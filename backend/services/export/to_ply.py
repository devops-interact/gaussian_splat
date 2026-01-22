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
    # Look for existing PLY file in model directory
    ply_files = list(model_dir.glob("*.ply"))
    
    if ply_files:
        # Use the first PLY file found
        source_ply = ply_files[0]
        output_ply = model_dir.parent / f"{job_id}.ply"
        shutil.copy2(source_ply, output_ply)
        logger.info(f"Exported PLY to {output_ply}")
        return output_ply
    else:
        raise FileNotFoundError(f"No PLY file found in {model_dir}")
