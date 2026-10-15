/*
 * Frame captures of the in-game HUD, for eyeballing it against the recording.
 *
 *   CAPTURE_OUT=/tmp/hud-after node tests/browser/capture-hud.mjs
 *
 * Four shots: a room while it is being fought (the foot mark, the rating panel
 * on the right, the log filling up on the left), the drops lying on the floor
 * after a kill, the same room once they have been walked over, and the boss
 * room right after the first blow lands on him - which is the frame the top
 * banner is supposed to light up on (`docs/adr/0043`).
 *
 * These are the only acceptance any of that has: the unit tests can say the log
 * has eight slots and that a kill drops something, but "does it read like the
 * recording" is a thing a person looks at. Output is a working reference, never
 * committed.
 *
 * Everything is driven with real key events, so the captures show the shipped
 * input path; the room jumps go through `Core.goToCell` on the live state, which
 * is what the browser suite does too.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.CAPTURE_OUT || "/tmp/hud-ingame";
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
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);

const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });

await page.waitForTimeout(1200);
/* First Enter opens the 地区地图, the second enters the stage it has selected. */
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await page.keyboard.press("Enter");
/* The cutscene, then the room with the stage title still hanging over it. */
await page.waitForTimeout(700);
await shot("00-cutscene");
/* 2.04s 插画 + 0.3s 全黑之后房间才淡进来，关卡名从那一刻挂 4.2 秒。 */
await page.waitForTimeout(2600);
await shot("01-stage-title");

/*
 * Fight the opening room: walk in among them and swing. The point of the shot
 * is the right-hand panel and the log moving, so it has to be a real fight
 * rather than scripted damage.
 */
for (let pass = 0; pass < 14; pass += 1) {
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(420);
  await page.keyboard.up("ArrowRight");
  for (let cut = 0; cut < 3; cut += 1) {
    await page.keyboard.press("KeyX");
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(260);
}
await shot("02-fighting");

/* The drops the kills left on the floor, before anybody walks over them. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  state.enemies.forEach((enemy) => { if (!enemy.dead) enemy.hp = 0; });
});
await page.waitForTimeout(1200);
await shot("03-drops");

/* Walk the room so the plates get collected and the log fills. */
for (let pass = 0; pass < 6; pass += 1) {
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowRight");
}
await page.waitForTimeout(200);
await shot("04-collected");

/*
 * The boss room, and the first blow that lands on him: that is the frame the
 * top banner lights up on (`docs/adr/0043`), not the frame he walks in on.
 */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  window.DNFCore.goToCell(state, state.dungeon.boss);
});
await page.waitForTimeout(600);
await shot("05-boss-room");
await page.evaluate(() => {
  const Core = window.DNFCore;
  const state = window.nanoDnf.getState();
  const boss = state.enemies.find((enemy) => enemy.type === "boss");
  if (!boss) throw new Error("no boss in the boss room");
  state.player.x = boss.x - 40;
  state.player.z = boss.z || 0;
  Core.damageEnemy(state, boss, 12, 0, boss.x, { slayerSwing: true });
});
await page.waitForTimeout(200);
await shot("06-boss-engaged");

/*
 * 冠军怪那一圈光环（`docs/adr/0046`）：跳到摆着 `咒之赤哥布林` 的那一间，
 * 把镜头推过去。它是"同一具身体 + 一层 `champdark`"，所以这一帧要能看出
 * 紫光罩在赤哥布林身上、而不是换了一只怪。
 */
await page.evaluate(() => {
  const Core = window.DNFCore;
  const state = window.nanoDnf.getState();
  /* 前面那场 Boss 已经把他打死了，先把他扶起来再去看这一间。 */
  state.defeat = false;
  state.player.dead = false;
  state.player.hp = state.player.maxHp;
  const index = state.stage.rooms.findIndex((room) =>
    (room.enemies || []).some((one) => one.type === "cursedRed"));
  const cell = state.dungeon.cells.findIndex((spot) => spot.room === index);
  Core.goToCell(state, cell);
  state.enemies.forEach((enemy) => { if (enemy.champion) enemy.attackCooldown = 9; });
});
await page.waitForTimeout(700);
await shot("07-champion");

/* 通关那一页：评级徽记与那只箱子（`docs/adr/0045`）。 */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  state.stats.hitsTaken = 6;
  state.victory = true;
});
/* 两拍：逐行刚出来那一下，与开箱之后。 */
await page.waitForTimeout(600);
await shot("08-victory-rows");
await page.waitForTimeout(4200);
await shot("09-victory-reward");

await browser.close();
server.close();
console.log(`captures -> ${OUT}`);
