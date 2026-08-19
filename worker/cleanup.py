from __future__ import annotations

import logging
import time

from api.cleanup import DEFAULT_MAX_AGE, remove_stale_data

INTERVAL_SECONDS = 24 * 60 * 60

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cleanup")


def main() -> None:
    while True:
        result = remove_stale_data(max_age=DEFAULT_MAX_AGE)
        logger.info(
            "removed %d stale batch(es), %d stale standalone job(s)",
            len(result["removed_batches"]), len(result["removed_jobs"]),
        )
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
