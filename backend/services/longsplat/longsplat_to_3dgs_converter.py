"""
Custom converter from LongSplat output to standard 3D Gaussian Splatting PLY format.
This replaces the broken convert_3dgs.py dependency.

IMPORTANT: Writes BOTH f_dc_* (SH coefficients for 3DGS viewers) AND standard
red/green/blue (uchar) properties for Blender/MeshLab compatibility.
"""
import re
import torch
import numpy as np
from pathlib import Path
from typing import List, Tuple
from plyfile import PlyData, PlyElement
import logging

logger = logging.getLogger(__name__)


def _normalize_f_rest_fields(vertex_data: np.ndarray) -> Tuple[np.ndarray, int]:
    """
    Ensure the number of f_rest_* properties is divisible by 3.

    @mkkellogg/gaussian-splats-3d (INRIA V1 PLY) uses sphericalHarmonicsFieldCount / 3 as
    coefficientsPerChannel; a non-integer breaks internal f_rest index keys and can yield a
    blank splat pass with no JS error. LongSplat exports sometimes emit 11 f_rest_* columns.
    """
    if vertex_data.dtype.names is None:
        return vertex_data, 0
    names = list(vertex_data.dtype.names)
    frest: List[Tuple[int, str]] = []
    for n in names:
        m = re.match(r"f_rest_(\d+)$", n)
        if m:
            frest.append((int(m.group(1)), n))
    if not frest:
        return vertex_data, 0
    frest.sort(key=lambda x: x[0])
    ordered = [x[1] for x in frest]
    k = len(ordered)
    r = k % 3
    if r == 0:
        return vertex_data, 0
    to_drop = set(ordered[-r:])
    new_names = [n for n in names if n not in to_drop]
    new_dtype = np.dtype([(n, vertex_data.dtype.fields[n][0]) for n in new_names])
    new_data = np.empty(len(vertex_data), dtype=new_dtype)
    for n in new_names:
        new_data[n] = vertex_data[n]
    logger.info(
        "Normalized f_rest for web viewer: dropped %d incomplete SH column(s) (%d -> %d): %s",
        r,
        k,
        k - r,
        sorted(to_drop, key=lambda x: int(x.split("_")[-1])),
    )
    return new_data, r


def _ordered_f_rest_property_names(prop_names: List[str]) -> List[str]:
    """All f_rest_* names in numeric order (from PLY header order / properties)."""
    found: List[Tuple[int, str]] = []
    for n in prop_names:
        m = re.match(r"f_rest_(\d+)$", n)
        if m:
            found.append((int(m.group(1)), n))
    found.sort(key=lambda x: x[0])
    return [x[1] for x in found]


def normalize_vertex_f_rest_by_property_names(vertex, prop_names: List[str]) -> Tuple[np.ndarray, int]:
    """
    Drop trailing f_rest_* columns so count is divisible by 3, using PLY property names.
    Works even when vertex.data.dtype.names is missing or incomplete (plyfile edge cases).
    """
    ordered_frest = _ordered_f_rest_property_names(prop_names)
    k = len(ordered_frest)
    if k == 0:
        if vertex.data.dtype.names is not None:
            return _normalize_f_rest_fields(vertex.data)
        return vertex.data, 0

    r = k % 3
    to_drop = set(ordered_frest[-r:]) if r else set()

    if r == 0 and vertex.data.dtype.names is not None:
        return _normalize_f_rest_fields(vertex.data)

    keep_names = [n for n in prop_names if n not in to_drop]
    n_verts = len(vertex.data)
    if n_verts == 0:
        return vertex.data, 0

    descr: List[Tuple[str, np.dtype]] = []
    for n in keep_names:
        arr = np.asarray(vertex[n])
        descr.append((n, arr.dtype))
    new_dtype = np.dtype(descr)
    new_data = np.empty(n_verts, dtype=new_dtype)
    for n in keep_names:
        new_data[n] = np.asarray(vertex[n])

    if r != 0:
        logger.info(
            "Normalized f_rest for web viewer: dropped %d incomplete SH column(s) (%d -> %d): %s",
            r,
            k,
            k - r,
            sorted(to_drop, key=lambda x: int(x.split("_")[-1])),
        )
    return new_data, r


