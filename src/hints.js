/*
 * Onboarding hints: what to tell a player, and when.
 *
 * Pure data + pure selection so the rules can be unit tested without a DOM.
 * Loaded as `window.DNFHints` in the browser and as a CommonJS module in Node.
 * The shell owns the "already shown" memory and the display timer.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFHints = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LOW_HP_RATIO = 0.35;

  /*
   * Order is priority, most urgent first: the slab warning only lasts 1.35s and
   * the upgrade card blocks the next room, while the rest can wait a beat.
   */
  var HINTS = [
    {
      id: "hazard",
      text: "地面裂开时离开那块石板",
      life: 5,
      when: function (state) {
        return (state.hazards || []).some(function (hazard) {
          return hazard.stage === "cracking";
        });
      }
    },
    {
      id: "upgrade",
      text: "选一张强化卡：按 1 / 2 / 3，或直接点卡片",
      life: 5,
      when: function (state) {
        return !!state.upgradeChoice;
      }
    },
    {
      id: "lowHp",
      text: "血量偏低：捡回血球，或先拉开距离",
      life: 4.5,
      when: function (state) {
        var player = state.player;
        return player.hp > 0 && player.hp <= player.maxHp * LOW_HP_RATIO;
      }
    },
    {
      id: "firstBlood",
      text: "四段连击：X 连按四下，第四下是收招重击",
      life: 4,
      when: function (state) {
        return state.stats.kills >= 1;
      }
    },
    {
      id: "move",
      text: "← → 移动 · C 跳跃 · X 普攻",
      life: 4.5,
      when: function (state) {
        return state.time > 1.5 && state.stats.kills === 0;
      }
    }
  ];

  /**
   * The next hint worth showing, or null.
   *
   * `seen` is a plain id -> true map owned by the caller, so each hint lands
   * once per run and a missed one does not nag forever.
   */
  function select(state, seen) {
    var shown = seen || {};
    for (var index = 0; index < HINTS.length; index += 1) {
      var hint = HINTS[index];
      if (shown[hint.id]) continue;
      if (!safeWhen(hint, state)) continue;
      return { id: hint.id, text: hint.text, life: hint.life };
    }
    return null;
  }

  /* A hint rule must never take the game down with it. */
  function safeWhen(hint, state) {
    try {
      return !!hint.when(state);
    } catch (error) {
      return false;
    }
  }

  return {
    LOW_HP_RATIO: LOW_HP_RATIO,
    HINTS: HINTS,
    select: select
  };
});
