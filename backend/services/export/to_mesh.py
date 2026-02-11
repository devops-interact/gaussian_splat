"""
Surface reconstruction from Gaussian Splat point clouds.

Uses Open3D Poisson reconstruction to convert a PLY point cloud into a
watertight triangle mesh, then exports as GLB for browser-native rendering.

Pipeline:
  1. Load PLY point cloud with colors
  2. Statistical outlier removal
  3. Estimate normals with adaptive radius
  4. Poisson surface reconstruction
  5. Trim low-density faces to remove artefacts
  6. Transfer vertex colors from original points
  7. Decimate to a target face count for browser performance
  8. Export as GLB (binary glTF)
"""
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


def _compute_adaptive_radius(pcd) -> float:
    """
    Compute an adaptive radius for normal estimation based on
    the actual average nearest-neighbour distance in the point cloud.
    """
    import open3d as o3d

    points = np.asarray(pcd.points)
    n_sample = min(len(points), 5000)
    indices = np.random.choice(len(points), n_sample, replace=False)
    sample_pts = points[indices]

    pcd_tree = o3d.geometry.KDTreeFlann(pcd)
    dists = []
    for pt in sample_pts:
        _, _, dist_sq = pcd_tree.search_knn_vector_3d(pt, 2)  # self + nearest
        if len(dist_sq) >= 2:
            dists.append(np.sqrt(dist_sq[1]))

    avg_dist = float(np.median(dists)) if dists else 0.1
    # Use 6x median distance as the search radius (covers local neighbourhood)
    radius = max(0.01, avg_dist * 6.0)
    logger.info(
        f"Adaptive normal radius: median_nn_dist={avg_dist:.4f}, "
        f"search_radius={radius:.4f}"
    )
    return radius


