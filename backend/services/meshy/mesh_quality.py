"""Classify zone GLB outputs as architectural space vs dominant object blobs."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from services.meshy.zone_normalize import bbox_extent, glb_bbox

logger = logging.getLogger(__name__)

MeshClass = Literal["architectural", "object", "unknown"]


def classify_zone_mesh(glb_path: Path) -> MeshClass:
    """
    Heuristic classification from axis-aligned bounding box.

    Object-like meshes (chair, person blob) are compact and roughly cubic.
    Architectural fragments tend to be wide, thin, or horizontally extended.
    """
    bbox = glb_bbox(glb_path)
    if not bbox:
        return "unknown"

    ext = bbox_extent(bbox)
    ex, ey, ez = ext
    if min(ext) <= 0:
        return "unknown"

    footprint = max(ex, ez)
    height = ey
    depth = min(ex, ez)
    slenderness = height / max(footprint, 1e-6)
    footprint_ratio = footprint / max(height, 1e-6)
    thin_depth = depth / max(footprint, 1e-6)

    # Wide horizontal extent — likely wall or floor segment
    if footprint_ratio >= 1.2 and footprint > depth * 1.3:
        return "architectural"

    # Thin depth profile — wall-like
    if thin_depth < 0.35 and footprint > height * 0.5:
        return "architectural"

    # Compact cubic blob — chair, table, person
    if slenderness > 0.7 and slenderness < 2.5:
        aspect_xz = min(ex, ez) / max(ex, ez)
        if aspect_xz > 0.45 and footprint_ratio < 1.1:
            return "object"

    if slenderness >= 2.5 and footprint_ratio < 0.8:
        return "object"

    return "unknown"


def mesh_passes_quality_gate(glb_path: Path) -> bool:
    """Zone detail meshes must not be classified as dominant objects."""
    kind = classify_zone_mesh(glb_path)
    if kind == "object":
        logger.info("Mesh quality gate rejected object-like mesh: %s", glb_path)
        return False
    return True
