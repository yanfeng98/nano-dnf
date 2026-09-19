/*
 * Per-seed run records: the best clear time and level seen for a seed.
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

  function normalizeSeed(seed) {
    var value = Number(seed);
    if (!isFinite(value)) return null;
    return Math.floor(value) >>> 0;
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
      var seed = normalizeSeed(key);
      var entry = normalizeEntry(seeds[key]);
      if (seed === null || !entry) return;
      store.seeds[String(seed)] = entry;
    });
    return store;
  }

  function serialize(store) {
    return JSON.stringify(store || emptyStore());
  }

  function best(store, seed) {
    var normalized = normalizeSeed(seed);
    if (!store || !store.seeds || normalized === null) return null;
    return store.seeds[String(normalized)] || null;
  }

  /*
   * The fastest clear across every seed the store remembers, with the seed it
   * belongs to. Ties go to the smaller seed so the answer never depends on key
   * order, and entries that cannot be read are skipped instead of trusted.
   */
  function bestOverall(store) {
    if (!store || !store.seeds) return null;
    var winner = null;
    Object.keys(store.seeds).forEach(function (key) {
      var seed = normalizeSeed(key);
      var entry = normalizeEntry(store.seeds[key]);
      if (seed === null || !entry) return;
      if (
        !winner ||
        entry.seconds < winner.seconds ||
        (entry.seconds === winner.seconds && seed < winner.seed)
      ) {
        winner = {
          seed: seed,
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
    var seed = normalizeSeed(run && run.seed);
    var seconds = Number(run && run.seconds);
    var level = Math.floor(Number(run && run.level));

    if (
      seed === null ||
      !isFinite(seconds) ||
      seconds <= 0 ||
      !isFinite(level) ||
      level <= 0
    ) {
      return { store: base, improved: false, entry: null };
    }

    var seeds = {};
    Object.keys(base.seeds || {}).forEach(function (key) {
      seeds[key] = base.seeds[key];
    });

    var key = String(seed);
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
    emptyStore: emptyStore,
    deserialize: deserialize,
    serialize: serialize,
    best: best,
    bestOverall: bestOverall,
    record: record,
    formatSeconds: formatSeconds
  };
});
