import math

from services.meshy.scene_compose import (
    compose_radius_from_bbox,
    compose_zone_transforms_for_ids,
    zone_transform_from_yaw,
    zone_transform_matrix,
)


def test_zone_transform_at_shared_origin() -> None:
    t = zone_transform_from_yaw(90.0, radius=0.0)
    assert t[0][3] == 0.0
    assert t[2][3] == 0.0


def test_zone_transform_matrix_uses_bucket_center() -> None:
    t0 = zone_transform_matrix(0, n_zones=4, radius=0.0)
    t1 = zone_transform_matrix(1, n_zones=4, radius=0.0)
    assert t0[0][3] == zone_transform_from_yaw(45.0, 0.0)[0][3]
    assert t1[0][3] == zone_transform_from_yaw(135.0, 0.0)[0][3]


def test_compose_zone_transforms_uses_zone_id_sectors() -> None:
    radius = 2.0
    transforms = compose_zone_transforms_for_ids([0, 2], n_zones=4, radius=radius)
    assert set(transforms.keys()) == {0, 2}
    assert transforms[0][0][3] != transforms[2][0][3] or transforms[0][2][3] != transforms[2][2][3]
    expected_0 = zone_transform_matrix(0, n_zones=4, radius=radius)
    expected_2 = zone_transform_matrix(2, n_zones=4, radius=radius)
    assert transforms[0][0][3] == expected_0[0][3]
    assert transforms[2][2][3] == expected_2[2][3]


def test_compose_radius_from_bbox() -> None:
    bbox = {"min": [0, 0, 0], "max": [4, 3, 6]}
    r = compose_radius_from_bbox(bbox)
    assert r == max(6 / 2 * 0.85, 2.0)
