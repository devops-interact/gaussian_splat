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
    Build transforms for succeeded zones at shared origin.

    Uses enumerate index (not raw zone id) so 2 succeeded zones get 180° spacing
    regardless of which zone ids Meshy returned.
    """
    if not zone_ids:
        return {}
    count = n_zones if n_zones is not None else len(zone_ids)
    bucket = 360.0 / max(count, 1)
    transforms: Dict[int, List[List[float]]] = {}
    for i, zid in enumerate(sorted(zone_ids)):
        yaw = (i + 0.5) * bucket
        transforms[zid] = zone_transform_from_yaw(yaw, radius)
    return transforms
