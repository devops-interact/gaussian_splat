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
| Babylon.js (`@babylonjs/core`, `@babylonjs/loaders`) | Native 3DGS viewer, PLY → GaussianSplattingMesh |
| [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) | Measure picking: NDC from canvas backing store, cone pick over world center cache from `splatsData` |
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

**Web viewer compatibility (Babylon.js SPLAT loader):** The INRIA PLY path assumes the number of `f_rest_*` properties is **divisible by three** (SH coefficients per color channel). A partial tail can yield incorrect SH rendering. When building `model.ply`, [`longsplat_to_3dgs_converter.py`](backend/services/longsplat/longsplat_to_3dgs_converter.py) drops the trailing incomplete `f_rest_*` columns so the count is a multiple of three.

**Export hard gate:** After sanitization, [`assert_ply_gaussian_splats3d_compatible`](backend/services/longsplat/longsplat_to_3dgs_converter.py) runs from [`to_ply.py`](backend/services/export/to_ply.py). If any `f_rest_*` remain and their count is **not** divisible by three, export **raises** so a broken PLY is not published.

### PLY vs `.splat`

The API still serves **`.ply`** (and `.ply.gz`). Babylon.js also supports **`.splat`** for faster loads. In-app: use the viewer **Display** panel **Download .splat** (exports the in-memory Babylon splat buffer).

**Deployment checklist (Vercel + RunPod):** The SPA (Vercel) and the API/training image (Docker Hub → RunPod) should track the **same `main` commit** when you change PLY or viewer behavior. After merging backend fixes, run [`./build-and-push.sh`](build-and-push.sh) (runs **`npm run build`** + **`npm test`** in `frontend/`, viewer dependency checks, and required LongSplat files before `docker buildx push`), **recreate or pull** `interactdevops/gaussian-room-reconstruction:latest` on the pod, then run a **new job**. In container logs, successful normalization logs *Normalized f_rest for web viewer* and export diagnostics should show **9** (or 0) `f_rest_*` fields, not **11**. Old `model.ply` files on disk are not rewritten automatically.

### 3D viewer troubleshooting (Babylon.js)

Use this order to separate **data** issues from **runtime** issues:

1. **Console logs from `Viewer3D`:** After load, check `[Babylon] Splat center cache` and `[Babylon] phase: ImportMeshAsync done`. Counts at **0** point to PLY parse / SH layout issues.
2. **`f_rest_*` count:** In the PLY header, `f_rest_*` properties should be a **multiple of three** for correct SH rendering.
3. **Network:** Confirm the PLY `fetch` is **200** and returns decompressed PLY bytes (not raw gzip).
4. **Camera vs. scene:** If splat count is healthy but the view looks empty, compare bbox logs to camera position.
5. **Spinner never clears:** Follow **`[Babylon] phase:`** logs. **`PLY fetch start`** without **`PLY fetch done`** → stalled model request or **120s** timeout. Stops after **`ImportMeshAsync start`** → splat conversion/render issue (check console for loader errors). **`GET /api/jobs/{id}/initial_camera`** uses an **8s** timeout in parallel with PLY fetch.
6. **Upside-down horizon with `initial_camera`:** Pose-derived **`position` / `target`** come from LongSplat world space. `Viewer3D` uses **`cameraUp: [0, 1, 0]`** when that API hint is applied, and **`cameraUp: [0, -1, 0]`** for the bbox-only fallback.
7. **Measure picks land off the splat:** Measure mode uses [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) with **`splatCentersOnly`**: screen-space cone (**`PICK_RADIUS_PX` = 28**) over cached world centers from **`splatsData`**. Center cache rebuilds after load and after min-alpha filter via **`updateData`**.

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

