# Known Base Coordinate for Batch Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user set a known/fixed coordinate per base file in batch job submission, so a surveyed base station's real-world position is used instead of always falling back to single-solution auto-computed position.

**Architecture:** Coordinate is tied to base-file identity, not the randomized sweep — `gnss_engine/sweep.py` stays untouched. The API accepts a new optional `base_coords` field (JSON list, order-matched to uploaded base files) on `POST /batches`, and overrides each drawn `ProcessingConfig`'s `base_coord_mode`/`base_coord` per base via `model_copy` before writing the job. The frontend adds a mode-select + coordinate-inputs row per base file, mirroring the existing single-job `ConfigForm.tsx` pattern.

**Tech Stack:** FastAPI, Pydantic v2, pytest (backend); React/TypeScript, Vitest, @testing-library/react (frontend).

## Global Constraints

- `base_coords` is **optional** on `POST /batches` (`Form(None)`, not `Form(...)`) — ~30 existing tests in `tests/api/test_main.py` call this endpoint without it, and it must keep defaulting to `single`/`None` for every base (matching today's behavior) when omitted.
- No changes to `gnss_engine/models/config.py`, `gnss_engine/sweep.py`, or `gnss_engine/conf/render.py` — `ProcessingConfig.base_coord_mode`/`base_coord` and their RTKLIB rendering already exist and work; this feature only needs to populate them correctly per batch job.
- `web/src/components/SweepConfigForm.tsx` is out of scope — sweep-range UI only, unrelated to base coordinates.

---

### Task 1: Backend — per-base known coordinate in `POST /batches`

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/main.py:9-48` (imports/constants), `api/main.py:122-199` (`/batches` endpoint)
- Test: `tests/api/test_main.py`

**Interfaces:**
- Produces: `BaseCoordEntry` (in `api/schemas.py`) — `mode: BaseCoordMode = BaseCoordMode.SINGLE`, `coord: tuple[float, float, float] | None = None`. Consumed only within `api/main.py`'s `/batches` handler for this task; not consumed by any other task.

- [ ] **Step 1: Write the failing tests**

In `tests/api/test_main.py`, insert these 4 tests immediately after `test_post_batch_creates_jobs_for_every_base_and_config` (which ends at line 223) and before `test_post_batch_requires_at_least_one_base` (line 226):

```python
def test_post_batch_applies_per_base_known_coord(client):
    base_coords = json.dumps([
        {"mode": "single", "coord": None},
        {"mode": "known-llh", "coord": [32.0, 34.0, 50.0]},
    ])
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=2),
        data={**_batch_data("2"), "base_coords": base_coords},
    )
    assert resp.status_code == 201
    manifest = jobstore.read_batch_manifest(resp.json()["batch_id"])
    base0_job = manifest["bases"][0]["jobs"][0]["job_id"]
    base1_job = manifest["bases"][1]["jobs"][0]["job_id"]
    cfg0 = jobstore.read_config(base0_job)
    cfg1 = jobstore.read_config(base1_job)
    assert cfg0.base_coord_mode == "single"
    assert cfg0.base_coord is None
    assert cfg1.base_coord_mode == "known-llh"
    assert cfg1.base_coord == (32.0, 34.0, 50.0)
    assert manifest["bases"][0]["base_coord_mode"] == "single"
    assert manifest["bases"][0]["base_coord"] is None
    assert manifest["bases"][1]["base_coord_mode"] == "known-llh"
    assert manifest["bases"][1]["base_coord"] == [32.0, 34.0, 50.0]


def test_post_batch_defaults_base_coords_to_single_when_omitted(client):
    resp = client.post("/batches", files=_batch_files(n_bases=2), data=_batch_data("1"))
    assert resp.status_code == 201
    manifest = jobstore.read_batch_manifest(resp.json()["batch_id"])
    for b in manifest["bases"]:
        assert b["base_coord_mode"] == "single"
        assert b["base_coord"] is None
        cfg = jobstore.read_config(b["jobs"][0]["job_id"])
        assert cfg.base_coord_mode == "single"
        assert cfg.base_coord is None


def test_post_batch_rejects_base_coords_length_mismatch(client):
    base_coords = json.dumps([{"mode": "single", "coord": None}])
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=2),
        data={**_batch_data("1"), "base_coords": base_coords},
    )
    assert resp.status_code == 422


