#!/usr/bin/env python3
"""Convert the Poly Haven texture sets used by assets/models/*.glb to WebP.

    python3 tools/assets/build_textures.py

Writes assets/models/tex/<id>_c.webp (colour, with the scan's ambient occlusion
multiplied in so crevices stay dark under our simple lighting) and
<id>_n.webp (OpenGL-convention normal map).
"""
import glob
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', '.cache', 'polyhaven')
OUT = os.path.join(HERE, '..', '..', 'assets', 'models', 'tex')

# id -> output size in px
SETS = {
    'rock_moss_set_01': 1024, 'rock_moss_set_02': 1024, 'boulder_01': 1024,
    'rock_face_01': 1024, 'rock_face_02': 1024, 'namaqualand_boulder_03': 1024,
    'fern_02': 1024, 'tree_stump_01': 1024, 'dead_tree_trunk': 1024,
    'dead_tree_trunk_02': 1024, 'dry_branches_medium_01': 512, 'shrub_04': 512,
    # buildings
    'weathered_plank_siding': 1024, 'rustic_stone_wall_02': 1024, 'grey_roof_01': 1024,
}


def find(asset_id, kind):
    hits = sorted(glob.glob(os.path.join(CACHE, asset_id, '*', 'textures', f'*_{kind}_*.jpg')))
    return hits[0] if hits else None


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for asset_id, size in SETS.items():
        diff = Image.open(find(asset_id, 'diff')).convert('RGB').resize((size, size), Image.LANCZOS)
        arm = find(asset_id, 'arm')
        if arm:
            ao = np.asarray(Image.open(arm).convert('RGB').resize((size, size), Image.LANCZOS))[..., 0] / 255.0
            c = np.asarray(diff).astype(np.float32) / 255.0
            lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
            lin *= (0.35 + 0.65 * ao)[..., None]
            c = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
            diff = Image.fromarray(np.clip(c * 255 + 0.5, 0, 255).astype(np.uint8))
        nor = Image.open(find(asset_id, 'nor_gl')).convert('RGB').resize((size, size), Image.LANCZOS)
        for img, suffix, q in ((diff, 'c', 84), (nor, 'n', 82)):
            path = os.path.join(OUT, f'{asset_id}_{suffix}.webp')
            img.save(path, 'WEBP', quality=q, method=6)
            total += os.path.getsize(path)
        print(asset_id, size, 'ao' if arm else '')
    print(f'{total / 1e6:.2f} MB of textures in {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
