from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
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


def write_job_created(job_id: str) -> None:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "created.json").write_text(
        json.dumps({"created_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8"
    )


def read_job_created(job_id: str) -> str | None:
    p = job_dir(job_id) / "created.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))["created_at"]


def write_name(dir_: Path, name: str) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / "name.json").write_text(json.dumps({"name": name}), encoding="utf-8")


def read_name(dir_: Path) -> str | None:
    p = dir_ / "name.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))["name"]


def write_job_name(job_id: str, name: str) -> None:
    write_name(job_dir(job_id), name)


def read_job_name(job_id: str) -> str | None:
    return read_name(job_dir(job_id))


def delete_job(job_id: str) -> None:
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


def delete_batch(batch_id: str) -> None:
    shutil.rmtree(batch_dir(batch_id), ignore_errors=True)


def _batches_root() -> Path:
    return get_settings().data_dir / "batches"


def batch_dir(batch_id: str) -> Path:
    return _batches_root() / batch_id


def write_batch_name(batch_id: str, name: str) -> None:
    write_name(batch_dir(batch_id), name)


def read_batch_name(batch_id: str) -> str | None:
    return read_name(batch_dir(batch_id))


def write_batch_manifest(batch_id: str, manifest: dict) -> None:
    d = batch_dir(batch_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def read_batch_manifest(batch_id: str) -> dict | None:
    p = batch_dir(batch_id) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def list_batch_ids() -> list[str]:
    root = _batches_root()
    if not root.exists():
        return []
    return [d.name for d in root.iterdir() if d.is_dir()]


def list_batch_job_ids() -> set[str]:
    ids: set[str] = set()
    for bid in list_batch_ids():
        manifest = read_batch_manifest(bid)
        if manifest is None:
            continue
        for b in manifest["bases"]:
            ids.update(j["job_id"] for j in b["jobs"])
    return ids