def test_post_batch_rejects_known_mode_missing_coord(client):
    base_coords = json.dumps([{"mode": "known-xyz", "coord": None}])
    resp = client.post(
        "/batches",
        files=_batch_files(n_bases=1),
        data={**_batch_data("1"), "base_coords": base_coords},
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_main.py -k "base_coord" -v`
Expected: FAIL, all 4 — `test_post_batch_applies_per_base_known_coord` fails on `assert cfg1.base_coord_mode == "known-llh"` (actual `"single"`, new field isn't read yet). `test_post_batch_rejects_base_coords_length_mismatch` and `test_post_batch_rejects_known_mode_missing_coord` fail on `assert resp.status_code == 422` (actual `201`, FastAPI silently ignores the unknown `base_coords` form field today). `test_post_batch_defaults_base_coords_to_single_when_omitted` fails with `KeyError: 'base_coord_mode'` — today's `bases_manifest` entries only have `base_id`/`filename`/`jobs`, no coordinate keys at all yet.

- [ ] **Step 3: Add `BaseCoordEntry` to `api/schemas.py`**

In `api/schemas.py`, change the top:

```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel
```

to:

```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from gnss_engine.models.config import BaseCoordMode
```

Then insert this new class right before `class BatchCreated(BaseModel):`:

```python
class BaseCoordEntry(BaseModel):
    mode: BaseCoordMode = BaseCoordMode.SINGLE
    coord: tuple[float, float, float] | None = None


```

- [ ] **Step 4: Wire it into `api/main.py`**

Change the imports at the top of `api/main.py`. The pydantic import line:

```python
from pydantic import ValidationError
```

becomes:

```python
from pydantic import TypeAdapter, ValidationError
```

The schemas import block:

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
    JobCreated,
    JobListItem,
    JobStatusResponse,
    RenameRequest,
    TimeSyncFileResult,
    TimeSyncResponse,
    TimeWindow,
)
```

becomes:

```python
from api.schemas import (
    BaseCoordEntry,
    BatchBaseReport,
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchReportEntry,
    BatchReportResponse,
    BatchReportSummary,
    BatchStatusResponse,
    JobCreated,
    JobListItem,
    JobStatusResponse,
    RenameRequest,
    TimeSyncFileResult,
    TimeSyncResponse,
    TimeWindow,
)
```

The gnss_engine config import:

```python
from gnss_engine.models.config import ProcessingConfig, SweepConfig
```

becomes:

```python
from gnss_engine.models.config import BaseCoordMode, ProcessingConfig, SweepConfig
```

Right after the `MAX_TOTAL_BATCH_JOBS = 500` constant (and its comment), add:

```python
_BASE_COORDS_ADAPTER = TypeAdapter(list[BaseCoordEntry])
```

- [ ] **Step 5: Accept and validate `base_coords` in `create_batch`**

The `create_batch` signature currently reads:

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
```

Change it to:

```python
@app.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    base: list[UploadFile] = File(...),
    sweep_config: str = Form(...),
    base_coords: str | None = Form(None),
    n_configs: int = Form(100),
    name: str | None = Form(None),
) -> BatchCreated:
```

Immediately after the existing sweep-config parse block:

```python
    try:
        sweep = SweepConfig.model_validate_json(sweep_config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid sweep_config: {exc}") from exc
```

insert:

```python
    if base_coords is None:
        base_coord_entries = [BaseCoordEntry() for _ in base]
    else:
        try:
            base_coord_entries = _BASE_COORDS_ADAPTER.validate_json(base_coords)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=f"invalid base_coords: {exc}") from exc
        if len(base_coord_entries) != len(base):
            raise HTTPException(
                status_code=422,
                detail="base_coords length must match number of base files",
            )
        for i, entry in enumerate(base_coord_entries):
            if entry.mode != BaseCoordMode.SINGLE and entry.coord is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"base_coords[{i}]: coord is required when mode is not 'single'",
                )
```

- [ ] **Step 6: Apply the per-base override in the job-creation loop**

The base loop currently reads:

```python
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
            jobstore.write_job_sweep_config(job_id, sweep)
            queue.enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
            jobs.append({"job_id": job_id, "config_idx": config_idx})
        bases_manifest.append({"base_id": base_id, "filename": base_filename, "jobs": jobs})
