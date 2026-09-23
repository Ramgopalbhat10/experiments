import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * First-person hands and held gear, drawn in their own little scene on top
 * of the world (like Henry's hands in Firewatch). Everything is modelled from
 * rounded primitives and canvas-painted details.
 */

const M = (hex, opts = {}) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex), ...opts });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, canvas: c, ctx: g };
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const SKIN = M('#d99a72'), SLEEVE = M('#c8894a'), CUFF = M('#a86d38');

/** A gripping hand with rolled sleeve; side = 1 right, -1 left. */
function hand(side) {
  const g = new THREE.Group();
  const palm = mesh(new RoundedBoxGeometry(0.075, 0.095, 0.03, 3, 0.013), SKIN);
  g.add(palm);
  // curled fingers wrapping forward
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(side * (-0.027 + i * 0.018), 0.045 - Math.abs(i - 1.5) * 0.004, 0.006);
    const a = mesh(new THREE.CapsuleGeometry(0.0085, 0.028, 3, 6), SKIN, 0, 0.018, 0);
    const b = mesh(new THREE.CapsuleGeometry(0.008, 0.022, 3, 6), SKIN, 0, 0.042, 0.012);
    b.rotation.x = 1.1;
    f.add(a, b);
    f.rotation.x = -1.2;
    g.add(f);
  }
  const thumb = mesh(new THREE.CapsuleGeometry(0.0095, 0.035, 3, 6), SKIN, side * 0.042, 0.0, 0.018);
  thumb.rotation.set(-0.6, 0, side * 0.9);
  g.add(thumb);
  const wrist = mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.06, 10), SKIN, 0, -0.07, 0);
  const cuff = mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.05, 12), CUFF, 0, -0.115, 0);
  const sleeve = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 12), SLEEVE, 0, -0.27, 0);
  g.add(wrist, cuff, sleeve);
  return g;
}

