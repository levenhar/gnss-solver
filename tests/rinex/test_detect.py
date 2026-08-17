from __future__ import annotations

from pathlib import Path

from gnss_engine.rinex.detect import (
    Compression,
    detect_compression,
    is_rinex_obs,
)


def test_detect_by_suffix():
    assert detect_compression(Path("a.rnx")) is Compression.NONE
    assert detect_compression(Path("a.rnx.gz")) is Compression.GZIP
    assert detect_compression(Path("a.obs.Z")) is Compression.UNIX_Z
    assert detect_compression(Path("a.crx")) is Compression.HATANAKA
    assert detect_compression(Path("site0010.23d")) is Compression.HATANAKA


def test_is_rinex_obs(tmp_path):
    obs = tmp_path / "r.rnx"
    obs.write_text(
        "     3.04           OBSERVATION DATA    M                   "
        "RINEX VERSION / TYPE\n",
        encoding="ascii",
    )
    nav = tmp_path / "n.rnx"
    nav.write_text(
        "     3.04           NAVIGATION DATA     M                   "
        "RINEX VERSION / TYPE\n",
        encoding="ascii",
    )
    assert is_rinex_obs(obs) is True
    assert is_rinex_obs(nav) is False
