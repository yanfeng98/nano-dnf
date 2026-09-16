/*
 * Browser-level playability proof.
 *
 * Serves the real static build (index.html + src + assets) and drives it in
 * headless Chromium twice:
 *   1. keyboard pass - the DNF key layout, real key events
 *   2. touch pass    - pointer events on the on-screen controls (?touch=1)
 *
 * Both passes must clear the dungeon with no console errors, page errors or
 * failed asset loads, and must initialise the WebAudio feedback path.
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

const SLOT_KEYS = [
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyY"
];
const KEY_FOR_ACTION = {
  left: "ArrowLeft",
  right: "ArrowRight",
  jump: "ArrowUp",
  attack: "KeyX"
};

/** Skill id -> the key/slot that currently holds it. */
function keyForSkill(skillId, loadout) {
  const index = loadout.indexOf(skillId);
  return index === -1 ? null : SLOT_KEYS[index];
}

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

/** The same policy as tests/core.test.js, expressed as a set of wanted actions. */
function decide(state, constants) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  const want = new Set();

  if (alive.length === 0) {
    want.add("right");
    return want;
  }

  const inbound = (state.projectiles || []).find((shot) => {
    const closing = shot.vx > 0 ? shot.x <= player.x : shot.x >= player.x;
    return closing && Math.abs(shot.x - player.x) < 200;
  });
  if (inbound && player.onGround) {
    want.add("jump");
    return want;
  }

  alive.sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x));
  const target = alive[0];
  const delta = target.x - player.x;
  const distance = Math.abs(delta);
  const elapsed = target.attackDuration - target.attackTimer;
  const threatRange =
    target.attackKind === "slam" && target.slam
      ? target.slam.radius
      : target.attackKind === "spin" && target.spinDash
        ? target.spinDash.radius * 1.6
        : target.attackRange;
  /* A charge and a spin both stay live past the wind-up; the sweep keeps moving. */
  const activeUntil =
    target.attackKind === "charge"
      ? target.chargeTo
      : target.attackKind === "spin" && target.spinDash
        ? target.spinDash.windup + target.spinDash.duration
        : target.attackWindup;
  const threatened = target.attackTimer > 0 && elapsed <= activeUntil + 0.05;

  if (threatened) {
    /*
     * A spinning sweep outruns a retreat once it is on top of you, so the read
     * is to back off through the wind-up and jump the sweep itself.
     */
    if (target.attackKind === "spin" && target.spinDash) {
      const closing = delta > 0 ? "left" : "right";
      if (distance < threatRange + 45) {
        if (player.onGround && elapsed >= target.spinDash.windup - 0.25) {
          want.add("jump");
        } else {
          want.add(closing);
        }
      }
      return want;
    }
    const away = delta > 0 ? "left" : "right";
    const atLeftWall = player.x <= constants.arena.leftWall + player.width;
    const atRightWall = player.x >= constants.arena.rightWall - player.width;
    const cornered = (away === "left" && atLeftWall) || (away === "right" && atRightWall);
    if (distance < threatRange + 45 && !cornered) {
      want.add(away);
    } else if (cornered) {
      /* Cornered in DNF means launch: 上挑 cancels the wind-up and buys space. */
      const upSlash = constants.skills.upSlash;
      if (
        distance <= upSlash.reach &&
        player.mp >= upSlash.mp &&
        player.skillCooldowns.upSlash <= 0
      ) {
        want.add("upSlash");
      } else {
        want.add("attack");
      }
    }
    return want;
  }
  if (distance > 60) {
    want.add(delta > 0 ? "right" : "left");
    return want;
  }

  /* Attacks only reach where the Slayer looks, so turn around first. */
  const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
  if (!facingTarget) {
    want.add(delta > 0 ? "right" : "left");
    return want;
  }

  want.add("attack");
  const castable = constants.skillOrder.filter((skillId) => {
    const skill = constants.skills[skillId];
    return (
      (constants.equipped || constants.skillOrder).indexOf(skillId) !== -1 &&
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
    want.add(best);
  }
  return want;
}

function attachDiagnostics(page) {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], assets: [] };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("requestfailed", (request) =>
    diagnostics.failedRequests.push(`${request.url()} ${request.failure()?.errorText}`)
  );
  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith(".png") || url.endsWith(".js") || url.endsWith(".html")) {
      diagnostics.assets.push(`${response.status()} ${path.basename(url)}`);
    }
  });
  return diagnostics;
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.nanoDnf.getState())));
}

