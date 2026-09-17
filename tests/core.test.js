"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/core.js");
const Render = require("../src/render.js");

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

test("the combo chain walks the six stages of the normal attack", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 48);
  enemy.hp = 500;
  enemy.maxHp = 500;
  enemy.speed = 0;
  state.enemies = [enemy];

  const stages = Core.ATTACK_STAGES;
  assert.equal(stages.length, 6, "the client's normal attack is six swings");

  const hits = [];
  for (let swing = 0; swing < stages.length; swing += 1) {
    enemy.x = state.player.x + 48;
    const hpBefore = enemy.hp;
    Core.step(state, { attack: true });
    assert.equal(state.player.comboIndex, swing, `press ${swing + 1} plays stage ${swing}`);
    Core.runFrames(state, 22, {});
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
  const near = Core.createEnemy(state, "grunt", state.player.x + 60);
  const far = Core.createEnemy(state, "grunt", state.player.x + 130);
  [near, far].forEach((enemy) => {
    enemy.hp = 400;
    enemy.maxHp = 400;
    enemy.speed = 0;
  });
  state.enemies = [near, far];

  Core.step(state, { skills: { mountainBreaker: true } });
  Core.runFrames(state, 22, {});

  assert.ok(near.knockdown > 0, "the smash should knock the target down");
  assert.ok(far.knockdown > 0, "the ground shockwave should knock the far target down");
  assert.ok(state.effects.some((effect) => effect.kind === "shockwave"));
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
  Core.runFrames(state, 12, {});
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

test("the shipped sprite sheet matches the frame grid the renderer expects", () => {
  const file = path.join(__dirname, "..", "assets", "slayer.png");
  const buffer = fs.readFileSync(file);

  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), Render.SPRITE.frameW * Render.SPRITE.cols);
  assert.equal(buffer.readUInt32BE(20), Render.SPRITE.frameH * 5);
  assert.deepEqual(Render.SPRITE.rows, { idle: 0, run: 1, attack: 2, skill: 3, extras: 4 });
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
  assert.equal(icons.readUInt32BE(20), 32);
});

test("one press plays one stage of the normal attack, and attack speed sets the pace", () => {
  const stages = Core.ATTACK_STAGES;
  assert.equal(Core.PLAYER.maxCombo, stages.length, "the chain is as long as the animation");
  assert.equal(Render.SPRITE.frames.attack, 61, "the attack row carries the whole clip");

  /*
   * The stages tile the clip: no frame is skipped and none plays twice, so
   * mashing X runs the client's whole normal attack in order. The old bake kept
   * six frames (the first cut), which is why the rest never reached the screen.
   */
  let next = 0;
  stages.forEach((stage, index) => {
    assert.equal(stage.first, next, `stage ${index} starts where the last one ended`);
    assert.ok(stage.frames > 0, `stage ${index} has frames`);
    assert.equal(stage.damage, Core.PLAYER.comboDamage[index]);
    next = stage.first + stage.frames;
  });
  assert.equal(next, Render.SPRITE.frames.attack, "the stages cover the whole animation");

  /* A press shows its own stage, from that stage's first frame to its last. */
  assert.equal(Render.attackColumn(0, 0), 0, "the first press starts on the guard");
  assert.equal(Render.attackColumn(1, 0), stages[0].frames - 1);
  assert.equal(Render.attackColumn(0, 1), stages[1].first, "the second press is its own swing");
  assert.equal(
    Render.attackColumn(1, stages.length - 1),
    Render.SPRITE.frames.attack - 1,
    "the last press reaches the client's final frame"
  );
  assert.equal(Render.attackColumn(0, stages.length), 0, "the chain wraps back to the guard");

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

test("the shipped DNF effect sheet matches the renderer grid", () => {
  const buffer = fs.readFileSync(path.join(__dirname, "..", "assets", "effects.png"));
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), Render.EFFECT.cell * Render.EFFECT.frames);
  assert.equal(
    buffer.readUInt32BE(20),
    Render.EFFECT.cell * Core.SKILL_ORDER.length,
    "one baked effect row per skill"
  );
  assert.equal(Render.EFFECT.frames, 4);
  Core.SKILL_ORDER.forEach((skillId) => {
    assert.ok(Render.EFFECT.draw[skillId], `${skillId} needs an effect mapping`);
  });
});

