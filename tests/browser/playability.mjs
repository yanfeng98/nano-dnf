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
/*
 * All four arrows move now: up walks into the screen and down walks back out.
 * Jump is C, which is also the only key the on-screen hint teaches - this map
 * used to send jump through ArrowUp, and that alias is gone.
 */
const KEY_FOR_ACTION = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  jump: "KeyC",
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

  /*
   * The floor's second axis. Monsters open fights at a depth of their own (Broken
   * Span's caster does) and swing only across their own row, so a bot that knows
   * x and nothing else walks up and swings at the floor for the rest of the run.
   * It walks the row the way it walks the gap, both at once, and does not swing
   * until the row is right - which is also what a player who understands the game
   * does.
   *
   * While it is being attacked the block below takes over instead: a blow that
   * cannot reach it is not a reason to stop backing off.
   */
  const rowGap = (target.z || 0) - (player.z || 0);
  if (!threatened && Math.abs(rowGap) > constants.meleeReach) {
    want.add(rowGap > 0 ? "up" : "down");
    if (distance > 60) want.add(delta > 0 ? "right" : "left");
    return want;
  }

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
 * Drag a hotbar slot's skill out of the bar and let it go on nothing, which is
 * how a player empties a slot - the bar ships more slots than the kit has skills.
 */
