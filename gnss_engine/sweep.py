from __future__ import annotations

import random

from gnss_engine.models.config import (
    AmbiguityMode,
    BaseCoordMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    ProcessingConfig,
    TropoModel,
)

_OPTIONAL_CONSTELLATIONS = (
    Constellation.GLO,
    Constellation.GAL,
    Constellation.BDS,
    Constellation.QZSS,
    Constellation.SBAS,
)


def _random_constellations(rng: random.Random) -> list[Constellation]:
    constellations = [Constellation.GPS]
    for c in _OPTIONAL_CONSTELLATIONS:
        if rng.random() < 0.5:
            constellations.append(c)
    return constellations


def random_sweep(n: int = 100, seed: int | None = None) -> list[ProcessingConfig]:
    rng = random.Random(seed)
    return [
        ProcessingConfig(
            mode=rng.choice(list(PositioningMode)),
            constellations=_random_constellations(rng),
            frequency=rng.choice(list(Frequency)),
            elev_mask_deg=rng.uniform(0.0, 90.0),
            snr_mask_dbhz=rng.uniform(0.0, 60.0),
            tropo=rng.choice(list(TropoModel)),
            iono=rng.choice(list(IonoModel)),
            ambiguity=rng.choice(list(AmbiguityMode)),
            ar_ratio_min=rng.uniform(1.5, 5.0),
            ar_min_lock=rng.randint(0, 10),
            ar_min_elev_deg=rng.uniform(0.0, 30.0),
            ephemeris=rng.choice(list(EphemerisSource)),
            base_coord_mode=BaseCoordMode.SINGLE,
            base_coord=None,
        )
        for _ in range(n)
    ]
