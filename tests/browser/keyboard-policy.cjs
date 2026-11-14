"use strict";

const Core = require("../../src/core.js");
const CLOSING_GAP = 24;

/** The same policy as tests/core.test.js, expressed as a set of wanted actions. */
function decide(state, constants) {
  const player = state.player;
  const alive = state.enemies.filter((enemy) => !enemy.dead);
  const want = new Set();
  /* 这一间房自己的墙（`Core.roomLeft/roomRight` 的取法），不是全局默认值。 */
  const physicalLeft = state.room && state.room.leftWall !== undefined
    ? state.room.leftWall
    : constants.room.leftWall;
  const physicalRight = state.room && state.room.rightWall !== undefined
    ? state.room.rightWall
    : constants.room.rightWall;
  // An open entry transfers rooms before the physical wall. Treat its trigger
  // edge as the combat boundary, so retreat cannot repeatedly reset the fight.
  // Cleared-room routing below still walks through the doorway normally.
  const leftWall = physicalLeft + (Core.exitMode(state, 'W') === 'open' ? Core.DOOR.side : 0);
  const rightWall = physicalRight - (Core.exitMode(state, 'E') === 'open' ? Core.DOOR.side : 0);

  /*
   * 到 Boss 房的下一步（BFS，走的是玩法真正走的门）。副本图有岔路，只认"哪扇门开着"
   * 会在两间房之间来回蹭，永远打不到 Boss。
   */
  const routeStep = () => {
    const dungeon = state.dungeon;
    if (!dungeon) return null;
    const came = { [state.cell]: null };
    const queue = [state.cell];
    while (queue.length) {
      const at = queue.shift();
      if (at === dungeon.boss) break;
      for (const dir of Core.MINIMAP_DIRS) {
        const next = Core.doorNeighbour(dungeon, dungeon.cells[at], dir);
        if (next < 0 || came[next] !== undefined) continue;
        came[next] = { at, dir };
        queue.push(next);
      }
    }
    if (came[dungeon.boss] === undefined) return null;
    let step = null;
    for (let at = dungeon.boss; at !== state.cell; ) {
      step = came[at].dir;
      at = came[at].at;
    }
    return step;
  };
  /*
   * 实心布景（木桶、树、石头 —— `docs/adr/0030` / `0032`）这个 bot 都不会绕：前面撞上就让一格。
   * 让的方向按他现在站的这一排在哪一边取；`alongZ` 为真时他本来就在走深度轴，不用让。
   */
  const detour = (want, stepX, alongZ) => {
    if (alongZ) return;
    const target = player.x + stepX;
    for (const prop of state.props || []) {
      const spec = Core.propObstacle(prop, player);
      if (!spec) continue;
      if (Math.abs(target - spec.x) > spec.width / 2) continue;
      if (Math.abs((player.z || 0) - spec.z) > spec.depth / 2) continue;
      want.add((player.z || 0) <= spec.z ? "down" : "up");
      return;
    }
  };

  if (alive.length === 0) {
    /*
     * 清完房就走出门。门口按地图上那一格的方向开（`docs/adr/0030`），所以"一路往右"
     * 不再能出门：先算一条到 Boss 房的路（副本图有岔路），再朝下一步的方向走 ——
     * 上门/下门要先横向对上门的 x。
     */
    const dir = routeStep();
    if (!dir) {
      want.add("right");
      return want;
    }
    if (dir === "E") {
      want.add("right");
    } else if (dir === "W") {
      want.add("left");
    } else {
      const cell = Core.currentCell(state);
      const doorX = Core.doorX(state, cell, dir);
      if (Math.abs(doorX - player.x) > 20) want.add(doorX > player.x ? "right" : "left");
      want.add(dir === "N" ? "up" : "down");
    }
    detour(want, dir === "W" ? -player.width : player.width,
            dir === "N" || dir === "S");
    return want;
  }

  const inbound = (state.projectiles || []).find((shot) => {
    const closing = shot.vx > 0 ? shot.x <= player.x : shot.x >= player.x;
    return closing && Math.abs(shot.x - player.x) < 200;
  });
  if (inbound && player.onGround) {
    want.add("jump");
    return want;
  }

  /*
   * **领主房里先清小怪，但别为了清小怪横穿领主。** 只按"离得最近"选会在走进
   * 领主房时越过那几只小怪、一路贴到领主身上，然后被小怪和领主的重击一起夹死
   * （实测 73 秒倒在领主房，伤害日志是 boss:melee / boss:slam）。先把杂兵清掉，
   * 少挨十几点。
   *
   * **但小怪在房间另一头时不能横穿领主去找它**：命中停顿之后实测从西边进领主房、
   * 小怪在 421/490、领主在 790，bot 一路向左穿过领主，被领主从背后砍到 3 血。
   * 现在只有小怪不比领主远太多（或领主已经死了）才换目标；否则先打领主，等小怪
   * 自己走近再换。
   */
  const bossAlive = alive.find((enemy) => enemy.type === "boss");
  const chaffAlive = alive.filter((enemy) => enemy.type !== "boss");
  const nearestChaff = chaffAlive.slice()
    .sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
  const chaffIsClose = nearestChaff && (
    !bossAlive ||
    Math.abs(nearestChaff.x - player.x) <= Math.abs(bossAlive.x - player.x) + 120
  );
  const pool = chaffIsClose ? [nearestChaff] : bossAlive ? [bossAlive] : alive;
  pool.sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x));
  const target = pool[0];
  const delta = target.x - player.x;
  const distance = Math.abs(delta);
  /*
   * Reaches are measured **past the body** now (`bodyGap` in src/core.js), so
   * the bot has to read them the same way or it aims with a different ruler than
   * the game judges with. A fixed centre distance put it inside 牛头巨兽 once the
   * beast was drawn at the client's size, and being inside the body is being
   * inside its swing.
   */
  const gap = distance - (target.width + player.width) / 2;
  const elapsed = target.attackDuration - target.attackTimer;
  const threatRange =
    target.attackKind === "slam" && target.slam
      ? target.slam.radius
      : target.attackKind === "spin" && target.spinDash
        ? target.spinDash.radius * 1.6
        : target.attackRange;
  /* A charge and a spin both stay live past the wind-up; the sweep keeps moving. */
  const activeUntil =
    target.attackKind === "charge"
      ? target.chargeTo
      : target.attackKind === "spin" && target.spinDash
        ? target.spinDash.windup + target.spinDash.duration
        : target.attackWindup;
  const threatened = target.attackTimer > 0 && elapsed <= activeUntil + 0.05;

  /*
   * The floor's second axis. Monsters open fights at a depth of their own (Broken
   * Span's caster does) and swing only across their own row, so a bot that knows
   * x and nothing else walks up and swings at the floor for the rest of the run.
   * It walks the row the way it walks the gap, both at once, and does not swing
   * until the row is right - which is also what a player who understands the game
   * does.
   *
   * While it is being attacked the block below takes over instead: a blow that
   * cannot reach it is not a reason to stop backing off.
   */
  const rowGap = (target.z || 0) - (player.z || 0);
  /*
   * **Boss 只剩最后 12% 时贴脸换血。** 实测在领主 8/120 血时按"先退"走，
   * 下一记近战就把他从 11 打到 0；人都到这儿了，最后一刀值得吃。只在它已经
   * 够得着、而且同排的时候这么做。
   */
  if (
    target.type === "boss" &&
    target.hp <= target.maxHp * 0.12 &&
    gap <= CLOSING_GAP + 20 &&
    Math.abs(rowGap) <= constants.meleeReach
  ) {
    /*
     * **最后一刀优先用无敌技**：嗜魂之手那一类整段无敌，能在领主的下一记
     * 近战里把最后几点血打掉。**如果领主正在冲锋/重踏/旋风，而没有无敌技，
     * 就先让下面的闪避分支走** —— 否则会像实测那样站着读条被冲锋撞死。
     */
    const finishers = constants.skillOrder.filter((skillId) => {
      const skill = constants.skills[skillId];
      return (
        (constants.equipped || constants.skillOrder).indexOf(skillId) !== -1 &&
        player.mp >= skill.mp &&
        player.skillCooldowns[skillId] <= 0 &&
        distance <= skill.reach + target.width / 2
      );
    });
    const invuln = finishers.find((skillId) => constants.skills[skillId].invuln);
    /*
     * 收尾技也只打到面朝那一边；先转身，不然最后 6 血会站着对空气读条。
     */
    const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
    if (!facingTarget) {
      want.add(delta >= 0 ? "right" : "left");
      return want;
    }
    /*
     * **普通近战也换**：他的 0.22 秒一刀比领主的起手快，最后几点血值得抢；
     * 只有冲锋/重踏/旋风这种"站着读条会被撞死"的招才先让给闪避分支。
     */
    if (!threatened || invuln || target.attackKind === "melee") {
      if (invuln) want.add(invuln);
      else if (finishers.length > 0) {
        want.add(
          finishers.reduce((top, skillId) =>
            constants.skills[skillId].damage > constants.skills[top].damage ? skillId : top
          )
        );
      } else {
        want.add("attack");
      }
      return want;
    }
  }
  if (!threatened && Math.abs(rowGap) > constants.meleeReach) {
    want.add(rowGap > 0 ? "up" : "down");
    if (gap > CLOSING_GAP) want.add(delta > 0 ? "right" : "left");
    return want;
  }
  /*
   * **够不到的那一排，先走排再打。** 被胆小哥布林追着打时 `threatened` 为真，
   * 原来 `allChaff` 的「还手」分支不看 rowGap：站错排一刀刀挥空（实测 z 差 97、
   * 26 秒没掉一滴血），对方每 1.2 秒磨 5 点。杂兵的近战只打自己那一排，先上下
   * 对齐/让开再还手。冲锋不在此列 —— 它的解法本来就是让开那一排。
   */
  if (
    threatened &&
    target.type !== "boss" &&
    target.attackKind !== "charge" &&
    Math.abs(rowGap) > constants.meleeReach
  ) {
    want.add(rowGap > 0 ? "up" : "down");
    return want;
  }

  /*
   * **领主的近战只有 29（身体间距），他的刀有 68** —— 所以安全区是中间那一段，
   * 不是贴脸。等它起手才退已经晚了：先维持 40–60 的间距，再在它的冷却里出刀。
   */
  if (target.type === "boss" && !threatened) {
    /*
     * 被逼到墙角时**从他身上穿过去**（身体不挡路，只有攻击判定挡路）。穿的时候
     * 锁住方向，直到真的到了他另一侧或摸到对面的墙 —— 不然每 20ms 都会因为
     * "离墙远了一点"而翻向，最后在两厘米里来回摆（实测 px 61↔75）。
     */
    if (constants.bossCross) {
      const dir = constants.bossCrossDir;
      const passed = dir > 0 ? delta < 0 : delta > 0;
      const atFarWall = dir > 0
        ? player.x >= rightWall - player.width - 4
        : player.x <= leftWall + player.width + 4;
      if (passed || atFarWall) {
        constants.bossCross = false;
      } else {
        want.add(dir > 0 ? "right" : "left");
        return want;
      }
    }
    if (gap < 40) {
      const away = delta > 0 ? "left" : "right";
      const atLeftWall = player.x <= leftWall + player.width + 4;
      const atRightWall = player.x >= rightWall - player.width - 4;
      const cornered = (away === "left" && atLeftWall) || (away === "right" && atRightWall);
      if (cornered) {
        constants.bossCross = true;
        constants.bossCrossDir = delta > 0 ? 1 : -1;
        want.add(constants.bossCrossDir > 0 ? "right" : "left");
      } else {
        want.add(away);
      }
      return want;
    }
    if (gap > 60) {
      want.add(delta > 0 ? "right" : "left");
      return want;
    }
  }

  if (threatened) {
    /*
     * **冲锋只打它自己那一排。** 横向后退跑不过 430 的冲锋，往深度轴让开一步
     * 才是录像里的解法（`enemyHitsPlayer` 的 z 容差），也能少挨 16 点。
     */
    /*
     * **冲锋一看到就换排**，不再等它滑到 `chargeFrom`。实测最后 7 血时它在
     * 起手阶段，bot 按通用"后退"走横向，下一帧冲锋就撞上了；深度让开才是
     * `enemyHitsPlayer` 的 z 容差那条解法。
     */
    if (target.attackKind === "charge" && elapsed <= target.chargeTo) {
      want.add((player.z || 0) <= (target.z || 0) ? "down" : "up");
      return want;
    }
    /*
     * **下砸是地上的一个盘，跳起来就躲得掉**（`src/core.js` 的 slam 命中要求
     * `player.y >= groundY - 26`）。被逼在墙角时后退已经来不及，跳是录像里
     * 那个 Boss 那一招的另一个解法。
     */
    if (target.attackKind === "slam" && target.slam && player.onGround &&
        elapsed >= target.attackWindup - 0.25) {
      want.add("jump");
      return want;
    }
    /*
     * A spinning sweep outruns a retreat once it is on top of you, so the read
     * is to back off through the wind-up and jump the sweep itself.
     */
    if (target.attackKind === "spin" && target.spinDash) {
      const closing = delta > 0 ? "left" : "right";
      if (gap < threatRange + 45) {
        if (player.onGround && elapsed >= target.spinDash.windup - 0.25) {
          want.add("jump");
        } else {
          want.add(closing);
        }
      }
      return want;
    }
    const away = delta > 0 ? "left" : "right";
    const atLeftWall = player.x <= leftWall + player.width;
    const atRightWall = player.x >= rightWall - player.width;
    const cornered = (away === "left" && atLeftWall) || (away === "right" && atRightWall);
    /*
     * **只剩杂兵就不跑了**（和 `tests/core.test.js` 的 kitingBot 同一条）：一直后退
     * 会被逼到墙角，或者干脆绕圈耗到超时；最后一只杂兵值得站着吃完这一下再还手。
     */
    const allChaff = alive.every((enemy) => enemy.maxHp <= 70);
    if (!allChaff && gap < threatRange + 45 && !cornered) {
      want.add(away);
    } else if (allChaff && gap <= CLOSING_GAP + 12) {
      /*
       * 只剩杂兵、而且已经在能够到的那一档：**还手**。站着等它的下一刀只会
       * 被两只杂兵一记接一记磨死（实测第 9 格 4 血时 `want` 是空的）。
       *
       * **还手前先转身。** 这个分支在通用的“攻击只打到面朝那一边”检查之前，
       * 原来直接 `attack`；如果他是从左边冲过了头、怪现在在左手边，他会一直
       * 朝右挥空——实测会卡满 220s（两只咒之赤哥布林那一间）。
       */
      const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
      if (!facingTarget) want.add(delta >= 0 ? "right" : "left");
      else want.add("attack");
    } else if (cornered) {
      /* Cornered in DNF means launch: 上挑 cancels the wind-up and buys space. */
      const upSlash = constants.skills.upSlash;
      const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
      if (!facingTarget) {
        want.add(delta >= 0 ? "right" : "left");
      } else if (
        distance <= upSlash.reach &&
        player.mp >= upSlash.mp &&
        player.skillCooldowns.upSlash <= 0
      ) {
        want.add("upSlash");
      } else {
        want.add("attack");
      }
    }
    return want;
  }
  /*
   * 打领主是**打了就退**：它的近战 74、重踏 191，站进 24 像素的缝里会被它一记
   * 接一记地换血。离得比小怪远一点、只在他自己的冷却里挥刀。
   */
  const closingGap = target.type === "boss" ? 50 : CLOSING_GAP;
  if (gap > closingGap) {
    const direction = delta > 0 ? "right" : "left";
    want.add(direction);
    detour(want, direction === "right" ? player.width : -player.width, false);
    return want;
  }

  /* Attacks only reach where the Slayer looks, so turn around first. */
  const facingTarget = delta >= 0 ? player.facing >= 0 : player.facing < 0;
  if (!facingTarget) {
    want.add(delta > 0 ? "right" : "left");
    return want;
  }

  want.add("attack");
  const castable = constants.skillOrder.filter((skillId) => {
    const skill = constants.skills[skillId];
    return (
      (constants.equipped || constants.skillOrder).indexOf(skillId) !== -1 &&
      player.mp >= skill.mp &&
      player.skillCooldowns[skillId] <= 0 &&
      /*
       * The game's `attackBox` starts at the player's centre and reaches
       * `skill.reach`; it overlaps the target's body out to
       * `reach + target.width / 2`. The old check used the centre distance
       * alone, so against the 138-wide boss almost no skill ever qualified and
       * the bot fought it with normal attacks only (measured: died at 8/120).
       */
      distance <= skill.reach + target.width / 2 &&
      target.attackCooldown > skill.duration + 0.3
    );
  });
  if (castable.length > 0) {
    const best = castable.reduce((top, skillId) =>
      constants.skills[skillId].damage > constants.skills[top].damage ? skillId : top
    );
    want.add(best);
  }
  return want;
}


module.exports = decide;
