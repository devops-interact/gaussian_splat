"""Scene composition: zone transforms for multi-mesh room reconstruction."""

from __future__ import annotations

import math
from typing import List


def zone_transform_matrix(zone_id: int, n_zones: int, radius: float = 2.0) -> List[List[float]]:
    """
    Place zone meshes on a circle facing inward (yaw-based layout).
    Returns 4x4 row-major transform matrix.
    """
    angle = (zone_id / max(n_zones, 1)) * 2 * math.pi
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
