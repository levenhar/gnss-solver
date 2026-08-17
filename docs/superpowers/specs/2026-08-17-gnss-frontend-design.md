# GNSS React Frontend — Design Spec

**Date:** 2026-08-17
**Sub-project:** #3 of 5 (React Frontend SPA)
**Status:** Approved, pending implementation plan

---

## Context

Sub-project 3 of the 5-part GNSS post-processing web app. Sub-projects 1 (`gnss_engine`
library) and 2 (FastAPI + RQ + Redis + Docker API) are complete and merged to `main`. The API
exposes: `POST /jobs` (multipart), `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/result`,
`GET /health`, with CORS open. The locked contracts are `ProcessingConfig` (input) and
`Solution` (output).

This sub-project builds a React SPA so users drive the whole app from a browser: configure and
submit jobs, watch them process, and explore results on an interactive map + scientific charts.

Build order recap: **1 engine (done) → 2 API (done) → 3 frontend (this) → 4 advanced pipeline
→ 5 reporting.**

## Decisions locked during brainstorming

- **Full frontend** (not an MVP) — every control and view the current single-job `Solution`
  supports.
- **Honest gap handling:** two parts of the original brief need data that does not exist yet —
  DOP charts (engine doesn't emit DOP) and multi-base/constellation-matrix comparison (needs
  sub-project 4). These are built as clearly-labeled "available after …" placeholders. **No fake
  data.** Engine and API contracts are untouched.
- **Serving:** multi-stage Docker (node build → nginx static) as a 4th compose service `web` on
  `:3000`. `docker compose up` brings up the whole app. `npm run dev` for local hot-reload.
- **Charts:** Plotly (`react-plotly.js`) — one library covers time-series, scatter, histograms,
  and the polar skyplot.

## Tech stack

React 18 + Vite + TypeScript + Tailwind CSS + Lucide icons + react-leaflet (Leaflet) +
react-plotly.js (Plotly) + TanStack Query (server-state/polling) + React Router. Vitest +
React Testing Library for tests. Folder `web/` at repo root.

## Repository layout (added to the monorepo)

```
web/
  package.json, package-lock.json
  vite.config.ts, tsconfig.json, tsconfig.node.json
  tailwind.config.js, postcss.config.js
  index.html
  Dockerfile              # multi-stage node build -> nginx
  nginx.conf              # SPA fallback to index.html
  .dockerignore
  src/
    main.tsx              # React root, Router + QueryClient providers
    App.tsx               # layout shell + routes
    index.css            # Tailwind directives
    api/
      types.ts           # TS mirrors of ProcessingConfig + Solution + job DTOs
      client.ts          # typed fetch wrapper for the 5 endpoints
    pages/
      JobsList.tsx        # "/" — job table + New Job button
      NewJob.tsx          # "/new" — upload + config form -> POST /jobs
      JobDetail.tsx       # "/jobs/:id" — polling dashboard
    components/
      ConfigForm.tsx      # all ProcessingConfig controls
      FileUploads.tsx     # rover / base / nav[] inputs
      StatusBadge.tsx     # queued/started/finished/failed pill
      SummaryTiles.tsx    # fix rate, epochs, sigma, span
      TrackMap.tsx        # Leaflet map: track by Q, base pins, error ellipse, basemap switch
      charts/
        GroundTrack.tsx   # N vs E scatter, colored by Q
        HeightTime.tsx    # height vs time
        SatCountTime.tsx  # ns vs time
        ArRatioTime.tsx   # ratio vs time + threshold line
        ResidualHist.tsx  # res_p / res_c histograms
        SkyPlot.tsx       # polar az/el, SNR-colored
      ChartTabs.tsx       # tab switcher hosting the chart components
      Placeholder.tsx     # "available after …" panel for gaps
    lib/
      quality.ts          # Q code -> label + color
      geodesy.ts          # LLH -> local ENU; covariance -> ellipse polygon points
```

## Pages & flows

### `/` — Jobs list
`GET /jobs` (React Query, refetch interval ~5s) → table of `{job_id, status}` with a
`StatusBadge`, each row links to `/jobs/{id}`. "New Job" button → `/new`.

### `/new` — Submit form
`FileUploads` (rover required, base optional, nav ≥1) + `ConfigForm` (full `ProcessingConfig`).
On submit, build `FormData` (`rover`, `base?`, repeated `nav`, `config` = JSON string), `POST
/jobs`; on `201` redirect to `/jobs/{job_id}`. Client-side guard: require rover + ≥1 nav before
enabling submit; surface API `422` messages inline.

**ConfigForm controls → ProcessingConfig fields:**
- mode (select, 5 modes) → `mode`
- constellations (toggle group) → `constellations`
- frequency (select) → `frequency`
- elevation mask (slider 0–90) → `elev_mask_deg`
- SNR mask (slider 0–60) → `snr_mask_dbhz`
- troposphere (select) → `tropo`; ionosphere (select) → `iono`
- AR mode (select) → `ambiguity`; ratio (number) → `ar_ratio_min`; min-lock (number) →
  `ar_min_lock`; min-elev (number) → `ar_min_elev_deg`
