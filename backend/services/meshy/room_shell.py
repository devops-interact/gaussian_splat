"""Generate a textured room shell aligned to video-derived room envelope."""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import List, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

MIN_FRAMES_FOR_SHELL = 8
MIN_COVERAGE_DEG_FOR_SHELL = 200.0


def estimate_room_envelope(
    *,
    coverage_span_deg: float,
    orbit_radius_m: float = 2.5,
    default_height_m: float = 2.7,
) -> dict:
    """
    Estimate room width/depth/height from walkthrough coverage, not zone object bboxes.

    Returns dict with size_x, size_z, size_y, center_y.
    """
    span_rad = math.radians(max(coverage_span_deg, 90.0))
    # Chord length across arc + margin for partial pans
    width = max(2.0 * orbit_radius_m * math.sin(span_rad / 2.0) * 1.15, 3.0)
    depth = max(orbit_radius_m * 1.6, 3.0)
    height = default_height_m
    return {
        "size_x": width,
        "size_z": depth,
        "size_y": height,
        "center_y": height / 2.0,
    }


def _load_keyframe_image(path: Path):
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
    architecture_by_path: Optional[Mapping[Path, float]] = None,
):
    if not keyframe_paths:
        return None

    def score_path(p: Path) -> tuple[float, float]:
        arch = architecture_by_path.get(p, 0.5) if architecture_by_path else 0.5
        if yaw_by_path:
            yaw = yaw_by_path.get(p, 0.0)
            d = abs((yaw % 360.0) - (target_yaw_deg % 360.0))
            d = min(d, 360.0 - d)
            return (-arch, d)
        return (-arch, 0.0)

    best = min(keyframe_paths, key=score_path)
    return _load_keyframe_image(best)


def should_create_shell(
    frame_count: int,
    coverage_span_deg: float,
) -> bool:
    return frame_count >= MIN_FRAMES_FOR_SHELL and coverage_span_deg >= MIN_COVERAGE_DEG_FOR_SHELL


_WALL_FACINGS = ("+z", "+x", "-z", "-x")
_NEUTRAL_CAP_COLOR = [190, 188, 185, 255]


def _wall_center(
    facing: str,
    size_x: float,
    size_y: float,
    size_z: float,
    center_y: float,
) -> tuple[float, float, float]:
    hx, hz = size_x / 2.0, size_z / 2.0
    if facing == "+z":
        return (0.0, center_y, hz)
    if facing == "-z":
        return (0.0, center_y, -hz)
    if facing == "+x":
        return (hx, center_y, 0.0)
    return (-hx, center_y, 0.0)


def _wall_dimensions(facing: str, size_x: float, size_y: float, size_z: float) -> tuple[float, float]:
    if facing in ("+z", "-z"):
        return size_x, size_y
    return size_z, size_y


def _make_textured_wall(
    width: float,
    height: float,
    center: tuple[float, float, float],
    facing: str,
    texture_image,
):
    import numpy as np
    import trimesh

    half_w = width / 2.0
    half_h = height / 2.0
    cx, cy, cz = center

    if facing == "+z":
        vertices = np.array([
            [cx - half_w, cy - half_h, cz],
            [cx + half_w, cy - half_h, cz],
            [cx + half_w, cy + half_h, cz],
            [cx - half_w, cy + half_h, cz],
        ])
    elif facing == "-z":
        vertices = np.array([
            [cx + half_w, cy - half_h, cz],
            [cx - half_w, cy - half_h, cz],
            [cx - half_w, cy + half_h, cz],
            [cx + half_w, cy + half_h, cz],
        ])
    elif facing == "+x":
        vertices = np.array([
            [cx, cy - half_h, cz - half_w],
            [cx, cy - half_h, cz + half_w],
            [cx, cy + half_h, cz + half_w],
            [cx, cy + half_h, cz - half_w],
        ])
    else:
        vertices = np.array([
            [cx, cy - half_h, cz + half_w],
            [cx, cy - half_h, cz - half_w],
            [cx, cy + half_h, cz - half_w],
            [cx, cy + half_h, cz + half_w],
        ])

    faces = np.array([[0, 1, 2], [0, 2, 3]])
    uvs = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float64)
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture_image,
        metallicFactor=0.0,
        roughnessFactor=0.9,
    )
    visual = trimesh.visual.TextureVisuals(uv=uvs, material=material)
    return trimesh.Trimesh(vertices=vertices, faces=faces, visual=visual)


