from __future__ import annotations

from datetime import datetime, timezone

from gnss_engine.parse.summary import has_min_satellites, summarize
from gnss_engine.models.result import Epoch


def _e(q: int, sdn: float, sde: float, sdu: float, lat: float = 0.0, lon: float = 0.0, h: float = 0.0, ns: int = 8) -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=lat, lon=lon, h=h, q=q, ns=ns,
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


def test_summary_mean_position():
    epochs = [
        _e(1, 0.01, 0.02, 0.03, lat=32.0, lon=34.0, h=50.0),
        _e(1, 0.01, 0.02, 0.03, lat=32.002, lon=34.004, h=52.0),
    ]
    s = summarize(epochs)
    assert abs(s.mean_lat - 32.001) < 1e-9
    assert abs(s.mean_lon - 34.002) < 1e-9
    assert abs(s.mean_h - 51.0) < 1e-9


def test_empty_summary_has_no_position():
    s = summarize([])
    assert s.mean_lat is None
    assert s.mean_lon is None
    assert s.mean_h is None


def test_has_min_satellites_true_when_all_epochs_meet_default():
    epochs = [_e(1, 0.01, 0.02, 0.03, ns=6), _e(1, 0.01, 0.02, 0.03, ns=9)]
    assert has_min_satellites(epochs) is True


def test_has_min_satellites_false_when_any_epoch_below():
    epochs = [_e(1, 0.01, 0.02, 0.03, ns=8), _e(1, 0.01, 0.02, 0.03, ns=5)]
    assert has_min_satellites(epochs) is False


def test_has_min_satellites_respects_custom_threshold():
    epochs = [_e(1, 0.01, 0.02, 0.03, ns=4)]
    assert has_min_satellites(epochs, min_sats=4) is True
    assert has_min_satellites(epochs, min_sats=5) is False


def test_has_min_satellites_vacuously_true_on_empty():
    assert has_min_satellites([]) is True
