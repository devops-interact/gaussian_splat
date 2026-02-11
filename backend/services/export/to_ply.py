"""
Export model to PLY format.

Priority order:
1. model.ply (output of longsplat_to_3dgs_converter — has both f_dc_* AND red/green/blue)
2. Any other *.ply in root
3. point_cloud.ply (recursive — raw training output, may lack RGB)
4. Any *.ply recursive
"""
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


async def export_to_ply(
    model_dir: Path,
    job_id: str,
) -> Path:
    """
    Export model to PLY format.

    Args:
        model_dir: Directory containing the trained model
        job_id: Job identifier for output filename

    Returns:
        Path to exported PLY file
    """
    output_ply = model_dir.parent / f"{job_id}.ply"

    # 1. Prefer model.ply — this is the converter output with correct RGB colors
    model_ply = model_dir / "model.ply"
    if model_ply.exists():
        logger.info(f"Using converter output: {model_ply}")
        shutil.copy2(model_ply, output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 2. Any root-level PLY
    ply_files = list(model_dir.glob("*.ply"))
    if ply_files:
        source_ply = sorted(ply_files)[-1]
        logger.info(f"Using root PLY (no model.ply found): {source_ply}")
        shutil.copy2(source_ply, output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 3. Recursive: point_cloud.ply from training iterations
    ply_files = list(model_dir.rglob("point_cloud.ply"))
    if ply_files:
        source_ply = sorted(ply_files)[-1]
        logger.warning(f"Using raw training PLY (may lack RGB): {source_ply}")
        shutil.copy2(source_ply, output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 4. Any recursive PLY
    ply_files = list(model_dir.rglob("*.ply"))
    if ply_files:
        source_ply = sorted(ply_files)[-1]
        logger.warning(f"Fallback PLY: {source_ply}")
        shutil.copy2(source_ply, output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    logger.error(f"No PLY file found in {model_dir}")
    logger.error(f"Directory contents: {list(model_dir.rglob('*'))}")
    raise FileNotFoundError(f"No PLY file found in {model_dir}")


def _log_ply_color_info(ply_path: Path) -> None:
    """Log color property info from a PLY file for diagnostics."""
    try:
        from plyfile import PlyData
        import numpy as np

        plydata = PlyData.read(str(ply_path))
        vertex = plydata["vertex"]
        props = [p.name for p in vertex.properties]
        n = len(vertex.data)

        logger.info(f"PLY exported: {n} vertices, props={props[:20]}")

        # Check RGB
        if "red" in props:
            r = vertex["red"]
            g = vertex["green"]
            b = vertex["blue"]
            logger.info(
                f"  RGB stats: R=[{np.min(r)}-{np.max(r)}, mean={np.mean(r):.1f}], "
                f"G=[{np.min(g)}-{np.max(g)}, mean={np.mean(g):.1f}], "
                f"B=[{np.min(b)}-{np.max(b)}, mean={np.mean(b):.1f}]"
            )
        else:
            logger.warning("  No red/green/blue properties — viewer will fall back to SH")

        # Check SH
        if "f_dc_0" in props:
            f0 = vertex["f_dc_0"]
            f1 = vertex["f_dc_1"]
            f2 = vertex["f_dc_2"]
            logger.info(
                f"  SH DC stats: f0=[{np.min(f0):.3f}-{np.max(f0):.3f}], "
                f"f1=[{np.min(f1):.3f}-{np.max(f1):.3f}], "
                f"f2=[{np.min(f2):.3f}-{np.max(f2):.3f}]"
            )
    except Exception as e:
        logger.warning(f"Could not read PLY for diagnostics: {e}")
