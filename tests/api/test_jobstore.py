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
