// Offline trailer renderer (deterministic, frame by frame, via the game's ?cine mode).
//   npm i playwright && npx playwright install chromium
//   node render.js <outDir> <W> <H> <fps> <all|s01,s02,...> [preview]
// Use it where the browser has no GPU; on a machine with one, ?trailer plays live.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const port = 8800 + Math.floor(Math.random() * 100);
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(port);

(async () => {
  const [out, W, H, fps, which, preview] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], process.argv[6] || 'all', process.argv[7] === 'preview'];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-gl=angle', `--use-angle=${process.env.ANGLE || 'swiftshader'}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 1500)); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/index.html?cine&q=high&at=paradise&season=autumn`);
  await page.waitForSelector('#loading.done', { timeout: 600000 });
  await page.evaluate(() => { document.getElementById('start-btn').click(); });
  await page.waitForTimeout(1500);
  const list = await page.evaluate(async () => {
    const { makeShots } = await import('/src/trailer/shots.js');
    window.__shots = makeShots(window.__rainier, window.__cine);
    return window.__shots.map((s) => `${s.name}:${s.dur}`).join(', ');
  });
  console.log('loaded', (Date.now() - t0) / 1000, 's; shots:', list);
  const names = await page.evaluate(() => window.__shots.map((s) => s.name));
  const todo = which === 'all' ? names : which.split(',').map((w) => names.find((n) => n.startsWith(w)) || w);

  for (const name of todo) {
    const dir = path.join(out, name);
    if (!preview && fs.existsSync(path.join(dir, 'DONE'))) { console.log('skip', name); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const info = await page.evaluate(async (n) => {
      const s = window.__shots.find((x) => x.name === n);
      await s.setup();
      s.frame(0, 0);
      window.__cine.step(0);
      s.frame(0, 0);
      window.__cine.step(0);
      if (s.hud) window.__cine.step(0.11);   // let the HUD catch up with the new place
      return { dur: s.dur, hud: !!s.hud };
    }, name);
    const N = Math.round(info.dur * fps);
    const frames = preview ? [0, Math.floor(N / 2), N - 1] : [...Array(N).keys()];
    const ts = Date.now();
    for (const i of frames) {
      const u = N > 1 ? i / (N - 1) : 0;
      const file = path.join(dir, `${String(i).padStart(4, '0')}.png`);
      if (info.hud) {
        await page.evaluate(([n, u, dt]) => {
          const s = window.__shots.find((x) => x.name === n);
          s.frame(u, u * s.dur);
          window.__cine.step(dt);
          const gl = window.__rainier.renderer.getContext();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        }, [name, u, 1 / fps]);
        await page.screenshot({ path: file, timeout: 600000 });
      } else {
        const url = await page.evaluate(([n, u, dt]) => {
          const s = window.__shots.find((x) => x.name === n);
          s.frame(u, u * s.dur);
          window.__cine.step(dt);
          return document.getElementById('scene').toDataURL('image/png');
        }, [name, u, 1 / fps]);
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      }
      const done = frames.indexOf(i) + 1;
      if (done % 12 === 0 || preview) console.log(name, `${done}/${frames.length}`, `${((Date.now() - ts) / done / 1000).toFixed(1)}s/frame`);
    }
    if (!preview) fs.writeFileSync(path.join(dir, 'DONE'), String(N));
    console.log('finished', name, ((Date.now() - ts) / 1000).toFixed(0), 's');
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
