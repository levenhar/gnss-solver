from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.rinex.header import parse_header, parse_nav_time_range

FIX = Path(__file__).parent / "fixtures" / "rover_header.rnx"
NAV_FIX = Path(__file__).parent.parent / "fixtures" / "brdc.nav"


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


def test_parse_header_fractional_seconds(tmp_path):
    """Test that fractional seconds in RINEX header TIME OF OBS are preserved."""
    header_file = tmp_path / "test_frac.rnx"
    header_file.write_text(
        "     3.04           OBSERVATION DATA    M                   RINEX VERSION / TYPE\n"
        "TEST                                                        MARKER NAME\n"
        "     1.000                                                  INTERVAL\n"
        "  2023     1     1    12    30   30.5000000     GPS         TIME OF FIRST OBS\n"
        "                                                            END OF HEADER\n",
        encoding="ascii",
    )
    meta = parse_header(header_file)
    assert meta.t_start.microsecond == 500000, f"Expected 500000, got {meta.t_start.microsecond}"


def test_parse_nav_time_range_scans_broadcast_epochs():
    t_start, t_end = parse_nav_time_range(NAV_FIX)
    assert t_start == datetime(2023, 12, 31, 22, 0, 0, tzinfo=timezone.utc)
    assert t_end == datetime(2024, 1, 2, 2, 0, 0, tzinfo=timezone.utc)


def test_parse_nav_time_range_two_digit_year_pivot(tmp_path):
    nav_file = tmp_path / "test_pivot.nav"
    nav_file.write_text(
        "     2.10           N: GPS NAV DATA                         RINEX VERSION / TYPE\n"
        "                                                            END OF HEADER\n"
        " 5 99  6 15 12  0  0.0 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n"
        "    0.000000000000D+00 0.000000000000D+00\n",
        encoding="ascii",
    )
    t_start, t_end = parse_nav_time_range(nav_file)
    assert t_start == datetime(1999, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    assert t_end == t_start


def test_parse_nav_time_range_unrecognized_format_returns_none(tmp_path):
    nav_file = tmp_path / "test_rinex3.nav"
    nav_file.write_text(
        "     3.04           N: GNSS NAV DATA                        RINEX VERSION / TYPE\n"
        "                                                            END OF HEADER\n"
        "G09 2023 12 31 22 00  0.0 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00\n",
        encoding="ascii",
    )
    t_start, t_end = parse_nav_time_range(nav_file)
    assert t_start is None
    assert t_end is None