```

Change it to:

```python
    bases_manifest = []
    for base_idx, bf in enumerate(base):
        base_id = f"base-{base_idx}"
        base_filename = bf.filename or f"base{base_idx}.rnx"
        base_bytes = await bf.read()
        coord_entry = base_coord_entries[base_idx]
        jobs = []
        for config_idx, cfg in enumerate(configs):
            job_id = uuid.uuid4().hex
            jobstore.save_upload(job_id, "rover", rover_filename, rover_bytes)
            for nav_filename, nav_bytes in nav_uploads:
                jobstore.save_upload(job_id, "nav", nav_filename, nav_bytes)
            jobstore.save_upload(job_id, "base", base_filename, base_bytes)
            job_cfg = cfg.model_copy(update={
                "base_coord_mode": coord_entry.mode,
                "base_coord": coord_entry.coord,
            })
            jobstore.write_config(job_id, job_cfg)
            jobstore.write_job_sweep_config(job_id, sweep)
            queue.enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
            jobs.append({"job_id": job_id, "config_idx": config_idx})
        bases_manifest.append({
            "base_id": base_id,
            "filename": base_filename,
            "base_coord_mode": coord_entry.mode.value,
            "base_coord": coord_entry.coord,
            "jobs": jobs,
        })
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_main.py -k "base_coord" -v`
Expected: PASS (4 tests)

- [ ] **Step 8: Run the full API test suite for regressions**

Run: `python -m pytest tests/api/ -v`
Expected: PASS, no regressions — every existing `/batches` call omits `base_coords`, which now defaults to one `BaseCoordEntry()` (mode `single`, coord `None`) per base, identical to the config each of those tests already asserts on.

- [ ] **Step 9: Commit**

```bash
git add api/schemas.py api/main.py tests/api/test_main.py
git commit -m "feat(api): support known coordinate per base in batch job submission"
```

---

### Task 2: Frontend — per-base coordinate data model and UI

**Files:**
- Modify: `web/src/lib/buildBatchForm.ts`
- Modify: `web/src/components/BatchFileUploads.tsx`
- Test: `web/src/components/BatchFileUploads.test.tsx` (new)

**Interfaces:**
- Consumes: `BaseCoordMode` type from `web/src/api/types.ts:8` (already exists — `"known-llh" | "known-xyz" | "single"`).
- Produces: `BatchBaseEntry` and updated `BatchFiles` (in `web/src/lib/buildBatchForm.ts`) — `BatchFiles.bases: BatchBaseEntry[]` where `BatchBaseEntry = { file: File | null; base_coord_mode: BaseCoordMode; base_coord: [number, number, number] | null }`. Consumed by Task 3 (`NewJob.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/BatchFileUploads.test.tsx`:

```tsx
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchFileUploads } from "./BatchFileUploads";
import type { BatchFiles } from "../lib/buildBatchForm";

function baseFiles(overrides: Partial<BatchFiles> = {}): BatchFiles {
  return {
    rover: null,
    nav: [],
    bases: [{ file: null, base_coord_mode: "single", base_coord: null }],
    ...overrides,
  };
}

function Harness({ initial }: { initial: BatchFiles }) {
  const [value, setValue] = useState(initial);
  return <BatchFileUploads value={value} onChange={setValue} />;
}

describe("BatchFileUploads", () => {
  it("defaults each base row to single mode with no coordinate inputs", () => {
    render(<BatchFileUploads value={baseFiles()} onChange={() => {}} />);
    expect(screen.getByLabelText("Base 1 coordinate mode")).toHaveValue("single");
    expect(screen.queryByLabelText("Base 1 coordinate 0")).not.toBeInTheDocument();
  });

  it("shows 3 coordinate inputs defaulted to 0 when mode switches off single", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BatchFileUploads value={baseFiles()} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Base 1 coordinate mode"), "known-llh");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        bases: [expect.objectContaining({ base_coord_mode: "known-llh", base_coord: [0, 0, 0] })],
      })
    );
  });

  it("clears the coordinate back to null when mode switches back to single", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = baseFiles({ bases: [{ file: null, base_coord_mode: "known-llh", base_coord: [1, 2, 3] }] });
    render(<BatchFileUploads value={value} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Base 1 coordinate mode"), "single");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        bases: [expect.objectContaining({ base_coord_mode: "single", base_coord: null })],
      })
    );
  });

  it("updates a single coordinate axis without touching the others", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={baseFiles({ bases: [{ file: null, base_coord_mode: "known-xyz", base_coord: [1, 2, 3] }] })}
      />
    );
    const input = screen.getByLabelText("Base 1 coordinate 1");
    await user.clear(input);
    await user.type(input, "9");
    expect(screen.getByLabelText("Base 1 coordinate 0")).toHaveValue(1);
    expect(input).toHaveValue(9);
    expect(screen.getByLabelText("Base 1 coordinate 2")).toHaveValue(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/BatchFileUploads.test.tsx`
Expected: FAIL — TypeScript/runtime errors, since `BatchFiles.bases` is still `(File | null)[]` (no `base_coord_mode`/`base_coord` fields, no mode `<select>` or coordinate `<input>`s rendered).

- [ ] **Step 3: Update `BatchFiles`/`BatchBaseEntry` in `buildBatchForm.ts`**

`web/src/lib/buildBatchForm.ts` currently reads:

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

Replace it entirely with:

```ts
import type { BaseCoordMode, SweepConfig } from "../api/types";

export interface BatchBaseEntry {
  file: File | null;
  base_coord_mode: BaseCoordMode;
  base_coord: [number, number, number] | null;
}

export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: BatchBaseEntry[];
}

