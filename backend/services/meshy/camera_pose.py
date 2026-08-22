"""Estimate camera yaw from walkthrough frames using optical flow."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

COVERAGE_MIN_SPAN_DEG = 200.0
COVERAGE_ACTIONABLE_MSG = (
    "Record at least 30 seconds while slowly panning 360° from the center of the room."
)


def estimate_yaw_by_index(
    frame_paths: Sequence[Path],
    *,
    fps: float = 1.5,
    allow_uniform_fallback: bool = False,
) -> tuple[dict[int, float], bool]:
    """
    Estimate per-frame yaw in degrees [0, 360).

    Uses Lucas-Kanade optical flow on consecutive frames when OpenCV is available.
    Returns (yaw_by_index, used_uniform_fallback).
    """
    if len(frame_paths) <= 1:
        return {0: 0.0}, False

    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        if allow_uniform_fallback:
            logger.warning("OpenCV unavailable — using uniform yaw estimate")
            return _uniform_yaw(len(frame_paths)), True
        raise RuntimeError(
            "OpenCV is required for room reconstruction yaw estimation. "
            "Install opencv-python-headless or record with clearer camera motion."
        )

    yaws: dict[int, float] = {0: 0.0}
    cumulative = 0.0

    prev_gray = _read_gray(frame_paths[0], cv2)
    if prev_gray is None:
        if allow_uniform_fallback:
            return _uniform_yaw(len(frame_paths)), True
        raise ValueError("Could not read first frame for yaw estimation")

    h, w = prev_gray.shape
    features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
    if features is None:
        if allow_uniform_fallback:
            return _uniform_yaw(len(frame_paths)), True
        raise ValueError("Not enough visual features in video frames for yaw estimation")

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
        cumulative += dx / max(w, 1) * 45.0
        yaws[i] = cumulative % 360.0

        prev_gray = gray
        features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
        if features is None:
            break

    if len(yaws) < len(frame_paths):
        if allow_uniform_fallback:
            uniform = _uniform_yaw(len(frame_paths))
            for i in range(len(frame_paths)):
                if i not in yaws:
                    yaws[i] = uniform.get(i, 0.0)
            return yaws, True
        raise ValueError(
            f"Yaw estimation incomplete ({len(yaws)}/{len(frame_paths)} frames). "
            + COVERAGE_ACTIONABLE_MSG
        )

    return yaws, False


def measure_yaw_coverage(
    yaw_by_index: Mapping[int, float],
    n_zones: int,
) -> dict[str, float | int | bool]:
    """Measure angular coverage and how many zones have at least one frame."""
    if not yaw_by_index:
        return {
            "zones_populated": 0,
            "span_deg": 0.0,
            "used_uniform_fallback": False,
        }

    yaws = [float(y) % 360.0 for y in yaw_by_index.values()]
    span_deg = _angular_span_deg(yaws)

    zones_seen: set[int] = set()
    bucket = 360.0 / max(n_zones, 1)
    for yaw in yaws:
        zone_id = int(yaw // bucket) % n_zones
        zones_seen.add(zone_id)

    return {
        "zones_populated": len(zones_seen),
        "span_deg": span_deg,
        "used_uniform_fallback": False,
    }


def validate_room_coverage(
    yaw_by_index: Mapping[int, float],
    n_zones: int,
    *,
    used_uniform_fallback: bool,
    min_span_deg: float = COVERAGE_MIN_SPAN_DEG,
) -> None:
    """Fail fast before Meshy when walkthrough coverage is insufficient."""
    coverage = measure_yaw_coverage(yaw_by_index, n_zones)
    span_deg = float(coverage["span_deg"])

    if used_uniform_fallback:
        raise ValueError(
            "Could not estimate camera rotation from your video. "
            + COVERAGE_ACTIONABLE_MSG
        )

    if span_deg < min_span_deg:
        raise ValueError(
            f"Insufficient 360° coverage ({span_deg:.0f}° of ~360° detected). "
            + COVERAGE_ACTIONABLE_MSG
        )


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


def _angular_span_deg(yaws: Sequence[float]) -> float:
    if len(yaws) < 2:
        return 0.0 if not yaws else 0.0
    unique = sorted({y % 360.0 for y in yaws})
    if len(unique) == 1:
        return 0.0
    gaps: list[float] = []
    for i, yaw in enumerate(unique):
        nxt = unique[(i + 1) % len(unique)]
        if i == len(unique) - 1:
            gaps.append((360.0 - yaw) + nxt)
        else:
            gaps.append(nxt - yaw)
    return 360.0 - max(gaps)


def _uniform_yaw(n: int) -> dict[int, float]:
    if n <= 1:
        return {0: 0.0}
    return {i: (i / (n - 1)) * 360.0 for i in range(n)}


def _read_gray(path: Path, cv2) -> Optional["object"]:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    return img
