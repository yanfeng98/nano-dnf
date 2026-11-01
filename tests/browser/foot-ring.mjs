/* V2 76s: compare the live renderer's foot-ring highlight with the recording.
 * One browser, fixed camera, real assets and renderer; no pixel recolouring. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.FOOT_RING_OUT || '/tmp/nano-foot-ring';
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
  await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3400);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    const cell = s.dungeon.cells.findIndex(c => c.col === 2 && c.row === 3);
    C.goToCell(s, cell);
    s.player.x = (207 + 418) / C.CAMERA.zoom;
    s.player.z = 250;
    s.player.invuln = s.player.hurtTimer = 0;
    s.player.buffs = {};
    s.camera.x = 207 / C.CAMERA.zoom;
    s.titleT = s.transition = 0; s.intro = null;
    window.nanoDnf.setMapMode('window');
    const render = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => render(ctx, state, { ...meta, paused: false });
  });
  await page.waitForTimeout(150);
  const reference = fs.readFileSync(new URL('../../docs/reference-evidence/02-foot-ring-reference-076.25.png', import.meta.url)).toString('base64');
  const measured = await page.locator('#stage').evaluate(async (canvas, reference) => {
    const ctx = canvas.getContext('2d');
    // The measured 65x22px footprint at the V2 76s matched camera.
    function highlight(data) {
      const pixels = [];
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = data.slice(i, i + 3);
        if (g > 150 && g > r * 0.9 && g > b * 1.5) pixels.push([r, g, b]);
      }
      pixels.sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]));
      const highlight = pixels.slice(0, 100);
      return { count: highlight.length, rgb: [0, 1, 2].map(i => highlight.reduce((sum, c) => sum + c[i], 0) / highlight.length) };
    }
    const img = new Image();
    img.src = 'data:image/png;base64,' + reference;
    await img.decode();
    const sample = document.createElement('canvas');
    sample.width = img.width; sample.height = img.height;
    const refCtx = sample.getContext('2d');
    refCtx.drawImage(img, 0, 0);
    return { actual: highlight(ctx.getImageData(503, 338, 70, 23).data),
      reference: highlight(refCtx.getImageData(0, 0, img.width, img.height).data) };
  }, reference);
  const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
  fs.writeFileSync(`${out}/076.png`, Buffer.from(url.split(',')[1], 'base64'));
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(measured, null, 2));
  console.log('foot-ring highlight', measured);
  assert.equal(measured.actual.count, 100);
  // Compare highlight colour, allowing vegetation/boots to occlude different pixels.
  [35, 30, 35].forEach((tolerance, channel) => {
    assert.ok(Math.abs(measured.actual.rgb[channel] - measured.reference.rgb[channel]) <= tolerance,
      `foot-ring highlight channel ${channel}: actual ${measured.actual.rgb}, reference ${measured.reference.rgb}`);
  });
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
