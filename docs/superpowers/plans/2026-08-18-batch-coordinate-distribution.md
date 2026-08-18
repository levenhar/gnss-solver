# Batch Coordinate Distribution Plots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the batch distribution grid's RMS N/E/U histograms with each job's actual computed position (UTM Easting/Northing/Height), so the plots show how the estimated position varies across the sweep instead of how confident each job's solver was.

**Architecture:** Engine computes each job's mean position (`mean_lat`/`mean_lon`/`mean_h`) from its epochs. The API, at batch-report time, averages every job's mean position within a base into one reference point, derives a single UTM zone from it, and converts each job's own mean position into UTM Easting/Northing with one shared `pyproj.Transformer` — keeping all jobs in a base on the same projected grid. The frontend swaps the distribution grid's 3 non-fix-rate tiles to plot these new fields instead of `rms_sdn/sde/sdu`.

**Tech Stack:** Python (FastAPI, Pydantic, pyproj), React/TypeScript, Vitest, pytest.

## Global Constraints

- Backward compatible: old stored `solution.json` files have no `mean_lat`/`mean_lon`/`mean_h` keys at all — `dict.get()` returns `None`, which must flow through to `utm_e`/`utm_n` staying `None` (no crash, no migration).
- `mean_lat`/`mean_lon`/`mean_h` are `None` (not `0.0`) when a job has zero epochs — `(0, 0)` is a real geographic point (Gulf of Guinea) and must never be silently included in a base's UTM reference average. This is a deliberate deviation from the existing `mean_sdn`/`mean_sde`/`mean_sdu`/`rms_*` fields, which keep their `0.0`-on-empty convention unchanged.
- The per-job table's existing "RMS N/E/U" column (`web/src/pages/BatchDetail.tsx:130,153`) is explicitly out of scope — do not touch it. `rms_sdn`/`rms_sde`/`rms_sdu` stay on `BatchReportEntry` (backend and frontend) exactly as they are today; only `DistributionGrid`'s `METRICS` array changes which fields it reads.
- One UTM zone per base, derived from the average of all its jobs' mean positions — not one zone per job. `zone = int((ref_lon + 180) // 6) + 1`; hemisphere from `ref_lat >= 0` (EPSG `326XX` north / `327XX` south).
- If a base has zero jobs with position data, skip the UTM transform for that base entirely — every entry's `utm_e`/`utm_n` stay `None`, and the frontend's existing per-metric null-filtering in `DistributionGrid` renders "no data" for those tiles (already-built logic, no frontend change needed for this case).
- New dependency: add `pyproj` to `pyproject.toml` `dependencies` (already present in the dev environment but currently undeclared).

---

### Task 1: Engine — per-job mean position in `SolutionSummary`

**Files:**
- Modify: `gnss_engine/models/result.py`
- Modify: `gnss_engine/parse/summary.py`
- Test: `tests/parse/test_summary.py`

**Interfaces:**
- Produces: `SolutionSummary.mean_lat: float | None`, `.mean_lon: float | None`, `.mean_h: float | None` — consumed by Task 2 via the stored solution dict's `summary` key (`summary.get("mean_lat")` etc., read as plain JSON, not re-validated through this Pydantic model).

- [ ] **Step 1: Write the failing tests**

Read `tests/parse/test_summary.py` first (it exists, 2 tests). Replace its `_e` helper and add two new tests. Full new file contents:

```python
from __future__ import annotations

from datetime import datetime, timezone

from gnss_engine.parse.summary import summarize
from gnss_engine.models.result import Epoch


def _e(q: int, sdn: float, sde: float, sdu: float, lat: float = 0.0, lon: float = 0.0, h: float = 0.0) -> Epoch:
    return Epoch(
        t=datetime(2023, 1, 1, tzinfo=timezone.utc),
        lat=lat, lon=lon, h=h, q=q, ns=8,
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


def test_summary_mean_position():
    epochs = [
        _e(1, 0.01, 0.02, 0.03, lat=32.0, lon=34.0, h=50.0),
        _e(1, 0.01, 0.02, 0.03, lat=32.002, lon=34.004, h=52.0),
    ]
    s = summarize(epochs)
    assert abs(s.mean_lat - 32.001) < 1e-9
    assert abs(s.mean_lon - 34.002) < 1e-9
    assert abs(s.mean_h - 51.0) < 1e-9


def test_empty_summary_has_no_position():
    s = summarize([])
    assert s.mean_lat is None
    assert s.mean_lon is None
    assert s.mean_h is None
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python -m pytest tests/parse/test_summary.py -v`
Expected: `test_summary_mean_position` and `test_empty_summary_has_no_position` FAIL with `AttributeError: 'SolutionSummary' object has no attribute 'mean_lat'` (or Pydantic construction error, since the field doesn't exist yet). The two pre-existing tests still PASS (the `_e` signature change is backward compatible — new params have defaults).

- [ ] **Step 3: Add the fields to `SolutionSummary`**

In `gnss_engine/models/result.py`, the `SolutionSummary` class currently reads:

```python
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
```

Change it to:

```python
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
    mean_lat: float | None = None
    mean_lon: float | None = None
    mean_h: float | None = None
```

- [ ] **Step 4: Compute the new fields in `summarize()`**

In `gnss_engine/parse/summary.py`, the `summarize()` function currently reads:

```python
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

Change the `return` to add the three new fields:

```python
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
        mean_lat=_mean([e.lat for e in epochs]) if epochs else None,
        mean_lon=_mean([e.lon for e in epochs]) if epochs else None,
        mean_h=_mean([e.h for e in epochs]) if epochs else None,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/parse/test_summary.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the broader engine test suite for regressions**

Run: `python -m pytest tests/models/test_result.py tests/parse/ -v`
Expected: PASS, no regressions (`tests/models/test_result.py` constructs `SolutionSummary` without the new fields, which is fine — they default to `None`).

- [ ] **Step 7: Commit**

```bash
git add gnss_engine/models/result.py gnss_engine/parse/summary.py tests/parse/test_summary.py
git commit -m "feat(engine): compute mean job position (lat/lon/h) in SolutionSummary"
```

---

### Task 2: API — UTM conversion in the batch report

**Files:**
- Modify: `pyproject.toml`
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Test: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `summary.get("mean_lat")` / `.get("mean_lon")` / `.get("mean_h")` from the stored solution dict (Task 1 populates these going forward; may be absent on old data — always use `.get()`, never direct indexing).
- Produces: `BatchReportEntry.utm_e: float | None`, `.utm_n: float | None`, `.mean_h: float | None` — consumed by Task 3's `DistributionGrid`.

- [ ] **Step 1: Write the failing tests**

Read `tests/api/test_main.py` first — it's a large existing file; add these two new tests immediately after `test_batch_report_404_when_unknown` (do not remove or reorder existing tests):

```python
def test_batch_report_converts_mean_position_to_utm(client):
    from pyproj import Transformer

    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {
        "fix_rate_pct": 90.0, "mean_lat": 32.0, "mean_lon": 34.0, "mean_h": 50.0,
    }})
    jobstore.write_solution(job_ids[1], {"summary": {
        "fix_rate_pct": 80.0, "mean_lat": 32.002, "mean_lon": 34.004, "mean_h": 52.0,
    }})

    report = client.get(f"/batches/{bid}/report").json()
    results = {r["job_id"]: r for r in report["bases"][0]["results"]}

    ref_lon = (34.0 + 34.004) / 2
    zone = int((ref_lon + 180) // 6) + 1
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{32600 + zone}", always_xy=True)
    expected_e0, expected_n0 = transformer.transform(34.0, 32.0)
    expected_e1, expected_n1 = transformer.transform(34.004, 32.002)

    assert results[job_ids[0]]["utm_e"] == pytest.approx(expected_e0)
    assert results[job_ids[0]]["utm_n"] == pytest.approx(expected_n0)
    assert results[job_ids[0]]["mean_h"] == 50.0
    assert results[job_ids[1]]["utm_e"] == pytest.approx(expected_e1)
    assert results[job_ids[1]]["utm_n"] == pytest.approx(expected_n1)
    assert results[job_ids[1]]["mean_h"] == 52.0


def test_batch_report_no_position_data_leaves_utm_none(client):
    resp = client.post("/batches", files=_batch_files(n_bases=1), data=_batch_data("2"))
    bid = resp.json()["batch_id"]
    manifest = jobstore.read_batch_manifest(bid)
    job_ids = [j["job_id"] for j in manifest["bases"][0]["jobs"]]

    jobstore.write_solution(job_ids[0], {"summary": {"fix_rate_pct": 90.0}})
    jobstore.write_solution(job_ids[1], {"summary": {"fix_rate_pct": 80.0}})

    report = client.get(f"/batches/{bid}/report").json()
    for r in report["bases"][0]["results"]:
        assert r["utm_e"] is None
        assert r["utm_n"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_main.py -k "utm" -v`
Expected: FAIL — `test_batch_report_converts_mean_position_to_utm` fails because `results[...]["utm_e"]` is `KeyError` (field doesn't exist in the response yet, since `BatchReportEntry` has no `utm_e` field). `test_batch_report_no_position_data_leaves_utm_none` also fails the same way.

- [ ] **Step 3: Add `pyproj` as a dependency**

In `pyproject.toml`, change:

```toml
dependencies = ["pydantic>=2.6"]
```

to:

```toml
dependencies = ["pydantic>=2.6", "pyproj>=3.6"]
```

Then install it into the environment (it's already present, but this ensures the declared version constraint is satisfied): `pip install -e .`

- [ ] **Step 4: Add the new fields to `BatchReportEntry`**

In `api/schemas.py`, `BatchReportEntry` currently reads:

```python
class BatchReportEntry(BaseModel):
    job_id: str
    config_idx: int
    config: dict
    status: str
    fix_rate_pct: float | None = None
    rms_sdn: float | None = None
    rms_sde: float | None = None
    rms_sdu: float | None = None
    error_type: str | None = None
    error_message: str | None = None
```

Change it to:

```python
class BatchReportEntry(BaseModel):
    job_id: str
    config_idx: int
    config: dict
    status: str
    fix_rate_pct: float | None = None
    rms_sdn: float | None = None
    rms_sde: float | None = None
    rms_sdu: float | None = None
    utm_e: float | None = None
    utm_n: float | None = None
    mean_h: float | None = None
    error_type: str | None = None
    error_message: str | None = None
```

- [ ] **Step 5: Add the UTM conversion to `batch_report()`**

In `api/main.py`, add the import (alongside the existing `import statistics` at the top of the file):

```python
from pyproj import Transformer
```

Add a module-level helper function above `batch_report` (i.e. directly above the `@app.get("/batches/{batch_id}/report", ...)` line):

```python
def _utm_transformer(ref_lat: float, ref_lon: float) -> Transformer:
    zone = int((ref_lon + 180) // 6) + 1
    epsg = (32600 if ref_lat >= 0 else 32700) + zone
    return Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
```

`api/main.py`'s `batch_report()` currently reads (this is the full current function body):

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
            error_type = error_message = None
            if sol is not None:
                summary = sol.get("summary", {})
                fix_rate = summary.get("fix_rate_pct")
                sdn = summary.get("rms_sdn")
                sde = summary.get("rms_sde")
                sdu = summary.get("rms_sdu")
                if fix_rate is not None:
                    fix_rates.append(fix_rate)
            if st == "failed":
                err = jobstore.read_error(jid)
                if err is not None:
                    error_type = err.type
                    error_message = err.message
            entries.append(BatchReportEntry(
                job_id=jid, config_idx=j["config_idx"], config=cfg, status=st,
                fix_rate_pct=fix_rate, rms_sdn=sdn, rms_sde=sde, rms_sdu=sdu,
                error_type=error_type, error_message=error_message,
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

Replace it with:

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
        positions = []  # (entry_index, lat, lon)
        for j in b["jobs"]:
            jid = j["job_id"]
            st = _status(jid)
            sol = jobstore.read_solution(jid) if st == "finished" else None
            cfg = jobstore.read_config(jid).model_dump(mode="json")
            fix_rate = sdn = sde = sdu = mean_h = mean_lat = mean_lon = None
            error_type = error_message = None
            if sol is not None:
                summary = sol.get("summary", {})
                fix_rate = summary.get("fix_rate_pct")
                sdn = summary.get("rms_sdn")
                sde = summary.get("rms_sde")
                sdu = summary.get("rms_sdu")
                mean_lat = summary.get("mean_lat")
                mean_lon = summary.get("mean_lon")
                mean_h = summary.get("mean_h")
                if fix_rate is not None:
                    fix_rates.append(fix_rate)
            if st == "failed":
                err = jobstore.read_error(jid)
                if err is not None:
                    error_type = err.type
                    error_message = err.message
            entries.append(BatchReportEntry(
                job_id=jid, config_idx=j["config_idx"], config=cfg, status=st,
                fix_rate_pct=fix_rate, rms_sdn=sdn, rms_sde=sde, rms_sdu=sdu,
                mean_h=mean_h, error_type=error_type, error_message=error_message,
            ))
            if mean_lat is not None and mean_lon is not None:
                positions.append((len(entries) - 1, mean_lat, mean_lon))

        if positions:
            ref_lat = statistics.mean(p[1] for p in positions)
            ref_lon = statistics.mean(p[2] for p in positions)
            transformer = _utm_transformer(ref_lat, ref_lon)
            for idx, lat, lon in positions:
                e, n = transformer.transform(lon, lat)
                entries[idx] = entries[idx].model_copy(update={"utm_e": e, "utm_n": n})

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

Note the UTM patch loop runs **before** `entries.sort(...)` — the `positions` list stores indices into `entries` captured during the build loop, which would be invalidated if sorting happened first.

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_main.py -k "utm" -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Run the full API test suite for regressions**

Run: `python -m pytest tests/api/ -v`
Expected: PASS, no regressions (existing batch-report tests never set `mean_lat`/`mean_lon` in their fixtures, so `positions` stays empty for them — `utm_e`/`utm_n` stay `None`, matching their existing assertions which don't check those fields).

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml api/schemas.py api/main.py tests/api/test_main.py
git commit -m "feat(api): convert per-job mean position to UTM E/N in batch report"
```

---

### Task 3: Web — swap distribution grid to coordinate tiles

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/components/charts/DistributionGrid.tsx`
- Modify: `web/src/components/charts/DistributionGrid.test.tsx`
- Modify: `web/src/pages/BatchDetail.test.tsx`

**Interfaces:**
- Consumes: `BatchReportEntry.utm_e: number | null`, `.utm_n: number | null`, `.mean_h: number | null` from Task 2's API response.
- No change to `DistributionGrid`'s own exported signature (`DistributionGrid({ results }: { results: BatchReportEntry[] })`) or to `PlotlyChart`/`distributionData` — only the `METRICS` array's field selection changes.

**Why `BatchDetail.test.tsx` is in scope despite the "RMS column is out of scope" constraint:** that constraint is about the visible RMS N/E/U *table column* (unaffected). But `BatchDetail.test.tsx` separately builds 3 object literals typed as `BatchReportEntry` (fixtures for `getBatchReport`), and once the interface below gains 3 new non-optional fields, TypeScript requires every such literal to include them — this is a compilation concern, not a feature-scope one. Two of those fixtures (`j-best`, `j-worse`) also feed the *existing* distribution-grid plot-count assertions (`toHaveLength(4)` / `toHaveLength(8)` at lines 68/73) — if their new coordinate fields were left `null`, 3 of the 4 tiles would render "no data" instead of a mocked `PlotlyChart`, silently dropping the count to 1/2 instead of 4/8. They must get real numeric values, not just type-satisfying nulls.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `web/src/components/charts/DistributionGrid.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-plotly.js", () => ({
  default: ({ data }: any) => <div data-testid="plot">{data[0]?.x?.length ?? 0} values</div>,
}));

import { DistributionGrid } from "./DistributionGrid";
import type { BatchReportEntry } from "../../api/types";

function entry(overrides: Partial<BatchReportEntry>): BatchReportEntry {
  return {
    job_id: "j", config_idx: 0, config: {}, status: "finished",
    fix_rate_pct: 90, utm_e: 500000, utm_n: 3500000, mean_h: 50,
    error_type: null, error_message: null,
    ...overrides,
  };
}

describe("DistributionGrid", () => {
  it("renders 4 histograms with only successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: 90, utm_e: 500000 }),
      entry({ job_id: "j2", fix_rate_pct: 80, utm_e: 500010 }),
      entry({ job_id: "j3", status: "failed", fix_rate_pct: null, utm_e: null, utm_n: null, mean_h: null }),
    ];
    render(<DistributionGrid results={results} />);
    const plots = screen.getAllByTestId("plot");
    expect(plots).toHaveLength(4);
    expect(plots[0]).toHaveTextContent("2 values"); // fix rate: 2 successful jobs
  });

  it("shows a header with the metric name above each chart", () => {
    const results: BatchReportEntry[] = [entry({ job_id: "j1" })];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/^fix rate \(%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^easting \(m\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^northing \(m\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^height \(m\)/i)).toBeInTheDocument();
  });

  it("shows the mean and std dev of each metric's values next to its header", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: 80, utm_e: 500000 }),
      entry({ job_id: "j2", fix_rate_pct: 100, utm_e: 500020 }),
    ];
    render(<DistributionGrid results={results} />);
    // fix_rate_pct: [80, 100] -> mean 90, population std = 10
    expect(screen.getByText(/^fix rate \(%\) · μ 90\.0 · σ 10\.0$/i)).toBeInTheDocument();
    // utm_e: [500000, 500020] -> mean 500010, population std = 10
    expect(screen.getByText(/^easting \(m\) · μ 500010\.000 · σ 10\.000$/i)).toBeInTheDocument();
  });

  it("omits the mean/std dev suffix for a metric with zero successful values", () => {
    const results: BatchReportEntry[] = [entry({ job_id: "j1", fix_rate_pct: null })];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/^fix rate \(%\)$/i)).toBeInTheDocument();
  });

  it("shows 'no data' for a metric with zero successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: null }),
    ];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders nothing when there are zero successful jobs", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", status: "failed", fix_rate_pct: null, utm_e: null, utm_n: null, mean_h: null }),
    ];
    const { container } = render(<DistributionGrid results={results} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/charts/DistributionGrid.test.tsx`
Expected: FAIL — TypeScript error / test failures, since `BatchReportEntry` has no `utm_e`/`utm_n`/`mean_h` fields yet and `DistributionGrid`'s `METRICS` still reads `rms_sdn`/`rms_sde`/`rms_sdu`.

- [ ] **Step 3: Add the new fields to the `BatchReportEntry` type**

In `web/src/api/types.ts`, `BatchReportEntry` currently reads:

```ts
export interface BatchReportEntry {
  job_id: string;
  config_idx: number;
  config: Record<string, unknown>;
  status: string;
  fix_rate_pct: number | null;
  rms_sdn: number | null;
  rms_sde: number | null;
  rms_sdu: number | null;
  error_type: string | null;
  error_message: string | null;
}
```

Change it to:

```ts
export interface BatchReportEntry {
  job_id: string;
  config_idx: number;
  config: Record<string, unknown>;
  status: string;
  fix_rate_pct: number | null;
  rms_sdn: number | null;
  rms_sde: number | null;
  rms_sdu: number | null;
  utm_e: number | null;
  utm_n: number | null;
  mean_h: number | null;
  error_type: string | null;
  error_message: string | null;
}
```

- [ ] **Step 4: Swap the `METRICS` array in `DistributionGrid.tsx`**

In `web/src/components/charts/DistributionGrid.tsx`, change:

```ts
const METRICS: { key: keyof BatchReportEntry; title: string; color: string; decimals: number }[] = [
  { key: "fix_rate_pct", title: "fix rate (%)", color: "#38bdf8", decimals: 1 },
  { key: "rms_sdn", title: "RMS N (m)", color: "#16a34a", decimals: 3 },
  { key: "rms_sde", title: "RMS E (m)", color: "#eab308", decimals: 3 },
  { key: "rms_sdu", title: "RMS U (m)", color: "#2563eb", decimals: 3 },
];
```

to:

```ts
const METRICS: { key: keyof BatchReportEntry; title: string; color: string; decimals: number }[] = [
  { key: "fix_rate_pct", title: "fix rate (%)", color: "#38bdf8", decimals: 1 },
  { key: "utm_e", title: "easting (m)", color: "#16a34a", decimals: 3 },
  { key: "utm_n", title: "northing (m)", color: "#eab308", decimals: 3 },
  { key: "mean_h", title: "height (m)", color: "#2563eb", decimals: 3 },
];
```

Nothing else in the file changes — the rest of `DistributionGrid` (filtering, `mean`/`stdDev`, the "no data" placeholder, the all-empty `null` return) is already generic over whatever `METRICS` lists.

- [ ] **Step 5: Add the new fields to `BatchDetail.test.tsx`'s fixtures**

In `web/src/pages/BatchDetail.test.tsx`, the `j-best` entry (inside `"shows ranked report table once finished"`) currently reads:

```tsx
          {
            job_id: "j-best", config_idx: 1,
            config: { mode: "static", frequency: "l1+l2", ambiguity: "continuous", elev_mask_deg: 15, ar_ratio_min: 3.0 },
            status: "finished", fix_rate_pct: 95, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
            error_type: null, error_message: null,
          },
```

Change its `status:` line to add the 3 new fields with real numeric values (so it keeps producing 4 mocked plots, not "no data" placeholders):

```tsx
            status: "finished", fix_rate_pct: 95, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
            utm_e: 500000, utm_n: 3500000, mean_h: 50,
            error_type: null, error_message: null,
```

The `j-worse` entry right below it currently reads:

```tsx
          {
            job_id: "j-worse", config_idx: 0,
            config: { mode: "kinematic", frequency: "l1", ambiguity: "off", elev_mask_deg: 10, ar_ratio_min: 2.5 },
            status: "finished", fix_rate_pct: 60, rms_sdn: 0.3, rms_sde: 0.3, rms_sdu: 0.4,
            error_type: null, error_message: null,
          },
```

Change its `status:` line the same way:

```tsx
            status: "finished", fix_rate_pct: 60, rms_sdn: 0.3, rms_sde: 0.3, rms_sdu: 0.4,
            utm_e: 500010, utm_n: 3500010, mean_h: 52,
            error_type: null, error_message: null,
```

In the second test (`"shows error type/message inline for a failed row"`), the `j-fail` entry currently reads:

```tsx
          {
            job_id: "j-fail", config_idx: 0, config: {}, status: "failed",
            fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null,
            error_type: "RtklibExecError", error_message: "boom",
          },
```

Change it to add the 3 new fields as `null` (this job is `status: "failed"`, already excluded from the distribution grid regardless):

```tsx
          {
            job_id: "j-fail", config_idx: 0, config: {}, status: "failed",
            fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null,
            utm_e: null, utm_n: null, mean_h: null,
            error_type: "RtklibExecError", error_message: "boom",
          },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/charts/DistributionGrid.test.tsx src/pages/BatchDetail.test.tsx`
Expected: PASS (6 + 3 tests). The `toHaveLength(4)` / `toHaveLength(8)` assertions in `BatchDetail.test.tsx` still hold, since `j-best`/`j-worse` now have real values for all 4 metrics.

- [ ] **Step 7: Run `tsc` and the full web test suite for regressions**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: both PASS, no regressions. `tsc --noEmit` is the check that catches any other `BatchReportEntry` object literal in the codebase this plan didn't anticipate — if it fails on a file not listed above, read that file and add the missing fields the same way (real values if it feeds a plot-count assertion, `null` otherwise); do not guess a fix without seeing the actual error.

- [ ] **Step 8: Commit**

```bash
git add web/src/api/types.ts web/src/components/charts/DistributionGrid.tsx web/src/components/charts/DistributionGrid.test.tsx web/src/pages/BatchDetail.test.tsx
git commit -m "feat(web): plot UTM easting/northing/height instead of RMS in distribution grid"
```
