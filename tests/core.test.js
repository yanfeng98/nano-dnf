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

test("鬼斩 spends MP, hits inside reach, then stays on cooldown", () => {
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
  const skill = Core.SKILLS.ghostSlash;
  const nearHp = near.hp;
  const farHp = far.hp;

  Core.step(state, { skills: { ghostSlash: true } });
  Core.runFrames(state, 26, {});

  assert.equal(nearHp - near.hp, skill.damage);
  assert.equal(far.hp, farHp);
  assert.ok(state.player.mp < mpBefore - skill.mp + 5, `mp=${state.player.mp}`);
  assert.ok(state.player.skillCooldowns.ghostSlash > 0, "鬼斩 should start its cooldown");

  const hpBefore = near.hp;
  Core.step(state, { skills: { ghostSlash: true } });
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

test("崩山击 adds a ground shockwave that reaches past the blade", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "grunt", state.player.x + 60);
  const far = Core.createEnemy(state, "grunt", state.player.x + 125);
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
  Core.runFrames(state, 24, {});

  assert.equal(nearHp - near.hp, skill.damage, "blade hit lands once");
  assert.equal(farHp - far.hp, skill.shockwave.damage, "shockwave reaches the second target");
  assert.ok(state.effects.some((effect) => effect.kind === "shockwave"));
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

  assert.equal(hpBefore - enemy.hp, skill.damage + (4 - 1) * skill.growth);
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
    skills: { ghostSlash: frame % 211 === 0, mountainBreaker: frame % 173 === 0 }
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
  const a = Core.createState({ seed: 5, roomIndex: 1 });
  const b = Core.createState({ seed: 5, roomIndex: 1 });

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
    target.attackKind === "slam" && target.slam ? target.slam.radius : target.attackRange;
  const activeUntil = target.attackKind === "charge" ? target.chargeTo : target.attackWindup;
  const threatened = target.attackTimer > 0 && elapsed <= activeUntil + 0.05;

  if (threatened) {
    if (distance < threatRange + 45) {
      if (delta > 0) input.left = true;
      else input.right = true;
    }
    return input;
  }
  if (distance > 60) {
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
  const totalEnemies = Core.ROOMS.reduce((total, room) => total + room.enemies.length, 0);
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
    assert.equal(state.stats.kills, totalEnemies);
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
