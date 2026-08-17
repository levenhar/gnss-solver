# GNSS Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-Python `gnss_engine` library that takes RINEX files + a typed config and returns a parsed, JSON-serializable GNSS solution by driving RTKLIB `rnx2rtkp`.

**Architecture:** Layered modules communicating through two Pydantic contracts (`ProcessingConfig` in, `Solution` out). RINEX inputs are detected/decompressed, validated, header-parsed to metadata; a `.conf` is rendered from the config; `rnx2rtkp` runs in a temp workdir; `.pos` and `.stat` outputs are parsed and summarized. No web, no async, no queue — those are later sub-projects.

**Tech Stack:** Python 3.11+ (container target), Pydantic v2, pytest, subprocess calls to `rnx2rtkp` / `CRX2RNX`, Python stdlib `gzip` for `.gz`.

## Global Constraints

- **Python:** target floor 3.11 (deployment container). Local dev may run 3.10 — put `from __future__ import annotations` at the top of every module and avoid 3.11-only syntax so tests run on both.
- **Config/serialization:** Pydantic **v2** only (`model_dump`, `model_validate`, `field_validator`). No v1 APIs.
- **No network** anywhere in engine v1. Precise ephemeris = caller-supplied files; no downloads.
- **External binaries:** `rnx2rtkp` and `CRX2RNX` are assumed on `PATH` (present in the sub-project-2 container, may be absent in local dev). Any test that actually invokes them is marked `@pytest.mark.requires_rtklib` and skipped when the binary is absent.
- **Package name:** `gnss_engine`. Tests live under `tests/` mirroring the package tree.
- **Style:** TDD (failing test first), frequent commits, one responsibility per module. Type-hint every public function.
- **RTKLIB Q codes:** `1=fix, 2=float, 4=DGPS/SBAS, 5=single` — use these exact integers everywhere.

---

### Task 1: Project scaffold, packaging, and typed errors

**Files:**
- Create: `pyproject.toml`
- Create: `gnss_engine/__init__.py`
- Create: `gnss_engine/errors.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `tests/test_errors.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: package `gnss_engine` importable; exception classes `EngineError` (base), `DecompressError`, `RinexValidationError`, `RtklibExecError`, `ParseError`. `RtklibExecError(exit_code: int, stderr: str, workdir: str)` stores those three as attributes. A pytest marker `requires_rtklib` registered in `conftest.py` plus a fixture `rtklib_available: bool`.

- [ ] **Step 1: Write the failing test**

`tests/test_errors.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_errors.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine'`.

- [ ] **Step 3: Write minimal implementation**

`pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "gnss-engine"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["pydantic>=2.6"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.setuptools.packages.find]
include = ["gnss_engine*"]

[tool.pytest.ini_options]
markers = ["requires_rtklib: needs rnx2rtkp/CRX2RNX on PATH"]
testpaths = ["tests"]
```

`gnss_engine/__init__.py`:
```python
from __future__ import annotations

__version__ = "0.1.0"
```

`gnss_engine/errors.py`:
```python
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
```

`tests/__init__.py`: empty file.

`tests/conftest.py`:
```python
from __future__ import annotations

import shutil

import pytest


@pytest.fixture
def rtklib_available() -> bool:
    return shutil.which("rnx2rtkp") is not None


def pytest_collection_modifyitems(config, items):
    if shutil.which("rnx2rtkp") is not None:
        return
    skip = pytest.mark.skip(reason="rnx2rtkp not on PATH")
    for item in items:
        if "requires_rtklib" in item.keywords:
            item.add_marker(skip)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_errors.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml gnss_engine/ tests/
git commit -m "feat: scaffold gnss_engine package with typed errors"
```

---

### Task 2: Result models (`Solution` and children)

**Files:**
- Create: `gnss_engine/models/__init__.py`
- Create: `gnss_engine/models/result.py`
- Create: `tests/models/__init__.py`
- Create: `tests/models/test_result.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: Pydantic models used by parsers, summary, and engine:
  - `Epoch(t: datetime, lat: float, lon: float, h: float, q: int, ns: int, sdn: float, sde: float, sdu: float, sdne: float, age: float, ratio: float, x: float | None = None, y: float | None = None, z: float | None = None)`
  - `SatStat(t: datetime, sat: str, az: float, el: float, snr: float, res_p: float, res_c: float, slip: bool, fix: int)`
  - `DatasetMeta(rinex_version: str, file_type: str, interval_s: float | None, t_start: datetime | None, t_end: datetime | None, span_s: float | None, receiver: str | None, antenna: str | None, rover_id: str | None, base_id: str | None = None)`
  - `SolutionSummary(n_epochs: int, n_fix: int, n_float: int, n_single: int, fix_rate_pct: float, mean_sdn: float, mean_sde: float, mean_sdu: float, rms_sdn: float, rms_sde: float, rms_sdu: float)`
  - `Solution(meta: DatasetMeta, config_used: dict, epochs: list[Epoch], sat_stats: list[SatStat], summary: SolutionSummary, engine_log: str)`

- [ ] **Step 1: Write the failing test**

`tests/models/test_result.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/models/test_result.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.models'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/models/__init__.py`: empty file.
`tests/models/__init__.py`: empty file.

`gnss_engine/models/result.py`:
```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class Epoch(BaseModel):
    t: datetime
    lat: float
    lon: float
    h: float
    q: int
    ns: int
    sdn: float
    sde: float
    sdu: float
    sdne: float
    age: float
    ratio: float
    x: float | None = None
    y: float | None = None
    z: float | None = None


class SatStat(BaseModel):
    t: datetime
    sat: str
    az: float
    el: float
    snr: float
    res_p: float
    res_c: float
    slip: bool
    fix: int


class DatasetMeta(BaseModel):
    rinex_version: str
    file_type: str
    interval_s: float | None = None
    t_start: datetime | None = None
    t_end: datetime | None = None
    span_s: float | None = None
    receiver: str | None = None
    antenna: str | None = None
    rover_id: str | None = None
    base_id: str | None = None


class SolutionSummary(BaseModel):
    n_epochs: int
    n_fix: int
    n_float: int
    n_single: int
    fix_rate_pct: float
    mean_sdn: float
    mean_sde: float
    mean_sdu: float
    rms_sdn: float
    rms_sde: float
    rms_sdu: float


class Solution(BaseModel):
    meta: DatasetMeta
    config_used: dict
    epochs: list[Epoch]
    sat_stats: list[SatStat]
    summary: SolutionSummary
    engine_log: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/models/test_result.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/models/ tests/models/
git commit -m "feat: add Solution result models"
```

---

### Task 3: Processing config model (`ProcessingConfig` + enums)