test("each skill picks a DNF effect row across the cast", () => {
  Core.SKILL_ORDER.forEach((skillId, row) => {
    const spec = Core.SKILLS[skillId];
    const mid = (spec.activeFrom + spec.activeTo) / 2 / spec.duration;
    const frame = Render.skillEffectFrame(skillId, mid);
    assert.ok(frame, `${skillId} should draw an effect mid-cast`);
    assert.equal(frame.row, row, `${skillId} owns its atlas row`);
    assert.ok(frame.col >= 0 && frame.col < Render.EFFECT.frames);
    assert.equal(Render.skillEffectFrame(skillId, 0), null, `${skillId} draws nothing on frame 0`);
    assert.equal(Render.skillEffectFrame(skillId, 1), null, `${skillId} stops after the cast`);
  });
  assert.equal(Render.skillEffectFrame("grunt", 0.5), null, "unknown skills have no effect");
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

  // 暴走: three hits while stepping forward
  const xBefore = state.player.x;
  Core.step(state, { skills: { frenzy: true } });
  Core.runFrames(state, 45, {});
  assert.equal(
    400 - near.hp,
    (Core.SKILLS.frenzy.damage + (state.player.level - 1) * Core.SKILLS.frenzy.growth) *
      Core.SKILLS.frenzy.hits,
    "暴走 lands three hits"
  );
  assert.ok(state.player.x > xBefore, "暴走 advances the character");

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
  assert.ok(behind.knockdown > 0 || behind.dead, "怒气爆发 knocks the target down");
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

test("崩山裂地斩 is a leaping ultimate with a wide rift", () => {
  const state = lastRoomState();
  const near = Core.createEnemy(state, "brute", state.player.x + 70);
  const far = Core.createEnemy(state, "brute", state.player.x + 260);
  [near, far].forEach((enemy) => {
    enemy.hp = 600;
    enemy.maxHp = 600;
    enemy.speed = 0;
  });
  state.enemies = [near, far];
  state.player.mp = state.player.maxMp;
  const skill = Core.SKILLS.mountainRift;

  Core.step(state, { skills: { mountainRift: true } });
  Core.runFrames(state, 20, {});
  assert.equal(state.player.onGround, false, "the ultimate leaps first");

  Core.runFrames(state, 12, {});
  assert.ok(
    state.effects.some((effect) => effect.kind === "shockwave"),
    "the landing splits the ground"
  );

  Core.runFrames(state, 48, {});
  assert.ok(
    state.player.mp <= state.player.maxMp - skill.mp + 12,
    `the ultimate costs ${skill.mp} MP (plus regen), mp=${state.player.mp}`
  );
  assert.ok(
    state.player.skillCooldowns.mountainRift > 0 &&
      state.player.skillCooldowns.mountainRift < skill.cooldown,
    "the long cooldown runs down after the cast"
  );
  assert.ok(far.hp < 600, "the rift reaches far targets");
  assert.ok(far.knockdown > 0 || far.dead, "the rift knocks them down");
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
    calls.filter((call) => call[0] === "drawImage" && call[1] === sheet && call[6] === -46).pop();

  const state = Core.createState({ seed: 3 });
  const renderIdle = () => {
    calls.length = 0;
    Render.render(ctx, state, { sprites });
    return playerDraw();
  };

  assert.equal(renderIdle()[3], 0, "idle uses the first sprite row");

  state.player.vx = 220;
  assert.equal(renderIdle()[3], 96, "running uses the run row");

  state.player.vx = 0;
  state.player.attackTimer = Core.PLAYER.attackDuration;
  assert.equal(renderIdle()[3], 192, "attacks use the attack row");

  state.player.attackTimer = 0;
  state.player.skillId = "bloodSword";
  state.player.skillTimer = Core.SKILLS.bloodSword.duration;
  assert.equal(renderIdle()[3], 288, "skills use the skill row");

  state.player.skillTimer = 0;
  state.player.skillId = null;
  state.player.onGround = false;
  state.player.vy = -200;
  const airborne = renderIdle();
  assert.equal(airborne[3], 384, "jumping uses the extras row");
  assert.equal(airborne[2], 192, "rising uses the jump column");

  state.player.onGround = true;
  state.player.vy = 0;
  state.player.hurtTimer = 0.1;
  const hurt = renderIdle();
  assert.equal(hurt[3], 384);
  assert.equal(hurt[2], 0, "hurt uses the hurt column");
});

test("touch controls expose a hit-testable layout for mobile play", () => {
  const buttons = Render.touchButtons();
  const actions = buttons.map((button) => button.action);

  assert.deepEqual(actions.slice(0, 4), ["left", "right", "jump", "attack"]);
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

test("the hotbar exposes two rows of DNF slots and the panel exposes every skill", () => {
  const Loadout = require("../src/loadout.js");
  const slots = Render.skillBarButtons();
  assert.equal(slots.length, Loadout.SLOT_COUNT, "A S D F G H / Q W E R T Y");
  assert.equal(Render.touchBarButtons().length, Loadout.SLOT_COUNT, "touch keeps both rows");
  assert.equal(slots[0].y, slots[5].y, "row one shares a baseline");
  assert.ok(slots[6].y > slots[0].y, "row two sits below row one");
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
