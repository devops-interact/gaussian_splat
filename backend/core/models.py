"""
Data models for job state and processing
"""
from enum import Enum
from datetime import datetime
from typing import Optional
from pydantic import ConfigDict
from pydantic import BaseModel

class JobStatus(str, Enum):
    UPLOADED = "uploaded"
    EXTRACTING_FRAMES = "extracting_frames"
    TRAINING = "training"  # LongSplat handles pose estimation + training together
    EXPORTING = "exporting"
    COMPLETED = "completed"
    ERROR = "error"

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

class JobCreate(BaseModel):
    video_filename: str
