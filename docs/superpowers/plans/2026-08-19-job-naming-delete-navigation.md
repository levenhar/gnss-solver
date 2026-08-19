# Job/Batch Naming, Delete, and Back Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users name jobs/batches at creation, rename them anytime, delete them from the jobs list, and navigate back to their previous in-app location from a header button.

**Architecture:** Backend stores an optional `name.json` per job/batch dir (mirrors the existing `created.json`/`config.json` per-entity file pattern in `api/jobstore.py`) and exposes it through existing list/status responses plus two new endpoint pairs (`PATCH .../name`, `DELETE ...`). Frontend threads `name` through the existing React Query + fetch-client stack, adds a small reusable `EditableName` component for the two detail pages, and a `useLocation().key`-based back button in the app header.

**Tech Stack:** FastAPI + Pydantic (backend), React 18 + TypeScript + react-router-dom + @tanstack/react-query + vitest/@testing-library/react (frontend). No new dependencies.

## Global Constraints

- Rename is allowed regardless of job/batch status (no status gating).
- Both jobs and batches get naming and delete (per design spec scope decision).
- Blank/whitespace-only names are rejected on create (silently ignored — falls back to id) and on rename (422).
- Deleting a batch also deletes every job dir it owns (matches the existing `cleanup.remove_stale_data` pattern in `api/cleanup.py`).
- No new UI library/modal — destructive confirm uses `window.confirm`, consistent with there being no existing modal component in this codebase.

---

## Task 1: jobstore name storage primitives

**Files:**
- Modify: `api/jobstore.py`
- Test: `tests/api/test_jobstore.py`

**Interfaces:**
- Produces: `jobstore.write_job_name(job_id: str, name: str) -> None`, `jobstore.read_job_name(job_id: str) -> str | None`, `jobstore.write_batch_name(batch_id: str, name: str) -> None`, `jobstore.read_batch_name(batch_id: str) -> str | None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_jobstore.py`:

```python
def test_job_name_roundtrip(data_env):
    jid = "job-name"
    assert jobstore.read_job_name(jid) is None
    jobstore.write_job_name(jid, "My Survey")
    assert jobstore.read_job_name(jid) == "My Survey"


def test_batch_name_roundtrip(data_env):
    bid = "batch-name"
    assert jobstore.read_batch_name(bid) is None
    jobstore.write_batch_name(bid, "Sweep A")
    assert jobstore.read_batch_name(bid) == "Sweep A"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_jobstore.py -v -k name`
Expected: FAIL with `AttributeError: module 'api.jobstore' has no attribute 'read_job_name'`

- [ ] **Step 3: Implement the storage primitives**

In `api/jobstore.py`, add after `read_job_created` (currently ending at line 106, right before `def delete_job`):

```python
def write_name(dir_: Path, name: str) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / "name.json").write_text(json.dumps({"name": name}), encoding="utf-8")


def read_name(dir_: Path) -> str | None:
    p = dir_ / "name.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))["name"]


def write_job_name(job_id: str, name: str) -> None:
    write_name(job_dir(job_id), name)


def read_job_name(job_id: str) -> str | None:
    return read_name(job_dir(job_id))
```

And after `_batches_root`/`batch_dir` are defined (right after the `batch_dir` function, before `write_batch_manifest`), add:

```python
def write_batch_name(batch_id: str, name: str) -> None:
    write_name(batch_dir(batch_id), name)


def read_batch_name(batch_id: str) -> str | None:
    return read_name(batch_dir(batch_id))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/api/test_jobstore.py -v -k name`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add api/jobstore.py tests/api/test_jobstore.py
git commit -m "feat(api): add job/batch name storage in jobstore"
```

---

## Task 2: create-time name + name in list/status responses

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `jobstore.write_job_name`, `jobstore.read_job_name`, `jobstore.write_batch_name`, `jobstore.read_batch_name` (Task 1).
- Produces: `JobCreated.name`, `JobListItem.name`, `JobStatusResponse.name`, `BatchCreated.name`, `BatchListItem.name`, `BatchStatusResponse.name` (all `str | None`, default `None`). `POST /jobs` and `POST /batches` accept optional `name` form field.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_main.py`:

```python
def test_post_job_with_name_persists_and_returns_it(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"}), "name": "  My Survey  "},
    )
    assert resp.json()["name"] == "My Survey"
    jid = resp.json()["job_id"]
    assert jobstore.read_job_name(jid) == "My Survey"


def test_post_job_without_name_returns_none(client):
    resp = client.post("/jobs", files=_files(), data={"config": json.dumps({"mode": "static"})})
    assert resp.json()["name"] is None


def test_post_job_blank_name_is_treated_as_no_name(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"}), "name": "   "},
    )
    assert resp.json()["name"] is None


def test_list_jobs_includes_name(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_job_name("j1", "Named Job")
    items = {i["job_id"]: i["name"] for i in client.get("/jobs").json()}
    assert items["j1"] == "Named Job"


def test_job_status_includes_name(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_job_name("j1", "Named Job")
    assert client.get("/jobs/j1").json()["name"] == "Named Job"


def test_post_batch_with_name_persists_and_returns_it(client):
    resp = client.post(
        "/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "  Sweep A  "}
    )
    assert resp.json()["name"] == "Sweep A"
    bid = resp.json()["batch_id"]
    assert jobstore.read_batch_name(bid) == "Sweep A"


def test_post_batch_without_name_returns_none(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    assert resp.json()["name"] is None


def test_list_batches_includes_name(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "Sweep A"})
    bid = resp.json()["batch_id"]
    items = {i["batch_id"]: i["name"] for i in client.get("/batches").json()}
    assert items[bid] == "Sweep A"


def test_batch_status_includes_name(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data={**_batch_data("1"), "name": "Sweep A"})
    bid = resp.json()["batch_id"]
    assert client.get(f"/batches/{bid}").json()["name"] == "Sweep A"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_main.py -v -k name`
