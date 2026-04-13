# Gaussian Splatting Room Reconstruction

A production web application that converts video footage of rooms into interactive 3D point cloud models and reconstructed meshes using **LongSplat** — NVIDIA's state-of-the-art unposed 3D Gaussian Splatting.

---

## Features

- **Video upload** with quality preset selection (**Balanced** / **Quality**)
- **LongSplat training** with MASt3R for automatic pose estimation (no COLMAP)
- **3D Viewer** — orbit, walk-through, measurement tool, snapshot capture
- **Gaussian splats + optional mesh** — primary view is the splat PLY; optional **OBJ** mesh download when the API exposes `model_url_obj` (`EXPORT_OBJ=true` on the pod)
- **Metadata panel** — point count, bounding box, color data, processing status
- **Downloads** — `.ply`, `.ply.gz`, optional `.obj` (mesh, when enabled)

---

## Quick Start

### 1. Build & Push Docker Image

```bash
docker system prune -af && docker builder prune -af
./build-and-push.sh
```

The script runs **`npm run build`** and **`npm test`** in `frontend/`, checks COOP/COEP/CORP headers, **`frontend/.env.example`**, the **`initial_camera`** API wiring, viewer + **`src/lib/splatPick.ts`** sources (existence + `@mkkellogg/gaussian-splats-3d` in `package.json`), and required LongSplat/backend files before Docker buildx push. Vercel-facing **`VITE_*`** variables are listed in **§ 3** and in [`frontend/.env.example`](frontend/.env.example).

### 2. Deploy Backend to RunPod

| Setting | Value |
|---|---|
| Container Image | `interactdevops/gaussian-room-reconstruction:latest` |
| **GPU Type** | **A40 (48 GB VRAM) — required** |
| Container Disk | 20 GB |
| Volume Disk | 150 GB |
| Volume Mount Path | `/app/storage` |
| Expose HTTP Ports | `8000` |

> Build is compiled for NVIDIA A40 (`sm_86`). Other GPUs are not supported.

**Long jobs — persistence and uptime:** Job state is persisted to `storage/logs/jobs.json` (and models under `storage/models/`). The volume mount at **`/app/storage`** must stay attached so a **restart or replacement pod** does not lose job rows (otherwise `GET /api/jobs/{id}/status` returns **404 Job not found** even though training finished on disk elsewhere). Configure RunPod so the instance stays **reachable for the whole preset duration** (aggressive idle stop or changing proxy URLs mid-job produces **404** or empty responses while the UI is still polling).

### 3. Deploy Frontend to Vercel

The SPA must reach your RunPod API over HTTPS. Pick **one** of these patterns:

| Approach | What to do |
|---|---|
| **A. Explicit API URL (simplest)** | In Vercel → Settings → Environment Variables → **Production**, set `VITE_API_BASE_URL` to your RunPod HTTPS origin with **no trailing slash**, e.g. `https://your-pod-id-8000.proxy.runpod.net`. Rebuild the project after changing env vars (Vite bakes this in at build time). |
| **B. Same-origin `/api` proxy** | Leave `VITE_API_BASE_URL` **unset** for Production. The app then calls relative URLs like `/api/projects`. Merge the **`rewrites`** block from [`frontend/vercel.rewrites.example.json`](frontend/vercel.rewrites.example.json) into [`frontend/vercel.json`](frontend/vercel.json) (same JSON object as the existing `headers` array), replacing `YOUR_RUNPOD_ORIGIN` with your HTTPS origin (no trailing slash). |
| **C. Viewer hangs on load (optional)** | In Vercel → **Environment Variables** → **Production**, add **`VITE_GS3D_FORCE_LEGACY_WORKERS`** with value **`true`** or **`1`**, then **redeploy**. This forces GaussianSplats3D to use CPU splat sort and non–shared-memory workers (see [`ARCHITECTURE.md`](ARCHITECTURE.md) § 3D viewer troubleshooting). Same line in `frontend/.env` or **`frontend/.env.local`** for local dev — see [`frontend/.env.example`](frontend/.env.example). |

If Production is built **without** `VITE_API_BASE_URL` and **without** rewrites, the browser will request `/api/...` on the Vercel domain only — those routes will 404 unless you add rewrites or a serverless proxy.

Example env (approach A); add the second line only if the splat viewer hangs on load:

```
VITE_API_BASE_URL=https://your-pod-id-8000.proxy.runpod.net
VITE_GS3D_FORCE_LEGACY_WORKERS=true
```

See [`frontend/.env.example`](frontend/.env.example) for all documented `VITE_*` keys.

Vercel project settings:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### 4. Verify

```bash
curl https://your-pod-8000.proxy.runpod.net/health
# {"status": "healthy"}
```

---

## Processing Pipeline

Orchestrated in [`backend/core/pipeline.py`](backend/core/pipeline.py) (see [`ARCHITECTURE.md`](ARCHITECTURE.md) for step timings and PLY details):

