import pytest

from services.meshy.camera_pose import (
    _angular_span_deg,
    _uniform_yaw,
    dominant_zone_fraction,
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


def test_dominant_zone_fraction() -> None:
    yaw = {i: 5.0 for i in range(20)}
    zid, frac = dominant_zone_fraction(yaw, 4)
    assert zid == 0
    assert frac == 1.0


def test_validate_room_coverage_rejects_uniform_fallback() -> None:
    with pytest.raises(ValueError, match="Could not estimate camera rotation"):
        validate_room_coverage({0: 0.0, 1: 180.0}, 4, used_uniform_fallback=True)


def test_validate_room_coverage_rejects_object_centric_video() -> None:
    yaw = {i: 10.0 for i in range(30)}
    with pytest.raises(ValueError, match="single-object"):
        validate_room_coverage(
            yaw,
            4,
            used_uniform_fallback=False,
            n_frames=30,
            extraction_fps=2.0,
        )


def test_validate_room_coverage_accepts_long_walk_forward_via_fallback() -> None:
    yaw = {i: 5.0 for i in range(50)}
    validate_room_coverage(
        yaw,
        4,
        used_uniform_fallback=False,
        n_frames=50,
        extraction_fps=2.0,
    )


def test_validate_room_coverage_accepts_wide_span_despite_dominant_zone() -> None:
    yaw = {i: 5.0 for i in range(38)}
    for i in range(38, 42):
        yaw[i] = 95.0
    for i in range(42, 45):
        yaw[i] = 185.0
    for i in range(45, 50):
        yaw[i] = 275.0
    validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_maybe_apply_frame_index_yaw_fallback_spreads_long_clip() -> None:
    from services.meshy.camera_pose import maybe_apply_frame_index_yaw_fallback

    yaw = {i: 0.0 for i in range(50)}
    result = maybe_apply_frame_index_yaw_fallback(yaw, n_frames=50, extraction_fps=2.0)
    assert result[0] == pytest.approx(0.0, abs=0.1)
    assert result[49] == pytest.approx(360.0, abs=0.1)


def test_validate_room_coverage_rejects_low_rotation() -> None:
    yaw = {i: float(i * 5) for i in range(8)}
    with pytest.raises(ValueError):
        validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_validate_room_coverage_accepts_good_walkthrough() -> None:
    yaw = {i: float(i * 20) for i in range(18)}
    validate_room_coverage(yaw, 4, used_uniform_fallback=False)


def test_calibrate_yaw_undercount_scales_long_walkthrough() -> None:
    from services.meshy.camera_pose import calibrate_yaw_undercount

    yaw = {i: float(i * 2.3) for i in range(40)}  # ~89° total
    calibrated = calibrate_yaw_undercount(yaw, n_frames=40, extraction_fps=1.5)
    total = sum(
        abs(calibrated[i] - calibrated[i - 1])
        for i in range(1, 40)
    )
    assert total == pytest.approx(360.0, abs=5.0)


def test_calibrate_yaw_skips_short_clips() -> None:
    from services.meshy.camera_pose import calibrate_yaw_undercount

    yaw = {i: float(i) for i in range(10)}
    assert calibrate_yaw_undercount(yaw, n_frames=10, extraction_fps=1.5) == yaw


def test_horizontal_fov_differs_by_orientation() -> None:
    from services.meshy.camera_pose import _horizontal_fov_deg

    assert _horizontal_fov_deg(False) > _horizontal_fov_deg(True)
    assert _horizontal_fov_deg(False) == pytest.approx(70.0)
    assert _horizontal_fov_deg(True) == pytest.approx(52.0)


def test_uniform_yaw_for_tests_only() -> None:
    yaws = _uniform_yaw(5)
    assert len(yaws) == 5
    assert yaws[0] == 0.0
    assert yaws[4] == pytest.approx(360.0)