/** Drag a skill tile from the arrange panel onto a hotbar slot. */
async function dragSkillToSlot(page, skillId, slotIndex) {
  return page.evaluate(
    ({ skillId, slotIndex }) => {
      const canvas = document.getElementById("stage");
      const rect = canvas.getBoundingClientRect();
      const toClient = (x, y) => ({
        clientX: rect.left + (x / canvas.width) * rect.width,
        clientY: rect.top + (y / canvas.height) * rect.height
      });
      const tile = window.DNFRender.loadoutPanelButtons().find((entry) => entry.skillId === skillId);
      const slot = window.DNFRender.skillBarButtons()[slotIndex];
      const send = (type, box, buttons) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            isPrimary: true,
            buttons: buttons,
            ...toClient(box.x + box.w / 2, box.y + box.h / 2)
          })
        );
      send("pointerdown", tile, 1);
      send("pointermove", slot, 1);
      send("pointerup", slot, 0);
      return {
        loadout: window.nanoDnf.getLoadout(),
        stored: window.localStorage.getItem("nano-dnf-loadout"),
        arranging: window.nanoDnf.isArranging()
      };
    },
    { skillId, slotIndex }
  );
}

/** Hold or release an on-screen control through real pointer events. */
async function touchAction(page, action, down) {
  await page.evaluate(
    ({ action, down }) => {
      const canvas = document.getElementById("stage");
      const slotIndex = action.startsWith("slot") ? Number(action.slice(4)) : -1;
      const button =
        slotIndex >= 0
          ? window.DNFRender.touchBarButtons()[slotIndex]
          : window.DNFRender.touchButtons().find((entry) => entry.action === action);
      const rect = canvas.getBoundingClientRect();
      const clientX = rect.left + ((button.x + button.w / 2) / canvas.width) * rect.width;
      const clientY = rect.top + ((button.y + button.h / 2) / canvas.height) * rect.height;
      window.__touchIds = window.__touchIds || {};
      if (!window.__touchIds[action]) {
        window.__touchIds[action] = Object.keys(window.__touchIds).length + 1;
      }
      canvas.dispatchEvent(
        new PointerEvent(down ? "pointerdown" : "pointerup", {
          pointerId: window.__touchIds[action],
          clientX,
          clientY,
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          isPrimary: true,
          buttons: down ? 1 : 0
        })
      );
    },
    { action, down }
  );
}

