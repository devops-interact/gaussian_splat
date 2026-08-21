"""JobManager SQLite persistence tests."""
import asyncio

import pytest

from datetime import datetime

from core.models import Job, JobStatus
from jobs.job_manager import JobManager


def test_create_get_update_job(temp_storage):
    manager = JobManager()

    async def run():
        job = await manager.create_job("room.mp4")
        assert job.status == JobStatus.UPLOADED
        fetched = await manager.get_job(job.job_id)
        assert fetched is not None
        assert fetched.video_filename == "room.mp4"

        fetched.status = JobStatus.RECONSTRUCTING
        fetched.progress = 0.5
        await manager.update_job(fetched)

        updated = await manager.get_job(job.job_id)
        assert updated.status == JobStatus.RECONSTRUCTING
        assert updated.progress == 0.5

    asyncio.run(run())


def test_migrate_jobs_json(temp_storage):
    import json
    from datetime import datetime
    from core.config import get_settings

    logs_dir = get_settings().LOGS_DIR
    jobs_file = logs_dir / "jobs.json"
    now = datetime.now().isoformat()
    jobs_file.write_text(json.dumps({
        "legacy-id": {
            "status": "training",
            "video_filename": "old.mp4",
            "quality_preset": "balanced",
            "progress": 0.2,
            "created_at": now,
            "updated_at": now,
        }
    }))

    manager = JobManager()

    async def run():
        job = await manager.get_job("legacy-id")
        assert job is not None
        assert job.status == JobStatus.RECONSTRUCTING
        assert job.video_filename == "old.mp4"

    asyncio.run(run())
    assert not jobs_file.exists() or (logs_dir / "jobs.json.bak").exists()
