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

/*
 * The stage these tests run: 幽暗密林 is the only one with rooms so far, and a
 * run is one stage now (`docs/adr/0026`). The pool, the gauntlet index and the
 * boss index are read off the stage rather than spelled out here, so filling in
 * the other seven stages cannot silently re-point this file at a stale room.
 */
const STAGE = Core.STAGES.mirkwood;
const ROOMS = STAGE.rooms;

/**
 * 一局地牢里的每一格摆的是哪间房（`docs/adr/0030`）。
 *
 * 换种子换的是**哪间房摆在哪一格**，地牢的形状一格都不动 —— 所以测试里凡是要
 * "这个种子的某一格是什么内容"，都得从这里读，不能自己假设顺序。
 */
function runCells(seed) {
  const state = Core.createState({
    seed: seed === undefined ? Core.DEFAULT_SEED : seed,
    stage: "mirkwood"
  });
  return state.dungeon.cells.map((cell) => ROOMS[cell.room]);
}

function enemiesInRun(seed) {
  return runCells(seed).reduce((total, room) => total + room.enemies.length, 0);
}

/** 哪一格摆着带 caster 的那间房，-1 表示这次洗牌没摆上去。 */
function cellWithCaster(seed) {
  return runCells(seed).findIndex((room) =>
    room.enemies.some((enemy) => enemy.type === "caster")
  );
}

/**
 * Boss 房那一格，人清空、站在那儿不动。
 *
 * 最后一格不会再往前走（Boss 房的另一头没有门），所以"只想量走位、不想换房"的测试
 * 都从这儿开始；换房那几条自己走门口，见 `walkToDoor`。
 */
/** 把这一局摆到"某一格"上：找一格摆着这间房的格子，人站过去。 */
function stateInCell(seed, seat) {
  const state = Core.createState({
    seed: seed === undefined ? Core.DEFAULT_SEED : seed,
    stage: "mirkwood"
  });
  Core.goToCell(state, seat);
  return state;
}

/** 摆到"某一间房"上：找它被洗到哪一格。 */
function stateInRoom(seed, roomIndex) {
  const state = Core.createState({
    seed: seed === undefined ? Core.DEFAULT_SEED : seed,
    stage: "mirkwood"
  });
  const at = state.dungeon.cells.findIndex((cell) => cell.room === roomIndex);
  assert.ok(at >= 0, `${ROOMS[roomIndex].name} is not dealt into this seed's dungeon`);
  Core.goToCell(state, at);
  return state;
}

/** 一间没有自己地面带的房（默认地面带那几条要量的就是它）。 */
function plainRoomIndex() {
  return ROOMS.findIndex((room) => !room.band);
}

/**
 * 一间空房，**门全焊死**。
 *
 * 清过的房间每一扇门都开是规矩（`exitMode`），可是"往一个方向走到底会被墙/背板拦住"
 * 这类测试要的正是**没有门口来接手**：门口是按地图方向开的（`docs/adr/0030`），不焊死
 * 的话人走着走着就换房了。这是脚手架，不是玩法。
 */
function sealedRoomState(seed, roomIndex) {
  const state = roomIndex === undefined
    ? stateInCell(seed, dungeonState(seed).dungeon.boss)
    : stateInRoom(seed, roomIndex);
  state.enemies = [];
  state.room.cleared = true;
  state.dungeon.cells[state.cell].cleared = true;
  state.dungeon.cells[state.cell].exits = 0;
  return state;
}

/** Boss 房那一格，清空、焊门。 */
function lastRoomState(seed) {
  return sealedRoomState(seed);
}

/**
 * 走到这一格某一扇开着的门口，返回用了多少帧；走不到就返回 -1。
 *
 * 门口是按地图方向立的，所以"往右走到底"不再能换房：左右门走到对应的墙，上门走到
 * 房间深处那扇（先横向对上门的 x），下门朝观众走到底。
 */
/**
 * 走到这一格某一扇开着的门口，返回用了多少帧；走不到就返回 -1。
 *
 * 门口是按地图方向立的，所以"往右走到底"不再能换房：左右门走到对应的墙，上门走到
 * 房间深处那扇（先横向对上门的 x），下门朝观众走到底。
 */

/**
 * 走到这一格某一扇开着的门口，返回用了多少帧；走不到就返回 -1。
 *
 * 门口是按地图方向立的，所以"往右走到底"不再能换房：左右门走到对应的墙，上门走到
 * 房间深处那扇（先横向对上门的 x），下门朝观众走到底。树和石头是实心的（`docs/adr/0032`），
 * 所以这一路是**绕过去**的，不是"一直按着方向键"。
 */
function walkToDoor(state, dir, frames) {
  const budget = frames || 60 * 12;
  const cell = Core.currentCell(state);
  const doorX = Core.doorX(state, cell, dir);
  const depth = Core.bandDepth(state.band);
  const input = {
    left: false, right: false, up: false, down: false, jump: false, attack: false, skills: {}
  };
  for (let frame = 0; frame < budget; frame += 1) {
    const player = state.player;
    /* 目标点要**站进门口判定区里**（`DOOR.side`/`DOOR.depth`），不是站在门口外面。 */
    const targetX =
      dir === "N" || dir === "S"
        ? doorX
        : dir === "E"
          ? Core.roomRight(state) - Core.DOOR.side / 2
          : Core.roomLeft(state) + Core.DOOR.side / 2;
    const targetZ =
      dir === "N"
        ? depth - Core.DOOR.depth / 2
        : dir === "S"
          ? Core.DOOR.depth / 2
          : player.z;
    const move = Core.routeStep(state, targetX, targetZ);
    const step = { ...input };
    if (move[0] > 0) step.right = true;
    if (move[0] < 0) step.left = true;
    if (move[1] > 0) step.up = true;
    if (move[1] < 0) step.down = true;
    const before = state.cell;
    Core.step(state, step);
    if (state.cell !== before) return frame;
  }
  return -1;
}

/**
 * 一条**净空的竖道**：这一列上没有实心布景挡路。
 *
 * 树和石头从 `docs/adr/0032` 起是实心的（人和怪都撞得到），而"地面带有多深"这类测试
 * 只想量地板、不想量布景 —— 所以先找一条没人站的列，把他放过去。
 */
function clearLaneX(state) {
  const player = state.player;
  const props = (state.props || []).filter((prop) => prop.solid && !prop.broken);
  for (let x = Core.ROOM.leftWall + 40; x < Core.ROOM.rightWall - 40; x += 6) {
    const blocked = props.some((prop) => {
      const box = Core.propBox(prop.piece);
      return Math.abs(x - (prop.x + (box.dx || 0))) <= box.width / 2 + player.width / 2;
    });
    if (!blocked) return x;
  }
  return player.x;
}

function killAll(state) {
  /*
   * Hit until it is dead: an elite or a boss gets a 回避 roll per hit
   * (docs/adr/0018), and every caller of this helper wants an empty room, not
   * a fight. The roll comes off the same seeded stream as everything else, so
   * "one big hit" lands or misses depending on how many numbers the code has
   * drawn before it - which changes whenever anything upstream does.
   */
  /*
   * **Also drain the second wave** (docs/adr/0037 追记三): killing the first
   * wave only leaves `room.pendingWave` on the clock, so "empty room" means
   * stepping until those have walked in and killing them too. The loop is
   * capped: a room has at most two waves.
   */
  for (let round = 0; round < 6; round += 1) {
    state.enemies.slice().forEach((enemy) => {
      for (let hit = 0; !enemy.dead && hit < 50; hit += 1) {
        Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
      }
    });
    if (!state.room || !state.room.pendingWave || state.room.pendingWave.length === 0) break;
    Core.step(state, {});
  }
}

test("player runs right and is clamped by the arena wall", () => {
  const state = lastRoomState();
  state.player.x = Core.ROOM.rightWall - 70;

  Core.runFrames(state, 60, { right: true });

  assert.equal(state.player.x, Core.ROOM.rightWall - state.player.width / 2);
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
  /*
   * Placed clear of the bodies on purpose: a brute is 68 wide and the Slayer 34,
   * so a fixed +48 put them overlapping and the push-apart walked the target out
   * of reach between cuts. The gap comes from the two bodies instead.
   */
  const inReach = (Core.ENEMY_TYPES.brute.width + Core.PLAYER.width) / 2 + 10;
  const enemy = Core.createEnemy(state, "brute", state.player.x + inReach);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  const stages = Core.ATTACK_STAGES;
  assert.equal(stages.length, 3, "the owner's chain is three cuts");

  const hits = [];
  for (let swing = 0; swing < stages.length; swing += 1) {
    enemy.x = state.player.x + inReach;
    const hpBefore = enemy.hp;
    Core.step(state, { attack: true });
    assert.equal(state.player.comboIndex, swing, `press ${swing + 1} plays stage ${swing}`);
    Core.runFrames(state, 24, {});
    hits.push(hpBefore - enemy.hp);
  }

  assert.deepEqual(hits, Core.PLAYER.comboDamage);
  assert.equal(state.player.comboIndex, stages.length - 1);
});

test("a landed normal cut stops the world for three frames", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 55);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  Core.step(state, { attack: true });
  let hit = false;
  for (let frame = 0; frame < 30 && !hit; frame += 1) {
    Core.runFrames(state, 1, {});
    hit = state.hitStop > 0;
  }
  assert.ok(hit, "the cut lands");
  const swing = state.player.attackTimer;
  const hp = enemy.hp;
  const clock = state.time;
  let frozen = 0;
  while (state.hitStop > 0) {
    Core.runFrames(state, 1, {});
    frozen += 1;
    assert.equal(state.player.attackTimer, swing, "the swing holds still");
    assert.equal(enemy.hp, hp, "the monster takes no further tick");
  }
  assert.equal(frozen, 3, "0.05s is three 60fps frames");
  assert.ok(
    state.time >= clock + 3 * Core.DT - 0.0001,
    "but the clock keeps running"
  );
  Core.runFrames(state, 1, {});
  assert.ok(state.player.attackTimer < swing, "and then the swing resumes");
});

test("a skill pressed during hit stop is not swallowed", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;
  state.hitStop = 0.1;

  Core.step(state, { skills: { upSlash: true } });
  assert.ok(state.skillBuffer && state.skillBuffer.id === "upSlash", "the press is remembered");
  assert.equal(state.player.skillId, null, "the world is still frozen on the hit");

  let frames = 0;
  while (state.player.skillId !== "upSlash" && frames < 30) {
    Core.runFrames(state, 1, {});
    frames += 1;
  }
  assert.equal(state.player.skillId, "upSlash", "the first unfrozen step casts it");
  assert.equal(state.skillBuffer, null, "and the buffer is spent once");
});

test("an attack pressed during hit stop is remembered", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.hitStop = 0.05;

  Core.step(state, { attack: true });
  assert.equal(
    state.player.attackBuffer,
    Core.PLAYER.attackBuffer,
    "the press is remembered through the freeze"
  );
  let frames = 0;
  while (state.stats.swings < 1 && frames < 30) {
    Core.runFrames(state, 1, {});
    frames += 1;
  }
  assert.equal(state.stats.swings, 1, "the first unfrozen step swings");
});

test("a jump pressed during hit stop is remembered", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.hitStop = 0.05;

  Core.step(state, { jump: true });
  assert.equal(
    state.player.jumpBuffer,
    Core.PLAYER.jumpBuffer,
    "the jump is remembered through the freeze"
  );
  let frames = 0;
  while (state.player.onGround && frames < 30) {
    Core.runFrames(state, 1, {});
    frames += 1;
  }
  assert.equal(state.player.onGround, false, "the first unfrozen step jumps");
});

test("a landed skill hit stops the world for its own beat", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 40);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];
  state.player.mp = state.player.maxMp;

  const hp = enemy.hp;
  Core.step(state, { skills: { upSlash: true } });
  let hit = false;
  for (let frame = 0; frame < 60 && !hit; frame += 1) {
    Core.runFrames(state, 1, {});
    hit = enemy.hp < hp && state.hitStop > 0;
  }
  assert.ok(hit, "上挑 lands");
  assert.equal(
    state.hitStop,
    Core.SKILL_HIT_STOP.upSlash,
    "its stop comes from the skill table, not the normal chain"
  );
  const skill = state.player.skillTimer;
  let frozen = 0;
  while (state.hitStop > 0) {
    Core.runFrames(state, 1, {});
    frozen += 1;
    assert.equal(state.player.skillTimer, skill, "the cast holds still");
  }
  assert.equal(frozen, 3, "0.05s is three 60fps frames");
  Core.runFrames(state, 1, {});
  assert.ok(state.player.skillTimer < skill, "and then the cast resumes");
});

test("a non-fatal hit on him does not freeze the world; the killing blow does", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.invuln = 0;
  const hp = state.player.hp;
  Core.damagePlayer(state, 10, state.player.x + 50);
  assert.ok(state.player.hp < hp, "the hit lands");
  /*
   * 非致命不冻（`docs/adr/0061` 追记二）：3 帧停顿实测把浏览器机器人拖进和
   * 胆小哥布林的换血循环，先不做。致命那一下仍停 6 帧。
   */
  assert.equal(state.hitStop, 0, "a non-fatal hit does not stop the world");

  const fatal = lastRoomState();
  fatal.enemies = [];
  fatal.player.invuln = 0;
  fatal.player.hp = 5;
  Core.damagePlayer(fatal, 10, fatal.player.x + 50);
  assert.ok(fatal.player.dead, "the hit kills him");
  assert.equal(fatal.hitStop, Core.HIT_STOP.kill, "the killing blow still stops");

  /* 霸体: the cast keeps its feet - no stop either. */
  const armored = lastRoomState();
  armored.enemies = [];
  armored.player.invuln = 0;
  armored.player.skillId = "graspHead";
  armored.player.skillTimer = 0.5;
  Core.damagePlayer(armored, 10, armored.player.x + 50);
  assert.equal(armored.hitStop, 0, "super armour takes the damage without the freeze");
});

test("the third normal cut knocks the monster down; the first two only push", () => {
  const state = lastRoomState();
  const inReach = (Core.ENEMY_TYPES.brute.width + Core.PLAYER.width) / 2 + 10;
  const enemy = Core.createEnemy(state, "brute", state.player.x + inReach);
  enemy.hp = 9999;
  enemy.maxHp = 9999;
  enemy.speed = 0;
  state.enemies = [enemy];

  const reactions = [];
  for (let press = 0; press < 3; press += 1) {
    enemy.x = state.player.x + inReach;
    enemy.z = state.player.z;
    enemy.onGround = true;
    enemy.knockdown = 0;
    enemy.vy = 0;
    const hp = enemy.hp;
    Core.step(state, { attack: true });
    assert.equal(state.player.comboIndex, press, `press ${press + 1} plays stage ${press}`);
    let frames = 0;
    while (enemy.hp === hp && frames < 40) {
      Core.runFrames(state, 1, {});
      frames += 1;
    }
    assert.ok(enemy.hp < hp, `press ${press + 1} connects`);
    reactions.push(enemy.knockdown > 0 || !enemy.onGround);
    /* 这一刀（含停顿）走完，趁 combo 窗口还在，按下一段。 */
    let guard = 0;
    while (state.player.attackTimer > 0 && guard < 60) {
      Core.runFrames(state, 1, {});
      guard += 1;
    }
  }
  assert.deepEqual(reactions, [false, false, true]);
});

test("an attack pressed during the swing is remembered", () => {
  const state = lastRoomState();
  state.enemies = [];
  Core.step(state, { attack: true });
  assert.equal(state.stats.swings, 1);
  Core.runFrames(state, 3, {});
  /* 挥砍中按一下再松开：原来这一下会被吞掉。 */
  Core.step(state, { attack: true });
  assert.equal(
    state.player.attackBuffer,
    Core.PLAYER.attackBuffer,
    "the press is remembered"
  );
  let guard = 0;
  while (state.stats.swings < 2 && guard < 60) {
    Core.runFrames(state, 1, {});
    guard += 1;
  }
  assert.equal(state.stats.swings, 2, "the remembered press starts the next cut");
  assert.equal(state.player.comboIndex, 1);
});

test("a dead monster lies down, turns into its own white silhouette, then bursts into its own colour", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.goToCell(state, state.dungeon.boss);
  const mob = state.enemies.find((enemy) => enemy.type !== "boss");
  assert.ok(mob, "Boss 房里还有小怪");
  /*
   * 其余的小兵也一并解决 —— 通关条件是"这一间清干净"，Boss 房的小兵也是兵。
   * 这条断言原来默认"Boss 房只有一只小兵"，那是房间内容的一个巧合，不是规矩。
   */
  state.enemies
    .filter((enemy) => enemy !== mob && enemy.type !== "boss")
    .forEach((enemy) => Core.damageEnemy(state, enemy, 99999, 0, state.player.x));

  Core.damageEnemy(state, mob, 99999, 0, state.player.x);
  /*
   * 业主的口径（`docs/adr/0034`）：「怪物确实会躺着死，然后出现白色怪物轮廓，
   * 然后碎裂成血块（和怪物颜色一样）散向四处」。
   */
  assert.ok(mob.dying > 0, "先躺着");
  assert.ok(!mob.silhouette, "躺着的这一段还是它自己");
  Core.runFrames(state, Math.ceil(Core.DEATH.lie * Core.FPS) - 3, {});
  assert.ok(!mob.silhouette, "躺够之前不许变白");

  Core.runFrames(state, 6, {});
  assert.ok(mob.silhouette, "躺够了下一次就是白色剪影");
  assert.ok(
    !state.effects.some((effect) => effect.kind === "deathburst"),
    "剪影还亮着，这时候还没炸"
  );

  /* 剪影亮 `DEATH.shape` 秒，然后炸开。 */
  Core.runFrames(state, Math.ceil(Core.DEATH.shape * Core.FPS) + 2, {});
  const burst = state.effects.find((effect) => effect.kind === "deathburst");
  assert.ok(burst, "剪影散的那一刻炸开");
  assert.equal(burst.type, mob.type, "碎块用的是这只怪自己的色号");
  assert.equal(burst.maxLife, Core.DEATH.chunks);
  assert.ok(!state.enemies.includes(mob), "炸完尸体从场上没了");

  /* 碎块飞完化掉，地上什么都不许剩。 */
  Core.runFrames(state, Math.ceil(Core.DEATH.chunks * Core.FPS) + 2, {});
  assert.equal(
    state.effects.filter((effect) => effect.kind === "deathburst").length,
    0,
    "碎块化干净"
  );

  /* Boss：几乎立刻变白；白剪影之后是魂球 + 碎块，**而且碎块要留在场上**。 */
  const boss = state.enemies.find((enemy) => enemy.type === "boss");
  /* Boss 每一击都掷一次回避（`docs/adr/0018`），一刀不一定砍得死。 */
  for (let hit = 0; hit < 50 && !boss.dead; hit += 1) {
    Core.damageEnemy(state, boss, 999999, 0, state.player.x);
  }
  assert.equal(boss.dying, Core.DEATH.bossLie + Core.DEATH.bossSmoke, "Boss 那一片白更大更久");
  Core.runFrames(state, Math.ceil(Core.DEATH.bossLie * Core.FPS) + 2, {});
  assert.ok(boss.silhouette, "Boss 也变白（几乎立刻，没有可见的躺下拍）");
  Core.runFrames(state, Math.ceil(Core.DEATH.bossSmoke * Core.FPS) + 2, {});
  const bossBurst = state.effects.filter(
    (effect) => effect.kind === "deathburst" && effect.seed === boss.id
  );
  assert.equal(bossBurst.length, 1, "Boss 也要炸出它自己的碎块");
  assert.equal(bossBurst[0].type, "boss", "碎块用 chunk_boss 那一族");
  /* 死亡特效（白剪影 + 碎块）演完才进胜利页（业主 2026-10-18）。 */
  Core.runFrames(state, Math.ceil((Core.DEATH.bossChunks + 0.5) * Core.FPS) + 2, {});
  assert.equal(state.victory, true, "Boss 房打掉就通关");
});

test("每只怪死都走同一条线：躺 → 白色剪影 → 自己颜色的碎块", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.goToCell(state, 0);
  const killed = state.enemies.slice();
  killed.forEach((enemy) => {
    Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
  });
  assert.equal(
    state.enemies.filter((enemy) => enemy.dead).length,
    killed.length,
    "躺着的都在名单里（收尸要等剪影走完）"
  );

  /* 躺 → 白：每一只都变，一只不落。 */
  Core.runFrames(state, Math.ceil(Core.DEATH.lie * Core.FPS) + 2, {});
  killed.forEach((enemy) => {
    assert.ok(enemy.silhouette, `${enemy.type} 也要变白`);
  });

  /* 白 → 炸：每只一份，用的是它自己的色号。 */
  Core.runFrames(state, Math.ceil(Core.DEATH.shape * Core.FPS) + 2, {});
  const bursts = state.effects.filter((effect) => effect.kind === "deathburst");
  assert.equal(bursts.length, killed.length, "一只一份碎块，不多不少");
  const kinds = new Set(killed.map((enemy) => enemy.type));
  kinds.forEach((kind) => {
    assert.ok(
      bursts.some((effect) => effect.type === kind),
      `${kind} 的碎块要用它自己的色号`
    );
  });
  assert.equal(
    state.enemies.filter((enemy) => enemy.dead).length,
    0,
    "炸完尸体都不在名单里"
  );

  /* 碎块化完，场上干干净净。 */
  Core.runFrames(state, Math.ceil(Core.DEATH.chunks * Core.FPS) + 4, {});
  assert.equal(
    state.effects.filter((effect) => effect.kind === "deathburst").length,
    0,
    "碎块都化干净了"
  );
});

test("a cleared room opens its doors and lets him walk out", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const from = state.dungeon.cells[state.cell];
  killAll(state);
  Core.step(state, {});

  assert.equal(state.room.cleared, true);
  /*
   * **清房不发强化卡**（业主 2026-10-17；`docs/adr/0053`）：门在清房那一刻就开，
   * 没有人再拦着他，也没有「选完卡才放行」那一步。
   */
  assert.equal(state.upgradeChoice, undefined);

  /*
   * 门口是按地图方向立的（`docs/adr/0030`），所以测试也得按方向走到那扇门：起点房
   * 只有一个北出口，往上走到房间深处才算站进门口。
   */
  const dir = "NESW".split("").find((d) => Core.exitMode(state, d) === "open");
  assert.equal(dir, "N", "the entry room of this dungeon opens north");
  const frames = walkToDoor(state, dir);
  assert.ok(frames >= 0, "the door has to let him through");
  assert.notEqual(state.cell, state.dungeon.entry);
  assert.equal(state.cell, Core.doorNeighbour(state.dungeon, from, dir));
  assert.equal(state.entryDoor, "S", "he came in the far side of that door");
  assert.equal(state.room.cleared, false);
  assert.ok(state.enemies.length > 0, "an uncleared room fields its roster");
  assert.ok(state.transition > 0, "a room change fades in over BLACK (docs/adr/0030)");
});

/**
 * 摆到"这一局里摆着木桶、而且不是 Boss 房"的那一格上 —— 「打碎、出门、走回来」
 * 那条测试要找的就是它（Boss 房清完就通关了，走不出去）。
 */
function stateInBarrelCell(seed) {
  const state = Core.createState({
    seed: seed === undefined ? Core.DEFAULT_SEED : seed,
    stage: "mirkwood"
  });
  /*
   * 桶是**按种子撒**的（`docs/adr/0048`：录像一间房 5 只，散在整条带子里），
   * 不再是手写在某一间房的数据里 —— 所以这里要问的是**撒完之后**那一格有没有桶。
   */
  const at = state.dungeon.cells.findIndex((cell, index) => {
    if (index === state.dungeon.boss) return false;
    Core.goToCell(state, index);
    return state.props.some((prop) => Core.BREAKABLE[prop.piece]);
  });
  assert.ok(at >= 0, "this seed deals a room with a barrel in it, off the boss cell");
  Core.goToCell(state, at);
  return state;
}

/** 走到桶边上抡到它碎。桶是实心的（`docs/adr/0030`），所以这一趟是边走边砍。 */
function smashBarrel(state, prop) {
  state.player.z = prop.z;
  state.player.x = Math.max(Core.ROOM.leftWall + 20, prop.x - 90);
  state.player.facing = 1;
  for (let frame = 0; frame < 120 && !prop.broken; frame += 1) {
    Core.step(state, { right: true, attack: true });
  }
  assert.ok(prop.broken, "a swing next to it has to break the barrel");
  return prop;
}

/** 清空这一间房 —— 门在清房那一刻就开，不用再收卡（`docs/adr/0053`）。 */
function clearRoom(state) {
  /*
   * 多批房要等后续批次也进场再杀；只杀当前这一批，房间不会 cleared、门也不开。
   * 每轮跑够死亡三拍，最多 12 轮。
   */
  for (let round = 0; round < 12 && state.room && !state.room.cleared; round += 1) {
    killAll(state);
    Core.runFrames(state, Math.ceil((Core.DEATH.lie + Core.DEATH.shape) * Core.FPS) + 8, {});
  }
}

test("a smashed barrel stays smashed when he walks out of the room and back in", () => {
  const state = stateInBarrelCell();
  const wasAt = state.cell;
  const barrel = state.props.find((prop) => Core.BREAKABLE[prop.piece]);
  assert.ok(barrel, "兽栏 has a barrel standing in it");

  clearRoom(state);
  smashBarrel(state, barrel);
  assert.equal(barrel.solid, false, "碎的桶不再挡人");
  Core.runFrames(state, Math.ceil(Core.BREAK_ANIM * Core.FPS) + 2, {});
  assert.equal(barrel.gone, true, "木片飞完，这块地就空了");

  /* 出门 —— 挑一扇不通向 Boss 房的门，不然走不回来。 */
  const cell = Core.currentCell(state);
  const dir = "NESW".split("").find((d) => {
    const next = Core.doorNeighbour(state.dungeon, cell, d);
    return Core.exitMode(state, d) === "open" && next >= 0 && next !== state.dungeon.boss;
  });
  assert.ok(dir, "a cleared room has at least one door that is not the boss's");
  assert.ok(walkToDoor(state, dir) >= 0, "and it lets him through");
  assert.notEqual(state.cell, wasAt);

  /* 回头。门是那扇进来的门，随时能走（`exitMode`）。 */
  clearRoom(state);
  const back = state.entryDoor;
  assert.ok(walkToDoor(state, back) >= 0, "the way back is always open");
  assert.equal(state.cell, wasAt, "he is standing in the barrel's room again");

  const after = state.props.find((prop) => Core.BREAKABLE[prop.piece]);
  assert.equal(after.broken, true, "打碎的桶不能因为再进一次门就长回来");
  assert.equal(after.solid, false, "回来也不挡人");
  assert.equal(after.gone, true, "地上还是空的");
  assert.equal(after, barrel, "而且是同一个桶记着这件事，不是又摆了一只");
});

test("换房把上一间房的光和字一并留下，不带进新房间", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  /* 一站就是 99 秒的一条，走到新房间时本来还没散。 */
  state.effects.push({ kind: "deathburst", x: 120, z: 0, life: 99, maxLife: 99 });

  killAll(state);
  Core.step(state, {});
  const dir = "NESW".split("").find((d) => Core.exitMode(state, d) === "open");
  assert.ok(walkToDoor(state, dir) >= 0, "the door has to let him through");

  assert.deepEqual(
    state.effects.map((effect) => effect.kind),
    [],
    "上一间房的血光、伤害数字和房名牌都留在门外"
  );
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
  /* 命中停顿会把技能自己的钟往后推（`docs/adr/0061`）：跑到这一招收完。 */
  let cast = 0;
  while (state.player.skillTimer > 0 && cast < 180) {
    Core.runFrames(state, 1, {});
    cast += 1;
  }

  assert.equal(nearHp - near.hp, skill.damage * skill.hits);
  assert.equal(far.hp, farHp);
  /* 跑到收势会多回一点 MP；+8 是这一整段（含命中停顿）的回蓝余量。 */
  assert.ok(state.player.mp < mpBefore - skill.mp + 8, `mp=${state.player.mp}`);
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
   * The arc is the training-room reference's (assets/dnf_src/bilibili/skill-clips/
   * 01_崩山击.mp4), measured on the nameplate that rides over his head - a rigid
   * box that holds one row while he stands and travels with him in the air. He
   * leaves the ground at #22 and is back on it at #41, 0.633s, and the plate
   * rises 215 client px against the 218 client px he is drawn at: one body
   * height, which is 83px in this screen's own 身位. It used to be 250px, read
   * off the same clip and spent as this screen's pixels; see the move's own note.
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
  assert.ok(apex >= 70, `崩山击 has to jump properly (apex ${Math.round(apex)}px)`);
  assert.ok(apex <= 100, `and not higher than the reference's hop (apex ${Math.round(apex)}px)`);
  assert.ok(
    landedAt !== null && landedAt < skill.activeFrom,
    `the smash has to land on the ground (touched down at ${landedAt}, hit at ${skill.activeFrom})`
  );
  assert.ok(landedAt < 0.8, `and be back down inside 0.8s (landed at ${landedAt})`);
});

test("崩山击 brings its own fall gravity, and no other move does", () => {
  /*
   * The leap's arc is the reference's, and the world's gravity cannot make it:
   * 0.633s hanging over 83px needs a *lighter* fall than 2200, which would put
   * him down in 0.55s. 崩山击 is the one move that overrides it, so the override
   * is the only thing this test guards - a plain hop (C) or any other airborne
   * skill still falls at PHYSICS.gravity.
   */
  const carrying = Core.CASTABLE_SKILLS.filter((id) => Core.SKILLS[id].leapGravity);
  assert.deepEqual(carrying, ["mountainBreaker"], "only 崩山击 overrides the fall gravity");
  assert.ok(
    Core.SKILLS.mountainBreaker.leapGravity < Core.PHYSICS.gravity,
    "and its fall is lighter than the world's, which is what hangs the hop for 0.633s"
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
   * The move hops him ~42px forward before the blade lands, so the pair sits
   * ahead of the landing point: one inside the blade's 96px reach, one past it
   * but inside the 150px ground wave.
   */
  const near = Core.createEnemy(state, "grunt", state.player.x + 110);
  const far = Core.createEnemy(state, "grunt", state.player.x + 170);
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
   * 崩山击 raises, hops one body height and lands the smash at 0.70s. The wave
   * effect only lives 0.4s, so it is checked as it lands rather than at the end
   * of the recovery.
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
  /*
   * All three cuts land inside the cast - the sweep, the 十 and the qi the
   * third one leaves behind - and the sum is the same number it was when the
   * move had two hits at 18 each, which is why the balance numbers did not move.
   *
   * The window is the cast and no more: this move bleeds, and at level 4 the
   * first bleed tick comes 1s after the first cut, which is past the end of the
   * cast. Run a frame longer and the number below is three cuts plus a tick.
   */
  Core.runFrames(state, Math.ceil(skill.duration * Core.FPS), {});

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
  const near = Core.createEnemy(state, "grunt", state.player.x + 110);
  const far = Core.createEnemy(state, "grunt", state.player.x + 170);
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
    undefined,
    "and the landing art rides him down, the way the reference's column falls"
  );
  assert.equal(
    Render.EFFECT.draw.mountainBreaker.front,
    true,
    "drawn over him, not behind - the reference's burst covers him at its peak"
  );
  assert.equal(
    Render.EFFECT.frontFrames.mountainBreaker,
    6,
    "a row drawn in front says how long it is, same as 大蹦's second row"
  );
  assert.equal(
    Render.EFFECT.timing.mountainBreaker.from,
    0.38,
    "the column opens 0.2s before touchdown, the way the reference erupts it"
  );
});

test("出血 belongs to 血之狂暴 and to nothing else", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 60);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  /*
   * The control: the move that used to leave this wound now leaves nothing at
   * all. Blood has exactly one owner and the owner is the stance (adr/0017).
   */
  Core.step(state, { skills: { crossSlash: true } });
  /* Past the whole cast - the move holds him for it, so a second press cannot
     start until this one is over. */
  Core.runFrames(state, Core.FPS * 2, {});
  assert.equal(enemy.bleed, null, "十字斩 no longer bleeds on its own");

  state.player.level = 3;
  state.player.buffs.bloodRage = Infinity;
  state.player.skillCooldowns.crossSlash = 0;
  state.player.mp = state.player.maxMp;
  const hpBefore = enemy.hp;
  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.crossSlash.duration * Core.FPS), {});
  assert.ok(enemy.bleed, "with the stance up, the same move leaves the wound");

  const damage = hpBefore - enemy.hp;
  /*
   * Three seconds of it at one tick a second, and the spec says so: the tick
   * had been landing once and then sitting on a NaN timer until it expired.
   */
  Core.runFrames(state, 200, {});
  const bleedDamage = hpBefore - damage - enemy.hp;
  assert.ok(bleedDamage > 0, "bleed keeps ticking after the hit that opened it");
  const bleed = Core.SKILLS.frenzy.buff.bleed;
  assert.equal(
    bleedDamage,
    (bleed.damage + 2 * bleed.growth) * 3,
    "a tick a second for the three seconds the stance promises"
  );
  assert.equal(enemy.bleed, null, "bleed expires");
});

test("十字斩 carries him through the cross and puts him back where he pressed it", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;
  const skill = Core.SKILLS.crossSlash;
  const startX = state.player.x;

  Core.step(state, { skills: { crossSlash: true } });
  assert.equal(state.player.castOriginX, startX, "the cast remembers where it started");

  /*
   * The clip holds him still for #22-#43 and takes the whole step between #43
   * and #44, so nothing has moved by the third cut - the cross is carved in
   * front of the spot he was standing on.
   */
  const thirdCut = Math.ceil(skill.hitAt[2] * skill.duration * Core.FPS);
  let peak = startX;
  let movedEarly = false;
  Core.runFrames(state, Core.FPS * 2, (frame) => {
    if (frame < thirdCut - 2 && state.player.x !== startX) movedEarly = true;
    peak = Math.max(peak, state.player.x);
  });

  assert.ok(!movedEarly, "he stands still up to the third cut");
  assert.ok(
    peak > startX + skill.advance * 0.9,
    "the third cut walks him forward through the cross"
  );
  assert.ok(peak <= startX + skill.advance, "and no further than the clip's own step");

  /* Net zero: the recovery puts him back on the spot, exactly. */
  assert.equal(state.player.x, startX, "the recovery puts him back");
});

test("十字斩 lands all three cuts, on the clip's own three beats", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 60);
  enemy.hp = 900;
  enemy.maxHp = 900;
  enemy.speed = 0;
  state.enemies = [enemy];
  state.player.attackBonus = 0;
  const skill = Core.SKILLS.crossSlash;
  const oneCut = skill.damage + (state.player.level - 1) * skill.growth;

  Core.step(state, { skills: { crossSlash: true } });
  const landed = [];
  let was = enemy.hp;
  Core.runFrames(state, Core.FPS * 2, (frame) => {
    if (enemy.hp !== was) {
      landed.push({ frame: frame, damage: was - enemy.hp });
      was = enemy.hp;
    }
  });

  assert.equal(landed.length, skill.hits, "three cuts, three hits");
  assert.deepEqual(
    landed.map((hit) => hit.damage),
    [oneCut, oneCut, oneCut],
    "each cut does its own damage"
  );
  skill.hitAt.forEach((at, index) => {
    /*
     * `hitAt` is a fraction of the cast and the loop tests it against the
     * elapsed time it had *before* this frame's tick, so a beat legitimately
     * lands a frame or two either side of the clip's own frame - which is what
     * the slack is. It is not room to spread them: the move these replaced had
     * two hits at the midpoint of their window, which is where the second cut
     * would sit (frame 26 against the clip's 20).
     *
     * The third is looser on purpose: it is a qi that has to fly to him.
     */
    const beat = Math.ceil(at * skill.duration * Core.FPS);
    const slack = index === 2 ? 8 : 3;
    assert.ok(
      Math.abs(landed[index].frame - beat) <= slack,
      `cut ${index + 1} lands on its own beat - frame ${beat}, give or take ${slack} (landed on ${landed[index].frame})`
    );
  });
});

test("十字斩's third cut is a qi that leaves him, flies, and expires", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;
  const skill = Core.SKILLS.crossSlash;
  const origin = state.player.x;

  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, Math.ceil(skill.shot.from * skill.duration * Core.FPS) + 1, {});
  assert.equal(state.shots.length, 1, "the third cut leaves a qi behind");
  const bornAt = state.shots[0].x;
  assert.ok(
    Math.abs(bornAt - (origin + state.shots[0].facing * skill.shot.ahead)) < 8,
    "it starts where the clip starts it - in front of him, not on his hands"
  );

  Core.runFrames(state, Math.ceil(skill.shot.life * Core.FPS) - 6, {});
  assert.equal(state.shots.length, 1, "it is still in the air for its own life");
  assert.ok(state.shots[0].x > bornAt + 40, "and it travels while it is");

  Core.runFrames(state, 12, {});
  assert.equal(state.shots.length, 0, "then it is gone");
});

test("十字斩's qi passes through what it crosses, once each", () => {
  const state = lastRoomState();
  /*
   * Both stand outside the first two cuts' reach (84) and inside the qi's
   * flight, so whatever they lose is the qi's alone - and the far one proves it
   * is a sweep rather than a stop-on-first-contact.
   */
  const near = Core.createEnemy(state, "grunt", state.player.x + 115);
  const far = Core.createEnemy(state, "grunt", state.player.x + 175);
  [near, far].forEach((enemy) => {
    enemy.hp = 400;
    enemy.maxHp = 400;
    enemy.speed = 0;
  });
  state.enemies = [near, far];
  state.player.attackBonus = 0;
  const skill = Core.SKILLS.crossSlash;
  const oneCut = skill.damage + (state.player.level - 1) * skill.growth;

  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, Core.FPS * 2, {});

  assert.equal(400 - near.hp, oneCut, "the near body is hit once, by the qi");
  assert.equal(400 - far.hp, oneCut, "and the qi carries on to the far body");
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
  /*
   * **这一条不摆怪**：打中了会触发命中停顿（`docs/adr/0061`），世界停三帧，
   * 11 帧后就不是同一个"收招段"了。这里量的是取消窗口，不是命中。
   */
  state.enemies = [];

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
  assert.ok(state.player.x >= Core.ROOM.leftWall);
  assert.ok(state.player.x <= Core.ROOM.rightWall);
  assert.ok(state.player.hp >= 0 && state.player.hp <= state.player.maxHp);
  assert.ok(state.player.mp >= 0 && state.player.mp <= state.player.maxMp);
  assert.ok(state.cell >= 0 && state.cell < state.dungeon.cells.length);
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
 * Depth is opt-in: a room may open a fight on a row of its own, and a monster
 * only leaves the ground line to follow the Slayer there. This room does not
 * ask for one and the run never presses up or down, so z = 0 is where every
 * body stands and the run has to come out exactly as it did before the axis
 * existed. That is the invariant the five-slice plan rested on, so it is
 * asserted rather than assumed.
 */
test("a run that never walks in depth stays on the ground line", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  assert.equal(state.player.z, 0, "a fresh player walks the ground line");
  assert.ok(state.enemies.every((enemy) => enemy.z === 0), "this room opens the fight on it");

  Core.runFrames(state, 900, (frame) => ({
    right: frame % 200 < 150,
    left: frame % 200 >= 150,
    jump: frame % 47 === 0,
    attack: frame % 17 === 0,
    skills: { bloodSword: frame % 211 === 0, mountainBreaker: frame % 173 === 0 }
  }));

  /*
   * A tripwire, on purpose: the day a slice gives *this* room a depth, or has a
   * monster walk one without being followed there, this fails and gets replaced
   * by a real test of whatever it was given.
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

test("门口那一块没有布景压着 —— 实心件挪开、花草也不许盖门拱", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.dungeon.cells.forEach((cell, index) => {
    Core.goToCell(state, index);
    const depth = Core.bandDepth(state.band);
    const spec = (ROOMS[cell.room].props || []).filter((prop) => Core.propBox(prop.piece));
    /* 只数**人写的**那一批：撒出来的实心件躲不开门时是**丢掉**的（`SCATTER` 那段）。 */
    const placed = state.props.filter((prop) => prop.solid && !prop.scattered);
    assert.equal(
      placed.length,
      spec.length,
      `${state.room.name} 的实心布景要一件不少（压门的挪开，不是丢掉）`
    );
    /*
     * **所有**布景都过这一关，不只是实心件：花草贴花不挡人，但会把门拱画糊
     * （业主 2026-10-17：「有杂草盖住了门口」；`docs/adr/0056`）。
     */
    state.props.forEach((prop) => {
      assert.equal(
        Core.blocksDoorway(state, cell, { piece: prop.piece, x: prop.x, depth: prop.z / depth }, depth),
        false,
        `${state.room.name} 的 ${prop.piece} 压在门口上`
      );
    });
  });
});

