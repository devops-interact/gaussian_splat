"""Scene composition: zone transforms for multi-mesh room reconstruction."""

from __future__ import annotations

import math
from typing import Dict, List


def zone_transform_matrix(zone_id: int, n_zones: int, radius: float = 0.0) -> List[List[float]]:
    """
    Place zone meshes at shared origin with bucket-center yaw rotation.
    Returns 4x4 row-major transform matrix.
    """
    bucket = 360.0 / max(n_zones, 1)
    yaw = (zone_id + 0.5) * bucket
    return zone_transform_from_yaw(yaw, radius)


def zone_transform_from_yaw(yaw_deg: float, radius: float = 0.0) -> List[List[float]]:
    """Build row-major transform: yaw rotation at origin, optional circle offset."""
    angle = math.radians(yaw_deg)
    x = radius * math.sin(angle)
    z = radius * math.cos(angle)
    rot = angle + math.pi  # face center when radius > 0; orientation hint at origin

    cos_y = math.cos(rot)
    sin_y = math.sin(rot)

    return [
        [cos_y, 0, sin_y, x],
        [0, 1, 0, 0],
        [-sin_y, 0, cos_y, z],
        [0, 0, 0, 1],
    ]


def compose_zone_transforms(n_zones: int, radius: float = 0.0) -> dict[int, List[List[float]]]:
    return {z: zone_transform_matrix(z, n_zones, radius) for z in range(n_zones)}


def compose_zone_transforms_for_ids(
    zone_ids: List[int],
    n_zones: int | None = None,
    radius: float = 0.0,
) -> Dict[int, List[List[float]]]:
    """
    Build transforms for succeeded zones using each zone_id's angular sector.

    Yaw matches the Meshy keyframe bucket: (zone_id + 0.5) * (360 / n_zones).
    """
    if not zone_ids:
        return {}
    count = n_zones if n_zones is not None else max(zone_ids) + 1
    return {zid: zone_transform_matrix(zid, count, radius) for zid in zone_ids}


def compose_radius_from_bbox(
    aggregated_bbox: dict | None,
    *,
    ref_height: float | None = None,
    min_radius: float = 2.0,
) -> float:
    """Derive ring radius for zone placement from merged zone bounds."""
    if aggregated_bbox and aggregated_bbox.get("min") and aggregated_bbox.get("max"):
        mn, mx = aggregated_bbox["min"], aggregated_bbox["max"]
        span_x = mx[0] - mn[0]
        span_z = mx[2] - mn[2]
        return max(max(span_x, span_z) / 2.0 * 0.85, min_radius)
    if ref_height is not None and ref_height > 0:
        return max(ref_height * 0.5, min_radius)
    return min_radius
