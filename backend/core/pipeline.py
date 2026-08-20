"""
High-level orchestration: video → keyframes → Meshy multi-image-to-3D → GLB
"""
import logging
import time
from pathlib import Path
from typing import Optional

from core.config import get_settings, QUALITY_PRESETS, QualityPreset
from core.models import Job, JobStatus, ModelMetadata
from jobs.job_manager import get_job_manager
from services.video.extract_frames import extract_frames
from services.meshy.client import MeshyClient, MeshyError
from services.meshy.keyframe_selector import select_keyframes
from services.meshy.storage_upload import publish_keyframes

logger = logging.getLogger(__name__)
settings = get_settings()


def _extract_glb_metadata(glb_path: Path, thumbnail_url: Optional[str] = None) -> Optional[ModelMetadata]:
    try:
        import trimesh

        file_size = glb_path.stat().st_size
        scene = trimesh.load(str(glb_path), force="scene")
        if hasattr(scene, "geometry"):
            meshes = list(scene.geometry.values())
        else:
            meshes = [scene]

        total_verts = sum(len(m.vertices) for m in meshes if hasattr(m, "vertices"))
        total_faces = sum(len(m.faces) for m in meshes if hasattr(m, "faces"))

        bbox = None
        if meshes:
            bounds = scene.bounds if hasattr(scene, "bounds") else meshes[0].bounds
            bbox = {
                "min": bounds[0].tolist(),
                "max": bounds[1].tolist(),
            }

        return ModelMetadata(
            file_size=file_size,
            vertex_count=total_verts,
            face_count=total_faces,
            point_count=total_verts,
            has_colors=True,
            has_pbr=True,
            bounding_box=bbox,
            format="glb",
            thumbnail_url=thumbnail_url,
        )
    except Exception as e:
        logger.warning("Failed to extract GLB metadata: %s", e)
        return ModelMetadata(
            file_size=glb_path.stat().st_size if glb_path.exists() else None,
            format="glb",
            thumbnail_url=thumbnail_url,
        )


async def process_job(job: Job) -> Job:
    job_manager = get_job_manager()
    start_time = time.time()

    if not settings.MESHY_API_KEY:
        job.status = JobStatus.ERROR
        job.error_message = "MESHY_API_KEY is not configured"
        await job_manager.update_job(job)
        return job

    try:
        preset = job.quality_preset or QualityPreset.BALANCED
        preset_config = QUALITY_PRESETS[preset]
        logger.info("Processing job %s preset=%s", job.job_id, preset.value)

        # Extract frames
        job.status = JobStatus.EXTRACTING_FRAMES
        job.progress = 0.15
        await job_manager.update_job(job)

        video_path = settings.UPLOADS_DIR / job.video_filename
        frames_dir = settings.FRAMES_DIR / job.job_id
        await extract_frames(video_path, frames_dir, preset_config.fps)

        # Select keyframes
        job.status = JobStatus.SELECTING_KEYFRAMES
        job.progress = 0.25
        await job_manager.update_job(job)

        keyframes = select_keyframes(frames_dir, max_frames=preset_config.max_keyframes)
        image_urls = publish_keyframes(job.job_id, keyframes)

        # Submit to Meshy
        job.status = JobStatus.SUBMITTING_RECONSTRUCTION
        job.progress = 0.35
        await job_manager.update_job(job)

        client = MeshyClient(
            api_key=settings.MESHY_API_KEY,
            poll_interval_s=settings.MESHY_POLL_INTERVAL_S,
            timeout_s=settings.MESHY_TIMEOUT_S,
        )

        task_id = await client.create_multi_image_task(
            image_urls=image_urls,
            ai_model=preset_config.ai_model,
            should_texture=preset_config.should_texture,
            enable_pbr=preset_config.enable_pbr,
            texture_resolution=preset_config.texture_resolution,
            target_polycount=preset_config.target_polycount,
            should_remesh=preset_config.should_remesh,
            ultra_mode=preset_config.ultra_mode,
            target_formats=["glb", "obj"],
        )
        job.meshy_task_id = task_id

        job.status = JobStatus.RECONSTRUCTING
        job.progress = 0.45
        await job_manager.update_job(job)

        async def on_poll(task: dict) -> None:
            progress = task.get("progress", 0)
            job.progress = 0.35 + (progress / 100.0) * 0.50
            await job_manager.update_job(job)

        result = await _poll_with_updates(client, task_id, on_poll)

        # Download GLB
        job.status = JobStatus.DOWNLOADING_MODEL
        job.progress = 0.90
        await job_manager.update_job(job)

        model_urls = result.get("model_urls") or {}
        glb_url = model_urls.get("glb") or model_urls.get("pre_remeshed_glb")
        if not glb_url:
            raise MeshyError("Meshy task succeeded but no GLB URL returned")

        glb_path = settings.MODELS_DIR / f"{job.job_id}.glb"
        await client.download_file(glb_url, str(glb_path))

        obj_url = model_urls.get("obj")
        if obj_url:
            obj_path = settings.MODELS_DIR / job.job_id / f"{job.job_id}.obj"
            try:
                await client.download_file(obj_url, str(obj_path))
                job.model_url_obj = f"/static/models/{job.job_id}/{job.job_id}.obj"
            except Exception as e:
                logger.warning("Optional OBJ download failed: %s", e)

        thumbnail_url = result.get("thumbnail_url")
        metadata = _extract_glb_metadata(glb_path, thumbnail_url=thumbnail_url)
        if metadata:
            metadata.meshy_task_id = task_id
            job.model_metadata = metadata

        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.model_filename = f"{job.job_id}.glb"
        job.model_url = f"/api/jobs/{job.job_id}/model"
        job.processing_time_seconds = round(time.time() - start_time, 1)
        await job_manager.update_job(job)

        logger.info(
            "Job %s completed in %ss (Meshy task %s)",
            job.job_id,
            job.processing_time_seconds,
            task_id,
        )
        return job

    except Exception as e:
        logger.error("Error processing job %s: %s", job.job_id, e, exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = str(e)
        await job_manager.update_job(job)
        return job


async def _poll_with_updates(client: MeshyClient, task_id: str, on_poll) -> dict:
    import asyncio

    deadline = asyncio.get_event_loop().time() + client.timeout_s
    while asyncio.get_event_loop().time() < deadline:
        task = await client.get_task(task_id)
        await on_poll(task)
        status = task.get("status", "").upper()
        if status == "SUCCEEDED":
            return task
        if status == "FAILED":
            err = task.get("task_error") or task.get("message") or task
            raise MeshyError(f"Meshy task failed: {err}")
        await asyncio.sleep(client.poll_interval_s)
    raise MeshyError(f"Meshy task {task_id} timed out")
