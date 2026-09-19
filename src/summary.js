/*
 * End-of-run summary: the numbers one clear is worth.
 *
 * Pure module - no DOM, no storage, no clock - so the table the victory screen
 * draws can be unit tested, and so the browser proof can compare it against the
 * run it actually played. Loaded as `window.DNFSummary` in the browser and as a
 * CommonJS module in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.DNFSummary = factory(root.DNFCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  /*
   * Tenths, like `Records.formatSeconds` (a unit test pins the two together), so
   * 44.4 never prints as 0:44.3 through float error.
   */
  function formatSeconds(seconds) {
    var value = Number(seconds);
    if (!isFinite(value) || value <= 0) return "--";
    var total = Math.floor(value * 10 + 1e-6);
    var minutes = Math.floor(total / 600);
    var rest = total - minutes * 600;
    var whole = Math.floor(rest / 10);
    var tenths = rest - whole * 10;
    return minutes + ":" + (whole < 10 ? "0" : "") + whole + "." + tenths;
  }

  /* Upgrade ids are public-safe, but the screen should read like the game does. */
  function upgradeNames(ids) {
    return (ids || []).map(function (id) {
      var spec = Core.UPGRADES[id];
      return spec ? spec.name : String(id);
    });
  }

  function whole(value, fallback) {
    var number = Math.floor(Number(value));
    return isFinite(number) && number >= 0 ? number : fallback;
  }

  /*
   * The link that reopens one exact run. Pure string work so it can be tested
   * without a DOM: keep whatever else the URL carries (the touch switch, a hash)
   * and replace the seed in place rather than dropping the reader's context.
   */
  function seedUrl(href, seed) {
    var seedValue = Number(seed);
    if (!isFinite(seedValue) || seedValue <= 0 || Math.floor(seedValue) !== seedValue) return null;
    var text = String(href === undefined || href === null ? "" : href);
    if (!text) return null;

    var hash = "";
    var hashAt = text.indexOf("#");
    if (hashAt !== -1) {
      hash = text.slice(hashAt);
      text = text.slice(0, hashAt);
    }
    var query = "";
    var queryAt = text.indexOf("?");
    if (queryAt !== -1) {
      query = text.slice(queryAt + 1);
      text = text.slice(0, queryAt);
    }

    var kept = query
      .split("&")
      .filter(function (pair) {
        return pair && pair.split("=")[0] !== "seed";
      });
    kept.push("seed=" + whatInteger(seedValue));
    return text + "?" + kept.join("&") + hash;
  }

  function whatInteger(value) {
    return String(Math.floor(value) >>> 0);
  }

  /*
   * The rows the victory screen draws. `id` is stable so tests and the browser
   * proof can address a row without matching on translated labels.
   */
  function describe(run) {
    run = run || {};
    var names = upgradeNames(run.upgrades);
    var level = whole(run.level, 1);
    var rows = [
      { id: "seed", label: "种子", value: String(whole(run.seed, 0)) },
      { id: "time", label: "用时", value: formatSeconds(run.seconds) },
      { id: "level", label: "等级", value: "Lv " + (level < 1 ? 1 : level) },
      { id: "upgrades", label: "强化", value: names.length ? names.join(" · ") : "无" },
      { id: "kills", label: "击杀", value: String(whole(run.kills, 0)) },
      { id: "damage", label: "承伤", value: String(whole(run.damageTaken, 0)) }
    ];
    /*
     * How far the run got. A lost run needs this more than a won one, but the
     * clear screen shows it too so both endings read the same way.
     */
    var rooms = whole(run.rooms, 0);
    if (rooms > 0) {
      var reached = Math.min(rooms, whole(run.room, 0) + 1);
      rows.push({
        id: "reached",
        label: "到达",
        value: "第 " + (reached < 1 ? 1 : reached) + "/" + rooms + " 层"
      });
    }
    return {
      rows: rows,
      upgradeNames: names
    };
  }

  return {
    formatSeconds: formatSeconds,
    upgradeNames: upgradeNames,
    describe: describe,
    seedUrl: seedUrl
  };
});
