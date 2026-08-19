from __future__ import annotations

import json

import fakeredis
import pytest
from fastapi.testclient import TestClient

import api.main as main_mod
from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine.models.config import Constellation


@pytest.fixture
def client(data_env, monkeypatch):
    fake = fakeredis.FakeStrictRedis()
    monkeypatch.setattr(main_mod, "get_redis", lambda: fake)

    enqueued = {}

    class _FakeQueue:
        def enqueue(self, ref, *args, **kwargs):
            enqueued["ref"] = ref
            enqueued["job_id"] = kwargs.get("job_id", args[0] if args else None)
            return type("J", (), {"id": enqueued["job_id"]})()

    monkeypatch.setattr(main_mod, "get_queue", lambda connection=None: _FakeQueue())
    c = TestClient(main_mod.app)
    c.enqueued = enqueued
    return c


def _files():
    return [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]


def test_post_job_valid_enqueues(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"})},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    jid = body["job_id"]
    assert client.enqueued["ref"] == "api.tasks.run_solve_job"
    assert client.enqueued["job_id"] == jid
    # inputs persisted
    rover, nav, base = jobstore.resolve_inputs(jid)
    assert rover.name == "r.rnx"


def test_post_job_with_name_persists_and_returns_it(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"}), "name": "  My Survey  "},
    )
    assert resp.json()["name"] == "My Survey"
    jid = resp.json()["job_id"]
    assert jobstore.read_job_name(jid) == "My Survey"


def test_post_job_without_name_returns_none(client):
    resp = client.post("/jobs", files=_files(), data={"config": json.dumps({"mode": "static"})})
    assert resp.json()["name"] is None


def test_post_job_blank_name_is_treated_as_no_name(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"}), "name": "   "},
    )
    assert resp.json()["name"] is None


def test_list_jobs_includes_name(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_job_name("j1", "Named Job")
    items = {i["job_id"]: i["name"] for i in client.get("/jobs").json()}
    assert items["j1"] == "Named Job"


def test_job_status_includes_name(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_job_name("j1", "Named Job")
    assert client.get("/jobs/j1").json()["name"] == "Named Job"


def test_post_job_records_created_at(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"})},
    )
    jid = resp.json()["job_id"]
    assert jobstore.read_job_created(jid) is not None


def test_post_job_bad_config_is_422(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": "not-json"},
    )
    assert resp.status_code == 422


def test_get_status_404_when_unknown(client):
    assert client.get("/jobs/nope").status_code == 404


def test_result_flow_finished_and_failed(client):
    # finished
    jobstore.write_solution("fin", {"summary": {"fix_rate_pct": 50.0}})
    r = client.get("/jobs/fin/result")
    assert r.status_code == 200
    assert r.json()["summary"]["fix_rate_pct"] == 50.0
    assert client.get("/jobs/fin").json()["status"] == "finished"
    # failed
    jobstore.write_error("fl", ErrorInfo(type="ParseError", message="bad"))
    assert client.get("/jobs/fl").json()["status"] == "failed"
    rf = client.get("/jobs/fl/result")
    assert rf.status_code == 409
    assert rf.json()["detail"]["type"] == "ParseError"


def test_health_reports_redis(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["redis"] is True


def test_list_jobs(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_error("j2", ErrorInfo(type="X", message="y"))
    items = {i["job_id"]: i["status"] for i in client.get("/jobs").json()}
    assert items["j1"] == "finished"
    assert items["j2"] == "failed"


def test_list_jobs_excludes_batch_member_jobs(client):
    jobstore.write_solution("standalone", {"summary": {}})
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    manifest = jobstore.read_batch_manifest(resp.json()["batch_id"])
    batch_job_ids = {j["job_id"] for j in manifest["bases"][0]["jobs"]}

    listed = {i["job_id"] for i in client.get("/jobs").json()}

    assert "standalone" in listed
    assert listed.isdisjoint(batch_job_ids)


def _batch_files(n_bases=2):
    files = [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]
    for i in range(n_bases):
        files.append(("base", (f"base{i}.rnx", b"BASE", "application/octet-stream")))
    return files


def _sweep_config_json(**overrides) -> str:
    payload = {"mode": "static"}
    payload.update(overrides)
    return json.dumps(payload)


def _batch_data(n_configs, **sweep_overrides) -> dict:
    return {"n_configs": str(n_configs), "sweep_config": _sweep_config_json(**sweep_overrides)}


def test_post_batch_creates_jobs_for_every_base_and_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=2), data=_batch_data("3"))
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    assert body["n_bases"] == 2
    assert body["n_configs"] == 3
    manifest = jobstore.read_batch_manifest(body["batch_id"])
    assert len(manifest["bases"]) == 2
    for b in manifest["bases"]:
        assert len(b["jobs"]) == 3
    all_job_ids = [j["job_id"] for b in manifest["bases"] for j in b["jobs"]]
    assert len(set(all_job_ids)) == 6


def test_post_batch_requires_at_least_one_base(client):
    files = [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]
    resp = client.post("/batches", files=files, data={"n_configs": "5"})
    assert resp.status_code == 422


def test_post_batch_rejects_out_of_range_n_configs(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("0"))
    assert resp.status_code == 422


def test_post_batch_writes_created_at_to_manifest(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    assert manifest.get("created_at")


def test_post_batch_accepts_fanout_at_cap(client, monkeypatch):
    monkeypatch.setattr(main_mod, "MAX_TOTAL_BATCH_JOBS", 4)
    resp = client.post("/batches", files=_batch_files(n_bases=2), data=_batch_data("2"))
    assert resp.status_code == 201


def test_post_batch_rejects_fanout_over_cap(client, monkeypatch):
    monkeypatch.setattr(main_mod, "MAX_TOTAL_BATCH_JOBS", 4)
    resp = client.post("/batches", files=_batch_files(n_bases=2), data=_batch_data("3"))
    assert resp.status_code == 422


def test_post_batch_with_name_persists_and_returns_it(client):
    resp = client.post(
        "/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "  Sweep A  "}
    )
    assert resp.json()["name"] == "Sweep A"
    bid = resp.json()["batch_id"]
    assert jobstore.read_batch_name(bid) == "Sweep A"


def test_post_batch_without_name_returns_none(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    assert resp.json()["name"] is None


def test_list_batches_includes_name(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "Sweep A"})
    bid = resp.json()["batch_id"]
    items = {i["batch_id"]: i["name"] for i in client.get("/batches").json()}
    assert items[bid] == "Sweep A"


def test_batch_status_includes_name(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "Sweep A"})
    bid = resp.json()["batch_id"]
    assert client.get(f"/batches/{bid}").json()["name"] == "Sweep A"


def test_batch_status_aggregates_children(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 80.0, "rms_sdn": 0.1, "rms_sde": 0.1, "rms_sdu": 0.2}})
    jobstore.write_error(job_ids[1], ErrorInfo(type="ParseError", message="bad"))

    status = client.get(f"/batches/{bid}").json()
    assert status["status"] == "finished"
    assert status["done"] == 2
    assert status["total"] == 2
    assert status["bases"][0]["failed"] == 1


def test_batch_status_running_while_incomplete(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]
    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 80.0}})
    status = client.get(f"/batches/{bid}").json()
    assert status["status"] == "running"
    assert status["done"] == 1


def test_batch_status_404_when_unknown(client):
    assert client.get("/batches/nope").status_code == 404


def test_list_batches(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    items = client.get("/batches").json()
    assert any(i["batch_id"] == bid for i in items)


def test_batch_report_ranks_by_fix_rate_and_summarizes(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("3"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 60.0, "rms_sdn": 0.3, "rms_sde": 0.3, "rms_sdu": 0.4}})
    jobstore.write_solution(job_ids[1], {"summary": {"fix_rate_pct": 95.0, "rms_sdn": 0.1, "rms_sde": 0.1, "rms_sdu": 0.2}})
    jobstore.write_error(job_ids[2], ErrorInfo(type="RtklibExecError", message="boom"))

    report = client.get(f"/batches/{bid}/report").json()
    base_report = report["bases"][0]
    ordered_ids = [r["job_id"] for r in base_report["results"]]
    assert ordered_ids[0] == job_ids[1]
    assert ordered_ids[1] == job_ids[0]
    assert ordered_ids[2] == job_ids[2]
    assert base_report["results"][2]["status"] == "failed"
    assert base_report["results"][2]["fix_rate_pct"] is None

    summary = base_report["summary"]
    assert summary["best_job_id"] == job_ids[1]
    assert summary["best_fix_rate_pct"] == 95.0
    assert summary["worst_fix_rate_pct"] == 60.0
    assert summary["mean_fix_rate_pct"] == 77.5
    assert summary["n_failed"] == 1


