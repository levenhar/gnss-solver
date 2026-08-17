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
