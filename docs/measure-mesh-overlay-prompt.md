# Measure mode — wireframe mesh overlay (deprecated)

**Deprecated / superseded:** The mid-poly **Delaunay wireframe proxy** (`measureOverlayMesh`) and mesh-only picking have been **removed**. Measure mode now snaps **only** to **splat world centers** from the same cache as [`buildSplatCenterWorldCache`](../frontend/src/lib/splatPick.ts) (cone pick along the view ray; see **`splatCentersOnly`** in **`pickSplatMeasure`** and [`Viewer3D.tsx`](../frontend/src/components/Viewer3D.tsx)).

The long-form prompt below was retained only as **historical context** for the old experiment; do not treat it as the current product behavior.

---

# Executive prompt: Measure mode — mid-poly wireframe mesh overlay (mesh-only picking) — **historical**

_Use this section only if you are reviving the old approach or comparing designs._

Improve measurement reliability in the Gaussian splat viewer by overlaying a **mid-poly triangle mesh** (wireframe only; client-side proxy from splat centers, not full surface reconstruction), with **depth bias** to reduce z-fighting with splats, and switching measure-mode picking to **snap to that mesh only** (no GS3D splat raycast, no splat-center cache fallback, no ground plane fallback for placed points).

_(Remainder of original specification omitted; implementation was deleted from the codebase.)_
