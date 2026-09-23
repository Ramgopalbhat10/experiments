import * as THREE from 'three';
import { clamp } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Third-person hiking controller: WASD / arrows / gamepad / touch joystick,
 * orbit camera with pointer lock or drag, terrain-following with slope
 * slowdown, lake wading limits and simple collisions.
 */
export class Controller {
  constructor({ camera, dom, character, hf, lakes, vegetation, structures }) {
    this.camera = camera;
    this.dom = dom;
    this.char = character;
    this.hf = hf;
    this.lakes = lakes;
    this.veg = vegetation;
    this.structures = structures;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.yaw = 0;
    this.pitch = 0.18;
    this.dist = 7;
    this.distTarget = 7;
    this.grounded = true;
    this.speed = 0;
    this.keys = new Set();
    this.fast = false;
    this.enabled = true;
    this.joy = { x: 0, y: 0, active: false };
    this.lookTouch = null;
    this.runToggle = false;
    this.camTarget = new THREE.Vector3();
    this.mode = 'third';          // 'third' | 'first'
    this.look = -0.08;            // first-person look elevation (radians)
    this.stargaze = false;
    this.speedMul = 1;
    this.poles = false;
    this.fovTarget = 55;
    this.lookDelta = { x: 0, y: 0 };
    this.onInterrupt = null;      // called when the player moves during stargazing
    this.bob = 0;
    this.onStep = null;
    this._lastStep = 0;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    d.addEventListener('click', () => {
      if (!this.enabled || matchMedia('(pointer: coarse)').matches) return;
      if (document.pointerLockElement !== d) d.requestPointerLock?.();
    });
    let dragging = false, lx = 0, ly = 0;
    d.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    addEventListener('mouseup', () => (dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === d) {
        this._look(e.movementX, e.movementY);
      } else if (dragging) {
        this._look(e.clientX - lx, e.clientY - ly);
        lx = e.clientX; ly = e.clientY;
      }
    });
    d.addEventListener('wheel', (e) => {
      if (this.mode === 'first' || this.stargaze) return;
      this.distTarget = clamp(this.distTarget * (1 + Math.sign(e.deltaY) * 0.12), 2.2, 40);
      e.preventDefault();
    }, { passive: false });

