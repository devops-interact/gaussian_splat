"""
Data models for job state and processing
"""
from enum import Enum
from datetime import datetime
from typing import Optional, List
from pydantic import ConfigDict, BaseModel, Field
from core.config import QualityPreset


class JobStatus(str, Enum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    EXTRACTING_FRAMES = "extracting_frames"
    SELECTING_KEYFRAMES = "selecting_keyframes"
    SUBMITTING_RECONSTRUCTION = "submitting_reconstruction"
    RECONSTRUCTING = "reconstructing"
    DOWNLOADING_MODEL = "downloading_model"
    COMPOSING_SCENE = "composing_scene"
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


class KeyframeInfo(BaseModel):
    url: str
    index: int
    zone_id: Optional[int] = None
    yaw_deg: Optional[float] = None
    sharpness: Optional[float] = None


class ZoneMeshInfo(BaseModel):
    id: int
    mesh_url: str
    meshy_task_id: Optional[str] = None
    transform: List[List[float]] = Field(default_factory=lambda: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ])


class SceneManifest(BaseModel):
    composition_mode: str = "single_object"
    zones: List[ZoneMeshInfo] = Field(default_factory=list)
    shell_url: Optional[str] = None
    walk_path: Optional[List[List[float]]] = None


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
    keyframes: List[KeyframeInfo] = Field(default_factory=list)
    scene_manifest: Optional[SceneManifest] = None
    current_zone: Optional[int] = None
    total_zones: Optional[int] = None


class JobCreate(BaseModel):
    video_filename: str
    quality_preset: QualityPreset = QualityPreset.BALANCED


class PresetInfo(BaseModel):
    id: str
    name: str
    description: str
    estimated_minutes: int
    composition_mode: str = "single_object"
