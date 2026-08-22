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
        patch("trimesh.creation.box") as mock_box,
        patch("trimesh.visual.material.PBRMaterial"),
        patch("trimesh.visual.TextureVisuals"),
    ):
        mock_mesh = mock_box.return_value
        mock_mesh.export = lambda path: Path(path).write_bytes(b"glb")
        result = create_room_shell(
            "job-1",
            tmp_path / "models",
            frames,
            coverage_span_deg=320.0,
            orbit_radius_m=2.5,
            default_height_m=2.7,
        )

    assert result is not None
    extents = mock_box.call_args[1]["extents"]
    assert extents[0] >= 3.0
    assert extents[2] >= 3.0


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
