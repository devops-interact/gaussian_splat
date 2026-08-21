"""Tests for preset-aware video validation."""
from pathlib import Path
from unittest.mock import patch

from services.video.validate import validate_video, VideoInfo


def test_validate_video_uses_extraction_fps(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    info = VideoInfo(
        duration=10.0,
        width=1920,
        height=1080,
        fps=30.0,
        codec="h264",
        file_size=1024,
    )
    with patch("services.video.validate.get_video_info", return_value=info):
        result = validate_video(video, extraction_fps=1.0)
    assert result.valid is True
    assert result.video_info.duration == 10.0
