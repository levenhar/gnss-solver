# User-Controlled Batch Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user bound `random_sweep()`'s random draws — fixed `mode` for the whole batch, chosen constellation/enum candidate pools, and user-set min/max ranges for elevation/AR params — instead of the engine's hardcoded full-domain randomization.

**Architecture:** New `SweepConfig` Pydantic model carries the user's bounds through the stack exactly like `ProcessingConfig` already does for `/jobs`: JSON blob over a multipart `Form` field, validated server-side, passed into a rewritten `random_sweep(sweep, n, seed)`. Frontend gets a new `SweepConfigForm` component (parallel to the existing `ConfigForm`) feeding that JSON blob.

**Tech Stack:** Python 3.11+, Pydantic v2, FastAPI, pytest. React 18 + TypeScript, Vitest + Testing Library.

## Global Constraints

- `mode` has no default in `SweepConfig` — every batch submission must pick one explicitly (const for the whole batch, per spec).
- `snr_mask_dbhz` is a single const value in `SweepConfig` (default `15.0`), never a range — it is not drawn per-job.
- GPS is always forced into every generated config's `constellations`, independent of `constellation_pool` (unchanged existing behavior).
- `elev_mask_range` / `ar_min_elev_range` bounds must fall within `[0.0, 90.0]` (same bound `ProcessingConfig._elev_range` already enforces on the single-config path).
- `ar_min_lock_range` bounds must be `>= 0`.
- Every `*_range` field requires `min <= max`; every `*_pool` field must be non-empty.
- No other `/batches`/`/batches/{id}`/`/batches/{id}/report` endpoint response shape changes — only the request gains `sweep_config`, and the manifest gains a `sweep_config` key.
- `base_coord_mode`/`base_coord` sweep behavior is unchanged (`SINGLE`/`None`).

---

### Task 1: `SweepConfig` model

**Files:**
- Modify: `gnss_engine/models/config.py` (add `SweepConfig` class at end of file)
- Modify: `gnss_engine/__init__.py` (export `SweepConfig`)
- Test: `tests/models/test_config.py`

**Interfaces:**
- Consumes: existing enums `PositioningMode`, `Constellation`, `Frequency`, `TropoModel`, `IonoModel`, `AmbiguityMode`, `EphemerisSource` from `gnss_engine/models/config.py`.
- Produces: `SweepConfig` class with fields `mode: PositioningMode` (required), `constellation_pool: list[Constellation]`, `elev_mask_range: tuple[float, float]`, `ar_ratio_min_range: tuple[float, float]`, `ar_min_lock_range: tuple[int, int]`, `ar_min_elev_range: tuple[float, float]`, `snr_mask_dbhz: float`, `frequency_pool: list[Frequency]`, `tropo_pool: list[TropoModel]`, `iono_pool: list[IonoModel]`, `ambiguity_pool: list[AmbiguityMode]`, `ephemeris_pool: list[EphemerisSource]`. Used by Task 2 (`random_sweep`) and Task 3 (`api/main.py`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/models/test_config.py`:

```python
from gnss_engine.models.config import SweepConfig


def test_sweep_config_requires_mode():
    with pytest.raises(ValidationError):
        SweepConfig()


def test_sweep_config_defaults():
    sc = SweepConfig(mode="static")
    assert sc.mode is PositioningMode.STATIC
    assert set(sc.constellation_pool) == {
        Constellation.GLO, Constellation.GAL, Constellation.BDS, Constellation.QZSS, Constellation.SBAS,
    }
    assert sc.elev_mask_range == (0.0, 90.0)
    assert sc.ar_ratio_min_range == (1.5, 5.0)
    assert sc.ar_min_lock_range == (0, 10)
    assert sc.ar_min_elev_range == (0.0, 30.0)
    assert sc.snr_mask_dbhz == 15.0
    assert len(sc.frequency_pool) == 3
    assert len(sc.tropo_pool) == 5
    assert len(sc.iono_pool) == 6
    assert len(sc.ambiguity_pool) == 4
    assert len(sc.ephemeris_pool) == 2


@pytest.mark.parametrize(
    "field,value",
    [
        ("elev_mask_range", (50.0, 10.0)),
        ("ar_ratio_min_range", (5.0, 1.5)),
        ("ar_min_lock_range", (10, 0)),
        ("ar_min_elev_range", (20.0, 5.0)),
    ],
)
def test_sweep_config_range_min_must_not_exceed_max(field, value):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: value})


