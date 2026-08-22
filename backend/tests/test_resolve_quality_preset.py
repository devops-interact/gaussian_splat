from core.config import QualityPreset, resolve_quality_preset


def test_resolve_legacy_fast_and_balanced() -> None:
    assert resolve_quality_preset("fast") == QualityPreset.QUALITY
    assert resolve_quality_preset("balanced") == QualityPreset.QUALITY


def test_resolve_active_presets() -> None:
    assert resolve_quality_preset("quality") == QualityPreset.QUALITY
    assert resolve_quality_preset("room") == QualityPreset.ROOM


def test_resolve_unknown_defaults_to_quality() -> None:
    assert resolve_quality_preset("invalid") == QualityPreset.QUALITY
