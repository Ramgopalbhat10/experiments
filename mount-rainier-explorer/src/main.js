import * as THREE from 'three';
import { Heightfield, FLAG_GLACIER } from './world/heightfield.js';
import { Geo } from './core/geo.js';
import { Atmosphere } from './world/atmosphere.js';
import { Terrain, TerrainShadow } from './world/terrain.js';
import { Sky } from './world/sky.js';
import { PathNetwork } from './world/paths.js';
import { Vegetation } from './world/vegetation.js';
import { Lakes } from './world/water.js';
import { Waterfalls } from './world/waterfalls.js';
import { Cascades } from './world/cascades.js';
import { MeadowCarpet } from './world/meadow.js';
import { Clouds } from './world/clouds.js';
import { Structures } from './world/structures.js';
import { Character } from './player/character.js';
import { Controller } from './player/controller.js';
import { Post } from './post.js';
import { Ambience, MusicPlayer } from './audio.js';
import { StarSky } from './world/stars.js';
import { ViewModel } from './gameplay/viewmodel.js';
import { Camp } from './gameplay/camp.js';
import { Game } from './gameplay/game.js';
import { HUD } from './ui/hud.js';
import { PaperMap } from './ui/map.js';
import { PLACES, REGIONS } from './data/places.js';

const ASSETS = new URL('../assets', import.meta.url).href.replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const QUALITY = {
  low: { dpr: 1, terrainN: 96, shadow: 0, reflection: false, bake: 512, paths: 1, ao: false },
  medium: { dpr: 1.25, terrainN: 128, shadow: 1024, reflection: true, bake: 1024, paths: 2, ao: true },
  high: { dpr: 2, terrainN: 160, shadow: 2048, reflection: true, bake: 1024, paths: 2, ao: true },
};

