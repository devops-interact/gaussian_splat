"""
FastAPI entrypoint for Gaussian Splatting Room Reconstruction MVP
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import logging
from pathlib import Path
from typing import List

from api.jobs import router as jobs_router
from core.config import get_settings, QUALITY_PRESETS, QualityPreset
from core.models import PresetInfo
from core.logging_config import setup_logging

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Gaussian Splatting Room Reconstruction API")

# CORS middleware - allow all origins for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Include routers
app.include_router(jobs_router, prefix="/api/jobs", tags=["jobs"])

# Serve static files (generated models)
storage_path = Path(__file__).parent / "storage"
models_path = storage_path / "models"
models_path.mkdir(parents=True, exist_ok=True)

app.mount("/static/models", StaticFiles(directory=str(models_path)), name="models")


@app.get("/")
async def root():
    return {"message": "Gaussian Splatting Room Reconstruction API", "version": "0.2.0"}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
