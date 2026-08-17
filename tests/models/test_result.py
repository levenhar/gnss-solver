from __future__ import annotations

from datetime import datetime, timezone

from gnss_engine.models.result import (
    Epoch,
    SatStat,
    DatasetMeta,
    SolutionSummary,
    Solution,
)


def _epoch() -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=32.0, lon=34.0, h=50.0, q=1, ns=8,
        sdn=0.005, sde=0.005, sdu=0.01, sdne=0.0, age=0.0, ratio=99.9,
    )


def test_epoch_defaults_xyz_none():
    e = _epoch()
    assert e.x is None and e.y is None and e.z is None
    assert e.q == 1


def test_solution_is_json_serializable():
    sol = Solution(
        meta=DatasetMeta(
            rinex_version="3.04", file_type="O", interval_s=1.0,
            t_start=None, t_end=None, span_s=None,
            receiver="R", antenna="A", rover_id="ROVR",
        ),
        config_used={"mode": "static"},
        epochs=[_epoch()],
        sat_stats=[SatStat(
            t=datetime(2023, 1, 1, tzinfo=timezone.utc),
            sat="G01", az=120.0, el=45.0, snr=48.0,
            res_p=0.3, res_c=0.002, slip=False, fix=1,
        )],
        summary=SolutionSummary(
            n_epochs=1, n_fix=1, n_float=0, n_single=0, fix_rate_pct=100.0,
            mean_sdn=0.005, mean_sde=0.005, mean_sdu=0.01,
            rms_sdn=0.005, rms_sde=0.005, rms_sdu=0.01,
        ),
        engine_log="ok",
    )
    dumped = sol.model_dump(mode="json")
    assert dumped["summary"]["fix_rate_pct"] == 100.0
    assert dumped["epochs"][0]["q"] == 1
