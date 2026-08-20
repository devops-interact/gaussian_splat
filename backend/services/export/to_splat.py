"""
Convert 3D Gaussian Splat PLY to Babylon.js native .splat binary (32 bytes / splat).

Layout matches frontend/src/lib/splatPick.ts and @babylonjs/core GaussianSplattingMesh.splatsData.
"""
from __future__ import annotations

import logging
import struct
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

SH_C0 = 0.28209479177387814
SPLAT_ROW_BYTES = 32


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + np.exp(-x))


def ply_to_splat_bytes(ply_path: Path) -> bytes:
    """Read a 3DGS PLY and return Babylon-compatible .splat bytes."""
    from plyfile import PlyData

    plydata = PlyData.read(str(ply_path))
    vertex = plydata["vertex"]
    n = len(vertex.data)
    if n == 0:
        raise ValueError("Empty PLY")

    names = vertex.data.dtype.names or ()
    required = ("x", "y", "z", "scale_0", "scale_1", "scale_2", "opacity")
    for r in required:
        if r not in names:
            raise ValueError(f"PLY missing required property: {r}")

    has_fdc = all(f in names for f in ("f_dc_0", "f_dc_1", "f_dc_2"))
    has_rot = all(f in names for f in ("rot_0", "rot_1", "rot_2", "rot_3"))

    out = bytearray(n * SPLAT_ROW_BYTES)

    xs = vertex["x"]
    ys = vertex["y"]
    zs = vertex["z"]
    s0 = vertex["scale_0"]
    s1 = vertex["scale_1"]
    s2 = vertex["scale_2"]
    opacity = vertex["opacity"]

    if has_fdc:
        fdc0 = vertex["f_dc_0"]
        fdc1 = vertex["f_dc_1"]
        fdc2 = vertex["f_dc_2"]
    else:
        fdc0 = fdc1 = fdc2 = np.zeros(n)

    if has_rot:
        rot0 = vertex["rot_0"]
        rot1 = vertex["rot_1"]
        rot2 = vertex["rot_2"]
        rot3 = vertex["rot_3"]
    else:
        rot0 = np.ones(n)
        rot1 = rot2 = rot3 = np.zeros(n)

    for i in range(n):
        off = i * SPLAT_ROW_BYTES
        scale = (float(np.exp(s0[i])), float(np.exp(s1[i])), float(np.exp(s2[i])))
        r = int(np.clip((0.5 + SH_C0 * float(fdc0[i])) * 255, 0, 255))
        g = int(np.clip((0.5 + SH_C0 * float(fdc1[i])) * 255, 0, 255))
        b = int(np.clip((0.5 + SH_C0 * float(fdc2[i])) * 255, 0, 255))
        a = int(np.clip(_sigmoid(float(opacity[i])) * 255, 0, 255))

        # Babylon: q.set(r1,r2,r3,r0) then normalize; rot bytes = q.w,x,y,z mapped to 127.5
        r0, r1, r2, r3 = float(rot0[i]), float(rot1[i]), float(rot2[i]), float(rot3[i])
        qx, qy, qz, qw = r1, r2, r3, r0
        norm = (qx * qx + qy * qy + qz * qz + qw * qw) ** 0.5 or 1.0
        qx, qy, qz, qw = qx / norm, qy / norm, qz / norm, qw / norm
        rot_bytes = (
            int(np.clip(qw * 127.5 + 127.5, 0, 255)),
            int(np.clip(qx * 127.5 + 127.5, 0, 255)),
            int(np.clip(qy * 127.5 + 127.5, 0, 255)),
            int(np.clip(qz * 127.5 + 127.5, 0, 255)),
        )

        struct.pack_into(
            "<3f3f4B4B",
            out,
            off,
            float(xs[i]),
            float(ys[i]),
            float(zs[i]),
            scale[0],
            scale[1],
            scale[2],
            r,
            g,
            b,
            a,
            rot_bytes[0],
            rot_bytes[1],
            rot_bytes[2],
            rot_bytes[3],
        )

    return bytes(out)


def export_ply_to_splat(ply_path: Path, splat_path: Optional[Path] = None) -> Path:
    """Write .splat next to PLY (or to splat_path) and return output path."""
    if splat_path is None:
        splat_path = ply_path.with_suffix(".splat")
    data = ply_to_splat_bytes(ply_path)
    splat_path.write_bytes(data)
    logger.info("Wrote .splat: %s (%d bytes, %d splats)", splat_path, len(data), len(data) // SPLAT_ROW_BYTES)
    return splat_path