@pytest.mark.parametrize("field", ["elev_mask_range", "ar_min_elev_range"])
def test_sweep_config_elevation_ranges_bounded_0_to_90(field):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: (0.0, 120.0)})


def test_sweep_config_ar_min_lock_range_rejects_negative():
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", ar_min_lock_range=(-1, 5))


@pytest.mark.parametrize(
    "field",
    [
        "constellation_pool", "frequency_pool", "tropo_pool",
        "iono_pool", "ambiguity_pool", "ephemeris_pool",
    ],
)
def test_sweep_config_pools_reject_empty(field):
    with pytest.raises(ValidationError):
        SweepConfig(mode="static", **{field: []})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/models/test_config.py -v`
Expected: FAIL — `ImportError: cannot import name 'SweepConfig'`

- [ ] **Step 3: Implement `SweepConfig`**

Append to `gnss_engine/models/config.py`:

```python
class SweepConfig(BaseModel):
    mode: PositioningMode
    constellation_pool: list[Constellation] = [
        Constellation.GLO,
        Constellation.GAL,
        Constellation.BDS,
        Constellation.QZSS,
        Constellation.SBAS,
    ]
    elev_mask_range: tuple[float, float] = (0.0, 90.0)
    ar_ratio_min_range: tuple[float, float] = (1.5, 5.0)
    ar_min_lock_range: tuple[int, int] = (0, 10)
    ar_min_elev_range: tuple[float, float] = (0.0, 30.0)
    snr_mask_dbhz: float = 15.0
    frequency_pool: list[Frequency] = list(Frequency)
    tropo_pool: list[TropoModel] = list(TropoModel)
    iono_pool: list[IonoModel] = list(IonoModel)
    ambiguity_pool: list[AmbiguityMode] = list(AmbiguityMode)
    ephemeris_pool: list[EphemerisSource] = list(EphemerisSource)

    @field_validator("elev_mask_range", "ar_min_elev_range")
    @classmethod
    def _elev_range_bounds(cls, v: tuple[float, float]) -> tuple[float, float]:
        lo, hi = v
        if not (0.0 <= lo <= 90.0 and 0.0 <= hi <= 90.0):
            raise ValueError("elevation range bounds must be between 0 and 90 degrees")
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator("ar_ratio_min_range")
    @classmethod
    def _ar_ratio_min_range(cls, v: tuple[float, float]) -> tuple[float, float]:
        lo, hi = v
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator("ar_min_lock_range")
    @classmethod
    def _ar_min_lock_range(cls, v: tuple[int, int]) -> tuple[int, int]:
        lo, hi = v
        if lo < 0 or hi < 0:
            raise ValueError("ar_min_lock_range bounds must be >= 0")
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator(
        "constellation_pool", "frequency_pool", "tropo_pool",
        "iono_pool", "ambiguity_pool", "ephemeris_pool",
    )
    @classmethod
    def _non_empty_pool(cls, v: list) -> list:
        if not v:
            raise ValueError("pool must not be empty")
        return v
```

- [ ] **Step 4: Export `SweepConfig` from the package**

Edit `gnss_engine/__init__.py`:

```python
from __future__ import annotations

from gnss_engine.engine import solve
from gnss_engine.models.config import ProcessingConfig, SweepConfig
from gnss_engine.models.result import Solution
from gnss_engine.sweep import random_sweep

__version__ = "0.1.0"
__all__ = ["solve", "ProcessingConfig", "SweepConfig", "Solution", "random_sweep", "__version__"]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/models/test_config.py -v`
Expected: PASS (all tests including pre-existing `ProcessingConfig` tests)

- [ ] **Step 6: Commit**

```bash
git add gnss_engine/models/config.py gnss_engine/__init__.py tests/models/test_config.py
git commit -m "feat(engine): add SweepConfig model for user-bounded batch sweeps"
```

---

### Task 2: Rewrite `random_sweep()`

**Files:**
- Modify: `gnss_engine/sweep.py` (full rewrite)
- Modify: `tests/test_sweep.py` (full rewrite)

**Interfaces:**
- Consumes: `SweepConfig` from Task 1 (`gnss_engine/models/config.py`).
- Produces: `random_sweep(sweep: SweepConfig, n: int = 100, seed: int | None = None) -> list[ProcessingConfig]`. Used by Task 3 (`api/main.py`).

- [ ] **Step 1: Write the failing tests**

Replace `tests/test_sweep.py` entirely with:

```python
from __future__ import annotations

