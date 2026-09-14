"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/core.js");
const Render = require("../src/render.js");

/** Last room never advances, so movement tests can run without a room transition. */
function lastRoomState(seed) {
  const state = Core.createState({ seed: seed || Core.DEFAULT_SEED, roomIndex: Core.ROOMS.length - 1 });
  state.enemies = [];
  state.room.cleared = true;
  return state;
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
  Core.runFrames(state, 8, {});

  assert.equal(hpBefore - enemy.hp, Core.PLAYER.comboDamage[0]);
  assert.equal(state.stats.hits, 1);
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

test("combo chain escalates damage 8 / 10 / 15", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 48);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  const hits = [];
  for (let swing = 0; swing < 3; swing += 1) {
    enemy.x = state.player.x + 48;
    const hpBefore = enemy.hp;
    Core.step(state, { attack: true });
    Core.runFrames(state, 22, {});
    hits.push(hpBefore - enemy.hp);
  }

  assert.deepEqual(hits, Core.PLAYER.comboDamage);
  assert.equal(state.player.comboIndex, 2);
});

test("dead enemies leave the room and clearing the last room wins", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: Core.ROOMS.length - 1 });
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

  state.player.x = Core.ARENA.rightWall - state.player.width / 2;
  Core.step(state, {});

  assert.equal(state.roomIndex, 1);
  assert.equal(state.room.name, Core.ROOMS[1].name);
  assert.equal(state.room.cleared, false);
  assert.equal(state.enemies.length, Core.ROOMS[1].enemies.length);
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

test("skill spends MP and only hits enemies inside the whirlwind radius", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "grunt", state.player.x + 60);
  const far = Core.createEnemy(state, "grunt", state.player.x + 400);
  state.enemies = [near, far];
  state.player.mp = 80;
  const nearHp = near.hp;
  const farHp = far.hp;

  Core.step(state, { skill: true });
  Core.runFrames(state, 20, {});

  assert.equal(nearHp - near.hp, Core.SKILL.damage);
  assert.equal(far.hp, farHp);
  assert.ok(state.player.mp < 80 - Core.SKILL.cost + 4, `mp=${state.player.mp}`);
  assert.ok(state.player.mp > 80 - Core.SKILL.cost - 1, `mp=${state.player.mp}`);
});

test("skill is refused while MP is below cost", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 60);
  state.enemies = [enemy];
  state.player.mp = Core.SKILL.cost - 1;
  const hpBefore = enemy.hp;

  Core.step(state, { skill: true });
  Core.runFrames(state, 10, {});

  assert.equal(enemy.hp, hpBefore);
  assert.equal(state.player.skillTimer, 0);
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
    skill: frame % 211 === 0
  }));

  assert.ok(state.time > 14);
  assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y));
  assert.ok(state.player.x >= Core.ARENA.leftWall);
  assert.ok(state.player.x <= Core.ARENA.rightWall);
  assert.ok(state.player.hp >= 0 && state.player.hp <= state.player.maxHp);
  assert.ok(state.player.mp >= 0 && state.player.mp <= state.player.maxMp);
  assert.ok(state.roomIndex >= 0 && state.roomIndex < Core.ROOMS.length);
  assert.ok(state.enemies.every((enemy) => enemy.hp > 0));
  assert.equal(state.victory && state.defeat, false);
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
  Core.runFrames(state, 8, {});

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
 * Policy that plays the way a person would: respect the enemy wind-up, close in on
 * recovery frames, and spend MP on the AoE skill. Used to prove the dungeon is beatable.
 */
function kitingBot(state) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  const input = { left: false, right: false, jump: false, attack: false, skill: false };
  if (alive.length === 0) {
    input.right = true;
    return input;
  }
  alive.sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x));
  const target = alive[0];
  const delta = target.x - player.x;
  const distance = Math.abs(delta);
  const windingUp = target.attackTimer > 0 && target.attackDuration - target.attackTimer < target.attackWindup;

  if (windingUp && distance < target.attackRange + 45) {
    if (delta > 0) input.left = true;
    else input.right = true;
    return input;
  }
  if (distance > 60) {
    if (delta > 0) input.right = true;
    else input.left = true;
    return input;
  }
  input.attack = true;
  if (player.mp >= Core.SKILL.cost && distance <= Core.SKILL.radius) input.skill = true;
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
    assert.equal(state.stats.kills, 9);
    assert.ok(state.stats.damageTaken <= 12, `damageTaken=${state.stats.damageTaken}`);
    assert.ok(state.time < 90, `clear took ${state.time}s`);
  });
});

test("renderer draws a live frame and both end-state overlays without throwing", () => {
  const calls = [];
  const ctx = new Proxy(
    {
      createLinearGradient() {
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

  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  Render.render(ctx, state, { paused: false, showHelp: true });
  const liveCalls = calls.length;
  assert.ok(liveCalls > 40, `expected the renderer to draw, calls=${liveCalls}`);

  state.victory = true;
  Render.render(ctx, state, {});
  state.victory = false;
  state.defeat = true;
  Render.render(ctx, state, {});

  const texts = calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
  assert.ok(texts.includes("DUNGEON CLEARED"));
  assert.ok(texts.includes("YOU DIED"));
});