    // touch: left half = joystick, right half = look
    const joyEl = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    let joyId = null, jx = 0, jy = 0;
    d.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && joyId === null) {
          joyId = t.identifier; jx = t.clientX; jy = t.clientY;
          this.joy.active = true;
          if (joyEl) { joyEl.style.left = `${jx - 60}px`; joyEl.style.top = `${jy - 60}px`; joyEl.classList.add('on'); }
        } else if (!this.lookTouch) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    d.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          const dx = clamp((t.clientX - jx) / 50, -1, 1), dy = clamp((t.clientY - jy) / 50, -1, 1);
          this.joy.x = dx; this.joy.y = -dy;
          if (knob) knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this._look((t.clientX - this.lookTouch.x) * 1.6, (t.clientY - this.lookTouch.y) * 1.6);
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyId = null; this.joy.x = this.joy.y = 0; this.joy.active = false;
          if (knob) knob.style.transform = '';
          joyEl?.classList.remove('on');
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    };
    d.addEventListener('touchend', end);
    d.addEventListener('touchcancel', end);
    document.getElementById('btn-jump')?.addEventListener('touchstart', (e) => { this._jumpReq = true; e.preventDefault(); });
    document.getElementById('btn-run')?.addEventListener('touchstart', (e) => {
      this.runToggle = !this.runToggle;
      e.currentTarget.classList.toggle('on', this.runToggle);
      e.preventDefault();
    });
  }

  _look(dx, dy) {
    const zoom = this.fovTarget / 55;
    this.lookDelta.x += dx;
    this.lookDelta.y += dy;
    this.yaw -= dx * 0.0032 * zoom;
    if (this.mode === 'first' || this.stargaze) {
      this.look = clamp(this.look - dy * 0.0026 * zoom, this.stargaze ? 0.15 : -1.45, this.stargaze ? 1.55 : 1.45);
    } else {
      this.pitch = clamp(this.pitch + dy * 0.0026, -0.35, 1.35);
    }
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'first') this.look = clamp(-this.pitch * 0.5, -0.6, 0.6);
    this._snapCamera = true;
  }

  teleport(x, z, faceX = null, faceZ = null) {
    this.pos.set(x, this.hf.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    if (faceX !== null) {
      const dx = faceX - x, dz = faceZ - z;
      this.heading = Math.atan2(dx, dz);
      this.yaw = Math.atan2(-dx, -dz);
    }
    this.pitch = 0.12;
    this._snapCamera = true;
  }

  _gamepad() {
    const gp = navigator.getGamepads?.()[0];
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    this._look(dz(gp.axes[2] || 0) * 14, dz(gp.axes[3] || 0) * 10);
    return {
      x: dz(gp.axes[0] || 0), y: -dz(gp.axes[1] || 0),
      run: gp.buttons[7]?.pressed || gp.buttons[10]?.pressed,
      jump: gp.buttons[0]?.pressed,
    };
  }

  update(dt, time) {
    const k = this.keys;
    let ix = 0, iy = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) iy += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iy -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
      if (k.has('Comma')) this.yaw += dt * 1.8;
      if (k.has('Period')) this.yaw -= dt * 1.8;
      ix += this.joy.x; iy += this.joy.y;
    }
    const gp = this.enabled ? this._gamepad() : null;
    if (gp) { ix += gp.x; iy += gp.y; }
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    if (this.stargaze) {
      if (len > 0.2) this.onInterrupt?.();
      ix = iy = 0;
    }
    const running = k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle || gp?.run;
    const wantJump = (k.has('Space') || this._jumpReq || gp?.jump) && this.enabled;
    this._jumpReq = false;

    // camera-relative direction
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
    const mlen = Math.hypot(mx, mz);
    const hf = this.hf;
    let target = 0;
    if (mlen > 0.05) {
      mx /= mlen; mz /= mlen;
      const base = this.fast ? 38 : running ? 7.2 : 3.4;
      target = base * Math.min(1, mlen);
      // uphill costs effort; the Muir snowfield is a slog
      const ahead = hf.heightAt(this.pos.x + mx * 1.5, this.pos.z + mz * 1.5) - hf.heightAt(this.pos.x, this.pos.z);
      const grade = ahead / 1.5;
      if (!this.fast) target *= clamp(1 - Math.max(0, grade - 0.15) * (this.poles ? 0.55 : 0.9), 0.3, 1);
      if (!this.fast) target *= this.speedMul;
      if (!this.fast && hf.snowAt(this.pos.x, this.pos.z) > 0.5) target *= 0.85;
      const h = Math.atan2(mx, mz);
      let dh = h - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 10);
    }
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 6 : 9));
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const moveDirX = mlen > 0.05 ? mx : hx, moveDirZ = mlen > 0.05 ? mz : hz;

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += moveDirX * this.speed * dt;
    this.pos.z += moveDirZ * this.speed * dt;
    const lim = hf.half - 300;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    if (!this.fast) {
      this.veg.collide(this.pos, 0.35);
      this.structures.collide(this.pos, 0.35);
    }
    // wading limit: no swimming in glacial lakes
    let ground = hf.heightAt(this.pos.x, this.pos.z);
    const lvl = this.lakes.levelAt(this.pos.x, this.pos.z);
    if (lvl !== null && lvl - ground > 0.7) {
      this.pos.x = prevX; this.pos.z = prevZ;
      ground = hf.heightAt(this.pos.x, this.pos.z);
      this.speed *= 0.5;
    }
    this.water = lvl !== null ? lvl : null;

    // vertical
    if (this.grounded && wantJump) {
      this.vel.y = 6.2;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vel.y -= 19 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.vel.y = 0; this.grounded = true; }
    } else {
      // stick to the ground; walking off small ledges just follows the slope
      if (this.pos.y - ground > 1.2) { this.grounded = false; this.vel.y = 0; }
      else this.pos.y = ground;
    }

    // character
    const c = this.char;
    c.root.position.copy(this.pos);
    if (this.water !== null) c.root.position.y = Math.max(this.pos.y, this.water - 0.55);
    c.root.rotation.y = this.heading;
    c.root.visible = this.mode === 'third' && !this.stargaze;
    if (this.mode === 'first' && !this.stargaze && mlen > 0.05) this.heading = Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    c.animate(this.fast ? 7 : this.speed, this.grounded, dt, time);
    const ph = Math.floor(c.stepPhase / Math.PI);
    if (ph !== this._lastStep) {
      this._lastStep = ph;
      if (this.grounded && this.speed > 0.8 && this.onStep) this.onStep(this.speed);
    }

    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    const cam = this.camera;
    if (Math.abs(cam.fov - this.fovTarget) > 0.05) {
      cam.fov += (this.fovTarget - cam.fov) * Math.min(1, dt * 10);
      cam.updateProjectionMatrix();
    }
    if (this.mode === 'first' || this.stargaze) {
      const moving = Math.min(1, this.speed / 3);
      this.bob = this.stargaze ? 0 : Math.abs(Math.sin(this.char.stepPhase)) * 0.045 * moving;
      const eye = this.stargaze ? 0.45 : 1.62;
      const ground = this.water !== null ? Math.max(this.pos.y, this.water - 0.55) : this.pos.y;
      cam.position.set(this.pos.x, ground + eye + this.bob, this.pos.z);
      const ce = Math.cos(this.look);
      cam.up.copy(UP);
      cam.lookAt(this.pos.x - Math.sin(this.yaw) * ce * 10, cam.position.y + Math.sin(this.look) * 10, this.pos.z - Math.cos(this.yaw) * ce * 10);
      this.camTarget.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
      return;
    }
    this.dist += (this.distTarget * (this.fast ? 1.6 : 1) - this.dist) * Math.min(1, dt * 5);
    const tgt = this.camTarget;
    const want = _v.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    if (this._snapCamera) { tgt.copy(want); this._snapCamera = false; }
    else tgt.lerp(want, Math.min(1, dt * 12));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const off = _v2.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const pos = _v3.copy(tgt).add(off);
    // keep the camera above the ground along the boom
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const px = tgt.x + off.x * t, pz = tgt.z + off.z * t;
      const g = this.hf.heightAt(px, pz) + 0.45;
      const py = tgt.y + off.y * t;
      if (py < g) pos.y = Math.max(pos.y, g + (1 - t) * 0.2);
    }
    cam.position.copy(pos);
    cam.up.copy(UP);
    cam.lookAt(tgt.x, tgt.y + 0.1, tgt.z);
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
