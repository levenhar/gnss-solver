from __future__ import annotations

import random
from pathlib import Path

from gnss_engine.errors import RinexValidationError
from gnss_engine.models.config import (
    BaseCoordMode,
    Constellation,
    ProcessingConfig,
    SweepConfig,
)
from gnss_engine.rinex.obs import count_sats_by_system_per_epoch, min_sats_per_epoch

# Retries for one config slot before falling back to the full constellation
# pool (and, if even that fails, giving up on the whole sweep).
MAX_DRAW_ATTEMPTS = 25


def _random_constellations(rng: random.Random, pool: list[Constellation]) -> list[Constellation]:
    constellations = [Constellation.GPS]
    for c in pool:
        if rng.random() < 0.5:
            constellations.append(c)
    return constellations


def _draw_config(rng: random.Random, sweep: SweepConfig) -> ProcessingConfig:
    return ProcessingConfig(
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


def random_sweep(
    sweep: SweepConfig,
    n: int = 100,
    seed: int | None = None,
    rover_obs: Path | None = None,
    min_sats: int = 6,
) -> list[ProcessingConfig]:
    """Draw n random configs from the sweep.

    If rover_obs is given, each config is checked pre-run against the
    rover's raw per-epoch satellite counts (see gnss_engine.rinex.obs): a
    config whose chosen constellations drop below min_sats at any epoch is
    redrawn. A slot that still fails after MAX_DRAW_ATTEMPTS falls back to
    the full constellation pool; if even that isn't enough, raises
    RinexValidationError - no config can satisfy min_sats for this rover
    file.
    """
    rng = random.Random(seed)
    counts = count_sats_by_system_per_epoch(rover_obs) if rover_obs is not None else None

    configs: list[ProcessingConfig] = []
    for _ in range(n):
        cfg = _draw_config(rng, sweep)
        if counts is not None:
            attempts = 1
            while min_sats_per_epoch(counts, cfg.constellations) < min_sats and attempts < MAX_DRAW_ATTEMPTS:
                cfg = _draw_config(rng, sweep)
                attempts += 1
            if min_sats_per_epoch(counts, cfg.constellations) < min_sats:
                full_pool = [Constellation.GPS] + [
                    c for c in sweep.constellation_pool if c != Constellation.GPS
                ]
                cfg = cfg.model_copy(update={"constellations": full_pool})
                if min_sats_per_epoch(counts, cfg.constellations) < min_sats:
                    raise RinexValidationError(
                        f"rover has fewer than {min_sats} satellites at some epoch "
                        "even using every constellation in the sweep pool"
                    )
        configs.append(cfg)
    return configs
