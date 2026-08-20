# AI Room Reconstruction

Web app that converts room walkthrough videos into interactive **3D meshes (GLB)** via the **Meshy** image-to-3D API. Hosted on **Railway** (API + frontend services).

See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/RAILWAY-RUNBOOK.md`](docs/RAILWAY-RUNBOOK.md) for full details.

---

## Features

- **Video upload** with quality presets (**Fast** / **Balanced** / **Quality**)
- **Meshy AI reconstruction** from auto-selected keyframes (~5–12 min)
- **3D Viewer** — orbit, walk-through, measurement, WebXR, snapshot
- **Downloads** — GLB, optional OBJ

---

## Quick Start (Railway)

### 1. Build locally (optional)

```bash
./build-and-push.sh          # API image
./build-and-push.sh frontend # Web image
```

### 2. Deploy API service

```bash
railway up --service api
```

Set env vars: `MESHY_API_KEY`, `STORAGE_PUBLIC_BASE_URL` (api public URL), `JWT_SECRET_KEY`.  
Mount volume at `/app/backend/storage`.

Config: [`railway.toml`](railway.toml) → [`Dockerfile.railway`](Dockerfile.railway)

### 3. Deploy frontend (web) service

Set on **web** service:

```
BACKEND_URL=https://your-api.up.railway.app
```

```bash
railway up --service web -c railway.frontend.toml
```

Config: [`railway.frontend.toml`](railway.frontend.toml) → [`Dockerfile.frontend.railway`](Dockerfile.frontend.railway)

The SPA calls same-origin `/api/...`; nginx proxies to the API service.

### 4. Verify

```bash
curl https://your-api.up.railway.app/health
# {"status":"healthy"}

open https://your-web.up.railway.app
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
| **Quality** | 1.0 | 24,000 | ~70 min (often **1h+**) | Highest fidelity; **convert_3dgs** up to **10k** iters; **1.0 FPS** |

Wall time is **main `train.py` + second GPU phase `convert_3dgs.py`** (Scaffold→3DGS SH), then CPU PLY conversion—see [`ARCHITECTURE.md`](ARCHITECTURE.md) Quality Presets and server logs `[LongSplat timing]`.

### 3D viewer (Babylon.js)

The scan viewer uses [Babylon.js](https://github.com/BabylonJS/Babylon.js) native Gaussian splatting (`GaussianSplattingMesh` + SPLAT loader). The **Display** panel (bottom-right) exposes **min alpha** (live filter on in-memory splat data), **SH level** 0/1/2 when the model has spherical harmonics, and **Download .splat** (exports the Babylon in-memory splat buffer). Jobs still export **PLY** from the backend.

If the viewer stays on **“Loading Gaussian Splats…”**, check **`[Babylon] phase:`** logs in the browser console — details in [`ARCHITECTURE.md`](ARCHITECTURE.md).

If the room looks **upside-down** with pose-based framing, see **§ 3D viewer troubleshooting** in [`ARCHITECTURE.md`](ARCHITECTURE.md) (camera up for `initial_camera`).

**Measure** mode snaps to splat world centers via [`frontend/src/lib/splatPick.ts`](frontend/src/lib/splatPick.ts) (cone pick over a center cache built from `splatsData`). See **ARCHITECTURE.md** §3D Viewer — splat picking.

**Orbit zoom feels capped:** the viewer sets the `ArcRotateCamera` **`lowerRadiusLimit` / `upperRadiusLimit`** from the PLY bbox diagonal (after optional scene scale). If you want the room **visually larger** in the same units, set **`VITE_VIEWER_SCENE_SCALE`** (e.g. `2`) in **`frontend/.env.local`** or Vercel Production, then rebuild — see [`frontend/.env.example`](frontend/.env.example). Calibration still maps to meters because measure picks live in the same scaled space.

---

## Tech Stack

### Frontend (Vercel)

- **React 18** + TypeScript + Vite
- **Babylon.js** (`@babylonjs/core`, `@babylonjs/loaders`) — native Gaussian splat viewer (orbit / walk / measure); optional OBJ mesh download from API
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
| `GET` | `/api/jobs/{id}/model` | Download PLY |
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
│   │   │   └── splatPick.ts                 # Measure picks: cone pick on splatsData center cache
│   │   ├── components/
│   │   │   ├── VideoUpload.tsx              # Preset selector, file upload
│   │   │   ├── JobStatus.tsx                # Progress bar, status
│   │   │   ├── Viewer3D.tsx                 # Babylon.js PLY splat viewer + measure / walk
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
| Measure picks miss / offset | See [`ARCHITECTURE.md`](ARCHITECTURE.md) splat picking; check **`[Pick:dims]`** console logs (canvas backing-store vs. CSS pixels); ensure SPA/backend commit matches after viewer changes |
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
