import { makeShots, STATEMENTS, CAPTIONS, END_CARD } from './shots.js';

/**
 * ?trailer: plays the launch trailer live in the browser, so it can be
 * screen-recorded at full frame rate on a machine with a GPU. The score's
 * AudioContext clock is the master timeline; each frame the current shot
 * drives the camera, and a DOM overlay draws the titles.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fade = (t, t0, t1, fi = 0.45, fo = 0.45) => (t < t0 || t > t1 ? 0 : clamp01(Math.min((t - t0) / fi, (t1 - t) / fo)));

export class Trailer {
  constructor({ R, C, assets, onExit, hookStart = true, muteGame }) {
    this.R = R;
    this.C = C;
    this.onExit = onExit;
    this.muteGame = muteGame;
    this.shots = makeShots(R, C);
    this.starts = [0];
    for (const s of this.shots) this.starts.push(this.starts[this.starts.length - 1] + s.dur);
    this.film = this.starts[this.starts.length - 1];   // 57 s of footage
    this.total = this.film + END_CARD;                  // + 3 s end card
    this.state = 'idle';
    this.k = -1;
    this.audioData = fetch(`${assets}/trailer-score.mp3`).then((r) => r.arrayBuffer()).catch(() => null);
    this._dom();
    document.body.classList.add('trailer-mode');
    if (hookStart) {
      const btn = document.getElementById('start-btn');
      btn.textContent = 'Play trailer';
      btn.onclick = () => this.play();
    }
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.state !== 'idle') this.onExit(); });
  }

  _dom() {
    const el = (cls, parent, html = '') => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      parent.appendChild(d);
      return d;
    };
    const root = (this.root = el('trailer', document.body));
    el('tr-vignette', root);
    this.loc = el('tr-loc', root, '<i></i><b></b><span></span>');
    this.stmt = el('tr-statement', root, '<small></small><b></b>');
    this.cap = el('tr-caption', root, '<b></b>');
    this.black = el('tr-black', root);
    this.end = el('tr-end', root, `
      <h1>RAINIER</h1><i></i>
      <p>A Firewatch-inspired walk through Mount Rainier National Park</p>
      <small>Play free in your browser</small>
      <div class="tr-actions"><button class="btn" data-a="replay">Replay</button><button class="btn primary" data-a="play">Explore the park</button></div>`);
    this.end.querySelector('[data-a=replay]').onclick = () => { this.state = 'idle'; this.play(); };
    this.end.querySelector('[data-a=play]').onclick = () => this.onExit();
    this.msg = el('tr-msg', root);
  }

  async play() {
    this.muteGame?.();
    document.getElementById('intro').classList.add('gone');
    this.root.classList.add('on');
    this.end.classList.remove('done');
    this.black.style.opacity = 1;
    this.msg.textContent = 'Preparing the trailer…';
    try { await document.documentElement.requestFullscreen?.(); } catch (e) { /* not allowed: carry on windowed */ }
    // the AudioContext must be created inside the click
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = this.ctx || (AC ? new AC() : null);
    await this.ctx?.resume();
    const data = await this.audioData;
    if (data && this.ctx && !this.buffer) {
      try { this.buffer = await this.ctx.decodeAudioData(data.slice(0)); } catch (e) { this.buffer = null; }
    }
    // Pre-warm: visit every shot once (compiles shaders, fills the vegetation
    // and path caches) so the cuts don't hitch.
    const V = this.R.vegetation, M = this.R.meadow;
    V.cacheLimit = M.cacheLimit = 40000;
    for (let i = 0; i < this.shots.length; i++) {
      this.msg.textContent = `Preparing the trailer… ${Math.round((i / this.shots.length) * 100)}%`;
      const s = this.shots[i];
      s.setup();
      s.frame(0, 0);
      this.C.step(0);
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    this.msg.textContent = '';
    this.k = -1;
    const lead = 0.25;
    if (this.buffer) {
      this.src?.stop();
      const src = (this.src = this.ctx.createBufferSource());
      src.buffer = this.buffer;
      src.connect(this.ctx.destination);
      this.t0 = this.ctx.currentTime + lead;
      src.start(this.t0);
    } else {
      this.t0 = null;
      this.p0 = performance.now() + lead * 1000;
    }
    this.state = 'playing';
  }

  now() {
    return this.t0 != null ? this.ctx.currentTime - this.t0 : (performance.now() - this.p0) / 1000;
  }

  update() {
    if (this.state !== 'playing') return;
    const T = this.now();
    const shots = this.shots;
    if (T < this.film) {
      let k = 0;
      while (k < shots.length - 1 && T >= this.starts[k + 1]) k++;
      if (k !== this.k) { this.k = k; shots[k].setup(); }
      const s = shots[k];
      s.frame(clamp01((T - this.starts[k]) / s.dur), T - this.starts[k]);
    }
    this._overlay(T);
    if (T > this.total + 0.3) {
      this.state = 'done';
      this.end.classList.add('done');
    }
  }

  _overlay(T) {
    const film = this.film;
    // black: fade in, a short dip from the camp into the night, fade into the end card
    const dipAt = this.starts[12];
    let b = Math.max(1 - T / 0.9, 1 - Math.abs(T - dipAt) / 0.35, (T - (film - 1)) / 1);
    if (T >= film) b = 1;
    this.black.style.opacity = clamp01(b).toFixed(3);

    // location label, lower left, for the first seconds of a shot
    const k = this.k, s = this.shots[k];
    let la = 0;
    if (s?.label && T < film) {
      const t0 = this.starts[k] + 0.35, t1 = Math.min(t0 + 3, this.starts[k + 1] - 0.1);
      la = fade(T, t0, t1, 0.5, 0.5);
      if (this.loc.dataset.k !== String(k)) {
        this.loc.dataset.k = k;
        this.loc.querySelector('b').textContent = s.label;
        this.loc.querySelector('span').textContent = s.sub;
      }
      this.loc.style.transform = `translateY(${((1 - clamp01((T - t0) / 0.5)) * 0.6).toFixed(3)}vw)`;
    }
    this.loc.style.opacity = la.toFixed(3);

    // big statements, slowly tracking out
    const st = STATEMENTS.find((x) => T >= x.t0 && T <= x.t1);
    if (st) {
      const p = (T - st.t0) / (st.t1 - st.t0);
      const b = this.stmt.querySelector('b');
      b.textContent = st.text;
      // Oswald caps are ~0.46 em wide: keep the longest line inside ~88% of the frame
      b.style.fontSize = `${Math.min(3.5, (88 / st.text.length - 0.83) / 0.46).toFixed(3)}vw`;
      b.style.letterSpacing = `${(0.52 + 0.31 * p).toFixed(3)}vw`;
      this.stmt.querySelector('small').textContent = st.kicker || '';
      this.stmt.style.opacity = fade(T, st.t0, st.t1, 0.55, 0.5).toFixed(3);
    } else this.stmt.style.opacity = 0;

    const cp = CAPTIONS.find((x) => T >= x.t0 && T <= x.t1);
    if (cp) {
      this.cap.querySelector('b').textContent = cp.text;
      this.cap.style.opacity = fade(T, cp.t0, cp.t1, 0.25, 0.25).toFixed(3);
    } else this.cap.style.opacity = 0;

    // end card
    if (T >= film) {
      const te = T - film;
      this.end.style.opacity = clamp01(te / 0.5).toFixed(3);
      this.end.style.setProperty('--te', clamp01(te / END_CARD).toFixed(3));
      this.end.style.setProperty('--sub', clamp01((te - 0.5) / 0.6).toFixed(3));
    } else this.end.style.opacity = 0;
  }
}
