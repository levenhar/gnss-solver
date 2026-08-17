# Batch Config-Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user submit one rover + nav + one-or-more base RINEX files, run each base against 100 randomly generated `ProcessingConfig` variants, and view a ranked per-base report of fix-rate/precision stats to find the best config.

**Architecture:** A new `gnss_engine.sweep.random_sweep()` pure function generates N configs. A new `POST /batches` API endpoint fans out M bases × N configs into M×N ordinary jobs (reusing the existing single-job `jobstore`/`run_solve_job` pipeline completely unchanged — no worker code changes), tracked by a JSON manifest under `DATA_DIR/batches/{batch_id}/manifest.json`. Two read endpoints (`GET /batches/{id}`, `GET /batches/{id}/report`) aggregate child-job status/results into batch status and a ranked report. Frontend adds a batch toggle to `NewJob`, a new `BatchDetail` page, and merges batch rows into the existing `JobsList`.

**Tech Stack:** Python 3 / FastAPI / RQ / Redis / pytest / fakeredis (backend, unchanged); React / TypeScript / Vite / TanStack Query / Vitest + Testing Library (frontend, unchanged). No new dependencies.

## Global Constraints

- Reuse `jobstore.save_upload` / `write_config` / `read_config` / `read_solution` / `read_error` / `job_dir` verbatim for every child job — do not alter their signatures.
- `run_solve_job` and the RQ worker are untouched; batch is purely an orchestration layer on top.
- `ProcessingConfig.base_coord_mode` stays `SINGLE` for every swept config — base position always comes from the uploaded base RINEX file.
- Sweep is generated once per batch submission and reused identically across every base (same 100 configs per base, so results are comparable base-to-base by `config_idx`).
- No map view (explicitly out of scope, per user decision during brainstorming).
- Follow existing repo conventions exactly: top-level `gnss_engine/*.py` modules mirror to root-level `tests/test_*.py`; `api/*.py` mirrors to `tests/api/test_*.py`; frontend `web/src/**/*.tsx|ts` co-locates `*.test.tsx|ts` next to the source file.

---

### Task 1: Config sweep generator

**Files:**
- Create: `gnss_engine/sweep.py`
- Modify: `gnss_engine/__init__.py`
- Test: `tests/test_sweep.py`

**Interfaces:**
- Produces: `gnss_engine.sweep.random_sweep(n: int = 100, seed: int | None = None) -> list[ProcessingConfig]`, re-exported as `gnss_engine.random_sweep`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sweep.py
from __future__ import annotations

from gnss_engine.models.config import Constellation, BaseCoordMode
from gnss_engine.sweep import random_sweep


def test_random_sweep_returns_n_configs():
    configs = random_sweep(n=100, seed=1)
    assert len(configs) == 100


def test_random_sweep_fields_within_valid_ranges():
    configs = random_sweep(n=50, seed=2)
    for c in configs:
        assert 0.0 <= c.elev_mask_deg <= 90.0
        assert 0.0 <= c.snr_mask_dbhz <= 60.0
        assert 1.5 <= c.ar_ratio_min <= 5.0
        assert 0 <= c.ar_min_lock <= 10
        assert 0.0 <= c.ar_min_elev_deg <= 30.0
        assert Constellation.GPS in c.constellations
        assert c.base_coord_mode == BaseCoordMode.SINGLE
        assert c.base_coord is None


def test_random_sweep_reproducible_with_seed():
    a = random_sweep(n=10, seed=42)
    b = random_sweep(n=10, seed=42)
    assert [x.model_dump(mode="json") for x in a] == [x.model_dump(mode="json") for x in b]


def test_random_sweep_default_n_is_100():
    assert len(random_sweep(seed=7)) == 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sweep.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'gnss_engine.sweep'`

- [ ] **Step 3: Write minimal implementation**

```python
# gnss_engine/sweep.py
from __future__ import annotations

import random

from gnss_engine.models.config import (
    AmbiguityMode,
    BaseCoordMode,
    Constellation,
    EphemerisSource,
    Frequency,
    IonoModel,
    PositioningMode,
    ProcessingConfig,
    TropoModel,
)

_OPTIONAL_CONSTELLATIONS = (
    Constellation.GLO,
    Constellation.GAL,
    Constellation.BDS,
    Constellation.QZSS,
    Constellation.SBAS,
)


def _random_constellations(rng: random.Random) -> list[Constellation]:
    constellations = [Constellation.GPS]
    for c in _OPTIONAL_CONSTELLATIONS:
        if rng.random() < 0.5:
            constellations.append(c)
    return constellations


def random_sweep(n: int = 100, seed: int | None = None) -> list[ProcessingConfig]:
    rng = random.Random(seed)
    return [
        ProcessingConfig(
            mode=rng.choice(list(PositioningMode)),
            constellations=_random_constellations(rng),
            frequency=rng.choice(list(Frequency)),
            elev_mask_deg=rng.uniform(0.0, 90.0),
            snr_mask_dbhz=rng.uniform(0.0, 60.0),
            tropo=rng.choice(list(TropoModel)),
            iono=rng.choice(list(IonoModel)),
            ambiguity=rng.choice(list(AmbiguityMode)),
            ar_ratio_min=rng.uniform(1.5, 5.0),
            ar_min_lock=rng.randint(0, 10),
            ar_min_elev_deg=rng.uniform(0.0, 30.0),
            ephemeris=rng.choice(list(EphemerisSource)),
            base_coord_mode=BaseCoordMode.SINGLE,
            base_coord=None,
        )
        for _ in range(n)
    ]
```

Modify `gnss_engine/__init__.py`:

```python
from __future__ import annotations

from gnss_engine.engine import solve
from gnss_engine.models.config import ProcessingConfig
from gnss_engine.models.result import Solution
from gnss_engine.sweep import random_sweep