test("无盒布景的美术尺寸与渲染表对得上", () => {
  Object.keys(Core.PROP_ART).forEach((piece) => {
    const rect = Render.SCENE.pieces[piece];
    assert.ok(rect, `${piece} 在 SCENE.pieces 里没有`);
    assert.deepEqual(
      Core.PROP_ART[piece],
      [rect[2], rect[3]],
      `${piece} 的净空尺寸和画出来的尺寸分家了`
    );
  });
});

/*
 * 业主指名的那个格子：第一排第 3 格（(2,0)）往东到第一排第 4 格。
 * 默认种子下东门门拱 `x∈[873.6,978.4]`，原来有一丛 grass 在 x=876.8。
 */
test("业主报的那一格：东门门拱上不再有草", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.goToCell(state, 2);
  const cell = Core.currentCell(state);
  assert.equal(cell.col, 2);
  assert.equal(cell.row, 0);
  assert.ok(cell.exits & Core.MINIMAP_STEPS.E.bit, "这一格要真的有东门");
  const gate = Core.gateArtRect(state, cell, "E");
  state.props.forEach((prop) => {
    const art = Core.propArtSize(prop.piece);
    const box = Core.propBox(prop.piece);
    const ink = art || (box && box.ink);
    if (!ink) return;
    const foot = Core.ARENA.groundY - Core.depthLift(prop.z);
    const left = prop.x - ink[0] / 2;
    const right = prop.x + ink[0] / 2;
    const top = foot - ink[1];
    assert.ok(
      right <= gate.left || left >= gate.right || foot <= gate.top || top >= gate.bottom,
      `${prop.piece} 仍然压着东门门拱（x=${Math.round(prop.x)}）`
    );
  });
});

/*
 * **木桶碎片不许比整只桶还大。** 完整桶画 0.74，碎片原来按 1.0 画、还锚在
 * 未缩放的 63×78 框上（业主 2026-10-17：「有的木桶图片图层不对」）。这条把
 * 碎片的落点钉在缩放后的桶框里，尺寸也按同一个倍率。
 */
test("木桶碎片跟着桶的倍率画，不越出整只桶的框", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  let barrel = null;
  for (let index = 0; index < state.dungeon.cells.length && !barrel; index += 1) {
    Core.goToCell(state, index);
    barrel = state.props.find((prop) => prop.piece === "barrel");
  }
  assert.ok(barrel, "这一局总得有一只桶");

  barrel.broken = true;
  barrel.brokenAt = state.time - 0.2;
  barrel.solid = false;
  /* 这一间可能还有别的完整桶；这一条只看我们砸碎的那一只。 */
  state.props = [barrel];
  state.enemies = [];
  state.effects = [];

  const calls = [];
  const forest = { width: 1280, height: 2097 };
  Render.render(recordingContext(calls), state, { sprites: { forest } });

  /* 同一行 y=1874 还有门（sx<560）和死亡碎块（sx>979），只看桶与它的碎片。 */
  const pieces = calls.filter((call) =>
    call[0] === "drawImage" && call[1] === forest &&
    call[3] === 1874 && call[2] >= 560 && call[2] <= 979);
  assert.ok(pieces.length > 0, "碎片一块都没画");
  assert.equal(
    pieces.some((call) => call[2] === Render.SCENE.pieces.barrel[0]),
    false,
    "碎了的桶不该再画完整帧"
  );

  const scale = Core.propScale("barrel");
  const whole = Render.SCENE.pieces.barrel;
  const wholeW = whole[2] * scale[0];
  const wholeH = whole[3] * scale[1];
  const left = barrel.x - wholeW / 2;
  const top = Core.ARENA.groundY - Core.depthLift(barrel.z) - wholeH;
  pieces.forEach((call) => {
    assert.ok(
      Math.abs(call[8] - call[4] * scale[0]) < 0.01,
      `碎片宽 ${call[8]} 没有按桶的倍率 ${scale[0]} 画`
    );
    assert.ok(
      call[6] >= left - 1 && call[6] + call[8] <= left + wholeW + 1 &&
      call[7] >= top - 1 && call[7] + call[9] <= top + wholeH + 1,
      `碎片跑到整只桶的框外面了：(${call[6]},${call[7]}) ${call[8]}x${call[9]}`
    );
  });
});

test("the band's two edges stop him", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.enemies = [];
  /* 走一条净空的竖道 —— 树和石头现在是实心的，这一条只量地板（`docs/adr/0032`）。 */
  state.player.x = clearLaneX(state);

  /* Four seconds a side, against a floor that takes six tenths to cross. */
  Core.runFrames(state, 240, { up: true });
  assert.equal(state.player.z, Core.bandDepth(state.band), "held against the back edge");

  Core.runFrames(state, 240, { down: true });
  assert.equal(state.player.z, 0, "and against the front edge, which is the ground line");
});