Expected: FAIL — `KeyError: 'name'` (field not present in response JSON yet).

- [ ] **Step 3: Add `name` to the schemas**

In `api/schemas.py`, modify these five classes (add the `name` field, keep everything else unchanged):

```python
class JobCreated(BaseModel):
    job_id: str
    status: str
    name: str | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: ErrorInfo | None = None
    name: str | None = None


class JobListItem(BaseModel):
    job_id: str
    status: str
    name: str | None = None
```

```python
class BatchCreated(BaseModel):
    batch_id: str
    status: str
    n_bases: int
    n_configs: int
    name: str | None = None


class BatchListItem(BaseModel):
    batch_id: str
    status: str
    done: int
    total: int
    name: str | None = None
```

And add `name: str | None = None` to `BatchStatusResponse`:

```python
class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    bases: list[BatchBaseStatus]
    done: int
    total: int
    name: str | None = None
```

- [ ] **Step 4: Wire name through `api/main.py`**

In `create_job` (currently `api/main.py:79-103`), add the `name` form param and persist it:

```python
@app.post("/jobs", status_code=201, response_model=JobCreated)
async def create_job(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    config: str = Form(...),
    base: UploadFile | None = File(None),
    name: str | None = Form(None),
) -> JobCreated:
    try:
        cfg = ProcessingConfig.model_validate_json(config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid config: {exc}") from exc
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")

    job_id = uuid.uuid4().hex
    jobstore.save_upload(job_id, "rover", rover.filename or "rover.rnx", await rover.read())
    for nf in nav:
        jobstore.save_upload(job_id, "nav", nf.filename or "nav", await nf.read())
    if base is not None:
        jobstore.save_upload(job_id, "base", base.filename or "base.rnx", await base.read())
    jobstore.write_config(job_id, cfg)
    jobstore.write_job_created(job_id)
    clean_name = name.strip() if name and name.strip() else None
    if clean_name:
        jobstore.write_job_name(job_id, clean_name)

    get_queue().enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
    return JobCreated(job_id=job_id, status="queued", name=clean_name)
```

In `create_batch` (currently `api/main.py:106-164`), add the `name` form param and persist it before the return:

```python
@app.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    base: list[UploadFile] = File(...),
    sweep_config: str = Form(...),
    n_configs: int = Form(100),
    name: str | None = Form(None),
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
    clean_name = name.strip() if name and name.strip() else None
    if clean_name:
        jobstore.write_batch_name(batch_id, clean_name)
    return BatchCreated(batch_id=batch_id, status="queued", n_bases=len(base), n_configs=n_configs, name=clean_name)
```

Update `_compute_batch_status` (currently `api/main.py:178-191`) to include the name so both `GET /batches/{id}` and `GET /batches` (which reuses it) get it for free:

```python
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
    return BatchStatusResponse(
        batch_id=batch_id, status=status, bases=base_statuses, done=total_done, total=total_all,
        name=jobstore.read_batch_name(batch_id),
    )
```

Update `list_batches` (currently `api/main.py:202-209`) to carry the name through from `_compute_batch_status` instead of leaving it default `None`:

```python
@app.get("/batches", response_model=list[BatchListItem])
def list_batches() -> list[BatchListItem]:
    items = []
    for bid in jobstore.list_batch_ids():
        st = _compute_batch_status(bid)
        if st is not None:
            items.append(BatchListItem(batch_id=bid, status=st.status, done=st.done, total=st.total, name=st.name))
    return items
```

Update `job_status` (currently `api/main.py:288-293`):

```python
@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    st = _status(job_id)
    if st == "not_found":
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse(job_id=job_id, status=st, error=jobstore.read_error(job_id), name=jobstore.read_job_name(job_id))
```

Update `list_jobs` (currently `api/main.py:310-317`):

```python
@app.get("/jobs", response_model=list[JobListItem])
def list_jobs() -> list[JobListItem]:
    batch_job_ids = jobstore.list_batch_job_ids()
    return [
        JobListItem(job_id=j, status=_status(j), name=jobstore.read_job_name(j))
        for j in jobstore.list_job_ids()
        if j not in batch_job_ids
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/api/test_main.py tests/api/test_schemas.py -v`
Expected: PASS (all tests, including the new name ones)

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/main.py tests/api/test_main.py
git commit -m "feat(api): accept and surface job/batch names on create/list/status"
```

---

## Task 3: rename endpoints

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `JobStatusResponse`, `BatchStatusResponse`, `_status`, `_compute_batch_status`, `jobstore.write_job_name`/`write_batch_name` (Task 1 & 2).
- Produces: `PATCH /jobs/{job_id}/name`, `PATCH /batches/{batch_id}/name` (body `{"name": str}`, response is `JobStatusResponse`/`BatchStatusResponse`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_main.py`:

```python
def test_patch_job_name_renames(client):
    jobstore.write_solution("j1", {"summary": {}})
    resp = client.patch("/jobs/j1/name", json={"name": "  Renamed  "})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert jobstore.read_job_name("j1") == "Renamed"


def test_patch_job_name_404_when_unknown(client):
    resp = client.patch("/jobs/nope/name", json={"name": "x"})
    assert resp.status_code == 404


def test_patch_job_name_rejects_blank(client):
    jobstore.write_solution("j1", {"summary": {}})
    resp = client.patch("/jobs/j1/name", json={"name": "   "})
    assert resp.status_code == 422


def test_patch_batch_name_renames(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("1"))
    bid = resp.json()["batch_id"]
    resp = client.patch(f"/batches/{bid}/name", json={"name": "Renamed Sweep"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed Sweep"
    assert jobstore.read_batch_name(bid) == "Renamed Sweep"


def test_patch_batch_name_404_when_unknown(client):
    resp = client.patch("/batches/nope/name", json={"name": "x"})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_main.py -v -k patch_job_name or patch_batch_name`
Expected: FAIL with 404/405 (route doesn't exist)

- [ ] **Step 3: Add `RenameRequest` schema**

In `api/schemas.py`, add near the top (after `ErrorInfo`):

```python
class RenameRequest(BaseModel):
    name: str
```

- [ ] **Step 4: Add rename endpoints**

In `api/main.py`, add `RenameRequest` to the `from api.schemas import (...)` block, and add these two routes right after `job_status` (after line 293, before `job_result`):

```python
@app.patch("/jobs/{job_id}/name", response_model=JobStatusResponse)
def rename_job(job_id: str, body: RenameRequest) -> JobStatusResponse:
    if not jobstore.job_dir(job_id).exists():
        raise HTTPException(status_code=404, detail="job not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    jobstore.write_job_name(job_id, name)
    return JobStatusResponse(job_id=job_id, status=_status(job_id), error=jobstore.read_error(job_id), name=name)
```

And after `batch_status` (after line 199, before `list_batches`):

```python
@app.patch("/batches/{batch_id}/name", response_model=BatchStatusResponse)
def rename_batch(batch_id: str, body: RenameRequest) -> BatchStatusResponse:
    if jobstore.read_batch_manifest(batch_id) is None:
        raise HTTPException(status_code=404, detail="batch not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    jobstore.write_batch_name(batch_id, name)
    result = _compute_batch_status(batch_id)
    assert result is not None
    return result
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/api/test_main.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/main.py tests/api/test_main.py
git commit -m "feat(api): add job/batch rename endpoints"
```

---

## Task 4: delete endpoints

**Files:**
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `jobstore.job_dir`, `jobstore.delete_job`, `jobstore.read_batch_manifest`, `jobstore.delete_batch` (all pre-existing in `api/jobstore.py`).
- Produces: `DELETE /jobs/{job_id}` (204), `DELETE /batches/{batch_id}` (204, also deletes constituent job dirs).

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_main.py`:

```python
def test_delete_job_removes_it(client):
    jobstore.write_solution("j1", {"summary": {}})
    resp = client.delete("/jobs/j1")
    assert resp.status_code == 204
    assert client.get("/jobs/j1").status_code == 404


def test_delete_job_404_when_unknown(client):
    resp = client.delete("/jobs/nope")
    assert resp.status_code == 404


def test_delete_batch_removes_it_and_child_jobs(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    resp = client.delete(f"/batches/{bid}")
    assert resp.status_code == 204
    assert client.get(f"/batches/{bid}").status_code == 404
    for jid in job_ids:
        assert not jobstore.job_dir(jid).exists()


def test_delete_batch_404_when_unknown(client):
    resp = client.delete("/batches/nope")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/api/test_main.py -v -k delete_job or delete_batch`
Expected: FAIL with 405 Method Not Allowed (no DELETE route yet)

- [ ] **Step 3: Add delete endpoints**

In `api/main.py`, add after `job_result` (after line 307, before `list_jobs`):

```python
@app.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str) -> None:
    if not jobstore.job_dir(job_id).exists():
        raise HTTPException(status_code=404, detail="job not found")
    jobstore.delete_job(job_id)
```

And after `batch_report` (after line 285, before `job_status`):

```python
@app.delete("/batches/{batch_id}", status_code=204)
def delete_batch(batch_id: str) -> None:
    manifest = jobstore.read_batch_manifest(batch_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="batch not found")
    for b in manifest["bases"]:
        for j in b["jobs"]:
            jobstore.delete_job(j["job_id"])
    jobstore.delete_batch(batch_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/api/test_main.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run full backend suite**

Run: `pytest tests/ -v`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat(api): add job/batch delete endpoints"
```

---

## Task 5: frontend types + api client

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Produces: `client.renameJob(id: string, name: string): Promise<JobStatus>`, `client.renameBatch(id: string, name: string): Promise<BatchStatus>`, `client.deleteJob(id: string): Promise<void>`, `client.deleteBatch(id: string): Promise<void>`. `JobCreated`, `JobListItem`, `JobStatus`, `BatchCreated`, `BatchListItem`, `BatchStatus` all gain `name?: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/api/client.test.ts` (inside the existing `describe("api client", ...)` block for job-related, and `describe("batch api client", ...)` for batch-related — add as new top-level `it` blocks after each respective describe's existing tests, or as new describes; simplest is two new `describe` blocks at the end of the file):

```ts
describe("rename/delete", () => {
  it("renameJob PATCHes /jobs/:id/name with a JSON body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ job_id: "j1", status: "finished", error: null, name: "New" })
    );
    const res = await client.renameJob("j1", "New");
    expect(res.name).toBe("New");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/jobs\/j1\/name$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "New" });
  });

  it("renameBatch PATCHes /batches/:id/name with a JSON body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "running", bases: [], done: 0, total: 0, name: "New" })
    );
    const res = await client.renameBatch("b1", "New");
    expect(res.name).toBe("New");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/batches\/b1\/name$/);
    expect(init.method).toBe("PATCH");
  });

  it("deleteJob DELETEs /jobs/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
    await client.deleteJob("j1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/jobs\/j1$/);
    expect(init.method).toBe("DELETE");
  });

  it("deleteBatch DELETEs /batches/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
    await client.deleteBatch("b1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/batches\/b1$/);
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: FAIL with `client.renameJob is not a function`

- [ ] **Step 3: Add `name` to the types**

In `web/src/api/types.ts`, modify these interfaces (add `name?: string | null;` to each, keep all other fields):

```ts
export interface JobCreated { job_id: string; status: string; name?: string | null; }
export interface JobListItem { job_id: string; status: string; name?: string | null; }
export interface JobStatus { job_id: string; status: JobStatusValue; error: ErrorInfo | null; name?: string | null; }
```

```ts
export interface BatchCreated {
  batch_id: string;
  status: string;
  n_bases: number;
  n_configs: number;
  name?: string | null;
}

export interface BatchListItem {
  batch_id: string;
  status: string;
  done: number;
  total: number;
  name?: string | null;
}
```

```ts
export interface BatchStatus {
  batch_id: string;
  status: string;
  bases: BatchBaseStatus[];
  done: number;
  total: number;
  name?: string | null;
}
```

- [ ] **Step 4: Add the client methods**

In `web/src/api/client.ts`, add these four methods to the `client` object (after `getBatchReport`, before `health`):

```ts
  async renameJob(id: string, name: string): Promise<JobStatus> {
    return parse(
      await fetch(`${apiBase()}/jobs/${id}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    );
  },
  async renameBatch(id: string, name: string): Promise<BatchStatus> {
    return parse(
      await fetch(`${apiBase()}/batches/${id}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    );
  },
  async deleteJob(id: string): Promise<void> {
    await parse(await fetch(`${apiBase()}/jobs/${id}`, { method: "DELETE" }));
  },
  async deleteBatch(id: string): Promise<void> {
    await parse(await fetch(`${apiBase()}/batches/${id}`, { method: "DELETE" }));
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): add rename/delete client methods and name fields"
```

---

## Task 6: name param in form builders

**Files:**
- Modify: `web/src/lib/buildJobForm.ts`
- Modify: `web/src/lib/buildBatchForm.ts`
- Test: `web/src/lib/buildJobForm.test.ts`
- Test: `web/src/lib/buildBatchForm.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildJobForm(files: JobFiles, config: ProcessingConfig, name?: string): FormData`, `buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs?: number, name?: string): FormData`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/buildJobForm.test.ts`:

```ts
  it("includes a trimmed name field when provided", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG, "  My Survey  ");
    expect(fd.get("name")).toBe("My Survey");
  });

  it("omits the name field when blank or absent", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG, "   ");
    expect(fd.get("name")).toBeNull();
    const fd2 = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG);
    expect(fd2.get("name")).toBeNull();
  });
