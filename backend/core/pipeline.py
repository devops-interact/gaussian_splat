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
from services.sfm.estimate_poses import estimate_camera_poses
from services.gaussian.train import train_gaussian_splatting
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
        
        job.status = JobStatus.ESTIMATING_POSES
        job.progress = 0.3
        await job_manager.update_job(job)
        
        # Step 2: Estimate camera poses
        logger.info(f"Estimating camera poses for job {job.job_id}")
        colmap_output_dir = settings.FRAMES_DIR / job.job_id / "colmap"
        poses_success = await estimate_camera_poses(frames_dir, colmap_output_dir)
        
        if not poses_success:
            raise Exception("Failed to estimate camera poses. Ensure COLMAP is installed and video has sufficient features.")
        
        job.status = JobStatus.TRAINING
        job.progress = 0.5
        await job_manager.update_job(job)
        
        # Step 3: Train Gaussian Splatting
        logger.info(f"Training Gaussian Splatting model for job {job.job_id}")
        gaussian_output_dir = settings.MODELS_DIR / job.job_id
        gaussian_output_dir.mkdir(parents=True, exist_ok=True)
        
        training_success = await train_gaussian_splatting(
            frames_dir, 
            colmap_output_dir, 
            gaussian_output_dir,
            iterations=settings.GAUSSIAN_ITERATIONS
        )
        
        if not training_success:
            raise Exception("Gaussian Splatting training failed. Check logs for details.")
        
        job.status = JobStatus.EXPORTING
        job.progress = 0.9
        await job_manager.update_job(job)
        
        # Step 4: Export to PLY
        logger.info(f"Exporting model to PLY for job {job.job_id}")
        ply_path = await export_to_ply(gaussian_output_dir, job.job_id)
        
        if not ply_path:
            raise Exception("Failed to export PLY file")
        
        # Step 5: Optionally export to OBJ
        try:
            obj_path = await export_to_obj(ply_path, gaussian_output_dir / f"{job.job_id}.obj")
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
