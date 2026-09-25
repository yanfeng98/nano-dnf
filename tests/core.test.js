"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/core.js");
const Render = require("../src/render.js");

/*
 * Frames to run after pressing X before the cut lands. The blade connects on
 * the arc frame, which sits 0.70 of the way through the swing (see
 * PLAYER.attackActiveFrom), and the swing advances one step per frame.
 */
const ATTACK_HIT_FRAMES =
  Math.ceil((Core.PLAYER.attackActiveFrom * Core.PLAYER.attackDuration) / Core.DT);

/**
 * Decode the shipped 8-bit RGBA sprite sheet.
 *
 * The sheet is a plain non-interlaced PNG, so Node's zlib plus the five PNG
 * row filters is enough to read the pixels back and prove what the bake
 * actually wrote, without adding an image dependency to the test suite.
 */
function decodeRgbaPng(file) {
  const buffer = fs.readFileSync(file);
  const idat = [];
  let width = 0;
  let height = 0;
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "the sheet is an 8-bit PNG");
      assert.equal(data[9], 6, "the sheet is RGBA");
      assert.equal(data[12], 0, "the sheet is not interlaced");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const above = up ? up[x] : 0;
      const corner = up && x >= 4 ? up[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + above) & 0xff;
      else if (filter === 3) value = (value + ((left + above) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + above - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - corner);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : corner;
        value = (value + predictor) & 0xff;
      } else {
        assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      }
      row[x] = value;
    }
  }
  return { width, height, pixels };
}

/** Alpha bounding box of one cell, or null when the cell is empty. */
function cellAlphaBox(sheet, col, row, cellW, cellH) {
  const frameW = cellW || Render.SPRITE.frameW;
  const frameH = cellH || Render.SPRITE.frameH;
  let x0 = frameW;
  let y0 = frameH;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frameH; y += 1) {
    for (let x = 0; x < frameW; x += 1) {
      const alpha = sheet.pixels[((row * frameH + y) * sheet.width + col * frameW + x) * 4 + 3];
      if (alpha === 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Rooms in one run for a seed, so tests never assume the pool is the run. */
function runRooms(seed) {
  const layout = Core.layoutForSeed(seed === undefined ? Core.DEFAULT_SEED : seed);
  return layout.map((index) => Core.ROOMS[index]);
}

function lastRoomIndex(seed) {
  return Core.layoutForSeed(seed === undefined ? Core.DEFAULT_SEED : seed).length - 1;
}

function enemiesInRun(seed) {
  return runRooms(seed).reduce((total, room) => total + room.enemies.length, 0);
}

/** First room of this seed's run that fields a caster, or -1. */
function roomIndexWithCaster(seed) {
  return Core.layoutForSeed(seed).findIndex((index) =>
    Core.ROOMS[index].enemies.some((enemy) => enemy.type === "caster")
  );
}

/** Where this seed's run fights the collapsing-floor room, or -1. */
function chapelRoomIndex(seed) {
  return Core.layoutForSeed(seed === undefined ? Core.DEFAULT_SEED : seed).indexOf(
    Core.ALTERNATE_ROOM_INDEX
  );
}

/** Last room never advances, so movement tests can run without a room transition. */
function lastRoomState(seed) {
  const state = Core.createState({
    seed: seed || Core.DEFAULT_SEED,
    roomIndex: lastRoomIndex(seed)
  });
  state.enemies = [];
  state.room.cleared = true;
  return state;
}

/** A damage-first player: take the sharpest upgrade on offer. */
const UPGRADE_PREFERENCE = ["attack", "skillPower", "maxHp", "mpRegen"];

function preferredUpgrade(options) {
  const offered = options || [];
  for (const id of UPGRADE_PREFERENCE) {
    if (offered.includes(id)) return id;
  }
  return offered[0] || null;
}

function killAll(state) {
  state.enemies.slice().forEach((enemy) => {
    Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
  });
}

test("player runs right and is clamped by the arena wall", () => {
  const state = lastRoomState();
  state.player.x = Core.ARENA.rightWall - 70;

  Core.runFrames(state, 60, { right: true });

  assert.equal(state.player.x, Core.ARENA.rightWall - state.player.width / 2);
  assert.equal(state.player.facing, 1);
});

test("player stays grounded when idle", () => {
  const state = lastRoomState();

  Core.runFrames(state, 30, {});

  assert.equal(state.player.y, Core.ARENA.groundY);
  assert.equal(state.player.onGround, true);
  assert.equal(state.player.hp, state.player.maxHp);
});

test("jump leaves the ground, peaks above the floor, and lands again", () => {
  const state = lastRoomState();

  Core.step(state, { jump: true });
  assert.equal(state.player.onGround, false);
  assert.ok(state.player.vy < 0);

  let peak = state.player.y;
  for (let frame = 0; frame < 180; frame += 1) {
    Core.step(state, {}, Core.DT);
    peak = Math.min(peak, state.player.y);
  }

  assert.ok(peak < Core.ARENA.groundY - 80, `expected a real jump height, peak=${peak}`);
  assert.equal(state.player.y, Core.ARENA.groundY);
  assert.equal(state.player.onGround, true);
});

test("basic attack damages an enemy inside reach exactly once", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 50);
  state.enemies = [enemy];
  const hpBefore = enemy.hp;

  Core.step(state, { attack: true });
  Core.runFrames(state, ATTACK_HIT_FRAMES, {});

  assert.equal(hpBefore - enemy.hp, Core.PLAYER.comboDamage[0]);
  assert.equal(state.stats.hits, 1);
});

test("each cut connects on the frame the katana sweeps through", () => {
  /*
   * The damage used to land during the wind-up, about five frames before the
   * white slash arc was even on screen, which reads as the enemy reacting to a
   * swing that has not happened yet. The arcs sit on source frames 4, 13, 24 and
   * 34 - offsets 4, 3, 4 and 4 inside their stage - so the cut has to connect
   * within a frame of its arc: on the last wind-up frame at the earliest, never
   * back in the frozen guard pose.
   */
  /* Every stage puts its slash on its fourth frame. */
  const arcOffset = [3, 3, 3, 3];
  Core.ATTACK_STAGES.forEach((stage, press) => {
    const state = lastRoomState();
    const enemy = Core.createEnemy(state, "boss", state.player.x + 50);
    enemy.hp = 999;
    enemy.maxHp = 999;
    state.enemies = [enemy];
    const hpBefore = enemy.hp;
    /* A live combo window is what makes the next press play the next stage. */
    state.player.comboIndex = (press + Core.ATTACK_STAGES.length - 1) % Core.ATTACK_STAGES.length;
    state.player.comboTimer = Core.PLAYER.comboWindow;

    Core.step(state, { attack: true });
    let frames = 0;
    while (enemy.hp === hpBefore && frames < 40) {
      Core.runFrames(state, 1, {});
      frames += 1;
    }

    assert.ok(enemy.hp < hpBefore, `press ${press + 1} connects`);
    const frame = Render.playerFrame(state, state.player);
    assert.equal(frame.row, Render.SPRITE.rows.attack, `press ${press + 1} shows the attack row`);
    const offset = frame.col - stage.first;
    assert.ok(
      offset >= arcOffset[press] - 1 && offset <= arcOffset[press] + 1,
      `press ${press + 1} lands on the sweep, not the wind-up: frame ${stage.first + offset}`
    );
  });
});

test("attack does not reach an enemy far outside the hitbox", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 320);
  state.enemies = [enemy];
  const hpBefore = enemy.hp;

  Core.runFrames(state, 12, (frame) => (frame === 0 ? { attack: true } : {}));

  assert.equal(enemy.hp, hpBefore);
  assert.equal(state.stats.hits, 0);
});

test("the combo chain walks the three cuts of the normal attack", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 48);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  const stages = Core.ATTACK_STAGES;
  assert.equal(stages.length, 3, "the owner's chain is three cuts");

  const hits = [];
  for (let swing = 0; swing < stages.length; swing += 1) {
    enemy.x = state.player.x + 48;
    const hpBefore = enemy.hp;
    Core.step(state, { attack: true });
    assert.equal(state.player.comboIndex, swing, `press ${swing + 1} plays stage ${swing}`);
    Core.runFrames(state, 24, {});
    hits.push(hpBefore - enemy.hp);
  }

  assert.deepEqual(hits, Core.PLAYER.comboDamage);
  assert.equal(state.player.comboIndex, stages.length - 1);
});

test("dead enemies leave the room and clearing the last room wins", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: lastRoomIndex() });
  const total = state.enemies.length;

  killAll(state);
  Core.step(state, {});

  assert.equal(state.enemies.length, 0);
  assert.equal(state.stats.kills, total);
  assert.equal(state.room.cleared, true);
  assert.equal(state.victory, true);
});

test("cleared room advances to the next room at the right wall", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  killAll(state);
  Core.step(state, {});

  assert.equal(state.room.cleared, true);
  assert.equal(state.roomIndex, 0);
  /* The reward gates the exit: walking past it must not skip the choice. */
  assert.ok(state.upgradeChoice, "clearing a room must offer an upgrade");

  state.player.x = Core.ARENA.rightWall - state.player.width / 2;
  Core.step(state, {});
  assert.equal(state.roomIndex, 0, "the gate stays shut until an upgrade is taken");

  Core.chooseUpgrade(state, preferredUpgrade(state.upgradeChoice.options));
  Core.step(state, {});

  assert.equal(state.roomIndex, 1);
  assert.equal(state.room.name, runRooms()[1].name);
  assert.equal(state.room.cleared, false);
  assert.equal(state.enemies.length, runRooms()[1].enemies.length);
  assert.equal(state.player.x, 110);
});

test("enemy damage is applied once and grants invulnerability frames", () => {
  const state = lastRoomState();
  const hpBefore = state.player.hp;

  const first = Core.damagePlayer(state, 12, state.player.x + 40);
  assert.equal(first, 12);
  assert.equal(state.player.hp, hpBefore - 12);
  assert.ok(state.player.invuln > 0);

  const second = Core.damagePlayer(state, 12, state.player.x + 40);
  assert.equal(second, 0);
  assert.equal(state.player.hp, hpBefore - 12);
  assert.equal(state.stats.damageTaken, 12);
});

test("player death flips the run into defeat", () => {
  const state = lastRoomState();

  Core.damagePlayer(state, 9999, state.player.x + 40);

  assert.equal(state.player.hp, 0);
  assert.equal(state.player.dead, true);
  assert.equal(state.defeat, true);
});

test("血气之刃 spends MP, hits inside reach, then stays on cooldown", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "grunt", state.player.x + 70);
  const far = Core.createEnemy(state, "grunt", state.player.x + 420);
  [near, far].forEach((enemy) => {
    enemy.hp = 300;
    enemy.maxHp = 300;
  });
  state.enemies = [near, far];
  state.player.mp = 100;
  const mpBefore = state.player.mp;
  const skill = Core.SKILLS.bloodSword;
  const nearHp = near.hp;
  const farHp = far.hp;

  Core.step(state, { skills: { bloodSword: true } });
  Core.runFrames(state, 26, {});

  assert.equal(nearHp - near.hp, skill.damage * skill.hits);
  assert.equal(far.hp, farHp);
  assert.ok(state.player.mp < mpBefore - skill.mp + 5, `mp=${state.player.mp}`);
  assert.ok(state.player.skillCooldowns.bloodSword > 0, "血气之刃 should start its cooldown");

  const hpBefore = near.hp;
  Core.step(state, { skills: { bloodSword: true } });
  Core.runFrames(state, 20, {});
  assert.equal(near.hp, hpBefore, "cooldown should block an immediate recast");
});

test("skills are refused while MP is below their cost", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 60);
  enemy.hp = 300;
  enemy.maxHp = 300;
  state.enemies = [enemy];
  state.player.mp = Core.SKILLS.crossSlash.mp - 1;
  const hpBefore = enemy.hp;

  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, 10, {});

  assert.equal(enemy.hp, hpBefore);
  assert.equal(state.player.skillTimer, 0);
});

test("上挑 launches an enemy and keeps it from acting while airborne", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 50);
  enemy.hp = 300;
  enemy.maxHp = 300;
  state.enemies = [enemy];

  Core.step(state, { skills: { upSlash: true } });
  Core.runFrames(state, 6, {});

  assert.equal(enemy.hp, 300 - Core.SKILLS.upSlash.damage);
  assert.ok(enemy.y < Core.ARENA.groundY, `launched enemy should leave the ground, y=${enemy.y}`);
  assert.equal(enemy.attackTimer, 0);
  assert.equal(enemy.onGround, false);

  Core.runFrames(state, 10, {});
  assert.equal(enemy.attackTimer, 0, "airborne enemies cannot start an attack");
});

test("崩山击 jumps properly and lands the smash on the ground", () => {
  const state = lastRoomState();
  const skill = Core.SKILLS.mountainBreaker;
  /*
   * The owner's read: the hop has to look like a jump, and the blade has to land
   * on the ground rather than in the air. Record the actual arc the sim produces.
   *
   * The arc is the client preview's now (assets/dnf_src/bilibili/skill-clips/
   * 01_崩山击.mp4): he rises ~240px - the clip's own leap is about 3.7 body
   * heights - and is back down inside 0.75s, which is what the move's own
   * leapGravity is for. The global 2200 cannot hit both of those numbers.
   */
  state.enemies = [];
  const takeoff = state.player.y;
  let apex = 0;
  let landedAt = null;
  Core.step(state, { skills: { mountainBreaker: true } });
  for (let frame = 1; frame <= Math.ceil(skill.duration * Core.FPS); frame += 1) {
    Core.runFrames(state, 1, {});
    apex = Math.max(apex, takeoff - state.player.y);
    if (landedAt === null && frame > 6 && state.player.onGround) {
      landedAt = frame * Core.DT;
    }
  }
  assert.ok(apex >= 200, `崩山击 has to jump properly (apex ${Math.round(apex)}px)`);
  assert.ok(apex <= 300, `and not higher than the clip's leap (apex ${Math.round(apex)}px)`);
  assert.ok(
    landedAt !== null && landedAt < skill.activeFrom,
    `the smash has to land on the ground (touched down at ${landedAt}, hit at ${skill.activeFrom})`
  );
  assert.ok(landedAt < 0.8, `and be back down inside 0.8s (landed at ${landedAt})`);
});

test("崩山击 brings its own fall gravity, and no other move does", () => {
  /*
   * The leap's arc is the client preview's, and the world's gravity cannot make
   * it: ~240px up would hang for almost a second under 2200. 崩山击 is the one
   * move that overrides it, so the override is the only thing this test guards -
   * a plain hop (C) or any other airborne skill still falls at PHYSICS.gravity.
   */
  const carrying = Core.CASTABLE_SKILLS.filter((id) => Core.SKILLS[id].leapGravity);
  assert.deepEqual(carrying, ["mountainBreaker"], "only 崩山击 overrides the fall gravity");
  assert.ok(
    Core.SKILLS.mountainBreaker.leapGravity > Core.PHYSICS.gravity,
    "and its fall is heavier than the world's, which is what makes the leap high and short"
  );
  assert.equal(
    Core.SKILLS.mountainRift.leapGravity,
    undefined,
    "the ultimate is planted and has no fall of its own"
  );
});

test("崩山击's leap is invulnerable without the hit flash", () => {
  /*
   * The window is solid. The client's own preview holds one pose sequence
   * through the hop, and the i-frame blink chopped the whole move up (owner:
   * 「一摸一样」), so the leap marks its window solid: drawPlayer() still blinks
   * for a real hit - `hurtTimer` wins, and so does any `invuln` past the solid
   * timer - but not for the leap itself.
   */
  const state = lastRoomState();
  state.enemies = [];
  Core.step(state, { skills: { mountainBreaker: true } });
  Core.runFrames(state, 6, {});
  const player = state.player;
  assert.ok(player.solidInvuln > 0, "the leap marks its window solid");
  assert.ok(
    player.invuln >= player.solidInvuln,
    "and covers that whole window with invulnerability"
  );
  assert.equal(player.onGround, false, "the check is taken mid-hop");

  /* A plain hop (C) grants nothing, so there is nothing to blink either. */
  const hop = Core.createState({ seed: 3 });
  Core.runFrames(hop, 4, { jump: true });
  assert.equal(hop.player.invuln, 0, "a normal jump is not invulnerable");
  assert.equal(hop.player.solidInvuln, 0, "and marks no solid window");
});

test("崩山击 adds a ground shockwave that reaches past the blade", () => {
  const state = lastRoomState();
  /*
   * The move hops him ~105px forward before the blade lands, so the pair sits
   * ahead of the landing point: one inside the blade's 96px reach, one past it
   * but inside the 150px ground wave.
   */
  const near = Core.createEnemy(state, "grunt", state.player.x + 180);
  const far = Core.createEnemy(state, "grunt", state.player.x + 240);
  [near, far].forEach((enemy) => {
    enemy.hp = 300;
    enemy.maxHp = 300;
    enemy.speed = 0;
  });
  state.enemies = [near, far];
  const skill = Core.SKILLS.mountainBreaker;
  const nearHp = near.hp;
  const farHp = far.hp;

  Core.step(state, { skills: { mountainBreaker: true } });
  /*
   * 崩山击 raises, hops ~240px and lands the smash at 0.75s. The wave effect only
   * lives 0.4s, so it is checked as it lands rather than at the end of the
   * recovery.
   */
  Core.runFrames(state, Math.ceil(0.8 * Core.FPS), {});
  assert.ok(state.effects.some((effect) => effect.kind === "shockwave"));
  Core.runFrames(state, Math.ceil(0.5 * Core.FPS), {});

  assert.equal(nearHp - near.hp, skill.damage, "blade hit lands once");
  assert.equal(farHp - far.hp, skill.shockwave.damage, "shockwave reaches the second target");
});

test("skill damage grows with the character level", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 60);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];
  state.player.level = 4;
  state.player.attackBonus = 0;
  const skill = Core.SKILLS.crossSlash;
  const hpBefore = enemy.hp;

  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, 20, {});

  assert.equal(hpBefore - enemy.hp, (skill.damage + (4 - 1) * skill.growth) * skill.hits);
});

test("上挑 lifts the target and airborne hits keep it juggled", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 46);
  enemy.hp = 400;
  enemy.maxHp = 400;
  enemy.speed = 0;
  state.enemies = [enemy];

  Core.step(state, { skills: { upSlash: true } });
  Core.runFrames(state, 6, {});
  assert.equal(enemy.onGround, false, "上挑 should launch the target");

  Core.runFrames(state, 24, { attack: true });
  assert.ok(state.stats.airHits >= 1, `airborne hits should be counted, got ${state.stats.airHits}`);
  assert.equal(enemy.onGround, false, "the juggle keeps the target in the air");
  assert.ok(state.player.hp === state.player.maxHp, "the juggled enemy never gets to hit back");
});

test("崩山击 knocks the target down and its shockwave does too", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "grunt", state.player.x + 180);
  const far = Core.createEnemy(state, "grunt", state.player.x + 240);
  [near, far].forEach((enemy) => {
    enemy.hp = 400;
    enemy.maxHp = 400;
    enemy.speed = 0;
  });
  state.enemies = [near, far];

  Core.step(state, { skills: { mountainBreaker: true } });
  Core.runFrames(state, Math.ceil(0.8 * Core.FPS), {});

  assert.ok(near.knockdown > 0, "the smash should knock the target down");
  assert.ok(far.knockdown > 0, "the ground shockwave should knock the far target down");
  assert.ok(state.effects.some((effect) => effect.kind === "shockwave"));
});

test("崩山击's wave hits and shakes without drawing a targeting ring", () => {
  /*
   * The reference draws no ring under this move - the landing is the fire
   * column and the spikes and nothing else (owner: 「参考视频没有范围圈」).
   * The wave keeps its hitbox, so the second target above still takes its
   * damage; what is dropped is the ellipse the engine draws for every other
   * wave. 大蹦 dropped it too once the training-room reference showed what its
   * ground actually does: a one-sided gash with fire standing in it, and no
   * circle anywhere, so there is nothing left for the engine's ellipse to agree
   * with (see 崩山裂地斩's own test).
   */
  assert.equal(
    Core.SKILLS.mountainBreaker.shockwave.arc,
    false,
    "崩山击's wave draws no arc"
  );
  assert.equal(
    Core.SKILLS.mountainRift.shockwave.arc,
    false,
    "and 大蹦's gash draws none either"
  );

  const state = lastRoomState();
  state.enemies.forEach((enemy) => {
    enemy.dead = true;
  });
  Core.step(state, { skills: { mountainBreaker: true } });
  Core.runFrames(state, Math.ceil(0.78 * Core.FPS), {});
  const wave = state.effects.find((effect) => effect.kind === "shockwave");
  assert.ok(wave, "the wave is still pushed, so it still shakes the screen");
  assert.equal(wave.arc, false, "carrying the flag render reads to skip the ring");

  /*
   * And the ring is skipped in the one place that draws it. A plain wave has to
   * keep drawing, so this pins the flag, not the absence of the branch.
   */
  const renderSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "render.js"),
    "utf8"
  );
  assert.match(
    renderSource,
    /effect\.kind === "shockwave" && effect\.arc !== false/,
    "drawPlayer's wave branch skips the ring when the skill says so"
  );
  assert.equal(
    Render.EFFECT.draw.mountainBreaker.ground,
    true,
    "and the landing art is rooted on the floor, not on his airborne feet"
  );
  assert.equal(
    Render.EFFECT.timing.mountainBreaker.from,
    0.45,
    "the column is up before touchdown, the way the reference erupts it"
  );
});

test("十字斩 makes the target bleed from skill level 2", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 60);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, 30, {});
  assert.equal(enemy.bleed, null, "no bleed at level 1");

  state.player.level = 3;
  state.player.skillCooldowns.crossSlash = 0;
  state.player.mp = state.player.maxMp;
  const hpBefore = enemy.hp;
  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, 30, {});
  assert.ok(enemy.bleed, "十字斩 should apply bleed from level 2");

  const damage = hpBefore - enemy.hp;
  Core.runFrames(state, 200, {});
  assert.ok(enemy.hp < hpBefore - damage, "bleed should keep ticking after the cast");
  assert.equal(enemy.bleed, null, "bleed expires");
});

test("血气之刃 lands three hits and stuns the target while it is held", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 70);
  enemy.hp = 600;
  enemy.maxHp = 600;
  enemy.speed = 0;
  state.enemies = [enemy];
  const skill = Core.SKILLS.bloodSword;

  Core.step(state, { skills: { bloodSword: true } });
  let stunned = 0;
  for (let frame = 0; frame < 50; frame += 1) {
    Core.step(state, {});
    if (enemy.stun > 0) stunned += 1;
  }

  assert.equal(600 - enemy.hp, skill.damage * skill.hits, "three separate hits land");
  assert.ok(stunned > 8, `target should stay stunned through the ghosts, frames=${stunned}`);
  assert.ok(enemy.vx === 0, "血气之刃 holds the target in place");
});

test("normal attacks can be cancelled into a skill during recovery", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 55);
  enemy.hp = 600;
  enemy.maxHp = 600;
  enemy.speed = 0;
  state.enemies = [enemy];

  Core.step(state, { attack: true });
  /* The cut is 0.22s and its recovery starts at 0.64 of it: 11 frames since the
     press (12 with the press frame) is inside the swing. */
  Core.runFrames(state, 11, {});
  assert.ok(state.player.attackTimer > 0, "attack is still in recovery");

  Core.step(state, { skills: { crossSlash: true } });
  assert.equal(state.player.skillId, "crossSlash", "recovery can be cancelled into a skill");
  assert.equal(state.player.attackTimer, 0);
});

test("the boss keeps super armour while its slam is winding up", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 40);
  boss.hp = 900;
  boss.maxHp = 900;
  boss.speed = 0;
  boss.attackCooldown = 0;
  boss.slamCooldown = 0;
  state.enemies = [boss];

  let sawSuperArmor = false;
  for (let frame = 0; frame < 120; frame += 1) {
    Core.step(state, { attack: true });
    if (boss.superArmor) {
      sawSuperArmor = true;
      assert.equal(boss.hurtTimer, 0, "super armour never takes hit-stun");
    }
  }
  assert.ok(sawSuperArmor, "the boss should gain super armour for the slam");
  assert.ok(boss.hp < 900, "hits still land through super armour");
});

test("same seed and same inputs produce identical runs", () => {
  const pattern = (frame) => ({
    right: frame < 150,
    jump: frame % 90 === 0,
    attack: frame % 13 === 0,
    skill: frame % 210 === 0
  });
  const a = Core.createState({ seed: 42 });
  const b = Core.createState({ seed: 42 });

  Core.runFrames(a, 240, pattern);
  Core.runFrames(b, 240, pattern);

  const snapshot = (state) =>
    state.enemies.map((enemy) => [enemy.type, Number(enemy.x.toFixed(4)), enemy.hp, Number(enemy.y.toFixed(4))]);

  assert.deepEqual(snapshot(a), snapshot(b));
  assert.equal(a.player.hp, b.player.hp);
  assert.equal(a.player.x, b.player.x);
  assert.equal(a.stats.kills, b.stats.kills);
});

test("a 900-frame scripted run keeps the world inside its invariants", () => {
  const state = Core.createState({ seed: 7 });

  Core.runFrames(state, 900, (frame) => ({
    right: frame % 200 < 150,
    left: frame % 200 >= 150,
    jump: frame % 47 === 0,
    attack: frame % 17 === 0,
    skills: { bloodSword: frame % 211 === 0, mountainBreaker: frame % 173 === 0 }
  }));

  assert.ok(state.time > 14);
  assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y));
  assert.ok(state.player.x >= Core.ARENA.leftWall);
  assert.ok(state.player.x <= Core.ARENA.rightWall);
  assert.ok(state.player.hp >= 0 && state.player.hp <= state.player.maxHp);
  assert.ok(state.player.mp >= 0 && state.player.mp <= state.player.maxMp);
  assert.ok(state.roomIndex >= 0 && state.roomIndex < state.layout.length);
  assert.ok(state.enemies.every((enemy) => enemy.hp > 0));
  assert.equal(state.victory && state.defeat, false);
});

/** Render one frame into a recording context and hand back every call it made. */
function renderCalls(state, meta) {
  const calls = [];
  const ctx = new Proxy(
    {
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} })
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = (...args) => calls.push([String(prop), ...args]);
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );
  Render.render(ctx, state, meta || {});
  return calls;
}

/*
 * Depth (docs/adr/0001-depth-axis.md).
 *
 * The player can walk on the second axis from slice 2 on, but nothing else in
 * the world has a depth of its own yet: no room asks for one and no monster
 * takes a step in it, so z = 0 is still where every body stands and a run that
 * never presses up or down has to come out exactly as it did before the axis
 * existed. That is the invariant the five-slice plan rests on, so it is
 * asserted rather than assumed.
 */
test("no room and no monster has a depth of its own yet", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  assert.equal(state.player.z, 0, "a fresh player walks the ground line");
  assert.ok(state.enemies.every((enemy) => enemy.z === 0), "no room asks for a depth yet");

  Core.runFrames(state, 900, (frame) => ({
    right: frame % 200 < 150,
    left: frame % 200 >= 150,
    jump: frame % 47 === 0,
    attack: frame % 17 === 0,
    skills: { bloodSword: frame % 211 === 0, mountainBreaker: frame % 173 === 0 }
  }));

  /*
   * A tripwire, on purpose: the day a slice gives a room or a monster a depth,
   * this fails and gets replaced by a real test of whatever it was given.
   */
  assert.equal(state.player.z, 0, "and staying off the arrow keys keeps him there");
  assert.ok(state.enemies.every((enemy) => enemy.z === 0));
  assert.ok(state.pickups.every((drop) => drop.z === 0));
  assert.ok(state.projectiles.every((shot) => shot.z === 0));
});

test("the player can walk into the screen and back out", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  /* Movement, not combat: the room's monsters would only get in the way. */
  state.enemies = [];

  Core.runFrames(state, 30, { up: true });
  const walked = state.player.z;
  assert.ok(walked > 0, "up walks into the screen");

  Core.runFrames(state, 30, { down: true });
  assert.ok(state.player.z < walked, "and down walks back out");
});

test("the band's two edges stop him", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.enemies = [];

  /* Four seconds a side, against a floor that takes six tenths to cross. */
  Core.runFrames(state, 240, { up: true });
  assert.equal(state.player.z, Core.bandDepth(state.band), "held against the back edge");

  Core.runFrames(state, 240, { down: true });
  assert.equal(state.player.z, 0, "and against the front edge, which is the ground line");
});

test("crossing the whole floor takes about six tenths of a second", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.enemies = [];
  const band = Core.bandDepth(state.band);

  let frames = 0;
  while (state.player.z < band && frames < 600) {
    Core.step(state, { up: true });
    frames += 1;
  }

  /*
   * The feel the depth speed was chosen for: the run covers the band in about
   * the time it takes to cross a third of the screen sideways. It is a screen
   * speed, so this number moving means PHYSICS.depthSpeedRatio moved.
   */
  const seconds = frames * Core.DT;
  assert.ok(seconds > 0.5 && seconds < 0.7, `crossed the band in ${seconds}s`);
});

test("walking in depth never turns him around", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.enemies = [];

  Core.runFrames(state, 30, { right: true });
  assert.equal(state.player.facing, 1);

  Core.runFrames(state, 30, { up: true });
  assert.equal(state.player.facing, 1, "into the screen keeps facing right");
  Core.runFrames(state, 30, { down: true });
  assert.equal(state.player.facing, 1, "and so does back out of it");

  Core.runFrames(state, 30, { left: true });
  assert.equal(state.player.facing, -1, "only left and right turn him");
});

test("a swing roots him in depth the way it roots him sideways", () => {
  const free = Core.createState({ seed: Core.DEFAULT_SEED });
  free.enemies = [];
  Core.runFrames(free, 5, { up: true });
  const walked = free.player.z;
  assert.ok(walked > 60, `five frames of walking should be worth something, got ${walked}`);

  const swinging = Core.createState({ seed: Core.DEFAULT_SEED });
  swinging.enemies = [];
  swinging.player.attackTimer = Core.PLAYER.attackDuration;
  Core.runFrames(swinging, 5, { up: true });

  assert.ok(
    swinging.player.z < walked / 4,
    `a swing let him walk ${swinging.player.z} of the ${walked} he would have walked`
  );
});

test("a room with a shallower floor stops him sooner", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const room = Core.ROOMS[Core.ALTERNATE_ROOM_INDEX];
  const was = room.band;
  try {
    room.band = { backY: 380 };
    /*
     * Two rooms, not one: emptying the last room of a run is a victory, and a
     * won run stops stepping. The second entry is only there to stop the first
     * from being last.
     */
    state.layout = [Core.ALTERNATE_ROOM_INDEX, Core.ALTERNATE_ROOM_INDEX];
    Core.startRoom(state, 0);
    state.enemies = [];

    Core.runFrames(state, 240, { up: true });

    assert.equal(state.player.z, Core.bandDepth({ backY: 380 }));
    assert.ok(
      state.player.z < Core.bandDepth(Core.BAND),
      "which is short of where the default floor would have let him stand"
    );
  } finally {
    if (was === undefined) delete room.band;
    else room.band = was;
  }
});

/*
 * The other half of the anchor: where the arena keeps the ground a move opened.
 * `lastRoomState` is the fixture for "a state where nothing happens to me" - the
 * room is already marked cleared and has no monsters, so no hit cuts the cast
 * short and no clearing of the last room ends the run mid-test.
 */
test("a rift keeps its depth when the arena takes it over at the cast's end", () => {
  const state = lastRoomState();
  state.player.mp = state.player.maxMp;
  state.player.z = 300;

  Core.step(state, { skills: { mountainRift: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.mountainRift.duration * Core.FPS) + 2, {});

  const field = state.fields[0];
  assert.ok(field, "the end of the cast hands the ground to the arena");
  assert.equal(field.z, 300, "and the spot it remembers has a depth");
});

test("a wave's ring lies on the row its caster is standing on", () => {
  const state = lastRoomState();
  state.player.mp = state.player.maxMp;
  state.player.z = 180;

  Core.step(state, { skills: { mountainBreaker: true } });
  Core.runFrames(state, Math.ceil(0.78 * Core.FPS), {});

  const wave = state.effects.find((effect) => effect.kind === "shockwave");
  assert.ok(wave, "the wave is still pushed");
  assert.equal(wave.z, 180, "and it is a circle on his own row of the floor");
});

test("a monster's floor marks carry the monster's own depth", () => {
  const state = lastRoomState();
  /* A caster, because a plain swing telegraphs nothing: only the aimed, charged,
     spun, slammed and lunged attacks put a mark on the floor. */
  const caster = Core.createEnemy(state, "caster", state.player.x + 220, 250);
  state.enemies = [caster];

  let mark = null;
  for (let frame = 0; frame < 60 * 5 && !mark; frame += 1) {
    Core.step(state, {});
    mark = state.effects.find((effect) => effect.kind === "telegraph");
  }

  assert.ok(mark, "the caster aims before it fires");
  assert.equal(mark.z, 250, "and the ground it is about to scorch is the ground under it");
});

test("the depth constant, the lift and the band cannot drift apart", () => {
  /*
   * One constant with two uses: how far a step of z draws up the screen, and
   * how flat the floor lies under a circle. A second copy of it is the mistake
   * this pair exists to catch - a radial skill's hit disc and the ellipse drawn
   * for it have to be the same shape (see core.js's note on DEPTH).
   */
  assert.equal(Core.DEPTH.scale, 0.22);
  assert.equal(Core.depthLift(1), Core.DEPTH.scale);
  assert.equal(Core.depthLift(0), 0);
  assert.equal(Core.depthLift(undefined), 0, "a body with no depth is on the front edge");

  /*
   * The band's far edge is what you see, so its depth has to land on it. The
   * trip out is a divide by the constant and the trip back a multiply by it, so
   * it comes home a ten-billionth of a pixel off (120.00000000000001): exact to
   * floating point is the strongest thing a round trip through 0.22 can be, and
   * anything that actually drifts fails this by a mile.
   */
  const band = Core.BAND;
  const backEdge = Core.ARENA.groundY - band.backY;
  assert.ok(Math.abs(Core.depthLift(Core.bandDepth(band)) - backEdge) < 1e-9);
  assert.ok(band.backY < Core.ARENA.groundY, "the band runs back from the ground line");
  assert.ok(band.backY > 0, "and stays inside the frame");

  /* A deeper band is one two things can stand further apart on. */
  assert.ok(Core.bandDepth({ backY: 360 }) < Core.bandDepth({ backY: 310 }));
});

test("a room can bring its own floor, and gets the default without one", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.layout = [Core.ALTERNATE_ROOM_INDEX];
  Core.startRoom(state, 0);
  assert.equal(state.band, Core.BAND, "a room with no floor of its own gets the default one");

  const room = Core.ROOMS[Core.ALTERNATE_ROOM_INDEX];
  const was = room.band;
  try {
    room.band = { backY: 350 };
    Core.startRoom(state, 0);
    assert.equal(state.band.backY, 350, "a room's own floor is the one it fights on");
    assert.ok(
      Core.bandDepth(state.band) < Core.bandDepth(Core.BAND),
      "and a floor that stops higher up is a shallower one"
    );
  } finally {
    if (was === undefined) delete room.band;
    else room.band = was;
  }
});

test("a room can place a monster at a depth", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  assert.equal(Core.createEnemy(state, "grunt", 500).z, 0, "without one it stands on the line");
  assert.equal(Core.createEnemy(state, "grunt", 500, 240).z, 240);
});

test("a shot flies on the floor its caster stands on", () => {
  const state = lastRoomState();
  state.player.x = 500;
  const caster = Core.createEnemy(state, "caster", 200, 260);
  state.enemies = [caster];

  let shot = null;
  for (let frame = 0; frame < 60 * 5 && !shot; frame += 1) {
    Core.step(state, {});
    shot = state.projectiles[0] || null;
  }

  assert.ok(shot, "the caster should have fired");
  assert.equal(shot.z, 260);
});

test("a drop lands on the floor the body fell on", () => {
  const state = lastRoomState();
  const brute = Core.createEnemy(state, "brute", state.player.x + 60, 300);
  state.enemies = [brute];

  Core.damageEnemy(state, brute, brute.maxHp + 1, 0, brute.x, {});

  const drop = state.pickups.find((pickup) => pickup.kind === "heal_orb");
  assert.ok(drop, "a brute always pays out");
  assert.equal(drop.z, 300);
});

/*
 * "Every z is zero" is the invariant, but a world where every z is zero cannot
 * show that depth is wired up correctly - a site that never applies the lift
 * looks perfect until the first slice gives something a depth. So this drives
 * the same frame at two depths and reads the numbers back off the draw calls.
 */
test("everything placed on the floor comes up the screen by exactly the lift", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const player = state.player;
  state.enemies = [];
  state.effects = [];
  state.pickups = [];
  state.projectiles = [];

  const call = (calls, name, test) => calls.find((entry) => entry[0] === name && test(entry));

  const flat = renderCalls(state);
  player.z = 100;
  const deep = renderCalls(state);
  player.z = 0;

  const lift = Core.depthLift(100);
  assert.ok(lift > 0, "a hundred deep is a real distance");

  /* His shadow is pinned to the floor, and the floor moved, not just the body. */
  const shadow = (calls) =>
    call(calls, "ellipse", (c) => c[1] === player.x && c[3] === player.width * 0.75)[2];
  assert.equal(shadow(flat), Core.ARENA.groundY + 3);
  assert.equal(shadow(deep), Core.ARENA.groundY + 3 - lift);

  /* And the body itself, which is what the feet are attached to. */
  const body = (calls) => call(calls, "translate", (c) => c[1] === player.x)[2];
  assert.equal(body(flat), Core.ARENA.groundY);
  assert.equal(body(deep), Core.ARENA.groundY - lift);

  /* A monster, through its own shadow and its own body. */
  const brute = Core.createEnemy(state, "brute", 500);
  state.enemies = [brute];
  const enemyFlat = renderCalls(state);
  brute.z = 80;
  const enemyDeep = renderCalls(state);

  const enemyShadow = (calls) =>
    call(calls, "ellipse", (c) => c[1] === brute.x && c[3] === brute.width * 0.62)[2];
  const enemyBody = (calls) => call(calls, "translate", (c) => c[1] === brute.x)[2];
  assert.equal(enemyBody(enemyFlat), Core.ARENA.groundY);
  assert.equal(enemyBody(enemyDeep), Core.ARENA.groundY - Core.depthLift(80));
  assert.equal(enemyShadow(enemyDeep), Core.ARENA.groundY - Core.depthLift(80) + 3);

  /* And a slab, which is not a body at all: no `y`, just a patch of floor. */
  state.enemies = [];
  state.hazards = [{ x: 300, z: 0, radius: 60, phase: 0, stage: "dormant" }];
  const slabFlat = renderCalls(state);
  state.hazards[0].z = 120;
  const slabDeep = renderCalls(state);
  const slab = (calls) => call(calls, "translate", (c) => c[1] === 300)[2];
  assert.equal(slab(slabFlat), Core.ARENA.groundY, "a slab with no depth lies on the ground line");
  assert.equal(slab(slabDeep), Core.ARENA.groundY - Core.depthLift(120));
});

test("defeating enemies grants XP and levels the player up", () => {
  const state = lastRoomState();
  const first = Core.createEnemy(state, "brute", state.player.x + 60);
  const second = Core.createEnemy(state, "brute", state.player.x + 120);
  state.enemies = [first, second];
  const levelBefore = state.player.level;

  Core.damageEnemy(state, first, 9999, 0, state.player.x);
  Core.damageEnemy(state, second, 9999, 0, state.player.x);

  assert.equal(state.player.level, levelBefore + 1);
  assert.ok(state.player.attackBonus > 0);
  assert.ok(state.player.maxHp > Core.PLAYER.maxHp);
  assert.ok(state.player.xpToNext > Core.PROGRESSION.baseXpToNext);
  assert.ok(state.player.xp < state.player.xpToNext);
});

test("level up heals the player and raises combo damage", () => {
  const state = lastRoomState();
  state.player.hp = 40;
  const maxHpBefore = state.player.maxHp;

  Core.grantXp(state, Core.PROGRESSION.baseXpToNext);

  assert.equal(state.player.level, 2);
  assert.equal(state.player.maxHp, maxHpBefore + Core.PROGRESSION.maxHpPerLevel);
  assert.equal(state.player.hp, 40 + Core.PROGRESSION.healOnLevelUp);

  const enemy = Core.createEnemy(state, "brute", state.player.x + 50);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];
  const hpBefore = enemy.hp;

  Core.step(state, { attack: true });
  Core.runFrames(state, ATTACK_HIT_FRAMES, {});

  assert.equal(hpBefore - enemy.hp, Core.PLAYER.comboDamage[0] + state.player.attackBonus);
});

test("bosses always drop a heal orb and picking it up restores health", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 60);
  state.enemies = [boss];
  state.player.hp = 30;

  Core.damageEnemy(state, boss, 9999, 0, state.player.x);
  assert.equal(state.pickups.length, 1);
  assert.equal(state.pickups[0].value, Core.DROPS.bossHeal);
  const hpAfterKill = state.player.hp;

  const drop = state.pickups[0];
  drop.x = state.player.x;
  Core.step(state, {});
  Core.runFrames(state, 45, {});

  assert.equal(state.pickups.length, 0);
  assert.equal(state.player.hp, hpAfterKill + Core.DROPS.bossHeal);
});

test("dropped orbs expire instead of accumulating forever", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 700);
  state.enemies = [boss];

  Core.damageEnemy(state, boss, 9999, 0, state.player.x);
  assert.equal(state.pickups.length, 1);

  Core.runFrames(state, Math.ceil(Core.DROPS.lifetimeSeconds * Core.FPS) + 5, {});

  assert.equal(state.pickups.length, 0);
});

test("casters keep their firing range and telegraph a shot", () => {
  const state = lastRoomState();
  const caster = Core.createEnemy(state, "caster", state.player.x + 60);
  state.enemies = [caster];
  const startGap = caster.x - state.player.x;

  Core.runFrames(state, 30, {});
  assert.ok(caster.x - state.player.x > startGap, "caster should retreat while too close");

  let aimed = false;
  for (let frame = 0; frame < 60 * 5 && state.stats.damageTaken === 0; frame += 1) {
    Core.step(state, {});
    if (state.effects.some((effect) => effect.kind === "telegraph")) aimed = true;
  }

  assert.ok(aimed, "ranged attacks must telegraph before they fire");
  assert.equal(state.stats.damageTaken, Core.ENEMY_TYPES.caster.damage);
  assert.ok(
    Math.abs(caster.x - state.player.x) >= Core.ENEMY_TYPES.caster.keepRange - 20,
    "caster should settle outside its keep range"
  );
});

test("enemy projectiles expire after their fixed travel budget", () => {
  const state = lastRoomState();
  state.player.x = 500;
  const caster = Core.createEnemy(state, "caster", 200);
  state.enemies = [caster];

  const shot = Core.spawnProjectile(state, caster);
  assert.equal(state.projectiles.length, 1);
  state.player.x = Core.ARENA.leftWall + state.player.width / 2;

  for (let frame = 0; frame < 300 && state.projectiles.length > 0; frame += 1) {
    Core.updateProjectiles(state, Core.DT);
  }

  assert.equal(state.projectiles.length, 0);
  assert.ok(shot.traveled >= shot.maxDistance, `traveled=${shot.traveled}`);
  assert.equal(state.stats.damageTaken, 0);
});

test("chargers telegraph, dash at charge speed, then recover", () => {
  const state = lastRoomState();
  const charger = Core.createEnemy(state, "charger", state.player.x + 120);
  state.enemies = [charger];

  let telegraphed = false;
  let topSpeed = 0;
  let cooldownAfterDash = null;
  for (let frame = 0; frame < 60 * 6 && cooldownAfterDash === null; frame += 1) {
    Core.step(state, {});
    if (state.effects.some((effect) => effect.kind === "telegraph")) telegraphed = true;
    topSpeed = Math.max(topSpeed, Math.abs(charger.vx));
    if (charger.attackKind === "charge" && charger.attackRecovered) {
      cooldownAfterDash = charger.attackCooldown;
    }
  }

  assert.ok(telegraphed, "charges must telegraph before the dash");
  assert.ok(topSpeed >= Core.ENEMY_TYPES.charger.chargeSpeed * 0.8, `topSpeed=${topSpeed}`);
  assert.ok(cooldownAfterDash !== null && cooldownAfterDash > 0, "charge needs a recovery cooldown");
  assert.equal(state.stats.damageTaken, Core.ENEMY_TYPES.charger.damage);
});

test("the boss slam hits a grounded player and misses a jumping one", () => {
  const grounded = lastRoomState();
  const groundedBoss = Core.createEnemy(grounded, "boss", grounded.player.x + 90);
  groundedBoss.attackRange = 0;
  grounded.enemies = [groundedBoss];

  let telegraphed = false;
  for (let frame = 0; frame < 60 * 6 && grounded.stats.damageTaken === 0; frame += 1) {
    Core.step(grounded, {});
    if (grounded.effects.some((effect) => effect.kind === "telegraph" && effect.text === "SLAM")) {
      telegraphed = true;
    }
  }

  assert.ok(telegraphed, "slam must telegraph before it lands");
  assert.equal(grounded.stats.damageTaken, Core.ENEMY_TYPES.boss.slam.damage);

  const airborne = lastRoomState();
  const airborneBoss = Core.createEnemy(airborne, "boss", airborne.player.x + 90);
  airborneBoss.attackRange = 0;
  airborne.enemies = [airborneBoss];

  let slamResolved = false;
  for (let frame = 0; frame < 60 * 8 && !slamResolved; frame += 1) {
    const elapsed = airborneBoss.attackDuration - airborneBoss.attackTimer;
    const slamming = airborneBoss.attackKind === "slam" && airborneBoss.attackTimer > 0;
    const timeToImpact = airborneBoss.slam.windup - elapsed;
    const jumpNow =
      slamming && airborne.player.onGround && timeToImpact <= 0.3 && timeToImpact > 0;
    Core.step(airborne, jumpNow ? { jump: true } : {});
    if (airborneBoss.attackKind === "slam" && airborneBoss.attackTimer === 0) slamResolved = true;
  }

  assert.ok(slamResolved, "the slam should resolve within the window");
  assert.equal(airborne.stats.damageTaken, 0);
});

test("projectile combat stays deterministic for a fixed seed and input pattern", () => {
  const pattern = (frame) => ({ right: frame % 100 < 20, attack: frame % 23 === 0 });
  /* Pick the room from this seed's run: the layout decides what is in slot 1. */
  const casterRoom = roomIndexWithCaster(5);
  assert.notEqual(casterRoom, -1, "seed 5 should run a room with a caster");
  const a = Core.createState({ seed: 5, roomIndex: casterRoom });
  const b = Core.createState({ seed: 5, roomIndex: casterRoom });

  Core.runFrames(a, 60 * 20, pattern);
  Core.runFrames(b, 60 * 20, pattern);

  const snapshot = (state) => ({
    enemies: state.enemies.map((enemy) => [
      enemy.type,
      Number(enemy.x.toFixed(4)),
      enemy.hp,
      enemy.attackKind,
      Number(enemy.attackTimer.toFixed(4))
    ]),
    projectiles: state.projectiles.map((shot) => [
      Number(shot.x.toFixed(4)),
      Number(shot.y.toFixed(4)),
      shot.damage
    ]),
    damageTaken: state.stats.damageTaken,
    playerHp: state.player.hp
  });

  assert.deepEqual(snapshot(a), snapshot(b));
  assert.ok(a.nextProjectileId > 1, "the caster should have fired at least one shot");
});

test("the same seed still yields identical progression and drops", () => {
  const a = Core.createState({ seed: 99 });
  const b = Core.createState({ seed: 99 });
  const pattern = (frame) => ({ right: frame % 40 < 30, attack: frame % 9 === 0 });

  Core.runFrames(a, 400, pattern);
  Core.runFrames(b, 400, pattern);

  assert.equal(a.player.level, b.player.level);
  assert.equal(a.player.xp, b.player.xp);
  assert.equal(a.pickups.length, b.pickups.length);
  assert.deepEqual(
    a.pickups.map((drop) => [Number(drop.x.toFixed(4)), drop.value]),
    b.pickups.map((drop) => [Number(drop.x.toFixed(4)), drop.value])
  );
});

