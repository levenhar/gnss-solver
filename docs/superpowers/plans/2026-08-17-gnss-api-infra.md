# GNSS API + Async Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing `gnss_engine` library in an asynchronous FastAPI + RQ + Redis web service, containerized so `docker compose up` runs it locally with RTKLIB binaries compiled in.

**Architecture:** FastAPI accepts a multipart job submission, persists uploads to a per-job directory on a shared volume, and enqueues an RQ job on Redis. A separate worker process runs `gnss_engine.solve` and writes `solution.json` (or `error.json`) back into the job directory. Status/result endpoints read RQ state + those files. One shared Docker image runs both the API and the worker.

**Tech Stack:** Python 3.11+ (container), FastAPI, Uvicorn, RQ, Redis, Pydantic v2 / pydantic-settings, python-multipart; fakeredis + FastAPI TestClient for tests; multi-stage Docker building `rnx2rtkp` (RTKLIB demo5) and `CRX2RNX` (RNXCMP).

## Global Constraints

- **Python:** target floor 3.11 (container). Local dev may run 3.10 — start every module with `from __future__ import annotations`, no 3.11-only syntax.
- **Pydantic v2** and **pydantic-settings v2** only.
- **No database.** Job status lives in Redis (RQ); artifacts live on the filesystem under `DATA_DIR`.
- **Queue name** is the constant string `"gnss"` everywhere (API enqueues, worker consumes).
- **Enqueue by string reference** `"api.tasks.run_solve_job"` with the RQ job id set equal to `job_id`, so the API never imports the engine.
- **`gnss_engine` is unchanged** by this sub-project — import it, do not edit it.
- **Tests** run via `python -m pytest`, offline, with **fakeredis** (never a real Redis) and monkeypatched enqueue. No test starts a real worker or Docker.
- **Never commit** `__pycache__/`, `*.pyc`, or the `data/` artifacts directory.
- **Job id** = `uuid4().hex`.
- **Engine errors** are `EngineError` subclasses from `gnss_engine.errors`; `RtklibExecError` has a `.workdir` attribute.

---

### Task 1: Scaffold api/worker packages, settings, requirements, gitignore

**Files:**
- Create: `api/__init__.py`
- Create: `api/config.py`
- Create: `worker/__init__.py`
- Create: `requirements-api.txt`
- Modify: `.gitignore` (add `data/`)
- Modify: `pyproject.toml` (add `api*`, `worker*` to packages, extend testpaths)
- Create: `tests/api/__init__.py`
- Create: `tests/api/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `api.config.Settings` (`redis_url: str`, `data_dir: Path`) read from env vars `REDIS_URL` / `DATA_DIR`; `api.config.get_settings() -> Settings` (cached, with a way for tests to reset). Packages `api` and `worker` importable.

- [ ] **Step 1: Write the failing test**

`tests/api/test_config.py`:
```python
from __future__ import annotations

from pathlib import Path

from api.config import Settings, get_settings


def test_defaults():
    s = Settings()
    assert s.redis_url.startswith("redis://")
    assert isinstance(s.data_dir, Path)


