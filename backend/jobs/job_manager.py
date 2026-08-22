"""
Job state management backed by SQLite.
"""
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from core.models import Job, JobStatus, VideoValidation, ModelMetadata, KeyframeInfo, SceneManifest
from core.config import get_settings, QualityPreset, resolve_quality_preset
import database
from models.db_models import JobRecord

logger = logging.getLogger(__name__)

LEGACY_STATUS_MAP = {
    "training": JobStatus.RECONSTRUCTING,
    "exporting": JobStatus.DOWNLOADING_MODEL,
    "compressing": JobStatus.DOWNLOADING_MODEL,
}


def _record_to_job(record: JobRecord) -> Job:
    raw_status = record.status
    try:
        status = JobStatus(raw_status)
    except ValueError:
        status = LEGACY_STATUS_MAP.get(raw_status, JobStatus.ERROR)

    quality_preset = resolve_quality_preset(record.quality_preset)

    validation = None
    if record.validation_json:
        validation = VideoValidation(**record.get_validation())

    model_metadata = None
    if record.model_metadata_json:
        model_metadata = ModelMetadata(**record.get_model_metadata())

    keyframes = []
    if record.keyframes_json:
        keyframes = [KeyframeInfo(**k) for k in record.get_keyframes()]

    scene_manifest = None
    if record.scene_manifest_json:
        scene_manifest = SceneManifest(**record.get_scene_manifest())

    return Job(
        job_id=record.job_id,
        status=status,
        video_filename=record.video_filename,
        created_at=record.created_at,
        updated_at=record.updated_at,
        error_message=record.error_message,
        progress=record.progress or 0.0,
        model_filename=record.model_filename,
        model_url=record.model_url,
        model_url_obj=record.model_url_obj,
        quality_preset=quality_preset,
        validation=validation,
        estimated_minutes=record.estimated_minutes,
        model_metadata=model_metadata,
        processing_time_seconds=record.processing_time_seconds,
        meshy_task_id=record.meshy_task_id,
        keyframes=keyframes,
        scene_manifest=scene_manifest,
        current_zone=record.current_zone,
        total_zones=record.total_zones,
    )


def _job_to_record(job: Job, record: Optional[JobRecord] = None) -> JobRecord:
    if record is None:
        record = JobRecord(job_id=job.job_id, video_filename=job.video_filename, status=job.status.value)
    record.status = job.status.value
    record.video_filename = job.video_filename
    record.quality_preset = job.quality_preset.value if job.quality_preset else "quality"
    record.progress = job.progress
    record.error_message = job.error_message
    record.model_filename = job.model_filename
    record.model_url = job.model_url
    record.model_url_obj = job.model_url_obj
    record.estimated_minutes = job.estimated_minutes
    record.processing_time_seconds = job.processing_time_seconds
    record.meshy_task_id = job.meshy_task_id
    record.current_zone = job.current_zone
    record.total_zones = job.total_zones
    record.updated_at = job.updated_at
    if job.validation:
        record.set_validation(job.validation.model_dump(mode="json"))
    if job.model_metadata:
        record.set_model_metadata(job.model_metadata.model_dump(mode="json"))
    if job.keyframes:
        record.set_keyframes([k.model_dump(mode="json") for k in job.keyframes])
    elif job.keyframes == []:
        record.set_keyframes([])
    if job.scene_manifest:
        record.set_scene_manifest(job.scene_manifest.model_dump(mode="json"))
    return record


