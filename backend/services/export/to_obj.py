"""
Convert PLY to OBJ format (optional/best-effort)
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

async def export_to_obj(
    ply_path: Path,
    obj_path: Path
) -> Path:
    """
    Convert PLY file to OBJ format
    
    Args:
        ply_path: Path to input PLY file
        obj_path: Path to output OBJ file
    
    Returns:
        Path to exported OBJ file
    """
    try:
        # Lazy import to avoid segfault issues
        import trimesh
        
        # Load PLY file
        mesh = trimesh.load(str(ply_path))
        
        # If it's a point cloud, create a simple mesh representation
        if isinstance(mesh, trimesh.PointCloud):
            # For point clouds, we'll create a simple representation
            # In production, you might want to use Poisson reconstruction
            logger.warning("Converting point cloud to OBJ - using simple representation")
            # Create a basic mesh from point cloud (convex hull as fallback)
            mesh = mesh.convex_hull
        
        # Export to OBJ
        mesh.export(str(obj_path), file_type='obj')
        logger.info(f"Exported OBJ to {obj_path}")
        return obj_path
        
    except Exception as e:
        logger.error(f"OBJ export failed: {e}")
        raise
