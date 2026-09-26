#!/usr/bin/env node
/**
 * Bakes foliage cards from Poly Haven (CC0) scans: fir sprays and whorls from
 * the fir sapling's real needle geometry, and leafy clumps from shrub_04.
 * Each shot renders colour, tangent-space normal and depth through bake.html
 * in headless Chromium; pack_cards.py then assembles RGBA atlases.
 *
 *   cd tools/assets && node bake/bake_cards.mjs && python3 bake/pack_cards.py
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', '..', '.cache');
const THREE_DIR = process.env.THREE_DIR || path.join(HERE, '..', 'node_modules', 'three');
const OUT = path.join(CACHE, 'cards');

// fir_sapling holds three saplings (top-level nodes 0..2); shrub_04 four plants in a row along x
const FIR = '/polyhaven/fir_sapling/2k/fir_sapling.gltf';
const SHRUB = '/polyhaven/shrub_04/1k/shrub_04.gltf';
export const SHOTS = [
  // sprays: saplings laid on their side, leader pointing right -> branch sprays;
  // two or three spun and stacked on one spot give the dense sprays of a mature crown
  { name: 'fir_spray_0', model: FIR, pick: [0, 1], stack: { spin: [0, 90] }, euler: [0, 0, -90], view: 'side', anchor: 'left', w: 2048, h: 1024, pad: 0.01 },
  { name: 'fir_spray_1', model: FIR, pick: [1, 2, 0], stack: { spin: [30, 120, 75], scale: [1, 1.2, 0.8] }, euler: [0, 0, -90], view: 'side', anchor: 'left', w: 2048, h: 1024, pad: 0.01 },
  { name: 'fir_spray_2', model: FIR, pick: [2, 0], stack: { spin: [0, 45], scale: [1.25, 0.9] }, euler: [0, 90, -90], view: 'side', anchor: 'left', w: 2048, h: 1024, pad: 0.01 },
  // whorls: the saplings from above
  { name: 'fir_whorl_0', model: FIR, pick: [0, 2], stack: { spin: [0, 40] }, view: 'top', w: 1024, h: 1024, pad: 0.02 },
  { name: 'fir_whorl_1', model: FIR, pick: [1, 0], stack: { spin: [0, 55] }, view: 'top', w: 1024, h: 1024, pad: 0.02 },
  // young trees seen from the side (small firs, crown silhouettes)
  { name: 'fir_side_0', model: FIR, pick: [0, 1], stack: { spin: [0, 90] }, view: 'side', w: 1024, h: 2048, pad: 0.02 },
  { name: 'fir_side_1', model: FIR, pick: [1, 2], stack: { spin: [70, 10], scale: [1, 0.95] }, view: 'side', w: 1024, h: 2048, pad: 0.02 },
  // leafy clumps: each of shrub_04's four plants from above and from the side
  ...[0, 1, 2, 3].flatMap((i) => [
    { name: `leaf_top_${i}`, model: SHRUB, clip: { axis: 'x', from: i / 4, to: (i + 1) / 4 }, view: 'top', w: 1024, h: 1024, pad: 0.03 },
    { name: `leaf_side_${i}`, model: SHRUB, clip: { axis: 'x', from: i / 4, to: (i + 1) / 4 }, view: 'side', w: 1024, h: 1024, pad: 0.03 },
  ]),
];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u.startsWith('/three/') ? path.join(THREE_DIR, u.slice(7)) : u.startsWith('/polyhaven/') ? path.join(CACHE, u) : path.join(HERE, u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);

const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${port}/bake.html`);
await page.waitForFunction(() => window.ready);
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const meta = {};
for (const shot of SHOTS) {
  if (only.length && !only.some((o) => shot.name.startsWith(o))) continue;
  const t0 = Date.now();
  const r = await page.evaluate((s) => window.bake(s), shot);
  for (const k of ['color', 'normal', 'depth']) fs.writeFileSync(path.join(OUT, `${shot.name}_${k}.png`), Buffer.from(r[k].split(',')[1], 'base64'));
  meta[shot.name] = { span: r.span, w: shot.w, h: shot.h };
  console.log(`${shot.name}: ${r.span.map((v) => v.toFixed(2)).join(' x ')} m, ${Date.now() - t0} ms`);
}
const metaFile = path.join(OUT, 'meta.json');
const prev = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
fs.writeFileSync(metaFile, JSON.stringify({ ...prev, ...meta }, null, 1));
await browser.close();
srv.close();
