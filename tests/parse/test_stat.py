from __future__ import annotations

from pathlib import Path

import pytest

from gnss_engine.parse.stat import parse_stat
from gnss_engine.errors import ParseError

FIX = Path(__file__).parent / "fixtures" / "sample.stat"


def test_parse_stat_sat_rows_only():
    stats = parse_stat(FIX)
    assert len(stats) == 2          # $POS skipped
    s0 = stats[0]
    assert s0.sat == "G01"
    assert s0.az == 123.4
    assert s0.el == 45.6
    assert s0.res_p == 0.312
    assert s0.res_c == 0.0021
    assert s0.snr == 48.0
    assert s0.fix == 1
    assert s0.slip is False
    assert stats[1].slip is True     # slipc = 1


def test_malformed_sat_row_raises(tmp_path):
    bad = tmp_path / "bad.stat"
    bad.write_text("$SAT,2245,86400.0,G01\n", encoding="ascii")
    with pytest.raises(ParseError):
        parse_stat(bad)
