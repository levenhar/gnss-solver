from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_engine.errors import ParseError
from gnss_engine.models.result import SatStat

_GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def _gps_to_utc(week: int, tow: float) -> datetime:
    # Leap seconds ignored in v1 (documented limitation).
    return _GPS_EPOCH + timedelta(weeks=week, seconds=tow)


def parse_stat(path: Path) -> list[SatStat]:
    stats: list[SatStat] = []
    with path.open("r", encoding="ascii", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.startswith("$SAT"):
                continue
            cols = line.strip().split(",")
            if len(cols) < 16:
                raise ParseError(
                    f"{path}:{lineno}: $SAT expected >=16 fields, got {len(cols)}"
                )
            try:
                stats.append(SatStat(
                    t=_gps_to_utc(int(cols[1]), float(cols[2])),
                    sat=cols[3],
                    az=float(cols[5]),
                    el=float(cols[6]),
                    res_p=float(cols[7]),
                    res_c=float(cols[8]),
                    snr=float(cols[10]),
                    fix=int(cols[11]),
                    slip=int(cols[15]) > 0,
                ))
            except (ValueError, IndexError) as exc:
                raise ParseError(f"{path}:{lineno}: {exc}") from exc
    return stats