**Files:**
- Create: `gnss_engine/models/config.py`
- Create: `tests/models/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: enums and `ProcessingConfig`, consumed by `conf/render.py` (Task 8) and `engine.solve` (Task 13):
  - `PositioningMode` (str enum): `STATIC="static"`, `KINEMATIC="kinematic"`, `MOVINGBASE="movingbase"`, `PPP_STATIC="ppp-static"`, `PPP_KINEMATIC="ppp-kinematic"`
  - `Constellation` (str enum): `GPS`, `GLO`, `GAL`, `BDS`, `QZSS`, `SBAS`
  - `Frequency` (str enum): `L1="l1"`, `L1L2="l1+l2"`, `L1L2L5="l1+l2+l5"`
  - `TropoModel` (str enum): `OFF="off"`, `SAAS="saastamoinen"`, `SBAS="sbas"`, `EST_ZTD="estimate-ztd"`, `EST_ZTD_GRAD="estimate-ztd-grad"`
  - `IonoModel` (str enum): `OFF="off"`, `BROADCAST="broadcast"`, `SBAS="sbas"`, `IONO_FREE="iono-free-lc"`, `EST_STEC="estimate-stec"`, `IONEX="ionex"`
  - `AmbiguityMode` (str enum): `OFF="off"`, `CONTINUOUS="continuous"`, `INSTANTANEOUS="instantaneous"`, `FIX_HOLD="fix-and-hold"`
  - `EphemerisSource` (str enum): `BROADCAST="broadcast"`, `PRECISE="precise"`
  - `BaseCoordMode` (str enum): `KNOWN_LLH="known-llh"`, `KNOWN_XYZ="known-xyz"`, `SINGLE="single"`
  - `ProcessingConfig(BaseModel)` with fields (defaults shown):
    - `mode: PositioningMode = STATIC`
    - `constellations: list[Constellation] = [GPS]`
    - `frequency: Frequency = L1L2`
    - `elev_mask_deg: float = 15.0` (validator: 0–90)
    - `snr_mask_dbhz: float = 35.0` (validator: 0–60)
    - `tropo: TropoModel = SAAS`
    - `iono: IonoModel = BROADCAST`
    - `ambiguity: AmbiguityMode = CONTINUOUS`
    - `ar_ratio_min: float = 3.0`
    - `ar_min_lock: int = 0`
    - `ar_min_elev_deg: float = 0.0`
    - `ephemeris: EphemerisSource = BROADCAST`
    - `base_coord_mode: BaseCoordMode = SINGLE`
    - `base_coord: tuple[float, float, float] | None = None`

- [ ] **Step 1: Write the failing test**

`tests/models/test_config.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/models/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.models.config'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/models/config.py`:
```python
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, field_validator


class PositioningMode(str, Enum):
    STATIC = "static"
    KINEMATIC = "kinematic"
    MOVINGBASE = "movingbase"
    PPP_STATIC = "ppp-static"
    PPP_KINEMATIC = "ppp-kinematic"


class Constellation(str, Enum):
    GPS = "GPS"
    GLO = "GLO"
    GAL = "GAL"
    BDS = "BDS"
    QZSS = "QZSS"
    SBAS = "SBAS"


class Frequency(str, Enum):
    L1 = "l1"
    L1L2 = "l1+l2"
    L1L2L5 = "l1+l2+l5"


class TropoModel(str, Enum):
    OFF = "off"
    SAAS = "saastamoinen"
    SBAS = "sbas"
    EST_ZTD = "estimate-ztd"
    EST_ZTD_GRAD = "estimate-ztd-grad"


class IonoModel(str, Enum):
    OFF = "off"
    BROADCAST = "broadcast"
    SBAS = "sbas"
    IONO_FREE = "iono-free-lc"
    EST_STEC = "estimate-stec"
    IONEX = "ionex"


class AmbiguityMode(str, Enum):
    OFF = "off"
    CONTINUOUS = "continuous"
    INSTANTANEOUS = "instantaneous"
    FIX_HOLD = "fix-and-hold"


class EphemerisSource(str, Enum):
    BROADCAST = "broadcast"
    PRECISE = "precise"


class BaseCoordMode(str, Enum):
    KNOWN_LLH = "known-llh"
    KNOWN_XYZ = "known-xyz"
    SINGLE = "single"


class ProcessingConfig(BaseModel):
    mode: PositioningMode = PositioningMode.STATIC
    constellations: list[Constellation] = [Constellation.GPS]
    frequency: Frequency = Frequency.L1L2
    elev_mask_deg: float = 15.0
    snr_mask_dbhz: float = 35.0
    tropo: TropoModel = TropoModel.SAAS
    iono: IonoModel = IonoModel.BROADCAST
    ambiguity: AmbiguityMode = AmbiguityMode.CONTINUOUS
    ar_ratio_min: float = 3.0
    ar_min_lock: int = 0
    ar_min_elev_deg: float = 0.0
    ephemeris: EphemerisSource = EphemerisSource.BROADCAST
    base_coord_mode: BaseCoordMode = BaseCoordMode.SINGLE
    base_coord: tuple[float, float, float] | None = None

    @field_validator("elev_mask_deg", "ar_min_elev_deg")
    @classmethod
    def _elev_range(cls, v: float) -> float:
        if not 0.0 <= v <= 90.0:
            raise ValueError("elevation must be between 0 and 90 degrees")
        return v

    @field_validator("snr_mask_dbhz")
    @classmethod
    def _snr_range(cls, v: float) -> float:
        if not 0.0 <= v <= 60.0:
            raise ValueError("SNR mask must be between 0 and 60 dBHz")
        return v
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/models/test_config.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/models/config.py tests/models/test_config.py
git commit -m "feat: add ProcessingConfig model and enums"
```

---

### Task 4: RINEX input detection

**Files:**
- Create: `gnss_engine/rinex/__init__.py`
- Create: `gnss_engine/rinex/detect.py`
- Create: `tests/rinex/__init__.py`
- Create: `tests/rinex/test_detect.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Compression` (str enum): `NONE="none"`, `GZIP="gzip"`, `UNIX_Z="unix-z"`, `HATANAKA="hatanaka"`
  - `detect_compression(path: Path) -> Compression` — by suffix: `.gz`→GZIP, `.z`/`.Z`→UNIX_Z, `.crx`/`.??d` (obs suffix ending in `d`)→HATANAKA, else NONE.
  - `is_rinex_obs(path: Path) -> bool` — True when the (already-plain) file's header line contains `RINEX VERSION / TYPE` and the type column is `O` (observation).

- [ ] **Step 1: Write the failing test**

