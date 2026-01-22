"""
Job state management and storage
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict
from core.models import Job, JobStatus
from core.config import get_settings

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

# Global job manager instance
_job_manager = None

def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager
