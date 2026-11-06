"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Reward = require("../src/reward.js");
const Core = require("../src/core.js");

test("the card reward is deterministic per seed", () => {
  const left = Reward.snapshot(Reward.create({ seed: Core.DEFAULT_SEED }));
  const right = Reward.snapshot(Reward.create({ seed: Core.DEFAULT_SEED }));
  assert.deepEqual(right, left, "同一个种子要翻出同一张牌");
  assert.ok(left.item && left.item.length > 0);
  assert.ok(left.gold >= 500 && left.gold < 3500, `gold ${left.gold}`);
  assert.ok(left.cards === 4, "参考是四张牌");
});

test("the reward runs 战绩 → 宝箱 → 四张牌 → 领奖", () => {
  const reward = Reward.create({ seed: 7 });
  assert.equal(reward.phase, "stats");

  Reward.step(reward, Reward.TIMES.stats);
  assert.equal(reward.phase, "chest");

  Reward.step(reward, Reward.TIMES.chest);
  assert.equal(reward.phase, "cards");
  assert.equal(reward.faceUp, false, "牌先背朝上");

  Reward.step(reward, Reward.TIMES.flip);
  assert.equal(reward.faceUp, true, "青光褪去后成为金色牌面");

  /* The prompt appears first; the counter starts half a second later. */
  Reward.step(reward, Reward.TIMES.countdownAt - Reward.TIMES.flip);
  /* 3 → 2 → 1：倒计时走到零就自动选最左一张。 */
  Reward.step(reward, 1);
  assert.equal(reward.countdown, 2);
  Reward.step(reward, 1);
  assert.equal(reward.countdown, 1);
  Reward.step(reward, 1);
  assert.equal(reward.phase, "reveal");
  assert.equal(reward.picked, 0, "超时自动选最左一张");

  Reward.step(reward, Reward.TIMES.reveal);
  assert.equal(reward.phase, "done");
});

test("a click or a number key picks that card, and only once", () => {
  const reward = Reward.create({ seed: 42 });
  Reward.step(reward, Reward.TIMES.stats);
  Reward.step(reward, Reward.TIMES.chest);
  Reward.step(reward, Reward.TIMES.flip);
  assert.equal(reward.phase, "cards");
  assert.equal(reward.faceUp, true);

  assert.equal(Reward.pick(reward, 2), true);
  assert.equal(reward.phase, "reveal");
  assert.equal(reward.picked, 2);
  assert.equal(Reward.pick(reward, 1), false, "一张牌只选一次");
  assert.equal(Reward.pick(reward, 9), false, "没有第五张牌");
});

test("a pick outside the card phase does nothing", () => {
  const reward = Reward.create({ seed: 7 });
  assert.equal(Reward.pick(reward, 0), false, "战绩页上不能选牌");
  Reward.step(reward, Reward.TIMES.stats);
  assert.equal(Reward.pick(reward, 0), false, "宝箱还没开完也不能选");
});

test("different seeds do not all pay the same card", () => {
  const paid = [1, 7, 42, 20260915, 5, 99, 1234].map((seed) => {
    const reward = Reward.create({ seed });
    return reward.item + ":" + reward.gold;
  });
  assert.ok(new Set(paid).size > 1, `the reward must vary: ${paid.join(" | ")}`);
});

test("the item is one of the client's own cyan loot names", () => {
  const pool = Core.LOOT.cyan;
  for (let seed = 1; seed <= 50; seed += 1) {
    assert.ok(pool.includes(Reward.create({ seed }).item), `seed ${seed} paid an unknown item`);
  }
});

test("a card cannot be picked while the backs are still showing", () => {
  const reward = Reward.create({ seed: 11 });
  Reward.step(reward, Reward.TIMES.stats + Reward.TIMES.chest);
  assert.equal(reward.phase, "cards");
  assert.equal(reward.faceUp, false);
  assert.equal(Reward.pick(reward, 2), false, "the backs have not flipped yet");
  Reward.step(reward, Reward.TIMES.flip);
  assert.equal(reward.faceUp, true);
  assert.equal(Reward.pick(reward, 2), true, "after the flip the third card is selectable");
  assert.equal(reward.picked, 2);
});


