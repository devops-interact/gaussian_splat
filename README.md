# Gaussian Splatting Room Reconstruction

A production web application that converts video footage of rooms into interactive 3D point cloud models using **LongSplat** - NVIDIA's state-of-the-art technology for unposed 3D Gaussian Splatting reconstruction.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Vercel)                               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ VideoUpload │  │  JobStatus   │  │  Viewer3D   │  │  Quality Presets │  │
│  │ - Presets   │  │  - Progress  │  │  - PLY Load │  │  - Fast/Balanced │  │
│  │ - Validate  │  │  - Errors    │  │  - SH→RGB   │  │  - Quality       │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └────────┬─────────┘  │
│         │                │                 │                   │            │
│         └────────────────┴─────────────────┴───────────────────┘            │
│                                    │                                         │
│                            VITE_API_BASE_URL                                 │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                     │ HTTPS
┌────────────────────────────────────┼─────────────────────────────────────────┐
│                          BACKEND (RunPod GPU)                                │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                         FastAPI Server (:8000)                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │  │
│  │  │ /api/jobs/*  │  │ /api/presets │  │ /static/models/*.ply      │   │  │
│  │  │ Upload/Status│  │ Quality Info │  │ Generated 3D Models        │   │  │
│  │  └──────┬───────┘  └──────────────┘  └────────────────────────────┘   │  │
│  └─────────┼─────────────────────────────────────────────────────────────┘  │
│            │                                                                 │
│  ┌─────────▼─────────────────────────────────────────────────────────────┐  │
│  │                        Processing Pipeline                             │  │
│  │                                                                        │  │
│  │  ┌──────────────┐   ┌───────────────────────┐   ┌──────────────────┐  │  │
│  │  │ 1. Validate  │   │ 2. Extract Frames     │   │ 3. LongSplat     │  │  │
│  │  │ - Duration   │──▶│ - FFmpeg @ preset FPS │──▶│ - MASt3R Poses   │  │  │
│  │  │ - Resolution │   │ - JPG output          │   │ - 3DGS Training  │  │  │
│  │  │ - Format     │   └───────────────────────┘   │ - Point Cloud    │  │  │
│  │  └──────────────┘                               └────────┬─────────┘  │  │
│  │                                                          │            │  │
│  │  ┌──────────────┐   ┌───────────────────────┐           │            │  │
│  │  │ 5. Complete  │   │ 4. Export & Compress  │◀──────────┘            │  │
│  │  │ - model.ply  │◀──│ - PLY (31MB→25MB)     │                        │  │
│  │  │ - model.gz   │   │ - Gzip compression    │                        │  │
│  │  └──────────────┘   └───────────────────────┘                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         LongSplat Stack                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │  │
│  │  │   MASt3R    │  │   DUSt3R    │  │   CRoCo     │  │ 3DGS Kernels │  │  │
│  │  │ Pose Est.   │  │ Dense 3D    │  │ Cross-Attn  │  │ CUDA Render  │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Storage: /app/storage (RunPod Volume 150GB)                                 │
│  ├── uploads/    (videos)                                                    │
│  ├── frames/     (extracted JPGs)                                            │
│  ├── models/     (PLY outputs)                                               │
│  └── logs/       (app.log)                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Recent Progress (January 2026)

### Working Features
- **Video Upload** with quality preset selection (Fast/Balanced/Quality)
- **Video Validation** - checks duration, resolution, format before processing
- **Frame Extraction** using FFmpeg at configurable FPS
- **LongSplat Training** with MASt3R for automatic pose estimation (no COLMAP needed!)
- **PLY Export** with gzip compression (17% size reduction)
- **3D Viewer** parsing binary Gaussian Splatting PLY with spherical harmonics color

### Quality Presets

| Preset | FPS | Iterations | Est. Time | Use Case |
|--------|-----|------------|-----------|----------|
| **Fast** | 1.0 | 2,000 | 3-5 min | Quick preview, testing |
| **Balanced** | 2.0 | 5,000 | 8-12 min | Most videos |
| **Quality** | 3.0 | 12,000 | 20-30 min | Final production |

### Key Technical Details

**PLY Format (Gaussian Splatting):**
- Binary little-endian format
- ~62 properties per vertex including:
  - Position (x, y, z)
  - Normals (nx, ny, nz)
  - Spherical Harmonics DC (f_dc_0, f_dc_1, f_dc_2) → RGB color
  - 45 additional SH coefficients (f_rest_0 to f_rest_44)
  - Opacity (sigmoid-activated)
  - Scale (scale_0, scale_1, scale_2)
  - Rotation quaternion (rot_0-3)

**Color Conversion:**
```
RGB = SH_C0 × f_dc + 0.5
where SH_C0 = 0.28209479177387814
```

---

## Quick Start

### 1. Build & Push Docker Image

```bash
# Prune and rebuild
docker system prune -af && docker builder prune -af
./build-and-push.sh
```

### 2. Deploy to RunPod

| Setting | Value |
|---------|-------|
| Container Image | `interactdevops/gaussian-room-reconstruction:latest` |
| **GPU Type** | **A40 (48GB VRAM) ⭐ Required** |
| Container Disk | 20 GB |
| Volume Disk | 150 GB |
| Volume Mount Path | `/app/storage` |
| Expose HTTP Ports | `8000` |

> **Note:** This image is compiled specifically for NVIDIA A40 (sm_86). Other GPUs will not work.

### 3. Configure Frontend (Vercel)

Set environment variable:
```
VITE_API_BASE_URL=https://your-pod-id-8000.proxy.runpod.net
```

Vercel Project Settings:
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

### 4. Test

```bash
# Backend health check
curl https://your-pod-8000.proxy.runpod.net/health
# Expected: {"status": "healthy"}

# Get presets
curl https://your-pod-8000.proxy.runpod.net/api/presets
```

---

## Tech Stack

### Frontend
- **React 18** + TypeScript
- **Vite** build tool
- **Three.js** + @react-three/fiber for 3D visualization
- Custom binary PLY parser with SH→RGB color conversion

### Backend
- **Python 3.10** + FastAPI
- **PyTorch 2.1.0** (CUDA 12.1)
- **LongSplat** (NVIDIA) - unposed 3D Gaussian Splatting
  - **MASt3R** - automatic pose estimation
  - **DUSt3R** - dense 3D reconstruction
  - **CRoCo** - cross-attention features
- **FFmpeg** - video frame extraction
- Custom CUDA kernels for Gaussian rasterization

### Infrastructure
- **Docker** (multi-stage build, ~15GB image)
- **RunPod** GPU cloud (**A40 required**, 48GB VRAM, sm_86)
- **Vercel** frontend hosting
- **Docker Hub** container registry

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, validation info |
| `GET` | `/api/jobs/{id}/model` | Download PLY |
| `GET` | `/api/jobs/{id}/model?compressed=true` | Download compressed PLY.gz |

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
  "model_url_compressed": "/static/models/uuid.ply.gz"
}
```

**Status Flow:**
`uploaded` → `validating` → `extracting_frames` → `training` → `exporting` → `compressing` → `completed`

---

## Video Recording Best Practices

- **Duration:** 20-60 seconds optimal
- **Resolution:** 1080p minimum
- **Movement:** Slow, steady walk around room
- **Lighting:** Well-lit, consistent
- **Coverage:** Multiple angles, overlap between frames
- **Avoid:** Fast motion, blur, reflective surfaces

---

## Troubleshooting

### Empty 3D Preview
- PLY file generated but viewer shows nothing
- **Fixed:** Updated viewer to parse binary GS PLY with SH color conversion

### "Address already in use" Error
- Multiple jobs competing for same network port
- **Fixed:** Each job uses unique port based on job ID hash

### Long Training Times
- 78 frames × 5000 iterations ≈ 60 minutes
- **Solution:** Use "Fast" preset or shorter video

### COLMAP Errors (Legacy)
- Old pipeline used COLMAP for pose estimation
- **Fixed:** Replaced with LongSplat's internal MASt3R

---

## Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/jobs.py           # Upload, status, download endpoints
│   ├── core/
│   │   ├── config.py         # Quality presets, settings
│   │   ├── models.py         # Pydantic models
│   │   └── pipeline.py       # Processing orchestration
│   ├── services/
│   │   ├── longsplat/train.py   # LongSplat training wrapper
│   │   ├── video/
│   │   │   ├── extract_frames.py
│   │   │   └── validate.py      # Video validation
│   │   └── export/
│   │       ├── to_ply.py
│   │       └── compress.py      # Gzip compression
│   └── main.py               # FastAPI app
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoUpload.tsx   # Preset selector, validation
│   │   │   ├── JobStatus.tsx     # Progress, download buttons
│   │   │   └── Viewer3D.tsx      # Binary PLY parser, 3D render
│   │   └── api/jobs.ts           # API client
│   └── package.json
├── Dockerfile                # Multi-stage GPU build
├── build-and-push.sh         # Automated build script
└── README.md
```

---

## Resources

- [LongSplat Paper](https://linjohnss.github.io/longsplat/)
- [LongSplat GitHub](https://github.com/NVlabs/LongSplat)
- [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
- [MASt3R](https://github.com/naver/mast3r)
- [RunPod Documentation](https://docs.runpod.io/)

---

## License

MIT License - Research use. LongSplat components under NVIDIA license.
