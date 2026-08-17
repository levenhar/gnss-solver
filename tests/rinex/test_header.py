from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.rinex.header import parse_header

FIX = Path(__file__).parent / "fixtures" / "rover_header.rnx"


def test_parse_header_fields():
    meta = parse_header(FIX)
    assert meta.rinex_version == "3.04"
    assert meta.file_type == "O"
    assert meta.interval_s == 1.0
    assert meta.rover_id == "ROVR"
    assert meta.receiver == "SEPT POLARX5"
    assert meta.antenna == "TRM59800.00     NONE"
    assert meta.t_start == datetime(2023, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert meta.t_end == datetime(2023, 1, 1, 0, 0, 30, tzinfo=timezone.utc)
    assert meta.span_s == 30.0
