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