`tests/rinex/test_detect.py`:
```python
from __future__ import annotations

from pathlib import Path

from gnss_engine.rinex.detect import (
    Compression,
    detect_compression,
    is_rinex_obs,
)


def test_detect_by_suffix():
    assert detect_compression(Path("a.rnx")) is Compression.NONE
    assert detect_compression(Path("a.rnx.gz")) is Compression.GZIP
    assert detect_compression(Path("a.obs.Z")) is Compression.UNIX_Z
    assert detect_compression(Path("a.crx")) is Compression.HATANAKA
    assert detect_compression(Path("site0010.23d")) is Compression.HATANAKA


def test_is_rinex_obs(tmp_path):
    obs = tmp_path / "r.rnx"
    obs.write_text(
        "     3.04           OBSERVATION DATA    M                   "
        "RINEX VERSION / TYPE\n",
        encoding="ascii",
    )
    nav = tmp_path / "n.rnx"
    nav.write_text(
        "     3.04           NAVIGATION DATA     M                   "
        "RINEX VERSION / TYPE\n",
        encoding="ascii",
    )
    assert is_rinex_obs(obs) is True
    assert is_rinex_obs(nav) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/rinex/test_detect.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.rinex'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/rinex/__init__.py`: empty file.
`tests/rinex/__init__.py`: empty file.

`gnss_engine/rinex/detect.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/rinex/test_detect.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/rinex/ tests/rinex/
git commit -m "feat: add RINEX compression and obs detection"
```

---

### Task 5: RINEX decompression

**Files:**
- Create: `gnss_engine/rinex/decompress.py`
- Create: `tests/rinex/test_decompress.py`

**Interfaces:**
- Consumes: `Compression`, `detect_compression` (Task 4); `DecompressError` (Task 1).
- Produces: `decompress_to(path: Path, out_dir: Path) -> Path` — returns a path to a plain RINEX file inside `out_dir`. GZIP handled with stdlib `gzip`; UNIX_Z and HATANAKA shell out (`gzip -d` / `CRX2RNX`); NONE returns the input path unchanged. Raises `DecompressError` on tool failure/absence.

- [ ] **Step 1: Write the failing test**

`tests/rinex/test_decompress.py`:
```python
from __future__ import annotations

import gzip
from pathlib import Path

import pytest

from gnss_engine.rinex.decompress import decompress_to
from gnss_engine.errors import DecompressError


def test_passthrough_when_plain(tmp_path):
    src = tmp_path / "r.rnx"
    src.write_text("plain", encoding="ascii")
    out = decompress_to(src, tmp_path / "work")
    assert out == src


def test_gzip_roundtrip(tmp_path):
    payload = "RINEX CONTENT LINE\n"
    src = tmp_path / "r.rnx.gz"
    with gzip.open(src, "wt", encoding="ascii") as fh:
        fh.write(payload)
    work = tmp_path / "work"
    work.mkdir()
    out = decompress_to(src, work)
    assert out.parent == work
    assert out.suffix != ".gz"
    assert out.read_text(encoding="ascii") == payload


def test_missing_gzip_file_raises(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    with pytest.raises(DecompressError):
        decompress_to(tmp_path / "nope.rnx.gz", work)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/rinex/test_decompress.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.rinex.decompress'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/rinex/decompress.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/rinex/test_decompress.py -v`
Expected: PASS (3 tests). The gzip and passthrough paths use stdlib only; the UNIX_Z/HATANAKA branches are exercised later via the gated integration test.

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/rinex/decompress.py tests/rinex/test_decompress.py
git commit -m "feat: add RINEX decompression (gzip/Z/Hatanaka)"
```

---

### Task 6: RINEX header parsing → `DatasetMeta`

**Files:**
- Create: `gnss_engine/rinex/header.py`
- Create: `tests/rinex/fixtures/rover_header.rnx`
- Create: `tests/rinex/test_header.py`

**Interfaces:**
- Consumes: `DatasetMeta` (Task 2).
- Produces: `parse_header(path: Path) -> DatasetMeta`. Reads header labels (columns 61–80) up to `END OF HEADER`: `RINEX VERSION / TYPE`, `REC # / TYPE / VERS`, `ANT # / TYPE`, `INTERVAL`, `TIME OF FIRST OBS`, `TIME OF LAST OBS`, `MARKER NAME`. Computes `span_s` from first/last obs when both present.

- [ ] **Step 1: Write the failing test**

`tests/rinex/fixtures/rover_header.rnx` (exact content — RINEX 3 header, labels start at column 61):
```
     3.04           OBSERVATION DATA    M                   RINEX VERSION / TYPE
ROVR                                                        MARKER NAME
SEPT POLARX5        SEPT POLARX5        5.3.0               REC # / TYPE / VERS
1234                TRM59800.00     NONE                    ANT # / TYPE
     1.000                                                  INTERVAL
  2023     1     1     0     0    0.0000000     GPS         TIME OF FIRST OBS
  2023     1     1     0     0   30.0000000     GPS         TIME OF LAST OBS
                                                            END OF HEADER
```

`tests/rinex/test_header.py`:
```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.rinex.header import parse_header

FIX = Path(__file__).parent / "fixtures" / "rover_header.rnx"


def test_parse_header_fields():
    meta = parse_header(FIX)
    assert meta.rinex_version == "3.04"
    assert meta.file_type == "O"
    assert meta.interval_s == 1.0
    assert meta.rover_id == "ROVR"
    assert meta.receiver == "SEPT POLARX5"
    assert meta.antenna == "TRM59800.00     NONE"
    assert meta.t_start == datetime(2023, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert meta.t_end == datetime(2023, 1, 1, 0, 0, 30, tzinfo=timezone.utc)
    assert meta.span_s == 30.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/rinex/test_header.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.rinex.header'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/rinex/header.py`:
```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.models.result import DatasetMeta

_TYPE_MAP = {"O": "O", "N": "N", "G": "N", "M": "O"}


def _label(line: str) -> str:
    return line[60:80].strip()


def _obs_time(line: str) -> datetime:
    y = int(line[0:6]); mo = int(line[6:12]); d = int(line[12:18])
    h = int(line[18:24]); mi = int(line[24:30]); s = float(line[30:43])
    return datetime(y, mo, d, h, mi, int(s), tzinfo=timezone.utc)


def parse_header(path: Path) -> DatasetMeta:
    version = ""
    ftype = ""
    interval = None
    t_start = None
    t_end = None
    receiver = None
    antenna = None
    rover_id = None

    with path.open("r", encoding="ascii", errors="replace") as fh:
        for line in fh:
            label = _label(line)
            if label == "RINEX VERSION / TYPE":
                version = line[0:9].strip()
                ftype = line[20:21].upper()
            elif label == "MARKER NAME":
                rover_id = line[0:60].strip() or None
            elif label == "REC # / TYPE / VERS":
                receiver = line[20:40].strip() or None
            elif label == "ANT # / TYPE":
                antenna = line[20:40].strip() or None
            elif label == "INTERVAL":
                interval = float(line[0:10])
            elif label == "TIME OF FIRST OBS":
                t_start = _obs_time(line)
            elif label == "TIME OF LAST OBS":
                t_end = _obs_time(line)
            elif label == "END OF HEADER":
                break

    span = None
    if t_start is not None and t_end is not None:
        span = (t_end - t_start).total_seconds()

    return DatasetMeta(
        rinex_version=version,
        file_type=_TYPE_MAP.get(ftype, ftype),
        interval_s=interval,
        t_start=t_start,
        t_end=t_end,
        span_s=span,
        receiver=receiver,
        antenna=antenna,
        rover_id=rover_id,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/rinex/test_header.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/rinex/header.py tests/rinex/test_header.py tests/rinex/fixtures/rover_header.rnx
git commit -m "feat: parse RINEX header into DatasetMeta"
```

