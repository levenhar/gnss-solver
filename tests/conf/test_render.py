from __future__ import annotations

from gnss_engine.conf.render import render_conf
from gnss_engine.models.config import (
    ProcessingConfig,
    PositioningMode,
    Constellation,
    AmbiguityMode,
)


def _kv(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def test_static_gps_defaults_render():
    kv = _kv(render_conf(ProcessingConfig()))
    assert kv["pos1-posmode"] == "static"
    assert kv["pos1-navsys"] == "1"           # GPS only
    assert kv["pos1-elmask"] == "15"
    assert kv["pos2-armode"] == "continuous"
    assert kv["out-solformat"] == "llh"
    assert kv["out-outstat"] == "residual"


def test_multi_constellation_bitmask():
    cfg = ProcessingConfig(
        mode=PositioningMode.KINEMATIC,
        constellations=[Constellation.GPS, Constellation.GLO,
                        Constellation.GAL, Constellation.BDS],
        ambiguity=AmbiguityMode.FIX_HOLD,
    )
    kv = _kv(render_conf(cfg))
    assert kv["pos1-posmode"] == "kinematic"
    assert kv["pos1-navsys"] == "45"          # 1+4+8+32
    assert kv["pos2-armode"] == "fix-and-hold"
