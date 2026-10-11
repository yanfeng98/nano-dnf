/*
 * Frame-by-frame capture of one monster death, for eyeballing it against the
 * owner's dungeon recording (`/home/luyanfeng/luyanfeng/dnf-dungeon-videos/`).
 *
 *   node tests/browser/capture-death.mjs [frames] [outDir]
 *
 * The page's own loop is frozen (its rAF clock is pinned), and each shot is
 * taken after stepping the real `Core.step(state, {}, 1/60)` by hand - so the
 * frames come out exactly one game frame apart, which is what a 0.2s smoke
 * needs if it is going to be compared with a 30fps recording.
 *
 * The log line per shot carries `t` (game time), the dying monster's `dying`
 * countdown and the effects on the floor, so a mismatch can be pointed at a
 * number rather than at an impression.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.argv[3] || process.env.CAPTURE_OUT || "/tmp/death-ingame";
const SHOTS = Number(process.argv[2] || 120);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

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
/*
 * A clock the script owns. `scale` 1 is real time (the room fade-in needs it);
 * `scale` 0 freezes the loop, and then `t += 1/60` advances exactly one frame.
 */
await page.addInitScript(() => {
  const real = window.requestAnimationFrame.bind(window);
  window.__vclock = { scale: 1, t: 0, last: performance.now() };
  window.requestAnimationFrame = (callback) =>
    real(() => {
      const now = performance.now();
      window.__vclock.t += (now - window.__vclock.last) * window.__vclock.scale;
      window.__vclock.last = now;
      callback(window.__vclock.t);
    });
});
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);
/* Out of the title (any key), through the region map (Enter), into the stage. */
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
for (let press = 0; press < 5; press += 1) {
  const regionOpen = await page.evaluate(() => window.nanoDnf.getProgress().regionOpen);
  if (!regionOpen) break;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
}
if (await page.evaluate(() => window.nanoDnf.getProgress().regionOpen)) {
  throw new Error("the region map never closed - the capture would shoot the stage select");
}
/* And prove the run is actually ticking before the clock is taken over: the
   title screen keeps `state.time` at 0, so "no error" is not "in a stage". */
const running = await page.evaluate(async () => {
  const first = window.nanoDnf.getState().time;
  await new Promise((resolve) => setTimeout(resolve, 350));
  return window.nanoDnf.getState().time - first;
});
if (running <= 0) throw new Error("the run is not ticking - the capture would shoot a still");
/* Let the room's fade-in finish on the real clock, then take the clock over. */
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__vclock.scale = 0;
});

/* One monster in reach, the rest parked out of the frame so nothing else moves. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  /*
   * Both stand near the middle of the room: the vignette eats brightness at the
   * edges, and the recording this is compared against was shot mid-screen.
   */
  state.player.x = window.DNFCore.ARENA.width / 2 - 50;
  state.enemies.forEach((enemy, index) => {
    enemy.speed = 0;
    enemy.chargeSpeed = 0;
    enemy.attackRange = 0;
    if (index === 0) {
      enemy.x = state.player.x + 70;
      enemy.z = state.player.z;
    } else {
      enemy.x = 1400;
    }
  });
  state.player.facing = 1;
});

/* Kill it through the real damage path. */
const kill = async () => {
  await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    window.DNFCore.damageEnemy(state, state.enemies[0], 99999, 0, state.player.x);
  });
};
const KILL_AT = Number(process.env.KILL_AT || 0);
if (KILL_AT === 0) await kill();

const log = [];
for (let shot = 0; shot < SHOTS; shot += 1) {
  if (shot === KILL_AT) await kill();
  /*
   * Exactly one game frame. rAF timestamps are milliseconds, so one 60Hz frame
   * is 1000/60 ms here - adding `1/60` moves the clock 0.017ms and the game
   * (rightly) does nothing.
   */
  await page.evaluate(() => {
    window.__vclock.t += 1000 / 60;
  });
  /* Let the renderer draw the state we just stepped to. */
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  const name = `f${String(shot).padStart(3, "0")}.png`;
  await page.screenshot({ path: path.join(OUT, name) });
  log.push(
    await page.evaluate((file) => {
      const state = window.nanoDnf.getState();
      const first = state.enemies[0];
      return {
        file,
        t: Number(state.time.toFixed(3)),
        enemies: state.enemies.length,
        dying: first ? Number((first.dying || 0).toFixed(3)) : null,
        smoking: first ? !!first.smoking : null,
        effects: state.effects.map((e) => e.kind + ":" + Number((e.life || 0).toFixed(2))).join(" ")
      };
    }, name)
  );
}

fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify(log, null, 1));
console.log(`wrote ${SHOTS} frames + log.json to ${OUT}`);
console.log(log.slice(0, 6).map((r) => JSON.stringify(r)).join("\n"));
console.log("...");
console.log(log.slice(-3).map((r) => JSON.stringify(r)).join("\n"));
await browser.close();
server.close();