---

### Task 7: RINEX input validation

**Files:**
- Create: `gnss_engine/rinex/validate.py`
- Create: `tests/rinex/test_validate.py`

**Interfaces:**
- Consumes: `is_rinex_obs` (Task 4); `RinexValidationError` (Task 1).
- Produces: `validate_inputs(rover: Path, nav: list[Path], base: Path | None = None) -> None`. Raises `RinexValidationError` if: rover missing/not obs; nav list empty or any nav file missing; base given but missing/not obs.

- [ ] **Step 1: Write the failing test**

`tests/rinex/test_validate.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/rinex/test_validate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.rinex.validate'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/rinex/validate.py`:
```python
from __future__ import annotations

from pathlib import Path

from gnss_engine.errors import RinexValidationError
from gnss_engine.rinex.detect import is_rinex_obs


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

    if base is not None:
        if not base.exists():
            raise RinexValidationError(f"base file not found: {base}")
        if not is_rinex_obs(base):
            raise RinexValidationError(f"base is not a RINEX observation file: {base}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/rinex/test_validate.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/rinex/validate.py tests/rinex/test_validate.py
git commit -m "feat: add RINEX input validation"
```

---

### Task 8: Config → `.conf` rendering

**Files:**
- Create: `gnss_engine/conf/__init__.py`
- Create: `gnss_engine/conf/template.conf`
- Create: `gnss_engine/conf/render.py`
- Create: `tests/conf/__init__.py`
- Create: `tests/conf/test_render.py`

**Interfaces:**
- Consumes: `ProcessingConfig` and its enums (Task 3).
- Produces: `render_conf(config: ProcessingConfig) -> str`. Returns full `.conf` text: every line from `template.conf`, with keys the config controls overridden. Mapping decisions (RTKLIB `rnx2rtkp` keys):
  - `pos1-posmode` ← mode (`static|kinematic|movingbase|ppp-static|ppp-kinematic`)
  - `pos1-frequency` ← frequency (`l1|l1+l2|l1+l2+l5`)
  - `pos1-elmask` ← `elev_mask_deg`
  - `pos1-snrmask_L1` / `pos2-...` handled via single `pos1-snrmask_r`/`_b`? Use `pos1-snrmask_L1` = snr for simplicity: set `pos1-snrmask_L1` to `snr_mask_dbhz`.
  - `pos1-navsys` ← bitmask sum of constellations: GPS=1, SBAS=2, GLO=4, GAL=8, QZSS=16, BDS=32.
  - `pos1-tropopt` ← tropo (`off|saas|sbas|est-ztd|est-ztdgrad`)
  - `pos1-ionoopt` ← iono (`off|brdc|sbas|iono-free|est-stec|ionex-tec`)
  - `pos2-armode` ← ambiguity (`off|continuous|instantaneous|fix-and-hold`)
  - `pos2-arthres` ← `ar_ratio_min`
  - `pos2-arlockcnt` ← `ar_min_lock`
  - `pos2-arelmask` ← `ar_min_elev_deg`
  - `pos1-sateph` ← ephemeris (`brdc|precise`)
  - `out-solformat` ← fixed `llh`
  - `out-outstat` ← fixed `residual` (so `.stat` is emitted)

- [ ] **Step 1: Write the failing test**

`tests/conf/test_render.py`:
```python
from __future__ import annotations

from gnss_engine.conf.render import render_conf
from gnss_engine.models.config import (
    ProcessingConfig,
    PositioningMode,
    Constellation,
    AmbiguityMode,
)


def _kv(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def test_static_gps_defaults_render():
    kv = _kv(render_conf(ProcessingConfig()))
    assert kv["pos1-posmode"] == "static"
    assert kv["pos1-navsys"] == "1"           # GPS only
    assert kv["pos1-elmask"] == "15"
    assert kv["pos2-armode"] == "continuous"
    assert kv["out-solformat"] == "llh"
    assert kv["out-outstat"] == "residual"


def test_multi_constellation_bitmask():
    cfg = ProcessingConfig(
        mode=PositioningMode.KINEMATIC,
        constellations=[Constellation.GPS, Constellation.GLO,
                        Constellation.GAL, Constellation.BDS],
        ambiguity=AmbiguityMode.FIX_HOLD,
    )
    kv = _kv(render_conf(cfg))
    assert kv["pos1-posmode"] == "kinematic"
    assert kv["pos1-navsys"] == "45"          # 1+4+8+32
    assert kv["pos2-armode"] == "fix-and-hold"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/conf/test_render.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.conf'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/conf/__init__.py`: empty file.
`tests/conf/__init__.py`: empty file.

`gnss_engine/conf/template.conf` (minimal demo5-style defaults — the keys the renderer overrides plus a few required ones):
```
# rnx2rtkp options (gnss_engine template)
pos1-posmode       =static
pos1-frequency     =l1+l2
pos1-elmask        =15
pos1-snrmask_r     =off
pos1-snrmask_L1    =35
pos1-navsys        =1
pos1-tropopt       =saas
pos1-ionoopt       =brdc
pos1-sateph        =brdc
pos2-armode        =continuous
pos2-arthres       =3
pos2-arlockcnt     =0
pos2-arelmask      =0
out-solformat      =llh
out-outhead        =on
out-outopt         =on
out-outstat        =residual
```

