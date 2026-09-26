import * as THREE from 'three';
import { RECIPES } from './camp.js';
import { radioStatic } from '../audio.js';
import { PLACE_LINES, GENERIC_LINES } from '../data/radio.js';
import { clamp } from '../core/noise.js';

const $ = (id) => document.getElementById(id);

export const GEAR = [
  { id: 'hands', key: '1', name: 'Hands', hint: '' },
  { id: 'map', key: '2', name: 'Map', hint: 'Click to unfold the full map' },
  { id: 'compass', key: '3', name: 'Compass', hint: '' },
  { id: 'radio', key: '4', name: 'Radio', hint: 'Click: music on/off · R: next track' },
  { id: 'camera', key: '5', name: 'Camera', hint: 'Click to take a photo' },
  { id: 'binoculars', key: '6', name: 'Binoculars', hint: 'Hold right mouse (or click) to look · shows distance' },
  { id: 'flashlight', key: '7', name: 'Flashlight', hint: 'Click to switch on/off' },
  { id: 'poles', key: '8', name: 'Trekking poles', hint: 'Easier climbing while held' },
];

const ICONS = {
  hands: '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2 7-6 7s-6-3-7-5l-1.5-3a1.5 1.5 0 012.5-1.5L8 13"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  radio: '<rect x="7" y="7" width="10" height="14" rx="2"/><path d="M9 7V3 M9.5 15h5 M9.5 17.5h5"/><rect x="9.5" y="9.5" width="5" height="3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z M12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/>',
  binoculars: '<circle cx="7" cy="15" r="4"/><circle cx="17" cy="15" r="4"/><path d="M7 11V5h3v6 M17 11V5h-3v6 M10 12h4"/>',
  flashlight: '<path d="M9 3h6l-1 6v11a2 2 0 01-4 0V9z M10 13h4"/>',
  poles: '<path d="M8 3l2 18 M16 3l-2 18 M6.5 4h3.5 M14 4h3.5"/>',
};

/**
 * The hiking game layer: gear hotbar and first-person hands, energy,
 * camping and cooking, stargazing, the ranger radio, binoculars with a
 * rangefinder, and the flashlight.
 */
export class Game {
  constructor(o) {
    Object.assign(this, o);
    this.item = 'hands';
    this.energy = 100;
    this.flashOn = false;
    this.scope = false;
    this.scopeHeld = false;
    this.chatterTimer = 60;
    this.subTimer = 0;
    this.saidPlace = new Set();
    this.inHandMapT = 0;
    this._buildHotbar();
    this._bindInput();
    this.music.onTrack = (t, on) => {
      this.viewmodel.setRadioText(on ? t.name : 'RADIO OFF', on ? 'CH 3  ♪' : 'CH 3');
      this.toast(on ? `♪ ${t.name}` : 'Radio off');
    };
    this.viewmodel.setRadioText('RADIO OFF', 'CH 3');
    this.controller.onInterrupt = () => this.stopStargazing();
  }

