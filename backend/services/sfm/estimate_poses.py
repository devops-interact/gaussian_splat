"""
Estimate camera poses using COLMAP (headless mode for server deployment)
"""
import asyncio
import logging
from pathlib import Path
from utils.shell import run_command

logger = logging.getLogger(__name__)


async def estimate_camera_poses(
    frames_dir: Path,
    output_dir: Path
) -> bool:
    """
    Estimate camera poses from extracted frames using COLMAP
    
    Args:
        frames_dir: Directory containing extracted frames (with .jpg files)
        output_dir: Directory to save COLMAP output
    
    Returns:
        True if successful, False otherwise
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Count frames to verify we have images
    frame_files = list(frames_dir.glob("*.jpg")) + list(frames_dir.glob("*.png"))
    logger.info(f"Found {len(frame_files)} frames in {frames_dir}")
    
    if len(frame_files) < 3:
        logger.error(f"Not enough frames for reconstruction: {len(frame_files)} (need at least 3)")
        return False
    
    logger.info(f"Estimating camera poses using COLMAP (headless mode)")
    
    try:
        database_path = output_dir / "database.db"
        
        # Remove old database if exists to avoid conflicts
        if database_path.exists():
            database_path.unlink()
            logger.info("Removed existing database")
        
        # Step 1: Feature extraction
        # IMPORTANT: --SiftExtraction.use_gpu 0 because apt COLMAP has no CUDA
        # --ImageReader.single_camera 1 assumes all frames from same video/camera
        cmd_feature = [
            "colmap", "feature_extractor",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--ImageReader.camera_model", "PINHOLE",
            "--ImageReader.single_camera", "1",
            "--SiftExtraction.use_gpu", "0",  # CPU mode - apt COLMAP has no CUDA
        ]
        
        logger.info("Running COLMAP feature extraction (CPU mode)...")
        logger.info(f"Command: {' '.join(cmd_feature)}")
        stdout, stderr = await run_command(cmd_feature)
        if stdout:
            logger.info(f"Feature extraction output: {stdout[:1000]}")
        if stderr:
            logger.info(f"Feature extraction stderr: {stderr[:1000]}")
        
        # Step 2: Feature matching
        # --SiftMatching.use_gpu 0 for CPU mode
        cmd_match = [
            "colmap", "exhaustive_matcher",
            "--database_path", str(database_path),
            "--SiftMatching.use_gpu", "0",  # CPU mode
        ]
        
        logger.info("Running COLMAP feature matching (CPU mode)...")
        logger.info(f"Command: {' '.join(cmd_match)}")
        stdout, stderr = await run_command(cmd_match)
        if stdout:
            logger.info(f"Matching output: {stdout[:1000]}")
        if stderr:
            logger.info(f"Matching stderr: {stderr[:1000]}")
        
        # Step 3: Sparse reconstruction (mapper)
        sparse_dir = output_dir / "sparse"
        sparse_dir.mkdir(exist_ok=True)
        
        cmd_mapper = [
            "colmap", "mapper",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--output_path", str(sparse_dir),
        ]
        
        logger.info("Running COLMAP sparse reconstruction (mapper)...")
        logger.info(f"Command: {' '.join(cmd_mapper)}")
        stdout, stderr = await run_command(cmd_mapper)
        if stdout:
            logger.info(f"Mapper output: {stdout[:1000]}")
        if stderr:
            logger.info(f"Mapper stderr: {stderr[:1000]}")
        
        # Check if reconstruction was successful
        # COLMAP creates numbered subdirectories (0, 1, 2...) for each model
        sparse_models = list(sparse_dir.glob("*/cameras.bin"))
        if not sparse_models:
            # Also check for .txt format
            sparse_models = list(sparse_dir.glob("*/cameras.txt"))
        
        if not sparse_models:
            logger.error("COLMAP reconstruction produced no models!")
            logger.error(f"Contents of {sparse_dir}: {list(sparse_dir.rglob('*'))}")
            return False
        
        logger.info(f"Camera poses estimated successfully! Found {len(sparse_models)} model(s)")
        logger.info(f"Model locations: {[str(m.parent) for m in sparse_models]}")
        return True
        
    except FileNotFoundError as e:
        logger.error(f"COLMAP not found: {e}. Please install COLMAP.")
        return False
    except Exception as e:
        logger.error(f"COLMAP pose estimation failed: {e}", exc_info=True)
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return False
