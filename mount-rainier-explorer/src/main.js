import * as THREE from 'three';
import { Heightfield, FLAG_GLACIER } from './world/heightfield.js';
import { Geo } from './core/geo.js';
import { Atmosphere } from './world/atmosphere.js';
import { PhysicalAtmosphere, SUN_E } from './world/physatmo.js';
import { Terrain, TerrainShadow } from './world/terrain.js';
import { loadDetailTextures } from './world/textures.js';
import { setSurfaceDetail } from './world/materials.js';
import { loadProps } from './world/props.js';
import { Sky } from './world/sky.js';
import { PathNetwork } from './world/paths.js';
import { Vegetation } from './world/vegetation.js';
import { Lakes } from './world/water.js';
import { Waterfalls } from './world/waterfalls.js';
import { Cascades } from './world/cascades.js';
import { MeadowCarpet } from './world/meadow.js';
import { Clouds } from './world/clouds.js';
import { VolumetricClouds } from './world/volclouds.js';
import { Structures } from './world/structures.js';
import { Character } from './player/character.js';
import { Controller } from './player/controller.js';
import { Post } from './post.js';
import { Ambience, MusicPlayer } from './audio.js';
import { StarSky } from './world/stars.js';
import { ViewModel } from './gameplay/viewmodel.js';
import { Camp } from './gameplay/camp.js';
import { Game } from './gameplay/game.js';
import { Jev } from './gameplay/jev.js';
import { Ranger } from './gameplay/ranger.js';
import { HUD } from './ui/hud.js';
import { PaperMap } from './ui/map.js';
import { PLACES, REGIONS } from './data/places.js';

const ASSETS = new URL('../assets', import.meta.url).href.replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const QUALITY = {
  low: { dpr: 1, terrainN: 96, shadow: 0, farShadow: 0, reflection: false, bake: 512, paths: 1, ao: false },
  medium: { dpr: 1.25, terrainN: 128, shadow: 1024, farShadow: 1024, reflection: true, bake: 1024, paths: 2, ao: true },
  high: { dpr: 2, terrainN: 160, shadow: 2048, farShadow: 2048, reflection: true, bake: 1024, paths: 2, ao: true },
};

function setProgress(p, label) {
  $('load-bar').style.width = `${Math.round(p * 100)}%`;
  if (label) $('load-label').textContent = label;
}