class JobManager:
    def __init__(self):
        self._migrate_json_if_needed()

    @property
    def jobs_file(self) -> Path:
        return get_settings().LOGS_DIR / "jobs.json"

    def _migrate_json_if_needed(self) -> None:
        jobs_file = self.jobs_file
        if not jobs_file.exists():
            return
        db = database.SessionLocal()
        try:
            if db.query(JobRecord).count() > 0:
                return
            with open(self.jobs_file, "r") as f:
                data = json.load(f)
            for job_id, job_data in data.items():
                raw_status = job_data.get("status", "error")
                try:
                    status = JobStatus(raw_status).value
                except ValueError:
                    status = LEGACY_STATUS_MAP.get(raw_status, JobStatus.ERROR).value

                record = JobRecord(
                    job_id=job_id,
                    status=status,
                    video_filename=job_data.get("video_filename", ""),
                    quality_preset=resolve_quality_preset(job_data.get("quality_preset")).value,
                    progress=float(job_data.get("progress", 0)),
                    error_message=job_data.get("error_message"),
                    model_filename=job_data.get("model_filename"),
                    model_url=job_data.get("model_url"),
                    model_url_obj=job_data.get("model_url_obj"),
                    estimated_minutes=job_data.get("estimated_minutes"),
                    processing_time_seconds=job_data.get("processing_time_seconds"),
                    meshy_task_id=job_data.get("meshy_task_id"),
                    created_at=datetime.fromisoformat(job_data["created_at"]),
                    updated_at=datetime.fromisoformat(job_data["updated_at"]),
                )
                if job_data.get("validation"):
                    record.set_validation(job_data["validation"])
                if job_data.get("model_metadata"):
                    record.set_model_metadata(job_data["model_metadata"])
                db.add(record)
            db.commit()
            backup = jobs_file.with_suffix(".json.bak")
            jobs_file.rename(backup)
            logger.info("Migrated jobs.json to SQLite (%d jobs)", len(data))
        except Exception as e:
            db.rollback()
            logger.warning("Failed to migrate jobs.json: %s", e)
        finally:
            db.close()

    async def create_job(self, video_filename: str) -> Job:
        job_id = str(uuid.uuid4())
        now = datetime.now()
        job = Job(
            job_id=job_id,
            status=JobStatus.UPLOADED,
            video_filename=video_filename,
            created_at=now,
            updated_at=now,
        )
        db = database.SessionLocal()
        try:
            record = _job_to_record(job)
            record.created_at = now
            db.add(record)
            db.commit()
        finally:
            db.close()
        return job

    async def get_job(self, job_id: str) -> Optional[Job]:
        db = database.SessionLocal()
        try:
            record = db.query(JobRecord).filter(JobRecord.job_id == job_id).first()
            return _record_to_job(record) if record else None
        finally:
            db.close()

    async def update_job(self, job: Job) -> None:
        job.updated_at = datetime.now()
        db = database.SessionLocal()
        try:
            record = db.query(JobRecord).filter(JobRecord.job_id == job.job_id).first()
            if not record:
                record = _job_to_record(job)
                db.add(record)
            else:
                _job_to_record(job, record)
            db.commit()
        finally:
            db.close()

    def recover_stale_jobs(self) -> None:
        in_flight = {
            JobStatus.VALIDATING,
            JobStatus.EXTRACTING_FRAMES,
            JobStatus.SELECTING_KEYFRAMES,
            JobStatus.SUBMITTING_RECONSTRUCTION,
            JobStatus.RECONSTRUCTING,
            JobStatus.DOWNLOADING_MODEL,
            JobStatus.COMPOSING_SCENE,
        }
        recovered = 0
        db = database.SessionLocal()
        try:
            records = db.query(JobRecord).all()
            for record in records:
                job = _record_to_job(record)
                if job.status not in in_flight:
                    continue
                recovered += 1
                glb_path = get_settings().MODELS_DIR / f"{job.job_id}.glb"
                if glb_path.exists():
                    job.model_filename = f"{job.job_id}.glb"
                    job.model_url = f"/api/jobs/{job.job_id}/model"
                    if job.model_metadata is None:
                        try:
                            from core.pipeline import _extract_glb_metadata
                            job.model_metadata = _extract_glb_metadata(glb_path)
                        except Exception as e:
                            logger.warning("Metadata extraction during recovery failed: %s", e)
                    job.status = JobStatus.COMPLETED
                    job.progress = 1.0
                    logger.info("Recovered job %s: GLB exists — finalized as completed", job.job_id)
                else:
                    last_step = job.status.value
                    job.status = JobStatus.ERROR
                    job.error_message = (
                        "The backend restarted while this job was in progress "
                        f"(last step: {last_step}) and no model was found. "
                        "Please re-run the scan."
                    )
                    logger.warning("Recovered job %s: no GLB found — marked as error", job.job_id)
                job.updated_at = datetime.now()
                _job_to_record(job, record)
            if recovered:
                db.commit()
                logger.info("Startup recovery resolved %d stale in-flight job(s)", recovered)
        finally:
            db.close()

        try:
            import asyncio
            asyncio.run(self._recover_meshy_errored_jobs())
        except Exception as e:
            logger.warning("Meshy error-job recovery failed: %s", e)

    async def _recover_meshy_errored_jobs(self) -> None:
        """Finalize ERROR jobs whose Meshy task completed after our poll timed out."""
        from core.pipeline import finalize_meshy_result, _meshy_timeout_for_preset
        from services.meshy.client import MeshyClient

        cfg = get_settings()
        if not cfg.MESHY_API_KEY:
            return

        recovered = 0
        db = database.SessionLocal()
        try:
            records = db.query(JobRecord).filter(JobRecord.status == JobStatus.ERROR.value).all()
            for record in records:
                job = _record_to_job(record)
                if not job.meshy_task_id:
                    continue
                glb_path = cfg.MODELS_DIR / f"{job.job_id}.glb"
                if glb_path.exists():
                    continue

                preset = job.quality_preset or QualityPreset.QUALITY
                client = MeshyClient(
                    api_key=cfg.MESHY_API_KEY,
                    poll_interval_s=cfg.MESHY_POLL_INTERVAL_S,
                    timeout_s=_meshy_timeout_for_preset(preset),
                )
                try:
                    task = await client.get_task(job.meshy_task_id)
                except Exception as e:
                    logger.warning("Meshy recovery poll failed for %s: %s", job.job_id, e)
                    continue

                if task.get("status", "").upper() != "SUCCEEDED":
                    continue

                try:
                    job = await finalize_meshy_result(job, client, task, job.meshy_task_id)
                    job.updated_at = datetime.now()
                    _job_to_record(job, record)
                    recovered += 1
                    logger.info(
                        "Recovered job %s from Meshy task %s",
                        job.job_id,
                        job.meshy_task_id,
                    )
                except Exception as e:
                    logger.warning("Meshy recovery download failed for %s: %s", job.job_id, e)

            if recovered:
                db.commit()
                logger.info("Recovered %d job(s) from completed Meshy tasks", recovered)
        finally:
            db.close()


_job_manager: Optional[JobManager] = None


def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager
