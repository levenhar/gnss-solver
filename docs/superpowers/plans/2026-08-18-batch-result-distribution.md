# Batch Result Distribution Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add histogram-based distribution charts (fix rate + RMS N/E/U) to the batch results page, shown overall and per-base, so users can see the spread of outcomes across the random config sweep run against the same base data.

**Architecture:** Pure frontend addition. `PlotlyChart` gains an optional `height` prop. A new `distributionData` helper in `lib/chartData.ts` builds a single-trace histogram from a plain number array. A new `DistributionGrid` component filters a `BatchReportEntry[]` down to successful values per metric and renders a 2×2 grid of small histograms. `BatchDetail.tsx` mounts one `DistributionGrid` for the overall report and one per expanded base. No backend or API changes.

**Tech Stack:** React, TypeScript, `react-plotly.js` / `plotly.js-dist-min` (already a dependency), Vitest + Testing Library for tests.

## Global Constraints

- No backend/API changes — all data already exists on `BatchReportEntry` (`web/src/api/types.ts:85-96`).
- Existing `PlotlyChart` callers (`ResidualHist`, `HeightTime`, `SatCountTime`, `ArRatioTime`, `GroundTrack`, `SkyPlot`) must keep rendering at their current 420px height — the new `height` prop must default to `420`.
- Follow existing test pattern: mock `react-plotly.js` with `vi.mock("react-plotly.js", () => ({ default: ({ data }: any) => <div data-testid="plot">{data.length} traces</div> }));` (used in `web/src/components/ChartTabs.test.tsx:6`).
- Color palette: reuse existing hex values already used in `lib/chartData.ts` / `lib/quality.ts` — `#38bdf8` (blue), `#16a34a` (green), `#eab308` (yellow), `#2563eb` (blue-2). Do not introduce new colors.
- Failed/null entries are excluded from histograms (per-metric filtering, independent per metric).

---

### Task 1: `PlotlyChart` — add optional `height` prop

**Files:**
- Modify: `web/src/components/charts/PlotlyChart.tsx`
- Test: `web/src/components/charts/PlotlyChart.test.tsx` (new file)

**Interfaces:**
- Produces: `PlotlyChart({ data, layout, height }: { data: Partial<Data>[]; layout?: Partial<Layout>; height?: number })` — `height` defaults to `420`, used as `style={{ width: "100%", height: \`${height}px\` }}`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/charts/PlotlyChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-plotly.js", () => ({
  default: ({ style }: any) => <div data-testid="plot" style={style} />,
}));

import { PlotlyChart } from "./PlotlyChart";

