// Controlled real-Canvas evidence for the room42 physical-anchor depth plane.
// Run npm run serve first; the full browser suite separately checks keyboard travel.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.PILLAR_ORDER_OUT || '/tmp/nano-pillar-order';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
  await page.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  await page.goto(process.env.PILLAR_ORDER_URL || 'http://localhost:8080/?seed=1');
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3400);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    C.goToCell(s, s.dungeon.cells.findIndex(c => c.col === 1 && c.row === 3));
    s.intro = null; s.transition = s.titleT = 0; s.enemies = []; s.effects = [];
    const p = s.props.find(p => p.x === 362 && p.piece === 'pillarDecor');
    if (!p) throw new Error('room42 pillar absent');
    s.props = [p]; s.player.x = p.x; s.player.buffs = {};
    s.player.invuln = s.player.hurtTimer = 0; s.camera.x = 150;
    const render = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => {
      const draw = ctx.drawImage, order = [];
      ctx.drawImage = function (img, ...args) {
        if (img === meta.sprites.pillarPale) order.push('pillar');
        if (img === meta.sprites.slayer) order.push('body');
        return draw.call(this, img, ...args);
      };
      try { return render(ctx, state, { ...meta, paused: false }); }
      finally { ctx.drawImage = draw; window.pillarOrder = order; }
    };
  });
  const records = [];
  // The plane is independently measured native y241, not read from production sortZ.
  for (const [name, delta] of [['front', -10], ['behind', 10]]) {
    await page.evaluate(delta => {
      const C = window.DNFCore, s = window.nanoDnf.getState();
      s.player.z = (430 - (241 * 1.125 + 92)) / (C.CAMERA.zoom * C.DEPTH.scale) + delta;
    }, delta);
    await page.waitForTimeout(100);
    const record = await page.evaluate(() => ({ z: window.nanoDnf.getState().player.z, order: window.pillarOrder }));
    assert.deepEqual(record.order, name === 'front' ? ['pillar', 'body'] : ['body', 'pillar']);
    records.push({ name, ...record });
    const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  fs.writeFileSync(`${out}/order.json`, JSON.stringify(records, null, 2) + '\n');
  console.log('native pillar depth plane OK', records);
} finally { await browser.close(); }
