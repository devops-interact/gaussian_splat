"""
Room reconstruction pipeline: environment-first shell + optional zone detail meshes.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from core.config import QUALITY_PRESETS, QualityPreset, get_settings
from core.models import Job, JobStatus, KeyframeInfo, SceneManifest, ZoneMeshInfo
from core.pipeline import _extract_glb_metadata, _meshy_timeout_for_preset
from jobs.job_manager import get_job_manager
from services.meshy.architectural_scoring import architecture_scores_by_index
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
    select_alternate_zone_keyframes,
    select_zone_keyframes,
)
from services.meshy.mesh_quality import mesh_passes_quality_gate
from services.meshy.meshy_params import meshy_task_kwargs
from services.meshy.person_filter import person_flags_by_index
from services.meshy.room_shell import create_room_shell, estimate_room_envelope
from services.meshy.scene_compose import compose_zone_transforms_for_ids
from services.meshy.storage_upload import publish_keyframes
from services.meshy.zone_normalize import (
    aggregate_bbox,
    align_zones_to_floor_origin,
    dedupe_similar_zones,
    glb_bbox,
    glb_vertex_count,
    normalize_zone_glbs,
    zones_are_similar,
)
from services.video.extract_frames import extract_frames
from services.video.orientation import probe_video_orientation

logger = logging.getLogger(__name__)

MIN_ZONE_VERTS_FOR_SHELL = 500
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


def _zone_duplicate_of_existing(
    job_dir: Path,
    zone_id: int,
    kept_zone_ids: List[int],
) -> Optional[int]:
    """Return zone id that zone_id duplicates, if any."""
    path = job_dir / f"zone_{zone_id}.glb"
    bbox = glb_bbox(path)
    if not bbox:
        return None
    from services.meshy.zone_normalize import glb_content_hash, glb_vertex_count

    verts = glb_vertex_count(path)
    h = glb_content_hash(path)
    for other in kept_zone_ids:
        other_path = job_dir / f"zone_{other}.glb"
        if not other_path.exists():
            continue
        other_bbox = glb_bbox(other_path)
        if not other_bbox:
            continue
        if zones_are_similar(
            bbox,
            other_bbox,
            verts,
            glb_vertex_count(other_path),
            hash_a=h,
            hash_b=glb_content_hash(other_path),
        ):
            return other
    return None


async def _process_zone_with_retry(
    client: MeshyClient,
    job: Job,
    job_manager,
    zone_id: int,
    initial_paths: List[Path],
    frame_paths: List[Path],
    preset_config,
    path_to_index: Dict[Path, int],
    yaw_by_index: dict,
    sharpness_by_index: dict,
    architecture_by_index: dict,
    person_by_index: Optional[dict],
    bucket: float,
    sem: asyncio.Semaphore,
    zone_urls_out: Dict[int, List[str]],
) -> Tuple[Optional[Tuple[int, str, dict]], str, Set[int]]:
    """
    Run Meshy for a zone with retries on object-like or duplicate meshes.

    Returns (zone_result or None, error_message, used_frame_indices).
    """
    max_retries = preset_config.zone_mesh_max_retries
    used_indices: Set[int] = set()
    paths = list(initial_paths)
    last_error = ""

    for attempt in range(max_retries + 1):
        if attempt > 0:
            paths = select_alternate_zone_keyframes(
                frame_paths,
                zone_id,
                n_zones=preset_config.n_zones,
                max_per_zone=preset_config.max_keyframes,
                yaw_by_index=yaw_by_index,
                sharpness_by_index=sharpness_by_index,
                architecture_by_index=architecture_by_index,
                person_by_index=person_by_index,
                min_architecture=preset_config.min_architecture_score,
                exclude_indices=used_indices,
            )
            if not paths:
                break

        used_indices.update(path_to_index.get(p, -1) for p in paths if p in path_to_index)
        urls = publish_keyframes(job.job_id, paths, zone_id=zone_id)
        zone_urls_out[zone_id] = urls

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
                base = 0.35 + (zone_id / max(preset_config.n_zones, 1)) * 0.35
                zone_span = 0.35 / max(preset_config.n_zones, 1)
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
            last_error = err
            logger.warning("Zone %s Meshy attempt %d failed: %s", zone_id, attempt, err)
            continue

        if not task_id or not result:
            last_error = "Empty Meshy result"
            continue

        glb_url = MeshyClient.best_glb_url(result)
        if not glb_url:
            last_error = "No GLB URL in Meshy result"
            continue

        job_dir = settings.MODELS_DIR / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        glb_path = job_dir / f"zone_{zone_id}.glb"
        await client.download_file(glb_url, str(glb_path))

        if not mesh_passes_quality_gate(glb_path):
            last_error = "Mesh classified as dominant object (not room detail)"
            logger.info("Zone %s rejected by quality gate (attempt %d)", zone_id, attempt)
            continue

        return (zone_id, task_id, result), "", used_indices

    return None, last_error or "All retry attempts failed", used_indices


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

        orient = probe_video_orientation(video_path)
        rotation_deg = orient.rotation_deg if orient else 0
        is_portrait = orient.is_portrait if orient else bool(
            job.validation and job.validation.is_portrait
        )
        if orient:
            logger.info(
                "Video orientation for job %s: %s %s (rotation=%d°)",
                job.job_id,
                orient.label,
                orient.aspect_label,
                orient.rotation_deg,
            )

        await extract_frames(
            video_path,
            frames_dir,
            preset_config.fps,
            rotation_deg=rotation_deg,
        )

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
            is_portrait=is_portrait,
        )
        validate_room_coverage(yaw_by_index, n_zones, used_uniform_fallback=used_uniform)
        coverage = measure_yaw_coverage(yaw_by_index, n_zones)
        coverage_span = float(coverage["span_deg"])

        sharpness_by_index = {i: laplacian_sharpness(p) for i, p in enumerate(frame_paths)}
        architecture_by_index = architecture_scores_by_index(frame_paths, is_portrait=is_portrait)
        person_by_index = None
        if preset_config.exclude_person_frames:
            person_by_index = person_flags_by_index(
                frame_paths,
                hit_threshold=preset_config.person_hog_hit_threshold,
                min_confidence=preset_config.person_min_confidence,
                is_portrait=is_portrait,
            )

        zones = select_zone_keyframes(
            frame_paths,
            n_zones=n_zones,
            max_per_zone=preset_config.max_keyframes,
            yaw_by_index=yaw_by_index,
            sharpness_by_index=sharpness_by_index,
            architecture_by_index=architecture_by_index,
            person_by_index=person_by_index,
            min_architecture=preset_config.min_architecture_score,
        )
        if not zones:
            raise ValueError("No zone keyframes selected — walk the full room in your video")

        job.total_zones = n_zones
        walk_path = build_walk_path(frame_paths, yaw_by_index)
        path_to_index = {p: i for i, p in enumerate(frame_paths)}
        architecture_by_path = {p: architecture_by_index[i] for p, i in path_to_index.items()}
        yaw_by_path = {p: yaw_by_index[i] for p, i in path_to_index.items()}

        all_keyframes: List[KeyframeInfo] = []
        zone_urls: Dict[int, List[str]] = {}
        candidates = frame_candidates_from_paths(
            frame_paths,
            yaw_by_index=yaw_by_index,
            sharpness_by_index=sharpness_by_index,
        )
        path_to_candidate = {c.path: c for c in candidates}

        bucket = 360.0 / n_zones
        for zone_id, paths in sorted(zones.items()):
            urls = publish_keyframes(job.job_id, paths, zone_id=zone_id)
            zone_urls[zone_id] = urls
            for i, p in enumerate(paths):
                c = path_to_candidate.get(p)
                idx = c.index if c else path_to_index.get(p, i)
                all_keyframes.append(KeyframeInfo(
                    url=urls[i] if i < len(urls) else "",
                    index=idx,
                    zone_id=zone_id,
                    yaw_deg=c.yaw_deg if c else None,
                    sharpness=c.sharpness if c else None,
                    person_detected=bool(person_by_index.get(idx, False)) if person_by_index else False,
                ))
        job.keyframes = all_keyframes
        await job_manager.update_job(job)

        # Environment-first: build room shell before optional zone Meshy jobs
        job.status = JobStatus.COMPOSING_SCENE
        job.progress = 0.22
        await job_manager.update_job(job)

        flat_paths = list(frame_paths)
        shell_path = None
        if preset_config.room_shell_enabled:
            shell_path = create_room_shell(
                job.job_id,
                settings.MODELS_DIR,
                flat_paths,
                coverage_span_deg=coverage_span,
                orbit_radius_m=preset_config.room_orbit_radius_m,
                default_height_m=preset_config.room_default_height_m,
                n_zones=n_zones,
                yaw_by_path=yaw_by_path,
                architecture_by_path=architecture_by_path,
            )

        if preset_config.room_shell_required and not shell_path:
            raise ValueError(
                "Room shell could not be created — record a longer 360° walkthrough "
                "(30+ seconds, full room visible)."
            )

        client = MeshyClient(
            api_key=settings.MESHY_API_KEY,
            poll_interval_s=settings.MESHY_POLL_INTERVAL_S,
            timeout_s=meshy_timeout,
        )

        job.status = JobStatus.RECONSTRUCTING
        zone_results: Dict[int, tuple[str, dict]] = {}
        zone_errors: Dict[str, str] = {}
        sem = asyncio.Semaphore(settings.MESHY_MAX_PARALLEL_JOBS)

        job.status = JobStatus.SUBMITTING_RECONSTRUCTION
        job.progress = 0.28
        await job_manager.update_job(job)

        async def run_zone(zone_id: int, paths: List[Path]) -> None:
            result, err, _ = await _process_zone_with_retry(
                client,
                job,
                job_manager,
                zone_id,
                paths,
                frame_paths,
                preset_config,
                path_to_index,
                yaw_by_index,
                sharpness_by_index,
                architecture_by_index,
                person_by_index,
                bucket,
                sem,
                zone_urls,
            )
            if result:
                zid, task_id, meshy_result = result
                zone_results[zid] = (task_id, meshy_result)
            elif err:
                zone_errors[str(zone_id)] = err

        await asyncio.gather(*[
            run_zone(zid, zones[zid])
            for zid in sorted(zones.keys())
        ])

        if not shell_path and len(zone_results) < 2:
            detail = "; ".join(f"Zone {z}: {msg}" for z, msg in sorted(zone_errors.items()))
            raise ValueError(
                f"Room reconstruction failed — no shell and only {len(zone_results)} zone(s). {detail}"
            )

        job.status = JobStatus.DOWNLOADING_MODEL
        job.progress = 0.72
        await job_manager.update_job(job)

        job_dir = settings.MODELS_DIR / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        kept_zone_ids: List[int] = []
        for zone_id in sorted(zone_results.keys()):
            glb_path = job_dir / f"zone_{zone_id}.glb"
            if not glb_path.exists():
                zone_errors[str(zone_id)] = "GLB file missing after download"
                continue
            dup_of = _zone_duplicate_of_existing(job_dir, zone_id, kept_zone_ids)
            if dup_of is not None:
                zone_errors[str(zone_id)] = f"Duplicate of zone {dup_of} (near-identical mesh)"
                glb_path.unlink(missing_ok=True)
                continue
            kept_zone_ids.append(zone_id)

        if kept_zone_ids:
            normalize_zone_glbs(job_dir, kept_zone_ids)
            zone_quality: Dict[int, float] = {}
            for zid, paths in zones.items():
                if zid not in kept_zone_ids:
                    continue
                scores = [
                    sharpness_by_index.get(path_to_index[p], 0.0)
                    * architecture_by_index.get(path_to_index[p], 0.5)
                    for p in paths
                    if p in path_to_index
                ]
                zone_quality[zid] = sum(scores) / len(scores) if scores else 0.0

            deduped_ids, dedupe_errors = dedupe_similar_zones(job_dir, kept_zone_ids, zone_quality)
            zone_errors.update(dedupe_errors)
            kept_zone_ids = deduped_ids
            zone_results = {zid: zone_results[zid] for zid in kept_zone_ids if zid in zone_results}

        zone_bboxes: Dict[int, dict] = {}
        if kept_zone_ids:
            aligned = align_zones_to_floor_origin(job_dir, kept_zone_ids)
            zone_bboxes.update(aligned)

        envelope = estimate_room_envelope(
            coverage_span_deg=coverage_span,
            orbit_radius_m=preset_config.room_orbit_radius_m,
            default_height_m=preset_config.room_default_height_m,
        )
        agg_bbox = aggregate_bbox(list(zone_bboxes.values())) if zone_bboxes else {
            "min": [-envelope["size_x"] / 2, 0, -envelope["size_z"] / 2],
            "max": [envelope["size_x"] / 2, envelope["size_y"], envelope["size_z"] / 2],
        }

        ref_height = envelope["size_y"]
        compose_radius = preset_config.zone_compose_radius
        transforms = compose_zone_transforms_for_ids(
            kept_zone_ids,
            n_zones=n_zones,
            radius=compose_radius,
        )

        manifest_zones: List[ZoneMeshInfo] = []
        for zone_id in sorted(kept_zone_ids):
            task_id, _ = zone_results[zone_id]
            glb_path = job_dir / f"zone_{zone_id}.glb"
            if not glb_path.exists():
                continue
            manifest_zones.append(ZoneMeshInfo(
                id=zone_id,
                mesh_url=f"/api/jobs/{job.job_id}/zones/{zone_id}",
                meshy_task_id=task_id,
                transform=transforms.get(zone_id, transforms.get(list(transforms.keys())[0])),
            ))

        shell_url = f"/api/jobs/{job.job_id}/shell" if shell_path and shell_path.exists() else None
        primary_geometry = "shell" if shell_url else "zones"

        manifest = SceneManifest(
            composition_mode="room_shell" if shell_url else "zone_mesh",
            primary_geometry=primary_geometry,
            zones=manifest_zones,
            shell_url=shell_url,
            walk_path=walk_path,
            zone_errors=zone_errors or None,
            zone_count=len(manifest_zones),
            coverage_span_deg=coverage_span,
            normalization_ref_height=ref_height,
        )
        job.scene_manifest = manifest

        if shell_path and shell_path.exists():
            compat = settings.MODELS_DIR / f"{job.job_id}.glb"
            import shutil
            shutil.copy2(shell_path, compat)
            job.model_filename = f"{job.job_id}.glb"
            job.model_url = f"/api/jobs/{job.job_id}/model"
            meta = _extract_glb_metadata(compat)
            if meta:
                meta.bounding_box = agg_bbox
                job.model_metadata = meta
        elif manifest_zones:
            primary = job_dir / f"zone_{manifest_zones[0].id}.glb"
            compat = settings.MODELS_DIR / f"{job.job_id}.glb"
            if primary.exists():
                import shutil
                shutil.copy2(primary, compat)
            job.model_filename = f"{job.job_id}.glb"
            job.model_url = f"/api/jobs/{job.job_id}/model"
            job.meshy_task_id = manifest_zones[0].meshy_task_id
            meta = _extract_glb_metadata(compat if compat.exists() else primary)
            if meta and agg_bbox:
                meta.bounding_box = agg_bbox
                job.model_metadata = meta

        job.status = JobStatus.COMPLETED
        job.progress = 1.0
        job.processing_time_seconds = round(time.time() - start_time, 1)
        job.current_zone = None
        await job_manager.update_job(job)

        logger.info(
            "Room job %s completed in %ss (shell=%s, %d zone meshes, %d errors)",
            job.job_id,
            job.processing_time_seconds,
            bool(shell_url),
            len(manifest_zones),
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
