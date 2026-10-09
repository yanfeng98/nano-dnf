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
   * Order is priority, most urgent first: the upgrade card blocks the way on,
   * while the rest can wait a beat.
   *
   * 这里原先第一条是「陷阱」（石板裂开时离开那块地板）。业主 2026-10-10 说
   * 「以后也不要有这种陷阱」，整套塌陷地板连着这条提示一起拆了（`docs/adr/0030`）。
   */
  var HINTS = [
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
      /*
       * 门口按地图方向开（`docs/adr/0030`）：不认字也知道往哪走，但"清完房门口才亮"
       * 这件事得有人说过一次。
       */
      id: "door",
      text: "清完房间门口会亮，走到那儿去下一间",
      life: 5,
      when: function (state) {
        return !!(state.room && state.room.cleared) && !state.upgradeChoice;
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
    },
    {
      /*
       * **The 一觉 has no slot, so nothing in the bar says it exists.** The tile
       * at the end of the bar is where it lives; this says it once, in words,
       * while the first fight is under way. The owner's first play of that slice
       * reported exactly this gap - 「没看到技能」 - and a move nobody is told
       * about is a move nobody casts (docs/adr/0025).
       */
      id: "awakening",
      text: "V 觉醒 · 魔狱血刹（身后背剑，再按落下）",
      life: 4.5,
      when: function (state) {
        return (
          state.time > 6 &&
          state.stats.kills >= 1 &&
          !(state.player.buffs.hellbenter > 0)
        );
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
