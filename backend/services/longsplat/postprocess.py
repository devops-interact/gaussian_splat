import numpy as np
from plyfile import PlyData, PlyElement
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class PlyOptimizer:
    """
    Post-processing pipeline for 3D Gaussian Splatting models.
    Handles centering, opacity pruning, scale outlier removal,
    and statistical position filtering for cleaner reconstructions.
    """

    @staticmethod
    def optimize(ply_path: Path, output_path: Path = None) -> bool:
        """
        Run the full optimization pipeline:
          1. Remove NaN/Inf points
          2. Prune low-opacity Gaussians (sigmoid < threshold)
          3. Remove oversized scale outliers (> 3σ)
          4. Statistical position outlier removal (z-score)
          5. Center to (0, 0, 0)
        """
        if output_path is None:
            output_path = ply_path

        try:
            logger.info(f"Running full PLY optimization: {ply_path}")
            plydata = PlyData.read(str(ply_path))
            vertex = plydata['vertex']
            n_original = len(vertex.data)
            prop_names = [p.name for p in vertex.properties]
            logger.info(f"Original point count: {n_original:,}")

            data = vertex.data.copy()

            # ── 1. Remove NaN/Inf ────────────────────────────────────────
            x, y, z = data['x'], data['y'], data['z']
            valid = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
            if not np.all(valid):
                n_invalid = int(np.sum(~valid))
                logger.warning(f"Removing {n_invalid} NaN/Inf points")
                data = data[valid]

            # ── 2. Opacity pruning ───────────────────────────────────────
            if 'opacity' in prop_names:
                raw_opacity = data['opacity']
                sigmoid_opacity = 1.0 / (1.0 + np.exp(-raw_opacity.astype(np.float64)))
                opacity_mask = sigmoid_opacity >= 0.02  # Keep only visible splats
                n_opacity_removed = int(np.sum(~opacity_mask))
                if n_opacity_removed > 0:
                    logger.info(
                        f"Opacity pruning: removing {n_opacity_removed:,} splats "
                        f"(sigmoid < 0.02), keeping {int(np.sum(opacity_mask)):,}"
                    )
                    data = data[opacity_mask]

            # ── 3. Scale outlier removal ─────────────────────────────────
            if 'scale_0' in prop_names and 'scale_1' in prop_names and 'scale_2' in prop_names:
                s0 = data['scale_0'].astype(np.float64)
                s1 = data['scale_1'].astype(np.float64)
                s2 = data['scale_2'].astype(np.float64)
                # Scales are in log-space; compute the max scale per Gaussian
                max_scale = np.maximum(np.maximum(s0, s1), s2)
                scale_mean = np.mean(max_scale)
                scale_std = np.std(max_scale)
                scale_threshold = scale_mean + 3.0 * scale_std
                scale_mask = max_scale <= scale_threshold
                n_scale_removed = int(np.sum(~scale_mask))
                if n_scale_removed > 0:
                    logger.info(
                        f"Scale outlier removal: removing {n_scale_removed:,} oversized splats "
                        f"(threshold={scale_threshold:.4f}), keeping {int(np.sum(scale_mask)):,}"
                    )
                    data = data[scale_mask]

            # ── 3b. Scale floor clamp ───────────────────────────────────
            # Gaussians with extremely small scales are sub-pixel and invisible.
            # Clamp log-scale to a reasonable minimum so every splat is at least
            # ~4mm (exp(-5.5) ≈ 0.004 units) in each axis.
            MIN_LOG_SCALE = -5.5
            if 'scale_0' in prop_names:
                for s in ['scale_0', 'scale_1', 'scale_2']:
                    below = data[s] < MIN_LOG_SCALE
                    n_clamped = int(np.sum(below))
                    if n_clamped > 0:
                        data[s] = np.maximum(data[s], MIN_LOG_SCALE)
                        logger.info(
                            f"Scale floor: clamped {n_clamped:,} values in {s} "
                            f"to >= {MIN_LOG_SCALE}"
                        )

            # ── 4. Statistical position outlier removal ──────────────────
            x, y, z = data['x'].astype(np.float64), data['y'].astype(np.float64), data['z'].astype(np.float64)
            positions = np.column_stack([x, y, z])
            centroid = np.mean(positions, axis=0)
            dists = np.linalg.norm(positions - centroid, axis=1)
            dist_mean = np.mean(dists)
            dist_std = np.std(dists)
            # Remove points beyond 3 standard deviations from centroid
            position_mask = dists <= (dist_mean + 3.0 * dist_std)
            n_position_removed = int(np.sum(~position_mask))
            if n_position_removed > 0:
                logger.info(
                    f"Position outlier removal: removing {n_position_removed:,} distant points "
                    f"(> {dist_mean + 3.0 * dist_std:.4f} from centroid), keeping {int(np.sum(position_mask)):,}"
                )
                data = data[position_mask]

            # ── 5. Center to (0, 0, 0) ──────────────────────────────────
            x, y, z = data['x'], data['y'], data['z']
            cx, cy, cz = float(np.mean(x)), float(np.mean(y)), float(np.mean(z))
            logger.info(f"Centering from ({cx:.4f}, {cy:.4f}, {cz:.4f}) to origin")
            data['x'] = x - cx
            data['y'] = y - cy
            data['z'] = z - cz

            # ── Write result ────────────────────────────────────────────
            n_final = len(data)
            n_removed = n_original - n_final
            logger.info(
                f"Optimization complete: {n_original:,} → {n_final:,} points "
                f"(removed {n_removed:,}, {n_removed/max(n_original,1)*100:.1f}%)"
            )

            new_vertex = PlyElement.describe(data, 'vertex')
            PlyData([new_vertex], text=False).write(str(output_path))
            logger.info(f"Saved optimized model to {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to optimize PLY: {e}", exc_info=True)
            return False

    @staticmethod
    def center_model(ply_path: Path, output_path: Path = None) -> bool:
        """
        Legacy method — now delegates to the full optimize() pipeline.
        """
        return PlyOptimizer.optimize(ply_path, output_path)
