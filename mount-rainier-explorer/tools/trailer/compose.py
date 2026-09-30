"""Edit + titles + encode: frames/<shot>/NNNN.png + score.wav -> MP4 (1920x1080, 24 fps).

    pip install numpy pillow imageio-ffmpeg
    python3 compose.py [framesDir] [out.mp4]
    CRF=22 MAXRATE=3.5M BUFSIZE=7M ABR=160k python3 compose.py frames share.mp4   # < 30 MB
Env: LIMIT=<seconds> encodes only the start. Run from the working directory
that holds frames/ and score.wav (made by score.py).
"""
import os, sys, glob, subprocess, math, re, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

HERE = os.getcwd()
W, H, FPS = 1920, 1080, 24
FR = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else 'frames')
OUT = os.path.join(HERE, sys.argv[2] if len(sys.argv) > 2 else 'rainier_trailer.mp4')
ONLY = sys.argv[3] if len(sys.argv) > 3 else None   # e.g. "stills" to dump a few frames instead of encoding


def ensure_fonts():
    """Fetch Oswald and Work Sans (the game's fonts) as TTF from Google Fonts."""
    d = os.path.join(HERE, 'fonts')
    if os.path.exists(os.path.join(d, 'Oswald-700.ttf')):
        return
    os.makedirs(d, exist_ok=True)
    req = urllib.request.Request('https://fonts.googleapis.com/css2?family=Oswald:wght@300;500;700&family=Work+Sans:ital,wght@0,400;0,600;1,400', headers={'User-Agent': 'Wget/1.0'})
    css = urllib.request.urlopen(req).read().decode()
    for fam, style, w, url in re.findall(r"font-family: '([^']+)';\s*font-style: (\w+);\s*font-weight: (\d+);\s*src: url\(([^)]+)\)", css):
        name = f"{fam.replace(' ', '')}-{w}{'i' if style == 'italic' else ''}.ttf"
        urllib.request.urlretrieve(url, os.path.join(d, name))


ensure_fonts()
F = lambda n, s: ImageFont.truetype(os.path.join(HERE, 'fonts', n + '.ttf'), s)
ACCENT = (232, 112, 58)

# (shot, seconds, location label, sub label)
SEQ = [
    ('s01_aerial_paradise', 6.0, 'PARADISE', '5,400 FT · GOLDEN HOUR'),
    ('s02_myrtle', 4.5, 'MYRTLE FALLS', 'SKYLINE TRAIL · 5,482 FT'),
    ('s03_skyline_walk', 4.5, 'SKYLINE TRAIL', 'PARADISE MEADOWS'),
    ('s04_glaciervista', 4.5, 'GLACIER VISTA', 'TATOOSH RANGE · 6,336 FT'),
    ('s07_sunrise_aerial', 3.0, 'SUNRISE', 'EMMONS GLACIER · 6,400 FT'),
    ('s05_eunice', 4.5, 'EUNICE LAKE', 'MOWICH · 5,354 FT'),
    ('s06_louise', 4.5, 'LOUISE LAKE', 'STEVENS CANYON · 4,600 FT'),
    ('s08_fremont_sunset', 4.5, 'MOUNT FREMONT LOOKOUT', '7,181 FT · SUNSET'),
    ('s09a_fp_map', 2.0, None, None),
    ('s09b_fp_binoculars', 2.0, None, None),
    ('s09c_fp_radio', 2.0, None, None),
    ('s10_camp_dusk', 4.5, None, None),
    ('s11_stargaze', 4.5, None, None),
    ('s12_finale_reflection', 6.0, 'REFLECTION LAKES', '4,854 FT · ALPENGLOW'),
]
END_CARD = 3.0
TOTAL = sum(s[1] for s in SEQ) + END_CARD
starts = np.cumsum([0] + [s[1] for s in SEQ])

# big centred statements: (t0, t1, text, size)
STATEMENTS = [
    (1.1, 5.5, '1,600 KM² OF REAL TERRAIN', 70),
    (15.4, 19.2, 'EVERY TRAIL. EVERY VIEWPOINT.', 64),
    (27.3, 31.3, 'WATERFALLS. ALPINE LAKES. FALL COLOUR.', 58),
    (42.3, 46.2, 'MAKE CAMP. COOK. REST.', 64),
    (46.8, 50.8, 'STAY FOR THE STARS', 64),
    (52.6, 56.2, 'THE MOUNTAIN IS OUT', 64),
]
KICKERS = [(0.9, 5.5, 'MOUNT RAINIER NATIONAL PARK · WASHINGTON')]
# gameplay captions (upper third, over a soft band)
GAMEPLAY = [(36.15, 37.9, 'READ THE MAP'), (38.1, 39.9, 'SCOUT THE PEAKS'), (40.1, 41.9, 'LISTEN TO THE RANGER')]


