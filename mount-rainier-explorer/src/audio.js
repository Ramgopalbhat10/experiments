/**
 * Procedural ambience with WebAudio: wind that rises with altitude, the roar of
 * nearby waterfalls and rivers, footsteps that change with the ground, and the
 * occasional bird in the forest. No audio files needed.
 */
export class Ambience {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.985 * b + 0.015 * w * 4;   // brown-ish
      d[i] = b * 0.6 + w * 0.08;
    }
    this.noise = noise;
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(0, Math.random() * 3);
      return s;
    };

    // wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // water
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass';
    this.waterFilter.frequency.value = 1400;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    loop().connect(hp).connect(this.waterFilter).connect(this.waterGain).connect(this.master);

    this.nextBird = ctx.currentTime + 4;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  update({ altitude, waterDist, waterSize, forest, night, dt }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    const wind = Math.min(1, 0.15 + Math.max(0, altitude - 1200) / 2200) * gust;
    this.windGain.gain.setTargetAtTime(wind * 0.35, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(350 + gust * 500, t, 0.5);
    const w = waterDist < Infinity ? Math.min(1, (waterSize * 12) / (waterDist + 10)) : 0;
    this.waterGain.gain.setTargetAtTime(w * 0.55, t, 0.3);

    if (t > this.nextBird) {
      this.nextBird = t + 3 + Math.random() * 9;
      if (forest > 0.3 && !night) this._chirp(Math.random() < 0.5 ? 'thrush' : 'chick');
      else if (!night && altitude > 1500 && Math.random() < 0.4) this._chirp('marmot');
    }
  }

  _chirp(kind) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = 'sine';
    g.gain.value = 0;
    const out = pan ? (pan.pan.value = Math.random() * 2 - 1, o.connect(g).connect(pan), pan) : o.connect(g);
    out.connect(this.master);
    if (kind === 'thrush') {
      // varied thrush: a long, buzzy, single note
      const f = 2600 + Math.random() * 1600;
      o.frequency.setValueAtTime(f, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.15);
      g.gain.linearRampToValueAtTime(0.03, t + 1.2);
      g.gain.linearRampToValueAtTime(0, t + 1.5);
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 48; lg.gain.value = 40;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + 1.6);
      o.start(t); o.stop(t + 1.6);
    } else if (kind === 'chick') {
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.16;
        o.frequency.setValueAtTime(4200, s);
        o.frequency.exponentialRampToValueAtTime(2800, s + 0.08);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.03, s + 0.01);
        g.gain.linearRampToValueAtTime(0, s + 0.09);
      }
      o.start(t); o.stop(t + 0.6);
    } else {
      // hoary marmot whistle
      o.frequency.setValueAtTime(2900, t);
      o.frequency.linearRampToValueAtTime(2500, t + 0.35);
      g.gain.linearRampToValueAtTime(0.03, t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + 0.4);
      o.start(t); o.stop(t + 0.45);
    }
  }

  step(surface, speed) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const cfg = {
      snow: ['lowpass', 900, 0.22, 0.12],
      rock: ['bandpass', 2200, 0.12, 0.05],
      trail: ['bandpass', 1300, 0.14, 0.07],
      meadow: ['bandpass', 3200, 0.07, 0.06],
      forest: ['lowpass', 700, 0.18, 0.07],
      water: ['highpass', 1500, 0.16, 0.12],
    }[surface] || ['bandpass', 1300, 0.12, 0.06];
    f.type = cfg[0];
    f.frequency.value = cfg[1] * (0.85 + Math.random() * 0.3);
    const vol = cfg[2] * Math.min(1.3, 0.6 + speed / 8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + cfg[3] + 0.05);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 3.5, cfg[3] + 0.08);
  }
}

