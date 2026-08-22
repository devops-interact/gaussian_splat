"""Build Meshy API kwargs from preset config."""

from __future__ import annotations

from typing import List, Optional, Sequence

from core.config import MeshyPresetConfig


def _angular_distance(a: float, b: float) -> float:
    d = abs((a % 360.0) - (b % 360.0))
    return min(d, 360.0 - d)


def texture_urls_for_preset(
    geometry_urls: List[str],
    preset: MeshyPresetConfig,
    *,
    zone_center_yaw_deg: Optional[float] = None,
    frame_yaws_deg: Optional[Sequence[float]] = None,
) -> Optional[List[str]]:
    if preset.texture_image_urls_mode != "wall_priority":
        return None
    if not geometry_urls:
        return list(geometry_urls)

    wall_idx = 0
    if zone_center_yaw_deg is not None and frame_yaws_deg:
        wall_idx = min(
            range(len(geometry_urls)),
            key=lambda i: _angular_distance(
                frame_yaws_deg[i] if i < len(frame_yaws_deg) else 0.0,
                zone_center_yaw_deg,
            ),
        )

    wall_url = geometry_urls[wall_idx]
    extras = [u for u in geometry_urls if u != wall_url][:3]
    return [wall_url, *extras]


def meshy_task_kwargs(
    preset: MeshyPresetConfig,
    geometry_urls: List[str],
    *,
    zone_center_yaw_deg: Optional[float] = None,
    frame_yaws_deg: Optional[Sequence[float]] = None,
) -> dict:
    kwargs = {
        "ai_model": preset.ai_model,
        "should_texture": preset.should_texture,
        "enable_pbr": preset.enable_pbr,
        "texture_resolution": preset.texture_resolution,
        "target_polycount": preset.target_polycount,
        "should_remesh": preset.should_remesh,
        "target_formats": ["glb", "obj"],
        "image_enhancement": preset.image_enhancement,
        "remove_lighting": preset.remove_lighting,
        "auto_size": preset.auto_size,
        "origin_at": preset.origin_at,
        "save_pre_remeshed_model": preset.save_pre_remeshed_model,
        "multi_view_thumbnails": preset.multi_view_thumbnails,
    }
    if preset.decimation_mode is not None:
        kwargs["decimation_mode"] = preset.decimation_mode
    tex = texture_urls_for_preset(
        geometry_urls,
        preset,
        zone_center_yaw_deg=zone_center_yaw_deg,
        frame_yaws_deg=frame_yaws_deg,
    )
    if tex:
        kwargs["texture_image_urls"] = tex
    return kwargs
