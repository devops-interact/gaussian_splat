"""Build Meshy API kwargs from preset config."""

from __future__ import annotations

from typing import List, Optional

from core.config import MeshyPresetConfig


def texture_urls_for_preset(
    geometry_urls: List[str],
    preset: MeshyPresetConfig,
) -> Optional[List[str]]:
    if preset.texture_image_urls_mode == "wall_priority":
        return list(geometry_urls)
    return None


def meshy_task_kwargs(preset: MeshyPresetConfig, geometry_urls: List[str]) -> dict:
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
    tex = texture_urls_for_preset(geometry_urls, preset)
    if tex:
        kwargs["texture_image_urls"] = tex
    return kwargs
