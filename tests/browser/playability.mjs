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
  attack: "KeyX",
  choice0: "Digit1",
  choice1: "Digit2",
  choice2: "Digit3"
};

/** A damage-first player: take the sharpest upgrade on offer. */
const UPGRADE_PREFERENCE = ["attack", "skillPower", "maxHp", "mpRegen"];

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

  /* Clearing a room opens the reward chooser; pick the sharpest card on offer. */
  if (state.upgradeChoice) {
    const options = state.upgradeChoice.options || [];
    let index = 0;
    for (const id of UPGRADE_PREFERENCE) {
      const found = options.indexOf(id);
      if (found !== -1) {
        index = found;
        break;
      }
    }
    want.add("choice" + index);
    return want;
  }

  /* A cracked slab is a telegraphed threat: step off it before it drops. */
  const slabAt = (x) =>
    (state.hazards || []).find(
      (hazard) =>
        hazard.stage &&
        hazard.stage !== "dormant" &&
        Math.abs(hazard.x - x) <= hazard.radius + 12
    );
  const underfoot = slabAt(player.x);
  if (underfoot && player.y >= constants.arena.groundY - 26) {
    const away = underfoot.x >= player.x ? "left" : "right";
    const atWall =
      away === "left"
        ? player.x <= constants.arena.leftWall + player.width
        : player.x >= constants.arena.rightWall - player.width;
    want.add(atWall ? (away === "left" ? "right" : "left") : away);
    return want;
  }

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
    const direction = delta > 0 ? "right" : "left";
    const ahead = player.x + (direction === "right" ? 60 : -60);
    if (!slabAt(ahead)) {
      want.add(direction);
    } else if (distance <= constants.skills.upSlash.reach) {
      /* Out of reach and blocked by a breaking slab: hold ground. */
      want.add("attack");
    }
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
/**
 * Press/release a batch of on-screen controls in one round trip.
 *
 * The touch path used to pay one page.evaluate per changed action, which made
 * the bot's reaction time a function of harness latency rather than of the
 * policy. Batching keeps the pass a fair proxy for a competent touch player.
 */
async function touchActions(page, changes) {
  if (!changes.length) return;
  await page.evaluate((list) => {
    const canvas = document.getElementById("stage");
    const rect = canvas.getBoundingClientRect();
    window.__touchIds = window.__touchIds || {};
    for (const { action, down } of list) {
      const slotIndex = action.startsWith("slot") ? Number(action.slice(4)) : -1;
      const choiceIndex = action.startsWith("choice") ? Number(action.slice(6)) : -1;
      const button =
        choiceIndex >= 0
          ? window.DNFRender.upgradeCards()[choiceIndex]
          : slotIndex >= 0
            ? window.DNFRender.touchBarButtons()[slotIndex]
            : window.DNFRender.touchButtons().find((entry) => entry.action === action);
      if (!button) continue;
      const clientX = rect.left + ((button.x + button.w / 2) / canvas.width) * rect.width;
      const clientY = rect.top + ((button.y + button.h / 2) / canvas.height) * rect.height;
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
    }
  }, changes);
}