from gnss_engine.models.config import (
    AmbiguityMode,
    BaseCoordMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    SweepConfig,
    TropoModel,
)
from gnss_engine.sweep import random_sweep


def _default_sweep(**overrides) -> SweepConfig:
    return SweepConfig(mode="static", **overrides)


def test_random_sweep_returns_n_configs():
    configs = random_sweep(_default_sweep(), n=100, seed=1)
    assert len(configs) == 100


def test_random_sweep_default_n_is_100():
    assert len(random_sweep(_default_sweep(), seed=7)) == 100


def test_random_sweep_mode_is_const_from_sweep_config():
    sweep = _default_sweep(mode="kinematic")
    configs = random_sweep(sweep, n=20, seed=3)
    assert all(c.mode is PositioningMode.KINEMATIC for c in configs)


def test_random_sweep_fields_within_configured_ranges():
    sweep = _default_sweep(
        elev_mask_range=(5.0, 10.0),
        ar_ratio_min_range=(2.0, 2.5),
        ar_min_lock_range=(1, 3),
        ar_min_elev_range=(1.0, 4.0),
        snr_mask_dbhz=22.0,
    )
    configs = random_sweep(sweep, n=50, seed=2)
    for c in configs:
        assert 5.0 <= c.elev_mask_deg <= 10.0
        assert c.snr_mask_dbhz == 22.0
        assert 2.0 <= c.ar_ratio_min <= 2.5
        assert 1 <= c.ar_min_lock <= 3
        assert 1.0 <= c.ar_min_elev_deg <= 4.0
        assert Constellation.GPS in c.constellations
        assert c.base_coord_mode == BaseCoordMode.SINGLE
        assert c.base_coord is None


def test_random_sweep_constellations_limited_to_pool_plus_gps():
    sweep = _default_sweep(constellation_pool=[Constellation.GLO])
    configs = random_sweep(sweep, n=50, seed=5)
    for c in configs:
        assert Constellation.GPS in c.constellations
        assert set(c.constellations) <= {Constellation.GPS, Constellation.GLO}
    assert any(Constellation.GLO in c.constellations for c in configs)


def test_random_sweep_enum_fields_limited_to_pool():
    sweep = _default_sweep(
        frequency_pool=[Frequency.L1],
        tropo_pool=[TropoModel.OFF],
        iono_pool=[IonoModel.OFF],
        ambiguity_pool=[AmbiguityMode.OFF],
        ephemeris_pool=[EphemerisSource.BROADCAST],
    )
    configs = random_sweep(sweep, n=10, seed=6)
    for c in configs:
        assert c.frequency == Frequency.L1
        assert c.tropo == TropoModel.OFF
        assert c.iono == IonoModel.OFF
        assert c.ambiguity == AmbiguityMode.OFF
        assert c.ephemeris == EphemerisSource.BROADCAST


def test_random_sweep_reproducible_with_seed():
    sweep = _default_sweep()
    a = random_sweep(sweep, n=10, seed=42)
    b = random_sweep(sweep, n=10, seed=42)
    assert [x.model_dump(mode="json") for x in a] == [x.model_dump(mode="json") for x in b]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_sweep.py -v`
Expected: FAIL — `TypeError: random_sweep() missing 1 required positional argument: 'sweep'`

- [ ] **Step 3: Rewrite `random_sweep()`**

Replace `gnss_engine/sweep.py` entirely with:

```python
from __future__ import annotations

import random

from gnss_engine.models.config import (
    BaseCoordMode,
    Constellation,
    ProcessingConfig,
    SweepConfig,
)


def _random_constellations(rng: random.Random, pool: list[Constellation]) -> list[Constellation]:
    constellations = [Constellation.GPS]
    for c in pool:
        if rng.random() < 0.5:
            constellations.append(c)
    return constellations


