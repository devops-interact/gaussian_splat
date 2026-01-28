"""
API endpoints for job management
"""
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from pathlib import Path
from typing import Optional
from core.models import Job, JobStatus, VideoValidation
from core.config import get_settings, QualityPreset, QUALITY_PRESETS
from core.pipeline import process_job
from jobs.job_manager import get_job_manager
from services.video.validate import validate_video, get_video_info
import aiofiles
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


@router.post("/upload")
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    quality_preset: str = Form(default="balanced")
):
    """
    Upload a video file and start processing
    
    Args:
        file: Video file to upload
        quality_preset: Quality preset (fast, balanced, quality)
    """
    # Validate preset
    try:
        preset = QualityPreset(quality_preset)
    except ValueError:
        preset = QualityPreset.BALANCED
        logger.warning(f"Invalid preset '{quality_preset}', using balanced")
    
    preset_config = QUALITY_PRESETS[preset]
    
    # Validate file extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {settings.ALLOWED_EXTENSIONS}"
        )
    
    # Create job with preset
    job_manager = get_job_manager()
    job = await job_manager.create_job(file.filename)
    job.quality_preset = preset
    job.estimated_minutes = preset_config.estimated_minutes
    
    # Save uploaded file
    video_filename = f"{job.job_id}{file_ext}"
    video_path = settings.UPLOADS_DIR / video_filename
    
    try:
        async with aiofiles.open(video_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Validate video
        job.status = JobStatus.VALIDATING
        await job_manager.update_job(job)
        
        validation_result = validate_video(video_path)
        
        job.validation = VideoValidation(
            valid=validation_result.valid,
            duration=validation_result.video_info.duration if validation_result.video_info else None,
            width=validation_result.video_info.width if validation_result.video_info else None,
            height=validation_result.video_info.height if validation_result.video_info else None,
            fps=validation_result.video_info.fps if validation_result.video_info else None,
            errors=validation_result.errors,
            warnings=validation_result.warnings
        )
        
        if not validation_result.valid:
            job.status = JobStatus.ERROR
            job.error_message = "; ".join(validation_result.errors)
            await job_manager.update_job(job)
            
            # Delete invalid video
            video_path.unlink(missing_ok=True)
            
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Video validation failed",
                    "errors": validation_result.errors,
                    "warnings": validation_result.warnings
                }
            )
        
        # Update job with saved filename
        job.video_filename = video_filename
        job.status = JobStatus.UPLOADED
        await job_manager.update_job(job)
        
        # Start background processing
        background_tasks.add_task(process_job, job)
        
        response = {
            "job_id": job.job_id,
            "status": job.status,
            "quality_preset": preset.value,
            "estimated_minutes": preset_config.estimated_minutes,
            "message": "Video uploaded and validated. Processing started."
        }
        
        if validation_result.warnings:
            response["warnings"] = validation_result.warnings
        
        if validation_result.video_info:
            response["video_info"] = {
                "duration": validation_result.video_info.duration,
                "resolution": f"{validation_result.video_info.width}x{validation_result.video_info.height}",
                "fps": validation_result.video_info.fps
            }
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading file: {e}", exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = str(e)
        await job_manager.update_job(job)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.get("/{job_id}/status")
async def get_job_status(job_id: str):
    """
    Get the current status of a job
    """
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    response = {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "error_message": job.error_message,
        "model_url": job.model_url,
        "model_url_compressed": job.model_url_compressed,
        "quality_preset": job.quality_preset.value if job.quality_preset else "balanced",
        "estimated_minutes": job.estimated_minutes,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat()
    }
    
    if job.validation:
        response["validation"] = {
            "duration": job.validation.duration,
            "resolution": f"{job.validation.width}x{job.validation.height}" if job.validation.width else None,
            "fps": job.validation.fps,
            "warnings": job.validation.warnings
        }
    
    return response


@router.get("/{job_id}/model")
async def download_model(job_id: str, compressed: bool = False):
    """
    Download the generated model file
    
    Args:
        job_id: Job ID
        compressed: If true, download gzip-compressed version (smaller file)
    """
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Job not completed. Current status: {job.status}"
        )
    
    if not job.model_filename:
        raise HTTPException(status_code=404, detail="Model file not found")
    
    # Check for compressed version if requested
    if compressed:
        compressed_filename = job.model_filename + ".gz"
        compressed_path = settings.MODELS_DIR / compressed_filename
        if compressed_path.exists():
            return FileResponse(
                path=str(compressed_path),
                filename=compressed_filename,
                media_type="application/gzip"
            )
    
    model_path = settings.MODELS_DIR / job.model_filename
    
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")
    
    return FileResponse(
        path=str(model_path),
        filename=job.model_filename,
        media_type="application/octet-stream"
    )

@router.get("/{job_id}/preview")
async def get_preview_url(job_id: str):
    """
    Get the preview URL for the model
    """
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != JobStatus.COMPLETED or not job.model_url:
        raise HTTPException(
            status_code=400,
            detail="Model not ready for preview"
        )
    
    return {
        "preview_url": job.model_url,
        "model_filename": job.model_filename
    }
