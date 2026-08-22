"""Tests for zone mesh quality classification."""

from pathlib import Path
from unittest.mock import patch

from services.meshy.mesh_quality import classify_zone_mesh, mesh_passes_quality_gate


def test_classify_chair_like_object(tmp_path: Path) -> None:
    path = tmp_path / "chair.glb"
    path.write_bytes(b"fake")
    chair_bbox = {"min": [0, 0, 0], "max": [0.5, 1.0, 0.5]}
    with patch("services.meshy.mesh_quality.glb_bbox", return_value=chair_bbox):
        assert classify_zone_mesh(path) == "object"


def test_classify_wide_wall_architectural(tmp_path: Path) -> None:
    path = tmp_path / "wall.glb"
    path.write_bytes(b"fake")
    wall_bbox = {"min": [0, 0, 0], "max": [4.0, 2.5, 0.2]}
    with patch("services.meshy.mesh_quality.glb_bbox", return_value=wall_bbox):
        assert classify_zone_mesh(path) == "architectural"


def test_classify_humanoid_object(tmp_path: Path) -> None:
    path = tmp_path / "person.glb"
    path.write_bytes(b"fake")
    human_bbox = {"min": [0, 0, 0], "max": [0.4, 1.8, 0.35]}
    with patch("services.meshy.mesh_quality.glb_bbox", return_value=human_bbox):
        assert classify_zone_mesh(path) == "object"


def test_mesh_passes_quality_gate_rejects_compact_unknown(tmp_path: Path) -> None:
    path = tmp_path / "blob.glb"
    path.write_bytes(b"fake")
    compact_bbox = {"min": [0, 0, 0], "max": [0.5, 1.0, 0.45]}
    with patch("services.meshy.mesh_quality.glb_bbox", return_value=compact_bbox):
        with patch("services.meshy.mesh_quality.classify_zone_mesh", return_value="unknown"):
            assert mesh_passes_quality_gate(path) is False


def test_mesh_passes_quality_gate_rejects_object(tmp_path: Path) -> None:
    path = tmp_path / "obj.glb"
    path.write_bytes(b"fake")
    with patch("services.meshy.mesh_quality.classify_zone_mesh", return_value="object"):
        assert mesh_passes_quality_gate(path) is False