  // --- UI -----------------------------------------------------------------
  _buildHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.slots = {};
    for (const g of GEAR) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.title = `${g.name} (${g.key})`;
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[g.id]}</svg><span class="k">${g.key}</span><span class="n">${g.name}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.select(g.id); });
      bar.appendChild(b);
      this.slots[g.id] = b;
    }
    this.select('hands', true);
  }

  toast(text) {
    const el = $('mini-toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  subtitle(who, text, dur = 9) {
    const el = $('subtitle');
    el.innerHTML = `<b>${who}:</b> ${text}`;
    el.classList.add('show');
    this.subTimer = dur;
    radioStatic(this.audio);
  }

  select(id, silent = false) {
    this.item = id;
    for (const [k, b] of Object.entries(this.slots)) b.classList.toggle('on', k === id);
    this.viewmodel.setItem(id);
    this.controller.poles = id === 'poles';
    if (id !== 'binoculars') this.setScope(false);
    const g = GEAR.find((x) => x.id === id);
    if (!silent) this.toast(g.name);
    $('hint').textContent = g.hint || 'V: first/third person · C: make camp · G: stargaze · H: help';
    document.body.classList.toggle('viewfinder', id === 'camera' && this.controller.mode === 'first');
  }

  setScope(on) {
    this.scope = on;
    this.controller.fovTarget = on ? 11 : this.controller.stargaze ? 75 : 55;
    $('rangefinder').classList.toggle('show', on);
  }

  _bindInput() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.ready()) return;
      const g = GEAR.find((x) => `Digit${x.key}` === e.code);
      if (g) this.select(g.id);
      if (e.code === 'KeyV') this.toggleView();
      if (e.code === 'KeyC') this.pitchCamp();
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyG') this.controller.stargaze ? this.stopStargazing() : this.startStargazing();
      if (e.code === 'KeyK') this.music.toggle();
      if (e.code === 'KeyR' && this.item === 'radio') this.music.nextTrack();
      if (e.code === 'KeyN') this.music.nextTrack();
      if (e.code === 'KeyL') this.flashOn = !this.flashOn;
      if (e.code === 'KeyX' && this.controller.stargaze) this.stars.showLines = !this.stars.showLines;
    });
    const canvas = this.controller.dom;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.ready()) return;
      const locked = document.pointerLockElement === canvas;
      if (e.button === 2 && this.item === 'binoculars') { this.scopeHeld = true; this.setScope(true); return; }
      if (e.button === 0 && (locked || matchMedia('(pointer: coarse)').matches)) this.use();
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 2 && this.scopeHeld) { this.scopeHeld = false; this.setScope(false); }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.controller.mode !== 'first' || !this.ready()) return;
      const i = GEAR.findIndex((g) => g.id === this.item);
      this.select(GEAR[(i + (e.deltaY > 0 ? 1 : GEAR.length - 1)) % GEAR.length].id);
    }, { passive: true });
    $('btn-view')?.addEventListener('click', () => this.toggleView());
    $('btn-camp')?.addEventListener('click', () => (this.camp.active ? this.interact(true) : this.pitchCamp()));
    $('btn-stars')?.addEventListener('click', () => (this.controller.stargaze ? this.stopStargazing() : this.startStargazing()));
    $('btn-use')?.addEventListener('touchstart', (e) => { this.use(); e.preventDefault(); });
    document.querySelectorAll('#camp-menu .close').forEach((b) => b.addEventListener('click', () => this.closeCampMenu()));
  }

  ready() { return $('intro').classList.contains('gone') && !this.map.open && !this.hud.panel; }

  toggleView() {
    const first = this.controller.mode !== 'first';
    this.controller.setMode(first ? 'first' : 'third');
    document.body.classList.toggle('fp', first);
    document.body.classList.toggle('viewfinder', first && this.item === 'camera');
    this.toast(first ? 'First person' : 'Third person');
  }

  use() {
    switch (this.item) {
      case 'map': this.hud.togglePanel(null); this.map.toggle(true); break;
      case 'radio': this.music.toggle(); break;
      case 'camera': this.takePhoto(); break;
      case 'binoculars': if (!this.scopeHeld) this.setScope(!this.scope); break;
      case 'flashlight': this.flashOn = !this.flashOn; break;
      case 'compass': {
        const b = ((-this.controller.yaw * 180 / Math.PI) % 360 + 360) % 360;
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        this.toast(`Bearing ${Math.round(b)}° ${dirs[Math.round(b / 45) % 8]}`);
        break;
      }
      default: break;
    }
  }

  // --- camping ---------------------------------------------------------------
  pitchCamp() {
    const c = this.controller;
    if (this.camp.active && this.camp.distanceTo(c.pos) < 12) { this.interact(true); return; }
    const err = this.camp.pitch(c.pos.x, c.pos.z, c.heading);
    if (err) { this.toast(err); return; }
    this.toast('Camp pitched. Press E by the fire ring.');
    this.subtitle('Ranger', GENERIC_LINES[5]);
  }

  interact(force = false) {
    const menu = $('camp-menu');
    if (menu.classList.contains('open')) { this.closeCampMenu(); return; }
    if (!this.camp.active || (!force && this.camp.distanceTo(this.controller.pos) > 7)) {
      if (!force) this.toast(this.camp.active ? 'Walk back to your camp to use it' : 'Press C to make camp here');
      return;
    }
    this._renderCampMenu();
    menu.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeCampMenu() { $('camp-menu').classList.remove('open'); }

  _renderCampMenu() {
    const body = $('camp-body');
    const night = this.atmo.sunElevation < -6;
    const fire = this.camp.fireOn;
    body.innerHTML = `
      <div class="camp-row">
        <button class="btn" data-a="fire">${fire ? 'Put out fire' : 'Light the fire'}</button>
        <button class="btn" data-a="sleep">${night || this.atmo.hours > 19 ? 'Sleep until morning' : 'Nap for two hours'}</button>
        <button class="btn" data-a="stars">${night ? 'Lie back & stargaze' : 'Stargaze tonight'}</button>
        <button class="btn" data-a="pack">Pack up camp</button>
      </div>
      <h4>Cook something ${fire ? '' : '<small>(on the stove, or light the fire first)</small>'}</h4>
      <div class="recipes">${RECIPES.map((r) => `
        <button class="recipe" data-r="${r.id}"><b>${r.name}</b><span>${r.text}</span><i>${r.time}s · +${r.energy} energy</i></button>`).join('')}
      </div>
      <div id="cook-bar"><div></div></div>`;
    body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => this._campAction(b.dataset.a)));
    body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
      if (this.camp.cooking) return;
      const r = RECIPES.find((x) => x.id === b.dataset.r);
      this.camp.cook(r);
      this.toast(`Cooking ${r.name}…`);
      this.closeCampMenu();
    }));
  }

  _campAction(a) {
    const A = this.atmo;
    if (a === 'fire') { this.camp.setFire(!this.camp.fireOn); this._renderCampMenu(); return; }
    this.closeCampMenu();
    if (a === 'pack') { this.camp.packUp(); this.toast('Camp packed. Leave no trace.'); }
    if (a === 'sleep') {
      const night = A.sunElevation < -6 || A.hours > 19;
      this.fadeThen(() => {
        if (night) A.hours = 6.75; else A.hours = (A.hours + 2) % 24;
        this.energy = 100;
        this.camp.setFire(false);
      }, night ? 'You sleep to the sound of the creek…' : 'A short nap in the shade…');
    }
    if (a === 'stars') this.startStargazing();
  }

  fadeThen(fn, text) {
    const f = $('fade');
    $('fade-text').textContent = text || '';
    f.classList.add('on', 'long');
    setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on', 'long'), 900); }, 1300);
  }

  // --- stargazing ------------------------------------------------------------
  startStargazing() {
    if (this.atmo.sunElevation > -8) {
      this.fadeThen(() => { this.atmo.hours = 21.75; this._lieDown(); }, 'You wait for the stars to come out…');
      return;
    }
    this._lieDown();
  }

  _lieDown() {
    const c = this.controller;
    c.stargaze = true;
    c.look = 0.9;
    c.fovTarget = 75;
    this.stars.showLines = true;
    this.stars.uniforms.uBoost.value = 1.6;
    document.body.classList.add('stargazing');
    this.toast('Stargazing · X: constellation lines · G or move to get up');
    if (!this.music.playing) this.music.play(4);
  }

  stopStargazing() {
    const c = this.controller;
    if (!c.stargaze) return;
    c.stargaze = false;
    c.fovTarget = 55;
    c.look = 0;
    this.stars.showLines = false;
    this.stars.uniforms.uBoost.value = 1;
    document.body.classList.remove('stargazing');
    $('star-labels').innerHTML = '';
  }

  // --- photos ----------------------------------------------------------------
  takePhoto() { this.photoRequested = true; }

  // --- per frame ---------------------------------------------------------------
  /** A place was discovered: the ranger chimes in on the radio. */
  onDiscover(p) {
    if (this.saidPlace.has(p.id) || !PLACE_LINES[p.id]) return;
    this.saidPlace.add(p.id);
    this.ranger?.onDiscover(p);
    setTimeout(() => this.subtitle('Ranger (radio)', PLACE_LINES[p.id][0]), 2500);
    this.chatterTimer = 150;
  }

  update(dt, { camera, time }) {
    const c = this.controller;
    // energy: hiking burns it, rest restores it slowly, food restores it fast
    const burn = c.speed > 5 ? 0.22 : c.speed > 0.8 ? 0.07 : -0.03;
    this.energy = clamp(this.energy - (c.fast ? 0 : burn) * dt, 0, 100);
    c.speedMul = this.energy < 15 ? 0.65 : this.energy < 30 ? 0.85 : 1;
    $('energy-fill').style.width = `${this.energy}%`;
    $('energy').classList.toggle('low', this.energy < 30);
    if (this.energy < 15 && !this._tiredWarned) {
      this._tiredWarned = true;
      this.toast("You're exhausted. Make camp (C) and cook something.");
    }
    if (this.energy > 40) this._tiredWarned = false;

    // cooking
    const r = this.camp.update(dt);
    const bar = $('cook-progress');
    if (r?.progress !== undefined) { bar.classList.add('show'); bar.firstElementChild.style.width = `${r.progress * 100}%`; }
    else bar.classList.remove('show');
    if (r?.done) {
      this.energy = Math.min(100, this.energy + r.done.energy);
      this.toast(`${r.done.name} ready. +${r.done.energy} energy`);
    }

    // interaction prompt
    const nearCamp = this.camp.active && this.camp.distanceTo(c.pos) < 7;
    $('prompt').textContent = nearCamp ? 'E · Camp' : '';
    $('prompt').classList.toggle('show', nearCamp && !$('camp-menu').classList.contains('open'));

    // flashlight / headlamp
    const fl = this.flashLight;
    fl.intensity = this.flashOn ? 60 : 0;
    fl.position.copy(camera.position);
    camera.getWorldDirection(this._dir || (this._dir = new THREE.Vector3()));
    fl.target.position.copy(camera.position).addScaledVector(this._dir, 10);
    fl.target.updateMatrixWorld();

    // binocular rangefinder
    if (this.scope) this._rangefind(camera);

    // radio chatter
    if (this.subTimer > 0) { this.subTimer -= dt; if (this.subTimer <= 0) $('subtitle').classList.remove('show'); }
    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0 && !this.ranger?.jev.enabled) {
      this.chatterTimer = 150 + Math.random() * 150;
      this.subtitle('Ranger (radio)', GENERIC_LINES[Math.floor(Math.random() * GENERIC_LINES.length)]);
    }

    // hands
    const fp = c.mode === 'first' && !c.stargaze;
    if (fp) {
      this.inHandMapT -= dt;
      if (this.item === 'map' && this.inHandMapT <= 0) {
        this.inHandMapT = 0.4;
        this.viewmodel.drawMap({ x: c.pos.x, z: c.pos.z, heading: c.heading }, this.hf);
      }
      this.viewmodel.update(dt, {
        speed: c.speed, time, yaw: c.yaw, lookDX: c.lookDelta.x / Math.max(dt, 1e-3) * 0.016, lookDY: c.lookDelta.y / Math.max(dt, 1e-3) * 0.016,
        light: this.atmo.uniforms.uLightColor.value, ambient: this.atmo.uniforms.uAmbient.value,
        flashOn: this.flashOn, aspect: camera.aspect,
      });
    }
    c.lookDelta.x = c.lookDelta.y = 0;

    // stargazing labels
    if (c.stargaze) {
      const el = $('star-labels');
      const labels = this.stars.showLines ? this.stars.project(camera, innerWidth, innerHeight) : [];
      el.innerHTML = labels.map((l) => `<span class="${l.big ? 'big' : ''}" style="transform:translate(${l.x.toFixed(0)}px,${l.y.toFixed(0)}px)">${l.text}</span>`).join('');
    }
    return { overlay: fp ? { scene: this.viewmodel.scene, camera: this.viewmodel.camera } : null, scope: this.scope };
  }

  _rangefind(camera) {
    const hf = this.hf;
    const o = camera.position, d = this._dir;
    let t = 5, hit = null;
    while (t < 30000) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (!hf.inside(x, z)) break;
      if (y < hf.heightAt(x, z)) { hit = [x, hf.heightAt(x, z), z]; break; }
      t += Math.max(2, t * 0.01);
    }
    const el = $('rangefinder');
    if (!hit) { el.innerHTML = '<b>—</b><span>open sky</span>'; return; }
    let name = '', bd = 600;
    for (const p of this.places) {
      const dd = Math.hypot(p.x - hit[0], p.z - hit[2]);
      if (dd < bd) { bd = dd; name = p.name; }
    }
    if (!name) {
      for (const q of this.features.points) {
        if (q.k !== 'peak' || !q.n) continue;
        const dd = Math.hypot(q.x - hit[0], q.z - hit[2]);
        if (dd < bd) { bd = dd; name = q.n; }
      }
    }
    const km = t / 1000;
    el.innerHTML = `<b>${km < 1 ? `${Math.round(t)} m` : `${km.toFixed(1)} km`}</b><span>${Math.round(hit[1] * 3.28084).toLocaleString()} ft${name ? ` · ${name}` : ''}</span>`;
  }
}
