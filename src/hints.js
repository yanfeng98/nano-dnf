/*
 * Onboarding hints: what to tell a player, and when.
 *
 * Pure data + pure selection so the rules can be unit tested without a DOM.
 * Loaded as `window.DNFHints` in the browser and as a CommonJS module in Node.
 * The shell owns the "already shown" memory and the display timer.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.DNFHints = factory(root.DNFCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  var LOW_HP_RATIO = 0.35;
  /*
   * How far off a monster's row a cut still crosses, taken from the game rather
   * than guessed: a hint that says "you are on the wrong row" has to use the
   * same number the hit test does, or it tells the player to walk when he is
   * already there.
   */
  var ROW_REACH = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;

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
      id: "row",
      text: "站到怪那一行才打得到它：↑ ↓ 走进 / 走出屏幕",
      life: 5,
      when: function (state) {
        /*
         * He is swinging and every monster is off his row - which is the one way
         * a cut can land nothing and give the player no clue why. A caster holds
         * its row on purpose (see Core's chooseEnemyAction), so without this the
         * fight he cannot win is also a fight that says nothing.
         */
        if (state.player.attackTimer <= 0) return false;
        var alive = state.enemies.filter(function (enemy) {
          return !enemy.dead;
        });
        if (!alive.length) return false;
        return alive.every(function (enemy) {
          return Math.abs((enemy.z || 0) - (state.player.z || 0)) > ROW_REACH;
        });
      }
    },
    {
      id: "move",
      text: "← → ↑ ↓ 移动 · C 跳跃 · X 普攻",
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
