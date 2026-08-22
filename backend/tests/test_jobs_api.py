"""API tests for jobs endpoints."""
from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"


def test_job_status_not_found():
    resp = client.get("/api/jobs/nonexistent-id/status")
    assert resp.status_code == 404


def test_presets_list():
    resp = client.get("/api/presets")
    assert resp.status_code == 200
    presets = resp.json()
    assert len(presets) == 2
    ids = {p["id"] for p in presets}
    assert ids == {"quality", "room"}
