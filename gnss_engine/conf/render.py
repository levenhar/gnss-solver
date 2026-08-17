from __future__ import annotations

from importlib import resources

from gnss_engine.models.config import (
    ProcessingConfig,
    AmbiguityMode,
    BaseCoordMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    TropoModel,
)

_NAVSYS_BITS = {
    Constellation.GPS: 1,
    Constellation.SBAS: 2,
    Constellation.GLO: 4,
    Constellation.GAL: 8,
    Constellation.QZSS: 16,
    Constellation.BDS: 32,
}

_MODE = {
    PositioningMode.STATIC: "static",
    PositioningMode.KINEMATIC: "kinematic",
    PositioningMode.MOVINGBASE: "movingbase",
    PositioningMode.PPP_STATIC: "ppp-static",
    PositioningMode.PPP_KINEMATIC: "ppp-kinematic",
}
_FREQ = {
    Frequency.L1: "l1",
    Frequency.L1L2: "l1+l2",
    Frequency.L1L2L5: "l1+l2+l5",
}
_TROPO = {
    TropoModel.OFF: "off",
    TropoModel.SAAS: "saas",
    TropoModel.SBAS: "sbas",
    TropoModel.EST_ZTD: "est-ztd",
    TropoModel.EST_ZTD_GRAD: "est-ztdgrad",
}
_IONO = {
    IonoModel.OFF: "off",
    IonoModel.BROADCAST: "brdc",
    IonoModel.SBAS: "sbas",
    IonoModel.IONO_FREE: "iono-free",
    IonoModel.EST_STEC: "est-stec",
    IonoModel.IONEX: "ionex-tec",
}
_AR = {
    AmbiguityMode.OFF: "off",
    AmbiguityMode.CONTINUOUS: "continuous",
    AmbiguityMode.INSTANTANEOUS: "instantaneous",
    AmbiguityMode.FIX_HOLD: "fix-and-hold",
}
_EPH = {
    EphemerisSource.BROADCAST: "brdc",
    EphemerisSource.PRECISE: "precise",
}
_BASE_COORD_MODE = {
    BaseCoordMode.SINGLE: "single",
    BaseCoordMode.KNOWN_LLH: "llh",
    BaseCoordMode.KNOWN_XYZ: "xyz",
}


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _overrides(config: ProcessingConfig) -> dict[str, str]:
    navsys = sum(_NAVSYS_BITS[c] for c in config.constellations)
    overrides = {
        "pos1-posmode": _MODE[config.mode],
        "pos1-frequency": _FREQ[config.frequency],
        "pos1-elmask": _fmt(config.elev_mask_deg),
        "pos1-snrmask_r": "on",
        "pos1-snrmask_b": "on",
        "pos1-snrmask_L1": _fmt(config.snr_mask_dbhz),
        "pos1-navsys": str(navsys),
        "pos1-tropopt": _TROPO[config.tropo],
        "pos1-ionoopt": _IONO[config.iono],
        "pos1-sateph": _EPH[config.ephemeris],
        "pos2-armode": _AR[config.ambiguity],
        "pos2-arthres": _fmt(config.ar_ratio_min),
        "pos2-arlockcnt": str(config.ar_min_lock),
        "pos2-arelmask": _fmt(config.ar_min_elev_deg),
        "out-solformat": "llh",
        "out-outstat": "residual",
        "ant2-postype": _BASE_COORD_MODE[config.base_coord_mode],
    }
    if (
        config.base_coord_mode in (BaseCoordMode.KNOWN_LLH, BaseCoordMode.KNOWN_XYZ)
        and config.base_coord is not None
    ):
        c1, c2, c3 = config.base_coord
        overrides["ant2-pos1"] = _fmt(c1)
        overrides["ant2-pos2"] = _fmt(c2)
        overrides["ant2-pos3"] = _fmt(c3)
    return overrides


def render_conf(config: ProcessingConfig) -> str:
    template = (
        resources.files("gnss_engine.conf")
        .joinpath("template.conf")
        .read_text(encoding="ascii")
    )
    overrides = _overrides(config)
    out_lines: list[str] = []
    for line in template.splitlines():
        stripped = line.split("#", 1)[0]
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in overrides:
                out_lines.append(f"{key:<18} ={overrides[key]}")
                continue
        out_lines.append(line)
    return "\n".join(out_lines) + "\n"
