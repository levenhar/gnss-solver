# Batch Distribution Plots: Coordinates Instead of RMS — Design

## Problem

The batch-result distribution grid (`web/src/components/charts/DistributionGrid.tsx`) currently plots `rms_sdn`/`rms_sde`/`rms_sdu` — the RTKLIB-reported *position uncertainty* (precision) per job, RMS'd over that job's epochs. The user wants the histograms to show each job's actual **computed position** (coordinates) instead, so the spread visualizes how much the estimated position itself varies across the sweep's configs — not how confident each job's solver was in its own estimate.

No coordinate/position summary exists today. `Epoch` (`gnss_engine/models/result.py:8-23`) has per-epoch `lat`/`lon`/`h`, but `SolutionSummary` (`gnss_engine/models/result.py:51-62`) never aggregates them, and `BatchReportEntry` (`api/schemas.py:57-67`) has no position fields at all.

## Scope

Add per-job mean position to the engine summary, convert it to UTM Easting/Northing at report-build time (one shared zone per base, so all jobs in a base plot on the same projected grid), and swap the distribution grid's N/E/U tiles to show Easting/Northing/Height. The fix-rate tile is unchanged. The per-job table's existing "RMS N/E/U" column (`web/src/pages/BatchDetail.tsx:130,153`) is explicitly **out of scope** — it keeps showing solver-reported precision; only the histogram grid changes.

## Design

### 1. Engine: per-job mean position

`gnss_engine/models/result.py` — `SolutionSummary` gains:
```python
mean_lat: float | None = None
mean_lon: float | None = None
mean_h: float | None = None
```

`gnss_engine/parse/summary.py` — `summarize()` computes these as the arithmetic mean of `e.lat`/`e.lon`/`e.h` across the job's epochs, matching the existing `mean_sdn`/`mean_sde`/`mean_sdu` pattern — **except** these three are `None` (not `0.0`) when `epochs` is empty. `0.0, 0.0` is a real point (Gulf of Guinea); treating "no epochs" as "position at the equator/prime-meridian" would poison the batch-wide UTM reference computed in the API layer (a job that produced zero epochs must not silently pull the whole base's reference point toward `(0, 0)`). The other `mean_*`/`rms_*` fields keep their existing `0.0`-on-empty convention — this only changes the three new fields.

### 2. API: UTM conversion, one zone per base

New dependency: `pyproj` (already present in the dev environment but undeclared — add to `pyproject.toml` `dependencies`).

`api/schemas.py` — `BatchReportEntry` gains:
```python
utm_e: float | None = None
utm_n: float | None = None
mean_h: float | None = None
```

`api/main.py` `batch_report()` — currently a single pass per base building `entries` and collecting `fix_rates`. Restructure to:
1. **Pass 1** (unchanged loop, extended): for each job, also read `summary.get("mean_lat")` / `mean_lon` / `mean_h` from the stored solution dict. Build each `BatchReportEntry` with `mean_h` set but `utm_e`/`utm_n` left `None` for now. Separately collect `(entry_index, lat, lon)` for every job whose `mean_lat`/`mean_lon` are both non-`None`.
2. **Reference + zone**: if any positions were collected, average them (`statistics.mean`) into `(ref_lat, ref_lon)`, derive the UTM zone number `int((ref_lon + 180) // 6) + 1` and hemisphere from `ref_lat >= 0`, and build one `pyproj.Transformer` for that zone (`EPSG:4326` → `EPSG:326XX`/`327XX`).
3. **Pass 2**: for each collected `(entry_index, lat, lon)`, transform to `(utm_e, utm_n)` and patch the corresponding entry (`entry.model_copy(update={...})`, since `BatchReportEntry` instances are already built).
4. If a base has zero jobs with position data (e.g. an old batch predating this change, or every job failed before producing epochs), skip the transform entirely — every entry's `utm_e`/`utm_n` stay `None`, and the frontend's existing per-metric null-filtering renders "no data" for those two tiles, same as any other all-null metric today.

Old stored `solution.json` files have no `mean_lat`/`mean_lon`/`mean_h` keys at all (not merely `null`) — `dict.get()` returns `None`, which flows through identically to the empty-epochs case. No migration needed.

### 3. Web: swap the grid's tiles

`web/src/api/types.ts` — `BatchReportEntry` interface gains `utm_e: number | null`, `utm_n: number | null`, `mean_h: number | null` (parallel to the new API fields; existing `rms_sdn/sde/sdu` stay, since the job table still uses them).

`web/src/components/charts/DistributionGrid.tsx` — the `METRICS` array's 3 non-fix-rate entries change from `rms_sdn`/`rms_sde`/`rms_sdu` to `utm_e`/`utm_n`/`mean_h`, titled `"easting (m)"`, `"northing (m)"`, `"height (m)"`. Decimal precision: 3 for all three (meters, matching the old RMS tiles' precision). Everything else in the component (per-metric null filtering, "no data" placeholder, all-empty → render nothing, the μ/σ header line) is generic over whatever `METRICS` lists and needs no changes.

## Testing

- `tests/parse/test_summary.py`: extend to assert `mean_lat`/`mean_lon`/`mean_h` are the arithmetic mean of a fixture with non-constant lat/lon/h, and that they're `None` (not `0.0`) for `summarize([])`.
- `tests/api/test_main.py`: extend the existing batch-report test(s) to write solutions with `mean_lat`/`mean_lon` set, and assert the resulting entries carry non-`None` `utm_e`/`utm_n` consistent with a known UTM zone for the fixture's coordinates; extend/add a case where no job has position data and assert `utm_e`/`utm_n` are `None` throughout (no crash from the empty-positions path).
- `web/src/components/charts/DistributionGrid.test.tsx`: swap the `rms_sdn`/etc. fixtures/assertions to `utm_e`/`utm_n`/`mean_h` field names and the new tile titles.

## Out of scope

- The per-job table's "RMS N/E/U" column in `BatchDetail.tsx` is unchanged.
- No offset-from-reference display (e.g. "how far from the mean, in meters") — tiles show the raw absolute UTM Easting/Northing per job, per the user's explicit ask for "the coordinates" rather than a derived spread metric.
- No handling for batches whose base spans multiple UTM zones (6° of longitude) — not a realistic scenario for a single physical rover/base site, which is what a batch base represents.
