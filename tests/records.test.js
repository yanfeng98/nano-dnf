"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Records = require("../src/records.js");

/*
 * A record belongs to one stage of one seed now: the run itself is a stage
 * (`docs/adr/0026`), so the store is keyed `<stage>:<seed>`. `STAGE` comes off
 * the module, and `OTHER_STAGE` is a second real 格兰之森 stage - it has no
 * rooms yet, but a record has never needed one.
 */
const STAGE = Records.DEFAULT_STAGE;
const OTHER_STAGE = "sunderland";

test("an empty store has no record for any seed", () => {
  const store = Records.emptyStore();

  assert.equal(store.runs, 0);
  assert.deepEqual(store.seeds, {});
  assert.equal(Records.best(store, STAGE, 7), null);
  assert.equal(Records.best(store, STAGE, "not-a-seed"), null);
});

test("the first clear becomes the record for that seed", () => {
  const outcome = Records.record(Records.emptyStore(), {
    stage: STAGE,
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
  assert.deepEqual(Records.best(outcome.store, STAGE, 7), outcome.entry);
});

test("a slower clear counts as a run but keeps the faster record", () => {
  const first = Records.record(Records.emptyStore(), {
    stage: STAGE,
    seed: 7,
    seconds: 50,
    level: 5
  });
  const second = Records.record(first.store, { stage: STAGE, seed: 7, seconds: 61, level: 7 });

  assert.equal(second.improved, false);
  assert.equal(second.entry.seconds, 50, "the faster time stands");
  assert.equal(second.entry.level, 5, "the recorded level belongs to the record run");
  assert.equal(second.entry.clears, 2, "the slower run still counts as a clear");
  assert.equal(second.store.runs, 2);
});

test("a faster clear replaces the record and reports the improvement", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { stage: STAGE, seed: 7, seconds: 50, level: 5 }).store;
  const faster = Records.record(store, { stage: STAGE, seed: 7, seconds: 44.4, level: 4 });

  assert.equal(faster.improved, true);
  assert.equal(faster.entry.seconds, 44.4);
  assert.equal(faster.entry.level, 4, "a faster run sets the level even when it is lower");
  assert.equal(faster.entry.clears, 2);
});

test("records are per seed", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { stage: STAGE, seed: 7, seconds: 50, level: 5 }).store;
  store = Records.record(store, { stage: STAGE, seed: 42, seconds: 80, level: 6 }).store;

  assert.equal(Records.best(store, STAGE, 7).seconds, 50);
  assert.equal(Records.best(store, STAGE, 42).seconds, 80);
  assert.equal(Records.best(store, STAGE, 99), null, "an unseen seed has no record");
  assert.equal(store.runs, 2);
});

test("records are per stage, so one stage's time is not another's", () => {
  let store = Records.emptyStore();
  store = Records.record(store, { stage: STAGE, seed: 7, seconds: 50, level: 5 }).store;
  store = Records.record(store, { stage: OTHER_STAGE, seed: 7, seconds: 80, level: 6 }).store;

  assert.equal(Records.best(store, STAGE, 7).seconds, 50);
  assert.equal(Records.best(store, OTHER_STAGE, 7).seconds, 80);
  assert.equal(store.runs, 2, "the same seed on two stages is two runs");

  /* The key says both halves, and the seed alone is the older spelling. */
  assert.equal(Records.keyFor(STAGE, 7), STAGE + ":7");
  assert.deepEqual(Records.parseKey(STAGE + ":7"), { stage: STAGE, seed: 7 });
  assert.deepEqual(Records.parseKey("7"), { stage: Records.DEFAULT_STAGE, seed: 7 });
  assert.equal(Records.parseKey(STAGE + ":junk"), null, "a key without a seed is not a key");
  assert.equal(Records.keyFor(STAGE, "junk"), null, "and a run without one has no key");
});

test("a run without a seed or a time is ignored instead of counted", () => {
  const store = Records.emptyStore();

  assert.equal(Records.record(store, { seconds: 50, level: 5 }).improved, false);
  assert.equal(
    Records.record(store, { stage: STAGE, seed: 7, seconds: 0, level: 5 }).store.runs,
    0
  );
  assert.equal(Records.record(store, null).store.runs, 0);
  assert.equal(Records.record(store, { stage: STAGE, seed: 7, seconds: 50 }).entry, null);
});

