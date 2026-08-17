from __future__ import annotations

from api.schemas import (
    BatchBaseReport,
    BatchBaseStatus,
    BatchCreated,
    BatchListItem,
    BatchReportEntry,
    BatchReportResponse,
    BatchReportSummary,
    BatchStatusResponse,
    ErrorInfo,
    JobCreated,
    JobStatusResponse,
    JobListItem,
)


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


def test_batch_created():
    b = BatchCreated(batch_id="x", status="queued", n_bases=2, n_configs=100)
    assert b.n_bases == 2


def test_batch_status_response_aggregates_bases():
    r = BatchStatusResponse(
        batch_id="x", status="running",
        bases=[BatchBaseStatus(base_id="base-0", done=1, total=100, failed=0)],
        done=1, total=100,
    )
    assert r.bases[0].total == 100


def test_batch_report_entry_optional_stats_default_none():
    e = BatchReportEntry(job_id="j1", config_idx=0, config={}, status="queued")
    assert e.fix_rate_pct is None


def test_batch_report_response_shape():
    entry = BatchReportEntry(job_id="j1", config_idx=0, config={}, status="finished", fix_rate_pct=90.0)
    summary = BatchReportSummary(best_job_id="j1", best_fix_rate_pct=90.0, worst_fix_rate_pct=90.0,
                                  mean_fix_rate_pct=90.0, median_fix_rate_pct=90.0, n_failed=0)
    report = BatchReportResponse(batch_id="x", bases=[BatchBaseReport(base_id="base-0", results=[entry], summary=summary)])
    assert report.bases[0].summary.best_job_id == "j1"


def test_batch_list_item():
    assert BatchListItem(batch_id="x", status="finished", done=100, total=100).done == 100