test("crossing the whole floor takes about a third of crossing the window sideways", () => {
  /*
   * Measured on the shared floor: this number is the default band's speed, and
   * the seed's own opening room can bring a wider one of its own (胆小鬼的窝
   * does). Two entries, so the emptied room is not the last of the run - a won
   * run stops stepping.
   */
  const state = sealedRoomState(Core.DEFAULT_SEED, plainRoomIndex());
  const band = Core.bandDepth(state.band);
  state.player.x = clearLaneX(state);

  let frames = 0;
  while (state.player.z < band && frames < 600) {
    Core.step(state, { up: true });
    frames += 1;
  }

  /*
   * The feel the depth speed was chosen for: he crosses the band in about the
   * time it takes to cross **a third of the window sideways**. It is a screen
   * speed, so what is pinned here is the **ratio** and not a number of seconds -
   * the band, the window and his walk have all moved under it once already
   * (`docs/adr/0039` scaled every walk onto the recording's pace, `0040` cut the
   * window to 4:3). A ratio keeps saying what the number is *for*.
   */
  const seconds = frames * Core.DT;
  const screen = Core.windowWidth() / Core.PHYSICS.moveSpeed;
  const share = seconds / screen;
  assert.ok(
    share > 0.32 && share < 0.38,
    `他穿过地面带用了横穿窗口的 ${share.toFixed(3)}（${seconds.toFixed(3)}s 对 ${screen.toFixed(3)}s）`
  );
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

test("a cast pins the facing it was started with, and a swing does not", () => {
  /*
   * The owner read this off the screen: 「按方向键，大蹦的技能特效会转向，这是不对的」.
   * The facing was the one input a cast did not take away, and it was not only a
   * picture - the effect art mirrors off the live facing, each hit builds its box
   * from it, and the leap reads it on the beat it fires. So the opposite arrow
   * turned the rift, flipped which side it could hit and could throw the hop
   * backwards.
   */
  const casting = Core.createState({ seed: Core.DEFAULT_SEED });
  casting.enemies = [];
  Core.runFrames(casting, 10, { right: true });
  assert.equal(casting.player.facing, 1, "he starts this facing right");

  const before = casting.player.x;
  Core.step(casting, { skills: { mountainRift: true } });
  assert.ok(casting.player.skillTimer > 0, "the cast is under way");
  const midCast = Core.SKILLS.mountainRift.duration * 0.6;
  Core.runFrames(casting, Math.ceil(midCast * Core.FPS), { left: true });
  assert.ok(casting.player.skillTimer > 0, "still casting, so this test means something");
  assert.equal(casting.player.facing, 1, "holding the opposite arrow does not turn him");
  /*
   * And he does not walk it off either: the rift is drawn at his own x for the
   * whole cast, so a step here would drag the fire across the floor. The only
   * movement allowed is the hop the move owns, which the reference puts 47px
   * forward - and it is forward, not back along the arrow he is holding.
   */
  assert.ok(
    casting.player.x >= before && casting.player.x <= before + 60,
    `the cast moved him only by its own hop (${before} -> ${casting.player.x})`
  );

  const swinging = Core.createState({ seed: Core.DEFAULT_SEED });
  swinging.enemies = [];
  Core.runFrames(swinging, 10, { right: true });
  swinging.player.attackTimer = Core.PLAYER.attackDuration;
  Core.runFrames(swinging, 6, { left: true });
  assert.equal(
    swinging.player.facing,
    -1,
    "a normal swing still lets him turn - it is a short chain, not a commitment"
  );
});

test("a swing roots him in depth the way it roots him sideways", () => {
  const free = Core.createState({ seed: Core.DEFAULT_SEED });
  free.enemies = [];
  Core.runFrames(free, 5, { up: true });
  const walked = free.player.z;
  /*
   * 五帧的自由走位正好是五帧的深度速度。写成从 `PHYSICS` 推出来的数、而不是一个
   * 绝对值：整档步速被乘过一次 0.65（`docs/adr/0039`），绝对值会跟着过期，
   * 这一条要钉的是"深度那根轴还在按同一个比例走"。
   */
  const perFrame =
    ((Core.PHYSICS.depthSpeedRatio * Core.PHYSICS.moveSpeed) / Core.DEPTH.scale) * Core.DT;
  assert.ok(
    Math.abs(walked - perFrame * 5) < 0.01,
    `five frames of walking should be worth ${(perFrame * 5).toFixed(2)}, got ${walked}`
  );

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
  /* 先把"哪一间"定下来再改它 —— 改完再问一次，`plainRoomIndex` 会答出别的房间。 */
  const plain = plainRoomIndex();
  const room = ROOMS[plain];
  const was = room.band;
  try {
    room.band = { backY: 380 };
    const state = sealedRoomState(Core.DEFAULT_SEED, plain);
    state.player.x = clearLaneX(state);

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
  /*
   * 这一条量的是"施法结束时地面接过来的那一档深度"，不是布景。门口净空会把
   * 实心件挪到新的位置（`docs/adr/0056`），挪过来的石头可能正好顶在测试选的
   * 那一档上，把他推开 —— 那检验的是布景，不是这一条。先清掉实心件。
   */
  state.props = state.props.filter((prop) => !prop.solid);
  state.player.mp = state.player.maxMp;
  /* A row inside this room's own floor: rooms differ now, so ask the room. */
  const deep = Core.bandDepth(state.band) * 0.6;
  state.player.z = deep;

  Core.step(state, { skills: { mountainRift: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.mountainRift.duration * Core.FPS) + 2, {});

  const field = state.fields[0];
  assert.ok(field, "the end of the cast hands the ground to the arena");
  assert.equal(field.z, deep, "and the spot it remembers has a depth");
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
    /*
     * Held where it was put. It walks toward the Slayer's row on its own now,
     * which is tested below; this test is about what depth the mark carries.
     */
    caster.z = 250;
    caster.vz = 0;
    Core.step(state, {});
    mark = state.effects.find((effect) => effect.kind === "telegraph");
  }

  assert.ok(mark, "the caster aims before it fires");
  assert.equal(mark.z, 250, "and the ground it is about to scorch is the ground under it");
});

/*
 * Depth is what decides whether a blow lands, not just where it is drawn. The
 * defender is a point on the floor and the attack is an interval around the
 * attacker's own row, so stepping aside is a defence - and the same step is what
 * makes your own swing miss, which is what keeps the standoff a standoff rather
 * than a place to farm from.
 */
test("the Slayer has two heights, and the sheet is the judge of both", () => {
  /*
   * 格 (the reach unit) is the cell: `SLAYER_HEIGHT` is `SPRITE.anchorY` seen
   * from the physics side, and two copies of it would mean a reach that drifts
   * every time the art is re-baked.
   */
  assert.equal(Core.SLAYER_HEIGHT, Render.SPRITE.anchorY);

  /*
   * 身位 (the art unit) is the *man*: how tall he is actually drawn. It is what
   * reference measurements are normalised against, so it is a fact about the
   * PNG rather than a number anyone may edit - it is read back off the idle
   * row here. The two are different numbers by design: the cell reserves
   * headroom above his head for the widest swing in the sheet, and reading a
   * flame's height in the wrong one is off by that headroom.
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  let top = Infinity;
  let bottom = -Infinity;
  for (let col = 0; col < Render.SPRITE.frames.idle; col += 1) {
    const box = cellAlphaBox(sheet, col, Render.SPRITE.rows.idle);
    top = Math.min(top, box.y0);
    bottom = Math.max(bottom, box.y1);
  }
  assert.equal(bottom - top + 1, Render.SPRITE.bodyHeight, "身位 is the idle frame's own height");
  assert.ok(Render.SPRITE.bodyHeight < Render.SPRITE.anchorY, "身位 is shorter than 格: the cell has headroom");
});

test("a reach is a band either side of the row you are standing on", () => {
  const half = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;

  assert.ok(Core.inReachOf(0, 0), "level with him is in reach");
  assert.ok(Core.inReachOf(half, 0), "and so is exactly one reach away");
  assert.ok(Core.inReachOf(-half, 0), "in both directions");
  assert.ok(!Core.inReachOf(half + 1, 0), "a hair past it is not");

  /* The band is where it is drawn, so the reach is worth reading as a share of it. */
  assert.ok(half * 2 < Core.bandDepth(Core.BAND) / 2, "a melee reach is a small part of the floor");

  /* Floor moves cover more of it: that is the whole difference between them. */
  const patch = Core.DEPTH_REACH.floor * Core.SLAYER_HEIGHT;
  assert.ok(patch > half);
  assert.ok(!Core.inReachOf(patch + 1, 0), "and even a patch stops somewhere");
});

test("a cut does not cross the floor sideways", () => {
  const swing = (z) => {
    const state = lastRoomState();
    const brute = Core.createEnemy(state, "brute", state.player.x + 40);
    state.enemies = [brute];
    /* Standing still, so the only thing that changes between runs is the depth. */
    brute.speed = 0;
    state.player.z = z;
    const before = brute.hp;
    /* One press, then no input at all: holding the key is a different test. */
    Core.step(state, { attack: true });
    Core.runFrames(state, ATTACK_HIT_FRAMES, {});
    return before - brute.hp;
  };

  assert.ok(swing(0) > 0, "on his own row the cut lands");
  assert.equal(
    swing(Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT + 20),
    0,
    "a step off that row and it is swinging at the floor"
  );
});

test("and a monster's does not cross it either", () => {
  const exchange = (z) => {
    const state = lastRoomState();
    const grunt = Core.createEnemy(state, "grunt", state.player.x + 40);
    state.enemies = [grunt];
    grunt.speed = 0;
    state.player.z = z;
    Core.runFrames(state, 60 * 4, {});
    return state.stats.damageTaken;
  };

  assert.ok(exchange(0) > 0, "level with it, it connects");
  assert.equal(
    exchange(Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT + 20),
    0,
    "aside from it, it cannot reach him either"
  );
});

test("the spin is answerable in depth too, and it reaches wider than a swing", () => {
  const run = (z) => {
    const state = lastRoomState();
    const elite = Core.createEnemy(state, "elite", state.player.x + SPIN_FROM);
    /*
     * **位置钉死**：`createEnemy` 会按随机流抖 ±14 像素，而这几条要的是一个
     * 确定的几何 —— 旋风的判定是**身体间距 ≤ 73**，抖出去就永远不进那一招。
     * 它曾经因此红过：房间内容多两只怪就会挪动那条随机流，这一步就从
     * "进得来"滑到"进不来"，而测试看上去像在说"精英不会旋风"。
     */
    elite.x = state.player.x + SPIN_FROM;
    state.enemies = [elite];
    elite.speed = 0;
    elite.attackRange = NEVER_REACHES;
    state.player.z = z;
    Core.runFrames(state, 60 * 5, {});
    return state.stats.damageTaken;
  };
  const melee = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
  const spin = Core.DEPTH_REACH.spin * Core.SLAYER_HEIGHT;

  assert.equal(run(0), Core.ENEMY_TYPES.elite.spinDash.damage, "in its row, the sweep clips");
  assert.equal(
    run(melee + 10),
    Core.ENEMY_TYPES.elite.spinDash.damage,
    "and a step out of a swing's reach is not out of the sweep's"
  );
  assert.equal(run(spin + 20), 0, "but out of its own row entirely is");
});

test("a floor move covers the patch it draws, and stops where it stops", () => {
  const caughtBy = (z) => {
    const state = lastRoomState();
    const brute = Core.createEnemy(state, "brute", state.player.x + 60);
    state.enemies = [brute];
    brute.speed = 0;
    brute.z = z;
    state.player.z = 0;
    state.player.mp = state.player.maxMp;
    const before = brute.hp;
    /* 崩山击's wave lands with the smash, 0.78s in. The leap's own forward carry
       is pinned off, because the leap travels 150px and would land him past the
       brute - what is under test here is the wave's depth, not the hop's reach. */
    Core.step(state, { skills: { mountainBreaker: true } });
    Core.runFrames(state, Math.ceil(0.78 * Core.FPS), (frame, live) => {
      live.player.vx = 0;
      return {};
    });
    return before - brute.hp;
  };

  const patch = Core.DEPTH_REACH.floor * Core.SLAYER_HEIGHT;
  assert.ok(patch > Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT, "a patch is wider than a swing");

  assert.ok(caughtBy(0) > 0, "level with the smash it is caught");
  assert.ok(caughtBy(patch - 20) > 0, "and so is a body standing on the patch, off his own row");
  assert.equal(caughtBy(patch + 40), 0, "past the patch, nothing");
});

/*
 * Monsters walk the second axis too. What that buys is the difference between a
 * fight and a hiding place: without it the Slayer could stand one row off every
 * melee monster in the game and neither side could land a blow, for as long as
 * he liked. What it costs is that parking far away is no longer a defence - the
 * defence is a step aside taken while the blow is already committed, which is
 * what the axis is for. Both halves are pinned here.
 */
test("a monster walks onto the row the Slayer has stepped to", () => {
  const state = lastRoomState();
  const grunt = Core.createEnemy(state, "grunt", state.player.x + 40);
  state.enemies = [grunt];
  assert.equal(grunt.z, 0, "it starts level with him");

  state.player.z = 300;
  /*
   * Three seconds, because arriving is the thing being tested and it takes about
   * 1.7 of them: a walk (about 1s of cooldown), a whiffed swing (0.5s, and a
   * monster cannot choose actions mid-swing), then the walk again. The old form
   * asked for half the gap inside one second, which only held because every
   * walk was 1.5x faster before `docs/adr/0039`.
   */
  Core.runFrames(state, 180, {});

  const row = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
  const gap = Math.abs(state.player.z - grunt.z);
  assert.ok(
    gap <= row + 1,
    `it should end up on his row (within ${row.toFixed(1)} z), left ${gap}`
  );
});

test("stepping aside during a wind-up still dodges the blow", () => {
  const state = lastRoomState();
  const brute = Core.createEnemy(state, "brute", state.player.x + 40);
  state.enemies = [brute];
  /* Stays put, so the only thing that moves is the Slayer. A monster that can
     follow him is the test above; this one is about the commit. */
  brute.speed = 0;

  let committed = false;
  for (let frame = 0; frame < 60 * 3 && !committed; frame += 1) {
    Core.step(state, {});
    committed = brute.attackTimer > 0;
  }
  assert.ok(committed, "the brute winds up a swing");

  state.player.z = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT + 100;
  Core.runFrames(state, Math.ceil(brute.attackDuration * Core.FPS) + 2, {});

  assert.equal(state.stats.damageTaken, 0, "the blow lands on the row he left");
});

test("monsters on different rows do not shove each other", () => {
  const apart = (zA, zB) => {
    const state = lastRoomState();
    const a = Core.createEnemy(state, "grunt", 400);
    const b = Core.createEnemy(state, "grunt", 400);
    state.enemies = [a, b];
    a.x = 400;
    b.x = 400;
    a.z = zA;
    b.z = zB;
    a.speed = 0;
    b.speed = 0;
    Core.runFrames(state, 2, {});
    return Math.abs(a.x - b.x);
  };

  assert.ok(apart(0, 400) === 0, "the same spot on two rows is not a collision");
  assert.ok(apart(0, 0) > 0, "and the same spot on one row still is");
});

test("a radial move is a disc on the floor, not a line across it", () => {
  const burst = (dz) => {
    const state = lastRoomState();
    const brute = Core.createEnemy(state, "brute", state.player.x);
    state.enemies = [brute];
    brute.speed = 0;
    brute.z = dz;
    state.player.z = 0;
    const before = brute.hp;
    state.player.mp = state.player.maxMp;
    Core.step(state, { skills: { rageBurst: true } });
    Core.runFrames(state, Math.ceil(0.9 * Core.FPS), {});
    return before - brute.hp;
  };

  assert.ok(burst(0) > 0, "under him is inside the ring");
  /*
   * 92, not the 152 this used to be: the ring the reference draws is 2.17
   * Slayer-heights across, so the disc is 1.09 either side of his soles and the
   * old circle was sized to the caster rather than to the art. 60 is a depth a
   * "line across the floor" would miss, which is what this test is about - the
   * exact number belongs to the move's own spec, not here.
   */
  assert.ok(burst(60) > 0, "and so is a body standing 60 into the screen");
  assert.equal(burst(400), 0, "400 in is outside it");
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
  /*
   * Which rooms do is their own business and it changes; this asks for one that
   * does not, so it keeps testing the fallback instead of whoever just moved.
   */
  const plain = plainRoomIndex();
  assert.ok(plain >= 0, "there is still a room standing on the shared floor");

  const state = stateInRoom(Core.DEFAULT_SEED, plain);
  assert.equal(state.band, Core.BAND, "a room with no floor of its own gets the default one");

  const room = ROOMS[plain];
  const was = room.band;
  try {
    room.band = { backY: 350 };
    Core.goToCell(state, state.cell);
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

test("a room can open a fight at a depth", () => {
  /* 十夫长的营寨 是声明了深度的那一间：它的投手占自己的一排。 */
  const state = stateInRoom(Core.DEFAULT_SEED, STAGE.gauntletIndex);
  const caster = state.enemies.find((enemy) => enemy.type === "caster");
  const declared = ROOMS[STAGE.gauntletIndex].enemies.find(
    (enemy) => enemy.type === "caster"
  ).depth;

  assert.ok(caster, "the gauntlet fields a caster");
  assert.equal(
    caster.z,
    declared * Core.bandDepth(state.band),
    "and it opens the fight at the depth the room declared, in the band it fights on"
  );
  assert.ok(caster.z > Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT, "far enough back to be a walk");
  assert.equal(state.player.z, 0, "who walks in on the front edge");
});

test("a shot flies on the floor its caster stands on", () => {
  const state = lastRoomState();
  state.player.x = 500;
  const caster = Core.createEnemy(state, "caster", 200, 260);
  state.enemies = [caster];

  let shot = null;
  for (let frame = 0; frame < 60 * 5 && !shot; frame += 1) {
    /* Held on its row: it walks toward the Slayer's on its own now. */
    caster.z = 260;
    caster.vz = 0;
    Core.step(state, {});
    shot = state.projectiles[0] || null;
  }

  assert.ok(shot, "the caster should have fired");
  assert.equal(shot.z, 260);
});

test("a kill leaves no health on the floor", () => {
  /*
   * Monsters used to leave a heal orb where the body fell - a brute always,
   * an elite and a boss always, half the chaff. The owner took the whole line
   * out: blood comes back only through 血之狂暴's own orbs, which is what
   * `0017` said the stance's price was buying (docs/adr/0021).
   *
   * **地上现在有东西了，可它不是血**（`docs/adr/0042`）：怪一死摆出来的是一块
   * 掉落名牌，收掉它给经验与金币，血条一分都不涨 —— 这一条要的正是后者。
   */
  const state = lastRoomState();
  state.player.buffs.bloodRage = 0;
  const brute = Core.createEnemy(state, "brute", state.player.x + 60, 300);
  const boss = Core.createEnemy(state, "boss", state.player.x + 120, 0);
  state.enemies = [brute, boss];

  Core.damageEnemy(state, brute, brute.maxHp + 1, 0, brute.x, {});
  Core.damageEnemy(state, boss, boss.maxHp + 1, 0, boss.x, {});

  assert.ok(
    state.pickups.every((drop) => drop.kind === "loot" && drop.value === undefined),
    "no heal orbs, from any rank"
  );
  /*
   * 走过去把两块名牌收掉：经验金币进账，**血一点不动** —— 唯一的例外是升级本身
   * 回的那一口（`PROGRESSION.healOnLevelUp`），那是等级的账，不是掉落的。
   */
  const levelBefore = state.player.level;
  state.player.hp = 20;
  state.pickups.slice().forEach((drop) => {
    state.player.x = drop.x;
    state.player.z = drop.z || 0;
    Core.step(state, {});
  });
  const levels = state.player.level - levelBefore;
  assert.equal(
    state.player.hp,
    20 + levels * Core.PROGRESSION.healOnLevelUp,
    "picking a drop up heals nothing beyond the level it earned"
  );

  /* And the blood orbs still come out of a hit while the stance is up. */
  state.pickups = [];
  state.player.buffs.bloodRage = Infinity;
  state.player.stanceDrainTimer = 999;
  const target = Core.createEnemy(state, "brute", state.player.x + 60);
  for (let hit = 0; hit < 40 && !state.pickups.length; hit += 1) {
    Core.damageEnemy(state, target, 1, 0, state.player.x);
  }
  assert.equal(state.pickups.length, 1, "the stance's own blood is the only pick-up");
  assert.equal(state.pickups[0].kind, "blood_orb");
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

  /* And the scenery, which is not a body either: no `y`, just a footprint. */
  state.enemies = [];
  state.props = [{ piece: "barrel", x: 300, z: 0, solid: true, hp: 1, broken: false,
                   brokenAt: -1 }];
  const forest = { width: 1280, height: 1487 };
  const propFlat = renderCalls(state, { sprites: { forest } });
  state.props[0].z = 120;
  const propDeep = renderCalls(state, { sprites: { forest } });
  /*
   * 木桶是**有自己倍率**的那几件之一（`Core.propScale`，`docs/adr/0050`）——
   * 烘出来的像素数乘那个倍率才是它画多大，所以这里也要乘。
   */
  const barrelRect = Render.SCENE.pieces.barrel;
  const barrelScale = Core.propScale("barrel");
  const barrelLeft = Math.round(300 - (barrelRect[2] * barrelScale[0]) / 2);
  const prop = (calls) => call(calls, "drawImage", (c) => c[6] === barrelLeft)[7];
  const barrelTall = barrelRect[3] * barrelScale[1];
  assert.equal(prop(propFlat), Math.round(Core.ARENA.groundY - barrelTall),
    "a barrel with no depth stands on the ground line");
  assert.equal(prop(propDeep), Math.round(Core.ARENA.groundY - Core.depthLift(120) - barrelTall));
});

/*
 * **经验是捡起来才给的**（业主 2026-10-14，Q12 选 a）：怪倒下的那一刻只把掉落
 * 名牌放到地上，走进去收掉才进账（`docs/adr/0042`）。
 */
function pickUpEverything(state) {
  state.pickups.slice().forEach((drop) => {
    state.player.x = drop.x;
    state.player.z = drop.z || 0;
    Core.step(state, {});
  });
}

test("defeating enemies grants XP and levels the player up", () => {
  const state = lastRoomState();
  const first = Core.createEnemy(state, "brute", state.player.x + 60);
  const second = Core.createEnemy(state, "brute", state.player.x + 120);
  state.enemies = [first, second];
  const levelBefore = state.player.level;

  Core.damageEnemy(state, first, 9999, 0, state.player.x);
  Core.damageEnemy(state, second, 9999, 0, state.player.x);

  assert.equal(state.player.xp, 0, "倒下那一刻还不给经验");
  pickUpEverything(state);

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

test("bosses pay out in experience, not in health", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", state.player.x + 60);
  state.enemies = [boss];
  state.player.hp = 30;
  const xpBefore = state.player.xp;

  Core.damageEnemy(state, boss, 9999, 0, state.player.x);

  assert.ok(
    state.pickups.every((drop) => drop.kind === "loot"),
    "the kill itself drops no health"
  );
  assert.equal(state.player.xp, xpBefore, "倒下那一刻还不给经验");
  pickUpEverything(state);

  assert.ok(
    state.player.hp <= 30 + Core.PROGRESSION.healOnLevelUp * 3,
    "and the only health it hands back is the level-up heal, not an orb"
  );
  assert.ok(state.player.xp > xpBefore, "the reward for a boss is the level");
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
  state.player.x = Core.ROOM.leftWall + state.player.width / 2;

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
  groundedBoss.attackRange = NEVER_REACHES;
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
  airborneBoss.attackRange = NEVER_REACHES;
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
  const casterRoom = cellWithCaster(5);
  assert.ok(casterRoom >= 0, "seed 5 has to deal a room with a thrower somewhere");
  assert.notEqual(casterRoom, -1, "seed 5 should run a room with a caster");
  const a = Core.createState({ seed: 5, cell: casterRoom });
  const b = Core.createState({ seed: 5, cell: casterRoom });

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
 * spend MP on the AoE skill. Used to prove the stage is beatable.
 */
/** The same measure the AI uses: how far apart two bodies are, edge to edge. */
function bodyGapOf(a, b) {
  return Math.abs(a.x - b.x) - (a.width + b.width) / 2;
}

/*
 * A reach that can never connect. `attackRange` is measured **past the body**
 * now, so the old idiom of setting it to 0 to disable melee no longer disables
 * anything: 0 means "only when the bodies touch", and a body wide enough to
 * overlap already touches. Tests that want melee out of the way use this.
 */
/* 摆在这个距离上，身体间距 58.5，稳稳落在旋风的 73 以内。 */
const SPIN_FROM = 95;
const NEVER_REACHES = -1e6;

/**
 * 前面那一步撞在实心布景上就让一格：木桶（`docs/adr/0030`）和树、石头（`docs/adr/0032`）
 * 都是实心的，这个 bot 又不会绕路，不躲开就会顶着它们原地推。
 *
 * 让的方向按"他现在站的这一排在哪一边"取，所以让完还是朝着目标那一排走。
 */
function detour(state, input, stepX) {
  const player = state.player;
  const target = player.x + stepX;
  const half = player.width / 2 + 8;
  const blocker = blockingProp(state, (prop, spec, centre) =>
    Math.abs(target - centre) < spec.width / 2 + half &&
    Math.abs((player.z || 0) - prop.z) < spec.depth / 2 + half);
  if (!blocker) return input;
  /*
   * **挡路的是桶就砸它。** 桶是全场唯一**只有他打得碎**的东西（`CONTEXT.md`「木桶」），
   * 而绕开一坨挨在一起的三只桶比砸碎难得多 —— 人是这么打的，演示 bot 也照这么打。
   * 不砸的话它会在桶堆边上顶满一整局（`docs/adr/0050` 记了实测）。
   */
  if (Core.BREAKABLE[blocker.prop.piece]) return smashTowards(input, blocker, player);
  /*
   * 否则让一步：**按他现在站的这一排取**，不查路网 —— `Core.routeStep` 在盒子的边界上
   * 会一帧答"往左"、下一帧答"往右"，实测卡在 626.0 / 628.9 两个数之间来回三个像素
   * （`docs/adr/0048`）。这条规矩是确定的，所以它收敛。
   */
  const sidestep = (player.z || 0) <= blocker.z ? "down" : "up";
  return { ...input, [sidestep]: true };
}

/** 朝挡住他的那件东西挥一刀。 */
function smashTowards(input, blocker, player) {
  const out = { ...input };
  if (blocker.x > player.x) { out.right = true; out.left = false; }
  else { out.left = true; out.right = false; }
  out.attack = true;
  return out;
}

/*
 * 往**上/下**走的时候被实心件挡住：横着让一让。`detour` 那一套是给横走用的，
 * 而门口是按地图方向开的（`docs/adr/0030`）—— 北门要他从带子前缘一路走到底，
 * 路上那五只桶正好横在那条直线上，少了这一段，bot 就顶着一只桶推满一整局。
 */
function detourRow(state, input, stepZ) {
  const player = state.player;
  const half = player.width / 2 + 8;
  const blocker = blockingProp(state, (prop, spec, centre) =>
    Math.abs(player.x - centre) < spec.width / 2 + half &&
    Math.abs((player.z || 0) + stepZ - prop.z) < spec.depth / 2 + half);
  const out = { ...input };
  if (!blocker) {
    if (stepZ > 0) out.up = true;
    else out.down = true;
    return out;
  }
  if (Core.BREAKABLE[blocker.prop.piece]) return smashTowards({ ...input }, blocker, player);
  /* 让一步的方向由**障碍在哪一边**定死，不长在会在边界上翻面的答案上。 */
  const sidestep = player.x <= blocker.x ? "left" : "right";
  out[sidestep] = true;
  out[sidestep === "left" ? "right" : "left"] = false;
  return out;
}

/** 第一个挡住的那个实心件（找不到就是 null）。`hit` 收下它的盒子与中心。 */
function blockingProp(state, hit) {
  for (const prop of state.props || []) {
    if (!prop.solid || prop.broken) continue;
    const spec = Core.propBox(prop.piece);
    if (!spec) continue;
    const centre = prop.x + (spec.dx || 0);
    if (hit(prop, spec, centre)) return { prop, spec, x: centre, z: prop.z };
  }
  return null;
}

/*
 * bot 这一帧要往哪儿去：还有活怪就找最近那只，没有就找一扇开着的门
 * （上/下门要对上门的 x、再走到那一头；左右门直接走到墙）。
 */
function botGoal(state) {
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  if (alive.length) {
    const near = alive.reduce((best, enemy) =>
      (best && Math.abs(best.x - state.player.x) <= Math.abs(enemy.x - state.player.x)
        ? best : enemy), null);
    return { x: near.x, z: near.z || 0 };
  }
  const cell = Core.currentCell(state);
  const dirs = "NESW".split("").filter((d) => Core.exitMode(state, d) === "open");
  const dir = dirs[0];
  if (!dir) return null;
  if (dir === "E") return { x: Core.roomRight(state) - 30, z: state.player.z || 0 };
  if (dir === "W") return { x: Core.roomLeft(state) + 30, z: state.player.z || 0 };
  return { x: Core.doorX(state, cell, dir), z: dir === "N" ? Core.bandDepth(state.band) - 10 : 10 };
}

function kitingBot(state) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  /* A cracked slab is a telegraphed threat: step off it before it drops. */
  const input = { left: false, right: false, up: false, down: false, jump: false,
                  attack: false, skills: {} };
  Core.SKILL_ORDER.forEach((skillId) => {
    input.skills[skillId] = false;
  });
  if (alive.length === 0) {
    /*
     * 清完房就走出门。门口按地图上那一格的方向开（`docs/adr/0030`），所以"一路往右"
     * 不再能出门：先问**到 Boss 房的路**下一步往哪走（副本图有岔路，来回蹭两间房是
     * 走不到底的），再朝那个方向走 —— 上门/下门要先横向对上门的 x。
     */
    const route = routeToBoss(state);
    const dir = route[0];
    if (!dir) {
      input.right = true;
      return input;
    }
    if (dir === "E") {
      input.right = true;
      return detour(state, input, player.width);
    }
    if (dir === "W") {
      input.left = true;
      return detour(state, input, -player.width);
    }
    const stepZ = dir === "N" ? player.width : -player.width;
    /*
     * **先让开，再对门。** 这两条规矩会互相顶：门口那一列的桶让他往左让一步，
     * 而"对上门的 x"立刻把他推回来 —— 实测卡在 624 与 629 之间来回蹭，
     * 一局走不完（`docs/adr/0048`）。所以被挡住的时候，让路优先。
     */
    const blockedRow = blockingProp(state, (prop, spec, centre) =>
      Math.abs(player.x - centre) < spec.width / 2 + player.width / 2 + 8 &&
      Math.abs((player.z || 0) + stepZ - prop.z) < spec.depth / 2 + player.width / 2 + 8);
    if (blockedRow) return detourRow(state, input, stepZ);
    const doorX = Core.doorX(state, Core.currentCell(state), dir);
    if (Math.abs(doorX - player.x) > 20) {
      if (doorX > player.x) {
        input.right = true;
        return detour(state, input, player.width);
      }
      input.left = true;
      return detour(state, input, -player.width);
    }
    if (stepZ > 0) input.up = true;
    else input.down = true;
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
  /* Every threat below is a reach past the body, so the bot measures the gap. */
  const gap = bodyGapOf(target, player);
  /*
   * The floor's second axis. A caster holds its row - its shots carry the row it
   * stands on, so standing off the Slayer's is what makes him come to it - which
   * means a policy that only knows x can never finish that fight: it walks up and
   * swings at the floor. This walks the row the same way it walks the gap, with
   * the game's own reach as the threshold rather than a number of its own.
   */
  const rowGap = (target.z || 0) - (player.z || 0);
  const rowReach = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
  const offRow = Math.abs(rowGap) > rowReach;
  const rowStep = rowGap > 0 ? "up" : "down";
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
      if (gap < threatRange + 45) {
        if (player.onGround && elapsed >= target.spinDash.windup - 0.25) {
          input.jump = true;
        } else {
          input[closing] = true;
        }
      }
      return input;
    }
    /*
     * **只剩一只杂兵就不跑了。** 这条策略是"贴着就撤、只有被逼到墙角才还手"，
     * 场上还有别的怪时它总会被逼到墙角；**剩最后一只**（而且是个杂兵）时它就一直
     * 绕圈跑 —— 实测跑了 240 秒、一刀没砍中，门永远不开（`docs/adr/0050` 追记四）。
     * Boss 不在此列：它本来就得靠风筝。
     */
    const allChaff = alive.every((enemy) => enemy.maxHp <= 70);
    if (!allChaff && gap < threatRange + 45) {
      const away = delta > 0 ? "left" : "right";
      const atLeftWall = player.x <= Core.ROOM.leftWall + player.width;
      const atRightWall = player.x >= Core.ROOM.rightWall - player.width;
      const cornered = (away === "left" && atLeftWall) || (away === "right" && atRightWall);
      if (!cornered) {
        input[away] = true;
        return input;
      }
      /* Cornered: fighting back beats eating the whole wind-up for free. */
    }
    return input;
  }
  /*
   * Close to **his own reach**, measured as a gap, not to a fixed centre
   * distance. A flat "60 away" put him inside 牛头巨兽's body once the beast was
   * drawn at the size the client draws it - and being inside the body is being
   * inside its swing, which is where the policy's damage was coming from.
   */
  const closingGap = Core.PLAYER.attackReach * 0.35;
  if (gap > closingGap) {
    const direction = delta > 0 ? "right" : "left";
    input[direction] = true;
    if (offRow) input[rowStep] = true;
    return detour(state, input, delta > 0 ? player.width : -player.width);
  }
  /* Attacks only reach where the Slayer looks, so turn around first. */
  const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
  if (!facingTarget) {
    if (delta > 0) input.right = true;
    else input.left = true;
    return input;
  }
  /* In range sideways, but a swing only crosses his own row: walk onto it first. */
  if (offRow) {
    input[rowStep] = true;
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

test("a timing-aware policy can clear the whole stage without losing health", () => {
  const results = [1, 7, 42, 20260915].map((seed) => {
    const state = Core.createState({ seed });
    /*
     * Where the damage happened, room by room. A bare total says the policy got
     * hurt but not by what, and "the beast's new reach" and "a hazard the policy
     * mis-reads" are different problems.
     */
    const damageByRoom = [];
    const visited = new Set();
    const botLast = { x: NaN, z: NaN };
    let botStuck = 0;
    let last = -1;
    for (let frame = 0; frame < 60 * 240 && !state.victory && !state.defeat; frame += 1) {
      visited.add(state.cell);
      if (state.cell !== last) {
        last = state.cell;
        damageByRoom[last] = 0;
      }
      const before = state.stats.damageTaken;
      /*
       * **卡住就蹭一下。** 布景一密，"对上门的 x"和"让开挡路的东西"两条规矩会互相顶，
       * 实测在两三个像素之间来回蹭满一整局（`docs/adr/0049` / `0050` 都记过）。
       * 与其每改一次摆法就修一次 bot，不如让它**自己发现没动**：连着 40 帧没挪窝就
       * 改成上下蹭、再 200 帧还没动就横着蹭。它是脚手架，不该是这一片最容易坏的那件。
       */
      if (!state.victory && !state.defeat && frame % 60 === 0) {
        /*
         * **一秒一量，不是一帧一量。** 一帧一量会被亚像素的抖动骗过去：他贴着石头
         * 原地抖，每帧都"动"了 0.2 像素，于是这个计数永远是 0 —— 实测他那样停了
         * 七十五秒而 `botStuck` 还是 0。
         */
        const moved = Math.abs(state.player.x - botLast.x) +
          Math.abs(state.player.z - botLast.z);
        botStuck = moved < 8 ? botStuck + 1 : 0;
        botLast.x = state.player.x;
        botLast.z = state.player.z;
      }
      const walking = kitingBot(state);
      /*
       * **卡住就用游戏自己那套路网走。** 这条 bot 的走法是自己写的一堆"往目标挪一步、
       * 撞上了就让一让"，而布景一密，"对上门的 x / 让开挡路的东西 / 走到怪那一排"
       * 三件事会互相顶，实测能在原地蹭满一整局（`docs/adr/0050` 追记四）。
       * `Core.routeStep` 是**怪也在走**的那套一步 BFS（`docs/adr/0048`），
       * 拿它当兜底，比再加一条手写规矩稳。目标：还有活怪就找它，没有就找门。
       */
      if (botStuck > 1) {
        const goal = botGoal(state);
        if (goal) {
          const route = Core.routeStep(state, goal.x, goal.z, state.player.x, state.player.z);
          walking.up = route[1] > 0;
          walking.down = route[1] < 0;
          walking.right = route[0] > 0;
          walking.left = route[0] < 0;
        }
      }
      Core.step(state, walking);
      damageByRoom[last] = (damageByRoom[last] || 0) + (state.stats.damageTaken - before);
    }
    return { state, damageByRoom, visited };
  });

  results.forEach(({ state, damageByRoom, visited }) => {
    assert.equal(state.victory, true,
      `seed run ended defeated=${state.defeat} cell=${state.cell} of ${state.dungeon.cells.length}`);
    assert.equal(state.defeat, false);
    /*
     * 一路打到 Boss 房：**走过哪几格，就要把那几格的怪清光**。一局走的是他自己选的那条
     * 路（`docs/adr/0030`），所以总击杀数只有这条路上算得出来，不是整张图的怪。
     */
    /*
     * 领主房只数领主：它一倒下就通关，剩下的小怪会从场上拿掉、不用杀
     * （业主 2026-10-18）。其余走过的格子仍然要清光。
     */
    const routed = [...visited].reduce((total, cell) => {
      const roomIndex = state.dungeon.cells[cell].room;
      if (roomIndex === undefined) return total;
      const enemies = state.stage.rooms[roomIndex].enemies;
      if (cell === state.dungeon.boss) {
        return total + enemies.filter((enemy) => enemy.type === "boss").length;
      }
      return total + enemies.length;
    }, 0);
    assert.equal(state.stats.kills, routed,
      `seed ${state.seed}: ${visited.size} cells walked, ${routed} bodies in them`);
    /*
     * 「without losing health」, with the bar where the run's shape moved it.
     *
     * 一局现在走的是副本图上他自己的一条路（`docs/adr/0030`），比过去那条五间房的线
     * 长，路上还多了三个房间的怪。**2026-10-17 清房不再发强化卡**（`docs/adr/0053`），
     * 同一条策略不再有那几张卡的伤害/生命补正，实测承伤从 38-67 抬到 **62-121**
     * （最大生命 156-176；最高的那一局是 seed 42 的腐叶浅沟，121/168 ≈ 72%）。
     * 横线因此放到 **80%**：它守的是"读着冷却走的策略能不能把这一关走完"，不是
     * "一路不挨打" —— 后者这条测试给不了，也不该由它给。真玩觉得太硬，再回来调平衡。
     */
    assert.ok(state.stats.damageTaken <= state.player.maxHp * 0.8,
      `seed ${state.seed}: damageTaken=${state.stats.damageTaken} of ${state.player.maxHp} ` +
        `by room [${damageByRoom.join(", ")}] (${state.stage.rooms.map((r) => r.name).join(" / ")})`);
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
  /* A clear names the stage it cleared; only a defeat is generic. */
  assert.ok(
    texts.includes(STAGE.name + " 通关"),
    `a clear must name the stage: ${texts.join(" / ")}`
  );
  assert.ok(texts.includes("YOU DIED"));
});

test("the shipped sprite sheet matches the frame grid the renderer expects", () => {
  const file = path.join(__dirname, "..", "assets", "slayer.png");
  const buffer = fs.readFileSync(file);

  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), Render.SPRITE.frameW * Render.SPRITE.cols);
  assert.equal(
    buffer.readUInt32BE(20),
    Render.SPRITE.frameH * Object.keys(Render.SPRITE.rows).length
  );
  assert.deepEqual(Render.SPRITE.rows, {
    idle: 0,
    run: 1,
    attack: 2,
    skill: 3,
    extras: 4,
    clips: 5,
    clips2: 6,
    /* 大蹦's clip again with the katana's own pixels pushed red - see the
     * blood-blade test below and assets/import_dnf_swordman.py. */
    bloodblade: 7,
    /* 崩山击's own clip again, filled with the reference's yellow: the one frame
     * of him the clip paints flat (see the apex-flash test below). */
    flare: 8,
    /* 血之狂暴's own swing: the body's 188-209, on its own row at the bottom. */
    rage: 9,
    /* ... and the client's own slash arc alone, graded to cream. */
    ragearc: 10,
    /* 魔狱血刹's two body motions, on a row of their own below the stance's:
     * `clips2` had three columns left and a clip that overruns `cols` is
     * truncated in silence (see assets/import_dnf_swordman.py ROWS). */
    awaken: 11
  });
  /*
   * Every played frame has to exist inside its row. The run is the client's
   * **eight-frame cycle** (105-112; 113-116 is the dash thrust at the end).
   * The stand is the client's four "still" frames (176-179), so it only asks
   * for four.
   */
  Object.keys(Render.SPRITE.frames).forEach((row) => {
    const count = Render.SPRITE.frames[row];
    assert.ok(count > 0 && count <= Render.SPRITE.cols, `${row} frames must fit the row`);
  });
  assert.ok(Render.SPRITE.frames.idle >= 4, "the idle loop needs real frames");
  assert.equal(Render.SPRITE.frames.run, 8, "the run is the client's eight-frame cycle at 30fps");
  assert.ok(Render.SPRITE.frames.attack >= 4, "a cut needs wind-up, slash and recovery");

  const icons = fs.readFileSync(path.join(__dirname, "..", "assets", "skills.png"));
  assert.equal(icons.readUInt32BE(16), 32 * Core.SKILL_ORDER.length, "one icon per skill");
  assert.equal(icons.readUInt32BE(20), 32 * 2, "a skill row and a buff-badge row");
});

test("every frame the renderer plays fits inside its sprite cell", () => {
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  assert.equal(sheet.width, Render.SPRITE.frameW * Render.SPRITE.cols);
  assert.equal(sheet.height, Render.SPRITE.frameH * Object.keys(Render.SPRITE.rows).length);

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

/*
 * 大蹦's sword goes blood for the strike and comes back when the cast ends -
 * the owner: 「释放大蹦后，剑变成血剑，释放完变成原来的剑」. His reads on which
 * half of that belongs to the move have moved twice, and the split it settles
 * on is worth stating: the red **body** is 血之狂暴 and belongs to the stance,
 * but the **sword** going blood is the move's own effect - the reference's
 * character carries a red weapon anyway, so the sword changing is not the
 * weapon's colour showing through.
 *
 * It is baked as a copy of the clip's own cells on a row of its own, and this
 * test is about why that is not an implementation detail: a copy cannot miss
 * the blade it is meant to be. An overlay would have to be aimed at wherever
 * his sword happens to be in each of the four poses, and the ones that come out
 * wrong come out wrong silently.
 */
test("大蹦's sword turns to blood for the strike, and back after", () => {
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  const clip = Render.SPRITE.skillClips.mountainRift;
  const clipRow = clip.row;
  const bloodRow = Render.SPRITE.rows.bloodblade;
  const at = (row, col, x, y) =>
    sheet.pixels.subarray(
      ((row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4,
      ((row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4 + 4
    );
  const silver = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 30 && Math.max(r, g, b) > 110;

  let blades = 0;
  for (let step = 0; step < clip.frames; step += 1) {
    const col = clip.first + step;
    /* The two middle beats are the ones that carry the blade; `step` is a frame,
     * so find which beat owns it rather than indexing the beats by it. */
    let cursor = 0;
    let owner = null;
    for (const beat of clip.beats) {
      if (step < cursor + beat.frames) { owner = beat; break; }
      cursor += beat.frames;
    }
    const carries = !!(owner && owner.blood);
    let copyInk = 0;
    let bladeInk = 0;
    for (let y = 0; y < Render.SPRITE.frameH; y += 1) {
      for (let x = 0; x < Render.SPRITE.frameW; x += 1) {
        const plain = at(clipRow, col, x, y);
        const red = at(bloodRow, col, x, y);
        if (red[3] === 0) continue;
        copyInk += 1;
        /*
         * The copy is the same picture: where the plain cell has nothing, so
         * has it - a blade that grew a pixel of its own is a second thing
         * drawn beside him, which is what this row exists to not be.
         */
        assert.equal(red[3], plain[3], `cell ${col} pixel ${x},${y}: the copy keeps his silhouette`);
        /* The bake leaves the near-invisible edge alone (alpha <= 60); so does
         * this, or the two disagree about pixels neither can see. */
        if (plain[3] <= 60) continue;
        if (silver(plain)) {
          bladeInk += 1;
          assert.ok(
            red[0] > red[1] * 2 && red[0] > red[2] * 2,
            `cell ${col} pixel ${x},${y}: the katana's silver has to come out blood`
          );
        } else {
          /*
           * Everything that is not the blade is his body, and his body is the
           * stance's business: the blood copy leaves it exactly alone, or this
           * row reddens him a second time on top of 血之狂暴's own sheet.
           */
          assert.deepEqual(
            [...red.subarray(0, 3)],
            [...plain.subarray(0, 3)],
            `cell ${col} pixel ${x},${y}: the blood blade must not touch his body`
          );
        }
      }
    }
    if (carries) {
      assert.ok(bladeInk > 50, `cell ${col} carries a blade to see (${bladeInk} red pixels)`);
    } else {
      /*
       * And it is only red where the *move* has the sword out in its blood
       * form: the raise keeps the plain katana (「使用技能前和跳起来的剑是不
       * 一样」) and so does the stand he is left in.
       */
      assert.equal(copyInk, 0, `cell ${col} keeps the plain katana`);
    }
    blades += bladeInk;
  }
  assert.ok(blades > 200, `and there are blades to see (${blades} red pixels in all)`);

  /* And the renderer plays it only for as long as the cast is out. */
  const state = Core.createState({ seed: 5 });
  const player = state.player;
  const at2 = (fraction) => {
    player.skillId = "mountainRift";
    player.skillTimer = Core.SKILLS.mountainRift.duration * (1 - fraction);
    return Render.playerFrame(state, player).row;
  };
  assert.equal(at2(0.05), clipRow, "the raise is his own sword");
  assert.equal(at2(0.2), bloodRow, "the leap carries the blood blade");
  assert.equal(at2(0.45), bloodRow, "and so does the landing");
  assert.equal(at2(0.8), clipRow, "and it is the plain katana again for the stand");
});

/*
 * 崩山击's apex flash - the one frame of the reference that paints him flat
 * yellow (#34 of 01 崩山击, 0.400s after his feet leave the ground and 0.200s
 * before they come back to it).
 *
 * It is the same trick as the blood blade and for the same reason: the pack
 * ships no such layer (its seven 崩山击 candidates are spike fans, fire and a
 * blue finish), so the flash is his *own* art filled, on a row of its own. A
 * copy cannot be aimed wrong, and the fill is what makes it a flash rather than
 * a second character: nothing about him changes colour, he is lit up.
 */
test("崩山击 flashes yellow at the top of its hop, behind him", () => {
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  const clip = Render.SPRITE.skillClips.mountainBreaker;
  const flareRow = Render.SPRITE.rows.flare;
  const flare = clip.flare;
  const at = (row, col, x, y) =>
    sheet.pixels.subarray(
      ((row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4,
      ((row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4 + 4
    );

  let lit = 0;
  for (let step = 0; step < clip.frames; step += 1) {
    const col = clip.first + step;
    let copyInk = 0;
    for (let y = 0; y < Render.SPRITE.frameH; y += 1) {
      for (let x = 0; x < Render.SPRITE.frameW; x += 1) {
        const plain = at(clip.row, col, x, y);
        const flash = at(flareRow, col, x, y);
        /* Column for column with the clip, so the renderer can hand this row the
         * column it is already drawing and it cannot come out on a different
         * pose from the body it is behind. */
        assert.equal(
          flash[3],
          plain[3],
          `cell ${col} pixel ${x},${y}: the flash keeps his own silhouette`
        );
        if (flash[3] <= 60) continue;
        copyInk += 1;
        assert.ok(
          flash[0] > 200 && flash[1] > 140 && flash[2] < 160,
          `cell ${col} pixel ${x},${y}: the flash is the reference's yellow`
        );
      }
    }
    assert.ok(copyInk > 100, `cell ${col} has a body to light up (${copyInk} pixels)`);
    lit += copyInk;
  }
  assert.ok(lit > 1000, `and the whole clip is lit (${lit} pixels)`);
  /* Nothing beyond the clip's own nine columns: the row is the clip's and
   * nothing else's, so no other move can flash with it. */
  for (let col = clip.first + clip.frames; col < Render.SPRITE.cols; col += 1) {
    let ink = 0;
    for (let y = 0; y < Render.SPRITE.frameH; y += 1) {
      for (let x = 0; x < Render.SPRITE.frameW; x += 1) if (at(flareRow, col, x, y)[3] > 0) ink += 1;
    }
    assert.equal(ink, 0, `column ${col} is not this clip's`);
  }

  /* The reference's flash sits just past the top of the hop, and only there. */
  assert.ok(flare.from > 0.3 && flare.from < 0.4, "the flash opens just past the apex");
  assert.ok(flare.until > flare.from, "and it closes");
  assert.ok(flare.until - flare.from < 0.05, "a flash is a frame or two, not a pose");
  /*
   * And it rides the coil, not the swing that follows it. #34 of the reference
   * still has the blade up, and the flash is a silhouette of *him*: pointed at
   * the crescent's cell it became the slash's own arc instead - a yellow scythe
   * twice his width, with the character a speck inside it.
   */
  assert.ok(
    flare.from >= clip.beats[1].from && flare.until <= clip.beats[1].until,
    "the flash rides the pose the reference flashes, not the crescent after it"
  );

  const state = Core.createState({ seed: 5 });
  const player = state.player;
  const flashAt = (fraction) => {
    player.skillId = "mountainBreaker";
    player.skillTimer = Core.SKILLS.mountainBreaker.duration * (1 - fraction);
    return Render.flareFlash(player);
  };
  assert.equal(flashAt(flare.from - 0.01), null, "the hop climbs unlit");
  assert.equal(flashAt((flare.from + flare.until) / 2), flare, "the apex flashes");
  assert.equal(flashAt(flare.until + 0.01), null, "and the descent is unlit");
  /* No other move has one, and neither has a 崩山击 that is not being cast. */
  player.skillId = "mountainRift";
  player.skillTimer = Core.SKILLS.mountainRift.duration * 0.7;
  assert.equal(Render.flareFlash(player), null, "大蹦 has no flash to run");
  player.skillId = "mountainBreaker";
  player.skillTimer = 0;
  assert.equal(Render.flareFlash(player), null, "and neither has a cast that is over");

  /*
   * Behind him, and off the plain sheet: drawPlayer has to put the flash down
   * before it draws the body, or it covers the character instead of glowing out
   * from behind him. A flash of light over him would also be the one thing the
   * stance's own tint could turn into a second red.
   */
  const renderSource = fs.readFileSync(path.join(__dirname, "..", "src", "render.js"), "utf8");
  const flareAt = renderSource.indexOf("var flare = flareFlash(player);");
  const bodyAt = renderSource.indexOf(
    "drawSpriteFrame(ctx, body, frame.col, frame.row, player.x, feetY(player), player.facing < 0);"
  );
  assert.ok(flareAt > 0, "drawPlayer draws the flash");
  assert.ok(bodyAt > flareAt, "and draws it before the body, so it is behind him");
  assert.match(
    renderSource,
    /drawSpriteFrame\(ctx, image, frame\.col, SPRITE\.rows\.flare, player\.x, feetY\(player\),\s*\n\s*player\.facing < 0, flare\.scale\);/,
    "off the plain sheet, scaled by what the clip declares"
  );
});

test("血之狂暴's chain still comes round: its window scales with its slower swing", () => {
  /*
   * The owner, after the stance's swings got their own 22-frame animation:
   * 「是不是少动作了」. They were: the combo window was a flat 0.45s, the stance
   * made a press last 0.44s, and by the time the next press was allowed the
   * window had run out - `comboIndex` never left 0, so a chain that walks three
   * swings only ever played the first of them (8 of the 22 frames).
   *
   * So this pins the two numbers that have to agree: a press may be taken as soon
   * as `attackCooldown` allows, and the window a press opens has to outlast that.
   */
  const state = Core.createState({ seed: 11 });
  const base = state.player.attackDuration;
  state.player.buffs.bloodRage = Infinity;
  const speed = Core.attackSpeedOf(state.player);
  const swing = (base / speed) * Core.FPS;
  assert.ok(speed < 1, "the stance swings slower than his own combo");

  /* Mash X the moment the game allows it, and watch the indexes come round. */
  const seen = new Set();
  for (let i = 0; i < 12 * Core.FPS; i += 1) {
    const player = state.player;
    const ready =
      player.attackTimer <= 0 && player.attackCooldown <= 0 && player.skillTimer <= 0;
    Core.step(state, ready ? { attack: true } : {});
    if (player.attackTimer > 0) seen.add(player.comboIndex);
  }
  assert.deepEqual(
    [...seen].sort(),
    [0, 1, 2],
    "mashing walks the whole chain instead of replaying its first cut"
  );

  /* And the window a press opens is longer than the slowest press it must catch. */
  state.player.attackTimer = 0;
  state.player.attackCooldown = 0;
  Core.step(state, { attack: true });
  const cycle = state.player.attackCycle;
  assert.ok(
    state.player.comboTimer > cycle * 0.95,
    `the window (${state.player.comboTimer.toFixed(2)}s) must outlast the press cycle (${cycle.toFixed(2)}s)`
  );
  assert.ok(swing > 0, "sanity: the swing has frames to play");
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
   * 崩山击 has to read as the training-room reference, which opens on the lift:
   * 187 (the blade still down and forward, the pose he is already standing in),
   * 194/203 (both hands up, the blade over the head - the client's own 举剑),
   * 204-205 (the coil at the top of the hop), the smash's crescent (206-207)
   * coming down through the fall, the low lunge it lands in (208-209), and the
   * client's own get-up (210-211) back onto 187, the pose he stands in. The
   * client's own hop frames (127-132) are out: they carry no
   * sword motion, so putting them in front of the smash gave the move two
   * wind-ups (owner: 「举剑过头」is part of the jump).
   *
   * The boundaries are the reference's own frames, folded into this cast
   * (`p = (0.05 + (k - 22) / 30) / 1.3`, k over 01 崩山击's own numbering):
   * #32-33 is the apex at 0.29-0.32, #34 opens the fall at 0.35, #41 puts his
   * feet down at 0.53 and the rise runs #51-56 (0.78-0.91). The three beats
   * after the lift used to sit an act late - the crescent did not open until
   * 0.45, so he was still swinging at the top of the hop where the reference
   * already has the blade down - and the move then held the lunge where the
   * reference gets up.
   */
  const smash = Render.SPRITE.skillClips.mountainBreaker;
  assert.equal(smash.row, Render.SPRITE.rows.clips);
  assert.equal(smash.first, 0, "崩山击 opens the first clip row");
  assert.equal(smash.frames, 12, "the lift, the coil, the crescent, the lunge and the get-up");
  const beats = smash.beats.map((beat) => beat.frames);
  assert.deepEqual(beats, [3, 2, 2, 2, 2, 1], "each act is paced on its own");
  /* Each act hands over to the next, and each boundary is a reference frame. */
  assert.deepEqual(
    smash.beats.map((beat) => [beat.from, beat.until]),
    [[0, 0.29], [0.29, 0.35], [0.35, 0.51], [0.51, 0.78], [0.78, 0.89], [0.89, 1]],
    "the acts change over on the reference's own apex, fall, touchdown and rise"
  );
  assert.ok(
    smash.beats[0].until <= Core.SKILLS.mountainBreaker.activeFrom / Core.SKILLS.mountainBreaker.duration,
    "and the blade is up before the hit, not on it"
  );
  /*
   * The crescent is the fall, so the hit - a frame after touchdown - lands in
   * the lunge the reference lands in, not on the swing (#41 holds the low pose
   * from 0.53 all the way to the rise at the end).
   */
  const hitAt = Core.SKILLS.mountainBreaker.activeFrom / Core.SKILLS.mountainBreaker.duration;
  assert.ok(
    smash.beats[2].until <= hitAt,
    `the swing is over before he lands on it (crescent ends ${smash.beats[2].until}, hit at ${hitAt})`
  );
  assert.equal(
    beats.reduce((total, count) => total + count, 0),
    smash.frames,
    "every baked frame belongs to a beat"
  );
  /*
   * And the clip is the one the bake ships. The last three are the get-up the
   * reference does at #51-56 and this move used to skip: the client's own 210
   * (up off the back knee, blade across the chest) and 211 (nearly upright),
   * back onto 187 - the pose he stands in, which is also the frame this clip
   * opens on, so the move ends where it started. 崩山裂地斩 keeps its own 132
   * stand for the same reason; 崩山击 must not end on the lunge the way it used
   * to, holding it for the last third of the cast with the reference standing.
   */
  const smashBake = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_swordman.py"),
    "utf8"
  );
  assert.match(
    smashBake,
    /"mountainBreaker", \[187, 194, 203, 204, 205, 206, 207, 208, 209, 210, 211, 187\]\)/,
    "崩山击 rises out of its lunge and is left standing where it started"
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

  /* The same mid-leap frame for 大蹦 - whose leap carries the blood blade. */
  player.skillId = "mountainRift";
  player.skillTimer = Core.SKILLS.mountainRift.duration * 0.5;
  const rift = Render.SPRITE.skillClips.mountainRift;
  const leapRift = Render.playerFrame(state, player);
  assert.equal(
    leapRift.row,
    Render.SPRITE.rows.bloodblade,
    "大蹦 keeps its action in the air too - on the blood-bladed copy of it"
  );

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
  /*
   * Read from the move's own block, not from the whole file: 怒气爆发 declares a
   * window of its own now (see the test below), and counting every `"window":` in
   * the bake would make this pair's count depend on how many other picks happen
   * to have one.
   */
  const riftWindows = [
    ...source
      .slice(source.indexOf('"mountainRift": {'))
      .matchAll(/"window":\s*\((-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+)\)/g)
  ].map((match) => match.slice(1).map(Number));
  assert.equal(riftWindows.length, 2, "both halves of the move declare a window");
  assert.deepEqual(
    riftWindows[0],
    riftWindows[1],
    "and it is the same window for both, or one draw size cannot place them"
  );
  const [left, top, right, bottom] = riftWindows[0];
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
    Render.EFFECT.cell * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount),
    "one baked effect row per skill, plus the orb / dive / crescent / two blades / 大蹦-fire rows"
  );
  /*
   * Each row carries its own frame count: the picked moves ship their whole
   * sequence, everything else the four-frame sample. Read the sheet back and
   * count the drawn columns per row, so a stale atlas cannot pass.
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  /*
   * Which rows are staged, read off the bake. A staged row is a *timeline*, not
   * a sequence: its columns are fixed windows of the cast and the moves that have
   * a quiet act leave those columns empty on purpose (大蹦 holds its ring with
   * only the cracks lit; 怒气爆发 has seven tenths of a second between its burst
   * and its column). Every other row is one shape played back to back, so a hole
   * in it really is a frame of the wrong shape at that moment.
   */
  const bake = fs.readFileSync(
    path.join(__dirname, "..", "assets", "import_dnf_effects.py"),
    "utf8"
  );
  const picks = bake.slice(bake.indexOf("PICKS = {"), bake.indexOf("\n}\n", bake.indexOf("PICKS = {")));
  const staged = new Set(
    Core.SKILL_ORDER.filter((skillId) => {
      const at = picks.indexOf(`"${skillId}": {`);
      if (at < 0) return false;
      /* To the next key of the same block, so one pick's `stages` cannot vouch
         for the pick above or below it. */
      const next = picks.indexOf('\n    "', at + 1);
      return picks.slice(at, next < 0 ? picks.length : next).includes('"stages"');
    })
  );
  Core.SKILL_ORDER.forEach((skillId, row) => {
    /* 大蹦's rows are not on this sheet - see the rift sheet below. */
    if (Render.EFFECT.riftRows[skillId]) return;
    const declared = Render.EFFECT.rowFrames[skillId];
    assert.ok(declared > 0, `${skillId} needs a row length`);
    const drawn = [];
    for (let column = 0; column < Render.EFFECT.maxFrames; column += 1) {
      if (cellAlphaBox(sheet, column, row, Render.EFFECT.cell, Render.EFFECT.cell)) drawn.push(column);
    }
    assert.ok(drawn.length > 0, `${skillId} has no art in its row at all`);
    /*
     * A row is one timeline over one cast, and it is declared as long as the
     * cast is. A row may not run past its own length, and it ends on its last
     * column: the move's last act is at the end of the cast, not somewhere in
     * the middle with dead air after it.
     */
    assert.ok(
      drawn[drawn.length - 1] < declared,
      `${skillId} draws past its declared ${declared} frame(s)`
    );
    assert.equal(
      drawn[drawn.length - 1],
      declared - 1,
      `${skillId} should end on its last column (${declared - 1})`
    );
    if (!staged.has(skillId)) {
      assert.ok(
        drawn.every((column, index) => column === drawn[0] + index),
        `${skillId} frames must be packed with no hole in the row`
      );
      assert.equal(drawn[0], 0, `${skillId} frames must be packed from column 0`);
    }
  });
  assert.equal(Render.EFFECT.rowFrames.mountainBreaker, 6, "崩山击 ships its six-frame ground slash");
  assert.equal(Render.EFFECT.rowFrames.crossSlash, 34, "十字斩 ships the clip's own thirty-four frames");
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
  /*
   * **魔狱血刹's 火山 is the third row**, and its own length is what the sheet is
   * as wide as - the sheet is as long as its longest row, which is the
   * volcano's sixty columns rather than 大蹦's forty-five.
   */
  const volcano = Render.EFFECT.riftRows.hellbenterSlam;
  assert.ok(volcano, "魔狱血刹 declares its eruption on the same sheet");
  assert.equal(volcano.back, 2, "as the row after 大蹦's two");
  const riftColumns = Math.max(Render.EFFECT.maxFrames, Render.EFFECT.rowFrames.hellbenterSlam);
  const riftColumnsDrawn = (row, columns) => {
    const drawn = [];
    for (let column = 0; column < columns; column += 1) {
      if (cellAlphaBox(riftSheet, column, row, Render.EFFECT.riftCell, Render.EFFECT.riftCell)) {
        drawn.push(column);
      }
    }
    return drawn;
  };
  const riftBuffer = fs.readFileSync(path.join(__dirname, "..", "assets", "rift.png"));
  assert.equal(riftBuffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(
    riftBuffer.readUInt32BE(16),
    Render.EFFECT.riftCell * riftColumns,
    "the rift sheet is as long as its longest row"
  );
  assert.equal(riftBuffer.readUInt32BE(20), Render.EFFECT.riftCell * 3, "and holds all three rows");
  const riftSheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "rift.png"));
  const columnsDrawn = (row) => riftColumnsDrawn(row, riftColumns);
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
   * The fire row opens on its own first act, and that act is the landing: the
   * raise carries no blood of its own (docs/adr/0003), so the head of the row is
   * empty until he drives the sword in. The stage windows are what pin that, in
   * 大蹦 plays in stages below.
   */
  assert.equal(
    Render.EFFECT.frontFrames.mountainRift,
    Render.EFFECT.maxFrames,
    "the fire row runs on the rift's timeline, or the two halves drift apart"
  );
  const fireFrames = columnsDrawn(rift.front);
  assert.ok(
    fireFrames[0] > 0,
    "and it opens on the eruption, not on the raise - nothing burns before the slam"
  );
  assert.ok(
    fireFrames.every((column, index) => column === fireFrames[0] + index),
    "and runs on with no hole in it"
  );
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
  /*
   * A row whose columns are a reference clip's own frames writes its stage
   * windows as `ref(44)` rather than as a fraction - `ref`'s docstring has the
   * reason. This test compares windows, so it has to read them the same way the
   * bake does, and it takes `ref`'s own declared bounds rather than assuming
   * 十字斩's cast.
   */
  const refBounds = /def ref\(frame: int, first: int = (\d+), last: int = (\d+)\)/.exec(source);
  assert.ok(refBounds, "the bake declares what a reference frame number means");
  const refFirst = Number(refBounds[1]);
  const refLast = Number(refBounds[2]);
  const asFraction = (frame, number) =>
    frame === undefined
      ? Number(number)
      : (Number(frame) - refFirst) / (refLast - refFirst);
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
    for (const [, entry, middle, fromRef, fromNum, untilRef, untilNum] of text.matchAll(
      /"entry":\s*"([^"]+\.img)"([^}]*)"from":\s*(?:ref\((\d+)\)|([\d.]+)),\s*"until":\s*(?:ref\((\d+)\)|([\d.]+))/g
    )) {
      const range = /"frames":\s*\((\d+),\s*(\d+)\)/.exec(middle);
      const offset = /"offset":\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/.exec(middle);
      stages.push({
        shape: entry.replace(/^\((?:tn|18)\)/, ""),
        from: asFraction(fromRef, fromNum),
        until: asFraction(untilRef, untilNum),
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
   * effect no longer floats wherever its bounding box sits.
   *
   * It bakes from the **plain** board, which is the red one, and that reverses
   * slices 38/39. Those read the official BloodBlast preview - a pale-gold plume
   * - and baked "(tn)" to match it. But the reference the owner names for this
   * move is the training-room clip, and that measures saturated red with blue at
   * zero (ring 217,27,4; column 249,58,3), as does the pack's own preview. 大蹦
   * sits in the same split and the repo already ships it red. So this assertion
   * is the one that would catch a slide back to the gold board - see
   * docs/adr/0006.
   *
   * It is also staged rather than stacked: the clip's two eruptions are a beat
   * apart with nothing between them, and stacking the pack played both at once.
   */
  const rageBurst = blocks.find((entry) => entry.skill === "rageBurst");
  const rageText = picks.slice(rageBurst.from, picks.indexOf("\n}", rageBurst.from));
  assert.match(rageText, /"anchor":\s*\(\s*-?\d+,\s*-?\d+\s*\)/, "rageBurst needs a ground anchor");
  assert.match(rageText, /"palette":\s*""/, "rageBurst bakes the pack's own red board");
  assert.doesNotMatch(rageText, /"palette":\s*"\(tn\)"/, "and never the pale-gold one");
  assert.match(rageText, /"stages":\s*\[/, "rageBurst plays in windows, not as one stack");
  assert.match(rageText, /"window":\s*\(\s*-?\d+,\s*-?\d+,\s*\d+,\s*\d+\s*\)/,
    "and declares the window that is its zoom");
  /*
   * Every use of the ring's two halves names the same line to scale about. That
   * line is the whole reason the ring can be flattened at all (see `rescale`):
   * without it each half scales about its own bottom, 38px apart, and the ring
   * is flat at the front and round at the back. Counted rather than pattern-
   * matched once, because a stage that forgets it is the failure mode.
   */
  const abouts = [...rageText.matchAll(/"about":\s*(\d+)/g)].map((match) => Number(match[1]));
  const halves = (rageText.match(/blood_floor_(?:front|back)\.img/g) || []).length;
  assert.ok(halves >= 4, `the ring's two halves are used for the burst and its tail (${halves})`);
  assert.equal(abouts.length, halves, "every ring half flattens about a named line");
  assert.equal(new Set(abouts).size, 1, "and the two halves name the same one");
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
   * The fan's drawn width is the *row's* zoom, not the fan's own scale, and the
   * pair below is what that costs.
   *
   * The fan is the widest thing in this row, so the row's ink window is measured
   * across the fan: every client pixel of fan the scale adds, the window adds
   * too, and fit_scale hands the gain straight back. Measured on the bake,
   * taking the fan's scale from 1.2 to 1.6 moved its cell from 109 to 116px
   * while the column lost a fifth of its own size to the shrunken fit. So the
   * fan's scale stays where round 12 signed it off - what fills the cell is the
   * fan, so its drawn width is (cell - margin) / cell * `size` and nothing else.
   * 264 puts it at the reference's 2.80 Slayer-heights (01 崩山击's burst frame,
   * x 699..1308 against a 218px Slayer); 236 left it at 2.39.
   *
   * Growing `size` grows the column with it, so the column's stretch is the one
   * it was measured at (1.36, 1.66), scaled by 236/264 - the column still
   * measures what slice 63 signed off (1.06 x 1.56 against the reference's
   * 1.06 x 1.51).
   */
  assert.match(
    smashText,
    /"stretch":\s*\(1\.15,\s*1\.46\)/,
    "the column keeps the size it was measured at, scaled by the row's new zoom"
  );
  const renderText = fs.readFileSync(path.join(__dirname, "..", "src", "render.js"), "utf8");
  assert.match(
    renderText,
    /mountainBreaker:\s*\{\s*dx:\s*70,\s*dy:\s*-66,\s*size:\s*264\b/,
    "and the row is zoomed out to the fan's width, which is what 264 is"
  );
  /*
   * The impact stands in front of him, not on him. Measured against the
   * nameplate over his head - the one thing in the clip that holds still - the
   * reference's fire centre is 70px ahead of him at the landing and 87px ahead
   * at the burst peak; the row's anchor is the column's foot, so dx is where
   * that foot goes. It is the same complaint the owner sent back on 大蹦 once:
   * 「火焰都靠近角色，没有在圈内」.
   */
  assert.match(
    renderText,
    /mountainBreaker:\s*\{\s*dx:\s*70,/,
    "and its column stands where the reference stands it, in front of him"
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
    (fireText.match(/"ramp":\s*(FIRE_RAMP|BODY_RAMP)/g) || []).length,
    (fireText.match(/"entry":/g) || []).length,
    "every layer of the fire is ramped - the debris, which is plain rock, lives on the ground row"
  );
  /*
   * The fire is the other half of the same pack, and it is drawn over the
   * Slayer: the rift stays behind him on the skill's own row, and the flames
   * that come out of the split are on a front row baked to the same window.
   *
   * What is *not* here any more is a blade of its own. The reference's long red
   * blade is the sword he is already holding under 血之狂暴, and the two windows
   * this row used to spend on the pack's own bloodsword read as 「凭空多出来一
   * 把血剑」 - see docs/adr/0003. That is what this pins: the art is still in the
   * pack, and it is not drawn.
   */
  const frontStart = source.indexOf("FRONT_ROWS = [");
  assert.ok(frontStart > 0, "the bake declares the rows drawn in front of the Slayer");
  const frontText = source.slice(frontStart, source.indexOf("\n]\n", frontStart));
  assert.ok(
    !/bloodsword/.test(frontText.replace(/^\s*#.*$/gm, "")),
    "大蹦 summons no blade of its own (docs/adr/0003)"
  );
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
      scale: scale ? Number(scale[1]) : 1,
      /* The rest of the stage's own text, for the few things a test reads
       * straight off it - which ramp a layer is on, mostly. */
      raw: middle
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
   * And no blade of its own is drawn on either row. The reference's long red
   * blade is the sword he is already holding under 血之狂暴, and the pack's own
   * bloodsword - which this row spent two windows on - read as 「凭空多出来一把
   * 血剑」. See docs/adr/0003.
   */
  assert.ok(
    ![...back, ...front].some((stage) => stage.entry.includes("bloodsword")),
    "大蹦 draws no blade of its own on either row (docs/adr/0003)"
  );
  /*
   * What the fire does have to answer is the landing: its first flame opens on
   * the beat the sword goes into the ground, `activeFrom`.
   */
  const opensOn = Math.min(
    ...front
      .filter((stage) => /bloodsexp_[12]/.test(stage.entry))
      .map((stage) => toCast(stage.from))
  );
  assert.ok(
    Math.abs(opensOn - spec.activeFrom) < 0.1,
    `the first flame opens on the slam (${opensOn.toFixed(2)}s vs ${spec.activeFrom}s)`
  );
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
  /*
   * In Slayer-heights now, not client px: until slice 65 the two spires behind
   * the caster set this span's near end, and with those gone the fire's own ends
   * do. The clip's fire runs 0.19-2.65 of a Slayer forward of him in the second
   * wave and 0.38 behind his feet in the first, so "the length of the gash" is
   * two of his heights for the two waves together.
   */
  const slayerPx = Render.SPRITE.bodyHeight / 0.596;
  assert.ok(
    spansAcross > 2 * slayerPx,
    `the fire runs two Slayer-heights of gash at least (${spansAcross}px of client art)`
  );
  /*
   * **No tongue stands on him.** The row behind the Slayer carries the ground he
   * stands in, not fire: two spires used to be baked there at u 25 and u -20, on
   * the reading that "the near end of the gash is where his own body is", and
   * they put a 1.4-Slayer column on his shoulders - the other half of what the
   * owner read as 「还是靠近角色」. Masking his own red body out of the clip's
   * 720px frames (x 312-356) and cutting the fire off above the glowing floor
   * (y < 340), the second wave's tongues begin **+0.19 of a Slayer in front of
   * him** and run to +2.65: he stands clear, in the open. Its first wave is the
   * one that hugs him (tongues to 0.38 behind his feet), and that fire is a
   * front-row bush whose own art edge runs back over him - so nothing has to be
   * drawn behind the Slayer to get it.
   */
  const behind = back.filter(isFlame);
  assert.equal(
    behind.length,
    0,
    "no tongue is composited behind him: the ground is, the fire is not"
  );
  const inFront = front.filter(isFlame);
  assert.equal(
    inFront.length,
    everyFlame.length,
    "so every flame of the move is drawn over him"
  );
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
   * fire the lull burns, 1.15 for the landing, 2.20 at the top of the second
   * wave, where 179px of art comes out 2.5 Slayers tall.
   *
   * The 2.1 ceiling on that scale moved twice in slice 65. The clip's tallest
   * tongues reach 2.5 Slayers against the ruler (measured on the outro frame,
   * where he stands alone: his drawn height in the 720px frame is 112px), which
   * is 2.2 of the spire's 179px of art once the faint tip is discounted - so
   * 2.1 put a ceiling *below the reference* and is what 「火焰要高一下」 was
   * about. It went to 2.6 for the near end: measured across the second wave's
   * frames, the clip's fire comes within 0.10 of a Slayer of his feet at 0.25 of
   * a Slayer up and is still only 0.25 out at 2.0 - so the flames beside him are
   * tall ones, and a ceiling under 2.2 cannot draw that edge.
   */
  assert.ok(
    everyFlame.every((stage) => stage.scale >= 0.75 && stage.scale <= 2.6),
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
  /*
   * And the tall tongues are **scattered along the rank**, not stacked on one
   * side. The clip's crest, measured per quarter-Slayer column over #86-#115
   * (median across frames, and the tallest each column ever reaches), is
   * 1.0-1.4 Slayers of low fire with tongues of 2.0-2.6 poking out of it, and
   * those stand all along it - 2.6 near him, 2.4 at the far end, 1.9-2.05 in
   * between. The owner, looking at the clip and then at ours: 「火焰要高一下…
   * 没有一侧是显著高的」. Ours was a monotone fall from 1.75 to 1.00 - 2.2
   * Slayers at one end against 1.1 at the other - and no side-scatter check
   * would have caught it, which is why this one has teeth: each half of the
   * rank has to carry a tongue within 85% of the tallest.
   */
  const tallPlaces = second
    .filter((stage) => stage.scale >= 1 && shapeOf(stage) === "bloodsexp_2")
    .map((stage) => ({ u: stands(stage)[0], scale: stage.scale }));
  const tallest = Math.max(...tallPlaces.map((p) => p.scale));
  const rankMid = (Math.min(...tallPlaces.map((p) => p.u)) + Math.max(...tallPlaces.map((p) => p.u))) / 2;
  [tallPlaces.filter((p) => p.u < rankMid), tallPlaces.filter((p) => p.u >= rankMid)].forEach(
    (half, index) => {
      assert.ok(
        half.some((p) => p.scale >= tallest * 0.85),
        `the ${index === 0 ? "near" : "far"} half of the second eruption carries a tall tongue, the way the clip's does`
      );
    }
  );
  /*
   * The two slabs end on the **same ground**: the second eruption is not a
   * shorter rank bunched up inside the landing wave's. Measured off
   * 10_崩山裂地斩 with one mask on both, its two waves run 346px and 371 - the
   * second a shade wider, ending 20px past the first. The owner's first note was
   * the far end of this (「第二波岩浆偏向角色方向…应该岩浆范围和第一波一样」) and
   * the old rank stopped 134px short of where the landing wave's slab does.
   *
   * **Bushes only, and not the embers** (`from < 0.8`). Comparing like shapes
   * keeps this free of the two shapes' own art widths and of the Slayer-height
   * conversion - it is the same ruler on both sides. And the embers have to go:
   * they are the same bush at 0.75-0.78 running the whole gash in both waves, so
   * a span that counted them would let a far-out ember stand in for a rank that
   * had bunched up, which is how the old bake passed a span check while
   * measuring 0.58 by its tongues.
   */
  const slabEnd = (wave) =>
    Math.max(
      ...wave
        .filter((stage) => shapeOf(stage) === "bloodsexp_1" && stage.from < 0.8)
        .map(stands)
        .map(([u]) => u)
    );
  const endStep = slabEnd(first) - slabEnd(second);
  assert.ok(
    Math.abs(endStep) <= 45,
    `the two waves' slabs end on the same ground (${slabEnd(second)} against ${slabEnd(first)}px forward)`
  );
  /*
   * And its near end keeps the clip's own split: **low fire on his feet, tall
   * tongues clear of him.** Both halves of this were the owner playing it. First
   * 「还是靠近角色」 - the wave stood a column on his shoulders, so the rank moved
   * out and the spires baked behind him came out; then 「靠近角色有一个小小的空间
   * 没有岩浆，换言之就是空了一块」 - moving the rank out had left a bare strip of
   * floor between him and the fire, and the clip has no hole there: measured per
   * quarter-Slayer column over #86-#115, its second wave keeps 0.75 Slayers of
   * fire at his feet and 1.18 just in front, while its tongues begin +0.19 out.
   * So one bush stands back at the near end (1.0 Slayer, reaching over his feet
   * by its own 90px of art) and every spire stays forward of it.
   */
  const secondBushes = second.filter((stage) => shapeOf(stage) === "bloodsexp_1" && stage.scale >= 1);
  const nearBush = Math.min(...secondBushes.map(stands).map(([u]) => u));
  assert.ok(
    nearBush <= 100,
    `the second eruption's low fire reaches his feet, the way the clip's does (nearest bush at ${nearBush}px)`
  );
  /*
   * **And the wall beside him is tongues, not one mass.** This is the last thing
   * the owner saw, playing the version that closed the wedge: 「靠近角色部分现在
   * 像是一滩鲜红的血，没有区分开」 - it had been closed with a single 2.5-scale
   * bush, and a bush is a rounded dome, so it read as a pool. The clip's near
   * region is a **comb**: over #90/#93/#96/#99 its edge is 4-6 narrow flames with
   * dark ground between them, rising out of a lit base. A tongue has to be a
   * spire to do that - a spire is narrow at the top and widens downward, so the
   * tops separate while the bases run together, which is exactly the comb the
   * clip's top fifth is (21% lit) over a solid lower mass.
   *
   * So at least two of the tongues stand in the near quarter of the rank, and the
   * base they rise from is still a bush at his feet. Counting them is the pin:
   * the blob version has one tongue this near, and so does the rank that stood
   * clear of him altogether.
   */
  const nearTongues = second.filter(
    (stage) => shapeOf(stage) === "bloodsexp_2" && stands(stage)[0] <= 140 && stage.scale >= 1.3
  );
  assert.ok(
    nearTongues.length >= 2,
    `the near end of the second eruption is a comb of tongues, not one mass (${nearTongues.length} there)`
  );
  /*
   * The second wave's own bushes, told apart from the embers it dies back into
   * (`bloodsexp_1` too, but with no fill and on the gash's own line) by the one
   * thing only the slab carries.
   */
  const slab = second.filter(
    (stage) => stage.entry.includes("bloodsexp_1") && /"fill":/.test(stage.raw)
  );
  assert.ok(
    slab.length >= 4,
    `the second eruption stands in a slab, not on bare ground (${slab.length} bushes)`
  );
  /*
   * And the slab's two properties are built, not inherited, because the pack has
   * neither of them.
   *
   * `fill` closes the gaps in the flames' own furry outlines, and `base` cuts the
   * foot straight. Measured row by row against #100, ours already matched the
   * reference from 20% of its height upward and diverged *only* in the bottom
   * 15%, where the reference is 100% lit across its whole width - a curtain of
   * fire standing on a straight edge. That is a shape no rounded, furry foot in
   * this pack will ever read as, however it is scaled or arranged.
   *
   * The one line is what makes the cut land: `base` straightens each layer's own
   * bottom, so unless the layers agree on where the bottom *is*, the composite's
   * lowest row is whichever one hangs lowest and the edge comes out ragged again.
   * That was the first attempt at this, and it moved nothing.
   */
  assert.equal(
    new Set(slab.map((stage) => stage.at.split(",")[1])).size,
    1,
    "the slab stands on one line, so its foot can be cut straight"
  );
  slab.forEach((stage) => {
    assert.match(
      stage.raw,
      /"fill":\s*\d+/,
      `the slab is closed up, or its flames' own gaps show through (${stage.at})`
    );
    assert.match(
      stage.raw,
      /"base":\s*\d+/,
      `and given a straight foot to stand on (${stage.at})`
    );
  });
  const bodyLight = front.filter((stage) => /BODY_RAMP/.test(stage.raw) && stage.from >= 0.45);
  assert.ok(
    bodyLight.length >= 2,
    "and the light that fills the gaps between its strands is a layer of its own"
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
  const webStages = floorStages
    .filter((stage) => stage.first === 10 && stage.first === stage.last)
    .sort((a, b) => a.from - b.from);
  assert.ok(webStages.length >= 1, "the finished lit web is drawn at all");
  /*
   * Held from the split to the end *without a gap*. It was one stage; it is two
   * now, because the reference's web spreads as its fire dies - it is at its
   * widest on the clip's last frames, not at the lull - so the held web hands
   * over to a wider copy instead of sitting at one width and fading out. The
   * property worth pinning is the coverage, not the stage count.
   */
  for (let i = 1; i < webStages.length; i += 1) {
    assert.ok(webStages[i].from <= webStages[i - 1].until, "the held web has no gap in it");
  }
  assert.ok(
    webStages[0].from <= 0.4 && webStages[webStages.length - 1].until >= 0.99,
    "and held from the split to the end"
  );
  assert.ok(
    webStages[webStages.length - 1].scale > webStages[0].scale,
    "and spreads as the fire dies, the way the reference's does"
  );
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
   * The columns this row actually draws, and the reason it has any empty ones:
   * 怒气爆发 is staged, so the seven tenths of a second between its burst and its
   * column are columns with nothing on them. Every assertion below reads those
   * columns - "is this red", "how big is it", "is it 大蹦's art" - and a test that
   * sampled the row on a fixed loop would have been measuring the quiet stretch.
   */
  const rageFrames = Render.EFFECT.rowFrames.rageBurst;
  const drawn = [];
  for (let column = 0; column < rageFrames; column += 1) {
    if (cellAlphaBox(sheet, column, rage, cell, cell)) drawn.push(column);
  }
  assert.ok(
    drawn.length > 0 && drawn.length < rageFrames,
    `怒气爆发 draws some columns and leaves others empty (${drawn.length} of ${rageFrames})`
  );
  /*
   * The two acts, split at the **quiet stretch** rather than at the midpoint of
   * the row: the burst act does not end when it stops being drawn, it ends when
   * the crescent it collapses to has faded (cols 12-18), and a fixed halfway
   * mark would cut that crescent in half and file it under the column. The
   * biggest gap between two drawn columns *is* the quiet stretch, so it is the
   * split.
   */
  let gapAt = 0;
  for (let index = 1; index < drawn.length; index += 1) {
    if (drawn[index] - drawn[index - 1] > drawn[gapAt + 1] - drawn[gapAt]) gapAt = index - 1;
  }
  const burstCols = drawn.slice(0, gapAt + 1);
  const columnCols = drawn.slice(gapAt + 1);
  assert.ok(burstCols.length >= 5, `the burst owns its own columns (${burstCols.length})`);
  assert.ok(columnCols.length >= 4, `and the column owns later ones (${columnCols.length})`);
  assert.ok(
    columnCols[0] - burstCols[burstCols.length - 1] > 4,
    "with a quiet stretch between them, which is the move"
  );
  /*
   * The colour is part of the art, and this one is a **reversal**: slices 38/39
   * baked this row white-gold off the official BloodBlast preview. The clip the
   * owner names is red - saturated, with blue at zero - and the pack's own
   * preview is red too, so the row is the pack's plain board through BURST_RAMP
   * and reads (180,20,3) over the burst against the clip's (217,27,4). The
   * white-gold board of the very same shapes would put green near 230 and blue
   * near 200 here, so this is the assertion that catches a slide back to it.
   */
  const meanInk = (row, columns) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (const column of columns) {
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
  const burst = meanInk(rage, drawn);
  assert.ok(burst[0] > 120, `怒气爆发 is red (red ${burst[0].toFixed(0)})`);
  assert.ok(burst[1] < 60, `怒气爆发 is blood, not gold (green ${burst[1].toFixed(0)})`);
  assert.ok(burst[2] < 40, `and with no blue in it at all (blue ${burst[2].toFixed(0)})`);
  /*
   * And both acts are drawn at the sizes the training room shows. The clip's own
   * numbers, in Slayer-heights off its 220px Slayer: the burst ring is 2.17
   * across, the column 1.77 x 2.99. Everything here is the row's own ink times
   * the renderer's `size`, so a retuned window, a retuned `size` or a rescaled
   * layer all move this number - which is the point of pinning the *look* rather
   * than the plumbing.
   */
  const draw = Render.EFFECT.draw.rageBurst;
  /*
   * The box this measures is the **lit red** one, not the alpha one. The clip's
   * own numbers were read with `measure_effect.py`, whose mask is
   * `red > 90 && red > green*1.9+12 && red > blue*1.9+12` - and the alpha box
   * would count the LANCZOS fringe the bake leaves around every resized layer,
   * which is 3px a side on this row and would flatter it by 7%. Same ruler on
   * both sides, or the comparison is between two different things.
   */
  const litBox = (column) => {
    const pixels = cellPixels(rage, column);
    let x0 = cell;
    let y0 = cell;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const at = (y * cell + x) * 4;
        const red = pixels[at];
        const green = pixels[at + 1];
        const blue = pixels[at + 2];
        /*
         * alpha > 60 as well as the colour: a resized layer keeps its own RGB
         * under a nearly transparent edge, so the colour test alone reads the
         * fringe as ink. 60 is the same floor the bake treats as an edge.
         */
        if (pixels[at + 3] <= 60) continue;
        if (!(red > 90 && red > green * 1.9 + 12 && red > blue * 1.9 + 12)) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  };
  const heights = (columns) => {
    let widest = 0;
    let tallest = 0;
    for (const column of columns) {
      const box = litBox(column);
      if (!box) continue;
      widest = Math.max(widest, box.x1 - box.x0 + 1);
      tallest = Math.max(tallest, box.y1 - box.y0 + 1);
    }
    return [
      (widest * draw.size) / cell / Render.SPRITE.bodyHeight,
      (tallest * draw.size) / cell / Render.SPRITE.bodyHeight
    ];
  };
  const [ringWide, ringTall] = heights(burstCols);
  const [columnWide, columnTall] = heights(columnCols);
  assert.ok(Math.abs(ringWide - 2.17) < 0.15, `the burst ring is the clip's 2.17 Slayer-heights across (${ringWide.toFixed(2)})`);
  /*
   * And as flat as it is wide, which took a bake change rather than a number:
   * the ring is a front half and a back half whose bottoms are 38px apart, so
   * squashing each about its own bottom drew them apart and the ring came out
   * 0.97 deep against the clip's 0.85. Both halves now name one line to flatten
   * about (`"about"` in the pick, the caster's ground point), and that is what
   * this reading is the end of.
   */
  assert.ok(Math.abs(ringTall - 0.85) < 0.12, `and the clip's 0.85 deep (${ringTall.toFixed(2)})`);
  assert.ok(Math.abs(columnWide - 1.77) < 0.2, `the column is the clip's 1.77 across (${columnWide.toFixed(2)})`);
  assert.ok(Math.abs(columnTall - 2.99) < 0.2, `and the clip's 2.99 tall (${columnTall.toFixed(2)})`);
  /*
   * The ring does not go straight to a clean floor: it collapses into a thin
   * crescent that lingers in the same patch of ground (the clip's #49-#58) and
   * is gone by #60. So the burst act has to reach past the halfway mark of the
   * cast, or that crescent is not being drawn at all.
   */
  assert.ok(
    burstCols[burstCols.length - 1] / (rageFrames - 1) > 0.4,
    `the collapsed crescent lingers into the quiet half (last burst column ${burstCols[burstCols.length - 1]})`
  );
  /*
   * The rift row opens on the landing, so the frames to compare are the ones it
   * actually draws - the broken floor and the first eruption. Compared against
   * 怒气爆发's own drawn columns, since its later ones are the empty quiet.
   */
  const riftRow = Render.EFFECT.riftRows.mountainRift.back;
  const riftCell = Render.EFFECT.riftCell;
  for (let index = 0; index < 6; index += 1) {
    const column = drawn[index % drawn.length];
    const a = cellPixels(rage, column);
    const b = cellPixels(riftRow, column, riftSheet, riftCell);
    const c = cellPixels(smash, column % Render.EFFECT.rowFrames.mountainBreaker);
    assert.ok(difference(a, b) > 0.4, `column ${column}: 怒气爆发 and 大蹦 are different art`);
    assert.ok(difference(b, c) > 0.4, `column ${column}: 大蹦 is not 崩山击's smash again`);
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
  const maxHp = state.player.maxHp;
  const hpBefore = state.player.hp;
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 60, {});

  assert.ok(state.player.buffs.bloodRage > 0, "the stance goes up");
  /*
   * **The stance makes his cuts slower, not faster** (0.8, the owner's number -
   * see Core.SKILLS.frenzy.buff.attackSpeed): 22 body frames inside a 0.176s cut
   * was a flick rather than a swing. What it still buys is power.
   */
  assert.ok(Core.attackSpeedOf(state.player) < baseSpeed, "the stance slows the swing down");

  /*
   * The opening cut comes off max HP rather than being a flat number, so it
   * means the same fraction of the bar at every level. 17.5% is what the
   * reference's own HP orb reads on the frame the stance lands (adr/0017).
   */
  assert.ok(
    hpBefore - state.player.hp >= maxHp * 0.175 - 1e-9,
    "opening it costs the reference's 17.5% of the bar"
  );

  /*
   * A buffer in the DNF sense: the client's own read is "cast it again to take
   * it down", so an hour of game time must not tick it away. The HP does not
   * stop, though - the stance is paid for in blood for as long as it is up, on
   * a ten-second clock (docs/adr/0020: the owner read our old per-second
   * trickle as far too fast, and the move's own numbers charge every ten
   * seconds).
   */
  const hpAfterCast = state.player.hp;
  Core.runFrames(state, 540, {});
  assert.equal(state.player.buffs.bloodRage, Infinity, "the stance has no timer");
  assert.equal(state.player.hp, hpAfterCast, "and it is not due for ten seconds");
  Core.runFrames(state, 120, {});
  assert.ok(
    state.player.hp < hpAfterCast,
    "and it keeps charging him for as long as it is up"
  );
  assert.ok(Core.attackSpeedOf(state.player) < baseSpeed, "it is still up a minute later");

  /* Cooldowns run fast while it is up ... */
  state.player.skillCooldowns.upSlash = 4;
  Core.runFrames(state, 60, {});
  const ragingCooldown = state.player.skillCooldowns.upSlash;

  /* ... and the second cast is the cancel: instant, and free of MP. */
  state.player.mp = state.player.maxMp;
  state.player.skillCooldowns.frenzy = 0;
  Core.step(state, { skills: { frenzy: true } });
  /*
   * Dropping it is free but it is not instant: the same cast plays and the
   * stance comes down where the arrow lands, so the way out looks like the way
   * in (docs/adr/0017).
   */
  Core.runFrames(state, 10, {});
  assert.equal(state.player.buffs.bloodRage, 0, "casting it again takes it down");
  assert.equal(state.player.mp, state.player.maxMp, "and dropping it costs no MP");
  assert.equal(Core.attackSpeedOf(state.player), baseSpeed, "the attack speed goes with it");

  /*
   * The drain goes with it too, which is the whole point of being able to drop
   * it. Read from where it actually came down, not from the press: the stance is
   * still up for the ten frames the cast takes to land, and it charges for them.
   */
  const hpWhenDown = state.player.hp;
  Core.runFrames(state, 120, {});
  assert.equal(state.player.hp, hpWhenDown, "the drain stops the moment it is down");

  state.player.skillCooldowns.upSlash = 4;
  Core.runFrames(state, 60, {});
  assert.ok(
    state.player.skillCooldowns.upSlash > ragingCooldown,
    "cooldowns run at the normal rate once the stance is down"
  );
});

test("血之狂暴's release is two beats: the burst, then the blood gathering", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;

  Core.step(state, { skills: { frenzy: true } });
  /* Past the stance landing (0.10s in) but not yet at the second beat's delay. */
  Core.runFrames(state, 10, {});
  assert.ok(state.player.buffs.bloodRage > 0, "precondition: the stance is up");

  /*
   * The second beat is queued when the stance lands and plays on afterwards, on
   * its own clock. Its delay is set against the *body*: it lands where the cast's
   * clip has the arm out and the hand open, which is where the reference puts the
   * blood (docs/adr/0017).
   */
  const queued = state.effects.filter((e) => e.kind === "rageGather");
  assert.equal(queued.length, 1, "the burst queues exactly one gathering");
  const gather = Core.SKILLS.frenzy.buff.gather;
  assert.equal(queued[0].delay, gather.delay, "and it waits the reference's beat");
  assert.equal(queued[0].maxLife, gather.delay + gather.life, "then runs for its own life");

  /* Half a second after the press it has not started: the burst is still all. */
  const started = queued[0].maxLife - queued[0].life;
  assert.ok(
    started < queued[0].delay,
    `nothing to draw yet (${started.toFixed(2)}s of a ${gather.delay}s wait)`
  );

  /* And it outlives the cast, which is the whole point of it being separate. */
  Core.runFrames(state, Math.round((gather.delay + gather.life + 0.4) * Core.FPS), {});
  assert.equal(state.player.skillTimer, 0, "the cast is long over");
  assert.equal(
    state.effects.filter((e) => e.kind === "rageGather").length,
    0,
    "and the gathering has finished and cleaned itself up"
  );
});

test("血之狂暴 is paid for in blood, and the price can kill him", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;

  const maxHp = state.player.maxHp;
  const hpBefore = state.player.hp;
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 30, {});
  assert.ok(state.player.buffs.bloodRage > 0, "precondition: the stance is up");
  assert.equal(
    Math.round(hpBefore - state.player.hp),
    Math.round(maxHp * 0.175),
    "opening it costs the reference's 17.5% of the bar"
  );

  /*
   * **No floor under it.** This is the one place in the game where the Slayer
   * can spend his own last point of HP, and the owner's call is that it has to
   * be able to take him out: a cost you cannot die of is a fee, not a cost, and
   * then nobody ever has to decide whether to keep the stance up (adr/0017).
   * It is also why the drain is charged in `spendPlayerHp` and not
   * `damagePlayer` - no i-frames, no knockback, no 硬直, and `damageTaken` stays
   * a count of what the monsters did.
   */
  /*
   * And the bill itself: 1% of max HP a tick, one tick every ten seconds. This
   * is the number the owner reset (docs/adr/0020) - it used to be 1 HP every
   * half second, which at 120 max HP is three times the rate the move's own
   * numbers charge for.
   */
  const billBefore = state.player.hp;
  Core.runFrames(state, 660, {});
  assert.equal(
    Math.round(billBefore - state.player.hp),
    Math.round(maxHp * 0.01),
    "the bill is 1% of the bar every ten seconds"
  );
  Core.runFrames(state, 600, {});
  assert.equal(
    Math.round(billBefore - state.player.hp),
    Math.round(maxHp * 0.02),
    "and it comes round again ten seconds later"
  );

  const takenBefore = state.stats.damageTaken;
  state.player.hp = 1;
  Core.runFrames(state, 660, {});
  assert.equal(state.player.hp, 0, "the bill takes his last point and then some");
  assert.ok(state.player.dead, "and it kills him");
  assert.ok(state.defeat, "the run is over");
  assert.equal(state.stats.damageTaken, takenBefore, "but the monsters get no credit for it");
});

test("精英 与 Boss 的 回避, and 血之狂暴's 命中 closes it", () => {
  const state = lastRoomState();
  state.player.level = 5;
  const boss = Core.createEnemy(state, "boss", state.player.x + 60);
  boss.hp = 100000;
  boss.maxHp = 100000;
  boss.speed = 0;
  state.enemies = [boss];
  assert.ok(boss.evasion > 0, "a boss can slide out from under a hit");

  /* Grunts cannot: clearing a room is exactly as it was before this slice. */
  assert.equal(
    Core.createEnemy(state, "grunt", state.player.x - 60).evasion,
    0,
    "a grunt has no evasion at all"
  );

  let missed = 0;
  for (let hit = 0; hit < 200; hit += 1) {
    if (Core.damageEnemy(state, boss, 1, 0, state.player.x) === 0) missed += 1;
  }
  assert.ok(missed > 0, `without the stance some cuts slide off (${missed} of 200)`);
  const missText = state.effects.filter((e) => e.miss && e.text === "MISS");
  assert.equal(missText.length, missed, "and every one of them says MISS where it happened");

  /* With the stance up, none of them do. */
  state.player.buffs.bloodRage = Infinity;
  state.player.stanceDrainTimer = 999;
  let stillMissed = 0;
  for (let hit = 0; hit < 200; hit += 1) {
    if (Core.damageEnemy(state, boss, 1, 0, state.player.x) === 0) stillMissed += 1;
  }
  assert.equal(stillMissed, 0, "with the stance up, nothing slides off him");
});

test("硬直 is his own recovery, the stance halves it, and it is not 霸体", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.hp = state.player.maxHp;

  /* The control: the same hit with the stance down. */
  state.player.buffs.bloodRage = 0;
  state.player.invuln = 0;
  Core.damagePlayer(state, 1, state.player.x + 40);
  const plainRecovery = state.player.hurtTimer;
  assert.equal(plainRecovery, Core.PLAYER.hurtStun, "a hit stuns him for the base time");

  /* The same hit with it up. */
  state.player.hp = state.player.maxHp;
  state.player.invuln = 0;
  state.player.hurtTimer = 0;
  state.player.buffs.bloodRage = Infinity;
  state.player.stanceDrainTimer = 999;
  Core.damagePlayer(state, 1, state.player.x + 40);
  assert.equal(state.player.maxHp - state.player.hp, 1, "he takes every point of the damage");
  assert.equal(state.player.hurtTimer, plainRecovery * 0.5, "but his feet come back in half the time");
});

test("血之狂暴's attack power reaches every skill, not only the three the wiki names", () => {
  const state = lastRoomState();
  state.player.level = 5;
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 40);
  enemy.speed = 0;
  state.enemies = [enemy];

  const land = () => {
    state.player.mp = state.player.maxMp;
    state.player.skillCooldowns.upSlash = 0;
    enemy.hp = 100000;
    const before = enemy.hp;
    Core.step(state, { skills: { upSlash: true } });
    /* 命中停顿会推后这一招的收势：等它真的收完，再量伤害。 */
    let cast = 0;
    while (state.player.skillTimer > 0 && cast < 120) {
      Core.runFrames(state, 1, {});
      cast += 1;
    }
    return before - enemy.hp;
  };

  const plain = land();
  state.player.buffs.bloodRage = Infinity;
  state.player.stanceDrainTimer = 999;
  const raging = land();
  assert.ok(plain > 0, "precondition: the move lands");
  /*
   * 上挑 is not one of the three the wiki's old text names, and it is lifted all
   * the same: since 2019 the live skill lifts every 转职后 skill, and the owner
   * took that version (adr/0017).
   */
  assert.equal(raging, Math.round(plain * Core.SKILLS.frenzy.buff.attackPower), "lifted by the stance's own multiplier");
});

/*
 * 暴走 is **not** 血之狂暴 - they are two skills with two reference clips, and
 * the repo used to conflate them (see CONTEXT.md and docs/adr/0016). The three
 * things that separate them are all here: 暴走 has a real duration rather than
 * being a stance, it puts its own buff up rather than the stance's, and it
 * announces itself with a short-lived icon instead of a badge that stays.
 */
test("暴走 is a timed buff with its own icon, not the stance", () => {
  const state = lastRoomState();
  state.enemies = [];
  state.player.mp = state.player.maxMp;

  const baseSpeed = Core.attackSpeedOf(state.player);
  Core.step(state, { skills: { berserk: true } });
  /* The buff lands on the cast's own active window, a few frames in. */
  Core.runFrames(state, 10, {});
  assert.ok(state.player.buffIconTimer > 0, "the icon lights on the press");

  /* The icon is its own, much shorter clock: 1.5s against the buff's 8. */
  Core.runFrames(state, 100, {});
  assert.equal(state.player.buffIconTimer, 0, "the icon is gone after a beat and a half");
  assert.ok(state.player.buffs.berserk > 0, "while the buff is still running");
  assert.ok(Core.attackSpeedOf(state.player) > baseSpeed, "the buff buys attack speed");
  assert.ok(!(state.player.buffs.bloodRage > 0), "and it does not put the stance up");

  /* Unlike a stance it runs out on its own - that is the whole difference. */
  Core.runFrames(state, 8 * 60, {});
  assert.equal(state.player.buffs.berserk, 0, "eight seconds later it is off");
  assert.equal(Core.attackSpeedOf(state.player), baseSpeed, "and the attack speed goes with it");
});

test("暴走 moves him faster and hits harder while it is up", () => {
  const state = lastRoomState();

  /* Controls first: the same walk and the same cut, with the buff never cast. */
  Core.runFrames(state, 2, { right: true });
  const plainVx = Math.abs(state.player.vx);
  assert.ok(plainVx > 0, "he walks without the buff");

  const enemy = Core.createEnemy(state, "brute", state.player.x + 40);
  enemy.hp = 5000;
  enemy.maxHp = 5000;
  enemy.speed = 0;
  state.enemies = [enemy];
  Core.step(state, { skills: { upSlash: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.upSlash.duration * Core.FPS) + 4, {});
  const plainDamage = 5000 - enemy.hp;
  assert.ok(plainDamage > 0, "the up-slash lands without the buff");

  /* Now with 暴走 up. The cast itself roots him, so it has to run out first. */
  state.enemies = [];
  state.player.mp = state.player.maxMp;
  state.player.skillCooldowns.berserk = 0;
  state.player.skillCooldowns.upSlash = 0;
  Core.step(state, { skills: { berserk: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.berserk.duration * Core.FPS) + 4, {});

  Core.runFrames(state, 2, { right: true });
  assert.ok(
    Math.abs(state.player.vx) > plainVx * 1.15,
    `暴走 must move him faster (${plainVx} -> ${Math.abs(state.player.vx)})`
  );

  const enemy2 = Core.createEnemy(state, "brute", state.player.x + 40);
  enemy2.hp = 5000;
  enemy2.maxHp = 5000;
  enemy2.speed = 0;
  state.enemies = [enemy2];
  Core.step(state, { skills: { upSlash: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.upSlash.duration * Core.FPS) + 4, {});
  const berserkDamage = 5000 - enemy2.hp;
  assert.ok(
    berserkDamage > plainDamage,
    `暴走 must hit harder (${plainDamage} -> ${berserkDamage})`
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
  /* Park the stance's own HP drip so this test measures the orb and nothing else. */
  state.player.stanceDrainTimer = 999;
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

  /*
   * **The crossing is timed, not paced** (docs/adr/0020). The reference spends
   * 0.45s flying the orb from the monster to him - #834 has the ball on the
   * monster, #846 has it going off on his chest - and that is what makes it
   * read as flying at all. At the fixed 620 px/s this used to run at, a
   * monster standing next to him got the blood back in 0.08s and the whole
   * thing was a blink. So: the same seconds at any range, and 0.45 of them.
   */
  const crossing = (gap) => {
    state.player.onGround = true;
    state.player.vy = 0;
    state.player.y = Core.ARENA.groundY;
    state.player.hp = state.player.maxHp;
    state.player.buffs.bloodRage = Infinity;
    state.player.stanceDrainTimer = 999;
    state.pickups.length = 0;
    target.x = state.player.x + gap;
    for (let hit = 0; hit < 40 && !state.pickups.length; hit += 1) {
      Core.damageEnemy(state, target, 1, 0, state.player.x);
    }
    assert.equal(state.pickups.length, 1, `precondition: an orb from ${gap}px away`);
    const chest = () => state.player.y - state.player.height * 0.75;
    const away = () => {
      const orb = state.pickups[0];
      return Math.hypot(state.player.x - orb.x, chest() - orb.y);
    };
    const distance = away();
    const half = Math.round((Core.BLOOD_ORB.flightSeconds * Core.FPS) / 2);
    let frames = 0;
    let leftAtHalf = null;
    while (state.pickups.length && frames < 240) {
      Core.runFrames(state, 1, {});
      frames += 1;
      if (frames === half && state.pickups.length) leftAtHalf = away();
    }
    return { distance, frames, leftAtHalf };
  };
  const near = crossing(140);
  const far = crossing(420);
  const flight = Core.BLOOD_ORB.flightSeconds;
  const expected = Math.round(flight * Core.FPS);
  /*
   * **The trip is the clock, not the distance** (docs/adr/0020): 0.55s whether
   * it was drawn four Slayer-widths away or twelve.
   */
  assert.ok(
    Math.abs(near.frames - expected) <= 1 && Math.abs(far.frames - expected) <= 1,
    `the crossing is ${flight}s at any range (${near.frames} and ${far.frames} frames, want ${expected})`
  );
  /*
   * **And it eases in.** Halfway through the clock the ball is still more than
   * half the way out - the reference drifts out of the body and then comes, so
   * the last third of the time covers most of the ground. A constant speed
   * would leave exactly half of it at the half-way mark.
   */
  assert.ok(
    near.leftAtHalf > near.distance * 0.6 && far.leftAtHalf > far.distance * 0.6,
    `the ball is still far out at half time (${near.leftAtHalf.toFixed(0)}/${near.distance.toFixed(0)}, ` +
      `${far.leftAtHalf.toFixed(0)}/${far.distance.toFixed(0)}), so it is pulled rather than thrown`
  );
});
test("the stance paints him red, carries a second blade and draws nothing else", () => {
  const state = Core.createState({ seed: 9 });
  const sprites = {
    slayer: { width: 8736, height: 1232 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: { width: 5760, height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount) }
  };
  const rowOf = (calls, image, row) =>
    calls.filter(
      (call) => call[0] === "drawImage" && call[1] === image && call[3] === row * Render.EFFECT.cell
    );
  /*
   * The shared context double stubs the gradient factories out, so this test
   * counts them itself: an aura round the Slayer would be a radial gradient
   * behind him, and the reference has none (docs/adr/0017).
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
  assert.equal(rowOf(calm, sprites.effects, Render.EFFECT.orbRow).length, 0, "no stance, no blood orbs");

  /* Mid-swing with the stance up: the whole look is on screen at once. */
  state.player.buffs.bloodRage = Infinity;
  state.player.attackTimer = state.player.attackDuration * 0.5;
  const raging = [];
  const ragingGradients = renderWith(raging);

  /*
   * **The second blade.** 血之狂暴's dual-wield is a layer over the equipped
   * sword, not a second weapon in the body art - the client ships no such
   * animation - and the pack draws it twice so his own body can pass between
   * the halves. Both have to be on screen: a swing that only drew the front
   * copy would look like the blade snapped wherever he covers it.
   */
  assert.ok(
    rowOf(raging, sprites.effects, Render.EFFECT.rageBladeUnderRow).length >= 1,
    "the half of the blade behind him"
  );
  assert.ok(
    rowOf(raging, sprites.effects, Render.EFFECT.rageBladeUpperRow).length >= 1,
    "and the half in front of him"
  );

  /* The red brush fan rides the same swing, off its own row now that the skill
     row is the cast's burst. */
  assert.ok(
    rowOf(raging, sprites.effects, Render.EFFECT.rageSlashRow).length >= 1,
    "the swing carries the stance's own red fan"
  );
  /*
   * **The cream trail is the *second* sword's** (the owner read the reference
   * apart frame by frame: 「奶油颜色的应该是第二把剑的剑影」), laid on that blade's
   * own per-frame positions. The *first* sword's pale arc is the client's own,
   * in the body cells, and is left alone (docs/adr/0019).
   */
  assert.equal(Render.EFFECT.rageSwipeRows, undefined, "no separate crescent rows out here");
  assert.equal(
    Render.EFFECT.extraRowCount,
    16,
    "the extra rows are the orb, the dive arc, the red fan, the two blades, the gathering, " +
      "嗜魂封魔斩's vortex, the fog at his hand, 魔狱血刹's sword, its white warning, its 血丝, " +
      "its 成形, the ring that 成形 opens with, the star it opens into, and 大蹦's fire"
  );
  state.player.comboIndex = 0;
  state.player.attackTimer = state.player.attackDuration * 0.5;
  assert.equal(
    rowOf(raging, sprites.effects, Core.SKILL_ORDER.indexOf("frenzy")).length,
    0,
    "and the cast's burst never draws on a swing"
  );

  /* Non-vacuous: the same mid-swing frame with the stance down draws none of it. */
  state.player.buffs.bloodRage = 0;
  const swing = [];
  Render.render(recordingContext(swing), state, { sprites });
  state.player.buffs.bloodRage = Infinity;
  assert.equal(
    rowOf(swing, sprites.effects, Render.EFFECT.rageSlashRow).length,
    0,
    "no stance, no red fan"
  );
  assert.equal(
    rowOf(swing, sprites.effects, Render.EFFECT.rageSlashRow).length,
    0,
    "no stance, no red fan either"
  );
  assert.equal(
    rowOf(swing, sprites.effects, Render.EFFECT.rageBladeUpperRow).length,
    0,
    "no stance, no second blade"
  );

  /*
   * **And nothing else.** The reference draws no aura round him and no icon over
   * his head for as long as the stance is up - measured over its steady stretch,
   * the bands either side of him hold zero non-black pixels. Both of those used
   * to be invented here. The read is the red body and the lit hotbar slot, and
   * that is all (docs/adr/0017).
   */
  const badge = raging.filter(
    (call) => call[0] === "drawImage" && call[1] === sprites.skills && call[3] === 32
  );
  assert.equal(badge.length, 0, "no badge over his head");
  assert.equal(ragingGradients.length, calmGradients.length, "and no glow round him");

  /* And the blood drawn out of a monster is drawn from its own row. */
  state.pickups.push({
    kind: "blood_orb",
    x: state.player.x + 60,
    y: state.player.y - 40,
    radius: Core.BLOOD_ORB.radius,
    value: Core.BLOOD_ORB.heal,
    life: 1.2,
    fromX: state.player.x + 60,
    fromY: state.player.y - 40,
    progress: 0.5,
    /* The ball's own path: the renderer draws these behind it as the tail. */
    trail: [
      { x: state.player.x + 60, y: state.player.y - 40 },
      { x: state.player.x + 85, y: state.player.y - 40 }
    ]
  });
  const orbPass = [];
  Render.render(recordingContext(orbPass), state, { sprites });
  assert.ok(
    rowOf(orbPass, sprites.effects, Render.EFFECT.orbRow).length >= 1,
    "the orb art comes off the orb row"
  );
});

test("嗜魂封魔斩 is a channel: the key being down is its length", () => {
  /*
   * The move is the game's only cast whose length is the player's (docs/adr/0023).
   * The two properties that make it one are both here: **the entrance cannot be
   * skipped** however fast the key comes up, and **letting go is what ends it** -
   * a hold of one length and a hold of another give two different casts out of
   * the same press.
   */
  const run = (heldFrames) => {
    const state = lastRoomState();
    state.player.mp = state.player.maxMp;
    state.enemies = [];
    const hold = { skills: { bloodyRave: true } };
    Core.step(state, hold);
    let frames = 0;
    while (state.player.skillId === "bloodyRave" && frames < 600) {
      Core.step(state, frames < heldFrames ? hold : {});
      frames += 1;
    }
    return frames;
  };
  const channel = Core.SKILLS.bloodyRave.channel;
  const shortest = run(1);
  const long = run(600);
  /*
   * A tap still pays the whole entrance and the whole tail - the reference has no
   * vortex at all before 0.867s and the finisher is what the move is for.
   */
  const floor = (channel.entrance + channel.tail) * Core.FPS;
  assert.ok(
    shortest >= floor - 2,
    `a one-frame tap still runs the entrance and the tail (${shortest} frames, floor ${Math.round(floor)})`
  );
  assert.ok(
    long >= shortest + channel.hold * Core.FPS - 6,
    `holding adds the vortex's own seconds on top (${long} vs ${shortest})`
  );
  /* And the cap is the reference's steady stretch, not unbounded. */
  assert.ok(
    long <= (channel.entrance + channel.hold + channel.tail) * Core.FPS + 2,
    `the hold is capped at the reference's own 3.133s (${long} frames)`
  );
  /*
   * **The cap ends the cast by itself** (docs/adr/0023: 「不松手到 3.133s 自动收」),
   * which is also the one case the reference clip shows - its cast holds the whole
   * steady stretch and cuts at 4.300s. Waiting on `input.skills` alone meant a
   * player who never let go got no ending: no finisher art (the effect kept
   * drawing the entrance's column) and no cut (`hitTime` stays Infinity until
   * there is a release).
   */
  const capped = lastRoomState();
  const caught = Core.createEnemy(capped, "grunt", capped.player.x + 70);
  caught.hp = 900;
  caught.maxHp = 900;
  caught.speed = 0;
  capped.enemies = [caught];
  capped.player.mp = capped.player.maxMp;
  const never = { skills: { bloodyRave: true } };
  Core.step(capped, never);
  Core.runFrames(capped, Math.ceil((channel.entrance + channel.hold) * Core.FPS) + 2, never);
  assert.notEqual(capped.player.channelReleasedAt, null, "holding to the cap lets go for him");
  assert.ok(
    Math.abs(capped.player.channelReleasedAt - (channel.entrance + channel.hold)) < 0.05,
    `and it lets go at the reference's own 3.133s (${capped.player.channelReleasedAt.toFixed(3)})`
  );
  const beforeCut = caught.hp;
  Core.runFrames(capped, Math.ceil(channel.tail * Core.FPS) + 2, never);
  assert.ok(
    beforeCut - caught.hp >= Core.SKILLS.bloodyRave.damage,
    "and the finisher's cut lands on a hold that was never let go of"
  );
});

test("嗜魂封魔斩's vortex is rooted on his feet, whatever depth he casts from", () => {
  /*
   * **The bug the owner found by playing, after four rounds of 对照图 could not.**
   * `drawBloodVortex` translated to `feetY(player) - depthLift(player.z)`, and
   * `feetY()` already takes the depth lift out - so the whole vortex rode a
   * *second* lift up the screen: 0.4 Slayer-heights at the depth he was standing
   * in the screenshot he sent, 1.05 at the back of the band. Every
   * capture-effect run defaults to `DEPTH=0`, where the two lifts cancel and the
   * art really is on his hand - which is why the numbers kept saying 「挨着了」
   * while the screen said 「高于手」.
   *
   * This pins the two origins together: whatever depth he casts from, the
   * vortex's own translate has to be the point the body is drawn on (`feetY`,
   * which is also what the baked rows anchor to: caster.y - depthLift).
   */
  const state = Core.createState({ seed: 11 });
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: { width: 5760, height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount) }
  };
  const spec = Core.SKILLS.bloodyRave;
  const vortexOrigin = (z) => {
    state.player.skillId = "bloodyRave";
    state.player.skillTimer = spec.duration * 0.5;
    state.player.channelReleasedAt = null;
    state.player.z = z;
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    const first = calls.findIndex(
      (call) => call[0] === "drawImage" && call[3] === Render.EFFECT.vortexRow * Render.EFFECT.cell
    );
    assert.ok(first > 0, `the vortex is drawn at z=${z}`);
    for (let index = first; index >= 0; index -= 1) {
      if (calls[index][0] === "translate") return calls[index];
    }
    throw new Error("the vortex draws with no translate of its own");
  };
  for (const z of [0, 220, 400]) {
    const origin = vortexOrigin(z);
    assert.equal(origin[1], state.player.x, `the vortex is on his column at z=${z}`);
    assert.equal(
      origin[2],
      state.player.y - Core.depthLift(z),
      `and on his feet at z=${z}, lifted once rather than twice`
    );
  }
});

test("嗜魂封魔斩's hold stays in the casting pose", () => {
  /*
   * The clip's own frame list carried client frame 176 twice - once as the pose
   * the move is entered from, once second-to-last, which put it inside the 站桩
   * beat. A beat's frames cycle, so a third of a three-second hold was spent in
   * the *standing* cell (arm down, sword planted, byte-identical to the column
   * the cast opens on) instead of the pose the reference holds through its whole
   * steady stretch (#059-#152 is a still body).
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  const clip = Render.SPRITE.skillClips.bloodyRave;
  const at = (col, x, y) =>
    sheet.pixels.subarray(
      ((clip.row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4,
      ((clip.row * Render.SPRITE.frameH + y) * sheet.width + col * Render.SPRITE.frameW + x) * 4 + 4
    );
  const differing = (a, b) => {
    let count = 0;
    for (let y = 0; y < Render.SPRITE.frameH; y += 1) {
      for (let x = 0; x < Render.SPRITE.frameW; x += 1) {
        const one = at(a, x, y);
        const two = at(b, x, y);
        if (Math.abs(one[0] - two[0]) + Math.abs(one[1] - two[1]) + Math.abs(one[2] - two[2]) +
            Math.abs(one[3] - two[3]) > 32) {
          count += 1;
        }
      }
    }
    return count;
  };
  const entry = clip.first;
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  player.skillId = "bloodyRave";
  const spec = Core.SKILLS.bloodyRave;
  let holdFrames = 0;
  for (let progress = 0.2; progress < 0.84; progress += 0.02) {
    player.skillTimer = spec.duration * (1 - progress);
    const frame = Render.playerFrame(state, player);
    holdFrames += 1;
    assert.ok(
      differing(entry, frame.col) > 400,
      `progress ${progress.toFixed(2)} draws column ${frame.col}, which is the standing cell`
    );
  }
  assert.ok(holdFrames >= 30, `the steady stretch was sampled (${holdFrames} frames)`);
});

test("魔狱血刹: the first press leaves a sword on his back and a clock running", () => {
  /*
   * The shape docs/adr/0025 decided, and the thing that makes this skill unlike
   * every other one in the kit: the press is a **state**, not a move. It plays
   * its own second, hands him back to the room, and leaves `buffs.hellbenter`
   * counting down - which is what makes everything he does for the next fifty
   * seconds happen with the sword on his back.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  assert.equal(player.hellbenterTier, 0, "he starts with nothing on his back");
  Core.step(state, { skills: { hellbenter: true } });
  assert.equal(player.skillId, "hellbenter", "the press raises the sword");
  assert.ok(!player.buffs.hellbenter, "and nothing lands on the press itself");
  /* The buff opens inside the cast (`activeFrom`), the way 血之狂暴's does. */
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenter.activeFrom * Core.FPS) + 2, {});
  assert.equal(player.hellbenterTier, 1, "the sword is on him by the middle of the cast");
  assert.ok(
    player.buffs.hellbenter > Core.SKILLS.hellbenter.buff.duration - 1,
    `with the reference's own fifty seconds on it (${player.buffs.hellbenter.toFixed(2)})`
  );
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenter.duration * Core.FPS) + 2, {});
  assert.equal(player.skillId, null, "and the cast lets go");
  assert.ok(player.buffs.hellbenter > 0, "leaving the sword exactly where it is");
  assert.equal(player.hellbenterTier, 1, "and the move is playable again - he is not rooted");
  assert.equal(Core.SKILLS.hellbenter.buff.duration, 50, "the clock is the reference's own");
});

test("魔狱血刹's sword outlives the room it was raised in", () => {
  /*
   * **The decision that made the clock a buff rather than a `skillTimer`.**
   * `startRoom` clears every skill field on the player - `skillId`, `skillTimer`,
   * the hit counters - and a sword kept in any of those would be dropped at the
   * door, which is the opposite of the move: he is supposed to walk into the
   * next room carrying it (docs/adr/0025). If someone tidies the exemption away,
   * this is the test that says so.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  Core.step(state, { skills: { hellbenter: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenter.duration * Core.FPS) + 2, {});
  const before = player.buffs.hellbenter;
  assert.ok(player.hellbenterTier > 0 && before > 40, "he is carrying it");
  /* 换一格：剑要跟着人过门槛（`docs/adr/0030` 把"房间"换成了"格子"）。 */
  Core.goToCell(state, Core.doorNeighbour(state.dungeon, Core.currentCell(state), "N") >= 0
    ? Core.doorNeighbour(state.dungeon, Core.currentCell(state), "N")
    : state.dungeon.boss);
  assert.ok(player.buffs.hellbenter > 0, "the next room finds the sword still on him");
  assert.ok(player.hellbenterTier > 0, "the tier rides with it");
  Core.runFrames(state, 30, {});
  assert.ok(
    player.buffs.hellbenter < before - 0.4,
    `and its clock kept running in the new room (${before} -> ${player.buffs.hellbenter})`
  );
});

test("魔狱血刹: the second press brings the sword down, it does not raise another", () => {
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  Core.step(state, { skills: { hellbenter: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenter.duration * Core.FPS) + 2, {});
  assert.ok(player.buffs.hellbenter > 0, "the sword is up");
  Core.step(state, { skills: { hellbenter: true } });
  /*
   * **Two moves on one key, decided by the state, not by the key.** Both halves
   * are separate `SKILLS` entries so the art, the hit beats and the end-of-cast
   * bookkeeping cannot drift apart between the two ways in.
   */
  assert.equal(player.skillId, "hellbenterSlam", "the same key casts the other half");
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenterSlam.duration * Core.FPS) + 2, {});
  assert.equal(player.hellbenterTier, 0, "and the sword is gone once it lands");
  assert.equal(player.buffs.hellbenter, 0, "with its clock stopped");
});

test("魔狱血刹: the clock running out brings it down by itself", () => {
  /*
   * The owner's call in the grill: the sword never simply vanishes. Fifty
   * seconds running out is the *same* ending as the second press - one move,
   * `hellbenterSlam` - so the two cannot drift apart, and a player who never
   * presses again still gets the payoff.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  Core.step(state, { skills: { hellbenter: true } });
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenter.duration * Core.FPS) + 2, {});
  player.buffs.hellbenter = 2 * Core.DT;
  Core.runFrames(state, 4, {});
  assert.equal(player.skillId, "hellbenterSlam", "the clock ends the state with no key pressed");
  Core.runFrames(state, Math.ceil(Core.SKILLS.hellbenterSlam.duration * Core.FPS) + 2, {});
  assert.equal(player.hellbenterTier, 0, "and the state is over");
});

test("魔狱血刹's sword hangs behind him, tip down, and grows from the neck", () => {
  /*
   * Two measured facts about the reference, pinned together here: the sword
   * hangs **behind him** (the client's own frame carries the blade 0.5 of a
   * Slayer-height back, and the training room agrees), and it grows **downward**
   * - the pommel stays at 1.27 heights off the floor while the blade gets longer,
   * so a full sword puts its tip on the ground (11_魔狱血刹 2:37).
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  /*
   * The sword's own draw, and the transform it was drawn under. `drawImage` is
   * called in the nine-argument form, so `[6]`/`[7]` are where the cell lands
   * and `[8]` is its size - and the cell lands inside a translate that is the
   * sword's own column and line.
   */
  const swordDraw = (tier) => {
    player.facing = 1;
    player.buffs.hellbenter = 30;
    player.hellbenterTier = tier;
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    /*
     * **A full sword is the gold one** (the owner: 「血气汲取满了，剑应该变成…」),
     * so the row to look for is the gold one at the top tier and the red one
     * below it.
     */
    const wanted = tier >= Render.BLOOD_SWORD.tiers
      ? Render.EFFECT.goldSwordRow
      : Render.EFFECT.bloodSwordRow;
    const index = calls.findIndex(
      (call) => call[0] === "drawImage" && call[3] === wanted * Render.EFFECT.cell
    );
    assert.ok(index > 0, `the sword is drawn at tier ${tier}`);
    let origin = null;
    for (let back = index; back >= 0; back -= 1) {
      if (calls[back][0] === "translate") {
        origin = calls[back];
        break; /* the sword's own, which is the nearest one before the draw */
      }
    }
    return { draw: calls[index], origin };
  };
  const body = Render.SPRITE.bodyHeight;
  const small = swordDraw(1);
  const full = swordDraw(Render.BLOOD_SWORD.tiers);
  const sizeOf = (entry) => entry.draw[8];
  /*
   * **The growth is a cell per tier, not a zoom.** The row carries the client's
   * own sword cut to eight lengths and `SWORD.cellFor` says which one a tier
   * draws; the blade comes out one step per hit that forged it (the owner:
   * 「血剑没成型前跟参考不一样」). The first cut scaled the long frame instead,
   * which drew a miniature *complete* sword at the cast; the owner sent that
   * back (「断剑好像不对」).
   */
  assert.equal(small.draw[2], 0, "the cast draws the shortest cell");
  /*
   * Eight tiers walk up four cells and hold the last: the row is the client's
   * own sword at four lengths, and the mapping between them is `tierCell`.
   */
  let previousSize = 0;
  for (let tier = 1; tier <= Render.BLOOD_SWORD.tiers; tier += 1) {
    const entry = swordDraw(tier);
    const drawn = entry.draw[8];
    assert.ok(drawn >= previousSize, `tier ${tier} never shrinks (${previousSize} -> ${drawn})`);
    previousSize = drawn;
  }
  assert.equal(Render.EFFECT.bloodSwordFrames, 8, "the row carries one drawing per tier");
  /*
   * **Every tier is drawn at the same `size` and the *cell* is what changes.** A
   * zoom would carry the hilt along with the blade, and the client's own frames
   * are the same picture cut short (f1's 73 rows agree with f2's pixel for
   * pixel), so the cut is the operation the pack itself uses. 补记十 swapped this
   * for a single cell drawn at eight sizes and lost the black crossguard and the
   * gold eye with it - they only exist in the *coloured* frames.
   */
  assert.equal(sizeOf(small), Render.BLOOD_SWORD.size, "the cast draws at the one size");
  assert.equal(sizeOf(full), Render.BLOOD_SWORD.size, "and so does a full sword");
  assert.equal(
    Render.BLOOD_SWORD.cellFor(1),
    0,
    "the cast reads the client's shortest cut"
  );
  assert.equal(
    Render.BLOOD_SWORD.cellFor(Render.BLOOD_SWORD.tiers),
    Render.EFFECT.bloodSwordFrames - 1,
    "and the last tier the longest"
  );
  assert.ok(
    Render.BLOOD_SWORD.cellFor(Render.BLOOD_SWORD.tiers) > Render.BLOOD_SWORD.cellFor(1),
    "so the blade is what grows"
  );
  /*
   * **The pommel is what stays.** The ink's top edge, measured from the feet,
   * has to be the same number at both tiers - a sword that grew about its middle
   * would lift as it grew, and the reference's tip falls to the floor instead.
   */
  const neckOf = (entry) =>
    entry.origin[2] + entry.draw[7] + Render.BLOOD_SWORD.inkTop * sizeOf(entry);
  assert.ok(
    Math.abs(neckOf(small) - neckOf(full)) < 0.5,
    `the pommel is pinned while the blade grows (${neckOf(small)} vs ${neckOf(full)})`
  );
  assert.ok(
    Math.abs(neckOf(full) - player.y + Render.BLOOD_SWORD.top * body) < 0.5,
    `and it sits where the reference has it (${player.y - neckOf(full)} off the floor)`
  );
  /* Behind him: he faces +x, so the sword's column is *behind* his own. */
  assert.ok(
    Math.abs(small.origin[1] - (player.x - Render.BLOOD_SWORD.behind * body)) < 0.5,
    `the sword hangs behind him (${small.origin[1]} vs his ${player.x})`
  );
  assert.equal(small.origin[2], player.y, "and its line is his own ground line");
  /* And nothing is drawn once the state is down. */
  player.buffs.hellbenter = 0;
  player.hellbenterTier = 0;
  const quiet = [];
  Render.render(recordingContext(quiet), state, { sprites });
  assert.equal(
    quiet.filter(
      (call) =>
        call[0] === "drawImage" && call[3] === Render.EFFECT.bloodSwordRow * Render.EFFECT.cell
    ).length,
    0,
    "no sword once the clock is out"
  );
});

test("魔狱血刹's sword grows between the rungs, not in one jump at each", () => {
  /*
   * The ladder is bought in tens of hits (Core.HELLBENTER.hitsPerTier) and each
   * rung is one baked cell, so drawing one cell per tier makes the drop jump a
   * whole step on the tenth blow. The reference does not: `BV1U1v6B2EWt`
   * 1:49-2:05, walked frame by frame, has the drop go 0.32 -> 1.05
   * Slayer-heights with no step anywhere in it (docs/adr/0025 补记十八 二). So the
   * held sword is drawn as the rung it is on cross-faded into the next one, by
   * however many of that rung's hits are already in.
   */
  const sword = Render.BLOOD_SWORD;
  const at = (tier, charge) => sword.blendFor({ hellbenterTier: tier, hellbenterCharge: charge });
  const per = Core.HELLBENTER.hitsPerTier;
  /* On the rung, before any of its hits: that cell alone. */
  assert.deepEqual(
    at(3, 0),
    { from: sword.cellFor(3), to: sword.cellFor(4), mix: 0 },
    "a fresh tier draws its own cell"
  );
  /* Halfway through the rung's hits: half of the next cell laid over it. */
  assert.deepEqual(
    at(3, per / 2),
    { from: sword.cellFor(3), to: sword.cellFor(4), mix: 0.5 },
    "and the next one comes in as the hits land"
  );
  /* The top rung has nowhere to go, and must not blend off the end of the row. */
  assert.deepEqual(
    at(sword.tiers, per),
    {
      from: sword.cellFor(sword.tiers),
      to: sword.cellFor(sword.tiers),
      mix: 0
    },
    "the full sword is the full sword whatever the charge says"
  );
  /*
   * And the renderer actually uses it: at half a rung the sword row is drawn
   * twice - the cell it is on, and the one it is working towards.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  player.facing = 1;
  player.buffs.hellbenter = sword.hold - 10;
  player.hellbenterTier = 3;
  player.hellbenterCharge = per / 2;
  const calls = [];
  Render.render(recordingContext(calls), state, { sprites });
  const swordRow = Render.EFFECT.bloodSwordRow;
  const cells = calls
    .filter(
      (call) =>
        call[0] === "drawImage" && call[3] / Render.EFFECT.cell === swordRow
    )
    .map((call) => call[2] / Render.EFFECT.cell);
  assert.ok(
    cells.includes(sword.cellFor(3)) && cells.includes(sword.cellFor(4)),
    "the sword is drawn as both rungs, half a rung in"
  );
});

test("魔狱血刹's 血气之剑 forms before it is a sword", () => {
  /*
   * The owner pointed at the reference's own cast twice (「开始」, then 「开始的断剑
   * 样子和参考不一样」): the sword does not arrive finished. The art is the client's
   * `sword-dodge.img` - outline -> **white sword** -> red outline -> a white burst
   * with rays -> red-and-white with sparks -> a **red sword** -> a gold blade -
   * which is 11_魔狱血刹 #52-#72 beat for beat. The sword row must not be drawn
   * while that is running, or the finished sword pops in behind the effect that is
   * meant to be making it (docs/adr/0025 补记五).
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: Render.SPRITE.frameW * Render.SPRITE.cols, height: Render.SPRITE.frameH * 12 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    rift: { width: 23040, height: 384 * 3 },
    awakening: { width: 560, height: 296 }
  };
  const hold = Render.BLOOD_SWORD.hold;
  const drawnRows = (left) => {
    player.facing = 1;
    player.buffs.hellbenter = left;
    player.hellbenterTier = 1;
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    return calls
      .filter((call) => call[0] === "drawImage" && call[4] === Render.EFFECT.cell)
      .map((call) => call[3] / Render.EFFECT.cell);
  };
  const swordRow = Render.EFFECT.bloodSwordRow;
  const formRow = Render.EFFECT.bloodSwordRow + 4;  // sword +8, gold +9, white +10, strand +11, form +12
  const bloodFormRingRow = Render.EFFECT.bloodSwordRow + 5;
  const bloodFormStarRow = Render.EFFECT.bloodSwordRow + 6;
  /* The moment it lands: the disc and nothing else. */
  const fresh = drawnRows(hold);
  assert.ok(fresh.includes(formRow), "the 成形 is drawn the moment the sword lands");
  assert.ok(!fresh.includes(swordRow), "and the finished sword is not, yet");
  /* Half a second later the 成形 is over and the sword itself is there. */
  const settled = drawnRows(hold - 0.5);
  assert.ok(settled.includes(swordRow), "the sword is drawn once the disc is over");
  assert.ok(!settled.includes(formRow), "and the 成形 is not drawn twice");
  /* The line is `SWORD_FORM.seconds`, read off the reference's own 13 frames. */
  assert.ok(
    drawnRows(hold - 0.4).includes(formRow) && !drawnRows(hold - 0.5).includes(formRow),
    "the 成形 lasts the 0.43s the reference's #49-#63 has it for"
  );
  /*
   * **And it has two beats, not one.** The reference holds a gold sunburst at his
   * chest for #49-#55, then swaps it for a red spiked star at #57 (补记十八 六);
   * the disc used to stay up for the whole stretch, which is what made the 成形
   * read as one gold flash. The two are different rows, so which one is drawn at
   * a given progress is exactly what this can check.
   */
  const rowsAt = (left) =>
    drawnRows(left).filter(
      (row) => row === bloodFormRingRow || row === bloodFormStarRow
    );
  assert.deepEqual(
    rowsAt(hold)[0],
    bloodFormRingRow,
    "the 成形 opens with the gold disc"
  );
  assert.deepEqual(
    rowsAt(hold - 0.4)[0],
    bloodFormStarRow,
    "and ends on the red star the reference swaps in for it"
  );
  /* Every one of its cells is real art on the shipped sheet, and the row runs
     outline -> white -> lit, which is the whole point of it. */
  const effects = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  const cell = Render.EFFECT.cell;
  const formCells = [];
  for (let index = 0; index < Render.BLOOD_SWORD_FORM.frames; index += 1) {
    formCells.push(cellAlphaBox(effects, index, formRow, cell, cell));
  }
  assert.ok(
    formCells.every((box) => box),
    "every frame of the 成形 has ink"
  );
  /* f1 is the same sword **lit**: white and longer than the faint outline f0. */
  assert.ok(
    formCells[1].y1 - formCells[1].y0 > formCells[0].y1 - formCells[0].y0,
    "the second frame is the same sword lit up, taller than the outline"
  );
  /*
   * **And none of them is the long sword** (docs/adr/0025 补记二十). The owner saw
   * the 成形 resolve into a full-grown sword and then hand over to a first-tier one:
   * 「在释放的一瞬间有个长剑变成了短剑，应该一开始就是短剑」. `sword-dodge`'s f4-f8
   * are 115 px of ink in the cell - as tall as the last tier - while the first tier
   * is 60, so the row now stops at f3 and every frame it keeps is first-tier sized.
   */
  const held = /* the first tier's own cell, on the sword's row */
    cellAlphaBox(
      effects,
      0,
      Render.EFFECT.bloodSwordRow,
      cell,
      cell
    );
  /*
   * **Both sides in screen pixels, because the two rows are drawn at different
   * `size`.** What the owner sees is not the cells' ink but what the renderer
   * scales them to: the 成形 at `BLOOD_SWORD_FORM.size`, the held sword at
   * `BLOOD_SWORD.size`.
   */
  const heldHeight = ((held.y1 - held.y0) / cell) * Render.BLOOD_SWORD.size;
  formCells.forEach((box, index) => {
    const drawn = ((box.y1 - box.y0) / cell) * Render.BLOOD_SWORD_FORM.size;
    assert.ok(
      drawn <= heldHeight * 1.25,
      `and the 成形's frame ${index} is the sword he will actually be holding ` +
        `(${drawn.toFixed(0)}px against ${heldHeight.toFixed(0)}px)`
    );
  });
});

test("魔狱血刹's full sword is a different sword, not the same one re-edged", () => {
  /*
   * The owner, looking at the 满档 sword: 「铸剑完成后应该是换了一把剑」, and then a
   * reference frame: 「就是这一把」. In it the guard and the red shaft above it are
   * unchanged, and **everything below the guard is a blade that comes to a point**
   * - dark body, gold edge - where the growing sword has a round-ended blood drop.
   * docs/adr/0025 补记十九.
   *
   * Both rows are read back off the shipped sheet, so a stale atlas cannot pass:
   * the red one has to stay round (that is the reference's own growth, 补记十八 二)
   * and the full one has to taper to a point.
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  const cell = Render.EFFECT.cell;
  const alphaAt = (x, y) => sheet.pixels[(y * sheet.width + x) * 4 + 3];
  const widthAt = (row, column, y) => {
    let left = -1;
    let right = -1;
    for (let x = 0; x < cell; x += 1) {
      if (alphaAt(column * cell + x, row * cell + y) > 40) {
        if (left < 0) left = x;
        right = x;
      }
    }
    return left < 0 ? 0 : right - left + 1;
  };
  const last = Render.EFFECT.bloodSwordFrames - 1;
  /*
   * **The blade curves.** That is the shape 换剑 swaps in: the reference's own
   * 满档 sword is a **sabre that hooks towards its tip** (业主的第二张参考图), not a
   * straight-sided drop - and it is the client's own `sword-dodge` f9, which has
   * that hook in its art. So the measure is the blade's *spine*: the centre of the
   * silhouette a few rows under the guard versus the centre near its end. A drop
   * is symmetric and its spine never leaves the guard's line; a sabre's does.
   */
  const spine = (row, column) => {
    const span = (y) => {
      let left = -1;
      let right = -1;
      for (let x = 0; x < cell; x += 1) {
        if (alphaAt(column * cell + x, row * cell + y) > 40) {
          if (left < 0) left = x;
          right = x;
        }
      }
      return [left, right];
    };
    let guard = 0;
    let widest = 0;
    for (let y = 0; y < cell; y += 1) {
      const [left, right] = span(y);
      if (left >= 0 && right - left + 1 > widest) {
        widest = right - left + 1;
        guard = y;
      }
    }
    let bottom = guard;
    for (let y = cell - 1; y > guard; y -= 1) {
      if (span(y)[0] >= 0) {
        bottom = y;
        break;
      }
    }
    const middle = (y) => {
      const [left, right] = span(y);
      return left < 0 ? null : (left + right) / 2;
    };
    const top = middle(guard + 2);
    const low = middle(guard + Math.floor((bottom - guard) * 0.95));
    return {
      widest,
      height: bottom - guard,
      drift: top === null || low === null ? 0 : low - top
    };
  };
  const red = spine(Render.EFFECT.bloodSwordRow, last);
  assert.ok(red.height > 40, `the drop really is there (${red.height} rows)`);
  assert.ok(
    Math.abs(red.drift) < 1.5,
    `the growing sword's drop is symmetric about the guard (${red.drift})`
  );
  const gold = spine(Render.EFFECT.goldSwordRow, last);
  assert.ok(gold.height > 40, `and the full sword's blade is there (${gold.height} rows)`);
  assert.ok(
    Math.abs(gold.drift) > Math.abs(red.drift) + 2,
    `while the full sword carries a sabre's curve (${gold.drift} vs ${red.drift})`
  );
  /*
   * **And the swap only happens at full.** Reaching the top of the ladder is
   * 「铸剑完成」; below it the sword is the drop, growing (the reference's own
   * growth, 补记十八 二), including in the white warning's own row.
   */
  const whiteLow = spine(Render.EFFECT.whiteSwordRow, 3);
  assert.ok(
    Math.abs(whiteLow.drift) < 1.5,
    `a half-forged sword stays a drop even in the white warning (${whiteLow.drift})`
  );
  const whiteFull = spine(Render.EFFECT.whiteSwordRow, last);
  assert.ok(
    Math.abs(whiteFull.drift) > Math.abs(red.drift) + 2,
    `and the full one is the same sabre, whitened (${whiteFull.drift})`
  );
  /* The guard is the one thing the swap must not touch, and the row order holds. */
  assert.equal(
    Render.EFFECT.bloodSwordRow + 1,
    Render.EFFECT.goldSwordRow,
    "gold is still its own row, right after the red one"
  );
});

test("魔狱血刹's 觉醒插画 owns the cast's own second and nothing else", () => {
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  const cutInCall = () => {
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    const index = calls.findIndex((call) => call[0] === "drawImage" && call[1] === sprites.awakening);
    return index === -1 ? null : calls[index];
  };
  const spec = Core.SKILLS.hellbenter;
  player.skillId = "hellbenter";
  /*
   * **It owns the whole cast** (补记十八 七). Walked off `11_魔狱血刹.mp4`: the
   * illustration is in at 0.900s and *still there* at 2.067s, when the sword is
   * already forming - it covers the cast and does not move or grow while it is up.
   * It used to leave at 0.40, on the reading that it would otherwise cover the
   * 成形; that reading was wrong about where the two are drawn (the picture is in
   * the lower left, the 成形 is on him), so the picture now stays and only the
   * cast's own end takes it away.
   */
  player.skillTimer = spec.duration * 0.75;
  const settled = cutInCall();
  assert.ok(settled, "the picture is drawn while the cast runs");
  /*
   * `drawImage(image, dx, dy, dw, dh)`: `[2]` is where its left edge lands.
   * **It is the world window's left edge, not the canvas'** (`docs/adr/0040`):
   * the picture slides in from the edge of the picture, so it never sits in the
   * black bar.
   */
  const atRest = Core.VIEW.left;
  assert.ok(
    Math.abs(settled[2] - atRest) < 0.001,
    `and is fully in a quarter of the way in (${settled[2]}, expected ${atRest})`
  );
  player.skillTimer = spec.duration * 0.5;
  const holding = cutInCall();
  assert.ok(
    holding && Math.abs(holding[2] - atRest) < 0.001,
    `and is still there where the sword starts forming (${holding && holding[2]})`
  );
  /* And it is only the cast's end that takes it away. */
  player.skillTimer = spec.duration * 0.05;
  const leaving = cutInCall();
  assert.ok(
    leaving && leaving[2] < 0,
    `and it is sliding out as the cast lets go (${leaving && leaving[2]})`
  );
  player.skillTimer = spec.duration * 0.99;
  player.skillId = null;
  player.skillTimer = 0;
  assert.equal(cutInCall(), null, "and it is gone the moment the cast is");
});

test("魔狱血刹's sword is forged by his own hits, and only by them", () => {
  /*
   * 铸剑 is the owner's own reading of the reference - 「需要通过攻击从怪物身上汲取
   * 血气」 - so the growth is paid for by fighting and by nothing else. The two
   * ways it could go wrong are both here: a sword that grows when the *floor*
   * kills something (the gate is `slayerSwing`, the flag the arena's own damage
   * already clears), and a sword that grows with no sword up.
   *
   * **How much fighting buys a tier** is the other half, and the owner's own
   * note on it: one-hit-per-tier maxed the sword inside the first two monsters,
   * and he sent it back as 「你现在的短剑长得有点快」. Ten hits to a tier now, and
   * the ten are counted rather than rounded up, so nine hits must move nothing.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  player.buffs.hellbenter = 40;
  player.hellbenterTier = 1;
  const enemy = Core.createEnemy(state, "brute", player.x + 60);
  enemy.hp = 900;
  enemy.maxHp = 900;
  state.enemies = [enemy];

  const perTier = Core.HELLBENTER.hitsPerTier;
  for (let hit = 1; hit < perTier; hit += 1) {
    Core.damageEnemy(state, enemy, 1, 0, player.x);
    assert.equal(
      player.hellbenterTier,
      1,
      `hit ${hit} of ${perTier} has not bought a tier yet`
    );
  }
  assert.equal(
    state.effects.filter((effect) => effect.kind === "bloodStrand").length,
    perTier - 1,
    "and the blood each hit took is drawn flying into him"
  );

  Core.damageEnemy(state, enemy, 1, 0, player.x);
  assert.equal(player.hellbenterTier, 2, `${perTier} hits buy the tier`);
  assert.equal(player.hellbenterCharge, 0, "and the count starts again from zero");

  Core.damageEnemy(state, enemy, 5, 0, player.x, { noBloodOrbs: true });
  assert.equal(player.hellbenterTier, 2, "a slab crushing a monster forges nothing");

  Core.damageEnemy(state, enemy, 999, 0, player.x);
  assert.ok(enemy.dead, "the brute is dead");
  assert.equal(
    player.hellbenterTier,
    3,
    "a kill pays a whole tier on the spot, on top of the hit that killed it"
  );

  for (let index = 0; index < 40; index += 1) {
    const next = Core.createEnemy(state, "grunt", 520);
    next.hp = 1;
    state.enemies.push(next);
    Core.damageEnemy(state, next, 5, 0, player.x);
  }
  assert.equal(
    player.hellbenterTier,
    Core.HELLBENTER.tiers,
    "and the sword stops growing at the top tier"
  );

  player.buffs.hellbenter = 0;
  player.hellbenterTier = 0;
  const before = state.effects.filter((effect) => effect.kind === "bloodStrand").length;
  const plain = Core.createEnemy(state, "grunt", 520);
  Core.damageEnemy(state, plain, 5, 0, player.x);
  assert.equal(player.hellbenterTier, 0, "with no sword on his back there is nothing to forge");
  assert.equal(
    state.effects.filter((effect) => effect.kind === "bloodStrand").length,
    before,
    "and nothing flies in"
  );
});

test("魔狱血刹's sword turns white for the last five seconds, and breathes", () => {
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  const swordPasses = (seconds) => {
    player.buffs.hellbenter = seconds;
    player.hellbenterTier = Render.BLOOD_SWORD.tiers;
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    const rows = {
      red: Render.EFFECT.bloodSwordRow * Render.EFFECT.cell,
      gold: Render.EFFECT.goldSwordRow * Render.EFFECT.cell,
      white: Render.EFFECT.whiteSwordRow * Render.EFFECT.cell
    };
    return {
      red: calls.filter((call) => call[0] === "drawImage" && call[3] === rows.red).length,
      gold: calls.filter((call) => call[0] === "drawImage" && call[3] === rows.gold).length,
      white: calls.filter((call) => call[0] === "drawImage" && call[3] === rows.white).length
    };
  };
  const calm = swordPasses(Render.BLOOD_SWORD.whiteFrom + 6);
  /*
   * **Two passes of the red row, and both are the sword.** The cell is drawn
   * flat and then again with `lighter` (`SWORD.glow`), which is what keeps a
   * blade whose own art is mostly dark reading as a red sword on our floor -
   * the owner named what it looked like without that pass: 「断剑不对吧」.
   */
  /*
   * With time left and the ladder finished, the sword is the **gold** one - and
   * it is drawn the same two passes: flat, then again with `lighter`.
   */
  assert.equal(
    calm.gold,
    Render.BLOOD_SWORD.glow ? 2 : 1,
    "there is time left and the ladder is finished: the sword is the gold one"
  );
  assert.equal(calm.red, 0, "and the red row is not drawn at all");
  assert.equal(calm.white, 0, "and neither is the white row");
  const warning = swordPasses(Render.BLOOD_SWORD.whiteFrom - 1);
  assert.equal(warning.gold, 0, "the last five seconds swap the row rather than tint it");
  assert.equal(warning.red, 0, "and the red row is not the one it swaps to");
  assert.equal(
    warning.white,
    Render.BLOOD_SWORD.glow ? 3 : 2,
    "and the white sword is drawn twice - itself, and the breath laid over it " +
      "(plus the glow pass, when the sword has one)"
  );
});

test("魔狱血刹's 血丝 flies from the wound to him", () => {
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  const wound = { x: player.x + 180, y: player.y - 40 };
  state.effects.push({
    kind: "bloodStrand",
    x: wound.x,
    y: wound.y,
    z: 0,
    life: 0.16,
    maxLife: 0.32
  });
  const calls = [];
  Render.render(recordingContext(calls), state, { sprites });
  const index = calls.findIndex(
    (call) => call[0] === "drawImage" && call[3] === Render.EFFECT.strandRow * Render.EFFECT.cell
  );
  assert.ok(index > 0, "the strand is drawn");
  const head = calls.slice(0, index).reverse().find((call) => call[0] === "translate");
  assert.ok(
    head[1] > player.x && head[1] < wound.x,
    `half way through, its head is half way there (${head[1]})`
  );
  assert.ok(head[2] < player.y, "and above the floor, on its way to his chest");
  const turn = calls.slice(0, index).reverse().find((call) => call[0] === "rotate");
  assert.ok(turn && Math.abs(turn[1]) > 0.01, "the thread is turned along the line it is flying");
});

test("魔狱血刹's 火山 is ground he opened, and it burns on its own clock", () => {
  /*
   * The half of the move that is not his: the sword goes into the floor and
   * **the floor is what erupts** (docs/adr/0002's rule, and why this is a field
   * rather than a five-second cast). It keeps hitting after he has walked away,
   * it holds what it has (the reference's 砸地瞬间控制住敌人), and it knocks what
   * is left standing down on its way out.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  player.buffs.hellbenter = 40;
  player.hellbenterTier = Core.HELLBENTER.tiers;
  const victim = Core.createEnemy(state, "brute", player.x + 60, 0);
  victim.hp = 9000;
  victim.maxHp = 9000;
  victim.speed = 0;
  victim.attackRange = NEVER_REACHES;
  state.enemies = [victim];

  Core.step(state, { skills: { hellbenter: true } });
  assert.equal(player.skillId, "hellbenterSlam", "the second press is the fall");
  /*
   * The cast is 3.0s now - he holds the pose while the ground burns (see the
   * skill's own `duration`) - so the field is read at its *handover*, `field.at`
   * of the cast, not at its end.
   */
  const slam = Core.SKILLS.hellbenterSlam;
  let handover = 0;
  while (state.fields.length === 0 && handover < 180) {
    Core.runFrames(state, 1, {});
    handover += 1;
  }
  assert.equal(state.fields.length, 1, "it leaves the ground burning where the sword went in");
  const field = state.fields[0];
  /*
   * **In front of him, not under him.** The owner: 「崩的位置不对」. Measured on
   * 11_魔狱血刹 #180, the crater's centre is 131 client px = 1.56 身位 ahead of his
   * own, so the crater is 1.5 身位 forward and he ends up standing at its near
   * rim (`SKILLS.hellbenterSlam.field.forward`).
   */
  const forward = Core.SKILLS.hellbenterSlam.field.forward;
  assert.equal(
    field.x,
    player.x + field.facing * forward,
    "in front of him"
  );
  /*
   * The art is 108 world px either side of that spot, so the crater's near rim
   * lands 23 px in front of his soles - he is standing just behind it, which is
   * the reference's own reading.
   */
  assert.ok(forward > 108, `and not on his own feet (${forward} px ahead of the crater's centre)`);
  assert.equal(field.tier, Core.HELLBENTER.tiers, "and it remembers what the sword was worth");
  /*
   * **And he is not free: he holds the pose.** The owner: 「在崩的过程中身体应该保持
   * 一个固定的姿势」 - the reference holds the same crouch from the slam to the end
   * of the eruption (#158 through #230), so the cast runs to 3.0s and the last
   * 2.4s of it are the hold.
   */
  assert.equal(player.skillId, "hellbenterSlam", "he is still in the move while it burns");
  /*
   * ... and the pose he holds is the motion's **last frame**, not a pose of its
   * own: the beats stop at 0.2 of the cast, so everything after that is the
   * drive's final cell (`SPRITE.skillClips.hellbenterSlam`).
   */
  const beats = Render.SPRITE.skillClips.hellbenterSlam.beats;
  assert.equal(
    Number((beats[beats.length - 1].until * slam.duration).toFixed(3)),
    slam.field.at,
    "the drive ends as the ground opens"
  );
  assert.equal(
    beats.reduce((sum, beat) => sum + beat.frames, 0),
    Render.SPRITE.skillClips.hellbenterSlam.frames,
    "and the beats are the whole clip"
  );

  /*
   * The crack alone: no damage yet - the column is what burns (see the stages).
   * The victim stands where the crater is now, which is 1.5 身位 ahead of the
   * caster rather than on him, so it is placed off the *field*.
   */
  victim.x = field.x;
  const cracked = victim.hp;
  Core.runFrames(state, Math.ceil(0.6 * Core.FPS), {});
  assert.equal(victim.hp, cracked, "the crack under him does not damage on its own");

  /* Walk him into the eruption. */
  Core.runFrames(state, Math.ceil(3.5 * Core.FPS), {});
  assert.ok(victim.hp < cracked - 100, `the column does, and in beats (${cracked - victim.hp})`);
  assert.ok(
    victim.stun > 0 || victim.knockdown > 0,
    "and it holds what it has rather than knocking it about"
  );
  /* And it is still the floor's, not his: he can be somewhere else entirely. */
  player.x += 300;
  victim.hp = 9000;
  const far = victim.hp;
  Core.runFrames(state, Math.ceil(0.4 * Core.FPS), {});
  assert.ok(victim.hp < far, "the beats land wherever the crack is, not wherever he is");
});

test("魔狱血刹's 火山 is worth what the sword was worth", () => {
  /*
   * The owner's own shape for the two presses: **没铸满也能拍，伤害按档位缩放**
   * (grill Q4). Same volcano, two swords - the stub he never fed and the one the
   * whole fifty seconds went into.
   */
  const burn = (tier) => {
    const state = Core.createState({ seed: 11 });
    const player = state.player;
    player.buffs.hellbenter = 40;
    player.hellbenterTier = tier;
    const victim = Core.createEnemy(state, "brute", player.x + 60, 0);
    victim.hp = 9000;
    victim.maxHp = 9000;
    victim.speed = 0;
    victim.attackRange = NEVER_REACHES;
    state.enemies = [victim];
    const slam = Core.SKILLS.hellbenterSlam;
    Core.step(state, { skills: { hellbenter: true } });
    /* To the handover, then the whole five seconds of ground. */
    Core.runFrames(state, Math.ceil(slam.field.at * Core.FPS) + 1, {});
    const start = victim.hp;
    Core.runFrames(state, Math.ceil((slam.field.span + slam.field.linger) * Core.FPS) + 2, {});
    return start - victim.hp;
  };
  const forged = burn(Core.HELLBENTER.tiers);
  const stub = burn(1);
  assert.ok(stub > 0, `the 断剑 still erupts (${stub})`);
  assert.ok(
    forged > stub * 1.6,
    `but a full sword is worth about twice it (${stub} -> ${forged})`
  );
});

test("魔狱血刹's 火山 is drawn on the floor, not on him", () => {
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    rift: { width: 23040, height: 384 * 3 },
    awakening: { width: 560, height: 296 }
  };
  const field = {
    skillId: "hellbenterSlam",
    from: 0,
    x: 640,
    y: Core.ARENA.groundY,
    z: 220,
    facing: 1,
    clock: 2.5,
    span: 5,
    life: 5.6
  };
  state.fields = [field];
  player.x = 120;
  const calls = [];
  Render.render(recordingContext(calls), state, { sprites });
  const row = Render.EFFECT.riftRows.hellbenterSlam.back;
  /* `drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)`: `[3]` is which row. */
  const index = calls.findIndex(
    (call) => call[0] === "drawImage" && call[3] === row * Render.EFFECT.riftCell
  );
  assert.ok(index > 0, "the eruption is drawn");
  const draw = Render.EFFECT.draw.hellbenterSlam;
  const origin = calls.slice(0, index).reverse().find((call) => call[0] === "translate");
  assert.equal(origin[1], field.x, "on the spot it was opened on, not on the Slayer");
  /*
   * The row is anchored on the ground point the bake pinned to the cell's 0.75
   * line, so the drawn origin sits `size / 4` above it - and that ground point
   * has to be *this spot's* floor line, depth lift and all. Getting this wrong
   * is what put 嗜魂封魔斩's vortex a Slayer-height over his hand for four rounds
   * (docs/adr/0024).
   */
  assert.ok(
    Math.abs(origin[2] + draw.size / 4 - (Core.ARENA.groundY - Core.depthLift(field.z))) < 0.5,
    `the column stands on that spot's own floor line (${origin[2] + draw.size / 4})`
  );
  /* The draw entry has to pin it to the floor, or it would ride him instead. */
  assert.equal(Render.EFFECT.draw.hellbenterSlam.ground, true, "it belongs to the ground");
});

test("魔狱血刹's two pieces of art are the ones the bake wrote", () => {
  /*
   * Both new files are facts about PNGs rather than numbers anyone should be
   * free to edit, so they are read back here the way the body sheet's own height
   * is: the sword's row has to still be the shape the renderer's ink fractions
   * describe, and the 插画 has to be the half-body it was cut from, not a
   * full-frame rectangle of the clip.
   */
  const effects = decodeRgbaPng(path.join(__dirname, "..", "assets", "effects.png"));
  const cell = Render.EFFECT.cell;
  const tiers = 1;
  const cells = [];
  for (let index = 0; index < tiers; index += 1) {
    cells.push(cellAlphaBox(effects, index, Render.EFFECT.bloodSwordRow, cell, cell));
  }
  assert.ok(
    cells.every((box) => box),
    "the sword row's cell has ink"
  );
  const shortCell = cells[0];
  const longCell = cells[tiers - 1];
  /*
   * **They all share a pommel line and start from the same hilt.** That is what
   * lets the renderer pin the sword by its top and step cell by cell as it is
   * forged without the sword jumping - the hilt stays where it is and only the
   * blade below it changes (see SWORD.cellFor).
   */
  assert.ok(
    cells.every((box) => box.y0 === shortCell.y0),
    "every tier hangs from the same point"
  );
  /*
   * **The range is the reference's own pair, and it is narrow on purpose.** It
   * used to open on the client's shortest frame (73 of its 160), which is 85%
   * hilt and reads as a guard with a stub - the owner: 「断剑不对吧」. Measured off
   * 11_魔狱血刹 #100/#140 the sword behind him is 0.92-0.96 of a Slayer-height,
   * so the ladder starts at 0.90 身位 and ends at the full 1.29.
   */

  /*
   * The row is the client's own `sword-dodge` at four lengths, 0.61 -> 1.20
   * 身位, so the first cell is a little over half the last - **not** the 85%-hilt
   * stub the old cut opened on. (0.61/1.20 = 0.51, measured on the shipped PNG.)
   */
  assert.ok(
    shortCell.y1 - shortCell.y0 > 0.45 * (longCell.y1 - longCell.y0),
    `and the first is a whole sword, not a stub (${shortCell.y1 - shortCell.y0} rows)`
  );
  /*
   * **The blade only ever grows.** Read bottom to top: each tier's ink is taller
   * than the one before it, and never shorter - a row that went the other way
   * anywhere would read as the sword shrinking on a hit.
   */
  for (let index = 1; index < tiers; index += 1) {
    assert.ok(
      cells[index].y1 >= cells[index - 1].y1,
      `tier ${index + 1} is at least as long as tier ${index} ` +
        `(${cells[index - 1].y1 - cells[index - 1].y0} -> ${cells[index].y1 - cells[index].y0})`
    );
  }
  assert.ok(
    Math.abs(shortCell.y0 / cell - Render.BLOOD_SWORD.inkTop) < 0.02,
    `the renderer's ink top still describes every one of them (${shortCell.y0})`
  );
  /* And the white row is the same cells, recoloured. */
  for (let index = 0; index < tiers; index += 1) {
    const white = cellAlphaBox(effects, index, Render.EFFECT.whiteSwordRow, cell, cell);
    assert.ok(
      white && white.y0 === cells[index].y0 && white.y1 === cells[index].y1,
      `the white warning is the same sword at tier ${index + 1}, not a differently shaped one`
    );
  }
  const awakening = decodeRgbaPng(path.join(__dirname, "..", "assets", "awakening.png"));
  const lit = cellAlphaBox(awakening, 0, 0, awakening.width, awakening.height);
  assert.ok(lit, "the cut-in is not empty");
  assert.ok(
    lit.y0 > 0 || lit.x1 < awakening.width - 1,
    "the picture is a shaped illustration, not the whole clip frame"
  );
  /* The one thing that makes it the 一觉 picture: it was cut from the reference. */
  assert.ok(
    awakening.width >= 500 && awakening.height >= 250,
    `the cut-in is cut at the reference's own size (${awakening.width}x${awakening.height})`
  );
  /*
   * And both of the cast's body motions are real cells on the sheet, not blank
   * columns. 魔狱血刹's 起手 is the client's 75-89 and its 落 is 143-156 - the
   * owner named both off the labelled full-frame sheet (`docs/adr/0025`), and
   * every frame of each has to exist or the move plays a hole.
   */
  const sheet = decodeRgbaPng(path.join(__dirname, "..", "assets", "slayer.png"));
  const moves = [
    ["hellbenter", 15, "起手"],
    ["hellbenterSlam", 14, "落"]
  ];
  moves.forEach(([skillId, frames, label]) => {
    const clip = Render.SPRITE.skillClips[skillId];
    assert.ok(
      clip && clip.frames === frames,
      `魔狱血刹's ${label} is the client's ${frames}-frame motion`
    );
    for (let step = 0; step < clip.frames; step += 1) {
      assert.ok(
        cellAlphaBox(sheet, clip.first + step, clip.row),
        `and every one of its cells has the Slayer in it (column ${clip.first + step})`
      );
    }
  });
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
  /* Past the cast's active window - the stance lands at the end of the beat. */
  Core.runFrames(state, 30, {});
  assert.ok(state.player.buffs.bloodRage > 0, "血之狂暴 goes up");
  assert.ok(state.player.hp < hpBeforeBuff, "血之狂暴 costs HP to keep");
  assert.ok(
    Core.attackSpeedOf(state.player) < speedBeforeBuff,
    "血之狂暴 slows the swing down (its own animation needs the time)"
  );
  assert.equal(near.hp, 400, "血之狂暴 is a stance, not a damage move");
  /* Let the stance finish casting before the next skill - it is a long one. */
  Core.runFrames(state, Math.ceil(Core.SKILLS.frenzy.duration * Core.FPS), {});

  /*
   * 嗜魂封魔斩: the vortex gnaws in small beats and drags what it catches toward
   * him, and the finisher is one heavy cut at the end. It used to be a rising
   * wave called 血气爆发 - the owner identified it as this move off two frame
   * sheets and had it redone (docs/adr/0022).
   */
  state.player.skillCooldowns.bloodyRave = 0;
  state.player.mp = state.player.maxMp;
  near.hp = 400;
  near.x = state.player.x + 60;
  const hold = { skills: { bloodyRave: true } };
  Core.step(state, hold);
  /* The entrance is the move's warning and cannot be skipped or cut short. */
  Core.runFrames(state, Math.ceil(Core.SKILLS.bloodyRave.channel.entrance * Core.FPS) - 3, hold);
  assert.equal(near.hp, 400, "the vortex is not out yet during the 0.867s entrance");
  assert.equal(state.player.channelReleasedAt, null, "and letting go early cannot end the entrance");
  const startX = near.x;
  Core.runFrames(state, 24, hold);
  assert.ok(near.hp < 400, "the vortex beats damage what it holds");
  assert.ok(near.x < startX, "and drags it toward his feet rather than pushing it away");
  /* Let go: the tail is fixed, and the finisher lands inside it. */
  const beforeFinisher = near.hp;
  Core.runFrames(state, 2, {});
  assert.notEqual(state.player.channelReleasedAt, null, "letting go is what ends the channel");
  /* The tail is 0.767s however long the vortex ran - 46 frames at 60fps. */
  Core.runFrames(state, Math.ceil(Core.SKILLS.bloodyRave.channel.tail * Core.FPS) + 2, {});
  assert.ok(
    beforeFinisher - near.hp >= Core.SKILLS.bloodyRave.damage,
    "the finisher cuts harder than any single vortex beat"
  );
  assert.equal(state.player.skillId, null, "and the cast is over");

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

test("嗜魂之手 is 无敌: a hit during the cast does not land at all", () => {
  const state = lastRoomState();
  Core.step(state, { skills: { graspHead: true } });
  Core.runFrames(state, 6, {});
  assert.ok(state.player.skillTimer > 0, "the cast is running");

  const hpBefore = state.player.hp;
  const dealt = Core.damagePlayer(state, 30, state.player.x + 40);

  assert.equal(dealt, 0, "无敌: the hit is refused outright");
  assert.equal(state.player.hp, hpBefore, "and costs him nothing");
  assert.equal(state.player.skillId, "graspHead", "the cast is not cut short");
  assert.ok(state.player.skillTimer > 0, "it is still running");
});

test("嗜魂之手 is 霸体 underneath: even with the i-frames spent, the move goes on", () => {
  const state = lastRoomState();
  Core.step(state, { skills: { graspHead: true } });
  Core.runFrames(state, 6, {});
  /* Spend the i-frames but leave the skill's 霸体: this is the guarantee the
     invuln window cannot make on its own, on the frames either side of it. */
  state.player.invuln = 0;

  const hpBefore = state.player.hp;
  const dealt = Core.damagePlayer(state, 30, state.player.x + 40);

  assert.ok(dealt > 0, "now the hit lands");
  assert.equal(state.player.hp, hpBefore - dealt, "and he pays for it");
  assert.equal(state.player.hurtTimer, 0, "but takes no hit-stun");
  assert.equal(state.player.skillId, "graspHead", "and the cast is not cut short");
});

test("the same hit does cut short a move without 霸体", () => {
  const state = lastRoomState();
  Core.step(state, { skills: { crossSlash: true } });
  Core.runFrames(state, 6, {});
  assert.ok(state.player.skillTimer > 0, "the cast is running");

  const dealt = Core.damagePlayer(state, 30, state.player.x + 40);

  assert.ok(dealt > 0, "the hit lands");
  assert.equal(state.player.skillId, null, "the cast is cut short");
  assert.equal(state.player.skillTimer, 0, "and its timer is cleared");
  assert.ok(state.player.hurtTimer > 0, "he takes the hit-stun instead");
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
  let tail = 0;
  while (state.player.skillTimer > 0 && tail < 240) {
    Core.runFrames(state, 1, {});
    tail += 1;
  }
  assert.ok(
    state.player.skillCooldowns.mountainRift > 0 &&
      state.player.skillCooldowns.mountainRift < skill.cooldown,
    "the long cooldown runs down after the cast"
  );
  assert.ok(near.knockdown > 0 || near.dead, "the rift knocks them down");
  assert.equal(state.player.skillTimer, 0, "and the cast does end (its own 4s plus the hit stops)");
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
   * **With the stance up the cut is its own animation.** 血之狂暴's swings are
   * the body's 188-209 (the owner picked the frames): three swings over the
   * three-hit chain, and the client's blood-sword row is drawn against them
   * frame for frame. The column comes off the *combo*, so the chain walks the
   * whole animation once instead of restarting it every press (docs/adr/0019).
   */
  const rage = Render.SPRITE.rageSwing;
  const arc = Render.SPRITE.rageArc;
  state.player.buffs.bloodRage = Infinity;
  const raging = renderIdle();
  /*
   * Two draws, both of them the stance's own: the swing's body art, and the
   * client's slash arc (lifted to its own row and graded to cream) over it.
   */
  const rows = calls
    .filter((call) => call[0] === "drawImage" && call[1] === sheet && call[6] === -Render.SPRITE.anchorX)
    .map((call) => call[3] / Render.SPRITE.frameH);
  assert.ok(
    rows.indexOf(rage.row) >= 0,
    "the stance's attack is its own clip, not the katana chain"
  );
  assert.ok(rows.indexOf(arc.row) >= 0, "and its own arc rides over it");
  assert.ok(
    raging[2] >= rage.first * Render.SPRITE.frameW &&
      raging[2] < (rage.first + rage.frames) * Render.SPRITE.frameW,
    "and it is drawn from that clip's own columns"
  );
  state.player.buffs.bloodRage = 0;
  assert.equal(
    renderIdle()[3],
    Render.SPRITE.frameH * 2,
    "with the stance down the katana chain is back"
  );

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

test("the hotbar exposes two rows of DNF slots and the panel exposes every skill", () => {
  const Loadout = require("../src/loadout.js");
  const slots = Render.skillBarButtons();
  assert.equal(slots.length, Loadout.SLOT_COUNT, "A S D F G H / Q W E R T Y");
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
  const barY = Render.skillBarButtons()[0].y + 4;
  const barY2 = Render.skillBarButtons()[6].y + 4;
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
    drag: { skillId: "bloodyRave", x: 400, y: 300 }
  });
  assert.equal(drawsAt(barY), 6, "the compact bar keeps its first row while arranging");
  assert.equal(drawsAt(barY2), 5, "and its second row");
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
  /* 这一条量的是"过没过半血"，不是回避率 —— 回避要抽一次随机数，抽了就把这条测试
     从"半血"变成"这一局那两颗骰子"，不是它要说的东西。 */
  boss.evasion = 0;
  state.enemies = [boss];
  const spec = Core.ENEMY_TYPES.boss;

  assert.equal(boss.phase, 1);
  /* One point above the ratio leaves it calm; the next point flips it. */
  Core.damageEnemy(state, boss, boss.maxHp * (1 - spec.phase2.hpRatio) - 1, 0, state.player.x);
  assert.equal(boss.phase, 1, "the boss must stay in phase one above the threshold");
  assert.equal(boss.speed, spec.speed);

  Core.damageEnemy(state, boss, 2, 0, state.player.x);
  assert.equal(boss.phase, 2, "crossing half health starts phase two");
  /* The banner is the stage's to own: every stage's boss is a different animal. */
  assert.equal(
    state.effects.some((effect) => effect.kind === "banner" && effect.text === STAGE.bossBanner),
    true,
    "the phase change must announce itself"
  );
  assert.ok(boss.speed > spec.speed, `phase two is faster: ${boss.speed}`);
  assert.ok(boss.damage > spec.damage, `phase two hits harder: ${boss.damage}`);
  assert.ok(boss.attackCooldownMax < spec.attackCooldown, "phase two attacks sooner");
  assert.ok(boss.slam.radius > spec.slam.radius, "phase two slams further");

  /* Every other boss in every other run reads from this one table. */
  /*
   * **191, not the 208 it was**：那一圈是"盘子的边比身体半宽再远 105"（`docs/adr/0036`），
   * 而牛的体宽照录像量出来偏大 1.20 倍、改成了 138（`docs/adr/0050` 追记），
   * 于是半宽从 (172+34)/2 = 103 变成 (138+34)/2 = 86 —— 那 105 是量出来的，它不变。
   */
  assert.equal(spec.slam.radius, 191, "the shared slam radius must not change");
  assert.equal(spec.slam.cooldown, 3.6, "the shared slam cooldown must not change");
  /* 57, not 88: every locomotion speed was scaled onto the recording's pace (docs/adr/0039). */
  assert.equal(spec.speed, 57, "the shared speed must not change");
  /* 13, not 18: 删掉每房强化卡之后补的余量（`docs/adr/0053`）。 */
  assert.equal(spec.damage, 13, "the shared damage must not change");

  const fresh = Core.createEnemy(Core.createState({ seed: 3 }), "boss", 500);
  assert.equal(fresh.phase, 1);
  assert.equal(fresh.slam.radius, 191, "a new boss starts from the pristine spec");
  assert.equal(fresh.speed, 57);

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
    /*
     * Mid band, and the band moved with the body: the lunge needs a gap between
     * `minGap` and `gap`, which for a 172-wide beast is a centre distance of
     * 154-268. +160 sat just under the near edge once the body grew.
     */
    const boss = Core.createEnemy(state, "boss", state.player.x + 200);
    /* Isolate the lunge: the slam would otherwise preempt a mid-range attack. */
    boss.slam = null;
    boss.attackRange = NEVER_REACHES;
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
  /* Mid band for the lunge, which is a gap - see the lunge test below. */
  const boss = Core.createEnemy(state, "boss", state.player.x + 200);
  /* 同上：击退要真的发出去，不能被一次回避吃掉。 */
  boss.evasion = 0;
  boss.slam = null;
  boss.attackRange = NEVER_REACHES;
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

/*
 * 录像里那张图，逐格读出来的（`docs/adr/0030`）。
 *
 * 这是**和参考片的契约**，不是地牢实现的复述：格子的位置、每一格算房间还是走廊、
 * 每一格开哪几个方向，全部来自 `measure-map-layout.png` 里量出来的那 12 格。
 * 谁想动地牢的形状，先回去量一遍录像。
 */
const MEASURED_MAP = {
  "0,0": "room:E",
  "1,0": "corr:ESW",
  "2,0": "corr:ESW",
  "3,0": "corr:SW",
  "0,1": "room:E",
  "1,1": "corr:NSW",
  "2,1": "room:N",
  "3,1": "corr:NS",
  "0,2": "room:E",
  "1,2": "corr:NEW",
  "2,2": "room:W",
  "3,2": "room:N"
};

/** 一格的门，写成 "NESW" 里选了哪几个。 */
function exitsOf(cell) {
  return "NESW".split("").filter((_, index) => cell.exits & (1 << index)).join("");
}

function cellKey(cell) {
  return `${cell.col},${cell.row}`;
}

function dungeonState(seed) {
  return Core.createState({
    seed: seed === undefined ? Core.DEFAULT_SEED : seed,
    stage: "mirkwood"
  });
}

test("the dungeon is the grid the recording shows, on every seed", () => {
  for (const seed of [1, 7, 42, Core.DEFAULT_SEED, 31337]) {
    const state = dungeonState(seed);
    const cells = state.dungeon.cells;
    assert.equal(cells.length, Object.keys(MEASURED_MAP).length, `seed ${seed} cell count`);
    assert.equal(state.dungeon.cols, 4, "4 columns, off the recording");
    assert.equal(state.dungeon.rows, 3, "3 rows, off the recording");
    cells.forEach((cell) => {
      const key = `${cell.col},${cell.row}`;
      const want = MEASURED_MAP[key];
      assert.ok(want, `seed ${seed} has a cell at ${key}, which the recording does not`);
      assert.equal(`${cell.kind}:${exitsOf(cell)}`, want, `seed ${seed} at ${key}`);
    });
  }
});

test("the entry and the boss are the recording's two cells", () => {
  const dun = Core.DUNGEON;
  assert.deepEqual(dun.entry, [2, 1], "the recording starts him at (2,1)");
  assert.deepEqual(dun.boss, [0, 2], "the red horned face sits on (0,2)");
  for (const seed of [1, 7, Core.DEFAULT_SEED]) {
    const state = dungeonState(seed);
    const entry = state.dungeon.cells[state.dungeon.entry];
    const boss = state.dungeon.cells[state.dungeon.boss];
    assert.equal(cellKey(entry), "2,1");
    assert.equal(cellKey(boss), "0,2");
    assert.equal(state.cell, state.dungeon.entry, "a run opens in the entry cell");
    assert.equal(state.room.name, ROOMS[dun.entryRoom].name, "and it is that room");
    assert.equal(
      state.stage.rooms[boss.room].enemies.filter((enemy) => enemy.type === "boss").length,
      1,
      "the boss cell holds the one boss"
    );
  }
});

function cellKey(cell) {
  return `${cell.col},${cell.row}`;
}

test("every seed deals every room exactly once, and deals the same way twice", () => {
  const roomCount = ROOMS.length;
  for (let seed = 1; seed <= 64; seed += 1) {
    const dealt = runCells(seed).map((room) => room.name);
    assert.equal(dealt.length, 12, `seed ${seed} does not fill the grid`);
    assert.equal(new Set(dealt).size, roomCount, `seed ${seed} repeats or drops a room`);
    /* 起点房与 Boss 房钉死，别的按种子洗 —— 洗的是内容，不是形状。 */
    assert.equal(dealt[6], "林间空地", `seed ${seed} moved the entry room`);
    assert.deepEqual(
      runCells(seed).map((room) => room.name),
      runCells(seed).map((room) => room.name),
      "the same seed has to deal the same dungeon"
    );
  }
  const orders = new Set();
  for (let seed = 1; seed <= 64; seed += 1) orders.add(runCells(seed).map((r) => r.name).join(","));
  assert.ok(orders.size > 1, "different seeds must still deal different rooms");
});

test("the dungeon is one connected map, and every cell can be walked to", () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    const state = dungeonState(seed);
    const seen = new Set([state.dungeon.entry]);
    const queue = [state.dungeon.entry];
    while (queue.length) {
      const at = queue.shift();
      "NESW".split("").forEach((dir) => {
        const next = Core.doorNeighbour(state.dungeon, state.dungeon.cells[at], dir);
        if (next < 0 || seen.has(next)) return;
        seen.add(next);
        queue.push(next);
      });
    }
    assert.equal(seen.size, state.dungeon.cells.length, `seed ${seed} has a cell no door reaches`);
    /* 门是双向的：能从 A 走 B，就得能从 B 走回 A。 */
    state.dungeon.cells.forEach((cell, index) => {
      "NESW".split("").forEach((dir) => {
        const next = Core.doorNeighbour(state.dungeon, cell, dir);
        if (next < 0) return;
        const back = Core.MINIMAP_STEPS[dir].back;
        assert.equal(
          Core.doorNeighbour(state.dungeon, state.dungeon.cells[next], back),
          index,
          `${cellKey(cell)} opens ${dir} to a cell that does not open back`
        );
      });
    });
  }
});

test("a door is locked until the room is cleared, and the way back is always open", () => {
  const state = dungeonState(Core.DEFAULT_SEED);
  const entry = state.dungeon.cells[state.dungeon.entry];
  assert.equal(exitsOf(entry), "N", "the entry cell opens north only");

  state.entryDoor = null;
  assert.equal(Core.exitMode(state, "N"), "locked", "an uncleared room is shut");
  assert.equal(Core.exitMode(state, "E"), "none", "and a wall is not a door");

  killAll(state);
  Core.step(state, {});
  assert.equal(Core.exitMode(state, "N"), "open", "clearing the room opens its doors");

  /* 进来那扇门永远开着 —— 这是"能回头"的全部内容。 */
  const other = dungeonState(Core.DEFAULT_SEED);
  const door = Core.doorNeighbour(other.dungeon, other.dungeon.cells[other.cell], "N");
  Core.goToCell(other, door);
  assert.equal(exitsOf(other.dungeon.cells[door]), "ESW", "the cell north of the entry");
  other.entryDoor = "S";
  assert.equal(Core.exitMode(other, "S"), "open", "the way he came in stays open");
  assert.equal(Core.exitMode(other, "W"), "locked", "and the rest do not, until it is cleared");
});

/**
 * 从他现在这一格走到 Boss 房的一条路，一个方向一步。
 *
 * 用 BFS，因为副本图有岔路（`docs/adr/0030`）—— "一路往右"那种写法在图上根本不成立。
 * 搜索走的是 `doorNeighbour`，也就是玩法真正走的那个门。
 */
function routeToBoss(state) {
  const start = state.cell;
  const goal = state.dungeon.boss;
  const came = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    if (at === goal) break;
    "NESW".split("").forEach((dir) => {
      const next = Core.doorNeighbour(state.dungeon, state.dungeon.cells[at], dir);
      if (next < 0 || came.has(next)) return;
      came.set(next, { at, dir });
      queue.push(next);
    });
  }
  assert.ok(came.has(goal), "the boss cell has to be reachable");
  const steps = [];
  for (let at = goal; at !== start; ) {
    const hop = came.get(at);
    steps.unshift(hop.dir);
    at = hop.at;
  }
  return steps;
}

/*
 * **清房不再发卡**（业主 2026-10-17：「我不想要通关每一个房间给的加 buffer 的奖励」；
 * `docs/adr/0053`）。门在 `cell.cleared` 那一刻就开，玩家数值一个都不涨。
 */
test("清房不发强化卡：门直接开，玩家的数值不变", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  const read = () => ({
    attackBonus: state.player.attackBonus,
    maxHp: state.player.maxHp,
    mpRegen: state.player.mpRegen,
    skillPower: state.player.skillPower,
    attackSpeed: state.player.attackSpeed
  });
  const before = read();

  killAll(state);
  Core.step(state, {});

  assert.equal(state.room.cleared, true);
  assert.equal(state.upgradeChoice, undefined, "清房不该再弹强化卡");
  assert.equal(state.player.upgradesTaken, undefined, "玩家身上不该再记强化");
  assert.deepEqual(read(), before, "清房不该改任何一项数值");

  const dir = "NESW".split("").find((d) => Core.exitMode(state, d) === "open");
  assert.ok(walkToDoor(state, dir) >= 0, `清完房 ${dir} 门就该让他走`);
});

/*
 * **领主一倒下就通关，不用再清剩下的怪**（业主 2026-10-18）。它的白色剪影
 * 先演完（`victoryDelay`），然后才进胜利页；其余小怪在那一刻就从场上拿掉。
 */
test("killing the lord clears the run without killing the other monsters", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  Core.goToCell(state, state.dungeon.boss);
  const boss = state.enemies.find((enemy) => enemy.type === "boss");
  assert.ok(boss, "the lord is in the room");
  assert.ok(state.enemies.length > 1, "and he is not alone");
  boss.evasion = 0;
  boss.hp = 1;
  Core.damageEnemy(state, boss, 99999, 0, boss.x);
  Core.step(state, {});

  assert.equal(state.room.cleared, true);
  assert.equal(state.victory, false, "the death effect still has to play");
  assert.ok(state.victoryDelay > 0, "the death effect is on its clock");
  assert.ok(
    state.enemies.every((enemy) => enemy.type === "boss"),
    "the other monsters are taken off the field"
  );
  assert.ok(
    state.effects.some((effect) => effect.kind === "bossrays"),
    "the lord's finishing light rays are on the clock"
  );

  Core.runFrames(
    state,
    Math.ceil((Core.DEATH.bossLie + Core.DEATH.bossSmoke + Core.DEATH.bossChunks + 0.6) * Core.FPS),
    {}
  );
  assert.equal(state.victory, true);
});

test("the elite mini-boss telegraphs a spin that sweeps a wide lane", () => {
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + SPIN_FROM);
  /*
   * **位置钉死**：`createEnemy` 会按随机流抖 ±14 像素，而这几条要的是一个
   * 确定的几何 —— 旋风的判定是**身体间距 ≤ 73**，抖出去就永远不进那一招。
   * 它曾经因此红过：房间内容多两只怪就会挪动那条随机流，这一步就从
   * "进得来"滑到"进不来"，而测试看上去像在说"精英不会旋风"。
   */
  elite.x = state.player.x + SPIN_FROM;
  state.enemies = [elite];
  /* Pin it down so the sweep itself, not a chase, is what threatens the player. */
  elite.speed = 0;
  elite.attackRange = NEVER_REACHES;
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
    const elite = Core.createEnemy(state, "elite", state.player.x + SPIN_FROM);
    /*
     * **位置钉死**：`createEnemy` 会按随机流抖 ±14 像素，而这几条要的是一个
     * 确定的几何 —— 旋风的判定是**身体间距 ≤ 73**，抖出去就永远不进那一招。
     * 它曾经因此红过：房间内容多两只怪就会挪动那条随机流，这一步就从
     * "进得来"滑到"进不来"，而测试看上去像在说"精英不会旋风"。
     */
    elite.x = state.player.x + SPIN_FROM;
    state.enemies = [elite];
    elite.speed = 0;
    elite.attackRange = NEVER_REACHES;
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

test("the elite is worth more experience than the chaff it is made of", () => {
  /*
   * The elite used to be worth a bigger heal orb than a grunt. With the whole
   * drop line gone (docs/adr/0021) its reward is the experience and the room
   * it unlocks, so that is what this holds.
   */
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + 60);
  const grunt = Core.createEnemy(state, "grunt", state.player.x + 90);
  state.enemies = [elite, grunt];

  Core.damageEnemy(state, elite, 9999, 0, state.player.x);
  pickUpEverything(state);

  assert.ok(state.stats.loot > 0, "它掉下来的名牌收得走");
  assert.ok(elite.xp > grunt.xp, "but it is worth more than a grunt");
});

test("the elite is a mini-boss, not a second boss: no phase two, no boss drop", () => {
  const state = lastRoomState();
  const elite = Core.createEnemy(state, "elite", state.player.x + 90);
  state.enemies = [elite];

  assert.equal(elite.phase2, null, "only the stage's boss enrages");
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

/*
 * **领主是两条血**（业主 2026-10-18「原视频中是两条血，才换颜色的」）：
 * 绿色那条从满血走到 50% 见底，然后红色那条从满格再走到 0；不是同一条换颜色。
 */
test("the lord's bar is two bars: green to half, then red from full", () => {
  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", 600);
  boss.maxHp = 160;
  boss.hp = 160;
  boss.phase = 1;
  assert.equal(Render.bossBarShare(boss), 1, "phase one starts full");
  boss.hp = 120;
  assert.equal(Render.bossBarShare(boss), 0.5, "phase one is half spent at 120/160");
  boss.hp = 80;
  assert.equal(Render.bossBarShare(boss), 0, "phase one is empty at exactly half");

  Core.enterPhase2(state, boss);
  assert.equal(boss.phase, 2);
  assert.equal(Render.bossBarShare(boss), 1, "the red bar starts full at 80/160");
  boss.hp = 40;
  assert.equal(Render.bossBarShare(boss), 0.5, "the red bar is half spent at 40/160");
  boss.hp = 0;
  assert.equal(Render.bossBarShare(boss), 0, "and empty at zero");
});

test("the boss bar names the boss in both phases, and no longer writes 狂暴 on it", () => {
  const calls = [];
  const ctx = recordingContext(calls);

  const state = lastRoomState();
  const boss = Core.createEnemy(state, "boss", 600);
  boss.hp = boss.maxHp * 0.8;
  state.enemies = [boss];
  /* 那块条显示的是**当前目标**，所以先把目标设上。 */
  state.target = { enemy: boss, dying: 0, share: boss.hp / boss.maxHp };
  state.bossEngaged = true;

  calls.length = 0;
  Render.render(ctx, state, {});
  const calmArcs = calls.filter((call) => call[0] === "arc").length;
  const calmTexts = calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
  const bossInfo = Core.monsterInfo("boss");
  const bossName = "Lv" + bossInfo.level + " " + bossInfo.label;
  assert.equal(
    Render.TARGET_PANEL.bossBar,
    1068,
    "Boss 条是整条 1068，不是某一帧剩下的绿色"
  );
  assert.ok(
    calmTexts.includes(bossName),
    `the bar must name this stage's boss (${bossName}), got ${JSON.stringify(calmTexts)}`
  );
  assert.ok(
    calmTexts.includes("ALERT!"),
    "交上手之后，条里没填满的那一段要写 ALERT!"
  );

  Core.enterPhase2(state, boss);
  calls.length = 0;
  Render.render(ctx, state, {});
  const enragedArcs = calls.filter((call) => call[0] === "arc").length;
  const enragedTexts = calls.filter((call) => call[0] === "fillText").map((call) => String(call[1]));
  assert.ok(enragedTexts.includes(bossName), "phase two still names him");
  assert.equal(
    enragedTexts.some((text) => text.includes("狂暴")),
    false,
    "录像里没有「· 狂暴」—— 翻脸仍然是玩法，但不写在条上"
  );
  assert.equal(
    enragedTexts.includes("ALERT!"),
    false,
    "红相位不再画橙色 ALERT 空槽"
  );
  /*
   * 业主 2026-10-21：「领主的……脚底下的光环」不要了。半血不再加那圈持续
   * 脉冲环；阶段变化只由金色一闪 / 暴怒横幅交代，所以 draw calls 不该增加。
   */
  assert.equal(
    enragedArcs,
    calmArcs,
    `the enrage aura is gone: ${calmArcs} -> ${enragedArcs}`
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

  const cleared = Core.createState({ seed: 7, stage: "mirkwood" });
  Core.goToCell(cleared, cleared.dungeon.boss);
  cleared.victory = true;
  const clearCalls = [];
  Render.render(recordingContext(clearCalls), cleared, {
    run: { seed: 7, improved: true, resultText: "新纪录！ 0:44.4 · Lv 4", recordText: run.recordText }
  });
  const clearTexts = textsFrom(clearCalls);
  assert.ok(clearTexts.includes(cleared.stage.name + " 通关"));
  assert.ok(
    clearTexts.some((text) => text.includes("新纪录！")),
    `a record run must say so: ${clearTexts.join(" / ")}`
  );
  assert.ok(
    clearTexts.some((text) => text.includes("本种子最佳")),
    "the clear screen must repeat the standing record"
  );
});

test("the two orbs are capsules flush with the bar's two ends", () => {
  /*
   * 2026-10-27 业主实玩反馈「血条和蓝条和框没对齐」：旧版画的是两颗 38×72 的竖椭圆，
   * 圆心 (146,496)/(814,496)，既比录像的胶囊窄一圈，又比球窝高 4px，还多画了数字。
   * 录像里它们是竖直胶囊：外框各 91×161 录像px、左右各自贴住底条两端的球窝、
   * 一直落到画面底边（`ref-13.png`：红 x9..100 / 蓝 x1341..1433，y5..166）。
   */
  const orb = Render.HUD_ORB;
  const bar = { x: 120, y: 456, w: 720, h: 82 };
  assert.deepEqual(orb.left, { x: 124.5, y: 458, w: 45.5, h: 80 }, "the HP capsule");
  assert.deepEqual(orb.right, { x: 790, y: 458, w: 45.5, h: 80 }, "the MP capsule");
  assert.equal(orb.left.x - bar.x, 4.5, "the HP capsule sits in the bar's left socket");
  assert.equal(
    bar.x + bar.w - (orb.right.x + orb.right.w),
    orb.left.x - bar.x,
    "the MP capsule mirrors it on the right"
  );
  assert.equal(orb.left.y + orb.left.h, 538, "both capsules reach the bar's bottom edge");
  assert.ok(
    orb.left.w < orb.left.h,
    `a capsule, not a sphere: ${orb.left.w}x${orb.left.h}`
  );
});

test("nothing is printed inside the two orbs", () => {
  /* 录像里球上没有数字 —— 血量只由液面读（`docs/adr/0064` 补记）。 */
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.player.hp = 77;
  state.player.mp = 33;
  const calls = [];
  Render.render(recordingContext(calls), state, {});
  const inside = (x, y, box) =>
    x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  const texts = calls.filter((call) => call[0] === "fillText");
  for (const call of texts) {
    for (const box of [Render.HUD_ORB.left, Render.HUD_ORB.right]) {
      assert.equal(
        inside(call[2], call[3], box),
        false,
        `"${call[1]}" is printed inside an orb at ${call[2]},${call[3]}`
      );
    }
  }
});

test("the coaching line is gone from the HUD", () => {
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

  /* `docs/adr/0064`：本作附加 HUD 撤掉，操作提示不再画；状态仍可留给测试读。 */
  assert.equal(
    textsFor({ hint }).includes(hint.text),
    false,
    "live play no longer draws the coaching line"
  );
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

test("the room banner moves clear of the boss bar and the help quotes the real map", () => {
  const bannerY = (cell) => {
    const calls = [];
    const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood", cell });
    /* Drop the state's own room banner so ours is the first in the stack. */
    state.effects = state.effects.filter((effect) => effect.kind !== "banner");
    state.effects.push({ kind: "banner", text: "ROOM BANNER", life: 1, maxLife: 1 });
    Render.render(recordingContext(calls), state, {});
    const call = calls.find((entry) => entry[0] === "fillText" && entry[1] === "ROOM BANNER");
    assert.ok(call, "the banner must be drawn");
    return call[3];
  };

  const plain = bannerY(0);
  const withBoss = bannerY(Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" })
    .dungeon.boss);
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
    texts.some((text) => text.includes("牛头巨兽")),
    `the help overlay must say what ends a run: ${texts.join(" / ")}`
  );

  /* Two banners in one frame (whatever produced them) must stack, not overprint. */
  const stacked = [];
  const cleared = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  Core.goToCell(cleared, cleared.dungeon.boss);
  cleared.effects.push({ kind: "banner", text: "Boss down!", life: 1, maxLife: 1 });
  cleared.effects.push({ kind: "banner", text: STAGE.clearBanner, life: 1, maxLife: 1 });
  Render.render(recordingContext(stacked), cleared, {});
  const first = stacked.find((call) => call[0] === "fillText" && call[1] === "Boss down!")[3];
  const second = stacked.find(
    (call) => call[0] === "fillText" && call[1] === STAGE.clearBanner
  )[3];
  assert.notEqual(first, second, "stacked banners must not overprint each other");
});

test("魔狱血刹's 落 draws no sword at all", () => {
  /*
   * **The owner's eye, 2026-10-07:** 「再拍的那一下，看到一个另一把剑存在，但是参考
   * 是没有的」. Frame by frame the reference has no blade anywhere in the 落:
   * `11_魔狱血刹` #147-#156 (the plunge) is a white spiky mass and a red vortex
   * with nothing held, and #158-#185 (the wing, then the crater) has no weapon
   * either. The sword this test used to assert came from reading the plunge's
   * white mass as a blade - docs/adr/0025 补记十八 §四, retracted in 补记十九 §十六.
   *
   * Both halves have to stay empty: the swung sword is gone, and the **on-back**
   * one must not creep in behind it. The gate only clears `buffs.hellbenter` on
   * `activeFrom`, so for the first fifth of the 落 the buff is still up and
   * `drawBloodSword` would happily draw the 起手's upright sword over the plunge.
   */
  const state = Core.createState({ seed: 11 });
  const player = state.player;
  const sprites = {
    slayer: { width: 13312, height: 1936 },
    skills: { width: 32 * Core.SKILL_ORDER.length, height: 64 },
    effects: {
      width: 5760,
      height: 128 * (Core.SKILL_ORDER.length + Render.EFFECT.extraRowCount)
    },
    awakening: { width: 560, height: 296 }
  };
  const swordRows = [
    Render.EFFECT.whiteSwordRow * Render.EFFECT.cell,
    Render.EFFECT.bloodSwordRow * Render.EFFECT.cell,
    Render.EFFECT.goldSwordRow * Render.EFFECT.cell
  ];
  /* Every frame of the cast, not a sample: the plunge and the wing are the beats
   * that were wrong, and they are the first third of it. */
  for (let step = 0; step <= 60; step += 1) {
    const seconds = (Core.SKILLS.hellbenterSlam.duration * step) / 60;
    player.facing = 1;
    player.buffs.hellbenter = 0;
    player.hellbenterTier = 0;
    player.skillId = "hellbenterSlam";
    player.skillTimer = Math.max(0, Core.SKILLS.hellbenterSlam.duration - seconds);
    const calls = [];
    Render.render(recordingContext(calls), state, { sprites });
    const drawn = calls.find(
      (call) => call[0] === "drawImage" && swordRows.includes(call[3])
    );
    assert.equal(
      drawn,
      undefined,
      `no sword may be drawn at ${seconds.toFixed(2)}s into the 落`
    );
  }
  /*
   * And the 起手 still has its sword - the thing this must not have broken.
   * While the buff runs and the sword is not being formed, `drawBloodSword`
   * paints the on-back sword out of one of the three rows.
   */
  player.skillId = null;
  player.buffs.hellbenter = 30;
  player.hellbenterTier = 4;
  player.skillTimer = 0;
  const calls = [];
  Render.render(recordingContext(calls), state, { sprites });
  assert.ok(
    calls.some((call) => call[0] === "drawImage" && swordRows.includes(call[3])),
    "the 持剑期 still draws the 血气之剑"
  );
});

/*
 * ---------------------------------------------------------------------------
 * 幽暗密林's room art and the map window (`docs/adr/0028`, `docs/adr/0029`).
 *
 * Both are baked sheets with a hand-kept table in `src/render.js` - the same
 * arrangement the monsters have - so both need the same two guards: every name
 * the game can ask for exists in the table, and every rect in the table has the
 * art in the sheet at that spot.
 * ---------------------------------------------------------------------------
 */

/** The alpha box of one rect of a sheet, in the rect's own coordinates. */
function rectAlphaBox(sheet, rect) {
  const [x, y, w, h] = rect;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const alpha = sheet.pixels[((y + j) * sheet.width + (x + i)) * 4 + 3];
      if (alpha === 0) continue;
      if (i < x0) x0 = i;
      if (j < y0) y0 = j;
      if (i > x1) x1 = i;
      if (j > y1) y1 = j;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w, h };
}

function asset(name) {
  return decodeRgbaPng(path.join(__dirname, "..", "assets", name));
}

test("a hit during 魔狱血刹's 起手 does not cancel the whole state", () => {
  /*
   * `activeFrom` lands the sword half a second into a one-second 起手, so a hit
   * taken before then used to cancel the cast outright - measured `tier 0` and
   * no buff, where a hit at 0.7s left both. The 落 is 霸体 so that a grunt
   * cannot eat what the fifty seconds were for (`docs/adr/0025`); the 起手 is
   * what those fifty seconds *are*, and it is the longer of the two windows.
   */
  const state = Core.createState({ seed: 3, stage: "mirkwood" });
  const idle = {
    left: false, right: false, up: false, down: false, jump: false, attack: false, skills: {}
  };
  const press = { ...idle, skills: { hellbenter: true } };
  const hit = Math.round(0.2 / Core.DT);
  const end = Math.round(1 / Core.DT);
  for (let frame = 0; frame <= end; frame += 1) {
    Core.step(state, frame === 0 ? press : idle);
    if (frame === hit) Core.damagePlayer(state, 5, state.player.x + 40);
  }
  assert.equal(state.player.hellbenterTier, 1, "the sword has to come up through the hit");
  assert.ok(state.player.buffs.hellbenter > 0, "and the fifty seconds have to be running");
});

test("every prop a room scatters names a piece the bake produced", () => {
  const known = Object.keys(Render.SCENE.pieces);
  Object.keys(Core.STAGES).forEach((id) => {
    (Core.STAGES[id].rooms || []).forEach((room) => {
      (room.props || []).forEach((prop) => {
        assert.ok(
          known.includes(prop.piece),
          `${id} / ${room.name} scatters "${prop.piece}", which has no rect in SCENE.pieces`
        );
      });
    });
  });
  /* And the reverse: a piece nothing uses is art shipped for nothing. */
  const used = new Set();
  Object.keys(Core.STAGES).forEach((id) => {
    (Core.STAGES[id].rooms || []).forEach((room) => {
      (room.props || []).forEach((prop) => used.add(prop.piece));
    });
  });
  /*
   * **撒出来的也要算**：那批不在任何房间的 `props` 里，只在 `Core.SCATTER` 那张表上 ——
   * 漏了它，补进来的 19 件（02 套剩下那批）会被判成"烘了没人用"。
   */
  ["low", "flowers", "tall", "solid", "barrels"].forEach((group) => {
    (Core.SCATTER[group].pieces || []).forEach((piece) => used.add(piece));
  });
  /*
   * The pieces no room scatters because the renderer places them itself: the way
   * out of the room, and everything the map window is built from.
   */
  ["gate", "gateUp", "gateDown", "door", "doorUp", "doorDown",
   "gateBlock", "doorBlock", "gateLight", "gateLight2",
   "chunk_grunt0", "chunk_grunt1", "chunk_grunt2",
   "chunk_coward0", "chunk_coward1", "chunk_coward2",
   "chunk_caster0", "chunk_caster1", "chunk_caster2",
   "chunk_brute0", "chunk_brute1", "chunk_brute2",
   "chunk_elite0", "chunk_elite1", "chunk_elite2",
   "chunk_boss0", "chunk_boss1", "chunk_boss2",
   "barrel1", "barrel2", "barrel3", "barrel4", "barrel5", "barrel6",
   "barrel7", "barrel8", "barrel9", "barrel10", "barrel11", "barrel12",
   "chest1", "chest2", "tomb1", "tomb2", "tomb3", "tomb4", "tomb5", "tomb6", "tomb7",
   "boss", "marker", "blank", "tl", "top", "tr", "left", "centre", "right",
   "bl", "bottom", "br"].forEach((reserved) => used.add(reserved));
  known.filter((name) => !used.has(name)).forEach((unused) => {
    assert.ok(
      ["far", "mid", "tile0", "tile1", "tile2", "tile3"].includes(unused),
      `SCENE.pieces.${unused} is neither a layer nor scattered by any room`
    );
  });
});

test("the forest sheet holds each piece of the room art where the table says", () => {
  const sheet = asset("forest.png");
  Object.keys(Render.SCENE.pieces).forEach((name) => {
    const box = rectAlphaBox(sheet, Render.SCENE.pieces[name]);
    assert.ok(box, `SCENE.pieces.${name} points at empty pixels`);
    /*
     * The bake crops every piece to its own ink, so the box has to touch all
     * four edges of the rect - a gap means the table and the sheet have drifted.
     */
    assert.equal(box.x0, 0, `${name} has a gap on its left`);
    assert.equal(box.y0, 0, `${name} has a gap on its top`);
    assert.equal(box.x1, box.w - 1, `${name} has a gap on its right`);
    assert.equal(box.y1, box.h - 1, `${name} has a gap on its bottom`);
  });
});

test("the ground strips are the same height as each other", () => {
  /*
   * The band is drawn as one column of strips from the far edge to the bottom of
   * the screen, so strips of different heights would leave a step in the grass.
   */
  const heights = Render.SCENE.ground.map((name) => Render.SCENE.pieces[name][3]);
  heights.forEach((height) => {
    assert.ok(
      Math.abs(height - heights[0]) <= 2,
      `the ground strips are ${heights.join("/")} tall, which would show a seam`
    );
  });
});

/*
 * **启动加载屏不许画任何图。** 它的全部意义是"素材没到齐时别让玩家看见
 * 后备画法"；一旦它自己画了图，那条保证就漏了。
 */
test("加载屏只画字和进度条，不碰任何素材图", () => {
  const calls = [];
  Render.renderLoading(recordingContext(calls), { total: 10, loaded: 4, ready: false });
  assert.equal(calls.filter((call) => call[0] === "drawImage").length, 0,
    "加载屏画了图，素材没到齐时就会把老画法露出来");
  const texts = calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
  assert.ok(texts.some((text) => String(text).includes("40%")),
    `加载屏没有报进度：${texts.join(" / ")}`);
});

test("the map window sits in the corner, clear of the panels that share the top", () => {
  /*
   * 右上角是**世界窗口**的右上角，不是画布的（`docs/adr/0040`）：画布右边 120 px
   * 是黑边，HUD 一律压在游戏画面之内，录像也是这么摆的。
   */
  const right = Core.VIEW.left + Core.VIEW.width;
  const box = Render.minimapBox({});
  assert.ok(box.x + box.w <= right, "the window runs off the right edge");
  assert.equal(box.x + box.w, right - Render.MINIMAP.margin, "it is not right-aligned");
  assert.ok(box.y >= 0 && box.y + box.h < 140, "the window is not along the top");
  /* The room card moves out of its way - see drawHud. */
  const cardW = 236;
  const cardX = right - cardW - 16 - (box.w) - 12;
  assert.ok(cardX + cardW < box.x, "the room card and the map window overlap");
  /*
   * In touch mode the corner is the mute/loadout/pause buttons', so the window
   * drops below them rather than under them.
   */
  const touch = Render.minimapBox({ touch: { enabled: true } });
  assert.ok(touch.y > box.y, "touch mode has to move the window off the buttons");
  assert.ok(touch.y >= 20 + 44, "the window still overlaps the touch buttons");
});

test("the map's button is what a tap has to hit, not the window", () => {
  const box = Render.minimapBox({});
  assert.equal(Render.hitTestMinimap(box.x + box.w - 10, 8 + box.y, {}), "map",
    "the ⊘ in the title bar has to answer a tap");
  assert.equal(Render.hitTestMinimap(box.x + box.w / 2, box.y + box.h / 2, {}), null,
    "the map's own floor is not a button");
  assert.equal(Render.hitTestMinimap(10, 10, {}), null, "the player panel is not the map");
  /* In the radar form it is the disc that answers, wherever the window sits. */
  const radarMeta = { map: { mode: "radar" } };
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 + 4 };
  assert.equal(Render.hitTestMinimap(centre.x, centre.y, radarMeta), "map");
  assert.equal(Render.hitTestMinimap(centre.x + Render.MINIMAP.radarRadius + 10, centre.y,
    radarMeta), null, "a tap outside the disc is not the map");
});

test("the map draws the whole dungeon, and blanks only what is not there", () => {
  const state = Core.createState({ seed: 1, stage: "mirkwood" });
  const calls = [];
  const sheet = { width: 378, height: 122 };
  Render.render(recordingContext(calls), state, {
    sprites: { minimap: sheet },
    map: { mode: "window" }
  });
  const tiles = calls.filter((call) => call[0] === "drawImage" && call[1] === sheet);
  const grid = Render.MINIMAP.cols * Render.MINIMAP.rows;
  /* 12 格全满的地牢：格子上各画一块，外加每个未占用的格子一块空白。 */
  assert.ok(
    tiles.length >= grid,
    `only ${tiles.length} tiles were drawn for a ${grid}-cell grid`
  );
  /*
   * 每一格底下先铺一块**绿底**（客户端的图块自带那片绿，雷达形态放大时露出来的
   * 边角也得是绿的），图块压在上面。这一关 12 格全满，所以绿底一块不少。
   */
  const blanks = tiles.filter((call) => call[2] === Render.MINIMAP.pieces.blank[0] &&
                                         call[3] === Render.MINIMAP.pieces.blank[1]);
  assert.equal(blanks.length, grid, "every cell of the grid gets the blank cell first");
  assert.equal(state.dungeon.cells.length, grid, "and this dungeon uses all of them");
});

/*
 * **领主房那格的牛头从第一帧就画，不等他走进那间房**
 * （业主 2026-10-17：「右上角的地图，领主房间，应该是牛头图标」）。
 *
 * 图标本身一直是客户端那张红牛头（`MINIMAP.pieces.boss`）；这次改的是它被迷雾
 * 藏起来的问题 —— 等他走进去才画的话，这张图就只在他已经站在里面时才告诉他
 * Boss 在哪。底下的格子没去过仍是黑的，只把牛头露出来。
 */
test("地图的领主格是牛头，没去过也露出来", () => {
  const state = Core.createState({ seed: 7, stage: "mirkwood" });
  const boss = state.dungeon.cells[state.dungeon.boss];
  assert.ok(!boss.seen, "这一条要从没去过的领主房开始");

  const calls = [];
  const minimap = { width: 378, height: 122 };
  Render.render(recordingContext(calls), state, {
    sprites: { minimap },
    map: { mode: "window" }
  });

  const box = Render.minimapBox({});
  const cell = Render.MINIMAP.tile;
  const face = Render.MINIMAP.pieces.boss;
  const heads = calls.filter((call) =>
    call[0] === "drawImage" &&
    call[1] === minimap &&
    call[2] === face[0] && call[3] === face[1] &&
    Math.abs(call[6] - (box.left + boss.col * cell)) <= cell &&
    Math.abs(call[7] - (box.top + boss.row * cell)) <= cell);
  assert.ok(heads.length > 0, "领主格没有画牛头");
  assert.ok(
    heads[0][6] >= box.left + boss.col * cell &&
    heads[0][6] < box.left + (boss.col + 1) * cell,
    "牛头要落在领主那一格里"
  );
});

/*
 * **清房之后，邻接的未探索房间露一个「?」**（业主 2026-10-18）。它只在
 * "当前这间清了 + 那扇门真的通 + 那格没去过"三条同时成立时画。
 */
test("清房后邻接的未探索房间在地图上变成问号", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  const minimap = { width: 378, height: 122 };
  const box = Render.minimapBox({});
  const tile = Render.MINIMAP.tile;
  const here = state.dungeon.cells[state.cell];
  const dir = Core.MINIMAP_DIRS.find((name) => here.exits & Core.MINIMAP_STEPS[name].bit);
  assert.ok(dir, "the entry room has an exit to question");
  const next = Core.doorNeighbour(state.dungeon, here, dir);
  assert.ok(next >= 0 && next !== state.dungeon.boss);
  const nextCell = state.dungeon.cells[next];
  assert.ok(!nextCell.seen, "the neighbour starts unseen");

  const questionCalls = (sprites) => {
    const calls = [];
    Render.render(recordingContext(calls), state, {
      sprites: { minimap: sprites },
      map: { mode: "window" }
    });
    return calls.filter((call) =>
      call[0] === "drawImage" && call[1] === sprites &&
      call[2] === Render.MINIMAP.pieces.question[0] &&
      call[3] === Render.MINIMAP.pieces.question[1]);
  };

  assert.equal(questionCalls(minimap).length, 0, "没清房之前不该有问号");

  killAll(state);
  Core.step(state, {});
  assert.equal(here.cleared, true);
  const marked = questionCalls(minimap);
  assert.ok(marked.length >= 1, "清房后邻接的未探索房间要露问号");
  assert.ok(
    marked.some((call) =>
      Math.abs(call[6] - (box.left + nextCell.col * tile)) <= tile &&
      Math.abs(call[7] - (box.top + nextCell.row * tile)) <= tile),
    "问号要落在邻接那一格上"
  );
});

test("the map window's markers land in the boss's cell and in the player's", () => {
  const state = Core.createState({ seed: 7, stage: "mirkwood" });
  /* 站到地图上第四格，好让"他在哪"和"Boss 在哪"是两个地方。 */
  Core.goToCell(state, 3);
  const calls = [];
  const sheet = { width: 378, height: 122 };
  Render.render(recordingContext(calls), state, {
    sprites: { minimap: sheet },
    map: { mode: "window" }
  });
  const box = Render.minimapBox({});
  const placed = calls.filter((call) => call[0] === "drawImage" && call[1] === sheet)
    .map((call) => ({ sx: call[3], sy: call[4], dx: call[6], dy: call[7] }));
  const cell = Render.MINIMAP.tile;
  const at = (col, row) => placed.some((spot) =>
    Math.abs(spot.dx - (box.left + col * cell)) < cell &&
    Math.abs(spot.dy - (box.top + row * cell)) < cell);
  const boss = state.dungeon.cells[state.dungeon.boss];
  const here = state.dungeon.cells[state.cell];
  assert.ok(at(boss.col, boss.row), "the boss's room is not marked");
  assert.ok(at(here.col, here.row), "the room the player is in is not marked");

  /*
   * 他在 Boss 房时蓝柱子要**看不见** —— 录像里 226s 起整张图里蓝色像素归零，红牛头
   * 比蓝柱子大，后画的正好盖住它（`docs/adr/0030`）。所以顺序是量出来的，不是审美。
   */
  const marker = Render.MINIMAP.pieces.marker;
  const face = Render.MINIMAP.pieces.boss;
  Core.goToCell(state, state.dungeon.boss);
  const asBoss = [];
  Render.render(recordingContext(asBoss), state, {
    sprites: { minimap: sheet },
    map: { mode: "window" }
  });
  const ordered = asBoss.filter((call) => call[0] === "drawImage" && call[1] === sheet)
    .map((call) => call[2]);
  assert.ok(
    ordered.indexOf(face[0]) > ordered.indexOf(marker[0]),
    "the horned face has to be painted over the blue marker"
  );
});

/*
 * 镜头（`docs/adr/0035`、`docs/adr/0040`）。这一条钉的是**量出来的那个数**，不是实现：
 * 录像里他一屏高 4.0755 个身位（一屏 1080 视频像素 ÷ 他画出来的 265 像素），
 * 所以本作一屏 540 屏幕像素里装的世界高度要是 `ARENA.height / zoom`，
 * 而一个身位（美术里 84 px，`Render.SPRITE.bodyHeight`）要正好画成它的 1/4.0755。
 *
 * **横向量的是世界窗口，不是画布**：录像的游戏画面是居中的 4:3（1440×1080），
 * 一屏只装 5.434 身位，所以一屏的世界宽是 `VIEW.width / zoom` 而不是画布宽除以 zoom ——
 * 画布左右那两条黑边不算世界。
 *
 * 把这条写成断言而不是注释，是因为 zoom 是**一整条链子**量出来的数：
 * 改精灵图、改画布高度、或者顺手"调一下镜头"，都会从这里错开 —— 而错开之后
 * 画面上看不出来（它只是"没那么像录像了"），只有这个比值能立刻说出来。
 */
test("镜头拉近到录像那一档，一屏装的身位数对得上", () => {
  const figures = Core.ARENA.height / Core.CAMERA.zoom / Render.SPRITE.bodyHeight;
  assert.ok(
    Math.abs(figures - 1080 / 265) < 1e-9,
    `一屏装 ${figures.toFixed(4)} 个身位，录像里是 ${(1080 / 265).toFixed(4)}`
  );
  /* 死区那个比例也是量的：录像里屏宽的 224/1440，居中，六个房间一致。 */
  assert.equal(Core.CAMERA.deadzoneShare, 224 / 1440);
  /*
   * 拉近之后一屏只看得到 608.6 世界像素 —— 房间（960）比它宽，所以镜头才有得滚。
   * 这一条要是翻了，说明镜头已经松到一屏装得下整间房，`docs/adr/0035` 就白写了。
   */
  assert.ok(
    Math.abs(Core.windowWidth() - Core.VIEW.width / Core.CAMERA.zoom) < 1e-9,
    "窗口宽度就是世界窗口的宽除以 zoom"
  );
  /* 一屏装的身位数：`VIEW.width / zoom / bodyHeight`，录像 1440/265 = 5.434。 */
  const across = Core.VIEW.width / Core.CAMERA.zoom / Render.SPRITE.bodyHeight;
  assert.ok(
    Math.abs(across - 1440 / 265) < 1e-9,
    `一屏横向装 ${across.toFixed(4)} 个身位，录像里是 ${(1440 / 265).toFixed(4)}`
  );
  assert.ok(
    Core.windowWidth() < Core.ROOM.width,
    `一屏看得见 ${Core.windowWidth().toFixed(1)} 世界像素，房间 ${Core.ROOM.width}：镜头没得滚`
  );
});

test("镜头只在死区边上才动，到墙就停住，而且跟他 1:1", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const zoom = Core.CAMERA.zoom;
  /* 屏幕 x：世界先过窗口自己那一段偏移，才是画布上的位置（`docs/adr/0040`）。 */
  const screenX = () => Core.VIEW.left + (state.player.x - state.camera.x) * zoom;
  /* 死区的两条边在**屏幕**上量，而且是量在**世界窗口**里的。 */
  const half = (Core.VIEW.width * Core.CAMERA.deadzoneShare) / 2;
  const rightEdge = Core.VIEW.left + Core.VIEW.width / 2 + half;

  assert.equal(state.camera.x, 0, "从西门那间房开局，镜头应该贴在左边的墙上");

  let followed = 0;
  let clamped = 0;
  for (let i = 0; i < 600; i += 1) {
    Core.step(state, { right: true });
    const atWall = state.camera.x >= Core.roomWidth(state) - Core.windowWidth() - 1e-9;
    if (atWall) {
      /*
       * 镜头顶在墙上了，**这一段不该再管他**：他本来就该能一路走到屏幕边上
       * （录像里他走到 x=1211 而镜头一动不动，连续 6.8 秒）。所以这里只数帧数。
       */
      clamped += 1;
      continue;
    }
    const x = screenX();
    if (state.camera.x > 0) {
      /*
       * 越过死区之后他跟镜头是 1:1 的：他钉在带子的右边缘，镜头替他走。
       * 录像里量出来没有滞后（30fps 下一帧内就到全速），所以这里要求**每一帧**都严丝合缝，
       * 而不是"大致在一个范围内"—— 给镜头加平滑就会从这里红。
       */
      /*
       * 跑速降到 1.25 身位/秒后，一帧只走约 2.8 屏幕px；镜头仍是 1:1，
       * 但玩家可能还差小半步才贴到边缘。给 3 屏幕px 的量化余量，镜头平滑仍会红。
       */
      assert.ok(
        Math.abs(x - rightEdge) < 3,
        `跟着走的时候他应该钉在死区右边缘 ${rightEdge.toFixed(1)}，现在在 ${x.toFixed(1)}`
      );
      followed += 1;
    } else {
      assert.ok(
        x <= rightEdge + 1e-6,
        `镜头还没动，他就不该越过死区右边缘 ${rightEdge.toFixed(1)}（在 ${x.toFixed(1)}）`
      );
    }
  }

  assert.ok(followed > 30, `跟了 ${followed} 帧，太短了，没量到 1:1 那一段`);
  assert.ok(clamped > 30, `顶在墙上只有 ${clamped} 帧，没量到"他到屏幕边上去"那一段`);
  assert.ok(
    Math.abs(state.camera.x - (Core.roomWidth(state) - Core.windowWidth())) < 1e-9,
    "他跑到最右边，镜头应该正好停在右边那堵墙上"
  );
  assert.ok(
    screenX() > rightEdge + 1,
    "镜头停在墙上之后他还应该能往右走到屏幕边上 —— 录像里就是这样（他走到 x=1211 镜头不动）"
  );
});

/*
 * 当前目标与那两句战斗里的字（`docs/adr/00xx`）。量自业主的幽暗密林录像：
 * 那块条**每一只怪都会有**、换目标整块换掉、目标倒下时红叉闪 1.2 秒；
 * 而 `无法浮空` 讲的是**霸体不吃浮空** —— 这条是玩法，不只是那四个字。
 */
test("霸体挑不起来，而且落一句 无法浮空", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const enemy = Core.createEnemy(state, "grunt", 600);
  state.enemies = [enemy];

  /* 没霸体：挑得起来，一个字都不该多。 */
  Core.damageEnemy(state, enemy, 5, 0, enemy.x - 40, { launch: -430 });
  assert.ok(enemy.vy < 0, "没霸体的怪要被挑起来");
  assert.equal(
    state.effects.some((effect) => effect.kind === "hitWord"),
    false,
    "挑起来了就不该说'无法浮空'"
  );

  /* 挂着霸体：挑不起来 —— 连它的出招都不打断。 */
  enemy.vy = 0;
  enemy.onGround = true;
  enemy.attackTimer = 0.4;
  enemy.superArmor = true;
  Core.damageEnemy(state, enemy, 5, 0, enemy.x - 40, { launch: -430 });
  assert.equal(enemy.vy, 0, "霸体挑不起来");
  assert.equal(enemy.onGround, true, "霸体还站在地上");
  assert.equal(enemy.attackTimer, 0.4, "霸体的出招不能被打断");
  const word = state.effects.find((effect) => effect.kind === "hitWord");
  assert.ok(word, "挑不起来就得说 `无法浮空`");
  assert.equal(word.text, "无法浮空");
  assert.ok(word.life > 0, "那句话活得了一会儿才会消失");

  /* 伤害一分不少 —— 霸体是"不被打断"，不是"免伤"。 */
  assert.ok(enemy.hp < enemy.maxHp, "霸体照样吃伤害");

  /* 破霸体的招式不受这条约束（嗜魂之手那两处就是这么用的）。 */
  enemy.superArmor = true;
  Core.damageEnemy(state, enemy, 1, 0, enemy.x - 40, { launch: -430, ignoreSuperArmor: true });
  assert.ok(enemy.vy < 0, "ignoreSuperArmor 的招式照挑不误");
});

test("当前目标跟着他打的那只怪走，倒下之后红叉闪完才散", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  const first = Core.createEnemy(state, "grunt", 600);
  const second = Core.createEnemy(state, "coward", 700);
  state.enemies = [first, second];
  assert.equal(state.target, null, "一开局没有目标");

  Core.damageEnemy(state, first, 5, 0, 600, {});
  assert.equal(state.target.enemy, first, "打中谁，谁就是目标");

  /* 换一只打：整块换掉，而不是"两块都在"。 */
  Core.damageEnemy(state, second, 5, 0, 700, {});
  assert.equal(state.target.enemy, second, "换目标就整块换掉");

  /* 掉血那一截记成一个白块（`TARGET.ghostFade`）。 */
  const before = state.target.enemy.hp;
  Core.step(state, {});
  assert.equal(state.target.share, before / second.maxHp, "血条的读数跟着目标走");

  /* 目标倒下：那 1.2 秒里它还在（红叉就画在这段时间里），之后才散。 */
  Core.damageEnemy(state, second, 99999, 0, 700, {});
  assert.ok(second.dead, "这一下应该把它打死");
  let lived = 0;
  for (let i = 0; i < Math.ceil(Core.TARGET.deathBlink / Core.DT) + 2; i += 1) {
    if (state.target) lived += 1;
    Core.step(state, {});
  }
  assert.equal(state.target, null, "红叉闪完，那块条就该散了");
  assert.ok(
    Math.abs(lived * Core.DT - Core.TARGET.deathBlink) <= Core.DT * 2,
    `目标在倒下之后还留了 ${(lived * Core.DT).toFixed(2)} 秒，量出来是 ${Core.TARGET.deathBlink}`
  );
});

test("那只条上的名字、类别、等级都长在怪自己身上", () => {
  /* 名字只有一处：`ENEMY_TYPES`。舞台上那份副本已经删掉了（它只被一个测试读）。 */
  const paths = ["src/core.js"];
  const source = fs.readFileSync(path.join(__dirname, "..", paths[0]), "utf8");
  assert.equal(
    source.includes("bossName"),
    false,
    "Boss 的名字现在归怪自己（`ENEMY_TYPES.boss.label`），舞台上不该再有第二份"
  );
  /* 每一个兵种都要有这三样，否则那块条会画出 `undefined`。 */
  ["grunt", "coward", "brute", "caster", "charger", "elite", "boss"].forEach((type) => {
    const info = Core.monsterInfo(type);
    assert.ok(info, `${type} 没有身份`);
    assert.ok(info.label && typeof info.label === "string", `${type} 没有名字`);
    assert.ok(["人型", "野兽"].includes(info.race), `${type} 的类别是 ${info.race}`);
    assert.ok(info.level > 0, `${type} 没有等级`);
  });
  /* 录像里那块条写过的三档就是这些：杂兵 Lv4、Boss Lv7、Boss 是 野兽。 */
  assert.equal(Core.monsterInfo("grunt").label, "哥布林");
  assert.equal(Core.monsterInfo("grunt").level, 4);
  assert.equal(Core.monsterInfo("boss").label, "领主 - 牛头巨兽");
  assert.equal(Core.monsterInfo("boss").race, "野兽");
  assert.equal(Core.monsterInfo("boss").level, 7);
});

test("那两句战斗里的字，照量出来的样子画", () => {
  /*
   * 这一条用自己的一层录制壳，因为要看**赋值**（字体、颜色），而共用的那个
   * `recordingContext` 只记方法调用。量出来的样子是：伤害数字粗斜体、纯黄、
   * 到点不淡出；命中状态词冷白、钉在怪身上；那块条上写的是类别牌 + `Lv{n} 名字`。
   */
  const calls = [];
  const ctx = new Proxy(
    {
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} })
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = (...args) => calls.push([prop, ...args]);
        return target[prop];
      },
      set(target, prop, value) {
        calls.push(["set:" + String(prop), value]);
        target[prop] = value;
        return true;
      }
    }
  );

  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", 600);
  enemy.hp = enemy.maxHp / 2;
  state.enemies = [enemy];
  state.target = { enemy: enemy, dying: 0, share: 0.5, ghost: { from: 1, to: 0.5, t: 0 } };
  state.effects.push({ kind: "damage", text: "16", x: enemy.x, y: 400, life: 0.6, maxLife: 0.6 });
  state.effects.push({
    kind: "hitWord", text: "无法浮空", x: enemy.x + 10, y: 410, life: 0.6, maxLife: 0.6
  });

  Render.render(ctx, state, {});

  const texts = calls.filter((c) => c[0] === "fillText").map((c) => String(c[1]));
  assert.ok(texts.includes("16"), "伤害数字要画出来");
  assert.ok(texts.includes("无法浮空"), "命中状态词要画出来");
  assert.ok(texts.includes("人型"), "那块条上要有类别牌");
  assert.ok(
    texts.some((text) => text.startsWith("Lv" + Core.monsterInfo("grunt").level + " ")),
    `那块条上要有 \`Lv{n} 名字\`：${texts.join(" / ")}`
  );

  const fonts = calls.filter((c) => String(c[0]).startsWith("set:font")).map((c) => String(c[1]));
  assert.ok(fonts.some((font) => font.includes("italic")), "伤害数字是粗斜体（量到向右斜 10–22°）");
  const fills = calls.filter((c) => c[0] === "set:fillStyle").map((c) => String(c[1]));
  assert.ok(fills.includes("#ffff00"), "伤害数字是纯黄 #FFFF00");
  assert.ok(fills.includes("#dc0000"), "血条是饱和红");
  assert.ok(fills.includes("#f8ece5"), "掉血那一截是惨白的白块");

  /*
   * **顶部正中那条 420×34 的 Boss 横条已经删掉**（录像里没有它）。
   * 它原来画在正中间，所以只要没有再往居中位置画那块面板，就算删干净了。
   */
  const panels = calls.filter((call) => call[0] === "fillRect" && call[2] === 84);
  assert.equal(panels.length, 0, "正中间那条 Boss 横条不该还在");
});

/*
 * **高草按身位排**（业主 2026-10-12 照录像定的，Q12 选 c）：录像里那一丛高草
 * 画在他裤腿**前面**。它**挡画不挡路** —— 不占身位、不进判定，只是排队的时候
 * 跟立着的东西走同一个队（`SCENE.decals` 里已经没有它了）。
 *
 * 这一条同时守住了另一半：**同一丛草，靠里的那次必须画在他之前**。只测"草能盖住人"
 * 是不够的 —— 把草整个挪到人后面（或者干脆从队里拿掉）都会让前半句通过。
 */
test("高草按身位排：靠镜头的那一丛画在他前面，靠里的画在他后面", () => {
  const SL = { width: 1, height: 1 };
  const FO = { width: 1, height: 1 };
  const MO = { width: 1, height: 1 };
  const sprites = { slayer: SL, forest: FO, monsters: MO };

  const order = (grassZ) => {
    const calls = [];
    const state = lastRoomState();
    state.enemies = [];
    state.props = [{ piece: "grass", x: 480, z: grassZ }];
    state.player.x = 480;
    state.player.z = 200;
    Render.render(recordingContext(calls), state, { sprites: sprites });
    /*
     * 草和背景铺的是**同一张图集**（`sprites.forest`），所以不能按图集找它 ——
     * 那找到的是背景那几条。按它自己的那块源矩形找（`SCENE.pieces.grass`）。
     */
    const grass = Render.SCENE.pieces.grass;
    const draws = calls.filter((call) => call[0] === "drawImage");
    return {
      player: draws.map((call) => call[1]).indexOf(SL),
      /* 连宽高一起比：玩家的第 0 帧也从 (0, 0) 取，只比左上角会认错人。 */
      grass: draws.findIndex(
        (call) => call[2] === grass[0] && call[3] === grass[1] &&
          call[4] === grass[2] && call[5] === grass[3]
      )
    };
  };

  const near = order(0);
  const far = order(430);
  assert.ok(near.player >= 0 && near.grass >= 0, "人和草都得画出来");
  assert.ok(
    near.grass > near.player,
    `靠镜头的草要画在他之后（压在他腿前面）：人 ${near.player} → 草 ${near.grass}`
  );
  assert.ok(
    far.grass < far.player,
    `靠里的草要画在他之前（被他挡住）：草 ${far.grass} → 人 ${far.player}`
  );

  /* 矮的那几档还是贴花：它们永远铺在最底下，跟身位无关。 */
  ["grassFlower", "sprout", "flower", "bush"].forEach((piece) => {
    assert.ok(Render.SCENE.decals.includes(piece), `${piece} 该留在贴花那一档`);
  });
  assert.equal(Render.SCENE.decals.includes("grass"), false, "高草不该再算贴花");
});

/*
 * **一间房里的怪是"分组"聚着的。** 量自业主的幽暗密林录像：同时在场 **2–4 只**、
 * 相邻两只见的**中位是 0.70 身位**（59 世界像素）、一群展开的**中位是 1.32 身位**；
 * 而他在一间房里待 17–45 秒，一路上遇到的是**几组**（那一群不围着他转，
 * 有的在他身前、有的在他身后 —— 那是多组散布在房间里的读法）。
 *
 * 所以这条禁掉的是**"一字排开"那个间距**：相邻两只见要么是**同一组**（贴着，约 0.7 身位），
 * 要么**换了一组**（隔开至少两个身位）。原来那个 `x 620/790/880` 正好落在中间，
 * 两头都不是 —— 业主说的「怪物少」有一半是这个。
 *
 * 体宽大的（牛头 68 宽）同组间距按体宽让开，所以门槛跟着体型走。
 */
test("一间房里的怪是分组聚着的，不是一字排开", () => {
  const FIGURE = 84;
  Core.STAGES.mirkwood.rooms.forEach((room) => {
    /*
     * **Two waves, two checks.** A wave is what is on the floor together, so
     * each wave has to satisfy the group spacing on its own; a wave-2 monster
     * standing apart from wave 1 is the point of a wave (`docs/adr/0037`
     * 追记三). Sort by x first: the roster array is authored by role, not by
     * position, and only the sorted neighbours are actually neighbours.
     */
    [1, 2].forEach((wave) => {
      const entries = room.enemies
        .filter((entry) => (entry.wave || 1) === wave)
        .slice()
        .sort((a, b) => a.x - b.x);
      const info = entries.map((entry) => Core.monsterInfo(entry.type));
      for (let i = 1; i < entries.length; i += 1) {
        const gap = entries[i].x - entries[i - 1].x;
        const wide = Math.max(info[i].width, info[i - 1].width) - 33;
        const within = FIGURE + Math.max(0, wide);
        assert.ok(
          gap <= within || gap >= 2 * FIGURE,
          `${room.name} 第 ${wave} 波第 ${i} 与第 ${i + 1} 只相距 ${gap} 像素：` +
            `同组该 ≤ ${within}、换组该 ≥ ${2 * FIGURE} —— 卡在中间就是"一字排开"`
        );
      }
    });
  });
});

/*
 * **远景钉在屏幕上，不跟着房间滚。**
 *
 * 量自录像：画面上方那片远墙与远树干**整场一像素都不动**，跟着镜头动的只有它下面
 * 那一层。所以这条两头发力：镜头挪过之后 **`far` 落在屏幕上的位置必须一模一样**，
 * 而 **`mid` 必须挪** —— 只测前半句的话，把整个世界都钉住也会通过。
 *
 * 这里**必须把变换算进去**：镜头是 `ctx.translate` 干的，`drawImage` 的参数里看不见它。
 * 只比参数的话，far 与 mid 在两个镜头下的参数**完全一样**，这条测试会假绿。
 * 所以下面跟着一小层画布变换（只认 save/restore/translate/scale/setTransform）。
 */
function drawScreenXs(cameraX) {
  const draws = [];
  const stack = [];
  let m = [1, 0, 0, 1, 0, 0];
  /* m = m · n（canvas 的约定：(x,y) → (a·x + c·y + e, b·x + d·y + f)） */
  const mul = (n) => {
    const [a, b, c, d, e, f] = m;
    m = [
      a * n[0] + b * n[2], a * n[1] + b * n[3],
      c * n[0] + d * n[2], c * n[1] + d * n[3],
      e * n[0] + f * n[2] + n[4], e * n[1] + f * n[3] + n[5]
    ];
  };
  const handlers = {
    save: () => stack.push(m.slice()),
    restore: () => { m = stack.pop() || [1, 0, 0, 1, 0, 0]; },
    translate: (x, y) => mul([1, 0, 0, 1, x, y]),
    scale: (x, y) => mul([x, 0, 0, y, 0, 0]),
    setTransform: (a, b, c, d, e, f) => { m = [a, b, c, d, e, f]; },
    drawImage: function (sheet, sx, sy, sw, sh, dx, dy) {
      draws.push({ rect: [sx, sy, sw, sh], screenX: m[0] * dx + m[2] * dy + m[4] });
    }
  };
  const base = {
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  };
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (handlers[prop]) return handlers[prop];
      target[prop] = () => {};
      return target[prop];
    }
  });

  const state = lastRoomState();
  state.enemies = [];
  state.props = [];
  state.camera.x = cameraX;
  const sheet = { width: 1, height: 1 };
  Render.render(ctx, state, { sprites: { slayer: sheet, forest: sheet, monsters: sheet } });

  /*
   * **要连宽高一起比。** `far` 那块是 `[0, 0, 640, 375]`，而玩家精灵的第 0 帧也从
   * `(0, 0)` 取 —— 只比 `(sx, sy)` 会把他匹配进来，于是"远景动了"是假的。
   */
  const at = (rect) =>
    draws
      .filter((d) => d.rect.every((v, i) => v === rect[i]))
      .map((d) => Math.round(d.screenX));
  return { far: at(Render.SCENE.pieces.far), mid: at(Render.SCENE.pieces.mid) };
}

test("镜头挪了，远景不动、中景跟着动", () => {
  const still = drawScreenXs(0);
  const shifted = drawScreenXs(300);
  assert.ok(still.far.length > 0, "远景要真的画出来");
  assert.ok(still.mid.length > 0, "中景要真的画出来");
  assert.deepEqual(
    shifted.far,
    still.far,
    `远景不该跟着镜头动：${JSON.stringify(still.far)} → ${JSON.stringify(shifted.far)}`
  );
  assert.notDeepEqual(
    shifted.mid,
    still.mid,
    "中景必须跟着镜头动，否则整幅背景都钉死了"
  );
});

/*
 * **每间房都要摆到录像那个密度。** 量出来录像一间房 **50–90 件**、走位带上
 * **75–95% 有东西**；本作原来是 **4–8 件**、不到一成（业主说的「场景素材少」）。
 * 缺的那批按种子撒（`Core.SCATTER`），这条守住"撒够了"。
 */
test("每间房都摆到录像那个密度", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  state.dungeon.cells.forEach((cell, index) => {
    Core.goToCell(state, index);
    assert.ok(
      state.props.length >= 55 && state.props.length <= 90,
      `${state.room.name} 摆了 ${state.props.length} 件，录像里一间房是 50–90 件`
    );
    /* 撒出来的全是**不挡人**的那几档；立着的实心件仍然是人手写的（`docs/adr/0032`）。 */
    const soft = state.props.filter((prop) => !prop.solid).length;
    assert.ok(soft >= 50, `${state.room.name} 只有 ${soft} 件不挡人的布景，撒得太少`);
  });
});

/*
 * 步速（`docs/adr/0039`）。整档速度是**量的**，不是调的：录像里他一秒走
 * **1.25 个身位**（330 视频px/s，镜头自己的滚动量已经扣掉），哥布林一秒走
 * **0.62–0.77**。这一条把这两段读数钉在代码里 —— 动 `PHYSICS.moveSpeed` 或
 * `ENEMY_TYPES.grunt.speed` 而不重新去录像里量，就会从这里红。
 *
 * 单位是**身位**（美术里他画出来多高，`Render.SPRITE.bodyHeight` = 84），
 * 不是格 —— 格是量判定用的另一个单位（`CONTEXT.md`「单位与量法」）。
 */
test("全场步速是录像那一档：他一秒走 1.25 个身位", () => {
  const heights = Core.PHYSICS.moveSpeed / Render.SPRITE.bodyHeight;
  assert.ok(
    Math.abs(heights - 1.25) < 0.02,
    `他一秒走 ${heights.toFixed(3)} 个身位，录像里是 1.25`
  );
  /*
   * 哥布林那一档是**同一个比例**压出来的，落点正好在录像那段 0.62–0.77 里：
   * 录像只量得到他和哥布林两样在走路的东西，其余每一档按同一比例走。
   */
  const goblin = Core.ENEMY_TYPES.grunt.speed / Render.SPRITE.bodyHeight;
  assert.ok(
    goblin > 0.62 && goblin < 0.77,
    `哥布林一秒走 ${goblin.toFixed(3)} 个身位，录像里是 0.62–0.77`
  );
  /*
   * 过一间房：本作 960 ÷ 105 = 9.14 秒；录像最小那间 11.4 身位 ÷ 1.25 = 9.12 秒。
   * 房间宽度两边本来就一样（`docs/adr/0035`），所以这一个数两边也该一样。
   */
  const across = Core.ROOM.width / Core.PHYSICS.moveSpeed;
  assert.ok(across > 8.9 && across < 9.3, `过一间房要 ${across.toFixed(2)} 秒，录像里是 9.12`);
});

/*
 * **挥空也是一次出手。** 这一条钉的是 `advanceEnemyAttack` 里那个坑：
 * 每一种招都在自己收招那一下给冷却，只有**普攻打空**没给 —— 于是 `attackCooldown`
 * 留在 0，而 `chooseEnemyAction` 在出招期间根本不跑，怪就在原地一记一记地挥空，
 * `vz` 每帧被砍一半：往屏幕里走得只剩自己的一小截，站远一档就等于把它钉在地上。
 */
test("挥空的怪也要吃冷却，不然它会一直挥空、再也走不过来", () => {
  const state = sealedRoomState(Core.DEFAULT_SEED, plainRoomIndex());
  const grunt = Core.createEnemy(state, "grunt", state.player.x + 40);
  state.enemies = [grunt];
  /* 把他挪到怪够不着的那一档深度：x 上贴身，深度上够不着 —— 那个怪必打空。 */
  state.player.z = 300;

  let swung = false;
  for (let i = 0; i < 240 && !swung; i += 1) {
    Core.step(state, {});
    if (grunt.attackTimer > 0) swung = true;
  }
  assert.ok(swung, "怪应该会出手，但是 240 帧里一次都没挥");

  while (grunt.attackTimer > 0) Core.step(state, {});
  const row = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
  assert.ok(
    Math.abs(state.player.z - grunt.z) > row,
    "这一下必须是打空的，否则这条测的不是挥空"
  );
  assert.ok(grunt.attackCooldown > 0, "挥空之后冷却还是 0 —— 它会一记接一记地挥下去");

  /* 冷却走完之后它得带着深度速度重新上路，而不是永远钉在原地。 */
  Core.runFrames(state, 180, {});
  const gap = Math.abs(state.player.z - grunt.z);
  assert.ok(gap <= row + 1, `三秒之后它应该走到他那一档上，还差 ${gap.toFixed(1)}`);
});

/*
 * **每间房不是一副样子**（`docs/adr/0047`）。录像里六间房量出来差别最大的那一档是
 * 高草：Boss 房**一屏 0–2 丛**，别的房间 0–5 —— 那一间的草地上几乎是空的。
 * 这一条钉的是"按房间改写撒景件数"这条路真的通了（改的是 `SCATTER` 的默认值，
 * 那一间在自己的 `scatter` 里盖掉）。
 */
test("Boss 房的高草几乎为零，别的房间仍是那一档", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  Core.goToCell(state, state.dungeon.boss);
  const tall = state.props.filter((prop) => prop.piece === "grass").length;
  assert.ok(tall <= 2, `Boss 房摆了 ${tall} 丛高草，录像里是 0–2`);

  Core.goToCell(state, state.dungeon.entry);
  const other = state.props.filter((prop) => prop.piece === "grass").length;
  assert.ok(other >= 6, `普通房只摆了 ${other} 丛高草，撒得太少`);
  /* 布景总数那一档没被这条改坏（录像一间房 50–90 件）。 */
  assert.ok(state.props.length >= 55 && state.props.length <= 90);
});

/*
 * **地图窗口画的是"他探过哪儿"，没去过的是黑的**（业主 2026-10-15 实玩）。
 *
 * 这一条推翻了 `docs/adr/0030` 里那句「整张图从第一帧就 12 格画满、包括他从没进去过的
 * 那四格」—— 那是误读：客户端 `act1.img` 里本来就有一整族"已经去过"的亮图块，
 * 我们只烘了暗的那一族，于是把**没去过**看成了画满。
 */
test("地图上的迷雾：探过的格子记着，没去过的不算探过", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, stage: "mirkwood" });
  const seenCount = () => state.dungeon.cells.filter((cell) => cell.seen).length;

  assert.equal(seenCount(), 1, "开局只有他站着的那一格是探过的");
  assert.equal(state.dungeon.cells[state.cell].seen, true, "而且就是他那一格");

  /* 走开一格：两格都探过了。 */
  const first = state.cell;
  const other = (first + 1) % state.dungeon.cells.length;
  Core.goToCell(state, other);
  assert.equal(seenCount(), 2, "走过的那一格也该记上");
  assert.equal(state.dungeon.cells[other].seen, true);

  /* 回去：还是探过的，不会"忘掉"。 */
  Core.goToCell(state, first);
  assert.equal(seenCount(), 2);
  assert.equal(state.dungeon.cells[first].seen, true);

  /* Boss 那格没去过之前不算探过 —— 红脸也是靠这一条才能等到去过才画。 */
  assert.ok(!state.dungeon.cells[state.dungeon.boss].seen, "没进过 Boss 房就不该算探过");
});

/*
 * **声音事件**（`docs/adr/0058`）：核心只排队，`main.js` 才播放。这条钉的是
 * "每一种玩家 / 怪物事件都真的排上了" —— 浏览器证明只能看出"有声音放出去过"，
 * 分不出是玩家还是怪物。
 */
test("Core queues client-sound events for the player and the monsters", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.drainSounds(state);

  /* 普攻与技能起手各一条。 */
  Core.step(state, { attack: true });
  let events = Core.drainSounds(state);
  assert.ok(
    events.some((event) => event.kind === "playerAttack"),
    "a normal swing should queue a playerAttack voice"
  );
  /* 技能要在他没出招的时候按 —— 用一局新的，免得被上一刀的硬直挡住。 */
  const skillState = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.drainSounds(skillState);
  Core.step(skillState, { skills: { upSlash: true } });
  events = Core.drainSounds(skillState);
  assert.ok(
    events.some((event) => event.kind === "playerSkill" && event.skillId === "upSlash"),
    "a skill cast should queue its own voice"
  );

  /* 受伤与死亡。 */
  Core.damagePlayer(state, 5, state.player.x + 10);
  events = Core.drainSounds(state);
  assert.ok(
    events.some((event) => event.kind === "playerHurt"),
    "taking a hit should queue a hurt voice"
  );
  state.player.hp = 1;
  state.player.invuln = 0;
  Core.damagePlayer(state, 99, state.player.x + 10);
  events = Core.drainSounds(state);
  assert.ok(
    events.some((event) => event.kind === "playerDie"),
    "dying should queue the death voice"
  );

  /* 怪物：受击、死亡、出招、脚步。 */
  const monsterState = Core.createState({ seed: Core.DEFAULT_SEED });
  Core.goToCell(monsterState, 0);
  Core.drainSounds(monsterState);
  const enemy = monsterState.enemies[0];
  enemy.evasion = 0;
  Core.damageEnemy(monsterState, enemy, 1, 0, monsterState.player.x);
  events = Core.drainSounds(monsterState);
  assert.ok(
    events.some((event) => event.kind === "enemyHurt" && event.id === enemy.id),
    "a wounded monster should queue its hurt voice"
  );
  Core.damageEnemy(monsterState, enemy, 99999, 0, monsterState.player.x);
  events = Core.drainSounds(monsterState);
  assert.ok(
    events.some((event) => event.kind === "enemyDie" && event.id === enemy.id),
    "a dying monster should queue its death voice"
  );

  /*
   * 把玩家放到它面前、不动手，等它出招；一条一条地 drain，免得队列封顶把
   * 那一条挤掉。
   */
  monsterState.player.x = enemy.x - 30;
  monsterState.player.z = enemy.z;
  let sawAttack = false;
  let sawStep = false;
  for (let frame = 0; frame < 240 && !(sawAttack && sawStep); frame += 1) {
    Core.step(monsterState, {});
    events = Core.drainSounds(monsterState);
    events.forEach((event) => {
      if (event.kind === "enemyAttack") sawAttack = true;
      if (event.kind === "enemyStep") sawStep = true;
    });
  }
  assert.ok(sawAttack, "a monster in reach should queue its attack voice");
  assert.ok(sawStep, "a walking monster should queue footsteps");
});

