"""
Select optimal keyframes from extracted video frames for multi-image 3D APIs.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def _sharpness_score(image_path: Path) -> float:
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def _list_frame_paths(frames_dir: Path) -> List[Path]:
    paths = sorted(frames_dir.glob("frame_*.png"))
    if not paths:
        paths = sorted(frames_dir.glob("*.png"))
    if not paths:
        paths = sorted(frames_dir.glob("*.jpg"))
    return paths


def select_keyframes(frames_dir: Path, max_frames: int = 4) -> List[Path]:
    """
    Pick up to `max_frames` frames with temporal spread and high sharpness.
    """
    paths = _list_frame_paths(frames_dir)
    if not paths:
        raise ValueError(f"No frames found in {frames_dir}")
    if len(paths) <= max_frames:
        return paths

    scores = [(p, _sharpness_score(p)) for p in paths]
    scores.sort(key=lambda x: x[1], reverse=True)

    # Divide timeline into buckets; pick best sharp frame per bucket
    n = len(paths)
    bucket_size = max(1, n // max_frames)
    selected: List[Path] = []
    used: set[Path] = set()

    for bucket in range(max_frames):
        start = bucket * bucket_size
        end = n if bucket == max_frames - 1 else min(n, (bucket + 1) * bucket_size)
        bucket_paths = paths[start:end]
        if not bucket_paths:
            continue
        best = max(bucket_paths, key=lambda p: next(s for pp, s in scores if pp == p))
        if best not in used:
            selected.append(best)
            used.add(best)

    # Fill remaining slots with globally sharpest unused frames
    for p, _ in scores:
        if len(selected) >= max_frames:
            break
        if p not in used:
            selected.append(p)
            used.add(p)

    selected.sort(key=lambda p: p.name)
    logger.info("Selected keyframes: %s", [p.name for p in selected])
    return selected[:max_frames]
