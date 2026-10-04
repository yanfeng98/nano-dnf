/*
 * Shoots 血之狂暴's 血球 crossing the arena, so the ball, its tail and the
 * arrival flash can be compared against the reference frame by frame
 * (docs/adr/0020). Nothing else does: capture-effect.mjs casts a hotbar skill,
 * and a skill does not draw blood out of anything.
 *
 * The orb is built by hand rather than hit out of a monster - a hit draws it
 * wherever that monster happens to be standing, and the read wants one long
 * crossing with nothing else on screen. The shape is the core's own
 * (`spawnBloodOrb`); if those fields change, this has to change with them.
 *
 *   node tests/browser/capture-orb-flight.mjs [shots] [slowdown] [stepMs]
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/luyanfeng/luyanfeng/nano-dnf";
const OUT = process.env.CAPTURE_OUT || path.join(ROOT, "assets/dnf_src/bilibili/skill-clips/orb-flight");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".png": "image/png" };

const shots = Number(process.argv[2] || 40);
const slowdown = Number(process.argv[3] || 0.06);
const stepMs = Number(process.argv[4] || 90);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
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
  window.requestAnimationFrame = (cb) => real(() => cb(started + (performance.now() - started) * slow));
}, slowdown);
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);

/* No monsters: this run is about the orb, and a hit would spawn its own. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  state.enemies.forEach((enemy) => { enemy.speed = 0; enemy.attackRange = 0; enemy.x = 900; });
});

/* The stance has to be up: it is what makes him red and the orbs his. */
const rageKey = await page.evaluate(() => {
  const index = window.nanoDnf.getLoadout().indexOf("frenzy");
  return index === -1 ? null : `Key${window.DNFLoadout.SLOT_KEYS[index]}`;
});
await page.keyboard.press(rageKey);
await page.waitForFunction(() => {
  const p = window.nanoDnf.getState().player;
  return p.buffs.bloodRage > 0 && p.skillId !== "frenzy";
}, null, { timeout: 60000 });
await page.waitForTimeout(6000);

/* Hand-build one orb at fighting distance - the same shape the core spawns. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  const player = state.player;
  const x = player.x + 300;
  const y = player.y - 40;
  state.pickups.push({
    kind: "blood_orb",
    x, y, z: 0,
    radius: 20,
    value: 4,
    life: 1.2,
    fromX: x,
    fromY: y,
    progress: 0,
    trail: [{ x, y }]
  });
});

const log = [];
for (let shot = 0; shot < shots; shot += 1) {
  await page.screenshot({ path: path.join(OUT, `f${String(shot).padStart(2, "0")}.png`) });
  log.push(await page.evaluate(() => {
    const s = window.nanoDnf.getState();
    const orb = s.pickups.find((d) => d.kind === "blood_orb");
    return {
      t: Number(s.time.toFixed(3)),
      orb: orb ? { x: Number(orb.x.toFixed(1)), y: Number(orb.y.toFixed(1)), trail: orb.trail.length } : null,
      flashes: s.effects.filter((e) => e.kind === "bloodFlash").length
    };
  }));
  await page.waitForTimeout(stepMs);
}
fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify({ shots: log }, null, 1));
const first = log.find((row) => row.orb);
const last = [...log].reverse().find((row) => row.orb);
console.log(`${shots} shots -> ${OUT}`);
console.log(`orb visible ${log.filter((r) => r.orb).length} shots, trail up to ${Math.max(0, ...log.map((r) => (r.orb ? r.orb.trail : 0)))} entries`);
if (first && last) console.log(`span ${first.t} -> ${last.t}s, x ${first.orb.x} -> ${last.orb.x}`);
console.log(`flash frames: ${log.filter((r) => r.flashes).length}`);
await browser.close();
server.close();