__version__ = "0.1.0"
__all__ = ["solve", "ProcessingConfig", "Solution", "random_sweep", "__version__"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sweep.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add gnss_engine/sweep.py gnss_engine/__init__.py tests/test_sweep.py
git commit -m "feat(engine): add random_sweep config generator"
```

---

### Task 2: Batch manifest storage in jobstore

**Files:**
- Modify: `api/jobstore.py`
- Test: `tests/api/test_jobstore.py`

**Interfaces:**
- Consumes: existing `get_settings()` from `api.config` (already imported in `jobstore.py`).
- Produces: `jobstore.batch_dir(batch_id: str) -> Path`, `jobstore.write_batch_manifest(batch_id: str, manifest: dict) -> None`, `jobstore.read_batch_manifest(batch_id: str) -> dict | None`, `jobstore.list_batch_ids() -> list[str]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_jobstore.py`:

```python
def test_batch_manifest_roundtrip(data_env):
    bid = "batch1"
    assert jobstore.read_batch_manifest(bid) is None
    manifest = {
        "batch_id": bid,
        "created_at": "2026-08-17T00:00:00+00:00",
        "n_configs": 2,
        "bases": [{"base_id": "base-0", "filename": "b.obs", "jobs": [
            {"job_id": "j1", "config_idx": 0},
            {"job_id": "j2", "config_idx": 1},
        ]}],
    }
    jobstore.write_batch_manifest(bid, manifest)
    loaded = jobstore.read_batch_manifest(bid)
    assert loaded == manifest


def test_list_batch_ids(data_env):
    jobstore.write_batch_manifest("b-a", {"batch_id": "b-a", "bases": []})
    jobstore.write_batch_manifest("b-b", {"batch_id": "b-b", "bases": []})
    assert set(jobstore.list_batch_ids()) == {"b-a", "b-b"}


def test_list_batch_ids_empty_when_no_batches_dir(data_env):
    assert jobstore.list_batch_ids() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_jobstore.py -v -k batch`
Expected: FAIL with `AttributeError: module 'api.jobstore' has no attribute 'read_batch_manifest'`

- [ ] **Step 3: Write minimal implementation**

Append to `api/jobstore.py` (after `list_job_ids`):

```python
def _batches_root() -> Path:
    return get_settings().data_dir / "batches"


def batch_dir(batch_id: str) -> Path:
    return _batches_root() / batch_id


def write_batch_manifest(batch_id: str, manifest: dict) -> None:
    d = batch_dir(batch_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def read_batch_manifest(batch_id: str) -> dict | None:
    p = batch_dir(batch_id) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def list_batch_ids() -> list[str]:
    root = _batches_root()
    if not root.exists():
        return []
    return [d.name for d in root.iterdir() if d.is_dir()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_jobstore.py -v`
Expected: PASS (all tests in file, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add api/jobstore.py tests/api/test_jobstore.py
git commit -m "feat(api): add batch manifest storage to jobstore"
```

---

### Task 3: Batch API schemas

**Files:**
- Modify: `api/schemas.py`
- Test: `tests/api/test_schemas.py`

**Interfaces:**
- Produces: `BatchCreated`, `BatchListItem`, `BatchBaseStatus`, `BatchStatusResponse`, `BatchReportEntry`, `BatchReportSummary`, `BatchBaseReport`, `BatchReportResponse` pydantic models in `api.schemas`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_schemas.py`:

```python
from api.schemas import (
    BatchBaseReport,
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchReportEntry,
    BatchReportResponse,
    BatchReportSummary,
    BatchStatusResponse,
)


def test_batch_created():
    b = BatchCreated(batch_id="x", status="queued", n_bases=2, n_configs=100)
    assert b.n_bases == 2


def test_batch_status_response_aggregates_bases():
    r = BatchStatusResponse(
        batch_id="x", status="running",
        bases=[BatchBaseStatus(base_id="base-0", done=1, total=100, failed=0)],
        done=1, total=100,
    )
    assert r.bases[0].total == 100


def test_batch_report_entry_optional_stats_default_none():
    e = BatchReportEntry(job_id="j1", config_idx=0, config={}, status="queued")
    assert e.fix_rate_pct is None


def test_batch_report_response_shape():
    entry = BatchReportEntry(job_id="j1", config_idx=0, config={}, status="finished", fix_rate_pct=90.0)
    summary = BatchReportSummary(best_job_id="j1", best_fix_rate_pct=90.0, worst_fix_rate_pct=90.0,
                                  mean_fix_rate_pct=90.0, median_fix_rate_pct=90.0, n_failed=0)
    report = BatchReportResponse(batch_id="x", bases=[BatchBaseReport(base_id="base-0", results=[entry], summary=summary)])
    assert report.bases[0].summary.best_job_id == "j1"


def test_batch_list_item():
    assert BatchListItem(batch_id="x", status="finished", done=100, total=100).done == 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_schemas.py -v`
Expected: FAIL with `ImportError: cannot import name 'BatchBaseReport' from 'api.schemas'`

- [ ] **Step 3: Write minimal implementation**

Append to `api/schemas.py`:

```python
class BatchCreated(BaseModel):
    batch_id: str
    status: str
    n_bases: int
    n_configs: int


class BatchListItem(BaseModel):
    batch_id: str
    status: str
    done: int
    total: int


class BatchBaseStatus(BaseModel):
    base_id: str
    done: int
    total: int
    failed: int


class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    bases: list[BatchBaseStatus]
    done: int
    total: int


class BatchReportEntry(BaseModel):
    job_id: str
    config_idx: int
    config: dict
    status: str
    fix_rate_pct: float | None = None
    rms_sdn: float | None = None
    rms_sde: float | None = None
    rms_sdu: float | None = None


class BatchReportSummary(BaseModel):
    best_job_id: str | None = None
    best_fix_rate_pct: float | None = None
    worst_fix_rate_pct: float | None = None
    mean_fix_rate_pct: float | None = None
    median_fix_rate_pct: float | None = None
    n_failed: int = 0


class BatchBaseReport(BaseModel):
    base_id: str
    results: list[BatchReportEntry]
    summary: BatchReportSummary


class BatchReportResponse(BaseModel):
    batch_id: str
    bases: list[BatchBaseReport]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_schemas.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add api/schemas.py tests/api/test_schemas.py
git commit -m "feat(api): add batch response schemas"
```

---

### Task 4: `POST /batches` endpoint

**Files:**
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `jobstore.save_upload`, `jobstore.write_config`, `jobstore.write_batch_manifest` (Task 2); `gnss_engine.sweep.random_sweep` (Task 1); `BatchCreated` (Task 3); existing `get_queue()` from `api.queue`.
- Produces: `POST /batches` route on `app`, returning `BatchCreated`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_main.py`:

```python
def _batch_files(n_bases=2):
    files = [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]
    for i in range(n_bases):
        files.append(("base", (f"base{i}.rnx", b"BASE", "application/octet-stream")))
    return files


def test_post_batch_creates_jobs_for_every_base_and_config(client):
    resp = client.post("/batches", files=_batch_files(n_bases=2), data={"n_configs": "3"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    assert body["n_bases"] == 2
    assert body["n_configs"] == 3
    manifest = jobstore.read_batch_manifest(body["batch_id"])
    assert len(manifest["bases"]) == 2
    for b in manifest["bases"]:
        assert len(b["jobs"]) == 3
    all_job_ids = [j["job_id"] for b in manifest["bases"] for j in b["jobs"]]
    assert len(set(all_job_ids)) == 6


def test_post_batch_requires_at_least_one_base(client):
    files = [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]
    resp = client.post("/batches", files=files, data={"n_configs": "5"})
    assert resp.status_code == 422


def test_post_batch_rejects_out_of_range_n_configs(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "0"})
    assert resp.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_main.py -v -k batch`
Expected: FAIL with 404 (no `/batches` route registered) on all three tests

- [ ] **Step 3: Write minimal implementation**

In `api/main.py`, add imports (extend the existing `from api.schemas import ...` line and add a new one):

```python
from api.schemas import (
    BatchCreated,
    ErrorInfo,
    JobCreated,
    JobListItem,
    JobStatusResponse,
)
from gnss_engine.sweep import random_sweep
```

Add the endpoint after `create_job`:

```python
@app.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    base: list[UploadFile] = File(...),
    n_configs: int = Form(100),
) -> BatchCreated:
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")
    if not base:
        raise HTTPException(status_code=422, detail="at least one base file is required")
    if not 1 <= n_configs <= 200:
        raise HTTPException(status_code=422, detail="n_configs must be between 1 and 200")

    batch_id = uuid.uuid4().hex
    rover_filename = rover.filename or "rover.rnx"
    rover_bytes = await rover.read()
    nav_uploads = [(nf.filename or "nav", await nf.read()) for nf in nav]
    configs = random_sweep(n=n_configs)
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
        "n_configs": n_configs,
        "bases": bases_manifest,
    })
    return BatchCreated(batch_id=batch_id, status="queued", n_bases=len(base), n_configs=n_configs)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_main.py -v`
Expected: PASS (all tests in file, including the 3 new batch tests; note `client.enqueued` fixture only records the *last* enqueue call, which is fine since these tests only assert job/manifest counts, not enqueue args)

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat(api): add POST /batches to fan out config sweep per base"
```

---

### Task 5: `GET /batches` and `GET /batches/{id}` status endpoints

**Files:**
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `_status(job_id)` (existing helper), `jobstore.read_batch_manifest`, `jobstore.list_batch_ids` (Task 2), `BatchStatusResponse`/`BatchBaseStatus`/`BatchListItem` (Task 3).
- Produces: `GET /batches/{batch_id}` → `BatchStatusResponse`; `GET /batches` → `list[BatchListItem]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_main.py`:

```python
def test_batch_status_aggregates_children(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "2"})
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 80.0, "rms_sdn": 0.1, "rms_sde": 0.1, "rms_sdu": 0.2}})
    jobstore.write_error(job_ids[1], ErrorInfo(type="ParseError", message="bad"))

    status = client.get(f"/batches/{bid}").json()
    assert status["status"] == "finished"
    assert status["done"] == 2
    assert status["total"] == 2
    assert status["bases"][0]["failed"] == 1


