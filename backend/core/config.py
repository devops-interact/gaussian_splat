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
    
    # Processing settings
    FRAME_EXTRACTION_FPS: float = 2.0  # Extract 2 frames per second
    LONGSPLAT_ITERATIONS: int = 30000  # LongSplat training iterations
    LONGSPLAT_RESOLUTION: int = 1  # Resolution scale (1, 2, 4, or 8)
    
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
