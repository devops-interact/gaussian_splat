"""
Estimate camera poses using COLMAP
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
        frames_dir: Directory containing extracted frames
        output_dir: Directory to save COLMAP output
    
    Returns:
        True if successful, False otherwise
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    logger.info(f"Estimating camera poses using COLMAP")
    
    try:
        # Step 1: Feature extraction
        database_path = output_dir / "database.db"
        cmd_feature = [
            "colmap", "feature_extractor",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--ImageReader.camera_model", "PINHOLE",
            "--ImageReader.single_camera", "1"
        ]
        
        logger.info("Running COLMAP feature extraction...")
        await run_command(cmd_feature)
        
        # Step 2: Feature matching
        cmd_match = [
            "colmap", "exhaustive_matcher",
            "--database_path", str(database_path)
        ]
        
        logger.info("Running COLMAP feature matching...")
        await run_command(cmd_match)
        
        # Step 3: Sparse reconstruction
        sparse_dir = output_dir / "sparse"
        sparse_dir.mkdir(exist_ok=True)
        
        cmd_recon = [
            "colmap", "mapper",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--output_path", str(sparse_dir)
        ]
        
        logger.info("Running COLMAP sparse reconstruction...")
        await run_command(cmd_recon)
        
        # Check if reconstruction was successful
        sparse_models = list(sparse_dir.glob("*/cameras.bin"))
        if not sparse_models:
            logger.warning("COLMAP reconstruction produced no models")
            return False
        
        logger.info(f"Camera poses estimated successfully. Models: {len(sparse_models)}")
        return True
        
    except FileNotFoundError:
        logger.error("COLMAP not found. Please install COLMAP and ensure it's in your PATH.")
        return False
    except Exception as e:
        logger.error(f"COLMAP pose estimation failed: {e}")
        return False