```

(add these inside the existing `describe("buildJobForm", ...)` block, before its closing `});`)

Append to `web/src/lib/buildBatchForm.test.ts`:

```ts
  it("includes a trimmed name field when provided", () => {
    const fd = buildBatchForm({ rover: file("r.obs"), nav: [file("a.nav")], bases: [file("b.obs")] }, DEFAULT_SWEEP_CONFIG, 100, "  Sweep A  ");
    expect(fd.get("name")).toBe("Sweep A");
  });

  it("omits the name field when absent", () => {
    const fd = buildBatchForm({ rover: file("r.obs"), nav: [file("a.nav")], bases: [file("b.obs")] }, DEFAULT_SWEEP_CONFIG);
    expect(fd.get("name")).toBeNull();
  });
```

(check the top of `web/src/lib/buildBatchForm.test.ts` for its existing `file()` helper and `DEFAULT_SWEEP_CONFIG` import — reuse whatever it already imports; add these `it` blocks inside its existing top-level `describe`)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/buildJobForm.test.ts src/lib/buildBatchForm.test.ts`
Expected: FAIL — `fd.get("name")` is `null` when a name was passed (param ignored)

- [ ] **Step 3: Implement**

Replace `web/src/lib/buildJobForm.ts` in full:

```ts
import type { ProcessingConfig } from "../api/types";

export interface JobFiles {
  rover: File | null;
  base: File | null;
  nav: File[];
}

export function buildJobForm(files: JobFiles, config: ProcessingConfig, name?: string): FormData {
  const fd = new FormData();
  if (name && name.trim()) fd.append("name", name.trim());
  if (files.rover) fd.append("rover", files.rover);
  if (files.base) fd.append("base", files.base);
  for (const n of files.nav) fd.append("nav", n);
  const cfg: ProcessingConfig = { ...config };
  if (cfg.base_coord_mode === "single") cfg.base_coord = null;
  fd.append("config", JSON.stringify(cfg));
  return fd;
}
```

