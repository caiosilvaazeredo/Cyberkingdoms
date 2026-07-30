// Renders every Kenney .glb we have into a 2:1 isometric PNG sprite plus a
// manifest describing how to anchor it on the tile grid.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node render.mjs <outDir> <srcDir...>');
const SRC_DIRS = process.argv.slice(3);

mkdirSync(OUT, { recursive: true });

import { resolve } from 'path';
const require_abs = (p) => resolve(p);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.toLowerCase().endsWith('.glb')) acc.push(p);
  }
  return acc;
}

// Only the GLB flavour of each kit; skip FBX/OBJ duplicates.
const models = [];
const seen = new Set();
for (const dir of SRC_DIRS) {
  for (const p of walk(dir)) {
    if (p.includes('FBX format') || p.includes('OBJ format')) continue;
    const kit = dir.split('/').filter(Boolean).pop().replace(/^kenney_/, '').replace(/_[\d.]+$/, '');
    const name = basename(p, '.glb');
    const id = `${kit}/${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, kit, name, path: p });
  }
}
console.log(`found ${models.length} glb models`);

// three.js module imports are blocked under file:// by CORS, so serve the
// filesystem over http for the duration of the render.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = readFileSync(p);
    const ext = p.slice(p.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const httpUrl = (abs) => ORIGIN + abs.split('/').map(encodeURIComponent).join('/');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
page.on('console', (m) => { if (m.type() === 'error') console.error('  [page]', m.text()); });

await page.goto(httpUrl(join(HERE, 'render.html')));
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });

const manifest = [];
let ok = 0, fail = 0;

for (const m of models) {
  try {
    // Serve the glb through a route so relative texture refs resolve.
    const url = httpUrl(require_abs(m.path));
    const res = await page.evaluate((u) => window.__renderGlb(u), url);
    if (!res) throw new Error('empty bounding box');

    const file = `${m.kit}__${m.name}.png`;
    writeFileSync(join(OUT, file), Buffer.from(res.png.split(',')[1], 'base64'));
    manifest.push({
      id: m.id, kit: m.kit, name: m.name, file,
      sizeX: +res.sizeX.toFixed(4), sizeY: +res.sizeY.toFixed(4), sizeZ: +res.sizeZ.toFixed(4),
      radius: +res.radius.toFixed(4), baseY: +res.baseY.toFixed(4),
    });
    ok++;
    if (ok % 20 === 0) console.log(`  rendered ${ok}/${models.length}`);
  } catch (e) {
    fail++;
    console.error(`  FAIL ${m.id}: ${e.message}`);
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ tileRatio: 2, models: manifest }, null, 2));
console.log(`done: ${ok} ok, ${fail} failed -> ${OUT}`);
await browser.close();
server.close();
