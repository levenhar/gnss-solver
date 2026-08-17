from __future__ import annotations

from pathlib import Path

import pytest

import gnss_engine.engine as engine_mod
from gnss_engine.engine import solve
from gnss_engine.errors import RtklibExecError
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution
from gnss_engine.run.runner import RunResult

OBS = (
    "     3.04           OBSERVATION DATA    M                   "
    "RINEX VERSION / TYPE\n"
    "ROVR                                                        MARKER NAME\n"
    "                                                            END OF HEADER\n"
)
NAV = (
    "     3.04           NAVIGATION DATA     M                   "
    "RINEX VERSION / TYPE\n"
)


def _write(p: Path, text: str) -> Path:
    p.write_text(text, encoding="ascii")
    return p


def test_solve_pipeline_with_mocked_runner(tmp_path, monkeypatch):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)

    pos = _write(tmp_path / "solution.pos",
        "%  GPST\n"
        "2023/01/01 00:00:00.000 32.0 34.0 50.0 1 9 "
        "0.004 0.005 0.009 0.001 0.0 0.0 0.0 99.9\n")
    stat = _write(tmp_path / "solution.pos.stat",
        "$SAT,2245,86400.000,G01,1,123.4,45.6,0.312,0.0021,1,48.0,1,0,120,0,0,0\n")

    def fake_run(conf_path, rover_, base_, nav_, workdir, binary="rnx2rtkp"):
        return RunResult(pos_path=pos, stat_path=stat, stdout="ok", stderr="")

    monkeypatch.setattr(engine_mod, "run_rnx2rtkp", fake_run)

    sol = solve(rover, [nav], ProcessingConfig(), workdir=tmp_path)
    assert isinstance(sol, Solution)
    assert sol.meta.rover_id == "ROVR"
    assert sol.summary.n_epochs == 1
    assert sol.summary.fix_rate_pct == 100.0
    assert sol.epochs[0].q == 1
    assert sol.sat_stats[0].sat == "G01"
    assert sol.config_used["mode"] == "static"


def test_solve_no_workdir_cleans_up_temp_dir_on_success(tmp_path, monkeypatch):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)

    pos = _write(tmp_path / "solution.pos",
        "%  GPST\n"
        "2023/01/01 00:00:00.000 32.0 34.0 50.0 1 9 "
        "0.004 0.005 0.009 0.001 0.0 0.0 0.0 99.9\n")
    stat = _write(tmp_path / "solution.pos.stat",
        "$SAT,2245,86400.000,G01,1,123.4,45.6,0.312,0.0021,1,48.0,1,0,120,0,0,0\n")

    seen_workdir: dict[str, Path] = {}

    def fake_run(conf_path, rover_, base_, nav_, workdir, binary="rnx2rtkp"):
        seen_workdir["path"] = Path(workdir)
        return RunResult(pos_path=pos, stat_path=stat, stdout="ok", stderr="")

    monkeypatch.setattr(engine_mod, "run_rnx2rtkp", fake_run)

    sol = solve(rover, [nav], ProcessingConfig())
    assert isinstance(sol, Solution)
    assert "path" in seen_workdir
    assert not seen_workdir["path"].exists()


def test_solve_no_workdir_retains_temp_dir_on_failure(tmp_path, monkeypatch):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)

    def fake_run(conf_path, rover_, base_, nav_, workdir, binary="rnx2rtkp"):
        raise RtklibExecError(exit_code=1, stderr="boom", workdir=str(workdir))

    monkeypatch.setattr(engine_mod, "run_rnx2rtkp", fake_run)

    with pytest.raises(RtklibExecError) as ei:
        solve(rover, [nav], ProcessingConfig())

    retained = Path(ei.value.workdir)
    assert retained.exists()


@pytest.mark.requires_rtklib
def test_solve_integration_real_binary(tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    rover = fixtures / "rover.obs"
    base = fixtures / "base.obs"
    nav = fixtures / "brdc.nav"
    if not (rover.exists() and nav.exists()):
        pytest.skip("real RINEX fixtures not bundled")
    sol = solve(rover, [nav], ProcessingConfig(), base=base, workdir=tmp_path)
    assert sol.summary.n_epochs > 0
