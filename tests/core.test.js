"use strict";

const fs = require("node:fs");
const path = require("node:path");
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

  assert.equal(nearHp - near.hp, skill.damage * skill.hits);
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

test("鬼斩 lands three hits and stuns the target while it is held", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "brute", state.player.x + 70);
  enemy.hp = 600;
  enemy.maxHp = 600;
  enemy.speed = 0;
  state.enemies = [enemy];
  const skill = Core.SKILLS.ghostSlash;

  Core.step(state, { skills: { ghostSlash: true } });
  let stunned = 0;
  for (let frame = 0; frame < 50; frame += 1) {
    Core.step(state, {});
    if (enemy.stun > 0) stunned += 1;
  }

  assert.equal(600 - enemy.hp, skill.damage * skill.hits, "three separate hits land");
  assert.ok(stunned > 8, `target should stay stunned through the ghosts, frames=${stunned}`);
  assert.ok(enemy.vx === 0, "鬼斩 holds the target in place");
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
    if (delta > 0) input.right = true;
    else input.left = true;
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
  assert.equal(buffer.readUInt32BE(16), Render.SPRITE.frameW * 6);
  assert.equal(buffer.readUInt32BE(20), Render.SPRITE.frameH * 5);
  assert.deepEqual(Render.SPRITE.rows, { idle: 0, run: 1, attack: 2, skill: 3, extras: 4 });

  const icons = fs.readFileSync(path.join(__dirname, "..", "assets", "skills.png"));
  assert.equal(icons.readUInt32BE(16), 32 * Core.SKILL_ORDER.length, "one icon per skill");
  assert.equal(icons.readUInt32BE(20), 32);
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

  // 三段斩: three hits while stepping forward
  const xBefore = state.player.x;
  Core.step(state, { skills: { tripleSlash: true } });
  Core.runFrames(state, 45, {});
  assert.equal(
    400 - near.hp,
    (Core.SKILLS.tripleSlash.damage + (state.player.level - 1) * Core.SKILLS.tripleSlash.growth) *
      Core.SKILLS.tripleSlash.hits,
    "三段斩 lands three hits"
  );
  assert.ok(state.player.x > xBefore, "三段斩 advances the character");

  // 裂波斩: launches through its wave
  state.player.skillCooldowns.waveSlash = 0;
  state.player.mp = state.player.maxMp;
  near.hp = 400;
  Core.step(state, { skills: { waveSlash: true } });
  Core.runFrames(state, 12, {});
  assert.ok(near.y < Core.ARENA.groundY || near.vy < 0, "裂波斩 lifts the target");
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

test("鬼影闪 dashes through the target with invincibility frames", () => {
  const state = lastRoomState();
  const enemy = Core.createEnemy(state, "grunt", state.player.x + 70);
  enemy.hp = 400;
  enemy.maxHp = 400;
  state.enemies = [enemy];
  const xBefore = state.player.x;

  Core.step(state, { skills: { ghostStep: true } });
  Core.runFrames(state, 8, {});
  assert.ok(state.player.invuln > 0, "the dash grants invincibility frames");
  Core.runFrames(state, 40, {});

  assert.ok(state.player.x > xBefore + 60, `the dash covers ground, x=${state.player.x}`);
  assert.ok(
    400 - enemy.hp >= Core.SKILLS.ghostStep.damage,
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

  const moved = Loadout.assign(base, 0, "ghostSlash");
  assert.equal(moved[0], "ghostSlash");
  assert.equal(moved[3], "upSlash", "the displaced skill swaps into the old slot");

  const cleared = Loadout.clearSlot(moved, 0);
  assert.equal(cleared[0], null);
  assert.equal(moved[0], "ghostSlash", "loadout updates are immutable");

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
  state.player.skillId = "ghostSlash";
  state.player.skillTimer = Core.SKILLS.ghostSlash.duration;
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
    drag: { skillId: "waveSlash", x: 400, y: 300 },
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

test("the dungeon gained a caster/charger room directly ahead of the boss", () => {
  assert.equal(Core.ROOMS.length, 5, "the dungeon now runs five rooms");

  const bossRoom = Core.ROOMS[Core.ROOMS.length - 1];
  assert.ok(
    bossRoom.enemies.some((enemy) => enemy.type === "boss"),
    "the boss must still close the dungeon"
  );
  assert.equal(bossRoom.enemies.length, 2, "the boss room stays a bodyguard fight");

  const mix = Core.ROOMS[Core.ROOMS.length - 2];
  const types = mix.enemies.map((enemy) => enemy.type);
  assert.ok(types.includes("caster"), `caster pressure missing from ${mix.name}`);
  assert.ok(types.includes("charger"), `charger pressure missing from ${mix.name}`);
  assert.equal(types.includes("boss"), false, "the mix room is not the boss room");
  assert.ok(
    types.includes("grunt") || types.includes("brute"),
    "the lane needs a body, not just two specials"
  );
});

test("the renderer gives the enraged boss its own palette, aura and bar label", () => {
  const calls = [];
  const ctx = recordingContext(calls);

  const state = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: Core.ROOMS.length - 1 });
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
  const withBoss = bannerY(Core.ROOMS.length - 1);
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
    texts.some((text) => text.includes(`第 ${Core.ROOMS.length} 层`)),
    `the help overlay must quote ${Core.ROOMS.length} rooms: ${texts.join(" / ")}`
  );

  /* Killing the boss stacks "Boss down!" and "Dungeon cleared!" in the same frame. */
  const stacked = [];
  const cleared = Core.createState({ seed: Core.DEFAULT_SEED, roomIndex: Core.ROOMS.length - 1 });
  cleared.effects.push({ kind: "banner", text: "Boss down!", life: 1, maxLife: 1 });
  cleared.effects.push({ kind: "banner", text: "Dungeon cleared!", life: 1, maxLife: 1 });
  Render.render(recordingContext(stacked), cleared, {});
  const first = stacked.find((call) => call[0] === "fillText" && call[1] === "Boss down!")[3];
  const second = stacked.find((call) => call[0] === "fillText" && call[1] === "Dungeon cleared!")[3];
  assert.notEqual(first, second, "stacked banners must not overprint each other");
});
