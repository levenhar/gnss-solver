from __future__ import annotations

from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine.models.config import ProcessingConfig


def test_save_and_resolve_inputs(data_env):
    jid = "job1"
    jobstore.save_upload(jid, "rover", "r.rnx", b"OBS")
    jobstore.save_upload(jid, "nav", "a.nav", b"NAV1")
    jobstore.save_upload(jid, "nav", "b.nav", b"NAV2")
    rover, nav, base = jobstore.resolve_inputs(jid)
    assert rover.name == "r.rnx"
    assert [p.name for p in nav] == ["a.nav", "b.nav"]
    assert base is None


def test_config_roundtrip(data_env):
    jid = "job2"
    cfg = ProcessingConfig(mode="kinematic")
    jobstore.write_config(jid, cfg)
    loaded = jobstore.read_config(jid)
    assert loaded.mode == cfg.mode


def test_solution_and_error_roundtrip(data_env):
    jid = "job3"
    assert jobstore.read_solution(jid) is None
    assert jobstore.read_error(jid) is None
    jobstore.write_solution(jid, {"summary": {"fix_rate_pct": 100.0}})
    assert jobstore.read_solution(jid)["summary"]["fix_rate_pct"] == 100.0
    jobstore.write_error(jid, ErrorInfo(type="ParseError", message="x"))
    assert jobstore.read_error(jid).type == "ParseError"


def test_list_job_ids(data_env):
    jobstore.save_upload("j-a", "rover", "r.rnx", b"x")
    jobstore.save_upload("j-b", "rover", "r.rnx", b"x")
    assert set(jobstore.list_job_ids()) == {"j-a", "j-b"}


def test_batch_manifest_roundtrip(data_env):
    bid = "batch1"
    assert jobstore.read_batch_manifest(bid) is None
    manifest = {
        "batch_id": bid,
        "created_at": "2026-08-17T00:00:00+00:00",
        "n_configs": 2,
        "bases": [{"base_id": "base-0", "filename": "b.obs", "jobs": [
            {"job_id": "j1", "config_idx": 0},
            {"job_id": "j2", "config_idx": 1},
        ]}],
    }
    jobstore.write_batch_manifest(bid, manifest)
    loaded = jobstore.read_batch_manifest(bid)
    assert loaded == manifest


def test_list_batch_ids(data_env):
    jobstore.write_batch_manifest("b-a", {"batch_id": "b-a", "bases": []})
    jobstore.write_batch_manifest("b-b", {"batch_id": "b-b", "bases": []})
    assert set(jobstore.list_batch_ids()) == {"b-a", "b-b"}


def test_list_batch_ids_empty_when_no_batches_dir(data_env):
    assert jobstore.list_batch_ids() == []


def test_job_created_roundtrip(data_env):
    jid = "job-created"
    assert jobstore.read_job_created(jid) is None
    jobstore.write_job_created(jid)
    created = jobstore.read_job_created(jid)
    assert created is not None
    assert created.endswith("+00:00")


def test_delete_job_removes_directory(data_env):
    jobstore.save_upload("j-del", "rover", "r.rnx", b"x")
    assert jobstore.job_dir("j-del").exists()
    jobstore.delete_job("j-del")
    assert not jobstore.job_dir("j-del").exists()


def test_delete_job_missing_dir_is_a_noop(data_env):
    jobstore.delete_job("never-existed")  # must not raise


def test_delete_batch_removes_directory(data_env):
    jobstore.write_batch_manifest("b-del", {"batch_id": "b-del", "bases": []})
    assert jobstore.batch_dir("b-del").exists()
    jobstore.delete_batch("b-del")
    assert not jobstore.batch_dir("b-del").exists()


def test_job_name_roundtrip(data_env):
    jid = "job-name"
    assert jobstore.read_job_name(jid) is None
    jobstore.write_job_name(jid, "My Survey")
    assert jobstore.read_job_name(jid) == "My Survey"


def test_batch_name_roundtrip(data_env):
    bid = "batch-name"
    assert jobstore.read_batch_name(bid) is None
    jobstore.write_batch_name(bid, "Sweep A")
    assert jobstore.read_batch_name(bid) == "Sweep A"
