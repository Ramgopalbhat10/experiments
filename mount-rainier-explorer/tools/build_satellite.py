#!/usr/bin/env python3
"""
Bake a colour texture of the park from Sentinel-2 cloudless 2016 imagery
(EOX IT Services GmbH, CC BY 4.0; contains modified Copernicus Sentinel data).

The terrain shader uses it for mid and far ground, where the scanned detail
textures fade out: real forest texture, moraines, rock bands and river bars
instead of a painted palette.

The satellite saw the park on summer mornings, so its slopes carry that sun's
light and shadow. We divide out a hillshade computed from our own elevation
for that sun, leaving (roughly) the ground's colour for our lighting to shade.

    python3 tools/build_satellite.py      # reads assets/terrain.png, writes assets/satellite.webp
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402  (shares the world frame, tile cache and mosaic helpers)

OUT_RES = 4096
# Sentinel-2 passes ~10:30 local solar time; the summer mosaic's typical sun
SUN_AZ, SUN_EL = 145.0, 50.0


def main():
    os.makedirs(bd.CACHE, exist_ok=True)
    cell = bd.SIZE_M / OUT_RES
    c = (np.arange(OUT_RES) + 0.5) * cell - bd.HALF
    xs, zs = np.meshgrid(c, c)
    lat = bd.LAT0 - zs / bd.M_LAT
    lon = bd.LON0 + xs / bd.M_LON

    print('Imagery (Sentinel-2 cloudless 2016, EOX) at z13...')
    img = bd.build_imagery(lat, lon)                      # float RGB 0..255

    print('Hillshade from assets/terrain.png...')
    t = np.asarray(Image.open(os.path.join(bd.OUT, 'terrain.png')).convert('RGB')).astype(np.float32)
    h = (t[..., 0] * 256 + t[..., 1]) / 10.0            # metres on the 2048 grid
    hi = np.asarray(Image.fromarray(h).resize((OUT_RES, OUT_RES), Image.BILINEAR))
    dzdx = np.gradient(hi, cell, axis=1)
    dzdz = np.gradient(hi, cell, axis=0)                  # +row = south
    n = np.stack([-dzdx, np.ones_like(hi), -dzdz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    az, el = np.radians(SUN_AZ), np.radians(SUN_EL)
    L = np.array([np.sin(az) * np.cos(el), np.sin(el), -np.cos(az) * np.cos(el)])  # x east, z south
    shade = np.clip((n * L).sum(-1), 0, 1)
    ref = np.sin(el)                                      # what flat ground received
    light = 0.4 + 0.6 * shade / ref                       # sky fill keeps shadows from blowing up

    lin = (img / 255.0) ** 2.2
    snow = np.clip((lin.min(-1) - 0.55) / 0.3, 0, 1)      # saturated glacier: leave as is
    corr = lin / np.clip(light, 0.45, 1.6)[..., None]
    lin = corr * (1 - snow[..., None]) + lin * snow[..., None]
    out = np.clip(lin, 0, 1) ** (1 / 2.2) * 255

    path = os.path.join(bd.OUT, 'satellite.webp')
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(path, 'WEBP', quality=80, method=6)
    print(f'  wrote satellite.webp: {os.path.getsize(path) / 1e6:.2f} MB ({OUT_RES} px, {cell:.1f} m/px)')


if __name__ == '__main__':
    main()
