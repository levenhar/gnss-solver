from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from gnss_engine.models.config import BaseCoordMode


class ErrorInfo(BaseModel):
    type: str
    message: str
    workdir: str | None = None


class RenameRequest(BaseModel):
    name: str


class JobCreated(BaseModel):
    job_id: str
    status: str
    name: str | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: ErrorInfo | None = None
    name: str | None = None


class JobListItem(BaseModel):
    job_id: str
    status: str
    name: str | None = None


class BaseCoordEntry(BaseModel):
    mode: BaseCoordMode = BaseCoordMode.SINGLE
    coord: tuple[float, float, float] | None = None


class BatchCreated(BaseModel):
    batch_id: str
    status: str
    n_bases: int
    n_configs: int
    name: str | None = None


class BatchListItem(BaseModel):
    batch_id: str
    status: str
    done: int
    total: int
    name: str | None = None


class BatchBaseStatus(BaseModel):
    base_id: str
    done: int
    total: int
    failed: int


class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    bases: list[BatchBaseStatus]
    done: int
    total: int
    name: str | None = None


class BatchReportEntry(BaseModel):
    job_id: str
    config_idx: int
    config: dict
    status: str
    fix_rate_pct: float | None = None
    rms_sdn: float | None = None
    rms_sde: float | None = None
    rms_sdu: float | None = None
    utm_e: float | None = None
    utm_n: float | None = None
    mean_h: float | None = None
    mean_sats: float | None = None
    min_sats: int | None = None
    error_type: str | None = None
    error_message: str | None = None


class BatchReportSummary(BaseModel):
    best_job_id: str | None = None
    best_fix_rate_pct: float | None = None
    worst_fix_rate_pct: float | None = None
    mean_fix_rate_pct: float | None = None
    median_fix_rate_pct: float | None = None
    n_failed: int = 0


class BatchBaseReport(BaseModel):
    base_id: str
    results: list[BatchReportEntry]
    summary: BatchReportSummary


class BatchReportResponse(BaseModel):
    batch_id: str
    bases: list[BatchBaseReport]


class TimeWindow(BaseModel):
    t_start: datetime | None = None
    t_end: datetime | None = None


class TimeSyncFileResult(TimeWindow):
    filename: str
    overlaps_rover: bool | None = None


class TimeSyncResponse(BaseModel):
    ok: bool
    rover: TimeWindow | None = None
    bases: list[TimeSyncFileResult] = []
    nav: TimeSyncFileResult | None = None
    issues: list[str] = []
