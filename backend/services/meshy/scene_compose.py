"""Scene composition: zone transforms for multi-mesh room reconstruction."""

from __future__ import annotations

import math
from typing import Dict, List, Optional


def zone_transform_matrix(zone_id: int, n_zones: int, radius: float = 2.0) -> List[List[float]]:
    """
    Place zone meshes on a circle facing inward (bucket-center yaw layout).
    Returns 4x4 row-major transform matrix.
    """
    bucket = 360.0 / max(n_zones, 1)
    yaw = (zone_id + 0.5) * bucket
    return zone_transform_from_yaw(yaw, radius)


def zone_transform_from_yaw(yaw_deg: float, radius: float = 2.0) -> List[List[float]]:
    """Build row-major transform from camera yaw for a zone (degrees)."""
    angle = math.radians(yaw_deg)
    x = radius * math.sin(angle)
    z = radius * math.cos(angle)
    yaw = angle + math.pi  # face center

    cos_y = math.cos(yaw)
    sin_y = math.sin(yaw)

    return [
        [cos_y, 0, sin_y, x],
        [0, 1, 0, 0],
        [-sin_y, 0, cos_y, z],
        [0, 0, 0, 1],
    ]


def compose_zone_transforms(n_zones: int, radius: float = 2.0) -> dict[int, List[List[float]]]:
    return {z: zone_transform_matrix(z, n_zones, radius) for z in range(n_zones)}


def compose_zone_transforms_for_ids(
    zone_ids: List[int],
    n_zones: int,
    radius: float = 2.0,
) -> Dict[int, List[List[float]]]:
    """
    Build transforms for zones using bucket-center yaw (not optical-flow drift).
    """
    if not zone_ids:
        return {}
    transforms: Dict[int, List[List[float]]] = {}
    bucket = 360.0 / max(n_zones, 1)
    for zid in sorted(zone_ids):
        yaw = (zid + 0.5) * bucket
        transforms[zid] = zone_transform_from_yaw(yaw, radius)
    return transforms