async function dragSlotOut(page, slotIndex) {
  return page.evaluate(
    (index) => {
      const canvas = document.getElementById("stage");
      const rect = canvas.getBoundingClientRect();
      const toClient = (x, y) => ({
        clientX: rect.left + (x / canvas.width) * rect.width,
        clientY: rect.top + (y / canvas.height) * rect.height
      });
      const slot = window.DNFRender.skillBarButtons()[index];
      const send = (type, x, y, buttons) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 11,
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            isPrimary: true,
            buttons: buttons,
            ...toClient(x, y)
          })
        );
      send("pointerdown", slot.x + slot.w / 2, slot.y + slot.h / 2, 1);
      /* An empty patch of arena, well away from the bar and the panel. */
      send("pointermove", 480, 200, 1);
      send("pointerup", 480, 200, 0);
      return {
        loadout: window.nanoDnf.getLoadout(),
        stored: window.localStorage.getItem("nano-dnf-loadout"),
        arranging: window.nanoDnf.isArranging()
      };
    },
    slotIndex
  );
}

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
    hasTouch: options.mode === "touch",
    /* The page owns a copy control, so the proof can read the clipboard back. */
    permissions: ["clipboard-read", "clipboard-write"]
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
    /*
     * How far off a monster's row a swing still crosses, in world pixels, read
     * off the game's own numbers: the bot has to aim with the same reach the hit
     * test uses or it walks to a row its swings cannot reach.
     */
    meleeReach: window.DNFCore.DEPTH_REACH.melee * window.DNFCore.SLAYER_HEIGHT,
    /*
     * The biggest single hit the shipped game can deal to the Slayer, taken
     * from the game's own numbers (boss damage scaled by its phase-two ratio).
     * The damage gate is written against this instead of a wall-clock total:
     * a total moves with machine load, a single hit cannot.
     */
    maxHit: (function () {
      let max = 0;
      Object.keys(window.DNFCore.ENEMY_TYPES || {}).forEach((type) => {
        const spec = window.DNFCore.ENEMY_TYPES[type];
        if (!spec) return;
        if (spec.damage) max = Math.max(max, spec.damage);
        if (spec.damage && spec.phase2 && spec.phase2.damageScale) {
          max = Math.max(max, Math.round(spec.damage * spec.phase2.damageScale));
        }
      });
      const hazard = window.DNFCore.HAZARD;
      if (hazard && hazard.playerDamage) max = Math.max(max, hazard.playerDamage);
      return max;
    })(),
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

  /*
   * The title screen is also the demo. The page has to look alive before anyone
   * presses a key, so watch it clear the opening room and take an upgrade card
   * while re-checking that the run waiting behind the overlay never moves.
   */
  const realSnapshot = () =>
    page.evaluate(() => {
      const state = window.nanoDnf.getState();
      return {
        hp: state.player.hp,
        xp: state.player.xp,
        level: state.player.level,
        roomIndex: state.roomIndex,
        kills: state.stats.kills,
        damageTaken: state.stats.damageTaken,
        time: Number(state.time.toFixed(4)),
        playerX: Number(state.player.x.toFixed(4)),
        cleared: state.room.cleared,
        enemies: state.enemies.length
      };
    });
  const inertBefore = await realSnapshot();
  const attractStart = await page.evaluate(() => window.nanoDnf.getAttract());
  const attractDemo = {
    polls: 0,
    seconds: 0,
    kills: 0,
    upgradePicks: 0,
    upgradeShown: false,
    roomsReached: 0,
    loops: 0,
    inert: true,
    missing: false
  };
  const demoDeadline = Date.now() + 30 * 1000;
  while (Date.now() < demoDeadline) {
    const demo = await page.evaluate(() => window.nanoDnf.getAttract());
    attractDemo.polls += 1;
    if (!demo || !demo.demo) {
      attractDemo.missing = true;
      break;
    }
    attractDemo.seconds = Math.max(attractDemo.seconds, demo.demo.seconds);
    attractDemo.kills = Math.max(attractDemo.kills, demo.demo.kills);
    attractDemo.upgradePicks = Math.max(attractDemo.upgradePicks, demo.demo.upgradePicks);
    attractDemo.loops = Math.max(attractDemo.loops, demo.demo.loops);
    attractDemo.roomsReached = Math.max(attractDemo.roomsReached, demo.demo.roomIndex + 1);
    if (demo.demo.upgradeOpen && !attractDemo.upgradeShown) {
      attractDemo.upgradeShown = true;
      await page.screenshot({ path: path.join(ARTIFACTS, "attract-upgrade.png") });
    }
    if (JSON.stringify(await realSnapshot()) !== JSON.stringify(inertBefore)) {
      attractDemo.inert = false;
    }
    if (attractDemo.upgradePicks >= 1 && attractDemo.roomsReached >= 2) break;
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "attract-play.png") });
  /*
   * The demo's whole arc has to be reachable, not just the opening room: drive
   * the same session forward in small steps until the boss rages and the run is
   * cleared, screenshotting the rage and re-checking the real run on every step.
   */
  const attractArc = {
    steps: 0,
    seconds: 0,
    phase2: false,
    cleared: false,
    bossShot: false,
    inert: true
  };
  for (let step = 0; step < 140; step += 1) {
    const shot = await page.evaluate(() => window.nanoDnf.fastForwardAttract(0.5));
    if (!shot) {
      attractArc.missing = true;
      break;
    }
    attractArc.steps += 1;
    attractArc.seconds = shot.seconds;
    if (shot.phase2Runs >= 1) attractArc.phase2 = true;
    if (shot.clears >= 1) attractArc.cleared = true;
    if (shot.bossPhase >= 2 && !attractArc.bossShot) {
      attractArc.bossShot = true;
      await page.screenshot({ path: path.join(ARTIFACTS, "attract-boss-rage.png") });
    }
    if (JSON.stringify(await realSnapshot()) !== JSON.stringify(inertBefore)) {
      attractArc.inert = false;
    }
    if (attractArc.phase2 && attractArc.cleared && attractArc.bossShot) break;
  }
  /* Nothing may have started audio yet: browsers only allow it after a gesture. */
  const musicBeforeInput = await page.evaluate(() => window.nanoDnf.getMusicState());
  /*
   * DNF's default key for the up-slash is Z. Press it on the shipped page, read
   * the skill back, then put the run back to its starting state so the pass
   * itself is measured from a clean run.
   */
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  /* Taking over retires the demo: F1 mid-run must not replay it. */
  const attractAfterInput = await page.evaluate(() => window.nanoDnf.getAttract());
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
    /*
     * The four presses are four different swings the bake put back to back, so
     * the row is contiguous: walk every press at its start and its end and report
     * the columns the renderer can actually reach.
     */
    const played = [];
    stages.forEach((stage, press) => {
      [0, 1].forEach((step) => {
        played.push(window.DNFRender.attackColumn(step, press));
      });
    });
    return {
      stages: stages.length,
      maxCombo: window.DNFCore.PLAYER.maxCombo,
      played,
      coverage:
        stages[stages.length - 1].first + stages[stages.length - 1].frames,
      firstColumn: played[0],
      secondColumn: played[2],
      lastColumn: played[played.length - 1],
      upSlashColumns: upSlash ? upSlash.frames : 0
    };
  });

  const held = new Set();
  const started = Date.now();
  let state = await readState(page);
  let midShot = false;
  let pauseReadout = null;
  let stanceReadout = null;
  let airReadout = null;
  let keyChecks = null;
  /*
   * One walk into the screen and back out, per pass. Nothing in the game asks
   * for depth yet - a monster's attacks are still width-only and the slabs
   * cover the whole band - so this is the only thing that would notice the
   * second axis wired to the wrong key, or to a touch button that is not drawn
   * where it is hit-tested.
   *
   * It runs in the opening second of the run, while the monsters are still
   * crossing the room: a hit roots the player and a rooted player stops walking
   * in depth, so a probe taken mid-fight measures the fight and not the axis.
   * That leaves the numbers it reports coarse on purpose - where the band's
   * edges are is pinned by the unit tests, which can take the measurement in a
   * room with nothing in it.
   */
  const depthProbe = { frames: 0, deepest: 0, returned: null };
  /*
   * And the deepest the bot itself took him, after the probe is over. A monster
   * that holds its row - a caster does, because its shots carry whatever row it
   * stands on - can only be hit by walking onto its row, so a pass that never
   * gets above zero walked past a fight it could not have won.
   */
  let steppedIn = 0;
  /* Into the screen for twenty, back out for forty: long enough to cross the
     band both ways at the speed the game walks it. */
  const DEPTH_PROBE_FRAMES = 64;
  const DEPTH_PROBE_TURN = 24;
  let overallBefore = null;
  let paceEarly = null;
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
  /*
   * The trap watch only sees what the pass samples, so a deliberate wait has to
   * keep sampling: the pause and stance checks hold the loop for seconds at a
   * time, which is longer than a slab needs to crack and break.
   */
  const sampleHazards = (sample) => {
    (sample.hazards || []).forEach((hazard, index) => {
      const key = `${sample.roomIndex}:${index}:${hazard.x}`;
      const entry = slabWatch.get(key) || { warned: false };
      if (hazard.stage === "cracking") entry.warned = true;
      if (hazard.stage === "collapsing" && !entry.warned) {
        unwarnedBreaks.push(`${key} broke without a warning`);
      }
      if (hazard.stage === "dormant") entry.warned = false;
      slabWatch.set(key, entry);
    });
  };
  const waitWatching = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await page.waitForTimeout(Math.max(1, Math.min(100, until - Date.now())));
      sampleHazards(await readState(page));
    }
  };
  /* Coaching: which hints showed, and whether any of them cleared again. */
  const hints = { seen: new Set(), cleared: 0, lastId: null };
  const keyOf = (action) => keyForSkill(action, loadout) || KEY_FOR_ACTION[action];
  const touchTarget = (action) => {
    const index = loadout.indexOf(action);
    return index === -1 ? action : `slot${index}`;
  };

      /*
       * The owner's read of the keys: 上挑 sits on Z and has to keep working even
       * when it is not in the bar, and Z in the air is 银光落刃 - a dive with a
       * landing shockwave - while X in the air is the client's jump attack.
       */
      keyChecks = await page.evaluate(async () => {
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        const down = (code) => window.dispatchEvent(new KeyboardEvent("keydown", { code: code, bubbles: true }));
        const up = (code) => window.dispatchEvent(new KeyboardEvent("keyup", { code: code, bubbles: true }));
        const player = () => window.nanoDnf.getState().player;
        const out = {};

        const original = window.nanoDnf.getLoadout();
        window.nanoDnf.setLoadout(
          original.map((skillId) => (skillId === "upSlash" ? null : skillId))
        );
        out.hasUpSlashInBar = window.nanoDnf.getLoadout().includes("upSlash");

        player().mp = player().maxMp;
        player().skillCooldowns.upSlash = 0;
        down("KeyZ");
        await nextFrame();
        await nextFrame();
        out.groundZ = player().skillId;
        up("KeyZ");
        await nextFrame();
        await nextFrame();

        player().mp = player().maxMp;
        player().skillCooldowns.silverFall = 0;
        player().skillTimer = 0;
        player().skillId = null;
        player().onGround = false;
        player().y = window.DNFCore.ARENA.groundY - 130;
        player().vy = -60;
        down("KeyZ");
        await nextFrame();
        await nextFrame();
        out.airZ = player().skillId;
        out.diveRow = window.DNFRender.SPRITE.skillClips.silverFall.row;
        out.airZRow = window.DNFRender.playerFrame(window.nanoDnf.getState(), player()).row;
        up("KeyZ");
        await nextFrame();

        player().skillTimer = 0;
        player().skillId = null;
        player().attackCooldown = 0;
        player().attackTimer = 0;
        player().onGround = false;
        player().y = window.DNFCore.ARENA.groundY - 110;
        player().vy = -170;
        down("KeyX");
        await nextFrame();
        await nextFrame();
        const frame = window.DNFRender.playerFrame(window.nanoDnf.getState(), player());
        out.airX = { row: frame.row, col: frame.col };
        const air = window.DNFRender.SPRITE.airAttack;
        out.airAttack = { row: air.row, first: air.first, frames: air.frames };
        up("KeyX");
        await nextFrame();

        window.nanoDnf.setLoadout(original);
        out.restored = window.nanoDnf.getLoadout().includes("upSlash");
        player().onGround = true;
        player().y = window.DNFCore.ARENA.groundY;
        player().vy = 0;
        player().attackTimer = 0;
        player().skillTimer = 0;
        player().skillId = null;
        return out;
      });

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

    /*
     * The clock is `frames` alone. An earlier cut stopped the whole block the
     * moment `returned` was first written, so the walk back out lasted exactly
     * one frame and the probe accused the game of not walking back at all.
     */
    if (depthProbe.frames < DEPTH_PROBE_FRAMES && !state.player.dead) {
      depthProbe.frames += 1;
      if (depthProbe.frames > 4 && depthProbe.frames <= DEPTH_PROBE_TURN) want.add("up");
      if (depthProbe.frames > DEPTH_PROBE_TURN) want.add("down");
      const z = state.player.z || 0;
      if (depthProbe.frames <= DEPTH_PROBE_TURN) {
        depthProbe.deepest = Math.max(depthProbe.deepest, z);
      } else {
        depthProbe.returned = depthProbe.returned === null ? z : Math.min(depthProbe.returned, z);
      }
    }
    if (depthProbe.returned !== null) steppedIn = Math.max(steppedIn, state.player.z || 0);

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
      /* With no record banked yet, the pace line has to say exactly that. */
      paceEarly = await page.evaluate(() => window.nanoDnf.getPace());
      /*
       * A paused run has to report the run on screen: read the live table, then
       * unpause so the pass keeps playing.
       *
       * Each pass uses its own way in. The touch pass taps the on-screen pause
       * button through real pointer events, because that is the only way a touch
       * player can reach this screen at all - going through KeyP here would have
       * passed while the button was missing.
       */
      const togglePause = async () => {
        if (options.mode === "touch") {
          await touchAction(page, "pause", true);
          await touchAction(page, "pause", false);
        } else {
          await page.keyboard.press("KeyP");
        }
      };
      await togglePause();
      await waitWatching(180);
      overallBefore = await page.evaluate(() => window.nanoDnf.getRunSummary().overallText);
      pauseReadout = await page.evaluate(() => {
        const state = window.nanoDnf.getState();
        const shown = {};
        window.nanoDnf.getLiveRows().forEach((row) => {
          shown[row.id] = row.value;
        });
        const upgrades = state.player.upgradesTaken;
        return {
          paused: window.nanoDnf.isPaused(),
          shown,
          expected: {
            seed: String(window.nanoDnf.getSeed()),
            time: window.DNFRecords.formatSeconds(state.time),
            level: "Lv " + state.player.level,
            upgrades: upgrades.length
              ? upgrades
                  .map((id) => (window.DNFCore.UPGRADES[id] || { name: id }).name)
                  .join(" · ")
              : "无",
            kills: String(state.stats.kills),
            damage: String(state.stats.damageTaken),
            reached:
              "第 " +
              Math.min(state.layout.length, state.roomIndex + 1) +
              "/" +
              state.layout.length +
              " 层"
          }
        };
      });
      await page.screenshot({ path: path.join(ARTIFACTS, `pause-readout-${options.mode}.png`) });
      await togglePause();
      await waitWatching(140);
      pauseReadout.resumed = !(await page.evaluate(() => window.nanoDnf.isPaused()));

      /*
       * 血之狂暴 is the kit's one buffer, and the owner's read of the client is
       * that it is a stance rather than a buff timer: it goes up, it stays up,
       * and the same skill cast again is what takes it down. Drive it through
       * the pass's own input path (the slot key on the keyboard, the slot itself
       * on touch), give the fight a moment to draw blood, then take it down.
       */
      const stance = await page.evaluate(() => {
        const slot = window.nanoDnf.getLoadout().indexOf("frenzy");
        return { slot, code: "Key" + window.DNFLoadout.SLOT_KEYS[slot] };
      });
      const castStance = async () => {
        if (options.mode === "touch") {
          await touchAction(page, "slot" + stance.slot, true);
          await touchAction(page, "slot" + stance.slot, false);
        } else {
          await page.keyboard.press(stance.code);
        }
      };
      const hpBeforeStance = await page.evaluate(() => window.nanoDnf.getState().player.hp);
      await castStance();
      await waitWatching(300);
      const raised = await page.evaluate(() => ({
        raging: window.nanoDnf.isRaging(),
        hp: window.nanoDnf.getState().player.hp
      }));
      /* Nothing but a second cast shortens it, so waiting must not end it. */
      await waitWatching(2200);
      const stillUp = await page.evaluate(() => window.nanoDnf.isRaging());
      const blood = await page.evaluate(() => {
        const state = window.nanoDnf.getState();
        let hits = 0;
        while (state.stats.bloodOrbs === 0 && hits < 60) {
          const target = state.enemies.find((enemy) => !enemy.dead);
          if (!target) break;
          /* The same hit the game's own attacks call. */
          window.DNFCore.damageEnemy(state, target, 1, 0, state.player.x);
          hits += 1;
        }
        /* Freeze mid-swing so the dual-blade arc is in the shot. */
        state.player.invuln = 0;
        state.player.hurtTimer = 0;
        state.player.attackTimer = state.player.attackDuration * 0.5;
        return {
          orbs: state.stats.bloodOrbs,
          flying: state.pickups.filter((drop) => drop.kind === "blood_orb").length,
          hits
        };
      });
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(ARTIFACTS, "rage-stance.png") });
      await castStance();
      await waitWatching(240);
      stanceReadout = {
        hpBefore: hpBeforeStance,
        raging: raised.raging,
        hpCost: hpBeforeStance - raised.hp,
        stillUp,
        orbs: blood.orbs,
        flying: blood.flying,
        hits: blood.hits,
        off: !(await page.evaluate(() => window.nanoDnf.isRaging()))
      };

      /*
       * 崩山击 and 大蹦 leave the ground part way through. The sprite has to keep
       * playing the skill's own action up there instead of dropping to the
       * generic jump art, which is what the owner saw as an extra attack in the
       * air. Freeze one mid-leap frame, read back which row the renderer picks,
       * then let the game have the frame back.
       */
      const air = await page.evaluate(() => {
        const state = window.nanoDnf.getState();
        const player = state.player;
        const before = {
          onGround: player.onGround,
          vy: player.vy,
          skillId: player.skillId,
          skillTimer: player.skillTimer
        };
        player.skillId = "mountainBreaker";
        player.skillTimer = window.DNFCore.SKILLS.mountainBreaker.duration * 0.6;
        player.onGround = false;
        player.vy = -220;
        const frame = window.DNFRender.playerFrame(state, player);
        const clip = window.DNFRender.SPRITE.skillClips.mountainBreaker;
        return {
          row: frame.row,
          col: frame.col,
          clipRow: clip.row,
          clipFirst: clip.first,
          clipFrames: clip.frames,
          extrasRow: window.DNFRender.SPRITE.rows.extras,
          before
        };
      });
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(ARTIFACTS, "smash-air.png") });
      await page.evaluate((before) => {
        const player = window.nanoDnf.getState().player;
        player.onGround = before.onGround;
        player.vy = before.vy;
        player.skillId = before.skillId;
        player.skillTimer = before.skillTimer;
      }, air.before);
      airReadout = {
        row: air.row,
        clipRow: air.clipRow,
        extrasRow: air.extrasRow,
        col: air.col,
        inClip: air.col >= air.clipFirst && air.col < air.clipFirst + air.clipFrames
      };

    }
    await page.waitForTimeout(options.mode === "touch" ? 16 : 20);
    state = await readState(page);
    sampleHazards(state);
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

  /*
   * A clear has to show this run's own numbers. Read the table the renderer
   * draws and compare it with the run that was just played - the banked record
   * for the clock, the live state for everything that cannot change after the
   * last hit.
   */
  const victorySummary = await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    const summary = window.nanoDnf.getRunSummary();
    const shown = {};
    (summary.rows || []).forEach((row) => {
      shown[row.id] = row.value;
    });
    const upgrades = state.player.upgradesTaken;
    const overall = window.DNFRecords.bestOverall(window.nanoDnf.getRecords());
    const expected = {
      seed: String(window.nanoDnf.getSeed()),
      time: window.DNFRecords.formatSeconds(
        summary.lastRun && summary.lastRun.entry ? summary.lastRun.entry.seconds : state.time
      ),
      level: "Lv " + state.player.level,
      upgrades: upgrades.length
        ? upgrades
            .map((id) => (window.DNFCore.UPGRADES[id] || { name: id }).name)
            .join(" · ")
        : "无",
      kills: String(state.stats.kills),
      damage: String(state.stats.damageTaken),
      reached:
        "第 " + Math.min(state.layout.length, state.roomIndex + 1) + "/" + state.layout.length + " 层"
    };
    return {
      victory: state.victory,
      link: summary.link || null,
      overallText: summary.overallText || null,
      overallExpected: overall
        ? "历史最佳 " +
          window.DNFRecords.formatSeconds(overall.seconds) +
          " · 种子 " +
          overall.seed
        : null,
      shown,
      expected,
      mismatches: Object.keys(expected)
        .filter((id) => shown[id] !== expected[id])
        .map((id) => ({ id, shown: shown[id], expected: expected[id] }))
    };
  });
  await page.screenshot({
    path: path.join(ARTIFACTS, `victory-summary-${options.mode}.png`)
  });

  /*
   * A shared link has to reopen the same run, and the page's copy control has
   * to hand back exactly that link.
   */
  const shareOrigin = await page.evaluate(() => ({
    seed: window.nanoDnf.getSeed(),
    layout: window.nanoDnf.getState().layout.slice()
  }));
  const shareLink = await page.evaluate(() => window.nanoDnf.getShareLink());
  const shareRoundTrip = {
    link: shareLink,
    seedOk: false,
    layoutOk: false,
    copied: null
  };
  if (shareLink) {
    const sharePage = await context.newPage();
    await sharePage.goto(shareLink, { waitUntil: "load" });
    await sharePage.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);
    const reopened = await sharePage.evaluate(() => ({
      seed: window.nanoDnf.getSeed(),
      layout: window.nanoDnf.getState().layout.slice()
    }));
    shareRoundTrip.seedOk = reopened.seed === shareOrigin.seed;
    shareRoundTrip.layoutOk =
      JSON.stringify(reopened.layout) === JSON.stringify(shareOrigin.layout);
    await sharePage.close();
  }
  await page.click("#copy-seed");
  await page.waitForTimeout(200);
  shareRoundTrip.copied = await page.evaluate(() =>
    navigator.clipboard
      .readText()
      .then((text) => text)
      .catch(() => null)
  );

  /*
   * The other ending has to report itself the same way. Restart, let the Slayer
   * fight for a moment so the table has real numbers, then take a lethal hit
   * through the game's own damage path and read the YOU DIED screen.
   */
  await page.keyboard.press("F3");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("KeyX");
  await page.waitForTimeout(5000);
  await page.keyboard.up("KeyX");
  await page.keyboard.up("ArrowRight");
  /*
   * A banked record gives the pace line something to race: it has to be ahead
   * while the clock is under the best, and flip the moment the clock passes it.
   */
  const paceBefore = await page.evaluate(() => window.nanoDnf.getPace());
  const paceFlip = await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    const record = window.nanoDnf.getRunSummary().record;
    if (record) state.time = record.seconds + 12;
    return { best: record ? record.seconds : null, clock: state.time };
  });
  await page.waitForTimeout(220);
  const paceAfter = await page.evaluate(() => window.nanoDnf.getPace());
  const defeatDeath = await page.evaluate(() => {
    const state = window.nanoDnf.getState();
    const deathTime = state.time;
    window.DNFCore.damagePlayer(state, state.player.hp + 50, state.player.x + 40);
    return { deathTime: deathTime, defeated: state.defeat };
  });
  await page.waitForTimeout(250);
  const defeatSummary = await page.evaluate((deathTime) => {
    const state = window.nanoDnf.getState();
    const summary = window.nanoDnf.getRunSummary();
    const shown = {};
    (summary.rows || []).forEach((row) => {
      shown[row.id] = row.value;
    });
    const upgrades = state.player.upgradesTaken;
    const clock = /^(\d+):(\d\d)\.(\d)$/.exec(shown.time || "");
    return {
      defeat: state.defeat,
      rooms: state.layout.length,
      roomIndex: state.roomIndex,
      shown,
      expected: {
        seed: String(window.nanoDnf.getSeed()),
        level: "Lv " + state.player.level,
        upgrades: upgrades.length
          ? upgrades
              .map((id) => (window.DNFCore.UPGRADES[id] || { name: id }).name)
              .join(" · ")
          : "无",
        kills: String(state.stats.kills),
        damage: String(state.stats.damageTaken),
        reached:
          "第 " + Math.min(state.layout.length, state.roomIndex + 1) + "/" + state.layout.length + " 层"
      },
      shownSeconds: clock
        ? Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 10
        : null,
      deathTime
    };
  }, defeatDeath.deathTime);
  await page.screenshot({
    path: path.join(ARTIFACTS, `defeat-summary-${options.mode}.png`)
  });

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
    /* And the slot it landed in can be emptied again by dragging it out. */
    const cleared = await dragSlotOut(page, 0);
    await page.keyboard.press("KeyB");
    await page.screenshot({ path: path.join(ARTIFACTS, "loadout-applied.png") });
    const restored = await page.evaluate(() => window.nanoDnf.resetLoadout());
    loadoutChecks = {
      arranging,
      dragged,
      cleared,
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
    attractStart,
    attractDemo,
    attractArc,
    attractAfterInput,
    pauseReadout,
    stanceReadout,
    airReadout,
    keyChecks,
    depthProbe,
    steppedIn,
    overallBefore,
    paceEarly,
    pace: { before: paceBefore, after: paceAfter, record: paceFlip.best },
    victorySummary,
    shareRoundTrip,
    defeatSummary,
    attackChain,
    upSlashKey,
    music: { beforeInput: musicBeforeInput, afterRun: musicAfterRun, mute: musicMuteProbe },
    slabWatch: { unwarnedBreaks, slabs: slabWatch.size },
    hints: { seen: [...hints.seen], cleared: hints.cleared },
    expectedKills,
    expectedUpgrades,
    maxHit: constants.maxHit,
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

/*
 * The damage gate. A wall-clock total depends on how loaded the machine is (a
 * busy box reacts late and eats more chip damage), so the gate is the size of a
 * single hit instead: no event may be bigger than the biggest attack the
 * shipped game can deal. Totals stay in the report as an observation.
 */
function damageProblems(mode, pass, maxHit) {
  const problems = [];
  const events = (pass && pass.damageLog) || [];
  events.forEach((event) => {
    if (typeof maxHit === "number" && maxHit > 0 && event.amount > maxHit) {
      problems.push(
        `${mode}: a ${event.amount} hit at ${event.t}s in room ${event.room} is bigger than the game's biggest attack (${maxHit})`
      );
    }
  });
  return problems;
}

function problemsFor(pass) {
  const problems = [];
  const demo = pass.attractDemo;
  if (!demo || demo.missing) {
    problems.push(`${pass.mode}: the title screen has no attract demo`);
  } else {
    if (!demo.inert) {
      problems.push(`${pass.mode}: the attract demo wrote into the real run`);
    }
    if (demo.kills < 1) {
      problems.push(`${pass.mode}: the attract demo never fought`);
    }
    if (demo.upgradePicks < 1) {
      problems.push(`${pass.mode}: the attract demo never took an upgrade card`);
    }
    if (demo.roomsReached < 2) {
      problems.push(`${pass.mode}: the attract demo never walked through the gate it opened`);
    }
    if (!demo.upgradeShown) {
      problems.push(`${pass.mode}: the demo never showed the upgrade cards`);
    }
  }
  if (!pass.attractAfterInput || pass.attractAfterInput.retired !== true) {
    problems.push(`${pass.mode}: the attract demo kept running after the player took over`);
  }
  const arc = pass.attractArc;
  if (!arc || arc.missing) {
    problems.push(`${pass.mode}: the attract demo cannot be driven forward`);
  } else {
    if (!arc.phase2) {
      problems.push(`${pass.mode}: the attract demo never carried the run into the boss rage`);
    }
    if (!arc.cleared) {
      problems.push(`${pass.mode}: the attract demo never cleared the throne room`);
    }
    if (!arc.inert) {
      problems.push(`${pass.mode}: driving the attract demo forward wrote into the real run`);
    }
    if (!arc.bossShot) {
      problems.push(`${pass.mode}: the rage frame was never on screen to capture`);
    }
  }
  const upSlash = pass.upSlashKey;
  const summary = pass.victorySummary;
  if (!summary || !summary.victory) {
    problems.push(`${pass.mode}: the clear screen was never reached to read its summary`);
  } else {
    const rowIds = ["seed", "time", "level", "upgrades", "kills", "damage"];
    rowIds.forEach((id) => {
      if (summary.shown[id] === undefined) {
        problems.push(`${pass.mode}: the clear screen has no ${id} row`);
      }
    });
    if (summary.mismatches.length) {
      problems.push(
        `${pass.mode}: the clear screen disagrees with the run it just played (${summary.mismatches
          .map((entry) => `${entry.id}: shown ${entry.shown} vs played ${entry.expected}`)
          .join("; ")})`
      );
    }
  }
  const share = pass.shareRoundTrip;
  if (pass.overallBefore !== null) {
    problems.push(
      `${pass.mode}: the title claimed a lifetime best before any run was banked (${pass.overallBefore})`
    );
  }
  const overall = pass.victorySummary && pass.victorySummary.overallText;
  if (!overall) {
    problems.push(`${pass.mode}: the page never reports a lifetime best after a clear`);
  } else if (overall !== pass.victorySummary.overallExpected) {
    problems.push(
      `${pass.mode}: the lifetime best line ${JSON.stringify(overall)} disagrees with the stored records (${pass.victorySummary.overallExpected})`
    );
  }
  if (!share || !share.link || share.link.indexOf("seed=") === -1) {
    problems.push(`${pass.mode}: the clear screen offers no shareable seed link`);
  } else {
    if (!share.seedOk) {
      problems.push(`${pass.mode}: the shared link did not reopen the same seed`);
    }
    if (!share.layoutOk) {
      problems.push(`${pass.mode}: the shared link did not reopen the same room layout`);
    }
    if (share.copied !== share.link) {
      problems.push(
        `${pass.mode}: the copy control returned ${JSON.stringify(share.copied)} instead of ${share.link}`
      );
    }
  }
  const paused = pass.pauseReadout;
  if (!paused || !paused.paused) {
    problems.push(`${pass.mode}: the pause screen was never reached to read its live table`);
  } else {
    const pauseRowIds = ["seed", "time", "level", "upgrades", "kills", "damage", "reached"];
    pauseRowIds.forEach((id) => {
      if (paused.shown[id] === undefined) {
        problems.push(`${pass.mode}: the pause screen has no ${id} row`);
      }
    });
    const pauseWrong = Object.keys(paused.expected).filter(
      (id) => paused.shown[id] !== paused.expected[id]
    );
    if (pauseWrong.length) {
      problems.push(
        `${pass.mode}: the pause screen disagrees with the live run (${pauseWrong
          .map((id) => `${id}: shown ${paused.shown[id]} vs live ${paused.expected[id]}`)
          .join("; ")})`
      );
    }
    if (paused.resumed !== true) {
      problems.push(`${pass.mode}: the pass never resumed after the pause check`);
    }
  }
  const stance = pass.stanceReadout;
  if (!stance) {
    problems.push(`${pass.mode}: the 血之狂暴 stance check never ran`);
  } else {
    if (stance.raging !== true) {
      problems.push(`${pass.mode}: casting 血之狂暴 did not raise the stance`);
    }
    if (!(stance.hpCost > 0)) {
      problems.push(`${pass.mode}: 血之狂暴 did not pay its HP cost (${stance.hpCost})`);
    }
    if (stance.stillUp !== true) {
      problems.push(`${pass.mode}: the stance ran out on its own - it is a toggle, not a timer`);
    }
    if (!(stance.orbs > 0)) {
      problems.push(`${pass.mode}: no blood orb was drawn in ${stance.hits} hits with the stance up`);
    }
    if (stance.off !== true) {
      problems.push(`${pass.mode}: casting 血之狂暴 again did not take the stance down`);
    }
  }
  const air = pass.airReadout;
  if (!air) {
    problems.push(`${pass.mode}: the mid-leap animation check never ran`);
  } else {
    if (air.row === air.extrasRow) {
      problems.push(
        `${pass.mode}: the leap fell back to the generic air art (row ${air.row}) instead of the skill's own action`
      );
    }
    if (air.row !== air.clipRow || !air.inClip) {
      problems.push(
        `${pass.mode}: the mid-leap frame is ${air.row}:${air.col}, not the 崩山击 clip ${air.clipRow}`
      );
    }
  }
  const keys = pass.keyChecks;
  if (!keys) {
    problems.push(`${pass.mode}: the key checks never ran`);
  } else {
    if (keys.hasUpSlashInBar !== false) {
      problems.push(`${pass.mode}: the check could not take 上挑 out of the bar`);
    }
    if (keys.groundZ !== "upSlash") {
      problems.push(
        `${pass.mode}: Z stopped casting 上挑 once it left the bar (cast ${keys.groundZ})`
      );
    }
    if (keys.airZ !== "silverFall") {
      problems.push(`${pass.mode}: Z in the air is ${keys.airZ}, not 银光落刃`);
    }
    if (keys.airZRow !== keys.diveRow) {
      problems.push(
        `${pass.mode}: the dive draws row ${keys.airZRow}, not its own clip ${keys.diveRow}`
      );
    }
    if (
      !keys.airX ||
      keys.airX.row !== keys.airAttack.row ||
      keys.airX.col < keys.airAttack.first ||
      keys.airX.col >= keys.airAttack.first + keys.airAttack.frames
    ) {
      problems.push(
        `${pass.mode}: a press of X in the air is not the jump attack (${JSON.stringify(keys.airX)})`
      );
    }
    if (keys.restored !== true) {
      problems.push(`${pass.mode}: the bar was not put back after the key checks`);
    }
  }
  if (!pass.paceEarly || pass.paceEarly.state !== "none") {
    problems.push(
      `${pass.mode}: the first run should report no record yet, got ${JSON.stringify(pass.paceEarly)}`
    );
  }
  if (!pass.pace || typeof pass.pace.record !== "number") {
    problems.push(`${pass.mode}: the clear never banked a record to race`);
  } else {
    if (!pass.pace.before || pass.pace.before.state !== "ahead") {
      problems.push(
        `${pass.mode}: the fresh run is not ahead of its record (${JSON.stringify(pass.pace.before)})`
      );
    }
    if (!pass.pace.after || pass.pace.after.state !== "behind") {
      problems.push(
        `${pass.mode}: the pace line did not flip behind past the record (${JSON.stringify(pass.pace.after)})`
      );
    } else if (
      typeof pass.pace.after.delta !== "number" ||
      Math.abs(pass.pace.after.delta - 12) > 0.5
    ) {
      problems.push(`${pass.mode}: the behind delta is ${pass.pace.after.delta}, not 12s`);
    }
  }
  const defeat = pass.defeatSummary;
  if (!defeat || !defeat.defeat) {
    problems.push(`${pass.mode}: the defeat screen was never reached to read its summary`);
  } else {
    const defeatRowIds = ["seed", "time", "level", "upgrades", "kills", "damage", "reached"];
    defeatRowIds.forEach((id) => {
      if (defeat.shown[id] === undefined) {
        problems.push(`${pass.mode}: the defeat screen has no ${id} row`);
      }
    });
    const wrong = Object.keys(defeat.expected).filter(
      (id) => defeat.shown[id] !== defeat.expected[id]
    );
    if (wrong.length) {
      problems.push(
        `${pass.mode}: the defeat screen disagrees with the run that died (${wrong
          .map((id) => `${id}: shown ${defeat.shown[id]} vs played ${defeat.expected[id]}`)
          .join("; ")})`
      );
    }
    /* The clock freezes a frame after the last hit, so allow one frame of slack. */
    if (
      typeof defeat.shownSeconds !== "number" ||
      Math.abs(defeat.shownSeconds - defeat.deathTime) > 0.3
    ) {
      problems.push(
        `${pass.mode}: the defeat screen clock (${defeat.shown && defeat.shown.time}) is not the death time (${defeat.deathTime})`
      );
    }
  }
  if (!upSlash || upSlash.shortcut !== "Z" || !upSlash.equipped || upSlash.cooldown <= 0) {
    problems.push(`${pass.mode}: Z does not cast the up-slash (${JSON.stringify(upSlash)})`);
  }
  const chain = pass.attackChain;
  if (!chain || chain.stages !== 3 || chain.maxCombo !== 3) {
    problems.push(`${pass.mode}: the shipped normal attack is not the owner's three-cut chain`);
  } else {
    if (chain.firstColumn !== 0) {
      problems.push(
        `${pass.mode}: the chain opens on frame ${chain.firstColumn}, not the first cut's wind-up`
      );
    }
    if (chain.secondColumn <= chain.firstColumn) {
      problems.push(`${pass.mode}: pressing X does not walk to the next stage`);
    }
    if (chain.coverage !== 23) {
      problems.push(
        `${pass.mode}: the three cuts cover ${chain.coverage} frames, not the baked 23`
      );
    }
    if (chain.lastColumn !== 22) {
      problems.push(`${pass.mode}: the last press ends on frame ${chain.lastColumn}, not 22`);
    }
    if (chain.upSlashColumns !== 9) {
      problems.push(
        `${pass.mode}: the up-slash skill ships ${chain.upSlashColumns} body frames, not 上挑's 9`
      );
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
  /*
   * The floor's second axis, walked through this pass's own input path - real
   * key events on one side, real pointer events on the other.
   */
  const walked = pass.depthProbe || {};
  if (!(walked.deepest > 0)) {
    problems.push(`${pass.mode}: walking into the screen never left the ground line`);
  } else if (!(walked.returned < walked.deepest)) {
    problems.push(
      `${pass.mode}: walking back towards the camera did not bring him in (${walked.deepest} -> ${walked.returned})`
    );
  }
  if (!(pass.steppedIn > 0)) {
    problems.push(`${pass.mode}: never walked onto a monster's row to reach it (deepest ${pass.steppedIn})`);
  }
  const upgrades = (pass.state.player.upgradesTaken || []).length;
  if (upgrades !== pass.expectedUpgrades) {
    problems.push(
      `${pass.mode}: upgradesTaken=${upgrades} (expected ${pass.expectedUpgrades})`
    );
  }
  problems.push(...damageProblems(pass.mode, pass, pass.maxHit));
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
    if (!checks || !checks.cleared) {
      problems.push("keyboard: dragging a skill out of the bar was never tried");
    } else {
      if (checks.cleared.loadout[0] !== null) {
        problems.push(
          `keyboard: dragging a skill out of the bar left ${checks.cleared.loadout[0]} in slot A`
        );
      }
      if (checks.cleared.stored !== checks.cleared.loadout.join(",")) {
        problems.push("keyboard: the emptied slot was not persisted");
      }
      if (checks.cleared.arranging !== true) {
        problems.push("keyboard: the emptied slot was not emptied while arranging");
      }
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
    attract: { ...pass.attractDemo, retiredOnTakeover: !!(pass.attractAfterInput || {}).retired },
    attractArc: pass.attractArc,
    victorySummary: pass.victorySummary && {
      shown: pass.victorySummary.shown,
      expected: pass.victorySummary.expected,
      overallText: pass.victorySummary.overallText,
      overallExpected: pass.victorySummary.overallExpected
    },
    share: pass.shareRoundTrip && {
      link: pass.shareRoundTrip.link,
      seedOk: pass.shareRoundTrip.seedOk,
      layoutOk: pass.shareRoundTrip.layoutOk,
      copied: pass.shareRoundTrip.copied
    },
    pauseReadout: pass.pauseReadout && {
      shown: pass.pauseReadout.shown,
      expected: pass.pauseReadout.expected,
      resumed: pass.pauseReadout.resumed
    },
    stanceReadout: pass.stanceReadout,
    airReadout: pass.airReadout,
    keyChecks: pass.keyChecks,
    pace: {
      firstRun: pass.paceEarly && pass.paceEarly.state,
      before: pass.pace.before && pass.pace.before.state,
      after: pass.pace.after && pass.pace.after.state,
      delta: pass.pace.after && pass.pace.after.delta,
      record: pass.pace.record
    },
    defeatSummary: pass.defeatSummary && {
      shown: pass.defeatSummary.shown,
      expected: pass.defeatSummary.expected,
      deathTime: Number((pass.defeatSummary.deathTime || 0).toFixed(2))
    },
    attackChain: pass.attackChain,
    upSlashKey: pass.upSlashKey,
    slabWatch: pass.slabWatch,
    collapses: pass.state.stats.collapses,
    hints: pass.hints,
    music: pass.music,
    damageLog: pass.damageLog,
    maxHit: pass.maxHit,
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

  /*
   * The damage gate has to have teeth: feed it a hit bigger than the game can
   * deal and a clean log, and require it to separate the two. A gate that only
   * ever passes is not a gate.
   */
  const gateSelfTest = {
    caughtRegression: damageProblems(
      "selftest",
      { damageLog: [{ t: 1, room: 1, amount: 60, attacker: "boss:melee" }] },
      22
    ).length,
    cleanPasses: damageProblems(
      "selftest",
      { damageLog: [{ t: 1, room: 1, amount: 13, attacker: "brute:melee" }] },
      22
    ).length
  };
  console.log(
    `damage gate self-test: caught=${gateSelfTest.caughtRegression} clean=${gateSelfTest.cleanPasses}`
  );

  const problems = passes.flatMap(problemsFor);
  if (gateSelfTest.caughtRegression !== 1 || gateSelfTest.cleanPasses !== 0) {
    problems.push(
      "the damage gate no longer separates a regression from a clean run " +
        JSON.stringify(gateSelfTest)
    );
  }
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
