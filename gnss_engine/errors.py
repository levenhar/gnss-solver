from __future__ import annotations


class EngineError(Exception):
    """Base class for all gnss_engine errors."""


class DecompressError(EngineError):
    """Decompression tool missing or failed."""


class RinexValidationError(EngineError):
    """RINEX input malformed, or required obs/nav missing."""


class ParseError(EngineError):
    """A .pos or .stat output file could not be parsed."""


class RtklibExecError(EngineError):
    """rnx2rtkp exited non-zero."""

    def __init__(self, exit_code: int, stderr: str, workdir: str) -> None:
        self.exit_code = exit_code
        self.stderr = stderr
        self.workdir = workdir
        super().__init__(
            f"rnx2rtkp exited {exit_code} (workdir={workdir}): {stderr}"
        )
