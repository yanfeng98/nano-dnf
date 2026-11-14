"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test('deep entry preserves recorded Lv5 red / Lv6 blue goblin credits across spawning', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    state.transition = 0;
    const observed = new Map();
    for (let frame = 0; frame < 900 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (observed.has(enemy.id)) continue;
        observed.set(enemy.id, enemy.type);
        const red = enemy.type === 'goblinRed';
        assert.ok(red || enemy.type === 'goblinBlue');
        assert.equal(enemy.level, red ? 5 : 6);
        assert.equal(enemy.xp, red ? 50 : 60);
        assert.equal(Render.targetTrackWidth(state, enemy), red ? 116 : 144);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) {
          Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
        }
      }
      Core.step(state, {});
    }
    assert.ok(state.room.cleared);
    assert.equal([...observed.values()].filter(type => type === 'goblinRed').length, 4);
    assert.equal([...observed.values()].filter(type => type === 'goblinBlue').length, 3);
    assert.equal(state.stats.kills, 7);
    assert.equal(state.player.xp, 380, 'four50 and three60 credits in the entry logs');
  }
});

test('ordinary entry deaths pay the four recorded credits, independently of loot', () => {
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({ stage: 'mirkwood', seed, referenceProfile: true });
    state.player.xpToNext = 100000; // Amounts only; the progression table remains unknown.
    const expected = { grunt: 40, caster: 40, coward: 40, cursedRed: 80 };
    for (const enemy of state.enemies) {
      assert.equal(enemy.xp, expected[enemy.type], `${enemy.type}: V1 entry death log`);
      for (let hit = 0; hit < 50 && !enemy.dead; hit++) {
        Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      assert.ok(enemy.dead);
    }
    assert.equal(state.stats.kills, 4);
    assert.equal(state.player.xp, 200, 'two 40s, champion 80, then final 40');
    assert.equal(state.stats.loot, 0);
    assert.equal(state.pickups.length, 4);
    assert.equal(state.log.filter(line => line.text === '获得40点经验值').length, 3);
    assert.equal(state.log.filter(line => line.text === '获得80点经验值').length, 1);
  }
});

test('room credits survive deferred spawning and preserve an explicit zero', () => {
  const state = Core.createState({ stage: 'mirkwood', seed: 7 });
  const roomIndex = state.dungeon.cells[state.cell].room;
  state.stage = { ...state.stage, rooms: state.stage.rooms.map((room, index) =>
    index === roomIndex ? { ...room, enemies: [
      { type: 'grunt', x: 300, xp: 0 },
      { type: 'grunt', x: 400, wave: 2, xp: 37 },
      { type: 'grunt', x: 500, wave: 2 }
    ] } : room) };
  Core.beginRoom(state, null);
  state.transition = 0;
  state.player.xpToNext = 100000;
  assert.equal(state.enemies[0].xp, 0);
  Core.damageEnemy(state, state.enemies[0], 9999, 0, state.player.x);
  assert.equal(state.player.xp, 0);
  for (let frame = 0; frame < 300 && state.room.pendingWave.length; frame++) {
    Core.step(state, {});
  }
  const arrivals = state.enemies.filter(enemy => !enemy.dead);
  assert.deepEqual(arrivals.map(enemy => enemy.xp), [37, Core.ENEMY_TYPES.grunt.xp]);
  for (const enemy of arrivals) Core.damageEnemy(state, enemy, 9999, 0, state.player.x);
  assert.equal(state.player.xp, 37 + Core.ENEMY_TYPES.grunt.xp);
});

test("ordinary entry includes the recorded cursed red champion among its four enemies", () => {
  // V1 target names: coward 62s, cursed-red 64s, thrower 65.5s,
  // ordinary goblin 66.5s; first room clears at a total of four kills.
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({ stage: "mirkwood", seed, referenceProfile: true });
    assert.deepEqual(state.enemies.map(enemy => enemy.type).sort(),
      ["caster", "coward", "cursedRed", "grunt"]);
    const champion = state.enemies.find(enemy => enemy.type === "cursedRed");
    assert.equal(champion.champion, "dark");
    assert.equal(champion.level, 4);
    assert.equal(Core.ENEMY_TYPES[champion.type].label, "诅咒之赤哥布林");
  }
});

const Render = require('../src/render.js');

test('the recorded fire champion keeps Lv4 when spawned by the real reinforcement path', () => {
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({ stage:'mirkwood', seed, referenceProfile:true });
    const cell = state.dungeon.cells.findIndex(spot => state.stage.rooms[spot.room].name === '投石坡');
    Core.goToCell(state, cell);
    state.transition = 0;
    state.player.invuln = Infinity;
    state.player.xpToNext = 100000; // Isolate the roster from the uncalibrated XP model.
    for (const enemy of state.enemies) {
      for (let hit=0; hit<20 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp+1, 0, state.player.x);
    }
    for (let frame=0; frame<600 && !state.enemies.some(e=>e.type==='burningThrower'); frame++) {
      Core.step(state, {}, Core.DT);
    }
    const fire = state.enemies.find(enemy => enemy.type === 'burningThrower');
    assert.ok(fire, 'the configured reinforcement actually spawned');
    assert.equal(fire.level, 4, 'V1 220s names the fire champion Lv4');
    assert.equal(fire.champion, 'fire');
    assert.equal(Render.targetTrackWidth(state, fire), 217, 'use the measured Lv4 target track');
  }
});

test('a room can explicitly override the fire champion level', () => {
  const state = Core.createState({stage:'mirkwood'});
  const fire = Core.createEnemy(state, 'burningThrower', 300, 0, 7);
  assert.equal(fire.level, 7);
});
