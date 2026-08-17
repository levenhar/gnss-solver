from __future__ import annotations

import pytest

from gnss_engine.errors import (
    EngineError,
    DecompressError,
    RinexValidationError,
    RtklibExecError,
    ParseError,
)


def test_all_errors_subclass_engine_error():
    for cls in (DecompressError, RinexValidationError, RtklibExecError, ParseError):
        assert issubclass(cls, EngineError)


def test_rtklib_exec_error_carries_context():
    err = RtklibExecError(exit_code=1, stderr="boom", workdir="/tmp/x")
    assert err.exit_code == 1
    assert err.stderr == "boom"
    assert err.workdir == "/tmp/x"
    assert "boom" in str(err)