def test_batch_status_running_while_incomplete(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "2"})
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]
    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 80.0}})
    status = client.get(f"/batches/{bid}").json()
    assert status["status"] == "running"
    assert status["done"] == 1


def test_batch_status_404_when_unknown(client):
    assert client.get("/batches/nope").status_code == 404


def test_list_batches(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "1"})
    bid = resp.json()["batch_id"]
    items = client.get("/batches").json()
    assert any(i["batch_id"] == bid for i in items)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_main.py -v -k "batch_status or list_batches"`
Expected: FAIL with 404 (routes not registered)

- [ ] **Step 3: Write minimal implementation**

In `api/main.py`, extend the `api.schemas` import to add `BatchBaseStatus, BatchListItem, BatchStatusResponse`:

```python
from api.schemas import (
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchStatusResponse,
    ErrorInfo,
    JobCreated,
    JobListItem,
    JobStatusResponse,
)
```

Add after `create_batch`:

```python
def _batch_base_counts(job_ids: list[str]) -> tuple[int, int, int]:
    done = failed = 0
    for jid in job_ids:
        st = _status(jid)
        if st in ("finished", "failed"):
            done += 1
        if st == "failed":
            failed += 1
    return done, len(job_ids), failed


def _compute_batch_status(batch_id: str) -> BatchStatusResponse | None:
    manifest = jobstore.read_batch_manifest(batch_id)
    if manifest is None:
        return None
    base_statuses = []
    total_done = total_all = 0
    for b in manifest["bases"]:
        job_ids = [j["job_id"] for j in b["jobs"]]
        done, total, failed = _batch_base_counts(job_ids)
        base_statuses.append(BatchBaseStatus(base_id=b["base_id"], done=done, total=total, failed=failed))
        total_done += done
        total_all += total
    status = "finished" if total_all > 0 and total_done == total_all else "running"
    return BatchStatusResponse(batch_id=batch_id, status=status, bases=base_statuses, done=total_done, total=total_all)


