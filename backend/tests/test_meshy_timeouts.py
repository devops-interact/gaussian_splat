from core.config import QUALITY_PRESETS, QualityPreset
from core.pipeline import _meshy_timeout_for_preset


def test_preset_timeouts() -> None:
    assert QUALITY_PRESETS[QualityPreset.QUALITY].meshy_timeout_s == 1800.0
    assert QUALITY_PRESETS[QualityPreset.ROOM].meshy_timeout_s == 1800.0


def test_meshy_timeout_for_preset() -> None:
    assert _meshy_timeout_for_preset(QualityPreset.QUALITY) == 1800.0
    assert _meshy_timeout_for_preset(QualityPreset.ROOM) == 1800.0
