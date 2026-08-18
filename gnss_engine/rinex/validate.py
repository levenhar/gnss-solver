from __future__ import annotations

from pathlib import Path

from gnss_engine.errors import RinexValidationError
from gnss_engine.rinex.detect import is_rinex_nav, is_rinex_obs, is_sp3


def validate_inputs(
    rover: Path, nav: list[Path], base: Path | None = None
) -> None:
    if not rover.exists():
        raise RinexValidationError(f"rover file not found: {rover}")
    if not is_rinex_obs(rover):
        raise RinexValidationError(f"rover is not a RINEX observation file: {rover}")

    if not nav:
        raise RinexValidationError("at least one navigation file is required")
    for n in nav:
        if not n.exists():
            raise RinexValidationError(f"navigation file not found: {n}")
        if not (is_rinex_nav(n) or is_sp3(n)):
            raise RinexValidationError(
                f"navigation file is not RINEX nav or SP3: {n}"
            )

    if base is not None:
        if not base.exists():
            raise RinexValidationError(f"base file not found: {base}")
        if not is_rinex_obs(base):
            raise RinexValidationError(f"base is not a RINEX observation file: {base}")