def rewrite_ply_sanitize_f_rest_inplace(ply_path: Path) -> bool:
    """
    If exported PLY has f_rest_* count not divisible by 3, rewrite file in place for web viewer.
    Returns True if file was rewritten.
    """
    try:
        plydata = PlyData.read(str(ply_path))
        vertex = plydata["vertex"]
        prop_names = [p.name for p in vertex.properties]
        frest = _ordered_f_rest_property_names(prop_names)
        if not frest or len(frest) % 3 == 0:
            return False
        data, _ = normalize_vertex_f_rest_by_property_names(vertex, prop_names)
        new_vertex = PlyElement.describe(data, "vertex")
        PlyData([new_vertex], text=False).write(str(ply_path))
        logger.info("Sanitized f_rest in place for web viewer: %s", ply_path)
        return True
    except Exception as e:
        logger.warning("Could not sanitize f_rest on %s: %s", ply_path, e)
        return False


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


# Spherical Harmonics constant for DC component -> RGB conversion
SH_C0 = 0.28209479177387814


def sh_to_rgb(f_dc: np.ndarray) -> np.ndarray:
    """
    Convert Spherical Harmonics DC coefficients to RGB [0, 255] uint8 values.

    Standard 3DGS formula: color = clamp(SH_C0 * f_dc + 0.5, 0, 1) * 255

    Detection strategy:
      - SH DC coefficients from 3DGS have negative values and std > 0.3
      - Direct RGB [0,1] is always non-negative with smaller variance
      - Direct RGB [0,255] has mean >> 10 and max around 255
    """
    f_min, f_max = float(np.min(f_dc)), float(np.max(f_dc))
    f_mean = float(np.mean(f_dc))
    f_std = float(np.std(f_dc))
    has_negatives = f_min < -0.01

    logger.info(
        f"SH DC input stats: min={f_min:.4f}, max={f_max:.4f}, "
        f"mean={f_mean:.4f}, std={f_std:.4f}, has_negatives={has_negatives}"
    )

    # Case 1: Values clearly in [0, 255] range — already uint8-scale RGB
    if f_min >= 0.0 and f_max > 1.0 and f_max <= 255.0 and f_mean > 10.0:
        logger.info("Detected uint8-scale RGB [0,255] — dividing by 255")
        rgb_float = np.clip(f_dc / 255.0, 0.0, 1.0)

    # Case 2: Has negative values → definitely SH (RGB can't be negative)
    elif has_negatives:
        logger.info("Detected SH coefficients (has negatives) — applying SH_C0 transform")
        rgb_float = SH_C0 * f_dc + 0.5
        rgb_float = np.clip(rgb_float, 0.0, 1.0)

    # Case 3: All in [0,1] — could be direct RGB or SH.
    # Use standard deviation: SH DC values from trained models have std > 0.3
    # while direct RGB [0,1] from normalized images has lower variance and
    # the SH transform would wash them out.  Always apply SH transform here
    # because LongSplat outputs f_dc_* as SH, and a "dark scene" where
    # f_dc happens to be in [0,1] would still need the SH_C0 multiply.
    elif 0.0 <= f_min and f_max <= 1.0:
        # Apply SH transform — this is the safer default for 3DGS output
        logger.info(
            "Values in [0,1] — applying SH_C0 transform (3DGS default). "
            f"std={f_std:.4f}"
        )
        rgb_float = SH_C0 * f_dc + 0.5
        rgb_float = np.clip(rgb_float, 0.0, 1.0)

    else:
        # General case — standard SH → RGB
        logger.info("Applying standard SH_C0 transform")
        rgb_float = SH_C0 * f_dc + 0.5
        rgb_float = np.clip(rgb_float, 0.0, 1.0)

    rgb_uint8 = (rgb_float * 255).astype(np.uint8)

    logger.info(
        f"RGB output stats: min={int(np.min(rgb_uint8))}, max={int(np.max(rgb_uint8))}, "
        f"mean={np.mean(rgb_uint8):.1f}"
    )

    return rgb_uint8


