"""
Compute default viewer camera from LongSplat cameras_all.json (first entry only).

The first list element is treated as the first training camera (same order as sorted
extracted frames copied into LongSplat's images/ — see longsplat train.py).

Matches LongSplat utils.graphics_utils.getWorld2View + scene.Camera.world_view_transform
convention (world_view = getWorld2View(R, T).T in PyTorch terms).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Distance along view ray for look-at = bbox diagonal × this (scales with scene size).
INITIAL_CAMERA_DIAGONAL_FRAC = 0.6


def _initial_camera_distance_frac() -> float:
    raw = os.environ.get("INITIAL_CAMERA_DISTANCE_FRAC", "").strip()
    if raw:
        try:
            return max(0.35, min(0.95, float(raw)))
        except ValueError:
            logger.warning("Invalid INITIAL_CAMERA_DISTANCE_FRAC=%r — using default", raw)
    return INITIAL_CAMERA_DIAGONAL_FRAC


def _world_view_transform_from_rt(R: np.ndarray, T: np.ndarray) -> np.ndarray:
    """Same as LongSplat getWorld2View then .T → world_view_transform."""
    W = np.eye(4, dtype=np.float64)
    W[:3, :3] = R.T
    W[:3, 3] = T.astype(np.float64).reshape(3)
    return W.T


def _camera_up_in_world(R: np.ndarray) -> np.ndarray:
    """
    Camera's physical up in world coords.

    cameras_all.json stores R as the camera-to-world rotation (3DGS / COLMAP convention),
    and the COLMAP camera frame has +Y pointing down in the image — so the camera up in
    world space is -R·(0,1,0), i.e. the negated second column of R.
    """
    up = -np.asarray(R, dtype=np.float64)[:, 1]
    n = float(np.linalg.norm(up))
    if n < 1e-10:
        return np.array([0.0, 1.0, 0.0], dtype=np.float64)
    return up / n


def _camera_center_and_forward(R: np.ndarray, T: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Camera center in world and unit forward (-Z camera axis in world)."""
    wv = _world_view_transform_from_rt(R, T)
    c2w = np.linalg.inv(wv)
    center = (c2w @ np.array([0.0, 0.0, 0.0, 1.0], dtype=np.float64))[:3]
    R_c2w = c2w[:3, :3]
    # OpenGL / Three.js camera looks down -Z in camera space
    fwd = R_c2w @ np.array([0.0, 0.0, -1.0], dtype=np.float64)
    n = float(np.linalg.norm(fwd))
    if n < 1e-10:
        fwd = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    else:
        fwd = fwd / n
    return center, fwd


def _ply_bbox_diagonal(ply_path: Path) -> float:
    """Cheap bbox diagonal for camera distance (matches viewer heuristic scale)."""
    try:
        from plyfile import PlyData

        plydata = PlyData.read(str(ply_path))
        v = plydata["vertex"]
        x = np.asarray(v["x"], dtype=np.float64)
        y = np.asarray(v["y"], dtype=np.float64)
        z = np.asarray(v["z"], dtype=np.float64)
        bb_min = np.array([x.min(), y.min(), z.min()])
        bb_max = np.array([x.max(), y.max(), z.max()])
        diag = float(np.linalg.norm(bb_max - bb_min))
        return max(diag * 1.2, 3.0)
    except Exception as e:
        logger.warning("Could not read PLY bbox from %s: %s — using default distance", ply_path, e)
        return 3.0


def load_ply_center_offset(offset_path: Path) -> tuple[float, float, float] | None:
    if not offset_path.exists():
        return None
    try:
        data = json.loads(offset_path.read_text(encoding="utf-8"))
        return float(data["cx"]), float(data["cy"]), float(data["cz"])
    except (KeyError, TypeError, ValueError, OSError) as e:
        logger.warning("Invalid ply_center_offset.json at %s: %s", offset_path, e)
        return None


def compute_initial_camera_from_paths(
    cameras_path: Path,
    offset_path: Path,
    ply_path: Path | None,
) -> dict[str, list[float]] | None:
    """
    First pose in cameras_all.json only: eye at that camera center (PLY-centered frame),
    look-at one scene-scaled step along its forward axis.

    Returns {"position": [x,y,z], "target": [x,y,z], "up": [x,y,z]} or None if required
    inputs are missing. `up` is the first camera's physical up in world coords — the
    viewer uses it to rotate the splat floor-down.
    """
    if not cameras_path.exists():
        logger.info("cameras_all.json missing: %s", cameras_path)
        return None
    offset = load_ply_center_offset(offset_path)
    if offset is None:
        logger.info("ply_center_offset.json missing (required for alignment): %s", offset_path)
        return None

    ox, oy, oz = offset
    off_vec = np.array([ox, oy, oz], dtype=np.float64)

    try:
        raw = json.loads(cameras_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read cameras JSON %s: %s", cameras_path, e)
        return None

    if not isinstance(raw, list) or len(raw) == 0:
        logger.warning("cameras_all.json is not a non-empty list")
        return None

    cam: dict[str, Any] = raw[0]
    try:
        R = np.asarray(cam["R"], dtype=np.float64).reshape(3, 3)
        T = np.asarray(cam["T"], dtype=np.float64).reshape(3)
    except (KeyError, ValueError) as e:
        logger.warning("Camera entry 0 missing R/T: %s", e)
        return None

    c0, f0 = _camera_center_and_forward(R, T)
    c0_centered = c0 - off_vec

    if ply_path and ply_path.exists():
        dist = _ply_bbox_diagonal(ply_path)
    else:
        dist = 3.0

    frac = _initial_camera_distance_frac()
    eye_dist = dist * frac

    position = c0_centered.astype(np.float64)
    target = c0_centered + f0 * eye_dist

    # Avoid degenerate position == target (e.g. tiny eye_dist)
    if float(np.linalg.norm(target - position)) < 1e-4:
        target = c0_centered + f0 * max(eye_dist, 1e-3)

    if float(np.linalg.norm(target - position)) < 1e-4:
        logger.warning("Initial camera degenerate after first-pose fix — bailing out")
        return None

    up = _camera_up_in_world(R)

    return {
        "position": [float(position[0]), float(position[1]), float(position[2])],
        "target": [float(target[0]), float(target[1]), float(target[2])],
        "up": [float(up[0]), float(up[1]), float(up[2])],
    }
