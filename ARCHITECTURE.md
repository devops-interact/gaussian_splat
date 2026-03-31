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
| Three.js (`@react-three/fiber`, `@react-three/drei`) | 3D visualization (points + GLB mesh) |
| `@mkkellogg/gaussian-splats-3d` | 3DGS React component and core renderer |
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
| LongSplat Training | 10-60 min | `model.ply` in models dir |
| Scaffold Conversion & Post-Process | 1-2 min | Converted and centered `model.ply` |
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

| Preset | FPS | LongSplat iterations | `convert_3dgs` prune ratio | Est. time | Use case |
|---|---|---|---|---|---|
| **Balanced** | 1.5 | 12,000 | 0.62 | ~20 min | Default previews |
| **Quality** | 2.0 | 20,000 | 0.68 | ~38 min | Higher fidelity |

Higher **prune ratio** keeps more Gaussians after Scaffold-GS → 3DGS conversion (less aggressive pruning). Tuning is per preset without code changes beyond `PresetConfig`.

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

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, model_url, model_url_mesh |
| `GET` | `/api/jobs/{id}/model` | Download PLY |
| `GET` | `/api/jobs/{id}/model?compressed=true` | Download compressed PLY.gz |
| `GET` | `/static/models/{id}.glb` | GLB mesh (static file) |

---

## Frontend Features

### 3D Viewer (`Viewer3D.tsx`)

- **Splat picking** — measurement clicks use `@mkkellogg/gaussian-splats-3d`’s built-in splat raycaster (`setFromCameraAndScreenPosition` + `intersectSplatMesh`), not [`THREE.Raycaster`](https://threejs.org/docs/#Raycaster). Core three.js raycasting targets meshes/lines/points; Gaussian splats need the library’s specialized intersection. Pointer position is mapped from `canvas.getBoundingClientRect()` into the same dimensions returned by `getRenderDimensions` (root `offsetWidth` / `offsetHeight`) so the ray matches the rendered viewport when layout differs. Ellipsoid-accurate tests are enabled (`raycastAgainstTrueSplatEllipsoid`). Hits are sorted by distance; the app accepts the closest hit within a bounding-box–scaled max distance. Reconstructions from LongSplat / MASt3R have no inherent metric scale and may carry pose noise—real-world distances rely on the viewer’s **calibration step**, not the raycaster alone.
- **Orbit mode** — rotate, pan, zoom with OrbitControls
- **Walk-through mode** — first-person WASD + mouse-look via pointer lock
- **Measurement tool** — click two points (A = lavender, B = green), displays distance
- **Points / Mesh toggle** — switch between raw point cloud and reconstructed GLB surface
- **Snapshot** — capture current view as PNG
- **Adaptive point size** — auto-calculated from bounding sphere, with manual +/- controls
- **Gizmo** — axis indicator (bottom-right)
- **Rendering (flicker / sparkles)** — `sphericalHarmonicsDegree: 1` when PLY includes `f_rest_*` (better view-dependent color than DC-only). `gpuAcceleratedSort: true` for depth-sort stability; `splatAlphaRemovalThreshold: 8` trims very transparent splats. Frontend-only: does not change the PLY produced by the backend.

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
| `#0d0b1a` | Card backgrounds, form inputs, purple-tinted dark |
| `#7c3aed` | Primary accent (brand purple) |
| `#a78bfa` | Secondary accent (soft lavender) |

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

Deploys automatically from the GitHub repository. Environment variable `VITE_API_BASE_URL` points to the RunPod pod proxy URL.

---

## Performance Expectations (A40 48GB)

| Video Length | Training Time | GPU Memory |
|---|---|---|
| 30 s | ~10-15 min | 12-20 GB |
| 60 s | ~20-30 min | 15-25 GB |
| 120 s | ~40-60 min | 20-35 GB |

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