def _make_colored_cap(width: float, depth: float, y: float, color: list[int]):
    import numpy as np
    import trimesh

    half_w, half_d = width / 2.0, depth / 2.0
    vertices = np.array([
        [-half_w, y, -half_d],
        [half_w, y, -half_d],
        [half_w, y, half_d],
        [-half_w, y, half_d],
    ])
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    colors = np.tile(color, (4, 1))
    return trimesh.Trimesh(vertices=vertices, faces=faces, vertex_colors=colors)


def _export_neutral_box_shell(
    trimesh,
    size_x: float,
    size_y: float,
    size_z: float,
    center_y: float,
    shell_path: Path,
) -> bool:
    import numpy as np

    box = trimesh.creation.box(extents=[size_x, size_y, size_z])
    box.apply_translation([0, center_y, 0])
    box.visual.vertex_colors = np.tile(_NEUTRAL_CAP_COLOR, (len(box.vertices), 1))
    try:
        box.export(str(shell_path))
        return True
    except Exception as e:
        logger.warning("Neutral room shell export failed: %s", e)
        return False


def create_room_shell(
    job_id: str,
    models_dir: Path,
    keyframe_paths: Sequence[Path],
    *,
    coverage_span_deg: float = 360.0,
    orbit_radius_m: float = 2.5,
    default_height_m: float = 2.7,
    n_zones: int = 4,
    yaw_by_path: Optional[Mapping[Path, float]] = None,
    architecture_by_path: Optional[Mapping[Path, float]] = None,
    margin_ratio: float = 0.05,
) -> Optional[Path]:
    """
    Create a box shell GLB sized from video envelope with per-wall textures.
    Returns path to shell.glb or None on failure.
    """
    if not keyframe_paths:
        return None

    if not should_create_shell(len(keyframe_paths), coverage_span_deg):
        logger.info(
            "Room shell skipped — need >=%d frames and >=%.0f° coverage",
            MIN_FRAMES_FOR_SHELL,
            MIN_COVERAGE_DEG_FOR_SHELL,
        )
        return None

    try:
        import trimesh
    except ImportError:
        logger.warning("trimesh unavailable — skipping room shell")
        return None

    envelope = estimate_room_envelope(
        coverage_span_deg=coverage_span_deg,
        orbit_radius_m=orbit_radius_m,
        default_height_m=default_height_m,
    )
    size_x = envelope["size_x"] * (1.0 + margin_ratio)
    size_z = envelope["size_z"] * (1.0 + margin_ratio)
    size_y = envelope["size_y"]
    center_y = envelope["center_y"]

    out_dir = models_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_path = out_dir / "shell.glb"

    bucket = 360.0 / max(n_zones, 1)
    wall_yaws = [(i + 0.5) * bucket for i in range(n_zones)]
    textures = [
        _pick_frontal_keyframe(
            keyframe_paths,
            yaw,
            yaw_by_path=yaw_by_path,
            architecture_by_path=architecture_by_path,
        )
        for yaw in wall_yaws
    ]
    valid = [im for im in textures if im is not None]
    if not valid:
        logger.info("Room shell skipped — no keyframe textures available")
        return None

    try:
        scene = trimesh.Scene()
        wall_count = min(n_zones, len(_WALL_FACINGS))
        for i in range(wall_count):
            tex = textures[i] if textures[i] is not None else valid[0]
            facing = _WALL_FACINGS[i]
            wall_w, wall_h = _wall_dimensions(facing, size_x, size_y, size_z)
            center = _wall_center(facing, size_x, size_y, size_z, center_y)
            wall = _make_textured_wall(wall_w, wall_h, center, facing, tex)
            scene.add_geometry(wall, node_name=f"wall_{i}")

        scene.add_geometry(
            _make_colored_cap(size_x, size_z, 0.0, _NEUTRAL_CAP_COLOR),
            node_name="floor",
        )
        scene.add_geometry(
            _make_colored_cap(size_x, size_z, size_y, [200, 200, 205, 255]),
            node_name="ceiling",
        )
        scene.export(str(shell_path))
    except Exception as e:
        logger.info("Room shell per-wall texturing failed (%s) — neutral box fallback", e)
        if not _export_neutral_box_shell(trimesh, size_x, size_y, size_z, center_y, shell_path):
            return None

    try:
        logger.info(
            "Room shell created at %s (%.1fx%.1fx%.1f from video envelope)",
            shell_path,
            size_x,
            size_y,
            size_z,
        )
        return shell_path
    except Exception as e:
        logger.warning("Room shell export failed: %s", e)
        return None
