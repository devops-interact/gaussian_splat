import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from core.config import QUALITY_PRESETS, QualityPreset
from core.models import Job, JobStatus
from core.pipeline_room import process_room_job


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


def _frame_setup(tmp_path: Path, count: int = 16):
    frames = [tmp_path / f"frame_{i:03d}.jpg" for i in range(count)]
    for p in frames:
        p.write_bytes(b"fake")
    yaw_by_index = {i: float(i * (360 / max(count - 1, 1))) for i in range(count)}
    zones = {
        0: frames[0:4],
        1: frames[4:8],
        2: frames[8:12],
        3: frames[12:16],
    }
    shell_path = tmp_path / "models" / "test-room-job" / "shell.glb"
    shell_path.parent.mkdir(parents=True, exist_ok=True)
    shell_path.write_bytes(b"shell-glb")
    return frames, yaw_by_index, zones, shell_path


def test_shell_first_completes_with_zero_zone_meshes(tmp_path) -> None:
    job = _make_job()
    frames, yaw_by_index, zones, shell_path = _frame_setup(tmp_path)

    mock_manager = MagicMock()
    mock_manager.update_job = AsyncMock()

    async def failing_zone(*args, **kwargs):
        return None, "Mesh classified as dominant object", set()

    with (
        patch("core.pipeline_room.get_job_manager", return_value=mock_manager),
        patch("core.pipeline_room.settings") as mock_settings,
        patch("core.pipeline_room.extract_frames", new_callable=AsyncMock),
        patch("core.pipeline_room.list_frame_paths", return_value=frames),
        patch("core.pipeline_room.estimate_yaw_by_index", return_value=(yaw_by_index, False)),
        patch("core.pipeline_room.validate_room_coverage"),
        patch("core.pipeline_room.measure_yaw_coverage", return_value={"span_deg": 350.0, "zones_populated": 4}),
        patch("core.pipeline_room.laplacian_sharpness", return_value=1.0),
        patch("core.pipeline_room.architecture_scores_by_index", return_value={i: 0.8 for i in range(16)}),
        patch("core.pipeline_room.person_flags_by_index", return_value={}),
        patch("core.pipeline_room.select_zone_keyframes", return_value=zones),
        patch("core.pipeline_room.publish_keyframes", side_effect=lambda jid, paths, zone_id=0: [f"url-{zone_id}-{i}" for i in range(len(paths))]),
        patch("core.pipeline_room.create_room_shell", return_value=shell_path),
        patch("core.pipeline_room._process_zone_with_retry", side_effect=failing_zone),
        patch("core.pipeline_room._extract_glb_metadata", return_value=None),
    ):
        mock_settings.MESHY_API_KEY = "test-key"
        mock_settings.UPLOADS_DIR = tmp_path
        mock_settings.FRAMES_DIR = tmp_path / "frames"
        mock_settings.MODELS_DIR = tmp_path / "models"
        mock_settings.MESHY_POLL_INTERVAL_S = 1
        mock_settings.MESHY_MAX_PARALLEL_JOBS = 2

        result = asyncio.run(process_room_job(job))

    assert result.status == JobStatus.COMPLETED
    assert result.scene_manifest is not None
    assert result.scene_manifest.shell_url is not None
    assert result.scene_manifest.primary_geometry == "shell"
    assert len(result.scene_manifest.zones) == 0


