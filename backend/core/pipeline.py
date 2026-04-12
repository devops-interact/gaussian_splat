"""
High-level orchestration of the processing pipeline
"""
import asyncio
import logging
import time
from pathlib import Path
from typing import Optional
from core.config import get_settings, QUALITY_PRESETS, QualityPreset
from core.models import Job, JobStatus, ModelMetadata
from jobs.job_manager import get_job_manager
from services.video.extract_frames import extract_frames
from services.longsplat.train import train_longsplat
from services.export.to_ply import export_to_ply
from services.export.to_obj import export_to_obj
from services.export.compress import compress_ply_gzip

logger = logging.getLogger(__name__)
settings = get_settings()


def _extract_ply_metadata(ply_path: Path) -> Optional[ModelMetadata]:
    """Extract metadata from a PLY file for the API response."""
    try:
        from plyfile import PlyData
        import numpy as np
        
        file_size = ply_path.stat().st_size
        plydata = PlyData.read(str(ply_path))
        vertex = plydata['vertex']
        num_points = len(vertex.data)
        prop_names = [prop.name for prop in vertex.properties]
        
        has_colors = 'f_dc_0' in prop_names or 'red' in prop_names
        has_opacity = 'opacity' in prop_names
        
        # Bounding box
        x = vertex['x']
        y = vertex['y']
        z = vertex['z']
        
        bbox = {
            "min": [float(np.min(x)), float(np.min(y)), float(np.min(z))],
            "max": [float(np.max(x)), float(np.max(y)), float(np.max(z))],
        }
        
        # Detect format
        fmt = "binary_little_endian"
        if hasattr(plydata, 'header'):
            header_str = str(plydata.header)
            if 'ascii' in header_str:
                fmt = "ascii"
            elif 'big_endian' in header_str:
                fmt = "binary_big_endian"
        
        return ModelMetadata(
            file_size=file_size,
            point_count=num_points,
            has_colors=has_colors,
            has_opacity=has_opacity,
            bounding_box=bbox,
            properties=prop_names,
            format=fmt,
        )
    except Exception as e:
        logger.warning(f"Failed to extract PLY metadata: {e}")
        return None


async def process_job(job: Job) -> Job:
    """
    Execute the full processing pipeline for a job
    """
    try:
        job_manager = get_job_manager()
        start_time = time.time()
        
        # Get preset configuration
        preset = job.quality_preset or QualityPreset.BALANCED
        preset_config = QUALITY_PRESETS[preset]
        
        logger.info(f"Processing job {job.job_id} with preset: {preset.value}")
        logger.info(f"Preset config: FPS={preset_config.fps}, iterations={preset_config.iterations}, resolution={preset_config.resolution}")
        phase_times: dict[str, float] = {}
        phase_t0 = time.perf_counter()

        def _phase(name: str) -> None:
            nonlocal phase_t0
            now = time.perf_counter()
            phase_times[name] = now - phase_t0
            phase_t0 = now

        # Update job status
        job.status = JobStatus.EXTRACTING_FRAMES
        job.progress = 0.1
        await job_manager.update_job(job)
        
        # Step 1: Extract frames using preset FPS
        video_path = settings.UPLOADS_DIR / job.video_filename
        frames_dir = settings.FRAMES_DIR / job.job_id
        
        logger.info(f"Extracting frames from {video_path} at {preset_config.fps} FPS")
        phase_t0 = time.perf_counter()
        frames_dir = await extract_frames(video_path, frames_dir, preset_config.fps)
        _phase("extract_frames")
        
        job.status = JobStatus.TRAINING
        job.progress = 0.3
        await job_manager.update_job(job)
        
        # Step 2: Train LongSplat with preset settings
        logger.info(f"Training LongSplat model for job {job.job_id}")
        longsplat_output_dir = settings.MODELS_DIR / job.job_id
        longsplat_output_dir.mkdir(parents=True, exist_ok=True)
        
        training_success = await train_longsplat(
            frames_dir,
            longsplat_output_dir,
            iterations=preset_config.iterations,
            resolution=preset_config.resolution,
            init_ratio=preset_config.init_frames_ratio,
            convert_prune_ratio=preset_config.convert_3dgs_prune_ratio,
        )
        _phase("train_longsplat")
        
        if not training_success:
            raise Exception("LongSplat training failed. Check logs for details.")
        
        job.status = JobStatus.EXPORTING
        job.progress = 0.85
        await job_manager.update_job(job)
        
        # Step 3: Export to PLY (LongSplat already generates PLY, just copy it)
        logger.info(f"Exporting model to PLY for job {job.job_id}")
        ply_path = await export_to_ply(longsplat_output_dir, job.job_id)
        _phase("export_to_ply")
        
        if not ply_path:
            raise Exception("Failed to export PLY file")
        
        # Step 4: Compress the output
        job.status = JobStatus.COMPRESSING
        job.progress = 0.92
        await job_manager.update_job(job)
        
        if settings.COMPRESS_OUTPUT:
            logger.info(f"Compressing model for job {job.job_id}")
            try:
                compressed_path = await asyncio.get_event_loop().run_in_executor(
                    None, compress_ply_gzip, ply_path
                )
                job.model_url_compressed = f"/static/models/{job.job_id}.ply.gz"
                logger.info(f"Compressed model saved to {compressed_path}")
            except Exception as e:
                logger.warning(f"Compression failed (optional): {e}")
        _phase("compress_gzip")
        
        # Step 5: Optionally export to OBJ (experimental; slow on dense PLYs)
        job.progress = 0.96
        await job_manager.update_job(job)

        job.model_url_obj = None
        if settings.EXPORT_OBJ:
            try:
                obj_path = await export_to_obj(ply_path, longsplat_output_dir / f"{job.job_id}.obj")
                job.model_url_obj = f"/static/models/{job.job_id}/{job.job_id}.obj"
                logger.info(f"Exported OBJ to {obj_path}")
            except Exception as e:
                logger.warning(f"OBJ export failed (optional): {e}")
        else:
            logger.info("Skipping OBJ export (EXPORT_OBJ=false); set EXPORT_OBJ=true to enable.")
        _phase("export_obj")

        # Extract PLY metadata
        job.progress = 0.98
        await job_manager.update_job(job)
        
        metadata = _extract_ply_metadata(ply_path)
        _phase("ply_metadata")
        if metadata:
            job.model_metadata = metadata
            logger.info(f"Model metadata: {metadata.point_count} points, {metadata.file_size} bytes, colors={metadata.has_colors}")
        
        # Finalize job
        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.model_filename = f"{job.job_id}.ply"
        # Viewer fetch must hit /api/... so gzip is decompressed and CORP is set for COEP pages
        job.model_url = f"/api/jobs/{job.job_id}/model"
        job.processing_time_seconds = round(time.time() - start_time, 1)
        await job_manager.update_job(job)

        parts = ", ".join(f"{k}={v:.1f}s" for k, v in sorted(phase_times.items(), key=lambda x: -x[1]))
        logger.info(f"Job {job.job_id} phase timings: {parts} (total {job.processing_time_seconds}s)")
        logger.info(f"Job {job.job_id} completed successfully in {job.processing_time_seconds}s")
        return job
        
    except Exception as e:
        logger.error(f"Error processing job {job.job_id}: {e}", exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = str(e)
        await job_manager.update_job(job)
        return job
