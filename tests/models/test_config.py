from __future__ import annotations

import pytest
from pydantic import ValidationError

from gnss_engine.models.config import (
    ProcessingConfig,
    PositioningMode,
    Constellation,
    AmbiguityMode,
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