Replace `web/src/lib/buildBatchForm.ts` in full:

```ts
import type { SweepConfig } from "../api/types";

export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: (File | null)[];
}

export function buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100, name?: string): FormData {
  const fd = new FormData();
  if (name && name.trim()) fd.append("name", name.trim());
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  for (const b of files.bases) if (b) fd.append("base", b);
  fd.append("n_configs", String(nConfigs));
  fd.append("sweep_config", JSON.stringify(sweepConfig));
  return fd;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/buildJobForm.test.ts src/lib/buildBatchForm.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/buildJobForm.ts web/src/lib/buildBatchForm.ts web/src/lib/buildJobForm.test.ts web/src/lib/buildBatchForm.test.ts
git commit -m "feat(web): thread optional name through job/batch form builders"
```

---

## Task 7: name field in NewJob page

**Files:**
- Modify: `web/src/pages/NewJob.tsx`
- Test: `web/src/pages/NewJob.test.tsx`

**Interfaces:**
- Consumes: `buildJobForm(files, config, name?)`, `buildBatchForm(files, sweepConfig, nConfigs?, name?)` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `web/src/pages/NewJob.test.tsx`, inside the existing `describe("NewJob batch mode", ...)` block:

```ts
  it("passes the name field through to createJob", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "createJob").mockResolvedValue({ job_id: "j1", status: "queued" });
    wrap();

    await user.type(screen.getByLabelText(/^name/i), "My Survey");
    const roverInput = screen.getByLabelText(/rover/i) as HTMLInputElement;
    await user.upload(roverInput, new File(["x"], "r.rnx"));
    const navInput = screen.getByLabelText(/navigation/i) as HTMLInputElement;
    await user.upload(navInput, new File(["x"], "a.nav"));

    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    const fd = (client.createJob as any).mock.calls[0][0] as FormData;
    expect(fd.get("name")).toBe("My Survey");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/NewJob.test.tsx -t "passes the name field"`
Expected: FAIL — `Unable to find a label with the text of: /^name/i`

- [ ] **Step 3: Add the name field**

In `web/src/pages/NewJob.tsx`:

