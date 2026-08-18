from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from gnss_engine.errors import RtklibExecError


@dataclass
class RunResult:
    pos_path: Path
    stat_path: Path
    stdout: str
    stderr: str


def run_rnx2rtkp(
    conf_path: Path,
    rover: Path,
    base: Path | None,
    nav: list[Path],
    workdir: Path,
    binary: str = "rnx2rtkp",
) -> RunResult:
    workdir.mkdir(parents=True, exist_ok=True)
    pos_path = workdir / "solution.pos"
    stat_path = workdir / "solution.pos.stat"

    args: list[str] = [binary, "-k", str(conf_path), "-o", str(pos_path), str(rover)]
    if base is not None:
        args.append(str(base))
    args.extend(str(n) for n in nav)

    proc = subprocess.run(args, capture_output=True, text=True, cwd=str(workdir))
    if proc.returncode != 0 or not pos_path.exists():
        # rnx2rtkp (demo5 build) reports fatal errors via showmsg() to
        # stdout and still exits 0 without writing solution.pos, so a
        # missing output file is treated as a failure too.
        raise RtklibExecError(
            exit_code=proc.returncode,
            stderr=(proc.stderr or "") + (proc.stdout or ""),
            workdir=str(workdir),
        )
    return RunResult(
        pos_path=pos_path,
        stat_path=stat_path,
        stdout=proc.stdout or "",
        stderr=proc.stderr or "",
    )
