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


# Quality preset definitions
QUALITY_PRESETS: Dict[QualityPreset, PresetConfig] = {
    QualityPreset.FAST: PresetConfig(
        name="Fast",
        description="Quick preview (~3-5 min). Lower quality, good for testing.",
        fps=1.0,
        iterations=2000,
        resolution=2,
        init_frames_ratio=0.15,
        estimated_minutes=5
    ),
    QualityPreset.BALANCED: PresetConfig(
        name="Balanced",
        description="Good quality (~8-12 min). Recommended for most videos.",
        fps=2.0,
        iterations=5000,
        resolution=1,
        init_frames_ratio=0.20,
        estimated_minutes=10
    ),
    QualityPreset.QUALITY: PresetConfig(
        name="Quality",
        description="Best quality (~20-30 min). For final production renders.",
        fps=3.0,
        iterations=12000,
        resolution=1,
        init_frames_ratio=0.25,
        estimated_minutes=25
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