export class ViewModel {
  constructor({ getMapCanvas }) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 20);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(0.4, 1, 0.3);
    this.scene.add(this.hemi, this.sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.getMapCanvas = getMapCanvas;
    this.items = {};
    this.current = 'hands';
    this.target = 'hands';
    this.raise = 1;          // 0 lowered, 1 raised
    this.phase = 0;
    this.sway = new THREE.Vector2();
    this._build();
    this._show('hands');
  }

  _build() {
    const I = this.items;
    const R = hand(1), L = hand(-1);
    this.R = R; this.L = L;

    // --- radio (the orange Firewatch walkie-talkie)
    {
      const g = new THREE.Group();
      const body = mesh(new RoundedBoxGeometry(0.062, 0.13, 0.036, 3, 0.01), M('#ef7a1a'));
      const face = mesh(new RoundedBoxGeometry(0.05, 0.075, 0.006, 2, 0.003), M('#2a2522'), 0, -0.018, 0.019);
      for (let i = 0; i < 5; i++) face.add(mesh(new THREE.BoxGeometry(0.036, 0.004, 0.004), M('#111'), 0, -0.024 + i * 0.011, 0.003));
      this.radioScreen = canvasTex(128, 48, (c) => { c.fillStyle = '#9fb58a'; c.fillRect(0, 0, 128, 48); });
      const screen = mesh(new THREE.PlaneGeometry(0.04, 0.015), new THREE.MeshBasicMaterial({ map: this.radioScreen.tex }), 0, 0.037, 0.0185);
      const antenna = mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.11, 8), M('#1c1c1c'), -0.018, 0.12, 0);
      const knob = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 10), M('#1c1c1c'), 0.017, 0.071, 0);
      const ptt = mesh(new RoundedBoxGeometry(0.008, 0.035, 0.02, 2, 0.003), M('#1c1c1c'), -0.033, 0.01, 0);
      g.add(body, face, screen, antenna, knob, ptt);
      g.position.set(0.0, 0.075, 0.025);
      g.rotation.set(0.2, -0.25, 0.08);
      I.radio = { right: g, pose: { r: [0.13, -0.155, -0.34], rr: [0.3, -0.3, 0.05] } };
    }
    // --- compass (brass, with a live needle)
    {
      const g = new THREE.Group();
      const brass = M('#b8893a');
      g.add(mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.018, 28), brass));
      const faceTex = canvasTex(256, 256, (c) => {
        c.fillStyle = '#f2ead6'; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#3a2a1e'; c.fillStyle = '#3a2a1e';
        for (let i = 0; i < 72; i++) {
          const a = i / 72 * Math.PI * 2, r0 = i % 9 === 0 ? 96 : 108;
          c.lineWidth = i % 9 === 0 ? 3 : 1.2;
          c.beginPath(); c.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0); c.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118); c.stroke();
        }
        c.font = 'bold 34px Oswald, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, d]) => {
          const a = d * Math.PI / 180;
          c.fillStyle = t === 'N' ? '#c3361c' : '#3a2a1e';
          c.fillText(t, 128 + Math.sin(a) * 72, 128 - Math.cos(a) * 72);
        });
      });
      this.compassFace = new THREE.Group();
      const face = mesh(new THREE.CircleGeometry(0.043, 32), new THREE.MeshLambertMaterial({ map: faceTex.tex }), 0, 0.0095, 0);
      face.rotation.x = -Math.PI / 2;
      this.compassFace.add(face);
      g.add(this.compassFace);
      const needle = new THREE.Group();
      const red = mesh(new THREE.ConeGeometry(0.006, 0.036, 4), M('#d0301a'), 0, 0, -0.018);
      red.rotation.x = -Math.PI / 2;
      const white = mesh(new THREE.ConeGeometry(0.006, 0.036, 4), M('#f4f4f0'), 0, 0, 0.018);
      white.rotation.x = Math.PI / 2;
      needle.add(red, white);
      needle.position.y = 0.012;
      this.needle = needle;
      g.add(needle);
      g.add(mesh(new THREE.TorusGeometry(0.008, 0.003, 6, 12), brass, 0, 0, -0.054));
      g.position.set(0, 0.07, 0.03);
      g.rotation.set(1.15, 0, 0);
      I.compass = { left: g, pose: { l: [-0.09, -0.175, -0.33], lr: [0.25, 0.3, -0.2] } };
    }
    // --- paper map held in both hands
    {
      this.mapTex = canvasTex(512, 384, (c) => { c.fillStyle = '#efe3c8'; c.fillRect(0, 0, 512, 384); });
      const paper = M('#ffffff', { map: this.mapTex.tex, side: THREE.DoubleSide });
      const g = new THREE.Group();
      const left = new THREE.PlaneGeometry(0.2, 0.26);
      const lp = mesh(left, paper, -0.1, 0, 0);
      lp.rotation.y = 0.12;
      const right = new THREE.PlaneGeometry(0.2, 0.26);
      const rp = mesh(right, paper, 0.1, 0, 0);
      rp.rotation.y = -0.12;
      // split the texture across the two folds
      const uvL = left.attributes.uv, uvR = right.attributes.uv;
      for (let i = 0; i < uvL.count; i++) { uvL.setX(i, uvL.getX(i) * 0.5); uvR.setX(i, 0.5 + uvR.getX(i) * 0.5); }
      g.add(lp, rp);
      g.position.set(0, -0.075, -0.4);
      g.rotation.x = -0.8;
      I.map = { free: g, pose: { l: [-0.19, -0.2, -0.36], r: [0.19, -0.2, -0.36], lr: [-0.9, 0, -0.5], rr: [-0.9, 0, 0.5] } };
    }
    // --- disposable camera
    {
      const g = new THREE.Group();
      g.add(mesh(new RoundedBoxGeometry(0.13, 0.068, 0.045, 3, 0.01), M('#f2c230')));
      g.add(mesh(new RoundedBoxGeometry(0.132, 0.03, 0.047, 2, 0.006), M('#1f1f1f'), 0, -0.012, 0));
      const lens = mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.02, 20), M('#222'), 0.022, 0.004, -0.028);
      lens.rotation.x = Math.PI / 2;
      g.add(lens, mesh(new THREE.CircleGeometry(0.012, 20), M('#3a5a7a'), 0.022, 0.004, -0.0385));
      g.children[g.children.length - 1].rotation.y = Math.PI;
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.014, 0.01), M('#111'), -0.035, 0.02, -0.024));
      g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), M('#111'), -0.04, 0.038, 0));
      g.position.set(0, -0.1, -0.3);
      I.camera = { free: g, pose: { l: [-0.1, -0.16, -0.3], r: [0.1, -0.16, -0.3], lr: [0.2, 0, -1.2], rr: [0.2, 0, 1.2] } };
    }
    // --- binoculars
    {
      const g = new THREE.Group();
      const green = M('#2f3b2a'), black = M('#161616');
      for (const s of [-1, 1]) {
        const tube = mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.11, 18), green, s * 0.035, 0, 0);
        tube.rotation.x = Math.PI / 2;
        const eye = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14), black, s * 0.035, 0, 0.062);
        eye.rotation.x = Math.PI / 2;
        g.add(tube, eye);
      }
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.05), black, 0, 0.012, 0.01));
      g.position.set(0, -0.1, -0.28);
      I.binoculars = { free: g, pose: { l: [-0.09, -0.17, -0.3], r: [0.09, -0.17, -0.3], lr: [0.4, 0, -0.9], rr: [0.4, 0, 0.9] } };
    }
    // --- flashlight
    {
      const g = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.16, 16), M('#3a3a3c'));
      const head = mesh(new THREE.CylinderGeometry(0.027, 0.018, 0.045, 18), M('#2a2a2c'), 0, 0.1, 0);
      this.lens = mesh(new THREE.CircleGeometry(0.024, 18), new THREE.MeshBasicMaterial({ color: 0x555555 }), 0, 0.1231, 0);
      this.lens.rotation.x = -Math.PI / 2;
      g.add(body, head, this.lens);
      g.rotation.set(-1.45, 0, 0);
      g.position.set(0, 0.02, 0.0);
      I.flashlight = { right: g, pose: { r: [0.18, -0.2, -0.36], rr: [0.1, -0.1, 0.1] } };
    }
    // --- trekking poles
    {
      this.poleL = new THREE.Group();
      this.poleR = new THREE.Group();
      for (const p of [this.poleL, this.poleR]) {
        p.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), M('#1f1f1f'), 0, 0.02, 0));
        p.add(mesh(new THREE.CylinderGeometry(0.007, 0.005, 1.25, 8), M('#8a9aa6'), 0, -0.6, 0));
        p.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 10), M('#1f1f1f'), 0, -1.12, 0));
      }
      I.poles = { pose: { l: [-0.26, -0.33, -0.38], r: [0.26, -0.33, -0.38], lr: [0.5, 0, -0.1], rr: [0.5, 0, 0.1] } };
    }
    I.hands = { pose: { l: [-0.3, -0.6, -0.4], r: [0.3, -0.6, -0.4], lr: [0, 0, 0], rr: [0, 0, 0] } };
    this.root.add(R, L, this.poleL, this.poleR);
    for (const k of ['radio', 'compass', 'map', 'camera', 'binoculars', 'flashlight']) {
      const it = I[k];
      if (it.right) R.add(it.right);
      if (it.left) L.add(it.left);
      if (it.free) this.root.add(it.free);
    }
  }

  _show(name) {
    const I = this.items;
    for (const k of Object.keys(I)) {
      const it = I[k];
      for (const o of [it.right, it.left, it.free]) if (o) o.visible = k === name;
    }
    this.poleL.visible = this.poleR.visible = name === 'poles';
    this.current = name;
  }

  setItem(name) {
    if (!this.items[name]) name = 'hands';
    this.target = name;
  }

  setRadioText(line1, line2 = '') {
    const { ctx, tex } = this.radioScreen;
    ctx.fillStyle = '#9fb58a'; ctx.fillRect(0, 0, 128, 48);
    ctx.fillStyle = '#1f2a18';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(line1.slice(0, 12), 6, 20);
    ctx.font = '14px monospace';
    ctx.fillText(line2.slice(0, 14), 6, 40);
    tex.needsUpdate = true;
  }

  /** Redraw the in-hand map around the player. */
  drawMap(player, hf) {
    const base = this.getMapCanvas?.();
    if (!base) return;
    const { ctx, tex } = this.mapTex;
    const S = base.width;
    const span = 3000; // metres shown
    const px = (player.x + hf.half) / hf.size * S, pz = (player.z + hf.half) / hf.size * S;
    const sw = span / hf.size * S;
    ctx.fillStyle = '#efe3c8';
    ctx.fillRect(0, 0, 512, 384);
    ctx.drawImage(base, px - sw * 0.667, pz - sw * 0.5, sw * 1.333, sw, 0, 0, 512, 384);
    ctx.save();
    ctx.translate(256, 192);
    ctx.rotate(-player.heading + Math.PI);
    ctx.fillStyle = '#c3361c';
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(80,50,30,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 510, 382);
    tex.needsUpdate = true;
  }

  update(dt, { speed, time, yaw, lookDX, lookDY, light, ambient, flashOn, aspect, poleSwing }) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // swap items with a lower/raise animation
    if (this.target !== this.current) {
      this.raise = Math.max(0, this.raise - dt * 5);
      if (this.raise === 0) this._show(this.target);
    } else this.raise = Math.min(1, this.raise + dt * 4);
    const ease = this.raise * this.raise * (3 - 2 * this.raise);

    const moving = Math.min(1, speed / 3);
    this.phase += dt * (2 + speed * 1.6);
    const bobX = Math.cos(this.phase) * 0.012 * moving, bobY = Math.abs(Math.sin(this.phase)) * 0.016 * moving;
    this.sway.x += ((lookDX || 0) * -0.00012 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += ((lookDY || 0) * 0.00012 - this.sway.y) * Math.min(1, dt * 8);
    const breathe = Math.sin(time * 1.6) * 0.004;
    this.root.position.set(bobX + this.sway.x, -bobY + breathe + this.sway.y - (1 - ease) * 0.45, 0);

    const pose = this.items[this.current].pose;
    const place = (h, p, r) => {
      if (!p) { h.visible = false; return; }
      h.visible = true;
      h.position.set(p[0], p[1], p[2]);
      h.rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
    };
    place(this.R, pose.r, pose.rr);
    place(this.L, pose.l, pose.lr);
    if (this.current === 'hands') { this.R.visible = this.L.visible = false; }
    if (this.current === 'poles') {
      const sw = Math.sin(this.phase) * 0.35 * moving;
      this.R.position.z += sw * 0.1; this.L.position.z -= sw * 0.1;
      this.poleR.position.copy(this.R.position); this.poleL.position.copy(this.L.position);
      this.poleR.rotation.set(0.45 + sw, 0, 0.08); this.poleL.rotation.set(0.45 - sw, 0, -0.08);
      this.poleR.position.y -= 0.02; this.poleL.position.y -= 0.02;
    }
    // compass needle keeps pointing at magnetic north (well, true north)
    if (this.needle) this.needle.rotation.y += ((-yaw) - this.needle.rotation.y) * Math.min(1, dt * 6) + Math.sin(time * 7) * 0.002;
    if (this.lens) this.lens.material.color.set(flashOn ? 0xfff1c8 : 0x555555);

    this.hemi.color.copy(ambient).multiplyScalar(1.4);
    this.hemi.groundColor.copy(ambient).multiplyScalar(0.6);
    this.sun.color.copy(light);
    this.sun.intensity = 1.2;
  }
}
