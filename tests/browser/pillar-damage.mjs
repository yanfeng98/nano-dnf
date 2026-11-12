// Keyboard hit -> native damage -> settled stump -> room revisit, with real assets.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const room33 = process.env.PILLAR_DAMAGE_ROOM === '33';
const probe = room33 ? { col: 2, row: 2, nativeX: 1129 } : { col: 1, row: 3, nativeX: 506 };
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
  await page.addInitScript(value => { window.pillarProbe = value; }, probe);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  await page.addInitScript(() => {
    const bytesToUrl = new WeakMap(), buffersToUrl = new WeakMap();
    window.stoneAudioSources = [];
    window.stoneAudioDecoded = false;
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function (...args) {
      return arrayBuffer.apply(this, args).then(bytes => { bytesToUrl.set(bytes, this.url); return bytes; });
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (bytes, ...args) {
      return decode.call(this, bytes, ...args).then(buffer => {
        const url = bytesToUrl.get(bytes) || '';
        buffersToUrl.set(buffer, url);
        if (url.endsWith('/tstone_break.ogg')) window.stoneAudioDecoded = true;
        return buffer;
      });
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const url = buffersToUrl.get(this.buffer) || '';
      if (url.endsWith('/tstone_break.ogg')) window.stoneAudioSources.push({ url, duration: this.buffer.duration, rate: this.playbackRate.value });
      return start.apply(this, args);
    };
  });
  await page.goto(process.env.PILLAR_DAMAGE_URL || `http://127.0.0.1:${server.address().port}/?seed=1`);
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.nanoDnf.getState().stage.id === 'mirkwooddeep' && !window.nanoDnf.getState().intro);
  await page.waitForFunction(() => window.stoneAudioDecoded);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    C.goToCell(s, s.dungeon.cells.findIndex(c => c.col === window.pillarProbe.col && c.row === window.pillarProbe.row));
    s.intro = null; s.transition = s.titleT = 0;
    s.enemies = []; s.shots = []; s.fields = []; s.pickups = [];
    s.room.cleared = true; C.currentCell(s).cleared = true;
    const p = s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX);
    if (!p || p.nativePillar.damagedAt !== -1) throw new Error('missing intact native pillar');
    s.player.x = C.propObstacle(p).x - 20;
    s.player.z = 0; s.player.facing = 1; s.player.invuln = 100;
    s.player.mp = Math.max(s.player.mp, 100); s.camera.x = 80;
  });
  // Start from real free ground; only direction keys drive contact and bypass.
  const walkPastPillar = async () => {
    const geometry = await page.evaluate(() => {
      const C = window.DNFCore, s = window.nanoDnf.getState();
      const p = s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX);
      const box = C.propObstacle(p, s.player);
      s.enemies = []; s.shots = []; s.fields = []; s.pickups = [];
      s.intro = null; s.transition = s.titleT = 0;
      s.player.x = box.x - 70; s.player.z = box.z;
      s.player.vx = s.player.vz = 0; s.player.invuln = 100;
      return box;
    });
    await page.keyboard.press('p');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1000);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('p');
    const contact = await page.evaluate(() => window.nanoDnf.getState().player.x);
    assert.ok(Math.abs(contact - (geometry.x - geometry.width / 2)) < 0.05,
      'right key stops at the physical footprint');
    await page.evaluate(() => {
      const s = window.nanoDnf.getState();
      s.player.z = 0;
    });
    await page.keyboard.press('p');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1000);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('p');
    const bypass = await page.evaluate(() => window.nanoDnf.getState().player.x);
    assert.ok(bypass > geometry.x + geometry.width / 2, 'a clear depth lane permits walking past');
    return { geometry, contact, bypass };
  };
  const intactCollision = await walkPastPillar();
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    const p = s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX);
    s.player.x = C.propObstacle(p).x - 20;
    s.player.z = 0; s.player.facing = 1;
  });
  const state = () => page.evaluate(() => {
    const s = window.nanoDnf.getState(), p = s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX);
    return { time: s.time, piece: p.piece, damagedAt: p.nativePillar.damagedAt, gone: !!p.gone, broken: p.broken };
  });
  await page.keyboard.press('p');
  await page.keyboard.press('x');
  await page.waitForTimeout(650);
  const missed = await state();
  assert.equal(missed.damagedAt, -1, 'wrong-depth keyboard swing misses');
  assert.equal(await page.evaluate(() => window.stoneAudioSources.length), 0, 'miss does not play the native break cue');
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState(), p = s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX);
    s.player.x = C.propObstacle(p).x - 130;
    s.player.z = p.sortZ; s.player.facing = 1;
  });
  await page.keyboard.press('p');
  await page.keyboard.press('d');
  await page.waitForFunction(() => window.nanoDnf.getState().props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX)?.nativePillar.damagedAt >= 0, null, { timeout: 4000 });
  const hit = await state();
  await page.waitForFunction(() => window.stoneAudioSources.length === 1);
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
    return s.props.find(p => p.nativePillar?.x === window.pillarProbe.nativeX).nativePillar;
  });
  await page.waitForTimeout(80);
  const image = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
  fs.writeFileSync(`${out}/settled.png`, Buffer.from(image.split(',')[1], 'base64'));
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    const cell = s.dungeon.cells.findIndex(c => c.col === window.pillarProbe.col && c.row === window.pillarProbe.row);
    C.goToCell(s, s.dungeon.entry); C.goToCell(s, cell);
  });
  const revisited = await state();
  assert.equal(revisited.damagedAt, hit.damagedAt);
  assert.equal(revisited.piece, 'pillarDamagedDecor');
  const damagedCollision = await walkPastPillar();
  assert.deepEqual(errors, []);
  const audio = await page.evaluate(() => ({ sources: window.stoneAudioSources, runtime: window.nanoDnf.getAudioState() }));
  assert.equal(audio.sources.length, 1, 'settling and revisiting do not replay the cue');
  assert.equal(audio.sources[0].rate, 1, 'retain the native sample pitch');
  assert.equal(audio.runtime.state, 'running');
  assert.equal(audio.runtime.muted, false);
  const result = { room: room33 ? 33 : 42, missed, hit, settled, revisited, native: render, intactCollision, damagedCollision, audio, errors };
  fs.writeFileSync(`${out}/verification.json`, JSON.stringify(result, null, 2) + '\n');
  console.log('native pillar keyboard miss + wave hit + persistent stump OK', result);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
