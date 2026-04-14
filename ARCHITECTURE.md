# Gaussian Room Reconstruction — Architecture

## Overview

A web application that converts video footage of rooms into interactive 3D point cloud models and reconstructed meshes using **LongSplat** (NVIDIA's unposed 3D Gaussian Splatting). The frontend is hosted on Vercel; the GPU backend runs on RunPod.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                             FRONTEND (Vercel)                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ VideoUpload │  │  JobStatus   │  │   Viewer3D   │  │   Metadata      │  │
│  │ - Presets   │  │  - Progress  │  │  - PLY Load  │  │  - Point Count  │  │
│  │ - Validate  │  │  - Errors    │  │  - GLB Mesh  │  │  - Bounding Box │  │
│  │             │  │              │  │  - Measure   │  │  - Color/SH     │  │
│  │             │  │              │  │  - Walk-thru │  │  - Status Badge │  │
│  │             │  │              │  │  - Snapshot  │  │                 │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
│         └────────────────┴──────────────────┴───────────────────┘           │
│                                    │                                        │
│                            VITE_API_BASE_URL                                │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │ HTTPS
┌────────────────────────────────────┼────────────────────────────────────────┐
│                         BACKEND (RunPod GPU)                                │
│                                    │                                        │
│  ┌─────────────────────────────────▼────────────────────────────────────┐   │
│  │                        FastAPI Server (:8000)                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │   │
│  │  │ /api/jobs/*  │  │ /api/presets │  │ /static/models/*          │   │   │
│  │  │ Upload/Status│  │ Quality Info │  │ .ply  .ply.gz  .glb      │   │   │
│  │  └──────┬───────┘  └──────────────┘  └───────────────────────────┘   │   │
│  └─────────┼────────────────────────────────────────────────────────────┘   │
│            │                                                                │
│  ┌─────────▼────────────────────────────────────────────────────────────┐   │
│  │                       Processing Pipeline                             │   │
│  │                                                                       │   │
│  │  1. Validate ──▶ 2. Extract Frames ──▶ 3. LongSplat Training         │   │
│  │                     (FFmpeg @ FPS)        (MASt3R + 3DGS)            │   │
│  │                                                │                      │   │
│  │  6. Complete ◀── 5. Mesh Recon (opt.) ◀── 4. Export & Compress       │   │
│  │  .ply + .obj      Poisson → OBJ             PLY + Gzip               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        LongSplat Stack                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │   MASt3R    │  │   DUSt3R    │  │  CRoCo   │  │ 3DGS Kernels │   │   │
│  │  │ Pose Est.   │  │ Dense 3D    │  │ Cross-Att│  │ CUDA Render  │   │   │
│  │  └─────────────┘  └─────────────┘  └──────────┘  └──────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Storage: /app/storage (RunPod Volume 150GB)                                │
│  ├── uploads/    (source videos)                                            │
│  ├── frames/     (extracted JPGs)                                           │
│  ├── models/     (.ply, .ply.gz, .glb outputs)                              │
│  └── logs/       (app.log)                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend (Vercel)

| Technology | Purpose |
|---|---|
| React 18 + TypeScript | UI framework |
| Vite | Build tool |
| Three.js (`@react-three/fiber`, `@react-three/drei`) | Scene helpers / legacy paths |
| `@mkkellogg/gaussian-splats-3d` | 3DGS viewer, PLY load, splat raycaster |
| [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) | Measure picking: NDC from **`renderDims`** (canvas or **`Viewer.getRenderDimensions`** when it diverges), GS3D raycast, world center cache fallback |
| Custom PLY parser | Binary GS format conversion within renderer |
| Tailwind CSS | Styling |
| Lucide React | Iconography |
| Framer Motion | UI Animations |
| React Router | Client-side routing |

### Backend (RunPod GPU)

| Technology | Purpose |
|---|---|
| Python 3.10 | Runtime |
| FastAPI | Async API server |
| PyTorch 2.2.0 (CUDA 12.1) | Deep learning |
| FFmpeg | Video frame extraction |
| LongSplat | 3D Gaussian Splatting (MASt3R poses) |
| Open3D | Poisson surface reconstruction |
| trimesh | OBJ mesh export |
| Passlib / PyJWT | Authentication |

### Infrastructure

| Component | Technology |
|---|---|
| Frontend Hosting | Vercel (auto-deploys from GitHub) |
| Backend/GPU | RunPod (A40 required) |
| Container | Docker (~15GB image, linux/amd64) |
| Registry | Docker Hub (`interactdevops/gaussian-room-reconstruction`) |
| Storage | RunPod Volume (150GB) |

### Required GPU

| GPU | VRAM | Architecture | Compute Capability |
|---|---|---|---|
| **A40** | **48 GB** | Ampere | sm_86 |

> Build is compiled specifically for NVIDIA A40 (sm_86).

---

## Processing Pipeline

```
Video (MP4)
  → 1. Validate (duration, resolution, format)
  → 2. Extract Frames (FFmpeg @ preset FPS → JPGs)
  → 3. LongSplat Training (MASt3R pose estimation → 3DGS)
  → 4. Scaffold-GS to standard 3DGS conversion
  → 5. Postprocess (prune low opacity, filter outliers, center)
  → 6. Export PLY + Gzip compress
  → 7. Mesh Reconstruction (Poisson surface → OBJ)  [optional]
  → 8. Complete → served via /api/jobs/{id}/model
```

### Step Details

| Step | Duration | Output |
|---|---|---|
| Frame Extraction | 10-30 s | `/app/storage/frames/{job_id}/` |
| LongSplat Training | ~20–90+ min (preset + clip length; includes `convert_3dgs`) | `model.ply` in models dir |
| Scaffold Conversion & Post-Process | ~3-15 min (scales with `convert_3dgs` iters) | Converted and centered `model.ply` |
| PLY Export + Compress | 5-10 s | `{job_id}.ply`, `{job_id}.ply.gz` |
| Mesh Reconstruction | 30-120 s | `{job_id}.obj` (Poisson → decimate → OBJ) |

### Mesh Reconstruction Sub-Pipeline

1. Load PLY point cloud with colors (Open3D)
2. Estimate & orient normals (KD-tree hybrid, k=15)
3. Poisson surface reconstruction (depth=9)
4. Trim low-density faces (bottom 2%)
5. Transfer vertex colors from nearest points (KNN)
6. Decimate to 500K faces for browser performance
7. Export as OBJ via trimesh

---

## Quality Presets

Defined in [`backend/core/config.py`](backend/core/config.py) (`QUALITY_PRESETS`).

| Preset | FPS | LongSplat iterations | `convert_3dgs` prune ratio | `convert_3dgs` iter cap | Est. time | Use case |
|---|---|---|---|---|---|---|
| **Balanced** | 1.5 | 12,000 | 0.58 | **6,500** | ~35 min (typ.) | Shorter post-train refinement than Quality |
| **Quality** | 1.0 | 24,000 | 0.65 | **10,000** | ~70 min (often 1h+) | Full main train + max refinement; fewer frames/sec |

**Two GPU-heavy phases:** (1) LongSplat `train.py` for `--iterations`, (2) `convert_3dgs.py` for `--iteration` up to the preset cap (floored at 3000, scaled by `quality_factor` below 12k main iters). Logs: `[LongSplat timing] train.py subprocess…`, `convert_3dgs.py…`, `custom converter + PlyOptimizer…`.

Sub-iteration counts (pose/local/global/post/init) and the **scaled** convert budget are computed in [`train.py`](backend/services/longsplat/train.py) (`quality_baseline=12000`, `convert_iters = max(3000, min(convert_3dgs_refinement_cap, int(convert_scale_cap * quality_factor)))` with **`convert_scale_cap=10000`** — keep this **≥** the largest preset `convert_3dgs_refinement_cap` or the scale term caps `convert_iters` below the preset).

Higher **prune ratio** keeps more Gaussians after Scaffold-GS → 3DGS conversion (less aggressive pruning). Tuning is per preset without code changes beyond `PresetConfig`.

**PLY extent:** [`postprocess.py`](backend/services/longsplat/postprocess.py) drops position outliers beyond `mean + sigma * std` (distance from centroid). Default **sigma = 3.5**; override with **`PLY_POSITION_OUTLIER_SIGMA`** (float, clamped **2.5–6**) if you need to retain more distant splats.

---

## PLY Output Format

Gaussian Splatting binary PLY with ~62 properties per vertex:

| Property | Description |
|---|---|
| `x, y, z` | Position |
| `nx, ny, nz` | Normals |
| `f_dc_0, f_dc_1, f_dc_2` | Spherical Harmonics DC (color) |
| `f_rest_0` … `f_rest_44` | Additional SH coefficients |
| `red, green, blue` | Direct RGB (uchar, preferred when present) |
| `opacity` | Transparency (sigmoid-activated) |
| `scale_0, scale_1, scale_2` | Gaussian scale |
| `rot_0, rot_1, rot_2, rot_3` | Rotation quaternion |

**Color priority:** Direct `red/green/blue` (uchar) is preferred over SH conversion. If only SH is available:

```
RGB = clamp(SH_C0 × f_dc + 0.5, 0, 1)
where SH_C0 = 0.28209479177387814
```

The backend converter also detects whether `f_dc` values are already in `[0,1]` or `[0,255]` range and handles each case.

**Web viewer compatibility (`@mkkellogg/gaussian-splats-3d`):** The INRIA PLY path assumes the number of `f_rest_*` properties is **divisible by three** (SH coefficients per color channel). A partial tail (for example eleven `f_rest_0`…`f_rest_10` fields) makes the library use non-integer channel strides and can yield a **blank splat canvas** with no JS error. When building `model.ply`, [`longsplat_to_3dgs_converter.py`](backend/services/longsplat/longsplat_to_3dgs_converter.py) drops the trailing incomplete `f_rest_*` columns so the count is a multiple of three.

**Export hard gate:** After sanitization, [`assert_ply_gaussian_splats3d_compatible`](backend/services/longsplat/longsplat_to_3dgs_converter.py) runs from [`to_ply.py`](backend/services/export/to_ply.py). If any `f_rest_*` remain and their count is **not** divisible by three, export **raises** so a broken PLY is not published.

### PLY vs `.ksplat` / `.splat`

The API still serves **`.ply`** (and `.ply.gz`). [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) also supports **`.ksplat`** and **`.splat`** for faster loads. In-app: use the viewer **Display** panel **Download .ksplat** (browser `PlyLoader` → `KSplatLoader`). Offline / batch: clone the upstream repo and run `node util/create-ksplat.js …`, or use the hosted [converter / demo](https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php). The npm package does **not** ship `util/create-ksplat.js`.

**Deployment checklist (Vercel + RunPod):** The SPA (Vercel) and the API/training image (Docker Hub → RunPod) should track the **same `main` commit** when you change PLY or viewer behavior. After merging backend fixes, run [`./build-and-push.sh`](build-and-push.sh) (runs **`npm run build`** + **`npm test`** in `frontend/`, header/CORP checks, and required LongSplat files before `docker buildx push`), **recreate or pull** `interactdevops/gaussian-room-reconstruction:latest` on the pod, then run a **new job**. In container logs, successful normalization logs *Normalized f_rest for web viewer* and export diagnostics should show **9** (or 0) `f_rest_*` fields, not **11**. Old `model.ply` files on disk are not rewritten automatically.

### 3D viewer troubleshooting (GaussianSplats3D)

Use this order to separate **data** issues from **runtime** issues:

1. **Console logs from `Viewer3D`:** After load, check `[GS3D] Splat count after load` and `[GS3D] Splat center cache`. Counts at **0** or missing point to PLY parse / SH layout, not “Three.js not drawing.”
2. **`f_rest_*` count:** In the PLY header, `f_rest_*` properties must be a **multiple of three** for `@mkkellogg/gaussian-splats-3d`; otherwise the splat pass can be empty while the grid/axes still render.
3. **`crossOriginIsolated`:** Run `crossOriginIsolated` in the browser console on the deployed app. If **false**, `SharedArrayBuffer` paths in the library may fail; align COOP/COEP on the HTML response (`frontend/vercel.json`) with CORP on the API (`backend/main.py`).
4. **Network:** Confirm the PLY `fetch` is **200** and the API sends **`Cross-Origin-Resource-Policy: cross-origin`** so a COEP-isolated page can read the body.
5. **Camera vs. scene:** If splat count is healthy but the view looks empty, compare bbox logs to camera position (centering / scale); misalignment is rarer than bad PLY SH columns.
6. **Spinner never clears:** Follow **`[GS3D] phase:`** logs in the console. If the last line is **`PLY fetch start`** (no **`PLY fetch done`**), the model request stalled or hit the **120s** PLY fetch timeout. If it stops after **`addSplatScene start`** (no **`addSplatScene done`**), `GaussianSplats3D` may be hung in GPU sort / shared-memory workers: set **`VITE_GS3D_FORCE_LEGACY_WORKERS=true`** in Vercel env, rebuild the frontend, and redeploy so the viewer forces **`gpuAcceleratedSort: false`** and **`sharedMemoryForWorkers: false`** even when **`crossOriginIsolated`** is true. **`GET /api/jobs/{id}/initial_camera`** uses an **8s** axios timeout and runs in parallel with the PLY fetch so a stuck API cannot block the viewer indefinitely.
7. **Upside-down or rolled horizon with `initial_camera`:** Pose-derived **`position` / `target`** come from LongSplat world space. `Viewer3D` uses **`cameraUp: [0, 1, 0]`** when that API hint is applied, and keeps **`cameraUp: [0, -1, 0]`** for the bbox-only fallback (MASt3R / OpenCV-style framing). If a scene still looks wrong, compare with hint off (bbox path) and file an issue with a sample job id.
8. **`VITE_GS3D_FORCE_LEGACY_WORKERS` tradeoff:** `true` can unblock **stuck loads** on some GPUs but disables **GPU-accelerated sort** and **shared worker memory** → **choppier** orbit and more CPU work during interaction. After confirming loads succeed (e.g. JobStatus no longer thrashes the viewer), try **unset** or **`false`** on Vercel for smoother motion on capable devices.
9. **MetaMask SES / `lockdown-install.js`:** Repeated **`DOMException: An attempt was made to use an object that is not, or is no longer, usable`** often comes from the extension’s SES hardening when libraries (e.g. OrbitControls) touch **`domElement.style`**. Test in **incognito without extensions** or disable that feature for debugging; it is not evidence of a bad PLY.
10. **Measure picks land off the splat / wrong fallback:** Check **`[Pick:dims]`** once per measure session: **`physical`** is the canvas backing store; **`gs3dReported`** comes from **`Viewer.getRenderDimensions`**. When they differ by more than a few pixels, the viewer uses **`pickUsing=gs3d`** so **`mousePos`** and **`renderDims`** match what **`setFromCameraAndScreenPosition`** expects. Measure mode uses [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts): library raycast first (closest hit by **`distance ≤ maxSplatPickDistance(bbox)`**; position from **`point`** or **`origin`**), then world-space **center cache** built with **`getSplatCenter(..., false)`** + **`matrixWorld`** when the mesh transform is not identity. **`PICK_RADIUS_PX`** is **28** in the same pixel units as **`renderDims`**. The **center cache** is rebuilt on **every** SplatTree completion: **`onSplatTreeReady`** is re-registered after each callback (GS3D clears the single slot after invoke), including progressive final builds. If **`[splatPick] center cache built: 0 splats`** appears, wait for **`[GS3D] SplatTree ready`** / retry logs; dev helper **`diagPickAlignment()`** can project cached centers to the screen.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, `model_url` (PLY via `/api/jobs/{id}/model`), `model_url_compressed`, `model_url_obj` |
| `GET` | `/api/jobs/{id}/model` | Download PLY (raw bytes; if only `.ply.gz` exists on disk, decompresses on the fly) |
| `GET` | `/api/jobs/{id}/model?compressed=true` | Download compressed PLY.gz |
| `GET` | `/api/jobs/{id}/initial_camera` | JSON `position` / `target` / `up` for viewer first frame ([`viewer_initial_camera.py`](backend/services/viewer_initial_camera.py)); 8s client timeout in viewer |
| `GET` | `/api/jobs/{id}/cameras` | Optional `cameras_all.json` from training output |
| `GET` | `/static/models/{id}/{id}.obj` | Optional Poisson/trimesh **OBJ** mesh when [`pipeline.py`](backend/core/pipeline.py) runs OBJ export (`EXPORT_OBJ=true`) |

---

## Frontend Features

### 3D Viewer (`Viewer3D.tsx`)

- **Splat picking** ([`splatPick.ts`](frontend/src/lib/splatPick.ts)) — **Strategy 1:** `intersectSplatMesh` after optional **`raycastAgainstTrueSplatEllipsoid`** (set when the GS3D build exposes it); pick **closest** hit by **`distance`** (≤ scene **`maxSplatPickDistance`**); read position from **`point`** or **`origin`** when present (no extra camera-distance gate on the hit position). **Strategy 2:** `Float32Array` world **center cache**: `getSplatCount(false)` then `getSplatCenter(i, p, false)` and **`p.applyMatrix4(splatMesh.matrixWorld)`** when the mesh matrix is not identity (works across GS3D boolean vs `Matrix4` third-arg APIs). Cache rebuild on **each** **`onSplatTreeReady`** (handler re-registers for the next GS3D tree build; also armed when the tree already exists at load and from the **5s** safety poll), plus **1.5s retry** if cache empty after a ready event. **Screen coords:** mouse is normalized to the canvas **`getBoundingClientRect`**, then scaled to **`renderDims`**: default **`canvas.width`/`height`**, or **`Viewer.getRenderDimensions`** when non-zero and meaningfully different from the backing store (same space as GS3D raycaster). Cone gate: **`PICK_RADIUS_PX`** (**28** px on the shorter **`renderDims`** axis). Reconstructions are not metric—use **calibration** for real-world distances. Dev: **`diagPickAlignment(camera, centers, w, h)`** projects sample centers for alignment checks.
- **Orbit mode** — rotate, pan, zoom with OrbitControls. After **`viewer.start()`**, `Viewer3D` patches **`minDistance`** / **`maxDistance`** from the PLY bbox diagonal × **`VITE_VIEWER_SCENE_SCALE`** (defaults **1**) so scroll-zoom can move closer than GS3D defaults. Optional **`VITE_VIEWER_SCENE_SCALE`** (clamped **0.25–10**) applies **`splatMesh.scale`**, scales initial camera eye positions from the look-at target, and scales measure **`maxDist`**. **`GET /api/jobs/{id}/initial_camera`** eye distance uses bbox diagonal × **`INITIAL_CAMERA_DIAGONAL_FRAC`** (**0.6**), overridable on the API host with env **`INITIAL_CAMERA_DISTANCE_FRAC`** (**0.35–0.95**); see [`viewer_initial_camera.py`](backend/services/viewer_initial_camera.py).
- **Walk-through mode** — first-person WASD + mouse-look via pointer lock. Walk/Measure listeners attach after `loading` becomes false so they bind to the real canvas once the GaussianSplats3D viewer exists (avoids stuck modes and DOMExceptions from pointer lock on a disposed canvas).
- **Measurement tool** — click two points (A = lavender, B = green); **mousemove** shows a preview ring at the **nearest splat world center** under the cursor (same **world center cache** as picking: rebuilt after each **`onSplatTreeReady`**). Placement uses **`pickSplatMeasure` with `splatCentersOnly`** ([`splatPick.ts`](frontend/src/lib/splatPick.ts)): **screen-space cone** (**`PICK_RADIUS_PX`**) along the view ray over cached centers (optional spatial grid when splat count is high), **no** GS3D ellipsoid surface hit and **no** ground-plane fallback — only discrete splat centers. Hints may show **`splat #index`** for pre-selection. The former wireframe Delaunay overlay is **removed**; historical design notes live in [`docs/measure-mesh-overlay-prompt.md`](docs/measure-mesh-overlay-prompt.md).
- **Points / Mesh toggle** — switch between raw point cloud and reconstructed GLB surface
- **Snapshot** — capture current view as PNG
- **Adaptive point size** — auto-calculated from bounding sphere, with manual +/- controls
- **Gizmo** — axis indicator (bottom-right)
- **Rendering / orientation** — Viewer ctor uses **`sphericalHarmonicsDegree: 2`**, **`freeIntermediateSplatData: false`**. **`cameraUp`** is **`[0, 1, 0]`** when **`GET /api/jobs/{id}/initial_camera`** provides pose-based framing (LongSplat world Y-up), and **`[0, -1, 0]`** for the bbox-only fallback (MASt3R / OpenCV-style). **`gpuAcceleratedSort`** and **`sharedMemoryForWorkers`** are **`true`** only when **`globalThis.crossOriginIsolated === true`** and **`VITE_GS3D_FORCE_LEGACY_WORKERS`** is not set to **`1`** / **`true`**; otherwise both are **`false`** (avoids `SharedArrayBuffer` worker errors; see console `[GS3D] crossOriginIsolated=false…` or **`VITE_GS3D_FORCE_LEGACY_WORKERS…`**). Splat scene uses **identity** `orientation`. **`splatAlphaRemovalThreshold`** (min alpha 1–255) and **`progressiveLoad`** (when vertex count ≥ 50k) come from the **Display** panel / load heuristics. **`addSplatScene`** is wrapped in a **90s** watchdog; PLY fetch uses **`AbortSignal.timeout(120s)`** when supported. After `addSplatScene`, **`viewer.start()`**, then **`setActiveSphericalHarmonicsDegrees`** / **`setSplatScale`** for live tuning. **World-space splat center cache** for measurement (rebuilt after each **SplatTree** completion; see **Splat picking** above). Console: **`[GS3D] phase:`** (init milestones), **`[GS3D] Splat count after load`**, **`[GS3D] Splat center cache:`**.
- **Display panel** — Min alpha (debounced → scene reload), SH 0/1/2 (live), splat scale (live, default **~1.25**, range **0.5–5** for legibility on load), **Download .ksplat** (client-side), and a short cross-origin isolation hint.
- **Performance audit (3D canvas)** — [`docs/viewer-3d-performance-audit.md`](docs/viewer-3d-performance-audit.md): GS3D / Three **knob inventory**, read-only comparison to **[playcanvas/supersplat](https://github.com/playcanvas/supersplat)** (no merge), **gap matrix**, Chrome **Performance** measurement protocol, prioritized **hypothesis backlog**, and **Wave 1** scope (low-risk experiments only).
- **Blank splat canvas (grid/axes OK)** — Confirm PLY **`f_rest_*` count divisible by three** (see PLY Output Format). If isolation headers are missing, the library may fail worker SharedArrayBuffer paths: see **SharedArrayBuffer / GPU** below.

### Viewer: SharedArrayBuffer / GPU-accelerated sort

The SPA should send **`Cross-Origin-Opener-Policy: same-origin`** and **`Cross-Origin-Embedder-Policy: require-corp`** (see `frontend/vercel.json` on Vercel). The FastAPI app adds the same headers plus **`Cross-Origin-Resource-Policy: cross-origin`** on **all** responses so a COEP-isolated browser tab can still call the RunPod API and fetch **`GET /api/jobs/{id}/model`** (decompressed PLY + CORP). Static **`/static/models/...`** remains for `.ply.gz`, OBJ, etc. `Viewer3D` **automatically** sets `gpuAcceleratedSort` and `sharedMemoryForWorkers` to false when `crossOriginIsolated` is false (no manual code change needed locally). If isolation is **on** but splat load **hangs** on some devices, set **`VITE_GS3D_FORCE_LEGACY_WORKERS=true`** at Vercel build time to keep COEP for other features while disabling the accelerated worker path in `GaussianSplats3D`.

### CORS / proxy (Authorization)

If the browser reports preflight failures mentioning **`Authorization`** in front of a RunPod or other reverse proxy, inspect the **actual** `OPTIONS`/`GET` responses in DevTools Network. The backend sets permissive CORS headers; the proxy must forward or repeat `Access-Control-Allow-Headers` (including `Authorization`) on preflight. Fix the proxy rather than mixing that with viewer tuning until splats render correctly.

### Debugging reconstruction vs viewer

If a scene looks noisy or full of sparkles after a deploy:

1. **A/B the PLY** — Download a `model.ply` from a job that used to look good and open it in the **current** web viewer. If it looks fine, the new artifact is likely **reconstruction** (LongSplat / MASt3R / conversion), not the viewer. If it looks bad, tune viewer options above or roll back viewer changes.
2. **Backend logs per job** — On the server, under `/app/storage/models/{job_id}/`: `training.log` (LongSplat stdout) and `convert_3dgs.log` (conversion). Container logs also mention `prune_ratio` and point to these paths after a successful `convert_3dgs.py`.
3. **Dependency diagnostics** — Training startup logs `find_spec("simple_knn")`, `__file__`, and `__loader__` so a broken or shadowed `simple_knn` install is visible before long runs.
4. **Measurement** — Use the two-point calibration step for real-world distances; MASt3R/LongSplat output is not metric by default.

### Metadata Panel (`TechnicalDetails.tsx`)

Displays: file size, point count, bounding box, feature count, quality preset, color/opacity data availability, processing status badge (Idle / Processing / Ready).

### Downloads

Available formats: `.ply` (full), `.ply.gz` (compressed), `.glb` (mesh, when available).

---

## UI Color Scheme

| Hex | Role |
|---|---|
| `#000000` | Base background |
| `#08080f` | Elevated surfaces, viewer background |
| `#121008` | Card backgrounds, form inputs, warm-tinted dark |
| `#efe752` | Primary accent (brand chartreuse) |
| `#f5ec99` | Secondary accent (soft yellow) |

Transparency variations for interactions: `/[0.04]`–`/[0.06]` subtle, `/[0.08]`–`/[0.12]` hover, `/[0.15]`–`/[0.25]` active/selected.

---

## Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/
│   │   ├── jobs.py                     # Upload, status, download endpoints
│   │   └── auth.py                     # Auth and simulated DB logic
│   ├── core/
│   │   ├── config.py                   # Quality presets, settings
│   │   ├── models.py                   # Pydantic models
│   │   ├── pipeline.py                 # Processing orchestration
│   │   └── logging_config.py           # Standardized logger
│   ├── services/
│   │   ├── longsplat/
│   │   │   ├── train.py                # LongSplat training and conversion
│   │   │   ├── longsplat_to_3dgs_converter.py  # SH→RGB heuristic conversion
│   │   │   └── postprocess.py          # Pruning, outliers, and centering
│   │   ├── video/
│   │   │   ├── extract_frames.py
│   │   │   └── validate.py
│   │   └── export/
│   │       ├── to_ply.py               # PLY export + color diagnostics
│   │       ├── to_obj.py               # OBJ export
│   │       └── compress.py             # Gzip compression
│   ├── database.py                     # In-memory session mock DB
│   ├── main.py                         # FastAPI app entry
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── components/layout/       # Sidebar and dashboard shell
│   │   │   ├── VideoUpload.tsx          # Preset selector, file upload
│   │   │   ├── JobStatus.tsx            # Progress bar, status badges
│   │   │   ├── Viewer3D.tsx             # Splat viewer, tools
│   │   │   ├── TechnicalDetails.tsx     # Metadata panel
│   │   │   └── ui/
│   │   │       ├── button.tsx           # Button variants
│   │   │       └── card.tsx             # Card primitive
│   │   ├── contexts/AuthContext.tsx     # JWT management
│   │   ├── pages/Home.tsx               # Dashboard main page
│   │   ├── types/job.ts                 # TypeScript interfaces
│   │   ├── api/jobs.ts                  # API client
│   │   └── index.css                    # Global styles
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── package.json
├── Dockerfile                           # Multi-stage GPU build (linux/amd64)
├── build-and-push.sh                    # Automated Docker build & push
└── ARCHITECTURE.md
```

---

## Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| PyTorch | 2.2.0+cu121 | CUDA training |
| torchvision | 0.17.0 | Vision ops |
| torch-scatter / torch-cluster | Latest | Point cloud ops |
| Open3D | 0.18.0 | Surface reconstruction (Poisson) |
| trimesh | 3.23.5 | Mesh processing, GLB export |
| scipy | 1.10.1 | Scientific computing |
| plyfile | 0.7.4 | PLY I/O |
| opencv-python | 4.8.1.78 | Video processing |
| huggingface_hub | Latest | MASt3R model download |

> **Note:** Open3D import is skipped during Docker build verification (AVX2 not available under QEMU emulation). It works at runtime on the A40 target.

---

## Environment Configuration

```dockerfile
ENV PYTHONPATH=/opt/LongSplat:/opt/gaussian-splatting:${PYTHONPATH}
CMD ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Deployment

### Build & Push

```bash
./build-and-push.sh
```

The script handles Docker buildx setup, `linux/amd64` platform targeting, build logging, and interactive push confirmation.

### RunPod Configuration

| Setting | Value |
|---|---|
| Image | `interactdevops/gaussian-room-reconstruction:latest` |
| Container Disk | 20 GB |
| Volume Disk | 150 GB |
| Volume Mount | `/app/storage` |
| HTTP Port | 8000 |
| TCP Port | 22 (SSH) |

### Vercel Frontend

Deploys automatically from the GitHub repository. **`VITE_API_BASE_URL`** (build-time) should be the RunPod HTTPS origin with no trailing slash, **or** leave it unset and add **`/api` → RunPod** rewrites in `frontend/vercel.json` (see `frontend/vercel.rewrites.example.json`) so the browser uses same-origin `/api/...`. All documented **`VITE_*`** keys live in **`frontend/.env.example`**. If the splat viewer hangs on **“Loading Gaussian Splats…”** with COEP isolation on, set **`VITE_GS3D_FORCE_LEGACY_WORKERS=true`** for the Vite production build and redeploy (see **3D viewer troubleshooting** above).

---

## Performance Expectations (A40 48GB)

| Video Length | Training time (typical, preset-dependent) | GPU memory |
|---|---|---|
| 30 s | ~8-18 min | 12-20 GB |
| 60 s | ~15-30 min | 15-25 GB |
| 120 s | ~28-50 min | 20-35 GB |

Container memory: ~2-4 GB. Disk per job: ~500 MB (frames + models).

---

## MASt3R vs COLMAP

This project uses **MASt3R** (via LongSplat) instead of COLMAP for camera pose estimation.

| | COLMAP | MASt3R |
|---|---|---|
| Type | Traditional SfM | Deep learning |
| Speed | Minutes to hours | Seconds to minutes |
| Docker-friendly | No (Qt/GUI deps) | Yes (pure Python/PyTorch) |
| Robustness | Needs good texture/overlap | Handles casual video |
| Integration | Multi-step | Single pipeline via LongSplat |

MASt3R is based on DUSt3R + CRoCo pretrained features. Model checkpoint: `MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth` (2.6 GB).

---

## Troubleshooting

| Issue | Solution |
|---|---|
| CUDA compilation errors during build | Ensure `TORCH_CUDA_ARCH_LIST="8.9"` is set |
| Build timeout | Re-run — Docker Hub pulls can be slow |
| `ModuleNotFoundError: scipy` | Rebuild image (already in requirements.txt) |
| Training fails immediately | Check GPU availability, PYTHONPATH, frame count (30+ recommended) |
| "No PLY file generated" | Check `/app/storage/models/{job_id}/` and training logs |
| Open3D "Illegal instruction" during build | Expected under QEMU — works at runtime on real x86_64 hardware |
| Stale frontend after deploy | Hard-refresh (Ctrl+Shift+R) or clear Vercel cache; backend serves `Cache-Control: no-store` on index.html |

---

## References

- [LongSplat Paper](https://linjohnss.github.io/longsplat/)
- [LongSplat GitHub](https://github.com/NVlabs/LongSplat)
- [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
- [MASt3R GitHub](https://github.com/naver/mast3r)
- [RunPod Documentation](https://docs.runpod.io/)
