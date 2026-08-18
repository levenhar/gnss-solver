from __future__ import annotations

from gnss_engine.models.config import (
    AmbiguityMode,
    BaseCoordMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    SweepConfig,
    TropoModel,
)
from gnss_engine.sweep import random_sweep


def _default_sweep(**overrides) -> SweepConfig:
    defaults = {"mode": "static"}
    defaults.update(overrides)
    return SweepConfig(**defaults)


def test_random_sweep_returns_n_configs():
    configs = random_sweep(_default_sweep(), n=100, seed=1)
    assert len(configs) == 100


def test_random_sweep_default_n_is_100():
    assert len(random_sweep(_default_sweep(), seed=7)) == 100


def test_random_sweep_mode_is_const_from_sweep_config():
    sweep = _default_sweep(mode="kinematic")
    configs = random_sweep(sweep, n=20, seed=3)
    assert all(c.mode is PositioningMode.KINEMATIC for c in configs)


def test_random_sweep_fields_within_configured_ranges():
    sweep = _default_sweep(
        elev_mask_range=(5.0, 10.0),
        ar_ratio_min_range=(2.0, 2.5),
        ar_min_lock_range=(1, 3),
        ar_min_elev_range=(1.0, 4.0),
        snr_mask_dbhz=22.0,
    )
    configs = random_sweep(sweep, n=50, seed=2)
    for c in configs:
        assert 5.0 <= c.elev_mask_deg <= 10.0
        assert c.snr_mask_dbhz == 22.0
        assert 2.0 <= c.ar_ratio_min <= 2.5
        assert 1 <= c.ar_min_lock <= 3
        assert 1.0 <= c.ar_min_elev_deg <= 4.0
        assert Constellation.GPS in c.constellations
        assert c.base_coord_mode == BaseCoordMode.SINGLE
        assert c.base_coord is None


def test_random_sweep_constellations_limited_to_pool_plus_gps():
    sweep = _default_sweep(constellation_pool=[Constellation.GLO])
    configs = random_sweep(sweep, n=50, seed=5)
    for c in configs:
        assert Constellation.GPS in c.constellations
        assert set(c.constellations) <= {Constellation.GPS, Constellation.GLO}
    assert any(Constellation.GLO in c.constellations for c in configs)


def test_random_sweep_enum_fields_limited_to_pool():
    sweep = _default_sweep(
        frequency_pool=[Frequency.L1],
        tropo_pool=[TropoModel.OFF],
        iono_pool=[IonoModel.OFF],
        ambiguity_pool=[AmbiguityMode.OFF],
        ephemeris_pool=[EphemerisSource.BROADCAST],
    )
    configs = random_sweep(sweep, n=10, seed=6)
    for c in configs:
        assert c.frequency == Frequency.L1
        assert c.tropo == TropoModel.OFF
        assert c.iono == IonoModel.OFF
        assert c.ambiguity == AmbiguityMode.OFF
        assert c.ephemeris == EphemerisSource.BROADCAST


def test_random_sweep_reproducible_with_seed():
    sweep = _default_sweep()
    a = random_sweep(sweep, n=10, seed=42)
    b = random_sweep(sweep, n=10, seed=42)
    assert [x.model_dump(mode="json") for x in a] == [x.model_dump(mode="json") for x in b]
