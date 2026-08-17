# GNSS React Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dockerized React + TypeScript SPA (`web/`) that submits GNSS jobs to the existing API, polls them to completion, and presents each `Solution` on an interactive Leaflet map + Plotly chart suite.

**Architecture:** Vite/React/TS/Tailwind SPA. All `Solution`→plot/geometry transforms live in pure, unit-tested functions in `web/src/lib/`; React components are thin renderers over them (so Plotly/Leaflet are mocked in tests). TanStack Query handles fetching + polling. Served in production by nginx via a multi-stage Docker image, added as a `web` compose service.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Tailwind 3, @tanstack/react-query 5, react-router-dom 6, react-leaflet 4 + leaflet 1.9, react-plotly.js 2 + plotly.js-dist-min, lucide-react, Vitest + @testing-library/react + jsdom.

## Global Constraints

- **Node 20+ / npm.** All frontend files live under `web/`. Do NOT modify `gnss_engine/`, `api/`, or `worker/` — the frontend consumes existing API contracts only.
- **TypeScript strict mode** on. No `any` in committed code except where a third-party type is genuinely missing (annotate with a comment).
- **API contract mirrors** in `web/src/api/types.ts` must match the Pydantic definitions exactly: `ProcessingConfig` (see `gnss_engine/models/config.py`) and `Solution`/`Epoch`/`SatStat`/`DatasetMeta`/`SolutionSummary` (see `gnss_engine/models/result.py`). Enum string values must match verbatim (e.g. `mode: "static"|"kinematic"|"movingbase"|"ppp-static"|"ppp-kinematic"`, `frequency: "l1"|"l1+l2"|"l1+l2+l5"`).
- **API base URL** from `import.meta.env.VITE_API_BASE`, default `"http://localhost:8000"`.
- **Q-code colors (fixed):** Q1 fixed `#16a34a` (green), Q2 float `#eab308` (yellow), Q4 DGPS/SBAS `#2563eb` (blue), Q5 single `#dc2626` (red), other `#6b7280` (gray).
- **Design direction:** dark, instrument-panel aesthetic fitting a scientific GNSS tool. Base surface `#0b0f14`, panel `#111820`, hairline borders `#1e2a36`, text `#e5edf5`/muted `#8ba0b3`, accent `#38bdf8` (cyan). Tabular/monospace numerals (`font-variant-numeric: tabular-nums`) for all metrics. Restrained, dense, legible — not flashy. Consistent 8px spacing scale.
- **Tests** run via `npm test` (`vitest run`) from `web/`. Mock `react-plotly.js` and `react-leaflet` in component tests; test transform logic directly in `lib`. No test hits a real network or a real map tile server.
- **No committed `node_modules/`, `dist/`, or `.env`.**
- **TDD:** failing test first where a unit is logic-bearing (lib, client, form serialization). Pure-presentational components get a render smoke test.

---

### Task 1: Scaffold Vite + React + TS + Tailwind + Vitest

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`
- Create: `web/tailwind.config.js`, `web/postcss.config.js`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`
- Create: `web/.gitignore`, `web/src/setupTests.ts`
- Create: `web/src/lib/quality.test.ts` placeholder? No — smoke test below.
- Create: `web/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable Vite app; `npm test`, `npm run build`, `npm run dev` scripts; Tailwind wired; Vitest+jsdom configured. `App` renders a shell with the app title.

- [ ] **Step 1: Write the failing test**

`web/src/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("build smoke", () => {
  it("adds", () => {
    expect(1 + 1).toBe(2);
  });
});
```
(This first test only proves the Vitest toolchain runs; real tests arrive with each feature.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm install` then `npm test`
Expected: FAIL first because dependencies/config are absent (`vitest: command not found` or missing config).

- [ ] **Step 3: Write minimal implementation**

`web/package.json`:
```json
{
  "name": "gnss-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.51.0",
    "leaflet": "^1.9.4",
    "lucide-react": "^0.427.0",
    "plotly.js-dist-min": "^2.34.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-leaflet": "^4.2.1",
    "react-plotly.js": "^2.6.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/leaflet": "^1.9.12",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/react-plotly.js": "^2.6.3",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.1",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.7",
    "typescript": "^5.5.4",
    "vite": "^5.3.5",
    "vitest": "^2.0.5"
  }
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
  },
} as any);
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

`web/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0b0f14",
        panel: "#111820",
        hair: "#1e2a36",
        ink: "#e5edf5",
        muted: "#8ba0b3",
        accent: "#38bdf8",
      },
    },
  },
  plugins: [],
};
```

`web/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`web/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GNSS Solver</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
body { @apply bg-base text-ink; margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
.tnum { font-variant-numeric: tabular-nums; }
```

`web/src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="border-b border-hair px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          GNSS <span className="text-accent">Solver</span>
        </h1>
      </header>
      <main className="p-6">Ready.</main>
    </div>
  );
}
```

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`web/src/setupTests.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

`web/.gitignore`:
```
node_modules/
dist/
*.local
.env
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm install && npm test`
Expected: PASS (1 test). Also `npm run build` should succeed.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/tsconfig.node.json web/tailwind.config.js web/postcss.config.js web/index.html web/src/main.tsx web/src/App.tsx web/src/index.css web/src/setupTests.ts web/src/smoke.test.ts web/.gitignore
git commit -m "feat(web): scaffold vite react ts tailwind vitest"
```

---

### Task 2: API types + client

**Files:**
- Create: `web/src/api/types.ts`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: TS types mirroring the API contracts, and a `client` with `listJobs()`, `getJob(id)`, `getResult(id)`, `createJob(form)`, `health()`. `apiBase()` reads `import.meta.env.VITE_API_BASE` with the localhost default.

- [ ] **Step 1: Write the failing test**

`web/src/api/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { client, ApiError } from "./client";

const okJson = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("listJobs GETs /jobs and returns parsed array", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson([{ job_id: "a", status: "finished" }]));
    const jobs = await client.listJobs();
    expect(jobs[0].job_id).toBe("a");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/jobs$/);
  });

  it("createJob POSTs FormData to /jobs", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ job_id: "x", status: "queued" }, 201));
    const fd = new FormData();
    const res = await client.createJob(fd);
    expect(res.job_id).toBe("x");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws ApiError with parsed detail on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ detail: "invalid config" }, 422));
    await expect(client.getResult("nope")).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/api/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write minimal implementation**

`web/src/api/types.ts`:
```ts
export type PositioningMode = "static" | "kinematic" | "movingbase" | "ppp-static" | "ppp-kinematic";
export type Constellation = "GPS" | "GLO" | "GAL" | "BDS" | "QZSS" | "SBAS";
export type Frequency = "l1" | "l1+l2" | "l1+l2+l5";
export type TropoModel = "off" | "saastamoinen" | "sbas" | "estimate-ztd" | "estimate-ztd-grad";
export type IonoModel = "off" | "broadcast" | "sbas" | "iono-free-lc" | "estimate-stec" | "ionex";
export type AmbiguityMode = "off" | "continuous" | "instantaneous" | "fix-and-hold";
export type EphemerisSource = "broadcast" | "precise";
export type BaseCoordMode = "known-llh" | "known-xyz" | "single";

