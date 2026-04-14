import json
import logging
import os
from pathlib import Path

import numpy as np
from plyfile import PlyData, PlyElement

logger = logging.getLogger(__name__)

# Position outlier gate: keep points with dist_to_centroid <= mean + sigma * std (higher = retain more distant splats).
_DEFAULT_POSITION_OUTLIER_SIGMA = 3.5
_SIGMA_MIN = 2.5
_SIGMA_MAX = 6.0


def _position_outlier_sigma() -> float:
    raw = os.environ.get("PLY_POSITION_OUTLIER_SIGMA", "").strip()
    if not raw:
        return _DEFAULT_POSITION_OUTLIER_SIGMA
    try:
        v = float(raw)
    except ValueError:
        logger.warning("Invalid PLY_POSITION_OUTLIER_SIGMA=%r — using default %.2f", raw, _DEFAULT_POSITION_OUTLIER_SIGMA)
        return _DEFAULT_POSITION_OUTLIER_SIGMA
    return max(_SIGMA_MIN, min(_SIGMA_MAX, v))


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
          1. Remove NaN/Inf points (positions, scales, opacity)
          2. Prune low-opacity Gaussians (sigmoid < threshold)
          3. Remove oversized scale outliers (> 3 sigma)
          3b. Clamp sub-pixel scales to a visible floor
          4. Statistical position outlier removal (z-score)
          5. Center to (0, 0, 0)

        Returns False without overwriting the file if all points would be
        removed, preserving the original PLY for the rest of the pipeline.
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

            if n_original == 0:
                logger.warning("Input PLY has 0 vertices — nothing to optimize")
                return False

            data = vertex.data.copy()

            # ── 1. Remove NaN/Inf (positions + scales + opacity) ─────────
            valid = (
                np.isfinite(data['x'])
                & np.isfinite(data['y'])
                & np.isfinite(data['z'])
            )
            if 'scale_0' in prop_names:
                for s in ['scale_0', 'scale_1', 'scale_2']:
                    valid &= np.isfinite(data[s])
            if 'opacity' in prop_names:
                valid &= np.isfinite(data['opacity'])

            if not np.all(valid):
                n_invalid = int(np.sum(~valid))
                logger.warning(f"Removing {n_invalid:,} NaN/Inf points")
                data = data[valid]

            if len(data) == 0:
                logger.error(
                    "All points removed during NaN/Inf filtering — "
                    "preserving original file unchanged"
                )
                return False

            # ── 2. Opacity pruning ───────────────────────────────────────
            if 'opacity' in prop_names:
                raw_opacity = data['opacity']
                sigmoid_opacity = 1.0 / (1.0 + np.exp(-raw_opacity.astype(np.float64)))
                opacity_mask = sigmoid_opacity >= 0.02
                n_opacity_removed = int(np.sum(~opacity_mask))
                if n_opacity_removed > 0:
                    logger.info(
                        f"Opacity pruning: removing {n_opacity_removed:,} splats "
                        f"(sigmoid < 0.02), keeping {int(np.sum(opacity_mask)):,}"
                    )
                    data = data[opacity_mask]

            if len(data) == 0:
                logger.error(
                    "All points removed during opacity pruning — "
                    "preserving original file unchanged"
                )
                return False

            # ── 3. Scale outlier removal ─────────────────────────────────
            if 'scale_0' in prop_names and 'scale_1' in prop_names and 'scale_2' in prop_names:
                s0 = data['scale_0'].astype(np.float64)
                s1 = data['scale_1'].astype(np.float64)
                s2 = data['scale_2'].astype(np.float64)
                max_scale = np.maximum(np.maximum(s0, s1), s2)
                scale_mean = np.mean(max_scale)
                scale_std = np.std(max_scale)

                if np.isfinite(scale_mean) and np.isfinite(scale_std) and scale_std > 0:
                    scale_threshold = scale_mean + 3.0 * scale_std
                    scale_mask = max_scale <= scale_threshold
                    n_scale_removed = int(np.sum(~scale_mask))
                    if n_scale_removed > 0:
                        logger.info(
                            f"Scale outlier removal: removing {n_scale_removed:,} oversized "
                            f"splats (threshold={scale_threshold:.4f}), "
                            f"keeping {int(np.sum(scale_mask)):,}"
                        )
                        data = data[scale_mask]
                else:
                    logger.warning(
                        f"Scale stats invalid (mean={scale_mean}, std={scale_std}), "
                        f"skipping outlier removal"
                    )

            if len(data) == 0:
                logger.error(
                    "All points removed during scale outlier removal — "
                    "preserving original file unchanged"
                )
                return False

            # ── 3b. Scale floor clamp ────────────────────────────────────
            # Clamp log-scale so every splat is at least ~4 mm per axis.
            MIN_LOG_SCALE = -7.0
            if 'scale_0' in prop_names and len(data) > 0:
                for s in ['scale_0', 'scale_1', 'scale_2']:
                    col = data[s].astype(np.float64)
                    below = col < MIN_LOG_SCALE
                    n_clamped = int(np.sum(below))
                    if n_clamped > 0:
                        data[s] = np.maximum(col, MIN_LOG_SCALE)
                        logger.info(
                            f"Scale floor: clamped {n_clamped:,} values in {s} "
                            f"to >= {MIN_LOG_SCALE}"
                        )

            # ── 4. Statistical position outlier removal ──────────────────
            if len(data) > 1:
                x = data['x'].astype(np.float64)
                y = data['y'].astype(np.float64)
                z = data['z'].astype(np.float64)
                positions = np.column_stack([x, y, z])
                centroid = np.mean(positions, axis=0)
                dists = np.linalg.norm(positions - centroid, axis=1)
                dist_mean = np.mean(dists)
                dist_std = np.std(dists)

                if np.isfinite(dist_mean) and np.isfinite(dist_std) and dist_std > 0:
                    pos_sigma = _position_outlier_sigma()
                    threshold = dist_mean + pos_sigma * dist_std
                    position_mask = dists <= threshold
                    n_position_removed = int(np.sum(~position_mask))
                    if n_position_removed > 0:
                        logger.info(
                            f"Position outlier removal: removing {n_position_removed:,} "
                            f"distant points (> {threshold:.4f} from centroid), "
                            f"keeping {int(np.sum(position_mask)):,}"
                        )
                        data = data[position_mask]
                else:
                    logger.warning(
                        f"Position stats invalid (mean={dist_mean}, std={dist_std}), "
                        f"skipping outlier removal"
                    )

            if len(data) == 0:
                logger.error(
                    "All points removed during position outlier removal — "
                    "preserving original file unchanged"
                )
                return False

            # ── 5. Center to (0, 0, 0) ──────────────────────────────────
            ply_cx = ply_cy = ply_cz = 0.0
            x, y, z = data['x'], data['y'], data['z']
            cx = float(np.mean(x))
            cy = float(np.mean(y))
            cz = float(np.mean(z))
            if np.isfinite(cx) and np.isfinite(cy) and np.isfinite(cz):
                logger.info(f"Centering from ({cx:.4f}, {cy:.4f}, {cz:.4f}) to origin")
                data['x'] = x - cx
                data['y'] = y - cy
                data['z'] = z - cz
                ply_cx, ply_cy, ply_cz = cx, cy, cz
            else:
                logger.warning(
                    f"Centroid is NaN ({cx}, {cy}, {cz}), skipping centering"
                )

            # ── Write result ─────────────────────────────────────────────
            n_final = len(data)
            n_removed = n_original - n_final
            logger.info(
                f"Optimization complete: {n_original:,} -> {n_final:,} points "
                f"(removed {n_removed:,}, {n_removed / max(n_original, 1) * 100:.1f}%)"
            )

            new_vertex = PlyElement.describe(data, 'vertex')
            PlyData([new_vertex], text=False).write(str(output_path))
            logger.info(f"Saved optimized model to {output_path}")
            try:
                off_path = output_path.parent / "ply_center_offset.json"
                off_path.write_text(
                    json.dumps({"cx": ply_cx, "cy": ply_cy, "cz": ply_cz}),
                    encoding="utf-8",
                )
                logger.info("Wrote %s for viewer / camera alignment", off_path)
            except OSError as e:
                logger.warning("Failed to write ply_center_offset.json: %s", e)
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
