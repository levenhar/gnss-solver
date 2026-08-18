from __future__ import annotations

import statistics
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from api import jobstore
from api.queue import get_queue, get_redis
from api.schemas import (
    BatchBaseReport,
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchReportEntry,
    BatchReportResponse,
    BatchReportSummary,
    BatchStatusResponse,
    JobCreated,
    JobListItem,
    JobStatusResponse,
)
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.sweep import random_sweep
from rq.job import Job
from rq.exceptions import NoSuchJobError

app = FastAPI(title="GNSS Solver API")

# Cap on total fan-out (bases * n_configs) for a single POST /batches request.
# n_configs alone is capped 1-200, but the number of base files is unbounded,
# so this stops a request from synchronously creating an unreasonable number
# of job dirs (each duplicating full rover/nav/base file bytes to disk) before
# the request handler returns.
MAX_TOTAL_BATCH_JOBS = 500

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


@app.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    base: list[UploadFile] = File(...),
    n_configs: int = Form(100),
) -> BatchCreated:
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")
    if not base:
        raise HTTPException(status_code=422, detail="at least one base file is required")
    if not 1 <= n_configs <= 200:
        raise HTTPException(status_code=422, detail="n_configs must be between 1 and 200")
    if len(base) * n_configs > MAX_TOTAL_BATCH_JOBS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"total batch jobs (bases x n_configs = {len(base) * n_configs}) "
                f"must not exceed {MAX_TOTAL_BATCH_JOBS}"
            ),
        )

    batch_id = uuid.uuid4().hex
    rover_filename = rover.filename or "rover.rnx"
    rover_bytes = await rover.read()
    nav_uploads = [(nf.filename or "nav", await nf.read()) for nf in nav]
    configs = random_sweep(n=n_configs)
    queue = get_queue()

    bases_manifest = []
    for base_idx, bf in enumerate(base):
        base_id = f"base-{base_idx}"
        base_filename = bf.filename or f"base{base_idx}.rnx"
        base_bytes = await bf.read()
        jobs = []
        for config_idx, cfg in enumerate(configs):
            job_id = uuid.uuid4().hex
            jobstore.save_upload(job_id, "rover", rover_filename, rover_bytes)
            for nav_filename, nav_bytes in nav_uploads:
                jobstore.save_upload(job_id, "nav", nav_filename, nav_bytes)
            jobstore.save_upload(job_id, "base", base_filename, base_bytes)
            jobstore.write_config(job_id, cfg)
            queue.enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
            jobs.append({"job_id": job_id, "config_idx": config_idx})
        bases_manifest.append({"base_id": base_id, "filename": base_filename, "jobs": jobs})

    jobstore.write_batch_manifest(batch_id, {
        "batch_id": batch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "n_configs": n_configs,
        "bases": bases_manifest,
    })
    return BatchCreated(batch_id=batch_id, status="queued", n_bases=len(base), n_configs=n_configs)


def _batch_base_counts(job_ids: list[str]) -> tuple[int, int, int]:
    done = failed = 0
    for jid in job_ids:
        st = _status(jid)
        if st in ("finished", "failed"):
            done += 1
        if st == "failed":
            failed += 1
    return done, len(job_ids), failed


def _compute_batch_status(batch_id: str) -> BatchStatusResponse | None:
    manifest = jobstore.read_batch_manifest(batch_id)
    if manifest is None:
        return None
    base_statuses = []
    total_done = total_all = 0
    for b in manifest["bases"]:
        job_ids = [j["job_id"] for j in b["jobs"]]
        done, total, failed = _batch_base_counts(job_ids)
        base_statuses.append(BatchBaseStatus(base_id=b["base_id"], done=done, total=total, failed=failed))
        total_done += done
        total_all += total
    status = "finished" if total_all > 0 and total_done == total_all else "running"
    return BatchStatusResponse(batch_id=batch_id, status=status, bases=base_statuses, done=total_done, total=total_all)


@app.get("/batches/{batch_id}", response_model=BatchStatusResponse)
def batch_status(batch_id: str) -> BatchStatusResponse:
    result = _compute_batch_status(batch_id)
    if result is None:
        raise HTTPException(status_code=404, detail="batch not found")
    return result


@app.get("/batches", response_model=list[BatchListItem])
def list_batches() -> list[BatchListItem]:
    items = []
    for bid in jobstore.list_batch_ids():
        st = _compute_batch_status(bid)
        if st is not None:
            items.append(BatchListItem(batch_id=bid, status=st.status, done=st.done, total=st.total))
    return items


@app.get("/batches/{batch_id}/report", response_model=BatchReportResponse)
def batch_report(batch_id: str) -> BatchReportResponse:
    manifest = jobstore.read_batch_manifest(batch_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="batch not found")

    base_reports = []
    for b in manifest["bases"]:
        entries = []
        fix_rates = []
        for j in b["jobs"]:
            jid = j["job_id"]
            st = _status(jid)
            sol = jobstore.read_solution(jid) if st == "finished" else None
            cfg = jobstore.read_config(jid).model_dump(mode="json")
            fix_rate = sdn = sde = sdu = None
            error_type = error_message = None
            if sol is not None:
                summary = sol.get("summary", {})
                fix_rate = summary.get("fix_rate_pct")
                sdn = summary.get("rms_sdn")
                sde = summary.get("rms_sde")
                sdu = summary.get("rms_sdu")
                if fix_rate is not None:
                    fix_rates.append(fix_rate)
            if st == "failed":
                err = jobstore.read_error(jid)
                if err is not None:
                    error_type = err.type
                    error_message = err.message
            entries.append(BatchReportEntry(
                job_id=jid, config_idx=j["config_idx"], config=cfg, status=st,
                fix_rate_pct=fix_rate, rms_sdn=sdn, rms_sde=sde, rms_sdu=sdu,
                error_type=error_type, error_message=error_message,
            ))
        entries.sort(key=lambda e: (e.fix_rate_pct is None, -(e.fix_rate_pct or 0.0)))
        n_failed = sum(1 for e in entries if e.status == "failed")
        if fix_rates:
            best_entry = next(e for e in entries if e.fix_rate_pct == max(fix_rates))
            summary = BatchReportSummary(
                best_job_id=best_entry.job_id,
                best_fix_rate_pct=max(fix_rates),
                worst_fix_rate_pct=min(fix_rates),
                mean_fix_rate_pct=statistics.mean(fix_rates),
                median_fix_rate_pct=statistics.median(fix_rates),
                n_failed=n_failed,
            )
        else:
            summary = BatchReportSummary(n_failed=n_failed)
        base_reports.append(BatchBaseReport(base_id=b["base_id"], results=entries, summary=summary))

    return BatchReportResponse(batch_id=batch_id, bases=base_reports)


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
