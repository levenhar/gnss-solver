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
