import math

from services.meshy.scene_compose import (
    compose_zone_transforms_for_ids,
    zone_transform_from_yaw,
    zone_transform_matrix,
)


def test_zone_transform_matrix_uses_bucket_center() -> None:
    t0 = zone_transform_matrix(0, n_zones=4, radius=2.0)
    t1 = zone_transform_matrix(1, n_zones=4, radius=2.0)
    # Bucket centers: 45° and 135°
    assert t0[0][3] == zone_transform_from_yaw(45.0, 2.0)[0][3]
    assert t1[0][3] == zone_transform_from_yaw(135.0, 2.0)[0][3]


def test_compose_zone_transforms_for_sparse_zone_ids() -> None:
    transforms = compose_zone_transforms_for_ids([0, 2, 3], n_zones=4, radius=3.0)
    assert set(transforms.keys()) == {0, 2, 3}
    assert transforms[0][0][3] == zone_transform_from_yaw(45.0, 3.0)[0][3]
    assert transforms[2][0][3] == zone_transform_from_yaw(225.0, 3.0)[0][3]


def test_zone_transform_faces_center() -> None:
    t = zone_transform_from_yaw(0.0, radius=2.0)
    x, z = t[0][3], t[2][3]
    # At yaw 0, position is (0, 0, radius); rotation should face origin
    assert math.isclose(x, 0.0, abs_tol=1e-5)
    assert math.isclose(z, 2.0, abs_tol=1e-5)