function setProgress(p, label) {
  $('load-bar').style.width = `${Math.round(p * 100)}%`;
  if (label) $('load-label').textContent = label;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const mobile = matchMedia('(pointer: coarse)').matches;
  let quality = params.get('q') || (mobile ? 'low' : 'medium');
  if (!QUALITY[quality]) quality = 'medium';

  setProgress(0.02, 'Reading the map…');
  const features = await (await fetch(`${ASSETS}/features.json`)).json();
  const meta = features.meta;
  const geo = new Geo(meta);
  const hf = new Heightfield(meta);
  const prog = [0, 0];
  await hf.load(ASSETS, (i, p) => {
    prog[i] = p;
    setProgress(0.05 + 0.55 * (prog[0] * 0.65 + prog[1] * 0.35), 'Surveying 1,600 km² of terrain…');
  });
  setProgress(0.62, 'Growing old-growth forest…');
  await frame();

  // --- renderer ---------------------------------------------------------
  const canvas = $('scene');
  const probe = document.createElement('canvas').getContext('webgl2');
  const clipControl = !!probe?.getExtension('EXT_clip_control');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    reversedDepthBuffer: clipControl,
    logarithmicDepthBuffer: !clipControl,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = QUALITY[quality].shadow > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = false;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 200000);

  const atmo = new Atmosphere();
  atmo.uniforms.uWorld.value.set(hf.half, hf.size);
  atmo.uniforms.uLightColor = { value: new THREE.Color() };
  atmo.uniforms.uAmbient = { value: new THREE.Color() };
  const season = params.get('season');
  if (season) atmo.setSeason(season);
  const hour = params.get('t');
  if (hour) atmo.hours = +hour;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = QUALITY[quality].shadow > 0;
  const setShadowSize = (s) => {
    sun.shadow.mapSize.set(s || 512, s || 512);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  };
  setShadowSize(QUALITY[quality].shadow);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  // created up front (intensity 0) so switching them on never recompiles shaders
  const fireLight = new THREE.PointLight(0xff8a3a, 0, 28, 1.6);
  const flashLight = new THREE.SpotLight(0xfff1d8, 0, 80, 0.42, 0.55, 1.4);
  scene.add(fireLight, flashLight, flashLight.target);

  let terrain = new Terrain(hf, atmo, { N: QUALITY[quality].terrainN });
  scene.add(terrain.group);
  const bake = new TerrainShadow(renderer, hf, atmo, QUALITY[quality].bake);
  const sky = new Sky(atmo);
  scene.add(sky.mesh);
  const stars = new StarSky(atmo);
  scene.add(stars.group);

  setProgress(0.7, 'Tracing trails and creeks…');
  await frame();
  const paths = new PathNetwork(features, hf, atmo);
  scene.add(paths.group);
  const vegetation = new Vegetation(hf, paths, atmo, quality, renderer);
  terrain.treeFar.value = vegetation.farRadius;
  terrain.shared.uTrail.value = paths.trailTex;
  scene.add(vegetation.group);
  const meadow = new MeadowCarpet(hf, paths, atmo, quality);
  scene.add(meadow.group);

  setProgress(0.78, 'Filling alpine lakes…');
  await frame();
  const lakes = new Lakes(features, hf, atmo, renderer);
  scene.add(lakes.mesh);
  const falls = new Waterfalls(features, hf, paths, atmo, new Cascades(hf, paths, atmo));
  scene.add(falls.group);
  const structures = new Structures(features, hf, atmo, geo);
  scene.add(structures.group);

  const camp = new Camp(atmo, hf, fireLight);
  scene.add(camp.group);

  const hiker = new Character(atmo);
  scene.add(hiker.root);
  const controller = new Controller({ camera, dom: canvas, character: hiker, hf, lakes, vegetation, structures });

  // --- places -----------------------------------------------------------
  const [sx, sz] = geo.toWorld(46.8529, -121.7604);
  const summit = { x: sx, z: sz };
  const clouds = new Clouds(atmo, summit);
  scene.add(clouds.mesh);
  vegetation.setShores(lakes);
  const findPoint = (name, x, z, maxD = 3000) => {
    let best = null, bd = maxD;
    for (const q of features.points) {
      if (q.n !== name) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bd) { bd = d; best = [q.x, q.z]; }
    }
    return best;
  };
  for (const p of PLACES) {
    let [x, z] = geo.toWorld(p.lat, p.lon);
    if (p.osm) {
      let best = findPoint(p.osm, x, z), bd = best ? Math.hypot(best[0] - x, best[1] - z) : 3000;
      for (const L of lakes.lakes) {
        if (L.name !== p.osm) continue;
        const d = Math.hypot(L.cx - x, L.cz - z);
        if (d < bd) { bd = d; best = [L.cx, L.cz]; }
      }
      if (best) [x, z] = best;
    }
    if (p.view) {
      const v = findPoint(p.view, x, z, 800);
      if (v) { p.vx = v[0]; p.vz = v[1]; }
    }
    p.x = x; p.z = z;
    p.regionLabel = REGIONS[p.region];
  }

  // can an eye at (x, z) see the point (tx, ty, tz)?
  const lineOfSight = (x, z, tx, ty, tz) => {
    const ey = hf.heightAt(x, z) + 1.7;
    let clear = 0;
    for (let i = 1; i < 24; i++) {
      const t = i / 24;
      const px = x + (tx - x) * t, pz = z + (tz - z) * t;
      if (hf.heightAt(px, pz) < ey + (ty - ey) * t - 0.5) clear++;
    }
    return clear / 23;
  };

  const dry = (x, z) => {
    for (let r = 0; r < 400; r += 6) {
      for (let a = 0; a < 12; a++) {
        const px = x + Math.cos(a * 0.5236) * r, pz = z + Math.sin(a * 0.5236) * r;
        if (lakes.levelAt(px, pz) === null && hf.waterAt(px, pz) < 0.3 && hf.slopeAt(px, pz) < 0.35) return [px, pz];
        if (r === 0) break;
      }
    }
    return [x, z];
  };

  function arrival(p) {
    let x = p.x, z = p.z, fx = summit.x, fz = summit.z;
    if (p.kind === 'waterfall') {
      const w = falls.nearest(p.x, p.z);
      if (w && w.dist < 300) {
        const f = w.fall, b = f.bottom;
        fx = (f.x + b[0]) / 2; fz = (f.z + b[2]) / 2;
        const fy = (f.y + b[1]) / 2;
        if (p.vx !== undefined) return [...dry(p.vx, p.vz), fx, fz];
        // pick a nearby, walkable spot with a clear view of the falls
        const off = p.standoff || 35;
        let best = null, bs = -Infinity;
        for (let r = off * 0.6; r <= off * 1.6; r += off * 0.25) {
          for (let a = 0; a < 20; a++) {
            const px = fx + Math.cos(a / 20 * Math.PI * 2) * r, pz = fz + Math.sin(a / 20 * Math.PI * 2) * r;
            if (lakes.levelAt(px, pz) !== null || hf.waterAt(px, pz) > 0.3) continue;
            const slope = hf.slopeAt(px, pz);
            const score = lineOfSight(px, pz, fx, fy, fz) * 3 - slope * 4 - Math.abs(r - off) / off;
            if (score > bs) { bs = score; best = [px, pz]; }
          }
        }
        if (best) [x, z] = best;
        return [x, z, fx, fz];
      }
    }
    if (p.kind === 'lake') {
      const named = lakes.lakes.filter((q) => q.name === p.osm && Math.hypot(q.cx - p.x, q.cz - p.z) < 1500);
      const L = named.sort((a, b) => b.area - a.area)[0] || lakes.nearestLake(p.x, p.z, 400);
      if (L) {
        // stand on a low shore spot with open water between you and the view
        const tx = p.look === 'feature' ? L.cx : summit.x, tz = p.look === 'feature' ? L.cz : summit.z;
        let best = null, bs = -Infinity;
        for (let k = 0; k < 36; k++) {
          const ang = (k / 36) * Math.PI * 2, ux = Math.cos(ang), uz = Math.sin(ang);
          for (let r = 4; r < 700; r += 4) {
            const qx = L.cx + ux * r, qz = L.cz + uz * r;
            if (lakes.levelAt(qx, qz) !== null) continue;
            const sx2 = qx + ux * 5, sz2 = qz + uz * 5;
            const above = hf.heightAt(sx2, sz2) - L.level;
            if (above < 0.2) continue;
            // facing the target across the lake, low to the water, clear sightline, not too steep
            const vx = tx - sx2, vz = tz - sz2, vl = Math.hypot(vx, vz) || 1;
            const across = -(ux * vx + uz * vz) / vl;
            const score = (p.look === 'feature' ? 0 : across * 3) + lineOfSight(sx2, sz2, L.cx, L.level + 0.5, L.cz) * 4
              - Math.max(0, above - 1.5) * 0.8 - hf.slopeAt(sx2, sz2) * 4;
            if (score > bs) { bs = score; best = [sx2, sz2]; }
            break;
          }
        }
        if (best) [x, z] = best;
        if (p.look === 'feature') { fx = L.cx; fz = L.cz; }
        return [x, z, fx, fz];
      }
    }
    if (p.trail) {
      // stand on the middle of a named trail (e.g. the Grove of the Patriarchs loop)
      const pts = [];
      for (const ln of paths.lines) {
        if (ln.name !== p.trail || Math.hypot(ln.pts[0] - x, ln.pts[1] - z) > 2500) continue;
        for (let i = 0; i < ln.pts.length; i += 2) pts.push([ln.pts[i], ln.pts[i + 1]]);
      }
      if (pts.length) {
        pts.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
        [x, z] = pts[0];
        const q = pts[Math.min(pts.length - 1, 4)];
        fx = x + (q[0] - x) * 50; fz = z + (q[1] - z) * 50;
        return [x, z, fx, fz];
      }
    }
    if (p.kind === 'lookout') {
      // step onto the catwalk side that faces the mountain
      const lk = structures.lookouts.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a));
      if (Math.hypot(lk.x - x, lk.z - z) < 300) {
        const dx = summit.x - lk.x, dz = summit.z - lk.z, l = Math.hypot(dx, dz);
        return [lk.x + (dx / l) * 9, lk.z + (dz / l) * 9, summit.x, summit.z];
      }
    }
    [x, z] = dry(x, z);
    if (p.look === 'feature-south') { fx = x; fz = z + 1000; }
    if (p.look === 'feature-north') { fx = x; fz = z - 1000; }
    if (p.look === 'feature') { fx = p.x; fz = p.z; }
    if (Math.hypot(fx - x, fz - z) < 1) { fx = summit.x; fz = summit.z; }
    return [x, z, fx, fz];
  }

  const fade = $('fade');
  async function travel(p, instant = false) {
    if (!instant) { fade.classList.add('on'); await new Promise((r) => setTimeout(r, 450)); }
    const [x, z, fx, fz] = arrival(p);
    controller.teleport(x, z, fx, fz);
    controller.update(0.016, 0);
    terrain.update(camera.position);
    vegetation.update(controller.pos);
    meadow.update(controller.pos);
    for (let i = 0; i < 6; i++) paths.update(controller.pos, QUALITY[quality].paths);
    if (!instant) { await frame(); fade.classList.remove('on'); }
    hud.title(p.name, `${p.regionLabel} · ${p.ft.toLocaleString()} ft`);
  }

  // --- audio, HUD, map ----------------------------------------------------
  const audio = new Ambience();
  const startAudio = () => audio.start();
  addEventListener('pointerdown', startAudio, { once: true });
  addEventListener('keydown', startAudio, { once: true });

  const applyQuality = (q) => {
    quality = q;
    const Q = QUALITY[q];
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
    renderer.setSize(innerWidth, innerHeight);
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(s.x, s.y);
    post.ao = Q.ao && params.get('ao') !== '0';
    renderer.shadowMap.enabled = Q.shadow > 0;
    sun.castShadow = Q.shadow > 0;
    if (Q.shadow) setShadowSize(Q.shadow);
    vegetation.setQuality(q);
    meadow.setQuality(q);
    terrain.treeFar.value = vegetation.farRadius;
    if (terrain.N !== Q.terrainN) {
      scene.remove(terrain.group);
      terrain = new Terrain(hf, atmo, { N: Q.terrainN });
      terrain.treeFar.value = vegetation.farRadius;
      terrain.shared.uTrail.value = paths.trailTex;
      scene.add(terrain.group);
    }
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  };

  const hud = new HUD({
    places: PLACES,
    atmo,
    quality,
    onTravel: (p) => travel(p),
    onSeason: (s) => { atmo.setSeason(s); vegetation.setSeason(s); meadow.setSeason(s); bake.update(true); },
    onQuality: applyQuality,
    onVolume: (v) => audio.setVolume(v),
    onFast: () => toggleFast(),
  });
  const map = new PaperMap({
    hf, features, places: PLACES,
    onTravel: (p) => travel(p),
    getPlayer: () => ({ x: controller.pos.x, z: controller.pos.z, heading: controller.heading }),
    isDiscovered: (id) => hud.isDiscovered(id),
  });
  $('btn-map')?.addEventListener('click', () => { hud.togglePanel(null); map.toggle(); });

  const music = new MusicPlayer(audio);
  const viewmodel = new ViewModel({ getMapCanvas: () => map.ensureBase() });
  const game = new Game({
    controller, atmo, hf, audio, music, viewmodel, camp, stars, map, hud,
    fireLight, flashLight, places: PLACES, features,
  });

  const toggleFast = () => {
    controller.fast = !controller.fast;
    hud.setFast(controller.fast);
  };

  // photos (disposable camera)
  let photoReq = false;
  const takePhoto = () => { game.takePhoto(); };
  $('btn-photo')?.addEventListener('click', takePhoto);
  let hudHidden = false;

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'KeyM') { hud.togglePanel(null); map.toggle(); }
    if (e.code === 'KeyJ') { map.toggle(false); hud.togglePanel('panel-places'); }
    if (e.code === 'KeyO') { map.toggle(false); hud.togglePanel('panel-settings'); }
    if (e.code === 'KeyH' || e.code === 'F1') { map.toggle(false); hud.togglePanel('panel-help'); }
    if (e.code === 'KeyF') toggleFast();
    if (e.code === 'KeyP') takePhoto();
    if (e.code === 'KeyU') { hudHidden = !hudHidden; document.body.classList.toggle('hud-hidden', hudHidden); }
    if (e.code === 'KeyT') { atmo.timeScale = atmo.timeScale ? 0 : 10; $('set-flow').value = atmo.timeScale; }
    if (e.code === 'BracketRight') atmo.hours = (atmo.hours + 0.25) % 24;
    if (e.code === 'BracketLeft') atmo.hours = (atmo.hours + 23.75) % 24;
    if (e.code === 'Escape') { map.toggle(false); hud.togglePanel(null); game.closeCampMenu(); game.stopStargazing(); }
  });

  const post = new Post(renderer, { ao: QUALITY[quality].ao && params.get('ao') !== '0' });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(s.x, s.y);
  });

  vegetation.setClearings(PLACES.map((p) => {
    const [x, z] = arrival(p);
    return { x, z, r: p.kind === 'forest' ? 6 : 16 };
  }));

  // --- start -------------------------------------------------------------
  setProgress(0.9, 'Lacing up boots…');
  atmo.update(0);
  bake.update(true);
  const startId = params.get('at') || 'myrtle';
  const start = PLACES.find((p) => p.id === startId) || PLACES[0];
  await travel(start, true);
  // warm up shader programs before revealing the scene
  renderer.compile(scene, camera);
  setProgress(1, 'Ready');
  await frame();
  $('loading').classList.add('done');
  $('start-btn').onclick = () => {
    $('intro').classList.add('gone');
    startAudio();
    if (!mobile) canvas.requestPointerLock?.();
    hud.title(start.name, `${start.regionLabel} · ${start.ft.toLocaleString()} ft`);
  };

  // --- loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  let t = 0, hudTimer = 0, fpsAcc = 0, fpsN = 0;
  const lightTarget = new THREE.Vector3();
  const camDir = new THREE.Vector3(), sunUV = new THREE.Vector3(), sunScreen = new THREE.Vector2();
  const ambient = new THREE.Color();
  const statsEl = $('stats');
  controller.onStep = (speed) => {
    const x = controller.pos.x, z = controller.pos.z;
    let surf = 'rock';
    if (controller.water !== null) surf = 'water';
    else if (hf.snowAt(x, z) > 0.45 || hf.flagsAt(x, z) & FLAG_GLACIER || (atmo.season === 'winter' && controller.pos.y > 800)) surf = 'snow';
    else if (paths.nearest(x, z, 1.2, ['trail', 'road'])) surf = 'trail';
    else if (hf.forestAt(x, z) > 0.4) surf = 'forest';
    else if (hf.meadowAt(x, z) > 0.3) surf = 'meadow';
    audio.step(surf, speed);
  };

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    renderer.info.reset();
    t += dt;
    atmo.update(dt);

    // lights follow the sun/moon; shadow frustum follows the hiker
    const L = atmo.lightDir;
    const u = atmo.uniforms;
    sun.color.copy(atmo.sunColor);
    sun.intensity = atmo.sunIntensity * (atmo.moon ? 0.35 : 1);
    if (atmo.moon) sun.color.set('#9fb0e8');
    hemi.color.copy(atmo.hemiSky);
    hemi.groundColor.copy(atmo.hemiGround);
    hemi.intensity = atmo.hemiIntensity;
    u.uLightColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    ambient.copy(atmo.hemiSky).lerp(atmo.hemiGround, 0.3).multiplyScalar(atmo.hemiIntensity);
    u.uAmbient.value.copy(ambient);
    u.uShadowStrength.value = atmo.moon ? 0.6 : 1;

    const panelOpen = map.open || hud.panel || $('camp-menu').classList.contains('open');
    controller.enabled = !panelOpen && $('intro').classList.contains('gone');
    controller.update(dt, t);
    lightTarget.set(Math.round(controller.pos.x), Math.round(controller.pos.y), Math.round(controller.pos.z));
    sun.target.position.copy(lightTarget);
    sun.position.copy(lightTarget).addScaledVector(L, 400);

    terrain.update(camera.position);
    bake.update();
    vegetation.update(controller.pos);
    meadow.update(controller.pos);
    paths.update(controller.pos, QUALITY[quality].paths);
    falls.update(camera, dt);
    structures.update(atmo);
    stars.update(camera);
    sky.update(camera, stars);
    const view = game.update(dt, { camera, time: t });

    lakes.updateReflection(scene, camera, [vegetation.pools.grass, vegetation.pools.flower, meadow.near, clouds.mesh, hiker.root, falls.group, paths.group, camp.group], QUALITY[quality].reflection);
    // god rays when looking toward a low sun
    camera.getWorldDirection(camDir);
    const sd = atmo.sunDir;
    sunUV.copy(camera.position).addScaledVector(sd, 1000).project(camera);
    const facing = camDir.dot(sd);
    const rays = facing > 0 && sd.y > -0.03 && !atmo.moon ? Math.min(1, facing * 1.3) * (0.35 + 0.65 * (1 - Math.min(1, sd.y * 2.5))) : 0;
    post.render(scene, camera, t, {
      overlay: view.overlay, scope: view.scope,
      sun: { uv: sunScreen.set(sunUV.x * 0.5 + 0.5, sunUV.y * 0.5 + 0.5), strength: rays, color: atmo.sunColor },
    });

    if (game.photoRequested || photoReq) {
      game.photoRequested = false;
      photoReq = false;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const strip = $('photos');
        const a = document.createElement('a');
        a.href = url;
        a.download = `rainier-${Date.now()}.png`;
        a.className = 'photo';
        a.innerHTML = `<img src="${url}" alt="Photo"><span>${hud.state && $('loc-name').textContent}</span>`;
        strip.prepend(a);
        while (strip.children.length > 6) strip.lastChild.remove();
        document.body.classList.add('flash');
        setTimeout(() => document.body.classList.remove('flash'), 180);
      });
    }

    // HUD & ambience at 10 Hz
    hudTimer += dt;
    fpsAcc += dt; fpsN++;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      const x = controller.pos.x, z = controller.pos.z;
      let label = '', bd = Infinity, near = null;
      for (const p of PLACES) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; near = p; }
      }
      if (near && bd < (near.kind === 'lake' || near.kind === 'meadow' || near.kind === 'village' ? 320 : 160)) {
        hud.discover(near);
        game.onDiscover(near);
      }
      if (bd < 1200) label = near.name;
      else {
        let pk = null, pd = 3500;
        for (const q of features.points) {
          if (!q.n || (q.k !== 'peak' && q.k !== 'waterfall')) continue;
          const d = Math.hypot(q.x - x, q.z - z);
          if (d < pd) { pd = d; pk = q; }
        }
        label = pk ? `Near ${pk.n}` : near ? near.regionLabel : 'Mount Rainier National Park';
      }
      const tr = paths.nearest(x, z, 3, ['trail', 'road']);
      const wf = falls.nearest(x, z);
      const riv = paths.nearest(x, z, 80, ['stream']);
      let waterDist = Infinity, waterSize = 0;
      if (wf && wf.dist < 900) { waterDist = wf.dist; waterSize = Math.min(3, wf.fall.drop / 18); }
      if (riv) {
        const s = riv.line.kind ? 1.2 : 0.35;
        if (riv.dist * (1 / s) < waterDist * (1 / Math.max(waterSize, 0.01))) { waterDist = riv.dist; waterSize = s; }
      }
      hud.update({
        heading: controller.heading, camYaw: controller.yaw, pos: controller.pos,
        elevation: controller.pos.y, placeLabel: label,
        trail: tr && tr.line.name ? tr.line.name : tr ? (tr.line.type === 'road' ? 'Road' : 'Unnamed trail') : '',
        summit,
      });
      audio.update({
        altitude: controller.pos.y, waterDist, waterSize,
        forest: hf.forestAt(x, z), night: atmo.uniforms.uNight.value > 0.6, dt,
      });
      if (map.open) map.draw();
      if (statsEl && params.has('stats')) {
        statsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${vegetation.instanceCount} plants`;
        fpsAcc = 0; fpsN = 0;
      }
    }
  }
  tick();
  window.__rainier = { get terrain() { return terrain; }, game, camp, stars, scene, camera, controller, atmo, hf, travel, PLACES, renderer, vegetation, lakes, falls, paths, meadow, post };
}

boot().catch((e) => {
  console.error(e);
  $('load-label').textContent = `Something went wrong: ${e.message}`;
});
