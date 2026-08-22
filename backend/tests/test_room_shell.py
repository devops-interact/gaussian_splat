from pathlib import Path
from unittest.mock import patch

from services.meshy.room_shell import (
    create_room_shell,
    estimate_room_envelope,
    should_create_shell,
)


def test_estimate_room_envelope_from_coverage() -> None:
    env = estimate_room_envelope(coverage_span_deg=300.0, orbit_radius_m=2.5, default_height_m=2.7)
    assert env["size_x"] >= 3.0
    assert env["size_z"] >= 3.0
    assert env["size_y"] == 2.7


def test_should_create_shell_requires_coverage() -> None:
    assert should_create_shell(20, 250.0) is True
    assert should_create_shell(5, 250.0) is False
    assert should_create_shell(20, 150.0) is False


def test_create_room_shell_uses_envelope_not_zone_bbox(tmp_path: Path) -> None:
    frames = []
    for i in range(10):
        p = tmp_path / f"frame_{i:03d}.jpg"
        p.write_bytes(b"fake")
        frames.append(p)

    fake_image = object()
    with (
        patch("services.meshy.room_shell._pick_frontal_keyframe", return_value=fake_image),
        patch("services.meshy.room_shell._make_textured_wall") as mock_wall,
        patch("services.meshy.room_shell._make_colored_cap") as mock_cap,
        patch("trimesh.Scene") as mock_scene_cls,
    ):
        mock_wall.return_value = object()
        mock_cap.return_value = object()
        mock_scene = mock_scene_cls.return_value
        mock_scene.export = lambda path: Path(path).write_bytes(b"glb")
        result = create_room_shell(
            "job-1",
            tmp_path / "models",
            frames,
            coverage_span_deg=320.0,
            orbit_radius_m=2.5,
            default_height_m=2.7,
        )

    assert result is not None
    assert mock_wall.call_count == 4
    wall_w, wall_h = mock_wall.call_args_list[0][0][0], mock_wall.call_args_list[0][0][1]
    assert wall_w >= 3.0 or wall_h >= 2.7


def test_create_room_shell_skips_without_textures(tmp_path: Path) -> None:
    frames = [tmp_path / f"frame_{i:03d}.jpg" for i in range(10)]
    for p in frames:
        p.write_bytes(b"fake")

    with patch("services.meshy.room_shell._pick_frontal_keyframe", return_value=None):
        result = create_room_shell(
            "job-1",
            tmp_path / "models",
            frames,
            coverage_span_deg=320.0,
        )

    assert result is None
