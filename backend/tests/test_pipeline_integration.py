"""Integration test for process_job with mocked Meshy."""
import asyncio
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from core.models import Job, JobStatus, QualityPreset
from core.pipeline import process_job
from services.meshy.client import MeshyError


def test_process_job_completes_with_mocked_meshy(temp_storage, tmp_path):
    now = datetime.now()
    job = Job(
        job_id="test-job",
        status=JobStatus.UPLOADED,
        video_filename="test-job.mp4",
        quality_preset=QualityPreset.QUALITY,
        created_at=now,
        updated_at=now,
    )
    video_path = temp_storage.UPLOADS_DIR / "test-job.mp4"
    video_path.write_bytes(b"fake")

    frames_dir = temp_storage.FRAMES_DIR / "test-job"
    frames_dir.mkdir(parents=True)
    for i in range(4):
        (frames_dir / f"frame_{i:04d}.jpg").write_bytes(b"\xff\xd8\xff")

    glb_path = temp_storage.MODELS_DIR / "test-job.glb"
    glb_path.write_bytes(b"glTF" + b"\x00" * 8)

    mock_client = AsyncMock()
    mock_client.create_multi_image_task.return_value = "meshy-task-1"
    mock_client.poll_until_complete.return_value = {
        "status": "SUCCEEDED",
        "model_urls": {"glb": "https://example.com/model.glb"},
    }
    mock_client.download_file = AsyncMock()

    async def fake_download(url, dest):
        Path(dest).write_bytes(glb_path.read_bytes())

    mock_client.download_file.side_effect = fake_download

    async def run():
        with patch("core.pipeline.settings.MESHY_API_KEY", "test-key"), \
             patch("core.pipeline.settings.FRAMES_DIR", temp_storage.FRAMES_DIR), \
             patch("core.pipeline.settings.UPLOADS_DIR", temp_storage.UPLOADS_DIR), \
             patch("core.pipeline.settings.MODELS_DIR", temp_storage.MODELS_DIR), \
             patch("core.pipeline.MeshyClient", return_value=mock_client), \
             patch("core.pipeline.extract_frames", new_callable=AsyncMock, return_value=frames_dir), \
             patch("core.pipeline.list_frame_paths", return_value=list(frames_dir.glob("*.jpg"))), \
             patch("core.pipeline.select_keyframes", return_value=list(frames_dir.glob("*.jpg"))), \
             patch("core.pipeline.publish_keyframes", return_value=["data:image/jpeg;base64,abc"]), \
             patch("core.pipeline._extract_glb_metadata") as mock_meta, \
             patch("core.pipeline.get_job_manager") as mock_jm:
            from core.models import ModelMetadata
            mock_jm.return_value.update_job = AsyncMock()
            mock_meta.return_value = ModelMetadata(
                file_size=100,
                vertex_count=10,
                face_count=5,
                format="glb",
            )
            result = await process_job(job)
            assert result.status == JobStatus.COMPLETED
            assert result.meshy_task_id == "meshy-task-1"
            assert result.model_filename == "test-job.glb"

    asyncio.run(run())


def test_process_job_uses_quality_meshy_timeout(temp_storage):
    now = datetime.now()
    job = Job(
        job_id="test-job-q",
        status=JobStatus.UPLOADED,
        video_filename="test-job-q.mp4",
        quality_preset=QualityPreset.QUALITY,
        created_at=now,
        updated_at=now,
    )
    (temp_storage.UPLOADS_DIR / "test-job-q.mp4").write_bytes(b"fake")
    frames_dir = temp_storage.FRAMES_DIR / "test-job-q"
    frames_dir.mkdir(parents=True)
    (frames_dir / "frame_0000.jpg").write_bytes(b"\xff\xd8\xff")

    mock_client = AsyncMock()
    mock_client.create_multi_image_task.return_value = "meshy-task-q"

    async def run():
        with patch("core.pipeline.settings.MESHY_API_KEY", "test-key"), \
             patch("core.pipeline.settings.FRAMES_DIR", temp_storage.FRAMES_DIR), \
             patch("core.pipeline.settings.UPLOADS_DIR", temp_storage.UPLOADS_DIR), \
             patch("core.pipeline.settings.MODELS_DIR", temp_storage.MODELS_DIR), \
             patch("core.pipeline.MeshyClient") as mock_client_cls, \
             patch("core.pipeline.extract_frames", new_callable=AsyncMock, return_value=frames_dir), \
             patch("core.pipeline.list_frame_paths", return_value=list(frames_dir.glob("*.jpg"))), \
             patch("core.pipeline.select_keyframes", return_value=list(frames_dir.glob("*.jpg"))), \
             patch("core.pipeline.publish_keyframes", return_value=["data:image/jpeg;base64,abc"]), \
             patch("core.pipeline.get_job_manager") as mock_jm:
            mock_client_cls.return_value = mock_client
            mock_jm.return_value.update_job = AsyncMock()
            mock_client.poll_until_complete.side_effect = MeshyError(
                "Meshy task meshy-task-q timed out after 1800.0s"
            )
            result = await process_job(job)
            assert result.status == JobStatus.ERROR
            mock_client_cls.assert_called_once()
            assert mock_client_cls.call_args.kwargs["timeout_s"] == 1800.0

    asyncio.run(run())
