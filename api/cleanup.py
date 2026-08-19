from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api import jobstore

DEFAULT_MAX_AGE = timedelta(days=3)


def remove_stale_data(max_age: timedelta = DEFAULT_MAX_AGE, now: datetime | None = None) -> dict:
    """Delete batches (and their jobs) and standalone jobs older than max_age.

    Jobs/batches with no known creation time (data predating this feature)
    are left alone rather than guessed at — same None-means-skip convention
    used elsewhere in jobstore.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - max_age

    removed_batches = []
    batch_job_ids: set[str] = set()
    for batch_id in jobstore.list_batch_ids():
        manifest = jobstore.read_batch_manifest(batch_id)
        if manifest is None:
            continue
        job_ids = [j["job_id"] for b in manifest["bases"] for j in b["jobs"]]
        batch_job_ids.update(job_ids)
        created_at = manifest.get("created_at")
        if created_at is None or datetime.fromisoformat(created_at) >= cutoff:
            continue
        for jid in job_ids:
            jobstore.delete_job(jid)
        jobstore.delete_batch(batch_id)
        removed_batches.append(batch_id)

    removed_jobs = []
    for job_id in jobstore.list_job_ids():
        if job_id in batch_job_ids:
            continue
        created_at = jobstore.read_job_created(job_id)
        if created_at is None or datetime.fromisoformat(created_at) >= cutoff:
            continue
        jobstore.delete_job(job_id)
        removed_jobs.append(job_id)

    return {"removed_batches": removed_batches, "removed_jobs": removed_jobs}
