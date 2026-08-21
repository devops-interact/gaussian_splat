"""
Lightweight asyncio job queue — one Meshy reconstruction at a time.
"""
import asyncio
import logging
from core.models import Job
from core.pipeline import process_job

logger = logging.getLogger(__name__)

_semaphore = asyncio.Semaphore(1)
_active: set[str] = set()


async def enqueue_job(job: Job) -> None:
    if job.job_id in _active:
        logger.warning("Job %s already queued/running", job.job_id)
        return
    _active.add(job.job_id)
    asyncio.create_task(_run_job(job))


async def _run_job(job: Job) -> None:
    try:
        async with _semaphore:
            await process_job(job)
    except Exception as e:
        logger.error("Worker failed for job %s: %s", job.job_id, e, exc_info=True)
    finally:
        _active.discard(job.job_id)