/**
 * Policy that plays the way a person would: respect each telegraph, stay out of the
 * dash lane and the slam ring, jump over aimed bolts, close in on recovery frames, and
 * spend MP on the AoE skill. Used to prove the dungeon is beatable.
 */
function kitingBot(state) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  /*
   * Clearing a room opens the reward chooser. Taking a card is the same call the
   * key handler makes, so the policy "presses a key" rather than steering around
   * it: a run that skips its reward is not the behaviour under test.
   */
  if (state.upgradeChoice) {
    const pick = preferredUpgrade(state.upgradeChoice.options);
    if (pick) Core.chooseUpgrade(state, pick);
    return { left: false, right: false, jump: false, attack: false, skills: {} };
  }
  /* A cracked slab is a telegraphed threat: step off it before it drops. */
  const slab = (state.hazards || []).find(
    (hazard) =>
      hazard.stage &&
      hazard.stage !== "dormant" &&
      Math.abs(hazard.x - player.x) <= hazard.radius + 12
  );
  if (slab && player.y >= Core.ARENA.groundY - 26) {
    const away = slab.x >= player.x ? "left" : "right";
    const atWall =
      away === "left"
        ? player.x <= Core.ARENA.leftWall + player.width
        : player.x >= Core.ARENA.rightWall - player.width;
    return {
      left: atWall ? away !== "left" : away === "left",
      right: atWall ? away !== "right" : away === "right",
      jump: false,
      attack: false,
      skills: {}
    };
  }
  /* And it should not walk back onto one while it is still breaking. */
  const activeSlabAt = (x) =>
    (state.hazards || []).some(
      (hazard) =>
        hazard.stage &&
        hazard.stage !== "dormant" &&
        Math.abs(hazard.x - x) <= hazard.radius + 12
    );
  const input = { left: false, right: false, jump: false, attack: false, skills: {} };
  Core.SKILL_ORDER.forEach((skillId) => {
    input.skills[skillId] = false;
  });
  if (alive.length === 0) {
    input.right = true;
    return input;
  }

  const inbound = state.projectiles.find((shot) => {
    const closing = shot.vx > 0 ? shot.x <= player.x : shot.x >= player.x;
    return closing && Math.abs(shot.x - player.x) < 200;
  });
  if (inbound && player.onGround) {
    input.jump = true;
    return input;
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
  const activeUntil = target.attackKind === "charge" ? target.chargeTo : target.attackWindup;
  const spinWindow =
    target.attackKind === "spin" && target.spinDash
      ? target.spinDash.windup + target.spinDash.duration
      : activeUntil;
  const threatened = target.attackTimer > 0 && elapsed <= spinWindow + 0.05;

  if (threatened) {
    /*
     * A spinning sweep outruns a retreat once it is on top of you, so the read
     * is to back off through the wind-up and jump the sweep itself.
     */
    if (target.attackKind === "spin" && target.spinDash) {
      const closing = delta > 0 ? "left" : "right";
      if (distance < threatRange + 45) {
        if (player.onGround && elapsed >= target.spinDash.windup - 0.25) {
          input.jump = true;
        } else {
          input[closing] = true;
        }
      }
      return input;
    }
    if (distance < threatRange + 45) {
      const away = delta > 0 ? "left" : "right";
      const atLeftWall = player.x <= Core.ARENA.leftWall + player.width;
      const atRightWall = player.x >= Core.ARENA.rightWall - player.width;
      const cornered = (away === "left" && atLeftWall) || (away === "right" && atRightWall);
      if (!cornered) {
        input[away] = true;
        return input;
      }
      /* Cornered: fighting back beats eating the whole wind-up for free. */
    }
    return input;
  }
  if (distance > 60) {
    const direction = delta > 0 ? "right" : "left";
    const ahead = player.x + (direction === "right" ? 60 : -60);
    if (!activeSlabAt(ahead)) {
      input[direction] = true;
    } else if (distance <= Core.PLAYER.attackReach) {
      /* Out of reach of the mob and blocked by a breaking slab: hold ground. */
      input.attack = true;
    }
    return input;
  }
  /* Attacks only reach where the Slayer looks, so turn around first. */
  const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
  if (!facingTarget) {
    if (delta > 0) input.right = true;
    else input.left = true;
    return input;
  }
  input.attack = true;
  /* Skills root the player, so only cast when the target cannot punish the animation. */
  const castable = Core.SKILL_ORDER.filter((skillId) => {
    const skill = Core.SKILLS[skillId];
    return (
      player.mp >= skill.mp &&
      player.skillCooldowns[skillId] <= 0 &&
      distance <= skill.reach &&
      target.attackCooldown > skill.duration + 0.3
    );
  });
  if (castable.length > 0) {
    const best = castable.reduce((top, skillId) =>
      Core.SKILLS[skillId].damage > Core.SKILLS[top].damage ? skillId : top
    );
    input.skills[best] = true;
  }
  return input;
}

test("a timing-aware policy can clear the whole dungeon without losing health", () => {
  const results = [1, 7, 42, 20260915].map((seed) => {
    const state = Core.createState({ seed });
    for (let frame = 0; frame < 60 * 240 && !state.victory && !state.defeat; frame += 1) {
      Core.step(state, kitingBot(state));
    }
    return state;
  });

  results.forEach((state) => {
    assert.equal(state.victory, true, `seed run ended defeated=${state.defeat} room=${state.roomIndex + 1}`);
    assert.equal(state.defeat, false);
    /* Each seed draws its own rooms, so the kill count has to come from its run. */
    assert.equal(state.stats.kills, enemiesInRun(state.seed));
    assert.ok(state.stats.damageTaken <= 12, `damageTaken=${state.stats.damageTaken}`);
    assert.ok(state.time < 90, `clear took ${state.time}s`);
  });
});

test("renderer draws a live frame and both end-state overlays without throwing", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });

  const live = renderCalls(state, { paused: false, showHelp: true });
  assert.ok(live.length > 40, `expected the renderer to draw, calls=${live.length}`);

  state.victory = true;
  const won = renderCalls(state);
  state.victory = false;
  state.defeat = true;
  const lost = renderCalls(state);

  const texts = live.concat(won, lost).filter((call) => call[0] === "fillText").map((call) => call[1]);
  assert.ok(texts.includes("DUNGEON CLEARED"));
  assert.ok(texts.includes("YOU DIED"));
});

test("the shipped sprite sheet matches the frame grid the renderer expects", () => {
  const file = path.join(__dirname, "..", "assets", "slayer.png");
  const buffer = fs.readFileSync(file);

  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), Render.SPRITE.frameW * Render.SPRITE.cols);
  assert.equal(buffer.readUInt32BE(20), Render.SPRITE.frameH * 7);
  assert.deepEqual(Render.SPRITE.rows, {
    idle: 0,
    run: 1,
    attack: 2,
    skill: 3,
    extras: 4,
    clips: 5,
    clips2: 6
  });
  /*
   * Long actions need room: the sheet carries twelve columns so a full DNF run
   * cycle fits and every played frame has to exist inside the row. The stand is
   * the client's four "still" frames (176-179), so it only asks for four.
   */
  Object.keys(Render.SPRITE.frames).forEach((row) => {
    const count = Render.SPRITE.frames[row];
    assert.ok(count > 0 && count <= Render.SPRITE.cols, `${row} frames must fit the row`);
  });
  assert.ok(Render.SPRITE.frames.idle >= 4, "the idle loop needs real frames");
  assert.ok(Render.SPRITE.frames.run >= 8, "the run cycle needs real frames");
  assert.ok(Render.SPRITE.frames.attack >= 4, "a cut needs wind-up, slash and recovery");

  const icons = fs.readFileSync(path.join(__dirname, "..", "assets", "skills.png"));
  assert.equal(icons.readUInt32BE(16), 32 * Core.SKILL_ORDER.length, "one icon per skill");
  assert.equal(icons.readUInt32BE(20), 32 * 2, "a skill row and a buff-badge row");
});

test("every frame the renderer plays fits inside its sprite cell", () => {
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  assert.equal(sheet.width, Render.SPRITE.frameW * Render.SPRITE.cols);
  assert.equal(sheet.height, Render.SPRITE.frameH * 7);

  /*
   * The bake composites each DNF frame into a fixed cell, and compositing is
   * silent about art that runs past the edge: the katana and the white slash
   * arcs were coming out sliced mid-blade because the cell only fitted the
   * body. Every frame the renderer can reach therefore has to sit strictly
   * inside its cell, with the widest frame - a swing that reaches past the
   * feet - sized for on purpose.
   */
  const plays = [];
  ["idle", "run", "attack", "skill", "extras"].forEach((name) => {
    const row = Render.SPRITE.rows[name];
    if (name === "skill") {
      for (let col = 0; col < Render.SPRITE.frames.skill; col += 1) plays.push([row, col, `${name} ${col}`]);
      return;
    }
    if (name === "extras") {
      Object.entries(Render.SPRITE.extras).forEach(([key, col]) => plays.push([row, col, `extras ${key}`]));
      return;
    }
    for (let col = 0; col < Render.SPRITE.frames[name]; col += 1) plays.push([row, col, `${name} ${col}`]);
  });

  /* Every per-move clip the renderer can draw must fit its cell too. */
  Object.entries(Render.SPRITE.skillClips).forEach(([skillId, clip]) => {
    for (let step = 0; step < clip.frames; step += 1) {
      plays.push([clip.row, clip.first + step, `${skillId} clip ${step}`]);
    }
  });

  plays.forEach(([row, col, label]) => {
    const box = cellAlphaBox(sheet, col, row);
    assert.ok(box, `${label} has art to draw`);
    assert.ok(
      box.x0 > 0 && box.y0 > 0 && box.x1 < Render.SPRITE.frameW - 1 && box.y1 < Render.SPRITE.frameH - 1,
      `${label} must not touch its cell border: ${JSON.stringify(box)}`
    );
  });
});

test("one press plays one stage of the normal attack, and attack speed sets the pace", () => {
  const stages = Core.ATTACK_STAGES;
  assert.equal(Core.PLAYER.maxCombo, stages.length, "the chain is as long as the animation");
  assert.equal(
    Render.SPRITE.frames.attack,
    27,
    "the attack row carries the three cuts and the air slash"
  );

  /*
   * One press is one of the client's own actions. The sheet repeats itself (its
   * hits two and three are the same backward sweep, pixel for pixel, and its
   * overhead sweep comes round three times), so the row is baked from three
   * *different* swings: the opening down cut, the backward low sweep and the
   * overhead sweep. Every stage carries its own wind-up and settle with the slash
   * on its fourth frame. The owner cut the fourth press (the overhead down slash).
   */
  const actions = [
    { first: 0, frames: 7 },
    { first: 7, frames: 9 },
    { first: 16, frames: 7 }
  ];
  stages.forEach((stage, index) => {
    assert.deepEqual(
      { first: stage.first, frames: stage.frames },
      actions[index],
      `stage ${index} must be the client's own action`
    );
    assert.equal(stage.damage, Core.PLAYER.comboDamage[index]);
  });
  assert.equal(stages.length, actions.length, "one stage per cut");

  /* No press may cross out of its own swing. */
  for (let press = 0; press < stages.length; press += 1) {
    const stage = stages[press];
    for (let step = 0; step <= 40; step += 1) {
      const column = Render.attackColumn(step / 40, press);
      assert.ok(
        column >= stage.first && column < stage.first + stage.frames,
        `press ${press} stays inside its action (column ${column})`
      );
    }
  }

  /* A press shows its own action, from that action's first frame to its last. */
  assert.equal(Render.attackColumn(0, 0), 0, "the first press starts on the cut's wind-up");
  assert.equal(Render.attackColumn(1, 0), stages[0].first + stages[0].frames - 1);
  assert.equal(Render.attackColumn(0, 1), stages[1].first, "the second press is its own swing");
  assert.equal(
    Render.attackColumn(1, stages.length - 1),
    22,
    "the last press ends on the last real attack frame"
  );
  assert.equal(
    Render.attackColumn(0, stages.length),
    0,
    "the chain wraps back to the first cut"
  );

  /*
   * 崩山击 has to read as the client's own preview, which opens on the lift: 187
   * (the blade still down and forward, the pose he is already standing in),
   * 194/203 (both hands up, the blade over the head - the client's own 举剑),
   * 204-205 (the coil at the top of the hop), the smash's crescent (206-207)
   * landing with the hit, and the low lunge it ends in (208-209) through the
   * recovery. The client's own hop frames (127-132) are out: they carry no sword
   * motion, so putting them in front of the smash gave the move two wind-ups
   * (owner: 「举剑过头」is part of the jump).
   */
  const smash = Render.SPRITE.skillClips.mountainBreaker;
  assert.equal(smash.row, Render.SPRITE.rows.clips);
  assert.equal(smash.first, 0, "崩山击 opens the first clip row");
  assert.equal(smash.frames, 9, "the lift, the coil, the crescent and the lunge");
  const beats = smash.beats.map((beat) => beat.frames);
  assert.deepEqual(beats, [3, 2, 2, 2], "each act is paced on its own");
  assert.ok(
    smash.beats[0].until <= Core.SKILLS.mountainBreaker.activeFrom / Core.SKILLS.mountainBreaker.duration,
    "and the blade is up before the hit, not on it"
  );
  assert.equal(
    beats.reduce((total, count) => total + count, 0),
    smash.frames,
    "every baked frame belongs to a beat"
  );

  /*
   * 大蹦 is its own move: the owner saw it playing 崩山击's smash, and then saw it
   * leap without the 举剑 in front of it (「崩山裂地斩是先举剑，参考 123-124」).
   * Its action is the training-room reference's (10_崩山裂地斩), read frame by
   * frame: the raise he holds, the leap with the blade still overhead, the prone
   * landing with the sword driven into the floor, and the stand he is back on
   * while the second eruption burns.
   */
  const rift = Render.SPRITE.skillClips.mountainRift;
  assert.ok(rift, "大蹦 gets a body animation of its own");
  assert.equal(rift.frames, 7, "the raise, the leap, the landing and the stand");
  assert.deepEqual(
    rift.beats.map((beat) => beat.frames),
    [2, 2, 2, 1],
    "each act is paced separately"
  );
  /*
   * The raise is the frames the owner pointed at (123-124). The leap is 204-205,
   * the blade over his head with his legs tucked; the landing is 208-209, the
   * prone settle with the sword in the floor; the last beat is 132, a plain
   * stand, because the next thing the reference does is get up.
   *
   * 127-132 must not be borrowed as 崩山击's hop - that clip *is* the plain hop,
   * and its opening frames are the aimless lean the owner sent back - and 133
   * must not be in there at all: it is a leaning balance on one raised leg with
   * the blade up in front, and holding it for the rest of the cast left him in
   * his own fire doing a pose the move never reaches (owner: 「放完技能多了一个不
   * 正确的动作，歪着身体举剑那个动作」).
   */
  const riftBake = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_swordman.py"),
    "utf8"
  );
  assert.match(
    riftBake,
    /"mountainRift", \[123, 124, 204, 205, 208, 209, 132\]\)/,
    "the clip opens on the owner's 举剑 frames (123-124)"
  );
  assert.ok(
    !/"mountainRift"[^\n]*133/.test(riftBake),
    "and it does not end on 133, the balance the owner read as a wrong pose"
  );
  assert.ok(
    !/mountainRift[^\n]*range\(127/.test(riftBake),
    "and it does not borrow 崩山击's hop clip (127-132) as a block"
  );
  /*
   * The leap is the reference's own: its #33-50 put the caster 269 ref px up at
   * the apex and 126 ref px forward over 18 frames of a 30fps clip, which is
   * 101px and 47px here. It needs no bespoke gravity either - -666 under the
   * world's 2200 peaks at 101px and touches down 0.605s later - and the window
   * is invulnerable without blinking, the way 崩山击's is, because the reference
   * holds one solid gold outline through the airborne frames.
   */
  assert.equal(
    Core.SKILLS.mountainRift.leapUp,
    -666,
    "the reference's arc needs no gravity of its own"
  );
  assert.equal(Core.SKILLS.mountainRift.leapGravity, undefined, "so it brings none");
  assert.ok(
    Math.abs((2 * 666) / Core.PHYSICS.gravity - 0.605) < 0.03,
    "and lands 0.605s after it leaves the floor, the reference's own airtime"
  );
  assert.ok(Core.SKILLS.mountainRift.leapInvuln > 0, "the hop is invulnerable");
  assert.ok(
    Core.SKILLS.mountainRift.leapFrom >= rift.beats[1].from,
    "and it fires as the body clip leaves the raise, not on the press"
  );
  assert.equal(
    Core.SKILLS.mountainBreaker.leap > 0,
    true,
    "while 崩山击 keeps the hop it is built around"
  );
  assert.ok(
    rift.beats[0].until < Core.SKILLS.mountainRift.activeFrom / Core.SKILLS.mountainRift.duration,
    "the raise happens before the hit, not on it"
  );
  assert.equal(
    rift.beats[2].from,
    Core.SKILLS.mountainRift.activeFrom / Core.SKILLS.mountainRift.duration,
    "he is on the floor, in the landing pose, on the beat the rift opens"
  );
  assert.equal(
    rift.beats.reduce((total, beat) => total + beat.frames, 0),
    rift.frames,
    "every frame of the clip belongs to a beat, so the drive is what it holds"
  );
  assert.notEqual(rift.row, smash.row, "and it is not the row 崩山击 uses");
  const riftSkill = Core.SKILLS.mountainRift;
  const smashSkill = Core.SKILLS.mountainBreaker;
  assert.ok(
    riftSkill.reach > smashSkill.reach,
    `大蹦 reaches further than 崩山击 (${riftSkill.reach} vs ${smashSkill.reach})`
  );
  assert.ok(
    riftSkill.shockwave.reach > smashSkill.shockwave.reach,
    `and its rift is wider (${riftSkill.shockwave.reach} vs ${smashSkill.shockwave.reach})`
  );
  /*
   * The gash is one-sided and as big as the reference's: 720x285 ref px of
   * cracked floor, 265x107 here, with its middle 80-106px in front of the caster.
   * So the move casts the forward box it already had the reach for rather than
   * the circle it used to draw around itself - a circle would punish the half of
   * the floor the move never touches - and the engine's ellipse is dropped along
   * with it, because the reference has a gash and no ring at all.
   */
  assert.equal(riftSkill.radius, 0, "the rift is a box, not a circle round him");
  assert.ok(
    riftSkill.reach >= 240 && riftSkill.reach <= 250,
    `and it reaches the reference's 245px front (${riftSkill.reach})`
  );
  assert.equal(
    riftSkill.shockwave.reach,
    250,
    "the wave stops where the fire does, not a third of the arena away"
  );
  assert.equal(riftSkill.shockwave.arc, false, "and draws no ring");
  assert.equal(riftSkill.shockwave.arcOffset, undefined, "so it has no arc to place");
  assert.equal(
    smashSkill.shockwave.arcOffset,
    undefined,
    "崩山击 keeps the arc a little ahead of him, where its wave travels"
  );
  assert.ok(
    riftSkill.heightPad > smashSkill.heightPad,
    "the ultimate also hits higher, so a juggled target is caught"
  );

  /*
   * The up-slash skill gets its own body animation from the same region the
   * owner pointed at (body frames 40-50), baked into the skill row after the
   * generic skill frames.
   */
  const upSlash = Render.SPRITE.skillClips.upSlash;
  assert.equal(upSlash.first, Render.SPRITE.frames.skill, "it starts after the generic frames");
  assert.equal(
    upSlash.frames,
    9,
    "上挑 is the client's own 42-50 on the sm_body0048 sheet, i.e. body frames 43-51 here"
  );

  /*
   * The baked row must hold one swoosh per press, on the swing frame, and the
   * four presses must not be the same art twice: the sheet's own hits two and
   * three are pixel-identical, and playing them in sheet order is what gave the
   * owner "two backward flicks, then two upward ones".
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  const fw = Render.SPRITE.frameW;
  const fh = Render.SPRITE.frameH;
  const row = Render.SPRITE.rows.attack;
  const trail = (col) => {
    let count = 0;
    for (let y = 0; y < fh; y += 1) {
      for (let x = 0; x < fw; x += 1) {
        const offset = ((row * fh + y) * sheet.width + col * fw + x) * 4;
        if (sheet.pixels[offset + 3] < 40) continue;
        const r = sheet.pixels[offset];
        const g = sheet.pixels[offset + 1];
        const b = sheet.pixels[offset + 2];
        const high = Math.max(r, g, b);
        if (high > 150 && high - Math.min(r, g, b) < 40) count += 1;
      }
    }
    return count;
  };
  const trails = [];
  for (let col = 0; col < Render.SPRITE.frames.attack; col += 1) trails.push(trail(col));

  /* Every stage swings on its fourth frame - that is where the blade lands. */
  const strikeColumns = Core.ATTACK_STAGES.map((stage, press) => {
    let best = -1;
    let bestValue = -1;
    for (let col = stage.first; col < stage.first + stage.frames; col += 1) {
      if (trails[col] > bestValue) {
        bestValue = trails[col];
        best = col;
      }
    }
    assert.equal(
      best,
      stage.first + 3,
      `press ${press} swings on its fourth frame (loudest column ${best})`
    );
    return best;
  });

  /* And no two presses may show the same art: that is the "same move twice". */
  const cellDiff = (a, b) => {
    let changed = 0;
    for (let y = 0; y < fh; y += 1) {
      for (let x = 0; x < fw; x += 1) {
        const one = ((row * fh + y) * sheet.width + a * fw + x) * 4;
        const two = ((row * fh + y) * sheet.width + b * fw + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          if (sheet.pixels[one + channel] !== sheet.pixels[two + channel]) {
            changed += 1;
            break;
          }
        }
      }
    }
    return changed;
  };
  for (let a = 0; a < strikeColumns.length; a += 1) {
    for (let b = a + 1; b < strikeColumns.length; b += 1) {
      assert.ok(
        cellDiff(strikeColumns[a], strikeColumns[b]) > 1000,
        `presses ${a + 1} and ${b + 1} must not play the same frame (${cellDiff(
          strikeColumns[a],
          strikeColumns[b]
        )} pixels differ)`
      );
    }
  }

  Core.ATTACK_STAGES.forEach((stage, press) => {
    assert.ok(
      trails[stage.first] < trails[stage.first + 3],
      `press ${press} winds up before it swings (start ${trails[stage.first]} vs swing ${trails[stage.first + 3]})`
    );
  });

  /* Attack speed divides the swing, and with it the wait before the next press. */
  const state = lastRoomState();
  assert.equal(Core.swingDuration(state.player), Core.PLAYER.attackDuration);
  Core.step(state, { attack: true });
  assert.equal(state.player.comboIndex, 0, "a fresh chain opens on stage one");
  const slowCooldown = state.player.attackCooldown;

  const fast = lastRoomState();
  fast.player.attackSpeed = 2;
  const enemy = Core.createEnemy(fast, "brute", fast.player.x + 48);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  fast.enemies = [enemy];
  Core.step(fast, { attack: true });
  assert.equal(fast.player.attackDuration, Core.PLAYER.attackDuration / 2);
  assert.ok(
    fast.player.attackCooldown < slowCooldown,
    "a faster Slayer can start the next swing sooner"
  );
  Core.runFrames(fast, 8, {});
  assert.equal(
    enemy.maxHp - enemy.hp,
    Core.PLAYER.comboDamage[0],
    "the hit window scales with the swing, so a fast cut still connects"
  );

  /*
   * And the reverse: at half speed the cut has to wait for its own arc instead
   * of landing on the old absolute 0.05s. Frame 5 is 0.083s, inside the old
   * window and before the scaled one (0.23 x 0.44s = 0.10s).
   */
  const half = lastRoomState();
  half.player.attackSpeed = 0.5;
  const laggingEnemy = Core.createEnemy(half, "brute", half.player.x + 48);
  laggingEnemy.hp = 500;
  laggingEnemy.maxHp = 500;
  laggingEnemy.speed = 0;
  half.enemies = [laggingEnemy];
  Core.step(half, { attack: true });
  Core.runFrames(half, 5, {});
  assert.equal(laggingEnemy.hp, laggingEnemy.maxHp, "a slow swing has not connected yet");
  Core.runFrames(half, 15, {});
  assert.equal(
    laggingEnemy.maxHp - laggingEnemy.hp,
    Core.PLAYER.comboDamage[0],
    "it connects when the slow swing reaches the arc"
  );
});

test("the swordman bake caches each source layer, so a new katana actually ships", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_swordman.py"),
    "utf8"
  );
  /*
   * One weapon pack holds hundreds of katana, and the layer key is just
   * "weapon_b" whoever is picked. Caching on that key kept serving the previous
   * sword after WEAPON_INDEX changed, so the sheet looked right but the client
   * art never moved. The cache name has to come from the source entry.
   */
  assert.ok(
    source.includes('entry.rsplit("/", 1)[-1]'),
    "the .img cache must be keyed by the pack entry it came from"
  );
  assert.ok(
    !source.includes('CACHE / (key + ".img")'),
    "caching on the layer key alone would re-use the previous weapon"
  );
  assert.match(
    source,
    /WEAPON_INDEX = "\d+"/,
    "the bake must pin the weapon it draws"
  );
  assert.ok(
    source.includes("f\"{WEAPON}/katana{WEAPON_INDEX}b.img\"") &&
      source.includes("f\"{WEAPON}/katana{WEAPON_INDEX}c.img\""),
    "both halves of the picked katana must come from WEAPON_INDEX"
  );
});

test("银光落刃 is what Z does in the air, and only in the air", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 40);
  enemy.hp = 400;
  enemy.maxHp = 400;
  enemy.speed = 0;
  state.enemies = [enemy];
  state.player.mp = state.player.maxMp;

  /* On the ground the same key is still 上挑. */
  Core.step(state, { skills: { upSlash: true } });
  assert.equal(state.player.skillId, "upSlash", "on the ground Z is the up-slash");
  Core.runFrames(state, Math.ceil(Core.SKILLS.upSlash.duration * Core.FPS) + 4, {});

  /* In the air it turns into the dive. */
  state.player.onGround = false;
  state.player.y = Core.ARENA.groundY - 130;
  state.player.vy = -80;
  state.player.skillCooldowns.silverFall = 0;
  state.player.mp = state.player.maxMp;
  const takeOffX = state.player.x;
  Core.step(state, { skills: { upSlash: true } });
  assert.equal(state.player.skillId, "silverFall", "in the air Z is 银光落刃");
  assert.ok(
    state.player.vy >= Core.SKILLS.silverFall.dive - 1,
    `the dive drives him down (vy ${state.player.vy})`
  );
  const hpBefore = enemy.hp;
  Core.runFrames(state, 45, {});
  assert.equal(state.player.onGround, true, "and it puts him on the floor");
  assert.ok(
    state.player.x > takeOffX + 20,
    `the dive lands ahead of the take-off (${Math.round(takeOffX)} -> ${Math.round(state.player.x)})`
  );
  assert.ok(enemy.hp < hpBefore, "the blade lands on whatever is under it");
  assert.ok(
    state.effects.some((effect) => effect.kind === "shockwave") ||
      state.effects.some((effect) => effect.kind === "banner"),
    "the landing is answered by the floor"
  );
});

test("银光落刃 only sometimes floors what it lands on", () => {
  /*
   * DNF's own skill has a chance of knocking the target down rather than a rule,
   * so the roll has to come off the RNG: over a spread of seeds some land on
   * their feet and some do not.
   */
  let floored = 0;
  const seeds = 40;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const state = Core.createState({ seed: seed });
    const enemy = Core.createEnemy(state, "brute", state.player.x + 40);
    enemy.hp = 400;
    enemy.maxHp = 400;
    enemy.speed = 0;
    state.enemies = [enemy];
    state.player.onGround = false;
    state.player.y = Core.ARENA.groundY - 120;
    state.player.vy = -40;
    state.player.mp = state.player.maxMp;
    Core.step(state, { skills: { upSlash: true } });
    Core.runFrames(state, 45, {});
    if (enemy.knockdown > 0) floored += 1;
  }
  assert.ok(floored > 0, `some dives floor the target (${floored}/${seeds})`);
  assert.ok(floored < seeds, `and some do not - it is a chance (${floored}/${seeds})`);
});

test("a leaping skill keeps its own animation while it is in the air", () => {
  const state = Core.createState({ seed: 5 });
  const player = state.player;
  player.onGround = false;
  player.vy = -260;
  player.skillId = "mountainBreaker";
  player.skillTimer = Core.SKILLS.mountainBreaker.duration * 0.5;

  const clip = Render.SPRITE.skillClips.mountainBreaker;
  const leaping = Render.playerFrame(state, player);
  assert.equal(
    leaping.row,
    clip.row,
    "崩山击's leap must keep playing its own action, not the generic jump art"
  );
  assert.ok(leaping.col >= clip.first && leaping.col < clip.first + clip.frames);

  /* The same mid-leap frame for 大蹦. */
  player.skillId = "mountainRift";
  player.skillTimer = Core.SKILLS.mountainRift.duration * 0.5;
  const rift = Render.SPRITE.skillClips.mountainRift;
  const leapRift = Render.playerFrame(state, player);
  assert.equal(leapRift.row, rift.row, "大蹦 keeps its action in the air too");

  /* A move with no clip of its own still falls back to the jump/fall frames. */
  player.skillId = "bloodSword";
  player.skillTimer = Core.SKILLS.bloodSword.duration * 0.5;
  assert.equal(
    Render.playerFrame(state, player).row,
    Render.SPRITE.rows.extras,
    "a move without a clip keeps the generic air pose"
  );

  /*
   * 银光落刃 has a clip of its own, so the dive plays the client's blade instead
   * of the hop art even though it happens entirely in the air.
   */
  player.skillId = "silverFall";
  player.skillTimer = Core.SKILLS.silverFall.duration * 0.5;
  const dive = Render.SPRITE.skillClips.silverFall;
  const diving = Render.playerFrame(state, player);
  assert.equal(diving.row, dive.row, "the dive keeps its own action");
  assert.ok(diving.col >= dive.first && diving.col < dive.first + dive.frames);

  /*
   * And a press of X in the air is the client's jump attack: the attack row's
   * tail, not the three ground cuts and not the hop frames.
   */
  player.skillId = null;
  player.skillTimer = 0;
  player.attackTimer = player.attackDuration * 0.5;
  const air = Render.SPRITE.airAttack;
  const slash = Render.playerFrame(state, player);
  assert.equal(slash.row, air.row, "the air slash lives on the attack row");
  assert.ok(
    slash.col >= air.first && slash.col < air.first + air.frames,
    `the air press plays the jump attack (column ${slash.col})`
  );
  player.attackTimer = 0;
  assert.equal(
    Render.playerFrame(state, player).row,
    Render.SPRITE.jump.row,
    "a hop with no attack plays the client's jump animation"
  );
});

test("the dive draws the blade from its own effect row", () => {
  const state = Core.createState({ seed: 5 });
  const sprites = {
    slayer: { width: 8736, height: 1232 },
    skills: { width: 352, height: 64 },
    effects: { width: 3456, height: 1664 }
  };
  const diveRow = Render.EFFECT.diveRow;
  const drawnFrom = (calls) =>
    calls.filter(
      (call) =>
        call[0] === "drawImage" &&
        call[1] === sprites.effects &&
        call[3] === diveRow * Render.EFFECT.cell
    ).length;

  state.player.skillId = "silverFall";
  state.player.skillTimer = Core.SKILLS.silverFall.duration * 0.6;
  const diving = [];
  Render.render(recordingContext(diving), state, { sprites });
  assert.ok(drawnFrom(diving) >= 1, "银光落刃 draws its arc from the dive row");

  /* 上挑 has its own row; nothing else may reach into the dive's. */
  state.player.skillId = "upSlash";
  state.player.skillTimer = Core.SKILLS.upSlash.duration * 0.5;
  const cutting = [];
  Render.render(recordingContext(cutting), state, { sprites });
  assert.equal(drawnFrom(cutting), 0, "and only the dive draws it");
});

test("大蹦 draws both halves off its own sheet", () => {
  const state = Core.createState({ seed: 5 });
  const sprites = {
    slayer: { width: 8736, height: 1232 },
    skills: { width: 352, height: 64 },
    effects: { width: 5760, height: 1792 },
    rift: { width: 17280, height: 768 }
  };
  const drawnFrom = (calls, sheet, row, cell) =>
    calls.filter(
      (call) => call[0] === "drawImage" && call[1] === sheet && call[3] === row * cell
    ).length;
  const rift = Render.EFFECT.riftRows.mountainRift;
  const cell = Render.EFFECT.riftCell;
  state.player.skillId = "mountainRift";
  state.player.skillTimer = Core.SKILLS.mountainRift.duration * 0.5;
  const casting = [];
  Render.render(recordingContext(casting), state, { sprites });
  assert.equal(
    drawnFrom(casting, sprites.rift, rift.back, cell),
    1,
    "the broken floor behind him is read off the big sheet"
  );
  assert.equal(
    drawnFrom(casting, sprites.rift, rift.front, cell),
    1,
    "and so is the fire drawn over him"
  );
  assert.equal(
    drawnFrom(casting, sprites.effects, Core.SKILL_ORDER.indexOf("mountainRift"), Render.EFFECT.cell),
    0,
    "and nothing is read off the small sheet for this move, where the art would be mush"
  );
  /* Without the big sheet there is nothing to draw, rather than a cell of mush. */
  const missing = [];
  Render.render(recordingContext(missing), state, {
    sprites: { ...sprites, rift: null }
  });
  assert.equal(drawnFrom(missing, sprites.effects, 10, Render.EFFECT.cell), 0, "and it fails empty");
});

/*
 * What 大蹦 opens belongs to the floor, not to the caster's animation.
 *
 * The reference ends with him back on his feet at 3.97s and the cracks still
 * glowing, and the move in the client is one a hit can cut short - either way
 * the fire he already opened keeps burning where he opened it. Ours used to be
 * drawn off `player.skillTimer`, so the whole rift vanished on the frame the
 * cast ended (or on the frame a hit landed), which is also why it followed him
 * around. These two pin the handover.
 *
 * The floor has two axes now, so "where he opened it" is three numbers plus a
 * facing, and the depth is the one the handover used to drop: it kept x, y and
 * facing, and a rift opened four Slayer-heights into the screen went on burning
 * at the front edge of the room the moment the arena took it over.
 */
test("the rift is handed to the floor, not the caster", () => {
  const state = Core.createState({ seed: 5 });
  const sprites = {
    slayer: { width: 8736, height: 1232 },
    skills: { width: 352, height: 64 },
    effects: { width: 5760, height: 1792 },
    rift: { width: 17280, height: 768 }
  };
  const rift = Render.EFFECT.riftRows.mountainRift;
  const cell = Render.EFFECT.riftCell;
  const drawnAt = (calls) => {
    /* The transform in force when the rift's own rows are drawn. */
    const out = [];
    calls.forEach((call, index) => {
      if (call[0] !== "drawImage" || call[1] !== sprites.rift) return;
      if (call[3] !== rift.back * cell && call[3] !== rift.front * cell) return;
      for (let back = index; back >= 0; back -= 1) {
        if (calls[back][0] === "translate") {
          out.push({ x: calls[back][1], y: calls[back][2] });
          break;
        }
      }
    });
    return out;
  };
  state.player.x = 120;
  state.player.y = Core.ARENA.groundY;
  state.player.z = 300;
  state.player.facing = 1;
  state.player.skillId = "mountainRift";
  state.player.skillTimer = Core.SKILLS.mountainRift.duration * 0.55;
  /* A hit lands mid-cast and cuts the move short. */
  Core.damagePlayer(state, 5, state.player.x + 40);
  assert.equal(state.player.skillId, null, "the hit ends the cast");
  assert.equal(state.fields.length, 1, "and the rift is handed over");
  const field = state.fields[0];
  assert.equal(field.x, 120, "at the spot the blade opened it");
  assert.equal(field.z, 300, "including how far into the screen that spot was");
  /*
   * He is knocked away from it, and the ground stays where it was: the rift is
   * no longer read off him at all. He is moved on both floor axes, so a rift
   * that quietly fell back to the ground line fails on the same assertion.
   */
  state.player.x = 400;
  state.player.z = 60;
  const calls = [];
  Render.render(recordingContext(calls), state, { sprites });
  const rows = drawnAt(calls);
  assert.ok(rows.length >= 2, "the rift is still drawn after the cast is over");
  assert.deepEqual(
    [...new Set(rows.map((row) => row.x))],
    [120],
    "and it is drawn where it was opened, not where he has been knocked to"
  );
  assert.deepEqual(
    [...new Set(rows.map((row) => row.y))],
    [Core.ARENA.groundY - Core.depthLift(300) + Render.EFFECT.draw.mountainRift.dy],
    "on the row of the floor it was opened on, not the one he has walked to"
  );
  /*
   * It runs the rest of the move's own tail, then the linger - both counted
   * from the frame it was interrupted on, not from the cast's end.
   */
  const tail = field.span - field.clock;
  assert.ok(tail > 0 && field.life === field.span + Core.SKILLS.mountainRift.field.linger,
    "the field has the move's tail to play and then its linger");
  for (let left = tail; left > 0; left -= 1 / 60) Core.step(state, {}, 1 / 60);
  assert.equal(state.fields.length, 1, "it is still burning when the cast would have ended");
  for (let left = Core.SKILLS.mountainRift.field.linger * 0.5; left > 0; left -= 1 / 60) {
    Core.step(state, {}, 1 / 60);
  }
  assert.equal(state.fields.length, 1, "and halfway through the linger");
  const half = Core.fieldProgress(state.fields[0]);
  assert.ok(half.fade < 1, `into its fade by then (fade ${half.fade.toFixed(2)})`);
  for (let left = Core.SKILLS.mountainRift.field.linger; left > 0; left -= 1 / 60) {
    Core.step(state, {}, 1 / 60);
  }
  assert.equal(state.fields.length, 0, "and then it is out");
  const gone = [];
  Render.render(recordingContext(gone), state, { sprites });
  assert.equal(drawnAt(gone).length, 0, "with nothing of it left on the floor");
});

test("大蹦's fire is still burning when he is back on his feet", () => {
  const state = lastRoomState();
  const spec = Core.SKILLS.mountainRift;
  Core.step(state, { skills: { mountainRift: true } });
  assert.equal(state.player.skillId, "mountainRift", "the move starts");
  for (let left = spec.duration; left > 0; left -= 1 / 60) {
    Core.step(state, {}, 1 / 60);
  }
  assert.equal(state.player.skillId, null, "and the cast is over");
  assert.equal(state.fields.length, 1, "but the ground it opened is not");
  const field = state.fields[0];
  const at = Core.fieldProgress(field);
  assert.equal(at.progress, spec.field.from + (1 - spec.field.from) * Math.min(1, field.clock / field.span),
    "and it is drawn on the move's own last frames");
  assert.ok(at.fade > 0 && at.fade <= 1, `while it dies down (fade ${at.fade.toFixed(2)})`);
  /* He is free to walk away from it, and it does not follow him. */
  const left = field.x;
  Core.step(state, { right: true }, 0.5);
  assert.ok(state.player.x > left, "he walks off");
  assert.equal(state.fields[0].x, left, "and the rift stays put");
});

test("the rift's draw size is the window the bake declares", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_effects.py"),
    "utf8"
  );
  /*
   * 大蹦's two halves are baked to *one declared window*, and the renderer turns
   * that window into `size`: the cell holds the window fitted into it, and the
   * cell is then drawn at `size`, so one client pixel of the pack lands on
   * `fit * size / cell` of a screen pixel. Which makes `size` a hand-off between
   * two files - the bake knows the window, the renderer knows the number, and the
   * bake can only *print* what the window comes to (see its "draw size for the
   * rift rows" line). Nothing read the printed number back, so a retuned window
   * would have shipped the move at the wrong zoom with every test green - which
   * is the class of mistake the 「糊」 was: art drawn at a size its own guide
   * never agreed to. This is that hand-off, pinned from both ends.
   */
  const declared = Number(/RIFT_CLIENT_PX = ([\d.]+)/.exec(source)[1]);
  const windows = [
    ...source.matchAll(/"window":\s*\((-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+)\)/g)
  ].map((match) => match.slice(1).map(Number));
  assert.equal(windows.length, 2, "both halves of the move declare a window");
  assert.deepEqual(
    windows[0],
    windows[1],
    "and it is the same window for both, or one draw size cannot place them"
  );
  const [left, top, right, bottom] = windows[0];
  const spanW = right - left;
  const spanH = bottom - top;
  const cell = Render.EFFECT.riftCell;
  const draw = Render.EFFECT.draw.mountainRift;
  /* The rift rows are baked with no margin - see `margin=0` in the bake's call. */
  const fit = Math.min(cell / spanW, cell / spanH);
  const landed = (fit * draw.size) / cell;
  assert.ok(
    Math.abs(landed - declared) < 0.005,
    `the window is drawn at ${landed.toFixed(3)} of a screen pixel per client px, not ${declared}`
  );
  /*
   * And the anchor lands on the caster's feet, which is the other half of the
   * same hand-off: the bake pins the caster's ground point to GROUND_LINE of the
   * cell, and a cell drawn centred at the origin puts that point `(GROUND_LINE -
   * 0.5) * size` below it. So the row's dy is not a taste - it is that line.
   */
  const groundLine = Number(/GROUND_LINE = ([\d.]+)/.exec(source)[1]);
  assert.ok(
    Math.abs(draw.dy + (groundLine - 0.5) * draw.size) <= 1,
    `dy ${draw.dy} does not put the pack's ground line on his feet ` +
      `(${(-(groundLine - 0.5) * draw.size).toFixed(1)})`
  );
});

test("the shipped DNF effect sheet matches the renderer grid", () => {
  const buffer = fs.readFileSync(path.join(__dirname, "..", "assets", "effects.png"));
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), Render.EFFECT.cell * Render.EFFECT.maxFrames);
  assert.equal(
    buffer.readUInt32BE(20),
    Render.EFFECT.cell * (Core.SKILL_ORDER.length + 3),
    "one baked effect row per skill, plus the blood-orb, dive and 大蹦-fire rows"
  );
  /*
   * Each row carries its own frame count: the picked moves ship their whole
   * sequence, everything else the four-frame sample. Read the sheet back and
   * count the drawn columns per row, so a stale atlas cannot pass.
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  Core.SKILL_ORDER.forEach((skillId, row) => {
    /* 大蹦's rows are not on this sheet - see the rift sheet below. */
    if (Render.EFFECT.riftRows[skillId]) return;
    const declared = Render.EFFECT.rowFrames[skillId];
    assert.ok(declared > 0, `${skillId} needs a row length`);
    const drawn = [];
    for (let column = 0; column < Render.EFFECT.maxFrames; column += 1) {
      if (cellAlphaBox(sheet, column, row, Render.EFFECT.cell, Render.EFFECT.cell)) drawn.push(column);
    }
    /*
     * A row is one timeline over one cast, and it is declared as long as the
     * cast is. Every row on this sheet fills it from column 0, and no row may
     * have a hole: a gap would draw the wrong frame of the shape at that moment.
     */
    assert.ok(
      drawn.every((column, index) => column === drawn[0] + index),
      `${skillId} frames must be packed with no hole in the row`
    );
    assert.equal(
      drawn[0] + drawn.length,
      declared,
      `${skillId} should bake ${declared} frame(s), found ${drawn.length}`
    );
    assert.equal(drawn[0], 0, `${skillId} frames must be packed from column 0`);
  });
  assert.equal(Render.EFFECT.rowFrames.mountainBreaker, 6, "崩山击 ships its six-frame ground slash");
  assert.equal(Render.EFFECT.rowFrames.crossSlash, 11, "十字斩 ships its eleven-frame cross");
  /*
   * 大蹦 is the one move whose art is drawn far bigger than a cell can hold, so
   * its two rows - the rift behind the Slayer and the fire over him - are baked
   * to a sheet of their own at a cell of their own. Both are baked to one
   * declared window, so the renderer needs one draw size for the pair and the
   * fire cannot drift off the rift it comes out of.
   */
  const rift = Render.EFFECT.riftRows.mountainRift;
  assert.ok(rift, "大蹦 declares where its two rows live");
  assert.equal(rift.back, 0, "the rift is the first row of its sheet");
  assert.equal(rift.front, 1, "and the fire the second");
  assert.ok(Render.EFFECT.riftCell > Render.EFFECT.cell, "at a cell a cell-sized grid cannot hold");
  const riftBuffer = fs.readFileSync(path.join(__dirname, "..", "assets", "rift.png"));
  assert.equal(riftBuffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(
    riftBuffer.readUInt32BE(16),
    Render.EFFECT.riftCell * Render.EFFECT.maxFrames,
    "the rift sheet is as long as the cast too"
  );
  assert.equal(riftBuffer.readUInt32BE(20), Render.EFFECT.riftCell * 2, "and holds both halves");
  const riftSheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "rift.png"));
  const columnsDrawn = (row) => {
    const drawn = [];
    for (let column = 0; column < Render.EFFECT.maxFrames; column += 1) {
      if (cellAlphaBox(riftSheet, column, row, Render.EFFECT.riftCell, Render.EFFECT.riftCell)) {
        drawn.push(column);
      }
    }
    return drawn;
  };
  const riftFrames = columnsDrawn(rift.back);
  assert.equal(
    Render.EFFECT.rowFrames.mountainRift,
    Render.EFFECT.maxFrames,
    "the rift row is as long as the cast"
  );
  /*
   * 大蹦's own row opens on the landing: its first act is 举剑, and the blade
   * that carries it lives on the fire row, drawn over him. So this row's head is
   * empty and its acts fill the rest - but with no hole, or the wrong frame of
   * the ground would be drawn at that moment.
   */
  assert.ok(riftFrames[0] > 0, "the rift row opens on the landing, not on the press");
  assert.ok(
    riftFrames.every((column, index) => column === riftFrames[0] + index),
    "and runs to the end with no hole in it"
  );
  assert.equal(riftFrames[riftFrames.length - 1], Render.EFFECT.maxFrames - 1, "to the last column");
  /*
   * The fire row opens on the blade the raise carries (the owner: 「应该是血剑」)
   * and runs to the end of the cast; the stage windows are what pin that the
   * fire itself does not start until he drives the blade in, in 大蹦 plays in
   * stages below.
   */
  assert.equal(
    Render.EFFECT.frontFrames.mountainRift,
    Render.EFFECT.maxFrames,
    "the fire row runs on the rift's timeline, or the two halves drift apart"
  );
  const fireFrames = columnsDrawn(rift.front);
  assert.equal(fireFrames[0], 0, "and it opens on the blade the raise carries");
  assert.equal(
    fireFrames[fireFrames.length - 1],
    Render.EFFECT.maxFrames - 1,
    "and it runs to the end of the cast, the way the client's rift keeps burning"
  );
  /*
   * 血之狂暴 splits the owner's pick in two: the dual-blade energy stays on the
   * skill's own row and the orbs that fly into the Slayer get a row of their
   * own, so a drop of blood does not arrive carrying a slash arc.
   */
  assert.equal(Render.EFFECT.orbRow, Core.SKILL_ORDER.length, "the orb row follows the skill rows");
  const orbs = [];
  for (let column = 0; column < Render.EFFECT.maxFrames; column += 1) {
    if (cellAlphaBox(sheet, column, Render.EFFECT.orbRow, Render.EFFECT.cell, Render.EFFECT.cell)) {
      orbs.push(column);
    }
  }
  assert.equal(orbs.length, Render.EFFECT.orbFrames, "the orb row carries its own frames");
  Core.SKILL_ORDER.forEach((skillId) => {
    assert.ok(Render.EFFECT.draw[skillId], `${skillId} needs an effect mapping`);
  });
});

/*
 * 怒气爆发 and 崩山裂地斩 were the only two rows built by stacking a whole pack,
 * and a pack ships every shape once per colour board: the plain entry plus
 * "(tn)" and "(18)" copies of the same art at the same coordinates. Pulling all
 * three in drew every ring and pillar two or three times over in different
 * colours, which is what the owner saw as "特效不对".
 */
