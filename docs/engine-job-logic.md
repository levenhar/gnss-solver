# GNSS Job Logic — Engineer Reference

Scope: what `gnss_engine.solve()` actually do, step by step. No API/queue/HTTP — pure pipeline logic. Entry point: `gnss_engine/engine.py:solve()`.

```
solve(rover, nav, config, base=None, workdir=None)
  1. decompress inputs
  2. validate inputs
  3. parse rover header → meta
  4. render RTKLIB conf
  5. run rnx2rtkp (subprocess)
  6. parse .pos → epochs
  7. parse .stat → sat_stats
  8. summarize(epochs) → summary
  9. return Solution
```

If `workdir=None`, solve wrap itself: create tempdir, recurse w/ workdir set, cleanup tempdir on success. On failure tempdir kept (so `RtklibExecError.workdir` point to inspectable files) — caller responsible for cleanup in that case.

## 1. Decompress (`rinex/decompress.py`, `rinex/detect.py`)

`detect_compression(path)` — pure filename sniff, no content read:
- `*.gz` → GZIP
- `*.z`/`*.Z` → UNIX_Z
- `*.crx` or filename matches `\.\d\dd$` (e.g. `.21d`) → HATANAKA
- else → NONE

`decompress_to(path, out_dir)`:
- NONE → return path unchanged (no copy).
- GZIP → python `gzip` module, stream-copy to `out_dir/<stem>`.
- UNIX_Z → shell out to `gzip -dc` (Z format is LZW, python stdlib can't do it — relies on system `gzip` supporting `.Z`).
- HATANAKA → shell out to `CRX2RNX -s <path>`, capture stdout to `out_dir/<stem>.rnx`. Hatanaka = RINEX-specific differential compression for observation files, needs the external `CRX2RNX` binary on PATH.

Failure (missing binary, bad archive) → `DecompressError`.

Applied to rover, every nav file, and base (if present) independently before anything else touches them.

## 2. Validate (`rinex/validate.py`)

Post-decompress, pre-everything-else sanity gate:
- rover file must exist AND pass `is_rinex_obs()`.
- at least 1 nav file required; each must exist (content not checked — nav files not required to be "obs" type).
- base (if given): must exist AND pass `is_rinex_obs()`.

`is_rinex_obs(path)` — read first line only, check `"RINEX VERSION / TYPE"` label present and file-type char at column 21 (0-idx 20) == `"O"`. Cheap header-only check, does not validate full file structure.

Any failure → `RinexValidationError`, job dies before RTKLIB ever runs.

## 3. Parse rover header (`rinex/header.py`)

Fixed-column RINEX header parser (`parse_header`), line-by-line until `END OF HEADER`. Column offsets are RINEX spec positions, not whitespace-split — RINEX header fields are fixed-width.

Extract: `rinex_version`, `file_type` (mapped O/N/G/M → O/N/N/O, i.e. GLONASS nav "G" and mixed "M" folded into N/O), `interval_s`, `t_start`/`t_end` (from `TIME OF FIRST/LAST OBS` records, composed via `_obs_time` which reads Y/M/D/H/M/S fixed columns), `span_s` = `t_end - t_start`, `receiver`, `antenna`, `rover_id` (from `MARKER NAME`).

Only rover header parsed for meta (not base, not nav) — if `base` present, `meta.base_id` separately set from `parse_header(base).rover_id` (i.e. base's own marker name reused as `base_id`).

This is metadata only — does not feed into the actual position solve, purely descriptive (`DatasetMeta`, shown in UI header).

## 4. Render RTKLIB conf (`conf/render.py`, `conf/template.conf`)

`render_conf(config: ProcessingConfig) -> str`:
- load `template.conf` (bundled resource, ini-style `key = value` RTKLIB options file).
- compute `_overrides` dict from `ProcessingConfig` fields (mode, frequency, elev/snr masks, navsys bitmask, tropo/iono opt, sat ephemeris, AR mode/threshold/lock-count/elev-mask, base coord type+values).
- walk template line by line; for any line whose key is in overrides, replace the value (preserve key padding, `key<18 chars> =value`), keep comment lines and non-overridden lines verbatim.
- write result to `workdir/opts.conf`.

`navsys` is a bitmask sum (GPS=1, SBAS=2, GLO=4, GAL=8, QZSS=16, BDS=32) built from `config.constellations` list.

This conf file is the actual control surface for RTKLIB — every solver behavior knob (positioning mode, ambiguity resolution strategy, atmosphere models, masks) flow through here into `rnx2rtkp` CLI options, nothing solved in Python itself.

## 5. Run RTKLIB (`run/runner.py`)

`run_rnx2rtkp(conf_path, rover, base, nav, workdir, binary="rnx2rtkp")`:
- build argv: `rnx2rtkp -k opts.conf -o solution.pos <rover> [<base>] <nav...>`.
- `subprocess.run(..., capture_output=True, text=True, cwd=workdir)` — **this is the actual GNSS solve**, all positioning math happens inside the external RTKLIB binary, gnss_engine is orchestration only.
- nonzero exit → `RtklibExecError(exit_code, stderr, workdir)` (workdir attached so caller/job-error can point at the failed run's files for debug).
- success → `RunResult(pos_path, stat_path, stdout, stderr)`. Note `stat_path` existence not guaranteed (only written if `out-outstat` enabled in conf — it is, via template default `out-outstat=residual`), engine.py checks `.exists()` before parsing stat.

Order of positional args matters to RTKLIB: rover first, then base (if any), then all nav files.

## 6. Parse `.pos` (`parse/pos.py`)

Line-based, whitespace-split (`line.split()`), skip blank lines and `%`-comment lines (RTKLIB `.pos` header). Each data line → 1 `Epoch`:

| col idx | field | meaning |
|---|---|---|
| 0,1 | t | date `YYYY/MM/DD` + time `HH:MM:SS.ffffff`, parsed as UTC (no tz conversion — RTKLIB output assumed UTC/GPST as configured) |
| 2,3,4 | lat, lon, h | position (deg, deg, m — `out-solformat=llh` in conf) |
| 5 | q | fix quality flag: 1=fix, 2=float, 3=sbas, 4=dgps, 5=single, 6=ppp |
| 6 | ns | num satellites used |
| 7,8,9 | sdn, sde, sdu | std-dev north/east/up (m) |
| 10 | sdne | north-east covariance term |
| 13 | age | differential age (s) |
| 14 | ratio | AR ratio-test value (this epoch's ambiguity fix confidence, compare against `ar_ratio_min` config) |

Requires ≥15 columns per line or raises `ParseError` with file:line context. `x/y/z` fields on `Epoch` left `None` here (llh format only — ECEF not populated from this parser).

## 7. Parse `.stat` (`parse/stat.py`)

Only lines starting `$SAT` consumed (RTKLIB stat file has multiple record types, `$SAT` = per-satellite per-epoch stats), comma-split, needs ≥16 fields.

Time reconstructed from **GPS week + time-of-week** (`cols[1]`, `cols[2]`), NOT calendar date — `_gps_to_utc` adds `timedelta(weeks, seconds)` to GPS epoch (1980-01-06). **Known limitation, documented in code**: leap seconds ignored, so `SatStat.t` will drift from true UTC by current leap-second count (18s as of this writing) relative to `Epoch.t` from the `.pos` parser. Don't cross-join `.pos` and `.stat` timestamps expecting exact match without accounting for this.

Fields: `sat` (PRN id), `az`/`el` (deg), `res_p`/`res_c` (pseudorange/carrier residuals), `snr`, `fix` (per-sat fix status), `slip` (bool, derived from slip-count field >0).

## 8. Summarize (`parse/summary.py`)

Pure aggregation over `Epoch` list, no file I/O:
- `n_fix` = count where `q==1`, `n_float` = `q==2`, `n_single` = `q>=4` (note: q=3 "sbas" counted in **none** of these buckets — falls through the gap between float=2 and single-and-above=4).
- `fix_rate_pct` = `100 * n_fix / n_epochs` (0 if no epochs, no div-by-zero).
- mean/RMS of `sdn`/`sde`/`sdu` across all epochs (not filtered by fix status — includes float/single epochs, so these numbers mix quality tiers).

## 9. Result assembly

`Solution` bundles: `meta` (step 3), `config_used` (the resolved `ProcessingConfig` as dumped JSON — full record of what settings actually produced this result), `epochs`, `sat_stats`, `summary`, `engine_log` (raw stdout+stderr concatenated from the RTKLIB subprocess — primary debug artifact when results look wrong but no exception raised).

## Failure modes summary

| Stage | Exception | Trigger |
|---|---|---|
| decompress | `DecompressError` | missing `gzip`/`CRX2RNX` binary, corrupt archive |
| validate | `RinexValidationError` | missing file, not RINEX obs, no nav files |
| conf render | (none — pure dict/string manipulation, config already pydantic-validated upstream) | |
| RTKLIB run | `RtklibExecError` | nonzero exit (bad RINEX content, incompatible sat systems, solver divergence, etc) — carries `workdir` for postmortem |
| parse .pos/.stat | `ParseError` | malformed RTKLIB output, column count mismatch |

All are subclasses of `EngineError`. None caught inside `solve()` itself — propagate to caller (job wrapper writes `error.json` and re-raises, per prior doc, but that's outside this file's scope).

## Known limitations / gotchas for anyone touching this code

1. **Leap seconds ignored** in `.stat` GPS-week/TOW → UTC conversion (`parse/stat.py`). `.pos` epoch times don't have this issue (parsed as literal calendar timestamp from RTKLIB text output).
2. **q=3 (SBAS) epochs** counted in `n_epochs` but not in `n_fix`/`n_float`/`n_single` — summary bucket counts won't sum to `n_epochs` if any SBAS-quality epochs present.
3. **ECEF (x/y/z) never populated** — `.pos` parser only handles `llh` format (hardcoded conf `out-solformat=llh`); if that conf override ever change, parser breaks silently (wrong column meanings, no format validation).
4. **stat file optional at parse time** (`.exists()` check) but conf always requests it (`out-outstat=residual`) — if RTKLIB version/config combo ever stops emitting it, `sat_stats` silently becomes `[]` rather than erroring.
5. **Precise ephemeris (`EphemerisSource.PRECISE`) has no special file-fetch logic** — config just changes `pos1-sateph` string passed to RTKLIB; no code here downloads/supplies precise orbit files, so this option will silently underperform or fail inside RTKLIB unless caller has otherwise provisioned precise ephemeris in the nav inputs.
6. **UNIX_Z decompress depends on system `gzip -dc`** supporting legacy `.Z` (LZW) — not guaranteed on all platforms/distros.
