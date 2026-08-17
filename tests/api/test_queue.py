from __future__ import annotations

import fakeredis

from api.queue import QUEUE_NAME, get_queue


def test_queue_uses_name_and_connection():
    fake = fakeredis.FakeStrictRedis()
    q = get_queue(connection=fake)
    assert q.name == QUEUE_NAME
    assert q.connection is fake


def test_enqueue_by_reference_creates_job():
    fake = fakeredis.FakeStrictRedis()
    q = get_queue(connection=fake)
    job = q.enqueue("api.tasks.run_solve_job", "job-xyz", job_id="job-xyz")
    assert job.id == "job-xyz"
    assert job.func_name == "api.tasks.run_solve_job"
