# GNSS API + Async Infra — Design Spec

**Date:** 2026-08-17
**Sub-project:** #2 of 5 (API + Async Infra)
**Status:** Approved, pending implementation plan

---

## Context

Sub-project 2 of the 5-part GNSS post-processing web app. Sub-project 1 (the pure-Python
`gnss_engine` library) is complete and merged to `main`; it exposes the two locked contracts
`ProcessingConfig` (input) and `Solution` (output). This sub-project wraps that engine in an
asynchronous web API so RINEX jobs can be submitted, processed off-request in a worker, and
their results retrieved — all runnable locally via `docker compose up`.

Build order recap: **1 Core engine (done)** → **2 API + async infra (this) → 3 Frontend SPA
→ 4 Advanced pipeline → 5 Reporting.**

## Decisions locked during brainstorming

- **Full async stack** (not a synchronous skeleton): FastAPI + Redis + RQ worker + Docker.
- **Task queue: RQ** (Redis-backed, minimal). A job is an enqueued Python function call.
  Sub-project 4's parallelism will be N independent RQ jobs — no Celery orchestration needed.
- **Storage: filesystem volume + Redis.** Redis holds job status (RQ's registry). Each job
  gets a directory on a persistent named volume holding uploaded RINEX, RTKLIB artifacts, and
  the `Solution` JSON. No database in v2.
- **Job submission: one-shot multipart `POST /jobs`** (rover + optional base + nav files +
  config JSON in a single request). No separate file-upload step in v2.
- **One shared Docker image for api + worker** (same image, different command per compose
  service). Both carry the RTKLIB binaries + `gnss_engine`.
- **Browser access via FastAPI Swagger UI (`/docs`)** — no React SPA in this sub-project
  (that is #3).

## Repository layout (added to the existing monorepo)

```
api/
  __init__.py
  config.py     # Settings from env: REDIS_URL, DATA_DIR (pydantic-settings or plain os.environ)
  queue.py      # Redis connection + RQ Queue factory
  jobstore.py   # job-directory management on the volume; save inputs; read/write solution.json & error.json
  tasks.py      # run_solve_job(job_id) -> calls gnss_engine.solve; executed by the worker
  schemas.py    # Pydantic response models: JobCreated, JobStatusResponse, ErrorInfo, JobListItem
  main.py       # FastAPI app + routes
worker/
  __init__.py
  __main__.py   # `python -m worker` -> boots an RQ worker on the same queue/redis
docker/
  Dockerfile         # multi-stage: build RTKLIB rnx2rtkp + RNXCMP CRX2RNX, then python:3.11-slim runtime
  docker-compose.yml # services: api, worker, redis; named volume for artifacts
requirements-api.txt # fastapi, uvicorn[standard], rq, redis, python-multipart, pydantic-settings
```

`gnss_engine/` is unchanged and installed as a local package into the image.

## Job lifecycle & data flow

1. **Submit** — `POST /jobs`, `multipart/form-data`:
   - `rover`: one RINEX obs file (required)
   - `base`: one RINEX obs file (optional)
   - `nav`: one or more navigation files (required, repeatable field)
   - `config`: a JSON string that parses into `ProcessingConfig` (required)

   Handler generates `job_id = uuid4().hex`, `jobstore` writes uploads to
   `{DATA_DIR}/jobs/{job_id}/input/` and the parsed config to `config.json`, then enqueues
   `api.tasks.run_solve_job(job_id)` with the RQ job id set equal to `job_id`. Returns
   `201 {"job_id": ..., "status": "queued"}`.

   Invalid/absent `config` JSON, missing `rover`, or empty `nav` → `422` **before** enqueue,
   nothing persisted.

2. **Process** — the worker executes `run_solve_job(job_id)`:
   - Reads `config.json` → `ProcessingConfig`; resolves rover/base/nav paths from the input dir.
   - Calls `gnss_engine.solve(rover, nav, config, base=base, workdir={job_dir}/work)`.
   - On success: writes `solution.json` (`Solution.model_dump(mode="json")`) to the job dir;
     the `.pos`/`.stat` produced under `work/` remain in the job dir tree.
   - On `EngineError` (any subclass): writes `error.json`
     `{"type": <ClassName>, "message": str(err), "workdir": <RtklibExecError.workdir or null>}`,
     then re-raises so RQ marks the job `failed`.

3. **Poll status** — `GET /jobs/{job_id}`:
   - Looks up the RQ job. Maps RQ status → `queued | started | finished | failed | not_found`.
   - `404` if no such job id. If `failed` and `error.json` exists, include its `ErrorInfo`.

4. **Fetch result** — `GET /jobs/{job_id}/result`:
   - `200` with the `Solution` JSON when finished and `solution.json` exists.
   - `404` if job unknown; `409` with `ErrorInfo` if the job failed; `409` "not ready" if still
     queued/started.

5. **List** — `GET /jobs` → array of `{job_id, status}` (from the job directories + RQ status).

6. **Health** — `GET /health` → `{"status": "ok", "redis": true|false}` (pings Redis).

## Module responsibilities & interfaces

- **`api/config.py`** — `Settings` with `redis_url: str` (default `redis://localhost:6379/0`)
  and `data_dir: Path` (default `./data`), read from env. A `get_settings()` accessor.
- **`api/queue.py`** — `get_redis()` → `redis.Redis.from_url(settings.redis_url)`;
  `get_queue()` → `rq.Queue("gnss", connection=get_redis())`. Queue name constant `"gnss"`.
- **`api/jobstore.py`** — pure filesystem/JSON, no Redis:
  - `job_dir(job_id) -> Path`, `input_dir(job_id) -> Path`
  - `save_upload(job_id, field, filename, data: bytes) -> Path`
  - `write_config(job_id, config: ProcessingConfig)`, `read_config(job_id) -> ProcessingConfig`
  - `resolve_inputs(job_id) -> tuple[Path, list[Path], Path | None]`  # rover, nav, base
  - `write_solution(job_id, solution)`, `read_solution(job_id) -> dict | None`
  - `write_error(job_id, info: ErrorInfo)`, `read_error(job_id) -> ErrorInfo | None`
  - `list_job_ids() -> list[str]`
- **`api/tasks.py`** — `run_solve_job(job_id: str) -> None`. Imports `gnss_engine.solve`.
  Enqueued by the API, imported and executed by the worker. Wraps solve in the error-capture
  described above.
- **`api/schemas.py`** — `JobCreated{job_id, status}`, `JobStatusResponse{job_id, status,
  error: ErrorInfo | None}`, `ErrorInfo{type, message, workdir}`, `JobListItem{job_id, status}`.
- **`api/main.py`** — FastAPI app wiring the six routes above to `jobstore` + `queue`.
- **`worker/__main__.py`** — connects to the same Redis and runs `rq.Worker(["gnss"])`.

## Docker / RTKLIB build

Multi-stage `docker/Dockerfile`:

- **Stage 1 — builder** (`debian:bookworm-slim` + `build-essential`, `git`):
  - Clone `rtklibexplorer/RTKLIB` (demo5 branch, pinned commit) and build `rnx2rtkp`
    (`app/consapp/rnx2rtkp/gcc`, `make`).
  - Clone/download RNXCMP (Hatanaka) and build `CRX2RNX`.
  - Both binaries land in a known path for copy-out.
- **Stage 2 — runtime** (`python:3.11-slim`):
  - `apt-get install` `gzip` (for `.gz`/`.Z` decompression) and any runtime libs.
  - Copy `rnx2rtkp` and `CRX2RNX` to `/usr/local/bin` (on PATH).
  - Copy the repo; `pip install .` (installs `gnss_engine` incl. the packaged `template.conf`
    via the sub-project-1 `package-data` entry) and `pip install -r requirements-api.txt`.
  - Default command overridden per compose service.

`docker/docker-compose.yml` services:
- `redis` — `redis:7-alpine`.
- `api` — the shared image, command `uvicorn api.main:app --host 0.0.0.0 --port 8000`,
  ports `8000:8000`, env `REDIS_URL=redis://redis:6379/0`, `DATA_DIR=/data`, volume `gnss-data:/data`.
- `worker` — the shared image, command `python -m worker`, same env + volume.
- named volume `gnss-data`.

Local run: `docker compose -f docker/docker-compose.yml up --build`, then open
`http://localhost:8000/docs`.

## Error handling

All engine failures are typed `EngineError` subclasses. The worker converts them to a
structured `error.json`; the API surfaces that as `ErrorInfo` on the status/result endpoints.
`RtklibExecError.workdir` is included when present (sub-project 1 retains the temp workdir on
failure, so the path is meaningful for debugging inside the container).

## Testing (TDD)

- **`jobstore` unit** (tmp `DATA_DIR`): save uploads, round-trip config, write/read
  solution + error, list job ids.
- **API unit** (`fastapi.testclient.TestClient`, **fakeredis** for Redis, monkeypatched
  `get_queue().enqueue`): `POST /jobs` validates config (422 on bad JSON / missing rover /
  empty nav), persists inputs, enqueues once; `GET /jobs/{id}` maps statuses incl. 404;
  `GET /jobs/{id}/result` returns 200/404/409 correctly; `GET /health` reports redis reachability.
- **`tasks.run_solve_job` unit** (monkeypatch `gnss_engine.solve`, tmp `DATA_DIR`): writes
  `solution.json` on success; writes `error.json` and re-raises on `EngineError`.
- **Gated integration** (`requires_rtklib` + Docker): real `rnx2rtkp`, a small bundled RINEX
  set, `POST /jobs` → poll → `GET result` returns a real `Solution`. Skipped locally when the
  binary is absent; run in Docker/CI. Manual smoke via `/docs` documented in the plan.

## Deliverable of this sub-project

A runnable async web service: `docker compose up` brings up `api`, `worker`, and `redis`;
RINEX jobs submitted at `POST /jobs` are processed by the worker via `gnss_engine.solve` and
retrievable as `Solution` JSON, all drivable from the browser at `/docs`. Frontend SPA,
advanced pipeline, and reporting remain later sub-projects.