test("the effect bake draws each shape in exactly one colour board", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_effects.py"),
    "utf8"
  );
  const start = source.indexOf("PICKS = {");
  assert.ok(start > 0, "the bake declares its per-move picks");
  const picks = source.slice(start, source.indexOf("\n}\n", start));
  const blocks = [];
  const key = /^ {4}"(\w+)":\s*\{/gm;
  for (let match = key.exec(picks); match; match = key.exec(picks)) {
    blocks.push({ skill: match[1], from: match.index });
  }
  assert.ok(blocks.length >= Core.SKILL_ORDER.length, "every skill is picked");
  blocks.forEach((block, index) => {
    const text = picks.slice(block.from, index + 1 < blocks.length ? blocks[index + 1].from : picks.length);
    /*
     * Two entries of one pack are only ever stacked by mistake when they are
     * the *same shape*: the packs ship every shape once per colour board, and
     * pulling in "(tn)" and "(18)" of one shape draws it two or three times
     * over. A staged pick names a window per instance, so the same shape may
     * come back later in the move (大蹦 erupts twice, holds its ring while the
     * cracks crawl out of it); what must never happen is the same shape - or
     * the same frames of it - drawn twice at once.
     */
    const stages = [];
    for (const [, entry, middle, from, until] of text.matchAll(
      /"entry":\s*"([^"]+\.img)"([^}]*)"from":\s*([\d.]+),\s*"until":\s*([\d.]+)/g
    )) {
      const range = /"frames":\s*\((\d+),\s*(\d+)\)/.exec(middle);
      const offset = /"offset":\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/.exec(middle);
      stages.push({
        shape: entry.replace(/^\((?:tn|18)\)/, ""),
        from: Number(from),
        until: Number(until),
        first: range ? Number(range[1]) : 0,
        last: range ? Number(range[2]) : Infinity,
        at: offset ? `${offset[1]},${offset[2]}` : "0,0"
      });
    }
    const seen = new Map();
    for (const [, entry] of text.matchAll(/"([^"]+\.img)"/g)) {
      const shape = entry.replace(/^\((?:tn|18)\)/, "");
      if (!seen.has(shape)) seen.set(shape, 1);
      else seen.set(shape, seen.get(shape) + 1);
    }
    for (const [shape, count] of seen) {
      if (count === 1) continue;
      assert.ok(
        stages.some((stage) => stage.shape === shape),
        `${block.skill} stacks ${shape} twice without a window to tell them apart`
      );
    }
    for (let a = 0; a < stages.length; a += 1) {
      for (let b = a + 1; b < stages.length; b += 1) {
        const one = stages[a];
        const two = stages[b];
        if (one.shape !== two.shape) continue;
        const overlap = Math.min(one.until, two.until) - Math.max(one.from, two.from);
        if (overlap <= 0) continue;
        const sameFrames = one.first <= two.last && two.first <= one.last;
        /*
         * The same art at the same time is only a mistake in the same *place*:
         * 大蹦's fire is a ring, so one flame shape is stamped round the rift
         * several times and those copies overlap in time on purpose. What this
         * catches is the pack stacked once per colour board - one shape, one
         * spot, two or three times over.
         */
        if (one.at !== two.at) continue;
        assert.ok(
          !sameFrames,
          `${block.skill} draws ${one.shape} frames ${one.first}-${one.last} over ` +
            `${one.from}-${one.until} and ${two.first}-${two.last} over ${two.from}-${two.until} ` +
            `at the same time, both at ${one.at}`
        );
      }
    }
  });
  /*
   * 怒气爆发 is rooted at the caster: the bake places a declared anchor (the
   * middle of the pack's own ground ring) on the cell's ground line, so the
   * effect no longer floats wherever its bounding box sits. It also bakes from
   * the colour board the client plays - the official BloodBlast preview erupts
   * white-gold out of the ring - while the plain board of the same shapes is
   * blood red.
   */
  const rageBurst = blocks.find((entry) => entry.skill === "rageBurst");
  const rageText = picks.slice(rageBurst.from, picks.indexOf("\n}", rageBurst.from));
  assert.match(rageText, /"anchor":\s*\(\s*-?\d+,\s*-?\d+\s*\)/, "rageBurst needs a ground anchor");
  assert.match(rageText, /"palette":\s*"\(tn\)"/, "rageBurst needs the client's white-gold board");
  /*
   * 崩山击's landing is the client preview's, in three parts: d-end is the
   * orange fire column and the white-blue flash that crosses it, and
   * b_bottom_01 is the red spikes spreading around the impact. The row used to
   * be the spikes alone, which is why the smash landed on a ground tick with no
   * impact.
   *
   * The spikes are the "_n" entry, not the "_d" one: the pack ships the same
   * shape on two boards, "_d" dark red (mean 149,1,0 over its opaque pixels)
   * and "_n" bright red-orange (232,40,0). The clip's spikes measure 229,59,14,
   * so the "_d" copy is what made the landing run maroon (owner: 「技能特效
   * 颜色不对」).
   *
   * And they are a fan, not a floor plate: every wedge points back at one
   * point, about (214, 102) in their own frames, and that is the impact - so
   * that point is what goes on the column's foot. Dropping the fan's *bottom
   * edge* there instead (the older -79, 78) stood the whole fan a body height
   * too high (owner: 「技能特效好像位置有点高」).
   */
  const smash = blocks.find((entry) => entry.skill === "mountainBreaker");
  const smashText = picks.slice(smash.from, picks.indexOf("\n}", smash.from));
  assert.match(smashText, /"d-end\.img"/, "崩山击 lands on the fire column and the flash");
  assert.match(smashText, /"b_bottom_01_n\.img"/, "with the bright spikes around it");
  assert.ok(
    !/"b_bottom_01_d\.img"/.test(smashText),
    "and not the dark board, which is the maroon copy of the same shape"
  );
  assert.match(smashText, /"anchor":\s*\(\s*-?\d+,\s*-?\d+\s*\)/, "rooted on the column's foot");
  assert.match(smashText, /"offset":\s*\(\s*-86,\s*142\s*\)/, "with the fan's own centre on it");
  /*
   * The three parts are staged rather than stacked, and carry their own scales.
   * Measured off the clip (÷2.67) the fan is ~230x107, the column ~150 tall and
   * the flash only ~100 wide; in the pack they arrive at 306, 140 and 169, so
   * the column and the fan are grown and the flash is not. One scale for the
   * lot blew the flash up to twice the clip's when the column was grown.
   */
  assert.match(
    smashText,
    /"entry":\s*"d-end\.img",\s*"frames":\s*\(0,\s*1\),\s*"scale":\s*1\.[0-9]/,
    "and the fire column scaled up off its own base"
  );
  assert.match(
    smashText,
    /"b_bottom_01_n\.img",\s*"scale":\s*1\.[0-9]/,
    "the spike fan grown with it"
  );
  assert.ok(
    !/"entry":\s*"d-end\.img",\s*"frames":\s*\(2,\s*5\)[^}]*"scale"/.test(smashText),
    "and the flash left at the size the pack draws it"
  );
  /*
   * 崩山裂地斩 is the 45-level ultimate's own pack, layer by layer: the blood
   * sword it summons comes down, the ground splits under it and the flames come
   * out of the split, on the "(tn)" board the client's own preview erupts in.
   * The owner signed that set off on assets/dnf_effect_anim/rift-outrage-break.png
   * after two misses - the whole pack stacked at once (every shape drawn once
   * per colour board) and then the base pack's fire pair, which is not this
   * move's art at all - so the layers and the board are both pinned here.
   */
  const rift = blocks.find((entry) => entry.skill === "mountainRift");
  const riftText = picks.slice(rift.from, picks.indexOf("\n}", rift.from));
  assert.match(riftText, /outragebreak_floor\.img/, "and splits the ground under it");
  assert.match(riftText, /"anchor":\s*\(\s*-?\d+,\s*-?\d+\s*\)/, "大蹦 is rooted at his feet");
  assert.ok(
    !/fire-(front|back)\.img/.test(riftText.replace(/^ *#.*$/gm, "")),
    "and not the fire pair the owner rejected"
  );
  /*
   * Its colour is the one row that does not come off a colour board. The pack
   * ships 大蹦's fire as deep blood red (140,2,1) or as orange (255,129,3), and
   * the reference is neither: 10_崩山裂地斩 draws the flame body at (183,25,7)
   * with the lava lines in its floor at (184,70,52). (The client's own preview
   * video is orange - the two disagree, and the reference wins.) So these layers
   * name a `ramp` built from the reference's own numbers instead of a board, and
   * neither the plain nor the orange board is named anywhere in the move.
   */
  assert.ok(
    /"palette":\s*""/.test(riftText) && !/"\(tn\)/.test(riftText),
    "大蹦 no longer draws off a colour board"
  );
  assert.match(riftText, /"ramp":\s*FLOOR_RAMP/, "its floor ramps to the reference's lava lines");
  const fireText = source.slice(
    source.indexOf('("mountainRiftFire", {'),
    source.indexOf("\n]", source.indexOf('("mountainRiftFire", {'))
  );
  assert.match(fireText, /"ramp":\s*FIRE_RAMP/, "and its fire to the reference's flame");
  assert.ok(
    !/"palette":\s*"\(tn\)"/.test(fireText),
    "with no orange board left on either half of the move"
  );
  assert.equal(
    (fireText.match(/"ramp":\s*FIRE_RAMP/g) || []).length,
    (fireText.match(/"entry":/g) || []).length,
    "every layer of the fire is ramped - the debris, which is plain rock, lives on the ground row"
  );
  /*
   * The fire is the other half of the same pack, and it is drawn over the
   * Slayer: the rift stays behind him on the skill's own row, and the blade the
   * raise carries plus the flames that come out of the split are on a front row
   * baked to the same window. The blade has to be here rather than behind him -
   * on his own row it lands on his feet and his body swallows it.
   */
  const frontStart = source.indexOf("FRONT_ROWS = [");
  assert.ok(frontStart > 0, "the bake declares the rows drawn in front of the Slayer");
  const frontText = source.slice(frontStart, source.indexOf("\n]\n", frontStart));
  assert.match(frontText, /outragebreak_bloodsword_none\.img/, "大蹦 summons the blood sword");
  assert.match(frontText, /outragebreak_bloodsexp_1_none\.img/, "and erupts out of the split");
  assert.match(frontText, /outragebreak_bloodsexp_2_none\.img/, "twice, the way the client does");
  assert.match(frontText, /"match":\s*"mountainRift"/, "on the rift's own window");
});

/*
 * The owner's second look at the client was 「这个技能应该是多个技能特效组合的」:
 * the pack is one move in four acts - the blade comes down, the floor splits
 * under it, the ring glows on and the magma erupts twice - and the row used to
 * stack all eight layers at once, so every act was on screen in the same third
 * of a second. The bake now names a window per act; this pins the reading of
 * the client's own preview (assets/dnf_effect_anim/rift-outrage-break-layers.txt)
 * and the wiring that plays it.
 */
function bakedStages(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} is in the bake`);
  const end = source.indexOf(endMarker, start);
  const text = source.slice(start, end < 0 ? source.length : end);
  const stages = [];
  for (const [, entry, middle, from, until] of text.matchAll(
    /"entry":\s*"([^"]+\.img)"([^}]*)"from":\s*([\d.]+),\s*"until":\s*([\d.]+)/g
  )) {
    const range = /"frames":\s*\((\d+),\s*(\d+)\)/.exec(middle);
    const offset = /"offset":\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/.exec(middle);
    const scale = /"scale":\s*([\d.]+)/.exec(middle);
    stages.push({
      entry,
      from: Number(from),
      until: Number(until),
      first: range ? Number(range[1]) : 0,
      last: range ? Number(range[2]) : Infinity,
      at: offset ? `${offset[1]},${offset[2]}` : "0,0",
      scale: scale ? Number(scale[1]) : 1
    });
  }
  /*
   * Every stage carries a window, and the reader above has to see all of them:
   * a stage written across two lines once slipped past it, which silently
   * halved what this test was checking.
   */
  assert.equal(
    stages.length,
    (text.match(/"entry":/g) || []).length,
    `${startMarker} has a stage the window reader cannot see`
  );
  return stages;
}

test("大蹦 plays in stages, not all at once", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_effects.py"),
    "utf8"
  );
  const back = bakedStages(source, '"mountainRift": {"palette"', "\n}\n");
  const front = bakedStages(source, '("mountainRiftFire", {', "\n]");
  assert.ok(back.length >= 4 && front.length >= 8, "both halves of the move are staged");

  /* Every window is a slice of one row, in order. */
  [...back, ...front].forEach((stage) => {
    assert.ok(stage.from >= 0 && stage.until <= 1, `${stage.entry} stays in the row`);
    assert.ok(stage.until > stage.from, `${stage.entry} needs a window with a length`);
    assert.ok(stage.last >= stage.first, `${stage.entry} needs frames in order`);
  });
  /*
   * And no shape is drawn twice over itself: two stages of one entry that run
   * at the same time have to be two different things. Either they are the same
   * art carrying different frames (the rift's cracks over the ring it holds),
   * or the same art standing in two places (大蹦's rank of pillars, each of
   * which names its own offset). What this catches is the bug that put every
   * shape on screen two or three times over - the whole pack stacked once per
   * colour board, at one spot, at one time.
   */
  [back, front].forEach((row) => {
    for (let a = 0; a < row.length; a += 1) {
      for (let b = a + 1; b < row.length; b += 1) {
        if (row[a].entry !== row[b].entry) continue;
        const overlap = Math.min(row[a].until, row[b].until) - Math.max(row[a].from, row[b].from);
        if (overlap <= 0) continue;
        if (row[a].at !== row[b].at) continue;
        assert.ok(
          row[a].last < row[b].first || row[b].last < row[a].first,
          `${row[a].entry} is drawn over itself at the same time`
        );
      }
    }
  });

  const spec = Core.SKILLS.mountainRift;
  const timing = Render.EFFECT.timing.mountainRift;
  const toCast = (at) => (timing.from + at * (timing.to - timing.from)) * spec.duration;

  /*
   * The row starts on the first frame of the cast, because its first act is
   * 举剑: 崩山裂地斩是先举剑, and the owner points at the client's own body frames
   * 123-124 for the raise - so the blood sword is on screen while he raises it
   * (「应该是血剑」) rather than appearing out of the sky on the landing. It lives
   * on the front row, drawn over him, because on his own row his body swallows
   * it. Its first window has to hand over to the strike on activeFrom - the beat
   * the slam lands on - so the blade goes into the ground with the hit.
   */
  const sword = front.filter((stage) => stage.entry.includes("bloodsword"));
  assert.equal(sword.length, 2, "the blade is drawn in front of him, in two windows");
  assert.ok(
    !back.some((stage) => stage.entry.includes("bloodsword")),
    "and not on the row behind him, where his own body covers it"
  );
  assert.ok(
    toCast(sword[0].from) < 0.02,
    `the blood sword is up with the raise (${toCast(sword[0].from).toFixed(2)}s in)`
  );
  const strike = sword[sword.length - 1];
  assert.ok(
    Math.abs(toCast(sword[0].until) - spec.activeFrom) < 0.08,
    `the blade is still coming down as he drives it in (${toCast(sword[0].until).toFixed(2)}s vs ` +
      `${spec.activeFrom}s)`
  );
  assert.ok(
    Math.abs(toCast(strike.from) - spec.activeFrom) < 0.08,
    `and the strike into the ground opens just before the hit (${toCast(strike.from).toFixed(2)}s vs ` +
      `${spec.activeFrom}s)`
  );
  const swordFrames = sword.map((stage) => stage.first);
  assert.deepEqual(swordFrames, [0, 13], "the gathering runs up to the strike frames");
  /*
   * And the body is on the landing by the time the blade goes in: the third beat
   * of the clip - the prone settle - starts exactly on activeFrom, and the leap
   * is the beat before it.
   */
  const clip = Render.SPRITE.skillClips.mountainRift;
  assert.equal(
    clip.beats[2].from,
    spec.activeFrom / spec.duration,
    "the body is on the landing on the beat the rift opens"
  );
  /*
   * What he holds while the rift burns is that landing (the reference keeps him
   * prone for the whole lull, its #51-88), and what he is left in at the end is
   * the plain stand of the last beat - the reference gets up while the second
   * eruption is still burning.
   */
  const held = lastRoomState();
  held.player.skillId = "mountainRift";
  held.player.skillTimer = spec.duration * 0.55;
  const proneStep = Render.playerFrame(held, held.player).col - clip.first;
  assert.ok(
    proneStep >= 4 && proneStep <= 5,
    `the pose held under the rift is the landing (${clip.first + proneStep})`
  );
  held.player.skillTimer = spec.duration * 0.1;
  assert.equal(
    Render.playerFrame(held, held.player).col,
    clip.first + clip.frames - 1,
    "and the pose he is left in at the end is the last frame of the clip"
  );

  /* Three hits: the sword, the rift grinding, then the second eruption. */
  assert.equal(spec.hits, 3, "the rift ticks, it is not one blow");
  assert.equal(spec.shockwaveHit, 0, "the ground wave belongs to the sword, not the last tick");
  const hitSpan = (spec.activeTo - spec.activeFrom) / spec.hits;
  /*
   * 大蹦 erupts along its gash, in a rank, not in a ring round the caster. That
   * is the one thing the training-room reference overturns: the owner asked for
   * the circle in the sixth pass (「不是一排柱子，应该是一个圈」) off the client's
   * own 100-frame preview, which does erupt all round him - but 10_崩山裂地斩,
   * which is the reference, has every frame of its fire ahead of his feet (660
   * ref px of it, 321 tall for the first wave and 596 for the second) over a
   * one-sided gash, and the client's preview is the 旁证.
   *
   * A place is named in client coordinates: (382 + u, 249), where u is how far
   * in front of the caster it stands and 249 is his own ground line (281) pulled
   * 32px into the gash, which is where the reference's flames stand. The pack's
   * own bottom centres are what an offset is measured from - the bush
   * (bloodsexp_1) is centred on x=419 with its foot at y=324, the spire
   * (bloodsexp_2) on x=474 with its foot at 282 - so a place can be read back out
   * of the numbers in the bake.
   */
  const ANCHOR = { x: 382, y: 281 };
  /*
   * The gash runs *forward* from the caster and recedes, so a thing standing u
   * px in front of him stands on y = 289 + 0.12u. That line is the spine the
   * floor's own ring is on: (382, 281) is the caster's ground point and the
   * bake's anchor, and the floor is placed by that point.
   */
  const GASH_DIP = 0.12;
  const SPINE = (u) => 289 + GASH_DIP * u;
  /* the pack's own bottom centre per shape: where its art meets the floor */
  const SHAPES = {
    bloodsexp_1: { centre: 419, foot: 324 },
    bloodsexp_2: { centre: 474, foot: 282 }
  };
  const shapeOf = (stage) =>
    stage.entry.includes("bloodsexp_1") ? "bloodsexp_1" : "bloodsexp_2";
  /* the two eruptions, not the light the pack calls bloodsexp_glow */
  const isFlame = (stage) =>
    stage.entry.includes("bloodsexp_1") || stage.entry.includes("bloodsexp_2");
  const placeOf = (stage) => stage.at.split(",").map(Number);
  /* where a stage stands: (u in front of the caster, how far off the gash line) */
  const stands = (stage) => {
    const shape = SHAPES[shapeOf(stage)];
    const [dx, dy] = placeOf(stage);
    const u = shape.centre + dx - ANCHOR.x;
    return [u, shape.foot + dy - SPINE(u)];
  };
  const flames = front.filter(isFlame);
  /*
   * The move erupts twice: the landing answers at once (the reference's #54-60)
   * and then the second wave runs the whole length of the gash (#84-115). The
   * split is the lull between them, which the reference spends on its lit
   * cracks alone.
   */
  const first = flames.filter((stage) => stage.from < 0.45);
  const second = flames.filter((stage) => stage.from >= 0.45);
  assert.ok(first.length >= 3, "the landing answers in several places");
  assert.ok(second.length >= 3, "and the second eruption comes up in several places");
  [first, second].forEach((wave) => {
    assert.equal(
      new Set(wave.map((stage) => stage.at)).size,
      wave.length,
      "and no two flames stand in the same spot"
    );
  });
  /*
   * Every flame of the move stands on the gash's own line and inside its length:
   * the reference's rock field runs from his feet forward and is lit end to end,
   * so a flame is not free to sit anywhere else. This is the assertion that
   * would have caught a ring - half of its places are behind the caster, where
   * there is no cracked ground at all.
   */
  const everyFlame = [...back, ...front].filter(isFlame);
  assert.ok(everyFlame.length >= 12, "the gash erupts in many places, in both halves");
  everyFlame.forEach((stage) => {
    const [u, into] = stands(stage);
    /*
     * On the gash's line, but not all *exactly* on it: 大蹦 covers a patch of the
     * floor plane, not a line. Running a ruler along the bottom of the
     * reference's fire finds bases spread over about 0.7 of a Slayer's height of
     * depth - the near ones well below his feet line, the far ones above it -
     * where a rank on one line reads as candles. 34px of client art is half of
     * that band, which is what these stand within.
     */
    assert.ok(
      Math.abs(into) <= 34,
      `${shapeOf(stage)} at ${stage.at} stands within the gash's band (${into}px off its spine)`
    );
    assert.ok(
      u > -60 && u < 470,
      `${shapeOf(stage)} at ${stage.at} stands within the gash, not off it (${u}px forward)`
    );
  });
  const places = everyFlame.map(stands);
  const spansAcross = Math.max(...places.map(([u]) => u)) - Math.min(...places.map(([u]) => u));
  assert.ok(
    spansAcross > 300,
    `the fire runs the length of the gash (${spansAcross}px of client art)`
  );
  /*
   * And the flame that lands on the Slayer himself is drawn *behind* him: the
   * near end of the gash is where his own body is, so a spire there belongs to
   * the row the renderer composites before he is drawn, not the one over him.
   */
  const behind = back.filter(isFlame);
  assert.ok(
    behind.length >= 2,
    "the fires that land on the Slayer are drawn behind him, the rest in front"
  );
  const inFront = front.filter(isFlame);
  assert.equal(
    inFront.length,
    everyFlame.length - behind.length,
    "and every flame is on exactly one of the two rows"
  );
  behind.forEach((stage) => {
    assert.ok(
      stands(stage)[0] < 40,
      `${shapeOf(stage)} at ${stage.at} is one of the near ones, drawn behind him`
    );
  });
  inFront.forEach((stage) => {
    assert.ok(
      stands(stage)[0] > 40,
      `${shapeOf(stage)} at ${stage.at} stands clear of his body`
    );
  });
  /*
   * And the fire is the reference's height, not the preview's, measured in the
   * Slayer's own heights off 10_崩山裂地斩: its landing tops out 1.0-1.13 and
   * settles to 0.70 for the quiet stretch, its second wave 2.22, and the far end
   * of the gash tapers off in embers. The bush is 127px of client art at its
   * tallest and the spire 179, this row draws a client pixel at 0.596 of a
   * screen pixel, and the pack's flame is as wide as it is because it is one
   * shape - so the tongues carry a `stretch` as well, which is a separate pin
   * (see the bake). The scales are what is left after both: 0.80 for the low
   * fire the lull burns, 1.15 for the landing, 1.75 at the top of the second
   * wave, where 179px of art comes out 2.2 Slayers tall.
   */
  assert.ok(
    everyFlame.every((stage) => stage.scale >= 0.75 && stage.scale <= 2.1),
    "every flame is a pillar of its own, neither a candle nor a column off the screen"
  );
  assert.ok(
    Math.max(...second.map((stage) => stage.scale)) >
      Math.max(...first.map((stage) => stage.scale)),
    "and the second eruption is the taller one, the way the reference rises"
  );
  const largest = first.reduce((best, stage) => (stage.scale > best.scale ? stage : best));
  assert.ok(
    largest.from <= Math.min(...first.map((stage) => stage.from)),
    "the tallest flame of the landing erupts first"
  );
  const firstPlaces = first.map(stands).map(([u]) => u);
  assert.ok(
    Math.abs(
      stands(largest)[0] -
        (Math.min(...firstPlaces) + Math.max(...firstPlaces)) / 2
    ) < 90,
    "and it stands in the middle of the gash, where the reference's fire is tallest"
  );
  const thirdHit = spec.activeFrom + 2 * hitSpan;
  const secondOpens = Math.min(...second.map((stage) => toCast(stage.from)));
  const secondCloses = Math.max(...second.map((stage) => toCast(stage.until)));
  assert.ok(
    thirdHit >= secondOpens && thirdHit <= secondCloses,
    `the third hit lands in the second eruption (${thirdHit.toFixed(2)}s vs ` +
      `${secondOpens.toFixed(2)}-${secondCloses.toFixed(2)}s)`
  );
  /*
   * The gap between the waves is not empty, and the floor is not a slideshow:
   * the reference keeps its broken rock field and the lit web running through it
   * under him from the landing to the very end of the cast (its #61-#133, where
   * the web is still glowing after he has stood up), so those frames are on the
   * floor for the whole move, not played once.
   *
   * The web itself is held at full width: playing the pack's f7-f10 across the
   * cast - which is what the bake used to do - showed the first ninth of it
   * through the quiet stretch and only finished it on the cast's last frame,
   * which measured as 0.07 of a Slayer-width of lit ground against the
   * reference's 2.32.
   */
  const floorStages = back.filter((stage) => stage.entry.includes("floor"));
  const web = floorStages.find((stage) => stage.first === 10 && stage.first === stage.last);
  assert.ok(web, "the finished lit web is drawn at all");
  assert.ok(web.from <= 0.4 && web.until >= 0.99, "and held from the split to the end");
  assert.ok(
    floorStages.some((stage) => stage.first === 7 && stage.last > stage.first),
    "and it spreads in the frames right after the landing, rather than crawling"
  );
  const heldFloor = floorStages.filter((stage) => stage.first === stage.last);
  assert.ok(heldFloor.length >= 3, "the floor is built from held frames, not a slideshow");
  assert.ok(
    heldFloor.filter((stage) => stage.from <= 0.4 && stage.until >= 0.99).length >= 2,
    "and more than one of them is held through the whole lull"
  );
  const lull = front.filter(isFlame).filter((stage) => stage.from >= 0.3 && stage.until <= 0.6);
  assert.ok(
    lull.length >= 2,
    `and the rank is still burning through the quiet stretch (${lull.length} flames)`
  );
  assert.ok(
    !front.filter(isFlame).some((stage) => toCast(stage.from) < spec.activeFrom - 0.05),
    "and no flame burns before he drives the blade in"
  );
});

