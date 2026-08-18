from __future__ import annotations

import random

from gnss_engine.models.config import (
    BaseCoordMode,
    Constellation,
    ProcessingConfig,
    SweepConfig,
)


def _random_constellations(rng: random.Random, pool: list[Constellation]) -> list[Constellation]:
    constellations = [Constellation.GPS]
    for c in pool:
        if rng.random() < 0.5:
            constellations.append(c)
    return constellations


def random_sweep(sweep: SweepConfig, n: int = 100, seed: int | None = None) -> list[ProcessingConfig]:
    rng = random.Random(seed)
    return [
        ProcessingConfig(
            mode=sweep.mode,
            constellations=_random_constellations(rng, sweep.constellation_pool),
            frequency=rng.choice(sweep.frequency_pool),
            elev_mask_deg=rng.uniform(*sweep.elev_mask_range),
            snr_mask_dbhz=sweep.snr_mask_dbhz,
            tropo=rng.choice(sweep.tropo_pool),
            iono=rng.choice(sweep.iono_pool),
            ambiguity=rng.choice(sweep.ambiguity_pool),
            ar_ratio_min=rng.uniform(*sweep.ar_ratio_min_range),
            ar_min_lock=rng.randint(*sweep.ar_min_lock_range),
            ar_min_elev_deg=rng.uniform(*sweep.ar_min_elev_range),
            ephemeris=rng.choice(sweep.ephemeris_pool),
            base_coord_mode=BaseCoordMode.SINGLE,
            base_coord=None,
        )
        for _ in range(n)
    ]
