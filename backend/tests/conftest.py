"""Shared pytest fixtures."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.config import get_settings


@pytest.fixture
def temp_storage(tmp_path, monkeypatch):
    """Isolated SQLite + storage dirs for job manager tests."""
    storage = tmp_path / "storage"
    for sub in ("uploads", "frames", "models", "logs"):
        (storage / sub).mkdir(parents=True)
    db_path = storage / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("ENV", "development")
    get_settings.cache_clear()
    settings = get_settings()
    monkeypatch.setattr(settings, "STORAGE_DIR", storage)
    monkeypatch.setattr(settings, "UPLOADS_DIR", storage / "uploads")
    monkeypatch.setattr(settings, "FRAMES_DIR", storage / "frames")
    monkeypatch.setattr(settings, "MODELS_DIR", storage / "models")
    monkeypatch.setattr(settings, "LOGS_DIR", storage / "logs")

    import database
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )
    database.engine = engine
    database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    from database import init_db
    init_db()

    import jobs.job_manager as jm_module
    jm_module._job_manager = None
    yield settings
    get_settings.cache_clear()
    jm_module._job_manager = None
