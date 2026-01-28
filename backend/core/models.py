"""
Data models for job state and processing
"""
from enum import Enum
from datetime import datetime
from typing import Optional, List
from pydantic import ConfigDict
from pydantic import BaseModel
from core.config import QualityPreset


class JobStatus(str, Enum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    EXTRACTING_FRAMES = "extracting_frames"
    TRAINING = "training"  # LongSplat handles pose estimation + training together
    EXPORTING = "exporting"
    COMPRESSING = "compressing"
    COMPLETED = "completed"
    ERROR = "error"


class VideoValidation(BaseModel):
    """Video validation result"""
    valid: bool
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    errors: List[str] = []
    warnings: List[str] = []


class Job(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    job_id: str
    status: JobStatus
    video_filename: str
    created_at: datetime
    updated_at: datetime
    error_message: Optional[str] = None
    progress: float = 0.0  # 0.0 to 1.0
    model_filename: Optional[str] = None
    model_url: Optional[str] = None
    model_url_compressed: Optional[str] = None  # Compressed version
    quality_preset: QualityPreset = QualityPreset.BALANCED
    validation: Optional[VideoValidation] = None
    estimated_minutes: Optional[int] = None


class JobCreate(BaseModel):
    video_filename: str
    quality_preset: QualityPreset = QualityPreset.BALANCED


class PresetInfo(BaseModel):
    """Info about a quality preset for API response"""
    id: str
    name: str
    description: str
    estimated_minutes: int
