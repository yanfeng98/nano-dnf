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
  /*
   * How far off the target's row he is willing to swing from, taken from the
   * game's own melee reach rather than picked: aim and judgment have to agree,
   * or the demo walks to a row its swings cannot cross.
   */
  var ROW_REACH = Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
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

  /**
   * 朝一个点走一步：方向由 `Core.routeStep` 算（绕开实心布景），这里只把它翻译成按键。
   *
   * 布景是实心的（`docs/adr/0032`）—— 演示以前是"一直朝着目标按方向键"，树和石头一实心
   * 它就会顶着树干原地推，永远走不到 Boss。
   */
  function walk(state, input, targetX, targetZ) {
    var move = Core.routeStep(state, targetX, targetZ);
    if (move[0] > 0) input.right = true;
    else if (move[0] < 0) input.left = true;
    if (move[1] > 0) input.up = true;
    else if (move[1] < 0) input.down = true;
    return move;
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
      /*
       * 清完房：走向一扇**开着的门**。门口是按地图上那一格的方向开的
       * （`docs/adr/0030`），所以这里不能再一路往右走 —— 上/下门要真的往上/往下走，
       * 左右门要走到对应的那面墙。走的步子交给 `Core.routeStep`：布景是实心的
       * （`docs/adr/0032`），直着走会在树干上原地推。
       */
      var door = openDoorGoal(state);
      if (!door) {
        input.right = true;
        return input;
      }
      /* 目标点要**落在门口判定区里**，不是站在门外：左右门是那面墙、上下门是门那条线。 */
      var doorwayX =
        door.dir === "E"
          ? Core.ARENA.rightWall - Core.DOOR.side / 2
          : door.dir === "W"
            ? Core.ARENA.leftWall + Core.DOOR.side / 2
            : door.x;
      var doorwayZ =
        door.dir === "N"
          ? Core.bandDepth(state.band) - Core.DOOR.depth / 2
          : door.dir === "S"
            ? Core.DOOR.depth / 2
            : state.player.z;
      walk(state, input, doorwayX, doorwayZ);
      return input;
    }

    var dx = target.x - state.player.x;
    var dz = (target.z || 0) - (state.player.z || 0);
    /*
     * The row, as well as the gap: a monster can open the fight standing well
     * back (Broken Span's caster does), and a swing thrown across the floor
     * sideways is a swing at the floor. Both of them are walking toward each
     * other's row, so this is also what the monster is doing - and the reach is
     * the same number the hit test uses, so the demo stops where its blows land.
     */
    if (Math.abs(dx) > APPROACH || Math.abs(dz) > ROW_REACH) {
      walk(state, input, target.x, target.z || 0);
      return input;
    }

    /*
     * Holding the direction keeps the swing pointed at the target; the rooted
     * attack damps the walk, so it reads as a step-in combo rather than a charge.
     *
     * **Both** directions, not just `dx < 0`. The old line pressed left only,
     * assuming that anything already inside `APPROACH` was being faced. A knock
     * back can shove him *past* the monster, and then he keeps the wrong face for
     * the rest of the fight: the swing box is built out of `facing`
     * (`startAttack`), so the demo and the monster end up standing 36 px apart
     * trading blows that cannot land. `facing` follows the movement direction, so
     * asking to walk the way he is looking is also how he turns around.
     */
    if (dx < 0) input.left = true;
    else input.right = true;
    input.attack = true;
    if (state.player.onGround && target.y < state.player.y - LEAP_GAP) input.jump = true;
    var skill = readySkill(session, state);
    if (skill) input.skills[skill] = true;
    return input;
  }

  /**
   * 这一格现在该往哪扇门走：`{dir, x}`，一扇都没有就 null（不该发生 —— 清完房的
   * 每一格至少有一条路）。
   *
   * **往 Boss 房的方向走**，不是一个方向一个方向地蹭：副本图有岔路（`docs/adr/0030`），
   * 优先走"没走过的门"会在两间房之间来回蹭，演示就永远打不到 Boss。所以这里先算一条
   * 到 Boss 房的最短路（BFS，走的是玩法真正走的门），取下一步。
   */
  function openDoorGoal(state) {
    var cell = Core.currentCell(state);
    if (!cell || !state.dungeon) return null;
    var route = routeToBoss(state);
    if (!route.length) return null;
    return {
      dir: route[0],
      x: Core.doorX(state.dungeon, cell, route[0])
    };
  }

  /** 从他在的这一格走到 Boss 房，一个方向一步；走不到就给空表。 */
  function routeToBoss(state) {
    var dungeon = state.dungeon;
    var start = state.cell;
    var goal = dungeon.boss;
    if (start === goal) return [];
    var came = {};
    came[start] = null;
    var queue = [start];
    while (queue.length) {
      var at = queue.shift();
      for (var index = 0; index < Core.MINIMAP_DIRS.length; index += 1) {
        var dir = Core.MINIMAP_DIRS[index];
        var next = Core.doorNeighbour(dungeon, dungeon.cells[at], dir);
        if (next < 0 || came[next] !== undefined) continue;
        came[next] = { at: at, dir: dir };
        queue.push(next);
      }
    }
    if (came[goal] === undefined) return [];
    var steps = [];
    for (var walk = goal; walk !== start; ) {
      steps.unshift(came[walk].dir);
      walk = came[walk].at;
    }
    return steps;
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
      /* 走过几格、图上一共几格 —— 副本图里没有定的"第几间"（docs/adr/0030）。 */
      rooms: state.stats.rooms,
      cells: state.dungeon ? state.dungeon.cells.length : 0,
      cell: state.cell,
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
