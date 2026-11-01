/* Real Canvas XP fill at zero, half and full, in town and dungeon. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.XP_CARD_OUT || '/tmp/nano-xp-card';
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
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.nanoDnf.getTown().open);
  const measurements = [];
  for (const mode of ['town', 'dungeon']) {
    if (mode === 'dungeon') {
      await page.evaluate(() => window.nanoDnf.leaveTown());
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3400);
      await page.keyboard.press('p');
      await page.evaluate(() => {
        const render = window.DNFRender.render;
        window.DNFRender.render = (ctx, state, meta) => render(ctx, state, { ...meta, paused: false });
      });
    }
    for (const share of [0, 0.5, 1]) {
      // Controlled rendering boundaries, not a change to the progression model.
      await page.evaluate(share => {
        const p = window.nanoDnf.getState().player;
        p.xpToNext = 100; p.xp = share * 100;
      }, share);
      await page.waitForTimeout(100);
      const bounds = await page.locator('#stage').evaluate(canvas => {
        const { data } = canvas.getContext('2d').getImageData(254, 485, 160, 8);
        let left = 160, right = -1;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 160; x++) {
          const i = (y * 160 + x) * 4;
          const [r, g, b] = data.slice(i, i + 3);
          if (g > 180 && g > r * 1.1 && g > b * 1.5) {
            left = Math.min(left, x); right = Math.max(right, x);
          }
        }
        return { width: right < 0 ? 0 : right - left + 1, left, right };
      });
      const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
      fs.writeFileSync(`${out}/${mode}-${share * 100}.png`, Buffer.from(url.split(',')[1], 'base64'));
      measurements.push({ mode, share, ...bounds });
      assert.ok(Math.abs(bounds.width - 160 * share) <= 2,
        `${mode} at ${share * 100}%: expected ${160 * share}px, saw ${bounds.width}px`);
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(measurements, null, 2));
  console.log('XP card browser OK', JSON.stringify(measurements));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