@app.get("/batches/{batch_id}", response_model=BatchStatusResponse)
def batch_status(batch_id: str) -> BatchStatusResponse:
    result = _compute_batch_status(batch_id)
    if result is None:
        raise HTTPException(status_code=404, detail="batch not found")
    return result


@app.get("/batches", response_model=list[BatchListItem])
def list_batches() -> list[BatchListItem]:
    items = []
    for bid in jobstore.list_batch_ids():
        st = _compute_batch_status(bid)
        if st is not None:
            items.append(BatchListItem(batch_id=bid, status=st.status, done=st.done, total=st.total))
    return items
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_main.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat(api): add GET /batches and GET /batches/{id} status endpoints"
```

---

### Task 6: `GET /batches/{id}/report` ranked report endpoint

**Files:**
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `jobstore.read_batch_manifest`, `jobstore.read_solution`, `jobstore.read_config`, `_status` (existing/Task 5); `BatchReportResponse`/`BatchBaseReport`/`BatchReportEntry`/`BatchReportSummary` (Task 3).
- Produces: `GET /batches/{batch_id}/report` → `BatchReportResponse`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_main.py`:

```python
def test_batch_report_ranks_by_fix_rate_and_summarizes(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={"n_configs": "3"})
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 60.0, "rms_sdn": 0.3, "rms_sde": 0.3, "rms_sdu": 0.4}})
    jobstore.write_solution(job_ids[1], {"summary": {"fix_rate_pct": 95.0, "rms_sdn": 0.1, "rms_sde": 0.1, "rms_sdu": 0.2}})
    jobstore.write_error(job_ids[2], ErrorInfo(type="RtklibExecError", message="boom"))

    report = client.get(f"/batches/{bid}/report").json()
    base_report = report["bases"][0]
    ordered_ids = [r["job_id"] for r in base_report["results"]]
    assert ordered_ids[0] == job_ids[1]
    assert ordered_ids[1] == job_ids[0]
    assert ordered_ids[2] == job_ids[2]
    assert base_report["results"][2]["status"] == "failed"
    assert base_report["results"][2]["fix_rate_pct"] is None

    summary = base_report["summary"]
    assert summary["best_job_id"] == job_ids[1]
    assert summary["best_fix_rate_pct"] == 95.0
    assert summary["worst_fix_rate_pct"] == 60.0
    assert summary["mean_fix_rate_pct"] == 77.5
    assert summary["n_failed"] == 1


def test_batch_report_404_when_unknown(client):
    assert client.get("/batches/nope/report").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_main.py -v -k batch_report`
Expected: FAIL with 404 (route not registered)

- [ ] **Step 3: Write minimal implementation**

In `api/main.py`, extend imports to add `statistics` at the top and the new schema names:

```python
import statistics
import uuid
```

```python
from api.schemas import (
    BatchBaseReport,
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchReportEntry,
    BatchReportResponse,
    BatchReportSummary,
    BatchStatusResponse,
    ErrorInfo,
    JobCreated,
    JobListItem,
    JobStatusResponse,
)
```

Add after `list_batches`:

```python
@app.get("/batches/{batch_id}/report", response_model=BatchReportResponse)
def batch_report(batch_id: str) -> BatchReportResponse:
    manifest = jobstore.read_batch_manifest(batch_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="batch not found")

    base_reports = []
    for b in manifest["bases"]:
        entries = []
        fix_rates = []
        for j in b["jobs"]:
            jid = j["job_id"]
            st = _status(jid)
            sol = jobstore.read_solution(jid) if st == "finished" else None
            cfg = jobstore.read_config(jid).model_dump(mode="json")
            fix_rate = sdn = sde = sdu = None
            if sol is not None:
                summary = sol.get("summary", {})
                fix_rate = summary.get("fix_rate_pct")
                sdn = summary.get("rms_sdn")
                sde = summary.get("rms_sde")
                sdu = summary.get("rms_sdu")
                if fix_rate is not None:
                    fix_rates.append(fix_rate)
            entries.append(BatchReportEntry(
                job_id=jid, config_idx=j["config_idx"], config=cfg, status=st,
                fix_rate_pct=fix_rate, rms_sdn=sdn, rms_sde=sde, rms_sdu=sdu,
            ))
        entries.sort(key=lambda e: (e.fix_rate_pct is None, -(e.fix_rate_pct or 0.0)))
        n_failed = sum(1 for e in entries if e.status == "failed")
        if fix_rates:
            best_entry = next(e for e in entries if e.fix_rate_pct == max(fix_rates))
            summary = BatchReportSummary(
                best_job_id=best_entry.job_id,
                best_fix_rate_pct=max(fix_rates),
                worst_fix_rate_pct=min(fix_rates),
                mean_fix_rate_pct=statistics.mean(fix_rates),
                median_fix_rate_pct=statistics.median(fix_rates),
                n_failed=n_failed,
            )
        else:
            summary = BatchReportSummary(n_failed=n_failed)
        base_reports.append(BatchBaseReport(base_id=b["base_id"], results=entries, summary=summary))

    return BatchReportResponse(batch_id=batch_id, bases=base_reports)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/ -v`
