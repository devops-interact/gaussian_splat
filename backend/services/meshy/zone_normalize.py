"""Cross-zone GLB scale normalization for coherent room composition."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def glb_bbox(glb_path: Path) -> Optional[dict]:
    """Return bounding box dict {min, max} for a GLB file."""
    try:
        import trimesh

        scene = trimesh.load(str(glb_path), force="scene")
        if hasattr(scene, "bounds"):
            bounds = scene.bounds
        else:
            bounds = scene.bounds  # type: ignore[union-attr]
        return {
            "min": bounds[0].tolist(),
            "max": bounds[1].tolist(),
        }
    except Exception as e:
        logger.warning("Failed to read bbox for %s: %s", glb_path, e)
        return None


def aggregate_bbox(bboxes: List[dict]) -> Optional[dict]:
    """Merge multiple axis-aligned bounding boxes."""
    if not bboxes:
        return None
    mins = [b["min"] for b in bboxes if b.get("min")]
    maxs = [b["max"] for b in bboxes if b.get("max")]
    if not mins or not maxs:
        return None
    return {
        "min": [
            min(m[0] for m in mins),
            min(m[1] for m in mins),
            min(m[2] for m in mins),
        ],
        "max": [
            max(m[0] for m in maxs),
            max(m[1] for m in maxs),
            max(m[2] for m in maxs),
        ],
    }


def placement_radius_from_bbox(bbox: Optional[dict], *, min_radius: float = 2.0) -> float:
    """Derive zone circle radius from aggregated horizontal extent."""
    if not bbox:
        return min_radius
    size_x = bbox["max"][0] - bbox["min"][0]
    size_z = bbox["max"][2] - bbox["min"][2]
    extent = max(size_x, size_z)
    return max(min_radius, extent * 0.35)


def normalize_zone_glbs(
    job_dir: Path,
    zone_ids: List[int],
) -> Tuple[Dict[int, float], Dict[int, dict]]:
    """
    Scale each zone GLB so Y height matches the median across zones.

    Returns (scale_factor_by_zone_id, bbox_by_zone_id after normalization).
    """
    import trimesh

    heights: dict[int, float] = {}
    bboxes: dict[int, dict] = {}
    scenes: dict[int, object] = {}

    for zone_id in zone_ids:
        glb_path = job_dir / f"zone_{zone_id}.glb"
        if not glb_path.exists():
            continue
        bbox = glb_bbox(glb_path)
        if not bbox:
            continue
        height = bbox["max"][1] - bbox["min"][1]
        if height <= 0:
            continue
        heights[zone_id] = height
        bboxes[zone_id] = bbox
        scenes[zone_id] = trimesh.load(str(glb_path), force="scene")

    if not heights:
        return {}, {}

    ref_height = sorted(heights.values())[len(heights) // 2]
    scale_factors: dict[int, float] = {}

    for zone_id, scene in scenes.items():
        scale = ref_height / heights[zone_id]
        scale_factors[zone_id] = scale
        if abs(scale - 1.0) < 1e-3:
            continue
        try:
            if hasattr(scene, "geometry"):
                for geom in scene.geometry.values():
                    geom.apply_scale(scale)
            else:
                scene.apply_scale(scale)  # type: ignore[union-attr]
            out_path = job_dir / f"zone_{zone_id}.glb"
            scene.export(str(out_path))  # type: ignore[union-attr]
            updated = glb_bbox(out_path)
            if updated:
                bboxes[zone_id] = updated
        except Exception as e:
            logger.warning("Zone %s scale normalization failed: %s", zone_id, e)

    return scale_factors, bboxes
