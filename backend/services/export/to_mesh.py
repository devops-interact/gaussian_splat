"""
Surface reconstruction from Gaussian Splat point clouds.

Uses Open3D Poisson reconstruction to convert a PLY point cloud into a
watertight triangle mesh, then exports as GLB for browser-native rendering.

Pipeline:
  1. Load PLY point cloud with colors
  2. Estimate normals (oriented consistently)
  3. Poisson surface reconstruction (depth=9)
  4. Trim low-density faces to remove reconstruction artefacts
  5. Transfer vertex colors from original points
  6. Decimate to a target face count for browser performance
  7. Export as GLB (binary glTF)
"""
import logging
import tempfile
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


def reconstruct_mesh(
    ply_path: Path,
    output_glb: Path,
    *,
    poisson_depth: int = 9,
    target_faces: int = 500_000,
    density_quantile: float = 0.02,
) -> bool:
    """
    Run the full surface reconstruction pipeline.

    Args:
        ply_path:         Input PLY point cloud (must have xyz; colours optional).
        output_glb:       Output GLB file path.
        poisson_depth:    Octree depth for Poisson reconstruction (8-10).
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

        # ── 2. Estimate & orient normals ─────────────────────────────────
        logger.info("Estimating normals …")
        # Adaptive radius: use average nearest-neighbour distance * 3
        pcd.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(
                radius=0.1, max_nn=30
            )
        )
        pcd.orient_normals_consistent_tangent_plane(k=15)
        logger.info("Normals estimated and oriented")

        # ── 3. Poisson surface reconstruction ────────────────────────────
        logger.info(f"Running Poisson reconstruction (depth={poisson_depth}) …")
        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd, depth=poisson_depth, linear_fit=False
        )

        n_verts_raw = len(np.asarray(mesh.vertices))
        n_faces_raw = len(np.asarray(mesh.triangles))
        logger.info(f"Raw mesh: {n_verts_raw:,} vertices, {n_faces_raw:,} faces")

        # ── 4. Trim low-density faces ────────────────────────────────────
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

        # ── 5. Transfer vertex colors ────────────────────────────────────
        if has_colors:
            logger.info("Transferring vertex colors from point cloud …")
            mesh_vertices = np.asarray(mesh.vertices)
            pcd_tree = o3d.geometry.KDTreeFlann(pcd)
            pcd_colors = np.asarray(pcd.colors)  # (N, 3) in [0, 1]

            mesh_colors = np.zeros_like(mesh_vertices)
            for i in range(len(mesh_vertices)):
                _, idx, _ = pcd_tree.search_knn_vector_3d(mesh_vertices[i], 1)
                mesh_colors[i] = pcd_colors[idx[0]]

            mesh.vertex_colors = o3d.utility.Vector3dVector(mesh_colors)
            logger.info("Vertex colors transferred")
        else:
            # Neutral grey
            mesh.paint_uniform_color([0.7, 0.7, 0.7])

        # ── 6. Decimate ──────────────────────────────────────────────────
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

        # ── 7. Export as GLB ─────────────────────────────────────────────
        # Open3D doesn't export GLB directly.  Write OBJ, then convert
        # via trimesh (already installed) which handles GLB natively.
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
        # Add alpha channel
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

    # Export as GLB (binary glTF)
    tmesh.export(str(output_path), file_type="glb")
