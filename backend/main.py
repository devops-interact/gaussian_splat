"""
FastAPI entrypoint for MESH-UP (Meshy + Railway)
"""
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
import os
import logging
from pathlib import Path
from typing import List

from api.jobs import router as jobs_router
from api.auth import router as auth_router
from api.projects import router as projects_router
from api.scans import router as scans_router
from core.config import get_settings, QUALITY_PRESETS, QualityPreset
from core.models import PresetInfo
from core.brand import BRAND_NAME, BRAND_VERSION

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

settings = get_settings()

# Explicit list: browsers sending Authorization need this on preflight responses;
# Access-Control-Allow-Headers: * is not sufficient for that case in Firefox / stricter Chrome.
CORS_ALLOW_HEADERS = [
    "Authorization",
    "Content-Type",
    "Accept",
    "Origin",
    "X-Requested-With",
]
CORS_ALLOW_HEADERS_VALUE = ", ".join(CORS_ALLOW_HEADERS)

# Initialize database and seed demo user
from database import init_db
init_db()

# Resolve jobs left in-flight by a previous crash/restart.
from jobs.job_manager import get_job_manager
get_job_manager().recover_stale_jobs()

app = FastAPI(title=f"{BRAND_NAME} API")

# CORS middleware - allow all origins for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=CORS_ALLOW_HEADERS,
    expose_headers=["*"],
)


@app.middleware("http")
async def ensure_cors_headers(request: Request, call_next):
    """
    Belt-and-suspenders CORS: guarantee Access-Control headers are present
    on every response, including error responses and RunPod proxy edge cases.
    """
    # Handle preflight OPTIONS immediately
    if request.method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS_VALUE,
                "Access-Control-Max-Age": "86400",
            },
        )

    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    response.headers["Access-Control-Allow-Headers"] = CORS_ALLOW_HEADERS_VALUE
    return response

# Include routers
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(scans_router, prefix="/api/projects", tags=["scans"])
app.include_router(jobs_router, prefix="/api/jobs", tags=["jobs"])

# Serve static files (generated 3D models)
storage_path = Path(__file__).parent / "storage"
models_path = storage_path / "models"
frames_path = storage_path / "frames"
models_path.mkdir(parents=True, exist_ok=True)
frames_path.mkdir(parents=True, exist_ok=True)

app.mount("/static/models", StaticFiles(directory=str(models_path)), name="models")
app.mount("/static/frames", StaticFiles(directory=str(frames_path)), name="frames")




@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/presets", response_model=List[PresetInfo], tags=["presets"])
async def get_presets():
    """Get available quality presets"""
    return [
        PresetInfo(
            id=preset.value,
            name=config.name,
            description=config.description,
            estimated_minutes=config.estimated_minutes
        )
        for preset, config in QUALITY_PRESETS.items()
    ]


@app.get("/api/presets/{preset_id}", response_model=PresetInfo, tags=["presets"])
async def get_preset(preset_id: str):
    """Get details for a specific preset"""
    try:
        preset = QualityPreset(preset_id)
        config = QUALITY_PRESETS[preset]
        return PresetInfo(
            id=preset.value,
            name=config.name,
            description=config.description,
            estimated_minutes=config.estimated_minutes
        )
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")


# Serve Frontend Static Files & SPA Fallback (Placed at end to avoid shadowing API routes)
frontend_dist = Path("/app/frontend/dist")

def _serve_index():
    """Serve index.html with no-cache headers to prevent stale frontend."""
    index_path = frontend_dist / "index.html"
    html = index_path.read_text()
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

if frontend_dist.exists():
    # Mount assets (these are content-hashed, safe to cache)
    assets_path = frontend_dist / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")

    # Serve other static files (vite.svg, etc.)
    @app.get("/vite.svg")
    async def serve_vite_svg():
        svg_path = frontend_dist / "vite.svg"
        if svg_path.exists():
            return FileResponse(svg_path)

    @app.get("/")
    async def serve_root():
        return _serve_index()

    @app.get("/{full_path:path}")
    async def serve_spa_catchall(full_path: str):
        # Check if file exists in dist (but not index.html via this path)
        file_path = frontend_dist / full_path
        if file_path.exists() and file_path.is_file() and full_path != "index.html":
            return FileResponse(file_path)
        # Fallback to index.html (no cache)
        return _serve_index()
else:
    @app.get("/")
    async def api_root():
        return {"message": f"{BRAND_NAME} API (No Frontend)", "version": BRAND_VERSION.lstrip("v")}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
