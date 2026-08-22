from pathlib import Path

import pytest

from services.meshy.keyframe_selector import (
    FrameCandidate,
    assign_zones_by_yaw,
    frame_candidates_from_paths,
    select_keyframes,
    select_zone_keyframes,
    _select_angular_diverse_keyframes,
)


def _paths(count: int, tmp_path: Path) -> list[Path]:
    paths: list[Path] = []
    for index in range(count):
        path = tmp_path / f"frame_{index:03d}.jpg"
        path.write_bytes(b"fake")
        paths.append(path)
    return paths


def test_assign_zones_four_quadrants() -> None:
    candidates = [
        FrameCandidate(path=Path("a.jpg"), index=0, yaw_deg=10.0),
        FrameCandidate(path=Path("b.jpg"), index=1, yaw_deg=100.0),
        FrameCandidate(path=Path("c.jpg"), index=2, yaw_deg=190.0),
        FrameCandidate(path=Path("d.jpg"), index=3, yaw_deg=280.0),
    ]

    zones = assign_zones_by_yaw(candidates, n_zones=4)

    assert [frame.index for frame in zones[0]] == [0]
    assert [frame.index for frame in zones[1]] == [1]
    assert [frame.index for frame in zones[2]] == [2]
    assert [frame.index for frame in zones[3]] == [3]


def test_yaw_normalization_places_near_zero_in_first_zone() -> None:
    candidates = [FrameCandidate(path=Path("a.jpg"), index=0, yaw_deg=365.0)]
    zones = assign_zones_by_yaw(candidates, n_zones=4)
    assert [frame.index for frame in zones[0]] == [0]


def test_select_zone_keyframes_returns_up_to_four_per_zone(tmp_path: Path) -> None:
    frames = _paths(24, tmp_path)
    yaw_by_index = {index: float(index * 15) for index in range(len(frames))}

    selected = select_zone_keyframes(
        frames,
        n_zones=4,
        max_per_zone=4,
        yaw_by_index=yaw_by_index,
    )

    assert selected
    assert all(1 <= len(paths) <= 4 for paths in selected.values())
    assert all(isinstance(path, Path) for paths in selected.values() for path in paths)


def test_select_zone_keyframes_respects_yaw_override(tmp_path: Path) -> None:
    frames = _paths(8, tmp_path)
    yaw_by_index = {
        0: 10.0,
        1: 20.0,
        2: 95.0,
        3: 110.0,
        4: 185.0,
        5: 200.0,
        6: 275.0,
        7: 290.0,
    }

    selected = select_zone_keyframes(
        frames,
        n_zones=4,
        max_per_zone=2,
        yaw_by_index=yaw_by_index,
        min_frames_per_zone=2,
    )

    zone_for_index = {}
    for zone_id, paths in selected.items():
        for path in paths:
            zone_for_index[int(path.stem.split("_")[1])] = zone_id

    assert zone_for_index[0] == zone_for_index[1] == 0
    assert zone_for_index[2] == zone_for_index[3] == 1
    assert zone_for_index[4] == zone_for_index[5] == 2
    assert zone_for_index[6] == zone_for_index[7] == 3


def test_select_zone_keyframes_skips_sparse_zones(tmp_path: Path) -> None:
    frames = _paths(4, tmp_path)
    yaw_by_index = {0: 5.0, 1: 15.0, 2: 25.0, 3: 35.0}

    selected = select_zone_keyframes(
        frames,
        n_zones=4,
        max_per_zone=4,
        yaw_by_index=yaw_by_index,
        min_frames_per_zone=2,
    )

    assert list(selected.keys()) == [0]


def test_select_keyframes_global_spreads_across_timeline(tmp_path: Path) -> None:
    frames = _paths(12, tmp_path)
    sharpness = {index: float(index) for index in range(len(frames))}

    selected = select_keyframes(frames, max_count=4, sharpness_by_index=sharpness)

    assert len(selected) == 4
    indices = [int(path.stem.split("_")[1]) for path in selected]
    assert indices == sorted(indices)
    assert max(indices) - min(indices) >= 3


def test_frame_candidates_estimate_yaw_from_progress() -> None:
    candidates = frame_candidates_from_paths(
        [Path("a.jpg"), Path("b.jpg"), Path("c.jpg"), Path("d.jpg")]
    )

    assert candidates[0].yaw_deg == pytest.approx(0.0)
    assert candidates[-1].yaw_deg == pytest.approx(360.0)


def test_select_zone_keyframes_rejects_invalid_zone_count(tmp_path: Path) -> None:
    frames = _paths(2, tmp_path)
    with pytest.raises(ValueError):
        select_zone_keyframes(frames, n_zones=0)


def test_angular_sector_prefers_sharper_frame() -> None:
    zone_frames = [
        FrameCandidate(path=Path("a.jpg"), index=0, yaw_deg=44.0, sharpness=1.0),
        FrameCandidate(path=Path("b.jpg"), index=1, yaw_deg=46.0, sharpness=10.0),
    ]
    arch = {0: 0.5, 1: 0.5}
    selected = _select_angular_diverse_keyframes(zone_frames, 0, 4, 1, architecture_by_index=arch)
    assert len(selected) == 1
    assert selected[0].index == 1


def test_select_keyframes_excludes_person_when_alternatives_exist(tmp_path: Path) -> None:
    frames = _paths(8, tmp_path)
    sharpness = {index: float(index) for index in range(len(frames))}
    person_by_index = {0: True, 1: True, 2: False, 3: False, 4: False, 5: False, 6: False, 7: False}

    selected = select_keyframes(
        frames,
        max_count=4,
        sharpness_by_index=sharpness,
        person_by_index=person_by_index,
        min_index_gap=1,
    )

    for path in selected:
        idx = int(path.stem.split("_")[1])
        assert person_by_index[idx] is False
