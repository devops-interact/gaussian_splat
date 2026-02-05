"""
Train LongSplat model for unposed 3D reconstruction from video frames
https://github.com/NVlabs/LongSplat
"""
import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
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
    
    # Simple defaults
    return Path("/opt/LongSplat")

LONGSPLAT_REPO = _resolve_longsplat_repo()

def _verify_gpu_compatibility() -> tuple[bool, str]:
    """
    Verify that the current GPU is compatible with the built CUDA extensions.
    This image is built for A40 (sm_86).
    """
    try:
        import torch
        if not torch.cuda.is_available():
            return False, "CUDA not available"
        
        device_name = torch.cuda.get_device_name(0)
        capability = torch.cuda.get_device_capability(0)
        
        # This image is built for sm_86 (A40, RTX 3090)
        expected_major, expected_minor = 8, 6
        
        if capability[0] != expected_major or capability[1] != expected_minor:
            return False, (
                f"GPU mismatch: Found {device_name} (sm_{capability[0]}{capability[1]}), "
                f"but this image was built for A40 (sm_{expected_major}{expected_minor}). "
                f"Use an A40 pod or rebuild the image for your GPU."
            )
        
        return True, f"GPU OK: {device_name} (sm_{capability[0]}{capability[1]})"
    except Exception as e:
        return False, f"GPU check failed: {e}"


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
        
        # Verify GPU compatibility before starting expensive training
        gpu_ok, gpu_msg = _verify_gpu_compatibility()
        logger.info(f"GPU check: {gpu_msg}")
        if not gpu_ok:
            logger.error(gpu_msg)
            raise RuntimeError(gpu_msg)
        
        # Ensure LongSplat repository is set up
        if not await _setup_longsplat_repo():
            logger.error("Failed to setup LongSplat repository")
            return False
            
        # DIAGNOSTICS: Check key dependencies explicitly
        try:
            logger.info("Running dependency diagnostics...")
            import torch
            logger.info(f"PyTorch: {torch.__version__} (CUDA: {torch.version.cuda})")
            import diff_gaussian_rasterization
            logger.info(f"diff_gaussian_rasterization: {diff_gaussian_rasterization.__file__}")
            import simple_knn
            logger.info(f"simple_knn: {simple_knn.__file__}")
            import fused_ssim
            logger.info(f"fused_ssim: {fused_ssim.__file__}")
            logger.info("Diagnostics passed: All CUDA extensions importable.")
        except ImportError as e:
            logger.error(f"Dependency diagnostic failed: {e}")
            logger.error("This suggests the Docker image needs to be fully rebuilt.")
            raise RuntimeError(f"Critical dependency missing: {e}")
        except Exception as e:
            logger.error(f"Unexpected diagnostic error: {e}")
        
        # Prepare the scene directory structure - USE UNIQUE DIRECTORY PER JOB
        try:
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
        except Exception as e:
            logger.error(f"Failed to prepare scene directory: {e}", exc_info=True)
            return False
        
        # Training command
        train_script = LONGSPLAT_REPO / "train.py"
        
        if not train_script.exists():
            logger.error(f"LongSplat train.py not found at {train_script}")
            return False
        
        # Generate unique port based on output directory hash to avoid conflicts
        # Use port range 6010-65000 (6009 is default)
        port_hash = int(hashlib.md5(str(output_dir).encode()).hexdigest()[:8], 16)
        unique_port = 6010 + (port_hash % 59000)  # Range: 6010-65009
        
        # Calculate optimal init_frame_num based on total frames (use ~20% of frames, min 10)
        total_frames = frame_count
        init_frames = max(10, min(total_frames // 5, 30))  # 10-30 frames for initialization
        
        # PATCH: Optimized hyperparameters for faster training (<20 mins)
        # Original: init=3000, pose=200, local=400, global=900, post=5000+
        cmd = [
            "/usr/bin/python3.10", str(train_script),
            "-s", str(scene_dir),
            "-m", str(output_dir),
            "--iterations", str(iterations),
            "--resolution", str(resolution),
            "--mode", "custom",  # Custom mode works without COLMAP, uses MASt3R for pose estimation
            "--port", str(unique_port),  # Use unique port to avoid "Address already in use" errors
            "--quiet",  # Reduce logging overhead for speed
            "--init_frame_num", str(init_frames),  # More frames = denser initial point cloud
            "--window_size", "5",  # Default window for good coverage
            "--pose_iteration", "50",    # Reduced from 200
            "--local_iter", "100",       # Reduced from 400
            "--global_iter", "300",      # Reduced from 900
            "--post_iter", "1000",       # Reduced from 5000 (huge speedup)
            "--init_iteraion", "1000",  # Faster initial optimization (typo is in LongSplat code)
        ]
        
        logger.info(f"Using {init_frames} initial frames (out of {total_frames} total)")
        
        logger.info(f"Running LongSplat training: {' '.join(cmd)}")
        logger.info(f"Using unique port {unique_port} for network GUI (avoids conflicts)")
        logger.info(f"Working directory: {LONGSPLAT_REPO}")
        logger.info(f"Scene directory contents: {list(scene_dir.iterdir())}")
        logger.info(f"Images directory contents: {list(images_dir.iterdir())[:5]}...")  # First 5 files
        logger.info(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'NOT SET')}")
        logger.info(f"Current PATH: {os.environ.get('PATH', 'NOT SET')[:200]}...")
        
        # Prepare environment with PYTHONPATH for LongSplat submodules
        env = os.environ.copy()
        pythonpath = env.get('PYTHONPATH', '')
        if str(LONGSPLAT_REPO) not in pythonpath:
            # We only need LongSplat here - submodules are managed by sys.path or pip install
            env['PYTHONPATH'] = f"{LONGSPLAT_REPO}:{pythonpath}" if pythonpath else str(LONGSPLAT_REPO)
        
        logger.info(f"Using PYTHONPATH: {env['PYTHONPATH']}")
        
        # Run training with direct file logging to avoid buffer truncation
        # This is critical because long training runs produce too much output for memory buffers
        log_file_path = output_dir / "training.log"
        logger.info(f"Streaming training output to {log_file_path}")
        
        timeout_seconds = 3600 * 4  # 4 hours max
        
        try:
            with open(log_file_path, "w") as log_file:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(LONGSPLAT_REPO),
                    env=env,
                    stdout=log_file,
                    stderr=asyncio.subprocess.STDOUT  # Merge stderr into stdout
                )
                
                try:
                    await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
                except asyncio.TimeoutError:
                    process.kill()
                    logger.error(f"LongSplat training timed out after {timeout_seconds} seconds")
                    raise
                
                if process.returncode != 0:
                    # Read the tail of the log file to show the error
                    logger.error(f"Training failed with return code {process.returncode}")
                    try:
                        with open(log_file_path, "r") as f:
                            # Read last 200 lines efficiently-ish
                            lines = f.readlines()
                            tail = "".join(lines[-200:])
                            logger.error(f"Training Log Tail:\n{tail}")
                    except Exception as read_err:
                        logger.error(f"Could not read log tail: {read_err}")
                    
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            
            logger.info("Training command completed successfully")
            
        except Exception as cmd_error:
            logger.error(f"Training command failed: {cmd_error}")
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