/*
 * 幽暗密林深处（2026-10-21）：4x4 的 15 格、猫妖族与暗咒猫妖。
 * 这些测试钉的是**这一关自己的数据**，不是 mirkwood 的回归。
 */
test("the deep dungeon is the recording's 5x4 grid with two holes", () => {
  const stage = Core.STAGES.mirkwooddeep;
  const dun = stage.dungeon;
  assert.equal(dun.cols, 5);
  assert.equal(dun.rows, 4);
  assert.deepEqual(dun.shape, ["RCCCR", ".CRCR", "RCRC.", "RCCCR"]);
  assert.deepEqual(dun.entry, [0, 3]);
  assert.deepEqual(dun.boss, [4, 1]);

  const state = Core.createState({ stage: "mirkwooddeep", seed: 1 });
  assert.equal(state.dungeon.cells.length, 18, "the two holes are not cells");
  assert.equal(
    state.dungeon.cells.filter((cell) => cell.kind === "room").length,
    8,
    "eight room cells"
  );
  assert.equal(
    state.dungeon.cells.filter((cell) => cell.kind === "corr").length,
    10,
    "ten corridor cells"
  );
  assert.ok(
    !state.dungeon.cells.some((cell) => cell.col === 0 && cell.row === 1),
    "the recording's first black cell stays a hole"
  );
  assert.ok(
    !state.dungeon.cells.some((cell) => cell.col === 4 && cell.row === 2),
    "the recording's second black cell stays a hole"
  );
  assert.equal(state.dungeon.cells[state.dungeon.entry].col, 0);
  assert.equal(state.dungeon.cells[state.dungeon.entry].row, 3);
  assert.equal(state.dungeon.cells[state.dungeon.boss].col, 4);
  assert.equal(state.dungeon.cells[state.dungeon.boss].row, 1);
  assert.equal(
    state.dungeon.cells[state.dungeon.boss].room,
    stage.bossIndex,
    "the boss cell is pinned to the boss room spec"
  );
  assert.equal(
    state.dungeon.cells[state.dungeon.entry].room,
    stage.dungeon.entryRoom,
    "the entry cell is pinned to the entry spec"
  );
  state.dungeon.cells.forEach((cell) => {
    assert.ok(state.stage.rooms[cell.room], `cell ${cell.col},${cell.row} has a room spec`);
  });
  assert.equal(stage.rooms.filter((room) => room.kind === "corr").length, 10);
  assert.equal(stage.rooms.filter((room) => room.kind !== "corr").length, 8);
});

