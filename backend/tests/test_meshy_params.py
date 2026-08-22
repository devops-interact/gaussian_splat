from services.meshy.meshy_params import texture_urls_for_preset
from core.config import QUALITY_PRESETS, QualityPreset


def test_wall_priority_puts_frontal_frame_first() -> None:
    preset = QUALITY_PRESETS[QualityPreset.ROOM]
    urls = ["http://a", "http://b", "http://c", "http://d"]
    yaws = [10.0, 100.0, 190.0, 280.0]
    # Zone 1 center = 135°; closest is index 1 (100°)
    tex = texture_urls_for_preset(
        urls,
        preset,
        zone_center_yaw_deg=135.0,
        frame_yaws_deg=yaws,
    )
    assert tex is not None
    assert tex[0] == "http://b"
    assert len(tex) == 4
