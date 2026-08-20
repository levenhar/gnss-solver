from __future__ import annotations

from datetime import datetime, timezone

import pytest

import api.tasks as tasks
from api import jobstore
from gnss_engine.errors import RinexValidationError, RtklibExecError
from gnss_engine.models.config import ProcessingConfig, SweepConfig
from gnss_engine.models.result import Epoch


class _FakeSolution:
    def model_dump(self, mode="json"):
        return {"summary": {"fix_rate_pct": 100.0}}


def _epoch(ns: int) -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=0.0, lon=0.0, h=0.0, q=1, ns=ns,
        sdn=0.0, sde=0.0, sdu=0.0, sdne=0.0, age=0.0, ratio=0.0,
    )


class _FakeSolutionEpochs:
    def __init__(self, ns: int):
        self.epochs = [_epoch(ns)]

    def model_dump(self, mode="json"):
        return {"epochs": [{"ns": self.epochs[0].ns}]}


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


def test_run_solve_job_without_sweep_config_never_regenerates(data_env, monkeypatch):
    jid = "no-sweep-job"
    _seed_job(jid)

    calls = {"n": 0}

    def fake_solve(rover, nav, config, base=None, workdir=None):
        calls["n"] += 1
        return _FakeSolutionEpochs(3)

    monkeypatch.setattr(tasks, "solve", fake_solve)
    tasks.run_solve_job(jid)
    assert calls["n"] == 1
    assert jobstore.read_solution(jid)["epochs"][0]["ns"] == 3


def test_run_solve_job_regenerates_when_below_min_sats(data_env, monkeypatch):
    jid = "regen-job"
    _seed_job(jid)
    jobstore.write_job_sweep_config(jid, SweepConfig(mode="static"))

    calls = {"n": 0}

    def fake_solve(rover, nav, config, base=None, workdir=None):
        calls["n"] += 1
        return _FakeSolutionEpochs(3 if calls["n"] == 1 else 8)

    def fake_random_sweep(sweep, n=1, rover_obs=None, seed=None, min_sats=6):
        return [ProcessingConfig()]

    monkeypatch.setattr(tasks, "solve", fake_solve)
    monkeypatch.setattr(tasks, "random_sweep", fake_random_sweep)
    tasks.run_solve_job(jid)
    assert calls["n"] == 2
    assert jobstore.read_solution(jid)["epochs"][0]["ns"] == 8


def test_run_solve_job_gives_up_after_max_attempts(data_env, monkeypatch):
    jid = "regen-giveup-job"
    _seed_job(jid)
    jobstore.write_job_sweep_config(jid, SweepConfig(mode="static"))

    calls = {"n": 0}

    def fake_solve(rover, nav, config, base=None, workdir=None):
        calls["n"] += 1
        return _FakeSolutionEpochs(3)

    def fake_random_sweep(sweep, n=1, rover_obs=None, seed=None, min_sats=6):
        return [ProcessingConfig()]

    monkeypatch.setattr(tasks, "solve", fake_solve)
    monkeypatch.setattr(tasks, "random_sweep", fake_random_sweep)
    tasks.run_solve_job(jid)
    assert calls["n"] == tasks.MAX_SOLVE_ATTEMPTS
    assert jobstore.read_solution(jid)["epochs"][0]["ns"] == 3


def test_run_solve_job_stops_regen_when_rover_cannot_reach_min_sats(data_env, monkeypatch):
    jid = "regen-infeasible-job"
    _seed_job(jid)
    jobstore.write_job_sweep_config(jid, SweepConfig(mode="static"))

    calls = {"n": 0}

    def fake_solve(rover, nav, config, base=None, workdir=None):
        calls["n"] += 1
        return _FakeSolutionEpochs(3)

    def fake_random_sweep(sweep, n=1, rover_obs=None, seed=None, min_sats=6):
        raise RinexValidationError("rover has fewer than 6 satellites at some epoch")

    monkeypatch.setattr(tasks, "solve", fake_solve)
    monkeypatch.setattr(tasks, "random_sweep", fake_random_sweep)
    tasks.run_solve_job(jid)
    assert calls["n"] == 1
    assert jobstore.read_solution(jid)["epochs"][0]["ns"] == 3
