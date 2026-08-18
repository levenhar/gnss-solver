# Batch Result Distribution Window — Design

## Problem

`BatchDetail` (web) runs N randomly-swept `ProcessingConfig`s (see `gnss_engine/sweep.py::random_sweep`) against the *same* base RINEX/nav data. Today the page only shows min/max/mean summary tiles (`StatTile`) per base and overall. Users want to see the actual **distribution** of outcomes across jobs — since all jobs in a base share the same input data, the spread of `fix_rate_pct` and RMS values reveals how sensitive the solution is to config choices for that data.

## Scope

Add histogram-based distribution charts to `BatchDetail.tsx`, both overall (all bases combined) and per-base (inside each base's expandable panel). No backend/API changes — all data (`fix_rate_pct`, `rms_sdn`, `rms_sde`, `rms_sdu`) already exists in `BatchReportEntry`.

## Components

### 1. `PlotlyChart.tsx` — add `height` prop
Currently hardcodes `height: "420px"` in the `style` prop. Add optional `height?: number` prop, default `420`, so smaller grid tiles can render at e.g. 220px without touching existing callers (`ResidualHist`, `HeightTime`, etc., which omit the prop and keep current behavior).

### 2. `lib/chartData.ts` — add `distributionData`
```ts
export function distributionData(values: number[], color: string): Partial<Data>[] {
  return [{ x: values, type: "histogram", marker: { color } }];
}
```
Caller is responsible for filtering out `null`/failed entries before passing `values` in.

### 3. New `components/charts/DistributionGrid.tsx`
```ts
function DistributionGrid({ results }: { results: BatchReportEntry[] })
```
- Filters `results` to successful entries (`status !== "failed"` and metric non-null) per metric independently.
- Renders a 2×2 CSS grid of 4 `PlotlyChart` histograms at `height={220}`:
  - Fix rate (`fix_rate_pct`, x-axis title "fix rate (%)")
  - RMS N (`rms_sdn`, "RMS N (m)")
  - RMS E (`rms_sde`, "RMS E (m)")
  - RMS U (`rms_sdu`, "RMS U (m)")
- Each histogram uses a distinct marker color, consistent with existing chart palette (`#38bdf8`, `#eab308`, etc. from `chartData.ts`).
- If a given metric has 0 successful values, that grid cell renders `"no data"` text instead of an empty chart.
- If **all** metrics are empty (0 successful jobs total), the component renders nothing.

### 4. `BatchDetail.tsx` — two insertion points
- **Overall**: inside the existing "All bases" panel, below the 4 `StatTile`s, add `<DistributionGrid results={report.data.bases.flatMap(b => b.results)} />`.
- **Per-base**: inside each base's `isOpen` block, after the base's 4 `StatTile`s and before the job table, add `<DistributionGrid results={b.results} />`.

## Data flow
Purely client-side derivation from the already-fetched `BatchReport` (`client.getBatchReport(id)`). No new queries, no schema changes.

## Testing
- Extend `BatchDetail.test.tsx` (existing test file) to assert `DistributionGrid` renders when report data has successful jobs, and renders nothing / "no data" cells when a base has zero successful jobs.
- No engine/API tests needed — no backend change.

## Out of scope
- No new backend statistics computation (percentiles, std dev, etc.) — histograms alone satisfy "see the distribution."
- No cross-base comparison overlay — each `DistributionGrid` is scoped to its own result set (overall or single base).