test("the deep stage names its new monsters the way the recording does", () => {
  const cat = Core.monsterInfo("cat");
  const thrower = Core.monsterInfo("throwerElite");
  const boss = Core.monsterInfo("lugaruBoss");
  assert.equal(cat.label, "猫妖");
  assert.equal(cat.race, "野兽");
  assert.equal(cat.level, 6);
  assert.equal(thrower.label, "投掷十夫长");
  assert.equal(thrower.race, "人型");
  assert.equal(boss.label, "领主 - 暗咒猫妖");
  assert.equal(boss.race, "野兽");
  assert.equal(boss.level, 9);
  assert.equal(boss.behavior, "boss");

  const state = Core.createState({ stage: "mirkwooddeep", seed: 1 });
  const entrySpec = Core.STAGES.mirkwooddeep.rooms[0];
  assert.ok(
    entrySpec.enemies.some((enemy) => enemy.type === "goblinRed"),
    "the entry room fields the recording's red goblins"
  );
  assert.ok(
    entrySpec.enemies.some((enemy) => enemy.type === "goblinBlue"),
    "and its blue goblins"
  );
  const chestRoom = state.stage.rooms.findIndex((room) => room.name === "宝箱浅沟");
  const chestCell = state.dungeon.cells.findIndex((cell) => cell.room === chestRoom);
  Core.goToCell(state, chestCell);
  assert.ok(
    state.enemies.some((enemy) => enemy.type === "cat" && enemy.level === 6),
    "the chest room fields a Lv6 cat"
  );
  assert.ok(
    state.enemies.some((enemy) => enemy.type === "throwerElite" && enemy.level === 6),
    "and a Lv6 throwing ten-captain"
  );
  const bossEnemy = Core.createEnemy(state, "lugaruBoss", 500);
  const catEnemy = Core.createEnemy(state, "cat", 500);
  assert.equal(Core.isBossEnemy(bossEnemy), true);
  assert.equal(Core.isBossEnemy(catEnemy), false);
});

