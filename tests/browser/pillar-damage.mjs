// Keyboard hit -> native damage -> settled stump -> room revisit, with real assets.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.PILLAR_DAMAGE_OUT || '/tmp/nano-pillar-damage';
fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  await page.goto(process.env.PILLAR_DAMAGE_URL || `http://127.0.0.1:${server.address().port}/?seed=1`);
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.nanoDnf.getState().stage.id === 'mirkwooddeep' && !window.nanoDnf.getState().intro);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    C.goToCell(s, s.dungeon.cells.findIndex(c => c.col === 1 && c.row === 3));
    s.intro = null; s.transition = s.titleT = 0;
    s.enemies = []; s.shots = []; s.fields = []; s.pickups = [];
    s.room.cleared = true; C.currentCell(s).cleared = true;
    const p = s.props.find(p => p.nativePillar?.x === 506);
    if (!p || p.nativePillar.damagedAt !== -1) throw new Error('missing intact native pillar');
    s.player.x = 506 * 1.125 / C.CAMERA.zoom - 30;
    s.player.z = 0; s.player.facing = 1; s.player.invuln = 100;
    s.player.mp = Math.max(s.player.mp, 100); s.camera.x = 80;
  });
  const state = () => page.evaluate(() => {
    const s = window.nanoDnf.getState(), p = s.props.find(p => p.nativePillar?.x === 506);
    return { time: s.time, piece: p.piece, damagedAt: p.nativePillar.damagedAt, gone: !!p.gone, broken: p.broken };
  });
  await page.keyboard.press('p');
  await page.keyboard.press('x');
  await page.waitForTimeout(650);
  const missed = await state();
  assert.equal(missed.damagedAt, -1, 'wrong-depth keyboard swing misses');
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState(), p = s.props.find(p => p.nativePillar?.x === 506);
    s.player.x = 506 * 1.125 / C.CAMERA.zoom - 130;
    s.player.z = p.sortZ; s.player.facing = 1;
  });
  await page.keyboard.press('p');
  await page.keyboard.press('d');
  await page.waitForFunction(() => window.nanoDnf.getState().props.find(p => p.nativePillar?.x === 506)?.nativePillar.damagedAt >= 0, null, { timeout: 4000 });
  const hit = await state();
  await page.waitForTimeout(850);
  const settled = await state();
  assert.equal(settled.piece, 'pillarDamagedDecor');
  assert.equal(settled.damagedAt, hit.damagedAt);
  assert.equal(settled.gone, false);
  assert.equal(settled.broken, false);
  await page.keyboard.press('p');
  const render = await page.evaluate(() => {
    const s = window.nanoDnf.getState();
    const original = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => original(ctx, state, { ...meta, paused: false });
    return s.props.find(p => p.nativePillar?.x === 506).nativePillar;
  });
  await page.waitForTimeout(80);
  const image = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
  fs.writeFileSync(`${out}/settled.png`, Buffer.from(image.split(',')[1], 'base64'));
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    const cell = s.dungeon.cells.findIndex(c => c.col === 1 && c.row === 3);
    C.goToCell(s, s.dungeon.entry); C.goToCell(s, cell);
  });
  const revisited = await state();
  assert.equal(revisited.damagedAt, hit.damagedAt);
  assert.equal(revisited.piece, 'pillarDamagedDecor');
  assert.deepEqual(errors, []);
  const result = { missed, hit, settled, revisited, native: render, errors };
  fs.writeFileSync(`${out}/verification.json`, JSON.stringify(result, null, 2) + '\n');
  console.log('native pillar keyboard miss + wave hit + persistent stump OK', result);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
