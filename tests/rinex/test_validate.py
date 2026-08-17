from __future__ import annotations

import pytest

from gnss_engine.rinex.validate import validate_inputs
from gnss_engine.errors import RinexValidationError

OBS = (
    "     3.04           OBSERVATION DATA    M                   "
    "RINEX VERSION / TYPE\n"
)
NAV = (
    "     3.04           NAVIGATION DATA     M                   "
    "RINEX VERSION / TYPE\n"
)


def _write(p, text):
    p.write_text(text, encoding="ascii")
    return p


def test_valid_inputs_pass(tmp_path):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)
    validate_inputs(rover, [nav])  # no raise


def test_missing_nav_rejected(tmp_path):
    rover = _write(tmp_path / "r.rnx", OBS)
    with pytest.raises(RinexValidationError):
        validate_inputs(rover, [])


def test_rover_not_obs_rejected(tmp_path):
    rover = _write(tmp_path / "r.rnx", NAV)
    nav = _write(tmp_path / "r.nav", NAV)
    with pytest.raises(RinexValidationError):
        validate_inputs(rover, [nav])