export interface ProcessingConfig {
  mode: PositioningMode;
  constellations: Constellation[];
  frequency: Frequency;
  elev_mask_deg: number;
  snr_mask_dbhz: number;
  tropo: TropoModel;
  iono: IonoModel;
  ambiguity: AmbiguityMode;
  ar_ratio_min: number;
  ar_min_lock: number;
  ar_min_elev_deg: number;
  ephemeris: EphemerisSource;
  base_coord_mode: BaseCoordMode;
  base_coord: [number, number, number] | null;
}

export interface Epoch {
  t: string; lat: number; lon: number; h: number; q: number; ns: number;
  sdn: number; sde: number; sdu: number; sdne: number; age: number; ratio: number;
  x: number | null; y: number | null; z: number | null;
}
export interface SatStat {
  t: string; sat: string; az: number; el: number; snr: number;
  res_p: number; res_c: number; slip: boolean; fix: number;
}
export interface DatasetMeta {
  rinex_version: string; file_type: string; interval_s: number | null;
  t_start: string | null; t_end: string | null; span_s: number | null;
  receiver: string | null; antenna: string | null; rover_id: string | null; base_id: string | null;
}
export interface SolutionSummary {
  n_epochs: number; n_fix: number; n_float: number; n_single: number; fix_rate_pct: number;
  mean_sdn: number; mean_sde: number; mean_sdu: number; rms_sdn: number; rms_sde: number; rms_sdu: number;
}
export interface Solution {
  meta: DatasetMeta; config_used: Record<string, unknown>;
  epochs: Epoch[]; sat_stats: SatStat[]; summary: SolutionSummary; engine_log: string;
}

export type JobStatusValue = "queued" | "started" | "finished" | "failed" | "not_found";
export interface JobCreated { job_id: string; status: string; }
export interface JobListItem { job_id: string; status: string; }
export interface ErrorInfo { type: string; message: string; workdir: string | null; }
export interface JobStatus { job_id: string; status: JobStatusValue; error: ErrorInfo | null; }

export const DEFAULT_CONFIG: ProcessingConfig = {
  mode: "static", constellations: ["GPS"], frequency: "l1+l2",
  elev_mask_deg: 15, snr_mask_dbhz: 35, tropo: "saastamoinen", iono: "broadcast",
  ambiguity: "continuous", ar_ratio_min: 3, ar_min_lock: 0, ar_min_elev_deg: 0,
  ephemeris: "broadcast", base_coord_mode: "single", base_coord: null,
};
```

`web/src/api/client.ts`:
```ts
import type { JobCreated, JobListItem, JobStatus, Solution } from "./types";

