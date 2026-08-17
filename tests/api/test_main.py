from __future__ import annotations

import json

import fakeredis
import pytest
from fastapi.testclient import TestClient

import api.main as main_mod
from api import jobstore
from api.schemas import ErrorInfo


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
