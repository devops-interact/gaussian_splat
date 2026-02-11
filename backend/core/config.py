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
    FAST = "fast"
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


# Quality preset definitions - Optimized for SPEED + DENSITY balance
QUALITY_PRESETS: Dict[QualityPreset, PresetConfig] = {
    QualityPreset.FAST: PresetConfig(
        name="Fast",
        description="Quick preview (~5-8 min). Good for testing.",
        fps=1.0,
        iterations=3000,  # Reduced from 5k for speed
        resolution=2,
        init_frames_ratio=0.15,
        estimated_minutes=7
    ),
    QualityPreset.BALANCED: PresetConfig(
        name="Balanced",
        description="Good quality (~15-20 min). Recommended for most videos.",
        fps=2.0,
        iterations=8000,  # Reduced from 15k - rely on densification instead
        resolution=1,
        init_frames_ratio=0.30,
        estimated_minutes=18
    ),
    QualityPreset.QUALITY: PresetConfig(
        name="Quality",
        description="Best quality (~25-35 min). For final production renders.",
        fps=3.0,
        iterations=15000,  # Reduced from 30k
        resolution=1,
        init_frames_ratio=0.25,
        estimated_minutes=32
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
    return settings
