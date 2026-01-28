"""
Train LongSplat model for unposed 3D reconstruction from video frames
https://github.com/NVlabs/LongSplat
"""
import asyncio
import hashlib
import logging
import os
import shutil
from pathlib import Path
from utils.shell import run_command

logger = logging.getLogger(__name__)

# Path to LongSplat repository
LONGSPLAT_REPO_URL = "https://github.com/NVlabs/LongSplat.git"

def _resolve_longsplat_repo() -> Path:
    """Resolve LongSplat repository path."""
    # Check environment variable first (set in Docker)
    env_path = os.getenv("LONGSPLAT_REPO")
    if env_path:
        repo_path = Path(env_path)
        if repo_path.exists():
            return repo_path
    
    # Fallback: check common locations
    project_root = Path(__file__).parent.parent.parent.parent
    # Check sibling directory
    sibling = project_root.parent / "LongSplat"
    if sibling.exists():
        return sibling
    # Check in project root
    local = project_root / "LongSplat"
    if local.exists():
        return local
    
    # Default fallback
    return project_root.parent / "LongSplat"

LONGSPLAT_REPO = _resolve_longsplat_repo()

async def train_longsplat(
    frames_dir: Path,
    output_dir: Path,
    iterations: int = 30000,
    resolution: int = 1
) -> bool:
    """
    Train LongSplat model directly from video frames (no COLMAP needed!)
    
    Args:
        frames_dir: Directory containing extracted video frames
        output_dir: Directory to save trained model
        iterations: Number of training iterations
        resolution: Resolution scale factor (1, 2, 4, or 8)
    
    Returns:
        True if training succeeded, False otherwise
    """
    try:
        logger.info(f"Starting LongSplat training from {frames_dir}")
        
        # Ensure LongSplat repository is set up
        if not await _setup_longsplat_repo():
            logger.error("Failed to setup LongSplat repository")
            return False
        
        # Prepare the scene directory structure - USE UNIQUE DIRECTORY PER JOB
        # Extract job_id from output_dir (e.g., /app/storage/models/job_id -> job_id)
        job_id = output_dir.name
        scene_dir = frames_dir.parent / f"longsplat_scene_{job_id}"
        images_dir = scene_dir / "images"
        
        # Clean up any existing scene directory for this job (ensure fresh start)
        if scene_dir.exists():
            logger.info(f"Cleaning up existing scene directory: {scene_dir}")
            shutil.rmtree(scene_dir)
        
        images_dir.mkdir(parents=True, exist_ok=True)
        
        # Copy frames to images directory
        logger.info(f"Copying frames to {images_dir}")
        frame_count = 0
        for frame_path in sorted(frames_dir.glob("*.png")) + sorted(frames_dir.glob("*.jpg")):
            shutil.copy2(frame_path, images_dir / frame_path.name)
            frame_count += 1
        
        logger.info(f"Copied {frame_count} frames to scene directory")
        
        # Training command
        train_script = LONGSPLAT_REPO / "train.py"
        
        if not train_script.exists():
            logger.error(f"LongSplat train.py not found at {train_script}")
            return False
        
        # Generate unique port based on output directory hash to avoid conflicts
        # Use port range 6010-65000 (6009 is default)
        port_hash = int(hashlib.md5(str(output_dir).encode()).hexdigest()[:8], 16)
        unique_port = 6010 + (port_hash % 59000)  # Range: 6010-65009
        
        cmd = [
            "/usr/bin/python3.10", str(train_script),
            "-s", str(scene_dir),
            "-m", str(output_dir),
            "--iterations", str(iterations),
            "--resolution", str(resolution),
            "--mode", "custom",  # Custom mode works without COLMAP, uses MASt3R for pose estimation
            "--port", str(unique_port),  # Use unique port to avoid "Address already in use" errors
            "--quiet",  # Reduce logging overhead for speed
            "--init_frame_num", "2",  # Fewer initial frames for faster startup
            "--window_size", "3",  # Smaller window for faster local optimization
        ]
        
        logger.info(f"Running LongSplat training: {' '.join(cmd)}")
        logger.info(f"Using unique port {unique_port} for network GUI (avoids conflicts)")
        logger.info(f"Working directory: {LONGSPLAT_REPO}")
        logger.info(f"Scene directory contents: {list(scene_dir.iterdir())}")
        logger.info(f"Images directory contents: {list(images_dir.iterdir())[:5]}...")  # First 5 files
        logger.info(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'NOT SET')}")
        logger.info(f"Current PATH: {os.environ.get('PATH', 'NOT SET')[:200]}...")
        
        # Prepare environment with PYTHONPATH for LongSplat submodules
        env = os.environ.copy()
        # Add LongSplat to PYTHONPATH so it can find its submodules
        pythonpath = env.get('PYTHONPATH', '')
        if str(LONGSPLAT_REPO) not in pythonpath:
            env['PYTHONPATH'] = f"{LONGSPLAT_REPO}:{pythonpath}" if pythonpath else str(LONGSPLAT_REPO)
        
        logger.info(f"Using PYTHONPATH: {env['PYTHONPATH']}")
        
        # Run training with timeout (long videos need more time)
        timeout_seconds = 3600 * 4  # 4 hours max
        try:
            stdout, stderr = await asyncio.wait_for(
                run_command(cmd, cwd=str(LONGSPLAT_REPO), env=env),
                timeout=timeout_seconds
            )
            logger.info(f"Training command completed successfully")
            logger.info(f"Training stdout (last 50 lines): {stdout.split(chr(10))[-50:]}")
            if stderr:
                logger.warning(f"Training stderr: {stderr[-2000:]}")  # Last 2000 chars
        except Exception as cmd_error:
            logger.error(f"Training command failed: {cmd_error}")
            logger.error(f"Check if PYTHONPATH is set correctly in container")
            logger.error(f"Command that failed: {' '.join(cmd)}")
            raise
        
        # Check if point cloud was generated (use dynamic iteration number)
        point_cloud = output_dir / "point_cloud" / f"iteration_{iterations}" / "point_cloud.ply"
        if not point_cloud.exists():
            # Also try looking for the latest iteration
            point_cloud_dir = output_dir / "point_cloud"
            if point_cloud_dir.exists():
                iteration_dirs = sorted([d for d in point_cloud_dir.glob("iteration_*") if d.is_dir()])
                if iteration_dirs:
                    point_cloud = iteration_dirs[-1] / "point_cloud.ply"
            
            if not point_cloud.exists():
                logger.error(f"Point cloud not generated at {point_cloud}")
                return False
        
        # Copy the final PLY to the root output directory
        final_ply = output_dir / "model.ply"
        shutil.copy2(point_cloud, final_ply)
        
        logger.info(f"LongSplat training completed successfully. Model saved to {final_ply}")
        
        # Clean up scene directory to free disk space
        try:
            if scene_dir.exists():
                shutil.rmtree(scene_dir)
                logger.info(f"Cleaned up scene directory: {scene_dir}")
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up scene directory: {cleanup_error}")
        
        return True
        
    except asyncio.TimeoutError:
        logger.error(f"LongSplat training timed out after {timeout_seconds} seconds")
        # Still try to clean up on timeout
        try:
            scene_dir = frames_dir.parent / f"longsplat_scene_{output_dir.name}"
            if scene_dir.exists():
                shutil.rmtree(scene_dir)
        except:
            pass
        return False
    except Exception as e:
        logger.error(f"LongSplat training failed: {e}", exc_info=True)
        # Still try to clean up on error
        try:
            scene_dir = frames_dir.parent / f"longsplat_scene_{output_dir.name}"
            if scene_dir.exists():
                shutil.rmtree(scene_dir)
        except:
            pass
        return False


