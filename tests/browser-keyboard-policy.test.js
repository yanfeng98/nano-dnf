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
