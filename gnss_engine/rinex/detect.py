from __future__ import annotations

import re
from enum import Enum
from pathlib import Path


class Compression(str, Enum):
    NONE = "none"
    GZIP = "gzip"
    UNIX_Z = "unix-z"
    HATANAKA = "hatanaka"


_HATANAKA_OBS = re.compile(r"\.\d\dd$", re.IGNORECASE)


def detect_compression(path: Path) -> Compression:
    name = path.name.lower()
    if name.endswith(".gz"):
        return Compression.GZIP
    if name.endswith(".z"):
        return Compression.UNIX_Z
    if name.endswith(".crx") or _HATANAKA_OBS.search(name):
        return Compression.HATANAKA
    return Compression.NONE


def is_rinex_obs(path: Path) -> bool:
    with path.open("r", encoding="ascii", errors="replace") as fh:
        first = fh.readline()
    if "RINEX VERSION / TYPE" not in first:
        return False
    # File type is the char at column 21 (0-indexed 20) in RINEX header.
    return first[20:21].upper() == "O"
