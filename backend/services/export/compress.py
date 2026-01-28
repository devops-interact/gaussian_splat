"""
PLY compression service - compress output files for faster downloads
"""
import gzip
import logging
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def compress_ply_gzip(input_path: Path, output_path: Optional[Path] = None) -> Path:
    """
    Compress a PLY file using gzip compression.
    
    Achieves 60-80% size reduction for typical point cloud data.
    
    Args:
        input_path: Path to the input PLY file
        output_path: Optional output path (defaults to input_path + .gz)
    
    Returns:
        Path to the compressed file
    """
    if output_path is None:
        output_path = input_path.with_suffix(input_path.suffix + ".gz")
    
    try:
        original_size = input_path.stat().st_size
        
        with open(input_path, 'rb') as f_in:
            with gzip.open(output_path, 'wb', compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        compressed_size = output_path.stat().st_size
        ratio = (1 - compressed_size / original_size) * 100
        
        logger.info(
            f"Compressed PLY: {original_size / 1024:.1f}KB -> "
            f"{compressed_size / 1024:.1f}KB ({ratio:.1f}% reduction)"
        )
        
        return output_path
        
    except Exception as e:
        logger.error(f"Failed to compress PLY: {e}")
        # Return original file path if compression fails
        return input_path


def decompress_ply_gzip(input_path: Path, output_path: Optional[Path] = None) -> Path:
    """
    Decompress a gzipped PLY file.
    
    Args:
        input_path: Path to the compressed file (.ply.gz)
        output_path: Optional output path (defaults to removing .gz extension)
    
    Returns:
        Path to the decompressed file
    """
    if output_path is None:
        if input_path.suffix == '.gz':
            output_path = input_path.with_suffix('')
        else:
            output_path = input_path.with_suffix('.ply')
    
    try:
        with gzip.open(input_path, 'rb') as f_in:
            with open(output_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        return output_path
        
    except Exception as e:
        logger.error(f"Failed to decompress PLY: {e}")
        raise


def get_file_size_str(file_path: Path) -> str:
    """Get human-readable file size"""
    size = file_path.stat().st_size
    
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    else:
        return f"{size / (1024 * 1024 * 1024):.2f} GB"


async def compress_model_files(model_dir: Path) -> dict:
    """
    Compress all model files in a directory.
    
    Returns dict with original and compressed file paths and sizes.
    """
    import asyncio
    
    result = {
        "files": [],
        "total_original_size": 0,
        "total_compressed_size": 0
    }
    
    # Find all PLY files
    ply_files = list(model_dir.glob("**/*.ply"))
    
    for ply_file in ply_files:
        # Skip already compressed files
        if ply_file.suffix == '.gz':
            continue
        
        original_size = ply_file.stat().st_size
        
        # Compress in thread pool
        compressed_path = await asyncio.get_event_loop().run_in_executor(
            None, compress_ply_gzip, ply_file
        )
        
        compressed_size = compressed_path.stat().st_size
        
        result["files"].append({
            "original": str(ply_file),
            "compressed": str(compressed_path),
            "original_size": original_size,
            "compressed_size": compressed_size,
            "reduction_percent": (1 - compressed_size / original_size) * 100
        })
        
        result["total_original_size"] += original_size
        result["total_compressed_size"] += compressed_size
    
    if result["total_original_size"] > 0:
        result["total_reduction_percent"] = (
            1 - result["total_compressed_size"] / result["total_original_size"]
        ) * 100
    
    return result
