"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Records = require("../src/records.js");

test("an empty store has no record for any seed", () => {
  const store = Records.emptyStore();

  assert.equal(store.runs, 0);
  assert.deepEqual(store.seeds, {});
  assert.equal(Records.best(store, 7), null);
  assert.equal(Records.best(store, "not-a-seed"), null);
});

test("the first clear becomes the record for that seed", () => {
  const outcome = Records.record(Records.emptyStore(), {
    seed: 7,
    seconds: 50.2,
    level: 5,
    updatedAt: 1000
  });

  assert.equal(outcome.improved, true);
  assert.equal(outcome.entry.seconds, 50.2);
  assert.equal(outcome.entry.level, 5);
  assert.equal(outcome.entry.clears, 1);
  assert.equal(outcome.store.runs, 1);
  assert.deepEqual(Records.best(outcome.store, 7), outcome.entry);
});

test("a slower clear counts as a run but keeps the faster record", () => {
  const first = Records.record(Records.emptyStore(), { seed: 7, seconds: 50, level: 5 });
  const second = Records.record(first.store, { seed: 7, seconds: 61, level: 7 });

  assert.equal(second.improved, false);
  assert.equal(second.entry.seconds, 50, "the faster time stands");
  assert.equal(second.entry.level, 5, "the recorded level belongs to the record run");
  assert.equal(second.entry.clears, 2, "the slower run still counts as a clear");
  assert.equal(second.store.runs, 2);
});

test("a faster clear replaces the record and reports the improvement", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { seed: 7, seconds: 50, level: 5 }).store;
  const faster = Records.record(store, { seed: 7, seconds: 44.4, level: 4 });

  assert.equal(faster.improved, true);
  assert.equal(faster.entry.seconds, 44.4);
  assert.equal(faster.entry.level, 4, "a faster run sets the level even when it is lower");
  assert.equal(faster.entry.clears, 2);
});

test("records are per seed", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { seed: 7, seconds: 50, level: 5 }).store;
  store = Records.record(store, { seed: 42, seconds: 80, level: 6 }).store;

  assert.equal(Records.best(store, 7).seconds, 50);
  assert.equal(Records.best(store, 42).seconds, 80);
  assert.equal(Records.best(store, 99), null, "an unseen seed has no record");
  assert.equal(store.runs, 2);
});

test("a run without a seed or a time is ignored instead of counted", () => {
  const store = Records.emptyStore();

  assert.equal(Records.record(store, { seconds: 50, level: 5 }).improved, false);
  assert.equal(Records.record(store, { seed: 7, seconds: 0, level: 5 }).store.runs, 0);
  assert.equal(Records.record(store, null).store.runs, 0);
  assert.equal(Records.record(store, { seed: 7, seconds: 50 }).entry, null);
});

test("the store round-trips through JSON and survives corrupt input", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { seed: 7, seconds: 50.25, level: 5, updatedAt: 12 }).store;
  store = Records.record(store, { seed: 42, seconds: 61.5, level: 6, updatedAt: 13 }).store;

  const restored = Records.deserialize(Records.serialize(store));
  assert.equal(restored.runs, store.runs);
  assert.equal(Records.best(restored, 7).seconds, 50.25);
  assert.equal(Records.best(restored, 42).level, 6);

  [null, "", "{not json", "[]", '{"schemaVersion":99}', '{"runs":3}'].forEach((raw) => {
    const fallback = Records.deserialize(raw);
    assert.equal(fallback.runs, 0, `corrupt input must not invent runs: ${raw}`);
    assert.deepEqual(fallback.seeds, {});
  });
});

test("a store written by an older schema is discarded rather than misread", () => {
  const legacy = JSON.stringify({
    schemaVersion: 0,
    runs: 9,
    seeds: { "7": { seconds: 10, level: 9 } }
  });

  const store = Records.deserialize(legacy);
  assert.equal(store.runs, 0);
  assert.equal(Records.best(store, 7), null);
});

test("the seed history is capped so storage cannot grow without bound", () => {
  let store = Records.emptyStore();
  for (let index = 0; index < Records.MAX_SEEDS + 5; index += 1) {
    store = Records.record(store, {
      seed: 1000 + index,
      seconds: 40 + index,
      level: 5,
      updatedAt: 1000 + index
    }).store;
  }

  assert.equal(Object.keys(store.seeds).length, Records.MAX_SEEDS);
  assert.equal(store.runs, Records.MAX_SEEDS + 5, "pruning drops seeds, not the run count");
  assert.equal(
    Records.best(store, 1000),
    null,
    "the oldest seed is the one dropped"
  );
  assert.ok(Records.best(store, 1000 + Records.MAX_SEEDS + 4), "the newest seed survives");
});

test("times are formatted as minutes and tenths", () => {
  assert.equal(Records.formatSeconds(44.4), "0:44.4");
  assert.equal(Records.formatSeconds(59.95), "0:59.9");
  assert.equal(Records.formatSeconds(60), "1:00.0");
  assert.equal(Records.formatSeconds(125.5), "2:05.5");
  assert.equal(Records.formatSeconds(0), "--");
  assert.equal(Records.formatSeconds(-4), "--");
  assert.equal(Records.formatSeconds("nope"), "--");
});
