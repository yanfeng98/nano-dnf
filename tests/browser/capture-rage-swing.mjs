/*
 * Frame-by-frame capture of 血之狂暴's dual-blade *normal attack*, which no
 * existing harness shoots: capture-effect.mjs casts a hotbar skill, and the
 * playability run photographs whatever it happens to be doing.
 *
 *   node /tmp/capture-rage-swing.mjs [shots] [slowdown] [stepMs]
 *
 * Opens the stance, then presses X and shoots every step. Output to
 * rage-swing-current/ under the gitignored assets/dnf_src tree, plus log.json.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/luyanfeng/luyanfeng/nano-dnf";
const OUT = process.env.CAPTURE_OUT || path.join(ROOT, "assets/dnf_src/bilibili/skill-clips/rage-swing-current");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

const shots = Number(process.argv[2] || 30);
const slowdown = Number(process.argv[3] || 0.05);
const stepMs = Number(process.argv[4] || 200);

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

/* Park the monsters: an interruption hands the swing to the hurt animation. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  state.enemies.forEach((enemy) => {
    enemy.speed = 0;
    enemy.chargeSpeed = 0;
    enemy.attackRange = 0;
    enemy.x = 900;
  });
});

const rageKey = await page.evaluate(() => {
  const index = window.nanoDnf.getLoadout().indexOf("frenzy");
  return index === -1 ? null : `Key${window.DNFLoadout.SLOT_KEYS[index]}`;
});
if (!rageKey) throw new Error("血之狂暴 is not on the hotbar");
await page.keyboard.press(rageKey);
await page.waitForFunction(
  () => {
    const player = window.nanoDnf.getState().player;
    return player.buffs.bloodRage > 0 && player.skillId !== "frenzy";
  },
  null,
  { timeout: 60000 }
);
/* Let the stance's own second beat finish so it does not confuse the swing. */
await page.waitForTimeout(6000);

const log = [];
/* Press attack, then shoot fast enough to walk the 0.22s swing. */
await page.keyboard.down("KeyX");
for (let shot = 0; shot < shots; shot += 1) {
  await page.screenshot({ path: path.join(OUT, `f${String(shot).padStart(2, "0")}.png`) });
  log.push(
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      const player = state.player;
      return {
        attackTimer: Number((player.attackTimer || 0).toFixed(4)),
        attackDuration: Number((player.attackDuration || 0).toFixed(4)),
        combo: player.comboIndex === undefined ? null : player.comboIndex,
        progress:
          player.attackTimer > 0
            ? Number((1 - player.attackTimer / player.attackDuration).toFixed(3))
            : null,
        raging: !!(player.buffs && player.buffs.bloodRage > 0),
        x: Number(player.x.toFixed(1)),
        y: Number(player.y.toFixed(1)),
        facing: player.facing,
        gather: Number((player.buffs && player.buffs.frenzyGather) || 0)
      };
    })
  );
  await page.waitForTimeout(stepMs);
}
await page.keyboard.up("KeyX");
const canvasRect = await page.evaluate(() => {
  const rect = document.getElementById("stage").getBoundingClientRect();
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
});
fs.writeFileSync(
  path.join(OUT, "log.json"),
  JSON.stringify({ canvas: canvasRect, shots: log }, null, 1)
);
const swinging = log.filter((row) => row.progress !== null).length;
console.log(`${shots} shots in ${OUT} · frames with an attack in flight: ${swinging}`);
await browser.close();
server.close();