test("the two blood eruptions are their own art, not one effect twice", () => {
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  const cell = Render.EFFECT.cell;
  /*
   * 大蹦's own row is no longer on this sheet - it is drawn far bigger than a
   * cell can hold, so it is baked to assets/rift.png at EFFECT.riftCell. That is
   * still the row this test is about, so read it from where it lives and sample
   * it down to the same grid, or "大蹦 is not 崩山击 again" would be comparing a
   * blank row and passing without looking at anything.
   */
  const riftSheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "rift.png"));
  const cellPixels = (row, column, sheetIn = sheet, cellIn = cell) => {
    const out = [];
    const step = cellIn / cell;
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const at =
          ((row * cellIn + Math.floor(y * step)) * sheetIn.width +
            column * cellIn +
            Math.floor(x * step)) *
          4;
        out.push(...sheetIn.pixels.subarray(at, at + 4));
      }
    }
    return out;
  };
  const difference = (a, b) => {
    let ink = 0;
    let apart = 0;
    for (let index = 0; index < a.length; index += 4) {
      if (a[index + 3] === 0 && b[index + 3] === 0) continue;
      ink += 1;
      if (
        Math.abs(a[index] - b[index]) > 40 ||
        Math.abs(a[index + 1] - b[index + 1]) > 40 ||
        Math.abs(a[index + 2] - b[index + 2]) > 40
      ) {
        apart += 1;
      }
    }
    return ink === 0 ? 0 : apart / ink;
  };
  const rage = Core.SKILL_ORDER.indexOf("rageBurst");
  const rift = Core.SKILL_ORDER.indexOf("mountainRift");
  const smash = Core.SKILL_ORDER.indexOf("mountainBreaker");
  /*
   * The colour is part of the art: 怒气爆发 erupts white-gold out of a pool of
   * blood, not red. The plain board of the same shapes measures [141,9,2] there,
   * so this is the assertion that would have caught shipping the wrong board.
   */
  const meanInk = (row) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let column = 0; column < Render.EFFECT.rowFrames.rageBurst; column += 1) {
      const pixels = cellPixels(row, column);
      for (let at = 0; at < pixels.length; at += 4) {
        if (pixels[at + 3] === 0) continue;
        red += pixels[at];
        green += pixels[at + 1];
        blue += pixels[at + 2];
        count += 1;
      }
    }
    return count === 0 ? [0, 0, 0] : [red / count, green / count, blue / count];
  };
  const burst = meanInk(rage);
  assert.ok(burst[1] > 150, `怒气爆发 erupts white-gold, not red (green ${burst[1].toFixed(0)})`);
  assert.ok(burst[2] > 100, `怒气爆发 keeps its gold tail (blue ${burst[2].toFixed(0)})`);
  /*
   * The rift row opens on the landing, so the frames to compare are the ones it
   * actually draws - the broken floor and the first eruption.
   */
  const riftRow = Render.EFFECT.riftRows.mountainRift.back;
  const riftCell = Render.EFFECT.riftCell;
  for (let column = 12; column < 18; column += 1) {
    const a = cellPixels(rage, column);
    const b = cellPixels(riftRow, column, riftSheet, riftCell);
    const c = cellPixels(smash, column % Render.EFFECT.rowFrames.mountainBreaker);
    assert.ok(difference(a, b) > 0.4, `frame ${column}: 怒气爆发 and 大蹦 are different art`);
    assert.ok(difference(b, c) > 0.4, `frame ${column}: 大蹦 is not 崩山击's smash again`);
  }
  /* and the comparison has something to look at, or the two above prove nothing */
  const riftInk = cellPixels(riftRow, 14, riftSheet, riftCell).filter(
    (_value, index) => index % 4 === 3
  ).filter((alpha) => alpha > 0).length;
  assert.ok(riftInk > 200, `the rift's own row has art on it (${riftInk} opaque samples)`);
});

test("each skill picks a DNF effect row across the cast", () => {
  Core.SKILL_ORDER.forEach((skillId, row) => {
    const spec = Core.SKILLS[skillId];
    const mid = (spec.activeFrom + spec.activeTo) / 2 / spec.duration;
    const frame = Render.skillEffectFrame(skillId, mid);
    assert.ok(frame, `${skillId} should draw an effect mid-cast`);
    assert.equal(frame.row, row, `${skillId} owns its atlas row`);
    assert.ok(frame.col >= 0 && frame.col < Render.EFFECT.rowFrames[skillId]);
    /*
     * A move's art starts on its own active window, so most of them draw
     * nothing at cast progress 0. 大蹦 is the exception: 崩山裂地斩是先举剑,
     * the blade it summons goes up with that raise, so its window opens on the
     * first frame of the cast (see EFFECT.timing.mountainRift) and the frame it
     * draws there is the head of the sword row, not the fire.
     */
    const opens = (Render.EFFECT.timing && Render.EFFECT.timing[skillId]) || null;
    if (opens && opens.from === 0) {
      assert.ok(Render.skillEffectFrame(skillId, 0), `${skillId} opens on its own first frame`);
    } else {
      assert.equal(Render.skillEffectFrame(skillId, 0), null, `${skillId} draws nothing on frame 0`);
    }
    assert.equal(Render.skillEffectFrame(skillId, 1), null, `${skillId} stops after the cast`);
  });
  assert.equal(Render.skillEffectFrame("grunt", 0.5), null, "unknown skills have no effect");
});

test("血之狂暴 is a stance with no timer, and casting it again takes it down", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;

  const baseSpeed = Core.attackSpeedOf(state.player);
  const hpBefore = state.player.hp;
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 60, {});

  const hpAfterCast = state.player.hp;
  assert.ok(state.player.buffs.bloodRage > 0, "the stance goes up");
  assert.ok(hpAfterCast < hpBefore, "going up costs HP");
  assert.ok(Core.attackSpeedOf(state.player) > baseSpeed, "the stance buys attack speed");

  /*
   * A buffer in the DNF sense: the client's own read is "cast it again to take
   * it down", so an hour of game time must not tick it away - and it must not
   * keep draining HP either.
   */
  Core.runFrames(state, 3600, {});
  assert.equal(state.player.buffs.bloodRage, Infinity, "the stance has no timer");
  assert.equal(state.player.hp, hpAfterCast, "and it stops charging HP after the cast");
  assert.ok(Core.attackSpeedOf(state.player) > baseSpeed, "it is still up a minute later");

  /* Cooldowns run fast while it is up ... */
  state.player.skillCooldowns.upSlash = 4;
  Core.runFrames(state, 60, {});
  const ragingCooldown = state.player.skillCooldowns.upSlash;

  /* ... and the second cast is the cancel, which costs nothing. */
  state.player.mp = state.player.maxMp;
  state.player.skillCooldowns.frenzy = 0;
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 60, {});
  assert.equal(state.player.buffs.bloodRage, 0, "casting it again takes it down");
  assert.equal(state.player.hp, hpAfterCast, "taking it down is free");
  assert.equal(Core.attackSpeedOf(state.player), baseSpeed, "the attack speed goes with it");

  state.player.skillCooldowns.upSlash = 4;
  Core.runFrames(state, 60, {});
  assert.ok(
    state.player.skillCooldowns.upSlash > ragingCooldown,
    "cooldowns run at the normal rate once the stance is down"
  );
});

test("血之狂暴 draws blood orbs out of what it hits and they fly back as healing", () => {
  const state = lastRoomState();
  const target = Core.createEnemy(state, "brute", state.player.x + 160);
  target.hp = 100000;
  target.maxHp = 100000;
  target.speed = 0;
  state.enemies = [target];

  /* Without the stance, the same hits draw nothing (the control). */
  for (let hit = 0; hit < 40; hit += 1) {
    Core.damageEnemy(state, target, 1, 0, state.player.x);
  }
  assert.equal(state.stats.bloodOrbs, 0, "no stance, no blood");
  assert.equal(state.pickups.length, 0, "and nothing is left on the floor");

  state.player.buffs.bloodRage = Infinity;
  let hits = 0;
  while (state.stats.bloodOrbs === 0 && hits < 40) {
    Core.damageEnemy(state, target, 1, 0, state.player.x);
    hits += 1;
  }
  assert.ok(state.stats.bloodOrbs > 0, `a landed hit has to draw blood (${hits} hits)`);
  assert.equal(state.pickups.length, 1, "the orb is a pickup");
  const orb = state.pickups[0];
  assert.equal(orb.kind, "blood_orb");
  assert.equal(orb.value, Core.BLOOD_ORB.heal, "the orb carries its heal");

  /*
   * It is pulled towards him rather than dropped: a Slayer standing in the air
   * over a jump still catches it, which the falling heal orbs cannot do.
   */
  state.player.onGround = false;
  state.player.vy = -320;
  state.player.y = Core.ARENA.groundY - 90;
  const wounded = state.player.maxHp - Core.BLOOD_ORB.heal - 5;
  state.player.hp = wounded;
  Core.runFrames(state, 60, {});
  assert.equal(state.player.hp, wounded + Core.BLOOD_ORB.heal, "arriving blood heals him");
  assert.equal(state.pickups.length, 0, "and the orb is spent");

  /* Blood that cannot reach him does not sit there forever. */
  state.player.invuln = 0;
  state.player.buffs.bloodRage = Infinity;
  Core.damageEnemy(state, target, 1, 0, state.player.x);
  if (!state.pickups.length) {
    for (let hit = 0; hit < 40 && !state.pickups.length; hit += 1) {
      Core.damageEnemy(state, target, 1, 0, state.player.x);
    }
  }
  assert.ok(state.pickups.length > 0, "precondition: a fresh orb");
  state.player.hp = state.player.maxHp;
  Core.runFrames(state, 200, {});
  assert.equal(state.pickups.length, 0, "orbs do not pile up");
});

test("the stance paints him red, badges its icon and rides the normal attack", () => {
  const state = Core.createState({ seed: 9 });
  const sprites = {
    slayer: { width: 8736, height: 1232 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: { width: 3456, height: 1536 }
  };
  const slot = Core.SKILL_ORDER.indexOf("frenzy");
  const rowOf = (calls, image, row) =>
    calls.filter(
      (call) => call[0] === "drawImage" && call[1] === image && call[3] === row * Render.EFFECT.cell
    );
  /*
   * The shared context double stubs the gradient factories out, so this test
   * counts them itself: the aura is a radial gradient behind the character.
   */
  const renderWith = (calls) => {
    const ctx = recordingContext(calls);
    const gradients = [];
    ctx.createRadialGradient = (...args) => {
      gradients.push(args);
      return { addColorStop() {} };
    };
    Render.render(ctx, state, { sprites });
    return gradients;
  };

  const calm = [];
  const calmGradients = renderWith(calm);
  const calmBadge = calm.filter(
    (call) => call[0] === "drawImage" && call[1] === sprites.skills && call[3] === 32
  );
  assert.equal(calmBadge.length, 0, "no stance, no badge");
  assert.equal(rowOf(calm, sprites.effects, Render.EFFECT.orbRow).length, 0, "and no blood orbs");

  /* Mid-swing with the stance up: the whole look is on screen at once. */
  state.player.buffs.bloodRage = Infinity;
  state.player.attackTimer = state.player.attackDuration * 0.5;
  state.pickups.push({
    kind: "blood_orb",
    x: state.player.x + 60,
    y: state.player.y - 40,
    radius: 9,
    value: Core.BLOOD_ORB.heal,
    life: 1.2,
    speed: Core.BLOOD_ORB.speed
  });
  const raging = [];
  const ragingGradients = renderWith(raging);

  /*
   * The badge is atlas frame 135, which lives on the icon sheet's second row:
   * a source y of 32 is the only place that art can come from.
   */
  const badge = raging.filter(
    (call) => call[0] === "drawImage" && call[1] === sprites.skills && call[3] === 32
  );
  assert.equal(badge.length, 1, "the stance shows its buff icon");
  assert.equal(badge[0][2], slot * 32, "the badge belongs to the stance's own slot");

  /* The dual-blade arc rides the normal attack, timed off the swing. */
  const frenzyRow = Core.SKILL_ORDER.indexOf("frenzy");
  const slash = rowOf(raging, sprites.effects, frenzyRow);
  assert.ok(slash.length >= 1, "the swing carries the stance's own arc");

  /* Non-vacuous: the same mid-swing frame without the stance draws no arc. */
  state.player.buffs.bloodRage = 0;
  const swing = [];
  Render.render(recordingContext(swing), state, { sprites });
  state.player.buffs.bloodRage = Infinity;
  assert.equal(rowOf(swing, sprites.effects, frenzyRow).length, 0, "no stance, no arc");

  /* And the blood drawn out of a monster is drawn from its own row. */
  const orbs = rowOf(raging, sprites.effects, Render.EFFECT.orbRow);
  assert.ok(orbs.length >= 1, "the orb art comes off the orb row");
  assert.ok(
    ragingGradients.length > calmGradients.length,
    "the stance adds its own glow behind him"
  );
});

test("the three new DNF skills land their hits and statuses", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "brute", state.player.x + 60);
  near.hp = 400;
  near.maxHp = 400;
  near.speed = 0;
  state.enemies = [near];
  state.player.level = 5;
  state.player.mp = state.player.maxMp;

  /*
   * 血之狂暴: the dual-blade stance. DNF's own clip shows no swing here, so the
   * skill costs HP and buys attack speed instead of landing hits.
   */
  const hpBeforeBuff = state.player.hp;
  const speedBeforeBuff = Core.attackSpeedOf(state.player);
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 20, {});
  assert.ok(state.player.buffs.bloodRage > 0, "血之狂暴 goes up");
  assert.ok(state.player.hp < hpBeforeBuff, "血之狂暴 costs HP to keep");
  assert.ok(
    Core.attackSpeedOf(state.player) > speedBeforeBuff,
    "血之狂暴 speeds the Slayer up"
  );
  assert.equal(near.hp, 400, "血之狂暴 is a stance, not a damage move");
  /* let the stance finish casting before the next skill */
  Core.runFrames(state, 30, {});

  // 血气爆发: launches through its wave
  state.player.skillCooldowns.bloodyRave = 0;
  state.player.mp = state.player.maxMp;
  near.hp = 400;
  Core.step(state, { skills: { bloodyRave: true } });
  Core.runFrames(state, 12, {});
  assert.ok(near.y < Core.ARENA.groundY || near.vy < 0, "血气爆发 lifts the target");
  Core.runFrames(state, 28, {});

  // 怒气爆发: hits everything around the player
  const behind = Core.createEnemy(state, "grunt", state.player.x - 90);
  behind.hp = 200;
  behind.maxHp = 200;
  behind.speed = 0;
  state.enemies = [near, behind];
  state.player.skillCooldowns.rageBurst = 0;
  state.player.mp = state.player.maxMp;
  const behindHp = behind.hp;
  Core.step(state, { skills: { rageBurst: true } });
  Core.runFrames(state, 40, {});
  assert.ok(behindHp - behind.hp >= Core.SKILLS.rageBurst.damage, "怒气爆发 reaches behind the player");
  assert.ok(
    behind.dead || behind.y < Core.ARENA.groundY || behind.vy < 0,
    "怒气爆发 lifts the target off the ground"
  );
});

test("抓头 grabs a target, holds it, slams it down and drains HP", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 40);
  enemy.hp = 600;
  enemy.maxHp = 600;
  enemy.attackCooldown = 0;
  state.enemies = [enemy];
  state.player.hp = 60;
  const hpBefore = state.player.hp;

  Core.step(state, { skills: { graspHead: true } });
  Core.runFrames(state, 12, {});
  assert.ok(enemy.grabbed > 0, "the target is held");
  assert.equal(enemy.attackTimer, 0, "a grabbed enemy cannot wind up");
  const lockedX = Math.abs(enemy.x - (state.player.x + state.player.facing * 30));
  assert.ok(lockedX < 6, `a grabbed target is pulled in front of the player, dx=${lockedX}`);

  Core.runFrames(state, 60, {});
  assert.ok(enemy.knockdown > 0 || enemy.dead, "the slam knocks it down");
  assert.equal(enemy.grabbed, 0, "the hold ends with the slam");
  assert.ok(state.player.hp > hpBefore, `抓头 drains HP, hp=${state.player.hp}`);
});

test("血魔 dashes through the target with invincibility frames", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 70);
  enemy.hp = 400;
  enemy.maxHp = 400;
  state.enemies = [enemy];
  const xBefore = state.player.x;

  Core.step(state, { skills: { bloodEvil: true } });
  Core.runFrames(state, 8, {});
  assert.ok(state.player.invuln > 0, "the dash grants invincibility frames");
  Core.runFrames(state, 40, {});

  assert.ok(state.player.x > xBefore + 60, `the dash covers ground, x=${state.player.x}`);
  assert.ok(
    400 - enemy.hp >= Core.SKILLS.bloodEvil.damage,
    "the dash cuts the target on the way through"
  );
  assert.ok(state.player.x > enemy.x, "the Slayer ends up past the target");
});

test("崩山裂地斩 leaps forward, lands on its gash and stands back up", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "brute", state.player.x + 160);
  /* And one behind him: the reference's gash is one-sided, so it must be spared. */
  const behind = Core.createEnemy(state, "brute", state.player.x - 160);
  [near, behind].forEach((enemy) => {
    enemy.hp = 600;
    enemy.maxHp = 600;
    enemy.speed = 0;
  });
  state.enemies = [near, behind];
  state.player.mp = state.player.maxMp;
  const skill = Core.SKILLS.mountainRift;

  Core.step(state, { skills: { mountainRift: true } });
  assert.ok(
    state.player.mp <= state.player.maxMp - skill.mp + 2,
    `the ultimate costs ${skill.mp} MP, mp=${state.player.mp}`
  );
  Core.runFrames(state, 16, {});
  /*
   * The raise is cast from the floor - the reference holds him planted while the
   * blood sword gathers over his head (its #16-32) - and the leap only starts
   * when that beat is done.
   */
  assert.equal(state.player.onGround, true, "the raise is cast from the floor");
  const xAtCast = state.player.x;

  /* The leap is the reference's #33-50: nearly a second off the ground. */
  Core.runFrames(state, 40, {});
  assert.equal(state.player.onGround, false, "then he leaps");
  assert.ok(
    state.player.y < Core.ARENA.groundY - 60,
    `and gets properly airborne (${(Core.ARENA.groundY - state.player.y).toFixed(0)}px up)`
  );

  /*
   * He comes down on activeFrom - the reference lands and drives the blade in on
   * the same frame - about 47px in front of where he cast it, and that is where
   * the ground opens.
   */
  Core.runFrames(state, 20, {});
  assert.equal(state.player.onGround, true, "and lands on the beat the rift opens");
  assert.ok(
    Math.abs(state.player.x - xAtCast - 47) < 20,
    `the hop carries him the reference's 47px forward (${(state.player.x - xAtCast).toFixed(1)}px)`
  );
  assert.ok(
    state.effects.some((effect) => effect.kind === "shockwave"),
    "the landing splits the ground"
  );
  assert.ok(near.hp < 600, "the gash catches what is in front of him");
  assert.equal(behind.hp, 600, "and spares what is behind him: it is a one-sided rift");

  Core.runFrames(state, 48, {});
  /*
   * The cast keeps running long after the hit: the second eruption is still
   * coming, and the reference spends those two seconds prone and then getting
   * up rather than free. The last tick is what floors what the rift caught.
   */
  assert.ok(state.player.skillTimer > 1, "the fire is still to come when the hit lands");
  Core.runFrames(state, 110, {});
  assert.ok(
    state.player.skillCooldowns.mountainRift > 0 &&
      state.player.skillCooldowns.mountainRift < skill.cooldown,
    "the long cooldown runs down after the cast"
  );
  assert.ok(near.knockdown > 0 || near.dead, "the rift knocks them down");
  assert.ok(state.player.skillTimer <= 0.1, "and the cast does end, 4s after the press");
});

test("the skill loadout assigns, swaps, clears and round-trips", () => {
  const Loadout = require("../src/loadout.js");
  const base = Loadout.create(Core.SKILL_ORDER);
  assert.equal(base.length, Loadout.SLOT_COUNT);
  assert.equal(Loadout.SLOT_COUNT, 12, "DNF two-row quickbar");
  assert.deepEqual(base, Loadout.DEFAULT_SLOTS);

  const moved = Loadout.assign(base, 0, "bloodSword");
  assert.equal(moved[0], "bloodSword");
  assert.equal(moved[3], "upSlash", "the displaced skill swaps into the old slot");

  const cleared = Loadout.clearSlot(moved, 0);
  assert.equal(cleared[0], null);
  assert.equal(moved[0], "bloodSword", "loadout updates are immutable");

  const swapped = Loadout.swap(base, 0, 2);
  assert.equal(swapped[0], base[2]);
  assert.equal(swapped[2], base[0]);

  const text = Loadout.serialize(cleared);
  assert.deepEqual(Loadout.deserialize(text, Core.SKILL_ORDER), cleared);
  assert.deepEqual(
    Loadout.deserialize("bogus", Core.SKILL_ORDER),
    new Array(12).fill(null),
    "unknown skill ids are rejected"
  );
  assert.equal(Loadout.slotForCode("KeyD"), 2);
  assert.equal(Loadout.slotForCode("KeyT"), 10);
  assert.equal(Loadout.slotForCode("ArrowLeft"), -1);
});

test("the up-slash keeps DNF's default Z key next to its quickbar slot", () => {
  const Loadout = require("../src/loadout.js");

  assert.equal(Loadout.SKILL_KEYS.KeyZ, "upSlash", "Z is the up-slash");
  assert.equal(Loadout.SKILL_SHORTCUTS.upSlash, "Z", "and the bar can print it");
  assert.ok(Core.SKILL_ORDER.includes(Loadout.SKILL_KEYS.KeyZ), "the shortcut names a real skill");
  assert.ok(
    Loadout.DEFAULT_SLOTS.includes("upSlash"),
    "the default bar still ships the up-slash, so Z has something to cast"
  );
  /* Z is a skill key, not a thirteenth slot: the two-row bar is untouched. */
  assert.equal(Loadout.SLOT_KEYS.includes("Z"), false);
  assert.equal(Loadout.slotForCode("KeyZ"), -1);
});

