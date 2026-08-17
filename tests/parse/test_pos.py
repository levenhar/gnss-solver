from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from gnss_engine.parse.pos import parse_pos
from gnss_engine.errors import ParseError

FIX = Path(__file__).parent / "fixtures" / "sample.pos"


def test_parse_pos_rows():
    epochs = parse_pos(FIX)
    assert len(epochs) == 2
    e0 = epochs[0]
    assert e0.t == datetime(2023, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert e0.lat == 32.0
    assert e0.q == 1
    assert e0.ns == 9
    assert e0.sdn == 0.004
    assert e0.sdne == 0.001
    assert e0.ratio == 99.9
    assert epochs[1].q == 2


def test_malformed_row_raises(tmp_path):
    bad = tmp_path / "bad.pos"
    bad.write_text(
        "2023/01/01 00:00:00.000 32.0 34.0\n", encoding="ascii"
    )
    with pytest.raises(ParseError):
        parse_pos(bad)
