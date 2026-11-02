/* Real menu entry and restart use the recording profile, not a label override. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.PROFILE_OUT || '/tmp/nano-starting-profile';
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  await page.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  const results = [];
  for (const [stage, level, deep] of [['mirkwood', 3, false], ['mirkwooddeep', 6, true]]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
    await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.nanoDnf.leaveTown());
    if (deep) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.nanoDnf.getProgress().regionOpen && window.nanoDnf.getState().transition <= 0);
    await page.keyboard.press('p');
    const actual = await page.evaluate(() => {
      const C = window.DNFCore, s = window.nanoDnf.getState(), p = s.player;
      return { stage: s.stage.id, upSlashSlot: window.nanoDnf.getLoadout().indexOf("upSlash"), level: p.level, name: p.name, upSlashRank: p.skillRanks?.upSlash, attackBonus: p.attackBonus,
        maxHp: p.maxHp, maxMp: p.maxMp, xpToNext: p.xpToNext,
        expectedHp: C.PLAYER.maxHp + (p.level - 1) * C.PROGRESSION.maxHpPerLevel,
        expectedMp: C.PLAYER.maxMp + (p.level - 1) * C.PROGRESSION.maxMpPerLevel };
    });
    assert.equal(actual.upSlashSlot, 1);
    assert.equal(actual.stage, stage); assert.equal(actual.level, level);
    assert.equal(actual.name, '阿努纳奇'); assert.equal(actual.upSlashRank, 1);
    assert.equal(actual.maxHp, actual.expectedHp); assert.equal(actual.maxMp, actual.expectedMp);
    assert.equal(actual.attackBonus, (level - 1) * 2);
    results.push(actual);
    const render = await page.evaluate(() => {
      const original = window.DNFRender.render;
      window.DNFRender.render = (ctx, s, m) => original(ctx, s, { ...m, paused: false });
      return true;
    });
    await page.waitForTimeout(100);
    const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
    fs.writeFileSync(`${out}/${stage}.png`, Buffer.from(url.split(',')[1], 'base64'));
    await page.evaluate(() => window.nanoDnf.restart());
    assert.equal(await page.evaluate(() => window.nanoDnf.getState().player.level), level);
  }
  // A custom/saved bar is intentional: refreshing must not silently reorder it.
  const custom = ['upSlash', 'mountainBreaker', null, 'bloodSword', null, null];
  await page.evaluate(slots => window.nanoDnf.setLoadout(slots), custom);
  await page.reload();
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  assert.deepEqual(await page.evaluate(() => window.nanoDnf.getLoadout()), custom);
  const reset = await page.evaluate(() => window.nanoDnf.resetLoadout());
  assert.equal(reset[1], 'upSlash');
  await page.reload();
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  assert.deepEqual(await page.evaluate(() => window.nanoDnf.getLoadout()), reset);
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(results, null, 2));
  console.log('starting profiles OK', results);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
