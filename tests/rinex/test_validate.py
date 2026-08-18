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
SP3 = "#dP2023  8 18  0  0  0.00000000     289 ORBIT IGb14 HLM  IGS\n"


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


def test_sp3_nav_accepted(tmp_path):
    rover = _write(tmp_path / "r.rnx", OBS)
    sp3 = _write(tmp_path / "orbit.sp3", SP3)
    validate_inputs(rover, [sp3])  # no raise


def test_nav_wrong_format_rejected(tmp_path):
    rover = _write(tmp_path / "r.rnx", OBS)
    bad_nav = _write(tmp_path / "r.nav", OBS)  # obs file mislabeled as nav
    with pytest.raises(RinexValidationError):
        validate_inputs(rover, [bad_nav])


def test_base_not_obs_rejected(tmp_path):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)
    base = _write(tmp_path / "b.rnx", NAV)
    with pytest.raises(RinexValidationError):
        validate_inputs(rover, [nav], base=base)
