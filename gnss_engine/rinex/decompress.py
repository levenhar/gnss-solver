from __future__ import annotations

import gzip
import shutil
import subprocess
from pathlib import Path

from gnss_engine.errors import DecompressError
from gnss_engine.rinex.detect import Compression, detect_compression


def decompress_to(path: Path, out_dir: Path) -> Path:
    comp = detect_compression(path)
    if comp is Compression.NONE:
        return path
    out_dir.mkdir(parents=True, exist_ok=True)

    if comp is Compression.GZIP:
        out = out_dir / path.with_suffix("").name
        try:
            with gzip.open(path, "rb") as src, out.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        except (OSError, EOFError) as exc:
            raise DecompressError(f"gzip failed for {path}: {exc}") from exc
        return out

    if comp is Compression.UNIX_Z:
        out = out_dir / path.with_suffix("").name
        try:
            with out.open("wb") as dst:
                subprocess.run(
                    ["gzip", "-dc", str(path)], stdout=dst, check=True
                )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise DecompressError(f".Z decompress failed for {path}: {exc}") from exc
        return out

    # HATANAKA: CRX2RNX writes alongside; -f overwrite, -s use stdout.
    out = out_dir / (path.stem + ".rnx")
    try:
        with out.open("wb") as dst:
            subprocess.run(
                ["CRX2RNX", "-s", str(path)], stdout=dst, check=True
            )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise DecompressError(f"CRX2RNX failed for {path}: {exc}") from exc
    return out
