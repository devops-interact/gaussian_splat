"""Tests for video orientation detection."""

from services.video.orientation import (
    LANDSCAPE_FOV_DEG,
    PORTRAIT_FOV_DEG,
    orientation_from_dimensions,
    probe_video_orientation,
)


def test_landscape_16_9_no_rotation() -> None:
    o = orientation_from_dimensions(1920, 1080, 0)
    assert o.is_portrait is False
    assert o.display_width == 1920
    assert o.display_height == 1080
    assert o.aspect_label == "16:9"
    assert o.label == "landscape"
    assert o.horizontal_fov_deg == LANDSCAPE_FOV_DEG


def test_portrait_9_16_with_90_rotation() -> None:
    o = orientation_from_dimensions(1920, 1080, 90)
    assert o.is_portrait is True
    assert o.display_width == 1080
    assert o.display_height == 1920
    assert o.aspect_label == "9:16"
    assert o.label == "portrait"
    assert o.horizontal_fov_deg == PORTRAIT_FOV_DEG


def test_probe_missing_file_returns_none(tmp_path) -> None:
    assert probe_video_orientation(tmp_path / "missing.mov") is None


def test_transpose_filter_for_rotation() -> None:
    from services.video.orientation import (
        build_extract_vf_filter,
        transpose_filter_for_rotation,
    )

    assert transpose_filter_for_rotation(0) is None
    assert transpose_filter_for_rotation(90) == "transpose=1"
    assert transpose_filter_for_rotation(180) == "hflip,vflip"
    assert transpose_filter_for_rotation(270) == "transpose=2"


def test_build_extract_vf_filter_no_rotation() -> None:
    from services.video.orientation import build_extract_vf_filter

    vf = build_extract_vf_filter(2.0, 0)
    assert vf == "fps=2.0,scale='min(1920,iw)':-2"
    assert "autorotate" not in vf
    assert "transpose" not in vf


def test_build_extract_vf_filter_with_rotation() -> None:
    from services.video.orientation import build_extract_vf_filter

    vf = build_extract_vf_filter(2.0, 90)
    assert "fps=2.0" in vf
    assert "transpose=1" in vf
    assert "scale='min(1920,iw)':-2" in vf
    assert "autorotate" not in vf