Expected: PASS (entire `tests/api/` suite)

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat(api): add GET /batches/{id}/report ranked stats endpoint"
```

---

### Task 7: Frontend batch types + API client methods

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Produces (types.ts): `BatchCreated`, `BatchListItem`, `BatchBaseStatus`, `BatchStatus`, `BatchReportEntry`, `BatchReportSummary`, `BatchBaseReport`, `BatchReport`.
- Produces (client.ts): `client.createBatch(form: FormData): Promise<BatchCreated>`, `client.listBatches(): Promise<BatchListItem[]>`, `client.getBatch(id: string): Promise<BatchStatus>`, `client.getBatchReport(id: string): Promise<BatchReport>`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/api/client.test.ts`:

```ts
describe("batch api client", () => {
  it("createBatch POSTs FormData to /batches", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "queued", n_bases: 2, n_configs: 100 }, 201)
    );
    const fd = new FormData();
    const res = await client.createBatch(fd);
    expect(res.batch_id).toBe("b1");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches$/);
  });

  it("listBatches GETs /batches", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson([{ batch_id: "b1", status: "finished", done: 100, total: 100 }])
    );
    const items = await client.listBatches();
    expect(items[0].batch_id).toBe("b1");
  });

  it("getBatch GETs /batches/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "running", bases: [], done: 1, total: 100 })
    );
    const status = await client.getBatch("b1");
    expect(status.done).toBe(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches\/b1$/);
  });

  it("getBatchReport GETs /batches/:id/report", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", bases: [] })
    );
    const report = await client.getBatchReport("b1");
    expect(report.batch_id).toBe("b1");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches\/b1\/report$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: FAIL with `TypeError: client.createBatch is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/api/types.ts`:

```ts
export interface BatchCreated {
  batch_id: string;
  status: string;
  n_bases: number;
  n_configs: number;
}

export interface BatchListItem {
  batch_id: string;
  status: string;
  done: number;
  total: number;
}

export interface BatchBaseStatus {
  base_id: string;
  done: number;
  total: number;
  failed: number;
}

export interface BatchStatus {
  batch_id: string;
  status: string;
  bases: BatchBaseStatus[];
  done: number;
  total: number;
}

export interface BatchReportEntry {
  job_id: string;
  config_idx: number;
  config: Record<string, unknown>;
  status: string;
  fix_rate_pct: number | null;
  rms_sdn: number | null;
  rms_sde: number | null;
  rms_sdu: number | null;
}

export interface BatchReportSummary {
  best_job_id: string | null;
  best_fix_rate_pct: number | null;
  worst_fix_rate_pct: number | null;
  mean_fix_rate_pct: number | null;
  median_fix_rate_pct: number | null;
  n_failed: number;
}

export interface BatchBaseReport {
  base_id: string;
  results: BatchReportEntry[];
  summary: BatchReportSummary;
}

export interface BatchReport {
  batch_id: string;
  bases: BatchBaseReport[];
}
```

Modify `web/src/api/client.ts` — update the type import line and add four methods to the `client` object:

```ts
import type { BatchCreated, BatchListItem, BatchReport, BatchStatus, JobCreated, JobListItem, JobStatus, Solution } from "./types";
```

```ts
export const client = {
  async listJobs(): Promise<JobListItem[]> {
    return parse(await fetch(`${apiBase()}/jobs`));
  },
  async getJob(id: string): Promise<JobStatus> {
    return parse(await fetch(`${apiBase()}/jobs/${id}`));
  },
  async getResult(id: string): Promise<Solution> {
    return parse(await fetch(`${apiBase()}/jobs/${id}/result`));
  },
  async createJob(form: FormData): Promise<JobCreated> {
    return parse(await fetch(`${apiBase()}/jobs`, { method: "POST", body: form }));
  },
  async createBatch(form: FormData): Promise<BatchCreated> {
    return parse(await fetch(`${apiBase()}/batches`, { method: "POST", body: form }));
  },
  async listBatches(): Promise<BatchListItem[]> {
    return parse(await fetch(`${apiBase()}/batches`));
  },
  async getBatch(id: string): Promise<BatchStatus> {
    return parse(await fetch(`${apiBase()}/batches/${id}`));
  },
  async getBatchReport(id: string): Promise<BatchReport> {
    return parse(await fetch(`${apiBase()}/batches/${id}/report`));
  },
  async health(): Promise<{ status: string; redis: boolean }> {
    return parse(await fetch(`${apiBase()}/health`));
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): add batch types and API client methods"
```

---

### Task 8: Multi-base batch form builder

**Files:**
- Create: `web/src/lib/buildBatchForm.ts`
- Test: `web/src/lib/buildBatchForm.test.ts`

**Interfaces:**
- Consumes: none beyond native `File`/`FormData`.
- Produces: `interface BatchFiles { rover: File | null; nav: File[]; bases: (File | null)[]; }`, `buildBatchForm(files: BatchFiles, nConfigs?: number): FormData`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/buildBatchForm.test.ts
import { describe, it, expect } from "vitest";
import { buildBatchForm, type BatchFiles } from "./buildBatchForm";

function file(name: string): File {
  return new File(["x"], name);
}

describe("buildBatchForm", () => {
  it("appends rover, all nav, all bases, and n_configs", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav"), file("b.nav")],
      bases: [file("base1.obs"), file("base2.obs")],
    };
    const fd = buildBatchForm(files, 100);
    expect((fd.get("rover") as File).name).toBe("r.rnx");
    expect(fd.getAll("nav").map((f) => (f as File).name)).toEqual(["a.nav", "b.nav"]);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
    expect(fd.get("n_configs")).toBe("100");
  });

  it("defaults n_configs to 100 when omitted", () => {
    const files: BatchFiles = { rover: file("r.rnx"), nav: [file("a.nav")], bases: [file("b.obs")] };
    const fd = buildBatchForm(files);
    expect(fd.get("n_configs")).toBe("100");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/buildBatchForm.test.ts`
Expected: FAIL with `Cannot find module './buildBatchForm'`

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/buildBatchForm.ts
export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: (File | null)[];
}