`gnss_engine/conf/render.py`:
```python
from __future__ import annotations

from importlib import resources

from gnss_engine.models.config import (
    ProcessingConfig,
    AmbiguityMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    TropoModel,
)

_NAVSYS_BITS = {
    Constellation.GPS: 1,
    Constellation.SBAS: 2,
    Constellation.GLO: 4,
    Constellation.GAL: 8,
    Constellation.QZSS: 16,
    Constellation.BDS: 32,
}

_MODE = {
    PositioningMode.STATIC: "static",
    PositioningMode.KINEMATIC: "kinematic",
    PositioningMode.MOVINGBASE: "movingbase",
    PositioningMode.PPP_STATIC: "ppp-static",
    PositioningMode.PPP_KINEMATIC: "ppp-kinematic",
}
_FREQ = {
    Frequency.L1: "l1",
    Frequency.L1L2: "l1+l2",
    Frequency.L1L2L5: "l1+l2+l5",
}
_TROPO = {
    TropoModel.OFF: "off",
    TropoModel.SAAS: "saas",
    TropoModel.SBAS: "sbas",
    TropoModel.EST_ZTD: "est-ztd",
    TropoModel.EST_ZTD_GRAD: "est-ztdgrad",
}
_IONO = {
    IonoModel.OFF: "off",
    IonoModel.BROADCAST: "brdc",
    IonoModel.SBAS: "sbas",
    IonoModel.IONO_FREE: "iono-free",
    IonoModel.EST_STEC: "est-stec",
    IonoModel.IONEX: "ionex-tec",
}
_AR = {
    AmbiguityMode.OFF: "off",
    AmbiguityMode.CONTINUOUS: "continuous",
    AmbiguityMode.INSTANTANEOUS: "instantaneous",
    AmbiguityMode.FIX_HOLD: "fix-and-hold",
}
_EPH = {
    EphemerisSource.BROADCAST: "brdc",
    EphemerisSource.PRECISE: "precise",
}


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _overrides(config: ProcessingConfig) -> dict[str, str]:
    navsys = sum(_NAVSYS_BITS[c] for c in config.constellations)
    return {
        "pos1-posmode": _MODE[config.mode],
        "pos1-frequency": _FREQ[config.frequency],
        "pos1-elmask": _fmt(config.elev_mask_deg),
        "pos1-snrmask_L1": _fmt(config.snr_mask_dbhz),
        "pos1-navsys": str(navsys),
        "pos1-tropopt": _TROPO[config.tropo],
        "pos1-ionoopt": _IONO[config.iono],
        "pos1-sateph": _EPH[config.ephemeris],
        "pos2-armode": _AR[config.ambiguity],
        "pos2-arthres": _fmt(config.ar_ratio_min),
        "pos2-arlockcnt": str(config.ar_min_lock),
        "pos2-arelmask": _fmt(config.ar_min_elev_deg),
        "out-solformat": "llh",
        "out-outstat": "residual",
    }


def render_conf(config: ProcessingConfig) -> str:
    template = (
        resources.files("gnss_engine.conf")
        .joinpath("template.conf")
        .read_text(encoding="ascii")
    )
    overrides = _overrides(config)
    out_lines: list[str] = []
    for line in template.splitlines():
        stripped = line.split("#", 1)[0]
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in overrides:
                out_lines.append(f"{key:<18} ={overrides[key]}")
                continue
        out_lines.append(line)
    return "\n".join(out_lines) + "\n"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/conf/test_render.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/conf/ tests/conf/
git commit -m "feat: render ProcessingConfig to rnx2rtkp .conf"
```

---

### Task 9: `.pos` parser

**Files:**
- Create: `gnss_engine/parse/__init__.py`
- Create: `gnss_engine/parse/pos.py`
- Create: `tests/parse/__init__.py`
- Create: `tests/parse/fixtures/sample.pos`
- Create: `tests/parse/test_pos.py`

**Interfaces:**
- Consumes: `Epoch` (Task 2); `ParseError` (Task 1).
- Produces: `parse_pos(path: Path) -> list[Epoch]`. Skips comment lines starting with `%`. Parses the RTKLIB `llh` solution format (whitespace-separated): `date time lat lon height Q ns sdn sde sdu sdne sdeu sdun age ratio`. Maps columns to `Epoch` (uses `sdne` col, drops `sdeu`/`sdun`). Raises `ParseError` on a malformed data row.

- [ ] **Step 1: Write the failing test**

`tests/parse/fixtures/sample.pos` (exact content):
```
% program   : RTKLIB ver.demo5
% pos mode  : static
%  GPST                  latitude(deg) longitude(deg)  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio
2023/01/01 00:00:00.000   32.000000000   34.000000000    50.0000   1   9   0.0040   0.0050   0.0090   0.0010   0.0000   0.0000   0.00   99.9
2023/01/01 00:00:01.000   32.000000010   34.000000010    50.0100   2   8   0.0200   0.0250   0.0400   0.0030   0.0000   0.0000   0.00    2.1
```

`tests/parse/test_pos.py`:
```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from gnss_engine.parse.pos import parse_pos
from gnss_engine.errors import ParseError

FIX = Path(__file__).parent / "fixtures" / "sample.pos"


def test_parse_pos_rows():
    epochs = parse_pos(FIX)
    assert len(epochs) == 2
    e0 = epochs[0]
    assert e0.t == datetime(2023, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert e0.lat == 32.0
    assert e0.q == 1
    assert e0.ns == 9
    assert e0.sdn == 0.004
    assert e0.sdne == 0.001
    assert e0.ratio == 99.9
    assert epochs[1].q == 2


def test_malformed_row_raises(tmp_path):
    bad = tmp_path / "bad.pos"
    bad.write_text(
        "2023/01/01 00:00:00.000 32.0 34.0\n", encoding="ascii"
    )
    with pytest.raises(ParseError):
        parse_pos(bad)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/parse/test_pos.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.parse'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/parse/__init__.py`: empty file.
`tests/parse/__init__.py`: empty file.

`gnss_engine/parse/pos.py`:
```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from gnss_engine.errors import ParseError
from gnss_engine.models.result import Epoch


def _parse_time(date_s: str, time_s: str) -> datetime:
    stamp = f"{date_s} {time_s}"
    dt = datetime.strptime(stamp, "%Y/%m/%d %H:%M:%S.%f")
    return dt.replace(tzinfo=timezone.utc)


def parse_pos(path: Path) -> list[Epoch]:
    epochs: list[Epoch] = []
    with path.open("r", encoding="ascii", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.strip() or line.lstrip().startswith("%"):
                continue
            cols = line.split()
            if len(cols) < 15:
                raise ParseError(
                    f"{path}:{lineno}: expected >=15 columns, got {len(cols)}"
                )
            try:
                epochs.append(Epoch(
                    t=_parse_time(cols[0], cols[1]),
                    lat=float(cols[2]),
                    lon=float(cols[3]),
                    h=float(cols[4]),
                    q=int(cols[5]),
                    ns=int(cols[6]),
                    sdn=float(cols[7]),
                    sde=float(cols[8]),
                    sdu=float(cols[9]),
                    sdne=float(cols[10]),
                    age=float(cols[13]),
                    ratio=float(cols[14]),
                ))
            except (ValueError, IndexError) as exc:
                raise ParseError(f"{path}:{lineno}: {exc}") from exc
    return epochs
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/parse/test_pos.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/parse/__init__.py gnss_engine/parse/pos.py tests/parse/
git commit -m "feat: add .pos solution parser"
```