```
Video (MP4)
  → Validate (upload / preset limits)
  → Extract frames (FFmpeg @ preset FPS → JPGs)
  → LongSplat training (MASt3R poses + joint 3DGS optimization; internal Scaffold→3DGS conversion + postprocess in train stack)
  → Export PLY (web-ready `model.ply` path)
  → Optional gzip of PLY for static `.ply.gz`
  → Optional OBJ mesh (Poisson / trimesh path when EXPORT_OBJ=true)
  → Complete — viewer loads PLY via GET /api/jobs/{id}/model; optional GET /api/jobs/{id}/initial_camera for first-frame pose
```

### Quality Presets

Defined in `backend/core/config.py` (`QUALITY_PRESETS`). Sub-iterations and `convert_3dgs` steps scale in `backend/services/longsplat/train.py`.

| Preset | FPS | LongSplat iterations | Est. time | Use case |
|---|---|---|---|---|
| **Balanced** | 1.5 | 12,000 | ~35 min (typ.; long clips longer) | Default quality; **convert_3dgs** cap **6.5k** iters |
| **Quality** | 2.0 | 24,000 | ~70 min (often **1h+**) | Highest fidelity; **convert_3dgs** up to **10k** iters |

Wall time is **main `train.py` + second GPU phase `convert_3dgs.py`** (Scaffold→3DGS SH), then CPU PLY conversion—see [`ARCHITECTURE.md`](ARCHITECTURE.md) Quality Presets and server logs `[LongSplat timing]`.

### 3D viewer (GaussianSplats3D)