export function buildBatchForm(files: BatchFiles, nConfigs = 100): FormData {
  const fd = new FormData();
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  for (const b of files.bases) if (b) fd.append("base", b);
  fd.append("n_configs", String(nConfigs));
  return fd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/buildBatchForm.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/buildBatchForm.ts web/src/lib/buildBatchForm.test.ts
git commit -m "feat(web): add multi-base batch form builder"
```

---

### Task 9: Batch toggle + multi-base upload on NewJob

**Files:**
- Create: `web/src/components/BatchFileUploads.tsx`
- Modify: `web/src/pages/NewJob.tsx`
- Create: `web/src/pages/NewJob.test.tsx`

**Interfaces:**
- Consumes: `BatchFiles`/`buildBatchForm` (Task 8), `client.createBatch` (Task 7), existing `FileUploads`/`ConfigForm`/`buildJobForm`/`client.createJob`.
- Produces: `BatchFileUploads({ value, onChange }: { value: BatchFiles; onChange: (v: BatchFiles) => void })`; `NewJob` renders a "Single config / Batch: random sweep" radio toggle and posts to the right endpoint.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/pages/NewJob.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NewJob } from "./NewJob";
import { client } from "../api/client";

function wrap() {
  return render(
    <MemoryRouter>
      <NewJob />
    </MemoryRouter>
  );
}

describe("NewJob batch mode", () => {
  it("shows single config form by default and hides multi-base add button", () => {
    wrap();
    expect(screen.queryByText(/\+ Add base/i)).not.toBeInTheDocument();
  });

  it("switching to batch mode reveals multi-base add button and hides ConfigForm", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));
    expect(screen.getByText(/\+ Add base/i)).toBeInTheDocument();
    expect(screen.getByText(/100 random configs/i)).toBeInTheDocument();
  });

  it("submits batch via client.createBatch when in batch mode", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "createBatch").mockResolvedValue({ batch_id: "b1", status: "queued", n_bases: 1, n_configs: 100 });
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));

    const roverInput = screen.getByLabelText(/rover/i) as HTMLInputElement;
    await user.upload(roverInput, new File(["x"], "r.rnx"));
    const navInput = screen.getByLabelText(/navigation/i) as HTMLInputElement;
    await user.upload(navInput, new File(["x"], "a.nav"));
    const baseInputs = screen.getAllByLabelText(/base \d/i);
    await user.upload(baseInputs[0], new File(["x"], "b1.obs"));

    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(client.createBatch).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/NewJob.test.tsx`
Expected: FAIL — `screen.getByLabelText(/batch: random sweep/i)` not found (toggle doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/src/components/BatchFileUploads.tsx
import type { BatchFiles } from "../lib/buildBatchForm";

export function BatchFileUploads({ value, onChange }: { value: BatchFiles; onChange: (v: BatchFiles) => void }) {
  function setBase(i: number, f: File | null) {
    const bases = [...value.bases];
    bases[i] = f;
    onChange({ ...value, bases });
  }
  function removeBase(i: number) {
    onChange({ ...value, bases: value.bases.filter((_, j) => j !== i) });
  }
  function addBase() {
    onChange({ ...value, bases: [...value.bases, null] });
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">
        <span className="mb-1 block text-muted">Rover (obs)</span>
        <input type="file" required onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Navigation (1+)</span>
        <input type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </label>
      <div className="text-sm sm:col-span-3">
        <span className="mb-1 block text-muted">Bases (1+)</span>
        <div className="space-y-2">
          {value.bases.map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">{`Base ${i + 1}`}</span>
                <input
                  aria-label={`Base ${i + 1}`}
                  type="file"
                  onChange={(e) => setBase(i, e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => removeBase(i)}
                className="rounded-md border border-hair px-2 py-1 text-xs text-muted"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addBase}
            className="rounded-md border border-hair px-2.5 py-1 text-xs text-muted"
          >
            + Add base
          </button>
        </div>
      </div>
    </div>
  );
}
```

Modify `web/src/pages/NewJob.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_CONFIG, type ProcessingConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { buildBatchForm, type BatchFiles } from "../lib/buildBatchForm";
import { FileUploads } from "../components/FileUploads";
import { BatchFileUploads } from "../components/BatchFileUploads";
import { ConfigForm } from "../components/ConfigForm";

export function NewJob() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({ rover: null, nav: [], bases: [] });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    !busy &&
    (mode === "single"
      ? !!files.rover && files.nav.length > 0
      : !!batchFiles.rover && batchFiles.nav.length > 0 && batchFiles.bases.length > 0 && batchFiles.bases.every(Boolean));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "single") {
        const res = await client.createJob(buildJobForm(files, config));
        nav(`/jobs/${res.job_id}`);
      } else {
        const res = await client.createBatch(buildBatchForm(batchFiles));
        nav(`/batches/${res.batch_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-base font-semibold">New Job</h2>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} />
          Single config
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === "batch"} onChange={() => setMode("batch")} />
          Batch: random sweep
        </label>
      </div>
      <section className="rounded-lg border border-hair bg-panel p-4">
        {mode === "single" ? (
          <FileUploads value={files} onChange={setFiles} />
        ) : (
          <BatchFileUploads value={batchFiles} onChange={setBatchFiles} />
        )}
      </section>
      {mode === "single" ? (
        <section className="rounded-lg border border-hair bg-panel p-4">
          <ConfigForm value={config} onChange={setConfig} />
        </section>
      ) : (
        <section className="rounded-lg border border-hair bg-panel p-4 text-sm text-muted">
          100 random configs will be generated and run against each base. Base position is taken from each base file
          (single-solution mode) — no manual coordinates.
        </section>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Submit job"}
      </button>
    </form>
  );
}
```

Note: `screen.getByLabelText(/rover/i)` and `/navigation/i)` in the test match `BatchFileUploads`'s labels ("Rover (obs)", "Navigation (1+)") the same way they already match `FileUploads`'s labels, since both use the same label text/structure.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/NewJob.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 5: Run full web test suite before moving on**

Run: `cd web && npx vitest run`
Expected: PASS (no regressions in `NewJob`-adjacent tests, e.g. none currently exist for the old `NewJob.tsx` so nothing to break)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/BatchFileUploads.tsx web/src/pages/NewJob.tsx web/src/pages/NewJob.test.tsx
git commit -m "feat(web): add batch mode toggle and multi-base upload to NewJob"
```

---

### Task 10: BatchDetail page + route

**Files:**
- Create: `web/src/pages/BatchDetail.tsx`
- Create: `web/src/pages/BatchDetail.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `client.getBatch`, `client.getBatchReport` (Task 7); `StatusBadge` (existing).
- Produces: `BatchDetail` component; route `/batches/:id` registered in `App.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/pages/BatchDetail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BatchDetail } from "./BatchDetail";
import { client } from "../api/client";

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/batches/${id}`]}>
        <Routes>
          <Route path="/batches/:id" element={<BatchDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BatchDetail", () => {
  it("shows progress while running", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "running",
      bases: [{ base_id: "base-0", done: 40, total: 100, failed: 0 }],
      done: 40, total: 100,
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText(/40\s*\/\s*100/)).toBeInTheDocument());
  });

  it("shows ranked report table once finished", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "finished",
      bases: [{ base_id: "base-0", done: 2, total: 2, failed: 0 }],
      done: 2, total: 2,
    });
    vi.spyOn(client, "getBatchReport").mockResolvedValue({
      batch_id: "b1",
      bases: [{
        base_id: "base-0",
        results: [
          { job_id: "j-best", config_idx: 1, config: {}, status: "finished", fix_rate_pct: 95, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2 },
          { job_id: "j-worse", config_idx: 0, config: {}, status: "finished", fix_rate_pct: 60, rms_sdn: 0.3, rms_sde: 0.3, rms_sdu: 0.4 },
        ],
        summary: { best_job_id: "j-best", best_fix_rate_pct: 95, worst_fix_rate_pct: 60, mean_fix_rate_pct: 77.5, median_fix_rate_pct: 77.5, n_failed: 0 },
      }],
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText("j-best")).toBeInTheDocument());
    expect(screen.getByText(/95/)).toBeInTheDocument();
    expect(screen.getByText("base-0")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: FAIL with `Cannot find module './BatchDetail'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/src/pages/BatchDetail.tsx
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function BatchDetail() {
  const { id = "" } = useParams();
  const status = useQuery({
    queryKey: ["batch", id],
    queryFn: () => client.getBatch(id),
    refetchInterval: (q) => (q.state.data?.status === "finished" ? false : 2000),
  });
  const finished = status.data?.status === "finished";
  const report = useQuery({
    queryKey: ["batch-report", id],
    queryFn: () => client.getBatchReport(id),
    enabled: finished,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="tnum text-base font-semibold">Batch {id}</h2>
        {status.data && <StatusBadge status={status.data.status} />}
        {status.data && (
          <span className="tnum text-sm text-muted">
            {status.data.done} / {status.data.total}
          </span>
        )}
      </div>

      {!finished && status.data && (
        <p className="text-muted">Processing… {status.data.done} / {status.data.total} runs done.</p>
      )}

      {finished && report.data && (
        <div className="space-y-6">
          {report.data.bases.map((b) => (
            <div key={b.base_id} className="rounded-lg border border-hair bg-panel p-4">
              <h3 className="mb-2 text-sm font-semibold">{b.base_id}</h3>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-hair px-3 py-2">
                  <div className="text-xs uppercase text-muted">Best fix rate</div>
                  <div className="tnum text-base">{b.summary.best_fix_rate_pct?.toFixed(1) ?? "—"}%</div>
                </div>
                <div className="rounded-md border border-hair px-3 py-2">
                  <div className="text-xs uppercase text-muted">Worst fix rate</div>
                  <div className="tnum text-base">{b.summary.worst_fix_rate_pct?.toFixed(1) ?? "—"}%</div>
                </div>
                <div className="rounded-md border border-hair px-3 py-2">
                  <div className="text-xs uppercase text-muted">Mean fix rate</div>
                  <div className="tnum text-base">{b.summary.mean_fix_rate_pct?.toFixed(1) ?? "—"}%</div>
                </div>
                <div className="rounded-md border border-hair px-3 py-2">
                  <div className="text-xs uppercase text-muted">Failed runs</div>
                  <div className="tnum text-base">{b.summary.n_failed}</div>
                </div>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-muted">
                    <th className="py-1 pr-2">Job</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Fix rate</th>
                    <th className="py-1 pr-2">RMS N/E/U</th>
                  </tr>
                </thead>
                <tbody>
                  {b.results.map((r) => (
                    <tr key={r.job_id} className="border-t border-hair">
                      <td className="tnum py-1 pr-2">{r.job_id}</td>
                      <td className="py-1 pr-2"><StatusBadge status={r.status} /></td>
                      <td className="tnum py-1 pr-2">{r.fix_rate_pct != null ? `${r.fix_rate_pct.toFixed(1)}%` : "—"}</td>
                      <td className="tnum py-1 pr-2">
                        {r.rms_sdn != null ? `${r.rms_sdn.toFixed(3)} / ${r.rms_sde!.toFixed(3)} / ${r.rms_sdu!.toFixed(3)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Modify `web/src/App.tsx` — add the import and route:

```tsx
import { Link, Route, Routes } from "react-router-dom";
import { JobsList } from "./pages/JobsList";
import { NewJob } from "./pages/NewJob";
import { JobDetail } from "./pages/JobDetail";
import { BatchDetail } from "./pages/BatchDetail";

export default function App() {
  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="border-b border-hair px-6 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          GNSS <span className="text-accent">Solver</span>
        </Link>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<JobsList />} />
          <Route path="/new" element={<NewJob />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/batches/:id" element={<BatchDetail />} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/BatchDetail.tsx web/src/pages/BatchDetail.test.tsx web/src/App.tsx
git commit -m "feat(web): add BatchDetail page with ranked report table"
```

---

### Task 11: Merge batch rows into JobsList

**Files:**
- Modify: `web/src/pages/JobsList.tsx`
- Modify: `web/src/pages/JobsList.test.tsx`

**Interfaces:**
- Consumes: `client.listJobs`, `client.listBatches` (Task 7), `StatusBadge` (existing).
- Produces: `JobsList` renders both job rows (linking to `/jobs/:id`) and batch rows (linking to `/batches/:id`, showing a `done/total` progress indicator), merged in one list.

- [ ] **Step 1: Write the failing test**

Append to `web/src/pages/JobsList.test.tsx`:

```tsx
it("lists batches alongside jobs with progress", async () => {
  vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
  vi.spyOn(client, "listBatches").mockResolvedValue([{ batch_id: "batch1", status: "running", done: 40, total: 100 }]);
  wrap(<JobsList />);
  await waitFor(() => expect(screen.getByText(/batch1/)).toBeInTheDocument());
  expect(screen.getByText(/40\s*\/\s*100/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/JobsList.test.tsx`
Expected: FAIL — `listBatches` not called / batch row not rendered

- [ ] **Step 3: Write minimal implementation**

Replace `web/src/pages/JobsList.tsx` in full:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function JobsList() {
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => client.listJobs(),
    refetchInterval: 5000,
  });
  const batches = useQuery({
    queryKey: ["batches"],
    queryFn: () => client.listBatches(),
    refetchInterval: 5000,
  });

  const isLoading = jobs.isLoading || batches.isLoading;
  const error = jobs.error || batches.error;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Jobs</h2>
        <Link to="/new" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base hover:brightness-110">
          <Plus size={16} /> New Job
        </Link>
      </div>
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-red-400">Failed to load jobs.</p>}
      <div className="divide-y divide-hair rounded-lg border border-hair bg-panel">
        {(batches.data ?? []).map((b) => (
          <Link key={b.batch_id} to={`/batches/${b.batch_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-white/5">
            <span className="tnum text-sm text-ink">{b.batch_id} <span className="text-muted">(batch)</span></span>
            <span className="flex items-center gap-2">
              <span className="tnum text-xs text-muted">{b.done} / {b.total}</span>
              <StatusBadge status={b.status} />
            </span>
          </Link>
        ))}
        {(jobs.data ?? []).map((j) => (
          <Link key={j.job_id} to={`/jobs/${j.job_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-white/5">
            <span className="tnum text-sm text-ink">{j.job_id}</span>
            <StatusBadge status={j.status} />
          </Link>
        ))}
        {jobs.data && batches.data && jobs.data.length === 0 && batches.data.length === 0 && (
          <p className="px-4 py-6 text-center text-muted">No jobs yet.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/JobsList.test.tsx`
Expected: PASS (both the pre-existing test and the new one)

- [ ] **Step 5: Run full web + python test suites**

Run: `cd web && npx vitest run`
Expected: PASS (all web tests)

Run: `python -m pytest`
Expected: PASS (all python tests; RTKLIB-dependent tests skip if `rnx2rtkp` isn't on PATH, per existing `tests/conftest.py`)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/JobsList.tsx web/src/pages/JobsList.test.tsx
git commit -m "feat(web): merge batch rows into JobsList"
```

---

### Task 12: Docker Compose build/run verification and push

**Files:** none (verification + deployment step, no code changes)

**Interfaces:** none — this task exercises the `docker/docker-compose.yml` stack built across Tasks 1–11.

- [ ] **Step 1: Rebuild all services**

Run: `docker compose -f docker/docker-compose.yml build`
Expected: `api`, `worker`, `web` images build successfully (api/worker share the same Dockerfile and only need a layer rebuild for the new `gnss_engine.sweep`/`api` code; `web` needs a full Vite build for the new `BatchDetail`/`BatchFileUploads` components)

- [ ] **Step 2: Start the stack**

Run: `docker compose -f docker/docker-compose.yml up -d`
Expected: `redis`, `api`, `worker`, `web` all report `Up` in `docker compose -f docker/docker-compose.yml ps`

- [ ] **Step 3: Verify API health and new routes respond**

Run:
```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/batches
```
Expected: `{"status":"ok","redis":true}` and `[]` (empty batch list, no batches submitted yet)

- [ ] **Step 4: Verify web serves the updated bundle**

Run: `curl -s http://localhost:3000/ | grep -o "<title>[^<]*</title>"`
Expected: `<title>GNSS Solver</title>` (200 response, page loads)

- [ ] **Step 5: Tear down**

Run: `docker compose -f docker/docker-compose.yml down`
Expected: all 4 containers stop and are removed; the `gnss-data` named volume is preserved (no `-v` flag used)

- [ ] **Step 6: Push to remote**

```bash
git push origin main
```

Expected: all 11 feature commits plus the design/plan docs pushed to `https://github.com/levenhar/gnss-solver` on `main`.
