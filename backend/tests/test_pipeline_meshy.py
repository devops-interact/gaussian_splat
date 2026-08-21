"""Tests for GLB metadata extraction."""
from pathlib import Path

from core.pipeline import _extract_glb_metadata


def test_extract_glb_metadata_missing_file(tmp_path):
    p = tmp_path / "missing.glb"
    meta = _extract_glb_metadata(p)
    assert meta is not None
    assert meta.format == "glb"
    assert meta.vertex_count is None
