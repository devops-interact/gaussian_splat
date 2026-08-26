"""
Extract frames from video using FFmpeg
"""
import asyncio
import logging
from pathlib import Path
from typing import Optional

from utils.shell import run_command
from services.video.orientation import (
    alternate_rotation_candidates,
    build_extract_vf_filter,
    read_image_dimensions,
    verify_extracted_frame_orientation,
)

logger = logging.getLogger(__name__)


async def _run_ffmpeg_extract(
    video_path: Path,
    frame_pattern: Path,
    fps: float,
    rotation_deg: int,
) -> None:
    vf = build_extract_vf_filter(fps, rotation_deg)
    cmd = [
        "ffmpeg",
        "-y",
        "-threads", "0",
        "-i", str(video_path),
        "-vf", vf,
        str(frame_pattern),
    ]
    await run_command(cmd)


async def extract_frames(
    video_path: Path,
    output_dir: Path,
    fps: float = 2.0,
    *,
    rotation_deg: int = 0,
    expected_portrait: Optional[bool] = None,
) -> Path:
    """
    Extract frames from video at specified FPS.

    When expected_portrait is set, verifies the first frame orientation and
    retries with alternate transpose values if metadata was wrong.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_pattern = output_dir / "frame_%06d.png"

    for existing in output_dir.glob("frame_*.png"):
        existing.unlink(missing_ok=True)

    logger.info(
        "Extracting frames from %s at %s FPS (rotation=%d°, expected_portrait=%s)",
        video_path,
        fps,
        rotation_deg,
        expected_portrait,
    )

    await _run_ffmpeg_extract(video_path, frame_pattern, fps, rotation_deg)

    first_frame = output_dir / "frame_000001.png"
    if not first_frame.exists():
        frames = sorted(output_dir.glob("frame_*.png"))
        first_frame = frames[0] if frames else None

    if first_frame and expected_portrait is not None:
        if not verify_extracted_frame_orientation(first_frame, expected_portrait):
            w, h = read_image_dimensions(first_frame)
            logger.warning(
                "Extracted frame %dx%d does not match expected portrait=%s — retrying transpose",
                w,
                h,
                expected_portrait,
            )
            for alt_rotation in alternate_rotation_candidates(rotation_deg, expected_portrait):
                for existing in output_dir.glob("frame_*.png"):
                    existing.unlink(missing_ok=True)
                logger.info("Retrying frame extraction with rotation=%d°", alt_rotation)
                await _run_ffmpeg_extract(video_path, frame_pattern, fps, alt_rotation)
                retry_first = output_dir / "frame_000001.png"
                if not retry_first.exists():
                    frames = sorted(output_dir.glob("frame_*.png"))
                    retry_first = frames[0] if frames else None
                if retry_first and verify_extracted_frame_orientation(retry_first, expected_portrait):
                    rw, rh = read_image_dimensions(retry_first)
                    logger.info(
                        "Frame orientation corrected with rotation=%d° (%dx%d)",
                        alt_rotation,
                        rw,
                        rh,
                    )
                    return output_dir
            raise ValueError(
                f"Could not extract frames in correct orientation "
                f"(expected portrait={expected_portrait}). "
                f"Re-upload the video or verify rotation metadata."
            )

    logger.info("Frames extracted to %s", output_dir)
    return output_dir
