from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from gnss_engine.run.runner import run_rnx2rtkp, RunResult
from gnss_engine.errors import RtklibExecError


def _touch(p: Path) -> Path:
    p.write_text("x", encoding="ascii")
    return p


def test_runner_builds_args_and_returns_paths(tmp_path, monkeypatch):
    captured = {}

    def fake_run(args, capture_output, text, cwd=None):
        captured["args"] = args
        # simulate rnx2rtkp writing outputs
        (tmp_path / "solution.pos").write_text("% pos\n", encoding="ascii")
        (tmp_path / "solution.pos.stat").write_text("$POS\n", encoding="ascii")
        return subprocess.CompletedProcess(args, 0, stdout="done", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    conf = _touch(tmp_path / "opts.conf")
    rover = _touch(tmp_path / "r.rnx")
    nav = _touch(tmp_path / "r.nav")

    result = run_rnx2rtkp(conf, rover, None, [nav], tmp_path)
    assert isinstance(result, RunResult)
    assert result.pos_path == tmp_path / "solution.pos"
    assert result.stat_path == tmp_path / "solution.pos.stat"
    assert "rnx2rtkp" in captured["args"][0]
    assert str(conf) in captured["args"]
    assert str(rover) in captured["args"]
    assert str(nav) in captured["args"]


def test_runner_raises_on_nonzero_exit(tmp_path, monkeypatch):
    def fake_run(args, capture_output, text, cwd=None):
        return subprocess.CompletedProcess(args, 2, stdout="", stderr="bad rinex")

    monkeypatch.setattr(subprocess, "run", fake_run)

    conf = _touch(tmp_path / "opts.conf")
    rover = _touch(tmp_path / "r.rnx")
    nav = _touch(tmp_path / "r.nav")

    with pytest.raises(RtklibExecError) as ei:
        run_rnx2rtkp(conf, rover, None, [nav], tmp_path)
    assert ei.value.exit_code == 2
    assert "bad rinex" in ei.value.stderr
