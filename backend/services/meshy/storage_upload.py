"""
Make keyframe images accessible to Meshy (public URL or data URI).
"""
from __future__ import annotations

import base64
import logging
import shutil
from pathlib import Path
from typing import List

from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def publish_keyframes(job_id: str, keyframe_paths: List[Path], zone_id: int = 0) -> List[str]:
    """
    Copy keyframes to a public static path and return absolute URLs for Meshy.
    Falls back to data URIs when STORAGE_PUBLIC_BASE_URL is unset.
    """
    dest_dir = settings.FRAMES_DIR / job_id / "keyframes" / f"zone_{zone_id}"
    dest_dir.mkdir(parents=True, exist_ok=True)

    published: List[Path] = []
    for i, src in enumerate(keyframe_paths):
        dest = dest_dir / f"keyframe_{i:02d}{src.suffix.lower()}"
        shutil.copy2(src, dest)
        published.append(dest)

    base = settings.STORAGE_PUBLIC_BASE_URL.rstrip("/") if settings.STORAGE_PUBLIC_BASE_URL else ""
    if base:
        urls = [
            f"{base}/static/frames/{job_id}/keyframes/zone_{zone_id}/{p.name}"
            for p in published
        ]
        logger.info("Published %d keyframes (zone %s) at %s", len(urls), zone_id, base)
        return urls

    logger.info("STORAGE_PUBLIC_BASE_URL unset — using data URIs for Meshy input")
    return paths_to_data_uris(published)


def paths_to_data_uris(paths: List[Path]) -> List[str]:
    uris: List[str] = []
    for path in paths:
        suffix = path.suffix.lower()
        mime = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        uris.append(f"data:{mime};base64,{data}")
    return uris
