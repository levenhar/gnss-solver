from __future__ import annotations

import pytest

import api.tasks as tasks
from api import jobstore
from gnss_engine.errors import RtklibExecError
from gnss_engine.models.config import ProcessingConfig


class _FakeSolution:
    def model_dump(self, mode="json"):
        return {"summary": {"fix_rate_pct": 100.0}}


def _seed_job(jid):
    jobstore.save_upload(jid, "rover", "r.rnx", b"OBS")
    jobstore.save_upload(jid, "nav", "a.nav", b"NAV")
    jobstore.write_config(jid, ProcessingConfig())


def test_run_solve_job_success_writes_solution(data_env, monkeypatch):
    jid = "ok-job"
    _seed_job(jid)

    def fake_solve(rover, nav, config, base=None, workdir=None):
        return _FakeSolution()

    monkeypatch.setattr(tasks, "solve", fake_solve)
    tasks.run_solve_job(jid)
    sol = jobstore.read_solution(jid)
    assert sol["summary"]["fix_rate_pct"] == 100.0
    assert jobstore.read_error(jid) is None


def test_run_solve_job_engine_error_writes_error_and_raises(data_env, monkeypatch):
    jid = "bad-job"
    _seed_job(jid)

    def fake_solve(rover, nav, config, base=None, workdir=None):
        raise RtklibExecError(exit_code=2, stderr="bad rinex", workdir="/data/jobs/bad-job/work")

    monkeypatch.setattr(tasks, "solve", fake_solve)
    with pytest.raises(RtklibExecError):
        tasks.run_solve_job(jid)
    err = jobstore.read_error(jid)
    assert err.type == "RtklibExecError"
    assert err.workdir == "/data/jobs/bad-job/work"
    assert jobstore.read_solution(jid) is None


def test_run_solve_job_non_engine_error_writes_error_and_raises(data_env, monkeypatch):
    jid = "runtime-error-job"
    _seed_job(jid)

    def fake_solve(rover, nav, config, base=None, workdir=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(tasks, "solve", fake_solve)
    with pytest.raises(RuntimeError):
        tasks.run_solve_job(jid)
    err = jobstore.read_error(jid)
    assert err.type == "RuntimeError"
    assert err.message == "boom"
    assert jobstore.read_solution(jid) is None
