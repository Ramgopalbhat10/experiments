#!/usr/bin/env python3
"""
Bake fine terrain relief: the difference between USGS 3DEP elevation at ~10 m
(AWS Terrain Tiles, zoom 14, lidar-derived around the mountain) and the game's
20 m heightfield as the terrain shader reconstructs it (Catmull-Rom).

The game adds it back on the GPU (vertex heights and fragment normals) and on
the CPU (walking, placement), so gullies, moraines, rock steps and road cuts
show up without doubling the heightfield.

    python3 tools/build_detail.py     # reads assets/terrain.png, writes assets/detail.webp

detail.webp: grey, 4096 px over the same 40.96 km square; value 128 = 0, one
step = 0.1 m (so +-12.7 m). Lossy WebP (q90) costs ~0.2 m rms, far below the
relief it carries, at a third of the PNG's size.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402

OUT_RES = 4096
STEP = 0.1


def catmull_rom_upsample(h, factor):
    """Evaluate the game's bicubic (Catmull-Rom) surface at the finer grid's texel centres."""
    R = h.shape[0]
    n = R * factor
    g = (np.arange(n) + 0.5) / factor - 0.5          # coarse texel coordinates
    i = np.floor(g).astype(np.int64)
    t = g - i
    t2, t3 = t * t, t * t * t
    w = np.stack([-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2], -1)
    idx = np.clip(i[:, None] + np.arange(-1, 3)[None, :], 0, R - 1)
    rows = (h[idx] * w[:, :, None]).sum(1)                # (n, R): along z
    return (rows[:, idx] * w[None, :, :]).sum(2)         # (n, n)


def main():
    os.makedirs(bd.CACHE, exist_ok=True)
    cell = bd.SIZE_M / OUT_RES
    c = (np.arange(OUT_RES) + 0.5) * cell - bd.HALF
    xs, zs = np.meshgrid(c, c)
    lat = bd.LAT0 - zs / bd.M_LAT
    lon = bd.LON0 + xs / bd.M_LON
    bd.DEM_Z = 14
    print('Elevation at zoom 14...')
    fine = bd.build_dem(lat, lon)

    t = np.asarray(Image.open(os.path.join(bd.OUT, 'terrain.png')).convert('RGB')).astype(np.float64)
    base = (t[..., 0] * 256 + t[..., 1]) / 10.0
    coarse = catmull_rom_upsample(base, OUT_RES // base.shape[0])
    d = fine - coarse
    print(f'  detail: std {d.std():.2f} m, |d| p99 {np.percentile(np.abs(d), 99):.1f} m, max {np.abs(d).max():.1f} m')
    q = np.clip(np.round(d / STEP) + 128, 0, 255).astype(np.uint8)
    path = os.path.join(bd.OUT, 'detail.webp')
    Image.fromarray(q, 'L').convert('RGB').save(path, 'WEBP', quality=90, method=6)
    print(f'  wrote detail.webp: {os.path.getsize(path) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