const SHAFTS = +(params.get('shafts') || 1);
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const mobile = matchMedia('(pointer: coarse)').matches;
  let quality = params.get('q') || (params.has('trailer') ? 'high' : mobile ? 'low' : 'medium');
  if (!QUALITY[quality]) quality = 'medium';

  setProgress(0.02, 'Reading the map…');
  const features = await (await fetch(`${ASSETS}/features.json`)).json();
  const meta = features.meta;
  const geo = new Geo(meta);
  const hf = new Heightfield(meta);
  const prog = [0, 0];
  // photo-scanned ground textures load alongside the heightfield (?detail=0 skips them)
  const detailLoad = params.get('detail') === '0' ? Promise.resolve(null)
    : loadDetailTextures(ASSETS, quality === 'low' ? 512 : 1024).catch((e) => { console.warn('ground textures', e); return null; });
  // ?relief=0 leaves out the 10 m lidar relief
  await hf.load(ASSETS, (i, p) => {
    prog[i] = p;
    setProgress(0.05 + 0.55 * (prog[0] * 0.65 + prog[1] * 0.35), 'Surveying 1,600 km² of terrain…');
  }, { detail: params.get('relief') !== '0' });
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
  // physically based sky and aerial perspective (adds its uniforms to atmo's before any material is built)
  const PHYS = { low: { skyW: 96, skyH: 54, apN: 16 }, medium: { skyW: 160, skyH: 90, apN: 24 }, high: { skyW: 192, skyH: 108, apN: 32 } };
  const phys = new PhysicalAtmosphere(renderer, atmo, PHYS[quality] || PHYS.medium);
  // photo-scanned rocks, ferns, logs and branches (?props=0 falls back to the procedural ones)
  const propsLoad = params.get('props') === '0' ? Promise.resolve(null)
    : loadProps(ASSETS, atmo).catch((e) => { console.warn('scanned props', e); return null; });
  atmo.uniforms.uWorld.value.set(hf.half, hf.size);
  atmo.uniforms.uHeightF.value = hf.heightTex;
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
  // far sun-shadow cascade (medium and high): forests and fir clumps shade the slopes
  // out to a kilometre; materials blend it with the near map (see materials.js)
  const farSun = new THREE.DirectionalLight(0xffffff, 3);
  const fsc = farSun.shadow.camera;
  fsc.left = -1100; fsc.right = 1100; fsc.top = 1100; fsc.bottom = -1100; fsc.near = 10; fsc.far = 8000;
  farSun.shadow.bias = -0.0006;
  farSun.shadow.normalBias = 1.0;
  const setFarShadow = (s) => {
    farSun.visible = farSun.castShadow = s > 0;
    if (s) {
      farSun.shadow.mapSize.set(s, s);
      farSun.shadow.map?.dispose();
      farSun.shadow.map = null;
    }
  };
  setFarShadow(QUALITY[quality].farShadow);
  scene.add(farSun, farSun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  // created up front (intensity 0) so switching them on never recompiles shaders
  const fireLight = new THREE.PointLight(0xff8a3a, 0, 28, 1.6);
  const flashLight = new THREE.SpotLight(0xfff1d8, 0, 80, 0.42, 0.55, 1.4);
  scene.add(fireLight, flashLight, flashLight.target);

  const detail = await detailLoad;
  setSurfaceDetail(detail);
  // Sentinel-2 colour for mid and far ground (?sat=0 turns it off)
  let satellite = null;
  if (params.get('sat') !== '0') {
    satellite = new THREE.TextureLoader().load(`${ASSETS}/satellite.webp`);
    satellite.colorSpace = THREE.SRGBColorSpace;
    satellite.anisotropy = 8;
  }
  let terrain = new Terrain(hf, atmo, { N: QUALITY[quality].terrainN, detail, satellite });
  scene.add(terrain.group);
  const bake = new TerrainShadow(renderer, hf, atmo, QUALITY[quality].bake);
  const sky = new Sky(atmo);
  scene.add(sky.mesh);
  const stars = new StarSky(atmo);
  scene.add(stars.group);

  setProgress(0.7, 'Tracing trails and creeks…');
  await frame();
  const props = await propsLoad;
  const paths = new PathNetwork(features, hf, atmo, { detail, props });
  scene.add(paths.group);
  const vegetation = new Vegetation(hf, paths, atmo, quality, renderer, props);
  terrain.treeFar.value = vegetation.farRadius;
  terrain.shared.uTrail.value = paths.trailTex;
  scene.add(vegetation.group);
  const meadow = new MeadowCarpet(hf, paths, atmo, quality, props?.cards);
  scene.add(meadow.group);

  setProgress(0.78, 'Filling alpine lakes…');
  await frame();
  const lakes = new Lakes(features, hf, atmo, renderer);
  scene.add(lakes.mesh);
  const falls = new Waterfalls(features, hf, paths, atmo, new Cascades(hf, paths, atmo));
  scene.add(falls.group);
  const structures = new Structures(features, hf, atmo, geo, { assets: props ? ASSETS : null });
  scene.add(structures.group);

  const camp = new Camp(atmo, hf, fireLight);
  scene.add(camp.group);

  const hiker = new Character(atmo);
  scene.add(hiker.root);
  const controller = new Controller({ camera, dom: canvas, character: hiker, hf, lakes, vegetation, structures });

  // --- places -----------------------------------------------------------
  const [sx, sz] = geo.toWorld(46.8529, -121.7604);
  const summit = { x: sx, z: sz };
  // volumetric cumulus (?clouds=0 turns them off, ?cover=0..1 sets how much of the sky they fill)
  const CLOUDQ = {
    low: { scale: 0.34, steps: 28, lightSteps: 3, detail: true, shadowSize: 128 },
    medium: { scale: 0.4, steps: 40, lightSteps: 4, detail: true, shadowSize: 256 },
    high: { scale: 0.34, steps: 56, lightSteps: 5, detail: true, shadowSize: 256 },
  };
  const vclouds = params.get('clouds') === '0' ? null
    : new VolumetricClouds(renderer, atmo, summit, { ...(CLOUDQ[quality] || CLOUDQ.medium), coverage: params.has('cover') ? +params.get('cover') : 0.55 });
  const clouds = new Clouds(atmo, summit);
  scene.add(clouds.mesh);
  // the sky dome's own cloud layer carries the sky; the cumulus billboards are opt-in (?puffs=1)
  clouds.mesh.visible = params.get('puffs') === '1';
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
  if (!params.has('trailer')) {
    // the trailer plays its own score instead of the live ambience
    addEventListener('pointerdown', startAudio, { once: true });
    addEventListener('keydown', startAudio, { once: true });
  }

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
    setFarShadow(Q.farShadow);
    vegetation.setQuality(q);
    meadow.setQuality(q);
    terrain.treeFar.value = vegetation.farRadius;
    if (terrain.N !== Q.terrainN) {
      scene.remove(terrain.group);
      terrain = new Terrain(hf, atmo, { N: Q.terrainN, detail, satellite });
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

  // the ranger on the radio: Jev-powered when the player adds an OpenRouter key
  const ranger = new Ranger({
    jev: new Jev(), game, atmo, hf, paths, lakes, falls, places: PLACES, controller,
    travel: (p) => travel(p),
    setSeason: (s) => { atmo.setSeason(s); vegetation.setSeason(s); meadow.setSeason(s); bake.update(true); },
    isAuto: () => !params.has('cine') && !document.body.classList.contains('trailer-mode'),
  });
  game.ranger = ranger;
  // like Firewatch, the park is seen through the hiker's eyes (V for third person;
  // the trailer and ?view=third keep the camera behind the hiker)
  if (!params.has('trailer') && !params.has('cine') && params.get('view') !== 'third') game.setView(true, true);

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
  post.clouds = vclouds;
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
  const tmpColor = new THREE.Color();
  // the sky's light also stands in for light bounced around by the terrain and trees
  const SKY_BOOST = 1.9;
  // daylight white balance: the sun high in the sky reads white
  const wb = (() => {
    const T = phys.transAt(6361.6, 0.75, [0, 0, 0]);
    const v = new THREE.Vector3(1 / T[0], 1 / T[1], 1 / T[2]);
    return v.multiplyScalar(1 / (0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z));
  })();
  let exposure = 6;
  /**
   * Sun and sky light from the physical atmosphere at the camera: the sun's
   * colour is what survives the air along its path, the sky light is the
   * sky's irradiance on level ground. By night the palette's moonlight and
   * moonlit sky take over.
   */
  function applyLights() {
    phys.update(camera);
    const u = atmo.uniforms, n = u.uNight.value;
    const T = phys.sunT, E = phys.skyUp;
    const m = Math.max(T[0], T[1], T[2], 1e-5);
    if (atmo.moon) {
      sun.color.set('#9fb0e8');
      sun.intensity = atmo.sunIntensity * 0.35;
    } else {
      sun.color.setRGB(T[0] / m, T[1] / m, T[2] / m);
      sun.intensity = SUN_E * m;
    }
    atmo.sunColor.copy(sun.color);
    u.uSunColor.value.copy(sun.color);
    hemi.intensity = 1;
    hemi.color.setRGB(E[0], E[1], E[2]).multiplyScalar(SUN_E * SKY_BOOST).add(tmpColor.copy(atmo.hemiSky).multiplyScalar(atmo.hemiIntensity * n));
    // light bounced off the ground: vegetation and soil, or snow
    const albedo = atmo.season === 'winter' ? 0.55 : 0.12;
    const sunH = atmo.moon ? 0 : SUN_E * Math.max(0, atmo.sunDir.y);
    hemi.groundColor.setRGB(T[0] * sunH + E[0] * SUN_E, T[1] * sunH + E[1] * SUN_E, T[2] * sunH + E[2] * SUN_E).multiplyScalar(albedo * SKY_BOOST)
      .add(tmpColor.copy(atmo.hemiGround).multiplyScalar(atmo.hemiIntensity * n));
    u.uLightColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    ambient.copy(hemi.color).lerp(hemi.groundColor, 0.3);
    u.uAmbient.value.copy(ambient);
    // quick sky tints (zenith, horizon) for the shaders that want one
    const z = phys.zenithL, h = phys.horizonL;
    u.uZenith.value.setRGB(z[0], z[1], z[2]).multiplyScalar(SUN_E).add(tmpColor.copy(u.uNightZenith.value).multiplyScalar(n));
    u.uHorizon.value.setRGB(h[0], h[1], h[2]).multiplyScalar(SUN_E).add(tmpColor.copy(u.uNightHorizon.value).multiplyScalar(n));
    u.uGroundSky.value.copy(u.uHorizon.value).multiplyScalar(0.45);
    u.uSunDisk.value.setRGB(T[0], T[1], T[2]).multiplyScalar(SUN_E * 8);
    // exposure follows the light on level ground, like a photographer (a sunset stays darker than noon)
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const Eg = sunH * lum(T) + SUN_E * lum(E);
    const dayExp = THREE.MathUtils.clamp(5.4 * Math.pow(1.3 / Math.max(Eg, 1e-3), 0.7), 2, 30);
    exposure = dayExp + (1.85 - dayExp) * n;
    if (vclouds) {
      // clouds are lit by the sun as it is at their height (or by the moon), the sky above and the ground below
      const Tc = phys.transAt(6363.5, atmo.sunDir.y, cloudT);
      const vis = THREE.MathUtils.smoothstep(atmo.sunDir.y, -0.04, 0.0);
      if (atmo.moon) cloudLight.radiance.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity * 3);
      else cloudLight.radiance.set(Tc[0], Tc[1], Tc[2]).multiplyScalar(SUN_E * vis * 3);
      cloudLight.dir.copy(atmo.moon ? atmo.lightDir : atmo.sunDir);
      cloudLight.ambTop.set(hemi.color.r, hemi.color.g, hemi.color.b).multiplyScalar(1 / Math.PI);
      cloudLight.ambBottom.set(hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b).multiplyScalar(1 / Math.PI);
    }
  }
  const cloudT = [0, 0, 0];
  const cloudLight = { dir: new THREE.Vector3(), radiance: new THREE.Vector3(), ambTop: new THREE.Vector3(), ambBottom: new THREE.Vector3() };
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

  // ?cine: offline "film" mode for trailers. The loop no longer runs on its
  // own; an external driver calls __cine.step(dt) once per video frame and
  // may override the camera (cine.cam) and the streaming focus (cine.focus).
  const cineMode = params.has('cine');
  let trailerMode = params.has('trailer') && !cineMode;
  const cine = { cam: null, focus: null };
  const cineCam = () => {
    const c = cine.cam;
    if (!c) return;
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.up.set(Math.sin(c.roll || 0), Math.cos(c.roll || 0), 0);
    camera.lookAt(c.look[0], c.look[1], c.look[2]);
    if (c.fov && Math.abs(camera.fov - c.fov) > 1e-3) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  };

  let trailer = null;
  function tick() {
    requestAnimationFrame(tick);
    frameStep(Math.min(clock.getDelta(), 0.05));
  }

  function frameStep(dt) {
    trailer?.update();
    renderer.info.reset();
    t += dt;
    atmo.update(dt);

    // lights follow the sun/moon; shadow frustum follows the hiker
    const L = atmo.lightDir;
    const u = atmo.uniforms;
    u.uShadowStrength.value = atmo.moon ? 0.6 : 1;

    const panelOpen = map.open || hud.panel || $('camp-menu').classList.contains('open');
    controller.enabled = !panelOpen && $('intro').classList.contains('gone');
    controller.update(dt, t);
    if (cineMode || trailerMode) cineCam();
    applyLights();
    vclouds?.update(dt, camera, cloudLight);
    const focus = ((cineMode || trailerMode) && cine.focus) || controller.pos;
    lightTarget.set(Math.round(focus.x), Math.round(focus.y), Math.round(focus.z));
    sun.target.position.copy(lightTarget);
    sun.position.copy(lightTarget).addScaledVector(L, 400);
    if (farSun.visible) {
      farSun.color.copy(sun.color);
      farSun.intensity = sun.intensity;
      farSun.target.position.set(Math.round(focus.x / 8) * 8, Math.round(focus.y / 8) * 8, Math.round(focus.z / 8) * 8);
      farSun.position.copy(farSun.target.position).addScaledVector(L, 4000);
    }

    terrain.update(camera.position);
    bake.update();
    vegetation.update(focus);
    meadow.update(focus);
    paths.update(focus, QUALITY[quality].paths);
    falls.update(camera, dt);
    structures.update(atmo);
    stars.update(camera);
    sky.update(camera, stars);
    const view = game.update(dt, { camera, time: t });
    ranger.update(dt);

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
      grade: { warm: 1 - Math.min(1, Math.max(0, (atmo.sunElevation - 6) / 30)) * 0.7, night: u.uNight.value, exposure, wb },
      // sunlight scattering through the trees: strongest in the misty morning and low sun
      shafts: params.get('shafts') === '0' || atmo.moon ? null : {
        light: sun,
        strength: THREE.MathUtils.smoothstep(atmo.sunElevation, -1, 5) * (0.7 + 1.1 * u.uMist.value) * SHAFTS,
      },
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
  Object.assign(cine, { step: (dt) => frameStep(dt), THREE, setQuality: applyQuality });
  if (cineMode) {
    window.__cine = cine;
    frameStep(1 / 30);
  } else {
    const makeTrailer = async (hookStart) => {
      const { Trailer } = await import('./trailer/trailer.js');
      trailer = new Trailer({
        R: { travel, PLACES, controller, hf, paths, lakes, atmo, game, camp, stars, clouds, structures, camera, vegetation, meadow },
        C: cine,
        assets: ASSETS,
        hookStart,
        muteGame: () => audio.setVolume(0),
        onExit: () => { if (params.has('trailer')) location.search = ''; else location.reload(); },
      });
      window.__trailer = trailer;
      return trailer;
    };
    if (trailerMode) await makeTrailer(true);
    // "Watch the trailer" on the title screen starts it in place (no navigation,
    // so it also works inside an embedded page)
    $('trailer-link').onclick = async (e) => {
      e.preventDefault();
      trailerMode = true;
      (trailer || (await makeTrailer(false))).play();
    };
    tick();
  }
  window.__rainier = { get terrain() { return terrain; }, game, camp, stars, scene, camera, controller, atmo, hf, travel, PLACES, renderer, vegetation, lakes, falls, paths, meadow, post, structures, hiker, clouds, ranger, props, summit, phys, vclouds, cloudPuffs: params.get('puffs') === '1' };
}

boot().catch((e) => {
  console.error(e);
  $('load-label').textContent = `Something went wrong: ${e.message}`;
});
