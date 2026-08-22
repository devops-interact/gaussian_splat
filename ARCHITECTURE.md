# MESH-UP — Architecture

## Overview

Web app that converts room walkthrough videos into interactive **textured 3D meshes (GLB)** using the **Meshy Multi-Image-to-3D API**. Hosted entirely on **Railway** (two services: API + frontend).

## Railway services

```
┌─────────────────────────┐     proxy /api, /static      ┌──────────────────────────┐
│  web (frontend)         │ ────────────────────────────▶│  api (backend)           │
│  nginx + React SPA      │     BACKEND_URL env var      │  FastAPI + FFmpeg + Meshy│
│  Dockerfile.frontend.railway │                              │  Dockerfile.railway      │
└─────────────────────────┘                              └──────────────────────────┘
         ▲                                                           │
         │ user browser                                              │ Meshy API
         └───────────────────────────────────────────────────────────┘
```

| Service | Dockerfile | Config |
|---|---|---|
| **api** | `Dockerfile.railway` | `railway.toml` |
| **web** | `Dockerfile.frontend.railway` | `railway.frontend.toml` |

The frontend uses **same-origin** `/api/...` calls; nginx proxies to the API service (no Vercel, no CORS setup needed).

## Pipeline modes

### Single-object (fast / balanced / quality)

```
Video upload → validate → FFmpeg keyframes → select 4 best frames
→ Meshy multi-image-to-3D (color-preserving params) → download GLB → viewer
```

Typical job time: **3–22 minutes** depending on preset.

### Room (beta) — Zone Mesh Composition (ZMC)

```
Video → FFmpeg frames + yaw estimate → select_zone_keyframes (4 zones × 4 frames)
→ parallel Meshy jobs (rate-limited) → zone GLBs + scene manifest
→ optional room shell → multi-mesh Babylon viewer
```

Typical job time: **~35–45 minutes** (4 serial/parallel zone reconstructions).

See [`docs/spike/meshy-room-workaround-no-pointcloud.md`](docs/spike/meshy-room-workaround-no-pointcloud.md) for design rationale.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Babylon.js (GLB mesh viewer), nginx |
| Backend | FastAPI, FFmpeg, httpx (Meshy client), SQLite jobs |
| AI | Meshy API (`meshy-7` / `meshy-6`) |
| Hosting | Railway (2 services) |

## Quality presets

| Preset | Mode | Meshy model | Est. time | Notes |
|---|---|---|---|---|
| fast | single | meshy-6 | ~5 min | 30k poly, `decimation_mode` off |
| balanced | single | meshy-7 | ~8 min | 50k poly |
| quality | single | meshy-7 + 4k | ~22 min | `decimation_mode=1`, pre-remeshed GLB |
| room | zone_mesh | meshy-7 + 4k | ~40 min | 4 zones, scene manifest |

### Meshy parameters (color fidelity)

| Parameter | Value | Purpose |
|---|---|---|
| `texture_image_urls` | keyframes (wall_priority in quality) | Guide textures independently of geometry |
| `auto_size` + `origin_at: bottom` | enabled | Real-world scale, floor at Y=0 |
| `image_enhancement` | false | Preserve video colors |
| `remove_lighting` | false | Keep environment lighting in texture |
| `decimation_mode` | 1 (quality) | Ultra polycount for multi-image |
| `save_pre_remeshed_model` | true (quality) | Higher-quality GLB when available |

## API endpoints (jobs)

| Endpoint | Description |
|---|---|
| `GET /api/presets` | Preset list (single source of truth for UI) |
| `GET /api/jobs/{id}/status` | Progress, keyframes, scene_manifest |
| `GET /api/jobs/{id}/model` | Primary GLB (zone 0 or merged) |
| `GET /api/jobs/{id}/scene` | Scene manifest JSON |
| `GET /api/jobs/{id}/zones/{zone_id}` | Per-zone GLB |
| `GET /api/jobs/{id}/shell` | Optional room shell GLB |
| `POST /api/jobs/webhooks/meshy` | Meshy completion webhook |

## Deploy

See [`docs/RAILWAY-RUNBOOK.md`](docs/RAILWAY-RUNBOOK.md).

```bash
# API service
railway up --service api

# Frontend service (set BACKEND_URL to api public URL first)
railway up --service web
```

## Viewer features

- Orbit / pan / zoom on GLB mesh (single or multi-zone composed scene)
- Walkthrough (UniversalCamera + collision proxy; walk path from manifest when available)
- Two-point calibration measurement (mesh raycast) with scale warning until calibrated
- Per-zone visibility toggles (room mode)
- Lighting panel (ambient / directional / environment)
- WebXR VR
- Viewer defaults in Settings (localStorage)

## Scene manifest

```json
{
  "composition_mode": "zone_mesh",
  "zones": [
    { "id": 0, "mesh_url": "/api/jobs/{id}/zones/0", "transform": [[...4x4...]] }
  ],
  "shell_url": "/api/jobs/{id}/shell",
  "walk_path": [[x, y, z, tx, ty, tz], ...]
}
```

## Limits & kill criteria

Meshy Multi-Image-to-3D assumes **1 object, 1–4 views** per job. Room mode composes multiple jobs; seams may be visible. If coverage <40% or seams >30 cm after tuning, consider external splat alternatives (documented in spike).