// ---------------------------------------------------------------------------
// Radio music: generative fingerpicked guitar (Karplus-Strong strings), a warm
// pad and the odd melody line. No audio files; every track is procedural.

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export const TRACKS = [
  { name: 'Two Forks', bpm: 70, chords: [[50, 57, 62, 66, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 62], [45, 52, 57, 61, 64]], scale: [62, 64, 66, 69, 71, 74, 76, 78], pattern: [0, 2, 3, 4, 3, 2, 1, 2], melody: 0.25 },
  { name: 'Paradise Meadows', bpm: 84, chords: [[43, 50, 55, 59, 62], [42, 50, 54, 57, 62], [40, 47, 52, 55, 59], [36, 48, 52, 55, 60]], scale: [67, 69, 71, 74, 76, 79, 81], pattern: [0, 3, 2, 4, 1, 3, 2, 4], melody: 0.35 },
  { name: 'Lookout at Dusk', bpm: 64, chords: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]], scale: [57, 60, 62, 64, 67, 69, 72], pattern: [0, 2, 4, 2, 3, 2, 4, 1], melody: 0.2 },
  { name: 'Carbon River', bpm: 76, chords: [[40, 47, 52, 55, 59], [36, 48, 52, 55, 60], [43, 50, 55, 59, 62], [38, 50, 54, 57, 62]], scale: [64, 67, 69, 71, 74, 76, 79], pattern: [0, 1, 2, 3, 4, 3, 2, 1], melody: 0.4 },
  { name: 'Night Watch', bpm: 56, chords: [[38, 45, 50, 53, 57], [34, 46, 50, 53, 58], [41, 48, 53, 57, 60], [36, 48, 52, 55, 60]], scale: [62, 65, 67, 69, 72, 74], pattern: [0, 4, 2, 3], melody: 0.15 },
];

export class MusicPlayer {
  constructor(ambience) {
    this.amb = ambience;
    this.index = 0;
    this.playing = false;
    this.cache = new Map();
    this.onTrack = null;
  }

  get ctx() { return this.amb.ctx; }

  _pluck(midi) {
    let b = this.cache.get(midi);
    if (b) return b;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const f = midiHz(midi), dur = 3.2;
    const n = Math.floor(sr * dur), period = Math.max(2, Math.round(sr / f));
    b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.5 + w * 0.5; ring[i] = prev; }
    const decay = 0.994 + Math.min(0.005, 40 / f * 0.01);
    let idx = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const cur = ring[idx], nxt = ring[(idx + 1) % period];
      ring[idx] = (cur + nxt) * 0.5 * decay;
      lp += (cur - lp) * 0.55;                  // soften the attack like a nylon string
      d[i] = lp * (i < 60 ? i / 60 : 1);
      idx = (idx + 1) % period;
    }
    this.cache.set(midi, b);
    return b;
  }

  _note(midi, t, vol, pan = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this._pluck(midi);
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = s.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(this.out);
    s.start(t);
  }

  _pad(chord, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp).connect(this.out);
    for (const m of [chord[0] + 12, chord[2], chord[3]]) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  toggle() { this.playing ? this.stop() : this.play(); return this.playing; }

  play(index = this.index) {
    if (!this.ctx) this.amb.start();
    if (!this.ctx) return;
    this.index = (index + TRACKS.length) % TRACKS.length;
    if (!this.out) {
      this.out = this.ctx.createGain();
      // a little small-speaker colour: it is a handheld radio after all
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
      this.out.connect(hp).connect(this.amb.master);
    }
    this.out.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.3);
    this.playing = true;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.3;
    clearInterval(this.timer);
    this.timer = setInterval(() => this._schedule(), 60);
    this.onTrack?.(TRACKS[this.index], true);
  }

  nextTrack() { this.play(this.index + 1); }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    if (this.out) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    this.onTrack?.(TRACKS[this.index], false);
  }

  _schedule() {
    const tr = TRACKS[this.index];
    const eighth = 60 / tr.bpm / 2;
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.25) {
      const bar = Math.floor(this.step / 8);
      const chord = tr.chords[Math.floor(bar / 2) % tr.chords.length];
      const k = this.step % 8;
      const t = this.next + (Math.random() - 0.5) * 0.012;  // human timing
      if (k === 0) {
        this._note(chord[0], t, 0.5, -0.2);                 // bass on the downbeat
        if (bar % 2 === 0) this._pad(chord, t, eighth * 16);
      }
      const tone = chord[tr.pattern[k % tr.pattern.length]];
      if (k !== 0 || tr.pattern.length < 8) this._note(tone + (k === 7 ? 12 : 0), t, 0.28 + Math.random() * 0.08, 0.15);
      if (Math.random() < tr.melody && k % 2 === 0) {
        const m = tr.scale[Math.floor(Math.random() * tr.scale.length)];
        this._note(m + 12, t + eighth * 0.02, 0.22, 0.35);
      }
      this.step++;
      this.next += eighth;
    }
  }
}

/** Short burst of radio static (for ranger chatter). */
export function radioStatic(amb) {
  const ctx = amb.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = amb.noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  s.connect(f).connect(g).connect(amb.master);
  s.start(t, Math.random() * 3, 0.4);
}
