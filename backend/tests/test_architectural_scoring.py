"""Tests for architectural frame scoring."""

from pathlib import Path

import numpy as np
import pytest

from services.meshy.architectural_scoring import (
    architecture_score,
    combined_frame_score,
    frame_diversity_distance,
    is_diverse_enough,
)


def _write_gray(path: Path, gray: np.ndarray) -> None:
    import cv2

    cv2.imwrite(str(path), gray)


def test_combined_frame_score_weights_architecture() -> None:
    assert combined_frame_score(10.0, 0.5) == pytest.approx(5.0)
    assert combined_frame_score(10.0, 1.0) == pytest.approx(10.0)


def test_architecture_score_wall_like_frame(tmp_path: Path) -> None:
    gray = np.full((240, 320), 128, dtype=np.uint8)
    gray[:, 0] = 40
    gray[:, -1] = 40
    gray[0, :] = 40
    path = tmp_path / "wall.jpg"
    _write_gray(path, gray)
    score = architecture_score(path)
    assert score > 0.2


def test_frame_diversity_distance_identical(tmp_path: Path) -> None:
    gray = np.random.randint(0, 255, (120, 160), dtype=np.uint8)
    a = tmp_path / "a.jpg"
    b = tmp_path / "b.jpg"
    _write_gray(a, gray)
    _write_gray(b, gray.copy())
    assert frame_diversity_distance(a, b) < 0.05


def test_is_diverse_enough_rejects_similar(tmp_path: Path) -> None:
    gray = np.random.randint(0, 255, (120, 160), dtype=np.uint8)
    a = tmp_path / "a.jpg"
    b = tmp_path / "b.jpg"
    _write_gray(a, gray)
    _write_gray(b, gray.copy())
    assert not is_diverse_enough(a, [b], threshold=0.12)
