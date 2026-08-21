# Railway Operations Runbook — MESH-UP

Railway project: **mesh-up** (two services: `api` + `web`).

Two Railway services in one project:

| Service | Dockerfile | Public URL |
|---|---|---|
| **api** | `Dockerfile.railway` | e.g. `https://api-production-xxxx.up.railway.app` |
| **web** | `Dockerfile.frontend.railway` | e.g. `https://web-production-xxxx.up.railway.app` |

Users hit **web**; nginx proxies `/api` and `/static` to **api**.

## 1. Deploy API service

```bash
railway link   # select project
railway service create api   # if not exists
railway up --service api
```

### API environment variables

| Variable | Description |
|---|---|
| `MESHY_API_KEY` | Meshy API bearer key |
| `STORAGE_PUBLIC_BASE_URL` | Public **api** URL (for Meshy keyframe image URLs) |
| `JWT_SECRET_KEY` | Auth secret (production) |
| `PORT` | Set automatically by Railway |

### API volume

Mount persistent storage at **`/app/backend/storage`** (10GB+).

### Verify API

```bash
curl https://YOUR-API.up.railway.app/health
# {"status":"healthy"}
```

## 2. Deploy frontend (web) service

```bash
railway service create web
```

Set environment on **web** service:

| Variable | Example |
|---|---|
| `BACKEND_URL` | `https://api-production-xxxx.up.railway.app` (no trailing slash) |
| `PORT` | Set automatically by Railway |

Deploy with per-service Dockerfile configured in Railway dashboard or:

```bash
railway up --service web
```

Reference config: [`railway.frontend.toml`](../railway.frontend.toml) → `Dockerfile.frontend.railway`

### Verify frontend

1. Open `https://YOUR-WEB.up.railway.app`
2. Login page should show API banner only if `/health` fails through proxy
3. Upload a test video

## Local build

```bash
./build-and-push.sh              # API image
./build-and-push.sh --frontend   # Frontend image (optional)
```

## Rollback

Railway dashboard → service → Deployments → redeploy previous version.

## Troubleshooting

| Issue | Fix |
|---|---|
| Demo login fails after rebrand | Use `demo@mesh-up.app` / `demo123`; delete SQLite on api volume to re-seed if old demo user remains |
| Login/API 404 on web domain | Set `BACKEND_URL` on web service to api public URL |
| Meshy can't fetch keyframes | Set `STORAGE_PUBLIC_BASE_URL` on **api** to api public URL |
| Jobs lost on redeploy | Attach volume on **api** at `/app/backend/storage` |
| Upload fails (413) | nginx `client_max_body_size` is 500m in frontend Dockerfile |

## Cost monitoring

Meshy: ~30 credits/job (~$0.30–0.60). Railway: Hobby/Pro + volume (~$5–20/mo per service).
