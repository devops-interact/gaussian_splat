import math

from services.meshy.scene_compose import (
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


def test_compose_zone_transforms_uses_index_not_raw_zone_id() -> None:
    transforms = compose_zone_transforms_for_ids([0, 2], n_zones=2, radius=0.0)
    assert set(transforms.keys()) == {0, 2}
    # Two zones → 90° and 270° bucket centers, both at origin
    assert transforms[0][0][3] == 0.0
    assert transforms[2][0][3] == 0.0
    yaw0 = math.degrees(math.atan2(transforms[0][0][2], transforms[0][0][0]))
    yaw2 = math.degrees(math.atan2(transforms[2][0][2], transforms[2][0][0]))
    assert abs(yaw0 - yaw2) > 90.0
