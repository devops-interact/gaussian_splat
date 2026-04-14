"""
Compute default viewer camera from LongSplat cameras_all.json (first N frames).

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

DEFAULT_FRAME_COUNT = 24
# Eye distance = diagonal × this (full diagonal was often too far for comfortable first view).
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
    n_frames: int = DEFAULT_FRAME_COUNT,
) -> dict[str, list[float]] | None:
    """
    Returns {"position": [x,y,z], "target": [0,0,0]} in the same centered frame as the served PLY,
    or None if required inputs are missing.
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

    n = min(n_frames, len(raw))
    centers: list[np.ndarray] = []
    forwards: list[np.ndarray] = []

    for i in range(n):
        cam: dict[str, Any] = raw[i]
        try:
            R = np.asarray(cam["R"], dtype=np.float64).reshape(3, 3)
            T = np.asarray(cam["T"], dtype=np.float64).reshape(3)
        except (KeyError, ValueError) as e:
            logger.warning("Camera entry %d missing R/T: %s", i, e)
            return None
        c, f = _camera_center_and_forward(R, T)
        centers.append(c - off_vec)
        forwards.append(f)

    fwd_sum = np.sum(np.stack(forwards, axis=0), axis=0)
    fn = float(np.linalg.norm(fwd_sum))
    if fn < 1e-8:
        fwd_mean = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    else:
        fwd_mean = fwd_sum / fn

    C_mean = np.mean(np.stack(centers, axis=0), axis=0)

    if ply_path and ply_path.exists():
        dist = _ply_bbox_diagonal(ply_path)
    else:
        dist = 3.0

    frac = _initial_camera_distance_frac()
    eye_dist = dist * frac
    eye = C_mean - fwd_mean * eye_dist
    target = np.array([0.0, 0.0, 0.0], dtype=np.float64)

    # Avoid degenerate eye == target
    if float(np.linalg.norm(eye - target)) < 1e-4:
        eye = target - fwd_mean * eye_dist

    return {
        "position": [float(eye[0]), float(eye[1]), float(eye[2])],
        "target": [float(target[0]), float(target[1]), float(target[2])],
    }
