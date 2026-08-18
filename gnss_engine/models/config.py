from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, field_validator


class PositioningMode(str, Enum):
    STATIC = "static"
    KINEMATIC = "kinematic"
    MOVINGBASE = "movingbase"
    PPP_STATIC = "ppp-static"
    PPP_KINEMATIC = "ppp-kinematic"


class Constellation(str, Enum):
    GPS = "GPS"
    GLO = "GLO"
    GAL = "GAL"
    BDS = "BDS"
    QZSS = "QZSS"
    SBAS = "SBAS"


class Frequency(str, Enum):
    L1 = "l1"
    L1L2 = "l1+l2"
    L1L2L5 = "l1+l2+l5"


class TropoModel(str, Enum):
    OFF = "off"
    SAAS = "saastamoinen"
    SBAS = "sbas"
    EST_ZTD = "estimate-ztd"
    EST_ZTD_GRAD = "estimate-ztd-grad"


class IonoModel(str, Enum):
    OFF = "off"
    BROADCAST = "broadcast"
    SBAS = "sbas"
    IONO_FREE = "iono-free-lc"
    EST_STEC = "estimate-stec"
    IONEX = "ionex"


class AmbiguityMode(str, Enum):
    OFF = "off"
    CONTINUOUS = "continuous"
    INSTANTANEOUS = "instantaneous"
    FIX_HOLD = "fix-and-hold"


class EphemerisSource(str, Enum):
    BROADCAST = "broadcast"
    PRECISE = "precise"


class BaseCoordMode(str, Enum):
    KNOWN_LLH = "known-llh"
    KNOWN_XYZ = "known-xyz"
    SINGLE = "single"


class ProcessingConfig(BaseModel):
    mode: PositioningMode = PositioningMode.STATIC
    constellations: list[Constellation] = [Constellation.GPS]
    frequency: Frequency = Frequency.L1L2
    elev_mask_deg: float = 15.0
    snr_mask_dbhz: float = 35.0
    tropo: TropoModel = TropoModel.SAAS
    iono: IonoModel = IonoModel.BROADCAST
    ambiguity: AmbiguityMode = AmbiguityMode.CONTINUOUS
    ar_ratio_min: float = 3.0
    ar_min_lock: int = 0
    ar_min_elev_deg: float = 0.0
    ephemeris: EphemerisSource = EphemerisSource.BROADCAST
    base_coord_mode: BaseCoordMode = BaseCoordMode.SINGLE
    base_coord: tuple[float, float, float] | None = None

    @field_validator("elev_mask_deg", "ar_min_elev_deg")
    @classmethod
    def _elev_range(cls, v: float) -> float:
        if not 0.0 <= v <= 90.0:
            raise ValueError("elevation must be between 0 and 90 degrees")
        return v

    @field_validator("snr_mask_dbhz")
    @classmethod
    def _snr_range(cls, v: float) -> float:
        if not 0.0 <= v <= 60.0:
            raise ValueError("SNR mask must be between 0 and 60 dBHz")
        return v


class SweepConfig(BaseModel):
    mode: PositioningMode
    constellation_pool: list[Constellation] = [
        Constellation.GLO,
        Constellation.GAL,
        Constellation.BDS,
        Constellation.QZSS,
        Constellation.SBAS,
    ]
    elev_mask_range: tuple[float, float] = (0.0, 90.0)
    ar_ratio_min_range: tuple[float, float] = (1.5, 5.0)
    ar_min_lock_range: tuple[int, int] = (0, 10)
    ar_min_elev_range: tuple[float, float] = (0.0, 30.0)
    snr_mask_dbhz: float = 15.0
    frequency_pool: list[Frequency] = list(Frequency)
    tropo_pool: list[TropoModel] = list(TropoModel)
    iono_pool: list[IonoModel] = list(IonoModel)
    ambiguity_pool: list[AmbiguityMode] = list(AmbiguityMode)
    ephemeris_pool: list[EphemerisSource] = list(EphemerisSource)

    @field_validator("elev_mask_range", "ar_min_elev_range")
    @classmethod
    def _elev_range_bounds(cls, v: tuple[float, float]) -> tuple[float, float]:
        lo, hi = v
        if not (0.0 <= lo <= 90.0 and 0.0 <= hi <= 90.0):
            raise ValueError("elevation range bounds must be between 0 and 90 degrees")
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator("ar_ratio_min_range")
    @classmethod
    def _ar_ratio_min_range(cls, v: tuple[float, float]) -> tuple[float, float]:
        lo, hi = v
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator("ar_min_lock_range")
    @classmethod
    def _ar_min_lock_range(cls, v: tuple[int, int]) -> tuple[int, int]:
        lo, hi = v
        if lo < 0 or hi < 0:
            raise ValueError("ar_min_lock_range bounds must be >= 0")
        if lo > hi:
            raise ValueError("range min must be <= max")
        return v

    @field_validator(
        "constellation_pool", "frequency_pool", "tropo_pool",
        "iono_pool", "ambiguity_pool", "ephemeris_pool",
    )
    @classmethod
    def _non_empty_pool(cls, v: list) -> list:
        if not v:
            raise ValueError("pool must not be empty")
        return v

    @field_validator("snr_mask_dbhz")
    @classmethod
    def _snr_range(cls, v: float) -> float:
        if not 0.0 <= v <= 60.0:
            raise ValueError("SNR mask must be between 0 and 60 dBHz")
        return v
