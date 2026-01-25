"""
Export model to PLY format
"""
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

async def export_to_ply(
    model_dir: Path,
    job_id: str
) -> Path:
    """
    Export model to PLY format
    
    Args:
        model_dir: Directory containing the trained model
        job_id: Job identifier for output filename
    
    Returns:
        Path to exported PLY file
    """
    output_ply = model_dir.parent / f"{job_id}.ply"
    
    # First check root directory
    ply_files = list(model_dir.glob("*.ply"))
    
    # If not found, search recursively (Gaussian Splatting outputs to point_cloud/iteration_XXXX/)
    if not ply_files:
        ply_files = list(model_dir.rglob("point_cloud.ply"))
    
    # Still nothing? Try any PLY file recursively
    if not ply_files:
        ply_files = list(model_dir.rglob("*.ply"))
    
    if ply_files:
        # Use the most recent / last iteration's PLY file
        source_ply = sorted(ply_files)[-1]
        logger.info(f"Found PLY file: {source_ply}")
        shutil.copy2(source_ply, output_ply)
        logger.info(f"Exported PLY to {output_ply}")
        return output_ply
    else:
        logger.error(f"No PLY file found in {model_dir}")
        logger.error(f"Directory contents: {list(model_dir.rglob('*'))}")
        raise FileNotFoundError(f"No PLY file found in {model_dir}")
