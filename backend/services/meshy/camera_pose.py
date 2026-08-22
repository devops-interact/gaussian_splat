"""Estimate camera yaw from walkthrough frames using optical flow."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


def estimate_yaw_by_index(
    frame_paths: Sequence[Path],
    *,
    fps: float = 1.5,
) -> dict[int, float]:
    """
    Estimate per-frame yaw in degrees [0, 360).

  Uses Lucas-Kanade optical flow on consecutive frames when OpenCV is available;
  falls back to uniform circular walkthrough assumption.
    """
    if len(frame_paths) <= 1:
        return {0: 0.0}

    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        logger.warning("OpenCV unavailable — using uniform yaw estimate")
        return _uniform_yaw(len(frame_paths))

    yaws: dict[int, float] = {0: 0.0}
    cumulative = 0.0

    prev_gray = _read_gray(frame_paths[0], cv2)
    if prev_gray is None:
        return _uniform_yaw(len(frame_paths))

    h, w = prev_gray.shape
    features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
    if features is None:
        return _uniform_yaw(len(frame_paths))

    lk_params = dict(
        winSize=(21, 21),
        maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )

    for i in range(1, len(frame_paths)):
        gray = _read_gray(frame_paths[i], cv2)
        if gray is None:
            yaws[i] = cumulative % 360.0
            continue

        next_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, features, None, **lk_params)
        if next_pts is None or status is None:
            yaws[i] = cumulative % 360.0
            prev_gray = gray
            continue

        mask = status.reshape(-1) == 1
        if mask.sum() < 10:
            yaws[i] = cumulative % 360.0
            prev_gray = gray
            features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
            if features is None:
                break
            continue

        old = features[mask].reshape(-1, 2)
        new = next_pts[mask].reshape(-1, 2)
        dx = float(np.median(new[:, 0] - old[:, 0]))
        # Horizontal flow → yaw change (empirical scale)
        cumulative += dx / max(w, 1) * 45.0
        yaws[i] = cumulative % 360.0

        prev_gray = gray
        features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
        if features is None:
            break

    # Fill any missing indices
    for i in range(len(frame_paths)):
        if i not in yaws:
            yaws[i] = _uniform_yaw(len(frame_paths)).get(i, 0.0)

    return yaws


def build_walk_path(
    frame_paths: Sequence[Path],
    yaw_by_index: Mapping[int, float],
    *,
    radius: float = 2.5,
    height: float = 1.5,
) -> list[list[float]]:
    """Circular walk path positions [x, y, z] from yaw estimates."""
    path: list[list[float]] = []
    n = len(frame_paths)
    for i in range(n):
        yaw_rad = (yaw_by_index.get(i, 0.0) / 180.0) * 3.14159265
        path.append([
            radius * __import__("math").sin(yaw_rad),
            height,
            radius * __import__("math").cos(yaw_rad),
        ])
    return path


def _uniform_yaw(n: int) -> dict[int, float]:
    if n <= 1:
        return {0: 0.0}
    return {i: (i / (n - 1)) * 360.0 for i in range(n)}


def _read_gray(path: Path, cv2) -> Optional["object"]:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    return img