---

### Task 10: `.stat` parser

**Files:**
- Create: `gnss_engine/parse/stat.py`
- Create: `tests/parse/fixtures/sample.stat`
- Create: `tests/parse/test_stat.py`

**Interfaces:**
- Consumes: `SatStat` (Task 2); `ParseError` (Task 1).
- Produces: `parse_stat(path: Path) -> list[SatStat]`. Reads only `$SAT` records (RTKLIB residual stat), comma-separated:
  `$SAT,week,tow,sat,frq,az,el,resp,resc,vsat,snr,fix,slip,lock,outc,slipc,rejc`.
  Converts GPS week+tow to UTC datetime (GPS epoch 1980-01-06, ignoring leap seconds for v1 — acceptable, documented). `slip = slipc field > 0`. Non-`$SAT` records skipped. Raises `ParseError` on a malformed `$SAT` row.

- [ ] **Step 1: Write the failing test**

`tests/parse/fixtures/sample.stat` (exact content):
```
$POS,2245,86400.000,1,32.0,34.0,50.0,0,0,0
$SAT,2245,86400.000,G01,1,123.4,45.6,0.312,0.0021,1,48.0,1,0,120,0,0,0
$SAT,2245,86400.000,G02,1,210.1,20.3,0.500,0.0100,1,41.0,2,0,5,0,1,0
```

`tests/parse/test_stat.py`:
```python
from __future__ import annotations

from pathlib import Path

import pytest

from gnss_engine.parse.stat import parse_stat
from gnss_engine.errors import ParseError

FIX = Path(__file__).parent / "fixtures" / "sample.stat"


def test_parse_stat_sat_rows_only():
    stats = parse_stat(FIX)
    assert len(stats) == 2          # $POS skipped
    s0 = stats[0]
    assert s0.sat == "G01"
    assert s0.az == 123.4
    assert s0.el == 45.6
    assert s0.res_p == 0.312
    assert s0.res_c == 0.0021
    assert s0.snr == 48.0
    assert s0.fix == 1
    assert s0.slip is False
    assert stats[1].slip is True     # slipc = 1


def test_malformed_sat_row_raises(tmp_path):
    bad = tmp_path / "bad.stat"
    bad.write_text("$SAT,2245,86400.0,G01\n", encoding="ascii")
    with pytest.raises(ParseError):
        parse_stat(bad)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/parse/test_stat.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.parse.stat'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/parse/stat.py`:
```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_engine.errors import ParseError
from gnss_engine.models.result import SatStat

_GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def _gps_to_utc(week: int, tow: float) -> datetime:
    # Leap seconds ignored in v1 (documented limitation).
    return _GPS_EPOCH + timedelta(weeks=week, seconds=tow)


def parse_stat(path: Path) -> list[SatStat]:
    stats: list[SatStat] = []
    with path.open("r", encoding="ascii", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.startswith("$SAT"):
                continue
            cols = line.strip().split(",")
            if len(cols) < 16:
                raise ParseError(
                    f"{path}:{lineno}: $SAT expected >=16 fields, got {len(cols)}"
                )
            try:
                stats.append(SatStat(
                    t=_gps_to_utc(int(cols[1]), float(cols[2])),
                    sat=cols[3],
                    az=float(cols[5]),
                    el=float(cols[6]),
                    res_p=float(cols[7]),
                    res_c=float(cols[8]),
                    snr=float(cols[10]),
                    fix=int(cols[11]),
                    slip=int(cols[15]) > 0,
                ))
            except (ValueError, IndexError) as exc:
                raise ParseError(f"{path}:{lineno}: {exc}") from exc
    return stats
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/parse/test_stat.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/parse/stat.py tests/parse/fixtures/sample.stat tests/parse/test_stat.py
git commit -m "feat: add .stat residual parser"
```

---

### Task 11: Solution summary

**Files:**
- Create: `gnss_engine/parse/summary.py`
- Create: `tests/parse/test_summary.py`

**Interfaces:**
- Consumes: `Epoch`, `SolutionSummary` (Task 2).
- Produces: `summarize(epochs: list[Epoch]) -> SolutionSummary`. Counts by Q code (1=fix, 2=float, 5=single; Q4 folded into single count is wrong — count Q4 separately? Spec summary has only fix/float/single. Treat Q>=4 as "single" bucket for n_single). `fix_rate_pct = 100 * n_fix / n_epochs` (0.0 when no epochs). Means and RMS over sdn/sde/sdu across all epochs. Empty input → all-zero summary.

- [ ] **Step 1: Write the failing test**

`tests/parse/test_summary.py`:
```python
from __future__ import annotations

from datetime import datetime, timezone

from gnss_engine.parse.summary import summarize
from gnss_engine.models.result import Epoch


def _e(q: int, sdn: float, sde: float, sdu: float) -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=0.0, lon=0.0, h=0.0, q=q, ns=8,
        sdn=sdn, sde=sde, sdu=sdu, sdne=0.0, age=0.0, ratio=0.0,
    )


def test_summary_counts_and_rate():
    epochs = [_e(1, 0.01, 0.02, 0.03), _e(1, 0.03, 0.04, 0.05), _e(2, 0.1, 0.1, 0.1), _e(5, 1.0, 1.0, 1.0)]
    s = summarize(epochs)
    assert s.n_epochs == 4
    assert s.n_fix == 2
    assert s.n_float == 1
    assert s.n_single == 1
    assert s.fix_rate_pct == 50.0
    assert abs(s.mean_sdn - (0.01 + 0.03 + 0.1 + 1.0) / 4) < 1e-9


def test_empty_summary_is_zeroed():
    s = summarize([])
    assert s.n_epochs == 0
    assert s.fix_rate_pct == 0.0
    assert s.mean_sdu == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/parse/test_summary.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.parse.summary'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/parse/summary.py`:
