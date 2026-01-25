"""
FastAPI entrypoint for Gaussian Splatting Room Reconstruction MVP
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging
from pathlib import Path

from api.jobs import router as jobs_router
from core.config import get_settings
from core.logging_config import setup_logging

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="Gaussian Splatting Room Reconstruction API")

# CORS middleware - allow Vercel and local development
# In production, allow all origins (Vercel domains vary)
# For production, set CORS_ORIGINS env var with specific domains, or use "*" for all
cors_origins_env = os.getenv("CORS_ORIGINS", "")
if cors_origins_env == "*" or not cors_origins_env:
    # Allow all origins (for Vercel deployments with varying domains)
    cors_origins = ["*"]
else:
    # Use specific origins from environment variable
    cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
    # Add localhost for development
    cors_origins.extend([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True if "*" not in cors_origins else False,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"message": "Gaussian Splatting Room Reconstruction API", "version": "0.1.0"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
