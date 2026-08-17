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
