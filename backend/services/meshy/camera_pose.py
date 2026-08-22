"""Estimate camera yaw from walkthrough frames using optical flow."""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

COVERAGE_MIN_SPAN_DEG = 200.0
COVERAGE_MIN_ZONES = 3
DOMINANT_ZONE_MAX_FRACTION = 0.75
SINGLE_OBJECT_SPAN_THRESHOLD_DEG = 120.0
FRAME_INDEX_FALLBACK_ROTATION_DEG = 30.0
MIN_WALKTHROUGH_DURATION_S = 25.0
MIN_WALKTHROUGH_FRAMES = 30
COVERAGE_ACTIONABLE_MSG = (
    "Record at least 30 seconds while slowly panning 360° from the center of the room."
)


def estimate_yaw_by_index(
    frame_paths: Sequence[Path],
    *,
    fps: float = 1.5,
    allow_uniform_fallback: bool = False,
    calibrate_undercount: bool = True,
    is_portrait: bool = False,
) -> tuple[dict[int, float], bool]:
    """
    Estimate per-frame cumulative yaw in degrees (unwrapped, may exceed 360).

    Uses affine partial rotation between consecutive frames when OpenCV is available.
    Returns (yaw_by_index, used_uniform_fallback).
    """
    if len(frame_paths) <= 1:
        return {0: 0.0}, False

    try:
        import cv2  # type: ignore
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

    for i in range(1, len(frame_paths)):
        gray = _read_gray(frame_paths[i], cv2)
        if gray is None:
            yaws[i] = cumulative
            continue

        delta = _estimate_frame_rotation_deg(prev_gray, gray, cv2, is_portrait=is_portrait)
        if delta is not None:
            cumulative += delta
        yaws[i] = cumulative
        prev_gray = gray

    total_rotation = _total_rotation_deg(yaws)
    logger.info(
        "Yaw estimation: %d frames, total rotation %.1f°, range %.1f°–%.1f°",
        len(yaws),
        total_rotation,
        min(yaws.values()),
        max(yaws.values()),
    )

    if total_rotation < 30.0 and len(frame_paths) >= 12:
        logger.warning(
            "Low rotation detected (%.1f°) — video may be mostly static or pan too slow",
            total_rotation,
        )

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

    if calibrate_undercount:
        yaws = calibrate_yaw_undercount(yaws, len(frame_paths), fps)

    return yaws, False


def calibrate_yaw_undercount(
    yaw_by_index: dict[int, float],
    n_frames: int,
    extraction_fps: float,
) -> dict[int, float]:
    """
    Scale yaw estimates when optical flow systematically undercounts slow pans.

    Long walkthroughs (30+ frames, 25+ seconds) with low measured rotation are
    likely full 360° pans that flow failed to quantify.
    """
    total = _total_rotation_deg(yaw_by_index)
    duration_s = n_frames / max(extraction_fps, 0.1)

    if duration_s < MIN_WALKTHROUGH_DURATION_S or n_frames < MIN_WALKTHROUGH_FRAMES:
        return yaw_by_index
    if total >= COVERAGE_MIN_SPAN_DEG:
        return yaw_by_index

    # Assume user intended a full pan; scale cumulative yaws to ~360°
    scale = 360.0 / max(total, 1.0)
    if scale < 1.8 or scale > 20.0:
        return yaw_by_index

    logger.info(
        "Yaw calibration: scaling %.1f° -> ~360° (%.1fx, %d frames, %.0fs)",
        total, scale, n_frames, duration_s,
    )
    return {k: float(v) * scale for k, v in yaw_by_index.items()}


def maybe_apply_frame_index_yaw_fallback(
    yaw_by_index: dict[int, float],
    n_frames: int,
    extraction_fps: float,
) -> dict[int, float]:
    """
    When optical flow detects almost no rotation on a long clip, assume a
    walk-forward orbit and spread frames evenly across 360° for bucketing.
    """
    duration_s = n_frames / max(extraction_fps, 0.1)
    total = _total_rotation_deg(yaw_by_index)

    if duration_s < MIN_WALKTHROUGH_DURATION_S or n_frames < MIN_WALKTHROUGH_FRAMES:
        return yaw_by_index
    if total >= FRAME_INDEX_FALLBACK_ROTATION_DEG:
        return yaw_by_index

    indices = sorted(yaw_by_index.keys())
    if len(indices) < 2:
        return yaw_by_index

    logger.info(
        "Frame-index yaw fallback: %.1f° flow rotation over %.0fs / %d frames",
        total,
        duration_s,
        n_frames,
    )
    n = len(indices)
    return {idx: (i / max(n - 1, 1)) * 360.0 for i, idx in enumerate(indices)}


