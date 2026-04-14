"""
Train LongSplat model for unposed 3D reconstruction from video frames
https://github.com/NVlabs/LongSplat
"""
import asyncio
import hashlib
import importlib.util
import logging
import os
import time
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
    resolution: int = 1,
    init_ratio: float = 0.2,
    convert_prune_ratio: float = 0.62,
    convert_refinement_cap: int = 10_000,
) -> bool:
    """
    Train LongSplat model directly from video frames (no COLMAP needed!)
    
    Args:
        frames_dir: Directory containing extracted video frames
        output_dir: Directory to save trained model
        iterations: Number of training iterations
        resolution: Resolution scale factor (1, 2, 4, or 8)
        convert_prune_ratio: Passed to convert_3dgs.py --prune_ratio (preset-controlled; higher keeps more Gaussians)
        convert_refinement_cap: Upper bound on convert_3dgs.py --iteration (GPU refinement after main train).

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
            sk_spec = importlib.util.find_spec("simple_knn")
            logger.info(f"simple_knn find_spec: {sk_spec} (origin={getattr(sk_spec, 'origin', None)})")
            import simple_knn as _simple_knn
            sk_file = getattr(_simple_knn, "__file__", None)
            sk_loader = getattr(_simple_knn, "__loader__", None)
            logger.info(f"simple_knn __file__: {sk_file!r}, __loader__: {sk_loader!r}")
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
        
        # Calculate optimal init_frame_num based on total frames and ratio
        total_frames = frame_count
        # Ensure at least 15 frames, but respect ratio
        init_frames = max(15, int(total_frames * init_ratio))
        
        # Scale sub-iteration parameters with main iterations (capped at quality_baseline).
        # Baseline 12000 = full internal budgets when main --iterations >= 12000 (e.g. Balanced).
        # Quality preset can use higher main --iterations (e.g. 28k) without raising these caps.
        quality_baseline = 12000
        quality_factor = min(1.0, iterations / quality_baseline)
        pose_iter   = max(40,  int(100  * quality_factor))
        local_iter  = max(80,  int(200  * quality_factor))
        global_iter = max(240, int(600  * quality_factor))
        post_iter   = max(800, int(2000 * quality_factor))
        init_iter   = max(600, int(1500 * quality_factor))
        # Scaffold-GS → 3DGS convert_3dgs refinement (scaled; cap from preset for Balanced vs Quality).
        # convert_scale_cap must be >= max QUALITY_PRESETS[*].convert_3dgs_refinement_cap or scaled_convert
        # plateaus below the preset cap (quality_factor==1 would cap at convert_scale_cap only).
        convert_floor = 3000
        convert_scale_cap = 14_000
        scaled_convert = int(convert_scale_cap * quality_factor)
        convert_iters = max(convert_floor, min(convert_refinement_cap, scaled_convert))

        logger.info(
            f"Quality factor: {quality_factor:.2f} → pose={pose_iter}, "
            f"local={local_iter}, global={global_iter}, "
            f"post={post_iter}, init={init_iter}, "
            f"convert_3dgs_iters={convert_iters} (cap={convert_refinement_cap}, frames={frame_count})"
        )

        # NOTE: LongSplat's train.py does NOT support --save_iterations or
        # --checkpoint_iterations (those are standard 3DGS flags). LongSplat
        # always saves the final PLY automatically via scene.save() at the end
        # of its refinement phase (iteration 30000 + post_iter).
        cmd = [
            "/usr/bin/python3.10", str(train_script),
            "-s", str(scene_dir),
            "-m", str(output_dir),
            "--iterations", str(iterations),
            "--resolution", str(resolution),
            "--mode", "custom",
            "--port", str(unique_port),
            "--quiet",
            "--init_frame_num", str(init_frames),
            "--window_size", "8",
            "--pose_iteration", str(pose_iter),
            "--local_iter", str(local_iter),
            "--global_iter", str(global_iter),
            "--post_iter", str(post_iter),
            "--init_iteraion", str(init_iter),
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
                t_train0 = time.perf_counter()
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
            
            train_wall_s = time.perf_counter() - t_train0
            logger.info(
                "[LongSplat timing] train.py subprocess wall time: %.1f s (%.1f min)",
                train_wall_s,
                train_wall_s / 60.0,
            )
            logger.info("Training command completed successfully")
            
            # Add diagnostic logging
            logger.info(f"Output directory contents: {list(output_dir.iterdir())}")
            checkpoint_files = list(output_dir.glob("**/*.pth"))
            ply_files = list(output_dir.glob("**/*.ply"))
            logger.info(f"Found {len(checkpoint_files)} checkpoint files, {len(ply_files)} PLY files")
            
            # ── CRITICAL: Run LongSplat's convert_3dgs.py ─────────────────────
            # LongSplat is built on Scaffold-GS which stores colors in MLPs,
            # NOT as per-point SH coefficients. The PLY from training contains
            # anchors with neural features — not renderable colors.
            # convert_3dgs.py properly:
            #   1. Loads the Scaffold-GS model (anchors + MLP weights)
            #   2. Expands anchors into individual Gaussians (anchor × n_offsets)
            #   3. Trains for additional iterations to learn SH color coefficients
            #   4. Saves standard 3DGS PLY with proper f_dc_* properties
            # The scene directory must still exist (needs images for rendering).
            # ── FIX: convert_3dgs.py expects cameras_all.json but training
            #    saves cameras_all_train.json / cameras_all_test.json.
            #    Create the expected file so the conversion script can load cameras.
            cameras_train = output_dir / "cameras_all_train.json"
            cameras_all = output_dir / "cameras_all.json"
            if cameras_train.exists() and not cameras_all.exists():
                shutil.copy(str(cameras_train), str(cameras_all))
                logger.info(f"Copied cameras_all_train.json → cameras_all.json ({cameras_all.stat().st_size} bytes)")
            elif cameras_all.exists():
                logger.info(f"cameras_all.json already exists ({cameras_all.stat().st_size} bytes)")
            else:
                logger.warning("cameras_all_train.json not found — convert_3dgs.py may fail to load cameras")

            convert_script = LONGSPLAT_REPO / "convert_3dgs.py"
            if convert_script.exists():
                convert_cmd = [
                    "/usr/bin/python3.10", str(convert_script),
                    "-m", str(output_dir),
                    "--iteration", str(convert_iters),
                    "--prune_ratio", str(convert_prune_ratio),
                ]
                convert_log_path = output_dir / "convert_3dgs.log"
                logger.info(
                    f"Running Scaffold-GS → 3DGS conversion ({convert_iters} refinement iters, "
                    f"prune_ratio={convert_prune_ratio}): {' '.join(convert_cmd)}"
                )
                
                try:
                    with open(convert_log_path, "w") as convert_log:
                        t_conv0 = time.perf_counter()
                        convert_proc = await asyncio.create_subprocess_exec(
                            *convert_cmd,
                            cwd=str(LONGSPLAT_REPO),
                            env=env,
                            stdout=convert_log,
                            stderr=asyncio.subprocess.STDOUT,
                        )
                        await asyncio.wait_for(convert_proc.wait(), timeout=3600)  # 1 hour max
                        conv_wall_s = time.perf_counter() - t_conv0
                        logger.info(
                            "[LongSplat timing] convert_3dgs.py wall time: %.1f s (%.1f min)",
                            conv_wall_s,
                            conv_wall_s / 60.0,
                        )
                    
                    if convert_proc.returncode == 0:
                        converted_ply = output_dir / "converted_3dgs" / "point_cloud.ply"
                        logger.info(f"convert_3dgs.py succeeded (exit 0), checking for {converted_ply}")
                        logger.info(
                            "Diagnostics: full LongSplat stdout is in %s; convert_3dgs output in %s",
                            output_dir / "training.log",
                            convert_log_path,
                        )
                        if converted_ply.exists():
                            logger.info(f"Converted PLY exists: {converted_ply.stat().st_size} bytes")
                        else:
                            logger.warning("convert_3dgs.py succeeded but converted_3dgs/point_cloud.ply not found")
                    else:
                        logger.warning(f"convert_3dgs.py exited with code {convert_proc.returncode}")
                        try:
                            with open(convert_log_path, "r") as f:
                                tail = "".join(f.readlines()[-50:])
                                logger.warning(f"convert_3dgs.py log tail:\n{tail}")
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    logger.warning("convert_3dgs.py timed out after 1 hour, continuing with fallback")
                except Exception as conv_err:
                    logger.warning(f"convert_3dgs.py failed: {conv_err}, continuing with fallback")
            else:
                logger.warning(f"convert_3dgs.py not found at {convert_script}, skipping Scaffold-GS conversion")
            
            # ── Custom converter: adds red/green/blue for Blender ──────────────
            # If convert_3dgs.py succeeded, the converter will find
            # converted_3dgs/point_cloud.ply (standard 3DGS with f_dc_*)
            # and just add RGB uchar properties for Blender compatibility.
            # If it failed, falls back to raw Scaffold-GS format handling.
            t_post0 = time.perf_counter()
            logger.info("Running custom converter (adds Blender-compatible RGB)...")
            conversion_success = convert_longsplat_to_3dgs(
                checkpoint_dir=output_dir,
                output_ply=output_dir / "model.ply"
            )
            
            if conversion_success:
                logger.info("Conversion completed - PLY has f_dc_* + RGB properties")
                model_ply = output_dir / "model.ply"
                if model_ply.exists():
                    logger.info("Running PlyOptimizer on model.ply (center, prune, scale floor)...")
                    opt_ok = PlyOptimizer.optimize(model_ply, model_ply)
                    if not opt_ok:
                        logger.warning(
                            "PlyOptimizer returned False — using original "
                            "unoptimized model.ply for the rest of the pipeline"
                        )
            else:
                logger.error("Conversion failed - PLY may be missing properties")
            post_wall_s = time.perf_counter() - t_post0
            logger.info(
                "[LongSplat timing] custom converter + PlyOptimizer wall time: %.1f s (%.1f min)",
                post_wall_s,
                post_wall_s / 60.0,
            )
            
            # Clean up scene directory (safe now — convert_3dgs.py already ran)
            try:
                if scene_dir.exists():
                    shutil.rmtree(scene_dir)
                    logger.info(f"Cleaned up scene directory: {scene_dir}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up scene directory: {cleanup_error}")
            
            return conversion_success
            
        except Exception as cmd_error:
            logger.error(f"Training command failed: {cmd_error}")
            # Clean up on failure
            try:
                scene_dir = frames_dir.parent / f"longsplat_scene_{output_dir.name}"
                if scene_dir.exists():
                    shutil.rmtree(scene_dir)
            except:
                pass
            raise
        
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
from .longsplat_to_3dgs_converter import convert_longsplat_to_3dgs

async def convert_to_3dgs_format(
    longsplat_output: Path,
    output_ply: Path,
    prune_ratio: float = 0.6,
    convert_iterations: int = 4000
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
            "--prune_ratio", str(prune_ratio),
            "--iteration", str(convert_iterations)
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
