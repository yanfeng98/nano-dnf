/*
 * Frame captures of 魔狱血刹's whole shape, for eyeballing it in the running
 * game against the reference (docs/adr/0025).
 *
 *   node tests/browser/capture-awakening.mjs
 *
 * `capture-effect.mjs` cannot do this one, for two reasons: the move has **no
 * hotbar slot** (all twelve are taken), so it is cast with its own key rather
 * than a slot key; and it is a **state**, not a cast - the interesting frames are
 * spread over fifty seconds, most of them with `skillId === null`.
 *
 * So this drives it in three steps and writes one screenshot each:
 *
 *   起手    press V and walk the cast's own second - the 觉醒插画 sliding in and
 *           the 血气之剑 coming up on his back
 *   持剑    set the buff to a little under full and walk him left, right and up
 *           the screen - the sword has to follow, stay behind him and keep its
 *           tip off the floor
 *   落      press V again - the sword goes down and the state ends
 *
 * The clock is slowed the same way `capture-effect.mjs` slows it (the page's own
 * `requestAnimationFrame` timestamps are scaled; nothing in the game is
 * touched), so a 1.0s cast can be photographed frame by frame. The two state
 * jumps - the buff's remaining seconds and the sword's tier - are written
 * straight onto the player, the same way that harness parks monsters; they are
 * stand-ins for fifty seconds of playing, not for the move's own code.
 *
 * Output goes to a gitignored folder under the repo so it can be looked at
 * without a /tmp path: assets/dnf_src/bilibili/skill-clips/awakening-ingame/.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT =
  process.env.CAPTURE_OUT ||
  path.join(ROOT, "assets/dnf_src/bilibili/skill-clips/awakening-ingame");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};
/* Slower than capture-effect's 0.08: the cut-in lives in the first 0.15s. */
const slowdown = Number(process.env.SLOWDOWN || 0.05);
const stepMs = Number(process.env.STEP_MS || 420);

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

/* Enemies parked out of reach so the state runs undisturbed. */
await page.evaluate(() => {
  const state = window.nanoDnf.getState();
  state.enemies.forEach((enemy) => {
    enemy.speed = 0;
    enemy.chargeSpeed = 0;
    enemy.attackRange = 0;
    enemy.x = 900;
  });
});

const log = [];
async function shot(name, note) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  log.push(
    await page.evaluate(
      ({ note }) => {
        const state = window.nanoDnf.getState();
        const player = state.player;
        return {
          note,
          skillId: player.skillId,
          tier: player.hellbenterTier,
          buff: Number((player.buffs.hellbenter || 0).toFixed(2)),
          x: Number(player.x.toFixed(1)),
          z: Number(player.z.toFixed(1)),
          facing: player.facing
        };
      },
      { note }
    )
  );
}

/* -- 起手: the cast's own second, walked in tenths ------------------------- */
await page.keyboard.press("KeyV");
for (let step = 0; step < 10; step += 1) {
  await shot(`cast-${String(step).padStart(2, "0")}`, "起手");
  await page.waitForTimeout(stepMs);
}

/*
 * **Wait for the cast to actually be over before touching the state.** The
 * slowed clock means ten shots cover a fifth of the second the cast takes, and
 * a state written while it is still running is overwritten by the cast's own
 * ending - the sword the harness was about to photograph goes back to tier 1 the
 * moment the buff lands.
 */
await page.waitForFunction(
  () => {
    const player = window.nanoDnf.getState().player;
    return player.skillId === null && player.buffs.hellbenter > 0;
  },
  null,
  { timeout: 120000 }
);

/* -- 持剑: a state that outlives the cast ---------------------------------- */
async function jumpTo(seconds) {
  await page.evaluate((left) => {
    window.nanoDnf.getState().player.buffs.hellbenter = left;
  }, seconds);
  await page.waitForTimeout(stepMs);
}

await shot("hold-tier1", "持剑 · 一档（刚铸出来）");

/*
 * **铸剑, through the game's own hit call.** Each of these is the same
 * `damageEnemy` a swing makes, so the tier it buys and the strand it draws are
 * the real ones; the target is parked in reach and given a thick health bar so
 * the sequence can be photographed rather than played.
 */
