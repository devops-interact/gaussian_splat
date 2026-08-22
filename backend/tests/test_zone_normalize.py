from services.meshy.zone_normalize import (
    aggregate_bbox,
    bbox_extent,
    zones_are_similar,
)


def test_aggregate_bbox_merges_zones() -> None:
    bboxes = [
        {"min": [0, 0, 0], "max": [1, 2, 1]},
        {"min": [-1, 0, -1], "max": [2, 3, 2]},
    ]
    agg = aggregate_bbox(bboxes)
    assert agg is not None
    assert agg["min"] == [-1, 0, -1]
    assert agg["max"] == [2, 3, 2]


def test_zones_are_similar_matching_bbox() -> None:
    bbox = {"min": [0, 0, 0], "max": [2, 2, 2]}
    assert zones_are_similar(bbox, bbox, 1000, 1000, hash_a="abc", hash_b="abc")


def test_zones_are_not_similar_different_size() -> None:
    a = {"min": [0, 0, 0], "max": [2, 2, 2]}
    b = {"min": [0, 0, 0], "max": [5, 2, 2]}
    assert not zones_are_similar(a, b, 1000, 1000)


def test_zones_are_not_similar_different_centroids() -> None:
    a = {"min": [0, 0, 0], "max": [2, 2, 2]}
    b = {"min": [5, 0, 5], "max": [7, 2, 7]}
    assert not zones_are_similar(a, b, 1000, 1000)


def test_bbox_extent() -> None:
    bbox = {"min": [0, 0, 0], "max": [3, 2, 4]}
    assert bbox_extent(bbox) == (3.0, 2.0, 4.0)
