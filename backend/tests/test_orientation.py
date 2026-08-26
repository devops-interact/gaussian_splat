"""Tests for video orientation detection."""

from services.video.orientation import (
    LANDSCAPE_FOV_DEG,
    PORTRAIT_FOV_DEG,
    alternate_rotation_candidates,
    frame_is_portrait,
    orientation_from_dimensions,
    probe_video_orientation,
    read_image_dimensions,
    resolve_pipeline_orientation,
    verify_extracted_frame_orientation,
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


def test_alternate_rotation_candidates_portrait() -> None:
    assert alternate_rotation_candidates(0, True) == [90, 270]
    assert alternate_rotation_candidates(90, True) == [270, 0]
    assert alternate_rotation_candidates(270, True) == [90, 0]


def test_alternate_rotation_candidates_landscape() -> None:
    assert alternate_rotation_candidates(90, False) == [0, 180]
    assert alternate_rotation_candidates(270, False) == [0, 180]


def test_resolve_pipeline_orientation_fallback(tmp_path) -> None:
    class FakeValidation:
        width = 1920
        height = 1080
        rotation_deg = 90
        is_portrait = True

    orient = resolve_pipeline_orientation(tmp_path / "missing.mov", FakeValidation())
    assert orient.is_portrait is True
    assert orient.rotation_deg == 90
    assert orient.display_width == 1080
    assert orient.display_height == 1920


def test_read_png_dimensions(tmp_path) -> None:
    png_path = tmp_path / "portrait.png"
    png_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x04\x38"  # width 1080
        b"\x00\x00\x07\x80"  # height 1920
        b"\x08\x02\x00\x00\x00"
        b"\x00" * 20
    )
    w, h = read_image_dimensions(png_path)
    assert w == 1080
    assert h == 1920
    assert frame_is_portrait(w, h) is True
    assert verify_extracted_frame_orientation(png_path, True) is True
    assert verify_extracted_frame_orientation(png_path, False) is False
