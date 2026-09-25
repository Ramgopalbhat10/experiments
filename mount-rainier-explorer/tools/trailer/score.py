"""Trailer score: 60 s, D major, 80 BPM (one bar = 3 s), cuts on the beat.

Fingerpicked Karplus-Strong guitar, warm saw pads, a celesta-like bell melody,
soft kick, cymbal swells and the park's ambience (wind, fire, crickets,
radio static) timed to the edit.
"""
import numpy as np
from scipy.signal import lfilter, butter, sosfilt, fftconvolve
import wave

SR = 48000
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N)
Rr = np.zeros(N)
BAR, BEAT = 3.0, 0.75


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * l * 1.414
    Rr[i:i + len(sig)] += sig * r * 1.414


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def env(n, a, r_start=None, r=0.05):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    if r_start is not None:
        rs, nr = int(r_start * SR), int(r * SR)
        if rs < n:
            e[rs:rs + nr] *= np.linspace(1, 0, min(nr, n - rs))
            e[rs + nr:] = 0
    return e


# --- instruments --------------------------------------------------------------
def pluck(m, dur=3.2, bright=0.5, decay=0.9975):
    f = midi(m)
    period = SR / f
    Np = int(period)
    frac = period - Np
    n = int(dur * SR)
    x = np.zeros(n)
    burst = rng.uniform(-1, 1, Np)
    burst = lp(burst, 800 + 5000 * bright, 1)
    burst -= burst.mean()
    x[:Np] = burst
    # two-point average in the loop, fractional delay via the averaging weights
    a = np.zeros(Np + 2)
    a[0] = 1
    a[Np] = -decay * (1 - frac * 0.5)
    a[Np + 1] = -decay * (frac * 0.5)
    a[Np] += -decay * 0.0
    y = lfilter([1.0], a, x)
    y = lfilter([0.5, 0.5], [1.0], y)
    y *= np.exp(-np.arange(n) / (SR * dur * 0.55))
    y = hp(y, 70)
    return y / (np.abs(y).max() + 1e-9)


def saw_pad(ms, dur, attack=1.2, release=1.2, cutoff=1400, detune=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in ms:
        for d in (-detune, 0, detune):
            f = midi(m + d)
            ph = rng.uniform(0, 1)
            out += 2 * ((t * f + ph) % 1) - 1
    out = lp(out, cutoff, 2)
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / release).clip(0, 1)
    return out * e / (len(ms) * 3)


def strings(ms, dur, attack=1.5, release=1.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in ms:
        for d in (-0.08, 0.05, 0.11):
            f = midi(m + d) * (1 + 0.003 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6)))
            ph = np.cumsum(f) / SR
            out += 2 * ((ph + rng.uniform(0, 1)) % 1) - 1
    out = lp(out, 2600, 2)
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / release).clip(0, 1)
    return out * e / (len(ms) * 3)


def bell(m, dur=2.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = midi(m)
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2)
         + 0.35 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 4)
         + 0.18 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 7)
         + 0.08 * np.sin(2 * np.pi * f * 4.2 * t) * np.exp(-t * 11))
    y *= np.minimum(1, t / 0.004)
    return y * 0.6


def kick(dur=0.6, f0=110, f1=42):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    return y * np.minimum(1, t / 0.002)


def boom(dur=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 34 + 60 * np.exp(-t * 9)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.1)
    noise = lp(rng.normal(0, 1, n), 300) * np.exp(-t * 3) * 0.6
    return (y + noise) * np.minimum(1, t / 0.003)


def swell(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = hp(rng.normal(0, 1, n), 3000) * (t / dur) ** 3
    return y * 0.5


def noise_bed(dur, lo, hi):
    return bp(rng.normal(0, 1, int(dur * SR)), lo, hi)


# --- harmony ------------------------------------------------------------------
# (bass, [chord tones]) per bar; bar 0 starts at t = 0
D = (50, [57, 62, 66, 69])
Dsus = (50, [57, 62, 64, 69])
Acs = (49, [57, 64, 69, 64])
Bm = (47, [54, 59, 62, 66])
G = (43, [50, 55, 59, 62])
Em = (52, [59, 64, 67, 71])
A = (45, [52, 57, 61, 64])
bars = [D, Dsus, D, Acs, Bm, G, D, A, Bm, G, D, A, Bm, G, Em, A, D, G, D, D]

# pads under everything (quiet in the intro, rising to the finale)
pad_gain = [0.15, 0.19, 0.18, 0.2, 0.2, 0.2, 0.22, 0.24, 0.24, 0.26, 0.26, 0.28, 0.3, 0.3, 0.22, 0.2, 0.22, 0.34, 0.4, 0.3]
for b, (bass, tones) in enumerate(bars):
    dur = BAR + 1.4 if b < 19 else 4.5
    pad = saw_pad([bass + 12] + [x for x in tones[:3]], dur, attack=0.8 if b else 3.0, release=1.4, cutoff=900 + 90 * b)
    add(pad, b * BAR, pad_gain[b], pan=0)

# strings from bar 7, and big in the finale
for b in range(7, 20):
    bass, tones = bars[b]
    g = 0.0 if b in (14, 15, 16) else (0.16 if b < 17 else 0.3)
    if g:
        add(strings([tones[0] + 12, tones[1] + 12, tones[2] + 12], BAR + 1.2 if b < 19 else 4.0), b * BAR, g, pan=0.25 * (1 if b % 2 else -1))
# low strings for weight
for b in (17, 18, 19):
    bass, _ = bars[b]
    add(strings([bass, bass + 7], BAR + 1.0 if b < 19 else 4.0), b * BAR, 0.22)

# fingerpicked guitar: eighth-note pattern per bar
pattern = [0, 2, 3, 1, 2, 3, 1, 2]
for b, (bass, tones) in enumerate(bars):
    if b < 2:
        continue
    sparse = b in (14, 15, 16)
    for k, p in enumerate(pattern):
        if sparse and k % 2:
            continue
        m = bass if k == 0 else tones[p]
        t = b * BAR + k * BEAT / 2 + rng.uniform(0, 0.012)
        vel = (0.5 if k == 0 else 0.32) * (1.0 if not sparse else 0.8) * (1.15 if b >= 17 else 1)
        add(pluck(m, 3.0, bright=0.35 + 0.1 * (k == 0)), t, vel, pan=-0.35 + 0.1 * p)
# intro: harmonics ringing out over the aerial
for t, m in [(0.4, 74), (1.9, 69), (3.4, 78), (4.9, 81)]:
    add(bell(m, 3.0), t, 0.22, pan=0.3)
    add(pluck(m - 12, 3.0, bright=0.2), t, 0.18, pan=-0.3)

# bell melody (celesta) bars 7-13 and the finale
mel = [
    (7, [(0, 78), (1, 76), (2, 74), (3.0, 76)]),
    (8, [(0, 74), (1.5, 73), (2.5, 71)]),
    (9, [(0, 71), (1, 74), (2, 79), (3, 78)]),
    (10, [(0, 78), (1, 76), (2, 74), (2.5, 76)]),
    (11, [(0, 76), (1.5, 73), (2.5, 69)]),
    (12, [(0, 74), (1, 78), (2, 81), (3, 79)]),
    (13, [(0, 79), (1, 78), (2, 74)]),
    (17, [(0, 79), (1, 81), (2, 83), (3, 81)]),
    (18, [(0, 81), (1, 78), (2, 76), (3, 78)]),
    (19, [(0, 74)]),
]
for b, notes in mel:
    for beat, m in notes:
        add(bell(m, 3.0), b * BAR + beat * BEAT, 0.2 if b < 17 else 0.26, pan=0.2)

# soft kick: bars 9-13 on 1 and 3, every beat in the gameplay bars, finale on 1 and 3
for b in range(9, 19):
    if b in (14, 15, 16):
        continue
    beats = [0, 1, 2, 3] if b in (12, 13) else [0, 2]
    for bt in beats:
        add(kick(), b * BAR + bt * BEAT, 0.45 if b < 17 else 0.6)
# toms / build into the finale
for i, t in enumerate(np.arange(48.75, 51.0, BEAT / 2)):
    add(kick(0.5, 180, 70), t, 0.12 + 0.05 * i, pan=0.2 * (-1) ** i)

# cymbal swells and impacts
add(swell(3.0), 48.0, 0.35)
add(swell(3.0), 54.0, 0.45)
add(boom(), 51.0, 0.55)
add(boom(), 57.0, 0.8)
add(swell(1.5), 4.5, 0.18)
add(hp(rng.normal(0, 1, int(SR * 3.0)), 5000) * np.exp(-np.arange(int(SR * 3.0)) / SR * 1.2) * 0.25, 51.0, 1.0)

# --- ambience -----------------------------------------------------------------
t_all = np.arange(N) / SR
wind = noise_bed(DUR, 200, 900) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.09 * t_all + 1.3)) * 0.05
wind *= np.clip(1 - np.abs(t_all - 3) / 9, 0.25, 1) * np.where((t_all > 42) & (t_all < 51), 0.3, 1)
add(wind, 0, 1.0)
# creek/falls at Myrtle (6-10.5 s)
water = noise_bed(4.9, 400, 5000) * env(int(4.9 * SR), 0.3, 4.4, 0.5)
add(water, 5.8, 0.06)
# radio static and squelch into the radio shot (40 s)
st = bp(rng.normal(0, 1, int(0.35 * SR)), 1200, 4200) * env(int(0.35 * SR), 0.005, 0.3, 0.05)
add(st, 40.0, 0.25, pan=0.3)
add(bp(rng.normal(0, 1, int(0.12 * SR)), 1500, 3500), 41.7, 0.12, pan=0.3)
# campfire crackle (42-46.5)
cr = np.zeros(int(4.8 * SR))
for _ in range(90):
    i = rng.integers(0, len(cr) - 800)
    cr[i:i + 600] += hp(rng.normal(0, 1, 600), 2000) * np.exp(-np.arange(600) / 90) * rng.uniform(0.3, 1)
cr += lp(rng.normal(0, 1, len(cr)), 500) * 0.15
add(cr * env(len(cr), 0.3, 4.3, 0.5), 42.0, 0.22, pan=-0.1)
# crickets under the stars (46.5-51)
n_cr = int(4.8 * SR)
tc = np.arange(n_cr) / SR
chirp = np.sin(2 * np.pi * 4300 * tc) * (np.sin(2 * np.pi * 28 * tc) > 0.3) * (np.sin(2 * np.pi * 1.6 * tc) > 0)
add(chirp * env(n_cr, 0.5, 4.2, 0.6), 46.4, 0.018, pan=0.5)
add(np.roll(chirp, 7000) * env(n_cr, 0.5, 4.2, 0.6), 46.6, 0.013, pan=-0.5)

# --- mix ----------------------------------------------------------------------
ir_n = int(2.6 * SR)
ir_t = np.arange(ir_n) / SR
irL = rng.normal(0, 1, ir_n) * np.exp(-ir_t * 2.4)
irR = rng.normal(0, 1, ir_n) * np.exp(-ir_t * 2.4)
irL = lp(irL, 5000); irR = lp(irR, 5000)
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wetL = fftconvolve(L, irL)[:N]
wetR = fftconvolve(Rr, irR)[:N]
outL = L + wetL * 0.32
outR = Rr + wetR * 0.32
# master: gentle low-cut, soft clip, fade in/out, normalise
outL, outR = hp(outL, 30), hp(outR, 30)
peak = max(np.abs(outL).max(), np.abs(outR).max())
outL, outR = outL / peak * 1.4, outR / peak * 1.4
outL, outR = np.tanh(outL), np.tanh(outR)
fade = np.ones(N)
fade[: int(0.4 * SR)] = np.linspace(0, 1, int(0.4 * SR))
fo = int(2.2 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
outL *= fade; outR *= fade
peak = max(np.abs(outL).max(), np.abs(outR).max())
outL, outR = outL / peak * 0.89, outR / peak * 0.89

pcm = (np.stack([outL, outR], 1) * 32767).astype(np.int16)
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote score.wav', pcm.shape)
