// Real Core throwerElite emission, loaded FlyBomb bitmap and rotation/pause checks.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.BOMB_OUT || '/tmp/nano160-bomb-browser';
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.css': 'text/css' };
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(process.env.BOMB_URL || `http://127.0.0.1:${server.address().port}/?seed=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.nanoDnf.getState().intro && window.nanoDnf.getState().transition <= 0);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const s = window.nanoDnf.getState(), C = window.DNFCore;
    s.intro = null; s.titleT = s.transition = 0; s.target = null; s.props = [];
    s.room.pendingWave = []; s.room.pendingWaves = [];
    s.player.x = 500; s.camera.x = 500 - 250 / C.CAMERA.zoom;
    const original = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => {
      const draw = ctx.drawImage;
      window.bombDraws = [];
      ctx.drawImage = function (...args) {
        if (args[0] === meta.sprites.goblinBomb) {
          const m = this.getTransform();
          window.bombDraws.push({
            src: args[0].src,
            source: args.slice(1, 5),
            angle: Math.atan2(m.b, m.a),
            cellScreenWidth: args[7] * Math.hypot(m.a, m.b)
          });
        }
        return draw.apply(this, args);
      };
      try { return original(ctx, state, { ...meta, paused: false }); } finally { ctx.drawImage = draw; }
    };
  });

  const emitted = await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    const e = C.createEnemy(s, 'throwerElite', 500 + 200 / C.CAMERA.zoom);
    s.enemies = [e]; s.projectiles = []; s.hitStop = 0; s.player.invuln = Infinity; e.z = s.player.z;
    e.attackKind = 'shoot'; e.attackTimer = e.attackDuration = 0.85; e.attackWindup = 0.55; e.attackHitDone = false;
    for (let i = 0; i < 45 && !s.projectiles.length; i++) C.step(s, {});
    const shot = s.projectiles[0];
    s.enemies = [];
    return { count: s.projectiles.length, nativeObject: shot?.nativeObject, hitDone: e.attackHitDone };
  });
  assert.equal(emitted.count, 1);
  assert.equal(emitted.nativeObject, 30021);
  assert.ok(emitted.hitDone);

  for (const age of [0, 0.0375, 0.075]) {
    await page.evaluate(age => {
      const s = window.nanoDnf.getState();
      s.time = 1234;
      s.projectiles[0].life = s.projectiles[0].maxLife - age;
    }, age);
    await page.waitForTimeout(80);
    const draws = await page.evaluate(() => window.bombDraws);
    assert.equal(draws.length, 1);
    const draw = draws[0];
    assert.ok(draw.src.endsWith('/assets/goblin-bomb.png'));
    assert.deepEqual(draw.source, [0, 0, 32, 32]);
    const expectedAngle = -((age / 0.15) % 1) * 6.28000020980835;
    assert.ok(Math.abs(Math.atan2(Math.sin(draw.angle - expectedAngle), Math.cos(draw.angle - expectedAngle))) < 1e-6);
    assert.ok(Math.abs(draw.cellScreenWidth - 36) < 1e-5);
  }

  const before = await page.evaluate(() => ({ draw: window.bombDraws, life: window.nanoDnf.getState().projectiles[0].life }));
  await page.waitForTimeout(160);
  const after = await page.evaluate(() => ({ draw: window.bombDraws, life: window.nanoDnf.getState().projectiles[0].life }));
  assert.deepEqual(after, before, 'pause freezes FlyBomb phase and life');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ url: page.url(), emitted, errors }, null, 2) + '\n');
  console.log('throwerElite FlyBomb 30021 emission, bitmap/rotation and pause stability OK');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
