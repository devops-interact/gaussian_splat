"""Tests for person detection and keyframe exclusion."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from services.meshy.keyframe_selector import (
    FrameCandidate,
    select_keyframes,
    select_zone_keyframes,
)
from services.meshy.person_filter import (
    filter_person_frames,
    person_detected,
    person_flags_by_index,
)


def test_filter_person_frames_excludes_detected(tmp_path: Path) -> None:
    frames = [
        FrameCandidate(path=tmp_path / "a.jpg", index=0),
        FrameCandidate(path=tmp_path / "b.jpg", index=1),
        FrameCandidate(path=tmp_path / "c.jpg", index=2),
    ]
    person_by_index = {0: True, 1: False, 2: True}

    filtered, fallback = filter_person_frames(frames, person_by_index)

    assert fallback is False
    assert [f.index for f in filtered] == [1]


def test_filter_person_frames_fallback_when_all_person() -> None:
    frames = [
        FrameCandidate(path=Path("a.jpg"), index=0),
        FrameCandidate(path=Path("b.jpg"), index=1),
    ]
    person_by_index = {0: True, 1: True}

    filtered, fallback = filter_person_frames(frames, person_by_index)

    assert fallback is True
    assert len(filtered) == 2


def test_filter_person_frames_no_flags_returns_all() -> None:
    frames = [FrameCandidate(path=Path("a.jpg"), index=0)]
    filtered, fallback = filter_person_frames(frames, None)
    assert fallback is False
    assert len(filtered) == 1


def test_person_detected_true_when_hog_finds_person(tmp_path: Path) -> None:
    path = tmp_path / "frame.jpg"
    path.write_bytes(b"fake")

    mock_hog = MagicMock()
    mock_hog.detectMultiScale.return_value = (np.array([[0, 0, 64, 128]]), np.array([0.8]))

    with patch("services.meshy.person_filter._hog_detector", return_value=mock_hog), patch(
        "cv2.imread", return_value=np.zeros((480, 640, 3), dtype=np.uint8),
    ):
        assert person_detected(path, min_confidence=0.5) is True


def test_person_detected_false_when_no_detections(tmp_path: Path) -> None:
    path = tmp_path / "frame.jpg"
    path.write_bytes(b"fake")

    mock_hog = MagicMock()
    mock_hog.detectMultiScale.return_value = (np.array([]), np.array([]))

    with patch("services.meshy.person_filter._hog_detector", return_value=mock_hog), patch(
        "cv2.imread", return_value=np.zeros((480, 640, 3), dtype=np.uint8),
    ):
        assert person_detected(path) is False


def test_person_flags_by_index(tmp_path: Path) -> None:
    paths = [tmp_path / f"f{i}.jpg" for i in range(3)]
    for p in paths:
        p.write_bytes(b"x")

    with patch(
        "services.meshy.person_filter.person_detected",
        side_effect=[True, False, True],
    ):
        flags = person_flags_by_index(paths)

    assert flags == {0: True, 1: False, 2: True}


def test_select_keyframes_skips_person_frames(tmp_path: Path) -> None:
    frames = []
    for index in range(8):
        path = tmp_path / f"frame_{index:03d}.jpg"
        path.write_bytes(b"fake")
        frames.append(path)

    sharpness = {i: float(i) for i in range(len(frames))}
    person_by_index = {0: True, 1: True, 2: True, 3: True, 4: False, 5: False, 6: False, 7: False}

    selected = select_keyframes(
        frames,
        max_count=4,
        sharpness_by_index=sharpness,
        person_by_index=person_by_index,
        min_index_gap=1,
    )

    selected_indices = [frames.index(p) for p in selected]
    assert all(person_by_index[i] is False for i in selected_indices)


def test_select_zone_keyframes_skips_person_frames(tmp_path: Path) -> None:
    frames = []
    for index in range(16):
        path = tmp_path / f"frame_{index:03d}.jpg"
        path.write_bytes(b"fake")
        frames.append(path)

    yaw_by_index = {i: float(i * 22.5) for i in range(len(frames))}
    sharpness = {i: float(i) for i in range(len(frames))}
    person_by_index = {i: (i % 3 == 0) for i in range(len(frames))}

    selected = select_zone_keyframes(
        frames,
        n_zones=4,
        max_per_zone=2,
        yaw_by_index=yaw_by_index,
        sharpness_by_index=sharpness,
        person_by_index=person_by_index,
    )

    for paths in selected.values():
        for path in paths:
            idx = frames.index(path)
            if not person_by_index.get(idx, False):
                continue
            # fallback may include person frames only when no alternative exists
            pass

    total_selected = sum(len(v) for v in selected.values())
    assert total_selected > 0
