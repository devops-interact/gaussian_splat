"""Score walkthrough frames for architectural content (walls/floor) vs furniture blobs."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Mapping, Sequence

logger = logging.getLogger(__name__)

# Minimum histogram distance (0–1) between primary keyframes of different zones.
DEFAULT_DIVERSITY_THRESHOLD = 0.12


def _read_gray(image_path: Path):
    import cv2  # type: ignore

    return cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)


def _line_density_score(gray) -> float:
    import cv2  # type: ignore

    edges = cv2.Canny(gray, 50, 150)
    h, w = gray.shape[:2]
    lines = cv2.HoughLinesP(edges, 1, 3.14159 / 180, threshold=60, minLineLength=w // 8, maxLineGap=12)
    if lines is None or len(lines) == 0:
        return 0.0

    horizontal = 0
    vertical = 0
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = abs((y2 - y1) / max((x2 - x1), 1)) if x2 != x1 else 10.0
        if angle < 0.35:
            horizontal += 1
        elif angle > 2.5:
            vertical += 1

    structural = horizontal + vertical
    return min(structural / max(len(lines), 1), 1.0)


def _center_edge_penalty(gray) -> float:
    """Lower is better for architecture — high edges in center = furniture."""
    import cv2  # type: ignore

    h, w = gray.shape[:2]
    y0, y1 = int(h * 0.25), int(h * 0.75)
    x0, x1 = int(w * 0.25), int(w * 0.75)
    center = gray[y0:y1, x0:x1]
    if center.size == 0:
        return 0.5
    edges = cv2.Canny(center, 50, 150)
    density = float(edges.mean()) / 255.0
    return max(0.0, 1.0 - density * 2.5)


def _floor_uniformity_score(gray, *, is_portrait: bool = False) -> float:
    import cv2  # type: ignore

    h, w = gray.shape[:2]
    floor_start = int(h * (0.80 if is_portrait else 0.75))
    floor_band = gray[floor_start:, :]
    if floor_band.size == 0:
        return 0.0
    lap = cv2.Laplacian(floor_band, cv2.CV_64F)
    variance = float(lap.var())
    # Moderate variance = visible floor texture; very high = clutter
    if variance < 20:
        return 0.3
    if variance > 800:
        return 0.2
    return min(variance / 400.0, 1.0)


def architecture_score(image_path: Path, *, is_portrait: bool = False) -> float:
    """
    Return 0–1 score: higher means more wall/floor, less dominant center object.
    """
    try:
        gray = _read_gray(image_path)
        if gray is None:
            return 0.5

        line_score = _line_density_score(gray)
        center_score = _center_edge_penalty(gray)
        floor_score = _floor_uniformity_score(gray, is_portrait=is_portrait)

        combined = line_score * 0.4 + center_score * 0.3 + floor_score * 0.3
        return max(0.05, min(1.0, combined))
    except Exception as exc:
        logger.debug("architecture_score failed for %s: %s", image_path, exc)
        return 0.5


def architecture_scores_by_index(
    frame_paths: Sequence[Path],
    *,
    is_portrait: bool = False,
) -> dict[int, float]:
    return {i: architecture_score(p, is_portrait=is_portrait) for i, p in enumerate(frame_paths)}


def combined_frame_score(
    sharpness: float,
    architecture: float,
    *,
    min_architecture: float = 0.0,
) -> float:
    arch = max(architecture, min_architecture)
    return max(sharpness, 0.01) * arch


def frame_diversity_distance(path_a: Path, path_b: Path) -> float:
    """
    Bhattacharyya distance between grayscale histograms (0 = identical, higher = more different).
    """
    try:
        import cv2  # type: ignore
        import numpy as np

        a = _read_gray(path_a)
        b = _read_gray(path_b)
        if a is None or b is None:
            return 1.0

        size = (64, 64)
        a_small = cv2.resize(a, size)
        b_small = cv2.resize(b, size)
        hist_a = cv2.calcHist([a_small], [0], None, [32], [0, 256])
        hist_b = cv2.calcHist([b_small], [0], None, [32], [0, 256])
        cv2.normalize(hist_a, hist_a)
        cv2.normalize(hist_b, hist_b)
        return float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_BHATTACHARYYA))
    except Exception:
        return 1.0


def is_diverse_enough(
    candidate: Path,
    reference_paths: Sequence[Path],
    *,
    threshold: float = DEFAULT_DIVERSITY_THRESHOLD,
) -> bool:
    if not reference_paths:
        return True
    return all(
        frame_diversity_distance(candidate, ref) >= threshold
        for ref in reference_paths
    )
