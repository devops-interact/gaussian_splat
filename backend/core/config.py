"""
Configuration settings for the application
"""
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Storage paths
    BASE_DIR: Path = Path(__file__).parent.parent
    STORAGE_DIR: Path = BASE_DIR / "storage"
    UPLOADS_DIR: Path = STORAGE_DIR / "uploads"
    FRAMES_DIR: Path = STORAGE_DIR / "frames"
    MODELS_DIR: Path = STORAGE_DIR / "models"
    LOGS_DIR: Path = STORAGE_DIR / "logs"
    
    # Processing settings - OPTIMIZED FOR SPEED
    FRAME_EXTRACTION_FPS: float = 1.0  # Extract 1 frame per second (halves frame count)
    LONGSPLAT_ITERATIONS: int = 3000  # Fast training (3000 iterations ~3-5 min)
    LONGSPLAT_RESOLUTION: int = 2  # Half resolution (2x faster rendering)
    
    # API settings
    MAX_UPLOAD_SIZE: int = 500 * 1024 * 1024  # 500MB
    ALLOWED_EXTENSIONS: List[str] = [".mp4"]
    
    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    # Create directories
    for dir_path in [settings.UPLOADS_DIR, settings.FRAMES_DIR, 
                     settings.MODELS_DIR, settings.LOGS_DIR]:
        dir_path.mkdir(parents=True, exist_ok=True)
    return settings
