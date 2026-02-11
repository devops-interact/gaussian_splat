# Gaussian Splatting Room Reconstruction

A production web application that converts video footage of rooms into interactive 3D point cloud models and reconstructed meshes using **LongSplat** — NVIDIA's state-of-the-art unposed 3D Gaussian Splatting.

---

## Features

- **Video upload** with quality preset selection (Fast / Balanced / Quality)
- **LongSplat training** with MASt3R for automatic pose estimation (no COLMAP)
- **3D Viewer** — orbit, walk-through, measurement tool, snapshot capture
- **Points / Mesh toggle** — raw point cloud or Poisson-reconstructed GLB surface
- **Metadata panel** — point count, bounding box, color data, processing status
- **Downloads** — `.ply`, `.ply.gz`, `.glb` (mesh)

---

## Quick Start

### 1. Build & Push Docker Image

```bash
docker system prune -af && docker builder prune -af
./build-and-push.sh
```

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

### 3. Deploy Frontend to Vercel

Set environment variable:

```
VITE_API_BASE_URL=https://your-pod-id-8000.proxy.runpod.net
```

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

```
Video (MP4)
  → Validate (duration, resolution, format)
  → Extract Frames (FFmpeg @ preset FPS)
  → LongSplat Training (MASt3R poses + 3DGS optimization)
  → Export PLY + Gzip compress
  → Mesh Reconstruction (Poisson surface → GLB)
  → Complete
```

### Quality Presets

| Preset | FPS | Iterations | Est. Time | Use Case |
|---|---|---|---|---|
| **Fast** | 1.0 | 2,000 | 3-5 min | Quick preview |
| **Balanced** | 2.0 | 5,000 | 8-12 min | Recommended |
| **Quality** | 3.0 | 12,000 | 20-30 min | Production |

---

## Tech Stack

### Frontend (Vercel)

- **React 18** + TypeScript + Vite
- **Three.js** (`@react-three/fiber`, `@react-three/drei`) — 3D viewer
- **Tailwind CSS** — styling
- Custom binary PLY parser with SH→RGB and direct RGB priority

### Backend (RunPod GPU)

- **Python 3.10** + FastAPI
- **PyTorch 2.2.0** (CUDA 12.1)
- **LongSplat** — MASt3R pose estimation + 3DGS training
- **Open3D** — Poisson surface reconstruction
- **trimesh** — GLB mesh export
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
| `GET` | `/static/models/{id}.glb` | GLB mesh (static) |

### Job Status Response

```json
{
  "job_id": "uuid",
  "status": "training",
  "progress": 0.65,
  "quality_preset": "balanced",
  "estimated_minutes": 10,
  "validation": {
    "duration": 45.2,
    "resolution": "1920x1080",
    "fps": 30.0,
    "warnings": []
  },
  "model_url": "/static/models/uuid.ply",
  "model_url_compressed": "/static/models/uuid.ply.gz",
  "model_url_mesh": "/static/models/uuid.glb"
}
```

**Status flow:**
`uploaded` → `validating` → `extracting_frames` → `training` → `exporting` → `compressing` → `completed`

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
| `#060606` | Elevated surfaces |
| `#081717` | Cards, inputs |
| `#35c889` | Primary accent (green) |
| `#a4a4ff` | Secondary accent (lavender) |

---

## Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/jobs.py                          # Upload, status, download endpoints
│   ├── core/
│   │   ├── config.py                        # Quality presets, settings
│   │   ├── models.py                        # Pydantic models
│   │   └── pipeline.py                      # Processing orchestration (6 steps)
│   ├── services/
│   │   ├── longsplat/
│   │   │   ├── train.py                     # LongSplat training wrapper
│   │   │   └── longsplat_to_3dgs_converter.py
│   │   ├── video/
│   │   │   ├── extract_frames.py
│   │   │   └── validate.py
│   │   └── export/
│   │       ├── to_ply.py                    # PLY export + diagnostics
│   │       ├── to_mesh.py                   # Poisson surface → GLB
│   │       ├── to_obj.py                    # OBJ export (optional)
│   │       └── compress.py                  # Gzip compression
│   ├── main.py                              # FastAPI entry
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoUpload.tsx              # Preset selector, file upload
│   │   │   ├── JobStatus.tsx                # Progress bar, status
│   │   │   ├── Viewer3D.tsx                 # PLY/GLB 3D viewer + tools
│   │   │   ├── TechnicalDetails.tsx         # Metadata panel
│   │   │   ├── layout/dashboard-layout.tsx
│   │   │   └── ui/{button,card}.tsx
│   │   ├── pages/Home.tsx                   # Main page layout
│   │   ├── types/job.ts
│   │   ├── api/jobs.ts
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
| Long training times | Use "Fast" preset or shorter video (< 30 s) |
| Stale frontend after deploy | Hard-refresh (`Ctrl+Shift+R`) or redeploy on Vercel |
| Training fails immediately | Check GPU availability, PYTHONPATH, frame count (30+) |
| No PLY generated | Check `/app/storage/models/{job_id}/` and training logs |
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
