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

test("the share link reopens one exact seed", () => {
  assert.equal(Summary.seedUrl("https://x.dev/nano-dnf/", 123), "https://x.dev/nano-dnf/?seed=123");
  assert.equal(
    Summary.seedUrl("https://x.dev/nano-dnf/?touch=1", 7),
    "https://x.dev/nano-dnf/?touch=1&seed=7"
  );
  /* An existing seed is replaced, not appended twice. */
  assert.equal(Summary.seedUrl("https://x.dev/p/?seed=5", 9), "https://x.dev/p/?seed=9");
  assert.equal(
    Summary.seedUrl("https://x.dev/p/?seed=5&touch=1", 9),
    "https://x.dev/p/?touch=1&seed=9"
  );
  assert.equal(Summary.seedUrl("https://x.dev/p/#top", 9), "https://x.dev/p/?seed=9#top");
  assert.equal(Summary.seedUrl("index.html", 9), "index.html?seed=9");

  /* A seed that cannot be trusted never becomes a link. */
  [0, -1, 1.5, NaN, "abc", undefined, null].forEach((bad) => {
    assert.equal(Summary.seedUrl("https://x.dev/", bad), null, `${bad} should not build a link`);
  });
  assert.equal(Summary.seedUrl("", 5), null);
});

test("the live variant reads the run that is still going", () => {
  const state = Core.createState({ seed: 4242 });
  Core.runFrames(state, 300, { right: true, attack: true });
  state.player.upgradesTaken.push("attack");

  const table = Summary.liveRun(state, 4242);
  const rows = table.rows;
  const value = (id) => rows.filter((row) => row.id === id)[0].value;

  assert.equal(value("seed"), "4242");
  assert.equal(value("time"), Summary.formatSeconds(state.time));
  assert.equal(value("level"), "Lv " + state.player.level);
  assert.equal(value("upgrades"), "锐锋");
  assert.equal(value("kills"), String(state.stats.kills));
  assert.equal(value("damage"), String(state.stats.damageTaken));
  assert.equal(value("reached"), "第 1/" + state.layout.length + " 层");

  /* A half-built state must not throw or invent numbers. */
  assert.doesNotThrow(() => Summary.liveRun(null, 9));
  assert.equal(Summary.liveRun({}, 9).rows.length, 6, "no layout means no reached row");
});

test("the pace line knows which side of the record the run is on", () => {
  const record = { seconds: 50, level: 5, clears: 1 };

  const noRecord = Summary.pace(12, null);
  assert.equal(noRecord.state, "none");
  assert.equal(noRecord.text, "本种子还没有记录");

  const ahead = Summary.pace(41.4, record);
  assert.equal(ahead.state, "ahead");
  assert.equal(ahead.delta, -8.6);
  assert.equal(ahead.text, "领先最佳 8.6s（最佳 0:50.0）");

  /* Crossing the record flips it, and a tie is still the good side. */
  const tie = Summary.pace(50, record);
  assert.equal(tie.state, "ahead");
  assert.equal(tie.delta, 0);

  const behind = Summary.pace(63.25, record);
  assert.equal(behind.state, "behind");
  assert.equal(behind.delta, 13.3, "the clock is reported in tenths");
  assert.equal(behind.text, "落后最佳 13.3s（最佳 0:50.0）");

  /* A clock or a record that cannot be trusted prints nothing rather than a lie. */
  assert.equal(Summary.pace(0, record).state, "none");
  assert.equal(Summary.pace(NaN, record).state, "none");
  assert.equal(Summary.pace(10, { seconds: 0 }).state, "none");
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
