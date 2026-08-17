from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.models.result import DatasetMeta

_TYPE_MAP = {"O": "O", "N": "N", "G": "N", "M": "O"}


def _label(line: str) -> str:
    return line[60:80].strip()


def _obs_time(line: str) -> datetime:
    y = int(line[0:6]); mo = int(line[6:12]); d = int(line[12:18])
    h = int(line[18:24]); mi = int(line[24:30]); s = float(line[30:43])
    sec = int(s)
    micro = round((s - sec) * 1_000_000)
    return datetime(y, mo, d, h, mi, sec, microsecond=micro, tzinfo=timezone.utc)


def parse_header(path: Path) -> DatasetMeta:
    version = ""
    ftype = ""
    interval = None
    t_start = None
    t_end = None
    receiver = None
    antenna = None
    rover_id = None

    with path.open("r", encoding="ascii", errors="replace") as fh:
        for line in fh:
            label = _label(line)
            if label == "RINEX VERSION / TYPE":
                version = line[0:9].strip()
                ftype = line[20:21].upper()
            elif label == "MARKER NAME":
                rover_id = line[0:60].strip() or None
            elif label == "REC # / TYPE / VERS":
                receiver = line[20:40].strip() or None
            elif label == "ANT # / TYPE":
                antenna = line[20:40].strip() or None
            elif label == "INTERVAL":
                interval = float(line[0:10])
            elif label == "TIME OF FIRST OBS":
                t_start = _obs_time(line)
            elif label == "TIME OF LAST OBS":
                t_end = _obs_time(line)
            elif label == "END OF HEADER":
                break

    span = None
    if t_start is not None and t_end is not None:
        span = (t_end - t_start).total_seconds()

    return DatasetMeta(
        rinex_version=version,
        file_type=_TYPE_MAP.get(ftype, ftype),
        interval_s=interval,
        t_start=t_start,
        t_end=t_end,
        span_s=span,
        receiver=receiver,
        antenna=antenna,
        rover_id=rover_id,
    )