def test_partial_zone_recovery_with_shell(tmp_path) -> None:
    job = _make_job()
    frames, yaw_by_index, zones, shell_path = _frame_setup(tmp_path)

    mock_manager = MagicMock()
    mock_manager.update_job = AsyncMock()

    async def zone_processor(client, job_obj, job_manager, zone_id, paths, *rest):
        if zone_id in (0, 1):
            models_dir = tmp_path / "models" / job_obj.job_id
            models_dir.mkdir(parents=True, exist_ok=True)
            (models_dir / f"zone_{zone_id}.glb").write_bytes(b"glb-zone")
            return (zone_id, f"task-{zone_id}", {"model_urls": {"glb": f"http://x/{zone_id}"}}), "", set()
        return None, "rejected", set()

    with (
        patch("core.pipeline_room.get_job_manager", return_value=mock_manager),
        patch("core.pipeline_room.settings") as mock_settings,
        patch("core.pipeline_room.extract_frames", new_callable=AsyncMock),
        patch("core.pipeline_room.list_frame_paths", return_value=frames),
        patch("core.pipeline_room.estimate_yaw_by_index", return_value=(yaw_by_index, False)),
        patch("core.pipeline_room.validate_room_coverage"),
        patch("core.pipeline_room.measure_yaw_coverage", return_value={"span_deg": 350.0, "zones_populated": 4}),
        patch("core.pipeline_room.laplacian_sharpness", return_value=1.0),
        patch("core.pipeline_room.architecture_scores_by_index", return_value={i: 0.8 for i in range(16)}),
        patch("core.pipeline_room.person_flags_by_index", return_value={}),
        patch("core.pipeline_room.select_zone_keyframes", return_value=zones),
        patch("core.pipeline_room.publish_keyframes", side_effect=lambda jid, paths, zone_id=0: [f"url-{zone_id}-{i}" for i in range(len(paths))]),
        patch("core.pipeline_room.create_room_shell", return_value=shell_path),
        patch("core.pipeline_room._process_zone_with_retry", side_effect=zone_processor),
        patch("core.pipeline_room.mesh_passes_quality_gate", return_value=True),
        patch("core.pipeline_room.normalize_zone_glbs", return_value=({}, {
            0: {"min": [0, 0, 0], "max": [4, 2.5, 0.3]},
            1: {"min": [0, 0, 0], "max": [4, 2.5, 0.3]},
        })),
        patch("core.pipeline_room.dedupe_similar_zones", return_value=([0, 1], {})),
        patch("core.pipeline_room.align_zones_to_floor_origin", return_value={
            0: {"min": [0, 0, 0], "max": [4, 2.5, 0.3]},
            1: {"min": [0, 0, 0], "max": [4, 2.5, 0.3]},
        }),
        patch("core.pipeline_room._extract_glb_metadata", return_value=None),
    ):
        mock_settings.MESHY_API_KEY = "test-key"
        mock_settings.UPLOADS_DIR = tmp_path
        mock_settings.FRAMES_DIR = tmp_path / "frames"
        mock_settings.MODELS_DIR = tmp_path / "models"
        mock_settings.MESHY_POLL_INTERVAL_S = 1
        mock_settings.MESHY_MAX_PARALLEL_JOBS = 2

        result = asyncio.run(process_room_job(job))

    assert result.status == JobStatus.COMPLETED
    assert result.scene_manifest.shell_url is not None
    assert len(result.scene_manifest.zones) == 2


def test_room_preset_shell_first_config() -> None:
    room = QUALITY_PRESETS[QualityPreset.ROOM]
    assert room.room_shell_required is True
    assert room.zone_compose_radius == 0.0
    assert room.zone_mesh_max_retries == 2


def test_process_room_job_passes_max_per_zone_from_preset(tmp_path) -> None:
    job = _make_job()
    frames, yaw_by_index, zones, shell_path = _frame_setup(tmp_path)
    select_mock = MagicMock(return_value=zones)

    mock_manager = MagicMock()
    mock_manager.update_job = AsyncMock()

    with (
        patch("core.pipeline_room.get_job_manager", return_value=mock_manager),
        patch("core.pipeline_room.settings") as mock_settings,
        patch("core.pipeline_room.extract_frames", new_callable=AsyncMock),
        patch("core.pipeline_room.list_frame_paths", return_value=frames),
        patch("core.pipeline_room.estimate_yaw_by_index", return_value=(yaw_by_index, False)),
        patch("core.pipeline_room.validate_room_coverage"),
        patch("core.pipeline_room.measure_yaw_coverage", return_value={"span_deg": 350.0, "zones_populated": 4}),
        patch("core.pipeline_room.laplacian_sharpness", return_value=1.0),
        patch("core.pipeline_room.architecture_scores_by_index", return_value={i: 0.8 for i in range(16)}),
        patch("core.pipeline_room.person_flags_by_index", return_value={}),
        patch("core.pipeline_room.select_zone_keyframes", select_mock),
        patch("core.pipeline_room.publish_keyframes", side_effect=lambda jid, paths, zone_id=0: [f"url-{zone_id}-{i}" for i in range(len(paths))]),
        patch("core.pipeline_room.create_room_shell", return_value=shell_path),
        patch("core.pipeline_room._process_zone_with_retry", side_effect=RuntimeError("stop-after-select")),
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
