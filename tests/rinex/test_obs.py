from __future__ import annotations

from pathlib import Path

import pytest

from gnss_engine.errors import ParseError
from gnss_engine.models.config import Constellation
from gnss_engine.rinex.obs import count_sats_by_system_per_epoch, min_sats_per_epoch

FIXTURES = Path(__file__).parent.parent / "fixtures"


def _time_field(yy=24, mm=1, dd=1, hh=0, mi=0, sec=0.0) -> str:
    return f"{yy:3d}{mm:3d}{dd:3d}{hh:3d}{mi:3d}{sec:11.7f}"


def _epoch_line(sats: list[str], flag: int = 0, **time_kwargs) -> str:
    line = _time_field(**time_kwargs) + f"{flag:3d}" + f"{len(sats):3d}"
    for s in sats[:12]:
        line += s
    return line


def _continuation_line(sats: list[str]) -> str:
    line = " " * 32
    for s in sats[:12]:
        line += s
    return line


def _obs_data_lines(n_sats: int, lines_per_sat: int) -> list[str]:
    return ["placeholder obs data"] * (n_sats * lines_per_sat)


def _write_rinex2(tmp_path: Path, n_obs_types: int, epochs: list[tuple[int, list[str]]]) -> Path:
    """epochs: list of (flag, sat_ids) where sat_ids like 'G02', 'R11'."""
    obs_types_content = (f"{n_obs_types:6d}" + "    C1" * min(n_obs_types, 9)).ljust(60)
    lines = [
        "     2.11           OBSERVATION DATA    M (MIXED)           RINEX VERSION / TYPE",
        "TEST                                                        MARKER NAME",
        obs_types_content + "# / TYPES OF OBSERV",
        "                                                            END OF HEADER",
    ]
    lines_per_sat = -(-n_obs_types // 5)
    for flag, sat_ids in epochs:
        lines.append(_epoch_line(sat_ids, flag=flag))
        for i in range(12, len(sat_ids), 12):
            lines.append(_continuation_line(sat_ids[i:i + 12]))
        if flag in (0, 1):
            lines.extend(_obs_data_lines(len(sat_ids), lines_per_sat))
    path = tmp_path / "test.obs"
    path.write_text("\n".join(lines) + "\n", encoding="ascii")
    return path


def test_counts_sats_by_system_single_epoch(tmp_path):
    path = _write_rinex2(tmp_path, n_obs_types=2, epochs=[(0, ["G02", "G03", "R11"])])
    counts = count_sats_by_system_per_epoch(path)
    assert counts == [{"G": 2, "R": 1}]


def test_counts_sats_across_multiple_epochs(tmp_path):
    path = _write_rinex2(
        tmp_path,
        n_obs_types=2,
        epochs=[
            (0, ["G02", "G03", "G06", "R11", "R12", "E02"]),
            (0, ["G02", "G03"]),
        ],
    )
    counts = count_sats_by_system_per_epoch(path)
    assert counts == [{"G": 3, "R": 2, "E": 1}, {"G": 2}]


def test_counts_sats_with_continuation_line(tmp_path):
    sats = [f"G{n:02d}" for n in range(1, 14)]  # 13 sats -> spills onto a continuation line
    path = _write_rinex2(tmp_path, n_obs_types=2, epochs=[(0, sats)])
    counts = count_sats_by_system_per_epoch(path)
    assert counts == [{"G": 13}]


def test_event_flag_epoch_is_not_counted_as_sats(tmp_path):
    path = _write_rinex2(
        tmp_path,
        n_obs_types=2,
        epochs=[(0, ["G02", "G03"]), (4, [])],
    )
    counts = count_sats_by_system_per_epoch(path)
    assert counts == [{"G": 2}]


def test_min_sats_per_epoch_picks_worst_epoch():
    counts = [{"G": 8, "R": 2}, {"G": 3, "R": 5}, {"G": 5, "R": 1}]
    assert min_sats_per_epoch(counts, [Constellation.GPS]) == 3
    assert min_sats_per_epoch(counts, [Constellation.GPS, Constellation.GLO]) == 6


def test_min_sats_per_epoch_empty_counts_is_zero():
    assert min_sats_per_epoch([], [Constellation.GPS]) == 0


def test_rinex3_obs_raises_parse_error(tmp_path):
    path = tmp_path / "v3.obs"
    path.write_text(
        "     3.04           OBSERVATION DATA    M                   RINEX VERSION / TYPE\n"
        "                                                            END OF HEADER\n",
        encoding="ascii",
    )
    with pytest.raises(ParseError):
        count_sats_by_system_per_epoch(path)


def test_real_rover_fixture_parses_without_error():
    counts = count_sats_by_system_per_epoch(FIXTURES / "rover.obs")
    assert len(counts) > 0
    assert all("G" in c for c in counts)