def tracked(draw_img, text, font, spacing, cx, cy, fill, anchor='mm'):
    """Draw text with extra letter spacing, centred on (cx, cy)."""
    d = ImageDraw.Draw(draw_img)
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = cx - total / 2 if anchor[0] == 'm' else cx
    asc, desc = font.getmetrics()
    y = cy - (asc + desc) / 2 if anchor[1] == 'm' else cy
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += w + spacing
    return total


def shadowed(base, drawfn, blur=10, strength=150):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    drawfn(layer, (255, 255, 255, 255))
    shadow = Image.new('RGBA', base.size, (0, 0, 0, 0))
    drawfn(shadow, (0, 0, 0, strength))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow)
    base.alpha_composite(layer)


def fade(t, t0, t1, fi=0.45, fo=0.45):
    if t < t0 or t > t1:
        return 0.0
    return max(0.0, min(1.0, (t - t0) / fi, (t1 - t) / fo))


def with_alpha(img, a):
    if a >= 0.999:
        return img
    r, g, b, al = img.split()
    al = al.point(lambda v: int(v * a))
    return Image.merge('RGBA', (r, g, b, al))


cache = {}


def shot_frame(name, idx):
    files = cache.get(name)
    if files is None:
        files = sorted(glob.glob(os.path.join(FR, name, '*.png')))
        if not files:
            files = sorted(glob.glob(os.path.join(HERE, 'preview', name, '*.png')))
        cache[name] = files
    if not files:
        return Image.new('RGB', (W, H), (30, 30, 30))
    # frames are named by index; fall back to the nearest one we have
    want = os.path.join(FR, name, f'{idx:04d}.png')
    f = want if os.path.exists(want) else files[min(len(files) - 1, int(idx / max(1, round(dict((s[0], s[1]) for s in SEQ)[name] * FPS)) * len(files)))]
    im = Image.open(f).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))
    return im


def base_frame(t):
    k = int(np.searchsorted(starts, t, side='right') - 1)
    if k >= len(SEQ):
        return None, k
    name, dur = SEQ[k][0], SEQ[k][1]
    idx = min(int(round((t - starts[k]) * FPS)), int(round(dur * FPS)) - 1)
    im = shot_frame(name, idx)
    # dissolve from the camp into the night sky
    cut = starts[11 + 1]  # s10 -> s11
    if abs(t - cut) < 0.5 and SEQ[k][0] in ('s10_camp_dusk', 's11_stargaze'):
        a = (t - (cut - 0.5)) / 1.0
        ia = shot_frame('s10_camp_dusk', min(int(round((t - starts[11]) * FPS)), int(4.5 * FPS) - 1))
        ib = shot_frame('s11_stargaze', max(0, int(round((t - cut) * FPS))))
        im = Image.blend(ia, ib, max(0, min(1, a)))
    return im, k


# vignette, precomputed (the game already adds its own film grain)
yy, xx = np.mgrid[0:H, 0:W]
vig = 1 - 0.28 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) ** 1.4
vig = np.clip(vig, 0, 1)[..., None].astype(np.float32)

big = {s: F('Oswald-500', s) for s in (58, 64, 70)}
kick_f = F('WorkSans-600', 22)
loc_f, sub_f = F('Oswald-500', 34), F('WorkSans-600', 17)
cap_f = F('Oswald-500', 46)
title_f = F('Oswald-700', 150)
tag_f = F('WorkSans-400i', 36)
cta_f = F('WorkSans-600', 24)


def frame(i):
    t = i / FPS
    im, k = base_frame(t)
    if im is None:
        im = Image.new('RGB', (W, H), (0, 0, 0))
    arr = np.asarray(im).astype(np.float32)
    arr = arr * vig
    # fade in from black, fade out into the end card
    g = min(1.0, t / 0.9)
    end = sum(s[1] for s in SEQ)
    if t > end - 1.0:
        g *= max(0.0, (end - t) / 1.0)
    arr *= g
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('RGBA')

    # location label, lower left, first 3 s of a shot
    if k < len(SEQ) and SEQ[k][2]:
        t0 = starts[k] + 0.35
        a = fade(t, t0, min(t0 + 3.0, starts[k + 1] - 0.1), 0.5, 0.5)
        if a > 0:
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            dy = (1 - min(1, (t - t0) / 0.5)) * 10

            def draw(L, fill):
                d = ImageDraw.Draw(L)
                x, y = 96, H - 150 + dy
                d.rectangle([x, y + 4, x + 4, y + 66], fill=(ACCENT + (fill[3],)) if fill[0] else fill)
                tracked(L, SEQ[k][2], loc_f, 4, x + 22, y + 2, fill, anchor='lt')
                tracked(L, SEQ[k][3], sub_f, 4, x + 22, y + 46, fill if fill[0] == 0 else (235, 225, 210, fill[3]), anchor='lt')
            shadowed(lay, draw, blur=8, strength=160)
            img.alpha_composite(with_alpha(lay, a))

    for (t0, t1, text, size) in STATEMENTS:
        a = fade(t, t0, t1, 0.55, 0.5)
        if a > 0:
            p = (t - t0) / (t1 - t0)
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            sp = 10 + 6 * p                     # slow tracking-out, trailer style
            shadowed(lay, lambda L, fill: tracked(L, text, big[size], sp, W / 2, H * 0.47, fill), blur=14, strength=170)
            img.alpha_composite(with_alpha(lay, a))
    for (t0, t1, text) in KICKERS:
        a = fade(t, t0, t1, 0.6, 0.5)
        if a > 0:
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            shadowed(lay, lambda L, fill: tracked(L, text, kick_f, 7, W / 2, H * 0.47 - 86, fill if fill[0] == 0 else (255, 214, 170, 255)), blur=8, strength=170)
            img.alpha_composite(with_alpha(lay, a))
    for (t0, t1, text) in GAMEPLAY:
        a = fade(t, t0, t1, 0.25, 0.25)
        if a > 0:
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            band = Image.new('RGBA', (W, 150), (0, 0, 0, 0))
            bd = np.zeros((150, W, 4), np.uint8)
            prof = (np.sin(np.linspace(0, np.pi, 150)) ** 1.5 * 120).astype(np.uint8)
            bd[..., 3] = prof[:, None]
            lay.alpha_composite(Image.fromarray(bd, 'RGBA'), (0, int(H * 0.37) - 75))
            shadowed(lay, lambda L, fill: tracked(L, text, cap_f, 10, W / 2, H * 0.37, fill), blur=10, strength=160)
            img.alpha_composite(with_alpha(lay, a))

    # end card
    if t >= end:
        te = t - end
        lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        a1 = min(1, te / 0.5)
        sp = 34 + 10 * te / END_CARD
        tracked(lay, 'RAINIER', title_f, sp, W / 2, H * 0.44, (255, 244, 226, 255))
        d = ImageDraw.Draw(lay)
        wline = 120 * min(1, te / 0.8)
        d.rectangle([W / 2 - wline, H * 0.44 + 96, W / 2 + wline, H * 0.44 + 99], fill=ACCENT + (255,))
        img.alpha_composite(with_alpha(lay, a1 * min(1, (TOTAL - t) / 0.6)))
        a2 = max(0, min(1, (te - 0.5) / 0.6)) * min(1, (TOTAL - t) / 0.6)
        if a2 > 0:
            lay2 = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            tracked(lay2, 'A Firewatch-inspired walk through Mount Rainier National Park', tag_f, 1, W / 2, H * 0.44 + 160, (235, 225, 210, 255))
            tracked(lay2, 'PLAY FREE IN YOUR BROWSER', cta_f, 8, W / 2, H * 0.44 + 222, ACCENT + (255,))
            img.alpha_composite(with_alpha(lay2, a2))
    return img.convert('RGB')


if __name__ == '__main__':
    n = int(round(float(os.environ.get('LIMIT', TOTAL)) * FPS))
    if ONLY == 'stills':
        os.makedirs(os.path.join(HERE, 'stills'), exist_ok=True)
        for t in [2.5, 8, 12, 17, 21, 24, 29, 33, 37, 39, 41, 44, 49, 52, 55.5, 58.2]:
            frame(int(t * FPS)).save(os.path.join(HERE, 'stills', f'{t:05.1f}.jpg'), quality=90)
        sys.exit(0)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', os.path.join(HERE, 'score.wav'),
           '-vf', 'hqdn3d=1.5:1.5:4:4', '-c:v', 'libx264', '-maxrate', os.environ.get('MAXRATE', '14M'), '-bufsize', os.environ.get('BUFSIZE', '28M'), '-preset', 'slow', '-crf', os.environ.get('CRF', '20'), '-tune', 'film', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
           '-c:a', 'aac', '-b:a', os.environ.get('ABR', '256k'), '-shortest', '-af', f"afade=t=out:st={n / FPS - 1.0}:d=1.0", '-movflags', '+faststart', OUT]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(frame(i).tobytes())
        if i % 120 == 0:
            print('frame', i, '/', n, flush=True)
    p.stdin.close()
    p.wait()
    print('wrote', OUT)