Add `Field` import (it's not currently imported there) and add `name` state:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { DEFAULT_CONFIG, DEFAULT_SWEEP_CONFIG, type ProcessingConfig, type SweepConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { buildBatchForm, type BatchFiles } from "../lib/buildBatchForm";
import { FileUploads } from "../components/FileUploads";
import { BatchFileUploads } from "../components/BatchFileUploads";
import { ConfigForm } from "../components/ConfigForm";
import { SweepConfigForm } from "../components/SweepConfigForm";
import { Field } from "../components/Field";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { springSmooth } from "../components/ui/transitions";
import { selCls } from "../components/ui/inputStyles";

type Mode = "single" | "batch";
const MODES: { value: Mode; label: string }[] = [
  { value: "single", label: "Single config" },
  { value: "batch", label: "Batch: random sweep" },
];

export function NewJob() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("single");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({ rover: null, nav: [], bases: [null] });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [sweepConfig, setSweepConfig] = useState<SweepConfig>(DEFAULT_SWEEP_CONFIG);
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
        const res = await client.createJob(buildJobForm(files, config, name));
        nav(`/jobs/${res.job_id}`);
      } else {
        const res = await client.createBatch(buildBatchForm(batchFiles, sweepConfig, 100, name));
        nav(`/batches/${res.batch_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }
```

`client.createBatch` still takes `FormData`, unaffected — the call site above just now passes `name` through `buildBatchForm`'s 4th param.

Add the name field to the JSX, right after the `<h1>...</h1>` block's closing `</div>` and before the mode-selector `<div className="inline-flex ...">`:

```tsx
      <Field label="Name (optional)">
        <input
          type="text"
          className={selCls}
          placeholder="e.g. Rooftop survey — north antenna"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/NewJob.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/NewJob.tsx web/src/pages/NewJob.test.tsx
git commit -m "feat(web): add optional name field to the new job form"
```

---

## Task 8: reusable EditableName component

**Files:**
- Create: `web/src/components/EditableName.tsx`
- Test: `web/src/components/EditableName.test.tsx`

**Interfaces:**
- Produces: `EditableName({ name, id, onSave, className }: { name: string | null | undefined; id: string; onSave: (name: string) => void; className?: string })` — a JSX component. Displays `name ?? id`; clicking the pencil icon reveals a text input; Enter or the check button calls `onSave(trimmedValue)` and exits edit mode; Escape or the X button exits edit mode without calling `onSave`. Empty/whitespace input does not call `onSave`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/EditableName.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableName } from "./EditableName";

describe("EditableName", () => {
  it("shows the name when set, falling back to id otherwise", () => {
    const { rerender } = render(<EditableName name="My Survey" id="abc123" onSave={() => {}} />);
    expect(screen.getByText("My Survey")).toBeInTheDocument();
    rerender(<EditableName name={null} id="abc123" onSave={() => {}} />);
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("edits and saves a new name on Enter", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    expect(onSave).toHaveBeenCalledWith("New Name");
    expect(screen.getByText("New Name") || screen.queryByRole("textbox")).toBeTruthy();
  });

  it("cancels editing on Escape without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    await user.type(screen.getByRole("textbox"), "{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not save a blank name", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/EditableName.test.tsx`
Expected: FAIL — cannot find module `./EditableName`

- [ ] **Step 3: Implement the component**

Create `web/src/components/EditableName.tsx`:

```tsx
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { selCls } from "./ui/inputStyles";

export function EditableName({
  name, id, onSave, className = "",
}: { name: string | null | undefined; id: string; onSave: (name: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          role="textbox"
          className={`${selCls} w-auto py-1`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" aria-label="Save name" onClick={commit} className="text-success hover:brightness-110">
          <Check size={15} />
        </button>
        <button type="button" aria-label="Cancel rename" onClick={() => setEditing(false)} className="text-muted hover:text-ink">
          <X size={15} />
        </button>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{name ?? id}</span>
      <button
        type="button"
        aria-label="Rename"
        onClick={() => { setDraft(name ?? id); setEditing(true); }}
        className="text-faint transition-colors duration-150 hover:text-ink"
      >
        <Pencil size={13} />
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/EditableName.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/EditableName.tsx web/src/components/EditableName.test.tsx
git commit -m "feat(web): add reusable EditableName component"
```

---

## Task 9: JobsList name display + delete

**Files:**
- Modify: `web/src/pages/JobsList.tsx`
- Test: `web/src/pages/JobsList.test.tsx`

**Interfaces:**
- Consumes: `client.deleteJob(id)`, `client.deleteBatch(id)` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add `userEvent` import and these tests to `web/src/pages/JobsList.test.tsx` (add `import userEvent from "@testing-library/user-event";` under the existing imports, and append these `it` blocks inside `describe("JobsList", ...)`):

```ts
  it("shows the name instead of the id when the job has one", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished", name: "My Survey" }]);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText("My Survey")).toBeInTheDocument());
    expect(screen.queryByText("abc123")).not.toBeInTheDocument();
  });

  it("deletes a job after confirming, then refreshes the list", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    vi.spyOn(client, "listJobs")
      .mockResolvedValueOnce([{ job_id: "abc123", status: "finished" }])
      .mockResolvedValueOnce([]);
    vi.spyOn(client, "deleteJob").mockResolvedValue();
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(client.deleteJob).toHaveBeenCalledWith("abc123"));
    await waitFor(() => expect(screen.queryByText(/abc123/)).not.toBeInTheDocument());
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    const del = vi.spyOn(client, "deleteJob");
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(del).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/JobsList.test.tsx`
Expected: FAIL — no button named "delete" exists yet

- [ ] **Step 3: Implement**

Replace `web/src/pages/JobsList.tsx` in full:

```tsx
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Inbox, TriangleAlert, Trash2 } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { springSnappy } from "../components/ui/transitions";

function Row({ to, primary, secondary, right, delay, onDelete }: {
  to: string; primary: React.ReactNode; secondary?: React.ReactNode; right: React.ReactNode; delay: number;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSnappy, delay }}
      className="flex items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:bg-white/[0.04]"
    >
      <Link to={to} className="group flex flex-1 items-center gap-2 text-sm text-ink">
        {primary}
        {secondary}
      </Link>
      <span className="flex items-center gap-3">
        {right}
        <button
          type="button"
          aria-label="Delete"
          onClick={onDelete}
          className="text-faint transition-colors duration-150 hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </span>
    </motion.div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export function JobsList() {
  const qc = useQueryClient();
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
  const deleteJob = useMutation({
    mutationFn: (id: string) => client.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const deleteBatch = useMutation({
    mutationFn: (id: string) => client.deleteBatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batches"] }),
  });

  const showSkeleton = (jobs.isLoading && !jobs.data) && (batches.isLoading && !batches.data);
  const isEmpty = jobs.data && batches.data && jobs.data.length === 0 && batches.data.length === 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
          <p className="mt-0.5 text-sm text-muted">Single solves and batch sweeps</p>
        </div>
        <Link
          to="/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accentInk
            shadow-elevated transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={16} strokeWidth={2.5} /> New Job
        </Link>
      </div>

      {jobs.error && batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={15} /> Failed to load jobs and batches.
        </p>
      )}
      {jobs.error && !batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger"><TriangleAlert size={15} /> Failed to load jobs.</p>
      )}
      {!jobs.error && batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger"><TriangleAlert size={15} /> Failed to load batches.</p>
      )}

      <Card className="divide-y divide-hair overflow-hidden">
        {showSkeleton && (
          <>
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </>
        )}

        {!showSkeleton && (batches.data ?? []).map((b, i) => (
          <Row
            key={b.batch_id}
            to={`/batches/${b.batch_id}`}
            delay={i * 0.03}
            primary={<span className="tnum">{b.name ?? b.batch_id}</span>}
            secondary={<span className="text-muted">(batch)</span>}
            right={
              <>
                <span className="tnum text-xs text-muted">{b.done} / {b.total}</span>
                <StatusBadge status={b.status} />
              </>
            }
            onDelete={() => {
              if (window.confirm("Delete this batch? This cannot be undone.")) deleteBatch.mutate(b.batch_id);
            }}
          />
        ))}

        {!showSkeleton && (jobs.data ?? []).map((j, i) => (
          <Row
            key={j.job_id}
            to={`/jobs/${j.job_id}`}
            delay={((batches.data?.length ?? 0) + i) * 0.03}
            primary={<span className="tnum">{j.name ?? j.job_id}</span>}
            right={<StatusBadge status={j.status} />}
            onDelete={() => {
              if (window.confirm("Delete this job? This cannot be undone.")) deleteJob.mutate(j.job_id);
            }}
          />
        ))}

        {!showSkeleton && isEmpty && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <Inbox size={28} className="text-faint" />
            <p className="text-sm text-muted">No jobs yet — start one to see results here.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/JobsList.test.tsx`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/JobsList.tsx web/src/pages/JobsList.test.tsx
git commit -m "feat(web): show job/batch names and add delete from the jobs list"
```

---

## Task 10: JobDetail rename

**Files:**
- Modify: `web/src/pages/JobDetail.tsx`
- Test: `web/src/pages/JobDetail.test.tsx`

**Interfaces:**
- Consumes: `EditableName` (Task 8), `client.renameJob(id, name)` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `web/src/pages/JobDetail.test.tsx`, inside `describe("JobDetail", ...)`:

```ts
  it("shows the name and renames via the client on save", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j3", status: "finished", error: null, name: "Old Name" });
    vi.spyOn(client, "getResult").mockResolvedValue(solution as any);
    vi.spyOn(client, "renameJob").mockResolvedValue({ job_id: "j3", status: "finished", error: null, name: "New Name" });
    wrap("j3");
    await waitFor(() => expect(screen.getByText("Old Name")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    await waitFor(() => expect(client.renameJob).toHaveBeenCalledWith("j3", "New Name"));
  });
```

Add `import userEvent from "@testing-library/user-event";` to the top of the file if not already present (it isn't — the file currently only imports `vi`/`waitFor`/etc. from vitest/testing-library).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/JobDetail.test.tsx -t "renames via the client"`
Expected: FAIL — `Unable to find role "button" with name /rename/i`

- [ ] **Step 3: Implement**

Replace `web/src/pages/JobDetail.tsx` in full:

```tsx
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryTiles } from "../components/SummaryTiles";
import { TrackMap } from "../components/TrackMap";
import { ChartTabs } from "../components/ChartTabs";
import { Placeholder } from "../components/Placeholder";
import { EditableName } from "../components/EditableName";
import { Card } from "../components/ui/Card";

export function JobDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["job", id],
    queryFn: () => client.getJob(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "started" ? 2000 : false;
    },
  });
  const finished = status.data?.status === "finished";
  const result = useQuery({
    queryKey: ["result", id],
    queryFn: () => client.getResult(id),
    enabled: finished,
  });
  const rename = useMutation({
    mutationFn: (name: string) => client.renameJob(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", id] }),
  });

  const arThreshold = Number((result.data?.config_used as any)?.ar_ratio_min ?? 3);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="tnum text-xl font-semibold tracking-tight text-ink">
          <EditableName name={status.data?.name} id={id} onSave={(n) => rename.mutate(n)} />
        </h1>
        {status.data && <StatusBadge status={status.data.status} />}
        {result.data?.meta && (
          <span className="tnum text-sm text-muted">
            {result.data.meta.rover_id} · v{result.data.meta.rinex_version} · {result.data.meta.interval_s ?? "—"}s · {result.data.meta.span_s ?? "—"}s span
          </span>
        )}
      </div>

      {(status.data?.status === "queued" || status.data?.status === "started") && (
        <Card className="flex items-center gap-2.5 px-4 py-3.5 text-sm text-muted">
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none text-accent" />
          Processing… polling for completion.
        </Card>
      )}

      {status.data?.status === "failed" && status.data.error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <div className="font-medium text-danger">{status.data.error.type}</div>
          <div className="mt-1 text-ink/90">{status.data.error.message}</div>
        </div>
      )}

      {finished && result.data && (
        <>
          <SummaryTiles solution={result.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden p-3">
              <TrackMap solution={result.data} />
            </Card>
            <ChartTabs solution={result.data} arThreshold={arThreshold} />
          </div>
          <div className="space-y-2">
            <Placeholder title="DOP (PDOP / HDOP / VDOP)" note="available after engine DOP support" />
            <Placeholder title="Multi-base comparison & constellation matrix" note="available after pipeline upgrade (sub-project 4)" />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/JobDetail.test.tsx`
Expected: PASS (all tests, including pre-existing ones — note the existing tests use `status: "finished"`/`"failed"` without `name`, which is fine since `EditableName` falls back to `id`)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/JobDetail.tsx web/src/pages/JobDetail.test.tsx
git commit -m "feat(web): rename a job from its detail page"
```

---

## Task 11: BatchDetail rename

**Files:**
- Modify: `web/src/pages/BatchDetail.tsx`
- Test: `web/src/pages/BatchDetail.test.tsx`

**Interfaces:**
- Consumes: `EditableName` (Task 8), `client.renameBatch(id, name)` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `web/src/pages/BatchDetail.test.tsx`, inside `describe("BatchDetail", ...)`:

```ts
  it("shows the name and renames via the client on save", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "running",
      bases: [{ base_id: "base-0", done: 1, total: 2, failed: 0 }],
      done: 1, total: 2, name: "Old Sweep",
    });
    vi.spyOn(client, "renameBatch").mockResolvedValue({
      batch_id: "b1", status: "running",
      bases: [{ base_id: "base-0", done: 1, total: 2, failed: 0 }],
      done: 1, total: 2, name: "New Sweep",
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText("Old Sweep")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Sweep{Enter}");
    await waitFor(() => expect(client.renameBatch).toHaveBeenCalledWith("b1", "New Sweep"));
  });
```

Add `import userEvent from "@testing-library/user-event";` to the top of the file (not currently imported).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx -t "renames via the client"`
Expected: FAIL — `Unable to find role "button" with name /rename/i`

- [ ] **Step 3: Implement**

In `web/src/pages/BatchDetail.tsx`, add imports (`useQueryClient`, `useMutation` from `@tanstack/react-query`; `EditableName`):

```tsx
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { BatchReportEntry } from "../api/types";
import { DistributionGrid } from "../components/charts/DistributionGrid";
import { BatchResultScatter } from "../components/charts/BatchResultScatter";
import { EditableName } from "../components/EditableName";
import { mean, range } from "../lib/stats";
import { Card } from "../components/ui/Card";
import { springSmooth, springSnappy } from "../components/ui/transitions";
```

(keep the rest of the file's helper functions — `summarizeConfig`, `StatTile`, `successfulNumeric`, `computeCoordStats`, `CoordStatTiles` — unchanged)

Then modify the `BatchDetail` function body, adding `qc` and the `rename` mutation, and swapping the header `<h1>`:

```tsx
export function BatchDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
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
  const rename = useMutation({
    mutationFn: (name: string) => client.renameBatch(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batch", id] }),
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleBase = (baseId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(baseId) ? next.delete(baseId) : next.add(baseId);
      return next;
    });
  const allResults = useMemo(() => (report.data ? report.data.bases.flatMap((b) => b.results) : []), [report.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="tnum text-xl font-semibold tracking-tight text-ink">
          <EditableName name={status.data?.name} id={id} onSave={(n) => rename.mutate(n)} />
        </h1>
        {status.data && <StatusBadge status={status.data.status} />}
        {status.data && (
          <span className="tnum text-sm text-muted">
            {status.data.done} / {status.data.total}
          </span>
        )}
      </div>
```

The rest of the component (from `{!finished && status.data && (...)}` through the closing `</div>` at the end of the return) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/BatchDetail.tsx web/src/pages/BatchDetail.test.tsx
git commit -m "feat(web): rename a batch from its detail page"
```

---

## Task 12: header back button

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: nothing new (uses `react-router-dom`'s `useLocation`/`useNavigate`, already a dependency).

- [ ] **Step 1: Write the failing tests**

Create `web/src/App.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

function wrap(initialEntries: string[], initialIndex = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("App back button", () => {
  it("hides the back button on the initial history entry", () => {
    wrap(["/"]);
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("shows the back button after navigating away from the initial entry", () => {
    wrap(["/", "/new"], 1);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: FAIL on the second test — no button named "back" exists yet (first test passes trivially, which is fine — TDD here is about the second assertion)

- [ ] **Step 3: Implement**

Replace `web/src/App.tsx` in full:

```tsx
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Radar } from "lucide-react";
import { JobsList } from "./pages/JobsList";
import { NewJob } from "./pages/NewJob";
import { JobDetail } from "./pages/JobDetail";
import { BatchDetail } from "./pages/BatchDetail";
import { PageTransition } from "./components/ui/PageTransition";

export default function App() {
  const location = useLocation();
  const nav = useNavigate();
  const canGoBack = location.key !== "default";

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="material-chrome sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-3.5">
          {canGoBack && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => nav(-1)}
              className="flex items-center justify-center rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
            >
              <ArrowLeft size={17} />
            </button>
          )}
          <Link to="/" className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Radar size={18} className="text-accent" strokeWidth={2.25} />
            GNSS <span className="text-accent">Solver</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <PageTransition>
          <Routes>
            <Route path="/" element={<JobsList />} />
            <Route path="/new" element={<NewJob />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
          </Routes>
        </PageTransition>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full frontend suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests, no regressions from Tasks 5–12)

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): add header back-navigation button"
```

---

## Final Verification

- [ ] **Step 1: Full backend suite**

Run: `pytest tests/ -v`
Expected: all pass

- [ ] **Step 2: Full frontend suite**

Run: `cd web && npx vitest run`
Expected: all pass

- [ ] **Step 3: Frontend typecheck + build**

Run: `cd web && npx tsc -b && npx vite build`
Expected: no type errors, build succeeds

- [ ] **Step 4: Rebuild and redeploy the `web`/`api` Docker images, smoke-test in browser**

```bash
docker compose -f docker/docker-compose.yml build web api worker
docker compose -f docker/docker-compose.yml up -d
```

Then in a browser at `http://localhost:3000`: create a named job, confirm the name shows in the list, rename it from the detail page, delete a job from the list (confirm dialog appears), and confirm the back button appears after navigating into a job and returns to the list.
