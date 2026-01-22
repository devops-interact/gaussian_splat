"""
API endpoints for job management
"""
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pathlib import Path
from core.models import Job, JobStatus
from core.config import get_settings
from core.pipeline import process_job
from jobs.job_manager import get_job_manager
import aiofiles
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

@router.post("/upload")
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """
    Upload a video file and start processing
    """
    # Validate file extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {settings.ALLOWED_EXTENSIONS}"
        )
    
    # Create job
    job_manager = get_job_manager()
    job = await job_manager.create_job(file.filename)
    
    # Save uploaded file
    video_filename = f"{job.job_id}{file_ext}"
    video_path = settings.UPLOADS_DIR / video_filename
    
    try:
        async with aiofiles.open(video_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Update job with saved filename
        job.video_filename = video_filename
        await job_manager.update_job(job)
        
        # Start background processing
        background_tasks.add_task(process_job, job)
        
        return {
            "job_id": job.job_id,
            "status": job.status,
            "message": "Video uploaded successfully. Processing started."
        }
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
    
    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "error_message": job.error_message,
        "model_url": job.model_url,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat()
    }

@router.get("/{job_id}/model")
async def download_model(job_id: str):
    """
    Download the generated model file
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
