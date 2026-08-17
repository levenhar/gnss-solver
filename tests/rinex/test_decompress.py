from __future__ import annotations

import gzip
from pathlib import Path

import pytest

from gnss_engine.rinex.decompress import decompress_to
from gnss_engine.errors import DecompressError


def test_passthrough_when_plain(tmp_path):
    src = tmp_path / "r.rnx"
    src.write_text("plain", encoding="ascii")
    out = decompress_to(src, tmp_path / "work")
    assert out == src


def test_gzip_roundtrip(tmp_path):
    payload = "RINEX CONTENT LINE\n"
    src = tmp_path / "r.rnx.gz"
    with gzip.open(src, "wt", encoding="ascii") as fh:
        fh.write(payload)
    work = tmp_path / "work"
    work.mkdir()
    out = decompress_to(src, work)
    assert out.parent == work
    assert out.suffix != ".gz"
    assert out.read_text(encoding="ascii") == payload


def test_missing_gzip_file_raises(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    with pytest.raises(DecompressError):
        decompress_to(tmp_path / "nope.rnx.gz", work)
