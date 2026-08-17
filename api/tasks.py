from __future__ import annotations

from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine import solve
from gnss_engine.errors import EngineError


def run_solve_job(job_id: str) -> None:
    config = jobstore.read_config(job_id)
    rover, nav, base = jobstore.resolve_inputs(job_id)
    workdir = jobstore.job_dir(job_id) / "work"
    try:
        solution = solve(rover, nav, config, base=base, workdir=workdir)
    except EngineError as err:
        jobstore.write_error(
            job_id,
            ErrorInfo(
                type=type(err).__name__,
                message=str(err),
                workdir=getattr(err, "workdir", None),
            ),
        )
        raise
    jobstore.write_solution(job_id, solution.model_dump(mode="json"))
