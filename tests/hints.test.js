"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Hints = require("../src/hints.js");
const Core = require("../src/core.js");

/** A quiet opening state: nothing is true yet, so no hint should fire. */
function opening(seed) {
  const state = Core.createState({ seed: seed === undefined ? 1 : seed });
  state.time = 0;
  return state;
}

test("a fresh run says nothing until the player has had a moment", () => {
  const state = opening();
  assert.equal(Hints.select(state, {}), null, "no hint in the first instant");

  state.time = 2;
  const first = Hints.select(state, {});
  assert.ok(first, "the opening hint should arrive shortly after the start");
  assert.equal(first.id, "move");
  assert.ok(first.text.includes("移动"), `the opening hint should teach movement: ${first.text}`);
  assert.ok(first.life > 0, "a hint needs a lifetime so it can clear");
});

test("each hint lands once per run", () => {
  const state = opening();
  state.time = 2;
  const seen = {};
  const first = Hints.select(state, seen);
  seen[first.id] = true;

  assert.equal(
    Hints.select(state, seen),
    null,
    "a hint that has been shown must not come back while nothing else is true"
  );
});

test("the urgent moments outrank the informational ones", () => {
  const state = opening();
  state.time = 30;
  state.stats.kills = 4;
  assert.equal(Hints.select(state, { move: true }).id, "firstBlood");

  state.upgradeChoice = { options: ["attack", "maxHp", "mpRegen"], picked: null };
  assert.equal(
    Hints.select(state, { move: true }).id,
    "upgrade",
    "a blocked gate is more urgent than a combo tip"
  );

  state.hazards = [{ x: 600, radius: 70, stage: "cracking" }];
  assert.equal(
    Hints.select(state, { move: true }).id,
    "hazard",
    "a 1.35s warning window beats everything else"
  );
});

test("every trigger fires on the state it describes", () => {
  const state = opening();
  state.time = 30;
  state.stats.kills = 1;
  assert.equal(Hints.select(state, {}).id, "firstBlood");

  state.upgradeChoice = { options: ["attack"], picked: null };
  assert.equal(Hints.select(state, {}).id, "upgrade");

  state.upgradeChoice = null;
  state.hazards = [{ x: 600, radius: 70, stage: "collapsing" }];
  assert.equal(
    Hints.select(state, { firstBlood: true }),
    null,
    "the trap tip is about the warning, not the hit"
  );
  state.hazards = [{ x: 600, radius: 70, stage: "cracking" }];
  assert.equal(Hints.select(state, {}).id, "hazard");

  state.hazards = [];
  state.player.hp = Math.floor(state.player.maxHp * Hints.LOW_HP_RATIO) - 1;
  assert.equal(Hints.select(state, {}).id, "lowHp");

  state.player.hp = state.player.maxHp;
  assert.equal(Hints.select(state, {}).id, "firstBlood", "a healthy player gets no caution");
});

test("a dying player is not nagged", () => {
  const state = opening();
  state.time = 30;
  state.stats.kills = 1;
  state.player.hp = 0;
  assert.equal(Hints.select(state, {}).id, "firstBlood", "no low-health tip at zero");
});

test("every hint is a short line with something to do", () => {
  Hints.HINTS.forEach((hint) => {
    assert.ok(hint.id && typeof hint.id === "string", "hints need an id to be seen-once");
    assert.ok(
      hint.text.length >= 8 && hint.text.length <= 40,
      `"${hint.text}" is too long or too short`
    );
    assert.ok(hint.life > 0 && hint.life <= 8, `"${hint.id}" needs a sane lifetime`);
    assert.equal(typeof hint.when, "function", `"${hint.id}" needs a trigger`);
  });
  assert.equal(
    new Set(Hints.HINTS.map((hint) => hint.id)).size,
    Hints.HINTS.length,
    "ids must be unique or the seen-once memory would skip one"
  );
});

test("a broken trigger cannot take the game down", () => {
  const hostile = {
    get time() {
      throw new Error("boom");
    }
  };
  assert.doesNotThrow(() => Hints.select(hostile, {}));
  assert.equal(Hints.select(hostile, {}), null);
});

test("a frozen run never hints", () => {
  /* The title screen does not step the sim, so time stays put and nothing fires. */
  const state = opening();
  for (let frame = 0; frame < Core.FPS * 60; frame += 1) {
    if (Hints.select(state, {})) {
      assert.fail(`hinted at time ${state.time} before the run started`);
    }
  }
});