test("the deep boss has no phase two and dies into victory", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 3 });
  Core.goToCell(state, state.dungeon.boss);
  const boss = state.enemies.find((enemy) => Core.isBossEnemy(enemy));
  assert.ok(boss, "the boss cell fields the cat king");
  /* The room's own name banner is not the boss's phase banner; clear the queue. */
  state.effects = [];

  /* 领主有 10% 回避：单次大伤害可能被闪掉，和 `killAll` 一样重复到为止。 */
  for (let hit = 0; hit < 50 && boss.hp > boss.maxHp * 0.45; hit += 1) {
    Core.damageEnemy(state, boss, Math.ceil(boss.maxHp * 0.52), 0, state.player.x);
  }
  assert.equal(boss.phase, 1, "the recording has one health bar, not a phase two");
  assert.equal(
    state.effects.filter((effect) => effect.kind === "banner").length,
    0,
    "the stage's bossBanner is empty on purpose: no words"
  );
  assert.equal(
    state.effects.some((effect) => effect.kind === "shockwave" && effect.gold),
    false,
    "there is no phase-two gold ring"
  );

  for (let hit = 0; hit < 50 && !boss.dead; hit += 1) {
    Core.damageEnemy(state, boss, 99999, 0, state.player.x);
  }
  Core.runFrames(state, 300, {});
  assert.equal(state.victory, true, "killing the cat king clears the stage");
  assert.ok(state.finishedAt > 0);
});

