"""
Async client for Meshy Multi-Image-to-3D API.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

MESHY_BASE = "https://api.meshy.ai"
DEFAULT_POLL_INTERVAL_S = 5.0
DEFAULT_TIMEOUT_S = 600.0
LATE_PROGRESS_THRESHOLD = 95
LATE_PROGRESS_EXTENSION_S = 300.0


class MeshyError(Exception):
    pass


class MeshyClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = MESHY_BASE,
        poll_interval_s: float = DEFAULT_POLL_INTERVAL_S,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.poll_interval_s = poll_interval_s
        self.timeout_s = timeout_s

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def create_multi_image_task(
        self,
        image_urls: List[str],
        *,
        ai_model: str = "meshy-7",
        should_texture: bool = True,
        enable_pbr: bool = True,
        texture_resolution: str = "2k",
        target_formats: Optional[List[str]] = None,
        target_polycount: int = 50_000,
        should_remesh: bool = False,
        ultra_mode: bool = False,
    ) -> str:
        if not image_urls:
            raise MeshyError("At least one image URL is required")
        if len(image_urls) > 4:
            raise MeshyError("Meshy supports at most 4 images")

        body: Dict[str, Any] = {
            "image_urls": image_urls,
            "ai_model": ai_model,
            "should_texture": should_texture,
            "enable_pbr": enable_pbr,
            "texture_resolution": texture_resolution,
            "should_remesh": should_remesh,
            "ultra_mode": ultra_mode,
            "target_polycount": target_polycount,
            "target_formats": target_formats or ["glb"],
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.base_url}/openapi/v1/multi-image-to-3d",
                headers=self._headers(),
                json=body,
            )
            if resp.status_code >= 400:
                raise MeshyError(f"Create task failed ({resp.status_code}): {resp.text}")
            data = resp.json()
            task_id = data.get("result") or data.get("id")
            if not task_id:
                raise MeshyError(f"Unexpected create response: {data}")
            logger.info("Meshy task created: %s", task_id)
            return str(task_id)

    async def get_task(self, task_id: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(
                f"{self.base_url}/openapi/v1/multi-image-to-3d/{task_id}",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            if resp.status_code >= 400:
                raise MeshyError(f"Get task failed ({resp.status_code}): {resp.text}")
            return resp.json()

    async def poll_until_complete(
        self,
        task_id: str,
        on_poll=None,
    ) -> Dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + self.timeout_s
        extended_late = False

        def _check_task(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            status = task.get("status", "").upper()
            if status == "SUCCEEDED":
                return task
            if status == "FAILED":
                err = task.get("task_error") or task.get("message") or task
                raise MeshyError(f"Meshy task failed: {err}")
            return None

        while asyncio.get_event_loop().time() < deadline:
            task = await self.get_task(task_id)
            if on_poll is not None:
                await on_poll(task)
            status = task.get("status", "").upper()
            progress = task.get("progress", 0) or 0
            logger.info("Meshy task %s status=%s progress=%s", task_id, status, progress)

            done = _check_task(task)
            if done is not None:
                return done

            if (
                not extended_late
                and status == "IN_PROGRESS"
                and progress >= LATE_PROGRESS_THRESHOLD
            ):
                deadline += LATE_PROGRESS_EXTENSION_S
                extended_late = True
                logger.info(
                    "Meshy task %s at %s%% — extended polling deadline by %ss",
                    task_id,
                    progress,
                    LATE_PROGRESS_EXTENSION_S,
                )

            await asyncio.sleep(self.poll_interval_s)

        task = await self.get_task(task_id)
        if on_poll is not None:
            await on_poll(task)
        status = task.get("status", "").upper()
        progress = task.get("progress", 0)
        logger.info(
            "Meshy task %s final poll status=%s progress=%s",
            task_id,
            status,
            progress,
        )
        done = _check_task(task)
        if done is not None:
            return done

        raise MeshyError(f"Meshy task {task_id} timed out after {self.timeout_s}s")

    async def download_file(self, url: str, dest_path: str) -> None:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code >= 400:
                raise MeshyError(f"Download failed ({resp.status_code}): {url}")
            from pathlib import Path

            path = Path(dest_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(resp.content)
            logger.info("Downloaded %s (%d bytes)", dest_path, len(resp.content))
