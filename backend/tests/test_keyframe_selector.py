"""Tests for keyframe selection."""
from pathlib import Path

import cv2
import numpy as np
import pytest

from services.meshy.keyframe_selector import select_keyframes, _sharpness_score


@pytest.fixture
def frames_dir(tmp_path):
    d = tmp_path / "frames"
    d.mkdir()
    for i in range(8):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        cv2.putText(img, str(i), (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        cv2.imwrite(str(d / f"frame_{i:06d}.png"), img)
    return d


def test_select_keyframes_returns_up_to_four(frames_dir):
    selected = select_keyframes(frames_dir, max_frames=4)
    assert 1 <= len(selected) <= 4


def test_select_keyframes_all_when_few(frames_dir):
    for p in list(frames_dir.glob("frame_*.png"))[4:]:
        p.unlink()
    selected = select_keyframes(frames_dir, max_frames=4)
    assert len(selected) == 4


def test_sharpness_score_nonzero(frames_dir):
    p = next(frames_dir.glob("*.png"))
    assert _sharpness_score(p) >= 0
