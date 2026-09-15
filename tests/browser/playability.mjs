/*
 * Browser-level playability proof.
 *
 * Serves the real static build (index.html + src + assets), drives it in
 * headless Chromium with the same kiting policy the unit test uses, and fails
 * on console errors, page errors, failed asset loads, or a run that does not
 * clear the dungeon.
 *
 *   npm run test:browser
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = path.join(ROOT, "tests", "browser", "artifacts");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};
const MAX_SECONDS = 150;

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const relative = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(ROOT, path.normalize(relative));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** The same policy as tests/core.test.js, driven through real key events. */
function decide(state, constants) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  const want = new Set();

  if (alive.length === 0) {
    want.add("ArrowRight");
    return want;
  }

  const inbound = (state.projectiles || []).find((shot) => {
    const closing = shot.vx > 0 ? shot.x <= player.x : shot.x >= player.x;
    return closing && Math.abs(shot.x - player.x) < 200;
  });
  if (inbound && player.onGround) {
    want.add("ArrowUp");
    return want;
  }

  alive.sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x));
  const target = alive[0];
  const delta = target.x - player.x;
  const distance = Math.abs(delta);
  const elapsed = target.attackDuration - target.attackTimer;
  const threatRange =
    target.attackKind === "slam" && target.slam ? target.slam.radius : target.attackRange;
  const activeUntil = target.attackKind === "charge" ? target.chargeTo : target.attackWindup;
  const threatened = target.attackTimer > 0 && elapsed <= activeUntil + 0.05;

  if (threatened) {
    if (distance < threatRange + 45) want.add(delta > 0 ? "ArrowLeft" : "ArrowRight");
    return want;
  }
  if (distance > 60) {
    want.add(delta > 0 ? "ArrowRight" : "ArrowLeft");
    return want;
  }

  want.add("KeyX");
  const skillKeys = { upSlash: "KeyA", mountainBreaker: "KeyS", crossSlash: "KeyD", ghostSlash: "KeyF" };
  const castable = constants.skillOrder.filter((skillId) => {
    const skill = constants.skills[skillId];
    return (
      player.mp >= skill.mp &&
      player.skillCooldowns[skillId] <= 0 &&
      distance <= skill.reach &&
      target.attackCooldown > skill.duration + 0.3
    );
  });
  if (castable.length > 0) {
    const best = castable.reduce((top, skillId) =>
      constants.skills[skillId].damage > constants.skills[top].damage ? skillId : top
    );
    want.add(skillKeys[best]);
  }
  return want;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, port } = await startServer();
  /* Reuse a locally cached Chromium when the bundled revision is not installed. */
  const cached = [
    process.env.CHROMIUM_PATH,
    process.env.HOME &&
      path.join(process.env.HOME, ".cache/ms-playwright/chromium-1161/chrome-linux/chrome"),
    process.env.HOME &&
      path.join(
        process.env.HOME,
        ".cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell"
      )
  ].find((candidate) => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch(cached ? { executablePath: cached } : {});
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const loadedAssets = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith(".png") || url.endsWith(".js") || url.endsWith(".html")) {
      loadedAssets.push(`${response.status()} ${path.basename(url)}`);
    }
  });

  const url = `http://127.0.0.1:${port}/index.html`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);
  await page.screenshot({ path: path.join(ARTIFACTS, "playability-title.png") });

  const constants = await page.evaluate(() => ({
    skills: JSON.parse(JSON.stringify(window.DNFCore.SKILLS)),
    skillOrder: window.DNFCore.SKILL_ORDER
  }));

  const held = new Set();
  const started = Date.now();
  let state = await page.evaluate(() => JSON.parse(JSON.stringify(window.nanoDnf.getState())));
  let shotTaken = false;

  while (!state.victory && !state.defeat) {
    if ((Date.now() - started) / 1000 > MAX_SECONDS) {
      await page.screenshot({ path: path.join(ARTIFACTS, "playability-timeout.png") });
      throw new Error(`run did not finish within ${MAX_SECONDS}s (room ${state.roomIndex + 1})`);
    }
    const want = decide(state, constants);
    for (const key of held) {
      if (!want.has(key)) {
        await page.keyboard.up(key === "ArrowUp" ? "ArrowUp" : key);
        held.delete(key);
      }
    }
    for (const key of want) {
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
    }
    if (!shotTaken && state.roomIndex === 1) {
      await page.screenshot({ path: path.join(ARTIFACTS, "playability-fight.png") });
      shotTaken = true;
    }
    await page.waitForTimeout(24);
    state = await page.evaluate(() => JSON.parse(JSON.stringify(window.nanoDnf.getState())));
  }
  for (const key of held) await page.keyboard.up(key);

  await page.screenshot({ path: path.join(ARTIFACTS, state.victory ? "playability-clear.png" : "playability-defeat.png") });
  await browser.close();
  server.close();

  const summary = {
    url,
    victory: state.victory,
    defeat: state.defeat,
    kills: state.stats.kills,
    damageTaken: state.stats.damageTaken,
    seconds: Number(state.time.toFixed(1)),
    level: state.player.level,
    consoleErrors,
    pageErrors,
    failedRequests,
    assets: loadedAssets
  };
  console.log(JSON.stringify(summary, null, 2));

  const problems = [];
  if (!state.victory) problems.push("dungeon was not cleared");
  if (state.stats.kills !== 11) problems.push(`kills=${state.stats.kills} (expected 11)`);
  if (state.stats.damageTaken > 24) problems.push(`damageTaken=${state.stats.damageTaken}`);
  if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.join(" | ")}`);
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(" | ")}`);
  if (failedRequests.length) problems.push(`failed requests: ${failedRequests.join(" | ")}`);
  if (!loadedAssets.some((line) => line.includes("slayer.png"))) problems.push("slayer.png was never loaded");
  if (problems.length) {
    console.error(`browser playability FAILED: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("browser playability OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
