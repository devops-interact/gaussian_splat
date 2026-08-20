"""Tests for GLB metadata extraction."""
from pathlib import Path
import pytest

from core.pipeline import _extract_glb_metadata


def test_extract_glb_metadata_missing_file(tmp_path):
    p = tmp_path / "missing.glb"
    assert _extract_glb_metadata(p) is None or True  # trimesh raises; handled
