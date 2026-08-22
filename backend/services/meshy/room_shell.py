"""Generate a textured room shell aligned to video-derived room envelope."""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import List, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

MIN_FRAMES_FOR_SHELL = 8
MIN_COVERAGE_DEG_FOR_SHELL = 200.0


def estimate_room_envelope(
    *,
    coverage_span_deg: float,
    orbit_radius_m: float = 2.5,
    default_height_m: float = 2.7,
) -> dict:
    """
    Estimate room width/depth/height from walkthrough coverage, not zone object bboxes.

    Returns dict with size_x, size_z, size_y, center_y.
    """
    span_rad = math.radians(max(coverage_span_deg, 90.0))
    # Chord length across arc + margin for partial pans
    width = max(2.0 * orbit_radius_m * math.sin(span_rad / 2.0) * 1.15, 3.0)
    depth = max(orbit_radius_m * 1.6, 3.0)
    height = default_height_m
    return {
        "size_x": width,
        "size_z": depth,
        "size_y": height,
        "center_y": height / 2.0,
    }


def _load_keyframe_image(path: Path):
    try:
        from PIL import Image
        return Image.open(path).convert("RGB")
    except Exception as e:
        logger.debug("Could not load keyframe %s: %s", path, e)
        return None


def _pick_frontal_keyframe(
    keyframe_paths: Sequence[Path],
    target_yaw_deg: float,
    yaw_by_path: Optional[Mapping[Path, float]] = None,
    architecture_by_path: Optional[Mapping[Path, float]] = None,
):
    if not keyframe_paths:
        return None

    def score_path(p: Path) -> tuple[float, float]:
        arch = architecture_by_path.get(p, 0.5) if architecture_by_path else 0.5
        if yaw_by_path:
            yaw = yaw_by_path.get(p, 0.0)
            d = abs((yaw % 360.0) - (target_yaw_deg % 360.0))
            d = min(d, 360.0 - d)
            return (-arch, d)
        return (-arch, 0.0)

    best = min(keyframe_paths, key=score_path)
    return _load_keyframe_image(best)


def should_create_shell(
    frame_count: int,
    coverage_span_deg: float,
) -> bool:
    return frame_count >= MIN_FRAMES_FOR_SHELL and coverage_span_deg >= MIN_COVERAGE_DEG_FOR_SHELL


def create_room_shell(
    job_id: str,
    models_dir: Path,
    keyframe_paths: Sequence[Path],
    *,
    coverage_span_deg: float = 360.0,
    orbit_radius_m: float = 2.5,
    default_height_m: float = 2.7,
    n_zones: int = 4,
    yaw_by_path: Optional[Mapping[Path, float]] = None,
    architecture_by_path: Optional[Mapping[Path, float]] = None,
    margin_ratio: float = 0.05,
) -> Optional[Path]:
    """
    Create a box shell GLB sized from video envelope with per-wall textures.
    Returns path to shell.glb or None on failure.
    """
    if not keyframe_paths:
        return None

    if not should_create_shell(len(keyframe_paths), coverage_span_deg):
        logger.info(
            "Room shell skipped — need >=%d frames and >=%.0f° coverage",
            MIN_FRAMES_FOR_SHELL,
            MIN_COVERAGE_DEG_FOR_SHELL,
        )
        return None

    try:
        import trimesh
    except ImportError:
        logger.warning("trimesh unavailable — skipping room shell")
        return None

    envelope = estimate_room_envelope(
        coverage_span_deg=coverage_span_deg,
        orbit_radius_m=orbit_radius_m,
        default_height_m=default_height_m,
    )
    size_x = envelope["size_x"] * (1.0 + margin_ratio)
    size_z = envelope["size_z"] * (1.0 + margin_ratio)
    size_y = envelope["size_y"]
    center_y = envelope["center_y"]

    box = trimesh.creation.box(extents=[size_x, size_y, size_z])
    box.apply_translation([0, center_y, 0])

    try:
        bucket = 360.0 / max(n_zones, 1)
        wall_yaws = [(i + 0.5) * bucket for i in range(n_zones)]
        textures = [
            _pick_frontal_keyframe(
                keyframe_paths,
                yaw,
                yaw_by_path=yaw_by_path,
                architecture_by_path=architecture_by_path,
            )
            for yaw in wall_yaws
        ]
        valid = [im for im in textures if im is not None]
        if not valid:
            logger.info("Room shell skipped — no keyframe textures available")
            return None
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=valid[0],
            metallicFactor=0.0,
            roughnessFactor=0.9,
        )
        box.visual = trimesh.visual.TextureVisuals(material=material)
    except Exception as e:
        logger.info("Room shell texturing partial failure: %s", e)

    out_dir = models_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_path = out_dir / "shell.glb"

    try:
        box.export(str(shell_path))
        logger.info(
            "Room shell created at %s (%.1fx%.1fx%.1f from video envelope)",
            shell_path,
            size_x,
            size_y,
            size_z,
        )
        return shell_path
    except Exception as e:
        logger.warning("Room shell export failed: %s", e)
        return None
