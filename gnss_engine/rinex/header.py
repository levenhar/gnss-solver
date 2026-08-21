from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_engine.models.result import DatasetMeta

_TYPE_MAP = {"O": "O", "N": "N", "G": "N", "M": "O"}


def _label(line: str) -> str:
    return line[60:80].strip()


def _obs_time(line: str) -> datetime:
    y = int(line[0:6]); mo = int(line[6:12]); d = int(line[12:18])
    h = int(line[18:24]); mi = int(line[24:30]); s = float(line[30:43])
    base = datetime(y, mo, d, h, mi, tzinfo=timezone.utc)
    return base + timedelta(seconds=s)


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


# RINEX 2.xx nav epoch line: (I2,5I3,F5.1,...) = PRN, YY, MM, DD, HH, MM, SS.S.
# RINEX 3.x sat IDs ("G09", "R01", ...) never match the leading I2 PRN slot,
# so this naturally yields no matches on RINEX 3 nav files rather than
# misparsing them - callers treat that as "can't determine, skip the check".
_NAV_EPOCH_LINE = re.compile(r"^(.{2})(.{3})(.{3})(.{3})(.{3})(.{3})(.{5})")


def parse_nav_time_range(path: Path) -> tuple[datetime | None, datetime | None]:
    """Min/max epoch across all broadcast records in a RINEX 2.xx nav file.

    Returns (None, None) if no epoch records can be recognized (e.g. a
    RINEX 3.x nav file, or a non-nav file) - this is a best-effort scan,
    not a full nav parser.
    """
    t_min: datetime | None = None
    t_max: datetime | None = None
    in_body = False
    with path.open("r", encoding="ascii", errors="replace") as fh:
        for line in fh:
            if not in_body:
                if _label(line) == "END OF HEADER":
                    in_body = True
                continue
            m = _NAV_EPOCH_LINE.match(line)
            if not m:
                continue
            try:
                prn = int(m.group(1))
                yy = int(m.group(2))
                mo = int(m.group(3))
                d = int(m.group(4))
                h = int(m.group(5))
                mi = int(m.group(6))
                s = float(m.group(7))
            except ValueError:
                continue
            if not (1 <= prn <= 99 and 1 <= mo <= 12 and 1 <= d <= 31 and 0 <= h <= 23 and 0 <= mi <= 59):
                continue
            year = 2000 + yy if yy < 80 else 1900 + yy
            try:
                t = datetime(year, mo, d, h, mi, tzinfo=timezone.utc) + timedelta(seconds=s)
            except ValueError:
                continue
            if t_min is None or t < t_min:
                t_min = t
            if t_max is None or t > t_max:
                t_max = t
    return t_min, t_max
