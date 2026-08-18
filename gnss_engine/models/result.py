from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class Epoch(BaseModel):
    t: datetime
    lat: float
    lon: float
    h: float
    q: int
    ns: int
    sdn: float
    sde: float
    sdu: float
    sdne: float
    age: float
    ratio: float
    x: float | None = None
    y: float | None = None
    z: float | None = None


class SatStat(BaseModel):
    t: datetime
    sat: str
    az: float
    el: float
    snr: float
    res_p: float
    res_c: float
    slip: bool
    fix: int


class DatasetMeta(BaseModel):
    rinex_version: str
    file_type: str
    interval_s: float | None = None
    t_start: datetime | None = None
    t_end: datetime | None = None
    span_s: float | None = None
    receiver: str | None = None
    antenna: str | None = None
    rover_id: str | None = None
    base_id: str | None = None


class SolutionSummary(BaseModel):
    n_epochs: int
    n_fix: int
    n_float: int
    n_single: int
    fix_rate_pct: float
    mean_sdn: float
    mean_sde: float
    mean_sdu: float
    rms_sdn: float
    rms_sde: float
    rms_sdu: float
    mean_lat: float | None = None
    mean_lon: float | None = None
    mean_h: float | None = None


class Solution(BaseModel):
    meta: DatasetMeta
    config_used: dict
    epochs: list[Epoch]
    sat_stats: list[SatStat]
    summary: SolutionSummary
    engine_log: str
