"""
Room reconstruction pipeline: zone keyframes → N Meshy jobs → scene manifest.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional

from core.config import QUALITY_PRESETS, QualityPreset, get_settings
from core.models import Job, JobStatus, KeyframeInfo, SceneManifest, ZoneMeshInfo
from core.pipeline import _extract_glb_metadata, _meshy_timeout_for_preset
from jobs.job_manager import get_job_manager
from services.meshy.camera_pose import build_walk_path, estimate_yaw_by_index
from services.meshy.client import MeshyClient, MeshyError
from services.meshy.keyframe_selector import (
    frame_candidates_from_paths,
    laplacian_sharpness,
    list_frame_paths,
    select_zone_keyframes,
)
from services.meshy.meshy_params import meshy_task_kwargs
from services.meshy.room_shell import create_room_shell
from services.meshy.scene_compose import compose_zone_transforms_for_ids
from services.meshy.storage_upload import publish_keyframes
from services.video.extract_frames import extract_frames

logger = logging.getLogger(__name__)
settings = get_settings()


async def _run_zone_meshy(
    client: MeshyClient,
    job: Job,
    zone_id: int,
    geometry_urls: List[str],
    preset_config,
    on_poll,
) -> tuple[int, str, dict]:
    kwargs = meshy_task_kwargs(preset_config, geometry_urls)
    task_id = await client.create_multi_image_task(image_urls=geometry_urls, **kwargs)
    result = await client.poll_until_complete(task_id, on_poll=on_poll)
    return zone_id, task_id, result


async def process_room_job(job: Job) -> Job:
    job_manager = get_job_manager()
    start_time = time.time()
    preset = job.quality_preset or QualityPreset.ROOM
    preset_config = QUALITY_PRESETS[preset]
    n_zones = preset_config.n_zones
    meshy_timeout = _meshy_timeout_for_preset(preset)

    if not settings.MESHY_API_KEY:
        job.status = JobStatus.ERROR
        job.error_message = "MESHY_API_KEY is not configured"
        await job_manager.update_job(job)
        return job

    try:
        job.status = JobStatus.EXTRACTING_FRAMES
        job.progress = 0.05
        await job_manager.update_job(job)

        video_path = settings.UPLOADS_DIR / job.video_filename
        frames_dir = settings.FRAMES_DIR / job.job_id
        await extract_frames(video_path, frames_dir, preset_config.fps)

        job.status = JobStatus.SELECTING_KEYFRAMES
        job.progress = 0.12
        await job_manager.update_job(job)

        frame_paths = list_frame_paths(frames_dir)
        if not frame_paths:
            raise ValueError(f"No frames found in {frames_dir}")

        yaw_by_index = estimate_yaw_by_index(frame_paths, fps=preset_config.fps)
        sharpness_by_index = {i: laplacian_sharpness(p) for i, p in enumerate(frame_paths)}

        zones = select_zone_keyframes(
            frame_paths,
            n_zones=n_zones,
            yaw_by_index=yaw_by_index,
            sharpness_by_index=sharpness_by_index,
        )
        if not zones:
            raise ValueError("No zone keyframes selected — walk the full room in your video")

        if len(zones) < 2:
            raise ValueError(
                f"Video needs a 360° walk — only {len(zones)} zone(s) found. "
                "Pan slowly around the full room while recording."
            )

        job.total_zones = len(zones)
        walk_path = build_walk_path(frame_paths, yaw_by_index)

        # Build keyframe metadata for API
        all_keyframes: List[KeyframeInfo] = []
        zone_urls: Dict[int, List[str]] = {}
        candidates = frame_candidates_from_paths(
            frame_paths,
            yaw_by_index=yaw_by_index,
            sharpness_by_index=sharpness_by_index,
        )
        path_to_candidate = {c.path: c for c in candidates}
        path_to_index = {p: i for i, p in enumerate(frame_paths)}

        zone_yaws: Dict[int, float] = {}
        for zone_id, paths in zones.items():
            yaws = [
                yaw_by_index.get(path_to_index[p], 0.0)
                for p in paths
                if p in path_to_index
            ]
            if yaws:
                zone_yaws[zone_id] = sum(yaws) / len(yaws)

        for zone_id, paths in sorted(zones.items()):
            urls = publish_keyframes(job.job_id, paths, zone_id=zone_id)
            zone_urls[zone_id] = urls
            for i, p in enumerate(paths):
                c = path_to_candidate.get(p)
                all_keyframes.append(KeyframeInfo(
                    url=urls[i] if i < len(urls) else "",
                    index=c.index if c else i,
                    zone_id=zone_id,
                    yaw_deg=c.yaw_deg if c else None,
                    sharpness=c.sharpness if c else None,
                ))
        job.keyframes = all_keyframes
        await job_manager.update_job(job)

        client = MeshyClient(
            api_key=settings.MESHY_API_KEY,
            poll_interval_s=settings.MESHY_POLL_INTERVAL_S,
            timeout_s=meshy_timeout,
        )

        job.status = JobStatus.RECONSTRUCTING
        transforms = compose_zone_transforms_for_ids(list(zones.keys()), zone_yaws)
        zone_results: Dict[int, tuple[str, dict]] = {}
        sem = asyncio.Semaphore(settings.MESHY_MAX_PARALLEL_JOBS)

        async def process_zone(zone_id: int, urls: List[str]) -> None:
            async with sem:
                job.current_zone = zone_id
                await job_manager.update_job(job)

                async def on_poll(task: dict) -> None:
                    base = 0.15 + (zone_id / max(len(zones), 1)) * 0.55
                    zone_span = 0.55 / max(len(zones), 1)
                    progress = task.get("progress", 0)
                    job.progress = base + (progress / 100.0) * zone_span
                    await job_manager.update_job(job)

                zid, task_id, result = await _run_zone_meshy(
                    client, job, zone_id, urls, preset_config, on_poll
                )
                zone_results[zid] = (task_id, result)

        job.status = JobStatus.SUBMITTING_RECONSTRUCTION
        job.progress = 0.15
        await job_manager.update_job(job)

        await asyncio.gather(*[process_zone(zid, urls) for zid, urls in zone_urls.items()])

        job.status = JobStatus.DOWNLOADING_MODEL
        job.progress = 0.75
        await job_manager.update_job(job)

        job_dir = settings.MODELS_DIR / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        manifest_zones: List[ZoneMeshInfo] = []

        for zone_id, (task_id, result) in sorted(zone_results.items()):
            glb_url = MeshyClient.best_glb_url(result)
            if not glb_url:
                logger.warning("Zone %s: no GLB URL", zone_id)
                continue
            glb_path = job_dir / f"zone_{zone_id}.glb"
            await client.download_file(glb_url, str(glb_path))
            manifest_zones.append(ZoneMeshInfo(
                id=zone_id,
                mesh_url=f"/api/jobs/{job.job_id}/zones/{zone_id}",
                meshy_task_id=task_id,
                transform=transforms[zone_id],
            ))

        if len(manifest_zones) < 2:
            raise ValueError(
                f"Room reconstruction produced only {len(manifest_zones)} zone mesh(es). "
                "Check Meshy task logs or retry with better video coverage."
            )

        shell_url = None
        if preset_config.room_shell_enabled:
            job.status = JobStatus.COMPOSING_SCENE
            job.progress = 0.85
            await job_manager.update_job(job)
            flat_paths = [p for paths in zones.values() for p in paths]
            shell_path = create_room_shell(job.job_id, settings.MODELS_DIR, flat_paths)
            if shell_path:
                shell_url = f"/api/jobs/{job.job_id}/shell"

        manifest = SceneManifest(
            composition_mode="zone_mesh",
            zones=manifest_zones,
            shell_url=shell_url,
            walk_path=walk_path,
        )
        job.scene_manifest = manifest

        # Primary model = zone 0 for backward compat
        if manifest_zones:
            primary = job_dir / f"zone_{manifest_zones[0].id}.glb"
            compat = settings.MODELS_DIR / f"{job.job_id}.glb"
            if primary.exists():
                import shutil
                shutil.copy2(primary, compat)
            job.model_filename = f"{job.job_id}.glb"
            job.model_url = f"/api/jobs/{job.job_id}/model"
            job.meshy_task_id = manifest_zones[0].meshy_task_id

            meta = _extract_glb_metadata(compat if compat.exists() else primary)
            if meta:
                job.model_metadata = meta

        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.processing_time_seconds = round(time.time() - start_time, 1)
        job.current_zone = None
        await job_manager.update_job(job)

        logger.info(
            "Room job %s completed in %ss (%d zones)",
            job.job_id,
            job.processing_time_seconds,
            len(manifest_zones),
        )
        return job

    except MeshyError as e:
        msg = str(e)
        logger.error("Room job %s Meshy error: %s", job.job_id, msg, exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = msg
        await job_manager.update_job(job)
        return job
    except Exception as e:
        logger.error("Room job %s failed: %s", job.job_id, e, exc_info=True)
        job.status = JobStatus.ERROR
        job.error_message = str(e)
        await job_manager.update_job(job)
        return job
