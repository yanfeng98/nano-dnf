"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Attract = require("../src/attract.js");
const Core = require("../src/core.js");

/** Step a demo session for whole seconds at the game's fixed step. */
function run(session, seconds) {
  const frames = Math.round(seconds / Core.DT);
  for (let frame = 0; frame < frames; frame += 1) Attract.step(session, Core.DT);
  return session;
}

function demo(seed) {
  return Attract.create({ seed: seed === undefined ? Core.DEFAULT_SEED : seed });
}

/** The real run a player would be looking at while the demo plays. */
function realRun(seed) {
  const state = Core.createState({ seed: seed === undefined ? Core.DEFAULT_SEED : seed });
  /* A run in progress, so an accidental write has something to damage. */
  Core.runFrames(state, 240, { right: true, attack: true });
  return state;
}

test("the demo plays in its own run and never touches the real one", () => {
  const live = realRun();
  const before = JSON.stringify(live);
  const session = demo();

  run(session, 30);

  assert.equal(JSON.stringify(live), before, "the demo wrote into the real run");
  /* And the two runs are genuinely different objects, not a shared reference. */
  assert.notEqual(session.state, live);
  assert.ok(session.state.stats.kills > 0, "the demo should be fighting in its own run");
});

test("the demo clears the opening room and takes an upgrade card", () => {
  const session = demo();
  run(session, 12);
  const opening = Attract.snapshot(session);

  assert.ok(opening.upgradePicks >= 1, `the demo never took a card: ${JSON.stringify(opening)}`);
  assert.ok(opening.kills >= 1, "the demo never killed anything");

  run(session, 8);
  assert.ok(
    session.state.roomIndex >= 1,
    "the demo never walked through the gate it opened"
  );
});

test("the same seed replays the same demo", () => {
  const left = demo(1234);
  const right = demo(1234);

  for (let second = 0; second < 20; second += 1) {
    run(left, 1);
    run(right, 1);
    assert.equal(
      JSON.stringify(Attract.snapshot(right)),
      JSON.stringify(Attract.snapshot(left)),
      `the demo drifted at second ${second}`
    );
  }
});

test("the demo does not lean on the ambient random generator", () => {
  const session = demo();
  const realRandom = Math.random;
  Math.random = () => {
    throw new Error("the demo reached for Math.random");
  };
  try {
    assert.doesNotThrow(() => run(session, 20), "the demo has to replay exactly");
  } finally {
    Math.random = realRandom;
  }
});

test("the demo loops back to the first room instead of ending", () => {
  const session = demo();
  run(session, Attract.MAX_SECONDS + 5);

  assert.ok(session.loops >= 1, "a finished demo run has to restart");
  assert.ok(session.upgradePicks >= 1, "the replay still shows the card pick");
  assert.ok(session.state.roomIndex < session.state.layout.length);
  assert.equal(session.state.player.dead, false);
});

test("a card the demo cannot take still cannot wedge it", () => {
  const session = demo();
  run(session, 5);
  if (session.state.upgradeChoice) session.state.upgradeChoice.options = [];

  run(session, Attract.MAX_SECONDS + 5);

  assert.ok(session.loops >= 1, "the demo has to restart rather than sit on a dead card");
});

test("the scripted input is well formed and leaves the state alone", () => {
  const session = demo();
  run(session, 3);
  const before = JSON.stringify(session.state);

  for (let frame = 0; frame < 300; frame += 1) {
    const input = Attract.decide(session);
    assert.equal(typeof input.left, "boolean");
    assert.equal(typeof input.right, "boolean");
    assert.equal(typeof input.jump, "boolean");
    assert.equal(typeof input.attack, "boolean");
    assert.ok(!(input.left && input.right), "the script must not walk both ways");
    Core.SKILL_ORDER.forEach((skillId) => {
      assert.equal(typeof input.skills[skillId], "boolean", `${skillId} missing from the script`);
    });
    /* Reading the script must not advance or edit the demo. */
    assert.equal(JSON.stringify(session.state), before);
  }

  /* A demo that has already won or lost stops asking for input. */
  session.state.victory = true;
  const quiet = Attract.decide(session);
  assert.deepEqual(
    { left: quiet.left, right: quiet.right, jump: quiet.jump, attack: quiet.attack },
    { left: false, right: false, jump: false, attack: false }
  );
});
