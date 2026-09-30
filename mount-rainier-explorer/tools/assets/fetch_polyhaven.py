#!/usr/bin/env python3
"""Download the Poly Haven (CC0) scans the game uses into tools/.cache/polyhaven.

    python3 tools/assets/fetch_polyhaven.py

Each asset lands in tools/.cache/polyhaven/<id>/<res>/ as the original glTF with
its .bin and JPG textures; build_models.mjs and build_textures.py read from there.
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', '.cache', 'polyhaven')
UA = {'User-Agent': 'rainier-explorer-build/1.0 (+https://polyhaven.com)'}

# id -> resolution of the textures we keep
ASSETS = {
    # rocks
    'rock_moss_set_01': '1k', 'rock_moss_set_02': '1k', 'boulder_01': '1k',
    'rock_face_01': '1k', 'rock_face_02': '1k', 'namaqualand_boulder_03': '1k',
    # forest floor
    'fern_02': '1k', 'tree_stump_01': '1k', 'dead_tree_trunk': '1k',
    'dead_tree_trunk_02': '1k', 'dry_branches_medium_01': '1k',
    # shrubs and saplings (the saplings' needles are baked into foliage cards)
    'shrub_04': '1k', 'fir_sapling': '2k', 'pine_sapling_small': '1k',
    'grass_medium_01': '1k', 'grass_medium_02': '1k',
    # bark for the conifer trunks
    'fir_tree_01': 'textures',
}
# plain texture sets (colour + normal at 1k): the park's buildings
TEXTURES = ['weathered_plank_siding', 'rustic_stone_wall_02', 'grey_roof_01']


def get(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(dest + '.part', 'wb') as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(dest + '.part', dest)
            return
        except Exception as e:  # network hiccup: back off and retry
            print(f'  retry {url}: {e}')
            time.sleep(2 ** attempt)
    sys.exit(f'failed to download {url}')


def files(asset_id):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset_id}', headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    for asset_id, res in ASSETS.items():
        f = files(asset_id)
        if res == 'textures':
            # just the 2k bark maps of the big fir; its 480 MB mesh isn't needed
            base = os.path.join(CACHE, asset_id, '2k')
            inc = f['gltf']['2k']['gltf']['include']
            for p, v in inc.items():
                if p.endswith('.jpg') and ('bark' in p or 'trunk_a' in p) and 'arm' not in p:
                    get(v['url'], os.path.join(base, p))
            print(asset_id, 'bark textures')
            continue
        g = f['gltf'][res]['gltf']
        base = os.path.join(CACHE, asset_id, res)
        get(g['url'], os.path.join(base, f'{asset_id}.gltf'))
        for p, v in g['include'].items():
            get(v['url'], os.path.join(base, p))
        print(asset_id, res)
    for tex_id in TEXTURES:
        f = files(tex_id)
        base = os.path.join(CACHE, tex_id, '1k', 'textures')
        get(f['Diffuse']['1k']['jpg']['url'], os.path.join(base, f'{tex_id}_diff_1k.jpg'))
        get(f['nor_gl']['1k']['jpg']['url'], os.path.join(base, f'{tex_id}_nor_gl_1k.jpg'))
        print(tex_id, 'textures')


if __name__ == '__main__':
    main()