from .postprocess import PlyOptimizer

async def convert_to_3dgs_format(
    longsplat_output: Path,
    output_ply: Path,
    prune_ratio: float = 0.6
) -> bool:
    """
    Convert LongSplat output to standard 3DGS format using the official script,
    then apply internal post-processing (centering) for utility.
    """
    try:
        # Standard script from the repo - NO PATCHING
        convert_script = LONGSPLAT_REPO / "convert_3dgs.py"
        
        if not convert_script.exists():
            logger.warning("convert_3dgs.py not found in repo, skipping conversion")
            return False
        
        cmd = [
            "/usr/bin/python3.10", str(convert_script),
            "-m", str(longsplat_output),
            "--prune_ratio", str(prune_ratio)
        ]
        
        logger.info(f"Running standard LongSplat conversion: {' '.join(cmd)}")
        await run_command(cmd, cwd=str(LONGSPLAT_REPO))
        
        # Locate the raw output from the standard script
        raw_ply = longsplat_output / "converted_3dgs" / "point_cloud.ply"
        
        if not raw_ply.exists():
            # Fallback path if script implementation varies
            raw_ply = longsplat_output / "point_cloud.ply"
        
        if raw_ply.exists():
            logger.info(f"Raw PLY generated at {raw_ply}. Applying internal optimizations...")
            
            # Internal Post-Processing Pipeline
            # 1. Center the model (Critical for viewer)
            # 2. Save final artifact
            if PlyOptimizer.center_model(raw_ply, output_ply):
                logger.info(f"Final optimized model saved to {output_ply}")
                return True
            else:
                logger.error("Post-processing failed, copying raw file instead.")
                shutil.copy2(raw_ply, output_ply)
                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Conversion/Optimization pipeline failed: {e}")
        return False
