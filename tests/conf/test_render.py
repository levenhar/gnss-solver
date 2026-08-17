from __future__ import annotations

from gnss_engine.conf.render import render_conf
from gnss_engine.models.config import (
    ProcessingConfig,
    PositioningMode,
    Constellation,
    AmbiguityMode,
    BaseCoordMode,
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


def test_snr_mask_enable_gates_are_turned_on():
    kv = _kv(render_conf(ProcessingConfig()))
    assert kv["pos1-snrmask_r"] == "on"
    assert kv["pos1-snrmask_b"] == "on"
    assert kv["pos1-snrmask_L1"] == "35"


def test_base_coord_mode_defaults_to_single():
    kv = _kv(render_conf(ProcessingConfig()))
    assert kv["ant2-postype"] == "single"


def test_base_coord_known_xyz_renders_position():
    cfg = ProcessingConfig(
        base_coord_mode=BaseCoordMode.KNOWN_XYZ,
        base_coord=(4000000.0, 3000000.0, 3900000.0),
    )
    kv = _kv(render_conf(cfg))
    assert kv["ant2-postype"] == "xyz"
    assert kv["ant2-pos1"] == "4000000"
    assert kv["ant2-pos2"] == "3000000"
    assert kv["ant2-pos3"] == "3900000"


def test_base_coord_known_llh_renders_position():
    cfg = ProcessingConfig(
        base_coord_mode=BaseCoordMode.KNOWN_LLH,
        base_coord=(32.5, 34.5, 100.0),
    )
    kv = _kv(render_conf(cfg))
    assert kv["ant2-postype"] == "llh"
    assert kv["ant2-pos1"] == "32.5"