async function touchAction(page, action, down) {
  await touchActions(page, [{ action, down }]);
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
    layout: window.nanoDnf.getState().layout.slice(),
    equipped: window.nanoDnf.getLoadout()
  }));
  /*
   * Read the required kill count from the run this seed actually drew, so a
   * seeded layout cannot make the expectation drift.
   */
  const expectedKills = constants.layout.reduce(
    (total, index) => total + constants.rooms[index].enemies.length,
    0
  );
  /* Every room but the last one pays out exactly one upgrade. */
  const expectedUpgrades = constants.layout.length - 1;
  let loadout = constants.equipped.slice();
  const touchMode = await page.evaluate(() => window.nanoDnf.isTouchMode());
  if (options.mode === "touch") {
    await page.screenshot({ path: path.join(ARTIFACTS, "playability-touch-start.png") });
  } else {
    await page.screenshot({ path: path.join(ARTIFACTS, "playability-title.png") });
  }

  /*
   * The title screen is a full-screen overlay: the dungeon must not run behind
   * it. Idle here for a few seconds and prove the Slayer is untouched, which is
   * what an idle player sees before they press anything.
   */
  const titleIdleSeconds = 3;
  await page.waitForTimeout(titleIdleSeconds * 1000);
  const idleState = await page.evaluate(() => {
    const snapshot = window.nanoDnf.getState();
    return {
      hp: snapshot.player.hp,
      maxHp: snapshot.player.maxHp,
      damageTaken: snapshot.stats.damageTaken,
      time: snapshot.time,
      defeat: snapshot.defeat
    };
  });
  const titleIdle = { seconds: titleIdleSeconds, ...idleState };
  /* Nothing may have started audio yet: browsers only allow it after a gesture. */
  const musicBeforeInput = await page.evaluate(() => window.nanoDnf.getMusicState());
  /*
   * DNF's default key for the up-slash is Z. Press it on the shipped page, read
   * the skill back, then put the run back to its starting state so the pass
   * itself is measured from a clean run.
   */
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  await page.keyboard.down("KeyZ");
  await page.waitForTimeout(80);
  const upSlashKey = await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    return {
      skillId: state.player.skillId,
      cooldown: Number((state.player.skillCooldowns.upSlash || 0).toFixed(2)),
      equipped: window.nanoDnf.getLoadout().indexOf("upSlash") !== -1,
      shortcut: window.DNFLoadout.SKILL_SHORTCUTS.upSlash
    };
  });
  await page.keyboard.up("KeyZ");
  await page.evaluate(() => window.nanoDnf.restart());

  /*
   * The shipped page, not just the unit tests: the normal attack has to carry
   * the client's whole chain and walk it one press at a time.
   */
  const attackChain = await page.evaluate(() => {
    const stages = window.DNFCore.ATTACK_STAGES;
    const upSlash = window.DNFRender.SPRITE.skillClips.upSlash;
    return {
      stages: stages.length,
      maxCombo: window.DNFCore.PLAYER.maxCombo,
      coverage: stages[stages.length - 1].first + stages[stages.length - 1].frames,
      firstColumn: window.DNFRender.attackColumn(0, 0),
      secondColumn: window.DNFRender.attackColumn(0, 1),
      lastColumn: window.DNFRender.attackColumn(1, stages.length - 1),
      upSlashColumns: upSlash ? upSlash.frames : 0
    };
  });

  const held = new Set();
  const started = Date.now();
  let state = await readState(page);
  let midShot = false;
  const trace = [];
  let loadoutChecks = null;
  const damageLog = [];
  let previousDamage = state.stats.damageTaken;
  /*
   * Watch every slab from the outside: a break that was never seen cracking
   * first would mean the trap fired without warning, which the design forbids
   * and a player could not dodge.
   */
  const slabWatch = new Map();
  const unwarnedBreaks = [];
  /* Coaching: which hints showed, and whether any of them cleared again. */
  const hints = { seen: new Set(), cleared: 0, lastId: null };
  const keyOf = (action) => keyForSkill(action, loadout) || KEY_FOR_ACTION[action];
  const touchTarget = (action) => {
    const index = loadout.indexOf(action);
    return index === -1 ? action : `slot${index}`;
  };

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
    const changes = [];
    for (const action of [...held]) {
      if (!want.has(action)) {
        changes.push({ action: action, down: false });
        held.delete(action);
      }
    }
    for (const action of want) {
      if (!held.has(action)) {
        changes.push({ action: action, down: true });
        held.add(action);
      }
    }
    if (options.mode === "touch") {
      await touchActions(
        page,
        changes.map((change) => ({
          action: touchTarget(change.action),
          down: change.down
        }))
      );
    } else {
      for (const change of changes) {
        if (change.down) await page.keyboard.down(keyOf(change.action));
        else await page.keyboard.up(keyOf(change.action));
      }
    }
    if (!midShot && state.roomIndex === 1) {
      await page.screenshot({ path: path.join(ARTIFACTS, `playability-${options.mode}-fight.png`) });
      midShot = true;
    }
    await page.waitForTimeout(options.mode === "touch" ? 16 : 20);
    state = await readState(page);
    (state.hazards || []).forEach((hazard, index) => {
      const key = `${state.roomIndex}:${index}:${hazard.x}`;
      const entry = slabWatch.get(key) || { warned: false };
      if (hazard.stage === "cracking") entry.warned = true;
      if (hazard.stage === "collapsing" && !entry.warned) {
        unwarnedBreaks.push(`${key} broke without a warning`);
      }
      if (hazard.stage === "dormant") entry.warned = false;
      slabWatch.set(key, entry);
    });
    const hintNow = await page.evaluate(() => window.nanoDnf.getHintState().active);
    if (hintNow && hintNow.id) {
      hints.seen.add(hintNow.id);
      hints.lastId = hintNow.id;
    } else if (hints.lastId) {
      hints.cleared += 1;
      hints.lastId = null;
    }
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
    if (options.mode === "touch") {
      await touchActions(page, [{ action: touchTarget(action), down: false }]);
    } else {
      await page.keyboard.up(keyOf(action));
    }
  }

  /* The soundtrack must be running by now, and must react to mute. */
  const musicAfterRun = await page.evaluate(() => window.nanoDnf.getMusicState());
  let musicMuteProbe = null;

  /* Mute toggle must survive a round trip through the on-screen control. */
  let muteRoundTrip = null;
  if (options.mode === "touch") {
    await touchAction(page, "mute", true);
    await touchAction(page, "mute", false);
    const mutedOnce = await page.evaluate(() => window.nanoDnf.getAudioState().muted);
    const busMuted = await page.evaluate(() => window.nanoDnf.getMusicState().busGain);
    await touchAction(page, "mute", true);
    await touchAction(page, "mute", false);
    const mutedTwice = await page.evaluate(() => window.nanoDnf.getAudioState().muted);
    muteRoundTrip = { afterFirstTap: mutedOnce, afterSecondTap: mutedTwice };
    musicMuteProbe = {
      mutedGain: busMuted,
      restoredGain: await page.evaluate(() => window.nanoDnf.getMusicState().busGain)
    };
  } else {
    await page.keyboard.press("KeyM");
    const busMuted = await page.evaluate(() => window.nanoDnf.getMusicState().busGain);
    await page.keyboard.press("KeyM");
    const busRestored = await page.evaluate(() => window.nanoDnf.getMusicState().busGain);
    musicMuteProbe = { mutedGain: busMuted, restoredGain: busRestored };
  }

  const audio = await page.evaluate(() => window.nanoDnf.getAudioState());
  /* The cleared run must have been banked, and banked in storage. */
  const records = await page.evaluate(() => ({
    seed: window.nanoDnf.getSeed(),
    store: window.nanoDnf.getRecords(),
    summary: window.nanoDnf.getRunSummary(),
    stored: window.localStorage.getItem("nano-dnf-records")
  }));
  if (options.mode === "keyboard") {
    /* Arrange the bar with the keyboard toggle plus a real pointer drag. */
    await page.keyboard.press("KeyB");
    const arranging = await page.evaluate(() => window.nanoDnf.isArranging());
    await page.screenshot({ path: path.join(ARTIFACTS, "loadout-panel.png") });
    const dragged = await dragSkillToSlot(page, "bloodSnatch", 0);
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
      window.DNFCore.startRoom(state, state.layout.length - 2);
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "room-mix.png") });

    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, state.layout.length - 1);
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
      window.DNFCore.startRoom(state, state.layout.length - 2);
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

    /* Freeze the reward chooser so the between-room decision reads on screen. */
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, 0);
      state.enemies = [];
      state.room.cleared = true;
      window.DNFCore.offerUpgrade(state);
      state.effects = state.effects.filter((effect) => effect.kind !== "banner");
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "upgrade-choice.png") });

    /* Freeze a coaching line: hints are transient, so ask for one on purpose. */
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      window.DNFCore.startRoom(state, 0);
      state.effects = state.effects.filter((effect) => effect.kind !== "banner");
      window.nanoDnf.previewHint("hazard");
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "hint-preview.png") });

    /* Freeze a breaking slab so the chapel's own mechanic is visible. */
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      const chapel = state.layout.findIndex((index) => {
        const spec = window.DNFCore.ROOMS[index];
        return spec.hazards && spec.hazards.length;
      });
      if (chapel === -1) return;
      window.DNFCore.startRoom(state, chapel);
      state.effects = state.effects.filter((effect) => effect.kind !== "banner");
      /* Park the room clock at the moment the first slab gives way. */
      state.roomTime = window.DNFCore.HAZARD.warn + 0.1;
      state.player.x = state.hazards[0].x + 130;
    });
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "chapel-hazard.png") });

    /* Back to the title after a clear: the seed now carries a record. */
    await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      state.victory = false;
      state.defeat = false;
    });
    await page.keyboard.press("F1");
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(ARTIFACTS, "title-record.png") });
    await page.keyboard.press("F1");
  }
  await context.close();

  return {
    mode: options.mode,
    url,
    titleIdle,
    attackChain,
    upSlashKey,
    music: { beforeInput: musicBeforeInput, afterRun: musicAfterRun, mute: musicMuteProbe },
    slabWatch: { unwarnedBreaks, slabs: slabWatch.size },
    hints: { seen: [...hints.seen], cleared: hints.cleared },
    expectedKills,
    expectedUpgrades,
    touchMode,
    state,
    damageLog,
    audio,
    records,
    muteRoundTrip,
    loadoutChecks,
    diagnostics,
    trace
  };
}