test("the shared result animation clock stays continuous across page changes", () => {
  const reward = Reward.create({ seed: 25 });
  Reward.step(reward, Reward.TIMES.stats);
  assert.equal(reward.phase, "chest");
  assert.equal(reward.elapsed, Reward.TIMES.stats);
  Reward.step(reward, Reward.TIMES.chest);
  assert.equal(reward.phase, "cards");
  const elapsed = reward.elapsed;
  Reward.step(reward, Reward.TIMES.flip);
  assert.equal(Reward.pick(reward, 2), true);
  assert.equal(reward.t, 0);
  assert.equal(reward.elapsed, elapsed + Reward.TIMES.flip, "a pick cannot jump the circle back to its initial angle");
  Reward.step(reward, Reward.TIMES.reveal);
  assert.equal(reward.phase, "done");
  assert.equal(Reward.snapshot(reward).elapsed, Math.round(reward.elapsed * 1000) / 1000);
});

// V1 348.633/349.133 and V2 401.2/401.7: prompt then counter, .5s apart.
test("recorded card spread and cyan fade precede the prompt and countdown", () => {
  const reward = Reward.create({ seed: 26 });
  Reward.step(reward, Reward.TIMES.stats + Reward.TIMES.chest);
  Reward.step(reward, 0.6);
  let s = Reward.snapshot(reward);
  assert.ok(s.spread > 0.4 && s.spread < 0.6, "halfway through the measured 1.2s spread");
  assert.equal(s.faceUp, false);
  assert.equal(s.promptVisible, false);
  assert.equal(s.countdownVisible, false);
  Reward.step(reward, 0.7);
  s = Reward.snapshot(reward);
  assert.equal(s.spread, 1);
  assert.ok(s.blue > 0 && s.blue < 1, "cyan washes off all four cards together");
  assert.equal(s.faceUp, false);
  Reward.step(reward, 0.65);
  s = Reward.snapshot(reward);
  assert.equal(s.faceUp, true);
  assert.equal(s.promptVisible, false);
  assert.equal(s.countdownVisible, false);
  Reward.step(reward, 0.15);
  s = Reward.snapshot(reward);
  assert.equal(s.promptVisible, true);
  assert.equal(s.countdownVisible, false, "the digit is not simultaneous with the prompt");
  Reward.step(reward, 0.5);
  assert.equal(Reward.snapshot(reward).countdownVisible, true);
  assert.equal(reward.countdown, 3);
  Reward.step(reward, 1);
  assert.equal(reward.countdown, 2);
  Reward.step(reward, 1);
  assert.equal(reward.countdown, 1);
  Reward.step(reward, 1);
  assert.equal(reward.phase, "reveal");
  assert.equal(reward.picked, 0);
});

test("the recorded stats page lasts about ten seconds", () => {
  const reward = Reward.create({ seed: 26 });
  Reward.step(reward, 9.9);
  assert.equal(reward.phase, "stats");
  Reward.step(reward, 0.2);
  assert.equal(reward.phase, "chest");
  assert.ok(Math.abs(reward.t - 0.1) < 1e-9);
});

test("a delayed frame preserves the same reward events as many short frames", () => {
  const one = Reward.create({ seed: 26 });
  const many = Reward.create({ seed: 26 });
  const duration = Reward.TIMES.stats + Reward.TIMES.chest + 5.6;
  Reward.step(one, duration);
  for (let i = 0; i < 1000; i++) Reward.step(many, duration / 1000);
  assert.deepEqual(Reward.snapshot(one), Reward.snapshot(many));
  assert.equal(one.phase, "reveal");
  assert.ok(Math.abs(one.t - 0.1) < 1e-8);
});