test("a chest pays one cyan item and gold; a tomb pays gold alone", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 1 });
  const chestRoom = state.stage.rooms.findIndex((room) => room.name === "猫妖岔路");
  const chestCell = state.dungeon.cells.findIndex((cell) => cell.room === chestRoom);
  Core.goToCell(state, chestCell);
  clearRoom(state);
  /* The cleared room leaves the monsters' plates on the floor; this test is about
     the chest's own drop, so start from an empty pickup list. */
  state.pickups = [];
  const chest = state.props.find((prop) => prop.piece === "chest");
  assert.ok(chest, "the chest room has a chest");
  smashBarrel(state, chest);
  assert.equal(chest.broken, true);
  const chestDrop = state.pickups.find((drop) => drop.kind === "loot");
  assert.ok(chestDrop, "the chest leaves a loot plate");
  assert.equal(chestDrop.exp, 0, "breakables do not grant experience");
  assert.equal(chestDrop.tone, "cyan");
  assert.ok(chestDrop.gold >= 60 && chestDrop.gold <= 120, `chest gold ${chestDrop.gold}`);

  const beforeLoot = state.stats.loot;
  state.log = [];
  state.player.x = chestDrop.x;
  state.player.z = chestDrop.z;
  Core.runFrames(state, 4, {});
  assert.equal(state.stats.loot, beforeLoot + 1, "walking over the plate collects it");
  assert.ok(
    state.log.some((line) => line.text.includes(chestDrop.name)),
    "the item's name is logged"
  );
  assert.ok(
    !state.log.some((line) => line.text.includes("0点经验值")),
    "no zero-experience line"
  );

  const roomAt = state.stage.rooms.findIndex((room) => room.name === "石碑夹道");
  const cellAt = state.dungeon.cells.findIndex((cell) => cell.room === roomAt);
  Core.goToCell(state, cellAt);
  clearRoom(state);
  state.pickups = [];
  const tomb = state.props.find((prop) => prop.piece === "tomb");
  assert.ok(tomb, "the stone-tablet corridor has a tomb");
  smashBarrel(state, tomb);
  assert.equal(tomb.broken, true);
  const goldDrop = state.pickups.find((drop) => drop.kind === "gold");
  assert.ok(goldDrop, "the tomb leaves gold only");
  assert.ok(goldDrop.gold >= 20 && goldDrop.gold <= 50, `tomb gold ${goldDrop.gold}`);

  state.log = [];
  state.player.x = goldDrop.x;
  state.player.z = goldDrop.z;
  const before = state.stats.gold;
  Core.runFrames(state, 4, {});
  assert.equal(state.stats.gold, before + goldDrop.gold);
  assert.ok(
    !state.log.some((line) => line.text.includes("[金币]")),
    "gold-only loot never prints an item line"
  );
});

