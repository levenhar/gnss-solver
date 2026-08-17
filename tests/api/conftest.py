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
