"""Generate a simple textured room shell (prism) to fill gaps between zone meshes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Sequence

logger = logging.getLogger(__name__)


def _load_keyframe_image(path: Path):
  """Load keyframe as PIL Image or None."""
  try:
    from PIL import Image
    return Image.open(path).convert("RGB")
  except Exception as e:
    logger.debug("Could not load keyframe %s: %s", path, e)
    return None


def create_room_shell(
    job_id: str,
    models_dir: Path,
    keyframe_paths: Sequence[Path],
    *,
    margin: float = 0.5,
    n_zones: int = 4,
) -> Optional[Path]:
    """
    Create a box shell GLB with wall textures sampled from keyframes.
    Returns path to shell.glb or None on failure.
    """
    try:
        import trimesh
        import numpy as np
    except ImportError:
        logger.warning("trimesh unavailable — skipping room shell")
        return None

    if not keyframe_paths:
        return None

    size = 4.0 + margin
    height = 2.8
    box = trimesh.creation.box(extents=[size, height, size])
    box.apply_translation([0, height / 2, 0])

    # Apply simple UV-mapped textures per wall from keyframes (mosaic)
    try:
        imgs = [_load_keyframe_image(p) for p in keyframe_paths[: max(n_zones, 4)]]
        valid = [im for im in imgs if im is not None]
        if valid:
            # Use first valid keyframe as diffuse for all faces (basic fill)
            tex_img = valid[0]
            material = trimesh.visual.material.PBRMaterial(
                baseColorTexture=tex_img,
                metallicFactor=0.0,
                roughnessFactor=0.9,
            )
            box.visual = trimesh.visual.TextureVisuals(material=material)
    except Exception as e:
        logger.debug("Shell texturing skipped: %s", e)

    out_dir = models_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_path = out_dir / "shell.glb"

    try:
        box.export(str(shell_path))
        logger.info("Room shell created at %s", shell_path)
        return shell_path
    except Exception as e:
        logger.warning("Room shell export failed: %s", e)
        return None