def _horizontal_fov_deg(is_portrait: bool) -> float:
    from services.video.orientation import LANDSCAPE_FOV_DEG, PORTRAIT_FOV_DEG

    return PORTRAIT_FOV_DEG if is_portrait else LANDSCAPE_FOV_DEG


def _estimate_frame_rotation_deg(prev_gray, gray, cv2, *, is_portrait: bool = False) -> Optional[float]:
    """Estimate inter-frame yaw rotation (degrees) via feature flow + affine fit."""
    import numpy as np  # type: ignore

    prev = _resize_for_tracking(prev_gray, cv2)
    curr = _resize_for_tracking(gray, cv2)
    h, w = prev.shape
    fov = _horizontal_fov_deg(is_portrait)

    features = cv2.goodFeaturesToTrack(
        prev, maxCorners=400, qualityLevel=0.01, minDistance=6, blockSize=7,
    )
    if features is None or len(features) < 12:
        return _rotation_from_horizontal_flow(prev, curr, cv2, np, fov_deg=fov)

    lk_params = dict(
        winSize=(21, 21),
        maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )
    next_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev, curr, features, None, **lk_params)
    if next_pts is None or status is None:
        return None

    mask = status.reshape(-1) == 1
    if mask.sum() < 12:
        return _rotation_from_horizontal_flow(prev, curr, cv2, np, fov_deg=fov)

    old = features[mask].reshape(-1, 2)
    new = next_pts[mask].reshape(-1, 2)

    M, inliers = cv2.estimateAffinePartial2D(
        old, new, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=2000,
    )
    if M is not None:
        angle = math.degrees(math.atan2(M[1, 0], M[0, 0]))
        return angle

    return _rotation_from_horizontal_flow(prev, curr, cv2, np, width=w, fov_deg=fov)


def _rotation_from_horizontal_flow(
    prev_gray,
    gray,
    cv2,
    np,
    width: Optional[int] = None,
    fov_deg: float = 70.0,
) -> Optional[float]:
    """Fallback: median horizontal flow scaled to approximate FOV."""
    w = width or prev_gray.shape[1]
    features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
    if features is None:
        return None
    next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
        prev_gray, gray, features, None,
        winSize=(21, 21), maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )
    if next_pts is None or status is None:
        return None
    mask = status.reshape(-1) == 1
    if mask.sum() < 8:
        return None
    old = features[mask].reshape(-1, 2)
    new = next_pts[mask].reshape(-1, 2)
    dx = float(np.median(new[:, 0] - old[:, 0]))
    return dx / max(w, 1) * fov_deg


