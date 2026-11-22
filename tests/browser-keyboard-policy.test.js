"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const decide = require('./browser/keyboard-policy.cjs');

function constants() {
  return { room: Core.ROOM, skills: Core.SKILLS, skillOrder: Core.SKILL_ORDER,
    meleeReach: Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT };
}

function bossAtEntry(dir) {
  const state = Core.createState({ stage: 'mirkwood', seed: 20260915 });
  const cell = dir === 'E' ? state.dungeon.boss : state.dungeon.cells.findIndex(
    room => Core.doorNeighbour(state.dungeon, room, dir) >= 0);
  Core.goToCell(state, cell);
  state.entryDoor = dir;
  assert.equal(Core.exitMode(state, dir), 'open');
  state.transition = 0;
  state.player.invuln = Infinity;
  state.player.x = dir === 'E'
    ? Core.roomRight(state) - Core.DOOR.side - state.player.width + 10
    : Core.roomLeft(state) + Core.DOOR.side + state.player.width - 10;
  const boss = Core.createEnemy(state, 'boss', state.player.x);
  boss.x = state.player.x + (dir === 'E' ? -110 : 110);
  boss.z = state.player.z;
  boss.attackTimer = 0;
  state.enemies = [boss];
  state.projectiles = [];
  return state;
}

for (const dir of ['E', 'W']) {
  test(`keyboard combat policy stays inside an open ${dir} entry during retreat`, () => {
    const state = bossAtEntry(dir);
    const policy = constants();
    const initialCell = state.cell;
    assert.equal(Core.doorAt(state), null, 'not yet in the entry doorway');
    const actions = decide(state, policy);
    assert.ok(!actions.has(dir === 'E' ? 'right' : 'left'),
      'retreating outwards would leave the live boss room');
    assert.ok(actions.has(dir === 'E' ? 'left' : 'right'),
      'cross toward the boss before entering the open doorway');
    // A 100ms decision interval, as in the observed slow-browser trace.
    for (let sample = 0; sample < 20; sample++) {
      const input = Object.fromEntries([...decide(state, policy)].map(action => [action, true]));
      for (let frame = 0; frame < 6; frame++) {
        Core.step(state, input);
        assert.equal(state.cell, initialCell, 'combat decisions must not reset the room');
      }
    }
  });
}

test('keyboard policy can still leave a cleared room along the real route', () => {
  const state = Core.createState({ stage: 'mirkwood', seed: 20260915 });
  state.enemies = [];
  state.room.pendingWave = [];
  state.room.pendingWaves = [];
  state.room.cleared = Core.currentCell(state).cleared = true;
  const input = {};
  for (const action of decide(state, constants())) input[action] = true;
  assert.ok(input.right || input.left || input.up || input.down);
});

test('keyboard policy detours when a pillar blocks the depth approach', () => {
  const state = Core.createState({ stage: 'mirkwood', seed: 20260915 });
  Core.goToCell(state, 1);
  const pillar = state.props.find(prop => prop.piece === 'pillar');
  const box = Core.propObstacle(pillar, state.player);
  state.props = [pillar];
  state.intro = null;
  state.transition = 0;
  state.player.x = box.x - 17;
  state.player.z = box.z - box.depth / 2;
  const enemy = Core.createEnemy(state, 'goblinBlue', state.player.x - 40, box.z + 55);
  enemy.speed = 0;
  enemy.attackCooldown = Infinity;
  state.enemies = [enemy];
  state.projectiles = [];
  const policy = constants();
  for (let frame = 0; frame < 180 && Math.abs(enemy.z - state.player.z) > policy.meleeReach; frame++) {
    const input = Object.fromEntries([...decide(state, policy)].map(action => [action, true]));
    Core.step(state, input);
  }
  assert.ok(Math.abs(enemy.z - state.player.z) <= policy.meleeReach,
    'the bot reaches attack depth by walking around the pillar');
});

test('keyboard policy backs out of the pillar gap and exits a cleared room', () => {
  const state = Core.createState({ stage: 'mirkwood', seed: 20260915 });
  Core.goToCell(state, 1);
  state.intro = null;
  state.transition = 0;
  state.enemies = [];
  state.room.cleared = Core.currentCell(state).cleared = true;
  state.player.x = 318;
  state.player.z = 267;
  const next = Core.doorNeighbour(state.dungeon, Core.currentCell(state), 'S');
  const policy = constants();
  for (let frame = 0; frame < 240 && state.cell === 1; frame++) {
    const input = Object.fromEntries([...decide(state, policy)].map(action => [action, true]));
    Core.step(state, input);
  }
  assert.equal(state.cell, next);
});

test('the keyboard bot dodges only live inbound projectiles in its lane', () => {
  const state = Core.createState({ seed: 1 });
  Object.assign(state.player, { x: 400, z: 100, facing: 1 });
  const target = state.enemies[0];
  Object.assign(target, { x: 430, z: 100 });
  state.enemies = [target];
  const policy = constants();
  const shot = { x: 350, z: state.player.z, vx: 300, radius: 9 };

  state.projectiles = [shot];
  assert.deepEqual(decide(state, policy), new Set(['jump']));

  for (const [label, fields] of [
    ['stopped shot', { stopped: true }],
    ['spent piercing shot', { hitPlayer: true }],
    ['shot in another lane', { z: shot.z + state.player.width / 2 + shot.radius + 1 }],
  ]) {
    state.projectiles = [{ ...shot, ...fields }];
    const actions = decide(state, policy);
    assert.ok(actions.has('attack'), label);
    assert.ok(!actions.has('jump'), label);
  }
});
