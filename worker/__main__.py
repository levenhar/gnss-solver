from __future__ import annotations

import rq

from api.queue import QUEUE_NAME, get_redis


def main() -> None:
    worker = rq.Worker([QUEUE_NAME], connection=get_redis())
    worker.work()


if __name__ == "__main__":
    main()
