from __future__ import annotations

from pathlib import Path

from gnss_engine.errors import ParseError
from gnss_engine.models.config import Constellation

# RINEX satellite system letters (used in the 'Gnn'/'Rnn'/... sat IDs on
# epoch record lines), keyed by the engine's own Constellation enum.
SYSTEM_LETTERS: dict[Constellation, str] = {
    Constellation.GPS: "G",
    Constellation.GLO: "R",
    Constellation.GAL: "E",
    Constellation.BDS: "C",
    Constellation.QZSS: "J",
    Constellation.SBAS: "S",
}


def _header_obs_type_count(lines: list[str]) -> tuple[int, int]:
    """Return (n_obs_types, index of first line after END OF HEADER)."""
    n_obs_types = 0
    for idx, line in enumerate(lines):
        label = line[60:80].strip()
        if idx == 0 and label == "RINEX VERSION / TYPE":
            version = line[0:9].strip()
            if version and float(version) >= 3.0:
                # RINEX 3's '>'-prefixed epoch records use a different
                # layout (no wrapped sat list on the epoch line); not
                # handled here.
                raise ParseError(
                    f"RINEX {version} observation files are not supported "
                    "by count_sats_by_system_per_epoch (RINEX 2.xx only)"
                )
        if label == "# / TYPES OF OBSERV" and n_obs_types == 0:
            n_obs_types = int(line[0:6])
        elif label == "END OF HEADER":
            return n_obs_types, idx + 1
    raise ParseError(f"END OF HEADER not found in {lines[0] if lines else '<empty file>'}")


def count_sats_by_system_per_epoch(path: Path) -> list[dict[str, int]]:
    """Per-epoch satellite counts by RINEX system letter (e.g. {"G": 8, "R": 4}).

    Reads only epoch/sat-list records (RINEX 2.xx observation format) and
    skips over the observation data lines themselves - this is a raw
    visibility count straight from the file, with no elevation or SNR
    filtering applied (that requires ephemeris + a receiver position, which
    only rnx2rtkp itself computes).
    """
    lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    n_obs_types, i = _header_obs_type_count(lines)
    lines_per_sat = -(-n_obs_types // 5) if n_obs_types else 0

    n = len(lines)
    counts: list[dict[str, int]] = []
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        flag = int(line[26:29])
        nsat = int(line[29:32])

        sats: list[str] = []
        remaining = nsat
        li = i
        first_line = True
        while remaining > 0 or first_line:
            take = min(remaining, 12) if remaining > 0 else 0
            row = lines[li] if li < n else ""
            for k in range(take):
                start = 32 + k * 3
                sats.append(row[start:start + 3].strip())
            remaining -= take
            li += 1
            first_line = False

        if flag in (0, 1):
            by_sys: dict[str, int] = {}
            for s in sats:
                if s:
                    by_sys[s[0]] = by_sys.get(s[0], 0) + 1
            counts.append(by_sys)
            i = li + nsat * lines_per_sat
        else:
            # Event/special record (flag 2-6): nsat is a line count of
            # auxiliary records, not satellites with observation data.
            i = li + nsat

    return counts


def min_sats_per_epoch(
    counts: list[dict[str, int]], constellations: list[Constellation]
) -> int:
    """Worst-case (minimum across epochs) raw satellite count for the given
    constellation selection. 0 if there are no epochs at all."""
    if not counts:
        return 0
    letters = {SYSTEM_LETTERS[c] for c in constellations}
    return min(sum(c.get(l, 0) for l in letters) for c in counts)
