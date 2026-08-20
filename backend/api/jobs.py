"""
API endpoints for job management
"""
import json
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form, Depends, Request
from fastapi.responses import FileResponse, Response
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session

from core.models import Job, JobStatus, VideoValidation
from core.config import get_settings, QualityPreset, QUALITY_PRESETS
from core.pipeline import process_job
from jobs.job_manager import get_job_manager
from services.video.validate import validate_video
from database import get_db
from models.db_models import Project, Scan
from api.auth import get_current_user_optional
from models.db_models import User

import aiofiles

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


@router.post("/upload")
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    quality_preset: str = Form(default="balanced"),
    project_id: Optional[int] = Form(default=None),
    scan_id: Optional[int] = Form(default=None),
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    try:
        preset = QualityPreset(quality_preset)
    except ValueError:
        preset = QualityPreset.BALANCED
        logger.warning(f"Invalid preset '{quality_preset}', using balanced")

    preset_config = QUALITY_PRESETS[preset]

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {settings.ALLOWED_EXTENSIONS}",
        )

    job_manager = get_job_manager()
    job = await job_manager.create_job(file.filename)
    job.quality_preset = preset
    job.estimated_minutes = preset_config.estimated_minutes

    video_filename = f"{job.job_id}{file_ext}"
    video_path = settings.UPLOADS_DIR / video_filename

    try:
        async with aiofiles.open(video_path, 'wb') as f:
            content = await file.read()
            await f.write(content)

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
            warnings=validation_result.warnings,
        )

        if not validation_result.valid:
            job.status = JobStatus.ERROR
            job.error_message = "; ".join(validation_result.errors)
            await job_manager.update_job(job)
            video_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Video validation failed",
                    "errors": validation_result.errors,
                    "warnings": validation_result.warnings,
                },
            )

        job.video_filename = video_filename
        job.status = JobStatus.UPLOADED
        await job_manager.update_job(job)

        scan = None
        if project_id:
            if not current_user:
                raise HTTPException(status_code=401, detail="Authentication required to link to project")
            project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
            if scan_id:
                scan = db.query(Scan).filter(Scan.id == scan_id, Scan.project_id == project_id).first()
                if not scan:
                    raise HTTPException(status_code=404, detail="Scan not found")
            else:
                scan = Scan(project_id=project_id, job_id=job.job_id, name="")
                db.add(scan)
                db.commit()
                db.refresh(scan)
            if scan:
                scan.job_id = job.job_id
                db.commit()

        background_tasks.add_task(process_job, job)

        response = {
            "job_id": job.job_id,
            "scan_id": scan.id if scan else None,
            "project_id": project_id if scan else None,
            "status": job.status,
            "quality_preset": preset.value,
            "estimated_minutes": preset_config.estimated_minutes,
            "message": "Video uploaded and validated. AI reconstruction started.",
        }

        if validation_result.warnings:
            response["warnings"] = validation_result.warnings

        if validation_result.video_info:
            response["video_info"] = {
                "duration": validation_result.video_info.duration,
                "resolution": f"{validation_result.video_info.width}x{validation_result.video_info.height}",
                "fps": validation_result.video_info.fps,
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
async def get_job_status(job_id: str, request: Request):
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)

    if not job:
        client = request.client.host if request.client else None
        logger.warning(
            "job_status_miss job_id=%s client_host=%s path=%s jobs_file=%s",
            job_id, client, request.url.path, job_manager.jobs_file,
        )
        raise HTTPException(status_code=404, detail="Job not found")

    response = {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "error_message": job.error_message,
        "model_url": job.model_url,
        "model_url_obj": job.model_url_obj,
        "quality_preset": job.quality_preset.value if job.quality_preset else "balanced",
        "estimated_minutes": job.estimated_minutes,
        "processing_time_seconds": job.processing_time_seconds,
        "meshy_task_id": job.meshy_task_id,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }

    if job.validation:
        response["validation"] = {
            "duration": job.validation.duration,
            "resolution": f"{job.validation.width}x{job.validation.height}" if job.validation.width else None,
            "fps": job.validation.fps,
            "warnings": job.validation.warnings,
        }

    if job.model_metadata:
        md = job.model_metadata
        response["model_metadata"] = {
            "file_size": md.file_size,
            "vertex_count": md.vertex_count,
            "face_count": md.face_count,
            "point_count": md.point_count or md.vertex_count,
            "has_colors": md.has_colors,
            "has_pbr": md.has_pbr,
            "bounding_box": md.bounding_box,
            "format": md.format,
            "thumbnail_url": md.thumbnail_url,
            "meshy_task_id": md.meshy_task_id,
        }

    return response


@router.get("/{job_id}/model")
async def download_model(job_id: str):
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail=f"Job not completed. Current status: {job.status}")

    if not job.model_filename:
        raise HTTPException(status_code=404, detail="Model file not found")

    model_path = settings.MODELS_DIR / job.model_filename
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    return FileResponse(
        path=str(model_path),
        filename=job.model_filename,
        media_type="model/gltf-binary",
        headers={"Cross-Origin-Resource-Policy": "cross-origin"},
    )


@router.get("/{job_id}/thumbnail")
async def get_thumbnail(job_id: str):
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)
    if not job or not job.model_metadata or not job.model_metadata.thumbnail_url:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=job.model_metadata.thumbnail_url)


@router.get("/{job_id}/preview")
async def get_preview_url(job_id: str):
    job_manager = get_job_manager()
    job = await job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.COMPLETED or not job.model_url:
        raise HTTPException(status_code=400, detail="Model not ready for preview")

    return {
        "preview_url": job.model_url,
        "model_filename": job.model_filename,
    }


@router.post("/webhooks/meshy")
async def meshy_webhook(request: Request):
    """Optional webhook for Meshy task completion (future use)."""
    body = await request.json()
    logger.info("Meshy webhook received: %s", json.dumps(body)[:500])
    return {"ok": True}
