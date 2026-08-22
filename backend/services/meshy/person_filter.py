"""Detect people in walkthrough frames so keyframe selection can exclude them."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

_HOG = None
_CENTER_CROP_RATIO = 0.70


def _hog_detector():
    global _HOG
    if _HOG is None:
        import cv2  # type: ignore

        hog = cv2.HOGDescriptor()
        hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        _HOG = hog
    return _HOG


def _center_crop(image, ratio: float = _CENTER_CROP_RATIO):
    import cv2  # type: ignore

    height, width = image.shape[:2]
    crop_w = max(1, int(width * ratio))
    crop_h = max(1, int(height * ratio))
    x0 = (width - crop_w) // 2
    y0 = (height - crop_h) // 2
    return image[y0 : y0 + crop_h, x0 : x0 + crop_w]


def person_detected(
    image_path: Path,
    *,
    hit_threshold: float = 0.0,
    min_confidence: float = 0.5,
    center_crop_ratio: float = _CENTER_CROP_RATIO,
) -> bool:
    """
    Return True when a person is detected in the center-weighted crop.

    Uses OpenCV HOG + SVM people detector (camera operator in walkthroughs).
    """
    try:
        import cv2  # type: ignore
    except ImportError as exc:
        raise RuntimeError("opencv-python-headless is required for person_detected") from exc

    image = cv2.imread(str(image_path))
    if image is None:
        return False

    crop = _center_crop(image, center_crop_ratio)
    hog = _hog_detector()
    _rects, weights = hog.detectMultiScale(
        crop,
        winStride=(8, 8),
        padding=(8, 8),
        scale=1.05,
        hitThreshold=hit_threshold,
    )

    if len(weights) == 0:
        return False

    return float(max(weights)) >= min_confidence


def person_flags_by_index(
    frame_paths: Sequence[Path],
    *,
    hit_threshold: float = 0.0,
    min_confidence: float = 0.5,
) -> dict[int, bool]:
    """Map frame index → True when a person is detected in that frame."""
    flags: dict[int, bool] = {}
    for index, path in enumerate(frame_paths):
        try:
            flags[index] = person_detected(
                path,
                hit_threshold=hit_threshold,
                min_confidence=min_confidence,
            )
        except Exception as exc:
            logger.warning("Person detection failed for frame %s: %s", path, exc)
            flags[index] = False
    return flags


def filter_person_frames(
    frames: Sequence,
    person_by_index: Optional[Mapping[int, bool]],
) -> tuple[list, bool]:
    """
    Exclude frames flagged as containing a person.

    Returns (filtered_frames, used_fallback). When every frame has a person,
    returns the original pool and used_fallback=True.
    """
    if not person_by_index:
        return list(frames), False

    filtered = [frame for frame in frames if not person_by_index.get(frame.index, False)]
    if filtered:
        return filtered, False

    logger.warning(
        "All %d candidate frame(s) contain a person — using fallback (least-bad frame)",
        len(frames),
    )
    return list(frames), True
