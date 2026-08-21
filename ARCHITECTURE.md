# MESH-UP — Architecture

## Overview

Web app that converts room walkthrough videos into interactive **textured 3D meshes (GLB)** using the **Meshy Multi-Image-to-3D API**. Hosted entirely on **Railway** (two services: API + frontend).

## Railway services

```
┌─────────────────────────┐     proxy /api, /static      ┌──────────────────────────┐
│  web (frontend)         │ ────────────────────────────▶│  api (backend)           │
│  nginx + React SPA      │     BACKEND_URL env var      │  FastAPI + FFmpeg + Meshy│
│  Dockerfile.frontend    │                              │  Dockerfile.railway      │
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

## Pipeline

```
Video upload → validate → FFmpeg keyframes → select 4 best frames
→ Meshy multi-image-to-3D → download GLB → viewer (Babylon.js)
```

Typical job time: **3–12 minutes**.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Babylon.js (GLB mesh viewer), nginx |
| Backend | FastAPI, FFmpeg, httpx (Meshy client) |
| AI | Meshy API (`meshy-7` / `meshy-6`) |
| Hosting | Railway (2 services) |

## Quality presets

| Preset | Meshy model | Est. time | Polycount |
|---|---|---|---|
| fast | meshy-6 | ~5 min | 30k |
| balanced | meshy-7 | ~8 min | 50k |
| quality | meshy-7 ultra + 4k | ~12 min | 100k |

## Deploy

See [`docs/RAILWAY-RUNBOOK.md`](docs/RAILWAY-RUNBOOK.md).

```bash
# API service
railway up --service api

# Frontend service (set BACKEND_URL to api public URL first)
railway up --service web
```

## Viewer features

- Orbit / pan / zoom on GLB mesh
- Walkthrough (UniversalCamera + collision proxy)
- Two-point calibration measurement (mesh raycast)
- WebXR VR
