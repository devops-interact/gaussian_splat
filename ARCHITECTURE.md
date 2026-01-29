# Gaussian Room Reconstruction - Architecture Summary

## Overview

A web application that converts video footage of rooms into interactive 3D point cloud models using **LongSplat** (NVIDIA's unposed 3D Gaussian Splatting).

---

## System Architecture

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

## Tech Stack

### Frontend (Vercel)
| Technology | Purpose |
|------------|---------|
| React 18 + TypeScript | UI Framework |
| Vite | Build tool |
| Three.js (@react-three/fiber) | 3D visualization |
| Custom PLY Parser | Binary GS format + SH→RGB |

### Backend (RunPod GPU)
| Technology | Purpose |
|------------|---------|
| Python 3.10 | Runtime |
| FastAPI | Async API server |
| PyTorch 2.1.0 (CUDA 12.1) | Deep learning |
| FFmpeg | Video frame extraction |
| LongSplat | 3D Gaussian Splatting |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Frontend Hosting | Vercel |
| Backend/GPU | RunPod (A40/RTX 4090/A100/H100) |
| Container | Docker (~15GB image) |
| Registry | Docker Hub |
| Storage | RunPod Volume (150GB) |

### Supported GPUs
| GPU | VRAM | Architecture | Compute Capability | Recommended For |
|-----|------|--------------|-------------------|-----------------|
| A100 | 40/80 GB | Ampere | sm_80 | Large jobs, production |
| **A40** | **48 GB** | Ampere | sm_86 | **Best value, recommended** |
| RTX 4090 | 24 GB | Ada Lovelace | sm_89 | Fast, smaller jobs |
| H100 | 80 GB | Hopper | sm_90 | Overkill for most |

---

## Quality Presets

| Preset | FPS | Iterations | Est. Time | Use Case |
|--------|-----|------------|-----------|----------|
| **Fast** | 1.0 | 2,000 | 3-5 min | Quick preview, testing |
| **Balanced** | 2.0 | 5,000 | 8-12 min | Most videos |
| **Quality** | 3.0 | 12,000 | 20-30 min | Final production |

---

## Data Flow

```
Video (MP4) → Frames (JPG @ FPS) → LongSplat → PLY (31MB) → Gzip (25MB) → 3D Viewer
```

---

## PLY Output Format

Gaussian Splatting outputs binary PLY with ~62 properties per vertex:

| Property | Description |
|----------|-------------|
| x, y, z | Position |
| nx, ny, nz | Normals |
| f_dc_0, f_dc_1, f_dc_2 | Spherical Harmonics DC (color) |
| f_rest_0 to f_rest_44 | Additional SH coefficients |
| opacity | Transparency (sigmoid-activated) |
| scale_0, scale_1, scale_2 | Gaussian scale |
| rot_0, rot_1, rot_2, rot_3 | Rotation quaternion |

**Color Conversion:**
```
RGB = SH_C0 × f_dc + 0.5
where SH_C0 = 0.28209479177387814
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, validation info |
| `GET` | `/api/jobs/{id}/model` | Download PLY |
| `GET` | `/api/jobs/{id}/model?compressed=true` | Download compressed PLY.gz |

---

## MASt3R vs COLMAP Comparison

### Overview

| Aspect | **COLMAP** | **MASt3R** |
|--------|-----------|------------|
| **Type** | Traditional Structure-from-Motion (SfM) | Deep Learning-based |
| **Pose Estimation** | Feature matching + bundle adjustment | Neural network inference |
| **Input Requirements** | Requires good feature overlap, texture | More robust to challenging scenes |
| **Speed** | Slow (minutes to hours) | Fast (seconds to minutes) |
| **GPU Dependency** | Optional (CPU works, GPU helps) | Requires GPU |
| **Installation** | Complex (Qt dependencies, GUI issues) | Python package + model weights |

### Why This Project Uses MASt3R (via LongSplat)

**COLMAP Problems Encountered:**
1. **GUI Dependencies** - Crashed with `qt.qpa.xcb: could not connect to display` in headless Docker
2. **Environment Issues** - Even with `QT_QPA_PLATFORM=offscreen`, feature extraction failed
3. **Complexity** - Required separate steps: feature extraction → matching → mapping
4. **Fragility** - Failed on videos with insufficient texture or motion blur

**MASt3R Advantages:**
1. **Headless-friendly** - Pure Python/PyTorch, no GUI dependencies
2. **Integrated** - LongSplat bundles MASt3R internally, single command
3. **Robust** - Trained on diverse data, handles casual video better
4. **End-to-end** - Pose estimation + 3D reconstruction in one pipeline

### Pipeline Comparison

**COLMAP Pipeline (legacy):**
```
Frames → Feature Extraction → Feature Matching → Bundle Adjustment → Sparse Points → Poses
```

**MASt3R Pipeline (current):**
```
Frames → Neural Network → Dense Matching → Camera Poses + 3D Points
```

### MASt3R Technical Details

- Based on **DUSt3R** (Dense Unconstrained Stereo 3D Reconstruction)
- Uses **CRoCo** (Cross-view Completion) pretrained features
- Outputs dense point maps + confidence + camera parameters
- Model checkpoint: `MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth` (2.6GB)

### Conclusion

MASt3R (through LongSplat) eliminated COLMAP headaches entirely. The tradeoff is a larger Docker image (includes 2.6GB model weights), but the reliability and ease of deployment far outweigh that cost.

---

## Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/jobs.py              # Upload, status, download endpoints
│   ├── core/
│   │   ├── config.py            # Quality presets, settings
│   │   ├── models.py            # Pydantic models
│   │   └── pipeline.py          # Processing orchestration
│   ├── services/
│   │   ├── longsplat/train.py   # LongSplat training wrapper
│   │   ├── video/
│   │   │   ├── extract_frames.py
│   │   │   └── validate.py      # Video validation
│   │   └── export/
│   │       ├── to_ply.py
│   │       └── compress.py      # Gzip compression
│   └── main.py                  # FastAPI app
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoUpload.tsx  # Preset selector, validation
│   │   │   ├── JobStatus.tsx    # Progress, download buttons
│   │   │   └── Viewer3D.tsx     # Binary PLY parser, 3D render
│   │   └── api/jobs.ts          # API client
│   └── package.json
├── Dockerfile                   # Multi-stage GPU build
├── build-and-push.sh            # Automated build script
└── README.md
```

---

## Resources

- [LongSplat Paper](https://linjohnss.github.io/longsplat/)
- [LongSplat GitHub](https://github.com/NVlabs/LongSplat)
- [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
- [MASt3R GitHub](https://github.com/naver/mast3r)
- [RunPod Documentation](https://docs.runpod.io/)
