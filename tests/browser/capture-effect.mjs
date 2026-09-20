/*
 * Frame-by-frame capture of one skill effect, for eyeballing it against the
 * client's own preview clip.
 *
 *   node tests/browser/capture-effect.mjs [skillId] [frames] [slowdown] [stepMs]
 *
 * Screenshots alone are too slow to catch a 1.05s cast: the first frame lands
 * after the eruption is already over. So this serves the real static build,
 * slows the clock the page sees (requestAnimationFrame timestamps are scaled,
 * nothing in the game is touched), casts the move from the hotbar and writes
 * one screenshot per step to /tmp/rift-ingame/fNN.png plus a log of the cast
 * progress each shot landed on.
 *
 * Used for 崩山裂地斩 (mountainRift): the row now starts on touchdown, and these
 * captures are what confirmed the sword offset and the 480px size against
 * OutRageBreak.avi. Output is a working reference, never committed.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.CAPTURE_OUT || "/tmp/rift-ingame";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

const skillId = process.argv[2] || "mountainRift";
const shots = Number(process.argv[3] || 24);
const slowdown = Number(process.argv[4] || 0.08);
const stepMs = Number(process.argv[5] || 550);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
await page.addInitScript((slow) => {
  const real = window.requestAnimationFrame.bind(window);
  const started = performance.now();
  window.requestAnimationFrame = (callback) =>
    real(() => callback(started + (performance.now() - started) * slow));
}, slowdown);
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);

const slotKey = await page.evaluate((id) => {
  const index = window.nanoDnf.getLoadout().indexOf(id);
  return index === -1 ? null : `Key${window.DNFLoadout.SLOT_KEYS[index]}`;
}, skillId);
if (!slotKey) throw new Error(`${skillId} is not on the hotbar`);
await page.keyboard.press(slotKey);

const log = [];
for (let shot = 0; shot < shots; shot += 1) {
  await page.screenshot({ path: path.join(OUT, `f${String(shot).padStart(2, "0")}.png`) });
  log.push(
    await page.evaluate((id) => {
      const state = window.nanoDnf.getState();
      const duration = window.DNFCore.SKILLS[id].duration;
      const casting = state.player.skillId === id;
      return {
        skillId: state.player.skillId,
        progress: casting ? Number((1 - state.player.skillTimer / duration).toFixed(3)) : null,
        x: Number(state.player.x.toFixed(1)),
        y: Number(state.player.y.toFixed(1)),
        facing: state.player.facing,
        groundY: window.DNFCore.ARENA.groundY
      };
    }, skillId)
  );
  await page.waitForTimeout(stepMs);
}
fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify(log, null, 1));
console.log(`${shots} shots in ${OUT} · casting ${log.filter((row) => row.progress !== null).length}`);
await browser.close();
server.close();
