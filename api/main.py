from __future__ import annotations

import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from api import jobstore
from api.queue import get_queue, get_redis
from api.schemas import JobCreated, JobListItem, JobStatusResponse
from gnss_engine.models.config import ProcessingConfig
from rq.job import Job
from rq.exceptions import NoSuchJobError

app = FastAPI(title="GNSS Solver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _rq_status(job_id: str) -> str | None:
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJobError:
        return None
    st = job.get_status(refresh=True)
    if st in ("queued", "deferred", "scheduled"):
        return "queued"
    if st == "started":
        return "started"
    if st == "finished":
        return "finished"
    if st == "failed":
        return "failed"
    return None


def _status(job_id: str) -> str:
    rq = _rq_status(job_id)
    if rq is not None:
        return rq
    if jobstore.read_solution(job_id) is not None:
        return "finished"
    if jobstore.read_error(job_id) is not None:
        return "failed"
    if jobstore.job_dir(job_id).exists():
        return "queued"
    return "not_found"


@app.post("/jobs", status_code=201, response_model=JobCreated)
async def create_job(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    config: str = Form(...),
    base: UploadFile | None = File(None),
) -> JobCreated:
    try:
        cfg = ProcessingConfig.model_validate_json(config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid config: {exc}") from exc
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")

    job_id = uuid.uuid4().hex
    jobstore.save_upload(job_id, "rover", rover.filename or "rover.rnx", await rover.read())
    for nf in nav:
        jobstore.save_upload(job_id, "nav", nf.filename or "nav", await nf.read())
    if base is not None:
        jobstore.save_upload(job_id, "base", base.filename or "base.rnx", await base.read())
    jobstore.write_config(job_id, cfg)

    get_queue().enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
    return JobCreated(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    st = _status(job_id)
    if st == "not_found":
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse(job_id=job_id, status=st, error=jobstore.read_error(job_id))


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    st = _status(job_id)
    if st == "not_found":
        raise HTTPException(status_code=404, detail="job not found")
    if st == "failed":
        err = jobstore.read_error(job_id)
        raise HTTPException(status_code=409, detail=(err.model_dump(mode="json") if err else "failed"))
    sol = jobstore.read_solution(job_id)
    if sol is None:
        raise HTTPException(status_code=409, detail="result not ready")
    return sol


@app.get("/jobs", response_model=list[JobListItem])
def list_jobs() -> list[JobListItem]:
    return [JobListItem(job_id=j, status=_status(j)) for j in jobstore.list_job_ids()]


@app.get("/health")
def health() -> dict:
    try:
        ok = bool(get_redis().ping())
    except Exception:
        ok = False
    return {"status": "ok", "redis": ok}