The scan viewer uses [`@mkkellogg/gaussian-splats-3d`](https://github.com/mkkellogg/GaussianSplats3D). The **Display** panel (bottom-right) exposes **min alpha** (reloads the splat scene), **SH level** 0/1/2, **splat scale**, and optional **Download .ksplat** in the browser (same idea as the [official demo / converter](https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php)). For batch conversion without the app, clone GaussianSplats3D and run `node util/create-ksplat.js` (not included in the npm package). Jobs still export **PLY**; `.ksplat` is optional for faster reloads elsewhere.

If the viewer stays on **“Loading Gaussian Splats…”**, set **`VITE_GS3D_FORCE_LEGACY_WORKERS=true`** in Vercel env (or `frontend/.env.local` locally), redeploy / restart dev, and check **`[GS3D] phase:`** logs in the browser console — details in [`ARCHITECTURE.md`](ARCHITECTURE.md).

If the room looks **upside-down** with pose-based framing, or orbit feels **choppy** while legacy workers are on, or you see **`lockdown-install.js` / SES** `DOMException` spam, see **§ 3D viewer troubleshooting** items **7–9** in [`ARCHITECTURE.md`](ARCHITECTURE.md) (camera up for `initial_camera`, legacy-worker tradeoff, MetaMask / extensions).

If **Measure** clicks still feel misaligned, open the console once per measure session and read **`[Pick:dims]`**: it logs **`physical`** (canvas backing store), **`gs3dReported`**, and **`pickUsing=canvas|gs3d (WxH)`** — when the library’s internal render size differs from the canvas, picks intentionally use **`getRenderDimensions`** for both **`renderDims`** and mouse scaling. Picking uses [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) (GS3D raycast + world-space center cache after each **SplatTree** build). See **ARCHITECTURE.md** §3D Viewer — splat picking.

---

## Tech Stack

### Frontend (Vercel)

- **React 18** + TypeScript + Vite
- **Three.js** + **GaussianSplats3D** — splat viewer (orbit / walk / measure); optional OBJ mesh download from API
- **Tailwind CSS** — styling
- Custom binary PLY parser with SH→RGB and direct RGB priority

### Backend (RunPod GPU)

- **Python 3.10** + FastAPI
- **PyTorch 2.2.0** (CUDA 12.1)
- **LongSplat** — MASt3R pose estimation + 3DGS training
- **Open3D** — Poisson surface reconstruction
- **trimesh** — optional mesh export (OBJ when `EXPORT_OBJ=true`)
- **FFmpeg** — video frame extraction

### Infrastructure

- **Docker** — multi-stage build, linux/amd64 (~15 GB image)
- **RunPod** — A40 GPU cloud
- **Vercel** — frontend hosting (auto-deploys from GitHub)
- **Docker Hub** — container registry

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, model URLs |
| `GET` | `/api/jobs/{id}/model` | Download PLY (CORP-safe for COEP pages) |
| `GET` | `/api/jobs/{id}/model?compressed=true` | Download compressed PLY.gz |
| `GET` | `/api/jobs/{id}/initial_camera` | Optional pose hint (`position` / `target`) for viewer first frame |
| `GET` | `/api/jobs/{id}/cameras` | Optional `cameras_all.json` from training |
| `GET` | `/static/models/{id}/*.obj` | OBJ mesh when `EXPORT_OBJ=true` and export succeeded |

### Job Status Response

```json
{
  "job_id": "uuid",
  "status": "training",
  "progress": 0.65,
  "quality_preset": "balanced",
  "estimated_minutes": 35,
  "validation": {
    "duration": 45.2,
    "resolution": "1920x1080",
    "fps": 30.0,
    "warnings": []
  },
  "model_url": "/api/jobs/uuid/model",
  "model_url_compressed": "/static/models/uuid.ply.gz",
  "model_url_obj": "/static/models/uuid/uuid.obj"
}
```

**Status flow:** `uploaded` → `validating` → `extracting_frames` → `training` → `exporting` → `compressing` → `completed` (or `error`). Optional OBJ export runs in the final stages when `EXPORT_OBJ=true`.

---

## Video Recording Tips

- **Duration:** 20–60 seconds optimal
- **Resolution:** 1080p minimum
- **Movement:** Slow, steady walk around the room
- **Lighting:** Well-lit, consistent
- **Coverage:** Multiple angles with frame overlap
- **Avoid:** Fast motion, blur, reflective surfaces

---

## UI Color Scheme

| Hex | Role |
|---|---|
| `#000000` | Base background |
| `#08080f` | Elevated surfaces |
| `#121008` | Cards, inputs |
| `#efe752` | Primary accent (chartreuse) |
| `#f5ec99` | Secondary accent (soft yellow) |

---

## Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/jobs.py                          # Upload, status, download endpoints
│   ├── core/
│   │   ├── config.py                        # Quality presets, settings
│   │   ├── models.py                        # Pydantic models
│   │   └── pipeline.py                      # Job orchestration (frames → train → PLY → gzip → optional OBJ)
│   ├── services/
│   │   ├── viewer_initial_camera.py         # initial_camera JSON for Viewer3D
│   │   ├── longsplat/
│   │   │   ├── train.py                     # LongSplat training wrapper
│   │   │   ├── postprocess.py
│   │   │   └── longsplat_to_3dgs_converter.py
│   │   ├── video/
│   │   │   ├── extract_frames.py
│   │   │   └── validate.py
│   │   └── export/
│   │       ├── to_ply.py                    # PLY export + diagnostics
│   │       ├── to_mesh.py                   # Poisson → GLB (utility; not wired in default pipeline)
│   │       ├── to_obj.py                    # OBJ export (optional)
│   │       └── compress.py                  # Gzip compression
│   ├── main.py                              # FastAPI entry
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   └── splatPick.ts                 # Measure picks: GS3D ray + dims/center cache
│   │   ├── components/
│   │   │   ├── VideoUpload.tsx              # Preset selector, file upload
│   │   │   ├── JobStatus.tsx                # Progress bar, status
│   │   │   ├── Viewer3D.tsx                 # GaussianSplats3D PLY viewer + measure / walk
│   │   │   ├── TechnicalDetails.tsx         # Metadata panel
│   │   │   ├── layout/dashboard-layout.tsx
│   │   │   └── ui/{button,card}.tsx
│   │   ├── pages/Home.tsx                   # Main page layout
│   │   ├── types/job.ts
│   │   ├── api/jobs.ts                      # initial_camera + model URLs
│   │   └── index.css
│   ├── tailwind.config.ts
│   └── package.json
├── Dockerfile                               # Multi-stage GPU build
├── build-and-push.sh                        # Automated build & push
├── ARCHITECTURE.md                          # Detailed architecture reference
├── LongSplat_README.md                      # LongSplat integration details
└── README.md
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Long training times | Use **Balanced** preset, shorter clip, or lower FPS (fewer frames) |
| Stale frontend after deploy | Hard-refresh (`Ctrl+Shift+R`) or redeploy on Vercel |
| Training fails immediately | Check GPU availability, PYTHONPATH, frame count (30+) |
| No PLY generated | Check `/app/storage/models/{job_id}/` and training logs |
| Measure picks miss / offset | See [`ARCHITECTURE.md`](ARCHITECTURE.md) splat picking; check **`[Pick:dims]`** (`pickUsing`, `gs3dReported` vs `physical`); ensure SPA/backend commit matches after viewer changes |
| Open3D build error | Expected under QEMU — works at runtime on real A40 hardware |

---

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — detailed system architecture, dependency matrix, deployment config, performance expectations
- **[LongSplat_README.md](./LongSplat_README.md)** — LongSplat integration, build configuration, training optimization

---

## Resources

- [LongSplat Paper](https://linjohnss.github.io/longsplat/)
- [LongSplat GitHub](https://github.com/NVlabs/LongSplat)
- [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
- [MASt3R](https://github.com/naver/mast3r)
- [RunPod Documentation](https://docs.runpod.io/)

---

## License

MIT License — Research use. LongSplat components under NVIDIA license.
