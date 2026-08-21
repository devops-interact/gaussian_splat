"""Tests for preset-specific Meshy timeouts."""
from core.config import QUALITY_PRESETS, QualityPreset
from core.pipeline import _meshy_timeout_for_preset


def test_quality_preset_has_longer_meshy_timeout():
    assert QUALITY_PRESETS[QualityPreset.QUALITY].meshy_timeout_s == 1800.0
    assert QUALITY_PRESETS[QualityPreset.BALANCED].meshy_timeout_s == 900.0
    assert QUALITY_PRESETS[QualityPreset.FAST].meshy_timeout_s == 600.0


def test_meshy_timeout_for_preset():
    assert _meshy_timeout_for_preset(QualityPreset.QUALITY) == 1800.0
    assert _meshy_timeout_for_preset(QualityPreset.FAST) == 600.0
