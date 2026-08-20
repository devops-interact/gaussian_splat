"""
Configuration settings for the application
"""
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic_settings import BaseSettings
from pydantic import BaseModel
from functools import lru_cache
from enum import Enum


class QualityPreset(str, Enum):
    """Quality presets for Meshy image-to-3D reconstruction"""
    FAST = "fast"
    BALANCED = "balanced"
    QUALITY = "quality"


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
    ultra_mode: bool = False
    max_keyframes: int = 4


QUALITY_PRESETS: Dict[QualityPreset, MeshyPresetConfig] = {
    QualityPreset.FAST: MeshyPresetConfig(
        name="Fast",
        description="Quick AI mesh (~3–5 min). Lower polycount, good for previews.",
        fps=2.0,
        estimated_minutes=5,
        ai_model="meshy-6",
        enable_pbr=False,
        target_polycount=30_000,
    ),
    QualityPreset.BALANCED: MeshyPresetConfig(
        name="Balanced",
        description="Balanced quality and speed (~5–8 min). Recommended default.",
        fps=1.5,
        estimated_minutes=8,
        ai_model="meshy-7",
        enable_pbr=True,
        target_polycount=50_000,
    ),
    QualityPreset.QUALITY: MeshyPresetConfig(
        name="Quality",
        description="Highest fidelity (~8–12 min). 4K textures, ultra mode.",
        fps=1.0,
        estimated_minutes=12,
        ai_model="meshy-7",
        enable_pbr=True,
        texture_resolution="4k",
        target_polycount=100_000,
        ultra_mode=True,
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

    DEFAULT_PRESET: QualityPreset = QualityPreset.BALANCED
    FRAME_EXTRACTION_FPS: float = 1.5

    # Video validation settings
    MIN_VIDEO_DURATION: float = 3.0
    MAX_VIDEO_DURATION: float = 300.0
    MIN_VIDEO_RESOLUTION: int = 480
    MAX_VIDEO_RESOLUTION: int = 4096

    # Database (SQLite in storage dir)
    DATABASE_URL: str = ""

    # Auth (JWT)
    JWT_SECRET_KEY: str = "gaussian-splat-demo-secret-change-in-production"
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

    # Public base URL for keyframe images (Railway domain). Empty = data URIs.
    STORAGE_PUBLIC_BASE_URL: str = ""
    RAILWAY_PUBLIC_DOMAIN: str = ""

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
    return settings
