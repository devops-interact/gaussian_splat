# LongSplat Integration

## Overview

LongSplat is a robust unposed 3D Gaussian Splatting framework designed for casually captured long videos. It addresses challenges like irregular camera motion, unknown poses, and expansive scenes where traditional methods fail due to pose drift or memory limitations.

**Repository:** https://github.com/NVlabs/LongSplat.git

---

## Key Features

### Incremental Joint Optimization
Concurrently optimizes camera poses and 3D Gaussians. This joint optimization avoids local minima and ensures global consistency across the reconstruction — critical for long, drift-prone sequences.

### Pose Estimation with 3D Priors
Leverages a Pose Estimation Module (MASt3R) that uses learned 3D priors for robust initialization and correction, superior to standard structure-from-motion (COLMAP) in difficult scenarios.

### Adaptive Octree Anchor Formation
Manages memory efficiency in large scenes using an adaptive Octree mechanism that dynamically adjusts anchor densities based on scene complexity, reducing memory usage without compromising detail.

---

## Build Configuration

All CUDA extensions are built from LongSplat's own submodules. No external `gaussian-splatting` repository dependency.

| Component | Source | Notes |
|---|---|---|
| diff-gaussian-rasterization | LongSplat submodule | CUDA rasterizer |
| simple-knn | LongSplat submodule | KNN for point clouds |
| fused-ssim | LongSplat submodule | Structural similarity |
| MASt3R | LongSplat submodule | Pose estimation (DUSt3R + CRoCo) |

**Target architecture:** `sm_86` (NVIDIA A40). The Dockerfile strictly targets this to avoid `no kernel image` runtime errors.

**Dependency handling:** `torch` and `pytorch3d` are installed from pre-built wheels before LongSplat's `requirements.txt` is processed (those entries are filtered out to prevent build conflicts).

---

## Training Optimization

Parameters are tuned for efficiency while preserving reconstruction quality:

- **Preset-tuned iterations** — main train (`--iterations` from `QUALITY_PRESETS`) plus scaled pose/local/global/post/init; then a **second GPU phase** `convert_3dgs.py` (Scaffold-GS → standard 3DGS) with `--iteration` capped per preset (`convert_3dgs_refinement_cap`: 6500 Balanced, 10000 Quality; floor 3000). See `backend/services/longsplat/train.py` and container logs `[LongSplat timing]`.
- **Auto-centering** — post-processing ensures the output model is centered at (0, 0, 0) for immediate viewing
- **Native color learning** — relies on the model's natural SH DC convergence rather than random initialization, preserving input video color fidelity

---

## Pipeline Integration

The backend orchestrates LongSplat training as step 3 of the processing pipeline:

1. Video preprocessing (FFmpeg frame extraction)
2. Frame preparation (scene directory structure)
3. **LongSplat training** (MASt3R pose estimation + Gaussian optimization)
4. Conversion to standard 3DGS PLY format (centered, with SH→RGB heuristic)

The training wrapper (`backend/services/longsplat/train.py`) handles:
- LongSplat repository path resolution via `LONGSPLAT_REPO` env
- Scene directory setup (copies frames to `images/`)
- Training execution with configurable timeout (4 hr max)
- stdout/stderr capture for production logging
- Output PLY validation

### Viewer API (no extra training step)

Training output under the job model directory feeds the **web viewer** only:

- **`GET /api/jobs/{id}/initial_camera`** — [`backend/services/viewer_initial_camera.py`](backend/services/viewer_initial_camera.py) reads LongSplat-style poses (e.g. `cameras_all.json` when present) and returns a suggested **`position` / `target`** in LongSplat world space. The SPA’s [`Viewer3D.tsx`](frontend/src/components/Viewer3D.tsx) fetches this in parallel with the PLY and applies **`cameraUp: [0, 1, 0]`** for that path (see **ARCHITECTURE.md**). This does **not** change the GPU training command or PLY export.

- **Large scenes / progressive viewer loads** — When the web viewer uses progressive splat loading, GaussianSplats3D may rebuild its **SplatTree** more than once; measure-mode center caches and pick dimensions stay in sync with that lifecycle (see **ARCHITECTURE.md** §3D Viewer — splat picking).

---

## References

- [LongSplat Paper](https://linjohnss.github.io/longsplat/)
- [LongSplat GitHub](https://github.com/NVlabs/LongSplat)
- [MASt3R GitHub](https://github.com/naver/mast3r)
