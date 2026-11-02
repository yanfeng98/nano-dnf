/* Real S-key cast: ready -> cooldown -> recovered, compared with V1 grey glyph. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.SKILL_STATE_OUT || '/tmp/nano-skill-states';
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
  await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const api = window.nanoDnf, s = api.getState();
    return !s.intro && s.transition <= 0 && !api.getProgress().regionOpen && !api.getTown().open;
  });
  await page.keyboard.press('p');
  await page.evaluate(() => {
    window.nanoDnf.setLoadout([null, 'upSlash', null, null, null, null]);
    const p = window.nanoDnf.getState().player;
    p.mp = p.maxMp;
    const render = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => render(ctx, state, { ...meta, paused: false });
  });
  const reference = fs.readFileSync(new URL('../../docs/reference-evidence/01-upslash-grey-reference-150.00.png', import.meta.url)).toString('base64');
  const snapshots = [];
  async function capture(name) {
    await page.waitForTimeout(100);
    const result = await page.locator('#stage').evaluate(async (canvas, reference) => {
      // Skip the recording's Lv label and key cap; compare the glyph body.
      const actual = canvas.getContext('2d').getImageData(584, 515, 31, 14).data;
      const img = new Image(); img.src = 'data:image/png;base64,' + reference; await img.decode();
      const sample = document.createElement('canvas'); sample.width = 31; sample.height = 14;
      const ctx = sample.getContext('2d'); ctx.drawImage(img, 0, 0);
      const expected = ctx.getImageData(0, 0, 31, 14).data;
      let a = [], b = [], chroma = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const c = [...actual.slice(i, i + 3)], r = [...expected.slice(i, i + 3)];
        chroma += Math.max(...c) - Math.min(...c);
        a.push(0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]);
        b.push(0.2126*r[0] + 0.7152*r[1] + 0.0722*r[2]);
      }
      const ma = a.reduce((s, n) => s+n, 0)/a.length, mb = b.reduce((s, n) => s+n, 0)/b.length;
      let covariance = 0, va = 0, vb = 0;
      a.forEach((n, i) => { const da=n-ma, db=b[i]-mb; covariance+=da*db; va+=da*da; vb+=db*db; });
      return { chroma: chroma/a.length, correlation: covariance/Math.sqrt(va*vb), rgba: [...actual],
        cooldown: window.nanoDnf.getState().player.skillCooldowns.upSlash || 0 };
    }, reference);
    const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    snapshots.push({ name, ...result });
    return result;
  }
  const ready = await capture('ready');
  await page.keyboard.press('p');
  await page.keyboard.press('KeyS');
  await page.waitForFunction(() => window.nanoDnf.getState().player.skillCooldowns.upSlash > 0);
  await page.keyboard.press('p');
  const cooling = await capture('cooldown');
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.nanoDnf.getState().player.skillCooldowns.upSlash <= 0);
  await page.keyboard.press('p');
  const recovered = await capture('recovered');
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(snapshots.map(({rgba, ...m}) => m), null, 2));
  console.log('skill-state snapshots', snapshots.map(({rgba, ...m}) => m));
  assert.ok(ready.chroma > 25, 'the ready icon remains coloured');
  assert.ok(cooling.chroma < 12 && cooling.correlation > 0.6, 'cooldown has the recorded neutral glyph without a blue decimal overlay');
  assert.deepEqual(recovered.rgba, ready.rgba, 'real cooldown expiry restores the original coloured pixels');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