def test_env_override(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://example:6379/1")
    monkeypatch.setenv("DATA_DIR", "/tmp/gnss-data")
    get_settings.cache_clear()
    s = get_settings()
    assert s.redis_url == "redis://example:6379/1"
    assert s.data_dir == Path("/tmp/gnss-data")
    get_settings.cache_clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api'`.

- [ ] **Step 3: Write minimal implementation**

`api/__init__.py`: empty file.
`worker/__init__.py`: empty file.
`tests/api/__init__.py`: empty file.

`api/config.py`:
```python
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    data_dir: Path = Path("./data")


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`requirements-api.txt`:
```
fastapi>=0.109
uvicorn[standard]>=0.27
rq>=1.15
redis>=5.0
python-multipart>=0.0.9
pydantic-settings>=2.1
```

Append to `.gitignore`:
```
data/
```

In `pyproject.toml`, change the packages include and testpaths:
```toml
[tool.setuptools.packages.find]
include = ["gnss_engine*", "api*", "worker*"]
```
```toml
[tool.pytest.ini_options]
markers = ["requires_rtklib: needs rnx2rtkp/CRX2RNX on PATH"]
testpaths = ["tests"]
```
(testpaths already `["tests"]` — leave as is; the new `tests/api` is discovered automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_config.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/ worker/ requirements-api.txt .gitignore pyproject.toml tests/api/
git commit -m "feat: scaffold api/worker packages and settings"
```

---

### Task 2: Response schemas

**Files:**
- Create: `api/schemas.py`
- Create: `tests/api/test_schemas.py`

**Interfaces:**
- Consumes: nothing.
- Produces Pydantic models used by `jobstore`, `tasks`, and `main`:
  - `ErrorInfo(type: str, message: str, workdir: str | None = None)`
  - `JobCreated(job_id: str, status: str)`
  - `JobStatusResponse(job_id: str, status: str, error: ErrorInfo | None = None)`
  - `JobListItem(job_id: str, status: str)`

- [ ] **Step 1: Write the failing test**

`tests/api/test_schemas.py`:
```python
from __future__ import annotations

from api.schemas import ErrorInfo, JobCreated, JobStatusResponse, JobListItem


def test_error_info_optional_workdir():
    e = ErrorInfo(type="RtklibExecError", message="boom")
    assert e.workdir is None
    assert e.type == "RtklibExecError"


def test_status_response_carries_error():
    r = JobStatusResponse(
        job_id="abc", status="failed",
        error=ErrorInfo(type="ParseError", message="bad", workdir="/data/x"),
    )
    dumped = r.model_dump(mode="json")
    assert dumped["status"] == "failed"
    assert dumped["error"]["workdir"] == "/data/x"


def test_created_and_list_item():
    assert JobCreated(job_id="a", status="queued").status == "queued"
    assert JobListItem(job_id="a", status="finished").job_id == "a"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.schemas'`.

- [ ] **Step 3: Write minimal implementation**

`api/schemas.py`:
```python
from __future__ import annotations

from pydantic import BaseModel


class ErrorInfo(BaseModel):
    type: str
    message: str
    workdir: str | None = None


class JobCreated(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: ErrorInfo | None = None


class JobListItem(BaseModel):
    job_id: str
    status: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_schemas.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/schemas.py tests/api/test_schemas.py
git commit -m "feat: add API response schemas"
```

---

### Task 3: Job store (filesystem + JSON)

**Files:**
- Create: `api/jobstore.py`
- Create: `tests/api/conftest.py`
- Create: `tests/api/test_jobstore.py`

**Interfaces:**
- Consumes: `api.config.get_settings` (Task 1), `api.schemas.ErrorInfo` (Task 2), `gnss_engine.models.config.ProcessingConfig`.
- Produces (all paths under `get_settings().data_dir / "jobs" / job_id`):
  - `job_dir(job_id) -> Path`
  - `input_dir(job_id) -> Path`  (`{job_dir}/input`)
  - `save_upload(job_id, role, filename, data: bytes) -> Path`  (role in `"rover"|"base"|"nav"`; writes `{input}/{role}/{filename}`)
  - `write_config(job_id, config: ProcessingConfig) -> None`  (`{job_dir}/config.json`)
  - `read_config(job_id) -> ProcessingConfig`
  - `resolve_inputs(job_id) -> tuple[Path, list[Path], Path | None]`  (rover, sorted nav list, base or None)
  - `write_solution(job_id, solution: dict) -> None`  (`{job_dir}/solution.json`)
  - `read_solution(job_id) -> dict | None`
  - `write_error(job_id, info: ErrorInfo) -> None`  (`{job_dir}/error.json`)
  - `read_error(job_id) -> ErrorInfo | None`
  - `list_job_ids() -> list[str]`

- [ ] **Step 1: Write the failing test**

`tests/api/conftest.py`:
```python
from __future__ import annotations

import pytest

from api.config import get_settings


@pytest.fixture
def data_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
```

`tests/api/test_jobstore.py`:
```python
from __future__ import annotations

from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine.models.config import ProcessingConfig


def test_save_and_resolve_inputs(data_env):
    jid = "job1"
    jobstore.save_upload(jid, "rover", "r.rnx", b"OBS")
    jobstore.save_upload(jid, "nav", "a.nav", b"NAV1")
    jobstore.save_upload(jid, "nav", "b.nav", b"NAV2")
    rover, nav, base = jobstore.resolve_inputs(jid)
    assert rover.name == "r.rnx"
    assert [p.name for p in nav] == ["a.nav", "b.nav"]
    assert base is None


def test_config_roundtrip(data_env):
    jid = "job2"
    cfg = ProcessingConfig(mode="kinematic")
    jobstore.write_config(jid, cfg)
    loaded = jobstore.read_config(jid)
    assert loaded.mode == cfg.mode


def test_solution_and_error_roundtrip(data_env):
    jid = "job3"
    assert jobstore.read_solution(jid) is None
    assert jobstore.read_error(jid) is None
    jobstore.write_solution(jid, {"summary": {"fix_rate_pct": 100.0}})
    assert jobstore.read_solution(jid)["summary"]["fix_rate_pct"] == 100.0
    jobstore.write_error(jid, ErrorInfo(type="ParseError", message="x"))
    assert jobstore.read_error(jid).type == "ParseError"


def test_list_job_ids(data_env):
    jobstore.save_upload("j-a", "rover", "r.rnx", b"x")
    jobstore.save_upload("j-b", "rover", "r.rnx", b"x")
    assert set(jobstore.list_job_ids()) == {"j-a", "j-b"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_jobstore.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.jobstore'`.

- [ ] **Step 3: Write minimal implementation**

`api/jobstore.py`:
```python
from __future__ import annotations

import json
from pathlib import Path

from api.config import get_settings
from api.schemas import ErrorInfo
from gnss_engine.models.config import ProcessingConfig

_ROLES = ("rover", "base", "nav")


def _jobs_root() -> Path:
    return get_settings().data_dir / "jobs"


def job_dir(job_id: str) -> Path:
    return _jobs_root() / job_id


def input_dir(job_id: str) -> Path:
    return job_dir(job_id) / "input"


def save_upload(job_id: str, role: str, filename: str, data: bytes) -> Path:
    if role not in _ROLES:
        raise ValueError(f"unknown role: {role}")
    dest_dir = input_dir(job_id) / role
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / Path(filename).name
    dest.write_bytes(data)
    return dest


def write_config(job_id: str, config: ProcessingConfig) -> None:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(
        json.dumps(config.model_dump(mode="json")), encoding="utf-8"
    )


def read_config(job_id: str) -> ProcessingConfig:
    raw = (job_dir(job_id) / "config.json").read_text(encoding="utf-8")
    return ProcessingConfig.model_validate_json(raw)


def resolve_inputs(job_id: str) -> tuple[Path, list[Path], Path | None]:
    inp = input_dir(job_id)
    rover_files = sorted((inp / "rover").glob("*"))
    if not rover_files:
        raise FileNotFoundError(f"no rover file for job {job_id}")
    nav = sorted((inp / "nav").glob("*"))
    base_files = sorted((inp / "base").glob("*")) if (inp / "base").exists() else []
    base = base_files[0] if base_files else None
    return rover_files[0], nav, base


def write_solution(job_id: str, solution: dict) -> None:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "solution.json").write_text(json.dumps(solution), encoding="utf-8")


def read_solution(job_id: str) -> dict | None:
    p = job_dir(job_id) / "solution.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def write_error(job_id: str, info: ErrorInfo) -> None:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "error.json").write_text(json.dumps(info.model_dump(mode="json")), encoding="utf-8")


def read_error(job_id: str) -> ErrorInfo | None:
    p = job_dir(job_id) / "error.json"
    if not p.exists():
        return None
    return ErrorInfo.model_validate_json(p.read_text(encoding="utf-8"))


def list_job_ids() -> list[str]:
    root = _jobs_root()
    if not root.exists():
        return []
    return [d.name for d in root.iterdir() if d.is_dir()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_jobstore.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/jobstore.py tests/api/conftest.py tests/api/test_jobstore.py
git commit -m "feat: add filesystem job store"
```

---

### Task 4: Redis connection + RQ queue factory

**Files:**
- Create: `api/queue.py`
- Create: `tests/api/test_queue.py`

**Interfaces:**
- Consumes: `api.config.get_settings` (Task 1).
- Produces:
  - `QUEUE_NAME = "gnss"`
  - `get_redis() -> redis.Redis`  (`redis.Redis.from_url(settings.redis_url)`)
  - `get_queue(connection=None) -> rq.Queue`  (`rq.Queue(QUEUE_NAME, connection=connection or get_redis())`)

- [ ] **Step 1: Write the failing test**

`tests/api/test_queue.py`:
```python
from __future__ import annotations

import fakeredis

from api.queue import QUEUE_NAME, get_queue


def test_queue_uses_name_and_connection():
    fake = fakeredis.FakeStrictRedis()
    q = get_queue(connection=fake)
    assert q.name == QUEUE_NAME
    assert q.connection is fake


def test_enqueue_by_reference_creates_job():
    fake = fakeredis.FakeStrictRedis()
    q = get_queue(connection=fake)
    job = q.enqueue("api.tasks.run_solve_job", "job-xyz", job_id="job-xyz")
    assert job.id == "job-xyz"
    assert job.func_name == "api.tasks.run_solve_job"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_queue.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.queue'`.

- [ ] **Step 3: Write minimal implementation**

`api/queue.py`:
```python
from __future__ import annotations

import redis
from rq import Queue

from api.config import get_settings

QUEUE_NAME = "gnss"


def get_redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url)


def get_queue(connection: redis.Redis | None = None) -> Queue:
    return Queue(QUEUE_NAME, connection=connection or get_redis())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_queue.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/queue.py tests/api/test_queue.py
git commit -m "feat: add redis connection and RQ queue factory"
```

---

### Task 5: Worker task `run_solve_job`

**Files:**
- Create: `api/tasks.py`
- Create: `tests/api/test_tasks.py`

**Interfaces:**
- Consumes: `api.jobstore` (Task 3), `api.schemas.ErrorInfo` (Task 2), `gnss_engine.solve`, `gnss_engine.errors.EngineError`.
- Produces: `run_solve_job(job_id: str) -> None`. Reads config + inputs from the job store, calls `gnss_engine.solve(rover, nav, config, base=base, workdir=job_dir/"work")`, writes `solution.json` on success; on `EngineError` writes `error.json` (type/message/`.workdir` when present) then re-raises.

- [ ] **Step 1: Write the failing test**

`tests/api/test_tasks.py`:
```python
from __future__ import annotations

import pytest

import api.tasks as tasks
from api import jobstore
from gnss_engine.errors import RtklibExecError
from gnss_engine.models.config import ProcessingConfig


class _FakeSolution:
    def model_dump(self, mode="json"):
        return {"summary": {"fix_rate_pct": 100.0}}


def _seed_job(jid):
    jobstore.save_upload(jid, "rover", "r.rnx", b"OBS")
    jobstore.save_upload(jid, "nav", "a.nav", b"NAV")
    jobstore.write_config(jid, ProcessingConfig())


def test_run_solve_job_success_writes_solution(data_env, monkeypatch):
    jid = "ok-job"
    _seed_job(jid)

    def fake_solve(rover, nav, config, base=None, workdir=None):
        return _FakeSolution()

    monkeypatch.setattr(tasks, "solve", fake_solve)
    tasks.run_solve_job(jid)
    sol = jobstore.read_solution(jid)
    assert sol["summary"]["fix_rate_pct"] == 100.0
    assert jobstore.read_error(jid) is None


def test_run_solve_job_engine_error_writes_error_and_raises(data_env, monkeypatch):
    jid = "bad-job"
    _seed_job(jid)

    def fake_solve(rover, nav, config, base=None, workdir=None):
        raise RtklibExecError(exit_code=2, stderr="bad rinex", workdir="/data/jobs/bad-job/work")

    monkeypatch.setattr(tasks, "solve", fake_solve)
    with pytest.raises(RtklibExecError):
        tasks.run_solve_job(jid)
    err = jobstore.read_error(jid)
    assert err.type == "RtklibExecError"
    assert err.workdir == "/data/jobs/bad-job/work"
    assert jobstore.read_solution(jid) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_tasks.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.tasks'`.

- [ ] **Step 3: Write minimal implementation**

`api/tasks.py`:
```python
from __future__ import annotations

from api import jobstore
from api.schemas import ErrorInfo
from gnss_engine import solve
from gnss_engine.errors import EngineError


def run_solve_job(job_id: str) -> None:
    config = jobstore.read_config(job_id)
    rover, nav, base = jobstore.resolve_inputs(job_id)
    workdir = jobstore.job_dir(job_id) / "work"
    try:
        solution = solve(rover, nav, config, base=base, workdir=workdir)
    except EngineError as err:
        jobstore.write_error(
            job_id,
            ErrorInfo(
                type=type(err).__name__,
                message=str(err),
                workdir=getattr(err, "workdir", None),
            ),
        )
        raise
    jobstore.write_solution(job_id, solution.model_dump(mode="json"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_tasks.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/tasks.py tests/api/test_tasks.py
git commit -m "feat: add run_solve_job worker task"
```

---

### Task 6: FastAPI app + routes

**Files:**
- Create: `api/main.py`
- Create: `tests/api/test_main.py`

**Interfaces:**
- Consumes: `api.jobstore` (Task 3), `api.queue` (Task 4), `api.schemas` (Task 2), `gnss_engine.models.config.ProcessingConfig`.
- Produces: `app` (FastAPI) with routes:
  - `POST /jobs` — multipart (`rover` UploadFile required; `base` UploadFile optional; `nav` list[UploadFile] required; `config` str Form required). Parses `config` → `ProcessingConfig` (422 on failure), requires ≥1 nav (422 if empty), saves uploads, `write_config`, enqueues `"api.tasks.run_solve_job"` with `job_id=job_id`, returns `201 JobCreated`.
  - `GET /jobs/{job_id}` — `JobStatusResponse`; 404 when unknown.
  - `GET /jobs/{job_id}/result` — Solution JSON (200) / 404 unknown / 409 failed(+error) / 409 not-ready.
  - `GET /jobs` — `list[JobListItem]`.
  - `GET /health` — `{"status":"ok","redis":bool}`.
  - Helper `_status(job_id) -> str` mapping RQ status with file fallback (`finished` if solution.json, `failed` if error.json, else `queued` if dir exists, else `not_found`).
  - CORS middleware allowing all origins (dev; frontend sub-project 3 will call cross-origin).

- [ ] **Step 1: Write the failing test**

`tests/api/test_main.py`:
```python
from __future__ import annotations

import json

import fakeredis
import pytest
from fastapi.testclient import TestClient

import api.main as main_mod
from api import jobstore
from api.schemas import ErrorInfo


@pytest.fixture
def client(data_env, monkeypatch):
    fake = fakeredis.FakeStrictRedis()
    monkeypatch.setattr(main_mod, "get_redis", lambda: fake)

    enqueued = {}

    class _FakeQueue:
        def enqueue(self, ref, *args, **kwargs):
            enqueued["ref"] = ref
            enqueued["job_id"] = kwargs.get("job_id", args[0] if args else None)
            return type("J", (), {"id": enqueued["job_id"]})()

    monkeypatch.setattr(main_mod, "get_queue", lambda connection=None: _FakeQueue())
    c = TestClient(main_mod.app)
    c.enqueued = enqueued
    return c


def _files():
    return [
        ("rover", ("r.rnx", b"OBS", "application/octet-stream")),
        ("nav", ("a.nav", b"NAV", "application/octet-stream")),
    ]


def test_post_job_valid_enqueues(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": json.dumps({"mode": "static"})},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    jid = body["job_id"]
    assert client.enqueued["ref"] == "api.tasks.run_solve_job"
    assert client.enqueued["job_id"] == jid
    # inputs persisted
    rover, nav, base = jobstore.resolve_inputs(jid)
    assert rover.name == "r.rnx"


def test_post_job_bad_config_is_422(client):
    resp = client.post(
        "/jobs",
        files=_files(),
        data={"config": "not-json"},
    )
    assert resp.status_code == 422


def test_get_status_404_when_unknown(client):
    assert client.get("/jobs/nope").status_code == 404


def test_result_flow_finished_and_failed(client):
    # finished
    jobstore.write_solution("fin", {"summary": {"fix_rate_pct": 50.0}})
    r = client.get("/jobs/fin/result")
    assert r.status_code == 200
    assert r.json()["summary"]["fix_rate_pct"] == 50.0
    assert client.get("/jobs/fin").json()["status"] == "finished"
    # failed
    jobstore.write_error("fl", ErrorInfo(type="ParseError", message="bad"))
    assert client.get("/jobs/fl").json()["status"] == "failed"
    rf = client.get("/jobs/fl/result")
    assert rf.status_code == 409
    assert rf.json()["detail"]["type"] == "ParseError"


def test_health_reports_redis(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["redis"] is True


def test_list_jobs(client):
    jobstore.write_solution("j1", {"summary": {}})
    jobstore.write_error("j2", ErrorInfo(type="X", message="y"))
    items = {i["job_id"]: i["status"] for i in client.get("/jobs").json()}
    assert items["j1"] == "finished"
    assert items["j2"] == "failed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_main.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.main'`.

- [ ] **Step 3: Write minimal implementation**

`api/main.py`:
```python
from __future__ import annotations

import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from api import jobstore
from api.queue import get_queue, get_redis
from api.schemas import JobCreated, JobListItem, JobStatusResponse
from gnss_engine.models.config import ProcessingConfig
from rq.job import Job
from rq.exceptions import NoSuchJobError

app = FastAPI(title="GNSS Solver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _rq_status(job_id: str) -> str | None:
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJobError:
        return None
    st = job.get_status(refresh=True)
    if st in ("queued", "deferred", "scheduled"):
        return "queued"
    if st == "started":
        return "started"
    if st == "finished":
        return "finished"
    if st == "failed":
        return "failed"
    return None


def _status(job_id: str) -> str:
    rq = _rq_status(job_id)
    if rq is not None:
        return rq
    if jobstore.read_solution(job_id) is not None:
        return "finished"
    if jobstore.read_error(job_id) is not None:
        return "failed"
    if jobstore.job_dir(job_id).exists():
        return "queued"
    return "not_found"


@app.post("/jobs", status_code=201, response_model=JobCreated)
async def create_job(
    rover: UploadFile = File(...),
    nav: list[UploadFile] = File(...),
    config: str = Form(...),
    base: UploadFile | None = File(None),
) -> JobCreated:
    try:
        cfg = ProcessingConfig.model_validate_json(config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid config: {exc}") from exc
    if not nav:
        raise HTTPException(status_code=422, detail="at least one nav file is required")

    job_id = uuid.uuid4().hex
    jobstore.save_upload(job_id, "rover", rover.filename or "rover.rnx", await rover.read())
    for nf in nav:
        jobstore.save_upload(job_id, "nav", nf.filename or "nav", await nf.read())
    if base is not None:
        jobstore.save_upload(job_id, "base", base.filename or "base.rnx", await base.read())
    jobstore.write_config(job_id, cfg)

    get_queue().enqueue("api.tasks.run_solve_job", job_id, job_id=job_id)
    return JobCreated(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    st = _status(job_id)
    if st == "not_found":
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse(job_id=job_id, status=st, error=jobstore.read_error(job_id))


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    st = _status(job_id)
    if st == "not_found":
        raise HTTPException(status_code=404, detail="job not found")
    if st == "failed":
        err = jobstore.read_error(job_id)
        raise HTTPException(status_code=409, detail=(err.model_dump(mode="json") if err else "failed"))
    sol = jobstore.read_solution(job_id)
    if sol is None:
        raise HTTPException(status_code=409, detail="result not ready")
    return sol


@app.get("/jobs", response_model=list[JobListItem])
def list_jobs() -> list[JobListItem]:
    return [JobListItem(job_id=j, status=_status(j)) for j in jobstore.list_job_ids()]


@app.get("/health")
def health() -> dict:
    try:
        ok = bool(get_redis().ping())
    except Exception:
        ok = False
    return {"status": "ok", "redis": ok}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_main.py -v`
Expected: PASS (6 tests). Note: the `client` fixture patches `main_mod.get_redis`/`get_queue`; `_rq_status` uses `Job.fetch` against fakeredis, which raises `NoSuchJobError` for file-seeded jobs, so status falls back to files as intended.

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/api/test_main.py
git commit -m "feat: add FastAPI app with job routes"
```

---

### Task 7: Worker entrypoint

**Files:**
- Create: `worker/__main__.py`
- Create: `tests/worker/__init__.py`
- Create: `tests/worker/test_worker.py`

**Interfaces:**
- Consumes: `api.queue.get_redis` + `QUEUE_NAME` (Task 4).
- Produces: `worker.__main__.main() -> None` that builds `rq.Worker([QUEUE_NAME], connection=get_redis())` and calls `.work()`. Guarded by `if __name__ == "__main__": main()`.

- [ ] **Step 1: Write the failing test**

`tests/worker/__init__.py`: empty file.

`tests/worker/test_worker.py`:
```python
from __future__ import annotations

import rq

import worker.__main__ as worker_main
from api.queue import QUEUE_NAME


def test_main_builds_worker_on_gnss_queue(monkeypatch):
    captured = {}

    class _FakeWorker:
        def __init__(self, queues, connection=None):
            captured["queues"] = queues
            captured["connection"] = connection

        def work(self):
            captured["worked"] = True

    monkeypatch.setattr(rq, "Worker", _FakeWorker)
    monkeypatch.setattr(worker_main, "get_redis", lambda: "REDIS")

    worker_main.main()

    assert captured["queues"] == [QUEUE_NAME]
    assert captured["connection"] == "REDIS"
    assert captured["worked"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/worker/test_worker.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'worker.__main__'`.

- [ ] **Step 3: Write minimal implementation**

`worker/__main__.py`:
```python
from __future__ import annotations

import rq

from api.queue import QUEUE_NAME, get_redis


def main() -> None:
    worker = rq.Worker([QUEUE_NAME], connection=get_redis())
    worker.work()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/worker/test_worker.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add worker/__main__.py tests/worker/
git commit -m "feat: add RQ worker entrypoint"
```

---

### Task 8: Docker image, compose, and config validation

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `.dockerignore`
- Create: `tests/docker/__init__.py`
- Create: `tests/docker/test_docker_config.py`
- Modify: `README.md` (add a "Run locally" section) — create if absent.

**Interfaces:**
- Consumes: nothing at runtime (infra files). The validation test reads the files as text.
- Produces: a multi-stage `Dockerfile` building `rnx2rtkp` + `CRX2RNX` and a runtime image with `gnss_engine` + API deps; a `docker-compose.yml` with `redis`, `api`, `worker` services and a named volume.

- [ ] **Step 1: Write the failing test**

`tests/docker/__init__.py`: empty file.

`tests/docker/test_docker_config.py`:
```python
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "docker" / "Dockerfile"
COMPOSE = ROOT / "docker" / "docker-compose.yml"


def test_dockerfile_multistage_builds_binaries():
    text = DOCKERFILE.read_text(encoding="utf-8")
    assert text.count("FROM ") >= 2, "expected a multi-stage build"
    assert "rnx2rtkp" in text
    assert "CRX2RNX" in text
    assert "pip install" in text
    assert "requirements-api.txt" in text


def test_compose_has_three_services_and_volume():
    text = COMPOSE.read_text(encoding="utf-8")
    for svc in ("redis:", "api:", "worker:"):
        assert svc in text, f"missing service {svc}"
    assert "uvicorn api.main:app" in text
    assert "python -m worker" in text
    assert "REDIS_URL" in text
    assert "DATA_DIR" in text
    assert "gnss-data" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/docker/test_docker_config.py -v`
Expected: FAIL — `FileNotFoundError` (Dockerfile/compose absent).

- [ ] **Step 3: Write minimal implementation**

`docker/Dockerfile`:
```dockerfile
# ---------- Stage 1: build RTKLIB rnx2rtkp + RNXCMP CRX2RNX ----------
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# RTKLIB demo5 (rnx2rtkp)
RUN git clone --depth 1 https://github.com/rtklibexplorer/RTKLIB.git /src/rtklib
RUN make -C /src/rtklib/app/consapp/rnx2rtkp/gcc && \
    cp /src/rtklib/app/consapp/rnx2rtkp/gcc/rnx2rtkp /usr/local/bin/rnx2rtkp

# RNXCMP (CRX2RNX) — Hatanaka compression tool
RUN curl -fsSL https://terras.gsi.go.jp/ja/crx2rnx/RNXCMP_4.1.0_src.tar.gz -o /tmp/rnxcmp.tar.gz && \
    tar xzf /tmp/rnxcmp.tar.gz -C /tmp && \
    gcc -O2 -o /usr/local/bin/CRX2RNX /tmp/RNXCMP_*/source/crx2rnx.c

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends gzip && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/bin/rnx2rtkp /usr/local/bin/rnx2rtkp
COPY --from=builder /usr/local/bin/CRX2RNX /usr/local/bin/CRX2RNX

WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir . && \
    pip install --no-cache-dir -r requirements-api.txt

ENV DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`docker/docker-compose.yml`:
```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    command: uvicorn api.main:app --host 0.0.0.0 --port 8000
    ports:
      - "8000:8000"
    environment:
      REDIS_URL: redis://redis:6379/0
      DATA_DIR: /data
    volumes:
      - gnss-data:/data
    depends_on:
      - redis

  worker:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    command: python -m worker
    environment:
      REDIS_URL: redis://redis:6379/0
      DATA_DIR: /data
    volumes:
      - gnss-data:/data
    depends_on:
      - redis

volumes:
  gnss-data:
```

`.dockerignore`:
```
.git
__pycache__/
*.pyc
data/
.superpowers/
docs/
tests/
```

Add to `README.md` (create if missing) a section:
```markdown
## Run locally (API + worker + Redis)

    docker compose -f docker/docker-compose.yml up --build

Then open http://localhost:8000/docs to submit a job (upload rover/nav files,
paste a config JSON), poll `GET /jobs/{id}`, and fetch `GET /jobs/{id}/result`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/docker/test_docker_config.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: all unit tests pass (engine suite + api/worker/docker), the one engine `requires_rtklib` integration test skips.

- [ ] **Step 6: Commit**

```bash
git add docker/ .dockerignore tests/docker/ README.md
git commit -m "feat: add multi-stage Docker image and compose stack"
```

---

## Self-Review

**1. Spec coverage:**
- FastAPI app + 6 routes → Task 6. ✓
- RQ queue + Redis → Task 4. ✓
- Worker process + `run_solve_job` → Tasks 5, 7. ✓
- Filesystem job store (inputs, config, solution, error) → Task 3. ✓
- Response schemas incl. structured `ErrorInfo` → Task 2. ✓
- Settings from env → Task 1. ✓
- One-shot multipart submission with 422 validation → Task 6. ✓
- Status mapping RQ + file fallback → Task 6 (`_status`). ✓
- Multi-stage Docker building `rnx2rtkp` + `CRX2RNX`, compose with api/worker/redis + volume → Task 8. ✓
- Browser access via `/docs` → FastAPI default (documented in README, Task 8). ✓
- Gated integration (real binary/Docker) → documented; unit tests use fakeredis + monkeypatched solve/enqueue. ✓
- Deferred items (SPA, multi-base, reporting, Postgres, convbin) correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete.

**3. Type consistency:** `ErrorInfo(type, message, workdir)` identical across Tasks 2/3/5/6. `run_solve_job(job_id)` enqueued as `"api.tasks.run_solve_job"` (Tasks 4/6) matches the definition (Task 5). `get_redis`/`get_queue`/`QUEUE_NAME` consistent across Tasks 4/6/7. `jobstore` function names identical between Task 3 definitions and Task 5/6 call sites. `_status` returns one of `queued|started|finished|failed|not_found` used consistently by the three routes.

**Known notes:**
- RQ's `Worker.work()` forks (POSIX); the worker runs only in the Linux container. Local unit tests never start a real worker (Task 7 mocks `rq.Worker`), so Windows/3.10 dev is unaffected.
- The RNXCMP download URL/version in the Dockerfile is pinned to 4.1.0; if that mirror path changes, only Task 8's Dockerfile line needs updating — it does not affect any unit test.