test("the renderer picks the sprite row that matches the player state", () => {
  const calls = [];
  const ctx = new Proxy(
    {
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = (...args) => calls.push([prop, ...args]);
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );

  const sheet = { width: 576, height: 480 };
  const sprites = { slayer: sheet, skills: { width: 128, height: 32 } };
  const playerDraw = () =>
    calls
      .filter(
        (call) =>
          call[0] === "drawImage" &&
          call[1] === sheet &&
          call[6] === -Render.SPRITE.anchorX
      )
      .pop();

  const state = Core.createState({ seed: 3 });
  const renderIdle = () => {
    calls.length = 0;
    Render.render(ctx, state, { sprites });
    return playerDraw();
  };

  assert.equal(renderIdle()[3], 0, "idle uses the first sprite row");

  state.player.vx = 220;
  assert.equal(renderIdle()[3], Render.SPRITE.frameH * 1, "running uses the run row");

  state.player.vx = 0;
  state.player.attackTimer = Core.PLAYER.attackDuration;
  state.player.attackCycle = Core.PLAYER.attackDuration + Core.PLAYER.attackCooldown;
  state.player.attackCooldown = state.player.attackCycle;
  state.player.comboTimer = Core.PLAYER.comboWindow;
  state.player.comboIndex = 0;
  assert.equal(renderIdle()[3], Render.SPRITE.frameH * 2, "attacks use the attack row");

  /*
   * The cut's frames span the whole press cycle, so its recovery keeps the
   * follow-through playing instead of snapping back to the idle pose between
   * cuts, which is what made the chain look chopped up.
   */
  state.player.attackTimer = 0;
  state.player.attackCooldown = 0.02;
  const stage = Core.ATTACK_STAGES[state.player.comboIndex];
  const recovering = renderIdle();
  assert.equal(recovering[3], Render.SPRITE.frameH * 2, "a cut's recovery still shows that cut");
  assert.equal(
    recovering[2],
    (stage.first + stage.frames - 1) * Render.SPRITE.frameW,
    "by the end of the recovery the cut has played its last frame"
  );

  state.player.comboTimer = 0;
  state.player.attackCooldown = 0;
  assert.equal(renderIdle()[3], 0, "with the combo over the Slayer goes back to idle");

  state.player.attackTimer = 0;
  state.player.skillId = "bloodSword";
  state.player.skillTimer = Core.SKILLS.bloodSword.duration;
  assert.equal(renderIdle()[3], Render.SPRITE.frameH * 3, "skills use the skill row");

  state.player.skillTimer = 0;
  state.player.skillId = null;
  state.player.onGround = false;
  state.player.vy = -200;
  /*
   * The hop is the client's own jump animation (sm_body0048 126-131), not the
   * old extras pair: that art carries the air slash's white arc, which is the
   * sword swing a jump is not supposed to have.
   */
  const airborne = renderIdle();
  assert.equal(airborne[3], Render.SPRITE.frameH * 6, "jumping uses the jump row");

  state.player.vy = -900;
  const launching = renderIdle();
  state.player.vy = 400;
  const falling = renderIdle();
  assert.ok(
    falling[2] > launching[2],
    `the jump animation walks forward as the hop falls (${launching[2]} -> ${falling[2]})`
  );
  state.player.vy = -200;

  state.player.onGround = true;
  state.player.vy = 0;
  state.player.hurtTimer = 0.1;
  const hurt = renderIdle();
  assert.equal(hurt[3], Render.SPRITE.frameH * 4);
  assert.equal(hurt[2], 0, "hurt uses the hurt column");
});

test("touch controls expose a hit-testable layout for mobile play", () => {
  const buttons = Render.touchButtons();
  const actions = buttons.map((button) => button.action);

  /*
   * The six a player holds the device with, in the block they are drawn in:
   * four ways to move on the floor's two axes, then jump and attack. Depth is
   * not an extra on a touch surface - whether the floor has a second axis is
   * the same question with a finger as with a keyboard.
   */
  assert.deepEqual(actions.slice(0, 6), ["up", "down", "left", "right", "jump", "attack"]);
  assert.ok(actions.includes("mute"));
  assert.ok(actions.includes("loadout"), "touch play needs the arrange button");

  buttons.forEach((button) => {
    assert.ok(button.x >= 0 && button.y >= 0, `${button.action} starts inside the arena`);
    assert.ok(button.x + button.w <= Core.ARENA.width, `${button.action} fits horizontally`);
    assert.ok(button.y + button.h <= Core.ARENA.height, `${button.action} fits vertically`);
    assert.equal(
      Render.hitTestTouch(button.x + button.w / 2, button.y + button.h / 2),
      button.action
    );
  });

  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const a = buttons[i];
      const b = buttons[j];
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(overlaps, false, `${a.action} overlaps ${b.action}`);
    }
  }

  assert.equal(Render.hitTestTouch(Core.ARENA.width / 2, 180), null, "empty space is not a button");
});

test("a touch player can pause and get out of it without a keyboard", () => {
  const pause = Render.touchButtons().find((button) => button.action === "pause");
  assert.ok(pause, "the touch layout needs a pause button");
  assert.equal(pause.label, "停");
  assert.equal(Render.hitTestTouch(pause.x + pause.w / 2, pause.y + pause.h / 2), "pause");

  const state = Core.createState({ seed: 5 });
  const liveCalls = [];
  Render.render(recordingContext(liveCalls), state, {
    touch: { enabled: true, pressed: [], muted: false }
  });
  const liveTexts = liveCalls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  assert.ok(liveTexts.includes("停"), `live play draws the pause button: ${liveTexts.join(" / ")}`);
  assert.equal(liveTexts.includes("续"), false, "an unpaused run does not offer to resume");

  const pausedCalls = [];
  Render.render(recordingContext(pausedCalls), state, {
    paused: true,
    liveRows: [{ id: "seed", label: "种子", value: "5" }],
    touch: { enabled: true, pressed: [], muted: false, paused: true }
  });
  const pausedTexts = pausedCalls
    .filter((call) => call[0] === "fillText")
    .map((call) => String(call[1]));
  assert.ok(pausedTexts.includes("PAUSED"));
  assert.ok(pausedTexts.includes("续"), "the paused frame offers the way out");
  assert.ok(
    pausedTexts.some((text) => text.includes("点右上角")),
    "the pause overlay tells a touch player how to leave it"
  );

  /*
   * Order matters: the overlay is painted over the controls, so a resume button
   * drawn before it would be sitting under a dark wash with no way to tap out.
   * It is drawn a second time after the overlay for exactly that reason, and the
   * last copy is the one that has to land on top.
   */
  const overlayAt = pausedTexts.indexOf("PAUSED");
  const resumeAt = pausedTexts.lastIndexOf("续");
  assert.ok(overlayAt !== -1, "the paused frame announces itself");
  assert.ok(resumeAt > overlayAt, "the resume button is drawn on top of the pause overlay");
});

test("the hotbar exposes two rows of DNF slots and the panel exposes every skill", () => {
  const Loadout = require("../src/loadout.js");
  const slots = Render.skillBarButtons();
  assert.equal(slots.length, Loadout.SLOT_COUNT, "A S D F G H / Q W E R T Y");
  assert.equal(Render.touchBarButtons().length, Loadout.SLOT_COUNT, "touch keeps both rows");
  assert.equal(slots[0].y, slots[5].y, "the A row shares a baseline");
  assert.equal(slots[6].y, slots[11].y, "and so does the Q row");
  /*
   * The bar mirrors the keyboard above it: the Q row is on top, the A row under
   * it. It used to be the other way round, which the owner spotted.
   */
  assert.ok(slots[6].y < slots[0].y, "Q W E R T Y sits above A S D F G H");
  const topRow = slots.filter((slot) => slot.y === slots[6].y).map((slot) => slot.index);
  const bottomRow = slots.filter((slot) => slot.y === slots[0].y).map((slot) => slot.index);
  assert.deepEqual(topRow, [6, 7, 8, 9, 10, 11], "Q W E R T Y is the top row");
  assert.deepEqual(bottomRow, [0, 1, 2, 3, 4, 5], "A S D F G H is the bottom row");
  slots.forEach((slot) => {
    assert.ok(slot.x + slot.w <= Core.ARENA.width);
    assert.ok(slot.y + slot.h <= Core.ARENA.height);
    const hit = Render.hitTestLoadout(slot.x + slot.w / 2, slot.y + slot.h / 2, false, false);
    assert.deepEqual(hit, { kind: "slot", index: slot.index });
  });

  /* Touch mode uses the compact bar, and hit-testing follows it. */
  const touchSlot = Render.touchBarButtons()[7];
  assert.deepEqual(
    Render.hitTestLoadout(touchSlot.x + 4, touchSlot.y + 4, false, true),
    { kind: "slot", index: 7 }
  );

  const tiles = Render.loadoutPanelButtons();
  assert.equal(tiles.length, Core.SKILL_ORDER.length, "every skill is draggable");
  tiles.forEach((tile) => {
    assert.ok(Core.SKILL_ORDER.includes(tile.skillId));
    const hit = Render.hitTestLoadout(tile.x + tile.w / 2, tile.y + tile.h / 2, true);
    assert.equal(hit.kind, "tile");
    assert.equal(hit.skillId, tile.skillId);
  });

  /* An open panel takes priority over the bar underneath it. */
  const topTile = tiles[tiles.length - 1];
  assert.equal(
    Render.hitTestLoadout(topTile.x + 4, topTile.y + 4, false),
    null,
    "the panel area is inert while the panel is closed"
  );
});

test("the renderer draws both hotbar rows and the loadout panel", () => {
  const calls = [];
  const ctx = new Proxy(
    {
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = (...args) => calls.push([prop, ...args]);
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );

  const state = Core.createState({ seed: 11 });
  const sprites = { slayer: { width: 576, height: 480 }, skills: { width: 128, height: 32 } };
  const barY = Render.skillBarButtons()[0].y + 2;
  const barY2 = Render.skillBarButtons()[6].y + 2;
  const tileYs = [...new Set(Render.loadoutPanelButtons().map((tile) => tile.y + 4))];
  const drawsAt = (destY) =>
    calls.filter(
      (call) => call[0] === "drawImage" && call[1] === sprites.skills && call[7] === destY
    ).length;
  const tileDraws = () => tileYs.reduce((total, destY) => total + drawsAt(destY), 0);
  /* Eleven skills fill the two rows, leaving one empty slot on the second row. */
  const loadout = Core.SKILL_ORDER.slice(0, 11).concat([null]);

  calls.length = 0;
  Render.render(ctx, state, { sprites, loadout });
  assert.equal(drawsAt(barY), 6, "six icons on the first row");
  assert.equal(drawsAt(barY2), 5, "the empty slot draws no icon");
  assert.equal(tileDraws(), 0, "panel is closed");

  calls.length = 0;
  Render.render(ctx, state, {
    sprites,
    loadout,
    loadoutOpen: true,
    drag: { skillId: "bloodyRave", x: 400, y: 300 },
    touch: { enabled: true, pressed: [], muted: false }
  });
  const touchY = Render.touchBarButtons()[0].y + 4;
  const touchY2 = Render.touchBarButtons()[6].y + 4;
  assert.equal(drawsAt(barY), 0, "touch mode uses the compact bar");
  assert.equal(drawsAt(touchY), 6, "compact bar keeps the first row while arranging");
  assert.equal(drawsAt(touchY2), 5, "compact bar keeps the second row while arranging");
  assert.equal(tileDraws(), Core.SKILL_ORDER.length, "every skill tile is drawn");
});

/** A canvas context double that records every draw call it receives. */
function recordingContext(calls) {
  return new Proxy(
    {
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = (...args) => calls.push([prop, ...args]);
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );
}

test("the boss enrages at half health without mutating the shared type spec", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 120);
  state.enemies = [boss];
  const spec = Core.ENEMY_TYPES.boss;

  assert.equal(boss.phase, 1);
  /* One point above the ratio leaves it calm; the next point flips it. */
  Core.damageEnemy(state, boss, boss.maxHp * (1 - spec.phase2.hpRatio) - 1, 0, state.player.x);
  assert.equal(boss.phase, 1, "the boss must stay in phase one above the threshold");
  assert.equal(boss.speed, spec.speed);

  Core.damageEnemy(state, boss, 2, 0, state.player.x);
  assert.equal(boss.phase, 2, "crossing half health starts phase two");
  assert.equal(
    state.effects.some((effect) => effect.kind === "banner" && effect.text === spec.phase2.banner),
    true,
    "the phase change must announce itself"
  );
  assert.ok(boss.speed > spec.speed, `phase two is faster: ${boss.speed}`);
  assert.ok(boss.damage > spec.damage, `phase two hits harder: ${boss.damage}`);
  assert.ok(boss.attackCooldownMax < spec.attackCooldown, "phase two attacks sooner");
  assert.ok(boss.slam.radius > spec.slam.radius, "phase two slams further");

  /* Every other boss in every other run reads from this one table. */
  assert.equal(spec.slam.radius, 150, "the shared slam radius must not change");
  assert.equal(spec.slam.cooldown, 3.6, "the shared slam cooldown must not change");
  assert.equal(spec.speed, 88, "the shared speed must not change");
  assert.equal(spec.damage, 18, "the shared damage must not change");

  const fresh = Core.createEnemy(Core.createState({ seed: 3 }), "boss", 500);
  assert.equal(fresh.phase, 1);
  assert.equal(fresh.slam.radius, 150, "a new boss starts from the pristine spec");
  assert.equal(fresh.speed, 88);

  /* The enrage is a deterministic state, so a twin boss lands on the same numbers. */
  const twin = Core.createEnemy(Core.createState({ seed: 3 }), "boss", 500);
  Core.enterPhase2(Core.createState({ seed: 3 }), twin);
  assert.equal(twin.phase, 2);
  assert.equal(twin.speed, boss.speed);
  assert.equal(twin.damage, boss.damage);
  assert.equal(twin.slam.radius, boss.slam.radius);
});

test("only the enraged boss lunges, and the lunge carries super armour", () => {
  const run = (enraged) => {
    const state = lastRoomState();
    const boss = Core.createEnemy(state, "boss", state.player.x + 160);
    /* Isolate the lunge: the slam would otherwise preempt a mid-range attack. */
    boss.slam = null;
    boss.attackRange = 0;
    boss.attackCooldown = 0;
    boss.slamCooldown = 0;
    state.enemies = [boss];
    if (enraged) {
      Core.enterPhase2(state, boss);
      boss.lungeCooldown = 0;
    }

    let telegraphed = false;
    let sawSuperArmor = false;
    let sawCharge = false;
    for (let frame = 0; frame < 60 * 4; frame += 1) {
      Core.step(state, {});
      if (state.effects.some((effect) => effect.kind === "telegraph" && effect.text === "LUNGE")) {
        telegraphed = true;
      }
      if (boss.attackKind === "charge") {
        sawCharge = true;
        if (boss.superArmor) sawSuperArmor = true;
      }
    }
    return { telegraphed, sawCharge, sawSuperArmor, restingSuperArmor: boss.superArmor };
  };

  const enraged = run(true);
  assert.ok(enraged.sawCharge, "the enraged boss must lunge from mid range");
  assert.ok(enraged.telegraphed, "the lunge must telegraph before it commits");
  assert.ok(enraged.sawSuperArmor, "the lunge must carry boss super armour");
  assert.equal(enraged.restingSuperArmor, false, "super armour must end with the lunge");

  const calm = run(false);
  assert.equal(calm.sawCharge, false, "phase one has no lunge");
  assert.equal(calm.telegraphed, false, "phase one must not telegraph a lunge");
});

test("super armour never sticks when a wind-up is interrupted", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 160);
  boss.slam = null;
  boss.attackRange = 0;
  state.enemies = [boss];
  Core.enterPhase2(state, boss);
  boss.attackCooldown = 0;
  boss.lungeCooldown = 0;

  /* Run into the lunge, then knock the boss down through its super armour. */
  let caught = false;
  for (let frame = 0; frame < 120 && !caught; frame += 1) {
    Core.step(state, {});
    caught = boss.attackKind === "charge" && boss.attackTimer > 0 && boss.superArmor;
  }
  assert.ok(caught, "the boss must be mid-lunge with super armour for this test to mean anything");

  Core.damageEnemy(state, boss, 8, 0, state.player.x, { knockdown: 0.8, ignoreSuperArmor: true });
  Core.runFrames(state, 6, {});
  assert.equal(boss.superArmor, false, "an interrupted wind-up must drop super armour");

  /* It has to stay knockback-able afterwards, not just report the flag. */
  boss.knockdown = 0;
  boss.stun = 0;
  boss.hurtTimer = 0;
  boss.vx = 0;
  Core.damageEnemy(state, boss, 6, 240, state.player.x);
  assert.ok(Math.abs(boss.vx) > 0, "the boss must take knockback again");
});

test("the chapel's floor cracks, breaks, and then settles again", () => {
  const index = chapelRoomIndex(1);
  assert.notEqual(index, -1, "seed 1 should draw the chapel");
  const state = Core.createState({ seed: 1, roomIndex: index });
  assert.equal(state.hazards.length, 2, "the chapel has two slabs");

  const seen = new Set();
  const stages = [];
  for (let frame = 0; frame < Core.FPS * 9; frame += 1) {
    Core.step(state, {});
    const stage = state.hazards[0].stage;
    seen.add(stage);
    if (stages[stages.length - 1] !== stage) stages.push(stage);
  }

  assert.deepEqual([...seen].sort(), ["collapsing", "cracking", "dormant"]);
  assert.ok(stages.includes("cracking"), "the slab must warn before it breaks");
  assert.ok(
    stages.indexOf("cracking") < stages.indexOf("collapsing"),
    `warning comes first: ${stages.join(" -> ")}`
  );
  /* The two slabs are offset, so the whole floor never goes at once. */
  const offset = state.hazards[1].phase - state.hazards[0].phase;
  assert.ok(Math.abs(offset) > 0.5, `slabs need different phases, got ${offset}`);
});

test("a breaking slab hits whoever is standing on it, both sides included", () => {
  const index = chapelRoomIndex(1);
  const state = Core.createState({ seed: 1, roomIndex: index });
  state.enemies = [];
  const hazard = state.hazards[0];
  state.player.x = hazard.x;

  let broke = false;
  for (let frame = 0; frame < Core.FPS * 6 && !broke; frame += 1) {
    Core.step(state, {});
    broke = state.stats.damageTaken > 0;
  }
  assert.ok(broke, "standing on the slab must cost health");
  assert.equal(state.stats.damageTaken, Core.HAZARD.playerDamage);

  /* A mob parked on a slab takes the same floor, with a knockdown. */
  const trap = Core.createState({ seed: 1, roomIndex: index });
  const slab = trap.hazards[0];
  const brute = Core.createEnemy(trap, "brute", slab.x);
  brute.speed = 0;
  trap.enemies = [brute];
  trap.player.x = Core.ARENA.leftWall + trap.player.width;
  const bruteHp = brute.hp;
  for (let frame = 0; frame < Core.FPS * 6 && brute.hp === bruteHp; frame += 1) {
    Core.step(trap, {});
  }
  assert.ok(brute.hp < bruteHp, "the floor does not care whose side you are on");
  assert.equal(bruteHp - brute.hp, Core.HAZARD.enemyDamage);
});

test("each break is counted once and carries its own effect, not a slam", () => {
  const index = chapelRoomIndex(1);
  const state = Core.createState({ seed: 1, roomIndex: index });
  const hazard = state.hazards[0];
  state.enemies = [];
  state.player.x = Core.ARENA.leftWall + state.player.width;

  const breaks = [];
  let previous = 0;
  for (let frame = 0; frame < Core.FPS * 9; frame += 1) {
    Core.step(state, {});
    if (state.stats.collapses > previous) {
      previous = state.stats.collapses;
      breaks.push(
        state.effects.filter((effect) => effect.kind === "collapse").map((effect) => effect.x)
      );
    }
  }

  /* Two slabs, two cycles each in nine seconds. */
  assert.ok(state.stats.collapses >= 4, `expected several breaks, saw ${state.stats.collapses}`);
  assert.equal(
    breaks.length,
    state.stats.collapses,
    "the counter and the emitted effects must agree"
  );
  breaks.forEach((xPositions, entry) => {
    assert.equal(xPositions.length, 1, `break ${entry} must emit exactly one effect`);
    assert.ok(
      state.hazards.some((slab) => slab.x === xPositions[0]),
      `break ${entry} points at a real slab`
    );
  });

  /* The floor's jolt is not the boss slam: no shockwave is involved. */
  assert.equal(
    state.effects.filter((effect) => effect.kind === "shockwave").length,
    0,
    "a collapse should not masquerade as a shockwave"
  );
});

test("the renderer gives the break its own shake and dust", () => {
  const firstTranslate = (effects, time) => {
    const state = lastRoomState();
    state.time = time;
    state.effects = effects;
    const calls = [];
    Render.render(recordingContext(calls), state, {});
    const call = calls.find((entry) => entry[0] === "translate");
    return call ? Math.abs(call[1]) : null;
  };

  const quiet = firstTranslate([], 0.01);
  const collapse = firstTranslate(
    [{ kind: "collapse", x: 600, y: Core.ARENA.groundY, radius: 70, life: 0.6, maxLife: 0.6 }],
    0.01
  );
  assert.ok(quiet !== null && quiet > 50, `no effect means no leading shake, got ${quiet}`);
  assert.ok(
    collapse !== null && collapse < 12,
    `a collapse should shake the frame a little, got ${collapse}`
  );
  /* Its own weight: the floor dropping is a harder jolt than a slam wave. */
  const slam = firstTranslate(
    [{ kind: "shockwave", x: 600, y: Core.ARENA.groundY, radius: 70, life: 0.6, maxLife: 0.6 }],
    0.01
  );
  assert.ok(
    collapse > slam,
    `the collapse should hit harder than a shockwave: ${collapse} vs ${slam}`
  );

  /* And the dust reads as debris, not just another ring. */
  const calls = [];
  const state = lastRoomState();
  state.effects = [
    { kind: "collapse", x: 600, y: Core.ARENA.groundY, radius: 70, life: 0.4, maxLife: 0.6 }
  ];
  Render.render(recordingContext(calls), state, {});
  assert.ok(
    calls.filter((call) => call[0] === "fillRect").length >= 6,
    "the break should throw grit"
  );
});

test("the policy will not walk onto a slab that is about to break", () => {
  const index = chapelRoomIndex(1);
  const state = Core.createState({ seed: 1, roomIndex: index });
  const hazard = state.hazards[0];
  /* Stand left of the slab with the only enemy beyond it: walking right crosses
   * the slab, so the policy has to wait instead. */
  state.player.x = hazard.x - hazard.radius - 90;
  const far = Core.createEnemy(state, "grunt", hazard.x + hazard.radius + 120);
  far.speed = 0;
  /* A sponge, so the room cannot clear and the slab stays under test. */
  far.maxHp = 100000;
  far.hp = 100000;
  state.enemies = [far];

  let waited = false;
  for (let frame = 0; frame < Core.FPS * 6 && state.hazards.length; frame += 1) {
    Core.step(state, kitingBot(state));
    if (
      state.hazards.length &&
      state.hazards[0].stage !== "dormant" &&
      state.player.x < hazard.x - hazard.radius
    ) {
      waited = true;
    }
  }

  assert.equal(state.stats.damageTaken, 0, "the policy should not be caught by the floor");
  assert.ok(waited, "and it should hold ground while the slab is unsafe");
});

test("a seed draws its own room order and replays exactly", () => {
  const layout = Core.layoutForSeed(7);
  assert.deepEqual(Core.layoutForSeed(7), layout, "the same seed must draw the same run");

  const drawn = [1, 7, 42, Core.DEFAULT_SEED, 5, 99, 1234, 31337].map((seed) =>
    Core.layoutForSeed(seed).join(",")
  );
  assert.ok(new Set(drawn).size > 1, `seeds must differ: ${drawn.join(" | ")}`);

  /* Drawing a run must not reorder the authored pool. */
  const pool = Core.ROOMS.map((room) => room.name).join(",");
  Core.layoutForSeed(999);
  assert.equal(Core.ROOMS.map((room) => room.name).join(","), pool);
});