export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? body);
  return body as T;
}

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
  async health(): Promise<{ status: string; redis: boolean }> {
    return parse(await fetch(`${apiBase()}/health`));
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/api/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/
git commit -m "feat(web): typed API client and contract types"
```

---

### Task 3: lib/quality + lib/geodesy (pure functions)

**Files:**
- Create: `web/src/lib/quality.ts`
- Create: `web/src/lib/geodesy.ts`
- Create: `web/src/lib/quality.test.ts`
- Create: `web/src/lib/geodesy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `quality.ts`: `qLabel(q: number): string`, `qColor(q: number): string` (colors per Global Constraints).
  - `geodesy.ts`: `llhToEnu(lat, lon, h, ref): {e,n,u}` (local tangent-plane meters relative to a reference LLH), `meanLatLon(epochs): {lat,lon}`, `covEllipse(sdn, sde, sdne, sigmaScale=1, points=48): Array<[dn, de]>` returning offsets in meters (north, east) tracing the error ellipse.

- [ ] **Step 1: Write the failing test**

`web/src/lib/quality.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { qLabel, qColor } from "./quality";

describe("quality", () => {
  it("labels", () => {
    expect(qLabel(1)).toMatch(/fix/i);
    expect(qLabel(2)).toMatch(/float/i);
    expect(qLabel(5)).toMatch(/single/i);
  });
  it("colors distinct per bucket", () => {
    const cs = new Set([qColor(1), qColor(2), qColor(4), qColor(5)]);
    expect(cs.size).toBe(4);
    expect(qColor(1)).toBe("#16a34a");
  });
});
```

`web/src/lib/geodesy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { llhToEnu, covEllipse } from "./geodesy";

describe("geodesy", () => {
  it("zero offset at reference", () => {
    const p = llhToEnu(32, 34, 100, { lat: 32, lon: 34, h: 100 });
    expect(Math.abs(p.e)).toBeLessThan(1e-6);
    expect(Math.abs(p.n)).toBeLessThan(1e-6);
  });
  it("east offset is positive for larger lon", () => {
    const p = llhToEnu(32, 34.001, 100, { lat: 32, lon: 34, h: 100 });
    expect(p.e).toBeGreaterThan(0);
    expect(Math.abs(p.n)).toBeLessThan(1); // ~same latitude
  });
  it("covEllipse returns closed ring of requested size", () => {
    const ring = covEllipse(0.01, 0.02, 0, 1, 32);
    expect(ring.length).toBe(32);
    // diagonal cov: east semi-axis (0.02) larger than north (0.01)
    const maxE = Math.max(...ring.map(([, de]) => Math.abs(de)));
    const maxN = Math.max(...ring.map(([dn]) => Math.abs(dn)));
    expect(maxE).toBeGreaterThan(maxN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/lib`
Expected: FAIL — cannot resolve `./quality` / `./geodesy`.

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/quality.ts`:
```ts
const LABELS: Record<number, string> = { 1: "Fixed", 2: "Float", 4: "DGPS/SBAS", 5: "Single" };
const COLORS: Record<number, string> = { 1: "#16a34a", 2: "#eab308", 4: "#2563eb", 5: "#dc2626" };

export function qLabel(q: number): string {
  return LABELS[q] ?? `Q${q}`;
}
export function qColor(q: number): string {
  return COLORS[q] ?? "#6b7280";
}
```

`web/src/lib/geodesy.ts`:
```ts
export interface Llh { lat: number; lon: number; h: number; }

const A = 6378137.0; // WGS84 semi-major
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const D2R = Math.PI / 180;

// Local tangent-plane ENU (meters) of a point relative to a reference LLH.
export function llhToEnu(lat: number, lon: number, _h: number, ref: Llh): { e: number; n: number; u: number } {
  const rlat = ref.lat * D2R;
  const sinLat = Math.sin(rlat);
  const rN = A / Math.sqrt(1 - E2 * sinLat * sinLat); // prime vertical radius
  const rM = (A * (1 - E2)) / Math.pow(1 - E2 * sinLat * sinLat, 1.5); // meridian radius
  const dLat = (lat - ref.lat) * D2R;
  const dLon = (lon - ref.lon) * D2R;
  const n = dLat * rM;
  const e = dLon * (rN * Math.cos(rlat));
  return { e, n, u: 0 };
}

export function meanLatLon(pts: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  if (pts.length === 0) return { lat: 0, lon: 0 };
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

// Error-ellipse offsets (north, east) in meters from a 2x2 covariance built from
// standard deviations sdn, sde and the cross term sdne (RTKLIB convention: signed
// sqrt of the covariance, so cov_ne = sign * sdne^2).
export function covEllipse(sdn: number, sde: number, sdne: number, sigmaScale = 1, points = 48): Array<[number, number]> {
  const cnn = sdn * sdn;
  const cee = sde * sde;
  const cne = Math.sign(sdne) * sdne * sdne;
  // eigen-decomposition of [[cnn, cne],[cne, cee]]
  const tr = cnn + cee;
  const det = cnn * cee - cne * cne;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const a = sigmaScale * Math.sqrt(Math.max(0, l1));
  const b = sigmaScale * Math.sqrt(Math.max(0, l2));
  // orientation: angle of major eigenvector (north-east plane)
  const theta = 0.5 * Math.atan2(2 * cne, cnn - cee);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < points; i++) {
    const t = (2 * Math.PI * i) / points;
    const x = a * Math.cos(t); // along major axis
    const y = b * Math.sin(t); // along minor axis
    const dn = x * cos - y * sin;
    const de = x * sin + y * cos;
    ring.push([dn, de]);
  }
  return ring;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/lib`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/
git commit -m "feat(web): quality colors and geodesy helpers"
```

---

### Task 4: App shell, router, providers, StatusBadge, JobsList

**Files:**
- Modify: `web/src/main.tsx` (add Router + QueryClientProvider)
- Modify: `web/src/App.tsx` (nav shell + `<Routes>`)
- Create: `web/src/components/StatusBadge.tsx`
- Create: `web/src/pages/JobsList.tsx`
- Create: `web/src/pages/NewJob.tsx` (stub — replaced in Task 5)
- Create: `web/src/pages/JobDetail.tsx` (stub — replaced in Task 8)
- Create: `web/src/components/StatusBadge.test.tsx`
- Create: `web/src/pages/JobsList.test.tsx`

**Interfaces:**
- Consumes: `client` (Task 2).
- Produces: `StatusBadge({ status })` colored pill; `JobsList` page listing jobs from `client.listJobs()` via React Query; routes `/`, `/new`, `/jobs/:id`. Stubs for NewJob/JobDetail so routing compiles.

- [ ] **Step 1: Write the failing test**

`web/src/components/StatusBadge.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders each status label", () => {
    for (const s of ["queued", "started", "finished", "failed"]) {
      const { unmount } = render(<StatusBadge status={s} />);
      expect(screen.getByText(new RegExp(s, "i"))).toBeInTheDocument();
      unmount();
    }
  });
});
```

`web/src/pages/JobsList.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { JobsList } from "./JobsList";
import { client } from "../api/client";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("JobsList", () => {
  it("lists jobs from the API", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/components/StatusBadge.test.tsx src/pages/JobsList.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`web/src/components/StatusBadge.tsx`:
```tsx
const STYLES: Record<string, string> = {
  queued: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  started: "bg-accent/20 text-accent border-accent/40",
  finished: "bg-green-600/20 text-green-400 border-green-500/40",
  failed: "bg-red-600/20 text-red-400 border-red-500/40",
  not_found: "bg-slate-700/30 text-slate-400 border-slate-600/40",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.not_found;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
```

`web/src/pages/JobsList.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function JobsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => client.listJobs(),
    refetchInterval: 5000,
  });

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
        {(data ?? []).map((j) => (
          <Link key={j.job_id} to={`/jobs/${j.job_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-white/5">
            <span className="tnum text-sm text-ink">{j.job_id}</span>
            <StatusBadge status={j.status} />
          </Link>
        ))}
        {data && data.length === 0 && <p className="px-4 py-6 text-center text-muted">No jobs yet.</p>}
      </div>
    </div>
  );
}
```

`web/src/pages/NewJob.tsx` (temporary stub):
```tsx
export function NewJob() {
  return <div className="text-muted">New job form (coming next).</div>;
}
```

`web/src/pages/JobDetail.tsx` (temporary stub):
```tsx
import { useParams } from "react-router-dom";
export function JobDetail() {
  const { id } = useParams();
  return <div className="text-muted">Job {id} (detail coming).</div>;
}
```

`web/src/App.tsx` (replace):
```tsx
import { Link, Route, Routes } from "react-router-dom";
import { JobsList } from "./pages/JobsList";
import { NewJob } from "./pages/NewJob";
import { JobDetail } from "./pages/JobDetail";

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
        </Routes>
      </main>
    </div>
  );
}
```

`web/src/main.tsx` (replace):
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/components/StatusBadge.test.tsx src/pages/JobsList.test.tsx`
Expected: PASS (2 tests). Full `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/main.tsx web/src/components/StatusBadge.tsx web/src/components/StatusBadge.test.tsx web/src/pages/
git commit -m "feat(web): app shell, router, jobs list, status badge"
```

---

### Task 5: ConfigForm + FileUploads + NewJob submission

**Files:**
- Create: `web/src/components/FileUploads.tsx`
- Create: `web/src/components/ConfigForm.tsx`
- Modify: `web/src/pages/NewJob.tsx` (real form → POST /jobs)
- Create: `web/src/lib/buildJobForm.ts`
- Create: `web/src/lib/buildJobForm.test.ts`

**Interfaces:**
- Consumes: `types` (Task 2), `client` (Task 2).
- Produces:
  - `buildJobForm(files, config): FormData` — assembles `rover`, optional `base`, repeated `nav`, and `config` (JSON). Pure + tested.
  - `ConfigForm({ value, onChange })` controlled editor for `ProcessingConfig`.
  - `FileUploads({ value, onChange })` for `{ rover, base, nav[] }`.
  - `NewJob` page composing them, calling `client.createJob`, navigating to `/jobs/{id}`.

- [ ] **Step 1: Write the failing test**

`web/src/lib/buildJobForm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildJobForm } from "./buildJobForm";
import { DEFAULT_CONFIG } from "../api/types";

function file(name: string, body = "x") {
  return new File([body], name, { type: "application/octet-stream" });
}

describe("buildJobForm", () => {
  it("packs rover, nav[], config; omits base when absent", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav"), file("b.nav")] }, DEFAULT_CONFIG);
    expect((fd.get("rover") as File).name).toBe("r.obs");
    expect(fd.getAll("nav").length).toBe(2);
    expect(fd.get("base")).toBeNull();
    const cfg = JSON.parse(fd.get("config") as string);
    expect(cfg.mode).toBe("static");
  });

  it("includes base when present and sends base_coord only for known modes", () => {
    const cfg = { ...DEFAULT_CONFIG, base_coord_mode: "known-xyz" as const, base_coord: [1, 2, 3] as [number, number, number] };
    const fd = buildJobForm({ rover: file("r.obs"), base: file("base.obs"), nav: [file("a.nav")] }, cfg);
    expect((fd.get("base") as File).name).toBe("base.obs");
    expect(JSON.parse(fd.get("config") as string).base_coord).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/lib/buildJobForm.test.ts`
Expected: FAIL — cannot resolve `./buildJobForm`.

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/buildJobForm.ts`:
```ts
import type { ProcessingConfig } from "../api/types";

export interface JobFiles {
  rover: File | null;
  base: File | null;
  nav: File[];
}

export function buildJobForm(files: JobFiles, config: ProcessingConfig): FormData {
  const fd = new FormData();
  if (files.rover) fd.append("rover", files.rover);
  if (files.base) fd.append("base", files.base);
  for (const n of files.nav) fd.append("nav", n);
  const cfg: ProcessingConfig = { ...config };
  if (cfg.base_coord_mode === "single") cfg.base_coord = null;
  fd.append("config", JSON.stringify(cfg));
  return fd;
}
```

`web/src/components/FileUploads.tsx`:
```tsx
import type { JobFiles } from "../lib/buildJobForm";

export function FileUploads({ value, onChange }: { value: JobFiles; onChange: (v: JobFiles) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">
        <span className="mb-1 block text-muted">Rover (obs)</span>
        <input type="file" required onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Base (obs, optional)</span>
        <input type="file" onChange={(e) => onChange({ ...value, base: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Navigation (1+)</span>
        <input type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </label>
    </div>
  );
}
```

`web/src/components/ConfigForm.tsx`:
```tsx
import type {
  ProcessingConfig, PositioningMode, Constellation, Frequency, TropoModel,
  IonoModel, AmbiguityMode, EphemerisSource, BaseCoordMode,
} from "../api/types";

const MODES: PositioningMode[] = ["static", "kinematic", "movingbase", "ppp-static", "ppp-kinematic"];
const CONSTS: Constellation[] = ["GPS", "GLO", "GAL", "BDS", "QZSS", "SBAS"];
const FREQS: Frequency[] = ["l1", "l1+l2", "l1+l2+l5"];
const TROPOS: TropoModel[] = ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"];
const IONOS: IonoModel[] = ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"];
const ARS: AmbiguityMode[] = ["off", "continuous", "instantaneous", "fix-and-hold"];
const EPHS: EphemerisSource[] = ["broadcast", "precise"];
const BASEMODES: BaseCoordMode[] = ["single", "known-llh", "known-xyz"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}
const selCls = "w-full rounded-md border border-hair bg-base px-2 py-1.5 text-ink";

export function ConfigForm({ value, onChange }: { value: ProcessingConfig; onChange: (v: ProcessingConfig) => void }) {
  const set = <K extends keyof ProcessingConfig>(k: K, v: ProcessingConfig[K]) => onChange({ ...value, [k]: v });
  const toggleConst = (c: Constellation) =>
    set("constellations", value.constellations.includes(c)
      ? value.constellations.filter((x) => x !== c)
      : [...value.constellations, c]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Positioning mode">
        <select className={selCls} value={value.mode} onChange={(e) => set("mode", e.target.value as PositioningMode)}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Frequency">
        <select className={selCls} value={value.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
          {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-sm text-muted">Constellations</span>
        <div className="flex flex-wrap gap-2">
          {CONSTS.map((c) => (
            <button type="button" key={c} onClick={() => toggleConst(c)}
              className={`rounded-md border px-2.5 py-1 text-xs ${value.constellations.includes(c) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <Field label={`Elevation mask: ${value.elev_mask_deg}°`}>
        <input type="range" min={0} max={90} value={value.elev_mask_deg} onChange={(e) => set("elev_mask_deg", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label={`SNR mask: ${value.snr_mask_dbhz} dBHz`}>
        <input type="range" min={0} max={60} value={value.snr_mask_dbhz} onChange={(e) => set("snr_mask_dbhz", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label="Troposphere">
        <select className={selCls} value={value.tropo} onChange={(e) => set("tropo", e.target.value as TropoModel)}>
          {TROPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Ionosphere">
        <select className={selCls} value={value.iono} onChange={(e) => set("iono", e.target.value as IonoModel)}>
          {IONOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Ambiguity resolution">
        <select className={selCls} value={value.ambiguity} onChange={(e) => set("ambiguity", e.target.value as AmbiguityMode)}>
          {ARS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="AR ratio min">
        <input type="number" step="0.1" className={selCls} value={value.ar_ratio_min} onChange={(e) => set("ar_ratio_min", Number(e.target.value))} />
      </Field>
      <Field label="Ephemeris">
        <select className={selCls} value={value.ephemeris} onChange={(e) => set("ephemeris", e.target.value as EphemerisSource)}>
          {EPHS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Base coordinate mode">
        <select className={selCls} value={value.base_coord_mode}
          onChange={(e) => {
            const m = e.target.value as BaseCoordMode;
            onChange({ ...value, base_coord_mode: m, base_coord: m === "single" ? null : (value.base_coord ?? [0, 0, 0]) });
          }}>
          {BASEMODES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      {value.base_coord_mode !== "single" && (
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {[0, 1, 2].map((i) => (
            <input key={i} type="number" step="any" className={selCls}
              value={value.base_coord?.[i] ?? 0}
              onChange={(e) => {
                const bc = [...(value.base_coord ?? [0, 0, 0])] as [number, number, number];
                bc[i] = Number(e.target.value);
                set("base_coord", bc);
              }} />
          ))}
        </div>
      )}
    </div>
  );
}
```

`web/src/pages/NewJob.tsx` (replace stub):
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_CONFIG, type ProcessingConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { FileUploads } from "../components/FileUploads";
import { ConfigForm } from "../components/ConfigForm";

export function NewJob() {
  const nav = useNavigate();
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = !!files.rover && files.nav.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await client.createJob(buildJobForm(files, config));
      nav(`/jobs/${res.job_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-base font-semibold">New Job</h2>
      <section className="rounded-lg border border-hair bg-panel p-4">
        <FileUploads value={files} onChange={setFiles} />
      </section>
      <section className="rounded-lg border border-hair bg-panel p-4">
        <ConfigForm value={config} onChange={setConfig} />
      </section>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={!canSubmit}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-40">
        {busy ? "Submitting…" : "Submit job"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/lib/buildJobForm.test.ts` then `npm run build`
Expected: PASS (2 tests); build compiles (type-checks the new components).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FileUploads.tsx web/src/components/ConfigForm.tsx web/src/pages/NewJob.tsx web/src/lib/buildJobForm.ts web/src/lib/buildJobForm.test.ts
git commit -m "feat(web): job submission form and config editor"
```

---

### Task 6: TrackMap (Leaflet)

**Files:**
- Create: `web/src/components/TrackMap.tsx`
- Create: `web/src/components/TrackMap.test.tsx`

**Interfaces:**
- Consumes: `types` (Task 2), `quality` + `geodesy` (Task 3).
- Produces: `TrackMap({ solution })` rendering an OSM/Sat/Topo-switchable Leaflet map with rover epochs as Q-colored `CircleMarker`s, a base pin when `base_coord`/base present, and (for static solutions) an error-ellipse `Polygon` from the mean position + covariance.

- [ ] **Step 1: Write the failing test**

`web/src/components/TrackMap.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Solution } from "../api/types";

// Mock react-leaflet with simple divs so jsdom can render without a real map.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile" />,
  CircleMarker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polygon: () => <div data-testid="ellipse" />,
  Popup: ({ children }: any) => <div>{children}</div>,
  LayersControl: Object.assign(({ children }: any) => <div>{children}</div>, { BaseLayer: ({ children }: any) => <div>{children}</div> }),
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

import { TrackMap } from "./TrackMap";

const sol = {
  meta: { rover_id: "R" },
  epochs: [
    { t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null },
    { t: "2023-01-01T00:00:01Z", lat: 32.0001, lon: 34.0001, h: 51, q: 2, ns: 8, sdn: 0.02, sde: 0.02, sdu: 0.04, sdne: 0, age: 0, ratio: 2, x: null, y: null, z: null },
  ],
  sat_stats: [],
  summary: {} as any,
  config_used: { mode: "static" },
} as unknown as Solution;

describe("TrackMap", () => {
  it("renders a marker per epoch", () => {
    render(<TrackMap solution={sol} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getAllByTestId("marker").length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/components/TrackMap.test.tsx`
Expected: FAIL — cannot resolve `./TrackMap`.

- [ ] **Step 3: Write minimal implementation**

`web/src/components/TrackMap.tsx`:
```tsx
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup, LayersControl, Tooltip } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { Solution } from "../api/types";
import { qColor, qLabel } from "../lib/quality";
import { covEllipse, meanLatLon, type Llh } from "../lib/geodesy";

// Convert a north/east meter offset back to lat/lon degrees near a reference.
function offsetToLatLon(ref: Llh, dn: number, de: number): [number, number] {
  const dLat = dn / 111320;
  const dLon = de / (111320 * Math.cos((ref.lat * Math.PI) / 180));
  return [ref.lat + dLat, ref.lon + dLon];
}

export function TrackMap({ solution }: { solution: Solution }) {
  const epochs = solution.epochs;
  const center = meanLatLon(epochs);
  const isStatic = String((solution.config_used as any)?.mode ?? "").startsWith("static") ||
    String((solution.config_used as any)?.mode ?? "").startsWith("ppp-static");

  // error ellipse from the first epoch's covariance around the mean (static case)
  const ell = isStatic && epochs.length
    ? covEllipse(epochs[0].sdn, epochs[0].sde, epochs[0].sdne, 100 /* exaggerate for visibility */)
        .map(([dn, de]) => offsetToLatLon({ lat: center.lat, lon: center.lon, h: 0 }, dn, de) as LatLngExpression)
    : null;

  return (
    <MapContainer center={[center.lat, center.lon] as LatLngExpression} zoom={17} className="h-[420px] w-full rounded-lg">
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OSM">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Topographic">
          <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" />
        </LayersControl.BaseLayer>
      </LayersControl>

      {epochs.map((e, i) => (
        <CircleMarker key={i} center={[e.lat, e.lon] as LatLngExpression} radius={4}
          pathOptions={{ color: qColor(e.q), fillColor: qColor(e.q), fillOpacity: 0.9, weight: 1 }}>
          <Tooltip>{`${e.t} · ${qLabel(e.q)} · ns ${e.ns}`}</Tooltip>
        </CircleMarker>
      ))}

      {ell && <Polygon positions={ell} pathOptions={{ color: "#38bdf8", weight: 1, fillOpacity: 0.08 }} />}

      {solution.meta.base_id && (
        <CircleMarker center={[center.lat, center.lon] as LatLngExpression} radius={6}
          pathOptions={{ color: "#e5edf5", fillColor: "#111820", fillOpacity: 1, weight: 2 }}>
          <Popup>Base: {solution.meta.base_id}</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/components/TrackMap.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TrackMap.tsx web/src/components/TrackMap.test.tsx
git commit -m "feat(web): leaflet track map with quality colors and error ellipse"
```

---

### Task 7: Plotly charts + ChartTabs

**Files:**
- Create: `web/src/lib/chartData.ts`
- Create: `web/src/lib/chartData.test.ts`
- Create: `web/src/components/charts/PlotlyChart.tsx`
- Create: `web/src/components/charts/GroundTrack.tsx`
- Create: `web/src/components/charts/HeightTime.tsx`
- Create: `web/src/components/charts/SatCountTime.tsx`
- Create: `web/src/components/charts/ArRatioTime.tsx`
- Create: `web/src/components/charts/ResidualHist.tsx`
- Create: `web/src/components/charts/SkyPlot.tsx`
- Create: `web/src/components/ChartTabs.tsx`
- Create: `web/src/components/ChartTabs.test.tsx`

**Interfaces:**
- Consumes: `types` (Task 2), `quality` + `geodesy` (Task 3).
- Produces: pure `chartData.ts` builders (tested) returning Plotly `data` arrays from a `Solution`; a shared `PlotlyChart` wrapper (dark theme); six chart components using the builders; `ChartTabs({ solution, arThreshold })` switching between them.

- [ ] **Step 1: Write the failing test**

`web/src/lib/chartData.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groundTrackData, heightTimeData, satCountData, arRatioData, residualData, skyplotData } from "./chartData";
import type { Solution } from "../api/types";

const sol = {
  epochs: [
    { t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null },
    { t: "2023-01-01T00:00:01Z", lat: 32.0001, lon: 34.0001, h: 51, q: 2, ns: 8, sdn: 0.02, sde: 0.02, sdu: 0.04, sdne: 0, age: 0, ratio: 2, x: null, y: null, z: null },
  ],
  sat_stats: [
    { t: "2023-01-01T00:00:00Z", sat: "G01", az: 120, el: 45, snr: 48, res_p: 0.3, res_c: 0.002, slip: false, fix: 1 },
  ],
} as unknown as Solution;

describe("chartData", () => {
  it("groundTrack returns points colored by q", () => {
    const d = groundTrackData(sol);
    expect(d[0].x?.length).toBe(2);
    expect(d[0].mode).toContain("markers");
  });
  it("height/satCount/arRatio series length match epochs", () => {
    expect((heightTimeData(sol)[0].y as number[]).length).toBe(2);
    expect((satCountData(sol)[0].y as number[]).length).toBe(2);
    expect((arRatioData(sol)[0].y as number[]).length).toBe(2);
  });
  it("residual + skyplot derive from sat_stats", () => {
    expect(residualData(sol).length).toBeGreaterThan(0);
    const sky = skyplotData(sol);
    expect((sky[0].r as number[])[0]).toBeCloseTo(45); // 90 - el
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/lib/chartData.test.ts`
Expected: FAIL — cannot resolve `./chartData`.

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/chartData.ts`:
```ts
import type { Data } from "plotly.js-dist-min";
import type { Solution } from "../api/types";
import { qColor } from "./quality";
import { llhToEnu, meanLatLon } from "./geodesy";

export function groundTrackData(sol: Solution): Partial<Data>[] {
  const ref0 = meanLatLon(sol.epochs);
  const ref = { lat: ref0.lat, lon: ref0.lon, h: 0 };
  const x: number[] = [], y: number[] = [], colors: string[] = [];
  for (const e of sol.epochs) {
    const enu = llhToEnu(e.lat, e.lon, e.h, ref);
    x.push(enu.e); y.push(enu.n); colors.push(qColor(e.q));
  }
  return [{ x, y, mode: "markers", type: "scattergl", marker: { size: 5, color: colors } }];
}

export function heightTimeData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.h), mode: "lines+markers", type: "scattergl", line: { color: "#38bdf8" } }];
}

export function satCountData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.ns), mode: "lines", type: "scattergl", line: { shape: "hv", color: "#38bdf8" } }];
}

export function arRatioData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.ratio), mode: "lines", type: "scattergl", line: { color: "#eab308" } }];
}

export function residualData(sol: Solution): Partial<Data>[] {
  return [
    { x: sol.sat_stats.map((s) => s.res_p), type: "histogram", name: "pseudorange", opacity: 0.6, marker: { color: "#38bdf8" } },
    { x: sol.sat_stats.map((s) => s.res_c), type: "histogram", name: "carrier", opacity: 0.6, marker: { color: "#eab308" } },
  ];
}

export function skyplotData(sol: Solution): Partial<Data>[] {
  return [{
    r: sol.sat_stats.map((s) => 90 - s.el),
    theta: sol.sat_stats.map((s) => s.az),
    text: sol.sat_stats.map((s) => s.sat),
    mode: "markers", type: "scatterpolar",
    marker: { size: 7, color: sol.sat_stats.map((s) => s.snr), colorscale: "Viridis", showscale: true, colorbar: { title: "SNR" } },
  }];
}
```

`web/src/components/charts/PlotlyChart.tsx`:
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

export function PlotlyChart({ data, layout }: { data: Partial<Data>[]; layout?: Partial<Layout> }) {
  return (
    <Plot
      data={data as Data[]}
      layout={{ ...DARK, ...layout, autosize: true }}
      useResizeHandler
      style={{ width: "100%", height: "420px" }}
      config={{ displModeBar: false } as any}
    />
  );
}
```

`web/src/components/charts/GroundTrack.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { groundTrackData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function GroundTrack({ solution }: { solution: Solution }) {
  return <PlotlyChart data={groundTrackData(solution)} layout={{ xaxis: { title: "East (m)" }, yaxis: { title: "North (m)", scaleanchor: "x" } }} />;
}
```

`web/src/components/charts/HeightTime.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { heightTimeData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function HeightTime({ solution }: { solution: Solution }) {
  return <PlotlyChart data={heightTimeData(solution)} layout={{ yaxis: { title: "Height (m)" } }} />;
}
```

`web/src/components/charts/SatCountTime.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { satCountData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function SatCountTime({ solution }: { solution: Solution }) {
  return <PlotlyChart data={satCountData(solution)} layout={{ yaxis: { title: "# satellites" } }} />;
}
```

`web/src/components/charts/ArRatioTime.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { arRatioData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function ArRatioTime({ solution, threshold }: { solution: Solution; threshold: number }) {
  const data = arRatioData(solution);
  const xs = solution.epochs.map((e) => e.t);
  const line = xs.length ? [{ x: [xs[0], xs[xs.length - 1]], y: [threshold, threshold], mode: "lines", line: { dash: "dash", color: "#dc2626" }, name: "threshold" }] : [];
  return <PlotlyChart data={[...data, ...(line as any)]} layout={{ yaxis: { title: "AR ratio" } }} />;
}
```

`web/src/components/charts/ResidualHist.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { residualData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function ResidualHist({ solution }: { solution: Solution }) {
  return <PlotlyChart data={residualData(solution)} layout={{ barmode: "overlay", xaxis: { title: "residual (m)" }, yaxis: { title: "count" } }} />;
}
```

`web/src/components/charts/SkyPlot.tsx`:
```tsx
import type { Solution } from "../../api/types";
import { skyplotData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function SkyPlot({ solution }: { solution: Solution }) {
  return <PlotlyChart data={skyplotData(solution)} layout={{ polar: { radialaxis: { range: [0, 90] }, angularaxis: { direction: "clockwise", rotation: 90 } } as any }} />;
}
```

`web/src/components/ChartTabs.tsx`:
```tsx
import { useState } from "react";
import type { Solution } from "../api/types";
import { GroundTrack } from "./charts/GroundTrack";
import { HeightTime } from "./charts/HeightTime";
import { SatCountTime } from "./charts/SatCountTime";
import { ArRatioTime } from "./charts/ArRatioTime";
import { ResidualHist } from "./charts/ResidualHist";
import { SkyPlot } from "./charts/SkyPlot";

const TABS = ["Track", "Height", "Sats", "AR", "Residuals", "Sky"] as const;
type Tab = typeof TABS[number];

export function ChartTabs({ solution, arThreshold }: { solution: Solution; arThreshold: number }) {
  const [tab, setTab] = useState<Tab>("Track");
  return (
    <div className="rounded-lg border border-hair bg-panel p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-xs ${tab === t ? "bg-accent/20 text-accent" : "text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Track" && <GroundTrack solution={solution} />}
      {tab === "Height" && <HeightTime solution={solution} />}
      {tab === "Sats" && <SatCountTime solution={solution} />}
      {tab === "AR" && <ArRatioTime solution={solution} threshold={arThreshold} />}
      {tab === "Residuals" && <ResidualHist solution={solution} />}
      {tab === "Sky" && <SkyPlot solution={solution} />}
    </div>
  );
}
```

`web/src/components/ChartTabs.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Solution } from "../api/types";

vi.mock("react-plotly.js", () => ({ default: ({ data }: any) => <div data-testid="plot">{data.length} traces</div> }));

import { ChartTabs } from "./ChartTabs";

const sol = { epochs: [{ t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null }], sat_stats: [] } as unknown as Solution;

describe("ChartTabs", () => {
  it("switches tabs", async () => {
    render(<ChartTabs solution={sol} arThreshold={3} />);
    expect(screen.getByTestId("plot")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Sky"));
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/lib/chartData.test.ts src/components/ChartTabs.test.tsx`
Expected: PASS (chartData 3 + ChartTabs 1).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/chartData.ts web/src/lib/chartData.test.ts web/src/components/charts/ web/src/components/ChartTabs.tsx web/src/components/ChartTabs.test.tsx
git commit -m "feat(web): plotly chart suite and tabbed panel"
```

---

### Task 8: JobDetail dashboard (polling, summary, placeholders)

**Files:**
- Create: `web/src/components/SummaryTiles.tsx`
- Create: `web/src/components/Placeholder.tsx`
- Modify: `web/src/pages/JobDetail.tsx` (real dashboard)
- Create: `web/src/pages/JobDetail.test.tsx`

**Interfaces:**
- Consumes: `client` (Task 2), `TrackMap` (Task 6), `ChartTabs` (Task 7), `StatusBadge` (Task 4), `types`.
- Produces: `SummaryTiles({ solution })`; `Placeholder({ title, note })`; `JobDetail` page polling status and rendering the dashboard on `finished`, the error on `failed`, a spinner on `queued/started`.

- [ ] **Step 1: Write the failing test**

`web/src/pages/JobDetail.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../components/TrackMap", () => ({ TrackMap: () => <div data-testid="map" /> }));
vi.mock("../components/ChartTabs", () => ({ ChartTabs: () => <div data-testid="charts" /> }));

import { JobDetail } from "./JobDetail";
import { client } from "../api/client";

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/jobs/${id}`]}>
        <Routes><Route path="/jobs/:id" element={<JobDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const solution = {
  meta: { rover_id: "ROVR", rinex_version: "3.04", interval_s: 1, span_s: 30, base_id: null },
  summary: { n_epochs: 2, n_fix: 1, n_float: 1, n_single: 0, fix_rate_pct: 50, mean_sdn: 0.01, mean_sde: 0.01, mean_sdu: 0.02, rms_sdn: 0, rms_sde: 0, rms_sdu: 0 },
  config_used: { mode: "static", ar_ratio_min: 3 },
  epochs: [], sat_stats: [], engine_log: "",
};

describe("JobDetail", () => {
  it("renders summary + dashboard when finished", async () => {
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j1", status: "finished", error: null });
    vi.spyOn(client, "getResult").mockResolvedValue(solution as any);
    wrap("j1");
    await waitFor(() => expect(screen.getByText(/50/)).toBeInTheDocument());
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getByTestId("charts")).toBeInTheDocument();
  });

  it("renders error when failed", async () => {
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j2", status: "failed", error: { type: "ParseError", message: "bad", workdir: null } });
    wrap("j2");
    await waitFor(() => expect(screen.getByText(/ParseError/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- src/pages/JobDetail.test.tsx`
Expected: FAIL — real `JobDetail` not implemented (stub renders neither summary nor error).

- [ ] **Step 3: Write minimal implementation**

`web/src/components/SummaryTiles.tsx`:
```tsx
import type { Solution } from "../api/types";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hair bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="tnum mt-1 text-lg text-ink">{value}</div>
    </div>
  );
}

export function SummaryTiles({ solution }: { solution: Solution }) {
  const s = solution.summary;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Fix rate" value={`${s.fix_rate_pct.toFixed(1)}%`} />
      <Tile label="Epochs" value={`${s.n_epochs}`} />
      <Tile label="σ N/E/U (m)" value={`${s.mean_sdn.toFixed(3)} / ${s.mean_sde.toFixed(3)} / ${s.mean_sdu.toFixed(3)}`} />
      <Tile label="Span" value={solution.meta.span_s != null ? `${solution.meta.span_s}s` : "—"} />
    </div>
  );
}
```

`web/src/components/Placeholder.tsx`:
```tsx
import { Lock } from "lucide-react";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-hair bg-panel/40 px-4 py-3 text-sm">
      <Lock size={16} className="text-muted" />
      <span className="text-ink">{title}</span>
      <span className="text-muted">— {note}</span>
    </div>
  );
}
```

`web/src/pages/JobDetail.tsx` (replace stub):
```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryTiles } from "../components/SummaryTiles";
import { TrackMap } from "../components/TrackMap";
import { ChartTabs } from "../components/ChartTabs";
import { Placeholder } from "../components/Placeholder";

export function JobDetail() {
  const { id = "" } = useParams();
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

  const arThreshold = Number((result.data?.config_used as any)?.ar_ratio_min ?? 3);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="tnum text-base font-semibold">Job {id}</h2>
        {status.data && <StatusBadge status={status.data.status} />}
        {result.data?.meta && (
          <span className="text-sm text-muted">
            {result.data.meta.rover_id} · v{result.data.meta.rinex_version} · {result.data.meta.interval_s ?? "—"}s · {result.data.meta.span_s ?? "—"}s span
          </span>
        )}
      </div>

      {(status.data?.status === "queued" || status.data?.status === "started") && (
        <p className="text-muted">Processing… polling for completion.</p>
      )}

      {status.data?.status === "failed" && status.data.error && (
        <div className="rounded-lg border border-red-500/40 bg-red-600/10 p-4 text-sm">
          <div className="font-medium text-red-400">{status.data.error.type}</div>
          <div className="mt-1 text-ink">{status.data.error.message}</div>
        </div>
      )}

      {finished && result.data && (
        <>
          <SummaryTiles solution={result.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TrackMap solution={result.data} />
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- src/pages/JobDetail.test.tsx`
Expected: PASS (2 tests). Then full `npm test` green and `npm run build` compiles.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SummaryTiles.tsx web/src/components/Placeholder.tsx web/src/pages/JobDetail.tsx web/src/pages/JobDetail.test.tsx
git commit -m "feat(web): job detail dashboard with polling, summary, placeholders"
```

---

### Task 9: Docker image, nginx, compose service, README, config test

**Files:**
- Create: `web/Dockerfile`
- Create: `web/nginx.conf`
- Create: `web/.dockerignore`
- Modify: `docker/docker-compose.yml` (add `web` service)
- Modify: `README.md` (frontend run section)
- Create: `tests/docker/test_web_config.py`

**Interfaces:**
- Consumes: nothing at runtime. The Python validation test reads the files as text.
- Produces: a multi-stage web image (node build → nginx), a `web` compose service on `3000:80`, and a text-validation test.

- [ ] **Step 1: Write the failing test**

`tests/docker/test_web_config.py`:
```python
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "web" / "Dockerfile"
NGINX = ROOT / "web" / "nginx.conf"
COMPOSE = ROOT / "docker" / "docker-compose.yml"


def test_web_dockerfile_multistage():
    text = DOCKERFILE.read_text(encoding="utf-8")
    assert text.count("FROM ") >= 2
    assert "npm run build" in text
    assert "nginx" in text.lower()


def test_nginx_has_spa_fallback():
    text = NGINX.read_text(encoding="utf-8")
    assert "try_files" in text
    assert "index.html" in text


def test_compose_has_web_service():
    text = COMPOSE.read_text(encoding="utf-8")
    assert "web:" in text
    assert "3000:80" in text
    assert "VITE_API_BASE" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/docker/test_web_config.py -v`
Expected: FAIL — web Dockerfile/nginx absent, compose lacks `web`.

- [ ] **Step 3: Write minimal implementation**

`web/Dockerfile`:
```dockerfile
# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---------- serve ----------
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

`web/nginx.conf`:
```
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`web/.dockerignore`:
```
node_modules
dist
.env
*.local
```

Add to `docker/docker-compose.yml` (new service; keep existing `redis`/`api`/`worker`/volume):
```yaml
  web:
    build:
      context: ../web
      dockerfile: Dockerfile
      args:
        VITE_API_BASE: http://localhost:8000
    ports:
      - "3000:80"
    depends_on:
      - api
```

Add to `README.md`:
```markdown
## Web UI

The React frontend is served by the `web` service:

    docker compose -f docker/docker-compose.yml up --build

Open http://localhost:3000 — submit a job (upload rover/nav files, set config),
watch it process, and explore the result on the map + charts. The UI talks to the
API at http://localhost:8000 (set `VITE_API_BASE` build arg to change).

Local frontend dev with hot reload:

    cd web && npm install && npm run dev   # http://localhost:3000
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/docker/test_web_config.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Full verification**

Run: `cd web && npm test` (all web tests green) and `npm run build` (production build succeeds), then `python -m pytest -q` from repo root (backend suite unaffected: prior passes + skips).
Expected: web suite green; backend unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/Dockerfile web/nginx.conf web/.dockerignore docker/docker-compose.yml README.md tests/docker/test_web_config.py
git commit -m "feat(web): dockerized nginx build and compose web service"
```

---

## Self-Review

**1. Spec coverage:**
- Jobs list / submit form / detail dashboard pages → Tasks 4, 5, 8. ✓
- Full ConfigForm → all `ProcessingConfig` fields → Task 5. ✓
- Typed API client mirroring contracts → Task 2. ✓
- Leaflet map: Q-colored track, base pin, error ellipse, basemap switch → Task 6. ✓
- Plotly suite: ground track, height, sat count, AR ratio, residuals, skyplot → Task 7. ✓
- Polling status + failed/finished states → Task 8. ✓
- Honest placeholders (DOP, multi-base/matrix) → Task 8. ✓
- Q-color mapping + geodesy/covariance math (tested) → Task 3. ✓
- Dockerized nginx `web` service on :3000, `VITE_API_BASE` → Task 9. ✓
- Design direction (dark instrument aesthetic, tabular numerals) → Global Constraints + applied in components. ✓
- Deferrals (DOP data, multi-base) correctly placeholders, engine/api untouched. ✓

**2. Placeholder scan:** No TBD/TODO. NewJob/JobDetail intentionally land as stubs in Task 4 and are fully replaced in Tasks 5/8 (explicitly stated, with the real code given there) — not an unfinished-spec placeholder.

**3. Type consistency:** `ProcessingConfig`/`Solution`/`Epoch`/`SatStat` field names in `types.ts` (Task 2) are used unchanged by `lib` (Task 3/7), forms (Task 5), map (Task 6), charts (Task 7), dashboard (Task 8). `client` method names (`listJobs/getJob/getResult/createJob/health`) consistent across Tasks 2/4/5/8. `buildJobForm(files, config)`, `qColor/qLabel`, `llhToEnu/meanLatLon/covEllipse`, `chartData` builder names match between definition and call sites. `JobFiles` shape shared by `buildJobForm` + `FileUploads`.

**Known notes:**
- Plotly config prop uses `displModeBar` spelled as in the code block; if a stricter type complains, cast via `as any` (already done) — cosmetic only.
- `scattergl`/`scatterpolar` trace types require WebGL/polar support present in `plotly.js-dist-min` (they are).
- npm dependency versions are floors (`^`); if the registry serves a newer minor that breaks a type, pin the offending package — does not affect the logic tasks whose tests gate correctness.
