from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from gnss_engine.conf.render import render_conf
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution
from gnss_engine.parse.pos import parse_pos
from gnss_engine.parse.stat import parse_stat
from gnss_engine.parse.summary import summarize
from gnss_engine.rinex.decompress import decompress_to
from gnss_engine.rinex.header import parse_header
from gnss_engine.rinex.validate import validate_inputs
from gnss_engine.run.runner import run_rnx2rtkp


def solve(
    rover: Path,
    nav: list[Path],
    config: ProcessingConfig,
    base: Path | None = None,
    workdir: Path | None = None,
) -> Solution:
    if workdir is None:
        tmp = tempfile.mkdtemp()
        try:
            result = solve(rover, nav, config, base=base, workdir=Path(tmp))
        except Exception:
            # Retain the temp workdir on failure so its path (carried in the
            # raised exception, e.g. RtklibExecError.workdir) is inspectable.
            raise
        else:
            shutil.rmtree(tmp, ignore_errors=True)
            return result

    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    prep = workdir / "input"

    rover = decompress_to(Path(rover), prep)
    nav = [decompress_to(Path(n), prep) for n in nav]
    base = decompress_to(Path(base), prep) if base is not None else None

    validate_inputs(rover, nav, base)

    meta = parse_header(rover)
    if base is not None:
        meta.base_id = parse_header(base).rover_id

    conf_path = workdir / "opts.conf"
    conf_path.write_text(render_conf(config), encoding="ascii")

    run = run_rnx2rtkp(conf_path, rover, base, nav, workdir)

    epochs = parse_pos(run.pos_path)
    sat_stats = parse_stat(run.stat_path) if run.stat_path.exists() else []
    summary = summarize(epochs)

    return Solution(
        meta=meta,
        config_used=config.model_dump(mode="json"),
        epochs=epochs,
        sat_stats=sat_stats,
        summary=summary,
        engine_log=run.stdout + run.stderr,
    )