def random_sweep(sweep: SweepConfig, n: int = 100, seed: int | None = None) -> list[ProcessingConfig]:
    rng = random.Random(seed)
    return [
        ProcessingConfig(
            mode=sweep.mode,
            constellations=_random_constellations(rng, sweep.constellation_pool),
            frequency=rng.choice(sweep.frequency_pool),
            elev_mask_deg=rng.uniform(*sweep.elev_mask_range),
            snr_mask_dbhz=sweep.snr_mask_dbhz,
            tropo=rng.choice(sweep.tropo_pool),
            iono=rng.choice(sweep.iono_pool),
            ambiguity=rng.choice(sweep.ambiguity_pool),
            ar_ratio_min=rng.uniform(*sweep.ar_ratio_min_range),
            ar_min_lock=rng.randint(*sweep.ar_min_lock_range),
            ar_min_elev_deg=rng.uniform(*sweep.ar_min_elev_range),
            ephemeris=rng.choice(sweep.ephemeris_pool),
            base_coord_mode=BaseCoordMode.SINGLE,
            base_coord=None,
        )
        for _ in range(n)
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_sweep.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/sweep.py tests/test_sweep.py
git commit -m "feat(engine): bound random_sweep draws by user-supplied SweepConfig"
```

---

### Task 3: API wiring (`/batches`)

**Files:**
- Modify: `api/main.py:104-156` (`create_batch`)
- Modify: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `SweepConfig` from Task 1, `random_sweep(sweep, n, seed)` from Task 2.
- Produces: `POST /batches` requires a new `sweep_config: str` multipart form field (JSON `SweepConfig`); batch manifest dict gains a `"sweep_config"` key. No other schema changes — later tasks (frontend) rely on this exact field name.

- [ ] **Step 1: Write the failing tests**

Add near the top of `tests/api/test_main.py`, after the existing imports (`import json` already present):

```python
from gnss_engine.models.config import Constellation
```

Add helpers right after `_batch_files`:

```python
def _sweep_config_json(**overrides) -> str:
    payload = {"mode": "static"}
    payload.update(overrides)
    return json.dumps(payload)


def _batch_data(n_configs, **sweep_overrides) -> dict:
    return {"n_configs": str(n_configs), "sweep_config": _sweep_config_json(**sweep_overrides)}
```

Replace every existing `data={"n_configs": "N"}` call site in the file with `data=_batch_data("N")` (same `"N"` string value each already uses). There are 14 call sites across these tests — update every one:
`test_list_jobs_excludes_batch_member_jobs`, `test_post_batch_creates_jobs_for_every_base_and_config`, `test_post_batch_rejects_out_of_range_n_configs`, `test_post_batch_writes_created_at_to_manifest`, `test_post_batch_accepts_fanout_at_cap`, `test_post_batch_rejects_fanout_over_cap`, `test_batch_status_aggregates_children`, `test_batch_status_running_while_incomplete`, `test_list_batches`, `test_batch_report_ranks_by_fix_rate_and_summarizes`, `test_batch_report_all_failed_base_has_none_summary_no_crash`, `test_batch_report_failed_entry_includes_error_info`, `test_batch_report_finished_entry_has_no_error_info`.

(`test_post_batch_requires_at_least_one_base` posts no base files at all and 422s before `sweep_config` would even be parsed — leave its `data={"n_configs": "5"}` as-is.)

Add new tests at the end of the batch test section:

```python
def test_post_batch_requires_sweep_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "1"})
    assert resp.status_code == 422


def test_post_batch_rejects_invalid_sweep_config(client):
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data={"n_configs": "1", "sweep_config": "not-json"},
    )
    assert resp.status_code == 422


def test_post_batch_rejects_sweep_config_min_greater_than_max(client):
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data={"n_configs": "1", "sweep_config": _sweep_config_json(elev_mask_range=[80.0, 10.0])},
    )
    assert resp.status_code == 422


def test_post_batch_manifest_stores_sweep_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    assert manifest["sweep_config"]["mode"] == "static"


