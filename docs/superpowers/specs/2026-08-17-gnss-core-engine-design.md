# GNSS Core Engine — Design Spec

**Date:** 2026-08-17
**Sub-project:** #1 of 5 (Core Engine)
**Status:** Approved, pending implementation plan

---

## Context

Full GNSS post-processing web app decomposed into 5 sub-projects. Each gets its own
spec → plan → build cycle. Build order (spine first):

1. **Core Engine** ← this spec. Pure-Python: RINEX in → parsed solution JSON out.
2. API + async task infra (FastAPI + Redis + worker + Docker).
3. Frontend SPA (config forms + Leaflet map + Plotly charts).
4. Advanced pipeline (multi-base compare, constellation matrix, outlier screening).
5. Reporting (PDF/JSON).

Everything downstream imports the Core Engine. Locking its contracts (`ProcessingConfig`,
`Solution`) early is the point of building it first.

## Decisions locked during brainstorming

- **RTKLIB source:** container-compiled RTKLIB demo5 from source (multi-stage Dockerfile,
  added in sub-project 2). Engine calls `rnx2rtkp` / `CRX2RNX` via subprocess, binaries
  assumed on PATH inside container. Local dev may install RTKLIB demo5 manually.
- **Config generation:** Pydantic model (`ProcessingConfig`) → `.conf` text. Model defaults
  seeded from a bundled demo5 default `.conf` template. Renderer overrides only keys the
  model sets; unset keys keep RTKLIB defaults. This one model is the contract later reused
  verbatim by API and frontend.
- **Output parsing:** parse **both** `.pos` and `.stat` in v1 to lock the output schema once.
- **RINEX input handling:** accept plain RINEX **plus** auto-decompress `.gz`, `.Z`, and
  Hatanaka `.crx` (gunzip + `CRX2RNX`). Receiver-binary via `convbin` deferred.

## Purpose

Pure-Python library. No web, no async, no queue. Single entry point:

```python
solve(rover: Path, nav: list[Path], config: ProcessingConfig, base: Path | None = None) -> Solution
```

RINEX in → runs `rnx2rtkp` → parsed, JSON-serializable `Solution` out.

## Architecture

```
gnss_engine/
  models/
    config.py       # Pydantic ProcessingConfig (the shared contract)
    result.py       # Pydantic Solution, Epoch, SatStat, DatasetMeta, SolutionSummary
  rinex/
    detect.py       # sniff compression + RINEX type
    decompress.py   # .gz/.Z -> plain, .crx -> .rnx (CRX2RNX)
    header.py       # parse header -> DatasetMeta (version, type, interval, span, rx, ant)
    validate.py     # obs+nav present, header sane -> raise RinexValidationError
  conf/
    template.conf   # demo5 default .conf (default-value source)
    render.py       # ProcessingConfig -> .conf text
  run/
    runner.py       # build temp workdir, invoke rnx2rtkp subprocess, capture logs/exit
  parse/
    pos.py          # .pos -> list[Epoch]
    stat.py         # .stat -> list[SatStat]
    summary.py      # epochs + stats -> SolutionSummary
  engine.py         # orchestrator: solve(...) -> Solution
  errors.py         # typed exceptions
```

Each module has one purpose, communicates through the Pydantic models, and is unit-testable
in isolation.

## Data flow

`solve(rover, nav, config, base?)`:

1. `detect` + `decompress` every input (rover, base, nav) to plain RINEX in a temp workdir.
2. `validate` inputs; `header.parse` rover (and base) → `DatasetMeta`.
3. `render` `ProcessingConfig` → `.conf` file in workdir.
4. `runner` invokes `rnx2rtkp` with rover/base/nav/conf, output `.pos` + `.stat`.
   Capture stdout/stderr/exit code.
5. `parse.pos` → `list[Epoch]`; `parse.stat` → `list[SatStat]`.
6. `summary` → `SolutionSummary`.
7. Assemble `Solution{meta, config_used, epochs, sat_stats, summary, engine_log}`.

Temp workdir cleaned on success; retained + path surfaced in exception on failure.

## Key contracts

### `ProcessingConfig` (models/config.py)

Typed fields, enums where RTKLIB has fixed choices:

- `PositioningMode`: `static | kinematic | movingbase | ppp-static | ppp-kinematic`
- `Constellations`: flag set `GPS | GLO | GAL | BDS | QZSS | SBAS` (single or multi)
- `frequencies`: L1 | L1+L2 | L1+L2+L5
- `elev_mask_deg: float`, `snr_mask_dbhz: float`
- `TropoModel`: `off | saastamoinen | sbas | estimate-ztd | estimate-ztd-grad`
- `IonoModel`: `off | broadcast | sbas | iono-free-lc | estimate-stec | ionex`
- `AmbiguityMode`: `off | continuous | instantaneous | fix-and-hold`
- `ar_ratio_min: float`, `ar_min_lock: int`, `ar_min_elev_deg: float`
- `EphemerisSource`: `broadcast | precise` (precise = caller supplies SP3/CLK; auto-download deferred)
- base coordinate mode: `known-llh | known-xyz | single` + optional coord values

Defaults seeded from `template.conf`. `render.py` maps each field to its RTKLIB conf key
and emits only set keys.

### `Solution` (models/result.py)

Fully JSON-serializable (`.model_dump()` → frontend/API payload).

- `Epoch{ t, lat, lon, h, x, y, z, q, ns, sdn, sde, sdu, sdne, age, ratio }`
  - `q`: 1=fix, 2=float, 4=DGPS/SBAS, 5=single (RTKLIB Q codes)
- `SatStat{ t, sat, az, el, snr, res_p, res_c, slip, fix }`
- `DatasetMeta{ rinex_version, file_type, interval_s, t_start, t_end, span_s,
  receiver, antenna, rover_id, base_id }`
- `SolutionSummary{ n_epochs, n_fix, n_float, n_single, fix_rate_pct,
  mean_sdn, mean_sde, mean_sdu, rms_sdn, rms_sde, rms_sdu }`
- `Solution{ meta, config_used, epochs, sat_stats, summary, engine_log }`

## Error handling (errors.py)

Typed exceptions, no silent failure:

- `DecompressError` — decompression tool missing/failed.
- `RinexValidationError` — bad/missing header, no obs or no nav.
- `RtklibExecError` — non-zero exit; carries exit code + captured stderr + workdir path.
- `ParseError` — malformed `.pos`/`.stat`.

## Explicit v1 exclusions (deferred)

- Multi-base, constellation matrix, outlier-exclusion re-run loop → sub-project 4.
- Precise ephemeris (SP3/CLK) **auto-download/association** → later. v1 accepts caller-provided
  nav/SP3/CLK files only.
- `convbin` receiver-binary → RINEX → later.
- Async, queue, API, Docker → sub-project 2.

## Testing (TDD)

- **Unit:**
  - `header.parse` on fixture headers → assert `DatasetMeta` fields.
  - `decompress` on `.gz` and `.crx` fixtures → assert plain output.
  - `render` → golden-file `.conf` comparison per positioning mode.
  - `parse.pos` / `parse.stat` on fixture output files → assert epoch/sat rows.
  - `summary` math (fix rate, RMS) on synthetic epoch lists.
- **Integration:**
  - Bundled small RINEX rover/base/nav fixture → `solve()` → assert fix rate range +
    epoch count. Marked `requires_rtklib`; skipped when binary absent, runs in Docker CI.

## Deliverable of this sub-project

Installable `gnss_engine` package with the module tree above, full unit test suite, one
gated integration test, and the two locked contracts (`ProcessingConfig`, `Solution`) that
sub-projects 2–5 build on.
