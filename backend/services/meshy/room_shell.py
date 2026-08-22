"""Generate a textured room shell aligned to the composed zone bounding box."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


def _load_keyframe_image(path: Path):
    """Load keyframe as PIL Image or None."""
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
):
    if not keyframe_paths:
        return None
    if not yaw_by_path:
        return _load_keyframe_image(keyframe_paths[0])

    def dist(p: Path) -> float:
        yaw = yaw_by_path.get(p, 0.0)
        d = abs((yaw % 360.0) - (target_yaw_deg % 360.0))
        return min(d, 360.0 - d)

    best = min(keyframe_paths, key=dist)
    return _load_keyframe_image(best)


def create_room_shell(
    job_id: str,
    models_dir: Path,
    keyframe_paths: Sequence[Path],
    *,
    aggregated_bbox: Optional[dict] = None,
    n_zones: int = 4,
    yaw_by_path: Optional[Mapping[Path, float]] = None,
    margin_ratio: float = 0.1,
) -> Optional[Path]:
    """
    Create a box shell GLB sized to the aggregated zone bbox with per-wall textures.
    Returns path to shell.glb or None on failure.
    """
    try:
        import trimesh
    except ImportError:
        logger.warning("trimesh unavailable — skipping room shell")
        return None

    if not keyframe_paths:
        return None

    if aggregated_bbox:
        min_b = aggregated_bbox["min"]
        max_b = aggregated_bbox["max"]
        size_x = max(max_b[0] - min_b[0], 1.0)
        size_y = max(max_b[1] - min_b[1], 2.0)
        size_z = max(max_b[2] - min_b[2], 1.0)
        size_x *= 1.0 + margin_ratio
        size_z *= 1.0 + margin_ratio
        center_y = size_y / 2.0
    else:
        size_x = size_z = 4.5
        size_y = 2.8
        center_y = size_y / 2.0

    box = trimesh.creation.box(extents=[size_x, size_y, size_z])
    box.apply_translation([0, center_y, 0])

    try:
        bucket = 360.0 / max(n_zones, 1)
        wall_yaws = [(i + 0.5) * bucket for i in range(n_zones)]
        textures = [
            _pick_frontal_keyframe(keyframe_paths, yaw, yaw_by_path=yaw_by_path)
            for yaw in wall_yaws
        ]
        valid = [im for im in textures if im is not None]
        if valid:
            material = trimesh.visual.material.PBRMaterial(
                baseColorTexture=valid[0],
                metallicFactor=0.0,
                roughnessFactor=0.9,
            )
            box.visual = trimesh.visual.TextureVisuals(material=material)
    except Exception as e:
        logger.debug("Shell texturing skipped: %s", e)

    out_dir = models_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_path = out_dir / "shell.glb"

    try:
        box.export(str(shell_path))
        logger.info("Room shell created at %s (%.1fx%.1fx%.1f)", shell_path, size_x, size_y, size_z)
        return shell_path
    except Exception as e:
        logger.warning("Room shell export failed: %s", e)
        return None
