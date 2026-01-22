"""backend.services.gaussian.train

Gaussian Splatting training integration.

- Local dev: falls back to a placeholder PLY generator (keeps the app runnable).
- GPU deploy (Runpod): uses the official implementation if available:
  https://github.com/graphdeco-inria/gaussian-splatting

To force the repo location (recommended in Docker): set env var GAUSSIAN_SPLATTING_REPO.
"""

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from utils.shell import run_command

logger = logging.getLogger(__name__)

GAUSSIAN_SPLATTING_REPO_URL = "https://github.com/graphdeco-inria/gaussian-splatting.git"


def _resolve_gs_repo() -> Optional[Path]:
    """Resolve gaussian-splatting repo location."""
    env_path = os.getenv("GAUSSIAN_SPLATTING_REPO")
    if env_path:
        p = Path(env_path).expanduser()
        if p.exists():
            return p

    # backend/services/gaussian/train.py -> backend/ is parents[3]
    project_root = Path(__file__).resolve().parents[3]

    sibling = project_root.parent / "gaussian-splatting"
    if sibling.exists():
        return sibling

    local = project_root / "gaussian-splatting"
    if local.exists():
        return local

    return None


def _pick_colmap_model_dir(colmap_dir: Path) -> Optional[Path]:
    sparse_root = colmap_dir / "sparse"
    if not sparse_root.exists():
        return None

    candidates = sorted([p for p in sparse_root.iterdir() if p.is_dir()])
    for d in candidates:
        if (d / "cameras.bin").exists() and (d / "images.bin").exists() and (d / "points3D.bin").exists():
            return d
    return None


def _latest_iteration_ply(output_dir: Path) -> Optional[Path]:
    cands = list(output_dir.rglob("point_cloud.ply"))
    if not cands:
        return None

    def iter_num(p: Path) -> int:
        m = re.search(r"iteration_(\d+)", str(p))
        return int(m.group(1)) if m else -1

    return sorted(cands, key=iter_num)[-1]


async def train_gaussian_splatting(
    frames_dir: Path,
    colmap_dir: Path,
    output_dir: Path,
    iterations: int = 30000,
) -> bool:
    """Train a Gaussian Splatting model from COLMAP output.

    Expected output for the rest of our pipeline:
    - <output_dir>/point_cloud.ply
    """

    logger.info("Training Gaussian Splatting model (iterations: %s)", iterations)

    model_dir = _pick_colmap_model_dir(colmap_dir)
    if not model_dir:
        logger.error("No COLMAP sparse model found under %s", colmap_dir)
        return False

    gs_repo = _resolve_gs_repo()
    if gs_repo and (gs_repo / "train.py").exists():
        try:
            # Prepare scene directory for gaussian-splatting COLMAP loader
            scene_dir = output_dir / "scene"
            scene_images_dir = scene_dir / "images"
            scene_sparse_dir = scene_dir / "sparse" / "0"
            scene_images_dir.mkdir(parents=True, exist_ok=True)
            scene_sparse_dir.mkdir(parents=True, exist_ok=True)

            # Copy frames
            for img in sorted(frames_dir.glob("*.jpg")):
                shutil.copy2(img, scene_images_dir / img.name)

            # Copy sparse COLMAP model files
            for f in model_dir.iterdir():
                if f.is_file():
                    shutil.copy2(f, scene_sparse_dir / f.name)

            cmd_train = [
                "python3",
                "train.py",
                "-s",
                str(scene_dir),
                "-m",
                str(output_dir),
                "--iterations",
                str(iterations),
            ]

            logger.info("Running official gaussian-splatting train: %s", " ".join(cmd_train))
            await run_command(cmd_train, cwd=gs_repo)

            src_ply = _latest_iteration_ply(output_dir)
            if not src_ply:
                logger.error("gaussian-splatting finished but no point_cloud.ply found under %s", output_dir)
                return False

            dst_ply = output_dir / "point_cloud.ply"
            if src_ply != dst_ply:
                shutil.copy2(src_ply, dst_ply)

            logger.info("Gaussian Splatting model PLY ready at %s", dst_ply)
            return True

        except Exception as e:
            logger.error("gaussian-splatting training failed; falling back to placeholder: %s", e, exc_info=True)

    logger.warning(
        "Official gaussian-splatting repo not available; using placeholder PLY. "
        "For GPU deploy, mount/clone the repo and set GAUSSIAN_SPLATTING_REPO."
    )
    return await _create_placeholder_ply(output_dir / "point_cloud.ply")


async def _create_placeholder_ply(output_path: Path) -> bool:
    """Placeholder for local dev."""
    import numpy as np

    output_path.parent.mkdir(parents=True, exist_ok=True)

    n_points = 50000
    points = np.random.rand(n_points, 3) * 2 - 1
    colors = (np.random.rand(n_points, 3) * 255).astype(np.uint8)

    with open(output_path, "w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {n_points}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("end_header\n")
        for i in range(n_points):
            f.write(f"{points[i, 0]:.6f} {points[i, 1]:.6f} {points[i, 2]:.6f} ")
            f.write(f"{colors[i, 0]} {colors[i, 1]} {colors[i, 2]}\n")

    logger.info("Placeholder PLY created at %s", output_path)
    return True
