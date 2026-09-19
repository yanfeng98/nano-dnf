"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Summary = require("../src/summary.js");
const Records = require("../src/records.js");
const Core = require("../src/core.js");

function rowOf(table, id) {
  const row = table.rows.filter((entry) => entry.id === id)[0];
  assert.ok(row, `the summary has no ${id} row`);
  return row;
}

test("the summary lists the run's own numbers", () => {
  const table = Summary.describe({
    seed: 20260915,
    seconds: 49.38,
    level: 5,
    upgrades: ["attack", "maxHp", "mpRegen"],
    kills: 14,
    damageTaken: 7
  });

  assert.deepEqual(
    table.rows.map((row) => row.id),
    ["seed", "time", "level", "upgrades", "kills", "damage"],
    "row ids are the stable contract"
  );
  assert.equal(rowOf(table, "seed").value, "20260915");
  assert.equal(rowOf(table, "time").value, "0:49.3");
  assert.equal(rowOf(table, "level").value, "Lv 5");
  assert.equal(rowOf(table, "upgrades").value, "锐锋 · 体魄 · 灵息");
  assert.equal(rowOf(table, "kills").value, "14");
  assert.equal(rowOf(table, "damage").value, "7");
});

test("a run with nothing picked says so instead of printing nothing", () => {
  const table = Summary.describe({ seed: 7, seconds: 12, level: 1, upgrades: [] });
  assert.equal(rowOf(table, "upgrades").value, "无");
  assert.equal(table.upgradeNames.length, 0);
});

test("the table says how far the run got", () => {
  const reached = Summary.describe({ seed: 1, room: 2, rooms: 5 });
  assert.equal(rowOf(reached, "reached").value, "第 3/5 层", "roomIndex 2 is the third room");
  assert.equal(Summary.describe({ seed: 1, room: 0, rooms: 5 }).rows.length, 7);

  /* A run that never left the first room, and one that cannot be trusted. */
  assert.equal(rowOf(Summary.describe({ room: 0, rooms: 5 }), "reached").value, "第 1/5 层");
  assert.equal(rowOf(Summary.describe({ room: -4, rooms: 5 }), "reached").value, "第 1/5 层");
  assert.equal(rowOf(Summary.describe({ room: 99, rooms: 5 }), "reached").value, "第 5/5 层");

  /* Without a room count there is nothing honest to say, so the row is absent. */
  assert.ok(
    Summary.describe({ seed: 1 }).rows.every((row) => row.id !== "reached"),
    "no room total means no reached row"
  );
});

test("an unknown upgrade id still shows something readable", () => {
  const table = Summary.describe({ upgrades: ["attack", "mystery"] });
  assert.deepEqual(table.upgradeNames, ["锐锋", "mystery"]);
  assert.equal(rowOf(table, "upgrades").value, "锐锋 · mystery");
});

test("the summary never prints a number it cannot vouch for", () => {
  const table = Summary.describe({ seed: "x", seconds: -5, level: 0, kills: -3, damageTaken: NaN });
  assert.equal(rowOf(table, "time").value, "--");
  assert.equal(rowOf(table, "level").value, "Lv 1");
  assert.equal(rowOf(table, "kills").value, "0");
  assert.equal(rowOf(table, "damage").value, "0");
  assert.doesNotThrow(() => Summary.describe(), "a missing run must not throw");
});

test("the clock format matches the records module exactly", () => {
  [0.04, 1, 9.96, 44.4, 59.99, 60, 61.05, 599.94, 600, 3599.9].forEach((seconds) => {
    assert.equal(
      Summary.formatSeconds(seconds),
      Records.formatSeconds(seconds),
      `the two formatters disagree at ${seconds}s`
    );
  });
});

test("a real cleared run produces a table the victory screen can print", () => {
  const state = Core.createState({ seed: 1234 });
  Core.runFrames(state, 60, { right: true, attack: true });
  state.player.upgradesTaken.push("attack", "skillPower");
  const rows = Summary.describe({
    seed: state.seed,
    seconds: state.time,
    level: state.player.level,
    upgrades: state.player.upgradesTaken,
    kills: state.stats.kills,
    damageTaken: state.stats.damageTaken
  }).rows;

  assert.equal(rows.length, 6);
  rows.forEach((row) => {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string");
    assert.ok(row.label.length > 0 && row.value.length > 0, "an empty cell is a bug");
  });
  assert.equal(rowOf({ rows }, "kills").value, String(state.stats.kills));
});
