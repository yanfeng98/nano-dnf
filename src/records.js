/*
 * Per-stage, per-seed run records: the best clear time and level seen.
 *
 * A record is keyed by `<stage>:<seed>` - a run is one stage now, so "the best
 * time on this seed" is not a question anyone can ask without saying which
 * stage (`docs/adr/0026`). Keys written before stages existed are bare seeds;
 * they are read as belonging to the first stage rather than thrown away.
 *
 * Pure data + pure functions so the merge rules can be unit tested without a
 * DOM or localStorage. Loaded as `window.DNFRecords` in the browser and as a
 * CommonJS module in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFRecords = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  /* Keep the store small: a demo does not need an unbounded seed history. */
  var MAX_SEEDS = 40;
  /* Where a record with no stage on it belongs - the first stage of the region. */
  var DEFAULT_STAGE = "mirkwood";

  function normalizeSeed(seed) {
    var value = Number(seed);
    if (!isFinite(value)) return null;
    return Math.floor(value) >>> 0;
  }

  /** A stage id is a lowercase slug, the same shape `Core.STAGES` uses. */
  function normalizeStage(stage) {
    if (typeof stage !== "string") return null;
    var trimmed = stage.trim();
    return /^[a-z][a-z0-9]*$/.test(trimmed) ? trimmed : null;
  }

  function keyFor(stage, seed) {
    var normalized = normalizeSeed(seed);
    if (normalized === null) return null;
    return (normalizeStage(stage) || DEFAULT_STAGE) + ":" + normalized;
  }

  /** Old keys are bare seeds; they are read as the first stage's. */
  function parseKey(key) {
    var parts = String(key).split(":");
    if (parts.length === 1) {
      var bare = normalizeSeed(parts[0]);
      return bare === null ? null : { stage: DEFAULT_STAGE, seed: bare };
    }
    var stage = normalizeStage(parts[0]);
    var seed = normalizeSeed(parts[1]);
    if (stage === null || seed === null) return null;
    return { stage: stage, seed: seed };
  }

  function emptyStore() {
    return { schemaVersion: SCHEMA_VERSION, runs: 0, seeds: {} };
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    var seconds = Number(raw.seconds);
    if (!isFinite(seconds) || seconds <= 0) return null;
    var level = Math.floor(Number(raw.level));
    var clears = Math.floor(Number(raw.clears));
    var updatedAt = Math.floor(Number(raw.updatedAt));
    var entry = {
      seconds: seconds,
      level: isFinite(level) && level > 0 ? level : 1,
      clears: isFinite(clears) && clears > 0 ? clears : 1
    };
    if (isFinite(updatedAt) && updatedAt > 0) entry.updatedAt = updatedAt;
    return entry;
  }

  function deserialize(text) {
    var parsed = null;
    if (typeof text === "string" && text) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = null;
      }
    }
    var store = emptyStore();
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== SCHEMA_VERSION) {
      return store;
    }
    var runs = Math.floor(Number(parsed.runs));
    if (isFinite(runs) && runs > 0) store.runs = runs;

    var seeds = parsed.seeds && typeof parsed.seeds === "object" ? parsed.seeds : {};
    Object.keys(seeds).forEach(function (key) {
      var spot = parseKey(key);
      var entry = normalizeEntry(seeds[key]);
      if (!spot || !entry) return;
      store.seeds[spot.stage + ":" + spot.seed] = entry;
    });
    return store;
  }

  function serialize(store) {
    return JSON.stringify(store || emptyStore());
  }

  function best(store, stage, seed) {
    var key = keyFor(stage, seed);
    if (!store || !store.seeds || key === null) return null;
    return store.seeds[key] || null;
  }

  /*
   * The fastest clear of one stage across every seed the store remembers, with
   * the seed it belongs to. Ties go to the smaller seed so the answer never
   * depends on key order, and entries that cannot be read are skipped instead
   * of trusted. Without a stage it looks at every stage - the title screen
   * always passes one, the tests use the bare form.
   *
   * **An unreadable id is not "every stage".** `normalizeStage` returns null for
   * anything that is not a slug, and reading that as "no stage asked for" made a
   * typo answer with some other stage's record - which is the one way this
   * screen could show a wrong number instead of no number.
   */
  function bestOverall(store, stage) {
    if (!store || !store.seeds) return null;
    var asked = stage !== undefined && stage !== null;
    var wanted = asked ? normalizeStage(stage) : null;
    if (asked && wanted === null) return null;
    var winner = null;
    Object.keys(store.seeds).forEach(function (key) {
      var spot = parseKey(key);
      var entry = normalizeEntry(store.seeds[key]);
      if (!spot || !entry) return;
      if (wanted !== null && spot.stage !== wanted) return;
      if (
        !winner ||
        entry.seconds < winner.seconds ||
        (entry.seconds === winner.seconds && spot.seed < winner.seed)
      ) {
        winner = {
          stage: spot.stage,
          seed: spot.seed,
          seconds: entry.seconds,
          level: entry.level,
          clears: entry.clears
        };
      }
    });
    return winner;
  }

  function prune(seeds) {
    var keys = Object.keys(seeds);
    if (keys.length <= MAX_SEEDS) return seeds;
    keys
      .sort(function (a, b) {
        return (seeds[a].updatedAt || 0) - (seeds[b].updatedAt || 0);
      })
      .slice(0, keys.length - MAX_SEEDS)
      .forEach(function (key) {
        delete seeds[key];
      });
    return seeds;
  }

  /**
   * Fold one cleared run into the store.
   *
   * Returns a fresh store plus whether this run improved the seed's record, so
   * the shell can say "new record" without re-deriving the comparison. A run
   * that is not a clear (no seed, no time) is ignored rather than counted.
   */
  function record(store, run) {
    var base = store && typeof store === "object" ? store : emptyStore();
    var seconds = Number(run && run.seconds);
    var level = Math.floor(Number(run && run.level));
    var key = keyFor(run && run.stage, run && run.seed);

    if (
      key === null ||
      !isFinite(seconds) ||
      seconds <= 0 ||
      !isFinite(level) ||
      level <= 0
    ) {
      return { store: base, improved: false, entry: null };
    }

    var seeds = {};
    Object.keys(base.seeds || {}).forEach(function (key2) {
      seeds[key2] = base.seeds[key2];
    });

    var previous = seeds[key] || null;
    var improved =
      !previous || seconds < previous.seconds || (seconds === previous.seconds && level > previous.level);
    var clears = (previous ? previous.clears : 0) + 1;
    var entry = {
      seconds: improved ? seconds : previous.seconds,
      level: improved ? level : previous.level,
      clears: clears
    };
    var updatedAt = Math.floor(Number(run && run.updatedAt));
    if (isFinite(updatedAt) && updatedAt > 0) {
      entry.updatedAt = updatedAt;
    } else if (previous && previous.updatedAt) {
      entry.updatedAt = previous.updatedAt;
    }
    seeds[key] = entry;

    return {
      store: {
        schemaVersion: SCHEMA_VERSION,
        runs: Math.floor(Number(base.runs) || 0) + 1,
        seeds: prune(seeds)
      },
      improved: improved,
      entry: entry
    };
  }

  /** "0:47.3" - a demo-scale run never needs an hours field. */
  function formatSeconds(seconds) {
    var value = Number(seconds);
    if (!isFinite(value) || value <= 0) return "--";
    /* Work in tenths so 44.4 does not print as 0:44.3 through float error. */
    var total = Math.floor(value * 10 + 1e-6);
    var minutes = Math.floor(total / 600);
    var rest = total - minutes * 600;
    var whole = Math.floor(rest / 10);
    var tenths = rest - whole * 10;
    return minutes + ":" + (whole < 10 ? "0" : "") + whole + "." + tenths;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_SEEDS: MAX_SEEDS,
    DEFAULT_STAGE: DEFAULT_STAGE,
    emptyStore: emptyStore,
    deserialize: deserialize,
    serialize: serialize,
    keyFor: keyFor,
    parseKey: parseKey,
    best: best,
    bestOverall: bestOverall,
    record: record,
    formatSeconds: formatSeconds
  };
});
