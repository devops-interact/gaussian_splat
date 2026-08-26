"""Video display orientation from container metadata and dimensions."""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

LANDSCAPE_FOV_DEG = 70.0
PORTRAIT_FOV_DEG = 52.0


@dataclass(frozen=True)
class VideoOrientation:
    stored_width: int
    stored_height: int
    rotation_deg: int
    display_width: int
    display_height: int
    aspect_label: str
    is_portrait: bool

    @property
    def label(self) -> str:
        return "portrait" if self.is_portrait else "landscape"

    @property
    def horizontal_fov_deg(self) -> float:
        return PORTRAIT_FOV_DEG if self.is_portrait else LANDSCAPE_FOV_DEG


def _normalize_rotation(value: object) -> int:
    try:
        deg = int(float(value)) % 360
    except (TypeError, ValueError):
        return 0
    if deg not in (0, 90, 180, 270):
        return 0
    return deg


def _aspect_label(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return "unknown"
    ratio = width / height
    if abs(ratio - 16 / 9) < 0.08:
        return "16:9"
    if abs(ratio - 9 / 16) < 0.08:
        return "9:16"
    if abs(ratio - 4 / 3) < 0.08:
        return "4:3"
    if abs(ratio - 3 / 4) < 0.08:
        return "3:4"
    return f"{width}:{height}"


def orientation_from_dimensions(
    width: int,
    height: int,
    rotation_deg: int = 0,
) -> VideoOrientation:
    rotation = _normalize_rotation(rotation_deg)
    if rotation in (90, 270):
        display_width, display_height = height, width
    else:
        display_width, display_height = width, height
    is_portrait = display_height > display_width
    return VideoOrientation(
        stored_width=width,
        stored_height=height,
        rotation_deg=rotation,
        display_width=display_width,
        display_height=display_height,
        aspect_label=_aspect_label(display_width, display_height),
        is_portrait=is_portrait,
    )


def rotation_from_stream(stream: dict) -> int:
    """Parse rotation metadata from an ffprobe video stream dict."""
    return _rotation_from_stream(stream)


def _rotation_from_stream(stream: dict) -> int:
    tags = stream.get("tags") or {}
    if "rotate" in tags:
        return _normalize_rotation(tags["rotate"])

    for side in stream.get("side_data_list") or []:
        if side.get("side_data_type") == "Display Matrix":
            matrix = side.get("rotation")
            if matrix is not None:
                return _normalize_rotation(matrix)

    return 0


def transpose_filter_for_rotation(rotation_deg: int) -> Optional[str]:
    """
    Map container rotation metadata to an FFmpeg transpose/hflip chain.

    Matches iPhone/MOV rotate tag conventions used by ffprobe.
    """
    rotation = _normalize_rotation(rotation_deg)
    if rotation == 90:
        return "transpose=1"
    if rotation == 180:
        return "hflip,vflip"
    if rotation == 270:
        return "transpose=2"
    return None


def probe_video_orientation(video_path: Path) -> Optional[VideoOrientation]:
    """Read stored dimensions and rotation metadata via ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            str(video_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.warning("ffprobe orientation probe failed: %s", result.stderr)
            return None

        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") != "video":
                continue
            width = int(stream.get("width", 0))
            height = int(stream.get("height", 0))
            if width <= 0 or height <= 0:
                return None
            rotation = _rotation_from_stream(stream)
            return orientation_from_dimensions(width, height, rotation)
    except Exception as exc:
        logger.warning("Could not probe video orientation for %s: %s", video_path, exc)
    return None


def read_image_dimensions(image_path: Path) -> tuple[int, int]:
    """Read PNG/JPEG width and height without external deps (PNG IHDR)."""
    with open(image_path, "rb") as f:
        header = f.read(24)
    if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")
        return width, height
    raise ValueError(f"Unsupported or corrupt image for dimension probe: {image_path}")


def frame_is_portrait(width: int, height: int) -> bool:
    return height > width


def verify_extracted_frame_orientation(frame_path: Path, expected_portrait: bool) -> bool:
    """True when extracted PNG aspect matches expected display orientation."""
    width, height = read_image_dimensions(frame_path)
    return frame_is_portrait(width, height) == expected_portrait


def alternate_rotation_candidates(rotation_deg: int, expected_portrait: bool) -> list[int]:
    """Rotation values to try when extracted frames have wrong orientation."""
    rotation = _normalize_rotation(rotation_deg)
    if expected_portrait:
        if rotation == 0:
            return [90, 270]
        if rotation == 90:
            return [270, 0]
        if rotation == 270:
            return [90, 0]
        if rotation == 180:
            return [90, 270, 0]
    else:
        if rotation in (90, 270):
            return [0, 180]
        if rotation == 180:
            return [0]
    return []


def resolve_pipeline_orientation(
    video_path: Path,
    validation: Optional[object] = None,
) -> VideoOrientation:
    """
    Resolve orientation from ffprobe, falling back to persisted job validation.
    validation may be a VideoValidation model or any object with width/height/rotation_deg/is_portrait.
    """
    orient = probe_video_orientation(video_path)
    if orient:
        return orient

    if validation is not None:
        width = getattr(validation, "width", None)
        height = getattr(validation, "height", None)
        rotation_deg = getattr(validation, "rotation_deg", 0) or 0
        if width and height:
            logger.warning(
                "ffprobe orientation probe failed — using persisted validation "
                "(rotation=%d°, stored=%dx%d)",
                rotation_deg,
                width,
                height,
            )
            return orientation_from_dimensions(width, height, rotation_deg)

    logger.warning("No orientation metadata for %s — assuming landscape", video_path)
    return orientation_from_dimensions(1920, 1080, 0)
