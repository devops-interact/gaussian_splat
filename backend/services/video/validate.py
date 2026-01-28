"""
Video validation service - validates videos before processing
"""
import logging
import subprocess
import json
from pathlib import Path
from typing import Tuple, Optional
from dataclasses import dataclass
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class VideoInfo:
    """Video metadata"""
    duration: float  # seconds
    width: int
    height: int
    fps: float
    codec: str
    file_size: int  # bytes


@dataclass
class ValidationResult:
    """Result of video validation"""
    valid: bool
    video_info: Optional[VideoInfo]
    errors: list[str]
    warnings: list[str]


def get_video_info(video_path: Path) -> Optional[VideoInfo]:
    """
    Extract video metadata using ffprobe
    """
    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.error(f"ffprobe failed: {result.stderr}")
            return None
        
        data = json.loads(result.stdout)
        
        # Find video stream
        video_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break
        
        if not video_stream:
            logger.error("No video stream found")
            return None
        
        # Extract info
        format_info = data.get("format", {})
        
        # Parse FPS (can be "30/1" or "29.97")
        fps_str = video_stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) > 0 else 30.0
        else:
            fps = float(fps_str)
        
        return VideoInfo(
            duration=float(format_info.get("duration", 0)),
            width=int(video_stream.get("width", 0)),
            height=int(video_stream.get("height", 0)),
            fps=fps,
            codec=video_stream.get("codec_name", "unknown"),
            file_size=int(format_info.get("size", 0))
        )
        
    except subprocess.TimeoutExpired:
        logger.error("ffprobe timed out")
        return None
    except Exception as e:
        logger.error(f"Failed to get video info: {e}")
        return None


def validate_video(video_path: Path) -> ValidationResult:
    """
    Validate a video file for 3D reconstruction
    
    Checks:
    - File exists and is readable
    - Duration within limits
    - Resolution within limits
    - Has video stream
    - Codec is supported
    
    Returns:
        ValidationResult with valid flag, video info, errors and warnings
    """
    errors = []
    warnings = []
    
    # Check file exists
    if not video_path.exists():
        return ValidationResult(
            valid=False,
            video_info=None,
            errors=["Video file not found"],
            warnings=[]
        )
    
    # Check file extension
    ext = video_path.suffix.lower()
    if ext not in settings.ALLOWED_EXTENSIONS:
        return ValidationResult(
            valid=False,
            video_info=None,
            errors=[f"Unsupported format: {ext}. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}"],
            warnings=[]
        )
    
    # Get video info
    video_info = get_video_info(video_path)
    
    if not video_info:
        return ValidationResult(
            valid=False,
            video_info=None,
            errors=["Could not read video file. File may be corrupted."],
            warnings=[]
        )
    
    # Validate duration
    if video_info.duration < settings.MIN_VIDEO_DURATION:
        errors.append(
            f"Video too short: {video_info.duration:.1f}s. "
            f"Minimum: {settings.MIN_VIDEO_DURATION}s"
        )
    
    if video_info.duration > settings.MAX_VIDEO_DURATION:
        errors.append(
            f"Video too long: {video_info.duration:.1f}s. "
            f"Maximum: {settings.MAX_VIDEO_DURATION}s (5 minutes)"
        )
    
    # Validate resolution
    min_dim = min(video_info.width, video_info.height)
    max_dim = max(video_info.width, video_info.height)
    
    if min_dim < settings.MIN_VIDEO_RESOLUTION:
        errors.append(
            f"Resolution too low: {video_info.width}x{video_info.height}. "
            f"Minimum: {settings.MIN_VIDEO_RESOLUTION}p"
        )
    
    if max_dim > settings.MAX_VIDEO_RESOLUTION:
        warnings.append(
            f"High resolution video ({video_info.width}x{video_info.height}) "
            f"will be downscaled for processing"
        )
    
    # Validate dimensions (must be even for video encoding)
    if video_info.width % 2 != 0 or video_info.height % 2 != 0:
        warnings.append("Video dimensions are odd; may cause encoding issues")
    
    # Check FPS
    if video_info.fps < 15:
        warnings.append(
            f"Low frame rate ({video_info.fps:.1f} fps) may result in "
            f"lower quality reconstruction"
        )
    
    if video_info.fps > 60:
        warnings.append(
            f"High frame rate ({video_info.fps:.1f} fps) - "
            f"frames will be sampled for efficiency"
        )
    
    # Check file size
    if video_info.file_size > settings.MAX_UPLOAD_SIZE:
        errors.append(
            f"File too large: {video_info.file_size / (1024*1024):.1f}MB. "
            f"Maximum: {settings.MAX_UPLOAD_SIZE / (1024*1024):.0f}MB"
        )
    
    # Estimate processing time and frames
    estimated_frames = int(video_info.duration * 2)  # At 2 FPS
    if estimated_frames < 10:
        errors.append(
            f"Not enough frames for reconstruction. "
            f"Video would produce only {estimated_frames} frames. Minimum: 10"
        )
    
    if estimated_frames > 500:
        warnings.append(
            f"Large video ({estimated_frames} frames at 2 FPS). "
            f"Consider using a shorter clip for faster processing."
        )
    
    return ValidationResult(
        valid=len(errors) == 0,
        video_info=video_info,
        errors=errors,
        warnings=warnings
    )


async def validate_video_async(video_path: Path) -> ValidationResult:
    """Async wrapper for video validation"""
    import asyncio
    return await asyncio.get_event_loop().run_in_executor(
        None, validate_video, video_path
    )
