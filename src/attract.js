/*
 * Attract mode: the self-playing demo that runs behind the title screen.
 *
 * Everything here works on one demo-owned Core state plus a scripted input
 * policy, so the demo replays exactly and a real run sitting next to it in the
 * same page is never touched. Loaded as `window.DNFAttract` in the browser and
 * as a CommonJS module in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.DNFAttract = factory(root.DNFCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  /* A beat after a room empties, so the card choice is visible before it is taken. */
  var PICK_DELAY = 0.9;
  /* At most one skill this often: the demo is a showcase, not a DPS race. */
  var SKILL_GAP = 2.6;
  /* Swing from here instead of walking into the enemy's own hitbox. */
  var APPROACH = 58;
  /* An enemy this far above the Slayer is worth a jump before the swing. */
  var LEAP_GAP = 120;
  /* Long demos stop being demos, so a stalled run is restarted. */
  var MAX_SECONDS = 45;
  /* A finished run holds its last frame for a beat, so the end reads on screen. */
  var HOLD_SECONDS = 2.5;

  function create(options) {
    options = options || {};
    var session = {
      seed: typeof options.seed === "number" ? options.seed : Core.DEFAULT_SEED,
      state: null,
      seconds: 0,
      loops: 0,
      upgradePicks: 0,
      /* Sticky across loops: what the visitor has been shown so far. */
      phase2Runs: 0,
      clears: 0,
      skillWait: 0,
      pickArmed: false,
      pickWait: 0,
      finished: false,
      holdWait: 0,
      countedPhase2: false,
      countedClear: false
    };
    reset(session);
    return session;
  }

  /*
   * A fresh demo run. The seed is kept, so a visitor who reloads the page sees
   * the same opening fight instead of a different one every time.
   */
  function reset(session) {
    session.state = Core.createState({ seed: session.seed });
    session.seconds = 0;
    session.skillWait = 0;
    session.pickArmed = false;
    session.pickWait = 0;
    session.finished = false;
    session.holdWait = 0;
    session.countedPhase2 = false;
    session.countedClear = false;
    return session.state;
  }

  function livingEnemies(state) {
    return state.enemies.filter(function (enemy) {
      return !enemy.dead;
    });
  }

  function nearestEnemy(state) {
    var best = null;
    var bestDistance = Infinity;
    livingEnemies(state).forEach(function (enemy) {
      var distance = Math.abs(enemy.x - state.player.x);
      if (distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    });
    return best;
  }

  function bossEnemy(state) {
    for (var index = 0; index < state.enemies.length; index += 1) {
      if (state.enemies[index].type === "boss") return state.enemies[index];
    }
    return null;
  }

  function emptyInput() {
    var input = { left: false, right: false, jump: false, attack: false, skills: {} };
    Core.SKILL_ORDER.forEach(function (skillId) {
      input.skills[skillId] = false;
    });
    return input;
  }

  /*
   * The scripted player. It walks to the nearest enemy, swings while standing in
   * reach, spends a skill when one is ready, and walks to the gate when the room
   * is empty. Read-only with respect to the simulation: it only reports input.
   */
  function decide(session) {
    var state = session.state;
    var input = emptyInput();
    if (state.victory || state.defeat) return input;
    /* The card is taken on a timer so the demo pauses on the choice. */
    if (state.upgradeChoice) return input;

    var target = nearestEnemy(state);
    if (!target) {
      input.right = true;
      return input;
    }

    var dx = target.x - state.player.x;
    if (Math.abs(dx) > APPROACH) {
      if (dx > 0) input.right = true;
      else input.left = true;
      return input;
    }

    /*
     * Holding the direction keeps the swing pointed at the target; the rooted
     * attack damps the walk, so it reads as a step-in combo rather than a charge.
     */
    if (dx < 0) input.left = true;
    input.attack = true;
    if (state.player.onGround && target.y < state.player.y - LEAP_GAP) input.jump = true;
    var skill = readySkill(session, state);
    if (skill) input.skills[skill] = true;
    return input;
  }

  function readySkill(session, state) {
    if (session.skillWait > 0) return null;
    var player = state.player;
    for (var index = 0; index < Core.SKILL_ORDER.length; index += 1) {
      var skillId = Core.SKILL_ORDER[index];
      var spec = Core.SKILLS[skillId];
      if (!spec) continue;
      if (player.skillCooldowns[skillId] > 0) continue;
      if (player.mp < spec.mp) continue;
      session.skillWait = SKILL_GAP;
      return skillId;
    }
    return null;
  }

  /* One simulation step of the demo. Replays the run once it ends. */
  function step(session, dt) {
    dt = typeof dt === "number" && dt > 0 ? dt : Core.DT;
    var state = session.state;

    /*
     * A finished run (cleared, lost or timed out) holds its last frame before it
     * loops: otherwise the boss's phase-two rage and the clear banner would pass
     * by in a single frame on the title screen.
     */
    if (session.finished || state.victory || state.defeat || session.seconds >= MAX_SECONDS) {
      if (!session.finished) {
        session.finished = true;
        session.holdWait = HOLD_SECONDS;
      }
      session.holdWait = Math.max(0, session.holdWait - dt);
      if (session.holdWait === 0) {
        session.loops += 1;
        reset(session);
      }
      return session;
    }

    if (state.upgradeChoice) {
      if (!session.pickArmed) {
        session.pickArmed = true;
        session.pickWait = PICK_DELAY;
      }
      session.pickWait = Math.max(0, session.pickWait - dt);
      if (session.pickWait === 0 && Core.chooseUpgrade(state, state.upgradeChoice.options[0])) {
        session.upgradePicks += 1;
        session.pickArmed = false;
      }
    } else {
      session.pickArmed = false;
      session.pickWait = 0;
    }

    session.skillWait = Math.max(0, session.skillWait - dt);
    Core.step(state, decide(session), dt);
    session.seconds += dt;

    var boss = bossEnemy(state);
    if (boss && boss.phase >= 2 && !session.countedPhase2) {
      session.countedPhase2 = true;
      session.phase2Runs += 1;
    }
    if (state.victory && !session.countedClear) {
      session.countedClear = true;
      session.clears += 1;
    }
    if (state.victory || state.defeat || session.seconds >= MAX_SECONDS) {
      session.finished = true;
      session.holdWait = HOLD_SECONDS;
    }
    return session;
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  /* A public-safe read of the demo, for the shell and for the browser proof. */
  function snapshot(session) {
    if (!session) return null;
    var state = session.state;
    var boss = bossEnemy(state);
    return {
      seed: session.seed,
      seconds: round(session.seconds),
      loops: session.loops,
      upgradePicks: session.upgradePicks,
      /* Sticky across loops: what the visitor has been shown. */
      phase2Runs: session.phase2Runs,
      clears: session.clears,
      finished: session.finished,
      roomIndex: state.roomIndex,
      rooms: state.layout.length,
      kills: state.stats.kills,
      hp: state.player.hp,
      alive: livingEnemies(state).length,
      upgradeOpen: !!state.upgradeChoice,
      bossPhase: boss ? boss.phase : null,
      bossHp: boss ? boss.hp : null,
      bossMaxHp: boss ? boss.maxHp : null,
      victory: state.victory,
      defeat: state.defeat
    };
  }

  return {
    PICK_DELAY: PICK_DELAY,
    SKILL_GAP: SKILL_GAP,
    MAX_SECONDS: MAX_SECONDS,
    HOLD_SECONDS: HOLD_SECONDS,
    create: create,
    reset: reset,
    decide: decide,
    step: step,
    snapshot: snapshot
  };
});
