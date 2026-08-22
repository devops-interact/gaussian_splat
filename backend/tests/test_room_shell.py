from pathlib import Path
from unittest.mock import patch

from services.meshy.room_shell import create_room_shell


def test_create_room_shell_skips_without_textures(tmp_path: Path) -> None:
    keyframe = tmp_path / "kf.jpg"
    keyframe.write_bytes(b"not-an-image")

    with patch("services.meshy.room_shell._pick_frontal_keyframe", return_value=None):
        result = create_room_shell(
            "job-1",
            tmp_path / "models",
            [keyframe],
            aggregated_bbox={"min": [0, 0, 0], "max": [2, 3, 2]},
            n_zones=4,
        )

    assert result is None
    assert not (tmp_path / "models" / "job-1" / "shell.glb").exists()
