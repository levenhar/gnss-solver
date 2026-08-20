from __future__ import annotations

from math import sqrt

from gnss_engine.models.result import Epoch, SolutionSummary


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _rms(values: list[float]) -> float:
    return sqrt(sum(v * v for v in values) / len(values)) if values else 0.0


def has_min_satellites(epochs: list[Epoch], min_sats: int = 6) -> bool:
    """True if every epoch used >= min_sats satellites (Epoch.ns)."""
    return all(e.ns >= min_sats for e in epochs)


def summarize(epochs: list[Epoch]) -> SolutionSummary:
    n = len(epochs)
    n_fix = sum(1 for e in epochs if e.q == 1)
    n_float = sum(1 for e in epochs if e.q == 2)
    n_single = sum(1 for e in epochs if e.q >= 4)
    sdn = [e.sdn for e in epochs]
    sde = [e.sde for e in epochs]
    sdu = [e.sdu for e in epochs]
    return SolutionSummary(
        n_epochs=n,
        n_fix=n_fix,
        n_float=n_float,
        n_single=n_single,
        fix_rate_pct=(100.0 * n_fix / n) if n else 0.0,
        mean_sdn=_mean(sdn),
        mean_sde=_mean(sde),
        mean_sdu=_mean(sdu),
        rms_sdn=_rms(sdn),
        rms_sde=_rms(sde),
        rms_sdu=_rms(sdu),
        # None (not 0.0) on empty epochs: (0, 0) is a real point and must not
        # silently pollute a batch's cross-job UTM reference average.
        mean_lat=_mean([e.lat for e in epochs]) if epochs else None,
        mean_lon=_mean([e.lon for e in epochs]) if epochs else None,
        mean_h=_mean([e.h for e in epochs]) if epochs else None,
        mean_sats=_mean([e.ns for e in epochs]) if epochs else None,
        min_sats=min((e.ns for e in epochs), default=None),
    )
