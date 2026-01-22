"""
Extract frames from video using FFmpeg
"""
import asyncio
import logging
from pathlib import Path
from utils.shell import run_command

logger = logging.getLogger(__name__)

async def extract_frames(
    video_path: Path,
    output_dir: Path,
    fps: float = 2.0
) -> Path:
    """
    Extract frames from video at specified FPS
    
    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        fps: Frames per second to extract
    
    Returns:
        Path to directory containing extracted frames
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_pattern = output_dir / "frame_%06d.jpg"
    
    logger.info(f"Extracting frames from {video_path} at {fps} FPS")
    
    # FFmpeg command to extract frames
    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",  # High quality JPEG
        str(frame_pattern)
    ]
    
    try:
        await run_command(cmd)
        logger.info(f"Frames extracted to {output_dir}")
        return output_dir
    except Exception as e:
        logger.error(f"Frame extraction failed: {e}")
        raise
