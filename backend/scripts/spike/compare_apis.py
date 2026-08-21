#!/usr/bin/env python3
"""
Spike script: extract keyframes from a video and submit to Meshy (or Hi3D stub).

Usage:
  MESHY_API_KEY=msk_... python scripts/spike/compare_apis.py --video path/to/room.mp4
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from services.meshy.client import MeshyClient  # noqa: E402
from services.meshy.keyframe_selector import (  # noqa: E402
    laplacian_sharpness,
    list_frame_paths,
    select_keyframes,
)
from services.video.extract_frames import extract_frames  # noqa: E402


async def run_meshy_spike(video_path: Path, output_dir: Path) -> None:
    api_key = os.environ.get("MESHY_API_KEY")
    if not api_key:
        raise SystemExit("Set MESHY_API_KEY")

    frames_dir = output_dir / "frames"
    await extract_frames(video_path, frames_dir, fps=1.0)
    frame_paths = list_frame_paths(frames_dir)
    if not frame_paths:
        raise SystemExit(f"No frames found in {frames_dir}")

    sharpness_by_index = {i: laplacian_sharpness(p) for i, p in enumerate(frame_paths)}
    selected = select_keyframes(
        frame_paths,
        max_count=4,
        sharpness_by_index=sharpness_by_index,
    )
    print(f"Selected {len(selected)} keyframes:")
    for p in selected:
        print(f"  - {p.name}")

    # For spike, use data URIs (no public URL needed)
    from services.meshy.storage_upload import paths_to_data_uris

    image_urls = paths_to_data_uris(selected)
    client = MeshyClient(api_key=api_key)
    task_id = await client.create_multi_image_task(
        image_urls=image_urls,
        ai_model="meshy-7",
        should_texture=True,
        enable_pbr=True,
        target_formats=["glb"],
        target_polycount=50_000,
    )
    print(f"Meshy task: {task_id}")
    result = await client.poll_until_complete(task_id)
    glb_url = result.get("model_urls", {}).get("glb")
    print(f"Status: {result.get('status')} GLB: {glb_url}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("/tmp/meshy-spike"))
    parser.add_argument("--provider", choices=["meshy"], default="meshy")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    asyncio.run(run_meshy_spike(args.video, args.output))


if __name__ == "__main__":
    main()
