/* Compare a controlled second-slot up-slash against the raw V2 recording crop. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.SKILL_ICON_OUT || '/tmp/nano-skill-icons';
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
  await page.waitForTimeout(3400);
  await page.keyboard.press('p');
  await page.evaluate(() => {
    window.nanoDnf.setLoadout([null, 'upSlash', null, null, null, null]);
    const p = window.nanoDnf.getState().player;
    p.mp = p.maxMp; p.skillCooldowns.upSlash = 0;
    const render = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => render(ctx, state, { ...meta, paused: false });
  });
  await page.waitForTimeout(100);
  const reference = fs.readFileSync(new URL('../../docs/reference-evidence/02-upslash-slot-reference-076.25.png', import.meta.url)).toString('base64');
  const measured = await page.locator('#stage').evaluate(async (canvas, reference) => {
    const actual = canvas.getContext('2d').getImageData(584, 503, 31, 31).data;
    const img = new Image(); img.src = 'data:image/png;base64,' + reference; await img.decode();
    const sample = document.createElement('canvas'); sample.width = sample.height = 31;
    const ctx = sample.getContext('2d'); ctx.drawImage(img, 0, 0);
    const expected = ctx.getImageData(0, 0, 31, 31).data;
    let a = [], b = [];
    for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) { a.push(actual[i]); b.push(expected[i]); }
    const ma = a.reduce((s, n) => s + n, 0) / a.length, mb = b.reduce((s, n) => s + n, 0) / b.length;
    let covariance = 0, va = 0, vb = 0;
    a.forEach((n, i) => { const da = n - ma, db = b[i] - mb; covariance += da * db; va += da * da; vb += db * db; });
    return { correlation: covariance / Math.sqrt(va * vb), rect: [584, 503, 31, 31] };
  }, reference);
  const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
  fs.writeFileSync(`${out}/actual.png`, Buffer.from(url.split(',')[1], 'base64'));
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(measured, null, 2));
  console.log('skill-icon reference comparison', measured);
  assert.ok(measured.correlation >= 0.65, 'the up-slash icon must occupy the recorded second-slot rectangle');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
