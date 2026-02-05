import numpy as np
from plyfile import PlyData, PlyElement
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class PlyOptimizer:
    """
    Standard post-processing pipeline for 3D Gaussian Splatting models.
    Handles centering, validation, and format standardization without patching external scripts.
    """
    
    @staticmethod
    def center_model(ply_path: Path, output_path: Path = None):
        """
        Loads a PLY file, calculates the centroid of vertex positions, 
        re-centers the model to (0,0,0), and saves it.
        """
        if output_path is None:
            output_path = ply_path
            
        try:
            logger.info(f"Optimizing PLY model: {ply_path}")
            
            # Read PLY
            plydata = PlyData.read(str(ply_path))
            vertex = plydata['vertex']
            
            # Extract positions
            x = vertex['x']
            y = vertex['y']
            z = vertex['z']
            
            # Compute Centroid
            centroid_x = np.mean(x)
            centroid_y = np.mean(y)
            centroid_z = np.mean(z)
            
            logger.info(f"Found centroid at ({centroid_x:.4f}, {centroid_y:.4f}, {centroid_z:.4f})")
            
            # Center positions
            vertex['x'] = x - centroid_x
            vertex['y'] = y - centroid_y
            vertex['z'] = z - centroid_z
            
            # Save optimized PLY
            PlyData([vertex], text=False).write(str(output_path))
            logger.info(f"Saved centered model to {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to optimize PLY: {e}")
            return False
