from __future__ import annotations

import redis
from rq import Queue

from api.config import get_settings

QUEUE_NAME = "gnss"


def get_redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url)


def get_queue(connection: redis.Redis | None = None) -> Queue:
    return Queue(QUEUE_NAME, connection=connection or get_redis())