- ephemeris (select) → `ephemeris`
- base coord mode (select) → `base_coord_mode`; three coord inputs → `base_coord`
  (sent only when mode is known-llh/known-xyz)

### `/jobs/:id` — Detail dashboard
React Query polls `GET /jobs/{id}` every 2s while status ∈ {queued, started}. On `failed`,
render the `ErrorInfo` (type + message). On `finished`, fetch `GET /jobs/{id}/result` → `Solution`
and render the dashboard:

- Header: job id, `StatusBadge`, dataset meta (rover id, rinex version, interval, span).
- `SummaryTiles`: fix rate %, epoch count, mean σN/σE/σU, base id if present.
- `TrackMap` (left/top) + `ChartTabs` (right/bottom).
- `Placeholder` strip: DOP chart, multi-base/matrix — labeled unavailable.

## Map (`TrackMap`)

react-leaflet. Rover epochs rendered as `CircleMarker`s (or short segments) colored by Q via
`quality.ts`: **Q1 fixed = green, Q2 float = yellow, Q4 DGPS/SBAS = blue, Q5 single = red**.
Base station(s) as pin markers with a metadata tooltip. For a static solution, a horizontal
**error ellipse** is drawn as a Leaflet `Polygon` whose vertices come from `geodesy.ts`
(2×2 covariance built from σN, σE, and the σNE cross term → ellipse points), centered on the
mean position — no Leaflet plugin required. Basemap switcher (`LayersControl`): OSM standard,
Esri World Imagery (satellite), OpenTopoMap. Auto-fit bounds to the track.

## Charts (`charts/*`, Plotly)

All derive from the current `Solution` (`epochs[]`, `sat_stats[]`):
- **GroundTrack** — N vs E scatter (local ENU via `geodesy.ts` from mean origin), points colored by Q.
- **HeightTime** — `h` vs `t` line/scatter.
- **SatCountTime** — `ns` vs `t` step line.
- **ArRatioTime** — `ratio` vs `t` with a horizontal line at the config's `ar_ratio_min`.
- **ResidualHist** — overlaid histograms of `sat_stats[].res_p` and `res_c`.
- **SkyPlot** — polar scatter (θ = azimuth, r = 90−elevation), marker color = SNR.

`ChartTabs` hosts them behind tabs (Track / Height / Sats / AR / Residuals / Sky).

## API client (`api/`)

`types.ts` hand-mirrors the Pydantic contracts (kept in sync manually): `ProcessingConfig` with
its enums, and `Solution` (`meta`, `config_used`, `epochs`, `sat_stats`, `summary`), plus
`JobCreated`, `JobStatus`, `ErrorInfo`, `JobListItem`. `client.ts` wraps `fetch` for `listJobs`,
`getJob`, `getResult`, `createJob(formData)`, `health`, reading the base URL from
`import.meta.env.VITE_API_BASE` (default `http://localhost:8000`). Non-2xx responses throw a
typed error carrying the parsed `detail`.

## Docker & compose

`web/Dockerfile` multi-stage: stage 1 `node:20-alpine` runs `npm ci && npm run build` (Vite →
`dist/`); stage 2 `nginx:alpine` serves `dist/` with `nginx.conf` that falls back unknown routes
to `index.html` (SPA routing). `VITE_API_BASE` passed as a build `ARG` (baked into the bundle,
since the browser—not the container—calls the API). `docker-compose.yml` gains a `web` service
building `web/Dockerfile`, `ports: 3000:80`, `build.args.VITE_API_BASE` default
`http://localhost:8000`, `depends_on: [api]`. Result: `docker compose up --build` → UI at
**http://localhost:3000**, talking to the API at `:8000`.

## Testing (Vitest + React Testing Library)

- `api/client` — mocked `fetch`: URL/method/FormData assembly, error parsing.
- `ConfigForm` — filling controls produces the exact `ProcessingConfig` JSON; base_coord omitted
  unless a known-coord mode is chosen.
- `lib/quality` — Q → label/color mapping incl. the Q4/Q5 buckets.
- `lib/geodesy` — LLH→ENU round-trip on a known offset; covariance→ellipse produces the expected
  vertex count and semi-axis orientation on a diagonal covariance.
- Render smoke tests — `StatusBadge` per status; one chart wrapper renders given a small
  `Solution` fixture (Plotly mocked); `Placeholder` shows its label.
- Real-API end-to-end (submit → poll → view) is manual, documented in the README.

## Explicit deferrals

- DOP (PDOP/HDOP/VDOP) chart → placeholder until the engine emits DOP (a future sub-project-1
  extension).
- Multi-base comparison + constellation-matrix views → placeholder until sub-project 4 produces
  that data.
- No changes to `gnss_engine/` or `api/` — the frontend consumes existing contracts only.

## Deliverable of this sub-project

A dockerized React SPA served at `http://localhost:3000` that submits jobs to the API,
polls them to completion, and presents each `Solution` on an interactive Leaflet map (track by
quality, base pins, error ellipse, basemap switch) and a Plotly chart suite (ground track,
height, sat count, AR ratio, residual distribution, skyplot), with honest placeholders for the
two not-yet-available data views. Advanced comparison views and reporting remain later
sub-projects.