```python
from __future__ import annotations

from math import sqrt

from gnss_engine.models.result import Epoch, SolutionSummary


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _rms(values: list[float]) -> float:
    return sqrt(sum(v * v for v in values) / len(values)) if values else 0.0


def summarize(epochs: list[Epoch]) -> SolutionSummary:
    n = len(epochs)
    n_fix = sum(1 for e in epochs if e.q == 1)
    n_float = sum(1 for e in epochs if e.q == 2)
    n_single = sum(1 for e in epochs if e.q >= 4)
    sdn = [e.sdn for e in epochs]
    sde = [e.sde for e in epochs]
    sdu = [e.sdu for e in epochs]
    return SolutionSummary(
        n_epochs=n,
        n_fix=n_fix,
        n_float=n_float,
        n_single=n_single,
        fix_rate_pct=(100.0 * n_fix / n) if n else 0.0,
        mean_sdn=_mean(sdn),
        mean_sde=_mean(sde),
        mean_sdu=_mean(sdu),
        rms_sdn=_rms(sdn),
        rms_sde=_rms(sde),
        rms_sdu=_rms(sdu),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/parse/test_summary.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/parse/summary.py tests/parse/test_summary.py
git commit -m "feat: add solution summary (fix rate, sigma stats)"
```

---

### Task 12: `rnx2rtkp` subprocess runner

**Files:**
- Create: `gnss_engine/run/__init__.py`
- Create: `gnss_engine/run/runner.py`
- Create: `tests/run/__init__.py`
- Create: `tests/run/test_runner.py`

**Interfaces:**
- Consumes: `RtklibExecError` (Task 1).
- Produces:
  - `RunResult` (dataclass): `pos_path: Path`, `stat_path: Path`, `stdout: str`, `stderr: str`.
  - `run_rnx2rtkp(conf_path: Path, rover: Path, base: Path | None, nav: list[Path], workdir: Path, binary: str = "rnx2rtkp") -> RunResult`. Builds arg list `[binary, "-k", conf, "-o", out.pos, rover, base?, *nav]`, sets `-s` stat output via conf (already `out-outstat=residual`), runs `subprocess.run(capture_output=True, text=True)`. On non-zero exit raises `RtklibExecError(exit_code, stderr, str(workdir))`. Returns `RunResult` with `pos_path = workdir/"solution.pos"` and `stat_path = workdir/"solution.pos.stat"`.

- [ ] **Step 1: Write the failing test**

`tests/run/test_runner.py` (mocks subprocess — no real binary needed):
```python
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from gnss_engine.run.runner import run_rnx2rtkp, RunResult
from gnss_engine.errors import RtklibExecError


def _touch(p: Path) -> Path:
    p.write_text("x", encoding="ascii")
    return p


def test_runner_builds_args_and_returns_paths(tmp_path, monkeypatch):
    captured = {}

    def fake_run(args, capture_output, text, cwd=None):
        captured["args"] = args
        # simulate rnx2rtkp writing outputs
        (tmp_path / "solution.pos").write_text("% pos\n", encoding="ascii")
        (tmp_path / "solution.pos.stat").write_text("$POS\n", encoding="ascii")
        return subprocess.CompletedProcess(args, 0, stdout="done", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    conf = _touch(tmp_path / "opts.conf")
    rover = _touch(tmp_path / "r.rnx")
    nav = _touch(tmp_path / "r.nav")

    result = run_rnx2rtkp(conf, rover, None, [nav], tmp_path)
    assert isinstance(result, RunResult)
    assert result.pos_path == tmp_path / "solution.pos"
    assert result.stat_path == tmp_path / "solution.pos.stat"
    assert "rnx2rtkp" in captured["args"][0]
    assert str(conf) in captured["args"]
    assert str(rover) in captured["args"]
    assert str(nav) in captured["args"]


def test_runner_raises_on_nonzero_exit(tmp_path, monkeypatch):
    def fake_run(args, capture_output, text, cwd=None):
        return subprocess.CompletedProcess(args, 2, stdout="", stderr="bad rinex")

    monkeypatch.setattr(subprocess, "run", fake_run)

    conf = _touch(tmp_path / "opts.conf")
    rover = _touch(tmp_path / "r.rnx")
    nav = _touch(tmp_path / "r.nav")

    with pytest.raises(RtklibExecError) as ei:
        run_rnx2rtkp(conf, rover, None, [nav], tmp_path)
    assert ei.value.exit_code == 2
    assert "bad rinex" in ei.value.stderr
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/run/test_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.run'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/run/__init__.py`: empty file.
`tests/run/__init__.py`: empty file.

`gnss_engine/run/runner.py`:
```python
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from gnss_engine.errors import RtklibExecError


@dataclass
class RunResult:
    pos_path: Path
    stat_path: Path
    stdout: str
    stderr: str


def run_rnx2rtkp(
    conf_path: Path,
    rover: Path,
    base: Path | None,
    nav: list[Path],
    workdir: Path,
    binary: str = "rnx2rtkp",
) -> RunResult:
    workdir.mkdir(parents=True, exist_ok=True)
    pos_path = workdir / "solution.pos"
    stat_path = workdir / "solution.pos.stat"

    args: list[str] = [binary, "-k", str(conf_path), "-o", str(pos_path), str(rover)]
    if base is not None:
        args.append(str(base))
    args.extend(str(n) for n in nav)

    proc = subprocess.run(args, capture_output=True, text=True, cwd=str(workdir))
    if proc.returncode != 0:
        raise RtklibExecError(
            exit_code=proc.returncode,
            stderr=proc.stderr or "",
            workdir=str(workdir),
        )
    return RunResult(
        pos_path=pos_path,
        stat_path=stat_path,
        stdout=proc.stdout or "",
        stderr=proc.stderr or "",
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/run/test_runner.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/run/ tests/run/
git commit -m "feat: add rnx2rtkp subprocess runner"
```

---

### Task 13: `solve()` orchestrator + gated integration test

**Files:**
- Create: `gnss_engine/engine.py`
- Modify: `gnss_engine/__init__.py` (export `solve`, `ProcessingConfig`, `Solution`)
- Create: `tests/test_engine.py`
- Create: `tests/fixtures/README.md`

**Interfaces:**
- Consumes: `decompress_to` (Task 5), `validate_inputs` (Task 7), `parse_header` (Task 6), `render_conf` (Task 8), `run_rnx2rtkp` (Task 12), `parse_pos` (Task 9), `parse_stat` (Task 10), `summarize` (Task 11), `ProcessingConfig` (Task 3), `Solution` (Task 2).
- Produces: `solve(rover: Path, nav: list[Path], config: ProcessingConfig, base: Path | None = None, workdir: Path | None = None) -> Solution`. Orchestrates the full pipeline; uses a `tempfile.TemporaryDirectory` when `workdir` is None. Populates `Solution.meta.base_id` from base header when base given.

- [ ] **Step 1: Write the failing test**

