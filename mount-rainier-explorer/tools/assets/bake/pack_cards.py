#!/usr/bin/env python3
"""Pack the baked foliage renders (tools/.cache/cards) into texture atlases.

    python3 tools/assets/bake/pack_cards.py

Writes assets/tex/fir_cards_{c,n}.webp and assets/tex/leaf_cards_{c,n}.webp
(colour with alpha, and card-space normals) plus assets/tex/cards.json with
each card's rectangle in UV space and its real-world size in metres.

Colour is pushed out into the transparent area (push-pull fill) so mipmaps
don't bleed a dark fringe, and a soft "thickness" darkening is baked in so
the heart of a clump is shadowed like the real thing.
"""
import json
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '.cache', 'cards')
OUT = os.path.join(HERE, '..', '..', '..', 'assets', 'tex')

# atlas name -> (size, [(card, x, y, w, h)])
ATLASES = {
    'fir_cards': ((2048, 2048), [
        ('fir_spray_0', 0, 0, 1024, 512), ('fir_spray_1', 1024, 0, 1024, 512),
        ('fir_spray_2', 0, 512, 1024, 512), ('fir_whorl_0', 1024, 512, 512, 512), ('fir_whorl_1', 1536, 512, 512, 512),
        ('fir_side_0', 0, 1024, 512, 1024), ('fir_side_1', 512, 1024, 512, 1024),
    ]),
    'leaf_cards': ((1024, 1024), [
        ('leaf_top_0', 0, 0, 256, 256), ('leaf_top_1', 256, 0, 256, 256), ('leaf_top_2', 512, 0, 256, 256), ('leaf_top_3', 768, 0, 256, 256),
        ('leaf_top_1', 0, 256, 256, 256), ('leaf_top_2', 256, 256, 256, 256), ('leaf_side_2', 512, 256, 256, 256), ('leaf_side_3', 768, 256, 256, 256),
        ('leaf_side_0', 0, 512, 512, 512), ('leaf_side_1', 512, 512, 512, 512),
    ]),
}


def load(name, kind):
    return np.asarray(Image.open(os.path.join(SRC, f'{name}_{kind}.png')).convert('RGBA')).astype(np.float32) / 255.0


def shrink(img, size):
    """Premultiplied-alpha resize (no dark fringes)."""
    a = img[..., 3:4]
    pm = np.concatenate([img[..., :3] * a, a], -1)
    r = np.stack([np.asarray(Image.fromarray(pm[..., k]).resize(size, Image.LANCZOS)) for k in range(4)], -1)
    a2 = np.clip(r[..., 3:4], 0, 1)
    rgb = np.where(a2 > 1e-4, r[..., :3] / np.maximum(a2, 1e-4), 0)
    return np.concatenate([np.clip(rgb, 0, 1), a2], -1)


def push_pull(rgb, a):
    """Fill the transparent area with the colour of the nearest opaque texels."""
    levels = [(rgb * a[..., None], a)]
    while min(levels[-1][1].shape) > 2:
        c, w = levels[-1]
        h2, w2 = c.shape[0] // 2 * 2, c.shape[1] // 2 * 2
        c, w = c[:h2, :w2], w[:h2, :w2]
        c = (c[0::2, 0::2] + c[1::2, 0::2] + c[0::2, 1::2] + c[1::2, 1::2])
        w = (w[0::2, 0::2] + w[1::2, 0::2] + w[0::2, 1::2] + w[1::2, 1::2])
        levels.append((c, w))
    c, w = levels[-1]
    col = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(levels[:-1]):
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)
        up = np.pad(up, ((0, c.shape[0] - up.shape[0]), (0, c.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        here = c / np.maximum(w, 1e-6)[..., None]
        k = np.clip(w, 0, 1)[..., None]
        col = here * k + up * (1 - k)
    return col


def thickness(a, size):
    """0 at the silhouette's edge .. 1 deep inside the clump."""
    im = Image.fromarray((a * 255).astype(np.uint8))
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(size * 0.035))).astype(np.float32) / 255
    return np.clip((blur - 0.35) / 0.6, 0, 1)


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = json.load(open(os.path.join(SRC, 'meta.json')))
    rects = {}
    for atlas, ((W, H), cards) in ATLASES.items():
        col = np.zeros((H, W, 4), np.float32)
        nor = np.zeros((H, W, 3), np.float32)
        nor[..., :] = (0.5, 0.5, 1.0)
        cover = np.zeros((H, W), np.float32)
        for i, (name, x, y, w, h) in enumerate(cards):
            c = shrink(load(name, 'color'), (w, h))
            n = shrink(load(name, 'normal'), (w, h))
            a = c[..., 3]
            # baked self-shadowing: the middle of a spray or clump is darker
            t = thickness(a, max(w, h))
            c[..., :3] *= (1.0 - 0.45 * t)[..., None]
            col[y:y + h, x:x + w] = c
            nn = n[..., :3] * 2 - 1
            nn /= np.maximum(np.linalg.norm(nn, axis=-1, keepdims=True), 1e-6)
            nor[y:y + h, x:x + w] = np.where(a[..., None] > 0.02, nn * 0.5 + 0.5, (0.5, 0.5, 1.0))
            cover[y:y + h, x:x + w] = a
            span = meta[name]['span']
            rects[f'{atlas}/{i}'] = {'card': name, 'uv': [x / W, 1 - (y + h) / H, w / W, h / H], 'size': [round(span[0], 4), round(span[1], 4)]}
        rgb = push_pull(col[..., :3], cover)
        out = np.concatenate([rgb, cover[..., None]], -1)
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(
            os.path.join(OUT, f'{atlas}_c.webp'), 'WEBP', quality=88, alpha_quality=90, method=6)
        Image.fromarray((np.clip(nor, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(
            os.path.join(OUT, f'{atlas}_n.webp'), 'WEBP', quality=86, method=6)
        for s in ('c', 'n'):
            p = os.path.join(OUT, f'{atlas}_{s}.webp')
            print(f'{os.path.relpath(p)}: {os.path.getsize(p) / 1024:.0f} KB')
    with open(os.path.join(OUT, 'cards.json'), 'w') as f:
        json.dump(rects, f, indent=1)


if __name__ == '__main__':
    main()