def reconstruct_mesh(
    ply_path: Path,
    output_glb: Path,
    *,
    poisson_depth: int = 8,
    target_faces: int = 500_000,
    density_quantile: float = 0.05,
) -> bool:
    """
    Run the full surface reconstruction pipeline.

    Args:
        ply_path:         Input PLY point cloud (must have xyz; colours optional).
        output_glb:       Output GLB file path.
        poisson_depth:    Octree depth for Poisson reconstruction (7-10).
        target_faces:     Maximum triangle count after decimation.
        density_quantile: Bottom % of low-density vertices to remove.

    Returns:
        True on success, False on failure.
    """
    try:
        import open3d as o3d
    except ImportError:
        logger.error("open3d is not installed – cannot generate mesh")
        return False

    try:
        # ── 1. Load point cloud ──────────────────────────────────────────
        logger.info(f"Loading point cloud from {ply_path}")
        pcd = o3d.io.read_point_cloud(str(ply_path))

        if pcd.is_empty():
            logger.error("Point cloud is empty")
            return False

        n_points = len(np.asarray(pcd.points))
        has_colors = pcd.has_colors()
        logger.info(f"Loaded {n_points:,} points, has_colors={has_colors}")

        # ── 2. Statistical outlier removal ───────────────────────────────
        logger.info("Removing statistical outliers …")
        pcd_clean, inlier_idx = pcd.remove_statistical_outlier(
            nb_neighbors=20, std_ratio=2.0
        )
        n_after = len(np.asarray(pcd_clean.points))
        logger.info(
            f"Outlier removal: {n_points:,} → {n_after:,} points "
            f"(removed {n_points - n_after:,})"
        )
        pcd = pcd_clean

        # ── 3. Estimate & orient normals (adaptive radius) ──────────────
        logger.info("Estimating normals with adaptive radius …")
        radius = _compute_adaptive_radius(pcd)
        pcd.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(
                radius=radius, max_nn=50
            )
        )
        pcd.orient_normals_consistent_tangent_plane(k=20)
        logger.info("Normals estimated and oriented")

        # ── 4. Poisson surface reconstruction ────────────────────────────
        # Adapt depth to point count: fewer points → lower depth
        adaptive_depth = poisson_depth
        if n_after < 50_000:
            adaptive_depth = min(poisson_depth, 7)
        elif n_after < 200_000:
            adaptive_depth = min(poisson_depth, 8)
        logger.info(
            f"Running Poisson reconstruction "
            f"(depth={adaptive_depth}, points={n_after:,}) …"
        )

        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd, depth=adaptive_depth, linear_fit=False
        )

        n_verts_raw = len(np.asarray(mesh.vertices))
        n_faces_raw = len(np.asarray(mesh.triangles))
        logger.info(f"Raw mesh: {n_verts_raw:,} vertices, {n_faces_raw:,} faces")

        # ── 5. Trim low-density faces ────────────────────────────────────
        densities_np = np.asarray(densities)
        density_threshold = np.quantile(densities_np, density_quantile)
        vertices_to_remove = densities_np < density_threshold
        mesh.remove_vertices_by_mask(vertices_to_remove)

        n_verts_trim = len(np.asarray(mesh.vertices))
        n_faces_trim = len(np.asarray(mesh.triangles))
        logger.info(
            f"After density trim ({density_quantile*100:.0f}%): "
            f"{n_verts_trim:,} vertices, {n_faces_trim:,} faces"
        )

        # ── 6. Crop mesh to original point cloud bounding box ────────────
        # Poisson can extrapolate far beyond the actual data; clip it.
        pcd_bbox = pcd.get_axis_aligned_bounding_box()
        # Expand bbox by 10% to keep edges
        center = pcd_bbox.get_center()
        extent = pcd_bbox.get_extent() * 1.1
        crop_min = center - extent / 2
        crop_max = center + extent / 2
        crop_bbox = o3d.geometry.AxisAlignedBoundingBox(crop_min, crop_max)
        mesh = mesh.crop(crop_bbox)
        logger.info(
            f"After bbox crop: {len(np.asarray(mesh.vertices)):,} vertices, "
            f"{len(np.asarray(mesh.triangles)):,} faces"
        )

        # ── 7. Transfer vertex colors ────────────────────────────────────
        if has_colors:
            logger.info("Transferring vertex colors from point cloud …")
            mesh_vertices = np.asarray(mesh.vertices)
            pcd_tree = o3d.geometry.KDTreeFlann(pcd)
            pcd_colors = np.asarray(pcd.colors)  # (N, 3) in [0, 1]

            mesh_colors = np.zeros_like(mesh_vertices)
            for i in range(len(mesh_vertices)):
                _, idx, _ = pcd_tree.search_knn_vector_3d(mesh_vertices[i], 3)
                # Average 3 nearest neighbours for smoother color
                mesh_colors[i] = np.mean(pcd_colors[idx], axis=0)

            mesh.vertex_colors = o3d.utility.Vector3dVector(mesh_colors)
            logger.info("Vertex colors transferred (3-NN average)")
        else:
            mesh.paint_uniform_color([0.7, 0.7, 0.7])

        # ── 8. Decimate ──────────────────────────────────────────────────
        current_faces = len(np.asarray(mesh.triangles))
        if current_faces > target_faces:
            logger.info(
                f"Decimating {current_faces:,} → {target_faces:,} faces …"
            )
            mesh = mesh.simplify_quadric_decimation(
                target_number_of_triangles=target_faces
            )
            n_faces_final = len(np.asarray(mesh.triangles))
            logger.info(f"After decimation: {n_faces_final:,} faces")

        # Clean up
        mesh.remove_degenerate_triangles()
        mesh.remove_duplicated_triangles()
        mesh.remove_duplicated_vertices()
        mesh.remove_non_manifold_edges()
        mesh.compute_vertex_normals()

        # ── 9. Export as GLB ─────────────────────────────────────────────
        logger.info("Exporting to GLB …")
        _export_glb_via_trimesh(mesh, output_glb)

        if output_glb.exists():
            size_mb = output_glb.stat().st_size / (1024 * 1024)
            logger.info(f"GLB written to {output_glb} ({size_mb:.1f} MB)")
            return True
        else:
            logger.error("GLB file was not created")
            return False

    except Exception as e:
        logger.error(f"Mesh reconstruction failed: {e}", exc_info=True)
        return False


def _export_glb_via_trimesh(o3d_mesh, output_path: Path) -> None:
    """Convert an Open3D TriangleMesh to GLB via trimesh."""
    import trimesh

    vertices = np.asarray(o3d_mesh.vertices)
    faces = np.asarray(o3d_mesh.triangles)

    # Vertex colors → uint8 RGBA
    if o3d_mesh.has_vertex_colors():
        vc = (np.asarray(o3d_mesh.vertex_colors) * 255).astype(np.uint8)
        alpha = np.full((vc.shape[0], 1), 255, dtype=np.uint8)
        vc_rgba = np.hstack([vc, alpha])
    else:
        vc_rgba = None

    tmesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        vertex_colors=vc_rgba,
        process=False,
    )

    tmesh.export(str(output_path), file_type="glb")
