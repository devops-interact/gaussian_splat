from services.meshy.zone_normalize import aggregate_bbox, placement_radius_from_bbox


def test_aggregate_bbox_merges_zones() -> None:
    bboxes = [
        {"min": [0, 0, 0], "max": [1, 2, 1]},
        {"min": [-1, 0, -1], "max": [2, 3, 2]},
    ]
    agg = aggregate_bbox(bboxes)
    assert agg is not None
    assert agg["min"] == [-1, 0, -1]
    assert agg["max"] == [2, 3, 2]


def test_placement_radius_from_bbox() -> None:
    bbox = {"min": [0, 0, 0], "max": [10, 2.5, 10]}
    radius = placement_radius_from_bbox(bbox, min_radius=2.0)
    assert radius == 10.0 * 0.35


def test_placement_radius_fallback() -> None:
    assert placement_radius_from_bbox(None) == 2.0
