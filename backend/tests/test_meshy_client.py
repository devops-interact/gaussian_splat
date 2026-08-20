"""Tests for Meshy client (mocked HTTP)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.meshy.client import MeshyClient, MeshyError


def test_create_multi_image_task():
    client = MeshyClient(api_key="test-key")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"result": "task-123"}

    async def run():
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            return await client.create_multi_image_task(
                image_urls=["data:image/png;base64,abc"],
                target_formats=["glb"],
            )

    task_id = asyncio.run(run())
    assert task_id == "task-123"


def test_poll_until_complete_succeeded():
    client = MeshyClient(api_key="test-key", poll_interval_s=0.01, timeout_s=5)

    responses = [
        {"status": "IN_PROGRESS", "progress": 50},
        {"status": "SUCCEEDED", "progress": 100, "model_urls": {"glb": "https://example.com/m.glb"}},
    ]
    call_count = 0

    async def fake_get(task_id):
        nonlocal call_count
        r = responses[min(call_count, len(responses) - 1)]
        call_count += 1
        return r

    client.get_task = fake_get  # type: ignore

    async def run():
        return await client.poll_until_complete("task-123")

    result = asyncio.run(run())
    assert result["status"] == "SUCCEEDED"


def test_create_rejects_too_many_images():
    client = MeshyClient(api_key="test-key")

    async def run():
        await client.create_multi_image_task(image_urls=["a", "b", "c", "d", "e"])

    with pytest.raises(MeshyError):
        asyncio.run(run())
