import { FLAG_GLACIER, FLAG_LAKE } from '../world/heightfield.js';

/**
 * A folded-paper topo map in the spirit of Firewatch's handheld map:
 * hillshade on cream paper, 100 m contours, glaciers, lakes, dashed trails,
 * and markers for every place in the journal. Click a place to travel there.
 */
export class PaperMap {
  constructor({ hf, features, places, onTravel, getPlayer, isDiscovered }) {
    this.hf = hf;
    this.features = features;
    this.places = places;
    this.onTravel = onTravel;
    this.getPlayer = getPlayer;
    this.isDiscovered = isDiscovered;
    this.el = document.getElementById('map');
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.card = document.getElementById('map-card');
    this.open = false;
    this.base = null;
    this.zoom = 1;
    this.cx = 0;
    this.cz = 0;
    this._bind();
  }

  _bind() {
    let drag = null, moved = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      const s = this._scale();
      this.cx -= dx / s; this.cz -= dy / s;
      drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && moved < 6) this._click(e);
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const before = this._toWorld(e.clientX - r.left, e.clientY - r.top);
      this.zoom = Math.min(12, Math.max(0.8, this.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
      const after = this._toWorld(e.clientX - r.left, e.clientY - r.top);
      this.cx += before[0] - after[0];
      this.cz += before[1] - after[1];
      this.draw();
    }, { passive: false });
    document.getElementById('map-close')?.addEventListener('click', () => this.toggle(false));
    document.getElementById('map-center')?.addEventListener('click', () => {
      const p = this.getPlayer();
      this.cx = p.x; this.cz = p.z; this.zoom = Math.max(this.zoom, 3);
      this.draw();
    });
    document.getElementById('map-zoom-in')?.addEventListener('click', () => { this.zoom = Math.min(12, this.zoom * 1.4); this.draw(); });
    document.getElementById('map-zoom-out')?.addEventListener('click', () => { this.zoom = Math.max(0.8, this.zoom / 1.4); this.draw(); });
    addEventListener('resize', () => this.open && this.draw());
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('open', this.open);
    if (this.open) {
      this.ensureBase();
      const p = this.getPlayer();
      this.cx = p.x; this.cz = p.z;
      if (this.zoom < 2) this.zoom = 2.2;
      this.card.classList.remove('show');
      this.draw();
    }
    return this.open;
  }

  /** The painted base map (built on first use); also used by the in-hand map. */
  ensureBase() {
    if (!this.base) this._buildBase();
    return this.base;
  }

  _scale() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return (Math.min(w, h) / this.hf.size) * this.zoom;
  }

  _toScreen(x, z) {
    const s = this._scale();
    return [(x - this.cx) * s + this.canvas.clientWidth / 2, (z - this.cz) * s + this.canvas.clientHeight / 2];
  }

  _toWorld(sx, sy) {
    const s = this._scale();
    return [(sx - this.canvas.clientWidth / 2) / s + this.cx, (sy - this.canvas.clientHeight / 2) / s + this.cz];
  }

  _buildBase() {
    const hf = this.hf, R = hf.res, S = 2048, k = R / S;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const H = hf.heights;
    for (let y = 0; y < S; y++) {
      const gy = Math.min(R - 2, Math.floor(y * k));
      for (let x = 0; x < S; x++) {
        const gx = Math.min(R - 2, Math.floor(x * k));
        const i = gy * R + gx;
        const dx = (H[i + 1] - H[i]) / hf.cell, dz = (H[i + R] - H[i]) / hf.cell;
        // light from the north-west, like a printed relief map
        let sh = 0.86 + (-dx * 0.6 - dz * 0.6) * 0.55 / Math.sqrt(1 + dx * dx + dz * dz);
        sh = Math.max(0.58, Math.min(1.08, sh));
        let r = 239, g = 227, b = 200;                         // paper
        const f = hf.cover[i * 4] / 255, m = hf.cover[i * 4 + 1] / 255, sn = hf.cover[i * 4 + 2] / 255;
        r = r * (1 - f * 0.16); g = g * (1 - f * 0.05); b = b * (1 - f * 0.2);
        r -= m * 12; b -= m * 18;
        const fl = hf.flags[i];
        if (fl & FLAG_GLACIER || sn > 0.5) { r = 248; g = 250; b = 252; sh = 0.9 + (sh - 0.86) * 0.6; }
        if (fl & FLAG_LAKE) { r = 132; g = 180; b = 196; sh = 1; }
        const o = (y * S + x) * 4;
        d[o] = r * sh; d[o + 1] = g * sh; d[o + 2] = b * sh * 0.97; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const toPx = (x, z) => [((x + hf.half) / hf.size) * S, ((z + hf.half) / hf.size) * S];
    // contours via marching squares on a 1024 grid
    const G = 1024, gk = R / G, cell = hf.size / G;
    const hs = new Float32Array(G * G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) hs[y * G + x] = H[Math.floor(y * gk) * R + Math.floor(x * gk)];
    const drawLevels = (step, width, color) => {
      ctx.beginPath();
      for (let y = 0; y < G - 1; y++) {
        for (let x = 0; x < G - 1; x++) {
          const a = hs[y * G + x], b = hs[y * G + x + 1], c = hs[(y + 1) * G + x + 1], dd = hs[(y + 1) * G + x];
          const lo = Math.min(a, b, c, dd), hi = Math.max(a, b, c, dd);
          for (let L = Math.ceil(lo / step) * step; L < hi; L += step) {
            const pts = [];
            const edge = (v0, v1, x0, y0, x1, y1) => {
              if ((v0 < L) !== (v1 < L)) {
                const t = (L - v0) / (v1 - v0);
                pts.push([(x0 + (x1 - x0) * t) * cell, (y0 + (y1 - y0) * t) * cell]);
              }
            };
            edge(a, b, x, y, x + 1, y); edge(b, c, x + 1, y, x + 1, y + 1);
            edge(c, dd, x + 1, y + 1, x, y + 1); edge(dd, a, x, y + 1, x, y);
            for (let i = 0; i + 1 < pts.length; i += 2) {
              const p = [pts[i][0] / hf.size * S, pts[i][1] / hf.size * S];
              const q = [pts[i + 1][0] / hf.size * S, pts[i + 1][1] / hf.size * S];
              ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
            }
          }
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    drawLevels(100, 0.6, 'rgba(140, 96, 52, 0.28)');
    drawLevels(500, 1.1, 'rgba(120, 76, 40, 0.45)');

    const line = (pts, color, w, dash = []) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = toPx(pts[i], pts[i + 1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
    };
    for (const s of this.features.streams) line(s.p, s.k ? 'rgba(70,130,170,0.9)' : 'rgba(80,140,180,0.55)', s.k ? 1.6 : 0.7);
    for (const r of this.features.roads) if (r.k >= 1) line(r.p, 'rgba(60,40,30,0.85)', r.k >= 2 ? 2.2 : 1.4);
    for (const t of this.features.trails) line(t.p, 'rgba(165,52,34,0.9)', 1.2, [4, 3]);
    ctx.setLineDash([]);
    for (const L of this.features.lakes) {
      for (const ring of L.outer) {
        ctx.beginPath();
        for (let i = 0; i < ring.length; i += 2) {
          const [x, y] = toPx(ring[i], ring[i + 1]);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgb(132,180,196)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(50,100,130,0.8)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
    // paper grain
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    this.base = cv;
  }

  draw() {
    const c = this.canvas, dpr = Math.min(devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#d8c9a8';
    ctx.fillRect(0, 0, w, h);
    const hf = this.hf;
    const [x0, y0] = this._toScreen(-hf.half, -hf.half);
    const size = hf.size * this._scale();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, x0, y0, size, size);

    // labels: peaks & glaciers at higher zooms
    ctx.textAlign = 'center';
    const z = this.zoom;
    ctx.font = `600 ${Math.min(14, 9 + z)}px "Oswald", sans-serif`;
    if (z > 2.5) {
      for (const p of this.features.points) {
        if (p.k !== 'peak' || !p.n) continue;
        const [sx, sy] = this._toScreen(p.x, p.z);
        if (sx < -50 || sy < -50 || sx > w + 50 || sy > h + 50) continue;
        ctx.fillStyle = 'rgba(80,50,30,0.85)';
        ctx.fillText('▲', sx, sy + 4);
        if (z > 4) { ctx.font = `500 11px "Work Sans", sans-serif`; ctx.fillText(p.n, sx, sy + 16); ctx.font = `600 ${Math.min(14, 9 + z)}px "Oswald", sans-serif`; }
      }
      ctx.font = `italic 500 12px "Work Sans", sans-serif`;
      ctx.fillStyle = 'rgba(60,110,150,0.9)';
      for (const g of this.features.glaciers) {
        const [sx, sy] = this._toScreen(g.x, g.z);
        ctx.fillText(g.n, sx, sy);
      }
    }
    // places
    this._hits = [];
    for (const p of this.places) {
      const [sx, sy] = this._toScreen(p.x, p.z);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const found = this.isDiscovered(p.id);
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = found ? '#e0662c' : '#fff7e6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#4a2d1c';
      ctx.stroke();
      if (z > 1.6) {
        ctx.font = '600 12px "Oswald", sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(245,235,212,0.9)';
        ctx.strokeText(p.name.toUpperCase(), sx, sy - 11);
        ctx.fillStyle = '#3a2416';
        ctx.fillText(p.name.toUpperCase(), sx, sy - 11);
      }
      this._hits.push({ p, sx, sy });
    }
    // player
    const pl = this.getPlayer();
    const [px, py] = this._toScreen(pl.x, pl.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-pl.heading + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fillStyle = '#c3361c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff5e0';
    ctx.stroke();
    ctx.restore();
    // scale bar
    const s = this._scale();
    const meters = [500, 1000, 2000, 5000][Math.max(0, Math.min(3, Math.floor(3 - Math.log2(z))))];
    ctx.fillStyle = '#3a2416';
    ctx.fillRect(20, h - 30, meters * s, 3);
    ctx.font = '500 11px "Work Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, 20, h - 36);
  }

  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 16;
    for (const h of this._hits || []) {
      const d = Math.hypot(h.sx - x, h.sy - y);
      if (d < bd) { bd = d; best = h.p; }
    }
    if (!best) { this.card.classList.remove('show'); return; }
    this.card.innerHTML = `
      <div class="card-kicker">${best.regionLabel}</div>
      <h3>${best.name}</h3>
      <div class="card-elev">${best.ft.toLocaleString()} ft · ${Math.round(best.ft * 0.3048).toLocaleString()} m</div>
      <p>${best.text}</p>
      <button class="btn primary" id="map-go">Travel here</button>`;
    this.card.classList.add('show');
    document.getElementById('map-go').onclick = () => { this.toggle(false); this.onTravel(best); };
  }
}