def test_post_batch_applies_sweep_config_bounds_to_generated_jobs(client):
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data=_batch_data(
            "5",
            mode="kinematic",
            elev_mask_range=[10.0, 20.0],
            constellation_pool=[],
        ),
    )
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]
    for jid in job_ids:
        cfg = jobstore.read_config(jid)
        assert cfg.mode.value == "kinematic"
        assert 10.0 <= cfg.elev_mask_deg <= 20.0
        assert cfg.constellations == [Constellation.GPS]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_main.py -v`
Expected: FAIL — existing batch tests 422 (missing `sweep_config`), new tests fail with `TypeError`/`NameError` since `sweep_config` isn't wired into `create_batch` yet.

- [ ] **Step 3: Wire `sweep_config` into `create_batch`**

Edit `api/main.py`. Change the import block (line 26-27):

```python
from gnss_engine.models.config import ProcessingConfig, SweepConfig
from gnss_engine.sweep import random_sweep
```

Change the `create_batch` signature and body (lines 104-156):

```python
@app.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    base: list[UploadFile] = File(...),
    sweep_config: str = Form(...),
    n_configs: int = Form(100),
) -> BatchCreated:
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")
    if not base:
        raise HTTPException(status_code=422, detail="at least one base file is required")
    if not 1 <= n_configs <= 200:
        raise HTTPException(status_code=422, detail="n_configs must be between 1 and 200")
    try:
        sweep = SweepConfig.model_validate_json(sweep_config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid sweep_config: {exc}") from exc
    if len(base) * n_configs > MAX_TOTAL_BATCH_JOBS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"total batch jobs (bases x n_configs = {len(base) * n_configs}) "
                f"must not exceed {MAX_TOTAL_BATCH_JOBS}"
            ),
        )

    batch_id = uuid.uuid4().hex
    rover_filename = rover.filename or "rover.rnx"
    rover_bytes = await rover.read()
    nav_uploads = [(nf.filename or "nav", await nf.read()) for nf in nav]
    configs = random_sweep(sweep=sweep, n=n_configs)
    queue = get_queue()

    bases_manifest = []
    for base_idx, bf in enumerate(base):
        base_id = f"base-{base_idx}"
        base_filename = bf.filename or f"base{base_idx}.rnx"
        base_bytes = await bf.read()
        jobs = []
        for config_idx, cfg in enumerate(configs):
            job_id = uuid.uuid4().hex
            jobstore.save_upload(job_id, "rover", rover_filename, rover_bytes)
            for nav_filename, nav_bytes in nav_uploads:
                jobstore.save_upload(job_id, "nav", nav_filename, nav_bytes)
            jobstore.save_upload(job_id, "base", base_filename, base_bytes)
            jobstore.write_config(job_id, cfg)
            queue.enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
            jobs.append({"job_id": job_id, "config_idx": config_idx})
        bases_manifest.append({"base_id": base_id, "filename": base_filename, "jobs": jobs})

    jobstore.write_batch_manifest(batch_id, {
        "batch_id": batch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "n_configs": n_configs,
        "sweep_config": sweep.model_dump(mode="json"),
        "bases": bases_manifest,
    })
    return BatchCreated(batch_id=batch_id, status="queued", n_bases=len(base), n_configs=n_configs)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/api/test_main.py -v`
Expected: PASS

- [ ] **Step 5: Run the full Python test suite**

Run: `pytest -v`
Expected: PASS (no regressions in `tests/conf`, `tests/run`, etc.)

- [ ] **Step 6: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat(api): require sweep_config on POST /batches, store it in the manifest"
```

---

### Task 4: Frontend `SweepConfig` type + shared `Field` component

**Files:**
- Modify: `web/src/api/types.ts` (add `SweepConfig` type + `DEFAULT_SWEEP_CONFIG`)
- Create: `web/src/components/Field.tsx` (extracted from `ConfigForm.tsx`)
- Modify: `web/src/components/ConfigForm.tsx` (use extracted `Field`)

**Interfaces:**
- Produces: `SweepConfig` TS interface, `DEFAULT_SWEEP_CONFIG` constant (used by Task 5, Task 7); `Field` component exported from `web/src/components/Field.tsx` as `export function Field({ label, children }: { label: string; children: React.ReactNode })` (used by Task 5).

No test file for this task — `types.ts` has no existing test coverage (mirrors `ProcessingConfig`/`DEFAULT_CONFIG`, also untested directly) and `Field` is a pure extraction verified by the existing `ConfigForm` test suite (currently none) continuing to build; correctness is exercised through Task 5/7's tests.

- [ ] **Step 1: Add `SweepConfig` type to `web/src/api/types.ts`**

Insert after the `DEFAULT_CONFIG` constant (end of file):

```typescript
export interface SweepConfig {
  mode: PositioningMode;
  constellation_pool: Constellation[];
  elev_mask_range: [number, number];
  ar_ratio_min_range: [number, number];
  ar_min_lock_range: [number, number];
  ar_min_elev_range: [number, number];
  snr_mask_dbhz: number;
  frequency_pool: Frequency[];
  tropo_pool: TropoModel[];
  iono_pool: IonoModel[];
  ambiguity_pool: AmbiguityMode[];
  ephemeris_pool: EphemerisSource[];
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  mode: "static",
  constellation_pool: ["GLO", "GAL", "BDS", "QZSS", "SBAS"],
  elev_mask_range: [0, 90],
  ar_ratio_min_range: [1.5, 5],
  ar_min_lock_range: [0, 10],
  ar_min_elev_range: [0, 30],
  snr_mask_dbhz: 15,
  frequency_pool: ["l1", "l1+l2", "l1+l2+l5"],
  tropo_pool: ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"],
  iono_pool: ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"],
  ambiguity_pool: ["off", "continuous", "instantaneous", "fix-and-hold"],
  ephemeris_pool: ["broadcast", "precise"],
};
```

