"""
Job state management and storage
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict
from core.models import Job, JobStatus, VideoValidation
from core.config import get_settings, QualityPreset

logger = logging.getLogger(__name__)
settings = get_settings()

class JobManager:
    """Manages job state persistence"""
    
    def __init__(self):
        self.jobs: Dict[str, Job] = {}
        self.jobs_file = settings.LOGS_DIR / "jobs.json"
        self._load_jobs()
    
    def _load_jobs(self):
        """Load jobs from disk"""
        if self.jobs_file.exists():
            try:
                with open(self.jobs_file, 'r') as f:
                    data = json.load(f)
                    for job_id, job_data in data.items():
                        job_data['status'] = JobStatus(job_data['status'])
                        job_data['created_at'] = datetime.fromisoformat(job_data['created_at'])
                        job_data['updated_at'] = datetime.fromisoformat(job_data['updated_at'])
                        
                        # Handle quality_preset
                        if 'quality_preset' in job_data and job_data['quality_preset']:
                            try:
                                job_data['quality_preset'] = QualityPreset(job_data['quality_preset'])
                            except ValueError:
                                job_data['quality_preset'] = QualityPreset.BALANCED
                        
                        # Handle validation
                        if 'validation' in job_data and job_data['validation']:
                            job_data['validation'] = VideoValidation(**job_data['validation'])
                        
                        self.jobs[job_id] = Job(**job_data)
            except Exception as e:
                logger.warning(f"Failed to load jobs: {e}")
    
    def _save_jobs(self):
        """Save jobs to disk"""
        try:
            data = {}
            for job_id, job in self.jobs.items():
                data[job_id] = job.model_dump(mode='json')
            with open(self.jobs_file, 'w') as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Failed to save jobs: {e}")
    
    async def create_job(self, video_filename: str) -> Job:
        """Create a new job"""
        import uuid
        job_id = str(uuid.uuid4())
        now = datetime.now()
        
        job = Job(
            job_id=job_id,
            status=JobStatus.UPLOADED,
            video_filename=video_filename,
            created_at=now,
            updated_at=now
        )
        
        self.jobs[job_id] = job
        self._save_jobs()
        return job
    
    async def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID"""
        return self.jobs.get(job_id)
    
    async def update_job(self, job: Job):
        """Update a job"""
        job.updated_at = datetime.now()
        self.jobs[job.job_id] = job
        self._save_jobs()

    def recover_stale_jobs(self):
        """
        Resolve jobs left in an in-flight status by a crash/restart.

        The pipeline coroutine dies with the process (e.g. OOM kill), leaving
        jobs frozen at their last persisted status. On startup:
        - If the exported PLY exists, finalize the job as completed (training
          finished; only post-processing was interrupted).
        - Otherwise mark it as an error so the UI stops showing a live job.
        """
        in_flight = {
            JobStatus.VALIDATING,
            JobStatus.EXTRACTING_FRAMES,
            JobStatus.TRAINING,
            JobStatus.EXPORTING,
            JobStatus.COMPRESSING,
            JobStatus.MESHING,
        }
        recovered = 0
        for job in self.jobs.values():
            if job.status not in in_flight:
                continue
            recovered += 1
            ply_path = settings.MODELS_DIR / f"{job.job_id}.ply"
            if ply_path.exists():
                job.model_filename = f"{job.job_id}.ply"
                job.model_url = f"/api/jobs/{job.job_id}/model"
                gz_path = ply_path.with_suffix(".ply.gz")
                if gz_path.exists():
                    job.model_url_compressed = f"/static/models/{job.job_id}.ply.gz"
                glb_path = settings.MODELS_DIR / job.job_id / f"{job.job_id}.glb"
                if glb_path.exists():
                    job.model_url_glb = f"/static/models/{job.job_id}/{job.job_id}.glb"
                if job.model_metadata is None:
                    try:
                        # Lazy import: core.pipeline imports this module at load time.
                        from core.pipeline import _extract_ply_metadata
                        job.model_metadata = _extract_ply_metadata(ply_path)
                    except Exception as e:
                        logger.warning(f"Metadata extraction during recovery failed: {e}")
                job.status = JobStatus.COMPLETED
                job.progress = 1.0
                logger.info(
                    f"Recovered job {job.job_id}: backend restarted mid-pipeline but the "
                    f"PLY exists — finalized as completed"
                )
            else:
                last_step = job.status.value
                job.status = JobStatus.ERROR
                job.error_message = (
                    "The backend restarted while this job was in progress "
                    f"(last step: {last_step}) and no trained model was found. "
                    "Please re-run the scan."
                )
                logger.warning(
                    f"Recovered job {job.job_id}: no PLY found after restart — marked as error"
                )
            job.updated_at = datetime.now()
        if recovered:
            self._save_jobs()
            logger.info(f"Startup recovery resolved {recovered} stale in-flight job(s)")

# Global job manager instance
_job_manager = None

def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager
