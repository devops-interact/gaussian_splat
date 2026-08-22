"""Cross-zone GLB scale normalization for coherent room composition."""

from __future__ import annotations

import hashlib
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


def glb_vertex_count(glb_path: Path) -> int:
    try:
        import trimesh

        scene = trimesh.load(str(glb_path), force="scene")
        if hasattr(scene, "geometry"):
            return sum(len(g.vertices) for g in scene.geometry.values())
        return len(scene.vertices)  # type: ignore[union-attr]
    except Exception:
        return 0


def glb_content_hash(glb_path: Path, *, sample_bytes: int = 65536) -> str:
    """Fast content fingerprint for duplicate detection."""
    data = glb_path.read_bytes()
    digest = hashlib.sha256(data[:sample_bytes]).hexdigest()[:16]
    return f"{len(data)}:{digest}"


def bbox_centroid(bbox: dict) -> Tuple[float, float, float]:
    mn, mx = bbox["min"], bbox["max"]
    return (
        (mn[0] + mx[0]) / 2.0,
        (mn[1] + mx[1]) / 2.0,
        (mn[2] + mx[2]) / 2.0,
    )


def bbox_extent(bbox: dict) -> Tuple[float, float, float]:
    mn, mx = bbox["min"], bbox["max"]
    return (mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])


def zones_are_similar(
    bbox_a: dict,
    bbox_b: dict,
    verts_a: int,
    verts_b: int,
    *,
    hash_a: Optional[str] = None,
    hash_b: Optional[str] = None,
) -> bool:
    if hash_a and hash_b and hash_a == hash_b:
        return True

    ext_a = bbox_extent(bbox_a)
    ext_b = bbox_extent(bbox_b)
    if min(ext_a) <= 0 or min(ext_b) <= 0:
        return False

    ratios = [ext_a[i] / ext_b[i] for i in range(3)]
    if not all(0.85 <= r <= 1.15 for r in ratios):
        return False

    if verts_a > 0 and verts_b > 0:
        vr = verts_a / verts_b
        if not (0.9 <= vr <= 1.1):
            return False

    ca = bbox_centroid(bbox_a)
    cb = bbox_centroid(bbox_b)
    dist = sum((ca[i] - cb[i]) ** 2 for i in range(3)) ** 0.5
    avg_extent = sum(ext_a) / 3.0
    return dist < avg_extent * 0.15


def dedupe_similar_zones(
    job_dir: Path,
    zone_ids: List[int],
    zone_quality: Dict[int, float],
) -> Tuple[List[int], Dict[str, str]]:
    """
    Drop near-duplicate zone GLBs, keeping the zone with highest quality score.

    Returns (kept_zone_ids, errors_for_dropped_zones).
    """
    if len(zone_ids) < 2:
        return zone_ids, {}

    meta: dict[int, dict] = {}
    for zid in zone_ids:
        path = job_dir / f"zone_{zid}.glb"
        if not path.exists():
            continue
        bbox = glb_bbox(path)
        if not bbox:
            continue
        meta[zid] = {
            "bbox": bbox,
            "verts": glb_vertex_count(path),
            "hash": glb_content_hash(path),
            "quality": zone_quality.get(zid, 0.0),
        }

    dropped: Dict[str, str] = {}
    removed: set[int] = set()

    sorted_ids = sorted(meta.keys())
    for i, a in enumerate(sorted_ids):
        if a in removed:
            continue
        for b in sorted_ids[i + 1:]:
            if b in removed:
                continue
            if zones_are_similar(
                meta[a]["bbox"],
                meta[b]["bbox"],
                meta[a]["verts"],
                meta[b]["verts"],
                hash_a=meta[a]["hash"],
                hash_b=meta[b]["hash"],
            ):
                keep, drop = (a, b) if meta[a]["quality"] >= meta[b]["quality"] else (b, a)
                removed.add(drop)
                dropped[str(drop)] = f"Duplicate of zone {keep} (near-identical mesh)"

    kept = [z for z in zone_ids if z not in removed]
    return kept, dropped


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


def align_zones_to_floor_origin(
    job_dir: Path,
    zone_ids: List[int],
) -> Dict[int, dict]:
    """
    Translate each zone GLB so floor sits at Y=0 (preserve XZ placement for ring composition).

    Returns updated bbox per zone.
    """
    import trimesh

    bboxes: dict[int, dict] = {}
    for zone_id in zone_ids:
        glb_path = job_dir / f"zone_{zone_id}.glb"
        if not glb_path.exists():
            continue
        try:
            scene = trimesh.load(str(glb_path), force="scene")
            if not hasattr(scene, "geometry") or not scene.geometry:
                continue
            bounds = scene.bounds
            mn, mx = bounds[0], bounds[1]
            dy = -mn[1]
            translation = [0.0, dy, 0.0]
            for geom in scene.geometry.values():
                geom.apply_translation(translation)
            scene.export(str(glb_path))
            updated = glb_bbox(glb_path)
            if updated:
                bboxes[zone_id] = updated
        except Exception as e:
            logger.warning("Zone %s floor alignment failed: %s", zone_id, e)
    return bboxes


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
