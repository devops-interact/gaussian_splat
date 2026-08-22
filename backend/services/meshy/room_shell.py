"""Generate a neutral room shell envelope aligned to video-derived bounds."""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Sequence

logger = logging.getLogger(__name__)

MIN_FRAMES_FOR_SHELL = 8
MIN_COVERAGE_DEG_FOR_SHELL = 200.0
_NEUTRAL_SHELL_COLOR = [190, 188, 185, 255]


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
    width = max(2.0 * orbit_radius_m * math.sin(span_rad / 2.0) * 1.15, 3.0)
    depth = max(orbit_radius_m * 1.6, 3.0)
    height = default_height_m
    return {
        "size_x": width,
        "size_z": depth,
        "size_y": height,
        "center_y": height / 2.0,
    }


def should_create_shell(
    frame_count: int,
    coverage_span_deg: float,
) -> bool:
    return frame_count >= MIN_FRAMES_FOR_SHELL and coverage_span_deg >= MIN_COVERAGE_DEG_FOR_SHELL


def _export_neutral_box_shell(
    trimesh,
    size_x: float,
    size_y: float,
    size_z: float,
    center_y: float,
    shell_path: Path,
) -> bool:
    import numpy as np

    box = trimesh.creation.box(extents=[size_x, size_y, size_z])
    box.apply_translation([0, center_y, 0])
    box.visual.vertex_colors = np.tile(_NEUTRAL_SHELL_COLOR, (len(box.vertices), 1))
    try:
        box.export(str(shell_path))
        return True
    except Exception as e:
        logger.warning("Neutral room shell export failed: %s", e)
        return False


def create_room_shell(
    job_id: str,
    models_dir: Path,
    keyframe_paths: Sequence[Path],
    *,
    coverage_span_deg: float = 360.0,
    orbit_radius_m: float = 2.5,
    default_height_m: float = 2.7,
    n_zones: int = 4,
    yaw_by_path=None,
    architecture_by_path=None,
    margin_ratio: float = 0.05,
) -> Path | None:
    """
    Create a neutral box shell GLB sized from video envelope (no video frame textures).
    Returns path to shell.glb or None on failure.
    """
    del n_zones, yaw_by_path, architecture_by_path  # envelope-only shell

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

    out_dir = models_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_path = out_dir / "shell.glb"

    if not _export_neutral_box_shell(trimesh, size_x, size_y, size_z, center_y, shell_path):
        return None

    logger.info(
        "Neutral room shell created at %s (%.1fx%.1fx%.1f from video envelope)",
        shell_path,
        size_x,
        size_y,
        size_z,
    )
    return shell_path
