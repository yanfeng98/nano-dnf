"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test('deep room14 includes the five recorded green goblins and both captain pairs at entry', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    const cell = state.dungeon.cells.findIndex(spot => spot.col === 3 && spot.row === 0);
    Core.goToCell(state, cell);
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    state.transition = 0;
    assert.equal(state.enemies.length, 9, 'map402 and the nine visible death credits');
    assert.equal(state.room.pendingWave.length, 0, 'all three kinds are already visible before the first kill');
    assert.equal(state.room.pendingWaves.length, 0);
    const expected = {grunt: [5, 4, 40, 116], deepElite: [2, 6, 60, 198], throwerElite: [2, 6, 60, 162]};
    for (const [type, [count, level, xp, width]] of Object.entries(expected)) {
      const enemies = state.enemies.filter(enemy => enemy.type === type);
      assert.equal(enemies.length, count, type);
      for (const enemy of enemies) {
        assert.equal(enemy.level, level);
        assert.equal(enemy.xp, xp);
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
    }
    assert.equal(state.stats.kills, 9);
    assert.equal(state.player.xp, 440, 'five40 and four60 recorded credits');
    Core.runFrames(state, 3, {});
    assert.ok(state.room.cleared);
  }
});

test('deep room23 restores three red, three blue and five cats with eleven60 credits', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 2 && spot.row === 1));
    state.transition = 0;
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'cat' ? 162 : enemy.type === 'deepElite' ? 198 : 144;
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 11, 'eleven new60 credits corroborate the native n432 roster');
    assert.deepEqual([...seen.values()].map(row => row.join(':')).sort(), [
      'goblinRed:6:60', 'goblinRed:6:60', 'goblinRed:6:60',
      'goblinBlue:6:60', 'goblinBlue:6:60', 'goblinBlue:6:60',
      'cat:6:60', 'cat:6:60', 'cat:6:60', 'cat:6:60', 'cat:6:60'
    ].sort());
    assert.equal(state.player.xp, 660);
    assert.ok(state.room.cleared);
  }
});

test('deep room13 restores nine recorded actors and nine60 credits', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 2 && spot.row === 0));
    state.transition = 0;
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'deepElite' ? 198 : enemy.type === 'throwerElite' || enemy.type === 'cat' ? 162 : 144;
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 9, 'nine new60 credits corroborate the native n412 roster');
    assert.deepEqual([...seen.values()].map(row => row.join(':')).sort(), [
      'goblinRed:6:60', 'goblinRed:6:60', 'goblinBlue:6:60', 'goblinBlue:6:60',
      'cat:6:60', 'cat:6:60', 'deepElite:6:60', 'deepElite:6:60', 'throwerElite:6:60'
    ].sort());
    assert.equal(state.player.xp, 540);
    assert.ok(state.room.cleared);
  }
});

test('deep room24 restores ten recorded actors and ten60 credits', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 3 && spot.row === 1));
    state.transition = 0;
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'deepElite' ? 198 : enemy.type === 'throwerElite' ? 162 : 144;
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 10, 'ten new60 credits corroborate the native n410 roster');
    assert.deepEqual([...seen.values()].map(row => row.join(':')).sort(), [
      'goblinRed:6:60', 'goblinRed:6:60', 'goblinRed:6:60',
      'goblinBlue:6:60', 'goblinBlue:6:60', 'goblinBlue:6:60',
      'goblinBlue:6:60', 'deepElite:6:60', 'deepElite:6:60', 'throwerElite:6:60'
    ].sort());
    assert.equal(state.player.xp, 600);
    assert.ok(state.room.cleared);
  }
});

test('deep room33 restores both captain kinds and all eight recorded60 credits', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 2 && spot.row === 2));
    state.transition = 0;
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'deepElite' ? 198 : enemy.type === 'throwerElite' ? 162 : 144;
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 8, 'eight new60 credits corroborate the native n433 roster');
    assert.deepEqual([...seen.values()].map(row => row.join(':')).sort(), [
      'goblinRed:6:60', 'goblinRed:6:60', 'goblinRed:6:60',
      'goblinBlue:6:60', 'goblinBlue:6:60', 'goblinBlue:6:60',
      'deepElite:6:60', 'throwerElite:6:60'
    ].sort());
    assert.equal(state.player.xp, 480);
    assert.ok(state.room.cleared);
  }
});

test('deep room43 restores both captain kinds and all eight recorded60 credits', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 2 && spot.row === 3));
    state.transition = 0;
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'deepElite' ? 198 : enemy.type === 'throwerElite' ? 162 : 144;
        assert.equal(Render.targetTrackWidth(state, enemy), width);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 8, 'eight new60 credits corroborate the native n423 roster');
    assert.deepEqual([...seen.values()].map(row => row.join(':')).sort(), [
      'goblinRed:6:60', 'goblinRed:6:60', 'goblinBlue:6:60', 'goblinBlue:6:60',
      'deepElite:6:60', 'deepElite:6:60', 'deepElite:6:60', 'throwerElite:6:60'
    ].sort());
    assert.equal(state.player.xp, 480);
    assert.ok(state.room.cleared);
  }
});

test('deep room42 matches eight recorded deaths, including the Lv7 cat', () => {
  const Render = require('../src/render.js');
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage: 'mirkwooddeep', seed, referenceProfile: true});
    Core.goToCell(state, state.dungeon.cells.findIndex(spot => spot.col === 1 && spot.row === 3));
    state.player.xpToNext = 100000;
    state.player.invuln = Infinity;
    state.transition = 0;
    const seen = new Map();
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.set(enemy.id, [enemy.type, enemy.level, enemy.xp]);
        const width = enemy.type === 'deepElite' ? 198 : enemy.level === 7 ? 196 : 162;
        assert.equal(Render.targetTrackWidth(state, enemy), width, `${enemy.type} Lv${enemy.level} recorded track`);
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.equal(seen.size, 8, 'V2 counter7 at entry and15 at exit');
    const roster = [...seen.values()].map(row => row.join(':')).sort();
    assert.deepEqual(roster, [
      'deepElite:6:60', 'deepElite:6:60',
      'throwerElite:6:60', 'throwerElite:6:60', 'throwerElite:6:60',
      'cat:6:60', 'cat:6:60', 'cat:7:70'
    ].sort());
    assert.equal(state.player.xp, 490, 'seven60 credits and the Lv7 cat70');
    assert.ok(state.room.cleared);
  }
});

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


test('deep lord room ordinary deaths pay the observed level-specific credits', () => {
  for (const seed of [1, 2, 7, 123]) {
    const state = Core.createState({stage:'mirkwooddeep', seed, referenceProfile:true});
    Core.goToCell(state, state.dungeon.cells.findIndex(c => c.col === 4 && c.row === 1));
    state.transition = 0;
    state.player.invuln = Infinity;
    state.player.xpToNext = 100000;
    const observed = new Set();
    let expectedXP = 0;
    for (let frame = 0; frame < 1200 && !state.room.cleared; frame++) {
      for (const enemy of state.enemies) {
        if (observed.has(enemy.id)) continue;
        observed.add(enemy.id);
        const expected = enemy.type === 'lugaruBoss' ? 360 : enemy.type === 'cat' ? 60 : 70;
        assert.equal(enemy.xp, expected, `${enemy.type}: V2 lord room death logs`);
        expectedXP += expected;
        for (let hit = 0; hit < 50 && !enemy.dead; hit++) Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
      }
      Core.step(state, {});
    }
    assert.ok(state.room.cleared);
    assert.equal(state.player.xp, expectedXP);
  }
});