export function buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100, name?: string): FormData {
  const fd = new FormData();
  if (name && name.trim()) fd.append("name", name.trim());
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  const validBases = files.bases.filter((b): b is BatchBaseEntry & { file: File } => b.file !== null);
  for (const b of validBases) fd.append("base", b.file);
  fd.append("n_configs", String(nConfigs));
  fd.append("sweep_config", JSON.stringify(sweepConfig));
  fd.append(
    "base_coords",
    JSON.stringify(validBases.map((b) => ({ mode: b.base_coord_mode, coord: b.base_coord })))
  );
  return fd;
}
```

- [ ] **Step 4: Add the mode select + coordinate inputs to `BatchFileUploads.tsx`**

Replace the full contents of `web/src/components/BatchFileUploads.tsx` with:

```tsx
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { BaseCoordMode } from "../api/types";
import type { BatchBaseEntry, BatchFiles } from "../lib/buildBatchForm";
import { selCls } from "./ui/inputStyles";

const fileCls =
  "block w-full text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 " +
  "file:bg-accent/15 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent " +
  "hover:file:bg-accent/25 file:transition-colors file:duration-150";

const BASEMODES: BaseCoordMode[] = ["single", "known-llh", "known-xyz"];

function UploadSlot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-xl border border-dashed border-hair bg-panel2/50 p-3 text-sm transition-colors duration-150 hover:border-hairStrong">
      <span className="mb-2 block font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function BatchFileUploads({ value, onChange }: { value: BatchFiles; onChange: (v: BatchFiles) => void }) {
  // Stable per-row ids, independent of array position, so React doesn't reuse/reconcile
  // the wrong DOM node (and its uncontrolled <input type="file"> display) when a row is
  // removed from the middle/start of the list.
  const nextRowId = useRef(value.bases.length);
  const [rowIds, setRowIds] = useState<number[]>(() => value.bases.map((_, i) => i));

  function setBase(i: number, f: File | null) {
    const bases = [...value.bases];
    bases[i] = { ...bases[i], file: f };
    onChange({ ...value, bases });
  }
  function setBaseCoordMode(i: number, mode: BaseCoordMode) {
    const bases = [...value.bases];
    bases[i] = {
      ...bases[i],
      base_coord_mode: mode,
      base_coord: mode === "single" ? null : (bases[i].base_coord ?? [0, 0, 0]),
    };
    onChange({ ...value, bases });
  }
  function setBaseCoordAxis(i: number, axis: 0 | 1 | 2, val: number) {
    const bases = [...value.bases];
    const coord = [...(bases[i].base_coord ?? [0, 0, 0])] as [number, number, number];
    coord[axis] = val;
    bases[i] = { ...bases[i], base_coord: coord };
    onChange({ ...value, bases });
  }
  function addBase() {
    setRowIds([...rowIds, nextRowId.current++]);
    const entry: BatchBaseEntry = { file: null, base_coord_mode: "single", base_coord: null };
    onChange({ ...value, bases: [...value.bases, entry] });
  }
  function removeBase(i: number) {
    setRowIds(rowIds.filter((_, j) => j !== i));
    onChange({ ...value, bases: value.bases.filter((_, j) => j !== i) });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UploadSlot label="Rover (obs)">
        <input className={fileCls} type="file" onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </UploadSlot>
      <UploadSlot label="Navigation (1+)">
        <input className={fileCls} type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </UploadSlot>
      <div className="text-sm sm:col-span-3">
        <span className="mb-2 block font-medium text-muted">Bases (1+)</span>
        <div className="space-y-2">
          {value.bases.map((b, i) => (
            <div key={rowIds[i]} className="space-y-2 rounded-xl border border-dashed border-hair bg-panel2/50 p-3 transition-colors duration-150 hover:border-hairStrong">
              <div className="flex items-center gap-2">
                <label className="flex-1">
                  <span className="sr-only">{`Base ${i + 1}`}</span>
                  <input
                    aria-label={`Base ${i + 1}`}
                    className={fileCls}
                    type="file"
                    onChange={(e) => setBase(i, e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeBase(i)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hair px-2.5 py-1.5 text-xs text-muted transition-colors duration-150 hover:border-danger/40 hover:text-danger"
                >
                  <X size={13} /> Remove
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Base ${i + 1} coordinate mode`}
                  className={selCls}
                  value={b.base_coord_mode}
                  onChange={(e) => setBaseCoordMode(i, e.target.value as BaseCoordMode)}
                >
                  {BASEMODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {b.base_coord_mode !== "single" && (
                  <div className="grid flex-1 grid-cols-3 gap-2">
                    {([0, 1, 2] as const).map((axis) => (
                      <input
                        key={axis}
                        aria-label={`Base ${i + 1} coordinate ${axis}`}
                        type="number"
                        step="any"
                        className={selCls}
                        value={b.base_coord?.[axis] ?? 0}
                        onChange={(e) => setBaseCoordAxis(i, axis, Number(e.target.value))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addBase}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hair px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:border-hairStrong hover:text-ink"
          >
            + Add base
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/BatchFileUploads.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/buildBatchForm.ts web/src/components/BatchFileUploads.tsx web/src/components/BatchFileUploads.test.tsx
git commit -m "feat(web): known coordinate input per base row in batch upload"
```

---

### Task 3: Frontend — wire `NewJob.tsx` to the new per-base shape

**Files:**
- Modify: `web/src/pages/NewJob.tsx`

**Interfaces:**
- Consumes: `BatchBaseEntry`/`BatchFiles` from Task 2 (`web/src/lib/buildBatchForm.ts`).

- [ ] **Step 1: Run `tsc` to see the breakage from Task 2's type change**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — errors in `web/src/pages/NewJob.tsx` around `batchFiles.bases`: the `useState<BatchFiles>` initializer (`bases: [null]`) no longer matches `BatchBaseEntry[]`, the `useTimeSyncCheck(batchFiles.rover, batchFiles.bases, ...)` call no longer matches `(File | null)[]`, and `batchFiles.bases.every(Boolean)` no longer means "every row has a file".

- [ ] **Step 2: Fix the state initializer**

In `web/src/pages/NewJob.tsx`, change:

```ts
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({ rover: null, nav: [], bases: [null] });
```

to:

```ts
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({
    rover: null,
    nav: [],
    bases: [{ file: null, base_coord_mode: "single", base_coord: null }],
  });
```

- [ ] **Step 3: Fix the time-sync check call**

Change:

```ts
  const batchTimeSync = useTimeSyncCheck(batchFiles.rover, batchFiles.bases, batchFiles.nav);
```

to:

```ts
  const batchTimeSync = useTimeSyncCheck(batchFiles.rover, batchFiles.bases.map((b) => b.file), batchFiles.nav);
```

- [ ] **Step 4: Fix the submit-readiness check**

Change:

```ts
    (mode === "single"
      ? !!files.rover && files.nav.length > 0
      : !!batchFiles.rover && batchFiles.nav.length > 0 && batchFiles.bases.length > 0 && batchFiles.bases.every(Boolean));
```

to:

```ts
    (mode === "single"
      ? !!files.rover && files.nav.length > 0
      : !!batchFiles.rover &&
        batchFiles.nav.length > 0 &&
        batchFiles.bases.length > 0 &&
        batchFiles.bases.every((b) => b.file !== null));
```

- [ ] **Step 5: Update the batch-mode helper copy**

Change:

```tsx
              <p className="mb-4 text-sm text-muted">
                100 random configs will be generated per the bounds below and run against each base. Base position is
                taken from each base file (single-solution mode) — no manual coordinates.
              </p>
```

to:

```tsx
              <p className="mb-4 text-sm text-muted">
                100 random configs will be generated per the bounds below and run against each base. Set a known
                coordinate on a base above if it's a surveyed station — otherwise its position is computed from the
                base file (single-solution mode).
              </p>
```

- [ ] **Step 6: Run `tsc` to verify the type errors are gone**

Run: `cd web && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 7: Run the full web test suite for regressions**

Run: `cd web && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/NewJob.tsx
git commit -m "feat(web): wire per-base known coordinate through NewJob batch submission"
```
