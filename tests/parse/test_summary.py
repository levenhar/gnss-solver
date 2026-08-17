from __future__ import annotations

from datetime import datetime, timezone

from gnss_engine.parse.summary import summarize
from gnss_engine.models.result import Epoch


def _e(q: int, sdn: float, sde: float, sdu: float) -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=0.0, lon=0.0, h=0.0, q=q, ns=8,
        sdn=sdn, sde=sde, sdu=sdu, sdne=0.0, age=0.0, ratio=0.0,
    )


def test_summary_counts_and_rate():
    epochs = [_e(1, 0.01, 0.02, 0.03), _e(1, 0.03, 0.04, 0.05), _e(2, 0.1, 0.1, 0.1), _e(5, 1.0, 1.0, 1.0)]
    s = summarize(epochs)
    assert s.n_epochs == 4
    assert s.n_fix == 2
    assert s.n_float == 1
    assert s.n_single == 1
    assert s.fix_rate_pct == 50.0
    assert abs(s.mean_sdn - (0.01 + 0.03 + 0.1 + 1.0) / 4) < 1e-9


def test_empty_summary_is_zeroed():
    s = summarize([])
    assert s.n_epochs == 0
    assert s.fix_rate_pct == 0.0
    assert s.mean_sdu == 0.0