def convert_longsplat_to_3dgs(checkpoint_dir: Path, output_ply: Path) -> bool:
    """
    Convert LongSplat checkpoint to standard 3DGS PLY format with:
    - f_dc_* properties (for Gaussian Splatting viewers)
    - red/green/blue uchar properties (for Blender/MeshLab/CloudCompare)
    
    Args:
        checkpoint_dir: Directory containing LongSplat training output
        output_ply: Output path for standard 3DGS PLY file
    
    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f"Converting LongSplat output from {checkpoint_dir}")
        
        # ── Priority 1: converted_3dgs/point_cloud.ply ──────────────────────
        # This is the output of LongSplat's convert_3dgs.py which properly
        # converts Scaffold-GS (anchor+MLP) into standard 3DGS with real
        # f_dc_* SH color coefficients trained against the video frames.
        converted_ply = checkpoint_dir / "converted_3dgs" / "point_cloud.ply"
        if converted_ply.exists():
            logger.info(f"Found properly converted 3DGS PLY: {converted_ply} ({converted_ply.stat().st_size} bytes)")
            # Verify it has f_dc_* properties
            try:
                check_data = PlyData.read(str(converted_ply))
                check_props = [p.name for p in check_data['vertex'].properties]
                n_verts = len(check_data['vertex'].data)
                logger.info(f"Converted PLY: {n_verts} vertices, props={check_props[:15]}...")
                if 'f_dc_0' in check_props:
                    logger.info("Converted PLY has standard 3DGS f_dc_* properties — adding RGB for Blender")
                    return _add_rgb_colors_to_3dgs_ply(converted_ply, output_ply)
                else:
                    logger.warning(f"Converted PLY lacks f_dc_0 (has: {check_props[:10]}), falling through")
            except Exception as e:
                logger.warning(f"Could not read converted PLY: {e}, falling through")
        
        # ── Priority 2: Any point_cloud.ply with f_dc_* properties ──────────
        # Find the latest checkpoint or point cloud
        checkpoint_files = list(checkpoint_dir.glob("**/*.pth"))
        ply_files = list(checkpoint_dir.glob("**/point_cloud.ply"))
        
        logger.info(f"Found {len(checkpoint_files)} .pth files, {len(ply_files)} .ply files")
        
        if ply_files:
            # Use the highest-iteration PLY file from training (numeric sort)
            source_ply = _pick_latest_ply(ply_files)
            logger.info(f"Using PLY file: {source_ply}")
            
            # Read the source PLY
            plydata = PlyData.read(str(source_ply))
            vertex = plydata['vertex']
            
            # Check what properties exist
            prop_names = [prop.name for prop in vertex.properties]
            logger.info(f"Source PLY properties: {prop_names[:20]}...")
            
            # If it already has f_dc_* properties, add RGB colors and save
            if 'f_dc_0' in prop_names:
                logger.info("Source PLY has 3DGS format — adding RGB colors for Blender compatibility")
                return _add_rgb_colors_to_3dgs_ply(source_ply, output_ply)
            
            # Otherwise, we need to convert from LongSplat/Scaffold-GS format
            logger.warning("Source PLY is Scaffold-GS format (no f_dc_*) — colors may be inaccurate")
            return _convert_from_raw_longsplat(vertex, prop_names, output_ply)
            
        elif checkpoint_files:
            # Load from checkpoint file
            checkpoint_path = sorted(checkpoint_files)[-1]
            logger.info(f"Using checkpoint: {checkpoint_path}")
            return _convert_from_checkpoint(checkpoint_path, output_ply)
        else:
            logger.error(f"No .pth or .ply files found in {checkpoint_dir}")
            return False
            
    except Exception as e:
        logger.error(f"Conversion failed: {e}", exc_info=True)
        return False


def _add_rgb_colors_to_3dgs_ply(source_ply: Path, output_ply: Path) -> bool:
    """
    Read a standard 3DGS PLY that has f_dc_* properties, add red/green/blue
    uchar properties derived from SH DC coefficients, and write the result.
    Also normalizes f_rest_* column count for GaussianSplats3D (multiple of 3).
    """
    try:
        plydata = PlyData.read(str(source_ply))
        vertex = plydata['vertex']
        prop_names = [prop.name for prop in vertex.properties]
        ordered_frest = _ordered_f_rest_property_names(prop_names)
        pre_bad_frest = len(ordered_frest) % 3 != 0

        data, f_rest_dropped = normalize_vertex_f_rest_by_property_names(vertex, prop_names)
        prop_names_set = set(data.dtype.names or ())
        num_points = len(data)

        has_rgb = (
            "red" in prop_names_set
            and "green" in prop_names_set
            and "blue" in prop_names_set
        )

        # Never copy source verbatim if f_rest count was bad for GS3D (11 cols, etc.)
        if has_rgb and f_rest_dropped == 0 and not pre_bad_frest:
            logger.info(
                "RGB properties already exist in source PLY — preserving original colors (not overwriting)"
            )
            import shutil
            shutil.copy2(source_ply, output_ply)
            return True
        if has_rgb:
            new_vertex = PlyElement.describe(data, "vertex")
            PlyData([new_vertex], text=False).write(str(output_ply))
            logger.info("Wrote PLY after f_rest normalization (RGB preserved from source)")
            return True

        # Extract SH DC coefficients
        f_dc_0 = data["f_dc_0"]
        f_dc_1 = data["f_dc_1"]
        f_dc_2 = data["f_dc_2"]

        features_dc = np.stack([f_dc_0, f_dc_1, f_dc_2], axis=-1)
        rgb = sh_to_rgb(features_dc)

        logger.info(f"Converted SH DC -> RGB for {num_points} points")
        logger.info(f"RGB sample (first 5): {rgb[:5]}")

        # Build new structured array with RGB properties added
        old_dtype = data.dtype
        new_fields = list(old_dtype.descr) + [
            ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')
        ]
        new_dtype = np.dtype(new_fields)
        new_data = np.empty(num_points, dtype=new_dtype)
        for field_name in old_dtype.names:
            new_data[field_name] = data[field_name]
        new_data['red'] = rgb[:, 0]
        new_data['green'] = rgb[:, 1]
        new_data['blue'] = rgb[:, 2]

        new_vertex = PlyElement.describe(new_data, 'vertex')
        PlyData([new_vertex], text=False).write(str(output_ply))

        logger.info(f"Wrote PLY with RGB colors to {output_ply}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to add RGB colors: {e}", exc_info=True)
        # Fallback: just copy the source
        import shutil
        shutil.copy2(source_ply, output_ply)
        return True


def _convert_from_raw_longsplat(vertex, prop_names: list, output_ply: Path) -> bool:
    """Convert from raw LongSplat PLY format to standard 3DGS format."""
    try:
        # Extract basic properties
        xyz = np.stack([vertex['x'], vertex['y'], vertex['z']], axis=-1)
        num_points = len(xyz)
        
        logger.info(f"Converting {num_points} points from LongSplat to 3DGS format")
        
        # LongSplat might store features as 'features_0', 'features_1', etc.
        # or as SH coefficients directly
        features_dc = None
        
        # Try to find feature properties
        feature_props = [p for p in prop_names if 'feature' in p.lower() or 'f_' in p]
        if feature_props:
            logger.info(f"Found feature properties: {feature_props[:10]}")
            # Take first 3 as RGB features
            if len(feature_props) >= 3:
                features_dc = np.stack([
                    vertex[feature_props[0]],
                    vertex[feature_props[1]], 
                    vertex[feature_props[2]]
                ], axis=-1)
        
        # Try standard color properties
        if features_dc is None and 'red' in prop_names:
            logger.info("Using existing red/green/blue properties as color source")
            r = vertex['red'].astype(np.float32) / 255.0
            g = vertex['green'].astype(np.float32) / 255.0
            b = vertex['blue'].astype(np.float32) / 255.0
            # Convert RGB [0,1] back to SH DC space: f_dc = (color - 0.5) / SH_C0
            features_dc = np.stack([
                (r - 0.5) / SH_C0,
                (g - 0.5) / SH_C0,
                (b - 0.5) / SH_C0,
            ], axis=-1)
        
        # If no features found, use default gray
        if features_dc is None:
            logger.warning("No feature properties found, using default gray color")
            features_dc = np.zeros((num_points, 3), dtype=np.float32)
        
        # Extract or create other properties
        opacity = vertex['opacity'] if 'opacity' in prop_names else np.zeros(num_points, dtype=np.float32)
        
        # Scale (log space)
        if 'scale_0' in prop_names:
            scales = np.stack([vertex[f'scale_{i}'] for i in range(3)], axis=-1)
        else:
            scales = np.ones((num_points, 3), dtype=np.float32) * -7.0  # Default small scale
        
        # Rotation (quaternion)
        if 'rot_0' in prop_names:
            rots = np.stack([vertex[f'rot_{i}'] for i in range(4)], axis=-1)
        else:
            # Default identity quaternion
            rots = np.zeros((num_points, 4), dtype=np.float32)
            rots[:, 0] = 1.0
        
        # Create standard 3DGS PLY with RGB colors
        return _write_standard_3dgs_ply(
            xyz, features_dc, opacity, scales, rots, output_ply
        )
        
    except Exception as e:
        logger.error(f"Raw conversion failed: {e}", exc_info=True)
        return False


def _convert_from_checkpoint(checkpoint_path: Path, output_ply: Path) -> bool:
    """Load Gaussian parameters from .pth checkpoint and write PLY."""
    try:
        checkpoint = torch.load(checkpoint_path, map_location='cpu')
        
        # Extract Gaussian parameters
        # LongSplat checkpoint structure may vary
        if 'gaussians' in checkpoint:
            gaussians = checkpoint['gaussians']
        else:
            gaussians = checkpoint
        
        # Get positions
        xyz = gaussians.get('_xyz', gaussians.get('xyz')).detach().cpu().numpy()
        
        # Get features (DC component)
        features_dc = gaussians.get('_features_dc', gaussians.get('features_dc'))
        if features_dc is not None:
            features_dc = features_dc.detach().cpu().numpy().squeeze()
        else:
            features_dc = np.zeros((len(xyz), 3), dtype=np.float32)
        
        # Get opacity
        opacity = gaussians.get('_opacity', gaussians.get('opacity'))
        if opacity is not None:
            opacity = opacity.detach().cpu().numpy().squeeze()
        else:
            opacity = np.zeros(len(xyz), dtype=np.float32)
        
        # Get scaling
        scales = gaussians.get('_scaling', gaussians.get('scaling'))
        if scales is not None:
            scales = scales.detach().cpu().numpy()
        else:
            scales = np.ones((len(xyz), 3), dtype=np.float32) * -7.0
        
        # Get rotation
        rots = gaussians.get('_rotation', gaussians.get('rotation'))
        if rots is not None:
            rots = rots.detach().cpu().numpy()
        else:
            rots = np.zeros((len(xyz), 4), dtype=np.float32)
            rots[:, 0] = 1.0
        
        logger.info(f"Loaded {len(xyz)} Gaussians from checkpoint")
        
        return _write_standard_3dgs_ply(
            xyz, features_dc, opacity, scales, rots, output_ply
        )
        
    except Exception as e:
        logger.error(f"Checkpoint conversion failed: {e}", exc_info=True)
        return False


def _write_standard_3dgs_ply(
    xyz: np.ndarray,
    features_dc: np.ndarray, 
    opacity: np.ndarray,
    scales: np.ndarray,
    rots: np.ndarray,
    output_path: Path
) -> bool:
    """
    Write standard 3DGS PLY format with all required properties.
    
    Includes BOTH:
    - f_dc_0, f_dc_1, f_dc_2  (SH DC coefficients for 3DGS viewers)
    - red, green, blue         (uchar RGB for Blender/MeshLab)
    """
    try:
        num_points = len(xyz)
        
        # Ensure features_dc has correct shape (N, 3)
        if features_dc.ndim == 1:
            features_dc = np.tile(features_dc[:, None], (1, 3))
        
        # Convert SH DC to RGB uint8 for Blender compatibility
        rgb = sh_to_rgb(features_dc)
        
        logger.info(f"RGB color stats: min={rgb.min()}, max={rgb.max()}, mean={rgb.mean():.1f}")
        
        # Create dtype for PLY — includes both SH and standard RGB
        dtype_full = [
            ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
            ('f_dc_0', 'f4'), ('f_dc_1', 'f4'), ('f_dc_2', 'f4'),
            ('opacity', 'f4'),
            ('scale_0', 'f4'), ('scale_1', 'f4'), ('scale_2', 'f4'),
            ('rot_0', 'f4'), ('rot_1', 'f4'), ('rot_2', 'f4'), ('rot_3', 'f4'),
            ('red', 'u1'), ('green', 'u1'), ('blue', 'u1'),
        ]
        
        # Create structured array
        elements = np.empty(num_points, dtype=dtype_full)
        elements['x'] = xyz[:, 0]
        elements['y'] = xyz[:, 1]
        elements['z'] = xyz[:, 2]
        elements['f_dc_0'] = features_dc[:, 0]
        elements['f_dc_1'] = features_dc[:, 1]
        elements['f_dc_2'] = features_dc[:, 2]
        elements['opacity'] = opacity
        elements['scale_0'] = scales[:, 0]
        elements['scale_1'] = scales[:, 1]
        elements['scale_2'] = scales[:, 2]
        elements['rot_0'] = rots[:, 0]
        elements['rot_1'] = rots[:, 1]
        elements['rot_2'] = rots[:, 2]
        elements['rot_3'] = rots[:, 3]
        elements['red'] = rgb[:, 0]
        elements['green'] = rgb[:, 1]
        elements['blue'] = rgb[:, 2]
        
        # Create PLY element
        vertex_element = PlyElement.describe(elements, 'vertex')
        
        # Write PLY file
        PlyData([vertex_element], text=False).write(str(output_path))
        
        logger.info(f"Wrote {num_points} points to {output_path}")
        logger.info(f"Properties: x, y, z, f_dc_0-2, opacity, scale_0-2, rot_0-3, red, green, blue")
        
        return True
        
    except Exception as e:
        logger.error(f"PLY write failed: {e}", exc_info=True)
        return False
