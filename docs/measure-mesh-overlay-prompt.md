# Executive prompt: Measure mode — mid-poly wireframe mesh overlay (mesh-only picking)

**Status:** Implemented in [`frontend/src/lib/measureOverlayMesh.ts`](../frontend/src/lib/measureOverlayMesh.ts) and [`Viewer3D.tsx`](../frontend/src/components/Viewer3D.tsx). Uncheck **Wireframe mesh picks** to restore splat-only picking.

---

Use this document as the single source of truth for a greenfield implementation task. Do **not** rely on optional Wavefront OBJ export or `EXPORT_OBJ`; mesh must be generated or derived **without** the `.obj` pipeline.

---

## Goal

Improve measurement reliability in the Gaussian splat viewer by overlaying a **mid-poly triangle mesh** (wireframe only; client-side proxy from splat centers, not full surface reconstruction), with **depth bias** to reduce z-fighting with splats, and switching measure-mode picking to **snap to that mesh only** (no GS3D splat raycast, no splat-center cache fallback, no ground plane fallback for placed points).

---

## Non-goals

- No new dependency on server-side OBJ generation, download URLs, or `to_obj.py` for this feature.
- No requirement for high-fidelity surface reconstruction; a **mid-poly** voxel budget (~3k target cells) is the default tradeoff between pick stability and cost.
- No third preset / API changes unless strictly required for a single feature flag.

---

## Rendering requirements

1. **Wireframe only** — `MeshBasicMaterial` with `wireframe: true` (or `WireframeGeometry` if preferred), color distinct from measure UI (e.g. muted cyan/gray) and readable on dark chrome.
2. **Depth offset** — eliminate or reduce z-fight with splats:
   - Use `polygonOffset: true`, `polygonOffsetFactor`, `polygonOffsetUnits` (tune empirically), scaled by **`VITE_VIEWER_SCENE_SCALE`** in the viewer so offset stays consistent when the splat is scaled, and/or a tiny constant **push along view normal** in the vertex shader or via `renderOrder` + material depth settings consistent with Three.js r150+ behavior.
   - Document chosen values in code comments so future tuning is obvious.
3. **Same scene graph** as the splat — mesh must live under the same world transform as the loaded PLY/splat mesh (respect `VITE_VIEWER_SCENE_SCALE` / `splatMesh` scale if present so picks and visuals stay aligned).
4. **Toggle** — user or measure mode should be able to show/hide the overlay without reloading the splat (e.g. checkbox in Measure panel or automatic show when entering measure mode).

---

## Picking requirements

1. **Snap to mesh only** — for placement and hover preview of measure points:
   - Use Three.js `Raycaster` against the overlay `THREE.Mesh` (or a hidden duplicate with `Side: DoubleSide` if back-face misses are an issue).
   - Return **world-space** hit point on the triangle surface (standard `Raycaster.intersectObject` first hit).
   - **Do not** call `pickSplatMeasure` / GS3D `intersectSplatMesh` / splat center cache for this mode.
2. **Reject** clicks that miss the mesh (no ground plane, no “nearest splat center”); show the same style of user hint as today (“move over the model”) adapted to “move over the wireframe mesh”.
3. **Performance** — mid-poly keeps raycast cost bounded on desktop; optionally throttle hover raycasts if needed.

---

## Mesh source (no .obj)

Choose **one** implementable path (document which was chosen in the PR):

**Option A — Client-side from splat centers (recommended for “no OBJ”)**  
After the splat center cache exists (`Float32Array` world positions in [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) / `Viewer3D`):

- Downsample (voxel grid or random stride) to a **target vertex budget** (default **~3k** cells; configurable constant).
- Build a **mid-poly** mesh: **Delaunay** after **PCA** best-fit plane (fallback: bbox smallest-axis projection), **convex hull** via a small dependency (e.g. `three-mesh-bvh` is for BVH not hull — use `quickhull3d` / `convex-hull` npm or implement incremental hull only if bundle size allows), or **alpha shape** if feasible without heavy native deps.
- Must be **robust** on colinear / flat scenes; fallback message if mesh cannot be built.

**Option B — Server-side mesh endpoint (still no OBJ file to user)**  
New API returns **glTF** or **binary STL** or JSON (positions + indices) built from PLY point cloud with Poisson/ball-pivot in Python (`open3d` / `trimesh`); frontend fetches once per job and builds `BufferGeometry`. Heavier ops/deploy story; only if client-only hull is unacceptable.

Default expectation in this prompt: **Option A** unless product explicitly chooses B.

---

## Files likely to change

- [`frontend/src/components/Viewer3D.tsx`](frontend/src/components/Viewer3D.tsx) — build/remove overlay mesh, toggle UI, wire measure `click` / `mousemove` to mesh raycast when overlay mode is on.
- [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) — optional: add `pickMeshMeasure(raycaster, mesh, ndc, ...)` or keep raycast entirely in `Viewer3D` to avoid bloating shared lib; either is fine if documented.
- Tests: unit test for ray vs simple triangle mesh in world space (no GS3D).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — short subsection: measure mesh overlay, mid-poly / PCA source, mesh-only picking.
- [`README.md`](README.md) — one line under viewer / measure if user-facing.

---

## Acceptance criteria

1. With overlay enabled in measure mode, two placed points lie on the **wireframe mesh surface** (raycast hit), not on arbitrary splat centers.
2. No regression to OBJ download path; feature works when `model_url_obj` is absent.
3. Wireframe remains readable at typical orbit distances; z-fight with splats is **visually acceptable** on desktop Chrome after tuning.
4. If mesh build fails, show a clear inline error and disable mesh-only pick until fixed or toggled off.

---

## Risks (communicate in PR)

- Mid-poly mesh is a **rough proxy** of the scene; measurements are “mesh true,” not “splat ellipsoid true.”
- Extreme sparse / planar captures may produce degenerate meshes — need fallback UX.

---

## Suggested implementation order

1. Mesh builder module (client, from cached centers + target poly count).
2. Add mesh to `threeScene`, wireframe + polygon offset + scale parity with splat.
3. Replace measure pick path with `Raycaster` only when feature is on.
4. Docs + minimal test + manual QA on one LongSplat job PLY.
