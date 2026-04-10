"""
Export model to PLY format.

Priority order:
1. model.ply (output of longsplat_to_3dgs_converter — has both f_dc_* AND red/green/blue)
2. Any other *.ply in root
3. point_cloud.ply (recursive — raw training output, may lack RGB)
4. Any *.ply recursive
"""
import logging
import re
import shutil
from pathlib import Path

from services.longsplat.longsplat_to_3dgs_converter import rewrite_ply_sanitize_f_rest_inplace

logger = logging.getLogger(__name__)


def _pick_latest_ply(ply_files):
    """Pick the PLY file from the highest training iteration (numeric sort).
    
    Paths look like .../iteration_12000/point_cloud.ply
    Alphabetical sort would rank iteration_12000 < iteration_7000 because '1' < '7'.
    This helper extracts the iteration number and picks the max.
    """
    def _iter_num(p):
        m = re.search(r'iteration_(\d+)', str(p))
        return int(m.group(1)) if m else 0
    return max(ply_files, key=_iter_num)


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
        rewrite_ply_sanitize_f_rest_inplace(output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 2. Any root-level PLY
    ply_files = list(model_dir.glob("*.ply"))
    if ply_files:
        source_ply = _pick_latest_ply(ply_files)
        logger.info(f"Using root PLY (no model.ply found): {source_ply}")
        shutil.copy2(source_ply, output_ply)
        rewrite_ply_sanitize_f_rest_inplace(output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 3. Recursive: point_cloud.ply from training iterations
    ply_files = list(model_dir.rglob("point_cloud.ply"))
    if ply_files:
        source_ply = _pick_latest_ply(ply_files)
        logger.warning(f"Using raw training PLY (may lack RGB): {source_ply}")
        shutil.copy2(source_ply, output_ply)
        rewrite_ply_sanitize_f_rest_inplace(output_ply)
        _log_ply_color_info(output_ply)
        return output_ply

    # 4. Any recursive PLY
    ply_files = list(model_dir.rglob("*.ply"))
    if ply_files:
        source_ply = _pick_latest_ply(ply_files)
        logger.warning(f"Fallback PLY: {source_ply}")
        shutil.copy2(source_ply, output_ply)
        rewrite_ply_sanitize_f_rest_inplace(output_ply)
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
        frest = [p for p in props if re.match(r"^f_rest_\d+$", p)]
        frest.sort(key=lambda x: int(x.split("_")[-1]))
        logger.info(
            "PLY exported: %s vertices, f_rest_* count=%s, props(head)=%s",
            n,
            len(frest),
            props[:20],
        )
        if frest and len(frest) % 3 != 0:
            logger.warning(
                "  f_rest_* count %d is not divisible by 3 — web viewer may show empty splats",
                len(frest),
            )

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

        # Scale diagnostics (critical for visibility)
        if "scale_0" in props:
            s0, s1, s2 = vertex["scale_0"], vertex["scale_1"], vertex["scale_2"]
            s_all = np.concatenate([s0, s1, s2])
            logger.info(
                f"  Scale (log-space): s0=[{np.min(s0):.3f} to {np.max(s0):.3f}], "
                f"s1=[{np.min(s1):.3f} to {np.max(s1):.3f}], "
                f"s2=[{np.min(s2):.3f} to {np.max(s2):.3f}]"
            )
            logger.info(
                f"  Scale (world-space): min_exp={np.exp(np.min(s_all)):.6f}, "
                f"max_exp={np.exp(np.max(s_all)):.4f}, "
                f"median_exp={np.exp(np.median(s_all)):.6f}"
            )
            sub_pixel = int(np.sum(s_all < -6))
            logger.info(
                f"  Scale < exp(-6): {sub_pixel}/{len(s_all)} values "
                f"({sub_pixel / len(s_all) * 100:.1f}%)"
            )
        else:
            logger.warning("  No scale_0 property — splats may render as default size")

        # Opacity diagnostics
        if "opacity" in props:
            op = vertex["opacity"].astype(np.float64)
            sig_op = 1.0 / (1.0 + np.exp(-op))
            logger.info(
                f"  Opacity (logit): [{np.min(op):.3f} to {np.max(op):.3f}], "
                f"mean={np.mean(op):.3f}"
            )
            logger.info(
                f"  Opacity (sigmoid): [{np.min(sig_op):.4f} to {np.max(sig_op):.4f}], "
                f"mean={np.mean(sig_op):.4f}, >0.5: {int(np.sum(sig_op > 0.5))}/{n}"
            )
        else:
            logger.warning("  No opacity property — splats default to transparent")

    except Exception as e:
        logger.warning(f"Could not read PLY for diagnostics: {e}")
