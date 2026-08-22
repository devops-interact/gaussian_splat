"""Keyframe selection for Meshy multi-image-to-3D and zone-based composition."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Sequence, Union

from services.meshy.architectural_scoring import (
    combined_frame_score,
    is_diverse_enough,
)
from services.meshy.person_filter import filter_person_frames

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


def _rank_score(
    frame: FrameCandidate,
    *,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    min_architecture: float = 0.0,
) -> float:
    sharp = frame.sharpness if frame.sharpness is not None else 0.0
    arch = architecture_by_index.get(frame.index, 0.5) if architecture_by_index else 1.0
    return combined_frame_score(sharp, arch, min_architecture=min_architecture)


def _best_in_pool(
    pool: Sequence[FrameCandidate],
    *,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    min_architecture: float = 0.0,
    exclude: Optional[set[int]] = None,
    diversity_refs: Optional[Sequence[Path]] = None,
) -> Optional[FrameCandidate]:
    if not pool:
        return None
    ranked = sorted(
        pool,
        key=lambda f: -_rank_score(
            f,
            architecture_by_index=architecture_by_index,
            min_architecture=min_architecture,
        ),
    )
    for candidate in ranked:
        if exclude and candidate.index in exclude:
            continue
        if diversity_refs and not is_diverse_enough(candidate.path, diversity_refs):
            continue
        return candidate
    return ranked[0] if ranked else None


def _yaw_in_sector(yaw_deg: float, start: float, end: float) -> bool:
    y = yaw_deg % 360.0
    if start <= end:
        return start <= y < end
    return y >= start or y < end


def _select_angular_diverse_keyframes(
    zone_frames: Sequence[FrameCandidate],
    zone_id: int,
    n_zones: int,
    max_count: int,
    *,
    person_by_index: Optional[Mapping[int, bool]] = None,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    min_architecture: float = 0.0,
    diversity_refs: Optional[Sequence[Path]] = None,
    exclude_indices: Optional[set[int]] = None,
) -> list[FrameCandidate]:
    """Pick sharpest frame per angular sub-sector within a zone bucket."""
    if max_count <= 0 or not zone_frames:
        return []

    zone_frames, _ = filter_person_frames(zone_frames, person_by_index)

    bucket = 360.0 / n_zones
    z_min = zone_id * bucket
    sector_size = bucket / max_count
    selected: list[FrameCandidate] = []

    for sector in range(max_count):
        s_start = z_min + sector * sector_size
        s_end = s_start + sector_size
        pool = [
            f for f in zone_frames
            if f.yaw_deg is not None and _yaw_in_sector(f.yaw_deg, s_start, s_end)
        ]
        if not pool:
            center = (s_start + s_end) / 2.0
            distances = [
                (_angular_distance(f.yaw_deg or 0.0, center), f)
                for f in zone_frames
            ]
            min_dist = min(d for d, _ in distances)
            near = [f for d, f in distances if d <= min_dist + 1.0]
            pool = [
                _best_in_pool(
                    near,
                    architecture_by_index=architecture_by_index,
                    min_architecture=min_architecture,
                    exclude=exclude_indices,
                    diversity_refs=diversity_refs,
                ) or near[0]
            ]
        if pool:
            best = _best_in_pool(
                pool,
                architecture_by_index=architecture_by_index,
                min_architecture=min_architecture,
                exclude=exclude_indices,
                diversity_refs=diversity_refs,
            )
            if best is None:
                best = max(
                    pool,
                    key=lambda f: _rank_score(
                        f,
                        architecture_by_index=architecture_by_index,
                        min_architecture=min_architecture,
                    ),
                )
            if best not in selected:
                selected.append(best)

    if len(selected) < max_count:
        remaining = [f for f in zone_frames if f not in selected]
        ranked = sorted(
            remaining,
            key=lambda f: -_rank_score(
                f,
                architecture_by_index=architecture_by_index,
                min_architecture=min_architecture,
            ),
        )
        for candidate in ranked:
            if exclude_indices and candidate.index in exclude_indices:
                continue
            if diversity_refs and not is_diverse_enough(candidate.path, diversity_refs):
                continue
            selected.append(candidate)
            if len(selected) >= max_count:
                break

    return sorted(selected[:max_count], key=lambda f: f.index)


def _angular_distance(a: float, b: float) -> float:
    d = abs((a % 360.0) - (b % 360.0))
    return min(d, 360.0 - d)


def _select_diverse_keyframes(
    pool: Sequence[FrameCandidate],
    max_count: int,
    *,
    min_index_gap: int = 1,
    person_by_index: Optional[Mapping[int, bool]] = None,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    min_architecture: float = 0.0,
) -> list[FrameCandidate]:
    if max_count <= 0 or not pool:
        return []

    pool, _ = filter_person_frames(pool, person_by_index)

    ranked = sorted(
        pool,
        key=lambda frame: (
            -_rank_score(
                frame,
                architecture_by_index=architecture_by_index,
                min_architecture=min_architecture,
            ),
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
    person_by_index: Optional[Mapping[int, bool]] = None,
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

    selected = _select_diverse_keyframes(
        candidates, max_count, min_index_gap=gap, person_by_index=person_by_index,
    )
    return [frame.path for frame in selected]


def select_zone_keyframes(
    frames: Sequence[Union[Path, str]],
    *,
    n_zones: int = DEFAULT_ZONE_COUNT,
    max_per_zone: int = MESHY_MAX_IMAGES,
    timestamps_sec: Optional[Sequence[float]] = None,
    yaw_by_index: Optional[Mapping[int, float]] = None,
    sharpness_by_index: Optional[Mapping[int, float]] = None,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    person_by_index: Optional[Mapping[int, bool]] = None,
    min_architecture: float = 0.0,
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
    primary_refs: list[Path] = []
    for zone_id in sorted(zones.keys()):
        zone_frames = zones[zone_id]
        if len(zone_frames) < min_frames_per_zone:
            continue
        selected = _select_angular_diverse_keyframes(
            zone_frames,
            zone_id,
            n_zones,
            max_per_zone,
            person_by_index=person_by_index,
            architecture_by_index=architecture_by_index,
            min_architecture=min_architecture,
            diversity_refs=primary_refs,
        )
        if selected:
            selected_by_zone[zone_id] = [frame.path for frame in selected]
            primary_refs.append(selected[0].path)

    return selected_by_zone


def select_alternate_zone_keyframes(
    frames: Sequence[Union[Path, str]],
    zone_id: int,
    *,
    n_zones: int = DEFAULT_ZONE_COUNT,
    max_per_zone: int = MESHY_MAX_IMAGES,
    yaw_by_index: Optional[Mapping[int, float]] = None,
    sharpness_by_index: Optional[Mapping[int, float]] = None,
    architecture_by_index: Optional[Mapping[int, float]] = None,
    person_by_index: Optional[Mapping[int, bool]] = None,
    min_architecture: float = 0.0,
    exclude_indices: Optional[set[int]] = None,
) -> list[Path]:
    """Pick alternate keyframes for a zone, excluding previously used frame indices."""
    candidates = frame_candidates_from_paths(
        frames,
        yaw_by_index=yaw_by_index,
        sharpness_by_index=sharpness_by_index,
    )
    zones = assign_zones_by_yaw(candidates, n_zones=n_zones)
    zone_frames = zones.get(zone_id, [])
    if not zone_frames:
        return []

    selected = _select_angular_diverse_keyframes(
        zone_frames,
        zone_id,
        n_zones,
        max_per_zone,
        person_by_index=person_by_index,
        architecture_by_index=architecture_by_index,
        min_architecture=min_architecture,
        exclude_indices=exclude_indices or set(),
    )
    return [frame.path for frame in selected]
