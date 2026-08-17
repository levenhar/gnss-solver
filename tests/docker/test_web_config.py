from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "web" / "Dockerfile"
NGINX = ROOT / "web" / "nginx.conf"
COMPOSE = ROOT / "docker" / "docker-compose.yml"


def test_web_dockerfile_multistage():
    text = DOCKERFILE.read_text(encoding="utf-8")
    assert text.count("FROM ") >= 2
    assert "npm run build" in text
    assert "nginx" in text.lower()


def test_nginx_has_spa_fallback():
    text = NGINX.read_text(encoding="utf-8")
    assert "try_files" in text
    assert "index.html" in text


def test_compose_has_web_service():
    text = COMPOSE.read_text(encoding="utf-8")
    assert "web:" in text
    assert "3000:80" in text
    assert "VITE_API_BASE" in text