async def _setup_longsplat_repo() -> bool:
    """
    Setup LongSplat repository (should already be installed in Docker)
    """
    try:
        if LONGSPLAT_REPO.exists() and (LONGSPLAT_REPO / "train.py").exists():
            logger.info(f"LongSplat repository found at {LONGSPLAT_REPO}")
            return True
        
        logger.info("LongSplat repository not found. Cloning...")
        
        # Try to clone if git is available
        if shutil.which("git"):
            try:
                repo_parent = LONGSPLAT_REPO.parent
                repo_parent.mkdir(parents=True, exist_ok=True)
                
                cmd_clone = [
                    "git", "clone",
                    "--recursive",
                    LONGSPLAT_REPO_URL,
                    str(LONGSPLAT_REPO)
                ]
                
                logger.info(f"Cloning repository: {' '.join(cmd_clone)}")
                await run_command(cmd_clone)
        
                logger.info("Repository cloned successfully")
                return True
            except Exception as e:
                logger.error(f"Failed to clone repository: {e}")
                return False
        else:
            logger.error("Git not found. Please clone the repository manually.")
            return False
        
    except Exception as e:
        logger.error(f"Error setting up LongSplat repository: {e}")
        return False


async def convert_to_3dgs_format(
    longsplat_output: Path,
    output_ply: Path,
    prune_ratio: float = 0.6
) -> bool:
    """
    Convert LongSplat output to standard 3DGS format for compatibility
    
    Args:
        longsplat_output: Directory containing LongSplat model
        output_ply: Path to save the converted PLY file
        prune_ratio: Ratio of points to prune (0.0-1.0)
    
    Returns:
        True if conversion succeeded
    """
    try:
        convert_script = LONGSPLAT_REPO / "convert_3dgs.py"
        
        if not convert_script.exists():
            logger.warning("convert_3dgs.py not found, skipping conversion")
            return False
        
        cmd = [
            "/usr/bin/python3.10", str(convert_script),
            "-m", str(longsplat_output),
            "--prune_ratio", str(prune_ratio)
        ]
        
        logger.info(f"Converting to 3DGS format: {' '.join(cmd)}")
        await run_command(cmd, cwd=str(LONGSPLAT_REPO))
        
        # The convert script should create point_cloud.ply in the output directory
        converted_ply = longsplat_output / "point_cloud.ply"
        if converted_ply.exists():
            shutil.copy2(converted_ply, output_ply)
            logger.info(f"Converted PLY saved to {output_ply}")
            return True
        
        return False
        
    except Exception as e:
        logger.error(f"Conversion to 3DGS format failed: {e}")
        return False
