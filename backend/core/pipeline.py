"""
High-level orchestration of the processing pipeline
"""
import asyncio
import logging
from pathlib import Path
from typing import Optional
from core.config import get_settings
from core.models import Job, JobStatus
from jobs.job_manager import get_job_manager
from services.video.extract_frames import extract_frames
from services.longsplat.train import train_longsplat
from services.export.to_ply import export_to_ply
from services.export.to_obj import export_to_obj

logger = logging.getLogger(__name__)
settings = get_settings()

async def process_job(job: Job) -> Job:
    """
    Execute the full processing pipeline for a job
    """
    try:
        job_manager = get_job_manager()
        
        # Update job status
        job.status = JobStatus.EXTRACTING_FRAMES
        job.progress = 0.1
        await job_manager.update_job(job)
        
        # Step 1: Extract frames
        video_path = settings.UPLOADS_DIR / job.video_filename
        frames_dir = settings.FRAMES_DIR / job.job_id
        
        logger.info(f"Extracting frames from {video_path}")
        frames_dir = await extract_frames(video_path, frames_dir, settings.FRAME_EXTRACTION_FPS)
        
        job.status = JobStatus.TRAINING
        job.progress = 0.3
        await job_manager.update_job(job)
        
        # Step 2: Train LongSplat (handles pose estimation + reconstruction in one step!)
        logger.info(f"Training LongSplat model for job {job.job_id}")
        longsplat_output_dir = settings.MODELS_DIR / job.job_id
        longsplat_output_dir.mkdir(parents=True, exist_ok=True)
        
        training_success = await train_longsplat(
            frames_dir, 
            longsplat_output_dir,
            iterations=settings.LONGSPLAT_ITERATIONS
        )
        
        if not training_success:
            raise Exception("LongSplat training failed. Check logs for details.")
        
        job.status = JobStatus.EXPORTING
        job.progress = 0.9
        await job_manager.update_job(job)
        
        # Step 3: Export to PLY (LongSplat already generates PLY, just copy it)
        logger.info(f"Exporting model to PLY for job {job.job_id}")
        ply_path = await export_to_ply(longsplat_output_dir, job.job_id)
        
        if not ply_path:
            raise Exception("Failed to export PLY file")
        
        # Step 4: Optionally export to OBJ (experimental)
        try:
            obj_path = await export_to_obj(ply_path, longsplat_output_dir / f"{job.job_id}.obj")
            logger.info(f"Exported OBJ to {obj_path}")
        except Exception as e:
            logger.warning(f"OBJ export failed (optional): {e}")
        
        # Finalize job
        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.model_filename = f"{job.job_id}.ply"
        job.model_url = f"/static/models/{job.model_filename}"
        await job_manager.update_job(job)
        
        logger.info(f"Job {job.job_id} completed successfully")
        return job
        
    except Exception as e:
        logger.error(f"Error processing job {job.job_id}: {e}", exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = str(e)
        await job_manager.update_job(job)
        return job
