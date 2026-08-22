import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.config import QualityPreset
from core.models import Job, JobStatus
from core.pipeline_room import process_room_job
from datetime import datetime, timezone


def _make_job() -> Job:
    now = datetime.now(timezone.utc)
    return Job(
        job_id="test-room-job",
        status=JobStatus.UPLOADED,
        video_filename="walk.mp4",
        created_at=now,
        updated_at=now,
        quality_preset=QualityPreset.ROOM,
    )


def test_partial_zone_recovery_completes_with_two_zones(tmp_path) -> None:
    job = _make_job()
    frames = [tmp_path / f"frame_{i:03d}.jpg" for i in range(16)]
    for p in frames:
        p.write_bytes(b"fake")

    yaw_by_index = {i: float(i * 25) for i in range(16)}
    zones = {0: frames[:4], 1: frames[4:8], 2: frames[8:12], 3: frames[12:16]}

    mock_manager = MagicMock()
    mock_manager.update_job = AsyncMock()

    async def fake_meshy(client, zone_id, urls, preset, frame_yaws, center_yaw, on_poll):
        if zone_id == 2:
            return zone_id, None, None, "Meshy timeout"
        return zone_id, f"task-{zone_id}", {"model_urls": {"glb": f"http://meshy/zone{zone_id}.glb"}}, None

    with (
        patch("core.pipeline_room.get_job_manager", return_value=mock_manager),
        patch("core.pipeline_room.settings") as mock_settings,
        patch("core.pipeline_room.extract_frames", new_callable=AsyncMock),
        patch("core.pipeline_room.list_frame_paths", return_value=frames),
        patch("core.pipeline_room.estimate_yaw_by_index", return_value=(yaw_by_index, False)),
        patch("core.pipeline_room.validate_room_coverage"),
        patch("core.pipeline_room.measure_yaw_coverage", return_value={"span_deg": 350.0, "zones_populated": 4}),
        patch("core.pipeline_room.laplacian_sharpness", return_value=1.0),
        patch("core.pipeline_room.select_zone_keyframes", return_value=zones),
        patch("core.pipeline_room.publish_keyframes", side_effect=lambda jid, paths, zone_id=0: [f"url-{zone_id}-{i}" for i in range(len(paths))]),
        patch("core.pipeline_room.MeshyClient") as MockClient,
        patch("core.pipeline_room._run_zone_meshy", side_effect=fake_meshy),
        patch("core.pipeline_room.normalize_zone_glbs", return_value=({}, {
            0: {"min": [0, 0, 0], "max": [1, 2, 1]},
            1: {"min": [0, 0, 0], "max": [1, 2, 1]},
            3: {"min": [0, 0, 0], "max": [1, 2, 1]},
        })),
        patch("core.pipeline_room.dedupe_similar_zones", return_value=([0, 1, 3], {"2": "Duplicate of zone 0"})),
        patch("core.pipeline_room.aggregate_bbox", return_value=None),
        patch("core.pipeline_room.create_room_shell", return_value=None),
        patch("core.pipeline_room._extract_glb_metadata", return_value=None),
    ):
        mock_settings.MESHY_API_KEY = "test-key"
        mock_settings.UPLOADS_DIR = tmp_path
        mock_settings.FRAMES_DIR = tmp_path / "frames"
        mock_settings.MODELS_DIR = tmp_path / "models"
        mock_settings.MESHY_POLL_INTERVAL_S = 1
        mock_settings.MESHY_MAX_PARALLEL_JOBS = 2

        client_instance = MockClient.return_value
        client_instance.download_file = AsyncMock()

        models_dir = tmp_path / "models" / job.job_id
        models_dir.mkdir(parents=True)
        for zid in (0, 1, 3):
            (models_dir / f"zone_{zid}.glb").write_bytes(b"glb")

        result = asyncio.run(process_room_job(job))

    assert result.status == JobStatus.COMPLETED
    assert result.scene_manifest is not None
    assert len(result.scene_manifest.zones) == 3
    assert result.scene_manifest.zone_errors is not None
    assert "2" in result.scene_manifest.zone_errors


def test_room_preset_uses_four_keyframes_per_zone() -> None:
    from core.config import QUALITY_PRESETS, QualityPreset

    room = QUALITY_PRESETS[QualityPreset.ROOM]
    assert room.fps == 2.0
    assert room.max_keyframes == 4


def test_process_room_job_passes_max_per_zone_from_preset(tmp_path) -> None:
    job = _make_job()
    frames = [tmp_path / f"frame_{i:03d}.jpg" for i in range(8)]
    for p in frames:
        p.write_bytes(b"fake")

    yaw_by_index = {i: float(i * 45) for i in range(8)}
    zones = {0: frames[:2], 1: frames[2:4], 2: frames[4:6], 3: frames[6:8]}

    mock_manager = MagicMock()
    mock_manager.update_job = AsyncMock()
    select_mock = MagicMock(return_value=zones)

    with (
        patch("core.pipeline_room.get_job_manager", return_value=mock_manager),
        patch("core.pipeline_room.settings") as mock_settings,
        patch("core.pipeline_room.extract_frames", new_callable=AsyncMock),
        patch("core.pipeline_room.list_frame_paths", return_value=frames),
        patch("core.pipeline_room.estimate_yaw_by_index", return_value=(yaw_by_index, False)),
        patch("core.pipeline_room.validate_room_coverage"),
        patch("core.pipeline_room.measure_yaw_coverage", return_value={"span_deg": 350.0, "zones_populated": 4}),
        patch("core.pipeline_room.laplacian_sharpness", return_value=1.0),
        patch("core.pipeline_room.select_zone_keyframes", select_mock),
        patch("core.pipeline_room.publish_keyframes", side_effect=RuntimeError("stop-after-select")),
    ):
        mock_settings.MESHY_API_KEY = "test-key"
        mock_settings.UPLOADS_DIR = tmp_path
        mock_settings.FRAMES_DIR = tmp_path / "frames"
        mock_settings.MODELS_DIR = tmp_path / "models"
        mock_settings.MESHY_MAX_PARALLEL_JOBS = 2
        mock_settings.MESHY_POLL_INTERVAL_S = 1

        result = asyncio.run(process_room_job(job))

    select_mock.assert_called_once()
    assert select_mock.call_args.kwargs["max_per_zone"] == 4
    assert result.status == JobStatus.ERROR