async function runPass(browser, baseUrl, options) {
  const context = await browser.newContext({
    viewport: { width: 1120, height: 720 },
    hasTouch: options.mode === "touch"
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);

  const url = options.mode === "touch" ? `${baseUrl}?touch=1` : baseUrl;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);

  const constants = await page.evaluate(() => ({
    skills: JSON.parse(JSON.stringify(window.DNFCore.SKILLS)),
    skillOrder: window.DNFCore.SKILL_ORDER,
    arena: JSON.parse(JSON.stringify(window.DNFCore.ARENA)),
    rooms: JSON.parse(JSON.stringify(window.DNFCore.ROOMS)),
    equipped: window.nanoDnf.getLoadout()
  }));
  /* Read the required kill count from the shipped core so it cannot drift. */
  const expectedKills = constants.rooms.reduce((total, room) => total + room.enemies.length, 0);
  let loadout = constants.equipped.slice();
  const touchMode = await page.evaluate(() => window.nanoDnf.isTouchMode());
  if (options.mode === "touch") {
    await page.screenshot({ path: path.join(ARTIFACTS, "playability-touch-start.png") });
  } else {
    await page.screenshot({ path: path.join(ARTIFACTS, "playability-title.png") });
  }

  const held = new Set();
  const started = Date.now();
  let state = await readState(page);
  let midShot = false;
  const trace = [];
  let loadoutChecks = null;
  const damageLog = [];
  let previousDamage = state.stats.damageTaken;

  while (!state.victory && !state.defeat) {
    if ((Date.now() - started) / 1000 > MAX_SECONDS) {
      await page.screenshot({ path: path.join(ARTIFACTS, `playability-timeout-${options.mode}.png`) });
      console.error(`--- ${options.mode} pass timed out; last samples ---`);
      trace.slice(-24).forEach((sample) => {
        console.error(
          `${sample.t}s room=${sample.room} hp=${sample.hp} px=${sample.px} want=${sample.want} | ${sample.enemies.join(" ; ")}`
        );
      });
      throw new Error(`${options.mode} pass did not finish within ${MAX_SECONDS}s`);
    }
    const want = decide(state, constants);
    const keyOf = (action) => keyForSkill(action, loadout) || KEY_FOR_ACTION[action];
    const touchTarget = (action) => {
      const index = loadout.indexOf(action);
      return index === -1 ? action : `slot${index}`;
    };
    for (const action of [...held]) {
      if (!want.has(action)) {
        if (options.mode === "touch") await touchAction(page, touchTarget(action), false);
        else await page.keyboard.up(keyOf(action));
        held.delete(action);
      }
    }
    for (const action of want) {
      if (!held.has(action)) {
        if (options.mode === "touch") await touchAction(page, touchTarget(action), true);
        else await page.keyboard.down(keyOf(action));
        held.add(action);
      }
    }
    if (!midShot && state.roomIndex === 1) {
      await page.screenshot({ path: path.join(ARTIFACTS, `playability-${options.mode}-fight.png`) });
      midShot = true;
    }
    await page.waitForTimeout(options.mode === "touch" ? 16 : 20);
    state = await readState(page);
    if (state.stats.damageTaken > previousDamage) {
      damageLog.push({
        t: Number(state.time.toFixed(1)),
        room: state.roomIndex + 1,
        amount: state.stats.damageTaken - previousDamage,
        attacker: state.enemies
          .filter((enemy) => !enemy.dead && enemy.attackTimer > 0)
          .map((enemy) => `${enemy.type}:${enemy.attackKind}`)
          .join("+") || "unknown"
      });
      previousDamage = state.stats.damageTaken;
    }
    trace.push({
      t: Number(state.time.toFixed(2)),
      room: state.roomIndex + 1,
      hp: Math.round(state.player.hp),
      px: Math.round(state.player.x),
      want: [...want].join("+"),
      enemies: state.enemies.map(
        (enemy) =>
          `${enemy.type}@${Math.round(enemy.x)} hp${enemy.hp} ${
            enemy.onGround ? "ground" : "air"
          } kd${enemy.knockdown.toFixed(1)} st${enemy.stun.toFixed(1)} ${enemy.attackKind}`
      )
    });
    if (trace.length > 80) trace.shift();
  }

  for (const action of held) {
    if (options.mode === "touch") await touchAction(page, action, false);
    else await page.keyboard.up(KEY_FOR_ACTION[action]);
  }

  /* Mute toggle must survive a round trip through the on-screen control. */
  let muteRoundTrip = null;
  if (options.mode === "touch") {
    await touchAction(page, "mute", true);
    await touchAction(page, "mute", false);
    const mutedOnce = await page.evaluate(() => window.nanoDnf.getAudioState().muted);
    await touchAction(page, "mute", true);
    await touchAction(page, "mute", false);
    const mutedTwice = await page.evaluate(() => window.nanoDnf.getAudioState().muted);
    muteRoundTrip = { afterFirstTap: mutedOnce, afterSecondTap: mutedTwice };
  }

  const audio = await page.evaluate(() => window.nanoDnf.getAudioState());
  if (options.mode === "keyboard") {
    /* Arrange the bar with the keyboard toggle plus a real pointer drag. */
    await page.keyboard.press("KeyB");
    const arranging = await page.evaluate(() => window.nanoDnf.isArranging());
    await page.screenshot({ path: path.join(ARTIFACTS, "loadout-panel.png") });
    const dragged = await dragSkillToSlot(page, "moonlightSlash", 0);
    await page.keyboard.press("KeyB");
    await page.screenshot({ path: path.join(ARTIFACTS, "loadout-applied.png") });
    const restored = await page.evaluate(() => window.nanoDnf.resetLoadout());
    loadoutChecks = {
      arranging,
      dragged,
      restored,
      storedAfterReset: await page.evaluate(() => window.localStorage.getItem("nano-dnf-loadout"))
    };

    /* Freeze one frame per skill so the DNF slash art can be eyeballed. */
    const skills = await page.evaluate(() => window.DNFCore.SKILL_ORDER);
    for (const skillId of skills) {
      await page.evaluate((skillId) => {
        const state = window.nanoDnf.getState();
        const skill = window.DNFCore.SKILLS[skillId];
        state.player.skillId = skillId;
        state.player.skillTimer = skill.duration * 0.55;
        state.player.skillHitsDone = 1;
        state.player.dead = false;
        state.defeat = false;
        state.victory = false;
      }, skillId);
      await page.waitForTimeout(70);
      await page.screenshot({ path: path.join(ARTIFACTS, `skill-${skillId}.png`) });
    }
  }
  await page.screenshot({
    path: path.join(ARTIFACTS, `playability-${options.mode}-clear.png`)
  });

  /*
   * Extra content evidence: the caster/charger mix room and the enraged boss.
   * Captured after the clear shot so the run-progress artifacts keep their meaning.
   */
  if (options.mode === "keyboard") {
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, window.DNFCore.ROOMS.length - 2);
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "room-mix.png") });

    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, window.DNFCore.ROOMS.length - 1);
      /* Drop the room-entry banner so the enrage announcement is what we capture. */
      state.effects = state.effects.filter((effect) => effect.kind !== "banner");
      const boss = state.enemies.find((enemy) => enemy.type === "boss");
      window.DNFCore.enterPhase2(state, boss);
      state.player.x = boss.x - 165;
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "boss-phase2.png") });

    /* Freeze the elite mid-spin so the whirl and its swept lane read on screen. */
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, window.DNFCore.ROOMS.length - 2);
      state.effects = state.effects.filter((effect) => effect.kind !== "banner");
      const elite = state.enemies.find((enemy) => enemy.type === "elite");
      const spin = elite.spinDash;
      elite.attackKind = "spin";
      elite.attackDuration = spin.windup + spin.duration + spin.recovery;
      elite.attackTimer = elite.attackDuration - spin.windup - spin.duration * 0.4;
      elite.attackHitDone = true;
      elite.superArmor = true;
      state.player.x = elite.x - 150;
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "elite-spin.png") });
  }
  await context.close();

  return {
    mode: options.mode,
    url,
    expectedKills,
    touchMode,
    state,
    damageLog,
    audio,
    muteRoundTrip,
    loadoutChecks,
    diagnostics,
    trace
  };
}