`tests/test_engine.py` (unit test mocks the runner + parsers boundary; integration test is gated):
```python
from __future__ import annotations

from pathlib import Path

import pytest

import gnss_engine.engine as engine_mod
from gnss_engine.engine import solve
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution
from gnss_engine.run.runner import RunResult

OBS = (
    "     3.04           OBSERVATION DATA    M                   "
    "RINEX VERSION / TYPE\n"
    "ROVR                                                        MARKER NAME\n"
    "                                                            END OF HEADER\n"
)
NAV = (
    "     3.04           NAVIGATION DATA     M                   "
    "RINEX VERSION / TYPE\n"
)


def _write(p: Path, text: str) -> Path:
    p.write_text(text, encoding="ascii")
    return p


def test_solve_pipeline_with_mocked_runner(tmp_path, monkeypatch):
    rover = _write(tmp_path / "r.rnx", OBS)
    nav = _write(tmp_path / "r.nav", NAV)

    pos = _write(tmp_path / "solution.pos",
        "%  GPST\n"
        "2023/01/01 00:00:00.000 32.0 34.0 50.0 1 9 "
        "0.004 0.005 0.009 0.001 0.0 0.0 0.0 99.9\n")
    stat = _write(tmp_path / "solution.pos.stat",
        "$SAT,2245,86400.000,G01,1,123.4,45.6,0.312,0.0021,1,48.0,1,0,120,0,0,0\n")

    def fake_run(conf_path, rover_, base_, nav_, workdir, binary="rnx2rtkp"):
        return RunResult(pos_path=pos, stat_path=stat, stdout="ok", stderr="")

    monkeypatch.setattr(engine_mod, "run_rnx2rtkp", fake_run)

    sol = solve(rover, [nav], ProcessingConfig(), workdir=tmp_path)
    assert isinstance(sol, Solution)
    assert sol.meta.rover_id == "ROVR"
    assert sol.summary.n_epochs == 1
    assert sol.summary.fix_rate_pct == 100.0
    assert sol.epochs[0].q == 1
    assert sol.sat_stats[0].sat == "G01"
    assert sol.config_used["mode"] == "static"


@pytest.mark.requires_rtklib
def test_solve_integration_real_binary(tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    rover = fixtures / "rover.obs"
    base = fixtures / "base.obs"
    nav = fixtures / "brdc.nav"
    if not (rover.exists() and nav.exists()):
        pytest.skip("real RINEX fixtures not bundled")
    sol = solve(rover, [nav], ProcessingConfig(), base=base, workdir=tmp_path)
    assert sol.summary.n_epochs > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gnss_engine.engine'`.

- [ ] **Step 3: Write minimal implementation**

`gnss_engine/engine.py`:
```python
from __future__ import annotations

import tempfile
from pathlib import Path

from gnss_engine.conf.render import render_conf
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution
from gnss_engine.parse.pos import parse_pos
from gnss_engine.parse.stat import parse_stat
from gnss_engine.parse.summary import summarize
from gnss_engine.rinex.decompress import decompress_to
from gnss_engine.rinex.header import parse_header
from gnss_engine.rinex.validate import validate_inputs
from gnss_engine.run.runner import run_rnx2rtkp


def solve(
    rover: Path,
    nav: list[Path],
    config: ProcessingConfig,
    base: Path | None = None,
    workdir: Path | None = None,
) -> Solution:
    if workdir is None:
        with tempfile.TemporaryDirectory() as tmp:
            return solve(rover, nav, config, base=base, workdir=Path(tmp))

    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    prep = workdir / "input"

    rover = decompress_to(Path(rover), prep)
    nav = [decompress_to(Path(n), prep) for n in nav]
    base = decompress_to(Path(base), prep) if base is not None else None

    validate_inputs(rover, nav, base)

    meta = parse_header(rover)
    if base is not None:
        meta.base_id = parse_header(base).rover_id

    conf_path = workdir / "opts.conf"
    conf_path.write_text(render_conf(config), encoding="ascii")

    run = run_rnx2rtkp(conf_path, rover, base, nav, workdir)

    epochs = parse_pos(run.pos_path)
    sat_stats = parse_stat(run.stat_path) if run.stat_path.exists() else []
    summary = summarize(epochs)

    return Solution(
        meta=meta,
        config_used=config.model_dump(mode="json"),
        epochs=epochs,
        sat_stats=sat_stats,
        summary=summary,
        engine_log=run.stdout + run.stderr,
    )
```

Update `gnss_engine/__init__.py`:
```python
from __future__ import annotations

from gnss_engine.engine import solve
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution

__version__ = "0.1.0"
__all__ = ["solve", "ProcessingConfig", "Solution", "__version__"]
```

`tests/fixtures/README.md`:
```markdown
# Integration fixtures

Drop a small real RINEX set here to enable `test_solve_integration_real_binary`:

- `rover.obs` — rover observation RINEX
- `base.obs` — base observation RINEX
- `brdc.nav` — broadcast navigation RINEX

The test is marked `requires_rtklib` and skips when `rnx2rtkp` is not on PATH
or when these files are absent.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_engine.py -v`
Expected: unit test PASS; `test_solve_integration_real_binary` SKIP (no `rnx2rtkp` / no fixtures).

- [ ] **Step 5: Run full suite**

Run: `python -m pytest -v`
Expected: all unit tests PASS, one SKIP.

- [ ] **Step 6: Commit**

```bash
git add gnss_engine/engine.py gnss_engine/__init__.py tests/test_engine.py tests/fixtures/README.md
git commit -m "feat: add solve() orchestrator wiring the full engine"
```

---

## Self-Review

**1. Spec coverage:**
- RINEX parser + validator → Tasks 4–7. ✓
- Conf generation (Pydantic → `.conf`) → Tasks 3, 8. ✓
- `rnx2rtkp` execution → Task 12. ✓
- `.pos`/`.stat` → structured JSON → Tasks 9, 10, 13. ✓
- Both parsers in v1 → Tasks 9, 10. ✓
- Decompress `.gz`/`.Z`/`.crx` → Task 5. ✓
- Typed errors → Task 1. ✓
- `ProcessingConfig`/`Solution` contracts → Tasks 2, 3. ✓
- Summary (fix rate, σ) → Task 11. ✓
- Gated integration test → Task 13. ✓
- Deferred items (multi-base, matrix, outlier, auto-download, convbin, async) correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**3. Type consistency:** `Epoch`/`SatStat`/`DatasetMeta`/`SolutionSummary`/`Solution` field names identical across Tasks 2, 9, 10, 11, 13. `render_conf`, `parse_pos`, `parse_stat`, `summarize`, `run_rnx2rtkp`, `RunResult`, `decompress_to`, `parse_header`, `validate_inputs`, `solve` signatures match between producing and consuming tasks. `RtklibExecError(exit_code, stderr, workdir)` consistent Tasks 1/12. ✓

**Known documented limitation:** `.stat` GPS-week→UTC ignores leap seconds in v1 (Task 10). Acceptable for plotting/screening; noted for later refinement.
