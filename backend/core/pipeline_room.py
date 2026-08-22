"""
Room reconstruction pipeline: zone keyframes → N Meshy jobs → scene manifest.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from core.config import QUALITY_PRESETS, QualityPreset, get_settings
from core.models import Job, JobStatus, KeyframeInfo, SceneManifest, ZoneMeshInfo
from core.pipeline import _extract_glb_metadata, _meshy_timeout_for_preset
from jobs.job_manager import get_job_manager
from services.meshy.camera_pose import (
    build_walk_path,
    estimate_yaw_by_index,
    measure_yaw_coverage,
    validate_room_coverage,
)
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
from services.meshy.zone_normalize import (
    aggregate_bbox,
    normalize_zone_glbs,
    placement_radius_from_bbox,
)
from services.video.extract_frames import extract_frames

logger = logging.getLogger(__name__)
settings = get_settings()


async def _run_zone_meshy(
    client: MeshyClient,
    zone_id: int,
    geometry_urls: List[str],
    preset_config,
    frame_yaws_deg: List[float],
    zone_center_yaw_deg: float,
    on_poll,
) -> Tuple[int, Optional[str], Optional[dict], Optional[str]]:
    try:
        kwargs = meshy_task_kwargs(
            preset_config,
            geometry_urls,
            zone_center_yaw_deg=zone_center_yaw_deg,
            frame_yaws_deg=frame_yaws_deg,
        )
        task_id = await client.create_multi_image_task(image_urls=geometry_urls, **kwargs)
        result = await client.poll_until_complete(task_id, on_poll=on_poll)
        return zone_id, task_id, result, None
    except Exception as e:
        return zone_id, None, None, str(e)


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

        yaw_by_index, used_uniform = estimate_yaw_by_index(
            frame_paths,
            fps=preset_config.fps,
            allow_uniform_fallback=False,
        )
        validate_room_coverage(yaw_by_index, n_zones, used_uniform_fallback=used_uniform)
        coverage = measure_yaw_coverage(yaw_by_index, n_zones)

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

        job.total_zones = n_zones
        walk_path = build_walk_path(frame_paths, yaw_by_index)

        all_keyframes: List[KeyframeInfo] = []
        zone_urls: Dict[int, List[str]] = {}
        candidates = frame_candidates_from_paths(
            frame_paths,
            yaw_by_index=yaw_by_index,
            sharpness_by_index=sharpness_by_index,
        )
        path_to_candidate = {c.path: c for c in candidates}
        path_to_index = {p: i for i, p in enumerate(frame_paths)}

        bucket = 360.0 / n_zones
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
        zone_results: Dict[int, tuple[str, dict]] = {}
        zone_errors: Dict[str, str] = {}
        sem = asyncio.Semaphore(settings.MESHY_MAX_PARALLEL_JOBS)

        async def process_zone(zone_id: int, urls: List[str], paths: List[Path]) -> None:
            zone_center_yaw = (zone_id + 0.5) * bucket
            frame_yaws = [
                yaw_by_index.get(path_to_index[p], 0.0)
                for p in paths
                if p in path_to_index
            ]

            async with sem:
                job.current_zone = zone_id
                await job_manager.update_job(job)

                async def on_poll(task: dict) -> None:
                    base = 0.15 + (zone_id / max(len(zone_urls), 1)) * 0.55
                    zone_span = 0.55 / max(len(zone_urls), 1)
                    progress = task.get("progress", 0)
                    job.progress = base + (progress / 100.0) * zone_span
                    await job_manager.update_job(job)

                zid, task_id, result, err = await _run_zone_meshy(
                    client,
                    zone_id,
                    urls,
                    preset_config,
                    frame_yaws,
                    zone_center_yaw,
                    on_poll,
                )
                if err:
                    zone_errors[str(zid)] = err
                    logger.warning("Zone %s Meshy failed: %s", zid, err)
                elif task_id and result:
                    zone_results[zid] = (task_id, result)

        job.status = JobStatus.SUBMITTING_RECONSTRUCTION
        job.progress = 0.15
        await job_manager.update_job(job)

        await asyncio.gather(*[
            process_zone(zid, urls, zones[zid])
            for zid, urls in zone_urls.items()
        ])

        if len(zone_results) < 2:
            detail = "; ".join(f"Zone {z}: {msg}" for z, msg in sorted(zone_errors.items()))
            raise ValueError(
                f"Room reconstruction failed — only {len(zone_results)} zone(s) succeeded. {detail}"
            )

        job.status = JobStatus.DOWNLOADING_MODEL
        job.progress = 0.75
        await job_manager.update_job(job)

        job_dir = settings.MODELS_DIR / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        for zone_id, (task_id, result) in sorted(zone_results.items()):
            glb_url = MeshyClient.best_glb_url(result)
            if not glb_url:
                zone_errors[str(zone_id)] = "No GLB URL in Meshy result"
                logger.warning("Zone %s: no GLB URL", zone_id)
                continue
            glb_path = job_dir / f"zone_{zone_id}.glb"
            await client.download_file(glb_url, str(glb_path))

        scale_factors, zone_bboxes = normalize_zone_glbs(job_dir, list(zone_results.keys()))
        agg_bbox = aggregate_bbox(list(zone_bboxes.values()))
        ref_height = None
        if zone_bboxes:
            heights = [b["max"][1] - b["min"][1] for b in zone_bboxes.values()]
            ref_height = sorted(heights)[len(heights) // 2] if heights else None

        radius = placement_radius_from_bbox(agg_bbox)
        transforms = compose_zone_transforms_for_ids(
            list(zone_results.keys()),
            n_zones=n_zones,
            radius=radius,
        )

        manifest_zones: List[ZoneMeshInfo] = []
        for zone_id, (task_id, _) in sorted(zone_results.items()):
            glb_path = job_dir / f"zone_{zone_id}.glb"
            if not glb_path.exists():
                continue
            manifest_zones.append(ZoneMeshInfo(
                id=zone_id,
                mesh_url=f"/api/jobs/{job.job_id}/zones/{zone_id}",
                meshy_task_id=task_id,
                transform=transforms.get(zone_id, transforms.get(list(transforms.keys())[0])),
            ))

        if len(manifest_zones) < 2:
            detail = "; ".join(f"Zone {z}: {msg}" for z, msg in sorted(zone_errors.items()))
            raise ValueError(
                f"Room reconstruction produced only {len(manifest_zones)} zone mesh(es). {detail}"
            )

        shell_url = None
        if preset_config.room_shell_enabled:
            job.status = JobStatus.COMPOSING_SCENE
            job.progress = 0.85
            await job_manager.update_job(job)
            flat_paths = [p for paths in zones.values() for p in paths]
            yaw_by_path = {p: yaw_by_index.get(path_to_index[p], 0.0) for p in flat_paths}
            shell_path = create_room_shell(
                job.job_id,
                settings.MODELS_DIR,
                flat_paths,
                aggregated_bbox=agg_bbox,
                n_zones=n_zones,
                yaw_by_path=yaw_by_path,
            )
            if shell_path:
                shell_url = f"/api/jobs/{job.job_id}/shell"

        manifest = SceneManifest(
            composition_mode="zone_mesh",
            zones=manifest_zones,
            shell_url=shell_url,
            walk_path=walk_path,
            zone_errors=zone_errors or None,
            zone_count=len(manifest_zones),
            coverage_span_deg=float(coverage["span_deg"]),
            normalization_ref_height=ref_height,
        )
        job.scene_manifest = manifest

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
                if agg_bbox:
                    meta.bounding_box = agg_bbox
                job.model_metadata = meta

        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.processing_time_seconds = round(time.time() - start_time, 1)
        job.current_zone = None
        await job_manager.update_job(job)

        logger.info(
            "Room job %s completed in %ss (%d/%d zones, %d errors)",
            job.job_id,
            job.processing_time_seconds,
            len(manifest_zones),
            n_zones,
            len(zone_errors),
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
