from __future__ import annotations

import pytest
from pydantic import ValidationError

from gnss_engine.models.config import (
    ProcessingConfig,
    PositioningMode,
    Constellation,
    AmbiguityMode,
    SweepConfig,
    Frequency,
    TropoModel,
    IonoModel,
    EphemerisSource,
)


def test_defaults():
    cfg = ProcessingConfig()
    assert cfg.mode is PositioningMode.STATIC
    assert cfg.constellations == [Constellation.GPS]
    assert cfg.ambiguity is AmbiguityMode.CONTINUOUS
    assert cfg.elev_mask_deg == 15.0


def test_multi_constellation_and_mode():
    cfg = ProcessingConfig(
        mode="kinematic",
        constellations=["GPS", "GAL", "BDS"],
    )
    assert cfg.mode is PositioningMode.KINEMATIC
    assert Constellation.GAL in cfg.constellations


def test_elev_mask_out_of_range_rejected():
    with pytest.raises(ValidationError):
        ProcessingConfig(elev_mask_deg=120.0)


def test_sweep_config_requires_mode():
    with pytest.raises(ValidationError):
        SweepConfig()


def test_sweep_config_defaults():
    sc = SweepConfig(mode="static")
    assert sc.mode is PositioningMode.STATIC
    assert set(sc.constellation_pool) == {
        Constellation.GLO, Constellation.GAL, Constellation.BDS, Constellation.QZSS, Constellation.SBAS,
    }
    assert sc.elev_mask_range == (0.0, 90.0)
    assert sc.ar_ratio_min_range == (1.5, 5.0)
    assert sc.ar_min_lock_range == (0, 10)
    assert sc.ar_min_elev_range == (0.0, 30.0)
    assert sc.snr_mask_dbhz == 15.0
    assert len(sc.frequency_pool) == 3
    assert len(sc.tropo_pool) == 5
    assert len(sc.iono_pool) == 6
    assert len(sc.ambiguity_pool) == 4
    assert len(sc.ephemeris_pool) == 2


@pytest.mark.parametrize(
    "field,value",
    [
        ("elev_mask_range", (50.0, 10.0)),
        ("ar_ratio_min_range", (5.0, 1.5)),
        ("ar_min_lock_range", (10, 0)),
        ("ar_min_elev_range", (20.0, 5.0)),
    ],
)
def test_sweep_config_range_min_must_not_exceed_max(field, value):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: value})


@pytest.mark.parametrize("field", ["elev_mask_range", "ar_min_elev_range"])
def test_sweep_config_elevation_ranges_bounded_0_to_90(field):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: (0.0, 120.0)})


def test_sweep_config_ar_min_lock_range_rejects_negative():
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", ar_min_lock_range=(-1, 5))


@pytest.mark.parametrize(
    "field",
    [
        "constellation_pool", "frequency_pool", "tropo_pool",
        "iono_pool", "ambiguity_pool", "ephemeris_pool",
    ],
)
def test_sweep_config_pools_reject_empty(field):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: []})
