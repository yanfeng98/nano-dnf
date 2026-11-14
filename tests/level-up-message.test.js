'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

test('a real death crossing a level threshold reports the observed event-log message', () => {
  const state = Core.createState({ stage: 'mirkwood', referenceProfile: true });
  const enemy = Core.createEnemy(state, 'grunt', state.player.x + 200, 0);
  state.enemies = [enemy];
  state.player.xp = state.player.xpToNext - enemy.xp;
  Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
  assert.equal(state.player.level, 4);
  assert.ok(state.log.some(line => line.text === '[阿努纳奇]已达到Lv4'));
  assert.ok(!state.effects.some(effect => effect.kind === 'banner' && /LEVEL UP/.test(effect.text)),
    'the generic level-up banner is absent from the observed transition');
  const count = state.log.length;
  Core.damageEnemy(state, enemy, 999, 0, state.player.x);
  Core.grantXp(state, 0);
  assert.equal(state.log.length, count, 'one level event is not repeated by a dead hit or no credit');
});

test('recording start levels are initial state, not new level-up messages', () => {
  for (const stage of ['mirkwood', 'mirkwooddeep']) {
    const state = Core.createState({stage, referenceProfile:true});
    assert.ok(!state.log.some(line => /已达到Lv/.test(line.text)));
  }
});
