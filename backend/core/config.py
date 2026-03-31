"""
Configuration settings for the application
"""
from pathlib import Path
from typing import List, Dict, Any
from pydantic_settings import BaseSettings
from pydantic import BaseModel
from functools import lru_cache
from enum import Enum


class QualityPreset(str, Enum):
    """Quality presets for 3D reconstruction"""
    BALANCED = "balanced"
    QUALITY = "quality"


class PresetConfig(BaseModel):
    """Configuration for a quality preset"""
    name: str
    description: str
    fps: float
    iterations: int
    resolution: int
    init_frames_ratio: float  # Ratio of frames to use for initialization
    estimated_minutes: int
    # LongSplat convert_3dgs.py: higher = keep more anchor-derived Gaussians (less aggressive prune).
    convert_3dgs_prune_ratio: float = 0.62


# Quality preset definitions - Optimized for SPEED + DENSITY balance
QUALITY_PRESETS: Dict[QualityPreset, PresetConfig] = {
    QualityPreset.BALANCED: PresetConfig(
        name="Balanced",
        description="Good quality (~15-25 min). Recommended for most videos.",
        fps=1.5,
        iterations=12000,
        resolution=1,
        init_frames_ratio=0.30,
        estimated_minutes=20,
        convert_3dgs_prune_ratio=0.62,
    ),
    QualityPreset.QUALITY: PresetConfig(
        name="Quality",
        description="Best quality (~30-45 min). For final production renders.",
        fps=2.0,
        iterations=20000,
        resolution=1,
        init_frames_ratio=0.25,
        estimated_minutes=38,
        convert_3dgs_prune_ratio=0.68,
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
    
    # Default processing settings (used if no preset specified)
    DEFAULT_PRESET: QualityPreset = QualityPreset.BALANCED
    FRAME_EXTRACTION_FPS: float = 2.0
    LONGSPLAT_ITERATIONS: int = 5000
    LONGSPLAT_RESOLUTION: int = 1
    
    # Video validation settings
    MIN_VIDEO_DURATION: float = 3.0  # Minimum 3 seconds
    MAX_VIDEO_DURATION: float = 300.0  # Maximum 5 minutes
    MIN_VIDEO_RESOLUTION: int = 480  # Minimum height
    MAX_VIDEO_RESOLUTION: int = 4096  # Maximum dimension
    
    # Database (SQLite in storage dir)
    DATABASE_URL: str = ""
    
    # Auth (JWT)
    JWT_SECRET_KEY: str = "gaussian-splat-demo-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # API settings
    MAX_UPLOAD_SIZE: int = 500 * 1024 * 1024  # 500MB
    ALLOWED_EXTENSIONS: List[str] = [".mp4", ".mov", ".avi", ".webm"]
    
    # Compression settings
    COMPRESS_OUTPUT: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = True


def get_preset_config(preset: QualityPreset) -> PresetConfig:
    """Get configuration for a quality preset"""
    return QUALITY_PRESETS[preset]


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    # Create directories
    for dir_path in [settings.UPLOADS_DIR, settings.FRAMES_DIR,
                     settings.MODELS_DIR, settings.LOGS_DIR]:
        dir_path.mkdir(parents=True, exist_ok=True)
    # Set database URL if not provided (SQLite in storage)
    if not settings.DATABASE_URL:
        db_path = settings.STORAGE_DIR / "data.db"
        settings.DATABASE_URL = f"sqlite:///{db_path}"
    return settings
