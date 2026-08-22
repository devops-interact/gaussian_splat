"""
Configuration settings for the application
"""
from pathlib import Path
from typing import List, Dict, Literal, Optional
from pydantic_settings import BaseSettings
from pydantic import BaseModel
from functools import lru_cache
from enum import Enum


class QualityPreset(str, Enum):
    """Quality presets for Meshy image-to-3D reconstruction"""
    QUALITY = "quality"
    ROOM = "room"


LEGACY_PRESET_ALIASES: Dict[str, QualityPreset] = {
    "fast": QualityPreset.QUALITY,
    "balanced": QualityPreset.QUALITY,
}


def resolve_quality_preset(value: Optional[str]) -> QualityPreset:
    """Map API/DB preset strings to active presets (legacy fast/balanced → quality)."""
    if not value:
        return QualityPreset.QUALITY
    try:
        return QualityPreset(value)
    except ValueError:
        return LEGACY_PRESET_ALIASES.get(value, QualityPreset.QUALITY)


class MeshyPresetConfig(BaseModel):
    """Meshy API parameters for a quality preset"""
    name: str
    description: str
    fps: float
    estimated_minutes: int
    ai_model: str = "meshy-7"
    should_texture: bool = True
    enable_pbr: bool = True
    texture_resolution: str = "2k"
    target_polycount: int = 50_000
    should_remesh: bool = False
    max_keyframes: int = 4
    meshy_timeout_s: float = 600.0
    # Color / fidelity
    texture_image_urls_mode: Literal["same", "wall_priority"] = "same"
    image_enhancement: bool = False
    remove_lighting: bool = False
    auto_size: bool = True
    origin_at: str = "bottom"
    decimation_mode: Optional[int] = None
    save_pre_remeshed_model: bool = True
    multi_view_thumbnails: bool = False
    # Room composition (preset room only)
    n_zones: int = 4
    composition_mode: Literal["single_object", "zone_mesh"] = "single_object"
    room_shell_enabled: bool = False


QUALITY_PRESETS: Dict[QualityPreset, MeshyPresetConfig] = {
    QualityPreset.QUALITY: MeshyPresetConfig(
        name="Object — highest detail",
        description="Single mesh from 4 views (~15–25 min). Best for one object, not full rooms.",
        fps=1.0,
        estimated_minutes=22,
        ai_model="meshy-7",
        enable_pbr=True,
        texture_resolution="4k",
        target_polycount=100_000,
        meshy_timeout_s=1800.0,
        texture_image_urls_mode="wall_priority",
        image_enhancement=False,
        decimation_mode=1,
        save_pre_remeshed_model=True,
        auto_size=True,
    ),
    QualityPreset.ROOM: MeshyPresetConfig(
        name="Room — full space",
        description="Reconstructs walls/floor by zones (~35–45 min). Recommended for walkthrough videos.",
        fps=1.5,
        estimated_minutes=40,
        ai_model="meshy-7",
        enable_pbr=True,
        texture_resolution="4k",
        target_polycount=80_000,
        meshy_timeout_s=1800.0,
        texture_image_urls_mode="wall_priority",
        image_enhancement=False,
        decimation_mode=1,
        save_pre_remeshed_model=True,
        auto_size=True,
        n_zones=4,
        composition_mode="zone_mesh",
        room_shell_enabled=True,
        multi_view_thumbnails=True,
    ),
}


class Settings(BaseSettings):
    # Storage paths
    BASE_DIR: Path = Path(__file__).parent.parent
    STORAGE_DIR: Path = BASE_DIR / "storage"
    UPLOADS_DIR: Path = STORAGE_DIR / "uploads"
    FRAMES_DIR: Path = STORAGE_DIR / "frames"
    MODELS_DIR: Path = STORAGE_DIR / "models"
    LOGS_DIR: Path = STORAGE_DIR / "logs"

    ENV: str = "development"

    # Video validation settings
    MIN_VIDEO_DURATION: float = 3.0
    MAX_VIDEO_DURATION: float = 300.0
    MIN_VIDEO_RESOLUTION: int = 480
    MAX_VIDEO_RESOLUTION: int = 4096

    # Database (SQLite in storage dir)
    DATABASE_URL: str = ""

    # Auth (JWT)
    JWT_SECRET_KEY: str = "mesh-up-demo-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7

    # API settings
    MAX_UPLOAD_SIZE: int = 500 * 1024 * 1024
    ALLOWED_EXTENSIONS: List[str] = [".mp4", ".mov", ".avi", ".webm"]

    # Meshy API
    MESHY_API_KEY: str = ""
    MESHY_POLL_INTERVAL_S: float = 5.0
    MESHY_TIMEOUT_S: float = 600.0
    MESHY_WEBHOOK_SECRET: str = ""
    MESHY_MAX_PARALLEL_JOBS: int = 3

    # Public base URL for keyframe images (Railway domain). Empty = data URIs.
    STORAGE_PUBLIC_BASE_URL: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = True


def get_preset_config(preset: QualityPreset) -> MeshyPresetConfig:
    return QUALITY_PRESETS[preset]


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    for dir_path in [settings.UPLOADS_DIR, settings.FRAMES_DIR,
                     settings.MODELS_DIR, settings.LOGS_DIR]:
        dir_path.mkdir(parents=True, exist_ok=True)
    if not settings.DATABASE_URL:
        db_path = settings.STORAGE_DIR / "data.db"
        settings.DATABASE_URL = f"sqlite:///{db_path}"
    if settings.ENV == "production" and settings.JWT_SECRET_KEY == "mesh-up-demo-secret-change-in-production":
        raise RuntimeError("JWT_SECRET_KEY must be set in production")
    return settings
