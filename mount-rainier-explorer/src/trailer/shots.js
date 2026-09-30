// The trailer's shot list: 14 camera moves across the park, cut to an 80 BPM
// score (one bar = 3 s). Each shot is { name, dur, label, sub, hud, setup(),
// frame(u) }; frame() drives C.cam = { pos, look, fov } (or null to use the
// game's own first-person camera) and C.focus, the point the world streams
// around. The same list drives the offline renderer (?cine) and the
// real-time trailer (?trailer).
export function makeShots(R, C) {
  const T = C.THREE;
  const H = (x, z) => R.hf.heightAt(x, z);
  const SUM = [-3464, 4392, -875];
  const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
  const mix = (a, b, u) => a + (b - a) * u;
  const mix3 = (a, b, u) => [mix(a[0], b[0], u), mix(a[1], b[1], u), mix(a[2], b[2], u)];
  const place = (id) => R.PLACES.find((p) => p.id === id);
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const ctl = R.controller;
  const hud = document.getElementById('hud');

  // ground clearance around a point so low cameras never dip into a hill
  const safeY = (x, z, lift) => {
    let g = H(x, z);
    for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) g = Math.max(g, H(x + ox, z + oz) - 0.5);
    return g + lift;
  };
  const hideHiker = (hide) => ctl.char.root.scale.setScalar(hide ? 1e-4 : 1);
  const cinematic = () => {
    hud.style.display = 'none';
    ctl.keys.clear();
    ctl.speed = 0;
    if (ctl.mode !== 'third') ctl.setMode('third');
    document.body.classList.remove('fp', 'viewfinder', 'stargazing');
    R.game.select('hands', true);
    R.game.setScope(false);
    ctl.stargaze = false;
    ctl.fovTarget = 55;
    R.stars.showLines = false;
    R.stars.uniforms.uBoost.value = 1;
    R.camp.packUp();
    R.clouds.mesh.visible = R.cloudPuffs;
    document.getElementById('subtitle').classList.remove('show');
  };
  const holdItem = (id) => {
    R.game.select(id, true);
    const vm = R.game.viewmodel;
    vm._show(id);
    vm.raise = 1;
  };
  const gameplay = () => {
    hud.style.display = '';
    // no surprise radio chatter: only the lines the edit asks for
    for (const p of R.PLACES) R.game.saidPlace.add(p.id);
    R.game.chatterTimer = 1e9;
    for (const id of ['hint', 'toast', 'mini-toast', 'photos', 'stats']) {
      const e = document.getElementById(id);
      if (e) e.style.visibility = 'hidden';
    }
    document.getElementById('subtitle').classList.remove('show');
  };
  const go = (id) => R.travel(place(id), true);   // synchronous when instant
  const placeHiker = (x, z, heading) => {
    ctl.pos.set(x, H(x, z), z);
    ctl.heading = heading;
    ctl._snapCamera = true;
  };

  // Walk the hiker along the trails: trace a route by following whichever
  // trail segment lies ahead (chaining OSM ways), then steer along it.
  function trailWalker(name, near, headingHint) {
    const segs = [];
    for (const ln of R.paths.lines) {
      if (ln.type !== 'trail') continue;
      const p = ln.pts;
      for (let i = 0; i < p.length - 2; i += 2) {
        if (Math.hypot(p[i] - near[0], p[i + 1] - near[1]) > 400) continue;
        segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], name && ln.name === name ? 0 : 3]);
      }
    }
    const proj = (x, z, s) => {
      const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
      return [s[0] + dx * t, s[1] + dz * t];
    };
    let p = [...near], d = [...headingHint];
    const route = [];
    for (let k = 0; k < 160; k++) {
      const q = [p[0] + d[0] * 0.5, p[1] + d[1] * 0.5];
      let best = null, bd = 1e9;
      for (const s of segs) {
        const pp = proj(q[0], q[1], s);
        let tx = s[2] - s[0], tz = s[3] - s[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const align = tx * d[0] + tz * d[1];
        const cost = Math.hypot(pp[0] - q[0], pp[1] - q[1]) + s[4] + (1 - Math.abs(align)) * 2;
        if (cost < bd) { bd = cost; best = { pp, t: align < 0 ? [-tx, -tz] : [tx, tz] }; }
      }
      if (!best) break;
      d = [d[0] * 0.6 + best.t[0] * 0.4, d[1] * 0.6 + best.t[1] * 0.4];
      const dl = Math.hypot(d[0], d[1]) || 1;
      d = [d[0] / dl, d[1] / dl];
      p = best.pp;
      route.push(p);
    }
    return {
      start: route[0],
      steer() {
        let bi = 0, bdd = 1e9;
        for (let i = 0; i < route.length; i++) {
          const dd = Math.hypot(route[i][0] - ctl.pos.x, route[i][1] - ctl.pos.z);
          if (dd < bdd) { bdd = dd; bi = i; }
        }
        const t = route[Math.min(route.length - 1, bi + 10)];
        const dx = t[0] - ctl.pos.x, dz = t[1] - ctl.pos.z, l = Math.hypot(dx, dz) || 1;
        ctl.yaw = Math.atan2(-dx, -dz);
        return [dx / l, dz / l];
      },
    };
  }

  const lookout = () => R.structures.lookouts.find((l) => l.name === 'Mount Fremont Lookout');
  let campSpot = null;
  const findCamp = () => {
    if (campSpot) return campSpot;
    // a flat, open meadow bench above Paradise with the mountain to the north
    let best = null;
    for (let dx = -300; dx <= 300; dx += 12) {
      for (let dz = -300; dz <= 100; dz += 12) {
        const x = -1500 + dx, z = 6250 + dz;
        const s = R.hf.slopeAt(x, z), f = R.hf.forestAt(x, z), w = R.hf.waterAt(x, z);
        if (s > 0.12 || f > 0.2 || w > 0.1 || R.paths.nearest(x, z, 10)) continue;
        const score = s * 3 + Math.abs(dx) * 0.001 + f;
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    campSpot = best;
    return best;
  };
  const pitchCamp = () => {
    const c = findCamp();
    placeHiker(c.x, c.z + 3.5, Math.PI);   // the camp goes 3.5 m ahead of the hiker
    R.camp.pitch(ctl.pos.x, ctl.pos.z, Math.PI);
    R.camp.setFire(true);
    placeHiker(c.x + 1.6, c.z + 1.2, Math.PI * 0.8);
    return c;
  };

  return [
    {
      name: 's01_aerial_paradise', dur: 6, label: 'PARADISE', sub: '5,400 FT · GOLDEN HOUR',
      setup() { cinematic(); go('paradise'); R.atmo.hours = 18.35; hideHiker(true); },
      frame(u) {
        const d = [-0.2497, -0.9683];
        const s = mix(-420, 260, ease(u));
        const x = -1541 + d[0] * s, z = 6581 + d[1] * s;
        const y = safeY(x, z, 0) + mix(34, 64, ease(u));
        C.cam = { pos: [x, y, z], look: [SUM[0], 2950 + 250 * u, SUM[2]], fov: 50 };
        C.focus = V(x + d[0] * 140, H(x + d[0] * 140, z + d[1] * 140), z + d[1] * 140);
      },
    },
    {
      name: 's02_myrtle', dur: 4.5, label: 'MYRTLE FALLS', sub: 'SKYLINE TRAIL · 5,482 FT',
      setup() { cinematic(); go('myrtle'); R.atmo.hours = 15.6; hideHiker(true); },
      frame(u) {
        const F = [-1334, 5962], dir = [0.447, 0.894];
        const r = mix(62, 50, ease(u));
        const x = F[0] + dir[0] * r, z = F[1] + dir[1] * r;
        const y = safeY(x, z, 3.2 + 0.6 * u);
        C.cam = { pos: [x, y, z], look: [F[0] - 3, y + 7 + 2 * u, F[1] - 6], fov: 50 };
        C.focus = V(F[0] + dir[0] * 20, H(F[0], F[1]), F[1] + dir[1] * 20);
      },
    },
    {
      name: 's03_skyline_walk', dur: 4.5, label: 'SKYLINE TRAIL', sub: 'PARADISE MEADOWS',
      setup() {
        cinematic(); go('paradise'); R.atmo.hours = 16.3; hideHiker(false);
        this.w = trailWalker('Skyline Trail', [-1541, 6420], [-0.25, -0.97]);
        placeHiker(this.w.start[0], this.w.start[1], Math.PI);
        ctl.keys.add('KeyW');
        this.w.steer();
        ctl.speed = 3.2;
        this.cam = null;
      },
      frame() {
        const f = this.w.steer();
        const p = ctl.pos, rx = -f[1], rz = f[0];
        const want = [p.x - f[0] * 4.6 - rx * 1.6, 0, p.z - f[1] * 4.6 - rz * 1.6];
        want[1] = safeY(want[0], want[2], 1.9);
        const look = [p.x + f[0] * 30, p.y + 5.5, p.z + f[1] * 30];
        this.cam = this.cam ? { pos: mix3(this.cam.pos, want, 0.12), look: mix3(this.cam.look, look, 0.08) } : { pos: want, look };
        C.cam = { ...this.cam, fov: 50 };
        C.focus = null;
      },
    },
    {
      name: 's04_glaciervista', dur: 4.5, label: 'GLACIER VISTA', sub: 'TATOOSH RANGE · 6,336 FT',
      setup() {
        cinematic(); go('glaciervista'); R.atmo.hours = 16.8; hideHiker(false);
        placeHiker(ctl.pos.x, ctl.pos.z, 0.15);   // facing south toward the Tatoosh
      },
      frame(u) {
        const p = ctl.pos;
        const side = mix(-2.5, -1.4, ease(u));
        const x = p.x + side, z = p.z - 5.2;
        C.cam = { pos: [x, safeY(x, z, 2.3), z], look: [p.x - 600, 1760, p.z + 7000], fov: 48 };
        C.focus = V(p.x, p.y, p.z + 60);
      },
    },
    {
      name: 's07_sunrise_aerial', dur: 3, label: 'SUNRISE', sub: 'EMMONS GLACIER · 6,400 FT',
      setup() { cinematic(); go('sunrise'); R.atmo.hours = 9.3; hideHiker(true); },
      frame(u) {
        const S = [5566, -7752], d = [-0.796, 0.606];
        const s = mix(-150, 170, u);
        const x = S[0] + d[0] * s, z = S[1] + d[1] * s;
        C.cam = { pos: [x, safeY(x, z, 0) + mix(70, 95, u), z], look: [SUM[0], 3600, SUM[2]], fov: 46 };
        C.focus = V(x + d[0] * 200, H(x + d[0] * 200, z + d[1] * 200), z + d[1] * 200);
      },
    },
    {
      name: 's05_eunice', dur: 4.5, label: 'EUNICE LAKE', sub: 'MOWICH · 5,354 FT',
      setup() { cinematic(); go('eunice'); R.atmo.hours = 16.0; hideHiker(true); },
      frame(u) {
        const p = ctl.pos, dx = SUM[0] - p.x, dz = SUM[2] - p.z, L = Math.hypot(dx, dz);
        const d = [dx / L, dz / L], s = mix(-3.5, 3.5, ease(u));
        const x = p.x - d[1] * s, z = p.z + d[0] * s;
        C.cam = { pos: [x, safeY(x, z, 1.25), z], look: [SUM[0], 3300, SUM[2]], fov: 44 };
        C.focus = V(x + d[0] * 60, p.y, z + d[1] * 60);
      },
    },
    {
      name: 's06_louise', dur: 4.5, label: 'LOUISE LAKE', sub: 'STEVENS CANYON · 4,600 FT',
      setup() { cinematic(); go('louise'); R.atmo.hours = 15.2; hideHiker(true); },
      frame(u) {
        const p = ctl.pos, f = [-Math.sin(ctl.yaw), -Math.cos(ctl.yaw)];
        const s = mix(-4, 4, ease(u));
        const x = p.x - f[1] * s, z = p.z + f[0] * s;
        C.cam = { pos: [x, safeY(x, z, 1.3), z], look: [p.x + f[0] * 300, p.y + 40, p.z + f[1] * 300], fov: 46 };
        C.focus = V(x + f[0] * 60, p.y, z + f[1] * 60);
      },
    },
    {
      name: 's08_fremont_sunset', dur: 4.5, label: 'MOUNT FREMONT LOOKOUT', sub: '7,181 FT · SUNSET',
      setup() { cinematic(); go('fremont'); R.atmo.hours = 18.9; hideHiker(true); },
      frame(u) {
        R.atmo.hours = mix(18.9, 19.25, u);
        const L = lookout();
        const sd = [-0.674, 0.739];
        const a = Math.atan2(-sd[1], -sd[0]) + mix(-0.5, 0.15, ease(u));
        const x = L.x + Math.cos(a) * 24, z = L.z + Math.sin(a) * 24;
        C.cam = { pos: [x, Math.max(safeY(x, z, 2), L.y + 5), z], look: [L.x, L.y + 3.5, L.z], fov: 50 };
        C.focus = V(L.x, L.y, L.z);
      },
    },
    {
      name: 's09a_fp_map', dur: 2, hud: true,
      setup() {
        cinematic(); gameplay(); go('paradise'); R.atmo.hours = 15.5; hideHiker(false);
        this.w = trailWalker('Skyline Trail', [-1541, 6420], [-0.25, -0.97]);
        placeHiker(this.w.start[0], this.w.start[1], Math.PI);
        ctl.setMode('first'); document.body.classList.add('fp');
        ctl.look = -0.12;
        holdItem('map');
        ctl.keys.add('KeyW');
        ctl.speed = 2.6;
        C.cam = null; C.focus = null;
        this.w.steer();
      },
      frame() { this.w.steer(); ctl.look = -0.12; },
    },
    {
      name: 's09b_fp_binoculars', dur: 2, hud: true,
      setup() {
        cinematic(); gameplay(); go('paradise'); R.atmo.hours = 16.0; hideHiker(false);
        ctl.setMode('first'); document.body.classList.add('fp');
        holdItem('binoculars');
        R.game.setScope(true);
        R.camera.fov = 11; R.camera.updateProjectionMatrix();
        this.tgt = [SUM[0] + 350, SUM[1] - 700, SUM[2] + 1200];
        const dx = this.tgt[0] - ctl.pos.x, dz = this.tgt[2] - ctl.pos.z;
        this.yaw0 = Math.atan2(-dx, -dz);
        C.cam = null; C.focus = null;
      },
      frame(u) {
        ctl.yaw = this.yaw0 + mix(0.05, -0.02, ease(u));
        const t = this.tgt;
        ctl.look = Math.atan2(t[1] - ctl.pos.y, Math.hypot(t[0] - ctl.pos.x, t[2] - ctl.pos.z)) + mix(-0.015, 0.01, u);
      },
    },
    {
      name: 's09c_fp_radio', dur: 2, hud: true,
      setup() {
        cinematic(); gameplay(); go('myrtle'); R.atmo.hours = 15.6; hideHiker(false);
        ctl.setMode('first'); document.body.classList.add('fp');
        holdItem('radio');
        R.game.subtitle('Ranger (radio)', 'Myrtle Falls, nice. Stand on the bridge and line the falls up with the summit.', 30);
        this.yaw0 = ctl.yaw;
        C.cam = null; C.focus = null;
      },
      frame(u) { ctl.yaw = this.yaw0 + mix(0.12, 0.02, ease(u)); ctl.look = mix(0.02, 0.1, ease(u)); },
    },
    {
      name: 's10_camp_dusk', dur: 4.5,
      setup() {
        cinematic(); go('paradise'); R.atmo.hours = 19.55; hideHiker(false);
        this.c = pitchCamp();
        R.camp.cook({ id: 'cocoa', name: 'Hot cocoa', time: 999, energy: 0 });
      },
      frame(u) {
        const c = this.c;
        const r = mix(10.5, 7.2, ease(u));
        const x = c.x + 2.2, z = c.z + r;
        C.cam = { pos: [x, safeY(x, z, mix(1.5, 1.25, u)), z], look: [c.x - 0.5, H(c.x, c.z) + 1.6 + 1.2 * u, c.z - 12], fov: 50 };
        C.focus = V(c.x, H(c.x, c.z), c.z);
      },
    },
    {
      name: 's11_stargaze', dur: 4.5,
      setup() {
        cinematic(); go('paradise'); R.atmo.hours = 22.4; hideHiker(false);
        this.c = pitchCamp();
        R.stars.uniforms.uBoost.value = 1.8;
        R.clouds.mesh.visible = false;
      },
      frame(u) {
        const c = this.c;
        const x = c.x + 1.5, z = c.z + 9;
        const y = safeY(x, z, 1.3);
        const pitch = mix(0.12, 1.05, ease(u));
        const yaw = mix(0, 0.35, ease(u));
        C.cam = { pos: [x, y, z], look: [x - Math.sin(yaw) * 100 * Math.cos(pitch), y + Math.sin(pitch) * 100, z - Math.cos(yaw) * 100 * Math.cos(pitch)], fov: 60 };
        C.focus = V(c.x, H(c.x, c.z), c.z);
      },
    },
    {
      name: 's12_finale_reflection', dur: 6, label: 'REFLECTION LAKES', sub: '4,854 FT · ALPENGLOW',
      setup() {
        cinematic(); go('reflection'); R.atmo.hours = 18.85; hideHiker(false);
        const p = ctl.pos;
        this.base = [p.x, p.z];
        const dx = SUM[0] - p.x, dz = SUM[2] - p.z, L = Math.hypot(dx, dz);
        this.d = [dx / L, dz / L];
        // the hiker stands at the shore a few metres right of camera, looking at the mountain
        placeHiker(p.x - this.d[1] * 4 + this.d[0] * 3, p.z + this.d[0] * 4 + this.d[1] * 3, Math.atan2(this.d[0], this.d[1]));
      },
      frame(u) {
        const [bx, bz] = this.base, d = this.d;
        const s = mix(-9, -5, ease(u));
        const x = bx + d[0] * s + d[1] * 0.5, z = bz + d[1] * s - d[0] * 0.5;
        C.cam = { pos: [x, safeY(x, z, 1.25), z], look: [SUM[0], 3250 + 150 * u, SUM[2]], fov: 44 };
        C.focus = V(bx + d[0] * 80, H(bx, bz), bz + d[1] * 80);
      },
    },
  ];
}

// Trailer text, in seconds on the 60 s timeline.
export const STATEMENTS = [
  { t0: 1.1, t1: 5.5, text: '1,600 km² of real terrain', kicker: 'Mount Rainier National Park · Washington' },
  { t0: 15.4, t1: 19.2, text: 'Every trail. Every viewpoint.' },
  { t0: 27.3, t1: 31.3, text: 'Waterfalls. Alpine lakes. Fall colour.' },
  { t0: 42.3, t1: 46.2, text: 'Make camp. Cook. Rest.' },
  { t0: 46.8, t1: 50.8, text: 'Stay for the stars' },
  { t0: 52.6, t1: 56.2, text: 'The mountain is out' },
];
export const CAPTIONS = [
  { t0: 36.15, t1: 37.9, text: 'Read the map' },
  { t0: 38.1, t1: 39.9, text: 'Scout the peaks' },
  { t0: 40.1, t1: 41.9, text: 'Listen to the ranger' },
];
export const END_CARD = 3;