test("the store round-trips through JSON and survives corrupt input", () => {
  let store = Records.emptyStore();
  store = Records.record(store, {
    stage: STAGE,
    seed: 7,
    seconds: 50.25,
    level: 5,
    updatedAt: 12
  }).store;
  store = Records.record(store, {
    stage: OTHER_STAGE,
    seed: 42,
    seconds: 61.5,
    level: 6,
    updatedAt: 13
  }).store;

  const restored = Records.deserialize(Records.serialize(store));
  assert.equal(restored.runs, store.runs);
  assert.equal(Records.best(restored, STAGE, 7).seconds, 50.25);
  assert.equal(Records.best(restored, OTHER_STAGE, 42).level, 6);

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
  assert.equal(Records.best(store, STAGE, 7), null);
});

/*
 * The keys on a player's machine predate stages: a record was a bare seed, and
 * there is no character save to rebuild it from, so those runs are read as the
 * first stage's rather than thrown away (`docs/adr/0026`).
 */
test("a key written before stages existed is read as the first stage's", () => {
  const legacy = JSON.stringify({
    schemaVersion: Records.SCHEMA_VERSION,
    runs: 2,
    seeds: { "7": { seconds: 50, level: 5, clears: 2, updatedAt: 1000 } }
  });

  const store = Records.deserialize(legacy);

  assert.equal(store.runs, 2);
  assert.deepEqual(
    Object.keys(store.seeds),
    [Records.DEFAULT_STAGE + ":7"],
    "the old key is re-keyed under the default stage"
  );
  assert.equal(Records.best(store, Records.DEFAULT_STAGE, 7).seconds, 50);
  assert.equal(
    Records.best(store, OTHER_STAGE, 7),
    null,
    "and it is not credited to a stage it was never run on"
  );
});

test("the seed history is capped so storage cannot grow without bound", () => {
  let store = Records.emptyStore();
  for (let index = 0; index < Records.MAX_SEEDS + 5; index += 1) {
    store = Records.record(store, {
      stage: STAGE,
      seed: 1000 + index,
      seconds: 40 + index,
      level: 5,
      updatedAt: 1000 + index
    }).store;
  }

  assert.equal(Object.keys(store.seeds).length, Records.MAX_SEEDS);
  assert.equal(store.runs, Records.MAX_SEEDS + 5, "pruning drops seeds, not the run count");
  assert.equal(
    Records.best(store, STAGE, 1000),
    null,
    "the oldest seed is the one dropped"
  );
  assert.ok(
    Records.best(store, STAGE, 1000 + Records.MAX_SEEDS + 4),
    "the newest seed survives"
  );
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

test("the best overall looks across every seed the store remembers", () => {
  const store = Records.emptyStore();
  assert.equal(Records.bestOverall(store), null, "an empty store has no best");
  assert.equal(Records.bestOverall(null), null);

  store.seeds[STAGE + ":777"] = { seconds: 61.2, level: 4, clears: 1 };
  store.seeds[STAGE + ":1234"] = { seconds: 47.6, level: 5, clears: 2 };
  store.seeds[STAGE + ":20260915"] = { seconds: 52.1, level: 5, clears: 1 };

  const best = Records.bestOverall(store);
  assert.equal(best.stage, STAGE);
  assert.equal(best.seed, 1234);
  assert.equal(best.seconds, 47.6);
  assert.equal(best.level, 5);
  assert.equal(best.clears, 2);

  /* With a stage it answers for that stage alone - the region map asks per stage. */
  store.seeds[OTHER_STAGE + ":9"] = { seconds: 30, level: 8, clears: 1 };
  assert.equal(Records.bestOverall(store, STAGE).seed, 1234, "the other stage's faster run is not it");
  assert.equal(Records.bestOverall(store, OTHER_STAGE).seconds, 30);
  assert.equal(
    Records.bestOverall(store, "grakkarak"),
    null,
    "a stage nobody has run has no best"
  );

  /* A tie belongs to the smaller seed, whatever the key order is. */
  store.seeds[STAGE + ":1234"] = { seconds: 50, level: 5, clears: 2 };
  store.seeds[STAGE + ":777"] = { seconds: 50, level: 3, clears: 1 };
  assert.equal(Records.bestOverall(store, STAGE).seed, 777);

  /* Entries that cannot be read are skipped instead of trusted. */
  const dirty = Records.emptyStore();
  dirty.seeds["not-a-seed"] = { seconds: 10, level: 2, clears: 1 };
  dirty.seeds["9"] = { seconds: 0, level: 2, clears: 1 };
  assert.equal(Records.bestOverall(dirty), null);
});
