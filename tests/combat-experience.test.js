"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

for (const [stage, type, credit] of [
  ['mirkwood', 'boss', 280],
  ['mirkwooddeep', 'lugaruBoss', 360]
]) {
  test(`${stage}: boss death pays the credit visible in the recording log`, () => {
    // Independently readable V1 330s / V2 386s; see 43-boss-xp-contact.png.
    const state = Core.createState({ stage, seed: 7, referenceProfile: true });
    state.player.xp = 0;
    state.player.xpToNext = 100000; // Isolate the amount from unresolved progression.
    const boss = Core.createEnemy(state, type, state.player.x + 200, 0);
    state.enemies = [boss];
    for (let hit = 0; hit < 50 && !boss.dead; hit++) {
      Core.damageEnemy(state, boss, boss.hp + 1, 0, state.player.x);
    }
    assert.ok(boss.dead);
    assert.equal(state.player.xp, credit);
    assert.ok(state.log.some(line => line.text === `获得${credit}点经验值`));
    assert.ok(state.effects.some(effect => effect.text === `${credit} Exp`));
    const drop = state.pickups[0];
    assert.ok(drop, 'loot remains separate from the boss credit');
    state.player.x = drop.x;
    state.player.z = drop.z;
    Core.runFrames(state, 3, {});
    assert.equal(state.stats.loot, 1);
    assert.equal(state.player.xp, credit, 'pickup cannot repeat the boss credit');
  });
}

// V1 71.3s: 80 EXP is received while the hardener remains on the floor;
// V1 73.1s: collecting it adds the item and gold, without another XP credit.
// V2 15.8s independently shows death/50 EXP before any item receipt.
// These checks establish event ownership, not the unverified XP amounts.
for (const [stage, type] of [
  ["mirkwood", "grunt"],
  ["mirkwood", "cursedRed"],
  ["mirkwood", "boss"],
  ["mirkwooddeep", "goblinRed"],
  ["mirkwooddeep", "lugaruBoss"]
]) {
  test(`${stage}/${type}: death awards experience while distant loot remains uncollected`, () => {
    const state = Core.createState({ stage, seed: 7, referenceProfile: true });
    state.player.xp = 0;
    state.player.xpToNext = 100000; // Isolate the credit from level-up rollover.
    const enemy = Core.createEnemy(state, type, state.player.x + 200, state.player.z);
    state.enemies = [enemy];
    const goldBefore = state.stats.gold;

    for (let hit = 0; hit < 50 && !enemy.dead; hit++) {
      Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
    }

    assert.equal(state.player.xp, enemy.xp, "XP must not wait for item pickup");
    assert.equal(state.stats.loot, 0);
    assert.equal(state.stats.gold, goldBefore);
    assert.equal(state.pickups.length, 1, "the item remains on the floor");
    assert.ok(state.log.some(line => line.text === `获得${enemy.xp}点经验值`));
    assert.ok(state.effects.some(effect => effect.text === `${enemy.xp} Exp`));

    Core.damageEnemy(state, enemy, 9999, 0, state.player.x);
    assert.equal(state.player.xp, enemy.xp, "repeated hits cannot credit a death twice");

    const drop = state.pickups[0];
    state.player.x = drop.x;
    state.player.z = drop.z;
    Core.runFrames(state, 3, {});

    assert.equal(state.stats.loot, 1, "real movement/step collection still works");
    assert.equal(state.stats.gold, goldBefore + drop.gold);
    assert.equal(state.player.xp, enemy.xp, "collecting the item cannot pay XP again");
    assert.equal(state.log.filter(line => line.text === `获得${enemy.xp}点经验值`).length, 1);
  });
}

test('death XP attaches to the player above the visual body', () => {
  for (const [height, depth] of [[0, 0], [35, 0], [20, 45]]) {
    const state = Core.createState({ stage: 'mirkwood', referenceProfile: true });
    state.player.xpToNext = 100000;
    state.player.y = Core.ARENA.groundY - height;
    state.player.z = depth;
    const enemy = Core.createEnemy(state, 'grunt', state.player.x + 200, depth);
    Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
    const text = state.effects.find(effect => effect.kind === 'pickupText');
    const headY = state.player.y - Core.depthLift(depth) - 265 * Core.VIDEO_PX;
    assert.ok(text.y < headY, `XP must be above the body (height ${height}, depth ${depth})`);
    assert.equal(text.anchor, 'player', 'normal death XP follows its owner rather than the death location');
  }
});

test('death XP float expires after the observed 24 unpaused 30fps frames', () => {
  const state = Core.createState({ stage: 'mirkwood', referenceProfile: true });
  state.transition = 0;
  state.player.xpToNext = 100000;
  const enemy = Core.createEnemy(state, 'grunt', state.player.x + 200, 0);
  state.enemies = [enemy];
  Core.damageEnemy(state, enemy, enemy.hp + 1, 0, state.player.x);
  // This regression isolates effect duration; native death phase/hit-stop remain separate audits.
  state.hitStop = 0;
  Core.step(state, {}, 0.79);
  assert.ok(state.effects.some(effect => effect.kind === 'pickupText'));
  Core.step(state, {}, 0.02);
  assert.ok(!state.effects.some(effect => effect.kind === 'pickupText'), 'float must be gone after 0.8s');
});
