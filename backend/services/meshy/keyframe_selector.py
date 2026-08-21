"""Keyframe selection for Meshy multi-image-to-3D and zone-based composition."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Sequence, Union

MESHY_MAX_IMAGES = 4
DEFAULT_ZONE_COUNT = 4


@dataclass(frozen=True)
class FrameCandidate:
    path: Path
    index: int
    timestamp_sec: Optional[float] = None
    yaw_deg: Optional[float] = None
    sharpness: Optional[float] = None


def _normalize_yaw(yaw_deg: float) -> float:
    return yaw_deg % 360.0


def _zone_for_yaw(yaw_deg: float, n_zones: int) -> int:
    if n_zones <= 0:
        raise ValueError("n_zones must be positive")
    bucket_size = 360.0 / n_zones
    return int(_normalize_yaw(yaw_deg) // bucket_size) % n_zones


def _estimate_yaw_from_progress(index: int, total: int) -> float:
    """Fallback when no pose metadata exists: assume a slow 360° walkthrough."""
    if total <= 1:
        return 0.0
    return (index / (total - 1)) * 360.0


def _resolve_yaw(index: int, total: int, yaw_by_index: Optional[Mapping[int, float]]) -> float:
    if yaw_by_index is not None and index in yaw_by_index:
        return _normalize_yaw(yaw_by_index[index])
    return _estimate_yaw_from_progress(index, total)


def list_frame_paths(frames_dir: Path) -> list[Path]:
    for pattern in ("frame_*.png", "*.png", "*.jpg"):
        paths = sorted(frames_dir.glob(pattern))
        if paths:
            return paths
    return []


def frame_candidates_from_paths(
    frames: Sequence[Union[Path, str]],
    *,
    timestamps_sec: Optional[Sequence[float]] = None,
    yaw_by_index: Optional[Mapping[int, float]] = None,
    sharpness_by_index: Optional[Mapping[int, float]] = None,
) -> list[FrameCandidate]:
    paths = [Path(frame) for frame in frames]
    total = len(paths)
    candidates: list[FrameCandidate] = []

    for index, path in enumerate(paths):
        timestamp = None
        if timestamps_sec is not None and index < len(timestamps_sec):
            timestamp = timestamps_sec[index]

        sharpness = None
        if sharpness_by_index is not None and index in sharpness_by_index:
            sharpness = sharpness_by_index[index]

        candidates.append(
            FrameCandidate(
                path=path,
                index=index,
                timestamp_sec=timestamp,
                yaw_deg=_resolve_yaw(index, total, yaw_by_index),
                sharpness=sharpness,
            )
        )

    return candidates


def laplacian_sharpness(image_path: Path) -> float:
    """Return Laplacian variance; higher means sharper. Requires OpenCV."""
    try:
        import cv2  # type: ignore
    except ImportError as exc:
        raise RuntimeError("opencv-python-headless is required for laplacian_sharpness") from exc

    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        return 0.0
    return float(cv2.Laplacian(image, cv2.CV_64F).var())


def assign_zones_by_yaw(
    candidates: Sequence[FrameCandidate],
    n_zones: int = DEFAULT_ZONE_COUNT,
) -> dict[int, list[FrameCandidate]]:
    zones: dict[int, list[FrameCandidate]] = {zone_id: [] for zone_id in range(n_zones)}

    for candidate in candidates:
        yaw = candidate.yaw_deg if candidate.yaw_deg is not None else 0.0
        zone_id = _zone_for_yaw(yaw, n_zones)
        zones[zone_id].append(candidate)

    return zones


def _minimum_index_spacing(selected: Sequence[FrameCandidate], candidate: FrameCandidate) -> int:
    if not selected:
        return math.inf  # type: ignore[return-value]
    return min(abs(candidate.index - existing.index) for existing in selected)


def _select_diverse_keyframes(
    pool: Sequence[FrameCandidate],
    max_count: int,
    *,
    min_index_gap: int = 1,
) -> list[FrameCandidate]:
    if max_count <= 0 or not pool:
        return []

    ranked = sorted(
        pool,
        key=lambda frame: (
            -(frame.sharpness if frame.sharpness is not None else 0.0),
            frame.index,
        ),
    )

    selected: list[FrameCandidate] = []
    for candidate in ranked:
        if len(selected) >= max_count:
            break
        if selected and _minimum_index_spacing(selected, candidate) < min_index_gap:
            continue
        selected.append(candidate)

    if len(selected) < max_count:
        for candidate in ranked:
            if candidate in selected:
                continue
            selected.append(candidate)
            if len(selected) >= max_count:
                break

    return sorted(selected, key=lambda frame: frame.index)


def select_keyframes(
    frames: Sequence[Union[Path, str]],
    max_count: int = MESHY_MAX_IMAGES,
    *,
    timestamps_sec: Optional[Sequence[float]] = None,
    yaw_by_index: Optional[Mapping[int, float]] = None,
    sharpness_by_index: Optional[Mapping[int, float]] = None,
    min_index_gap: Optional[int] = None,
) -> list[Path]:
    """Pick up to `max_count` keyframes spread across the full walkthrough."""
    candidates = frame_candidates_from_paths(
        frames,
        timestamps_sec=timestamps_sec,
        yaw_by_index=yaw_by_index,
        sharpness_by_index=sharpness_by_index,
    )
    if not candidates:
        return []

    total = len(candidates)
    gap = min_index_gap
    if gap is None:
        gap = max(1, total // max(max_count * 2, 1))

    selected = _select_diverse_keyframes(candidates, max_count, min_index_gap=gap)
    return [frame.path for frame in selected]


def select_zone_keyframes(
    frames: Sequence[Union[Path, str]],
    *,
    n_zones: int = DEFAULT_ZONE_COUNT,
    max_per_zone: int = MESHY_MAX_IMAGES,
    timestamps_sec: Optional[Sequence[float]] = None,
    yaw_by_index: Optional[Mapping[int, float]] = None,
    sharpness_by_index: Optional[Mapping[int, float]] = None,
    min_index_gap: int = 1,
    min_frames_per_zone: int = 1,
) -> dict[int, list[Path]]:
    """
    Split walkthrough frames into angular zones and pick Meshy-ready keyframes per zone.

    Returns `{zone_id: [path, ...]}` with at most `max_per_zone` paths per zone.
    Zones with fewer than `min_frames_per_zone` frames are omitted.
    """
    if n_zones <= 0:
        raise ValueError("n_zones must be positive")
    if max_per_zone <= 0:
        raise ValueError("max_per_zone must be positive")

    candidates = frame_candidates_from_paths(
        frames,
        timestamps_sec=timestamps_sec,
        yaw_by_index=yaw_by_index,
        sharpness_by_index=sharpness_by_index,
    )
    zones = assign_zones_by_yaw(candidates, n_zones=n_zones)

    selected_by_zone: dict[int, list[Path]] = {}
    for zone_id, zone_frames in zones.items():
        if len(zone_frames) < min_frames_per_zone:
            continue
        zone_gap = max(min_index_gap, len(zone_frames) // max(max_per_zone * 2, 1))
        selected = _select_diverse_keyframes(
            zone_frames,
            max_per_zone,
            min_index_gap=zone_gap,
        )
        if selected:
            selected_by_zone[zone_id] = [frame.path for frame in selected]

    return selected_by_zone
