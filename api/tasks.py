from __future__ import annotations

from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine import solve
from gnss_engine.errors import RinexValidationError
from gnss_engine.parse.summary import has_min_satellites
from gnss_engine.sweep import random_sweep

MIN_SATS = 6
# Initial solve + up to this many redraws before giving up and keeping the
# last result (each attempt is a full rnx2rtkp run, so keep this bounded).
MAX_SOLVE_ATTEMPTS = 8


def run_solve_job(job_id: str) -> None:
    try:
        config = jobstore.read_config(job_id)
        rover, nav, base = jobstore.resolve_inputs(job_id)
        sweep = jobstore.read_job_sweep_config(job_id)
        workdir = jobstore.job_dir(job_id) / "work"

        solution = solve(rover, nav, config, base=base, workdir=workdir)
        attempt = 1
        # Only batch-created jobs carry a sweep_config; a user-picked
        # single-job config is never silently swapped out from under them.
        while (
            sweep is not None
            and not has_min_satellites(solution.epochs, MIN_SATS)
            and attempt < MAX_SOLVE_ATTEMPTS
        ):
            try:
                config = random_sweep(sweep, n=1, rover_obs=rover)[0]
            except RinexValidationError:
                # No constellation combination can reach MIN_SATS for this
                # rover - further redraws can't help either.
                break
            jobstore.write_config(job_id, config)
            solution = solve(rover, nav, config, base=base, workdir=workdir)
            attempt += 1

        jobstore.write_solution(job_id, solution.model_dump(mode="json"))
    except Exception as err:
        jobstore.write_error(
            job_id,
            ErrorInfo(
                type=type(err).__name__,
                message=str(err),
                workdir=getattr(err, "workdir", None),
            ),
        )
        raise
