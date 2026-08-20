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
    SELECTING_KEYFRAMES = "selecting_keyframes"
    SUBMITTING_RECONSTRUCTION = "submitting_reconstruction"
    RECONSTRUCTING = "reconstructing"
    DOWNLOADING_MODEL = "downloading_model"
    COMPLETED = "completed"
    ERROR = "error"


class VideoValidation(BaseModel):
    valid: bool
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    errors: List[str] = []
    warnings: List[str] = []


class ModelMetadata(BaseModel):
    file_size: Optional[int] = None
    vertex_count: Optional[int] = None
    face_count: Optional[int] = None
    has_colors: bool = False
    has_pbr: bool = False
    bounding_box: Optional[dict] = None
    format: Optional[str] = None
    thumbnail_url: Optional[str] = None
    meshy_task_id: Optional[str] = None
    # Legacy fields kept for backward-compatible API responses
    point_count: Optional[int] = None
    has_opacity: bool = False
    properties: List[str] = []


class Job(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    job_id: str
    status: JobStatus
    video_filename: str
    created_at: datetime
    updated_at: datetime
    error_message: Optional[str] = None
    progress: float = 0.0
    model_filename: Optional[str] = None
    model_url: Optional[str] = None
    model_url_obj: Optional[str] = None
    quality_preset: QualityPreset = QualityPreset.BALANCED
    validation: Optional[VideoValidation] = None
    estimated_minutes: Optional[int] = None
    model_metadata: Optional[ModelMetadata] = None
    processing_time_seconds: Optional[float] = None
    meshy_task_id: Optional[str] = None
    # Deprecated
    model_url_compressed: Optional[str] = None


class JobCreate(BaseModel):
    video_filename: str
    quality_preset: QualityPreset = QualityPreset.BALANCED


class PresetInfo(BaseModel):
    id: str
    name: str
    description: str
    estimated_minutes: int
