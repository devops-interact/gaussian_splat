"""Scene composition: zone transforms for multi-mesh room reconstruction."""

from __future__ import annotations

import math
from typing import Dict, List, Mapping, Optional


def zone_transform_matrix(zone_id: int, n_zones: int, radius: float = 2.0) -> List[List[float]]:
    """
    Place zone meshes on a circle facing inward (yaw-based layout).
    Returns 4x4 row-major transform matrix.
    """
    angle = (zone_id / max(n_zones, 1)) * 2 * math.pi
    return zone_transform_from_yaw(math.degrees(angle), radius)


def zone_transform_from_yaw(yaw_deg: float, radius: float = 2.0) -> List[List[float]]:
    """Build row-major transform from mean camera yaw for a zone (degrees)."""
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
    zone_yaws_deg: Optional[Mapping[int, float]] = None,
    radius: float = 2.0,
) -> Dict[int, List[List[float]]]:
    """
    Build transforms only for zones that have keyframes.
    Uses mean yaw per zone when provided, else evenly spaced by zone id.
    """
    if not zone_ids:
        return {}
    n = len(zone_ids)
    transforms: Dict[int, List[List[float]]] = {}
    for i, zid in enumerate(sorted(zone_ids)):
        if zone_yaws_deg and zid in zone_yaws_deg:
            yaw = zone_yaws_deg[zid]
        else:
            yaw = (i / max(n, 1)) * 360.0
        transforms[zid] = zone_transform_from_yaw(yaw, radius)
    return transforms