test("a run opens on a ramp room, never on the hardest fight", () => {
  const ramps = Core.rampRooms();
  assert.ok(ramps.length >= 2, "there has to be a choice of opening rooms");
  ramps.forEach((index) => {
    const hardest = Math.max(...Core.rampRooms().map((room) => Core.roomThreat(room)));
    assert.ok(
      Core.roomThreat(index) <= hardest,
      `${Core.ROOMS[index].name} is meant to be one of the gentler rooms`
    );
  });

  for (let seed = 1; seed <= 200; seed += 1) {
    const opening = Core.layoutForSeed(seed)[0];
    assert.ok(
      ramps.includes(opening),
      `seed ${seed} opened on ${Core.ROOMS[opening].name}, which is not a ramp room`
    );
  }

  /* The hard rooms still show up, just not first. */
  const hard = [];
  for (let index = 0; index < Core.BOSS_ROOM_INDEX; index += 1) {
    if (index !== Core.GAUNTLET_ROOM_INDEX && !ramps.includes(index)) hard.push(index);
  }
  assert.ok(hard.length >= 1, "the pool needs rooms harder than the ramp set");
  hard.forEach((index) => {
    const appearsLater = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some((seed) =>
      Core.layoutForSeed(seed).slice(1).includes(index)
    );
    assert.ok(appearsLater, `${Core.ROOMS[index].name} should still be reachable later in a run`);
  });
});

test("every run is four combat rooms plus the throne, with the gauntlet last", () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const layout = Core.layoutForSeed(seed);
    assert.equal(layout.length, Core.RUN_COMBAT_ROOMS + 1, `seed ${seed}`);
    assert.equal(layout[layout.length - 1], Core.BOSS_ROOM_INDEX, `seed ${seed} must end at the boss`);
    assert.equal(
      layout[layout.length - 2],
      Core.GAUNTLET_ROOM_INDEX,
      `seed ${seed} must run the gauntlet before the throne`
    );
    assert.equal(new Set(layout).size, layout.length, `seed ${seed} repeats a room`);
    layout.slice(0, -1).forEach((index) => {
      assert.ok(
        index >= 0 && index < Core.BOSS_ROOM_INDEX,
        `seed ${seed} drew ${index} outside the combat pool`
      );
    });
  }
});

test("the alternate room is a real possibility, not scenery", () => {
  let included = 0;
  const skippable = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const layout = Core.layoutForSeed(seed);
    if (layout.includes(Core.ALTERNATE_ROOM_INDEX)) included += 1;
    for (let index = 0; index < Core.BOSS_ROOM_INDEX; index += 1) {
      if (index !== Core.GAUNTLET_ROOM_INDEX && !layout.includes(index)) skippable.add(index);
    }
  }
  assert.ok(included > 40, `the alternate should appear often, saw ${included}/200`);
  assert.ok(included < 200, "and it must sometimes be skipped");
  assert.equal(skippable.size, 4, "every non-gauntlet combat room can be skipped");
});

test("the layout changes what you fight, not only the order", () => {
  const rosters = new Set();
  const enemyCounts = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const layout = Core.layoutForSeed(seed);
    rosters.add(layout.slice(0, -1).sort().join(","));
    enemyCounts.add(enemiesInRun(seed));
  }
  assert.ok(rosters.size > 1, "different seeds field different rooms");
  assert.ok(
    enemyCounts.size > 1,
    `different seeds field different enemy counts, got ${[...enemyCounts].join(", ")}`
  );
});

test("startRoom follows the seed's layout", () => {
  const seed = 42;
  const layout = Core.layoutForSeed(seed);
  const state = Core.createState({ seed });

  assert.deepEqual(state.layout, layout);
  assert.equal(state.room.name, Core.ROOMS[layout[0]].name);
  assert.equal(state.enemies.length, Core.ROOMS[layout[0]].enemies.length);

  killAll(state);
  Core.step(state, {});
  Core.chooseUpgrade(state, preferredUpgrade(state.upgradeChoice.options));
  state.player.x = Core.ARENA.rightWall - state.player.width / 2;
  Core.step(state, {});

  assert.equal(state.roomIndex, 1);
  assert.equal(state.room.name, Core.ROOMS[layout[1]].name);
  assert.equal(state.enemies.length, Core.ROOMS[layout[1]].enemies.length);
});

test("the gauntlet ahead of the boss mixes caster pressure with the elite mini-boss", () => {
  assert.equal(Core.ROOMS.length, 6, "the pool holds five combat rooms plus the throne");
  assert.equal(Core.BOSS_ROOM_INDEX, Core.ROOMS.length - 1);

  /* Every seed runs the same number of rooms, ending with the gauntlet and boss. */
  [1, 7, 42, Core.DEFAULT_SEED].forEach((seed) => {
    const layout = Core.layoutForSeed(seed);
    assert.equal(layout.length, Core.RUN_COMBAT_ROOMS + 1, `seed ${seed} run length`);
    assert.equal(layout[layout.length - 1], Core.BOSS_ROOM_INDEX, "the boss closes every run");
    assert.equal(
      layout[layout.length - 2],
      Core.GAUNTLET_ROOM_INDEX,
      "the gauntlet always sits directly before the throne"
    );
    assert.equal(new Set(layout).size, layout.length, "a run never repeats a room");
  });

  const bossRoom = Core.ROOMS[Core.BOSS_ROOM_INDEX];
  assert.ok(
    bossRoom.enemies.some((enemy) => enemy.type === "boss"),
    "the boss must still close the dungeon"
  );
  assert.equal(bossRoom.enemies.length, 2, "the boss room stays a bodyguard fight");
  assert.equal(
    bossRoom.enemies.filter((enemy) => enemy.type === "elite").length,
    0,
    "the mini-boss belongs to the gauntlet, not the throne room"
  );

  const gauntlet = Core.ROOMS[Core.GAUNTLET_ROOM_INDEX];
  const types = gauntlet.enemies.map((enemy) => enemy.type);
  assert.ok(types.includes("caster"), `caster pressure missing from ${gauntlet.name}`);
  assert.ok(types.includes("charger"), `charger pressure missing from ${gauntlet.name}`);
  assert.equal(
    types.filter((type) => type === "elite").length,
    1,
    "the gauntlet holds exactly one elite mini-boss"
  );
  assert.equal(types.includes("boss"), false, "the gauntlet is not the throne room");
  assert.ok(
    gauntlet.enemies.length <= 3,
    "the gauntlet stays readable: three threats, one of them the mini-boss"
  );
});

function clearedRoomState(seed, roomIndex) {
  const state = Core.createState({ seed: seed, roomIndex: roomIndex });
  killAll(state);
  Core.step(state, {});
  return state;
}

test("clearing a room offers three distinct upgrades from the pool", () => {
  const state = clearedRoomState(Core.DEFAULT_SEED, 0);

  assert.ok(state.upgradeChoice, "a cleared room must open the chooser");
  assert.equal(state.upgradeChoice.options.length, Core.UPGRADES_PER_ROOM);
  assert.equal(
    new Set(state.upgradeChoice.options).size,
    Core.UPGRADES_PER_ROOM,
    "the three cards must be three different upgrades"
  );
  state.upgradeChoice.options.forEach((id) => {
    assert.ok(Core.UPGRADE_ORDER.includes(id), `${id} must come from the upgrade pool`);
    assert.ok(Core.UPGRADES[id], `${id} needs a spec`);
  });
});

test("a room's upgrade offer is seeded, and different seeds offer different sets", () => {
  const offered = [1, 7, 42, 20260915, 5, 99].map((seed) => {
    const state = clearedRoomState(seed, 0);
    return state.upgradeChoice.options.join(",");
  });

  /* Same seed twice: the offer replays exactly. */
  assert.equal(offered[0], clearedRoomState(1, 0).upgradeChoice.options.join(","));
  assert.ok(new Set(offered).size > 1, `runs must diverge, got ${offered.join(" | ")}`);
});

test("taking a card applies it once and records the pick", () => {
  const state = clearedRoomState(Core.DEFAULT_SEED, 0);
  const options = state.upgradeChoice.options.slice();
  const player = state.player;

  assert.equal(Core.chooseUpgrade(state, "not-offered"), false, "only offered cards count");
  assert.ok(state.upgradeChoice, "a rejected pick leaves the chooser open");

  assert.equal(Core.chooseUpgrade(state, options[0]), true);
  assert.equal(state.upgradeChoice, null, "the chooser closes after a pick");
  assert.deepEqual(player.upgradesTaken, [options[0]]);
  assert.equal(
    Core.chooseUpgrade(state, options[1]),
    false,
    "the same room cannot pay out twice"
  );
});

test("every upgrade in the pool changes the player's numbers", () => {
  const cases = [
    ["attack", (p) => p.attackBonus],
    ["attackSpeed", (p) => p.attackSpeed],
    ["maxHp", (p) => p.maxHp],
    ["mpRegen", (p) => p.mpRegen],
    ["skillPower", (p) => p.skillPower]
  ];

  cases.forEach(([id, read]) => {
    const state = lastRoomState();
    const before = read(state.player);
    Core.UPGRADES[id].apply(state.player);
    assert.ok(
      read(state.player) > before,
      `${id} must raise its stat: ${before} -> ${read(state.player)}`
    );
  });

  /* The two stat upgrades have to matter to the simulation, not just the numbers. */
  const regen = lastRoomState();
  regen.player.mp = 0;
  Core.UPGRADES.mpRegen.apply(regen.player);
  Core.runFrames(regen, Core.FPS, {});
  assert.ok(
    regen.player.mp > Core.PLAYER.mpRegenPerSecond,
    `extra regen must refill MP faster, got ${regen.player.mp}`
  );

  const power = lastRoomState();
  const plain = lastRoomState();
  power.player.skillPower = 2;
  [power, plain].forEach((state) => {
    const dummy = Core.createEnemy(state, "brute", state.player.x + 40);
    dummy.maxHp = 100000;
    dummy.hp = 100000;
    dummy.speed = 0;
    state.enemies = [dummy];
    Core.step(state, { skills: { upSlash: true } });
    Core.runFrames(state, 40, {});
  });
  assert.ok(
    power.stats.damageDealt > plain.stats.damageDealt,
    `skill power must scale skill damage: ${plain.stats.damageDealt} -> ${power.stats.damageDealt}`
  );
});

test("upgrades stack across the run", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const taken = [];
  const roomsThisRun = state.layout.length;
  for (let room = 0; room < roomsThisRun - 1; room += 1) {
    killAll(state);
    Core.step(state, {});
    assert.ok(state.upgradeChoice, `room ${room + 1} must offer an upgrade`);
    const pick = preferredUpgrade(state.upgradeChoice.options);
    taken.push(pick);
    Core.chooseUpgrade(state, pick);
    if (room < roomsThisRun - 2) {
      state.player.x = Core.ARENA.rightWall - state.player.width / 2;
      Core.step(state, {});
    }
  }

  assert.equal(
    state.player.upgradesTaken.length,
    roomsThisRun - 1,
    "every cleared room but the last pays out exactly one upgrade"
  );
  assert.deepEqual(state.player.upgradesTaken, taken);
});

test("the last room still ends the run instead of offering a reward", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: lastRoomIndex() });
  killAll(state);
  Core.step(state, {});

  assert.equal(state.victory, true);
  assert.equal(state.upgradeChoice, null, "the throne room pays out with victory, not a card");
});

test("the renderer lays out three tap targets and hit-tests them", () => {
  const cards = Render.upgradeCards();
  assert.equal(cards.length, Core.UPGRADES_PER_ROOM);
  cards.forEach((card, index) => {
    assert.equal(Render.hitTestUpgrade(card.x + card.w / 2, card.y + card.h / 2), index);
    assert.equal(card.action, "choice" + index);
  });
  assert.equal(Render.hitTestUpgrade(2, 2), null, "dead space is not a card");

  const state = clearedRoomState(Core.DEFAULT_SEED, 0);
  const names = state.upgradeChoice.options.map((id) => Core.UPGRADES[id].name);
  const calls = [];
  Render.render(recordingContext(calls), state, {});
  const texts = calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  names.forEach((name) => {
    assert.ok(texts.includes(name), `the chooser must label ${name}`);
  });
  assert.ok(
    texts.some((text) => text.includes("选一个强化")),
    "the chooser must say what it is"
  );
});

test("the elite mini-boss telegraphs a spin that sweeps a wide lane", () => {
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + 120);
  state.enemies = [elite];
  /* Pin it down so the sweep itself, not a chase, is what threatens the player. */
  elite.speed = 0;
  elite.attackRange = 0;
  const startX = elite.x;

  let telegraphed = false;
  let sawSuperArmor = false;
  let sweptForward = false;
  for (let frame = 0; frame < 60 * 6 && state.stats.damageTaken === 0; frame += 1) {
    Core.step(state, {});
    if (state.effects.some((effect) => effect.kind === "telegraph" && effect.text === "SPIN")) {
      telegraphed = true;
    }
    if (elite.attackKind === "spin" && elite.attackTimer > 0 && elite.superArmor) {
      sawSuperArmor = true;
    }
    if (Math.abs(elite.x - startX) > 20) sweptForward = true;
  }

  assert.ok(telegraphed, "the spin must telegraph before it lands");
  assert.ok(sawSuperArmor, "the spin must carry super armour");
  assert.ok(sweptForward, "the sweep must carry the elite forward, not just spin in place");
  assert.equal(state.stats.damageTaken, Core.ENEMY_TYPES.elite.spinDash.damage);

  /* Let the recovery play out: super armour belongs to the sweep alone. */
  Core.runFrames(state, 60, {});
  assert.equal(elite.superArmor, false, "super armour must end with the sweep");
});

test("the spin is answerable: backing out of the lane avoids it", () => {
  const run = (retreat) => {
    const state = lastRoomState();
    const elite = Core.createEnemy(state, "elite", state.player.x + 120);
    state.enemies = [elite];
    elite.speed = 0;
    elite.attackRange = 0;
    for (let frame = 0; frame < 60 * 5; frame += 1) {
      Core.step(state, retreat ? { left: true } : {});
    }
    return state.stats.damageTaken;
  };

  assert.equal(
    run(false),
    Core.ENEMY_TYPES.elite.spinDash.damage,
    "standing in the lane gets clipped"
  );
  assert.equal(run(true), 0, "leaving the lane avoids the sweep");
});

test("the elite mini-boss always pays out a bigger heal orb", () => {
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + 60);
  state.enemies = [elite];

  Core.damageEnemy(state, elite, 9999, 0, state.player.x);

  assert.equal(state.pickups.length, 1, "the elite must always drop");
  assert.equal(state.pickups[0].value, Core.DROPS.eliteHeal);
  assert.ok(
    Core.DROPS.eliteHeal > Core.DROPS.playerHeal &&
      Core.DROPS.eliteHeal < Core.DROPS.bossHeal,
    "the mini-boss pays out between a grunt and the boss"
  );
});

test("the elite is a mini-boss, not a second boss: no phase two, no boss drop", () => {
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + 90);
  state.enemies = [elite];

  assert.equal(elite.phase2, null, "only the Goblin King enrages");
  assert.equal(elite.phase, 1);
  Core.damageEnemy(state, elite, elite.maxHp * 0.6, 0, state.player.x);
  assert.equal(elite.phase, 1, "the elite never enters a second phase");
  assert.equal(
    Core.enterPhase2(state, elite),
    false,
    "the elite must refuse a phase change"
  );
});

test("the renderer draws the elite's whirl while it spins", () => {
  /* The elite has to read as a separate rank on screen, not recoloured chaff. */
  const eliteState = lastRoomState();
  const elite = Core.createEnemy(eliteState, "elite", eliteState.player.x + 120);
  eliteState.enemies = [elite];
  elite.attackKind = "melee";
  elite.attackTimer = 0;
  const calm = [];
  Render.render(recordingContext(calm), eliteState, {});
  const calmArcs = calm.filter((call) => call[0] === "arc").length;

  elite.attackKind = "spin";
  elite.attackDuration = 1.7;
  elite.attackTimer = 1;
  const whirling = [];
  Render.render(recordingContext(whirling), eliteState, {});
  const whirlArcs = whirling.filter((call) => call[0] === "arc").length;
  assert.ok(
    whirlArcs >= calmArcs + 2,
    `the whirl must draw its blades while spinning: ${calmArcs} -> ${whirlArcs}`
  );
});

test("the renderer gives the enraged boss its own palette, aura and bar label", () => {
  const calls = [];
  const ctx = recordingContext(calls);

  const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: lastRoomIndex() });
  const boss = state.enemies.find((enemy) => enemy.type === "boss");
  boss.hp = boss.maxHp * 0.8;
  state.enemies = [boss];

  calls.length = 0;
  Render.render(ctx, state, {});
  const calmArcs = calls.filter((call) => call[0] === "arc").length;
  const calmTexts = calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
  assert.ok(calmTexts.includes("GOBLIN KING"), "phase one keeps the plain bar label");
  assert.equal(
    calmTexts.some((text) => String(text).includes("狂暴")),
    false,
    "phase one must not claim to be enraged"
  );

  Core.enterPhase2(state, boss);
  calls.length = 0;
  Render.render(ctx, state, {});
  const enragedArcs = calls.filter((call) => call[0] === "arc").length;
  const enragedTexts = calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
  assert.ok(
    enragedTexts.some((text) => String(text).includes("狂暴")),
    "the bar must read as enraged in phase two"
  );
  assert.ok(
    enragedArcs > calmArcs,
    `the enrage aura must add draw calls: ${calmArcs} -> ${enragedArcs}`
  );
});

test("the title screen shows the seed record and a clear shows the result", () => {
  const textsFrom = (calls) =>
    calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  const run = {
    seed: 7,
    improved: false,
    seedText: "种子 7",
    recordText: "本种子最佳 0:44.4 · Lv 4 · 已通关 2 次（累计 3 次）",
    resultText: "本次 0:52.0 · Lv 5"
  };

  const titleCalls = [];
  Render.render(recordingContext(titleCalls), Core.createState({ seed: 7 }), {
    showHelp: true,
    run: run
  });
  const titleTexts = textsFrom(titleCalls);
  assert.ok(titleTexts.includes("种子 7"), `title must show the seed: ${titleTexts.join(" / ")}`);
  assert.ok(
    titleTexts.some((text) => text.includes("本种子最佳 0:44.4")),
    "title must show this seed's best"
  );
  assert.ok(titleTexts.includes("按 N 换一个种子"), "title must offer a fresh seed");

  const cleared = Core.createState({ seed: 7, roomIndex: lastRoomIndex() });
  cleared.victory = true;
  const clearCalls = [];
  Render.render(recordingContext(clearCalls), cleared, {
    run: { seed: 7, improved: true, resultText: "新纪录！ 0:44.4 · Lv 4", recordText: run.recordText }
  });
  const clearTexts = textsFrom(clearCalls);
  assert.ok(clearTexts.includes("DUNGEON CLEARED"));
  assert.ok(
    clearTexts.some((text) => text.includes("新纪录！")),
    `a record run must say so: ${clearTexts.join(" / ")}`
  );
  assert.ok(
    clearTexts.some((text) => text.includes("本种子最佳")),
    "the clear screen must repeat the standing record"
  );
});

test("the renderer shows a hint in play and hides it behind overlays", () => {
  const hint = {
    id: "upgrade",
    text: "选一张强化卡：按 1 / 2 / 3，或直接点卡片",
    life: 5,
    maxLife: 5
  };
  const textsFor = (meta) => {
    const calls = [];
    Render.render(recordingContext(calls), Core.createState({ seed: Core.DEFAULT_SEED }), meta);
    return calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  };

  assert.ok(textsFor({ hint }).includes(hint.text), "live play shows the coaching line");
  assert.equal(
    textsFor({ showHelp: true, hint }).includes(hint.text),
    false,
    "the title screen must not show coaching over the art"
  );
  assert.equal(
    textsFor({ paused: true, hint }).includes(hint.text),
    false,
    "a paused frame must not show coaching either"
  );
  assert.equal(textsFor({}).includes(hint.text), false, "no active hint means no line");
});

test("the reward chooser never shows through a full-screen overlay", () => {
  const state = clearedRoomState(Core.DEFAULT_SEED, 0);
  assert.ok(state.upgradeChoice, "precondition: a reward choice is pending");

  const textsFor = (meta) => {
    const calls = [];
    Render.render(recordingContext(calls), state, meta);
    return calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  };

  assert.ok(
    textsFor({}).some((text) => text.includes("选一个强化")),
    "live play must show the chooser"
  );

  [
    ["pause", { paused: true }],
    ["title", { showHelp: true }]
  ].forEach(([label, meta]) => {
    assert.equal(
      textsFor(meta).some((text) => text.includes("选一个强化")),
      false,
      `the chooser must stay hidden behind the ${label} overlay`
    );
  });

  state.victory = true;
  assert.equal(
    textsFor({}).some((text) => text.includes("选一个强化")),
    false,
    "the victory overlay hides the chooser too"
  );
});

test("the room banner waits for live play instead of freezing behind an overlay", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const banner = state.effects.find((effect) => effect.kind === "banner");
  assert.ok(banner, "a fresh run starts with a room banner queued");

  const textsFor = (meta) => {
    const calls = [];
    Render.render(recordingContext(calls), state, meta);
    return calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  };

  assert.ok(textsFor({}).includes(banner.text), "live play announces the room");
  assert.equal(
    textsFor({ showHelp: true }).includes(banner.text),
    false,
    "the title overlay must not show a half-faded room banner"
  );
  assert.equal(
    textsFor({ paused: true }).includes(banner.text),
    false,
    "a paused frame must not show the banner either"
  );

  /* Held back, not consumed: it still announces the room once play resumes. */
  assert.ok(
    state.effects.some((effect) => effect.kind === "banner"),
    "the queued banner is left alone"
  );
  assert.ok(textsFor({}).includes(banner.text), "and it appears when play resumes");
});

test("a run without a record yet says so instead of inventing one", () => {
  const calls = [];
  Render.render(recordingContext(calls), Core.createState({ seed: 7 }), {
    showHelp: true,
    run: { seed: 7, seedText: "种子 7", recordText: "本种子还没有通关记录", improved: false }
  });
  const texts = calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  assert.ok(texts.some((text) => text.includes("还没有通关记录")));
  assert.equal(
    texts.some((text) => text.includes("新纪录")),
    false,
    "an unfinished run cannot claim a record"
  );
});

test("the room banner moves clear of the boss bar and the help quotes the real room count", () => {
  const bannerY = (roomIndex) => {
    const calls = [];
    const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex });
    /* Drop the state's own room banner so ours is the first in the stack. */
    state.effects = state.effects.filter((effect) => effect.kind !== "banner");
    state.effects.push({ kind: "banner", text: "ROOM BANNER", life: 1, maxLife: 1 });
    Render.render(recordingContext(calls), state, {});
    const call = calls.find((entry) => entry[0] === "fillText" && entry[1] === "ROOM BANNER");
    assert.ok(call, "the banner must be drawn");
    return call[3];
  };

  const plain = bannerY(0);
  const withBoss = bannerY(lastRoomIndex());
  assert.equal(plain, 104, "a normal room keeps the established banner placement");
  assert.ok(
    withBoss > plain,
    `the banner must clear the boss bar: plain=${plain} bossRoom=${withBoss}`
  );
  assert.ok(
    withBoss >= 200,
    `the boss-room banner must drop below the HUD and bar band, got y=${withBoss}`
  );

  const calls = [];
  const help = Core.createState({ seed: Core.DEFAULT_SEED });
  Render.render(recordingContext(calls), help, { showHelp: true });
  const texts = calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  assert.ok(
    texts.some((text) => text.includes(`第 ${help.layout.length} 层`)),
    `the help overlay must quote the run length (${help.layout.length}): ${texts.join(" / ")}`
  );

  /* Killing the boss stacks "Boss down!" and "Dungeon cleared!" in the same frame. */
  const stacked = [];
  const cleared = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: lastRoomIndex() });
  cleared.effects.push({ kind: "banner", text: "Boss down!", life: 1, maxLife: 1 });
  cleared.effects.push({ kind: "banner", text: "Dungeon cleared!", life: 1, maxLife: 1 });
  Render.render(recordingContext(stacked), cleared, {});
  const first = stacked.find((call) => call[0] === "fillText" && call[1] === "Boss down!")[3];
  const second = stacked.find((call) => call[0] === "fillText" && call[1] === "Dungeon cleared!")[3];
  assert.notEqual(first, second, "stacked banners must not overprint each other");
});