describe("PlotlyChart", () => {
  it("defaults to 420px height", () => {
    const { getByTestId } = render(<PlotlyChart data={[]} />);
    expect(getByTestId("plot").style.height).toBe("420px");
  });

  it("uses a custom height when provided", () => {
    const { getByTestId } = render(<PlotlyChart data={[]} height={220} />);
    expect(getByTestId("plot").style.height).toBe("220px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/charts/PlotlyChart.test.tsx`
Expected: FAIL — second test expects `220px` but component always renders `420px`.

- [ ] **Step 3: Add the `height` prop**

Replace the full contents of `web/src/components/charts/PlotlyChart.tsx`:

```tsx
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js-dist-min";

const DARK: Partial<Layout> = {
  paper_bgcolor: "#111820",
  plot_bgcolor: "#111820",
  font: { color: "#e5edf5" },
  margin: { l: 48, r: 16, t: 24, b: 40 },
  xaxis: { gridcolor: "#1e2a36", zerolinecolor: "#1e2a36" },
  yaxis: { gridcolor: "#1e2a36", zerolinecolor: "#1e2a36" },
};

export function PlotlyChart({ data, layout, height = 420 }: { data: Partial<Data>[]; layout?: Partial<Layout>; height?: number }) {
  return (
    <Plot
      data={data as Data[]}
      layout={{ ...DARK, ...layout, autosize: true }}
      useResizeHandler
      style={{ width: "100%", height: `${height}px` }}
      config={{ displayModeBar: false } as any}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/charts/PlotlyChart.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/PlotlyChart.tsx web/src/components/charts/PlotlyChart.test.tsx
git commit -m "feat(web): add optional height prop to PlotlyChart"
```

---

### Task 2: `distributionData` helper

**Files:**
- Modify: `web/src/lib/chartData.ts`
- Test: `web/src/lib/chartData.test.ts` (new file — check first whether it already exists and extend instead of overwriting)

**Interfaces:**
- Consumes: nothing new — plain `number[]` input.
- Produces: `distributionData(values: number[], color: string): Partial<Data>[]` — single histogram trace, `{ x: values, type: "histogram", marker: { color } }`.

- [ ] **Step 1: Check for an existing test file**

Run: `cd web && ls src/lib/chartData.test.ts 2>/dev/null || echo "no existing file"`

If it exists, read it first and add the new `describe` block to it instead of overwriting. If not, create it fresh as below.

- [ ] **Step 2: Write the failing test**

Create (or append to) `web/src/lib/chartData.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { distributionData } from "./chartData";

describe("distributionData", () => {
  it("builds a single histogram trace from the values", () => {
    const traces = distributionData([1, 2, 3], "#38bdf8");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ x: [1, 2, 3], type: "histogram", marker: { color: "#38bdf8" } });
  });

  it("handles an empty array", () => {
    const traces = distributionData([], "#38bdf8");
    expect(traces[0].x).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/chartData.test.ts`
Expected: FAIL — `distributionData` is not exported from `./chartData`.

- [ ] **Step 4: Add the function**

Append to `web/src/lib/chartData.ts` (after the existing `skyplotData` function, keep all existing functions unchanged):

```ts
export function distributionData(values: number[], color: string): Partial<Data>[] {
  return [{ x: values, type: "histogram", marker: { color } }];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/chartData.test.ts`
Expected: PASS (2 new tests, plus any pre-existing ones in the file still passing)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/chartData.ts web/src/lib/chartData.test.ts
git commit -m "feat(web): add distributionData histogram helper"
```

---

### Task 3: `DistributionGrid` component

**Files:**
- Create: `web/src/components/charts/DistributionGrid.tsx`
- Test: `web/src/components/charts/DistributionGrid.test.tsx`

**Interfaces:**
- Consumes: `BatchReportEntry` type from `web/src/api/types.ts:85-96` (fields: `status: string`, `fix_rate_pct: number | null`, `rms_sdn: number | null`, `rms_sde: number | null`, `rms_sdu: number | null`); `distributionData(values, color)` from Task 2; `PlotlyChart({ data, layout, height })` from Task 1.
- Produces: `DistributionGrid({ results }: { results: BatchReportEntry[] })` — default export is a named export `DistributionGrid`, mounted in Task 4.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/charts/DistributionGrid.test.tsx`:

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
    fix_rate_pct: 90, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
    error_type: null, error_message: null,
    ...overrides,
  };
}

describe("DistributionGrid", () => {
  it("renders 4 histograms with only successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: 90, rms_sdn: 0.1 }),
      entry({ job_id: "j2", fix_rate_pct: 80, rms_sdn: 0.2 }),
      entry({ job_id: "j3", status: "failed", fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null }),
    ];
    render(<DistributionGrid results={results} />);
    const plots = screen.getAllByTestId("plot");
    expect(plots).toHaveLength(4);
    expect(plots[0]).toHaveTextContent("2 values"); // fix rate: 2 successful jobs
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
      entry({ job_id: "j1", status: "failed", fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null }),
    ];
    const { container } = render(<DistributionGrid results={results} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/charts/DistributionGrid.test.tsx`
Expected: FAIL — `./DistributionGrid` module does not exist.

- [ ] **Step 3: Implement the component**

Create `web/src/components/charts/DistributionGrid.tsx`:

```tsx
import type { BatchReportEntry } from "../../api/types";
import { distributionData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

const METRICS: { key: keyof BatchReportEntry; title: string; color: string }[] = [
  { key: "fix_rate_pct", title: "fix rate (%)", color: "#38bdf8" },
  { key: "rms_sdn", title: "RMS N (m)", color: "#16a34a" },
  { key: "rms_sde", title: "RMS E (m)", color: "#eab308" },
  { key: "rms_sdu", title: "RMS U (m)", color: "#2563eb" },
];

export function DistributionGrid({ results }: { results: BatchReportEntry[] }) {
  const successful = results.filter((r) => r.status !== "failed");
  const byMetric = METRICS.map((m) => ({
    ...m,
    values: successful.map((r) => r[m.key]).filter((v): v is number => typeof v === "number"),
  }));

  if (byMetric.every((m) => m.values.length === 0)) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {byMetric.map((m) => (
        <div key={m.title} className="rounded-md border border-hair p-2">
          {m.values.length ? (
            <PlotlyChart
              data={distributionData(m.values, m.color)}
              layout={{ xaxis: { title: m.title }, yaxis: { title: "count" } }}
              height={220}
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted">no data</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/charts/DistributionGrid.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/DistributionGrid.tsx web/src/components/charts/DistributionGrid.test.tsx
git commit -m "feat(web): add DistributionGrid histogram component"
```

---

### Task 4: Wire `DistributionGrid` into `BatchDetail`

**Files:**
- Modify: `web/src/pages/BatchDetail.tsx`
- Modify: `web/src/pages/BatchDetail.test.tsx`

**Interfaces:**
- Consumes: `DistributionGrid({ results }: { results: BatchReportEntry[] })` from Task 3.

- [ ] **Step 1: Add the mock and a failing test to `BatchDetail.test.tsx`**

In `web/src/pages/BatchDetail.test.tsx`, add the plotly mock at the top (after the existing imports, before `function wrap`):

```tsx
vi.mock("react-plotly.js", () => ({
  default: ({ data }: any) => <div data-testid="plot">{data[0]?.x?.length ?? 0} values</div>,
}));
```

Then extend the `"shows ranked report table once finished"` test (the one using `j-best` / `j-worse`, both `status: "finished"` with non-null metrics) by adding these assertions right after the existing `expect(screen.getByText("All bases")).toBeInTheDocument();` line:

```tsx
    // overall distribution grid: 4 histograms (fix rate + 3 RMS), 2 successful jobs each
    expect(screen.getAllByTestId("plot")).toHaveLength(4);
```

And after the existing `fireEvent.click(screen.getByRole("button", { name: /base-0/ }));` / `await waitFor(...)` block for that same test, add:

```tsx
    // per-base distribution grid adds 4 more histograms (8 total: overall + base-0)
    expect(screen.getAllByTestId("plot")).toHaveLength(8);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: FAIL — no `data-testid="plot"` elements exist yet (`BatchDetail.tsx` doesn't render `DistributionGrid`).

- [ ] **Step 3: Mount `DistributionGrid` in `BatchDetail.tsx`**

In `web/src/pages/BatchDetail.tsx`, add the import (after the existing `import type { BatchBaseReport } from "../api/types";` line):

```tsx
import { DistributionGrid } from "../components/charts/DistributionGrid";
```

Then in the "All bases" panel, add the grid after the existing stat tiles grid (i.e. after the `</div>` that closes the `grid grid-cols-2 gap-3 sm:grid-cols-4` block containing the 4 `StatTile`s at the overall level — `web/src/pages/BatchDetail.tsx:86-91`):

```tsx
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Best fix rate" value={overall.best != null ? `${overall.best.toFixed(1)}%` : "—"} />
              <StatTile label="Worst fix rate" value={overall.worst != null ? `${overall.worst.toFixed(1)}%` : "—"} />
              <StatTile label="Mean fix rate" value={overall.mean != null ? `${overall.mean.toFixed(1)}%` : "—"} />
              <StatTile label="Failed runs" value={String(overall.nFailed)} />
            </div>
            <div className="mt-3">
              <DistributionGrid results={report.data.bases.flatMap((b) => b.results)} />
            </div>
```

And inside the per-base `isOpen` block, add the grid after the per-base stat tiles and before the job table (`web/src/pages/BatchDetail.tsx:107-113`):

```tsx
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Best fix rate" value={b.summary.best_fix_rate_pct != null ? `${b.summary.best_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Worst fix rate" value={b.summary.worst_fix_rate_pct != null ? `${b.summary.worst_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Mean fix rate" value={b.summary.mean_fix_rate_pct != null ? `${b.summary.mean_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Failed runs" value={String(b.summary.n_failed)} />
                </div>
                {isOpen && (
                  <div className="mb-3">
                    <DistributionGrid results={b.results} />
                  </div>
                )}
                {isOpen && (
                  <table className="w-full text-left text-sm">
```

(This keeps the existing `{isOpen && ( <table>...` block exactly as-is — it just gets a new sibling `{isOpen && (...)}` block for the grid immediately before it. Do not duplicate or remove the table block.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: PASS (all 4 tests, including the 2 new assertions)

- [ ] **Step 5: Run the full web test suite**

Run: `cd web && npx vitest run`
Expected: PASS — no regressions in other files (`ChartTabs.test.tsx`, `chartData.test.ts`, `PlotlyChart.test.tsx`, `DistributionGrid.test.tsx`, `BatchDetail.test.tsx`, etc.)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/BatchDetail.tsx web/src/pages/BatchDetail.test.tsx
git commit -m "feat(web): show fix-rate/RMS distribution histograms in batch results"
```
