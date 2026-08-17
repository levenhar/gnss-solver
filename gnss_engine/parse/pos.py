from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.errors import ParseError
from gnss_engine.models.result import Epoch


def _parse_time(date_s: str, time_s: str) -> datetime:
    stamp = f"{date_s} {time_s}"
    dt = datetime.strptime(stamp, "%Y/%m/%d %H:%M:%S.%f")
    return dt.replace(tzinfo=timezone.utc)


def parse_pos(path: Path) -> list[Epoch]:
    epochs: list[Epoch] = []
    with path.open("r", encoding="ascii", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.strip() or line.lstrip().startswith("%"):
                continue
            cols = line.split()
            if len(cols) < 15:
                raise ParseError(
                    f"{path}:{lineno}: expected >=15 columns, got {len(cols)}"
                )
            try:
                epochs.append(Epoch(
                    t=_parse_time(cols[0], cols[1]),
                    lat=float(cols[2]),
                    lon=float(cols[3]),
                    h=float(cols[4]),
                    q=int(cols[5]),
                    ns=int(cols[6]),
                    sdn=float(cols[7]),
                    sde=float(cols[8]),
                    sdu=float(cols[9]),
                    sdne=float(cols[10]),
                    age=float(cols[13]),
                    ratio=float(cols[14]),
                ))
            except (ValueError, IndexError) as exc:
                raise ParseError(f"{path}:{lineno}: {exc}") from exc
    return epochs
