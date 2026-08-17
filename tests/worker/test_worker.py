from __future__ import annotations

import rq

import worker.__main__ as worker_main
from api.queue import QUEUE_NAME


def test_main_builds_worker_on_gnss_queue(monkeypatch):
    captured = {}

    class _FakeWorker:
        def __init__(self, queues, connection=None):
            captured["queues"] = queues
            captured["connection"] = connection

        def work(self):
            captured["worked"] = True

    monkeypatch.setattr(rq, "Worker", _FakeWorker)
    monkeypatch.setattr(worker_main, "get_redis", lambda: "REDIS")

    worker_main.main()

    assert captured["queues"] == [QUEUE_NAME]
    assert captured["connection"] == "REDIS"
    assert captured["worked"] is True
