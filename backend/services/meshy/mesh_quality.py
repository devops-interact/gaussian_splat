"""Classify zone GLB outputs as architectural space vs dominant object blobs."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from services.meshy.zone_normalize import bbox_extent, glb_bbox, glb_vertex_count

logger = logging.getLogger(__name__)

MeshClass = Literal["architectural", "object", "unknown"]
THIN_CARD_DEPTH_RATIO = 0.35
THIN_CARD_MAX_VERTS = 8000


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
    if thin_depth < THIN_CARD_DEPTH_RATIO and footprint > height * 0.5:
        return "architectural"

    # Tall humanoid — standing figure hallucinated by Meshy
    if slenderness >= 2.2 and footprint_ratio < 0.85 and footprint < height * 0.9:
        return "object"

    # Compact cubic blob — chair, table, person
    if slenderness > 0.7 and slenderness < 2.5:
        aspect_xz = min(ex, ez) / max(ex, ez)
        if aspect_xz > 0.45 and footprint_ratio < 1.1:
            return "object"

    if slenderness >= 2.5 and footprint_ratio < 0.8:
        return "object"

    return "unknown"


def is_thin_card_mesh(glb_path: Path) -> bool:
    """Reject flat billboard-like meshes even when classified as architectural."""
    bbox = glb_bbox(glb_path)
    if not bbox:
        return False

    ext = bbox_extent(bbox)
    ex, ey, ez = ext
    footprint = max(ex, ez)
    height = ey
    depth = min(ex, ez)
    if footprint <= 0:
        return False

    thin_depth = depth / footprint
    verts = glb_vertex_count(glb_path)

    if thin_depth >= THIN_CARD_DEPTH_RATIO:
        return False

    if footprint > height * 0.5 and verts <= THIN_CARD_MAX_VERTS:
        return True

    return thin_depth < 0.2 and verts <= THIN_CARD_MAX_VERTS


def _is_compact_unknown(ext: tuple[float, float, float]) -> bool:
    """Reject small compact unknown blobs that are likely furniture/person meshes."""
    ex, ey, ez = ext
    footprint = max(ex, ez)
    height = ey
    if footprint >= 1.5:
        return False
    slenderness = height / max(footprint, 1e-6)
    footprint_ratio = footprint / max(height, 1e-6)
    if slenderness >= 2.0 and footprint_ratio < 0.9:
        return True
    if 0.7 <= slenderness <= 2.5 and footprint_ratio < 1.05 and footprint < 1.2:
        return True
    return False


def mesh_passes_quality_gate(glb_path: Path) -> bool:
    """Zone detail meshes must not be objects or flat video-frame cards."""
    if is_thin_card_mesh(glb_path):
        logger.info("Mesh quality gate rejected thin-card mesh: %s", glb_path)
        return False

    kind = classify_zone_mesh(glb_path)
    if kind == "object":
        logger.info("Mesh quality gate rejected object-like mesh: %s", glb_path)
        return False

    if kind == "unknown":
        bbox = glb_bbox(glb_path)
        if bbox:
            ext = bbox_extent(bbox)
            if _is_compact_unknown(ext):
                logger.info("Mesh quality gate rejected compact unknown mesh: %s", glb_path)
                return False

    return True
