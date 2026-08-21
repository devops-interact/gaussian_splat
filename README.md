# MESH-UP

**Video to 3D mesh** — converts room walkthrough videos into interactive **GLB meshes** via the **Meshy** image-to-3D API. Hosted on **Railway** (API + web services).

See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/RAILWAY-RUNBOOK.md`](docs/RAILWAY-RUNBOOK.md) for full details.

**Demo login:** `demo@mesh-up.app` / `demo123`

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
railway up --service web
```

Per-service Dockerfile is configured in Railway (`Dockerfile.frontend.railway` for web). See [`railway.frontend.toml`](railway.frontend.toml).

The SPA calls same-origin `/api/...`; nginx proxies to the API service.

### 4. Verify

```bash
curl https://your-api.up.railway.app/health
# {"status":"healthy"}

open https://your-web.up.railway.app
```

---

## Processing Pipeline

Orchestrated in [`backend/core/pipeline.py`](backend/core/pipeline.py):

```
Video (MP4)
  → Validate (upload / preset limits)
  → Extract frames (FFmpeg @ preset FPS)
  → Select 4 keyframes (sharpness + temporal spread)
  → Meshy multi-image-to-3D
  → Download GLB
  → Complete — viewer loads mesh via GET /api/jobs/{id}/model
```

Typical job time: **3–12 minutes**.

### Quality Presets

Defined in `backend/core/config.py` (`QUALITY_PRESETS`):

| Preset | Meshy model | Est. time | Polycount |
|---|---|---|---|
| **Fast** | meshy-6 | ~5 min | 30k |
| **Balanced** | meshy-7 | ~8 min | 50k |
| **Quality** | meshy-7 ultra + 4k | ~12 min | 100k |

### 3D Viewer (Babylon.js)

The scan viewer loads **GLB meshes** with orbit, walkthrough, mesh raycast measurement, and WebXR. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for viewer details.

---

## Tech Stack

### Frontend (Railway web service)

- **React 18** + TypeScript + Vite
- **Babylon.js** — GLB mesh viewer (orbit / walk / measure / WebXR)
- **Tailwind CSS** — styling
- **nginx** — SPA + API proxy

### Backend (Railway api service)

- **Python 3.11** + FastAPI
- **Meshy API** — multi-image-to-3D
- **FFmpeg** — video frame extraction
- **SQLite** — persistent storage on Railway volume

### Infrastructure

- **Railway** — two services (api + web)
- **Docker** — `Dockerfile.railway`, `Dockerfile.frontend.railway`

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/presets` | List quality presets |
| `POST` | `/api/jobs/upload` | Upload video (multipart + quality_preset) |
| `GET` | `/api/jobs/{id}/status` | Job status, progress, model URLs |
| `GET` | `/api/jobs/{id}/model` | Download GLB |
| `GET` | `/api/jobs/{id}/thumbnail` | Job thumbnail |

### Job Status Response

```json
{
  "job_id": "uuid",
  "status": "reconstructing",
  "progress": 0.65,
  "quality_preset": "balanced",
  "estimated_minutes": 8,
  "validation": {
    "duration": 45.2,
    "resolution": "1920x1080",
    "fps": 30.0,
    "warnings": []
  },
  "model_url": "/api/jobs/uuid/model"
}
```

**Status flow:** `uploaded` → `validating` → `extracting_frames` → `selecting_keyframes` → `submitting_reconstruction` → `reconstructing` → `downloading_model` → `completed` (or `error`).

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
mesh-up/
├── backend/
│   ├── api/jobs.py                          # Upload, status, download endpoints
│   ├── core/
│   │   ├── brand.py                         # MESH-UP brand constants
│   │   ├── config.py                        # Quality presets, settings
│   │   ├── models.py                        # Pydantic models
│   │   └── pipeline.py                      # Job orchestration (frames → Meshy → GLB)
│   ├── services/meshy/                      # Meshy client, keyframes, storage
│   ├── main.py                              # FastAPI entry
│   └── requirements.txt
├── frontend/
│   ├── src/lib/brand.ts                     # MESH-UP brand constants
│   ├── src/viewer/                          # GLB viewer (Babylon.js)
│   └── package.json
├── Dockerfile.railway                       # API image
├── Dockerfile.frontend.railway              # Web image
├── railway.toml / railway.frontend.toml
├── ARCHITECTURE.md
└── README.md
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Long job times | Use **Fast** preset or shorter video |
| Stale frontend after deploy | Hard-refresh (`Ctrl+Shift+R`) or redeploy on Railway |
| Demo login fails | Use `demo@mesh-up.app` / `demo123`; re-seed DB if migrated from old demo user |
| Meshy jobs fail | Set `MESHY_API_KEY` on api service |
| Jobs lost on redeploy | Attach volume on api at `/app/backend/storage` |

---

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system architecture, Railway services, viewer features
- **[docs/RAILWAY-RUNBOOK.md](./docs/RAILWAY-RUNBOOK.md)** — deploy and ops
- **[docs/spike/meshy-vs-hi3d-decision.md](./docs/spike/meshy-vs-hi3d-decision.md)** — provider decision for MESH-UP
- **[LongSplat_README.md](./LongSplat_README.md)** — legacy GPU pipeline (not used in production)

---

## Resources

- [Meshy API](https://docs.meshy.ai/)
- [Babylon.js](https://github.com/BabylonJS/Babylon.js)
- [Railway Documentation](https://docs.railway.com/)

---

## License

MIT License — Research use.