function problemsFor(pass) {
  const problems = [];
  if (!pass.state.victory) problems.push(`${pass.mode}: dungeon was not cleared`);
  if (pass.state.defeat) problems.push(`${pass.mode}: player died`);
  if (pass.state.stats.kills !== pass.expectedKills) {
    problems.push(`${pass.mode}: kills=${pass.state.stats.kills} (expected ${pass.expectedKills})`);
  }
  if (pass.state.stats.damageTaken > 24) problems.push(`${pass.mode}: damageTaken=${pass.state.stats.damageTaken}`);
  if (pass.diagnostics.consoleErrors.length) {
    problems.push(`${pass.mode}: console errors: ${pass.diagnostics.consoleErrors.join(" | ")}`);
  }
  if (pass.diagnostics.pageErrors.length) {
    problems.push(`${pass.mode}: page errors: ${pass.diagnostics.pageErrors.join(" | ")}`);
  }
  if (pass.diagnostics.failedRequests.length) {
    problems.push(`${pass.mode}: failed requests: ${pass.diagnostics.failedRequests.join(" | ")}`);
  }
  if (!pass.diagnostics.assets.some((line) => line.includes("slayer.png"))) {
    problems.push(`${pass.mode}: slayer.png was never loaded`);
  }
  if (!pass.diagnostics.assets.some((line) => line.includes("skills.png"))) {
    problems.push(`${pass.mode}: skills.png was never loaded`);
  }
  if (!pass.audio.created) problems.push(`${pass.mode}: WebAudio was never initialised`);
  if (pass.mode === "touch") {
    if (!pass.touchMode) problems.push("touch: on-screen controls were not enabled");
    if (!pass.muteRoundTrip || pass.muteRoundTrip.afterFirstTap !== true) {
      problems.push("touch: mute button did not toggle");
    }
    if (!pass.muteRoundTrip || pass.muteRoundTrip.afterSecondTap !== false) {
      problems.push("touch: mute button did not toggle back");
    }
  }
  if (pass.mode === "keyboard") {
    const checks = pass.loadoutChecks;
    const defaults =
      "upSlash,mountainBreaker,crossSlash,ghostSlash,graspHead,mountainRift," +
      "tripleSlash,waveSlash,rageBurst,moonlightSlash,ghostStep,";
    if (!checks || !checks.arranging) problems.push("keyboard: B did not open the arrange panel");
    if (!checks || checks.dragged.loadout[0] !== "moonlightSlash") {
      problems.push("keyboard: dragging 月光斩 into slot A did not apply");
    }
    if (!checks || checks.dragged.stored !== checks.dragged.loadout.join(",")) {
      problems.push("keyboard: the arranged loadout was not persisted");
    }
    if (!checks || checks.restored.join(",") !== defaults) {
      problems.push("keyboard: resetLoadout did not restore the default bar");
    }
  }
  return problems;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/index.html`;
  const passes = [];
  const only = process.env.PASSES;
  const modes = ["keyboard", "touch"].filter((mode) => !only || only === mode);
  for (const mode of modes) {
    /* A fresh browser per pass keeps the two runs from starving each other. */
    const browser = await chromium.launch(chromiumLaunchOptions());
    passes.push(await runPass(browser, baseUrl, { mode }));
    await browser.close();
  }

  server.close();

  const summary = passes.map((pass) => ({
    mode: pass.mode,
    victory: pass.state.victory,
    defeat: pass.state.defeat,
    kills: pass.state.stats.kills,
    damageTaken: pass.state.stats.damageTaken,
    seconds: Number(pass.state.time.toFixed(1)),
    level: pass.state.player.level,
    damageLog: pass.damageLog,
    touchMode: pass.touchMode,
    audio: pass.audio,
    muteRoundTrip: pass.muteRoundTrip,
    loadoutChecks: pass.loadoutChecks,
    consoleErrors: pass.diagnostics.consoleErrors,
    pageErrors: pass.diagnostics.pageErrors,
    failedRequests: pass.diagnostics.failedRequests,
    assets: [...new Set(pass.diagnostics.assets)]
  }));
  console.log(JSON.stringify(summary, null, 2));

  const problems = passes.flatMap(problemsFor);
  if (problems.length) {
    const failed = passes.find((pass) => problemsFor(pass).length);
    if (failed) {
      console.error(`--- ${failed.mode} pass trace (last ${Math.min(30, failed.trace.length)} samples) ---`);
      failed.trace.slice(-30).forEach((sample) => {
        console.error(
          `${sample.t}s room=${sample.room} hp=${sample.hp} px=${sample.px} want=${sample.want} | ${sample.enemies.join(" ; ")}`
        );
      });
    }
    console.error(`browser playability FAILED: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("browser playability OK (keyboard + touch)");
}

/** Reuse a locally cached Chromium when the bundled revision is not installed. */
function chromiumLaunchOptions() {
  const cached = [
    process.env.CHROMIUM_PATH,
    process.env.HOME && path.join(process.env.HOME, ".cache/ms-playwright/chromium-1161/chrome-linux/chrome"),
    process.env.HOME &&
      path.join(process.env.HOME, ".cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell")
  ].find((candidate) => candidate && fs.existsSync(candidate));
  return cached ? { executablePath: cached } : {};
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
