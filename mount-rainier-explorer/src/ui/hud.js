import { REGIONS } from '../data/places.js';
import { SEASONS } from '../world/atmosphere.js';

const $ = (id) => document.getElementById(id);
const STORE = 'rainier-explorer:v1';

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ }
}

/**
 * HUD (compass, location card, discovery titles), the Places journal,
 * settings, help and the disposable-camera photo strip.
 */
export class HUD {
  constructor({ places, onTravel, atmo, onSeason, onQuality, onVolume, onFast, quality }) {
    this.places = places;
    this.onTravel = onTravel;
    this.atmo = atmo;
    this.state = load();
    this.state.found ||= {};
    this.compass = $('compass-strip');
    this.toastEl = $('toast');
    this._toastT = 0;
    this.panel = null;

    // compass ticks
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.ticks = [];
    for (let i = 0; i < 72; i++) {
      const el = document.createElement('div');
      const deg = i * 5;
      el.className = deg % 45 === 0 ? 'tick major' : deg % 15 === 0 ? 'tick mid' : 'tick';
      if (deg % 45 === 0) el.dataset.label = labels[deg / 45];
      this.compass.appendChild(el);
      this.ticks.push({ el, deg });
    }
    this.markers = places.map((p) => {
      const el = document.createElement('div');
      el.className = `cmark ${p.kind}`;
      el.title = p.name;
      this.compass.appendChild(el);
      return { el, p };
    });
    this.summitMark = document.createElement('div');
    this.summitMark.className = 'cmark summit-mark';
    this.summitMark.textContent = '▲';
    this.compass.appendChild(this.summitMark);

    // journal
    this._buildJournal();

    // settings
    const time = $('set-time'), flow = $('set-flow'), season = $('set-season');
    const qual = $('set-quality'), vol = $('set-volume');
    for (const [k, s] of Object.entries(SEASONS)) season.add(new Option(s.label, k));
    season.value = atmo.season;
    qual.value = quality;
    time.value = atmo.hours;
    time.addEventListener('input', () => { atmo.hours = +time.value; });
    flow.addEventListener('change', () => { atmo.timeScale = +flow.value; });
    season.addEventListener('change', () => onSeason(season.value));
    qual.addEventListener('change', () => onQuality(qual.value));
    vol.addEventListener('input', () => onVolume(+vol.value));
    this.timeInput = time;
    this.fastBtn = $('btn-fast');
    this.fastBtn?.addEventListener('click', () => onFast());

    for (const [btn, panel] of [['btn-places', 'panel-places'], ['btn-settings', 'panel-settings'], ['btn-help', 'panel-help']]) {
      $(btn)?.addEventListener('click', () => this.togglePanel(panel));
    }
    document.querySelectorAll('.panel .close').forEach((b) => b.addEventListener('click', () => this.togglePanel(null)));
  }

  isDiscovered(id) { return !!this.state.found[id]; }

  discover(p) {
    if (this.state.found[p.id]) return false;
    this.state.found[p.id] = Date.now();
    save(this.state);
    this.title(p.name, `${REGIONS[p.region]} · ${p.ft.toLocaleString()} ft`, true);
    this._buildJournal();
    return true;
  }

  title(main, sub, found = false) {
    const t = this.toastEl;
    t.querySelector('.t-main').textContent = main;
    t.querySelector('.t-sub').textContent = sub;
    t.querySelector('.t-kicker').textContent = found ? 'Discovered' : '';
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 5200);
  }

  togglePanel(id) {
    const cur = this.panel;
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
    this.panel = cur === id ? null : id;
    if (this.panel) $(this.panel).classList.add('open');
    if (this.panel && document.pointerLockElement) document.exitPointerLock();
    return this.panel;
  }

  _buildJournal() {
    const list = $('places-list');
    const count = Object.keys(this.state.found).length;
    $('places-count').textContent = `${count} / ${this.places.length} discovered`;
    list.innerHTML = '';
    for (const [rk, label] of Object.entries(REGIONS)) {
      const h = document.createElement('h4');
      h.textContent = label;
      list.appendChild(h);
      for (const p of this.places.filter((q) => q.region === rk)) {
        const item = document.createElement('div');
        item.className = `place ${this.isDiscovered(p.id) ? 'found' : ''}`;
        item.innerHTML = `
          <div class="place-head">
            <span class="dot ${p.kind}"></span>
            <span class="place-name">${p.name}</span>
            <span class="place-ft">${p.ft.toLocaleString()} ft</span>
          </div>
          <p>${p.text}</p>
          <button class="btn small">Travel</button>`;
        item.querySelector('.place-head').addEventListener('click', () => item.classList.toggle('expanded'));
        item.querySelector('button').addEventListener('click', () => { this.togglePanel(null); this.onTravel(p); });
        list.appendChild(item);
      }
    }
  }

  setFast(on) {
    this.fastBtn?.classList.toggle('on', on);
  }

  update({ heading, camYaw, pos, elevation, placeLabel, trail, summit, hint }) {
    // compass: camera yaw -> bearing (0 = north, clockwise)
    const bearing = ((-camYaw * 180 / Math.PI) % 360 + 360) % 360;
    const W = this.compass.clientWidth || 400;
    const span = 150; // degrees visible
    const toX = (deg) => {
      let d = ((deg - bearing + 540) % 360) - 180;
      return { x: W / 2 + (d / span) * W, vis: Math.abs(d) < span / 2 };
    };
    for (const t of this.ticks) {
      const { x, vis } = toX(t.deg);
      t.el.style.transform = `translateX(${x}px)`;
      t.el.style.opacity = vis ? 1 - Math.abs(x - W / 2) / (W / 2) * 0.7 : 0;
    }
    for (const m of this.markers) {
      const dx = m.p.x - pos.x, dz = m.p.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      const { x, vis } = toX(deg);
      const show = vis && dist < 6000 && dist > 40;
      m.el.style.opacity = show ? Math.min(1, (6000 - dist) / 2000) : 0;
      m.el.style.transform = `translateX(${x}px)`;
      m.el.classList.toggle('found', this.isDiscovered(m.p.id));
    }
    {
      const dx = summit.x - pos.x, dz = summit.z - pos.z;
      const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      const { x, vis } = toX(deg);
      this.summitMark.style.opacity = vis ? 1 : 0;
      this.summitMark.style.transform = `translateX(${x}px)`;
    }
    $('loc-name').textContent = placeLabel;
    $('loc-elev').textContent = `${Math.round(elevation * 3.28084).toLocaleString()} ft · ${Math.round(elevation).toLocaleString()} m`;
    $('loc-trail').textContent = trail || '';
    $('loc-time').textContent = `${this.atmo.clockString()} · ${SEASONS[this.atmo.season].label.split(' ')[0]}`;
    if (document.activeElement !== this.timeInput) this.timeInput.value = this.atmo.hours.toFixed(2);
    if (hint !== undefined) $('hint').textContent = hint;
  }
}
