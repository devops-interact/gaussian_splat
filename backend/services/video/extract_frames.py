"""
Extract frames from video using FFmpeg
"""
import asyncio
import logging
from pathlib import Path
from utils.shell import run_command
from services.video.orientation import build_extract_vf_filter

logger = logging.getLogger(__name__)


async def extract_frames(
    video_path: Path,
    output_dir: Path,
    fps: float = 2.0,
    *,
    rotation_deg: int = 0,
) -> Path:
    """
    Extract frames from video at specified FPS.

    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        fps: Frames per second to extract
        rotation_deg: Container rotation metadata (0/90/180/270) for transpose filter

    Returns:
        Path to directory containing extracted frames
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_pattern = output_dir / "frame_%06d.png"
    vf = build_extract_vf_filter(fps, rotation_deg)

    logger.info(
        "Extracting frames from %s at %s FPS (rotation=%d°, vf=%s)",
        video_path,
        fps,
        rotation_deg,
        vf,
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-threads", "0",
        "-i", str(video_path),
        "-vf", vf,
        str(frame_pattern),
    ]

    try:
        await run_command(cmd)
        logger.info(f"Frames extracted to {output_dir}")
        return output_dir
    except Exception as e:
        logger.error(f"Frame extraction failed: {e}")
        raise
