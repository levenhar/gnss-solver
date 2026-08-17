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