def test_batch_report_all_failed_base_has_none_summary_no_crash(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("3"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    for jid in job_ids:
        jobstore.write_error(jid, ErrorInfo(type="RtklibExecError", message="boom"))

    resp = client.get(f"/batches/{bid}/report")
    assert resp.status_code == 200
    summary = resp.json()["bases"][0]["summary"]
    assert summary["best_job_id"] is None
    assert summary["best_fix_rate_pct"] is None
    assert summary["worst_fix_rate_pct"] is None
    assert summary["mean_fix_rate_pct"] is None
    assert summary["median_fix_rate_pct"] is None
    assert summary["n_failed"] == len(job_ids)


def test_batch_report_404_when_unknown(client):
    assert client.get("/batches/nope/report").status_code == 404


def test_batch_report_converts_mean_position_to_utm(client):
    from pyproj import Transformer

    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {
        "fix_rate_pct": 90.0, "mean_lat": 32.0, "mean_lon": 34.0, "mean_h": 50.0,
    }})
    jobstore.write_solution(job_ids[1], {"summary": {
        "fix_rate_pct": 80.0, "mean_lat": 32.002, "mean_lon": 34.004, "mean_h": 52.0,
    }})

    report = client.get(f"/batches/{bid}/report").json()
    results = {r["job_id"]: r for r in report["bases"][0]["results"]}

    ref_lon = (34.0 + 34.004) / 2
    zone = int((ref_lon + 180) // 6) + 1
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{32600 + zone}", always_xy=True)
    expected_e0, expected_n0 = transformer.transform(34.0, 32.0)
    expected_e1, expected_n1 = transformer.transform(34.004, 32.002)

    assert results[job_ids[0]]["utm_e"] == pytest.approx(expected_e0)
    assert results[job_ids[0]]["utm_n"] == pytest.approx(expected_n0)
    assert results[job_ids[0]]["mean_h"] == 50.0
    assert results[job_ids[1]]["utm_e"] == pytest.approx(expected_e1)
    assert results[job_ids[1]]["utm_n"] == pytest.approx(expected_n1)
    assert results[job_ids[1]]["mean_h"] == 52.0


def test_batch_report_no_position_data_leaves_utm_none(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 90.0}})
    jobstore.write_solution(job_ids[1], {"summary": {"fix_rate_pct": 80.0}})

    report = client.get(f"/batches/{bid}/report").json()
    for r in report["bases"][0]["results"]:
        assert r["utm_e"] is None
        assert r["utm_n"] is None


def test_batch_report_failed_entry_includes_error_info(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    jid = manifest["bases"][0]["jobs"][0]["job_id"]
    jobstore.write_error(jid, ErrorInfo(type="RtklibExecError", message="boom"))

    report = client.get(f"/batches/{bid}/report").json()
    entry = report["bases"][0]["results"][0]
    assert entry["status"] == "failed"
    assert entry["error_type"] == "RtklibExecError"
    assert entry["error_message"] == "boom"


def test_batch_report_finished_entry_has_no_error_info(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    jid = manifest["bases"][0]["jobs"][0]["job_id"]
    jobstore.write_solution(jid, {"summary": {"fix_rate_pct": 80.0}})

    report = client.get(f"/batches/{bid}/report").json()
    entry = report["bases"][0]["results"][0]
    assert entry["status"] == "finished"
    assert entry["error_type"] is None
    assert entry["error_message"] is None


def test_post_batch_requires_sweep_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "1"})
    assert resp.status_code == 422


def test_post_batch_rejects_invalid_sweep_config(client):
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data={"n_configs": "1", "sweep_config": "not-json"},
    )
    assert resp.status_code == 422


def test_post_batch_rejects_sweep_config_min_greater_than_max(client):
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data={"n_configs": "1", "sweep_config": _sweep_config_json(elev_mask_range=[80.0, 10.0])},
    )
    assert resp.status_code == 422


def test_post_batch_manifest_stores_sweep_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    assert manifest["sweep_config"]["mode"] == "static"


def test_post_batch_applies_sweep_config_bounds_to_generated_jobs(client):
    # NOTE: deviates from the brief's literal `constellation_pool=[]` — SweepConfig
    # (Task 1) validates all pool fields, including constellation_pool, as non-empty
    # (see test_sweep_config_pools_reject_empty in tests/models/test_config.py), so an
    # empty pool 422s rather than producing GPS-only configs. Using a single-item pool
    # instead, matching how tests/test_sweep.py itself verifies constellation bounding
    # (GPS always present, other members drawn only from the pool).
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data=_batch_data(
            "5",
            mode="kinematic",
            elev_mask_range=[10.0, 20.0],
            constellation_pool=["GLO"],
        ),
    )
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]
    for jid in job_ids:
        cfg = jobstore.read_config(jid)
        assert cfg.mode.value == "kinematic"
        assert 10.0 <= cfg.elev_mask_deg <= 20.0
        assert Constellation.GPS in cfg.constellations
        assert set(cfg.constellations) <= {Constellation.GPS, Constellation.GLO}
