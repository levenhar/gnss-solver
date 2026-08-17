from __future__ import annotations

from gnss_engine.models.config import Constellation, BaseCoordMode
from gnss_engine.sweep import random_sweep


def test_random_sweep_returns_n_configs():
    configs = random_sweep(n=100, seed=1)
    assert len(configs) == 100


def test_random_sweep_fields_within_valid_ranges():
    configs = random_sweep(n=50, seed=2)
    for c in configs:
        assert 0.0 <= c.elev_mask_deg <= 90.0
        assert 0.0 <= c.snr_mask_dbhz <= 60.0
        assert 1.5 <= c.ar_ratio_min <= 5.0
        assert 0 <= c.ar_min_lock <= 10
        assert 0.0 <= c.ar_min_elev_deg <= 30.0
        assert Constellation.GPS in c.constellations
        assert c.base_coord_mode == BaseCoordMode.SINGLE
        assert c.base_coord is None


def test_random_sweep_reproducible_with_seed():
    a = random_sweep(n=10, seed=42)
    b = random_sweep(n=10, seed=42)
    assert [x.model_dump(mode="json") for x in a] == [x.model_dump(mode="json") for x in b]


def test_random_sweep_default_n_is_100():
    assert len(random_sweep(seed=7)) == 100
