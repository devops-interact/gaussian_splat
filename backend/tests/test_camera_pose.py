import pytest

from services.meshy.camera_pose import (
    _angular_span_deg,
    _uniform_yaw,
    measure_yaw_coverage,
    validate_room_coverage,
)


def test_angular_span_full_circle() -> None:
    yaws = [float(i) for i in range(0, 360, 10)]
    assert _angular_span_deg(yaws) == pytest.approx(350.0, abs=5.0)


def test_angular_span_partial() -> None:
    yaws = [10.0, 30.0, 50.0]
    assert _angular_span_deg(yaws) == pytest.approx(40.0, abs=1.0)


def test_measure_yaw_coverage_counts_zones() -> None:
    yaw_by_index = {i: float(i * 30) for i in range(12)}
    coverage = measure_yaw_coverage(yaw_by_index, n_zones=4)
    assert coverage["zones_populated"] == 4
    assert float(coverage["span_deg"]) > 300.0


def test_validate_room_coverage_rejects_uniform_fallback() -> None:
    with pytest.raises(ValueError, match="Could not estimate camera rotation"):
        validate_room_coverage({0: 0.0, 1: 180.0}, 4, used_uniform_fallback=True)


def test_validate_room_coverage_rejects_low_span() -> None:
    yaw = {0: 0.0, 1: 10.0, 2: 20.0}
    with pytest.raises(ValueError, match="Insufficient 360"):
        validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_validate_room_coverage_accepts_good_span() -> None:
    yaw = {i: float(i * 20) for i in range(18)}
    validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_validate_room_coverage_accepts_when_zones_populated() -> None:
    yaw = {0: 10.0, 1: 100.0, 2: 200.0}
    validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_total_rotation_on_unwrapped_yaws() -> None:
    from services.meshy.camera_pose import _total_rotation_deg

    yaw = {0: 0.0, 1: 90.0, 2: 180.0, 3: 270.0, 4: 360.0}
    assert _total_rotation_deg(yaw) == pytest.approx(360.0)


def test_measure_yaw_coverage_uses_total_rotation() -> None:
    yaw_by_index = {0: 0.0, 1: 120.0, 2: 240.0, 3: 380.0}
    coverage = measure_yaw_coverage(yaw_by_index, n_zones=4)
    assert float(coverage["total_rotation_deg"]) == pytest.approx(360.0, abs=1.0)
    assert float(coverage["span_deg"]) >= 200.0


def test_uniform_yaw_for_tests_only() -> None:
    yaws = _uniform_yaw(5)
    assert len(yaws) == 5
    assert yaws[0] == 0.0
    assert yaws[4] == pytest.approx(360.0)