function problemsFor(pass) {
  const problems = [];
  const upSlash = pass.upSlashKey;
  if (!upSlash || upSlash.shortcut !== "Z" || !upSlash.equipped || upSlash.cooldown <= 0) {
    problems.push(`${pass.mode}: Z does not cast the up-slash (${JSON.stringify(upSlash)})`);
  }
  const chain = pass.attackChain;
  if (!chain || chain.stages !== 4 || chain.maxCombo !== 4) {
    problems.push(`${pass.mode}: the shipped normal attack is not the four-cut chain`);
  } else {
    if (chain.coverage !== 42) {
      problems.push(`${pass.mode}: the cuts cover ${chain.coverage} frames, not the real 42`);
    }
    if (chain.firstColumn !== 0 || chain.secondColumn <= chain.firstColumn) {
      problems.push(`${pass.mode}: pressing X does not walk to the next stage`);
    }
    if (chain.lastColumn !== 41) {
      problems.push(`${pass.mode}: the last press ends on frame ${chain.lastColumn}, not 41`);
    }
    if (chain.upSlashColumns !== 11) {
      problems.push(`${pass.mode}: the up-slash skill ships no body animation`);
    }
  }
  if (!pass.state.victory) problems.push(`${pass.mode}: dungeon was not cleared`);
  if (pass.state.defeat) problems.push(`${pass.mode}: player died`);
  /* The title screen must be inert: an idle player is not being attacked. */
  const idle = pass.titleIdle;
  if (
    !idle ||
    idle.hp !== idle.maxHp ||
    idle.damageTaken !== 0 ||
    idle.time !== 0 ||
    idle.defeat
  ) {
    problems.push(
      `${pass.mode}: the dungeon ran behind the title screen for ${idle ? idle.seconds : 0}s ` +
        `(hp=${idle && idle.hp}/${idle && idle.maxHp} damageTaken=${idle && idle.damageTaken} ` +
        `time=${idle && idle.time} defeat=${idle && idle.defeat})`
    );
  }
  /* Soundtrack: silent until the first gesture, then running and mute-aware. */
  const music = pass.music || {};
  /* The collapsing floor: it must have fired, and never without its warning. */
  const slabs = pass.slabWatch || {};
  if (!(pass.state.stats.collapses > 0)) {
    problems.push(`${pass.mode}: the chapel's floor never broke during the run`);
  }
  if (slabs.slabs > 0 && (slabs.unwarnedBreaks || []).length) {
    problems.push(`${pass.mode}: ${slabs.unwarnedBreaks.join("; ")}`);
  }
  /* Coaching: it has to show up, cover the key moments, and clear again. */
  const coaching = pass.hints || {};
  const shownHints = coaching.seen || [];
  if (!shownHints.includes("upgrade")) {
    problems.push(
      `${pass.mode}: the upgrade hint never appeared (saw ${shownHints.join(", ") || "none"})`
    );
  }
  if (shownHints.length < 2) {
    problems.push(`${pass.mode}: expected several hints during a run, saw ${shownHints.length}`);
  }
  if (!(coaching.cleared > 0)) {
    problems.push(`${pass.mode}: no hint ever cleared`);
  }
  if (!music.beforeInput || music.beforeInput.started !== false) {
    problems.push(`${pass.mode}: music must not start before the first input`);
  }
  if (!music.afterRun || music.afterRun.started !== true) {
    problems.push(`${pass.mode}: the soundtrack never started`);
  } else {
    if (!(music.afterRun.scheduledNotes > 0)) {
      problems.push(`${pass.mode}: the soundtrack scheduled no notes`);
    }
    if (!(music.afterRun.busGain > 0)) {
      problems.push(`${pass.mode}: the music bus is silent while unmuted (${music.afterRun.busGain})`);
    }
  }
  if (!music.mute || music.mute.mutedGain !== 0 || !(music.mute.restoredGain > 0)) {
    problems.push(
      `${pass.mode}: the music bus ignored mute (muted=${music.mute && music.mute.mutedGain} ` +
        `restored=${music.mute && music.mute.restoredGain})`
    );
  }
  const banked = pass.records && pass.records.store && pass.records.store.seeds
    ? pass.records.store.seeds[String(pass.records.seed)]
    : null;
  if (!banked) {
    problems.push(`${pass.mode}: the cleared run was not recorded for seed ${pass.records.seed}`);
  } else {
    if (banked.clears !== 1) {
      problems.push(`${pass.mode}: expected 1 clear on the fresh store, got ${banked.clears}`);
    }
    /*
     * The record is banked on the victory frame, while `state.time` keeps
     * ticking afterwards so the closing banners can fade. A one-second window
     * proves the recorded time is the clear time without pinning a frame.
     */
    const drift = pass.state.time - banked.seconds;
    if (drift < 0 || drift > 1) {
      problems.push(
        `${pass.mode}: recorded ${banked.seconds}s but the run took ${pass.state.time}s`
      );
    }
    if (banked.level !== pass.state.player.level) {
      problems.push(`${pass.mode}: recorded Lv ${banked.level}, run ended at Lv ${pass.state.player.level}`);
    }
    if (!pass.records.summary || !pass.records.summary.recordText) {
      problems.push(`${pass.mode}: the title screen has no record line to show`);
    }
    if (!pass.records.stored) {
      problems.push(`${pass.mode}: the record never reached localStorage`);
    }
  }
  if (pass.state.stats.kills !== pass.expectedKills) {
    problems.push(`${pass.mode}: kills=${pass.state.stats.kills} (expected ${pass.expectedKills})`);
  }
  const upgrades = (pass.state.player.upgradesTaken || []).length;
  if (upgrades !== pass.expectedUpgrades) {
    problems.push(
      `${pass.mode}: upgradesTaken=${upgrades} (expected ${pass.expectedUpgrades})`
    );
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
      "upSlash,mountainBreaker,crossSlash,bloodSword,graspHead,mountainRift," +
      "frenzy,bloodyRave,rageBurst,bloodSnatch,bloodEvil,";
    if (!checks || !checks.arranging) problems.push("keyboard: B did not open the arrange panel");
    if (!checks || checks.dragged.loadout[0] !== "bloodSnatch") {
      problems.push("keyboard: dragging 嗜血 into slot A did not apply");
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
    upgradesTaken: pass.state.player.upgradesTaken,
    titleIdle: pass.titleIdle,
    attackChain: pass.attackChain,
    upSlashKey: pass.upSlashKey,
    slabWatch: pass.slabWatch,
    collapses: pass.state.stats.collapses,
    hints: pass.hints,
    music: pass.music,
    damageLog: pass.damageLog,
    seed: pass.records.seed,
    record: (pass.records.store.seeds || {})[String(pass.records.seed)] || null,
    recordText: (pass.records.summary || {}).recordText || null,
    storedRecord: !!pass.records.stored,
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