test("the map window's height follows the dungeon's rows, not a fixed 4x3", () => {
  const three = Render.minimapBox({ map: { cols: 4, rows: 3 } });
  const four = Render.minimapBox({ map: { cols: 4, rows: 4 } });
  assert.equal(four.w, three.w, "both grids are four columns wide");
  assert.ok(four.h > three.h, "a 4x4 dungeon needs the fourth row");
  assert.equal(four.left, three.left, "the grid starts at the same x");
});

test("the deep stage uses the recording's blue ten-captain and the larger cats", () => {
  const info = Core.monsterInfo("deepElite");
  assert.equal(info.label, "十夫长");
  assert.equal(info.race, "人型");
  assert.equal(info.behavior, "elite");
  assert.equal(Core.ENEMY_TYPES.cat.height >= 50, true, "the cat is the recording's larger quadruped");
  assert.equal(
    Core.ENEMY_TYPES.lugaruBoss.height <= 31,
    true,
    "the boss is a low quadruped: 0.31-0.37 body, not the old 88x68"
  );
  assert.equal(Core.ENEMY_TYPES.lugaruBoss.width >= 66, true);
  assert.notEqual(
    Core.ENEMY_TYPES.deepElite.label,
    undefined,
    "the deep ten-captain has its own type"
  );
  const state = Core.createState({ stage: "mirkwooddeep", seed: 3 });
  Core.goToCell(state, state.dungeon.boss);
  assert.ok(
    state.enemies.some((enemy) => enemy.type === "deepElite" && enemy.level === 7),
    "the boss room fields the Lv7 deep ten-captain"
  );
  /* The four-way corridor cell needs a tile; without it the map draws nothing. */
  assert.notEqual(Render.MINIMAP.tiles["corr:NESW"], undefined);
});

test("the deep route is pinned for every seed and the side nine shuffle", () => {
  const route = {
    "0,3": 0,
    "1,3": 10,
    "2,3": 8,
    "2,2": 12,
    "2,1": 9,
    "2,0": 13,
    "3,0": 5,
    "3,1": 6,
    "4,1": 1
  };
  const side = [2, 3, 4, 7, 11, 14, 15, 16, 17].sort((a, b) => a - b);
  [1, 7, 42, 20260915].forEach((seed) => {
    const state = Core.createState({ stage: "mirkwooddeep", seed });
    Object.keys(route).forEach((key) => {
      const col = Number(key.split(",")[0]);
      const row = Number(key.split(",")[1]);
      const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
      assert.ok(cell, `${key} exists`);
      assert.equal(cell.room, route[key], `seed ${seed}: ${key} is pinned`);
    });
    const sideCells = state.dungeon.cells
      .filter((cell) => Object.keys(route).every((key) => key !== `${cell.col},${cell.row}`))
      .map((cell) => cell.room)
      .sort((a, b) => a - b);
    assert.deepEqual(sideCells, side, `seed ${seed}: only the side nine remain`);
  });
});

test("the measured room widths and band are on the deep route", () => {
  const widths = {
    /*
     * 41 房 **560**（不是下界 456，2026-10-27）：22s 帧房里还有活着的青哥布林，
     * 东门却已经画在右墙上 —— 反推房间至少 543 世界px（`docs/adr/0063`）。
     */
    "0,3": 560,
    "1,3": 520,
    "2,3": 684,
    "2,2": 734,
    "2,1": 885,
    "2,0": 524,
    "3,0": 529,
    "3,1": 588,
    "4,1": 538
  };
  const state = Core.createState({ stage: "mirkwooddeep", seed: 7 });
  Object.keys(widths).forEach((key) => {
    const col = Number(key.split(",")[0]);
    const row = Number(key.split(",")[1]);
    const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
    Core.goToCell(state, state.dungeon.cells.indexOf(cell));
    assert.equal(state.room.width, widths[key], `${key} room width`);
    assert.equal(state.band.backY, 375, `${key} walkable band`);
    assert.equal(state.band.visualBackY, 320, `${key} visible ground top`);
    /*
     * 上/下门同轴只在这一关开（`doorX`）。这条守着"开关真的传到 `state.dungeon`"——
     * 2026-10-27 就漏过一次：`dungeonFor` 只抄了 `northX`，`southSharesNorthX`
     * 没带出来，于是 S 门还留在中心线，门测试当场红。
     */
    assert.equal(state.dungeon.southSharesNorthX, true, `${key}: 上/下门同轴开关传到了`);
  });
});

test("the route only scatters ground cover; the side eight keep the full scatter", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 7 });
  const route = ["0,3", "1,3", "2,3", "2,2", "2,1", "2,0", "3,0", "3,1", "4,1"];
  route.forEach((key) => {
    const col = Number(key.split(",")[0]);
    const row = Number(key.split(",")[1]);
    const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
    Core.goToCell(state, state.dungeon.cells.indexOf(cell));
    const scatteredSolid = state.props.filter(
      (prop) => prop.scattered && prop.solid
    );
    const scatteredBarrels = state.props.filter(
      (prop) => prop.scattered && prop.piece === "barrel"
    );
    assert.equal(scatteredSolid.length, 0, `${key}: no scattered solid props`);
    assert.equal(scatteredBarrels.length, 0, `${key}: no scattered barrels`);
  });

  const sideKey = ["0,2", "1,1", "3,2"];
  sideKey.forEach((key) => {
    const col = Number(key.split(",")[0]);
    const row = Number(key.split(",")[1]);
    const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
    Core.goToCell(state, state.dungeon.cells.indexOf(cell));
    assert.ok(
      state.props.some((prop) => prop.scattered && prop.solid),
      `${key}: the side corridors still get the full scatter`
    );
  });
});

test("the deep route keeps its measured props where the recording puts them", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 7 });
  const route = ["0,3", "1,3", "2,3", "2,2", "2,1", "2,0", "3,0", "3,1", "4,1"];
  route.forEach((key) => {
    const col = Number(key.split(",")[0]);
    const row = Number(key.split(",")[1]);
    const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
    Core.goToCell(state, state.dungeon.cells.indexOf(cell));
    const depth = Core.bandDepth(state.band);
    const spec = state.stage.rooms[cell.room].props || [];
    const hand = state.props.filter((prop) => !prop.scattered);
    assert.equal(hand.length, spec.length, `${key}: 手摆件一件不少`);
    /*
     * **手摆件就是量出来的位置，门口也不挪**（`docs/adr/0063` 追记，2026-10-27）。
     * 录像自己就把桶摆在下门拱旁边、把桶摆在上门前 35px —— "压门就挪"这条旧规矩
     * 会把它们推走，反而离录像更远。只允许撒出来的那批让门（见 `scatterProps`）。
     */
    spec.forEach((entry) => {
      const z = (entry.depth === undefined ? 0 : entry.depth) * depth;
      assert.ok(
        hand.some((prop) => prop.piece === entry.piece &&
          Math.abs(prop.x - entry.x) < 0.001 && Math.abs(prop.z - z) < 0.001),
        `${key}: ${entry.piece}@${entry.x} 应该留在量出来的位置`
      );
    });
    const specChests = spec.filter((entry) => entry.piece === "chest").length;
    assert.equal(
      hand.filter((prop) => prop.piece === "chest").length,
      specChests,
      `${key}: 宝箱一只不少`
    );
  });
});

test("路线格挪过的布景不许把宝箱/石碑盖住", () => {
  const route = ["0,3", "1,3", "2,3", "2,2", "2,1", "2,0", "3,0", "3,1", "4,1"];
  [7, 20260915].forEach((seed) => {
    const state = Core.createState({ stage: "mirkwooddeep", seed });
    route.forEach((key) => {
      const col = Number(key.split(",")[0]);
      const row = Number(key.split(",")[1]);
      const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
      Core.goToCell(state, state.dungeon.cells.indexOf(cell));
      const depth = Core.bandDepth(state.band);
      const artOf = (prop) => Core.propArtRect(state, {
        piece: prop.piece,
        x: prop.x,
        depth: prop.z / depth
      }, depth);
      state.props.filter((prop) => prop.piece === "chest" || prop.piece === "tomb")
        .forEach((loot) => {
          const lootArt = artOf(loot);
          state.props.forEach((prop) => {
            /*
             * 宝箱/石碑彼此并排不算：录像里两只箱子本来就挨着。别的件只在
             * **画在它前面**（z 更小，后画）时才会盖住它 —— 远的先画。
             */
            if (prop === loot) return;
            if (prop.piece === "chest" || prop.piece === "tomb") return;
            if (prop.z > loot.z + 0.001) return;
            const art = artOf(prop);
            if (!art) return;
            const covers =
              art.left < lootArt.right && art.right > lootArt.left &&
              art.top < lootArt.bottom && art.bottom > lootArt.top;
            assert.equal(
              covers,
              false,
              `seed ${seed} ${key}: ${prop.piece}@${Math.round(prop.x)} 挡住了 ` +
              `${loot.piece}@${Math.round(loot.x)}`
            );
          });
        });
    });
  });
});

test("the second wave runs in from the room edge instead of popping in", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 7 });
  const cell = state.dungeon.cells.find((at) => at.col === 0 && at.row === 3);
  Core.goToCell(state, state.dungeon.cells.indexOf(cell));
  /* 清掉第一波：第二波会从边缘进场。 */
  state.enemies.slice().forEach((enemy) => {
    Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
  });
  /* 只走一帧：波次刚生成，它们还没开始跑，x 应该正好在边缘。 */
  Core.runFrames(state, 1, {});

  const entering = state.enemies.filter((enemy) => enemy.entering && !enemy.dead);
  assert.ok(entering.length > 0, "the second wave is on its way in");
  const left = Core.roomLeft(state);
  const right = Core.roomRight(state);
  entering.forEach((enemy) => {
    assert.ok(
      Math.abs(enemy.x - (left + enemy.width)) < 1 ||
        Math.abs(enemy.x - (right - enemy.width)) < 1,
      `${enemy.type} starts at the room edge (${enemy.x})`
    );
    assert.equal(enemy.entering.speed, 200, "and runs in");
  });

  const first = entering[0];
  const toX = first.entering.toX;
  let frames = 0;
  while (first.entering && frames < 420) {
    Core.runFrames(state, 1, {});
    frames += 1;
  }
  assert.equal(first.entering, null, "it arrives (or times out) instead of walking forever");
  assert.ok(
    Math.abs(first.x - toX) < 20,
    `it stops on its mark, not at the spawn point (${first.x} vs ${toX})`
  );
});

test("the deep route's prop layout is the same on every seed", () => {
  const route = ["0,3", "1,3", "2,3", "2,2", "2,1", "2,0", "3,0", "3,1", "4,1"];
  const layout = (seed) => {
    const state = Core.createState({ stage: "mirkwooddeep", seed });
    return route.map((key) => {
      const col = Number(key.split(",")[0]);
      const row = Number(key.split(",")[1]);
      const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
      Core.goToCell(state, state.dungeon.cells.indexOf(cell));
      return state.props.filter((prop) => !prop.scattered)
        .map((prop) => `${prop.piece}@${prop.x.toFixed(1)}/${prop.z.toFixed(1)}`)
        .sort()
        .join("|");
    });
  };
  assert.deepEqual(layout(7), layout(20260915));
});

test("the deep route's nine cells can be walked through their own doors", () => {
  const state = Core.createState({ stage: "mirkwooddeep", seed: 7 });
  const route = [
    ["E", "1,3", "宝箱浅沟"],
    ["E", "2,3", "猫妖岔路"],
    ["N", "2,2", "藤蔓窄道"],
    ["N", "2,1", "投掷手坡"],
    ["N", "2,0", "老树回廊"],
    ["E", "3,0", "残柱祭坛"],
    ["W", "2,0", "老树回廊"],
    ["S", "2,1", "投掷手坡"],
    ["E", "3,1", "断墙营地"],
    ["E", "4,1", "暗咒猫妖的林地"]
  ];
  const cellAt = (key) => {
    const col = Number(key.split(",")[0]);
    const row = Number(key.split(",")[1]);
    return state.dungeon.cells.find((cell) => cell.col === col && cell.row === row);
  };
  route.forEach(([dir, key, name]) => {
    clearRoom(state);
    /*
     * `beginRoom` 从侧门进来把 z 放在 0（前缘），而 (2,1)/(1,0) 这些房间正中
     * 还有一扇 S 门；测试先走到中段再横穿，模拟一个会看门的玩家。
     */
    if (dir === "E" || dir === "W") {
      state.player.z = Core.bandDepth(state.band) / 2;
    }
    const before = state.cell;
    assert.ok(walkToDoor(state, dir) >= 0, `${name}: the ${dir} door lets him through`);
    assert.notEqual(state.cell, before, `${name}: he left the room`);
    const cell = state.dungeon.cells[state.cell];
    assert.equal(`${cell.col},${cell.row}`, key, `${name}: landed on ${key}`);
    assert.equal(state.stage.rooms[cell.room].name, name, `${name}: the pinned room`);
  });
  clearRoom(state);
  for (let hit = 0; hit < 80 && !state.victory; hit += 1) {
    state.enemies.slice().forEach((enemy) => {
      if (!enemy.dead) Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
    });
    Core.runFrames(state, 40, {});
  }
  assert.equal(state.victory, true, "the deep route reaches the boss and clears it");
});