- **Splat picking** ([`splatPick.ts`](frontend/src/lib/splatPick.ts)) — World **center cache** from `GaussianSplattingMesh.splatsData` (32 B/splat, positions at floats 0–2, transformed by mesh world matrix); splats with alpha below **`PICK_CENTER_ALPHA_FLOOR` (40/255)** are excluded so picks never snap to near-invisible floaters. Measure mode uses **`pickSplatMeasure` with `splatCentersOnly`**: screen-space cone (**`PICK_RADIUS_PX` = 28**) along the view ray; spatial grid when splat count > 50k (ray traversal dilated by one neighbor ring — no full-scan fallback). Mouse coords normalized via canvas **`getBoundingClientRect`** → canvas backing-store pixels. Dev: **`diagPickAlignment(camera, centers, w, h)`**.
- **Orbit mode** — `ArcRotateCamera` rotate/pan/zoom. **`lowerRadiusLimit` / `upperRadiusLimit`** from PLY bbox diagonal × **`VITE_VIEWER_SCENE_SCALE`**. Optional scene scale applies **`splatMesh.scaling`**, scales initial camera eye positions, and scales measure **`maxDist`**. **`GET /api/jobs/{id}/initial_camera`** for first-frame pose.
- **Walk-through mode** — first-person WASD + pointer-lock mouse look via `UniversalCamera`; speed scales with the scene diagonal.
- **Measurement tool** — yellow hover preview (persistent gizmo, repositioned per tick — no mesh churn) at nearest splat center; blue committed points sized from the scene diagonal; two-step calibrate then measure in meters with live segment distance in the hint. Clicks that drag > 5 px are ignored (orbit-safe); **Esc / right-click / Undo button** removes the last placed point.
- **Snapshot** — PNG capture with metadata watermark.
- **Display panel** — Min alpha (live filter via `updateData`), SH 0/1/2 when `maxShDegree > 0`, **Download .splat**.
- **Rendering** — Babylon.js `ImportMeshAsync` with SPLAT loader (`keepInRam: true`). PLY fetch **120s** timeout; import **90s** watchdog. Console: **`[Babylon] phase:`** milestones.

### CORS / proxy (Authorization)

If the browser reports preflight failures mentioning **`Authorization`** in front of a RunPod or other reverse proxy, inspect the **actual** `OPTIONS`/`GET` responses in DevTools Network. The backend sets permissive CORS headers; the proxy must forward or repeat `Access-Control-Allow-Headers` (including `Authorization`) on preflight. Fix the proxy rather than mixing that with viewer tuning until splats render correctly.

### HTTP 524 vs CORS during job polling

When the Vercel SPA calls RunPod **directly** via `VITE_API_BASE_URL` (cross-origin), a **stopped or unreachable pod** often surfaces as:

1. **HTTP 524** in DevTools (RunPod/Cloudflare gateway timeout — origin did not respond in time)
2. Browser console: **missing `Access-Control-Allow-Origin`** and axios **Network Error**

That CORS message is usually **misleading**: the 524 HTML error page comes from Cloudflare, not FastAPI, so it has no CORS headers. FastAPI already returns `Access-Control-Allow-Origin: *` on every response when the pod is healthy ([`backend/main.py`](backend/main.py)).

**Recommended fix:** use **same-origin** API calls — unset `VITE_API_BASE_URL` in Vercel Production and add `/api` + `/static` **rewrites** in [`frontend/vercel.json`](frontend/vercel.json) to the current RunPod HTTPS origin (see [`frontend/vercel.rewrites.example.json`](frontend/vercel.rewrites.example.json)). The browser then calls `your-app.vercel.app/api/...` and Vercel proxies to RunPod.

**Ops checklist when polling fails:**

- `curl -m 15 https://YOUR-POD-8000.proxy.runpod.net/health` → `{"status":"healthy"}`
- Pod **running** for the full job (~35–70 min); volume mounted at **`/app/storage`**
- After pod recreate, update **rewrites** (or `VITE_API_BASE_URL`) to the **new** proxy URL

**Frontend behavior:** [`JobStatus.tsx`](frontend/src/components/JobStatus.tsx) keeps polling through transient network/524 failures (with backoff and an amber warning); only **HTTP 404** on status stops polling (job record missing). Status requests use a **15s** axios timeout ([`frontend/src/api/jobs.ts`](frontend/src/api/jobs.ts)) so failures fail fast instead of waiting for Cloudflare’s ~100s 524.

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

Deploys automatically from the GitHub repository. `frontend/vercel.json` ships with an **SPA fallback rewrite** (all non-`/api`, non-`/static`, non-`/assets` paths → `index.html`) so deep links like `/projects/1` work with client-side routing. **`VITE_API_BASE_URL`** (build-time) should be the RunPod HTTPS origin with no trailing slash, **or** leave it unset and add **`/api` → RunPod** rewrites in `frontend/vercel.json` (see `frontend/vercel.rewrites.example.json`, which includes the API, `/static`, and SPA-fallback rules in the correct order) so the browser uses same-origin `/api/...`. All documented **`VITE_*`** keys live in **`frontend/.env.example`**. If the splat viewer hangs on **“Loading Gaussian Splats…”**, follow the **`[Babylon] phase:`** console logs (see **3D viewer troubleshooting** above).

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
