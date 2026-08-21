"""Tests for keyframe publishing (URL vs data URI)."""
from pathlib import Path

import pytest

from services.meshy.storage_upload import paths_to_data_uris, publish_keyframes


def test_paths_to_data_uris(tmp_path):
    img = tmp_path / "frame.jpg"
    img.write_bytes(b"\xff\xd8\xff fake jpeg")
    uris = paths_to_data_uris([img])
    assert len(uris) == 1
    assert uris[0].startswith("data:image/jpeg;base64,")


def test_publish_keyframes_data_uri_fallback(temp_storage, monkeypatch):
    src = temp_storage.FRAMES_DIR / "src.png"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"\x89PNG\r\n\x1a\n")

    monkeypatch.setattr("services.meshy.storage_upload.settings.STORAGE_PUBLIC_BASE_URL", "")
    urls = publish_keyframes("job-1", [src])
    assert len(urls) == 1
    assert urls[0].startswith("data:image/png;base64,")


def test_publish_keyframes_public_url(temp_storage, monkeypatch):
    src = temp_storage.FRAMES_DIR / "src.jpg"
    src.write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(
        "services.meshy.storage_upload.settings.STORAGE_PUBLIC_BASE_URL",
        "https://api.example.com",
    )
    urls = publish_keyframes("job-2", [src])
    assert urls[0] == "https://api.example.com/static/frames/job-2/keyframes/keyframe_00.jpg"