for (let hit = 0; hit < 8; hit += 1) {
  await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    const player = state.player;
    let target = state.enemies.find((enemy) => !enemy.dead && enemy.x < 700);
    if (!target) {
      target = window.DNFCore.createEnemy(state, "brute", player.x + 130);
      target.hp = 900;
      target.maxHp = 900;
      state.enemies.push(target);
    }
    window.DNFCore.damageEnemy(state, target, 5, 0, player.x);
  });
  await shot(`forge-${hit}`, "铸剑 · 命中吸血");
  await page.waitForTimeout(240);
}
await shot("hold-tier8", "持剑 · 满档");

/* The white warning: the last five seconds. */
await jumpTo(4);
await shot("white-a", "白闪 · 一拍");
await page.waitForTimeout(600);
await shot("white-b", "白闪 · 另一拍");

/* He moves and the sword goes with him: right, left, and up the screen. */
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(900);
await page.keyboard.up("ArrowRight");
await shot("hold-walk-right", "持剑 · 向右走");

await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(900);
await page.keyboard.up("ArrowLeft");
await shot("hold-walk-left", "持剑 · 向左走（剑在另一侧）");

await page.keyboard.down("ArrowUp");
await page.waitForTimeout(900);
await page.keyboard.up("ArrowUp");
await shot("hold-walk-deep", "持剑 · 走进画面（深度）");

/* -- 落 + 火山: the second press ------------------------------------------- */
/*
 * **Stand him in the middle of the room first.** He enters at the far left, and
 * the crater opens 1.31 Slayer-heights *ahead* of him - so at the level's edge
 * the eruption is drawn half off the screen and the captures show a sliver of
 * it. The same stand-in as the parked monsters above: `x` written straight onto
 * the player, because walking him there at this slowdown would take minutes.
 */
await page.evaluate(() => {
  window.nanoDnf.getState().player.x = 420;
});
await page.waitForTimeout(300);
await page.keyboard.press("KeyV");
for (let step = 0; step < 4; step += 1) {
  await shot(`fall-${String(step).padStart(2, "0")}`, "落");
  await page.waitForTimeout(stepMs);
}
/*
 * **Wait for the ground to actually open before walking its clock.** The field
 * is spawned when the cast reaches `SKILLS.hellbenterSlam.field.at` (0.6s in),
 * and at this slowdown that is twelve seconds of wall clock - so the loop below
 * used to run against an empty `state.fields`, draw nothing, and photograph the
 * *caster's* half of the row instead. It looked like a capture and was not one.
 */
await page.waitForFunction(() => window.nanoDnf.getState().fields.length > 0, null, {
  timeout: 180000
});
/*
 * The eruption is five seconds of *ground*, so its clock is walked rather than
 * waited out - the same kind of stand-in as the tier jumps above, and the only
 * way to photograph the whole arc of it at this frame rate. `tickAt` is nudged
 * too so the next beat lands on the shot.
 */
for (const seconds of [0.2, 0.9, 1.6, 2.3, 3.0, 4.0, 5.0]) {
  await page.evaluate((at) => {
    const state = window.nanoDnf.getState();
    if (!state.fields.length) return;
    state.fields[0].clock = at;
    state.fields[0].tickAt = 0.001;
  }, seconds);
  await page.waitForTimeout(220);
  await shot(`erupt-${seconds.toFixed(1)}`, "火山");
}
await page.waitForFunction(
  () => {
    const player = window.nanoDnf.getState().player;
    return player.skillId === null && player.hellbenterTier === 0;
  },
  null,
  { timeout: 120000 }
);
await shot("after", "落完 · 剑没了");

console.log(`wrote ${log.length} shots to ${OUT}`);
log.forEach((entry) =>
  console.log(
    `  ${entry.note}\tskill=${entry.skillId}\ttier=${entry.tier}\tbuff=${entry.buff}\tx=${entry.x}\tz=${entry.z}`
  )
);
await browser.close();
server.close();