def _resize_for_tracking(gray, cv2, target_width: int = 960):
    h, w = gray.shape
    if w <= target_width:
        return gray
    scale = target_width / w
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def measure_yaw_coverage(
    yaw_by_index: Mapping[int, float],
    n_zones: int,
) -> dict[str, float | int | bool]:
    """Measure angular coverage and how many zones have at least one frame."""
    if not yaw_by_index:
        return {
            "zones_populated": 0,
            "span_deg": 0.0,
            "total_rotation_deg": 0.0,
            "used_uniform_fallback": False,
        }

    yaws_norm = [float(y) % 360.0 for y in yaw_by_index.values()]
    span_wrapped = _angular_span_deg(yaws_norm)
    total_rotation = min(360.0, _total_rotation_deg(yaw_by_index))
    span_deg = max(span_wrapped, total_rotation)

    zones_seen: set[int] = set()
    bucket = 360.0 / max(n_zones, 1)
    for yaw in yaws_norm:
        zone_id = int(yaw // bucket) % n_zones
        zones_seen.add(zone_id)

    return {
        "zones_populated": len(zones_seen),
        "span_deg": span_deg,
        "total_rotation_deg": total_rotation,
        "used_uniform_fallback": False,
    }


def dominant_zone_fraction(
    yaw_by_index: Mapping[int, float],
    n_zones: int,
) -> tuple[int, float]:
    """Return (dominant_zone_id, fraction_of_frames_in_that_zone)."""
    if not yaw_by_index or n_zones <= 0:
        return 0, 1.0
    bucket = 360.0 / n_zones
    counts: dict[int, int] = {i: 0 for i in range(n_zones)}
    for yaw in yaw_by_index.values():
        zid = int(float(yaw) % 360.0 // bucket) % n_zones
        counts[zid] = counts.get(zid, 0) + 1
    total = len(yaw_by_index)
    dominant = max(counts, key=counts.get)
    return dominant, counts[dominant] / total


def validate_room_coverage(
    yaw_by_index: Mapping[int, float],
    n_zones: int,
    *,
    used_uniform_fallback: bool,
    min_span_deg: float = COVERAGE_MIN_SPAN_DEG,
    min_zones: int = COVERAGE_MIN_ZONES,
    n_frames: int | None = None,
    extraction_fps: float | None = None,
) -> None:
    """Fail fast before Meshy when walkthrough coverage is insufficient."""
    if used_uniform_fallback:
        raise ValueError(
            "Could not estimate camera rotation from your video. "
            + COVERAGE_ACTIONABLE_MSG
        )

    working_yaw = dict(yaw_by_index)
    if n_frames is not None and extraction_fps is not None:
        working_yaw = maybe_apply_frame_index_yaw_fallback(
            working_yaw,
            n_frames,
            extraction_fps,
        )

    coverage = measure_yaw_coverage(working_yaw, n_zones)
    span_deg = float(coverage["span_deg"])
    total_rotation = float(coverage.get("total_rotation_deg", span_deg))
    zones_populated = int(coverage["zones_populated"])
    _, dominant_frac = dominant_zone_fraction(working_yaw, n_zones)

    duration_s = (
        n_frames / max(extraction_fps, 0.1)
        if n_frames is not None and extraction_fps is not None
        else None
    )
    duration_note = f", {duration_s:.0f}s clip" if duration_s is not None else ""

    if dominant_frac > DOMINANT_ZONE_MAX_FRACTION:
        if (
            span_deg < SINGLE_OBJECT_SPAN_THRESHOLD_DEG
            and total_rotation < SINGLE_OBJECT_SPAN_THRESHOLD_DEG
        ):
            raise ValueError(
                "Video looks like a single-object shot, not a room walkthrough "
                f"(rotation {total_rotation:.0f}°, span {span_deg:.0f}°, "
                f"{dominant_frac * 100:.0f}% of frames in one zone{duration_note}). "
                "Use the Object preset for equipment scans, or pan slowly 360° "
                "from the center of the room with walls visible."
            )

    if total_rotation >= min_span_deg and zones_populated >= min_zones:
        return

    # Accept if angular span across frames is wide even when step-sum is low
    if span_deg >= min_span_deg and zones_populated >= min_zones:
        return

    if total_rotation < min_span_deg and span_deg < min_span_deg:
        raise ValueError(
            f"Insufficient 360° pan ({total_rotation:.0f}° of ~360° detected, "
            f"span {span_deg:.0f}°{duration_note}). "
            + COVERAGE_ACTIONABLE_MSG
        )

    raise ValueError(
        f"Not enough angular zones ({zones_populated}/{n_zones} detected, "
        f"span {span_deg:.0f}°{duration_note}). "
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
        yaw_rad = (yaw_by_index.get(i, 0.0) % 360.0 / 180.0) * math.pi
        path.append([
            radius * math.sin(yaw_rad),
            height,
            radius * math.cos(yaw_rad),
        ])
    return path


def _total_rotation_deg(yaw_by_index: Mapping[int, float]) -> float:
    if len(yaw_by_index) < 2:
        return 0.0
    indices = sorted(yaw_by_index.keys())
    total = 0.0
    for i in range(1, len(indices)):
        total += abs(float(yaw_by_index[indices[i]]) - float(yaw_by_index[indices[i - 1]]))
    return total


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
