from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api import jobstore
from api.cleanup import remove_stale_data

NOW = datetime(2026, 8, 19, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_removes_standalone_job_older_than_max_age(data_env):
    jobstore.save_upload("old", "rover", "r.rnx", b"x")
    jobstore.write_job_created("old")
    old_created = _iso(NOW - timedelta(days=10))
    (jobstore.job_dir("old") / "created.json").write_text(
        f'{{"created_at": "{old_created}"}}', encoding="utf-8"
    )

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_jobs"] == ["old"]
    assert not jobstore.job_dir("old").exists()


def test_keeps_standalone_job_within_max_age(data_env):
    jobstore.save_upload("fresh", "rover", "r.rnx", b"x")
    jobstore.write_job_created("fresh")

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_jobs"] == []
    assert jobstore.job_dir("fresh").exists()


def test_keeps_job_with_unknown_creation_time(data_env):
    jobstore.save_upload("nometa", "rover", "r.rnx", b"x")

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_jobs"] == []
    assert jobstore.job_dir("nometa").exists()


def test_removes_stale_batch_and_its_jobs(data_env):
    jobstore.save_upload("j1", "rover", "r.rnx", b"x")
    jobstore.save_upload("j2", "rover", "r.rnx", b"x")
    old_created = _iso(NOW - timedelta(days=10))
    jobstore.write_batch_manifest("b-old", {
        "batch_id": "b-old",
        "created_at": old_created,
        "bases": [{"base_id": "base-0", "filename": "b.obs", "jobs": [
            {"job_id": "j1", "config_idx": 0},
            {"job_id": "j2", "config_idx": 1},
        ]}],
    })

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_batches"] == ["b-old"]
    assert not jobstore.batch_dir("b-old").exists()
    assert not jobstore.job_dir("j1").exists()
    assert not jobstore.job_dir("j2").exists()


def test_keeps_recent_batch_and_its_jobs(data_env):
    jobstore.save_upload("j1", "rover", "r.rnx", b"x")
    jobstore.write_batch_manifest("b-new", {
        "batch_id": "b-new",
        "created_at": _iso(NOW - timedelta(hours=1)),
        "bases": [{"base_id": "base-0", "filename": "b.obs", "jobs": [
            {"job_id": "j1", "config_idx": 0},
        ]}],
    })

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_batches"] == []
    assert jobstore.batch_dir("b-new").exists()
    assert jobstore.job_dir("j1").exists()


def test_batch_jobs_never_treated_as_standalone(data_env):
    # A job belonging to a fresh batch must not be independently evaluated
    # (and possibly removed) by the standalone-job pass, even though it has
    # no created.json of its own.
    jobstore.save_upload("j1", "rover", "r.rnx", b"x")
    jobstore.write_batch_manifest("b-new", {
        "batch_id": "b-new",
        "created_at": _iso(NOW - timedelta(hours=1)),
        "bases": [{"base_id": "base-0", "filename": "b.obs", "jobs": [
            {"job_id": "j1", "config_idx": 0},
        ]}],
    })

    result = remove_stale_data(max_age=timedelta(days=3), now=NOW)

    assert result["removed_jobs"] == []
    assert jobstore.job_dir("j1").exists()