- [ ] **Step 2: Extract `Field` into its own file**

Create `web/src/components/Field.tsx`:

```typescript
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}
```

Edit `web/src/components/ConfigForm.tsx`: remove the local `Field` function definition (lines 15-22) and add an import at the top:

```typescript
import { Field } from "./Field";
```

- [ ] **Step 3: Run the frontend test suite to confirm no regression**

Run: `cd web && npx vitest run`
Expected: PASS (existing `ConfigForm`-dependent tests, e.g. `NewJob.test.tsx`, still pass — pure refactor, no behavior change)

- [ ] **Step 4: Commit**

```bash
git add web/src/api/types.ts web/src/components/Field.tsx web/src/components/ConfigForm.tsx
git commit -m "refactor(web): extract shared Field component, add SweepConfig type"
```

---

### Task 5: `SweepConfigForm` component

**Files:**
- Create: `web/src/components/SweepConfigForm.tsx`

**Interfaces:**
- Consumes: `SweepConfig`, `PositioningMode`, `Constellation`, `Frequency`, `TropoModel`, `IonoModel`, `AmbiguityMode`, `EphemerisSource` from `web/src/api/types.ts`; `Field` from `web/src/components/Field.tsx`.
- Produces: `export function SweepConfigForm({ value, onChange }: { value: SweepConfig; onChange: (v: SweepConfig) => void })`. Used by Task 7 (`NewJob.tsx`).

No standalone test file — mirrors the existing untested `ConfigForm.tsx`; behavior is exercised through Task 7's `NewJob.test.tsx` updates (form appears, values flow into the submitted `sweep_config` JSON).

- [ ] **Step 1: Implement `SweepConfigForm.tsx`**

Create `web/src/components/SweepConfigForm.tsx`:

```typescript
import type {
  SweepConfig, PositioningMode, Constellation, Frequency, TropoModel,
  IonoModel, AmbiguityMode, EphemerisSource,
} from "../api/types";
import { Field } from "./Field";

const MODES: PositioningMode[] = ["static", "kinematic", "movingbase", "ppp-static", "ppp-kinematic"];
const OPTIONAL_CONSTS: Constellation[] = ["GLO", "GAL", "BDS", "QZSS", "SBAS"];
const FREQS: Frequency[] = ["l1", "l1+l2", "l1+l2+l5"];
const TROPOS: TropoModel[] = ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"];
const IONOS: IonoModel[] = ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"];
const ARS: AmbiguityMode[] = ["off", "continuous", "instantaneous", "fix-and-hold"];
const EPHS: EphemerisSource[] = ["broadcast", "precise"];

const selCls = "w-full rounded-md border border-hair bg-base px-2 py-1.5 text-ink";

function ToggleGroup<T extends string>({
  label, options, selected, onToggle,
}: {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (opt: T) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button type="button" key={o} onClick={() => onToggle(o)}
            className={`rounded-md border px-2.5 py-1 text-xs ${selected.includes(o) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeField({
  label, min, max, step, value, onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="number" min={min} max={max} step={step} className={selCls}
          value={value[0]} onChange={(e) => onChange([Number(e.target.value), value[1]])} />
        <input type="number" min={min} max={max} step={step} className={selCls}
          value={value[1]} onChange={(e) => onChange([value[0], Number(e.target.value)])} />
      </div>
    </Field>
  );
}

export function SweepConfigForm({ value, onChange }: { value: SweepConfig; onChange: (v: SweepConfig) => void }) {
  const set = <K extends keyof SweepConfig>(k: K, v: SweepConfig[K]) => onChange({ ...value, [k]: v });
  const togglePool = <T extends string>(pool: T[], k: keyof SweepConfig, opt: T) =>
    set(k, (pool.includes(opt) ? pool.filter((x) => x !== opt) : [...pool, opt]) as SweepConfig[typeof k]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Positioning mode (fixed for whole batch)">
        <select className={selCls} value={value.mode} onChange={(e) => set("mode", e.target.value as PositioningMode)}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="SNR mask (fixed)">
        <input type="number" className={selCls} value={value.snr_mask_dbhz} disabled />
      </Field>

      <div className="sm:col-span-2">
        <span className="mb-1 block text-sm text-muted">Constellations (GPS always included)</span>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-hair bg-panel px-2.5 py-1 text-xs text-muted">GPS</span>
          {OPTIONAL_CONSTS.map((c) => (
            <button type="button" key={c} disabled={false}
              onClick={() => togglePool(value.constellation_pool, "constellation_pool", c)}
              className={`rounded-md border px-2.5 py-1 text-xs ${value.constellation_pool.includes(c) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <RangeField label="Elevation mask range (°)" min={0} max={90} step={0.1}
        value={value.elev_mask_range} onChange={(v) => set("elev_mask_range", v)} />
      <RangeField label="AR ratio min range" min={0} max={20} step={0.1}
        value={value.ar_ratio_min_range} onChange={(v) => set("ar_ratio_min_range", v)} />
      <RangeField label="AR min lock count range" min={0} max={100} step={1}
        value={value.ar_min_lock_range} onChange={(v) => set("ar_min_lock_range", v)} />
      <RangeField label="AR min elevation range (°)" min={0} max={90} step={0.1}
        value={value.ar_min_elev_range} onChange={(v) => set("ar_min_elev_range", v)} />

      <ToggleGroup label="Frequency candidates" options={FREQS} selected={value.frequency_pool}
        onToggle={(o) => togglePool(value.frequency_pool, "frequency_pool", o)} />
      <ToggleGroup label="Troposphere candidates" options={TROPOS} selected={value.tropo_pool}
        onToggle={(o) => togglePool(value.tropo_pool, "tropo_pool", o)} />
      <ToggleGroup label="Ionosphere candidates" options={IONOS} selected={value.iono_pool}
        onToggle={(o) => togglePool(value.iono_pool, "iono_pool", o)} />
      <ToggleGroup label="Ambiguity resolution candidates" options={ARS} selected={value.ambiguity_pool}
        onToggle={(o) => togglePool(value.ambiguity_pool, "ambiguity_pool", o)} />
      <ToggleGroup label="Ephemeris candidates" options={EPHS} selected={value.ephemeris_pool}
        onToggle={(o) => togglePool(value.ephemeris_pool, "ephemeris_pool", o)} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SweepConfigForm.tsx
git commit -m "feat(web): add SweepConfigForm for user-bounded batch sweep params"
```

---

### Task 6: `buildBatchForm.ts` carries `sweep_config`

**Files:**
- Modify: `web/src/lib/buildBatchForm.ts`
- Modify: `web/src/lib/buildBatchForm.test.ts`

**Interfaces:**
- Consumes: `SweepConfig` from `web/src/api/types.ts`.
- Produces: `buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100): FormData` — appends `fd.append("sweep_config", JSON.stringify(sweepConfig))`. Used by Task 7 (`NewJob.tsx`).

- [ ] **Step 1: Write the failing test**

Edit `web/src/lib/buildBatchForm.test.ts` — update every call site to pass a sweep config, and assert the new field. Replace the file with:

```typescript
import { describe, it, expect } from "vitest";
import { buildBatchForm, type BatchFiles } from "./buildBatchForm";
import { DEFAULT_SWEEP_CONFIG } from "../api/types";

function file(name: string): File {
  return new File(["x"], name);
}

describe("buildBatchForm", () => {
  it("appends rover, all nav, all bases, n_configs, and sweep_config", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav"), file("b.nav")],
      bases: [file("base1.obs"), file("base2.obs")],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG, 100);
    expect((fd.get("rover") as File).name).toBe("r.rnx");
    expect(fd.getAll("nav").map((f) => (f as File).name)).toEqual(["a.nav", "b.nav"]);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
    expect(fd.get("n_configs")).toBe("100");
    expect(JSON.parse(fd.get("sweep_config") as string)).toEqual(DEFAULT_SWEEP_CONFIG);
  });

  it("defaults n_configs to 100 when omitted", () => {
    const files: BatchFiles = { rover: file("r.rnx"), nav: [file("a.nav")], bases: [file("b.obs")] };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.get("n_configs")).toBe("100");
  });

  it("skips null entries in bases array", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [file("base1.obs"), null, file("base2.obs"), null],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
  });

  it("handles empty bases array", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.getAll("base")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run buildBatchForm`
Expected: FAIL — `sweep_config` missing from `FormData`, `JSON.parse(null)` throws

- [ ] **Step 3: Update `buildBatchForm.ts`**

Replace `web/src/lib/buildBatchForm.ts` entirely with:

```typescript
import type { SweepConfig } from "../api/types";

export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: (File | null)[];
}

export function buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100): FormData {
  const fd = new FormData();
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  for (const b of files.bases) if (b) fd.append("base", b);
  fd.append("n_configs", String(nConfigs));
  fd.append("sweep_config", JSON.stringify(sweepConfig));
  return fd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run buildBatchForm`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/buildBatchForm.ts web/src/lib/buildBatchForm.test.ts
git commit -m "feat(web): send sweep_config in batch submission form data"
```

---

### Task 7: Wire `SweepConfigForm` into `NewJob.tsx`

**Files:**
- Modify: `web/src/pages/NewJob.tsx`
- Modify: `web/src/pages/NewJob.test.tsx`

**Interfaces:**
- Consumes: `SweepConfigForm` (Task 5), `buildBatchForm(files, sweepConfig, nConfigs)` (Task 6), `DEFAULT_SWEEP_CONFIG` (Task 4).

- [ ] **Step 1: Update the failing tests**

Edit `web/src/pages/NewJob.test.tsx`. Replace the second test (batch-mode reveal) and keep the rest, updating the reveal assertion since the static paragraph is gone:

```typescript
  it("switching to batch mode reveals multi-base add button and sweep config form", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));
    expect(screen.getByText(/\+ Add base/i)).toBeInTheDocument();
    expect(screen.getByText(/positioning mode \(fixed for whole batch\)/i)).toBeInTheDocument();
  });
```

The other three tests (`shows single config form by default...`, `submits batch via client.createBatch...`, `removing a base row...`) need no assertion changes — they don't reference the removed static text.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd web && npx vitest run NewJob`
Expected: FAIL — `/positioning mode \(fixed for whole batch\)/i` not found (still showing the static note)

- [ ] **Step 3: Wire the form into `NewJob.tsx`**

Edit `web/src/pages/NewJob.tsx`:

Add imports:

```typescript
import { DEFAULT_CONFIG, DEFAULT_SWEEP_CONFIG, type ProcessingConfig, type SweepConfig } from "../api/types";
```

(replaces the existing `import { DEFAULT_CONFIG, type ProcessingConfig } from "../api/types";` line)

```typescript
import { SweepConfigForm } from "../components/SweepConfigForm";
```

Add state, right after the existing `config` state line:

```typescript
  const [sweepConfig, setSweepConfig] = useState<SweepConfig>(DEFAULT_SWEEP_CONFIG);
```

Update the batch submit call:

```typescript
        const res = await client.createBatch(buildBatchForm(batchFiles, sweepConfig));
```

Replace the static-note batch section:

```typescript
      ) : (
        <section className="rounded-lg border border-hair bg-panel p-4">
          <p className="mb-4 text-sm text-muted">
            100 random configs will be generated per the bounds below and run against each base. Base position is
            taken from each base file (single-solution mode) — no manual coordinates.
          </p>
          <SweepConfigForm value={sweepConfig} onChange={setSweepConfig} />
        </section>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run NewJob`
Expected: PASS

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd web && npx vitest run`
Expected: PASS (no regressions)

- [ ] **Step 6: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/NewJob.tsx web/src/pages/NewJob.test.tsx
git commit -m "feat(web): wire SweepConfigForm into NewJob batch mode"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Python suite**

Run: `pytest -v`
Expected: PASS, no regressions in `tests/conf`, `tests/run`, `tests/models`, `tests/api`, `tests/test_sweep.py`

- [ ] **Step 2: Run the full frontend suite**

Run: `cd web && npx vitest run`
Expected: PASS

- [ ] **Step 3: Manual smoke check (if Docker Desktop available)**

Run: `docker compose -f docker/docker-compose.yml up --build`, open `http://localhost:3000/jobs/new`, switch to "Batch: random sweep", confirm the mode dropdown, constellation toggles (GPS shown disabled), four min/max range pairs, disabled SNR field, and five candidate-pool toggle groups all render and update state (visually, via toggled highlight) as expected. Submit with a rover/nav/base fixture from `tests/fixtures/` and confirm the batch is created (redirects to `/batches/:id`).

If Docker Desktop isn't available, state that explicitly rather than claiming this step passed.
