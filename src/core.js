/*
 * nano-dnf core: deterministic, dependency-free combat/dungeon logic.
 * Loaded as a CommonJS module in Node (tests) and as `window.DNFCore` in the browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FPS = 60;
  var DT = 1 / FPS;

  /*
   * **三个宽度，别混**（`docs/adr/0035`、`docs/adr/0040`）：
   *
   * - `ARENA` 是**画布** —— 整块屏幕，HUD 住在它上面，它不跟着镜头动；
   * - `VIEW` 是**世界窗口** —— 画布上留给游戏世界的那块矩形（4:3、居中、左右黑边）。
   *   一屏能看多宽的世界由它说了算，见 `windowWidth()`；
   * - `ROOM` 是**一间房的默认尺寸** —— 房间是内容，比窗口宽，所以走一趟要滚镜头。
   *
   * 判定、刷怪、摆布景、门，全都读**房间**那三个（`roomWidth` / `roomLeft` /
   * `roomRight`），不要读 `ARENA` 的宽 —— 它只是画布。
   */
  var ARENA = {
    width: 960,
    height: 540,
    /*
     * The floor sits above the hotbar's band rather than under it: at 460 the
     * bar (which starts at height - 96) covered the ground the Slayer stands on,
     * and the owner asked for the floor to stay visible.
     */
    groundY: 430
  };

  /*
   * 世界窗口。**量自录像**：它的游戏画面是居中的 **4:3**（1440×1080，左右纯黑边）。
   * 720×540 正好 4:3，于是按 132.51 屏幕像素/身位 算一屏装 **5.434 身位**，与录像一致；
   * 在这之前画布整个 960 宽都是世界，一屏装 7.245 身位，比录像多看得见 33%。
   * **它不改房间** —— 房间仍是 `ROOM.width`，于是同一间房从 1.6 屏变成 2.1 屏，镜头有得滚。
   */
  var VIEW = {
    width: 720,
    height: ARENA.height,
    left: (ARENA.width - 720) / 2
  };

  /*
   * 一间房的默认尺寸 —— **这三个是权威，`ARENA` 那一个不是。**
   *
   * 读它们而不是直接读 `state.room.width`，是因为**房间还没开出来的时候也得答得上来**
   * （`createEnemy`、抛射物、身体分离这些都在 `beginRoom` 之外跑）：答不上来就回落到
   * 默认那一间的尺寸，于是任何一次调用都不会读到一个空房间。
   */
  var ROOM = {
    width: 960,
    /* 房间左右各留的墙厚；默认那一间就是 24 与 936。 */
    leftWall: 24,
    rightWall: 936
  };
  function roomWidth(state) {
    var room = state && state.room;
    if (!room || room.width === undefined) return ROOM.width;
    return room.width;
  }

  function roomLeft(state) {
    var room = state && state.room;
    if (!room || room.leftWall === undefined) return ROOM.leftWall;
    return room.leftWall;
  }

  function roomRight(state) {
    var room = state && state.room;
    if (!room || room.rightWall === undefined) return ROOM.rightWall;
    return room.rightWall;
  }

  /*
   * 美术里他画出来多高 —— 这就是**身位**（`CONTEXT.md`）。和 `Render.SPRITE.bodyHeight`
   * 是同一个数（那张图上他自己的包围盒，由一个测试钉着），这里是因为镜头要按它算远近。
   */
  var ART_HEIGHT = 84;

  /*
   * **录像里的一个像素等于本作世界里的多少。**
   *
   * 录像里他一身的 265 像素，本作美术里是 84（`ART_HEIGHT`），所以
   * 1 视频像素 = 84 / 265 = **0.317 世界像素**。业主那条整场录像里的每一处长度
   * （血条、头像框、字高、偏移）都是乘这个数折过来的 —— 写成一个名字而不是一堆
   * 手算好的小数，是为了让"这个数从哪儿来"在每一处都还看得见。
   */
  var VIDEO_PX = ART_HEIGHT / 265;

  /*
   * **镜头离他多近，以及它什么时候开始跟**（`docs/adr/0035`）。
   *
   * 这一组全是**量出来的**，不是挑的。量的是业主给的整场录像
   * （`dnf-dungeon-videos/00001-幽暗密林.mp4`，1920×1080，游戏画面居中 1440×1080）：
   *
   * **一、远近。** 录像里他一屏高 **4.0755 个身位**（一屏 1080 视频像素 ÷ 他画出来的
   * 265 像素）。本作一屏 `ARENA.height` = 540 屏幕像素，所以一个身位要画
   * **132.51** 屏幕像素 —— 而美术里的他只有 **84**，世界因此整体画大 **1.5775 倍**。
   * 一屏于是只看得到 960 / 1.5775 = **608.6 世界像素** = **7.245 身位**。
   * **这比录像的 5.434 身位还宽 33%** —— 那 33% 是**画幅**（录像 4:3，本作 16:9），
   * 单独一条，业主 2026-10-12 定的是先不动（Q16 选 a）。
   *
   * **二、死区。** 他到屏幕中间这一条带子里走动时**镜头不动**，一到边上镜头就开始跟。
   * 带子量出来是屏宽的 **224/1440 = 15.556%**，**居中**，六个房间一模一样
   * （屏幕 x 只落在 [607, 831] 这两个峰上，中间几乎是空的）。
   *
   * **三、跟法与边界。** 越过带子**一帧内就到全速**、跟他 **1:1**（30fps 下量不出任何
   * 滞后，所以这里不写平滑）；**到房间的墙就停住**，他还走他的（录像里他走到屏幕
   * x=1211 而镜头一动不动，连续 6.8 秒）；**纵向不跟**（95% 的帧 dy = 0）。
   */
  var CAMERA = {
    /* 一身位在屏幕上画多少像素：540 ÷ 4.0755 = 132.51。 */
    figure: ARENA.height / (1080 / 265),
    /* 一**世界**像素画多少屏幕像素：132.51 ÷ 84 = 1.5775。 */
    zoom: (ARENA.height / (1080 / 265)) / ART_HEIGHT,
    /* 死区，存成**屏宽**的比例 —— 因为它量的是屏幕，不是房间。 */
    deadzoneShare: 224 / 1440
  };

  /** 一屏看得见多宽的世界（世界像素）：**世界窗口**那一块除以远近。房间比它宽就有得滚。 */
  function windowWidth() {
    return VIEW.width / CAMERA.zoom;
  }

  var PHYSICS = {
    gravity: 2200,
    /*
     * **His pace is the recording's.** 幽暗密林's recording has him covering
     * **2.05 of his own body heights a second** - measured off his feet over
     * three separate clean runs, with the camera's own scroll divided back out
     * (520-555 video px/s against the 265 px to a height). This game had him at
     * 3.155, so every **locomotion** speed in this file was scaled onto that
     * reading by the same factor, `2.05 / 3.155 = 0.65`: his walk, the monsters'
     * walks, the rocks they throw and the beast's charge.
     *
     * The line is **locomotion vs. attack timing**: how fast a body or a rock
     * crosses the field is the recording's, while wind-ups, recoveries and
     * cooldowns stay this game's own numbers. The recording measures a goblin's
     * walk (0.62-0.77 heights a second, which 0.65 lands inside) and nothing
     * else that walks, so scaling the rest by the same factor is what keeps the
     * ratios the fights were tuned on - see `docs/adr/0039`.
     */
    moveSpeed: 172,
    jumpVelocity: -760,
    maxFallSpeed: 1400,
    /*
     * How fast walking into the screen looks, as a fraction of how fast walking
     * across it does. Tuned here rather than on the floor because it is the
     * screen the player is reading: the depth axis is foreshortened by
     * DEPTH.scale, so a floor speed equal to moveSpeed would crawl up the screen
     * at 58px/s. Three quarters gives 198px/s, which crosses the whole band in
     * about six tenths of a second.
     */
    depthSpeedRatio: 0.75
  };

  /*
   * The floor, seen at an angle, in one number.
   *
   * `scale` is how the depth axis foreshortens: a step of `z` towards the back
   * of the room lifts a thing this many pixels up the screen. It is the same
   * constant that squashes every ground ellipse the renderer draws, and that is
   * the point - the disc a radial skill hits and the ellipse drawn for it have
   * to stay the same shape, so there must never be a second copy of this
   * number. See docs/adr/0001-depth-axis.md.
   *
   * `z` is measured along the floor in the same units as `x`, and `z = 0` is
   * the ground line. Anything that has no depth yet stands at zero, which is
   * what keeps this axis from moving a single pixel until a slice gives it
   * something to move.
   */
  var DEPTH = {
    scale: 0.22
  };

  /** How far up the screen standing `z` deep pushes a point. */
  function depthLift(z) {
    return (z || 0) * DEPTH.scale;
  }

  /**
   * How fast something that walks the floor at `floorSpeed` covers depth, in `z`
   * units per second. The ratio is a screen speed, so the foreshortening has to
   * be divided out again to get back to the floor - and that is the only place
   * either side's depth pace is decided, so the Slayer's and the monsters' look
   * like the same kind of walking.
   */
  function depthSpeedFor(floorSpeed) {
    return (floorSpeed * PHYSICS.depthSpeedRatio) / DEPTH.scale;
  }

  /** How fast the Slayer walks into the screen. */
  function depthSpeed() {
    return depthSpeedFor(PHYSICS.moveSpeed);
  }

  /*
   * The floor band: the strip of floor a room's fighters stand on, running back
   * from the ground line to `backY`.
   *
   * 310 is as far back as the frame affords. The ground line is at 430 and the
   * hotbar starts at height - 96 = 444, so the floor has fourteen pixels in
   * front of it and has to open upwards, into the room. That makes the band
   * 120px deep on screen - about three quarters of a Slayer-height - and a
   * little over three and a half of them measured along the floor itself,
   * because the depth axis is foreshortened by DEPTH.scale.
   *
   * A room may carry its own (`band: {backY}`): a wide hall and a corridor
   * should not have to share a depth, and the band is what decides how far
   * apart two things can stand and still be in reach of each other.
   */
  var BAND = {
    backY: 310
  };

  /** How deep a band is, in the units `z` is measured in. */
  function bandDepth(band) {
    return (ARENA.groundY - (band || BAND).backY) / DEPTH.scale;
  }

  /*
   * One Slayer, from the soles of his feet to the top of his head, in world
   * pixels - the unit this project measures things with. The reference clips
   * were measured in these, and a reach written in pixels would have to be
   * re-measured every time the sheet is re-baked. Render's SPRITE.anchorY is the
   * same 156 seen from the asset side; a test pins the two together.
   */
  var SLAYER_HEIGHT = 156;

  /*
   * How deep an attack reaches, in Slayer-heights either side of the row the
   * attacker is standing on.
   *
   * This is what decides whether a blow lands, not just where it is drawn. The
   * defender is a point - the row a body stands on - and the attack is an
   * interval around the attacker's own row, so a swing that connects because two
   * x-ranges overlapped, while the two bodies stood three Slayer-heights apart,
   * is the thing this axis exists to stop.
   *
   * `melee` is 47 z, which is a tenth of the default band - so stepping a body
   * aside is enough to make a monster miss, and the same step is enough to make
   * you miss it. Moves that cover floor rather than a line widen it (see the
   * `depthReach` on SKILLS.mountainBreaker and SKILLS.mountainRift).
   */
  var DEPTH_REACH = {
    melee: 0.3,
    /* A spin sweeps the lane rather than a body-width (see spinHitsPlayer). */
    spin: 0.6,
    /*
     * A patch of floor rather than a line. 0.75 is the footprint the client's
     * own fire already pretended to have: slice 54 staggered its 12 tongues by
     * ±26 client px to read as "a patch on the ground plane", and ±26px of
     * screen is ±118 z.
     *
     * Slice 60 tried to derive this from the picture instead - the gash's own
     * ellipse read as a circle seen at the client's camera - and had to withdraw
     * it: three of the pack's floor pools, all circles in the game, measure
     * squashes of 0.295, 0.426 and 0.581, so an art's aspect says nothing about
     * the camera it was drawn for. The number stays where the picture put it.
     * See docs/adr/0002.
     */
    floor: 0.75
  };

  /**
   * Whether something standing at `z` is within reach of a blow thrown from
   * `at`. `reach` is in Slayer-heights; left out, it is a melee's.
   */
  function inReachOf(z, at, reach) {
    var half = (reach === undefined ? DEPTH_REACH.melee : reach) * SLAYER_HEIGHT;
    var from = (at || 0) - half;
    var point = z || 0;
    return point >= from && point <= from + half * 2;
  }

  /*
   * The Slayer's real normal attack is frames 0-41 of the body img: the guard,
   * then the four cuts it is built from (the white arcs land on 4, 13, 24 and
   * 34). One press plays one cut, so the whole chain only plays out when the
   * player keeps pressing X, and attack speed decides how fast each cut runs
   * and how soon the next one can start. Frames 40-50 are the up-slash skill's
   * own animation and 51-60 simply repeat that cycle, so neither belongs here.
   */
  /*
   * The cuts of the normal attack: three *different* swings, one per press.
   *
   * The body sheet carries six slash peaks but only three directions - its hits
   * two and three are the same backward-low sweep (pixel-identical frames) and
   * its fourth is repeated three times, so playing the sheet in order gave the
   * owner "two backward flicks, then two upward ones". The attack row is baked
   * from distinct swings instead (see assets/import_dnf_swordman.py CELLS.attack):
   * the opening down cut, the backward low sweep and the overhead sweep. Each
   * stage carries its own wind-up and settle with the slash on its fourth frame,
   * so the blade connects on the arc for every press. The owner cut the chain
   * from four presses to three - the overhead down slash is gone.
   */
  var ATTACK_STAGES = [
    { first: 0, frames: 7, damage: 8 },
    { first: 7, frames: 9, damage: 10 },
    { first: 16, frames: 7, damage: 11 }
  ];

  var PLAYER = {
    maxHp: 120,
    maxMp: 100,
    width: 34,
    height: 64,
    /*
     * One cut at attack speed 1: the swing itself, then a recovery the player is
     * free to move through. The cut's animation plays across both (see
     * attackCycle), so the ten frames read as one motion instead of a snap.
     * Attack speed divides the pair, which is what lets a faster Slayer play the
     * chain sooner.
     */
    attackDuration: 0.22,
    attackCooldown: 0.16,
    attackSpeed: 1,
    /*
     * Hit window as a fraction of the swing, so it lands on the same animation
     * frames however fast the swing runs. The cut's frames play across the
     * swing, so the white arc - the frame the blade actually connects on - sits
     * at about 0.40 of it and the damage lands on the frame just before the
     * arc. Opening the window any later costs real clear time, so the animation
     * was moved onto the arc instead of the hit window being moved onto it.
     */
    attackActiveFrom: 0.3,
    attackActiveTo: 0.64,
    attackReach: 68,
    attackHeightPad: 10,
    comboDamage: ATTACK_STAGES.map(function (stage) {
      return stage.damage;
    }),
    comboWindow: 0.45,
    maxCombo: ATTACK_STAGES.length,
    invulnAfterHit: 0.9,
    hurtStun: 0.22,
    knockbackX: 190,
    mpRegenPerSecond: 7
  };

  /* How long one swing takes at the player's attack speed. Kept in a band so a
     stack of speed upgrades still leaves readable animation and a live hitbox. */
  var MIN_ATTACK_SPEED = 0.5;
  var MAX_ATTACK_SPEED = 3;

  function swingDuration(player) {
    return PLAYER.attackDuration / attackSpeedOf(player);
  }

  /*
   * A buff's own numbers, looked up by the id it declares rather than by the
   * skill that happens to own it. Every stat reader asks "is anything up that
   * scales me?" through `buffScale` instead of reaching for one buff by name -
   * that is what lets 暴走 stack its attack speed on 血之狂暴's without either
   * reader naming a skill.
   */
  var BUFF_INDEX = null;
  function buffById(buffId) {
    if (!BUFF_INDEX) {
      BUFF_INDEX = {};
      Object.keys(SKILLS).forEach(function (id) {
        var buff = SKILLS[id].buff;
        if (buff) BUFF_INDEX[buff.id] = buff;
      });
    }
    return BUFF_INDEX[buffId] || null;
  }

  /* The product of every live buff's multiplier for one stat. */
  function buffScale(player, field) {
    var scale = 1;
    var buffs = (player && player.buffs) || {};
    Object.keys(buffs).forEach(function (id) {
      if (!(buffs[id] > 0)) return;
      var buff = buffById(id);
      if (buff && buff[field]) scale *= buff[field];
    });
    return scale;
  }

  /*
   * The total of every live buff's *additive* term for one stat. 命中 is the
   * only one so far: evasion is a probability, so it subtracts rather than
   * multiplies (docs/adr/0018).
   */
  function buffSum(player, field) {
    var total = 0;
    var buffs = (player && player.buffs) || {};
    Object.keys(buffs).forEach(function (id) {
      if (!(buffs[id] > 0)) return;
      var buff = buffById(id);
      if (buff && buff[field]) total += buff[field];
    });
    return total;
  }

  function attackSpeedOf(player) {
    var speed = Number(player && player.attackSpeed);
    if (!isFinite(speed) || speed <= 0) return PLAYER.attackSpeed;
    var base = Math.min(MAX_ATTACK_SPEED, Math.max(MIN_ATTACK_SPEED, speed));
    /*
     * 血之狂暴 swings faster (it is the dual-blade stance) and 暴走 stacks its
     * own attack speed on top of it. Both are declared on their own SKILLS
     * entry, so this reader names neither.
     */
    return Math.min(MAX_ATTACK_SPEED, base * buffScale(player, "attackSpeed"));
  }

  /*
   * Slayer (鬼剑士) skill kit, kept in the DNF shape: every skill has an MP cost,
   * a cooldown, and damage that grows with the skill level (here: character level).
   */
  var SKILLS = {
    upSlash: {
      id: "upSlash",
      name: "上挑",
      key: "A",
      mp: 8,
      cooldown: 1.5,
      damage: 12,
      growth: 3,
      duration: 0.28,
      /* The clip is body frames 41-50 and the blade connects on 44-45, a third
         of the way into the 0.28s cast, so the hit window opens with the arc
         instead of 0.05s ahead of it. These are seconds, not fractions. */
      activeFrom: 0.09,
      activeTo: 0.15,
      reach: 62,
      heightPad: 14,
      knockbackX: 70,
      launch: -430,
      radius: 0,
      hits: 1,
      /* DNF shape: low damage, lifts the target so a juggle can start. */
      juggle: true
    },
    mountainBreaker: {
      id: "mountainBreaker",
      name: "崩山击",
      key: "S",
      mp: 18,
      cooldown: 5,
      damage: 22,
      growth: 4,
      /*
       * 崩山击 is a committed move - raise, forward hop, landing shockwave,
       * recovery - and the cast is cut to the training-room reference
       * (assets/dnf_src/bilibili/skill-clips/01_崩山击.mp4): the leap is the
       * raise, the blade connects on the landing, and the whole thing is 1.3s
       * from the press. The client's own preview of the same move is a
       * different file (assets/dnf_src/skill-videos/Swordman-HopSmash.mp4) and
       * is only ever a 旁证 - this comment used to name the clip above as it.
       */
      duration: 1.3,
      /* seconds: the hop starts at 0.05s and touches down at ~0.70s, so the
         blade and its ground wave connect a frame later - while he is still in
         the air the box sits above the enemies and nothing lands. */
      activeFrom: 0.70,
      activeTo: 0.78,
      reach: 96,
      heightPad: 18,
      knockbackX: 240,
      launch: 0,
      radius: 0,
      hits: 1,
      /* DNF shape: leap smash that knocks the target down. */
      knockdown: 1.1,
      /*
       * The hop is the raise itself, and its arc is the reference's, read in
       * Slayer-heights: he leaves the ground at frame 22 of 01 崩山击 and is
       * back on it at frame 41, 19 of the clip's 30fps frames = 0.633s, and the
       * nameplate that rides over his head rises 215 client px against the 218
       * client px he is drawn at. So this is a hop of **one body height**, folded
       * into this screen (84px to the 身位, see CONTEXT.md) = 83px up, 42px
       * forward. The nameplate is the clean ruler: it is a rigid box that sits at
       * a fixed row while he stands and travels with him in the air.
       *
       * The gravity is this move's own and it is *lighter* than the world's
       * (2200): the reference hangs 0.633s over only 83px, and 2200 would put
       * him down in 0.55s. Folding the two measured numbers through
       * h = g t^2 / 8 and v = g t / 2 gives the pair below.
       *
       * Both used to be about three times this big, and the cause is worth
       * keeping: 250px and "about 3.7 body heights" were read off 01 崩山击 and
       * used as *this* screen's pixels, at a time when the repo had no 身位 to
       * convert through - `bodyHeight` and CONTEXT.md's 身位 entry both arrive a
       * day later, in 06107f2. Measuring the reference in the reference's own
       * units and drawing the result in ours is the trap this repo has now
       * written up three times (see assets/dnf_effect_picks.md); this is the one
       * that survived into the leap.
       */
      leap: 66,
      leapUp: -523,
      /* Only the airborne half of this move: -523 under 1653 peaks at
         -523^2 / (2 * 1653) = 83px and touches down 2 * 523 / 1653 = 0.633s
         later, on activeFrom. */
      leapGravity: 1653,
      leapFrom: 0.05,
      /* The leap's landing frames are invulnerable, DNF style: the Slayer is
         committed to the smash and cannot be knocked out of the air - the window
         has to cover the whole hop plus the landing hit (which now lands at
         0.70s, off a take-off at 0.067s), or a grunt standing where he comes
         down cancels the move before the blade connects. */
      leapInvuln: 0.72,
      shockwave: {
        reach: 150,
        damage: 10,
        growth: 2,
        heightPad: 10,
        knockbackX: 200,
        knockdown: 0.7,
        extraWaveFromLevel: 5,
        /*
         * The wave still hits and still shakes the screen, but it draws no ring:
         * the reference (01 崩山击) lands the smash on the fire column and the
         * spikes alone, and the drawn ellipse read as a targeting circle the
         * move does not have (owner: 「参考视频没有范围圈」). 大蹦 keeps its own
         * ring - that one is the fire's own circle (arcOffset 0).
         */
        arc: false
      },
      /*
       * The smash covers floor, not a line: it brings a fire column and a ring
       * of spikes out of the ground around the point he lands on. Anything
       * standing on that patch is inside it, not just anything on his row.
       */
      depthReach: DEPTH_REACH.floor
    },
    crossSlash: {
      id: "crossSlash",
      name: "十字斩",
      key: "D",
      mp: 14,
      cooldown: 4,
      damage: 12,
      growth: 2,
      /*
       * The cast is the reference clip's own 34 frames at 30fps (02_十字斩.mp4,
       * his press at #22 to the last frame the merged qi is still on screen,
       * #55). That is 1.1333s, and it is also the row's own length: 34 cells,
       * one per clip frame, so `col` is `clip frame - 22` exactly.
       *
       * **Three cuts, three hits** (`hitAt`, read as progress through the cast),
       * where the old spec had two spread evenly over a window - which is why
       * the first cut's arc never carried one:
       *
       *   #29 = 0.206  the sweep reaches its widest
       *   #33 = 0.324  the 十 takes shape
       *   #44 = 0.647  the third cut: the crescent sweeps and the qi merges
       *
       * Even spacing cannot say that (0.206/0.324/0.647 are not equally apart),
       * so this move names its own beats and the generic loop lands on them.
       *
       * `damage`/`growth` are a third of what they were, so three hits do what
       * two used to: a level-1 cut is 12 and the move still totals 36 a level,
       * which is why the balance numbers did not have to be re-tuned.
       */
      duration: 1.1333,
      activeFrom: 0.206,
      activeTo: 1,
      hitAt: [0.206, 0.324, 0.647],
      /*
       * **He moves, and then he comes back.** The clip's caster walks forward
       * 0.54 of a Slayer-height on the third cut - measured off his own boots,
       * not the art: their centre jumps from x 778 (#43) to 660 (#44) and stays
       * there to #55, while the 十 he drew stays on x 554-727 and lets him walk
       * through it. `advance` is that step in px; `advanceBack` is where the
       * recovery starts bringing him back to the spot he pressed the key on, so
       * the move is net zero - the clip ends with him back on 761.
       *
       * The clip does the return in one frame (#55 -> #56); 0.72 spreads it
       * over the last 0.32s so it reads as a step rather than a teleport.
       *
       * This is why the move is no longer fully `定身` - it locks the facing and
       * refuses input, but it carries him. See `CONTEXT.md` and `docs/adr/0012`.
       */
      advance: 45.5,
      advanceAt: 0.647,
      /* One frame of the clip at 30fps, which is all the step itself takes. */
      advanceRamp: 0.035,
      advanceBack: 0.72,
      /*
       * `reach` stays where it was. The reference is a training-room clip with
       * nothing to hit, so it can measure the art and not the box: the 十 and the
       * fan are both **centred on him** and reach only 0.58 of a Slayer-height
       * past his middle, while the blade itself swings out to 1.33. 84px is 1.0
       * of a height - between the two, and the only one of the three that was
       * ever picked for the judgement rather than for the drawing. `heightPad` is
       * the clip's own: the 十 runs 1.52 heights over his head and 0.24 under his
       * soles, so 30 clears the top and gives away a little at the bottom.
       */
      reach: 84,
      heightPad: 30,
      knockbackX: 180,
      launch: 0,
      radius: 0,
      hits: 3,
      /*
       * **The third hit leaves him.** In the clip, the three cuts' qi merge at
       * #44-#46 into one body that then flies 0.73 of a height forward and
       * shrinks away - so the cut that lands is not a box on his hands, it is a
       * box on **the thing that is flying** (`spawnShot`). The numbers are the
       * bake's own numbers for that stage (`travel` 63.5, `ahead` 66), read once
       * more here because the judgement and the picture have to agree about
       * where the qi is: he is hit by it where he sees it.
       */
      shot: {
        /* Which of the three cuts leaves him: the third (`hitAt` 0.647). */
        hit: 2,
        from: 0.647,
        ahead: 66,
        speed: 159,
        reach: 84,
        heightPad: 30,
        life: 0.4
      },
      /*
       * The cross used to leave the target bleeding from level 2. That line
       * moved to 血之狂暴, which is now the only thing in this game that draws
       * blood: with the stance down this is three cuts and a flying blade like
       * any other move (docs/adr/0017).
       */
    },
    bloodSword: {
      id: "bloodSword",
      name: "血气之刃",
      key: "F",
      mp: 25,
      cooldown: 8,
      damage: 14,
      growth: 2,
      duration: 0.72,
      activeFrom: 0.16,
      activeTo: 0.56,
      reach: 120,
      heightPad: 20,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 3,
      /* DNF shape: the blood blade cuts three times and holds the target. */
      stun: 0.35,
      hold: true
    },
    frenzy: {
      id: "frenzy",
      name: "血之狂暴",
      key: "G",
      mp: 12,
      cooldown: 3,
      damage: 0,
      growth: 0,
      /*
       * 0.50s: the first of the reference's two beats, and the only one that is
       * his. The whole ceremony in the clip runs 1.33s, but the thing that makes
       * it read is that he goes red in *one frame* at the burst - f43 stands
       * there ordinary, f44 is a flat red silhouette - and the corona spreads
       * over a character who is already raging. So the state lands with the
       * burst, a tenth of a second in, and the rest of the beat is that corona
       * dying back (docs/adr/0017).
       *
       * The first pass landed it at the *end* of the beat instead, and the owner
       * caught it: that reads as a wind-up and then a colour change, not as a
       * burst. The reference measures 1.33s of ceremony, but its ceremony opens
       * at f44, not at f84.
       */
      /*
       * **1.40s, which is the reference's own clock.** The owner caught this one:
       * the first pass fired the whole thing off in 0.6s, and he read it as the
       * stance arriving before it had finished being cast. Measured off
       * 07_血之狂暴, the ceremony runs f39-f84 = 46 frames = **1.53s**, and it is
       * worth being that long because it has three things in it: the body goes
       * red at f44, the arm goes out and the blood gathers at f64-f78, and it
       * settles by f84. Squeezed into 0.6s those beats land on top of each other.
       *
       * The clip's own frames are paced against this - see the `beats` on
       * SPRITE.skillClips.frenzy: he stands through the burst and spends the
       * arm motion over the back half, which is where the reference has it.
       */
      duration: 1.4,
      activeFrom: 0.13,
      activeTo: 0.2,
      reach: 0,
      heightPad: 0,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 1,
      /*
       * DNF shape: 血之狂暴 is the stance, not a damage move. It is the one
       * skill that owns this character's blood - the red body (0003/0004), the
       * dual blade, the bleed it puts on whatever he hits, and the 命中 that
       * keeps his cuts from sliding off an elite. Then the price: his own HP,
       * cut once to open it and then a little at a time for as long as he
       * keeps it up.
       *
       * It is a buffer in the DNF sense: the state has no timer at all (the
       * owner's read of the client is "cast it again to take it down"), so the
       * duration is Infinity and the toggle flag is what turns the second cast
       * into a cancel.
       */
      buff: {
        id: "bloodRage",
        duration: Infinity,
        toggle: true,
        /*
         * **0.8, not 1.25: the stance makes his cuts slower, not faster.**
         *
         * It has been 1.25 (a fifth quicker than his own combo) since the slice
         * that made this a stance, and the owner only saw what that cost once the
         * swings got their own animation: 「我看了确实是，但是应该是攻速太快」 -
         * 22 body frames were being played inside a 0.176s cut, and on screen that
         * is a flick, not a swing. The reference's own swing takes ~0.3s
         * (docs/adr/0019 decision 8), and 0.8 lands this one at 0.275s.
         *
         * **0.5, and the second half of the same note from the owner**: 「是不是少
         * 动作了，感觉原版的一套要运行 2s 钟左右，能看清动作」. At 0.8 a press lasted
         * 0.275s and the whole three-swing chain ~0.9s, so the 22 frames went by at
         * ~30fps - close to the client's own rate, but in a game you are *playing*
         * that reads as skipping frames rather than swinging. 0.5 puts one press at
         * 0.44s and the chain at ~1.5-1.8s, which is the ~2s he reads off the
         * reference.
         *
         * **0.85, and it is a measurement off the reference, not an estimate.**
         * The owner, after playing the 0.4 build: 「我怎么感觉源码的更丝滑，也更连贯，请你仔细
         * 量一下 BV1W9Gx6LELk.mp4」. Measured off that clip at 30fps: it advances ~12 *new*
         * poses a second (15 of its frames are duplicates - the recording is 30fps, the game is
         * not), which is the 13fps ours already runs at; what differs is the *swing*: the
         * reference's cream flashes at t=3.67 and again at t=3.93, so **one swing is ~0.26s**,
         * where our 0.4 made it 0.55s - 2.1x slower, which is what "not smooth" was. 0.85 puts
         * ours at 0.26s and the three-swing chain at ~0.8s, which is the clip's own 0.8-1.0s.
         * (The earlier 0.4 came from a spoken 「一套要运行 2s 左右」; the clip says ~1s.)
         *
         * **0.4, and the last of the three notes**: 「三个动作之间连贯性不好，感觉停了好久」.
         * The gap was the recovery between presses, not the swing - a chain press
         * now comes as soon as the swing ends (see the attack branch), so the
         * three swings run back to back. What is left is how long each swing is:
         * 0.55s here, which puts the whole set at ~1.7s with 22 frames playing at
         * ~13fps.
         *
         * It is a *taste* number and the owner set it: the stance keeps its
         * `attackPower: 1.25`, so what it gives up in rate it still pays back in
         * damage. Everything else that reads attack speed (upgrades, 暴走's own
         * 1.4) multiplies on top of this and is untouched.
         */
        attackSpeed: 0.85,
        cooldownScale: 1.4,
        attackPower: 1.25,
        /*
         * 命中, as the flat evasion it cancels. This game has no accuracy stat
         * and had no miss roll anywhere before this slice - the stance is the
         * only thing that grants either (docs/adr/0018).
         */
        accuracy: 0.15,
        /* 硬直: what is left of his own hit recovery while the stance is up. */
        hitRecovery: 0.5,
        /*
         * 出血. This used to be 十字斩's own line; the owner moved it here so
         * that blood has exactly one owner. Every hit lands it and every hit
         * refreshes it, and it stays on the target after the stance comes down.
         */
        bleed: { damage: 4, growth: 1, duration: 3, interval: 1 },
        /*
         * The price. `open.hpRatio` is the cut he takes on the frame the stance
         * lands - 17.5% of max HP, measured off the reference's own HP orb
         * (07_血之狂暴 #44: -14px, white loss band visible) - and `drain` is
         * what it takes after that. Neither has a floor: the owner's call is
         * that this is a cost and not a fee, so it can kill him, and the blood
         * orbs are the only way back up.
         *
         * **Once every ten seconds, 1% of max HP** (docs/adr/0020). The clip
         * cannot time this one - it runs 3.5s and its orb sits still for the
         * last 1.33s of it - so the cadence comes from the move's own numbers,
         * which charge the caster every ten seconds (75 against the 220 the cast
         * costs at level 1). What we had was 2 HP/s: 20 HP over ten seconds
         * against a 21 HP cast, three times the original's ratio, and the owner
         * read it as a bleed rather than a bill. He set the rate at 1% a tick
         * instead of the original's 6%, so a full bar lasts ~100 seconds of
         * standing still.
         */
        open: { hpRatio: 0.175 },
        drain: { interval: 10, hpRatio: 0.01 },
        /*
         * The reference's **second beat**: a compact mass of blood gathers in his
         * free hand while a star goes off over his head (07_血之狂暴 f64-78).
         *
         * **Timed to the body, not to a stopwatch.** 0.67s is f44 -> f64 in the
         * reference, and it is also exactly where the cast's own clip has the arm
         * out with the hand open - so the blood arrives in the hand that is
         * holding it out, which is the whole point of the beat.
         */
        gather: { delay: 0.67, life: 0.5 }
      }
    },
    berserk: {
      id: "berserk",
      name: "暴走",
      key: "Y",
      mp: 18,
      cooldown: 10,
      damage: 0,
      growth: 0,
      duration: 0.6,
      activeFrom: 0.12,
      activeTo: 0.2,
      reach: 0,
      heightPad: 0,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 1,
      /*
       * DNF shape: 暴走 is the Berserker's timed buff, and it is **not** 血之狂暴
       * - the two are separate skills with separate reference clips (see
       * CONTEXT.md and docs/adr/0016). 血之狂暴 is a stance you keep up (toggle,
       * no timer, dual blades, red body); 暴走 is a buff you re-cast: a real
       * duration, gone on its own.
       *
       * Its read is a cast icon over his head for a beat and a half (the same
       * art the hotbar shows), then 四条若隐若现的红丝 hanging round him for as
       * long as the buff runs (assets/dnf_src/bilibili/skill-clips/05_暴走.mp4,
       * measured frame by frame - the threads peak at 0.19% of the frame, which
       * a coarse red-pass missed entirely).
       *
       * **The numbers are deliberately over the client's.** The first cut used
       * the client's max-level 52% / 30% / 30% scaled down for a character still
       * on the level-up curve, and the owner played it and said it does not
       * land (「暴走效果不明显，比如移动速度等等 Buffer」, 2026-10-02). Measured
       * in the running game before touching it: walking was 265 px/s plain and
       * 331 with 暴走 - the hook was right and the number was just too small to
       * feel. So it now runs **above** the client's ceiling rather than below
       * it: a demo has one room to prove a buff in, and "有点效果" is not it.
       */
      castIcon: 1.5,
      buff: {
        id: "berserk",
        duration: 8,
        attackSpeed: 1.4,
        moveSpeed: 1.5,
        attackPower: 1.6
      }
    },
    /*
     * 魔狱血刹, the Berserker's 一觉 - and the first skill in this game that is a
     * **state before it is a move** (docs/adr/0025).
     *
     * Press it and the 觉醒插画 slides in over him while a 血气之剑 forms behind
     * his back; then the press is over and everything is as it was - except he is
     * carrying that sword, and everything he does for the next fifty seconds he
     * does with it on. The second press takes it into the ground (that half is
     * `hellbenterSlam`), and so does the clock running out.
     *
     * **The clock lives in `player.buffs`, not in `skillTimer`**, and that is the
     * whole reason the shape works: `startRoom` clears every skill field on the
     * player and deliberately leaves the buffs alone, so he walks into the next
     * room with the sword still on his back. A `skillTimer` would have dropped it
     * at the door.
     *
     * It is not in SKILL_ORDER: that list is the twelve hotbar slots (two rows of
     * six, all full) and it is also the row index of both baked sheets. Its key is
     * its own, the way 上挑's is - see `Loadout.SKILL_KEYS`.
     */
    hellbenter: {
      id: "hellbenter",
      name: "魔狱血刹",
      key: "V",
      /*
       * **A cooldown, not a once-a-run.** 业主 2026-10-06：「觉醒不能一局一次，
       * 像普通技能一样有冷却」。原来的 `cooldown: 0` 配着技能条上那句"一局一次"——
       * 那句话是骗人的（代码里根本没有一局一次的闸），而且他把话说反了：他不要
       * 一局一次，要的是**能再放**。
       *
       * 数取 **25**（一局就是三四十秒，五十秒的冷却等于"一局一次"——那正是他不要的）。
       * 别的技能最长的是 12（崩山裂地斩 / 崩山击），觉醒是这个倍数里最贵的那一个，
       * 但一局里放得出两三次。
       * 没有 MP——他要的是冷却，不是多一道门槛。
       */
      mp: 0,
      cooldown: 25,
      damage: 0,
      growth: 0,
      /* One second, which is the cut-in's own second in the reference. */
      duration: 1.0,
      /*
       * **The sword lands with the pose.** The 起手 motion is the client's own
       * 75-89 and its last frame is the stand he holds (see
       * `SPRITE.skillClips.hellbenter`), so the buff opens on the half second
       * that motion takes: the blade appears behind him exactly as he brings his
       * own around - the picture is already sliding back out, and the fifty
       * seconds are already running.
       */
      activeFrom: 0.5,
      activeTo: 0.6,
      /*
       * **霸体, for the same reason the 落 is.** The sword lands half a second
       * into this second-long 起手, so a single hit taken before then cancels
       * the cast and **the whole fifty seconds never happens** - measured:
       * `hellbenterTier` 0 and no buff after a hit at 0.2s, and 1 with the buff
       * up after the same hit at 0.7s. The 落's note says a grunt must not eat
       * what the fifty seconds were for (`docs/adr/0025`); the 起手 is what those
       * fifty seconds *are*, and it is the longer of the two windows. He still
       * takes every point of the damage (docs/adr/0018).
       */
      superArmor: true,
      reach: 0,
      heightPad: 0,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 1,
      /* `swordTier` is the tier the sword comes up at - see the buff branch. */
      buff: { id: "hellbenter", duration: 50, swordTier: 1 }
    },
    /*
     * The second press of 魔狱血刹's key, and what the clock triggers when it runs
     * out - one move, so the two ways of ending the state cannot drift apart.
     *
     * **This slice only takes the sword down.** The slam and the volcano (落剑
     * 1.5s, 喷发 3.15s - docs/adr/0025) are the next slice; what is here is the
     * ending that lets the two-press shape be played at all.
     */
    hellbenterSlam: {
      id: "hellbenterSlam",
      name: "魔狱血刹·落",
      key: "V",
      mp: 0,
      cooldown: 0,
      /*
       * The sword coming down is one blow; the **volcano is the field below**,
       * and it is where the rest of the damage lives. He is rooted for the fall
       * only - 0.6s - and then the ground keeps erupting without him, which is
       * the whole reason the eruption is a field and not a five-second cast
       * (docs/adr/0002's rule, and 大蹦's rift is the precedent).
       */
      /*
       * **5.4s: the blow, then the whole eruption with him still in the pose.** The
       * cast used to be 0.6s and then it let him go - a deliberate choice once
       * (「拍完 0.6 秒他就自由了」), and the owner has overruled it: 「在崩的过程中身体
       * 应该保持一个固定的姿势」. The reference holds one crouch from the slam to the
       * end of the column - 11_魔狱血刹 #158 through #230 and past it, the same low
       * forward pose frame for frame, and it only stands him up once the ground has
       * stopped (#330).
       *
       * So: the blow is still at 0.22s, the drive is still done by 0.6s (see the
       * beats in SPRITE.skillClips), and everything after that is the hold - the
       * ground burns its five seconds with him standing in it. The field opens at
       * 0.6s through `field.at`, not at the cast's end, or the volcano would be
       * 4.8s late.
       *
       * 5.4 = the 0.6s he needs + the 4.8s the field's own timeline runs to the end
       * of the column.
       */
      duration: 5.4,
      activeFrom: 0.22,
      activeTo: 0.3,
      reach: 120,
      heightPad: 20,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 1,
      damage: 26,
      growth: 6,
      /*
       * The blow itself **holds what it lands on** - the owner's reading of the
       * reference is 「砸地瞬间控制住被击的敌人」 - and then the ticks below keep
       * holding it while the column is up.
       */
      stun: 0.4,
      /*
       * **霸体, because the payoff must not be lost to a grunt.** The fall is
       * half a second of standing still in the middle of a room; without this, a
       * hit taken at the wrong moment cancels the one move the whole fifty
       * seconds was for. He still takes every point of the damage (docs/adr/0018).
       */
      superArmor: true,
      field: {
        /*
         * **8/59: where the caster's own art stopped.** The row is one
         * five-second timeline and the cast draws its first eight columns (see
         * `EFFECT.timing.hellbenterSlam.cast`), so the ground has to take over at
         * column 8 or the claw and the crescents would play twice - once in the
         * slam and again when the field opens. `from` is a progress, and a
         * column is `progress * 59`: 8/59.
         */
        from: 8 / 59,
        /*
         * **Seconds into the cast, not a progress of it.** The ground opens 0.6s
         * in - the moment the drive is done - and the field's own clock starts
         * there. (A progress would have to be re-read every time the hold's
         * length changes, which is exactly what it just did.)
         */
        at: 0.6,
        /*
         * **And it opens in front of him, not under him.** Measured on the
         * reference (#180): the crater's centre sits 305 video px ahead of his
         * own - and the clip draws him 195 video px tall against our 84 world px,
         * so that is **131 world px**, a little over 1.5 of his own heights. He
         * ends up at the crater's *near rim* (the art is 108 px either side) and
         * the column comes up well clear of him. Ours spawned on `caster.x`,
         * which put him inside his own volcano (the owner: 「崩的位置不对」).
         *
         * World px, not `SLAYER_HEIGHT`: that constant is the *cell* (156) and a
         * 身位 is the art (84), which is the one the reference's frames are
         * measured in - see CONTEXT.md's two units.
         */
        forward: 131,
        /*
         * Its own span, not the cast's: the row is a five-second timeline - slam,
         * crack, column, smoke - and the handover happens on its first frame
         * (`span` is what says so; see spawnField).
         */
        span: 5.0,
        linger: 0.6,
        /*
         * 火山: the eruption keeps hitting whatever is standing in the crack.
         * The numbers are the reference's own shape - 3.15s of eruption at about
         * a tick every sixth of a second is 17 beats, and it holds what it has
         * (`stun`, the same 定身 the reference's slam does) and knocks it down on
         * the way out.
         */
        tick: {
          interval: 0.18,
          from: 0.28,
          until: 0.93,
          radius: 1.3,
          depth: 1.3,
          damage: 12,
          growth: 3,
          stun: 0.32,
          knockdownLast: true
        }
      }
    },
    bloodyRave: {
      id: "bloodyRave",
      /*
       * **It was called 血气爆发 and that name was wrong** - the client's own
       * preview (`Swordman-BloodyRave.avi`) and the training-room clip
       * (`skill-clips/09_嗜魂封魔斩.mp4`) are the same move, section for section.
       * The id stays `bloodyRave` because that is the client's own name for it;
       * the owner confirmed the identity off two frame sheets (docs/adr/0022).
       */
      name: "嗜魂封魔斩",
      /* Its default slot is W (src/loadout.js DEFAULT_SLOTS); this is the label. */
      key: "W",
      mp: 40,
      cooldown: 12,
      /* The finisher's own cut. The vortex's ticks are priced separately below. */
      damage: 34,
      growth: 4,
      /*
       * **The one cast whose length is the player's.** `duration` is the *cap* -
       * press, hold the vortex no longer than 3.133s, then the tail - and letting
       * go early brings the end forward. Every second here is a reference second
       * (assets/dnf_effect_picks.md §25, `09_嗜魂封魔斩.mp4` at 30fps, #033 is the
       * press):
       *
       *   #033-036  0.000  the press: two gold frames, two dark red ones
       *   #037-041  0.133  the blade comes up, the hand goes out
       *   #042-052  0.300  the blood ball gathers in his hand and grows
       *   #053-058  0.667  it opens and runs out into the vortex
       *   #059-152  0.867  the vortex - **the stretch he can cut short**
       *   #153-156  4.000  it collapses back into his hand
       *   #157-161  4.133  the blade goes up and comes down
       *   #162-170  4.300  the golden cross
       *   #171-176  4.567  the afterglow
       *
       * He does not move through any of it: the reference's name plate never
       * shifts a pixel, so there is no `advance` and no `leap` here.
       */
      duration: 4.767,
      activeFrom: 0.867,
      activeTo: 4.0,
      /*
       * The vortex reaches **2.8-3.0 Slayer-heights in front of him** (measured
       * over the whole steady stretch; the middle of that band is 2.77) and stands
       * **1.68 high** - taller than he is. That is 245px and 141px, so the pad is
       * 141 minus his own 64. Depth takes the spin's lane rather than a melee
       * line's: it is a sweep across the floor, not a blade (DEPTH_REACH.spin).
       */
      reach: 245,
      heightPad: 77,
      knockbackX: 260,
      launch: 0,
      radius: 0,
      /* Only the finisher goes through the ordinary hit loop - see `channel`. */
      hits: 1,
      knockdown: true,
      depthReach: DEPTH_REACH.spin,
      /*
       * **按住／松手即收** (the owner's own pick, Q3 - it overrode my "fixed
       * length" recommendation; docs/adr/0023).
       *
       * `entrance` cannot be skipped: the reference spends 0.867s getting the ball
       * out before there is a vortex at all, and that is the move's whole warning.
       * After it, letting go at any frame runs `tail` and then the finisher.
       *
       * The vortex ticks on the reference's own beat - **0.300s**, the period the
       * steady stretch (#059-#152) autocorrelates to - and each tick pulls what it
       * catches toward him. Neither the tick nor the pull could be measured off
       * the clip: the training room has no monsters in it, so the reference shows
       * the vortex churning over bare floor. Those two numbers are the owner's
       * ruling (Q4) and are written down as invented, here and in the ledger.
       */
      channel: {
        entrance: 0.867,
        hold: 3.133,
        tail: 0.767,
        /* The finisher's cut, 0.300s after the release (the reference's #162). */
        hits: [0.300],
        tick: 0.3,
        tickDamage: 5,
        tickGrowth: 1,
        /* Px per second it drags what it has hold of toward his feet. */
        pull: 90,
        /* Nothing reaches him past this: the vortex has a near end. */
        stopAt: 46
      },
      /*
       * 霸体 and no more. The owner asked for 无敌 on 嗜魂之手 and got it, but that
       * move is 1.03s; this one can hold for 3.13 and then stands still for the
       * whole tail, and five seconds of i-frames would take half a room's threats
       * off the table. He takes the damage, keeps his feet, and finishes the move.
       */
      superArmor: true
    },
    rageBurst: {
      id: "rageBurst",
      name: "怒气爆发",
      key: "T",
      mp: 24,
      cooldown: 6.5,
      damage: 15,
      growth: 3,
      /*
       * 怒气爆发 is two eruptions a long beat apart, and the cast is the training
       * room's: assets/dnf_src/bilibili/skill-clips/08_怒气爆发.mp4 (97 frames at
       * 30fps, 32.900-36.133s), measured frame by frame with his own press at
       * #38 -
       *
       *   #38  0.000s  the press; he snaps into a braced stance
       *   #42  0.133s  a pool blooms at his feet
       *   #43  0.167s  the burst ring: 2.17 x 0.85 Slayer-heights of ground
       *   #49  0.367s  the ring is gone, and he settles back to his stand
       *   #69  1.033s  the column, 1.77 x 2.99, out of the same patch of floor
       *   #73  1.167s  it loses its footing and goes out
       *
       * He does not move: the nameplate riding over his head holds its row on all
       * 97 frames and drifts 7px across the whole clip, so there is no leap here
       * and no reach to fold - unlike 崩山击's one body height of hop.
       */
      duration: 1.2,
      /*
       * Three hits over the two eruptions: the engine spreads them evenly, so the
       * window is pinned to the ring (0.17s) and the column (1.03s) and the middle
       * one lands in the quiet stretch between them. That is the same price 大蹦
       * pays for its even spread, and it is written down for the same reason.
       */
      activeFrom: 0.17,
      activeTo: 1.03,
      reach: 0,
      heightPad: 0,
      knockbackX: 180,
      launch: -430,
      /*
       * The ring the clip draws is 2.17 Slayer-heights across - 1.09 either side
       * of his soles, measured on #46 where it is at its widest - so this is 92px
       * and not the 152 it used to be: the old number was sized to a circle round
       * the caster rather than to the art, and the art is what the clip shows.
       */
      radius: 92,
      hits: 3,
      /* DNF shape: 怒气爆发 erupts around the Slayer - blood out of the ground,
         three hits, and everything caught is lifted into the air. The lift is the
         owner's own reading of the move and the clip cannot speak to it - a
         training room has nothing standing in the fire - so it stays as it was. */
      juggle: true
    },
    bloodSnatch: {
      id: "bloodSnatch",
      name: "嗜血",
      key: "Y",
      mp: 18,
      cooldown: 5,
      damage: 26,
      growth: 3,
      duration: 0.5,
      activeFrom: 0.16,
      activeTo: 0.34,
      reach: 118,
      heightPad: 22,
      knockbackX: 200,
      launch: 0,
      radius: 0,
      hits: 1,
      knockdown: 0.5
    },
    graspHead: {
      id: "graspHead",
      name: "嗜魂之手",
      key: "U",
      mp: 20,
      cooldown: 7,
      damage: 24,
      growth: 3,
      /*
       * Two clips, and the owner pointed at both of them: the move's *body* is
       * the training-room one (skill-clips/04_嗜魂之手.mp4, 96 frames at 30fps)
       * and the *effect* is the one he called out inside the source recording
       * (BV1oUDLBaEaK.mp4, 76.63-77.63s - the only place this skill is on screen
       * with something in its hand; the training room has no target, so it fires
       * no VFX at all and is a pure motion demo).
       *
       * Both are the same animation, measured frame by frame:
       *
       *   training  #40-#43  wind-up, four frames, pixel-identical
       *             #44      one transition frame
       *             #45-#57  the hold, thirteen frames, pixel-identical
       *             #58      back on the stand        -> 18 frames = 0.600s
       *
       *   combat    f026-f028 wind-up, three frames held
       *             f029-f045 the same hold (verified against training #45-#57)
       *             f046-f047 the hand drops
       *             f049-f056 the burst, after he is already back on the stand
       *                                               -> 31 frames = 1.0333s
       *
       * The combat copy is the longer one because the burst is part of the
       * event and the training copy has no burst: its 0.600s is the body alone.
       * The owner picked the longer cut (2026-09-28), so the cast is the combat
       * clip's own 31 frames and the *body* beats below are the training clip's,
       * which is the one that resolves the transition into its own frame.
       *
       * He never leaves the ground (boot sole y=730 on all 96 training frames,
       * head row y=512 on all 96) and he never travels: the peak displacement is
       * 11.5 ref px = 4.4 client px, and he is back at zero by #58. So this move
       * carries no `advance` - **the only thing that moves is the hand**, 64 ref
       * px out and 71.9 ref px up. That is why the skill reads as
       * 定住 -> 伸手 -> 保持 rather than a swing, and why the hold is the move.
       *
       * `hold` is the combat clip's own hold: 17 frames = 0.567s. The burst has
       * no hit of its own - it is the *picture* of the slam, so the second hit
       * is pinned to where the clip puts the burst (f049 = 0.767s).
       */
      duration: 1.0333,
      activeFrom: 0.1333,
      activeTo: 1.0333,
      hitAt: [0.129, 0.742],
      reach: 52,
      heightPad: 12,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 2,
      /* DNF shape: grab the target, hold it, slam it down and drain some HP. */
      grab: { hold: 0.567, slamKnockdown: 1.1 },
      drain: 0.25,
      ignoresSuperArmor: true,
      /*
       * 无敌 for the whole cast, and 霸体 under it. The owner asked for both, in
       * that order: first 「这个技能不能被打断吧」 (which is 霸体) and then
       * 「这个技能要无敌」 (which is this). 无敌 is the one that answers him
       * completely - `damagePlayer` returns before it touches anything - and the
       * cast is the window, not `activeFrom`: the reach is the part that has to
       * survive being walked into.
       *
       * 霸体 stays because it is the flag for what this move is even without the
       * i-frames - a grab you can be shoved out of on the way in is not a grab -
       * and because it is the one that still holds on the frames either side of
       * an i-frame window.
       */
      invuln: 1.0333,
      superArmor: true
    },
    bloodEvil: {
      id: "bloodEvil",
      name: "血魔",
      key: "I",
      mp: 22,
      cooldown: 6,
      damage: 18,
      growth: 2.5,
      duration: 0.5,
      activeFrom: 0.06,
      activeTo: 0.34,
      reach: 96,
      heightPad: 20,
      knockbackX: 160,
      launch: 0,
      radius: 0,
      hits: 2,
      /* DNF shape: flash forward through the target with invincibility frames. */
      dash: 560,
      invuln: 0.45,
      stun: 0.2
    },
    mountainRift: {
      id: "mountainRift",
      name: "崩山裂地斩",
      key: "O",
      mp: 40,
      cooldown: 12,
      damage: 30,
      growth: 4,
      /*
       * The whole event is in the training-room clip the owner pointed at
       * (assets/dnf_src/bilibili/skill-clips/10_崩山裂地斩.mp4, 136 frames at
       * 30fps, 42.000-46.533s). Measured off it frame by frame, with the
       * caster's name plate as the marker for his own ground point:
       *
       *   #16  0.00s  the press: the sword comes up overhead (举剑)
       *   #17-32      he holds the raise while the blood sword gathers
       *   #33  0.57s  he leaps
       *   #42  0.87s  apex, 269 ref px up = 101px here
       *   #50  1.14s  lands 47px forward and drives the blade into the floor
       *   #51  1.17s  settles prone and the rift opens under the sword
       *   #51-59      the first wave: low fire out of the gash
       *   #60-83      only the cracks and their lava lines stay lit
       *   #84-110     the second wave: the tall eruption, 2.80-3.67s
       *   #88-96      he gets up while it burns
       *   #135 3.97s  he is back on his feet, the cracks still glowing
       *
       * So the cast is 4.0s, and the leap this move used to borrow from 崩山击
       * is *not* the 多余动作 the owner read off the client's own preview - the
       * training-room clip jumps 101px up and 47px forward. The clip's own arc
       * needs no bespoke gravity: -666 under the default 2200 peaks at 101px and
       * touches down 0.605s later, which is the reference to a pixel either way.
       */
      duration: 4.0,
      /*
       * Three hits, on the three things the reference does: the sword on the
       * landing (#50, 1.14s), the first eruption (#51-59, whose peak is 1.70s)
       * and the second (#84-110, erupting at 2.80s). The engine spreads them
       * evenly, so the window is pinned to the first and the third - the middle
       * hit then lands 0.26s after the first wave's peak, which is the price of
       * the even spread and is written down in assets/dnf_effect_picks.md.
       */
      activeFrom: 1.14,
      activeTo: 3.63,
      /*
       * 大蹦 is the 45-level ultimate, and the reference makes it a *forward*
       * move: the gash it opens is one-sided, roughly 265px wide with its middle
       * 95px in front of the caster (measured: 720x285 ref px of cracked ground,
       * centred 80-106px ahead of him). A circle round the caster would punish
       * the half of the floor the move never touches, so this is the forward box
       * - and it is still the longest reach in the kit.
       */
      reach: 245,
      heightPad: 48,
      knockbackX: 300,
      launch: 0,
      radius: 0,
      hits: 3,
      knockdown: 1.4,
      /*
       * The leap the reference does: a committed hop that is the raise plus the
       * drop. It fires as the body clip leaves the raise and touches down on the
       * beat the hits are timed to (leapFrom 0.135 + 2 * 666 / 2200 = 0.74 of the
       * 4s cast), and he is invulnerable and unblinking for all of it - the
       * reference holds a solid gold outline through the airborne frames rather
       * than a flicker (see the solidInvuln handling in updatePlayer).
       */
      leap: 78,
      leapUp: -666,
      leapFrom: 0.135,
      leapInvuln: 0.6,
      /*
       * And what the blade leaves on the floor is the *arena's*, not his
       * animation's. The reference has him back on his feet at #135 (3.97s) with
       * the cracks still glowing, and a real DNF carries this move as one a hit
       * can cut short - either way the fire he already opened goes on burning
       * where it was opened. So the landing hands the rift to a field record
       * (see spawnField): the spot, the facing and a clock of its own. The
       * renderer draws the ground off that record, which is why the rift stays
       * where it was cast, keeps burning when the cast is interrupted, and dies
       * down over `linger` after the cast rather than blinking out with it - the
       * handover itself happens at the end of the cast, or on the hit that ends
       * it early (see damagePlayer).
       */
      field: { from: 0.265, linger: 1.4 },
      shockwave: {
        reach: 250,
        damage: 18,
        growth: 3,
        heightPad: 30,
        knockbackX: 340,
        knockdown: 1.4,
        extraWaveFromLevel: 4,
        /*
         * The engine's ellipse is not the rift's shape. It used to be kept and
         * shrunk onto the fire's own circle (the old `arcOffset: 0`); now that
         * the fire is a one-sided gash there is no circle for it to agree with,
         * and the reference has no ring anywhere in it - the ground answers with
         * cracked floor and fire, nothing else (owner, on the same shape in
         * 崩山击: 「参考视频没有范围圈」). The hitbox, the knockback and the
         * screen shake all stay; only the drawn arc goes.
         */
        arc: false
      },
      /*
       * The ground wave belongs to the sword coming down, not to the last tick:
       * the other two hits are the rift grinding and the second eruption, and
       * they happen a second after he has already landed.
       */
      shockwaveHit: 0,
      /*
       * And the gash is a patch on the floor. Its art is the same one that was
       * hand-staggered to read that way (see DEPTH_REACH.floor), so the reach
       * and the picture finally agree about how much ground it covers.
       */
      depthReach: DEPTH_REACH.floor
    },
    /*
     * 银光落刃: the move the client puts on Z while the Slayer is in the air.
     * It is a dive - he drops straight down with the sword point first, lands on
     * the blade and the floor answers with a ring. DNF also gives it a chance to
     * put whatever it lands on the floor, which is what knockdownChance is for.
     *
     * It is not a hotbar skill: no slot, no icon, no effect row of its own. Z is
     * its only way in, and only off the ground.
     */
    silverFall: {
      id: "silverFall",
      name: "银光落刃",
      key: "Z",
      mp: 10,
      cooldown: 3,
      damage: 20,
      growth: 3,
      duration: 0.5,
      activeFrom: 0.08,
      activeTo: 0.34,
      reach: 70,
      heightPad: 20,
      knockbackX: 120,
      launch: 0,
      radius: 0,
      hits: 1,
      knockdown: 1.0,
      knockdownChance: 0.6,
      airOnly: true,
      /*
       * The dive drives him into the ground instead of waiting for gravity, and
       * it carries him forward: the owner's read is that the landing point is
       * ahead of where he let go, not straight down.
       */
      dive: 980,
      diveForward: 300,
      shockwave: {
        reach: 150,
        damage: 8,
        growth: 2,
        heightPad: 12,
        knockbackX: 160,
        knockdown: 0.7,
        extraWaveFromLevel: 3
      }
    }
  };

  var SKILL_ORDER = [
    "upSlash",
    "mountainBreaker",
    "crossSlash",
    "bloodSword",
    "frenzy",
    "bloodyRave",
    "rageBurst",
    "bloodSnatch",
    "graspHead",
    "bloodEvil",
    "mountainRift",
    /*
     * 暴走 sits last rather than next to 血之狂暴 because SKILL_ORDER doubles as
     * the row index of both baked sheets (assets/effects.png and skills.png):
     * appending keeps every existing row where the art already has it.
     */
    "berserk"
  ];
  /*
   * Every skill the Slayer can end up casting, in the order the cooldown table
   * and its countdown walk. 银光落刃 is in here but not in SKILL_ORDER: it has no
   * hotbar slot, no icon and no effect row of its own (SKILL_ORDER drives all
   * three), so it stays a Z-in-the-air move only.
   */
  var CASTABLE_SKILLS = SKILL_ORDER.concat([
    "silverFall",
    /*
     * 魔狱血刹 is castable, hotbarred nowhere: its own key raises the sword and
     * the same key brings it down. Both halves are here because this list is
     * what the cooldown table is built from - a skill missing from it has
     * `undefined <= 0` for a cooldown and can never pass the gate.
     */
    "hellbenter",
    "hellbenterSlam"
  ]);

  var PROGRESSION = {
    baseXpToNext: 30,
    growth: 1.6,
    maxHpPerLevel: 12,
    maxMpPerLevel: 5,
    attackPerLevel: 2,
    healOnLevelUp: 12,
    maxLevel: 12
  };

  /*
   * 血之狂暴 pulls blood out of whatever the Slayer hits: a landed hit has a
   * chance to draw an orb that flies into him and heals on arrival. The orb
   * ignores gravity on purpose - it is being pulled towards him, not dropped.
   *
   * **It is pulled in, and that is a shape, not a speed.** The reference's trip
   * is 0.55s - it leaves the monster around #79 and goes off on his chest at
   * #846 - but it does not spend them evenly: it drifts out of the body, then
   * the last fifth of the crossing covers most of the distance. That ease is
   * what "being drawn into him" looks like, and a constant speed reads as a
   * projectile instead (docs/adr/0020).
   *
   * So the orb is parameterised by *time*: `progress` runs 0 to 1 over
   * `flightSeconds` and the ball sits at `progress²` of the way from where it
   * was drawn to wherever he is now. Being homing falls out of that for free -
   * the far end of the line is his chest, re-read every frame - and so does
   * arriving on time, whatever the distance was.
   */
  /*
   * 魔狱血刹's 铸剑, as a rule rather than as art (docs/adr/0025): how many tiers
   * the sword has, how much fighting buys one tier, and what a kill is worth on
   * top of that.
   *
   * **A hit forges it; a clock does not.** The owner's own reading of the
   * reference is 「需要通过攻击从怪物身上汲取血气」 - the sword is paid for by
   * fighting, so a player who never swings carries the small one to the end.
   *
   * **Ten hits to a tier, not one.** One-per-hit filled all eight tiers inside
   * the first two monsters - a run is ~14 enemies and ~120 landed hits, so the
   * sword was maxed a sixth of the way in and the rest of the run bought
   * nothing. The owner played it and said so: 「你现在的短剑长得有点快」.
   * A tier now costs 10 hits and a kill pays a whole tier outright, so a full
   * sword is 80 hits' worth - about six tenths of a run's fighting, which puts
   * the last tiers on the boss room where the 51-second hold wants them.
   */
  var HELLBENTER = {
    tiers: 8,
    /* Landed hits that buy one tier. */
    hitsPerTier: 10,
    /* And what a kill is worth on top, in whole tiers. */
    killTiers: 1,
    /* How long one 血丝 takes to fly from the wound to his chest. */
    strandLife: 0.32
  };

  var BLOOD_ORB = {
    chance: 0.34,
    heal: 4,
    /* The ball itself: 0.47 Slayer-heights across, off the reference (#836:
     * its red mass is ~100px against his ~210). */
    radius: 20,
    flightSeconds: 0.55,
    /* Long enough that a ball can never be left hanging in the air. */
    lifetimeSeconds: 1.2,
    /*
     * The trail: how many of the ball's own past positions the renderer is
     * given to draw behind it. `trailStep` is the spacing, in ball radii, so
     * the tail is a fixed *length* behind the ball - about 1.8 ball-widths,
     * which is what the reference drags (#842-845) - rather than a fixed slice
     * of the flight, which would make a long crossing a long tail. The spacing
     * is well under a radius so the copies run into one another and read as a
     * smear with red blobs in it, which is what the reference's tail is.
     */
    trailSteps: 6,
    trailStep: 0.55
  };

  /*
   * How far up his body a 血球 lands, as a share of his collision box. The
   * reference puts it at the middle of his chest (#847: the flash goes off
   * about 55% of the way up a character drawn 84px tall), which is higher than
   * the box's own middle because the box is 64 and the art is 84.
   */
  var CHEST_OF_HEIGHT = 0.75;

  /*
   * **Sizes here are gameplay, not art.** `width` and `height` are the boxes the
   * AI and the hit tests reason about, and every range below was tuned against
   * them - they are centre-to-centre (`chooseEnemyAction`), so a body that grows
   * without its ranges growing beside it stops being able to reach anything.
   *
   * The monsters are *drawn* at the size the client draws them, which is a
   * separate number on purpose: see `MONSTER.draw` in src/render.js. Measured off
   * the owner's 幽暗密林 recording, a goblin is about 0.85 of a Slayer on screen
   * and 牛头巨兽 is about 3.2 - so the beast is drawn at more than three times a
   * goblin, which is most of what makes it read as a boss, while the fight it
   * fights is still the one these boxes were tuned for.
   */
  /*
   * **The monsters are the size the client draws them, and the boxes are that
   * size.** Every reach below is measured **past the body** (`bodyGap`), so a
   * body can change size without its reach changing with it - which is the whole
   * reason 牛头巨兽 can be as big as it looks.
   *
   * The sizes come off the owner's 幽暗密林 recording through one conversion: the
   * Slayer measures 240 px there and is 84 world px here, so 1 world px is about
   * 2.86 video px. A goblin measures 146-153 px (-> 53) and 牛头巨兽 574 px
   * (-> **201**), i.e. the beast is more than three times a goblin, which is
   * most of what makes it read as a boss. Width follows the art's own aspect.
   *
   * Every reach was converted one for one from the centre-to-centre numbers this
   * file used before, by subtracting the body span it had been measured against,
   * so the fight on screen is still the one those numbers were tuned for.
   */
  /*
   * **每只怪的身份：`label`（名字）、`race`（类别）、`level`（等级）。**
   *
   * 这三样不是给玩法用的，是给左上角那块**"当前目标"**面板用的
   * （量法与依据见下面的 `TARGET`）。它们放在这里而不是另开一张表，是为了让
   * "一只怪是什么"只有一个地方—— 挑名字的人不会漏掉一只怪。
   *
   * **出处**：业主的幽暗密林录像里，那块条上出现过的全部写法是
   * `人型 Lv4` 加 {哥布林, 胆小哥布林, 青哥布林, 赤哥布林, 投掷哥布林,
   * 燃烧之投掷哥布林, 诅咒之赤哥布林}，以及 `野兽 Lv7 领主 - 牛头巨兽`。
   * 所以：**杂兵一律 Lv4、Boss Lv7**，名字照客户端自己的叫法
   * （`docs/granfloris-assets.md` 的怪物总表）。
   *
   * 录像里没有、名字只能照着客户端总表读的两个（都标在它们自己那一条上）：
   * `brute` 与 `elite`。
   */
  var ENEMY_TYPES = {
    grunt: {
      /* 录像里出现最多的那一只：`人型 Lv4 哥布林`。 */
      label: "哥布林",
      race: "人型",
      level: 4,
      behavior: "melee",
      maxHp: 32,
      xp: 10,
      width: 33,
      height: 53,
      speed: 62,
      damage: 6,
      attackRange: 14,
      attackWindup: 0.28,
      attackDuration: 0.5,
      attackCooldown: 1.05,
      knockbackX: 150
    },
    /*
     * **换色的哥布林：同一套十七帧动作、同一个兵种，只是换了一张皮。**
     *
     * 这一个是业主连说两次「怪物少」之后补上的。量出来的答案不是"数量不够"
     * （录像同屏 2–4 只，本作正房 3 只，对得上），而是**三只长得一模一样** ——
     * 客户端那一族本来就是**同一画布十具换色**（`goblin/body0..9`），业主录像
     * 那块条上写过七个哥布林变体，而本作原来只烘了 `body0` 一具。
     *
     * 颜色是**量的平均色**对上的（`assets/import_dnf_monsters.py` 的 ROSTER）：
     * `body7` (44, 98, 129) 蓝 → 录像里的 `青哥布林`；`body8` (145, 53, 45) 红 → `赤哥布林`。
     */
    goblinBlue: {
      label: "青哥布林",
      race: "人型",
      level: 4,
      behavior: "melee",
      maxHp: 32,
      xp: 10,
      width: 33,
      height: 53,
      speed: 62,
      damage: 6,
      attackRange: 14,
      attackWindup: 0.28,
      attackDuration: 0.5,
      attackCooldown: 1.05,
      knockbackX: 150
    },
    goblinRed: {
      label: "赤哥布林",
      race: "人型",
      level: 4,
      behavior: "melee",
      maxHp: 32,
      xp: 10,
      width: 33,
      height: 53,
      speed: 62,
      damage: 6,
      attackRange: 14,
      attackWindup: 0.28,
      attackDuration: 0.5,
      attackCooldown: 1.05,
      knockbackX: 150
    },
    /*
     * 胆小哥布林: the same melee rank and file, but it breaks sooner and comes
     * back faster - less health than a grunt and quicker on its feet. It is a
     * stat change on `melee`, not a new behaviour, which is what the stage's
     * roster asked for (`docs/adr/0026` 换皮为主).
     */
    coward: {
      /* 录像：`人型 Lv4 胆小哥布林`。 */
      label: "胆小哥布林",
      race: "人型",
      level: 4,
      behavior: "melee",
      maxHp: 22,
      xp: 8,
      width: 33,
      height: 53,
      speed: 77,
      damage: 5,
      attackRange: 12,
      attackWindup: 0.24,
      attackDuration: 0.44,
      attackCooldown: 0.9,
      knockbackX: 130
    },
    /*
     * **换色的哥布林不是换一具身体，是同一具加一圈光环。** 客户端那一族本来就是同一套
     * 画布十具换色（`goblin/body0..9`），而"冠军怪"（champion）在客户端里是**另加一层
     * `champ*.img`**：录像里那只 `咒之赤哥布林` 身上那圈紫光正是 `champdark`，
     * `燃烧之投掷哥布林` 是投掷哥布林加 `champfire`（`docs/adr/0046`）。
     *
     * 所以这两条**一具新身体都不烘**：同一个兵种加一层光环，血厚一点、打得重一点。
     * 名字与类别照录像那块条读，数值是本作自己的。
     */
    cursedRed: {
      /* 录像：`人型 Lv4 咒之赤哥布林`（(2,1) 那一间，身上一圈紫光）。 */
      label: "咒之赤哥布林",
      race: "人型",
      behavior: "melee",
      champion: "dark",
      maxHp: 40,
      xp: 14,
      width: 33,
      height: 53,
      speed: 62,
      damage: 7,
      attackRange: 14,
      attackWindup: 0.28,
      attackDuration: 0.48,
      attackCooldown: 1.1,
      knockbackX: 130
    },
    burningThrower: {
      /* 录像那块条上念到过的名字；行为就是投掷哥布林那一套，加一圈火光。 */
      label: "燃烧之投掷哥布林",
      race: "人型",
      behavior: "ranged",
      champion: "fire",
      maxHp: 34,
      xp: 18,
      width: 32,
      height: 55,
      speed: 49,
      damage: 9,
      attackRange: 178,
      keepRange: 118,
      attackWindup: 0.5,
      attackDuration: 0.8,
      attackCooldown: 1.9,
      knockbackX: 130,
      projectile: { speed: 215, radius: 9, life: 1.4, maxDistance: 300, height: 34 }
    },
    brute: {
      /*
       * **录像里没有这只怪**（幽暗密林那头牛只有 Boss 那一只），名字照客户端的
       * 牛头一族读：`sprite_monster_tau.NPK` 的 body01 与 Boss 用的 body02 同族，
       * Boss 是"巨兽"，这一只就是**牛头怪**。类别跟着 Boss 走 `野兽`，等级按"杂兵 Lv4"。
       */
      label: "牛头怪",
      race: "野兽",
      level: 4,
      behavior: "melee",
      maxHp: 68,
      xp: 22,
      width: 68,
      height: 80,
      speed: 44,
      damage: 13,
      attackRange: 17,
      attackWindup: 0.42,
      attackDuration: 0.7,
      attackCooldown: 1.5,
      knockbackX: 200
    },
    caster: {
      /* 录像：`人型 Lv4 投掷哥布林`（客户端 `goblin/rtrowgoblin.img`，就是投掷那一只）。 */
      label: "投掷哥布林",
      race: "人型",
      level: 4,
      behavior: "ranged",
      maxHp: 26,
      xp: 14,
      width: 32,
      height: 55,
      speed: 49,
      damage: 7,
      attackRange: 178,
      keepRange: 118,
      attackWindup: 0.5,
      attackDuration: 0.8,
      attackCooldown: 1.9,
      knockbackX: 130,
      projectile: {
        speed: 215,
        radius: 9,
        life: 1.4,
        maxDistance: 300,
        height: 34
      }
    },
    charger: {
      /*
       * 本作自己写的兵种，客户端没有对应美术（`docs/granfloris-assets.md` 第六节），
       * 也没有出现在录像里 —— 名字是照它的行为起的。
       */
      label: "冲锋兵",
      race: "人型",
      level: 4,
      behavior: "charger",
      maxHp: 46,
      xp: 18,
      width: 36,
      height: 62,
      speed: 42,
      damage: 15,
      attackRange: 135,
      attackWindup: 0.5,
      attackDuration: 1.5,
      attackCooldown: 2.2,
      knockbackX: 210,
      chargeSpeed: 520,
      chargeFrom: 0.5,
      chargeTo: 0.86
    },
    /*
     * Elite mini-boss: the gauntlet's skill check. Slower and tankier than the
     * rank and file, and it owns one long-telegraphed move - a super-armoured
     * spinning sweep that carries a wide hitbox forward instead of a single
     * stationary slam. Clearing the spin means leaving the lane, not stepping
     * one body-width aside.
     */
    elite: {
      /*
       * **录像里没有这只怪**（幽暗密林那几间房没有白毛这一个），名字照客户端读：
       * `goblin/whiteboss.img`（白毛 + 蓝弯刀）在 `docs/granfloris-assets.md` 的
       * 怪物总表里写的是"疑**十夫长**" —— 那是个**存疑的读法**，而本作把它放在
       * 「十夫长的营寨」，两边对得上，所以就用这个名。哪天真从客户端里查到别的写法，
       * 改这一行即可。
       */
      label: "十夫长",
      race: "人型",
      level: 4,
      behavior: "elite",
      /*
       * 回避: a hit can slide off him. The elite and the boss are the only two
       * things in the game that have any, and they are the only reason
       * 血之狂暴's 命中 exists - grunts are exactly as hittable as they always
       * were, so clearing a room is unchanged (docs/adr/0018).
       */
      evasion: 0.15,
      maxHp: 150,
      xp: 45,
      width: 39,
      height: 61,
      speed: 47,
      damage: 16,
      attackRange: 24,
      attackWindup: 0.38,
      attackDuration: 0.72,
      attackCooldown: 1.7,
      knockbackX: 220,
      spinDash: {
        speed: 195,
        windup: 0.75,
        duration: 0.45,
        recovery: 0.5,
        cooldown: 5,
        /* Edge-relative, like every other reach here - `spinHitsPlayer` adds it
           to his own body. */
        radius: 84,
        /* When he decides to spin: the gap he commits from. */
        commit: 73,
        damage: 14
      }
    },
    boss: {
      /* 录像里那条唯一的 `野兽`：`Lv7 领主 - 牛头巨兽`（客户端 `tau/body02.img`）。 */
      label: "领主 - 牛头巨兽",
      race: "野兽",
      level: 7,
      behavior: "boss",
      /* 回避, the same as the elite's - see the note there. */
      evasion: 0.15,
      maxHp: 260,
      xp: 80,
      /*
       * **172x201 → 138x168**（`docs/adr/0050` 追记）。录像里它站着是 355x530 视频px；
       * 高度那一边是硬的（265 视频px = 1 身位，530 就是 **2.00 身位**），本作画出来
       * **2.39** —— 偏大 **1.20 倍**。改的是这一个数：**渲染按 `height / stand` 缩那张
       * sheet**，所以美术与判定一起缩，宽度按同一比例落到 138（美术画出来就是 138）。
       *
       * 它同时是判定（`docs/adr/0037`：那个数既是美术也是判定），所以跟着改的还有
       * 那一记地面重踏的半径（下一条）。
       */
      width: 138,
      height: 168,
      speed: 57,
      damage: 18,
      attackRange: 29,
      attackWindup: 0.36,
      attackDuration: 0.66,
      attackCooldown: 1.15,
      knockbackX: 260,
      chargeSpeed: 430,
      chargeFrom: 0.22,
      chargeTo: 0.62,
      slam: {
        /*
         * A disc on the floor, so its reach is floored rather than past the
         * body: 105 px past a body that is 103 px half-wide (the beast's 172
         * plus the Slayer's 34, halved), which is the 150 it was.
         */
        /*
         * 208 → 191：那一圈是"盘子的边比**身体半宽**再远 105"（`docs/adr/0036`），
         * 身体半宽从 (172+34)/2 = 103 变成 (138+34)/2 = 86 —— 那 105 是量出来的，不变。
         */
        radius: 191,
        /* When it decides to slam: the gap it commits from. */
        commit: 75,
        damage: 20,
        windup: 0.7,
        recovery: 0.5,
        cooldown: 3.6
      },
      phase2: {
        banner: "Goblin King enraged!",
        hpRatio: 0.5,
        speedScale: 1.28,
        damageScale: 1.2,
        cooldownScale: 0.7,
        windupScale: 0.82,
        slamRadiusScale: 1.18,
        slamCooldownScale: 0.55,
        lunge: {
          gap: 165,
          minGap: 51,
          speed: 280,
          windup: 0.34,
          recovery: 0.5,
          cooldown: 4.2
        }
      }
    }
  };

  /*
   * 地区 -> 关卡 -> 房间 (`CONTEXT.md`, `docs/adr/0026`).
   *
   * A stage is one named dungeon: a run of rooms ending in its own boss, and a
   * **run of its own** - the seed, the upgrade cards and the record all live
   * inside one stage now. The eight stages of 格兰之森 are the whole game; the
   * old six-room tower, and the Goblin King that sat at the top of it, are gone.
   *
   * Only 幽暗密林 has rooms so far. The rest are declared because the region map
   * draws all eight slots (the client's own stage-select strip has them) and a
   * stage with no `rooms` simply cannot be entered yet.
   */
  var REGION = {
    id: "granfloris",
    name: "格兰之森",
    /* Unlock order: parent stage first, its variant right behind it. */
    stages: [
      "mirkwood",
      "mirkwooddeep",
      "sunderland",
      "mirkwoodfrost",
      "sunderlandpoison",
      "grakkarak",
      "grakkarakburning",
      "sunderlanddark"
    ]
  };

  var STAGES = {
    mirkwood: {
      id: "mirkwood",
      /* The client's own code, off the `sprite/map/title/mirkwood.img` banner. */
      code: "mirkwood",
      name: "幽暗密林",
      /* 适合等级, off the DNF table; the run opens at `level[0]`. */
      level: [3, 5],
      /* Which frame of the client's stage-select strip is this stage. */
      slot: 0,
      /*
       * Six rooms declared, five fought: a run draws three of the four
       * non-gauntlet combat rooms, so the seed still decides the order and which
       * one is skipped. `gauntlet` always sits directly before the beast, which
       * is what makes it a ramp rather than a coin flip.
       */
      rooms: [
        {
          name: "林间空地",
          /* 起点房：地牢一进来就是它（`MIRKWOOD_DUNGEON.entryRoom`）。 */
          kind: "room",
          enemies: [
            { type: "grunt", x: 430 },
            { type: "grunt", x: 489 },
            { type: "goblinBlue", x: 700 },
            { type: "grunt", x: 759 }
          ],
          props: [
            { piece: "trunkTall", x: 150, depth: 1 },
            { piece: "trunkBent", x: 430, depth: 1 },
            { piece: "trunkMossy", x: 780, depth: 1 },
            { piece: "treeLeafy", x: 620, depth: 0.86 },
            { piece: "bush", x: 300, depth: 0.62 },
            { piece: "grassFlower", x: 640, depth: 0.5 },
            { piece: "rockSmall", x: 900, depth: 0.34 },
            { piece: "sprout", x: 60, depth: 0.12 }
          ]
        },
        {
          /*
           * The throwers hold a row of their own, so this fight asks for a step
           * into the screen before it can be won - the same job the old caster
           * rooms did, said again with goblins (`chooseEnemyAction` holds it).
           */
          name: "投石坡",
          kind: "room",
          enemies: [
            { type: "caster", x: 400, depth: 0.34 },
            { type: "grunt", x: 459 },
            { type: "grunt", x: 518 },
            { type: "grunt", x: 760 },
            { type: "goblinBlue", x: 819 },
            { type: "burningThrower", x: 878 }
          ],
          props: [
            { piece: "trunkBent", x: 210, depth: 1 },
            { piece: "trunkMossy", x: 560, depth: 1 },
            { piece: "wallStone", x: 470, depth: 0.72 },
            { piece: "rockFlat", x: 240, depth: 0.4 },
            { piece: "rockSmall", x: 700, depth: 0.46 },
            { piece: "grass", x: 860, depth: 0.3 },
          ]
        },
        {
          name: "兽栏",
          kind: "room",
          enemies: [
            { type: "grunt", x: 380 },
            { type: "brute", x: 439 },
            { type: "brute", x: 533 },
            { type: "goblinRed", x: 760 },
            { type: "grunt", x: 819 },
            { type: "goblinBlue", x: 878 }
          ],
          props: [
            { piece: "trunkTall", x: 340, depth: 1 },
            { piece: "trunkMossy", x: 700, depth: 1 },
            { piece: "pillar", x: 250, depth: 0.66 },
            { piece: "pillar", x: 800, depth: 0.66 },
            { piece: "grass", x: 620, depth: 0.14 }
          ]
        },
        {
          /*
           * 十夫长的营寨, the gauntlet: the ten-captain is the skill check, and
           * the thrower behind him keeps the floor honest while he spins.
           */
          name: "十夫长的营寨",
          kind: "room",
          enemies: [
            { type: "caster", x: 420, depth: 0.4 },
            { type: "grunt", x: 479 },
            { type: "grunt", x: 538 },
            { type: "elite", x: 760 },
            { type: "grunt", x: 824 },
            { type: "cursedRed", x: 883 }
          ],
          props: [
            { piece: "trunkTall", x: 120, depth: 1 },
            { piece: "trunkBent", x: 660, depth: 1 },
            { piece: "wallStone", x: 330, depth: 0.78 },
            { piece: "flower", x: 880, depth: 0.22 },
            { piece: "bush", x: 60, depth: 0.16 }
          ]
        },
        {
          /*
           * The alternate: they arrive in a pack and the floor is theirs,
           * because this is the room they dug.
           *
           * **不是"它们会逃"。** 这里原先写着 the cowards break and run —— 那是
           * 从名字推的，录像里查过：目标条上认出来的那几只（(2,1)、t≈59.3-62.0 s）
           * 始终贴在他身旁一个身位以内、面朝他，同进同退，**与普通哥布林没有可分辨的
           * 差别**；走速也分不出快慢，也没有缩成一团/原地发抖这类独有的动作。
           * 所以本作**不给它逃的 AI**（业主 2026-10-14 定）。它自己的两个数留着：
           * 血更低（22 对 32）、走得稍快（77 对 62）—— 那是本作的设计，不是量出来的。
           *
           * Wider than the default floor, which is what the room already is: a
           * warren is something you cross, not a corridor you hold - 150 screen
           * px against 120, so a third more ground to be pushed across.
           *
           * 这里原先还埋着两块会塌的石板（`hazards`）。业主 2026-10-10 的原话是
           * 「以后也不要有这种陷阱」，所以整套塌陷地板拆了 —— 连同 `Core.HAZARD`、
           * `updateHazards` 和那条提示。它不是幽暗密林的东西，是从已经删掉的
           * 「沉没礼拜堂」搬过来的（`docs/adr/0030`）。
           */
          name: "胆小鬼的窝",
          kind: "room",
          enemies: [
            { type: "coward", x: 400 },
            { type: "coward", x: 459 },
            { type: "coward", x: 518 },
            { type: "coward", x: 740 },
            { type: "coward", x: 799 },
            { type: "goblinBlue", x: 858 }
          ],
          props: [
            { piece: "trunkMossy", x: 100, depth: 1 },
            { piece: "trunkBent", x: 380, depth: 1 },
            { piece: "trunkTall", x: 880, depth: 1 },
            { piece: "stump", x: 520, depth: 0.74 },
            { piece: "bush", x: 240, depth: 0.56 },
            { piece: "bush", x: 700, depth: 0.5 },
            { piece: "sprout", x: 780, depth: 0.26 },
            { piece: "grassFlower", x: 430, depth: 0.18 }
          ],
          band: { backY: 280 }
        },
        {
          /*
           * 牛头巨兽的林地. The beast charges on a line, so this floor is a
           * little wider than the default instead of narrower: there has to be
           * somewhere to be that is not in front of it.
           *
           * 这是 Boss 房（`MIRKWOOD_DUNGEON.bossRoom`）：地图上 (0,2) 那格的东出口
           * 通回 (1,2)，两条路都要穿过它，所以这一格是地牢的尽头。
           */
          name: "牛头巨兽的林地",
          kind: "room",
          enemies: [
            { type: "grunt", x: 420 },
            { type: "grunt", x: 479 },
            { type: "goblinRed", x: 538 },
            { type: "boss", x: 800 }
          ],
          props: [
            { piece: "trunkTall", x: 210, depth: 1 },
            { piece: "trunkMossy", x: 560, depth: 1 },
            { piece: "trunkBent", x: 900, depth: 1 },
            { piece: "rockFlat", x: 680, depth: 0.62 },
            { piece: "stump", x: 400, depth: 0.44 },
            { piece: "grass", x: 120, depth: 0.2 }
          ],
          /*
           * **这一间自己一副样子**（`docs/adr/0047`）：录像里 Boss 房的草地几乎
           * 没有高草（一屏 0–2 丛，别的房间 0–5），所以只在这里改这一档的件数。
           */
          scatter: { tall: 1 },
          band: { backY: 300 }
        },

        /*
         * 下面六间是**走廊格**（地图上画成线的那些格子）。录像里它们在画面上
         * 和别的房间一模一样 —— 一屏、有树有桶、有仗打（量过：(1,0)/(1,1)/(1,2)
         * 三格他各待了 24 / 38 / 41 秒，画面里都有哥布林）；不一样的是**地图上
         * 那一格的形状**，以及它们都只有两条到三条路、是过道不是尽头。
         *
         * 所以名单轻一档：两只是"挡路的"，不是"这一间的内容"。哪一间摆在哪一格由
         * 种子洗牌（`dungeonFor`），所以名字不能写死到格子上去。
         */
        {
          name: "藤蔓窄道",
          kind: "corr",
          enemies: [
            { type: "coward", x: 420 },
            { type: "coward", x: 479 },
            { type: "coward", x: 700 },
            { type: "coward", x: 759 }
          ],
          props: [
            { piece: "trunkBent", x: 150, depth: 1 },
            { piece: "bush", x: 400, depth: 0.62 },
            { piece: "grass", x: 720, depth: 0.4 },
          ]
        },
        {
          name: "倒木小径",
          kind: "corr",
          enemies: [
            { type: "grunt", x: 420, depth: 0.2 },
            { type: "coward", x: 479 },
            { type: "coward", x: 700 },
            { type: "goblinBlue", x: 759 }
          ],
          props: [
            { piece: "trunkTall", x: 250, depth: 1 },
            { piece: "stump", x: 470, depth: 0.7 },
            { piece: "rockFlat", x: 620, depth: 0.44 },
            { piece: "sprout", x: 330, depth: 0.24 },
          ]
        },
        {
          name: "腐叶浅沟",
          kind: "corr",
          enemies: [
            { type: "grunt", x: 420 },
            { type: "grunt", x: 479, depth: 0.28 },
            { type: "cursedRed", x: 700 },
            { type: "grunt", x: 759 }
          ],
          props: [
            { piece: "trunkMossy", x: 180, depth: 1 },
            { piece: "bush", x: 520, depth: 0.58 },
            { piece: "grassFlower", x: 760, depth: 0.3 },
            { piece: "rockSmall", x: 380, depth: 0.4 },
          ]
        },
        {
          name: "雾林岔口",
          kind: "corr",
          enemies: [
            { type: "caster", x: 420, depth: 0.38 },
            { type: "grunt", x: 479 },
            { type: "grunt", x: 700 },
            { type: "goblinBlue", x: 759 }
          ],
          props: [
            { piece: "trunkMossy", x: 260, depth: 1 },
            { piece: "pillar", x: 470, depth: 0.66 },
            { piece: "grass", x: 640, depth: 0.36 },
          ]
        },
        {
          name: "断桩隘口",
          kind: "corr",
          enemies: [
            { type: "grunt", x: 420, depth: 0.3 },
            { type: "brute", x: 482 },
            { type: "brute", x: 742 },
            { type: "grunt", x: 802 }
          ],
          props: [
            { piece: "trunkBent", x: 160, depth: 1 },
            { piece: "stump", x: 420, depth: 0.72 },
            { piece: "rockSmall", x: 660, depth: 0.42 },
            { piece: "bush", x: 300, depth: 0.5 }
          ]
        },
        {
          name: "苔石夹道",
          kind: "corr",
          enemies: [
            { type: "grunt", x: 420, depth: 0.26 },
            { type: "caster", x: 479 },
            { type: "grunt", x: 700 },
            { type: "burningThrower", x: 759 }
          ],
          props: [
            { piece: "wallStone", x: 240, depth: 0.78 },
            { piece: "rockFlat", x: 500, depth: 0.52 },
            { piece: "grass", x: 820, depth: 0.34 },
          ]
        }
      ],
      bossIndex: 5,
      gauntletIndex: 3,
      /*
       * The banner it says when the beast crosses half health. **Its name is not
       * here** - a monster's name lives on the monster (`ENEMY_TYPES.boss.label`,
       * `领主 - 牛头巨兽`), because that is what the 当前目标 panel shows and what
       * the reference writes; this field used to hold a second, shorter copy of it
       * and was read by nothing but a test.
       */
      bossBanner: "牛头巨兽 暴怒！",
      clearBanner: "幽暗密林 通关！"
    },

    mirkwooddeep: {
      id: "mirkwooddeep",
      code: "mirkwooddeep",
      name: "幽暗密林深处",
      level: [4, 7],
      slot: 1,
      rooms: []
    },
    sunderland: {
      id: "sunderland",
      code: "sunderland",
      name: "雷鸣废墟",
      level: [6, 9],
      slot: 3,
      rooms: []
    },
    mirkwoodfrost: {
      id: "mirkwoodfrost",
      code: "mirkwoodfrost",
      name: "冰霜幽暗密林",
      level: [6, 9],
      slot: 2,
      rooms: []
    },
    sunderlandpoison: {
      id: "sunderlandpoison",
      code: "sunderlandpoison",
      name: "猛毒雷鸣废墟",
      level: [8, 11],
      slot: 4,
      rooms: []
    },
    grakkarak: {
      id: "grakkarak",
      code: "grakkarak",
      name: "格拉卡",
      level: [11, 14],
      slot: 5,
      rooms: []
    },
    grakkarakburning: {
      id: "grakkarakburning",
      code: "grakkarakburning",
      name: "烈焰格拉卡",
      level: [6, 9],
      slot: 6,
      rooms: []
    },
    sunderlanddark: {
      id: "sunderlanddark",
      code: "sunderlanddark",
      name: "暗黑雷鸣废墟",
      level: [17, 20],
      slot: 7,
      rooms: []
    }
  };

  /* The stage a run starts on until the region map says otherwise. */
  var DEFAULT_STAGE = "mirkwood";

  /* Same generator as the state RNG, but local: a layout must not consume the
   * draws that place enemies, so the two stay independent. */
  function layoutRandom(seed) {
    var state = (seed >>> 0) || 1;
    return function next() {
      var t = (state = (state + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DEFAULT_SEED = 20260915;

  /*
   * 幽暗密林 的副本图。**形状是量出来的，不是画的**（`docs/adr/0030`）。
   *
   * 业主的录像（`assets/dnf_src/bilibili/BV1d24y1P74G.mp4`）里那张地图窗口是
   * **4 列 × 3 行、12 格全满**：6 格画成房间（圆角方块）、6 格画成走廊（线）。
   * 一格算房间还是走廊由客户端的图块自己决定（`assets/import_dnf_minimap.py` 量出来的
   * 那 21 个形状）；**相邻也不等于相通** —— 录像里 (1,1) 和 (2,1) 贴在一起，却各自
   * 只开三个方向（(1,1) 是 NSW、(2,1) 只有 N），所以连接要一条条写出来，不从格子推。
   *
   * `shape` 一行一行从上往下，一个字母一格：`R` 房间格、`C` 走廊格、`.` 没有这一格。
   * 这一关 12 格全满；`.` 是留给别的关卡的（模型支持，这里用不到）。
   *
   * `links` 是 11 条连接，每条两端各给一个 `[列, 行]`。每格的门（`exits`）从这里算，
   * 不另外写一遍 —— 写两遍就总有一天对不上。
   *
   * `northX` 是上门在房间里立在哪（占屏幕宽的几成）。录像里三处看得见的上门量到
   * 0.673 / 0.492 / 0.469；没进去过的那一格没有证据，用 0.5。南门在录像里被 HUD
   * 挡住、量不出位置，一律 0.5。
   */
  var MIRKWOOD_DUNGEON = {
    cols: 4,
    rows: 3,
    shape: ["RCCC", "RCRC", "RCRR"],
    /* 起点房与 Boss 房钉死；别的格子由种子洗牌（见 `dungeonFor`）。 */
    entry: [2, 1],
    boss: [0, 2],
    entryRoom: 0,
    bossRoom: 5,
    northX: { "1,1": 0.492, "1,2": 0.469, "2,1": 0.673, "3,1": 0.5 },
    links: [
      [[0, 0], [1, 0]],
      [[1, 0], [2, 0]],
      [[2, 0], [3, 0]],
      [[1, 0], [1, 1]],
      [[1, 1], [1, 2]],
      [[1, 1], [0, 1]],
      [[2, 0], [2, 1]],
      [[3, 0], [3, 1]],
      [[3, 1], [3, 2]],
      [[1, 2], [2, 2]],
      [[1, 2], [0, 2]]
    ]
  };

  /*
   * 挂到关卡身上：一个关卡有没有地牢，看的就是 `stage.dungeon`（`dungeonFor` 从那里读）。
   * 常量写在下面是因为它要和 `dungeonFor` 挨着读；这一行是它唯一的入口。
   */
  STAGES.mirkwood.dungeon = MIRKWOOD_DUNGEON;

  /* North, east, south, west - the same bits `assets/import_dnf_minimap.py` uses. */
  var MINIMAP_DIR = { N: 1, E: 2, S: 4, W: 8 };
  /* 一个方向的步长，和它的反面：从哪个门进来，这一格的哪个门就通回去。 */
  var MINIMAP_STEPS = {
    N: { dx: 0, dy: -1, bit: 1, back: "S" },
    E: { dx: 1, dy: 0, bit: 2, back: "W" },
    S: { dx: 0, dy: 1, bit: 4, back: "N" },
    W: { dx: -1, dy: 0, bit: 8, back: "E" }
  };
  var MINIMAP_DIRS = ["N", "E", "S", "W"];

  function cellKey(col, row) {
    return col + "," + row;
  }

  function indexOfCell(cells, col, row) {
    for (var index = 0; index < cells.length; index += 1) {
      if (cells[index].col === col && cells[index].row === row) return index;
    }
    return -1;
  }

  function currentCell(state) {
    if (!state.dungeon || state.cell === undefined) return null;
    return state.dungeon.cells[state.cell] || null;
  }

  function currentSpec(state) {
    var cell = currentCell(state);
    return cell ? state.stage.rooms[cell.room] : null;
  }

  /**
   * 一关的地牢：`{cols, rows, cells, entry, boss}`。
   *
   * 每格是 `{col, row, kind, exits, room, cleared}`：`exits` 是 N/E/S/W 的位，
   * `room` 是 `stage.rooms` 的下标，`cleared` 说过没有 —— 打过的房间再进去不刷怪，
   * 这是"能回头"的前提（`docs/adr/0030`）。
   *
   * 发牌：起点房与 Boss 房钉死，**同一类的格子之间**按种子洗完再发。所以换种子换的是
   * 哪间房摆在哪一格，不是地牢的形状 —— 形状照录像，一间都不许动。
   */
  function dungeonFor(stage, seed) {
    var dun = stage && stage.dungeon;
    if (!dun) return null;
    var cells = [];
    dun.shape.forEach(function (line, row) {
      line.split("").forEach(function (code, col) {
        if (code === ".") return;
        cells.push({
          col: col,
          row: row,
          kind: code === "R" ? "room" : "corr",
          exits: 0,
          room: -1,
          cleared: false
        });
      });
    });
    dun.links.forEach(function (pair) {
      var a = indexOfCell(cells, pair[0][0], pair[0][1]);
      var b = indexOfCell(cells, pair[1][0], pair[1][1]);
      if (a < 0 || b < 0) return;
      var dx = cells[b].col - cells[a].col;
      var dy = cells[b].row - cells[a].row;
      MINIMAP_DIRS.forEach(function (dir) {
        var step = MINIMAP_STEPS[dir];
        if (step.dx !== dx || step.dy !== dy) return;
        cells[a].exits |= step.bit;
        cells[b].exits |= MINIMAP_STEPS[step.back].bit;
      });
    });
    var next = layoutRandom(seed ^ 0x5bf03635);
    var deck = { room: [], corr: [] };
    stage.rooms.forEach(function (spec, index) {
      if (index === dun.entryRoom || index === dun.bossRoom) return;
      deck[spec.kind === "corr" ? "corr" : "room"].push(index);
    });
    Object.keys(deck).forEach(function (kind) {
      for (var cursor = deck[kind].length - 1; cursor > 0; cursor -= 1) {
        var swap = Math.min(cursor, Math.floor(next() * (cursor + 1)));
        var held = deck[kind][cursor];
        deck[kind][cursor] = deck[kind][swap];
        deck[kind][swap] = held;
      }
    });
    cells.forEach(function (cell) {
      if (cell.col === dun.entry[0] && cell.row === dun.entry[1]) {
        cell.room = dun.entryRoom;
      } else if (cell.col === dun.boss[0] && cell.row === dun.boss[1]) {
        cell.room = dun.bossRoom;
      } else {
        cell.room = deck[cell.kind].shift();
      }
    });
    return {
      cols: dun.cols,
      rows: dun.rows,
      cells: cells,
      entry: indexOfCell(cells, dun.entry[0], dun.entry[1]),
      boss: indexOfCell(cells, dun.boss[0], dun.boss[1]),
      northX: dun.northX || {}
    };
  }

  /** 这一格某一扇门通向哪一格（`cells` 的下标），没这扇门就是 -1。 */
  function doorNeighbour(dungeon, cell, dir) {
    var step = MINIMAP_STEPS[dir];
    if (!step || !(cell.exits & step.bit)) return -1;
    return indexOfCell(dungeon.cells, cell.col + step.dx, cell.row + step.dy);
  }

  /**
   * 这一格的一扇门现在是什么状态：`"none"` 没有这扇门，`"locked"` 锁着，
   * `"open"` 能走。**清过房就都开；没清，只有他进来的那扇能走回去** ——
   * 这是 DNF 的规矩，也是"清房"这件事的意义。
   */
  function exitMode(state, dir) {
    var cell = currentCell(state);
    var step = MINIMAP_STEPS[dir];
    if (!cell || !step || !(cell.exits & step.bit)) return "none";
    if (cell.cleared || dir === state.entryDoor) return "open";
    return "locked";
  }

  /*
   * 换房那一下。录像里切过去是**一帧近全黑，然后新房间在 0.3 秒里淡进来**
   * （量法：整屏亮度 121.333s 掉到 4.2 再一路爬回 58，`docs/adr/0030`）。
   * 所以这不是"淡出再淡入"：旧画面直接切掉，黑的立刻盖上来。
   */
  var TRANSITION = {
    dur: 0.3
  };

  /* 门口那几块地：侧门沿 x，上门/下门沿 z，一样都要求他站在门口那一块。 */
  var DOOR = {
    /* 侧门：贴上左右墙这么近就算进了门框。 */
    side: 60,
    /* 上门/下门：走进地板最里/最外这么深。 */
    depth: 46,
    /* 上门/下门在 x 上认多宽 —— 门框左右各这么宽。 */
    span: 110,
    /* 换房之后他站在离门多远的地方。 */
    stand: 74,
    share: 0.5
  };

  /**
   * 上门/下门在这一格立在哪（像素）。
   *
   * **它是这一间房的比例，不是屏幕的比例。** 量录像时那三个数（0.673 / 0.492 /
   * 0.469）当时没区分这两者；房间能滚之后必须选一个，选的是**房间**
   * （`docs/adr/0035`）—— 门是房间里的东西，屏幕只是看它的一扇窗。
   */
  function doorX(state, cell, dir) {
    var share = dir === "N" ? (state.dungeon.northX || {})[cellKey(cell.col, cell.row)] : undefined;
    if (share === undefined) share = DOOR.share;
    return share * roomWidth(state);
  }

  /**
   * **一扇上/下门的整条路留空。**
   *
   * `blocksDoorway` 管的是门框自己那一块（门口净空，`docs/adr/0032`）；这一条管的是
   * **从带子前缘一路走到那扇门的那一整列** —— 上/下门只有这一条路可走，路上横着一件
   * 实心件，谁过一次都得绕一次。侧门不在此列：左右门贴墙，进出的路本来就是横着的，
   * 绕一件东西是横着让一步，不是"整条路被堵"。
   *
   * 业主的规矩是「门口不能有石头和树木」（`docs/adr/0032`）；这一条是它朝"门的那条路"
   * 上的一步 —— 桶按录像摆到一间房五只之后，正是这一列上的那一只把演示 bot 钉住的
   * （`docs/adr/0048` 记了实测）。
   */
  function blocksDoorLane(state, cell, entry) {
    if (!cell) return false;
    for (var i = 0; i < MINIMAP_DIRS.length; i += 1) {
      var dir = MINIMAP_DIRS[i];
      if (dir !== "N" && dir !== "S") continue;
      if (!(cell.exits & MINIMAP_STEPS[dir].bit)) continue;
      if (Math.abs(entry.x - doorX(state, cell, dir)) < DOOR.span) return true;
    }
    return false;
  }

  function inDoorZone(state, dir) {
    var player = state.player;
    var cell = currentCell(state);
    if (!cell) return false;
    if (dir === "E") return player.x >= roomRight(state) - DOOR.side;
    if (dir === "W") return player.x <= roomLeft(state) + DOOR.side;
    if (Math.abs(player.x - doorX(state, cell, dir)) > DOOR.span) return false;
    var deep = bandDepth(state.band);
    if (dir === "N") return player.z >= deep - DOOR.depth;
    return player.z <= DOOR.depth;
  }

  /*
   * **门口净空**（`docs/adr/0032`，业主：「门口不能有石头和树木」）。
   *
   * 每扇门前面留一条不许摆东西的带：左右门是贴墙的一条，上下门是那一格自己的门 x
   * 左右各一条；两边再各让出**一个半身位**（`DOOR.stand` 那一档），免得进门落脚就顶在
   * 石头上。带里的**实心**布景（木桶、树、石头）摆位时就丢掉 —— 花草贴花不算，它们不挡人。
   *
   * 这一关在**摆位的时候按格**过，不在写房间的时候过：房间是按种子洗到格子上的，
   * 同一间房落在不同格子上会碰上不同的门（上门/下门的 x 是那一格自己的）。
   */
  var DOOR_CLEAR = {
    side: DOOR.side + DOOR.stand,
    span: DOOR.span + DOOR.stand,
    depth: DOOR.depth + DOOR.stand
  };

  /*
   * 门口要清的是**两块地方**（`docs/adr/0032`）：进门落脚、出门站的那块**判定区**，和
   * **门拱自己的美术盒子**。只看 z 是不够的 —— 一棵 105x199 的树桩可以"站在判定区前面"
   * 却把整个门拱画糊（业主截图里的胆小鬼的窝就是这样）。
   *
   * 两样都用屏幕上的矩形比：地图是 x-y 的，判定区在 z 上怎么摆，最后都要落到同一个屏幕上。
   */
  var GATE_ART = { N: [157, 198], S: [192, 118], side: [131, 240] };

  /** 一扇门**拱**自己的美术盒子（画在哪、多大）—— 门口净空里那条"别把门画糊"的判据。 */
  function gateArtRect(state, cell, dir) {
    var depth = bandDepth(state.band);
    var floorOf = function (z) { return ARENA.groundY - depthLift(z); };
    if (dir === "N" || dir === "S") {
      var art = GATE_ART[dir];
      var x = doorX(state, cell, dir);
      var bottom = dir === "N" ? floorOf(depth) + 6 : ARENA.height;
      return { left: x - art[0] / 2, right: x + art[0] / 2, top: bottom - art[1], bottom: bottom };
    }
    var side = GATE_ART.side;
    var cx = dir === "E" ? roomWidth(state) - 34 : 34;
    var base = ARENA.groundY + 4;
    return { left: cx - side[0] / 2, right: cx + side[0] / 2, top: base - side[1], bottom: base };
  }

  /** 这一格某扇门"进出要用的那块地"（x-z 平面上的矩形）。 */
  function doorFloor(state, cell, dir) {
    var deep = bandDepth(state.band);
    if (dir === "E") {
      return { x: [roomRight(state) - DOOR_CLEAR.side, roomWidth(state)], z: [0, deep] };
    }
    if (dir === "W") {
      return { x: [0, roomLeft(state) + DOOR_CLEAR.side], z: [0, deep] };
    }
    var at = doorX(state, cell, dir);
    return {
      x: [at - DOOR_CLEAR.span, at + DOOR_CLEAR.span],
      z: dir === "N" ? [deep - DOOR_CLEAR.depth, deep] : [0, DOOR_CLEAR.depth]
    };
  }

  /**
   * 这件布景压没压到这一格任何一扇门。两种压法都算（`docs/adr/0032`）：
   *
   * 1. **地面**：它的盒子（x-z）压在"进出要用的那块地"上 —— 挡路；
   * 2. **美术**：它的美术矩形（屏幕）压到门拱自己的美术盒子上 —— 把门画糊。一棵
   *    105x199 的树桩可以站在判定区**前面**（第 1 条查不出来）却把整个门拱盖掉。
   *
   * 两条各用各的空间：第 1 条是地板对地板，第 2 条是画面对画面 —— 拿美术盒子去比地板
   * 那条，会把"站在门口前面的一棵高树"全判成违章（断桩隘口那间房会被掏空）。
   */
  function blocksDoorway(state, cell, entry, depth) {
    if (!cell) return false;
    var box = propBox(entry.piece);
    if (!box) return false;
    var z = entry.depth === undefined ? 0 : entry.depth * depth;
    var inkW = box.ink ? box.ink[0] : box.width;
    var inkH = box.ink ? box.ink[1] : box.width;
    var foot = ARENA.groundY - depthLift(z);
    var art = { left: entry.x - inkW / 2, right: entry.x + inkW / 2, top: foot - inkH, bottom: foot };
    var floorRect = {
      left: entry.x - box.width / 2,
      right: entry.x + box.width / 2,
      near: z - box.depth / 2,
      far: z + box.depth / 2
    };
    for (var index = 0; index < MINIMAP_DIRS.length; index += 1) {
      var dir = MINIMAP_DIRS[index];
      if (!(cell.exits & MINIMAP_STEPS[dir].bit)) continue;
      var floor = doorFloor(state, cell, dir);
      if (floorRect.left < floor.x[1] && floorRect.right > floor.x[0] &&
          floorRect.near < floor.z[1] && floorRect.far > floor.z[0]) return true;
      var gate = gateArtRect(state, cell, dir);
      if (art.left < gate.right && art.right > gate.left &&
          art.top < gate.bottom && art.bottom > gate.top) return true;
    }
    return false;
  }

  /*
   * **走位**：朝一个点走、绕开实心布景的下一步。返回 `[dx, dz]`，各是 -1 / 0 / 1。
   *
   * **从哪儿出发由 `fromX`/`fromZ` 说**（不给就是玩家）：玩家自己会绕，所以它原来是给
   * **自动演示和测试里的那些 bot** 用的 —— "一直往目标按方向键"会在树干上原地推，
   * 演示就永远走不到 Boss。**怪后来也要用它**（`docs/adr/0047`）：录像里那间房摆着
   * 五只木桶、哥布林照样一路走到他面前，而本作原来是"没有人绕路"（`blockProps` 那一节
   * 写着这条规矩），于是怪会被一件布景**永久钉住**。
   *
   * 一格 24 单位、整间房 38x22 格，一步 BFS 便宜到可以每帧算一次；布景按半格放大再判定，
   * 否则会有"格心在盒外、两格之间那段却在盒里"的缝。
   */
  function routeStep(state, targetX, targetZ, fromX, fromZ) {
    var step = 24;
    var left = roomLeft(state);
    var half = (state.player && state.player.width ? state.player.width : 34) / 2;
    var depth = bandDepth(state.band);
    var cols = Math.max(1, Math.floor((roomRight(state) - left) / step));
    var rows = Math.max(1, Math.floor(depth / step));
    var margin = step / 2;
    var solids = (state.props || []).filter(function (prop) {
      return prop.solid && !prop.broken && propBox(prop.piece);
    });
    var blocked = function (x, z) {
      return solids.some(function (prop) {
        var box = propBox(prop.piece);
        var centre = prop.x + (box.dx || 0);
        return (
          Math.abs(x - centre) < half + box.width / 2 + margin &&
          Math.abs(z - prop.z) < half + box.depth / 2 + margin
        );
      });
    };
    var cellX = function (x) {
      return Math.min(cols - 1, Math.max(0, Math.floor((x - left) / step)));
    };
    var cellZ = function (z) {
      return Math.min(rows - 1, Math.max(0, Math.floor(z / step)));
    };
    var seatX = function (i) { return left + (i + 0.5) * step; };
    var seatZ = function (j) { return (j + 0.5) * step; };

    var from = [
      cellX(fromX === undefined ? state.player.x : fromX),
      cellZ(fromZ === undefined ? state.player.z : fromZ)
    ];
    var goal = [cellX(targetX), cellZ(targetZ)];
    if (blocked(seatX(goal[0]), seatZ(goal[1]))) {
      /* 目标那一格被布景占着（门口那一带是清的，几乎用不到）：退到最近的一格空地。 */
      var best = null;
      for (var i = 0; i < cols; i += 1) {
        for (var j = 0; j < rows; j += 1) {
          if (blocked(seatX(i), seatZ(j))) continue;
          var far = Math.abs(i - goal[0]) + Math.abs(j - goal[1]);
          if (!best || far < best.far) best = { at: [i, j], far: far };
        }
      }
      if (!best) return [0, 0];
      goal = best.at;
    }
    if (from[0] === goal[0] && from[1] === goal[1]) return [0, 0];

    var key = function (a, b) { return a + "," + b; };
    var came = {};
    came[key(from[0], from[1])] = null;
    var queue = [from];
    var moves = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var found = false;
    while (queue.length && !found) {
      var at = queue.shift();
      for (var m = 0; m < moves.length && !found; m += 1) {
        var ni = at[0] + moves[m][0];
        var nj = at[1] + moves[m][1];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        if (came[key(ni, nj)] !== undefined) continue;
        if (blocked(seatX(ni), seatZ(nj))) continue;
        came[key(ni, nj)] = { at: at, step: moves[m] };
        if (ni === goal[0] && nj === goal[1]) found = true;
        queue.push([ni, nj]);
      }
    }
    if (!found) return [0, 0];
    var first = null;
    for (var walk = goal; walk[0] !== from[0] || walk[1] !== from[1]; ) {
      var hop = came[key(walk[0], walk[1])];
      first = hop.step;
      walk = hop.at;
    }
    return first || [0, 0];
  }

  /** 他正站在哪扇开着的门口，没有就 null。顺序按 N/E/S/W，先来的先算。 */
  function doorAt(state) {
    for (var index = 0; index < MINIMAP_DIRS.length; index += 1) {
      var dir = MINIMAP_DIRS[index];
      if (exitMode(state, dir) !== "open") continue;
      if (inDoorZone(state, dir)) return dir;
    }
    return null;
  }

  /*
   * Between-room rewards. Clearing a room offers three of these, so two runs on
   * different seeds stop looking alike. Every option is a plain stat change on
   * the player, which keeps the core deterministic and easy to reason about.
   */
  var UPGRADES = {
    attack: {
      id: "attack",
      name: "锐锋",
      detail: "普攻与技能伤害 +3",
      apply: function (player) {
        player.attackBonus += 3;
      }
    },
    maxHp: {
      id: "maxHp",
      name: "体魄",
      detail: "生命上限 +20 并立即回复 20",
      apply: function (player) {
        player.maxHp += 20;
        player.hp = Math.min(player.maxHp, player.hp + 20);
      }
    },
    mpRegen: {
      id: "mpRegen",
      name: "灵息",
      detail: "每秒回蓝 +3",
      apply: function (player) {
        player.mpRegen += 3;
      }
    },
    skillPower: {
      id: "skillPower",
      name: "鬼气",
      detail: "技能伤害 +15%",
      apply: function (player) {
        player.skillPower += 0.15;
      }
    },
    attackSpeed: {
      id: "attackSpeed",
      name: "迅捷",
      detail: "攻速 +15%",
      apply: function (player) {
        player.attackSpeed = Math.min(MAX_ATTACK_SPEED, attackSpeedOf(player) * 1.15);
      }
    }
  };

  var UPGRADE_ORDER = ["attack", "attackSpeed", "maxHp", "mpRegen", "skillPower"];
  var UPGRADES_PER_ROOM = 3;

  /*
   * 可破坏的布景：木桶。
   *
   * 客户端那只桶自己有 13 帧（`sprite_map_breakableobject.NPK :: barrel.img`）：第 0 帧
   * 是完整的桶，第 1-12 帧是飞散的木片和铁箍。所以"打碎"不是另画一套，是把那 12 帧放出来。
   *
   * **只有他打得碎，怪打不碎**：怪的攻击和怪的身体都撞得到它（业主的原话是「人和怪都撞得到
   * 它…只有人能打碎，怪物打不碎」），所以它挡两份、碎只认他那一下。
   *
   * 盒子照美术来：一个桶立在地上占这么宽、这么深。判定只看 x 和 z。
   */
  var BREAKABLE = {
    /* 盒子照美术来：那个桶画出来是 63x78（`SCENE.pieces.barrel`），桶身比影子窄一点。 */
    barrel: { width: 52, depth: 34, height: 78, hp: 1, ink: [63, 78] }
  };

  /*
   * **立着的布景：树、石头、树桩、石柱 —— 实心，挡人**（`docs/adr/0032`，业主：
   * 「树木和石头也要有碰撞」）。它们跟木桶不一样的地方只有两条：**打不碎**（挥击只认
   * `BREAKABLE`），**不挡飞行物**（和木桶一致：怪不会绕路也不会换排，挡了投石就等于
   * 把它们废掉）。
   *
   * `width` / `dx` 是**量出来的**：把每件美术最底下 12 行（贴地那一段）的 ink 取出来，
   * 量它占多宽、中心偏在美术中心哪一边（`assets/import_dnf_scene.py` 烘的图，
   * 树根会往外张，所以树干那一段比上面细）。树冠、石头的上半截**不进盒子** ——
   * 一个"看得见的树冠"和"走不过去的空墙"对不上，读起来是 bug。
   *
   * `depth` 没有像素可量（美术是正面的），按同一个规矩给：宽的三分之一，钳在 24–40，
   * 和木桶(52/34)是同一档手感。
   */
  var SOLID = {
    trunkTall:  { width: 146, dx: 4,   ink: [203, 422] },
    trunkBent:  { width: 111, dx: 6,   ink: [143, 423] },
    trunkMossy: { width: 100, dx: -18, ink: [160, 428] },
    treeLeafy:  { width: 84,  dx: -4,  ink: [153, 203] },
    stump:      { width: 74,  dx: -4,  ink: [105, 199] },
    pillar:     { width: 43,  dx: 0,   ink: [44, 111] },
    wallStone:  { width: 163, dx: -1,  ink: [167, 125] },
    rockFlat:   { width: 92,  dx: -20, ink: [141, 89] },
    rockSmall:  { width: 42,  dx: 0,   ink: [42, 44] },
    /*
     * 02 套剩下那批里**立着的**（业主 2026-10-13 把客户端拷上来之后补的）。
     * `width`/`dx` 是照同一条规矩量的：**每件美术最底下 12 行的墨**，
     * 树冠、石头的上半截不进盒子（`docs/adr/0032`）—— 量法：
     * 取 `assets/forest.png` 里这块矩形的最下 12 行，量 ink 的左右缘。
     * `depth` 仍然由宽度推（下面那一段）。
     *
     * **贴地平铺的那几件不在这里**（`grassPatch` / `leaves` / `leavesBroad` /
     * `leavesDense` / `pebble`）：它们走 `SCENE.decals`，谁都不撞。
     */
    firSmall:   { width: 42,  dx: 0,   ink: [42, 59] },
    firMid:     { width: 43,  dx: 0,   ink: [43, 71] },
    firTall:    { width: 44,  dx: 0,   ink: [44, 78] },
    snagTall:   { width: 96,  dx: 20,  ink: [139, 207] },
    fallenTrunk: { width: 223, dx: -2, ink: [226, 340] },
    stumpBroken: { width: 40, dx: -19, ink: [78, 112] },
    trunkHollow: { width: 84, dx: 2,   ink: [133, 178] },
    snagShort:  { width: 95,  dx: 0,   ink: [97, 104] },
    snagStub:   { width: 84,  dx: 2,   ink: [87, 101] },
    ruinStone:  { width: 139, dx: 2,   ink: [142, 103] },
    rockArch:   { width: 105, dx: -22, ink: [195, 180] },
    logMossy:   { width: 96,  dx: 24,  ink: [317, 175] },
    treeDead:   { width: 74,  dx: -4,  ink: [105, 277] },
    treeDeadTall: { width: 84, dx: 0,  ink: [175, 303] }
  };
  Object.keys(SOLID).forEach(function (piece) {
    SOLID[piece].depth = clamp(Math.round(SOLID[piece].width / 3), 24, 40);
  });

  /* 一个桶碎开之后，那一地木片还画多久（秒）。 */
  var BREAK_ANIM = 0.42;

  /*
   * 怪物怎么死。时间线是量出来的（`docs/adr/0030`）：录像里四次独立击杀对得一样齐 ——
   * **致命一击 → 身体倒地躺约 0.2 秒 → 原地炸开 → 身体不再回来**。
   *
   * 炸开是两样东西：一团**青白色圆爆**（客户端 `monsterdieflash`，亮 3 帧 = 0.10 秒）
   * 和 9-14 块**悬在空中不落**的红肉块（半秒内散掉）。**地上不留血泊、不留尸体** ——
   * 那是"击倒"，0.2 秒后会站起来，和死是两回事。
   */
  /*
   * 怪死：**倒地的尸体 → 变成它自己的白色剪影 → 炸成按它颜色的碎块四散**
   * （`docs/adr/0034`）。
   *
   * 业主的口径（2026-10-11，实玩之后）：「怪物确实会躺着死，然后出现白色怪物轮廓，
   * 然后碎裂成血块（和怪物颜色一样）散向四处」。拿他的幽暗密林录像逐帧对过：
   * **那团白不是烟，是怪自己的剪影** —— 96.65s 两只哥布林一起死，白色的包围盒
   * 276 × 114 px，正好是两只站着的身量（画上每只 98 × 108），96.667 满、96.933 缩、
   * 96.967 没了（**0.30 秒**）；随后炸开的碎块按怪自己的皮肤色染（T+4:50 那一只
   * 量到十几块金黄的，飞出去 0.4 秒内四散、渐隐）。
   *
   * 上一片把它读成"一片贴地的云、什么都不留" —— 错在只量白色：绿怪的碎块落在
   * 深绿草地上，按白色去扫一个也扫不到。
   */
  var DEATH = {
    /* 先倒地躺着（业主：「怪物确实会躺着死」）。 */
    lie: 0.2,
    /* 尸体变成它自己的**白色剪影**亮多久：录像里 0.30 秒（96.667–96.967）。 */
    shape: 0.3,
    /*
     * 碎块从炸出来到淡尽：**快、短**。录像里那些块只活 0.1–0.2 秒（T+4:50 那只
     * 290.167 出现、290.233 就没了），我们原来拖到 1.6 秒，看着像落叶飘下来。
     */
    chunks: 0.45,
    /* 一次炸开冒几块（T+4:50 量到十几块，取 14）。 */
    chunkCount: 14,
    /* Boss 只有那一片白、更大更久（录像里约 0.9 秒），砸不出碎块。 */
    bossSmoke: 0.9
  };

  /** 这一只死了那一片白亮多久（Boss 更大更久）。 */
  function smokeLife(enemy) {
    return enemy && enemy.type === "boss" ? DEATH.bossSmoke : DEATH.shape;
  }

  /** A prop is scenery unless its piece is one of these. */
  function breakableSpec(piece) {
    return BREAKABLE[piece] || null;
  }

  /** 一件布景的碰撞盒：**只挡人的**（树、石头）和**挡人又打碎得开的**（木桶）都在这一张表上。 */
  /*
   * **布景也有"画多大"这个数。**
   *
   * 怪一直有（`enemy.height`，渲染那边按它缩那张 sheet —— 所以怪表里那个高度既是美术
   * 也是判定）；**布景没有**：它按烘出来那张图的像素数画。而录像里**每一件是各自一个
   * 倍率**（客户端拿动画数据缩放每一件，那份数据在加密的 `Script.pvf` 里）——
   * 量出来的：木桶 1.83 视频px/画px、哥布林 2.0-2.6、石拱门 2.52、牛头巨兽 3.38。
   * 本作一律用 3.155（= 265 ÷ 84，身位换算那一条），于是**偏大的都是那些倍率比 3.155
   * 低的**：木桶偏大 1.35 倍、侧门 1.25 倍（`docs/adr/0050`）。
   *
   * 下面这两个数是**量的**（录像像素 ÷ 本作画出来的像素，几个样本一致）。
   * **没量到的一律 1** —— 猜一个比留着不动更糟：那会把一件本来对的也缩坏。
   */
  var PROP_SCALE = {
    /* 木桶：录像 132-160 视频px 宽、182 高（两个深度的样本），本作 63x78。 */
    barrel: 0.74,
    /*
     * 门的倍率只在**侧门**上量到（录像 330 视频px 宽，本作 131 画布px → 0.80）；
     * 上/下门与门板跟它同一族美术，按同一个数走，但**没单独量过**。
     */
    gate: 0.80, gateUp: 0.80, gateDown: 0.80,
    door: 0.80, doorUp: 0.80, doorDown: 0.80,
    /*
     * **石柱要两个数。** 录像里那根站着的是 **80x280 视频px = 0.30x1.06 身位**
     * （t=150 那一帧，三根并排，取最左边那根 —— 顶上和脚下都看得见），本作烘出来是
     * **44x111**。所以客户端把这一件**竖着拉长**了：横向 1.82 倍、纵向 2.52 倍。
     *
     * 所以这一张表允许**两个数**（`[横向, 纵向]`），一个数的意思就是两个轴同一个 ——
     * 木桶与门量下来两轴基本一致，石柱不一致。别把"一个数"当成规矩。
     */
    pillar: [0.58, 0.80],
    /*
     * **三棵直树干**（直 / 弯 / 长苔）。录像里那棵的**上段**是 **190 视频px = 0.72 身位**宽
     * （t=200 那一帧，树干两侧都看得清），而本作三棵的上段是 **1.40 / 0.82 / 0.93 身位** ——
     * 平均下来偏大 **1.45 倍**，最粗那棵偏大 **1.95 倍**。
     *
     * **倍率取三棵的平均 0.70**，不是逐棵的：录像里只看得见**一棵**，认不出它是这三棵里的
     * 哪一棵（三棵都是直的、都长苔）。逐棵要量得先认出它是谁。
     *
     * **只有横向**：树是**跑出画面顶**的（录像和本作都跑出去了），**高度量不到** ——
     * 所以纵向留 1，等于把树画细。客户端自己就是两轴分开缩的（石柱那一件量过），
     * 所以"只缩一个轴"不是歪门邪道。
     */
    trunkTall: [0.70, 1], trunkBent: [0.70, 1], trunkMossy: [0.70, 1],
    /*
     * **阔叶树**（t=88 那一帧，树冠左右、树顶、根脚四处都看得见）：
     * 录像 **260x440 视频px = 0.98x1.66 身位**，本作烘的是 **153x203** ——
     * 横向偏大 1.86 倍、纵向 1.46 倍。**又是"偏胖"**（本作 0.75 的宽高比对录像的 0.59）。
     */
    treeLeafy: [0.54, 0.69],
    /*
     * **高草换了那一件之后重新量的**（`docs/adr/0050` 追记三）：新那一件是 39x87，
     * 录像里那一撮是 **95x170 视频px**，所以两轴都要缩：横向 0.77、纵向 0.62。
     */
    grass: [0.77, 0.62]
  };

  /** 一件布景的倍率，拆成 `[横向, 纵向]`。 */
  function propScale(piece) {
    var entry = PROP_SCALE[piece];
    if (entry === undefined) return [1, 1];
    return typeof entry === "number" ? [entry, entry] : entry;
  }

  function propBox(piece) {
    var box = BREAKABLE[piece] || SOLID[piece] || null;
    if (!box) return box;
    /*
     * **盒子跟着美术一起缩。** 这是仓库里定过的规矩（`docs/adr/0032` / 0014）：
     * 美术和判定必须是同一个数，不然会出现"看着能走、结果被挡住"。
     */
    var scale = propScale(piece);
    if (scale[0] === 1 && scale[1] === 1) return box;
    return {
      width: box.width * scale[0],
      depth: box.depth * scale[0],
      height: (box.height || 0) * scale[1],
      hp: box.hp,
      dx: (box.dx || 0) * scale[0],
      ink: box.ink
    };
  }

  function nextRandom(state) {
    var t = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function createPlayer(x) {
    return {
      kind: "player",
      x: x,
      y: ARENA.groundY,
      /* Depth: 0 is the front edge of the floor, which is the ground line. */
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      width: PLAYER.width,
      height: PLAYER.height,
      facing: 1,
      onGround: true,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      mp: PLAYER.maxMp,
      maxMp: PLAYER.maxMp,
      level: 1,
      xp: 0,
      xpToNext: PROGRESSION.baseXpToNext,
      attackBonus: 0,
      mpRegen: PLAYER.mpRegenPerSecond,
      skillPower: 1,
      attackSpeed: PLAYER.attackSpeed,
      upgradesTaken: [],
      attackTimer: 0,
      attackDuration: PLAYER.attackDuration,
      attackCycle: PLAYER.attackDuration + PLAYER.attackCooldown,
      attackCooldown: 0,
      attackHitDone: false,
      comboIndex: 0,
      comboTimer: 0,
      skillId: null,
      skillTimer: 0,
      skillHitDone: false,
      skillHitsDone: 0,
      /*
       * 嗜魂封魔斩's own clock. `channelReleasedAt` is null for as long as he is
       * still holding, and the elapsed second he let go once he is; the vortex's
       * ticks are counted off `channelTickAt` (docs/adr/0023).
       */
      channelReleasedAt: null,
      channelTickAt: 0,
      airHitTimer: 0,
      /*
       * Self-buffs: 血之狂暴 (stance, no timer), 暴走 (timed) and 魔狱血刹's
       * 持剑期 (fifty seconds, and the one state that has to survive a room
       * change - see `startRoom`).
       */
      buffs: {},
      /*
       * How far 魔狱血刹's 血气之剑 has been forged, 1..8. It is next to the buff
       * rather than inside it because `player.buffs` carries seconds and nothing
       * else; **armed means `hellbenterTier > 0`**, and the sword is on his back
       * while `buffs.hellbenter > 0`. The two disagree in the one frame that
       * matters: the clock has run out but the sword has not come down yet, which
       * is what tells the gate to bring it down on its own.
       */
      hellbenterTier: 0,
      /*
       * Hits landed towards the *next* tier, 0..hitsPerTier-1. The tier is what
       * the sword is drawn from; this is only the part of the payment that has
       * not bought anything yet, and it is why the sword steps every tenth hit
       * instead of every hit (see growSword).
       */
      hellbenterCharge: 0,
      /* How long until 血之狂暴 charges him again for keeping it up. */
      stanceDrainTimer: 0,
      /*
       * The cast icon a buff flashes over his head, and its own clock. 暴走 is
       * the only buff that shows one - 血之狂暴's own read is the red body and
       * the lit hotbar slot, both of which are up the whole time it is.
       */
      buffIconTimer: 0,
      buffIconId: null,
      skillCooldowns: CASTABLE_SKILLS.reduce(function (map, skillId) {
        map[skillId] = 0;
        return map;
      }, {}),
      invuln: 0,
      /* Invulnerability that does not blink (see drawPlayer): set by a leap. */
      solidInvuln: 0,
      hurtTimer: 0,
      dead: false
    };
  }

  function createEnemy(state, type, x, z) {
    var spec = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    var jitter = (nextRandom(state) * 2 - 1) * 14;
    return {
      kind: "enemy",
      id: state.nextEnemyId++,
      type: type,
      x: clamp(x + jitter, roomLeft(state) + spec.width, roomRight(state) - spec.width),
      y: ARENA.groundY,
      /*
       * A room may place a monster at a depth; without one it stands on the
       * ground line, where every monster stood before there was a floor plane.
       * The jitter above is drawn whether or not `z` is passed, so adding
       * depths to a room cannot shift the deterministic stream.
       */
      z: z || 0,
      vx: 0,
      vy: 0,
      vz: 0,
      width: spec.width,
      height: spec.height,
      facing: -1,
      onGround: true,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      damage: spec.damage,
      xp: spec.xp,
      behavior: spec.behavior || "melee",
      /* 冠军怪那一圈光环（`champdark` / `champfire`）；普通怪是 null。 */
      champion: spec.champion || null,
      /* 回避: copied per-enemy, like everything else off the type spec (0018). */
      evasion: spec.evasion || 0,
      speed: spec.speed,
      attackRange: spec.attackRange,
      keepRange: spec.keepRange || 0,
      attackWindup: spec.attackWindup,
      attackDuration: spec.attackDuration,
      baseAttackWindup: spec.attackWindup,
      baseAttackDuration: spec.attackDuration,
      attackCooldownMax: spec.attackCooldown,
      baseSpeed: spec.speed,
      baseDamage: spec.damage,
      baseAttackCooldownMax: spec.attackCooldown,
      attackCooldown: 0.5,
      attackTimer: 0,
      attackKind: "melee",
      attackHitDone: false,
      attackRecovered: false,
      projectile: spec.projectile || null,
      chargeSpeed: spec.chargeSpeed || 0,
      chargeFrom: spec.chargeFrom || 0,
      chargeTo: spec.chargeTo || 0,
      chargeDir: -1,
      /* Per-enemy copies: a phase change must never mutate the shared type spec. */
      slam: spec.slam ? Object.assign({}, spec.slam) : null,
      baseSlam: spec.slam ? Object.assign({}, spec.slam) : null,
      slamCooldown: spec.slam ? spec.slam.cooldown * 0.5 : 0,
      spinDash: spec.spinDash || null,
      spinDir: -1,
      spinCooldown: spec.spinDash ? spec.spinDash.cooldown * 0.4 : 0,
      lungeCooldown: 0,
      phase: 1,
      phase2: spec.phase2 || null,
      knockdown: 0,
      stun: 0,
      grabbed: 0,
      bleed: null,
      superArmor: false,
      knockbackX: spec.knockbackX,
      hurtTimer: 0,
      dead: false
    };
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function normalizeInput(input) {
    input = input || {};
    var skills = input.skills || {};
    /*
     * Built off SKILL_ORDER rather than listed by hand. A skill missing from
     * this map is **silently uncastable** - the press never reaches the bar's
     * own gate, so the move simply does nothing and there is no error - which is
     * exactly what happened to 暴走 the first time it was added. 银光落刃 is not
     * in SKILL_ORDER (it is the air half of the up-slash key), so it is not in
     * here either; that key is read directly where the air case is decided.
     *
     * 魔狱血刹 is the second skill outside SKILL_ORDER and it *is* in here, so the
     * list is spelled out rather than read off the bar: both of its halves come
     * in on the one key, and which half the key means is decided in the gate (see
     * `wantsHellbenter` there).
     */
    var pressed = {};
    SKILL_ORDER.forEach(function (skillId) {
      pressed[skillId] = !!skills[skillId];
    });
    pressed.hellbenter = !!skills.hellbenter;
    return {
      left: !!input.left,
      right: !!input.right,
      /* Walking into and out of the screen: the second ground axis. */
      up: !!input.up,
      down: !!input.down,
      jump: !!input.jump,
      attack: !!input.attack,
      skills: pressed
    };
  }

  /*
   * **地上的掉落**（`docs/adr/0042`）。录像里怪一死，地上就摆出一块**写着物品名的
   * 名牌**（深底圆角 + 浅青字），走过去**自动收**；收的那一刻三样一起发生：牌子没了、
   * 原地浮一行绿色的 `+40 Exp`、左边日志加一行 `获得[X]1个`（外加点数与金币两行）。
   *
   * **经验是捡起来才给的**（业主 2026-10-14 定，Q12 选 a）—— 怪倒下的那一刻只把
   * 牌子放出来。掉落点就是它倒下的地方，够得着。
   *
   * 名字全部来自录像那份日志里念过的那些；白名与青名是照录像分的两档颜色
   * （`获得[哥布林毛皮]1个` 是白、`获得[最下级硬化剂]1个` 是青）。
   */
  var LOOT = {
    /*
     * 走过去就收的半径，按**身体间距**量（`CONTEXT.md`「身体间距」）—— 和"够不够
     * 得着"同一把尺子。录像里精确半径量不出来（地上叠了好几件分不清哪件是哪件），
     * 这是本作自己的数。
     */
    reach: 34,
    /* 名牌在地上就一直摆着，换房才清 —— **录像里没量到存活上限**（`docs/adr/0042`）。 */
    life: 1e9,
    white: ["破旧的皮革", "碎片", "哥布林毛皮", "生锈的铁片", "煤尘", "哥布林手骨"],
    cyan: ["最下级硬化剂", "炉岩炭", "冰冻水", "诺顿的新手HP药剂", "古老的法杖"]
  };

  /*
   * 战斗评分那四个读数（`docs/adr/0041`）。**名字照录像，公式是本作自己的**：
   * 录像里只读得出一个动静 —— 被击数从 4 变 5 的那一帧评分从 `SS` 掉成 `S`，
   * 之后一直到 15 次都没再掉档。所以这里也让**被击数**占主导，用时与等级是配重。
   * 这几个常数一个都没在录像里量到，实玩之后调的就是这一块。
   */
  var RATING = {
    hitCost: 4,
    hitCostCap: 50,
    parSeconds: 300,
    timeCost: 30,
    levelBonus: 2,
    levelBonusCap: 10,
    comboBaseline: 6,
    bands: [["S", 90], ["A", 75], ["B", 60], ["C", 0]]
  };

  /*
   * **进副本那一串**（`docs/adr/0044`）。全部量自录像的 53.87-61.3 s：
   *
   *   三帧全黑 → 插画淡入 0.3 秒 → 保持 1.5 秒 → 淡出 0.24 秒 → 全黑 0.3 秒
   *   → 房间淡入（很慢，约 2 秒才满亮）
   *
   * 两行关卡名（`幽暗密林` / `Gran-Floris 格兰之森`）跟房间一起淡入，
   * **到 t=61.10 用 0.17 秒快速淡出**（不是被顶掉）。它画在**世界层**里 ——
   * 录像里人挡在字前面、地图的近景石柱也压在字上。
   *
   * 录像里插画外面还有一圈 48 px 的金棕雕花木框，**这个客户端里没有**：过场图是
   * 一张光板的 800x600（全客户端 639 张大图里没有框这种东西，`assets/import_dnf_ui.py`）。
   * 所以照它**画的那张画**烘，框不自己画。
   */
  var INTRO = {
    artIn: 0.3,
    artHold: 1.5,
    artOut: 0.24,
    black: 0.3,
    /* 关卡名从房间亮起来算起挂多久、以及淡出用多久。 */
    title: 4.2,
    titleOut: 0.17
  };

  function introLength() {
    return INTRO.artIn + INTRO.artHold + INTRO.artOut + INTRO.black;
  }

  /** 进副本：把插画那一段挂上去。**只有真开局才要**，标题演示不从这里过。 */
  function beginIntro(state) {
    state.intro = { t: 0 };
    state.titleT = 0;
    return state;
  }

  /* 左边的日志栏能有几行 —— 录像里是 8 个固定槽位。 */
  var LOG_LINES = 8;

  function pushLog(state, text, tone) {
    state.log.push({ text: text, tone: tone || "white" });
    while (state.log.length > LOG_LINES) state.log.shift();
  }

  /*
   * 一件掉落由 (种子, 怪的编号) 决定，**不走 `nextRandom`**：那一条是敌人抖动与
   * 血球共用的，动它整段演示都会变（`docs/adr/0037` 在这一条上踩过一次）。
   */
  function hash32(a, b) {
    var h = ((a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function lootFor(state, enemy) {
    var h = hash32(state.seed, enemy.id || 0);
    var rare = (h & 1) === 0;
    var pool = rare ? LOOT.cyan : LOOT.white;
    return {
      name: pool[(h >>> 4) % pool.length],
      tone: rare ? "cyan" : "white",
      gold: 30 + ((h >>> 12) % 45)
    };
  }

  /** 战斗评分那一行读数：操作 / 技巧 / 被击数 / 评分（`docs/adr/0041`）。 */
  function ratingOf(state) {
    var stats = state.stats || {};
    var player = state.player || {};
    var swings = stats.swings || 0;
    var operation = swings > 0
      ? Math.round(((stats.swingsLanded || 0) / swings) * 100)
      : 100;
    var chains = stats.comboChains || 0;
    var technique = chains > 0
      ? Math.round(Math.min(1, (stats.comboHits || 0) / chains / RATING.comboBaseline) * 100)
      : 0;
    var hits = stats.hitsTaken || 0;
    var over = Math.max(0, (state.time - RATING.parSeconds) / RATING.parSeconds) * RATING.timeCost;
    var score = 100
      - Math.min(RATING.hitCostCap, hits * RATING.hitCost)
      - over
      + Math.min(RATING.levelBonusCap, Math.max(0, (player.level || 1) - 1) * RATING.levelBonus);
    score = Math.max(0, Math.min(100, Math.round(score)));
    var grade = "C";
    for (var i = 0; i < RATING.bands.length; i += 1) {
      if (score >= RATING.bands[i][1]) { grade = RATING.bands[i][0]; break; }
    }
    return { operation: operation, technique: technique, hits: hits, score: score, grade: grade };
  }

  function createState(options) {
    options = options || {};
    var state = {
      seed: typeof options.seed === "number" ? options.seed : DEFAULT_SEED,
      /*
       * Which stage this run is. It owns the room pool, the gauntlet index and
       * the boss index, so a run is one stage and nothing climbs between them
       * (`docs/adr/0026`). Resolved here once, and every reader goes through it.
       */
      stage: STAGES[options.stage] || STAGES[DEFAULT_STAGE],
      rngState: 0,
      time: 0,
      /* 地牢与他在哪一格（`docs/adr/0030`）；一格就是过去的"一间房"。 */
      dungeon: null,
      cell: 0,
      /* 他这一格是从哪个门进来的 —— 那扇门永远能走回去。开局没有。 */
      entryDoor: null,
      room: null,
      /*
       * 镜头：世界往哪一边挪（`docs/adr/0035`）。它在**世界**那一侧，屏幕上的
       * HUD 不跟着动。跟着谁走、有没有死区、到不到边夹取，都还在量录像，见
       * `updateCamera`。
       */
      camera: { x: 0, y: 0 },
      /* 他正在打的那只怪（左上角那块条显示的就是它）；见 `setTarget`。 */
      target: null,
      player: null,
      enemies: [],
      projectiles: [],
      pickups: [],
      effects: [],
      /* Ground a skill opened and left burning: see spawnField. */
      fields: [],
      /*
       * A skill's own judgement that leaves him and flies - not to be confused
       * with `projectiles`, which are the monsters' and travel the other way.
       * See `spawnShot`; 十字斩's third cut is the only one so far.
       */
      shots: [],
      nextEnemyId: 1,
      nextProjectileId: 1,
      stats: {
        hits: 0,
        kills: 0,
        damageDealt: 0,
        damageTaken: 0,
        /* The largest amount any single `damagePlayer` call landed (see it). */
        maxHitTaken: 0,
        airHits: 0,
        bloodOrbs: 0,
        rooms: 0,
        barrels: 0,
        /* 这一局从地上捡起来的东西与金币（`docs/adr/0042`）。 */
        loot: 0,
        gold: 0,
        /*
         * 战斗评分要的四个读数（`docs/adr/0041`）。**它们数的是"他出手"，不是
         * "怪挨打"** —— 一次挥砍扫中三只算**一次**出手，不然命中率会顶穿 100%。
         */
        swings: 0,
        swingsLanded: 0,
        lastLandedSwing: -1,
        hitsTaken: 0,
        comboChains: 0,
        comboHits: 0,
        lastHitAt: -99
      },
      /*
       * 左边那一栏事件日志（`docs/adr/0042`）：最多 8 行，满了挤掉最上面那行，
       * **不淡出也不滚动**。它跨房间留着 —— 换房不清。
       */
      log: [],
      /* 他挥出去的第几刀：只为了"这一刀算不算打中过"这一件事。 */
      swingSeq: 0,
      /* 第一次打中 Boss 那一刻才把目标条换成交战形态（`docs/adr/0043`）。 */
      bossEngaged: null,
      /* 进副本那一串（`docs/adr/0044`）：null = 已经在打了。 */
      intro: null,
      /* 关卡名还挂多久，0 = 不画。 */
      titleT: 0,
      /*
       * 这一局**结束那一刻**的钟（`docs/adr/0045`）。结算那一页的每一行、开箱的每一下
       * 都从它数起 —— 结束之后 `state.time` 还在走（战绩数字读的是快照），所以这个
       * 时间戳是那一页唯一能用的表。
       */
      finishedAt: null,
      upgradeChoice: null,
      /* 换房那一下的黑幕：从 TRANSITION.dur 数到 0，`1` 是全黑。 */
      transition: 0,
      victory: false,
      defeat: false
    };
    state.rngState = state.seed >>> 0;
    state.dungeon = dungeonFor(state.stage, state.seed);
    state.cell = state.dungeon ? state.dungeon.entry : 0;
    if (state.dungeon && typeof options.cell === "number") {
      state.cell = clamp(options.cell, 0, state.dungeon.cells.length - 1);
    }
    state.player = createPlayer(options.startX || 110);
    beginRoom(state, null);
    state.transition = TRANSITION.dur;
    return state;
  }

  /**
   * 直接落在某一格上，不开场演出、不算"走过来的"。
   *
   * 这是给**测试和调试**用的：一局从哪一格开始是地牢自己的事（`dungeonFor` 的起点房），
   * 玩家没有选择。所以它不算一条玩法入口，只算一个"把人放这儿"。
   */
  function goToCell(state, index) {
    if (!state.dungeon) return state.room;
    state.cell = clamp(index, 0, state.dungeon.cells.length - 1);
    state.entryDoor = null;
    markSeen(state);
    return beginRoom(state, null);
  }

  /**
   * **这一格他去过了。**
   *
   * 地图窗口画的是"他探过哪儿"，不是"整张图"（`docs/adr/0030` 当时把它读成后者 ——
   * 那是**误读**：客户端的 `act1.img` 里本来就有一整族"已经去过"的亮图块，
   * 我们只烘了暗的那一族，于是把"没去过"看成了"画满"）。业主 2026-10-15 实玩时
   * 指出：「探索地图是现在这种颜色，没有探索过的是黑的」。
   */
  function markSeen(state) {
    var cell = currentCell(state);
    if (cell) cell.seen = true;
  }

  /**
   * 走进一格：换的是"哪一格"，不是"第几关的第几间"。
   *
   * 进门之后他站在**进来那扇门**的位置（从东门进来就站在右边），这是"门口和地图方向一致"
   * 最直接的那一半 —— 他往哪走进去的，就从那边出现在下一间。
   */
  function enterCell(state, dir) {
    var cell = currentCell(state);
    if (!cell || !state.dungeon) return state.room;
    var at = doorNeighbour(state.dungeon, cell, dir);
    if (at < 0) return state.room;
    state.cell = at;
    markSeen(state);
    state.entryDoor = MINIMAP_STEPS[dir].back;
    state.transition = TRANSITION.dur;
    return beginRoom(state, state.entryDoor);
  }

  /*
   * **一间房的布景要摆到录像那个密度。**
   *
   * 量自业主的幽暗密林录像：一间房 **50–90 件**、走位带 **75–95% 有东西**；
   * 本作原来是 **4–8 件**、不到一成 —— **差十倍**（业主说的「场景素材少」就是这个）。
   * 手写 60 件 × 12 间 = 700 多条 `{piece, x, depth}` 不现实，所以：
   * **手写的那几件留着**（它们是这间房的地标：门口那两棵树、挡路的那块石头），
   * 缺的那批**按种子撒**。
   *
   * **撒的只用不挡人的那几档**（矮贴花与高草）。立着的实心件仍然由人写 ——
   * 怪不会绕路、会顶着它原地推（`docs/adr/0032`），几十块撒出来的石头会把它们顶死。
   *
   * 数量按录像折算：录像一屏 1440 视频像素 = 456 世界像素，我们一屏看得见 608，
   * 所以一间 960 像素的房子大致就是录像的一间房，直接用它的每屏量乘开。
   *
   * **它走自己的一条随机流**（`layoutRandom`，和地牢洗牌同一个做法），
   * 不碰 `nextRandom` —— 那一条是敌人抖动和掉落共用的，动它整段演示都会变。
   */
  var SCATTER = {
    /* 矮草丛：录像一屏 8–16 丛，是场上最密的一样。三件轮着来，免得一间房全一个样。 */
    low: {
      /*
       * 矮草丛与贴地平铺的叶片。后四件是 02 套里原来没取的那一批 ——
       * 录像里满地的是它们，不是我们那三件轮着来。
       */
      pieces: [
        "grassFlower", "sprout", "bush",
        "grassPatch", "leaves", "leavesBroad", "leavesDense",
        /* 一粒小石子：也是贴地的，混在草丛里。 */
        "pebble"
      ],
      /*
       * **34 → 28。** 一屏件的上限是量出来的（矮草一屏 8–16 丛），而石头那一档
       * （`stones`）要占位置，所以从这一档最上面减下来 —— 28 ÷ 2.1 屏 = 一屏 13.3 丛，
       * 仍在录像那一段里，一间房的布景总数也没顶到 90 的上限。
       */
      count: 28
    },
    /* 粉花：录像一屏 10–15 朵。 */
    flowers: { pieces: ["flower"], count: 26 },
    /*
     * 高草：录像一屏 0–5 丛。它**挡画不挡路**（`CONTEXT.md`）。
     * **Boss 房几乎没有它**（量到一屏 0–2 丛），所以那一间在自己的 `scatter` 里改这个数
     * —— 这是这一张表第一次按房间分开（`docs/adr/0047`）。
     */
    tall: { pieces: ["grass"], count: 8 },
    /*
     * **立着的那批**（02 套剩下那 19 件里的 14 件：三棵杉苗、两种倒木、四截断桩、
     * 两块岩壁、两棵枯树）。
     *
     * 它们**占地方、挡人**（`SOLID`），所以撒的时候必须躲开怪走的那条线 ——
     * 怪不会绕路，会顶着它原地推（`docs/adr/0032`）。躲法不是"别撒"，是**撒在深处**：
     * 本作的小怪站位最深到 depth 0.4（`stages.mirkwood.rooms` 里最大的那个），
     * 所以从 **0.55 往后**撒，它们够不着（判定是 z 上差 32 像素就算让开）。
     * 录像那边也是一样：大件都在带子靠里的那一半。
     */
    solid: {
      pieces: [
        "firSmall", "firMid", "firTall", "snagTall", "fallenTrunk",
        "stumpBroken", "trunkHollow", "snagShort", "snagStub",
        "ruinStone", "rockArch", "logMossy", "treeDead", "treeDeadTall"
      ],
      count: 6
    },
    /*
     * 木桶：录像**一间房 5 只**，散在**整条走位带**里（深度从贴后缘到贴前缘都有）、
     * 彼此间隔 100-300 像素。它是唯一只有他能打碎的实心件（`CONTEXT.md`）。
     *
     * 原来那 0-3 只是**人手写**的，等于把"摆在哪"钉死在几处；这一档改成按种子撒，
     * 总数才落到录像那一档。撒的位置要过「门口净空」（`docs/adr/0032`）——
     * 桶是实心的，横在门前人和演示 bot 都出不去。
     */
    barrels: { pieces: ["barrel"], count: 5, from: 0.08, to: 0.92 },
    /*
     * 石头：录像**一屏 2–7 块**，而且**成对、成 2–4 块的塌方堆**（不是均匀撒开）。
     * 本作原来一屏只有 **0.8 块** —— 手写的那几块，加上 `solid` 那一档里的岩壁，
     * 差三倍。它和木桶一样是实心的，所以从前摆不进走位带；怪会绕路之后可以了
     * （`docs/adr/0048`）。
     */
    stones: {
      /* 只取**小**的两件：录像那一堆是几块石头，不是一堵墙（岩壁在 `solid` 那一档）。 */
      pieces: ["rockSmall", "pillar"],
      /*
       * **一堆**，不是两堆。两堆那一版把一间房的实心件推到 17.9 件（一屏 8.5），
       * 而带子是可以被实心件**封死**的：演示 bot 走不到 Boss 房（`tests/attract`），
       * `routeStep` 在封死的房间里只会答 `[0, 0]`。一堆 2–4 块落在一屏 2.4 块，
       * 仍落在录像 2–7 那一段里，而"带子走得通"这条底线还在。
       */
      piles: 1,
      perPile: [2, 4],
      /* 一堆里散布多宽（世界px）—— 量的是"成堆"，不是"排成一行"。 */
      spread: 74,
      from: 0.10,
      to: 0.90
    },
    solidFrom: 0.55,
    solidTo: 0.94,
    /* 深度落在带子的哪一段：录像里布景基本都贴在走位带上。 */
    depthFrom: 0.04,
    depthTo: 0.96,
    /* 离房间两头留的边距，别撒进墙里。 */
    margin: 34
  };

  function scatterProps(state, next, alreadyPlaced) {
    var out = [];
    /*
     * **撒出去的实心件之间也要查重。** 手写的那条路会挪开、不压已摆下的实心件；
     * 撒的这条原来**只查门** —— 于是两件实心件可以叠在一起。判定上两个盒子都在，
     * 叠着只是难看，但"叠起来的那一片"正是带子最容易被封死的地方：布景挡住的格
     * 连成一片之后 `routeStep` 在整间房里只会答"没有路"（`docs/adr/0049`）。
     *
     * `alreadyPlaced` 是手写的那几件（它们在这之前就摆好了、而且过完门口净空了）。
     */
    var overlaps = function (x, z, box) {
      var check = function (list) {
        for (var i = 0; i < list.length; i += 1) {
          var other = list[i];
          if (!other.solid) continue;
          var otherBox = propBox(other.piece);
          if (!otherBox) continue;
          if (Math.abs(x - other.x) < (box.width + otherBox.width) / 2 &&
              Math.abs(z - other.z) < (box.depth + otherBox.depth) / 2) return true;
        }
        return false;
      };
      return check(out) || check(alreadyPlaced || []);
    };
    var left = roomLeft(state) + SCATTER.margin;
    var right = roomRight(state) - SCATTER.margin;
    var depth = bandDepth(state.band);
    /*
     * 每一档的件数可以被**这一间房**改写（`spec.scatter`）：录像里六间房不是一副样子，
     * 量到的差别最大的是高草 —— Boss 房一屏 0–2 丛，别的房间 0–5。
     */
    var perRoom = state.room && state.room.scatter;
    [SCATTER.low, SCATTER.flowers, SCATTER.tall].forEach(function (group) {
      var count = group.count;
      if (perRoom) {
        if (group === SCATTER.low && perRoom.low !== undefined) count = perRoom.low;
        if (group === SCATTER.flowers && perRoom.flowers !== undefined) count = perRoom.flowers;
        if (group === SCATTER.tall && perRoom.tall !== undefined) count = perRoom.tall;
      }
      for (var index = 0; index < count; index += 1) {
        /*
         * **贴花也别摆在门口**（业主 2026-10-15 实玩：「有的花丛遮挡住门口了」）。
         * 它不挡人，但**画**上会盖住门拱 —— 和手写的那批同一条规矩，只是没有盒子、
         * 所以不过"压到别的实心件"那一关。试几个位置，试不出来就少摆这一件。
         */
        var decal = null;
        for (var decalTry = 0; decalTry < 6 && decal === null; decalTry += 1) {
          var spot = {
            piece: group.pieces[Math.floor(next() * group.pieces.length)],
            x: left + next() * (right - left),
            depth: SCATTER.depthFrom + next() * (SCATTER.depthTo - SCATTER.depthFrom)
          };
          if (!blocksDoorway(state, currentCell(state), spot, depth) &&
              !blocksDoorLane(state, currentCell(state), spot)) decal = spot;
        }
        if (!decal) continue;
        out.push({
          piece: decal.piece,
          x: decal.x,
          z: decal.depth * depth,
          /* 撒的这几档不挡人：没有盒子，也就没有血、打不碎。 */
          solid: false,
          /* 撒的（不是人写的）：测试与复核要能把两拨分开，见 `SCATTER` 那段。 */
          scattered: true,
          hp: 0,
          broken: false,
          brokenAt: -1
        });
      }
    });
    /*
     * 立着的那一批：有盒子、挡人，所以只撒在带子深处（见上面那段），**而且要过
     * 「门口净空」那一关**（`docs/adr/0032`：门口不能有石头和树木）。
     *
     * 手写的那几件在 `beginRoom` 里会过这一关（压门就挪、挪不开才丢），**撒的这一批
     * 原来没走那条路** —— 于是那根 223 像素宽的倒木正好横在一扇门前，人和演示 bot
     * 都出不去：浏览器证明没红，`tests/attract.test.js` **转满一核六分钟**卡在那儿
     * （它那个 `while (!victory && seconds < 60)` 在"时间不推进"时是个死循环）。
     * 这里跟手写的那条一个待遇：**换几个位置再试，试不出来就丢**。
     */
    for (var pile = 0; pile < SCATTER.stones.piles; pile += 1) {
      var pileX = left + next() * (right - left);
      var pileDepth = SCATTER.stones.from +
        next() * (SCATTER.stones.to - SCATTER.stones.from);
      var pileSize = SCATTER.stones.perPile[0] +
        Math.floor(next() * (SCATTER.stones.perPile[1] - SCATTER.stones.perPile[0] + 1));
      for (var rock = 0; rock < pileSize; rock += 1) {
        var stonePiece = SCATTER.stones.pieces[
          Math.floor(next() * SCATTER.stones.pieces.length)
        ];
        var stoneBox = propBox(stonePiece);
        var stoneAt = null;
        for (var stoneTry = 0; stoneTry < 8 && stoneAt === null; stoneTry += 1) {
          var stone = {
            piece: stonePiece,
            x: clamp(pileX + (next() - 0.5) * SCATTER.stones.spread, left, right),
            depth: clamp(pileDepth + (next() - 0.5) * 0.08, 0, 1)
          };
          if (!blocksDoorway(state, currentCell(state), stone, depth) &&
              !blocksDoorLane(state, currentCell(state), stone) &&
              !overlaps(stone.x, stone.depth * depth, stoneBox)) stoneAt = stone;
        }
        if (!stoneAt) continue;
        out.push({
          piece: stonePiece,
          x: stoneAt.x,
          z: stoneAt.depth * depth,
          solid: true,
          scattered: true,
          hp: stoneBox && stoneBox.hp ? stoneBox.hp : 0,
          broken: false,
          brokenAt: -1
        });
      }
    }
    for (var b = 0; b < SCATTER.barrels.count; b += 1) {
      var barrelPiece = SCATTER.barrels.pieces[0];
      var barrelBox = propBox(barrelPiece);
      var barrelAt = null;
      for (var tryIndex = 0; tryIndex < 8 && barrelAt === null; tryIndex += 1) {
        var barrel = {
          piece: barrelPiece,
          x: left + next() * (right - left),
          depth: SCATTER.barrels.from +
            next() * (SCATTER.barrels.to - SCATTER.barrels.from)
        };
        if (!blocksDoorway(state, currentCell(state), barrel, depth) &&
            !blocksDoorLane(state, currentCell(state), barrel) &&
            !overlaps(barrel.x, barrel.depth * depth, barrelBox)) barrelAt = barrel;
      }
      if (!barrelAt) continue;
      out.push({
        piece: barrelPiece,
        x: barrelAt.x,
        z: barrelAt.depth * depth,
        solid: true,
        scattered: true,
        hp: barrelBox && barrelBox.hp ? barrelBox.hp : 1,
        broken: false,
        brokenAt: -1
      });
    }
    for (var k = 0; k < SCATTER.solid.count; k += 1) {
      var piece = SCATTER.solid.pieces[Math.floor(next() * SCATTER.solid.pieces.length)];
      var box = propBox(piece);
      var placed = null;
      for (var attempt = 0; attempt < 8 && placed === null; attempt += 1) {
        var candidate = {
          piece: piece,
          x: left + next() * (right - left),
          depth: SCATTER.solidFrom + next() * (SCATTER.solidTo - SCATTER.solidFrom)
        };
        if (!box || (!blocksDoorway(state, currentCell(state), candidate, depth) &&
            !blocksDoorLane(state, currentCell(state), candidate) &&
            !overlaps(candidate.x, candidate.depth * depth, box))) {
          placed = candidate;
        }
      }
      if (!placed) continue;
      out.push({
        piece: piece,
        x: placed.x,
        z: placed.depth * depth,
        solid: !!box,
        scattered: true,
        hp: box && box.hp ? box.hp : 0,
        broken: false,
        brokenAt: -1
      });
    }
    return out;
  }

  function beginRoom(state, entryDoor) {
    /*
     * **他人在这一格，这一格就是探过的** —— 挂在 `beginRoom` 上而不是挂在门上：
     * 开局那一格不经 `goToCell`，从这儿走两条路都盖得到。
     */
    markSeen(state);
    var cell = currentCell(state);
    var spec = state.stage.rooms[cell.room];
    /* 清过的房间不再刷怪：这是"能回头"的前提。 */
    var cleared = !!cell.cleared;
    state.room = {
      name: spec.name,
      total: spec.enemies.length,
      cleared: cleared,
      cell: state.cell,
      /*
       * 这一间房有多宽、两堵墙在哪（`docs/adr/0035`）。宽度写在房间上，没写的
       * 房间就是 `ROOM.width` —— 与**世界窗口**无关：窗口收窄不缩房间。
       */
      width: spec.width || ROOM.width,
      leftWall: ROOM.leftWall,
      rightWall: (spec.width || ROOM.width) - (ROOM.width - ROOM.rightWall),
      /*
       * 这一间房自己改哪几档撒景的件数（`docs/adr/0047`）。没写的房间用 `SCATTER`
       * 的默认值 —— 所以这一项不是"每间房都要写"，是**不default 的那几间才写**。
       */
      scatter: spec.scatter || null
    };
    /* 新的一间房：上一间那条"当前目标"不带进来。 */
    state.target = null;
    /*
     * The floor this room is fought on; a room without one gets the default
     * band. Read-only, like the room spec it comes from: `BAND` is a module
     * constant and one room's band object can back several rooms.
     */
    state.band = spec.band || BAND;
    /*
     * A room entry is {type, x, depth?}: `depth` is a share of this room's floor
     * - 0 is the front edge, 1 the far end - and it is turned into world units
     * here, once, so a room can be written without knowing how deep its floor is
     * and everything downstream only ever deals in `z`.
     */
    var depth = bandDepth(state.band);
    state.enemies = cleared
      ? []
      : spec.enemies.map(function (entry) {
          var z = entry.depth === undefined ? 0 : entry.depth * depth;
          return createEnemy(state, entry.type, entry.x, z);
        });
    /*
     * Scenery, in the room's own words: `{piece, x, depth?}`, where `piece` is a
     * name the bake produced (`assets/import_dnf_scene.py`) and `depth` is a
     * share of this room's floor, exactly like an enemy's. Most props are art
     * only; a piece in `BREAKABLE` (the barrel) also carries a box, blocks both
     * fighters and can be smashed by the player alone.
     */
    /*
     * **一格只摆一次。** 布景是这一格的记性，不是每次进门重铺一遍：木桶碎过就是
     * 碎了 —— 「这一局不再回来」（业主 2026-10-10）。所以这批对象挂在 `cell` 上，
     * 和 `cell.cleared` 一样活得比"进这一趟门"久；回头再走进来读到的是同一批对象，
     * `broken` / `gone` 都还在。（怪不在其中：清过的房间根本不刷怪，没清的房间
     * 重进时满血重来，那是另一回事。）
     */
    if (!cell.props) {
      var built = [];
      (spec.props || []).forEach(function (entry) {
        var z = entry.depth === undefined ? 0 : entry.depth * depth;
        var box = propBox(entry.piece);
        /*
         * 门口净空（`docs/adr/0032`，业主：「门口不能有石头和树木」）：压着门就**先往
         * 旁边挪**（最近的空位），挪不开才丢掉 —— 直接丢会把一间房掏空一半（断桩隘口
         * 的树桩正好站在上门那一条上）。
         *
         * 挪的位置要同时满足两条：离开**所有**门（判定区 + 门拱美术，`blocksDoorway`），
         * 也不压到已经摆下的实心件。房间是按种子洗到格子上的，所以这一刀只能落在这儿 ——
         * 写房间的人不知道它会落在哪一格。
         *
         * **贴花也在这套里了**（业主 2026-10-15 实玩：「有的花丛遮挡住门口了」）。
         * 原来它们不管：判定上确实"不挡人也不挡门"，但**画**上会盖住门拱 ——
         * 门口那一块是给人认路的，盖住就是盖住了。贴花没有盒子，所以让位时按 0 宽算。
         */
        if (blocksDoorway(state, cell, entry, depth)) {
          var moved = null;
          for (var away = 1; away <= 60 && moved === null; away += 1) {
            for (var side = -1; side <= 1 && moved === null; side += 2) {
              /* 挪不动就贴着墙试（最后那几个位置是这么够到的）。 */
              var span = box ? box.width / 2 : 0;
              var x = clamp(entry.x + side * away * 12,
                            roomLeft(state) + span,
                            roomRight(state) - span);
              if (blocksDoorway(state, cell, { piece: entry.piece, x: x, depth: entry.depth }, depth)) continue;
              if (box && built.some(function (other) {
                if (!other.solid) return false;
                var otherBox = propBox(other.piece);
                return Math.abs(x - other.x) < (box.width + otherBox.width) / 2;
              })) continue;
              moved = x;
            }
          }
          if (moved === null) return;
          entry = { piece: entry.piece, x: moved, depth: entry.depth };
        }
        built.push({
          piece: entry.piece,
          x: entry.x,
          z: z,
          /* 桶和立着的布景（树、石头）才有盒子；花草贴花没有。碎了的桶只剩美术。 */
          solid: !!box,
          hp: box && box.hp ? box.hp : 0,
          broken: false,
          /* 碎片的钟：从 0 数到 `BREAK_ANIM`，这段时间放那 12 帧。 */
          brokenAt: -1
        });
      });
      /*
       * 手写的那几件摆完，再把缺的那批**按种子撒**上去（`SCATTER`）。
       * 每格的种子不一样 —— 同一间房落在不同格子上不该长成同一副样子。
       */
      built = built.concat(
        scatterProps(state, layoutRandom(state.seed + (state.cell + 1) * 7919), built)
      );
      cell.props = built;
    }
    state.props = cell.props;
    state.player.x = roomLeft(state) + 86;
    state.player.y = ARENA.groundY;
    state.player.z = 0;
    if (entryDoor === "E") state.player.x = roomRight(state) - DOOR.stand;
    if (entryDoor === "W") state.player.x = roomLeft(state) + DOOR.stand;
    if (entryDoor === "N") {
      state.player.x = doorX(state, cell, "N");
      state.player.z = depth - DOOR.stand;
    }
    if (entryDoor === "S") {
      state.player.x = doorX(state, cell, "S");
      state.player.z = DOOR.stand;
    }
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    state.player.onGround = true;
    /*
     * 人一落地就把镜头摆好 —— 从东门进来镜头就贴在右墙上，从西门进来贴在左墙上，
     * 和录像里一样（他进门那一下镜头是**顶在边上**的，然后才跟着他往另一边滚）。
     * 每帧末尾还会再叫一次（`step`），两次的结果一样：它是幂等的。
     */
    updateCamera(state);
    state.player.attackTimer = 0;
    state.player.skillId = null;
    state.player.skillTimer = 0;
    state.player.attackHitDone = false;
    state.player.skillHitDone = false;
    state.player.skillHitsDone = 0;
    state.player.comboTimer = 0;
    /*
     * **What is deliberately not cleared**: `player.buffs` and, riding with it,
     * `player.hellbenterTier` - 魔狱血刹's whole shape is that the sword outlives
     * the room it was raised in (docs/adr/0025). Every skill field above is about
     * a cast that this room ended; the sword is not a cast.
     */
    state.pickups = [];
    state.projectiles = [];
    /* A new room is a new floor: nothing he opened in the last one burns here. */
    state.fields = [];
    /* ...and nothing he threw is still in the air in it either. */
    state.shots = [];
    /*
     * ...and the flashes of the room he just left go with them. An effect is
     * drawn at the x/z it was born at, so a death burst left running would burn
     * on the *new* room's floor for the rest of its half second. The banner for
     * this room is pushed below, after the clear.
     */
    state.effects = [];
    state.upgradeChoice = null;
    state.effects.push({
      kind: "banner",
      text: spec.name,
      life: 1.8,
      maxLife: 1.8
    });
    return state.room;
  }

  /*
   * **命中状态词：`无法浮空`。**
   *
   * 量自业主的幽暗密林录像。那一块浅色小字**自始至终只有一个词**，就是 `无法浮空`
   * —— 不是"浮空"：t=65 那一次`无`字被伤害数字压住了，只看得到后三个字，所以早先
   * 有一版把它读成了"浮空"。冷白 `#E4E7ED`、深色描边约 3 px、字高 **29 视频像素**、
   * 活 **0.4–0.8 秒**（和伤害数字的 0.6 秒同一档）。
   *
   * **它是钉在怪身上的，不是钉在数字上的** —— t=60 那一次它身旁 350 像素内一个数字都没有。
   * 有数字的时候它落在数字右边一点点（量到：左缘贴着数字的右缘，基线比数字低约 10 px）。
   *
   * 它讲的是**为什么这一下没把他挑起来**：霸体不吃浮空（见 `damageEnemy` 里
   * `opts.launch` 那一段）。业主在 Q17 上要它，要的正是这件事 —— 一个讲不清的
   * 手感问题，从此有一句话解释。
   */
  var HIT_WORD = {
    text: "无法浮空",
    life: 0.6,
    /* 相对伤害数字那个锚点的偏移（视频像素折成世界像素）。 */
    dx: 30 * VIDEO_PX,
    dy: 10 * VIDEO_PX
  };

  /** 在他身上落一个命中状态词。 */
  function pushHitWordEffect(state, enemy, text) {
    state.effects.push({
      kind: "hitWord",
      text: text,
      x: enemy.x + HIT_WORD.dx,
      y: enemy.y - enemy.height - 6 + HIT_WORD.dy,
      life: HIT_WORD.life,
      maxLife: HIT_WORD.life
    });
  }

  function pushDamageEffect(state, x, y, amount) {
    state.effects.push({
      kind: "damage",
      text: String(amount),
      x: x,
      y: y,
      /*
       * **活 0.6 秒** —— 量自录像（35 个数字：0.30–0.93 秒，中位 0.60），
       * 到点**直接消失**，不淡出、不缩小。
       */
      life: 0.6,
      maxLife: 0.6
    });
  }

  /*
   * A swing that slid off. It rides the damage-number effect rather than getting
   * a kind of its own, because it *is* the number for that hit - there just is
   * not one. Without it the player reads a miss as "my attack did nothing",
   * which is the shape of a bug (docs/adr/0018).
   */
  function pushMissEffect(state, enemy) {
    state.effects.push({
      kind: "damage",
      miss: true,
      text: "MISS",
      x: enemy.x,
      y: enemy.y - enemy.height - 6,
      life: 0.7,
      maxLife: 0.7
    });
  }

  function bodyBox(entity) {
    return {
      left: entity.x - entity.width / 2,
      right: entity.x + entity.width / 2,
      bottom: entity.y,
      top: entity.y - entity.height
    };
  }

  function boxesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  /*
   * `at` is the x the box is rooted at, and it exists because **not every box
   * comes off the caster**. 十字斩's third cut leaves him: the merged qi is a
   * thing that flies forward on its own (see `spawnShot`), and its box has to
   * travel with it rather than stretch from his hands. Everything else passes
   * nothing and roots on him, which is what it always did.
   */
  function attackBox(player, reach, heightPad, at) {
    var root = at === undefined ? player.x : at;
    var left = player.facing > 0 ? root : root - reach;
    return {
      left: left,
      right: left + reach,
      bottom: player.y + heightPad,
      top: player.y - player.height - heightPad
    };
  }

  /** When a skill's `index`-th hit lands, in seconds into the cast. */
  function hitTime(skill, index, player) {
    /*
     * **A channel's beats are timed from the release, not from the press.** Its
     * other beats are all "N seconds after he let go", and the press does not know
     * when that will be - which is the whole of why this move's art is read by
     * elapsed seconds rather than by progress (docs/adr/0023). Before the release
     * its hit is infinitely far away, so the ordinary hit loop simply waits.
     */
    if (skill.channel) {
      var released = player && player.channelReleasedAt;
      if (released === null || released === undefined) return Infinity;
      return released + (skill.channel.hits || [])[index];
    }
    /*
     * Most moves spread their hits evenly across the active window, and that is
     * all they ever needed to say. A move whose cuts land where the reference's
     * own cuts land cannot: 十字斩's three are 0.206 / 0.324 / 0.647 apart.
     */
    if (skill.hitAt) return skill.duration * skill.hitAt[index];
    var count = skill.hits || 1;
    return skill.activeFrom + index * ((skill.activeTo - skill.activeFrom) / count);
  }

  /*
   * How far in front of the spot he pressed the key on he stands, `elapsed`
   * seconds into a move that carries him.
   *
   * Three pieces, and all three are the clip's: nothing until the third cut,
   * then the step, then hold it, then walk back over the recovery. The step
   * itself takes ~one clip frame (#43 -> #44 is where his boots move), so it is
   * ramped over `advanceRamp` rather than snapped - at 30fps the clip can hide a
   * 139px jump inside one frame, at 60fps the same jump in one frame is a
   * teleport. The return is the one part the clip does not show: it cuts
   * straight back to the idle on #56, and a cut is not something a 60fps
   * renderer can play, so `advanceBack` spreads it instead.
   */
  function advanceAhead(skill, elapsed) {
    var progress = skill.duration > 0 ? elapsed / skill.duration : 1;
    var ramp = skill.advanceRamp === undefined ? 0 : skill.advanceRamp;
    if (progress <= skill.advanceAt) return 0;
    if (progress < skill.advanceAt + ramp) {
      return skill.advance * ((progress - skill.advanceAt) / Math.max(0.0001, ramp));
    }
    var back = skill.advanceBack === undefined ? 1 : skill.advanceBack;
    if (progress <= back) return skill.advance;
    var t = Math.min(1, (progress - back) / Math.max(0.0001, 1 - back));
    return skill.advance * (1 - t);
  }

  /*
   * Hand a skill's **flying** hitbox over to the arena.
   *
   * 十字斩's third cut is not a box on his hands - the clip's own third act is
   * the three cuts' qi merging into one body that flies forward and shrinks
   * away, so what lands is a box on *that*. The art for it is baked into the
   * row (the third stage's `travel`/`grow`), and this is the judgement half of
   * the same motion: it reads the same two numbers out of the skill's own `shot`
   * spec so that **he is hit by the qi where he can see it**.
   *
   * A shot is its own entity because it outlives the hit frame it was born on
   * and because it moves: it carries its own clock, its own speed and a list of
   * the bodies it has already passed through (so it hits each one once - it is a
   * sweep, not a trap).
   */
  function spawnShot(state, skillId, damage, hitIndex) {
    var skill = SKILLS[skillId];
    var shot = skill && skill.shot;
    if (!shot) return null;
    var player = state.player;
    var origin = player.castOriginX === undefined ? player.x : player.castOriginX;
    state.shots.push({
      skillId: skillId,
      /* Where the qi's own middle is, in world x. */
      x: origin + player.facing * shot.ahead,
      vx: player.facing * shot.speed,
      z: player.z || 0,
      facing: player.facing,
      y: player.y,
      height: player.height,
      reach: shot.reach,
      heightPad: shot.heightPad,
      damage: damage,
      hitIndex: hitIndex,
      struck: [],
      life: shot.life,
      maxLife: shot.life
    });
    return state.shots[state.shots.length - 1];
  }

  /*
   * Move every qi still in the air and let it hit what it is passing through.
   * One hit per body per qi: a second of overlap is not a second of damage.
   */
  function updateShots(state, dt) {
    if (!state.shots || !state.shots.length) return;
    state.shots.forEach(function (shot) {
      shot.life -= dt;
      shot.x += shot.vx * dt;
      var box = shotBox(shot);
      state.enemies.forEach(function (enemy) {
        if (enemy.dead || shot.struck.indexOf(enemy.id) !== -1) return;
        if (!inReachOf(enemy.z, shot.z, undefined)) return;
        if (!boxesOverlap(box, bodyBox(enemy))) return;
        shot.struck.push(enemy.id);
        applySkillHit(state, enemy, shot.damage, SKILLS[shot.skillId], shot.hitIndex);
      });
    });
    state.shots = state.shots.filter(function (shot) {
      return shot.life > 0;
    });
  }

  /** The qi's own box: centred on it, not stretching back to his hands. */
  function shotBox(shot) {
    var half = shot.reach / 2;
    return {
      left: shot.x - half,
      right: shot.x + half,
      bottom: shot.y + shot.heightPad,
      top: shot.y - shot.height - shot.heightPad
    };
  }

  function pushBanner(state, text, life) {
    state.effects.push({
      kind: "banner",
      text: text,
      life: life || 1.2,
      maxLife: life || 1.2
    });
  }

  /** 怪倒下时地上摆出来的那块名牌（`docs/adr/0042`）。 */
  function dropLoot(state, enemy) {
    var loot = lootFor(state, enemy);
    state.pickups.push({
      kind: "loot",
      name: loot.name,
      tone: loot.tone,
      gold: loot.gold,
      exp: enemy.xp,
      x: enemy.x,
      z: enemy.z || 0,
      life: LOOT.life
    });
  }

  /** 走过去把它收掉：经验、金币、日志三行、原地一行 `+N Exp`（`docs/adr/0042`）。 */
  function collectLoot(state, drop) {
    state.stats.loot += 1;
    state.stats.gold += drop.gold;
    /*
     * **经验挂在"捡"上，不挂在"杀"上**（业主 2026-10-14，Q12 选 a）。录像里那三行
     * 日志（`获得[X]1个` / `获得40点经验值` / `获得38金币`）也是同一刻一起出来的。
     */
    grantXp(state, drop.exp);
    pushLog(state, "获得[" + drop.name + "]1个", drop.tone);
    pushLog(state, "获得" + drop.exp + "点经验值", "gold");
    pushLog(state, "获得" + drop.gold + "金币", "gold");
    state.effects.push({
      kind: "pickupText",
      text: "+" + drop.exp + " Exp",
      x: drop.x,
      y: ARENA.groundY - depthLift(drop.z || 0) - 18,
      life: 0.9,
      maxLife: 0.9
    });
  }

  function grantXp(state, amount) {
    var player = state.player;
    if (player.dead || amount <= 0) return 0;
    player.xp += amount;
    var levels = 0;
    while (
      player.xp >= player.xpToNext &&
      player.level < PROGRESSION.maxLevel
    ) {
      player.xp -= player.xpToNext;
      player.level += 1;
      player.xpToNext = Math.round(player.xpToNext * PROGRESSION.growth);
      player.maxHp += PROGRESSION.maxHpPerLevel;
      player.maxMp += PROGRESSION.maxMpPerLevel;
      player.attackBonus += PROGRESSION.attackPerLevel;
      player.hp = Math.min(player.maxHp, player.hp + PROGRESSION.healOnLevelUp);
      player.mp = Math.min(player.maxMp, player.mp + PROGRESSION.maxMpPerLevel);
      levels += 1;
    }
    if (levels > 0) {
      pushBanner(state, "LEVEL UP - Lv " + player.level, 1.4);
    }
    return levels;
  }

  /** Three distinct upgrades, drawn from the seeded RNG so a seed replays exactly. */
  function rollUpgradeOptions(state) {
    var pool = UPGRADE_ORDER.slice();
    var options = [];
    while (options.length < UPGRADES_PER_ROOM && pool.length > 0) {
      var index = Math.floor(nextRandom(state) * pool.length);
      if (index >= pool.length) index = pool.length - 1;
      options.push(pool.splice(index, 1)[0]);
    }
    return options;
  }

  function offerUpgrade(state) {
    state.upgradeChoice = {
      cell: state.cell,
      options: rollUpgradeOptions(state),
      picked: null
    };
    return state.upgradeChoice;
  }

  /**
   * Take one offered upgrade. The gate to the next room only opens once a pick
   * is recorded, so a run cannot skip its reward by walking past it.
   */
  function chooseUpgrade(state, upgradeId) {
    var choice = state.upgradeChoice;
    if (!choice || choice.picked) return false;
    var id = String(upgradeId || "");
    if (choice.options.indexOf(id) === -1) return false;
    var spec = UPGRADES[id];
    if (!spec) return false;

    spec.apply(state.player);
    state.player.upgradesTaken.push(id);
    choice.picked = id;
    state.upgradeChoice = null;
    pushBanner(state, spec.name + " - " + spec.detail, 1.8);
    /*
     * 不再是"往右走"：门口按地图上那一格的方向开（`docs/adr/0030`），去哪一扇由他选的路
     * 决定，所以这句话只说"门开了"。
     */
    pushBanner(state, "门开了 · 去下一间", 1.4);
    return true;
  }

  /** The blood 血之狂暴 pulls out of a monster it just hit. */
  function spawnBloodOrb(state, enemy) {
    var x = enemy.x;
    var y = enemy.y - enemy.height * 0.55;
    var orb = {
      kind: "blood_orb",
      x: x,
      y: y,
      z: enemy.z || 0,
      radius: BLOOD_ORB.radius,
      value: BLOOD_ORB.heal,
      life: BLOOD_ORB.lifetimeSeconds,
      /* Where it was drawn, and how far along the pull it is (see BLOOD_ORB). */
      fromX: x,
      fromY: y,
      progress: 0,
      trail: [{ x: x, y: y }]
    };
    state.pickups.push(orb);
    state.stats.bloodOrbs += 1;
    return orb;
  }

  /*
   * One landed hit's worth of blood, two ways: the tier it buys and the strand
   * it draws on the way in. They are the same fact about the same hit, which is
   * why they are spawned together - a hit that grew the sword with nothing flying
   * into him would read as the sword growing on its own (docs/adr/0025).
   *
   * Hits are counted, not rounded up: ten of them buy a tier, and the ten are
   * carried across calls, so the sword steps at the tenth hit and not at the
   * first. A kill is the exception and skips the count entirely - it is worth a
   * whole tier on the spot, which is what makes finishing a monster feel like
   * the sword's business rather than the clock's.
   */
  function growSword(state, hits, kills) {
    var player = state.player;
    if (!(player.buffs.hellbenter > 0)) return;
    var tier = Math.max(1, player.hellbenterTier || 1);
    if (tier >= HELLBENTER.tiers) {
      player.hellbenterCharge = 0;
      return;
    }
    var charge = (player.hellbenterCharge || 0) + (hits || 0);
    var steps = (kills || 0) * HELLBENTER.killTiers +
      Math.floor(charge / HELLBENTER.hitsPerTier);
    player.hellbenterCharge = charge % HELLBENTER.hitsPerTier;
    player.hellbenterTier = Math.min(HELLBENTER.tiers, tier + steps);
  }

  function spawnBloodStrand(state, enemy) {
    state.effects.push({
      kind: "bloodStrand",
      /* Out of the wound: half way up the body that owns it. */
      x: enemy.x,
      y: enemy.y - enemy.height * 0.5,
      z: enemy.z || 0,
      life: HELLBENTER.strandLife,
      maxLife: HELLBENTER.strandLife
    });
  }

  /**
   * DNF bosses change gear once they are cornered. Crossing the phase-two health
   * ratio raises speed, damage and slam reach and unlocks the mid-range lunge.
   * Every number comes from the enemy's own base snapshot, so a phase change is
   * repeatable and never leaks into the shared ENEMY_TYPES spec.
   */
  function enterPhase2(state, enemy) {
    var phase2 = enemy.phase2;
    if (!phase2 || enemy.phase >= 2 || enemy.dead) return false;

    enemy.phase = 2;
    enemy.speed = enemy.baseSpeed * phase2.speedScale;
    enemy.damage = Math.round(enemy.baseDamage * phase2.damageScale);
    enemy.attackCooldownMax = enemy.baseAttackCooldownMax * phase2.cooldownScale;
    enemy.attackCooldown = Math.min(enemy.attackCooldown, enemy.attackCooldownMax);
    enemy.baseAttackWindup = enemy.baseAttackWindup * phase2.windupScale;

    if (enemy.slam && enemy.baseSlam) {
      enemy.slam.radius = enemy.baseSlam.radius * phase2.slamRadiusScale;
      enemy.slam.cooldown = enemy.baseSlam.cooldown * phase2.slamCooldownScale;
      enemy.slamCooldown = Math.min(enemy.slamCooldown, 0.6);
    }
    enemy.lungeCooldown = phase2.lunge.cooldown * 0.35;

    /* The transition telegraphs itself: a non-damaging ring plus a banner. */
    state.effects.push({
      kind: "shockwave",
      x: enemy.x,
      y: ARENA.groundY,
      radius: enemy.slam ? enemy.slam.radius : enemy.attackRange,
      life: 0.45,
      maxLife: 0.45
    });
    pushBanner(state, (state.stage && state.stage.bossBanner) || phase2.banner, 1.8);
    return true;
  }

  /*
   * Put - or refresh - the bleed on a monster. Every landed hit lands it again
   * while the stance is up, so the wound reads as "he is bleeding" rather than
   * as a pile of separate timers, and there is exactly one slot for it
   * (docs/adr/0017).
   */
  function startBleed(enemy, spec) {
    if (!spec) return;
    enemy.bleed = {
      damage: spec.damage,
      remaining: spec.duration,
      timer: spec.interval,
      /*
       * **The interval has to be stored, not just used once.** The tick does
       * `timer += bleed.interval` to line the next one up, and it was reading
       * a field the record never carried: `timer` went to NaN on the very first
       * tick and `NaN <= 0` is false, so a "4 a second for 3 seconds" bleed
       * ticked **exactly once** and then sat there until it expired. Found on
       * 2026-09-27 when 十字斩's beats moved and the bleed test started
       * measuring the wrong window.
       */
      interval: spec.interval
    };
  }

  /*
   * The bleed 血之狂暴 puts on whatever he hits, or null while the stance is
   * down. Its damage follows his level the way every other number in the game
   * does, and it is the same bleed whichever move landed it - blood has exactly
   * one owner, and that owner is the stance (docs/adr/0017).
   */
  function stanceBleed(player) {
    if (!player || !(player.buffs.bloodRage > 0)) return null;
    var buff = buffById("bloodRage");
    if (!buff || !buff.bleed) return null;
    var spec = buff.bleed;
    return {
      damage: spec.damage + (player.level - 1) * spec.growth,
      duration: spec.duration,
      interval: spec.interval
    };
  }

  /*
   * 回避 against 命中 (docs/adr/0018). Only an elite or a boss can slide out from
   * under a hit, and only 血之狂暴's accuracy closes the gap; the roll goes
   * through the seeded stream the drops use, so the same seed and the same
   * inputs still land every hit the same way.
   */
  function slidesOff(state, enemy) {
    var evasion = enemy.evasion || 0;
    if (evasion <= 0) return false;
    var miss = evasion - buffSum(state.player, "accuracy");
    if (miss <= 0) return false;
    return nextRandom(state) < miss;
  }

  /*
   * **当前目标：左上角那块条显示的是他正在打的那只怪。**
   *
   * 量自业主的幽暗密林录像（`dnf-dungeon-videos/00001-幽暗密林.mp4`）：
   *
   * - 那块条**每一只怪都会有** —— 它不是"精英专属"，是**当前目标**的读数；
   *   一帧里只有一块，换目标时**整块被换掉**（头像、类别、名字、血条一起换）。
   * - 目标倒下时，头像上打一个**闪三下**的红叉（约 **1.2 秒**），然后整块一帧消失。
   * - 录像里那条血条的**长度每只怪不一样**（哥布林量到 287 / 323 / 362 px，
   *   牛头巨兽 1068 px）—— 跟着怪变。是照最大血量还是照个头，量不出来。
   *
   * **有一件录像没讲清、这里就先不照抄的**：那一帧里"第一次打中"到"条子出现"
   * 之间量到约 **0.7 秒**的差（t=105.77 首个伤害数字 → t=106.533 条子到位）。
   * 只有一个样本，而且同一段里另外两间房的条子几乎是开局就在的 —— 所以本作做成
   * **打中即显示**，不搬那 0.7 秒。真要是固定延迟，加一个 `delay` 数就行。
   */
  var TARGET = {
    /* 目标倒下之后红叉还要闪多久（秒）。量出来是闪 3 下、共约 1.2 秒。 */
    deathBlink: 1.2,
    /*
     * 掉血那一截**不是"慢慢追上来的条"**：量出来是一块**白色块**，占着刚失去的那一段，
     * 原地**由白褪到黑**（约 0.7–0.8 秒），途中经过粉 → 暗红 → `#860000` → 黑。
     * 宽度从生到死**不变**，变的只有颜色。
     */
    ghostFade: 0.8
  };

  /** 他打中谁，谁就是当前目标。换人时整块换掉（那 1.2 秒的红叉也是从这儿重新算）。 */
  function setTarget(state, enemy) {
    if (!state.target || state.target.enemy.id !== enemy.id) {
      state.target = { enemy: enemy, dying: 0 };
    }
  }

  /**
   * 目标的存亡。**它握的是那只怪本身**，不是 id —— 目标倒下之后那只怪会被移出
   * `state.enemies`，可红叉还得闪完 1.2 秒，所以这块条读的是它自己那一份。
   */
  function updateTarget(state, dt) {
    var target = state.target;
    if (!target) return;
    if (target.enemy.dead) {
      target.dying += dt;
      if (target.dying >= TARGET.deathBlink) state.target = null;
      return;
    }
    target.dying = 0;
    /*
     * **掉血那一截**（`TARGET.ghostFade`）：血掉下去的那一帧把"刚失去的那一段"
     * 记下来，渲染那边照着它画一块白块 —— 那条血条的读数因此永远不用自己去记历史。
     */
    var share = target.enemy.maxHp > 0 ? target.enemy.hp / target.enemy.maxHp : 0;
    if (target.share === undefined) target.share = share;
    if (share < target.share - 1e-9) {
      target.ghost = { from: target.share, to: share, t: 0 };
    }
    target.share = share;
    if (target.ghost) {
      target.ghost.t += dt;
      if (target.ghost.t >= TARGET.ghostFade) target.ghost = null;
    }
  }

  function damageEnemy(state, enemy, amount, knockbackX, sourceX, options) {
    if (enemy.dead) return 0;
    var opts = options || {};
    /*
     * Is this the Slayer's own swing? His are the only hits that can slide off
     * (docs/adr/0018) and the only ones that carry 血之狂暴's bleed. Bleed ticks
     * and the chapel floor hit monsters too, and they pass `noBloodOrbs` - the
     * same flag the blood orbs were already using to ask this exact question.
     */
    var slayerSwing = !opts.noBloodOrbs;
    /*
     * 当前目标记在**同一个问法**上：这一下是不是他自己挥的。打空的（滑开）也算 ——
     * 那仍然是"他在打这一只"。地板与出血的 tick 不算：那是地的事，不是他在打谁。
     */
    if (slayerSwing) setTarget(state, enemy);
    if (slayerSwing && slidesOff(state, enemy)) {
      pushMissEffect(state, enemy);
      return 0;
    }
    var applied = Math.max(0, Math.round(amount));
    enemy.hp -= applied;
    state.stats.hits += 1;
    state.stats.damageDealt += applied;
    if (slayerSwing) {
      /*
       * 一次出手只算"打中过一次"：一刀扫中三只是**一次**命中，否则命中率会顶穿
       * 100%（`docs/adr/0041`）。`swingSeq` 在起手那一刻加一，这里记下这个号中过。
       */
      if (state.stats.lastLandedSwing !== state.swingSeq) {
        state.stats.lastLandedSwing = state.swingSeq;
        state.stats.swingsLanded += 1;
      }
      /* 连段：两次命中隔 2 秒以内算同一条（技巧那一行）。 */
      if (state.time - state.stats.lastHitAt > 2) state.stats.comboChains += 1;
      state.stats.lastHitAt = state.time;
      state.stats.comboHits += 1;
      /*
       * **顶部那块交战横幅是"你跟他交上手了"**（`docs/adr/0043`）：录像里它亮的
       * 那一帧，正好是他的挥砍弧线第一次打到牛头巨兽、冒出 `10` 的那一帧 ——
       * 不是它登场（它早就跟哥布林一起在场上打了），也不是小怪清完。
       */
      if (enemy.type === "boss" && !state.bossEngaged) {
        state.bossEngaged = { name: enemy.label, at: state.time };
      }
    }
    pushDamageEffect(state, enemy.x, enemy.y - enemy.height - 6, applied);
    /*
     * 血之狂暴: while the stance is up his hits draw blood out of the monster,
     * and every landed hit leaves the wound bleeding. Landing the bleed here
     * rather than on each move is what keeps it belonging to the stance instead
     * of to whichever skill happened to swing (docs/adr/0017).
     */
    if (applied > 0 && slayerSwing && state.player.buffs.bloodRage > 0) {
      if (nextRandom(state) < BLOOD_ORB.chance) spawnBloodOrb(state, enemy);
      startBleed(enemy, stanceBleed(state.player));
    }
    /*
     * 魔狱血刹's 铸剑, and it asks the same question the stance's orbs do: *was
     * this his own swing?* A slab that crushes a monster must not forge anybody's
     * sword any more than it may draw blood for the stance, so the gate is
     * `slayerSwing` - the flag the floor and the bleed ticks already clear.
     */
    if (applied > 0 && slayerSwing && state.player.buffs.hellbenter > 0) {
      growSword(state, 1, 0);
      spawnBloodStrand(state, enemy);
    }

    /* Super armour keeps bosses swinging through light hits, DNF style. */
    if (enemy.superArmor && !opts.ignoreSuperArmor) {
      enemy.vx *= 0.6;
    } else {
      var direction = enemy.x >= sourceX ? 1 : -1;
      enemy.vx = direction * knockbackX;
      enemy.hurtTimer = 0.18;
    }

    if (opts.launch) {
      /*
       * **霸体不吃浮空。** 伤害已经在上面结过了，一分不少 —— 但它**挑不起来**，
       * 而且连它的出招都不打断：打断了霸体就白叫霸体。挑不起来的时候在他身上落一句
       * `无法浮空`（`HIT_WORD`），把"为什么这一下没把他挑起来"讲出来。
       *
       * **这是一条玩法上的改动，不只是加一行字**：改之前 上挑 能把 Boss 从它的重踏里
       * 挑出来，改之后只能挨着。业主在 Q17 上要那句话，要的就是这件事 ——
       * 录像里那句话是冲着"这么打没用"说的，所以它得**真的**没用。
       * 带 `ignoreSuperArmor` 的技能（嗜魂之手那两处）不受这条约束：它们本来就是破霸体的。
       */
      if (enemy.superArmor && !opts.ignoreSuperArmor) {
        pushHitWordEffect(state, enemy, HIT_WORD.text);
      } else {
        enemy.vy = opts.launch;
        enemy.onGround = false;
        enemy.attackTimer = 0;
        enemy.knockdown = 0;
      }
    } else if (opts.juggle && !enemy.onGround) {
      /* Keep an airborne target in the air: this is the DNF juggle. */
      enemy.vy = Math.min(enemy.vy, -150);
    }

    if (opts.knockdown) {
      enemy.knockdown = Math.max(enemy.knockdown, opts.knockdown);
      enemy.vy = Math.min(enemy.vy, -170);
      enemy.onGround = false;
      enemy.attackTimer = 0;
    }
    if (opts.stun) {
      enemy.stun = Math.max(enemy.stun, opts.stun);
      enemy.attackTimer = 0;
    }
    if (opts.bleed) startBleed(enemy, opts.bleed);
    if (opts.grabbed) {
      enemy.grabbed = opts.grabbed;
      enemy.knockdown = 0;
      enemy.stun = 0;
      enemy.attackTimer = 0;
      enemy.superArmor = false;
    }

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.dead = true;
      /*
       * 躺 `DEATH.lie` 秒 → 尸体变成**它自己的白色剪影** `smokeLife()` 秒 →
       * 炸成碎块（`docs/adr/0034`）。剪影就是这只怪自己（`enemy.silhouette`），
       * 所以它得留在名单里到数完为止 —— 收尸那一步看 `enemy.dying`。
       */
      enemy.dying = DEATH.lie + smokeLife(enemy);
      state.stats.kills += 1;
      /*
       * A kill is worth more blood than a hit is (docs/adr/0025): the whole body
       * empties into the sword, not one cut's worth. The strand is the same one -
       * a second streak for the same death would be the animation talking, not
       * the rule.
       */
      if (slayerSwing) growSword(state, 0, 1);
      pushBanner(state, enemy.type === "boss" ? "Boss down!" : "Enemy down", 0.9);
      /*
       * **经验改成"捡起来才给"**（业主 2026-10-14，Q12 选 a）：这里只把名牌放到地上，
       * `grantXp` 挪到 `collectLoot` 里 —— 录像里那行 `+40 Exp` 就是名牌被收走那一刻
       * 浮出来的，不是怪倒下的时候。
       */
      dropLoot(state, enemy);
    } else if (enemy.phase2 && enemy.phase < 2 && enemy.hp <= enemy.maxHp * enemy.phase2.hpRatio) {
      enterPhase2(state, enemy);
    }
    return applied;
  }

  /*
   * Hand a skill's ground fire over to the arena.
   *
   * A move whose spec carries a `field` hands its effect over to the arena when
   * the cast ends or a hit cuts it short - anything from `field.from` (the beat
   * its art lands on the floor) onwards has already been drawn on the ground,
   * and the ground is not the caster's. From then on what is burning belongs to
   * the spot it was opened on: the record carries its own clock, so the renderer
   * draws it while he recovers, after the interruption, and after he has walked
   * off and left it. `progress` is the move's own cast progress at the moment of
   * the handover, so the art carries on from the frame it was already on.
   */
  function spawnField(state, skillId, progress, caster) {
    var spec = SKILLS[skillId];
    var field = spec && spec.field;
    if (!field || progress < field.from) return null;
    /*
     * How much of the move's animation the ground still has to play. Normally
     * that is what is left of the cast - the field picks up the art exactly
     * where the caster's own clock was - but a move can declare its own `span`
     * instead, and then the handover is the *first* frame of the field's
     * timeline: 魔狱血刹's volcano is five seconds of ground (slam, crack,
     * column, smoke) behind a 0.6s cast, and none of that five seconds has
     * happened yet when he lets go of it.
     */
    var span = field.span || (1 - field.from) * spec.duration;
    var field_ = {
      skillId: skillId,
      from: field.from,
      /*
       * **Where it opens is not where he stands.** `forward` is the reference's
       * own measurement of how far ahead of him the ground breaks open (魔狱血刹:
       * 1.5 身位), and it is the *spot* - art, anchor and every tick off it - that
       * moves, so the eruption burns where it was opened rather than where he is
       * (see `field.forward`).
       */
      x: caster.x + (caster.facing || 1) * (field.forward || 0),
      y: caster.y,
      /*
       * The depth is part of the spot, not a detail of the caster. A rift opened
       * four Slayer-heights into the screen that starts drawing itself on the
       * ground line the moment the arena takes it over is a rift in the wrong
       * place - and it is the handover, not the cast, that used to lose it.
       */
      z: caster.z || 0,
      facing: caster.facing,
      clock: field.span ? 0 : Math.max(0, (progress - field.from) * spec.duration),
      span: span,
      life: span + field.linger,
      /*
       * The tick clock, and the one thing a field has to remember about its own
       * birth: how far the sword behind it had been forged. 满档的火山比断剑砸出来
       * 的猛 - the same dial the sword's size reads (docs/adr/0025).
       */
      tickAt: field.tick ? field.tick.interval : 0,
      ticks: 0,
      tier: caster.hellbenterTier || 1
    };
    state.fields.push(field_);
    return field_;
  }

  /*
   * 火山: what a field does to whatever is standing in it.
   *
   * A field is ground he opened, so this runs on the field's own clock and not
   * on his - he may be three Slayer-heights away by the time the third tongue
   * comes up, and the thing that hits you is the floor, not him. Only fields
   * whose move declares `field.tick` damage anything; 大蹦's rift is art.
   */
  function updateFieldTicks(state, dt) {
    state.fields.forEach(function (field) {
      var spec = SKILLS[field.skillId];
      var tick = spec && spec.field && spec.field.tick;
      if (!tick || field.clock < 0) return;
      /* The eruption's own window, as fractions of the field's timeline. */
      var at = field.span > 0 ? field.clock / field.span : 1;
      if (at < (tick.from || 0) || at > (tick.until === undefined ? 1 : tick.until)) return;
      field.tickAt -= dt;
      if (field.tickAt > 0) return;
      field.tickAt += tick.interval;
      field.ticks += 1;
      var radius = tick.radius * SLAYER_HEIGHT;
      var last = at >= (tick.until === undefined ? 1 : tick.until) - tick.interval / Math.max(0.0001, field.span);
      /*
       * 满档最猛: the sword's own tier scales every beat, so the same volcano is
       * worth half as much when he slams the 断剑 he never fed.
       */
      var forged = (Math.max(1, Math.min(HELLBENTER.tiers, field.tier)) - 1) /
        Math.max(1, HELLBENTER.tiers - 1);
      var scale = 0.45 + 0.55 * forged;
      state.enemies.slice().forEach(function (enemy) {
        if (enemy.dead) return;
        var dx = enemy.x - field.x;
        var dz = (enemy.z || 0) - (field.z || 0);
        if (dx * dx > radius * radius) return;
        if (Math.abs(dz) > tick.depth * SLAYER_HEIGHT) return;
        var amount = Math.round((tick.damage + (state.player.level - 1) * tick.growth) * scale);
        damageEnemy(state, enemy, amount, 0, field.x, {
          noBloodOrbs: true,
          stun: tick.stun,
          knockdown: last && tick.knockdownLast ? 1.1 : 0
        });
      });
    });
  }

  /** Where a field is in its move's animation, and how far it has faded. */
  function fieldProgress(field) {
    var at = field.span > 0 ? Math.min(1, field.clock / field.span) : 1;
    var tail = field.life - field.span;
    return {
      progress: field.from + (1 - field.from) * at,
      /* The art's own last act is its embers; this is what takes it off screen. */
      fade: tail > 0 && field.clock > field.span
        ? Math.max(0, 1 - (field.clock - field.span) / tail)
        : 1
    };
  }

  /*
   * HP the Slayer spends on himself: 血之狂暴's opening cut and its drain.
   *
   * Deliberately *not* `damagePlayer` - this is not a hit, so it grants no
   * i-frames, no knockback, no 硬直 and no floating number, and `damageTaken`
   * stays a count of what the monsters did rather than of what he did to
   * himself. It can still kill him: the owner's call is that this is the price
   * of the stance and not a fee, so there is no 1 HP floor (docs/adr/0017).
   */
  function spendPlayerHp(state, player, amount) {
    if (player.dead) return 0;
    var spent = Math.max(0, amount);
    player.hp -= spent;
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      state.defeat = true;
    }
    return spent;
  }

  /*
   * 血之狂暴's bill: his own HP, charged for as long as the stance is up. It is
   * a bill and not a bleed - 1% of max HP every ten seconds (docs/adr/0020) -
   * and it does not stop: not between rooms, not standing still. The blood orbs
   * are the only way back up, which is what makes the stance something he has
   * to keep feeding (docs/adr/0017).
   *
   * The countdown lives on the player rather than on the buff record, because a
   * buff is a number of seconds and nothing else. Exactly one buff in the game
   * carries a drain; if a second one ever does, this needs a timer per buff.
   */
  function updateStanceDrain(state, player, dt) {
    var drain = null;
    Object.keys(player.buffs || {}).forEach(function (id) {
      if (!(player.buffs[id] > 0)) return;
      var buff = buffById(id);
      if (buff && buff.drain && buff.drain.interval > 0) drain = buff.drain;
    });
    if (!drain) {
      player.stanceDrainTimer = 0;
      return;
    }
    player.stanceDrainTimer -= dt;
    if (player.stanceDrainTimer <= 0) {
      /*
       * `+= interval` lines the next tick up rather than resetting to it, and
       * the interval has to be *stored* to do that - the bleed learned this one
       * the hard way and ticked exactly once for a week (see `damageEnemy`).
       */
      player.stanceDrainTimer += drain.interval;
      /* The cast's own cut is taken off max HP so it stays the same fraction of
       * the bar as he levels; the bill is charged the same way, for the same
       * reason - it is a share of the stance's price, not a flat number. */
      spendPlayerHp(state, player, (drain.hp || 0) + player.maxHp * (drain.hpRatio || 0));
    }
  }

  function damagePlayer(state, amount, sourceX) {
    var player = state.player;
    if (player.dead || player.invuln > 0) return 0;
    var applied = Math.max(0, Math.round(amount));
    player.hp -= applied;
    state.stats.damageTaken += applied;
    /* 被击数数的是**挨了几下**，不是挨了多少伤害（`docs/adr/0041`）。 */
    state.stats.hitsTaken += 1;
    /*
     * **The biggest *single* hit, kept here rather than worked out by
     * differencing `damageTaken`.** The browser gate asks "is any one hit bigger
     * than the biggest attack the game can deal", and a caller that only samples
     * that running total sees two hits inside one poll window as one bigger hit -
     * a slab and a monster landing together read as a 24 in a game whose largest
     * attack is 22. The game knows what one call was; this is where it says so.
     */
    if (applied > state.stats.maxHitTaken) state.stats.maxHitTaken = applied;
    pushDamageEffect(state, player.x, player.y - player.height - 6, applied);
    player.invuln = PLAYER.invulnAfterHit;
    /*
     * 霸体: a move that carries `superArmor` takes the hit and keeps its feet.
     * No hitstun and no knockback, because either one would end the pose the
     * move is - the reach of 嗜魂之手 has to survive the walk in. The damage,
     * the i-frames and the flash are all exactly the same; only the
     * interruption is off.
     */
    var armored = !!(player.skillId && SKILLS[player.skillId] && SKILLS[player.skillId].superArmor);
    if (!armored) {
      /*
       * 硬直: his own hit recovery, which 血之狂暴 cuts short. It is not 霸体 -
       * he still takes every point of the damage above and is still
       * interrupted here; he just gets his feet back sooner (docs/adr/0018).
       */
      player.hurtTimer = PLAYER.hurtStun * buffScale(player, "hitRecovery");
      player.vx = (player.x >= sourceX ? 1 : -1) * PLAYER.knockbackX;
    }
    player.attackTimer = 0;
    /*
     * A hit cuts the cast short - and the fire he had already opened stays on
     * the floor where he opened it (see spawnField). The knockback above is a
     * velocity, so his x is still the spot he was standing on.
     */
    var interrupted = !armored && player.skillId && SKILLS[player.skillId];
    if (interrupted) {
      spawnField(
        state,
        player.skillId,
        1 - player.skillTimer / interrupted.duration,
        player
      );
    }
    if (!armored) {
      player.skillId = null;
      player.skillTimer = 0;
      player.comboTimer = 0;
    }
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      state.defeat = true;
    }
    return applied;
  }

  function updatePlayer(state, input, dt) {
    var player = state.player;
    if (player.dead) return;

    var direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var rooted = player.attackTimer > 0 || player.skillTimer > 0 || player.hurtTimer > 0;
    var dashing =
      player.skillTimer > 0 && SKILLS[player.skillId] && SKILLS[player.skillId].dash > 0;
    /*
     * A leap keeps its forward speed for the whole hop: the rooted-skill damping
     * otherwise ate the push within four frames and he landed on the spot.
     */
    var leaping =
      player.skillTimer > 0 &&
      SKILLS[player.skillId] &&
      SKILLS[player.skillId].leap > 0 &&
      !player.onGround;
    /* A dive carries its own forward speed down, but only while it is off the
       ground: once it lands the carry is gone (see the touchdown handling). */
    var divingDown =
      player.skillTimer > 0 &&
      SKILLS[player.skillId] &&
      SKILLS[player.skillId].dive > 0 &&
      !player.onGround;
    /*
     * Turning is the one thing a cast takes away that left and right can still
     * ask for, so it needs saying out loud: **a skill locks the facing it was
     * started with, for the whole cast**. Everything else about the cast was
     * already gated (movement, jump, attack, a second skill); the facing was the
     * leak, and it was not only a picture - the renderer mirrors the effect art
     * off the live facing, the per-hit box is built from it, and the leap reads
     * it at the beat it fires. So a press of the opposite arrow mid-move turned
     * the rift, flipped which side it damaged, and could throw the hop backwards.
     *
     * Normal attacks are deliberately **not** locked: they are a short chain and
     * DNF lets him turn between its hits (the same reason `attackDir` used to
     * exist here - it was written and never read, so it is gone rather than
     * left to look like a lock).
     */
    if (direction !== 0 && player.skillTimer <= 0) player.facing = direction;
    /*
     * Depth moves like width does, out of the same rooted/dashing/leaping state,
     * with three differences that are all deliberate:
     *
     *   - it never touches `facing`. He keeps facing left or right while he
     *     walks into or out of the screen, which is what the client does, and
     *     turning is still something only left and right can ask for;
     *   - it is tuned as a screen speed rather than a floor speed, because the
     *     depth axis is foreshortened (see PHYSICS.depthSpeedRatio);
     *   - it stops at the edges of the room's own band, not at a wall.
     *
     * A leap keeps its depth the way it keeps its width: the rooted branch damps
     * rather than clears, so a hop cast while walking into the screen carries
     * that push, exactly as it carries a run.
     */
    var depthDirection = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    var carrying = rooted && !dashing && !leaping && !divingDown;
    if (carrying) {
      player.vx *= 0.25;
      player.vz *= 0.25;
    } else if (!rooted) {
      /* 暴走's move speed covers both axes: it is a run, not a ground slide. */
      var moveScale = buffScale(player, "moveSpeed");
      player.vx = direction * PHYSICS.moveSpeed * moveScale;
      player.vz = depthDirection * depthSpeed() * moveScale;
    }

    if (input.jump && player.onGround && !rooted) {
      player.vy = PHYSICS.jumpVelocity;
      player.onGround = false;
    }

    if (!player.onGround) {
      /*
       * A leap may bring its own fall gravity. 崩山击's arc is the client
       * preview's - ~250px up, back down inside 0.67s - and the global 2200
       * cannot do both (250px at 2200 hangs for 0.95s). This is the only use of
       * a per-skill gravity: every other move keeps PHYSICS.gravity.
       */
      var leapGravity =
        leaping && SKILLS[player.skillId].leapGravity
          ? SKILLS[player.skillId].leapGravity
          : PHYSICS.gravity;
      player.vy = Math.min(player.vy + leapGravity * dt, PHYSICS.maxFallSpeed);
      /*
       * 银光落刃 drops straight down rather than arcing: once it is cast the
       * dive speed overrides gravity, so the blade lands where the player let
       * go instead of drifting forward with the rest of the hop.
       */
      var diving = player.skillTimer > 0 && SKILLS[player.skillId] && SKILLS[player.skillId].dive;
      if (diving) {
        player.vy = Math.max(player.vy, SKILLS[player.skillId].dive);
        /* Keep the dive's own forward carry rather than damping it away. */
        if (player.vx === 0) player.vx = player.facing * (SKILLS[player.skillId].diveForward || 0);
      }
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;

    if (player.y >= ARENA.groundY) {
      player.y = ARENA.groundY;
      player.vy = 0;
      player.onGround = true;
      /*
       * 银光落刃 stops dead on touchdown: the dive carries him forward through
       * the air, but the owner's read is that he must not keep rushing along the
       * floor once the blade is in it.
       */
      var landedDive =
        player.skillTimer > 0 && SKILLS[player.skillId] && SKILLS[player.skillId].dive;
      if (landedDive) player.vx = 0;
    }
    player.x = clamp(
      player.x,
      roomLeft(state) + player.width / 2,
      roomRight(state) - player.width / 2
    );
    /*
     * And the band's two edges stop him the way the walls do. The front edge is
     * where the camera is and the back edge is the wall behind the room, so both
     * are hard limits: he is held against them rather than slid along them.
     */
    player.z = clamp(player.z, 0, bandDepth(state.band));
    /*
     * 实心布景（木桶）最后说话：它推人，墙推不动它。纵深那一半用 `width / 2`，
     * 和 `separateEnemies` 同一个读法 —— 一个身体"占多深"就是"占多宽"。
     */
    blockProps(state, player, player.width / 2, player.width / 2);

    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.solidInvuln = Math.max(0, (player.solidInvuln || 0) - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.comboTimer = Math.max(0, player.comboTimer - dt);
    player.airHitTimer = Math.max(0, player.airHitTimer - dt);
    Object.keys(player.buffs).forEach(function (id) {
      player.buffs[id] = Math.max(0, player.buffs[id] - dt);
    });
    /* The buff's cast icon is its own short clock, not the buff's own. */
    player.buffIconTimer = Math.max(0, (player.buffIconTimer || 0) - dt);
    updateStanceDrain(state, player, dt);
    if (player.comboTimer === 0) player.comboIndex = 0;
    player.mp = Math.min(player.maxMp, player.mp + player.mpRegen * dt);

    /*
     * Cooldowns run faster under a buff that says so. This reads the buff's own
     * `cooldownScale` field now - it used to be a literal 1.4 nailed to
     * bloodRage, which meant the buff declared a number that nothing read and a
     * second buff could not have shortened a cooldown at all (docs/adr/0017).
     */
    var cooldownScale = buffScale(player, "cooldownScale");
    CASTABLE_SKILLS.forEach(function (skillId) {
      player.skillCooldowns[skillId] = Math.max(
        0,
        player.skillCooldowns[skillId] - dt * cooldownScale
      );
    });

    /* DNF combo flow: normal attacks can be cancelled into a skill during recovery. */
    var attackRecovering =
      player.attackTimer > 0 &&
      player.attackDuration - player.attackTimer >=
        PLAYER.attackActiveTo * player.attackDuration;

    /*
     * Z is 上挑 on the ground and 银光落刃 in the air, so the air case is decided
     * before the bar is consulted: off the ground that key never reaches the
     * up-slash (nor is it held back by the up-slash's own cooldown - they are
     * different moves with different timers).
     */
    var wantsAirDive =
      !!input.skills.upSlash &&
      !player.onGround &&
      player.skillTimer <= 0 &&
      (player.attackTimer <= 0 || attackRecovering) &&
      player.skillCooldowns.silverFall <= 0 &&
      player.mp >= SKILLS.silverFall.mp;
    /*
     * **魔狱血刹's key casts one of two moves, and the state decides which**
     * (docs/adr/0025). While the sword is on his back the key brings it down;
     * with nothing on his back it raises one. And the third way in is the clock:
     * the fifty seconds running out arms the fall by itself, because the sword
     * never simply vanishes - that is read off the pair of fields rather than off
     * an edge, so a fall that arrives while he is mid-swing waits for the swing
     * to end instead of being dropped.
     */
    var swordUp = player.buffs.hellbenter > 0;
    var swordDue = !swordUp && (player.hellbenterTier || 0) > 0;
    var hellbenterMove = swordUp || swordDue ? "hellbenterSlam" : "hellbenter";
    var wantsHellbenter =
      (!!input.skills.hellbenter || swordDue) &&
      player.skillTimer <= 0 &&
      (player.attackTimer <= 0 || attackRecovering) &&
      player.skillCooldowns[hellbenterMove] <= 0 &&
      player.mp >= SKILLS[hellbenterMove].mp;
    var castSkill = wantsAirDive
      ? "silverFall"
      : wantsHellbenter
      ? hellbenterMove
      : SKILL_ORDER.filter(function (skillId) {
      var spec = SKILLS[skillId];
      return (
        input.skills[skillId] &&
        player.skillTimer <= 0 &&
        (player.attackTimer <= 0 || attackRecovering) &&
        player.skillCooldowns[skillId] <= 0 &&
        player.mp >= spec.mp
      );
    })[0];

    /*
     * Taking a toggle stance down is instant and free: no MP, and none of the
     * 0.5s of standing still that raising it costs. Dropping 血之狂暴 is what
     * you do when its price is about to kill you, so it cannot be the more
     * expensive half. It still pays the move's cooldown - a held slot key
     * re-casts the moment it is allowed to (input is `held || pressed`), and
     * without the cooldown a held key would flip the stance on and off.
     */
    if (castSkill) {
      var skillSpec = SKILLS[castSkill];
      /*
       * **Taking a toggle stance down is free, but it is not instant and it is
       * not silent.** The owner's read is that the way out has to look like the
       * way in (「关掉的血之狂暴的技能的特效也要跟开一样」), so the same cast
       * plays and the same art goes off; the only difference is that the state
       * comes *down* where the arrow lands, which the hit loop decides.
       *
       * It still pays the move's cooldown, which is what stops a held key from
       * flipping the stance on and off - a held slot key re-casts the moment it
       * is allowed to (input is `held || pressed`).
       */
      var stanceComingDown = !!(
        skillSpec.buff &&
        skillSpec.buff.toggle &&
        player.buffs[skillSpec.buff.id] > 0
      );
      if (!stanceComingDown) player.mp -= skillSpec.mp;
      player.skillId = castSkill;
      /*
       * **只有能打的招算一次出手。** 血之狂暴与暴走是纯架势（`buff`），既没有判定
       * 也命中不了任何东西，记进去只会把"操作"那一行白白往下拖（`docs/adr/0041`）。
       */
      if (!skillSpec.buff) {
        state.swingSeq += 1;
        state.stats.swings += 1;
      }
      /*
       * **Where he pressed the key.** A move that carries him states its own
       * position each frame from this point (`advanceAhead`), and a move whose
       * art is nailed to the ground - 十字斩's cross - is drawn from it too
       * (`anchor: "cast"` in the renderer). Read once, here, so neither of them
       * has to guess where "here" was after he has already moved off it.
       */
      player.castOriginX = player.x;
      player.skillTimer = skillSpec.duration;
      player.skillHitDone = false;
      /* Every cast gets its own ground to open - see `field.at`. */
      player.fieldSpawned = false;
      player.skillHitsDone = 0;
      player.channelReleasedAt = null;
      player.channelTickAt = skillSpec.channel ? skillSpec.channel.entrance : 0;
      player.skillCooldowns[castSkill] = skillSpec.cooldown;
      /*
       * 无敌 from the press, for a move that asks for it. `invuln` used to only
       * ever start on a *hit* (血魔's "flash through the target", whose first
       * hit is a frame after the press anyway), which cannot cover the reach of
       * a grab: the thing that ends 嗜魂之手 is a monster landing on him while
       * his hand is still going out. The owner asked for it by name -
       * 「这个技能要无敌」.
       *
       * `solidInvuln` rides along for 大蹦's reason: a whole second of i-frames
       * would otherwise blink him, and nothing in the reference blinks.
       */
      if (skillSpec.invuln) {
        player.invuln = Math.max(player.invuln, skillSpec.invuln);
        player.solidInvuln = Math.max(player.solidInvuln || 0, skillSpec.invuln);
      }
      player.attackTimer = 0;
      player.attackHitDone = false;
      player.comboTimer = 0;
      player.comboIndex = 0;
      player.leapDone = false;
      /* A dive starts falling the moment it is cast, not a frame later. */
      if (skillSpec.dive && !player.onGround) {
        player.vy = Math.max(player.vy, skillSpec.dive);
        /* ... and it lands ahead of the take-off, not under it. */
        if (skillSpec.diveForward) player.vx = player.facing * skillSpec.diveForward;
      }
    } else if (
      input.attack &&
      player.attackTimer <= 0 &&
      player.skillTimer <= 0 &&
      /*
       * **A chain press may come during the recovery.** The cooldown exists to
       * stop a *fresh* press being spammed; it is not meant to put a gap between
       * two cuts of one chain, and the owner heard that gap the moment the
       * stance's swings got long: 「三个动作之间连贯性不好，感觉停了好久」 -
       * a 0.44s swing followed by 0.32s of standing still. The combo timer is
       * what says the chain is still alive, so a press inside it is taken as
       * soon as the swing is over; once it lapses the cooldown still gates the
       * next press exactly as before.
       */
      (player.attackCooldown <= 0 || player.comboTimer > 0)
    ) {
      var nextStage = player.comboTimer > 0 ? (player.comboIndex + 1) % PLAYER.maxCombo : 0;
      player.attackDuration = swingDuration(player);
      player.attackTimer = player.attackDuration;
      /* 一次出手（`docs/adr/0041` 的操作那一行）。 */
      state.swingSeq += 1;
      state.stats.swings += 1;
      /*
       * The animation owns the whole cycle, not just the swing: the renderer
       * spreads the cut's frames over swing + recovery, so a cut stays one
       * continuous motion while the player is still free to move through the
       * recovery. Ending the animation at the swing and dropping back to idle
       * there is what made the chain look chopped into pieces.
       */
      player.attackCycle = player.attackDuration + PLAYER.attackCooldown / attackSpeedOf(player);
      player.attackCooldown = player.attackCycle;
      player.comboIndex = nextStage;
      /*
       * **The combo window scales with the swing, or a slow swing never chains.**
       * It was a flat `PLAYER.comboWindow` (0.45s). That is longer than a normal
       * cut (0.22s) so it never showed, and the moment 血之狂暴 slowed his swing
       * to 0.44s it showed on every one of them: the window expired while the
       * cut was still playing, `comboIndex` never left 0, and the stance's
       * animation - 22 frames carrying three swings - only ever played its first
       * eight. The owner read exactly that: 「是不是少动作了」.
       */
      player.comboTimer = PLAYER.comboWindow / attackSpeedOf(player);
      player.attackHitDone = false;
    }

    if (player.attackTimer > 0) {
      var elapsed = player.attackDuration - player.attackTimer;
      if (
        !player.attackHitDone &&
        elapsed >= PLAYER.attackActiveFrom * player.attackDuration &&
        elapsed <= PLAYER.attackActiveTo * player.attackDuration
      ) {
        player.attackHitDone = true;
        var box = attackBox(player, PLAYER.attackReach, PLAYER.attackHeightPad);
        /* 这一下也扫布景：木桶只有他打得碎（`swingProps`）。 */
        swingProps(state, box);
        /* 暴走's attack power lifts the normal chain too, not just skills. */
        var damage = Math.round(
          (PLAYER.comboDamage[player.comboIndex] + player.attackBonus) *
            buffScale(player, "attackPower")
        );
        state.enemies.slice().forEach(function (enemy) {
          if (enemy.dead) return;
          if (inReachOf(enemy.z, player.z) && boxesOverlap(box, bodyBox(enemy))) {
            var wasAirborne = !enemy.onGround;
            damageEnemy(state, enemy, damage, 140, player.x, { juggle: true });
            if (!enemy.dead && wasAirborne) {
              state.stats.airHits += 1;
              player.airHitTimer = 0.6;
            }
          }
        });
      }
      player.attackTimer = Math.max(0, player.attackTimer - dt);
    }

    if (player.skillTimer > 0) {
      var active = SKILLS[player.skillId];
      var skillElapsed = active.duration - player.skillTimer;
      var hitCount = active.hits || 1;

      /*
       * The hop is its own beat, not a side effect of the hit: it fires once the
       * raise is done and the blade only connects when he comes down. It has to
       * run outside the hit loop, which only wakes up on the active window.
       */
      if (
        active.leap &&
        !player.leapDone &&
        player.onGround &&
        skillElapsed >= active.duration * (active.leapFrom || 0)
      ) {
        player.leapDone = true;
        player.vx = player.facing * active.leap;
        player.vy = Math.min(player.vy, active.leapUp || -160);
        player.onGround = false;
        /* DNF's 崩山击 is invulnerable once it is committed to the leap. */
        player.invuln = Math.max(player.invuln, active.leapInvuln || 0.3);
        /*
         * ... and that window does not blink. The client's own preview holds him
         * solid through the hop - the whole move is one pose sequence and the
         * flicker broke it up - so the leap's window is marked solid. A real hit
         * that outlasts it still flashes: only `invuln` past this timer blinks.
         */
        player.solidInvuln = Math.max(player.solidInvuln || 0, active.leapInvuln || 0.3);
      }

      /*
       * **A move can open its ground before it lets go.** 魔狱血刹's 落 holds him
       * for the whole eruption now (5.4s), so the volcano cannot wait for the
       * cast to end - `field.at` is the *time into the cast* it opens on (0.6s)
       * and the field's own clock starts there, exactly as it did when the two
       * coincided at the cast's end.
       *
       * `1` and not `active.field.at`: the third argument is a progress of the
       * **move's timeline**, which the field compares against its own `from` (the
       * column it takes the row over at, 8/59) - a progress of the *cast* is a
       * different number and would be refused for being too early.
       */
      if (
        active.field &&
        active.field.at !== undefined &&
        !player.fieldSpawned &&
        skillElapsed >= active.field.at
      ) {
        player.fieldSpawned = true;
        spawnField(state, active.id, 1, player);
      }

      /*
       * **拍完剑就不在背后了。** 业主：「拍后背后没有剑了」——参考里第二下把剑送进地里
       * 之后，他背后那把就没了（11_魔狱血刹 0:08 那一段，他周围只剩火山，身上是空的）。
       * 原来这条只写在**施法结束**那一支里，所以整整 5.4 秒的喷发期间他还背着一把剑，
       * 剑和火山同时在屏幕上。
       *
       * 挂在 `activeFrom` 上而不是 `field.at`：`field.at`（0.6）是地面裂开、火山起来
       * 的那一瞬，而剑是**抡下去**的那一下离开他手的，那一下是 0.22。
       */
      if (active.id === "hellbenterSlam" && player.buffs.hellbenter > 0 &&
          skillElapsed >= active.activeFrom) {
        player.buffs.hellbenter = 0;
      }

      /*
       * **He can be carried by his own move.** A cast normally locks him to the
       * spot; 十字斩 is the one that walks him forward and back (see its own
       * `advance`/`advanceAt`/`advanceBack` and `docs/adr/0012`), and the step is
       * driven off the cast's clock rather than off `vx` - the rooted damping
       * would smear a 0.06s step into a long slide, and walls and bodies would
       * chop it up on the way. So his x is *stated* for each frame of the move,
       * from the spot he pressed the key on.
       */
      if (active.advance) {
        player.x = player.castOriginX + player.facing * advanceAhead(active, skillElapsed);
      }

      /*
       * **Letting go.** After the entrance, the frame the key stops being held is
       * the frame the tail starts, and the tail is a fixed 0.767s however long the
       * vortex ran (`docs/adr/0023`). Read off `input.skills` rather than a new
       * field because both input paths already carry "still down" there: the
       * keyboard through `held || pressed`, the touch bar through `held[slot]`
       * until `pointerup` (src/main.js).
       */
      if (active.channel && player.channelReleasedAt === null) {
        /*
         * **Letting go, and the cap letting go for him.** ADR 0023 says holding
         * all the way to 3.133s ends the cast by itself - 「不松手到 3.133s 自动收」
         * - and that is also the only case the reference clip shows: its own cast
         * holds the full steady stretch and cuts at 4.300s. The code used to wait
         * for `input.skills` alone, so a player who never lifted his finger got no
         * ending at all: the sprite played the tail while the effect kept drawing
         * the entrance's column, and `hitTime` stayed Infinity, so the finisher's
         * cut never landed either. Releasing at the cap costs no time - the cast
         * has exactly `tail` seconds left there - it only records that the tail
         * has started.
         */
        var cap = active.channel.entrance + active.channel.hold;
        if (skillElapsed >= active.channel.entrance && (!input.skills[active.id] || skillElapsed >= cap)) {
          player.channelReleasedAt = skillElapsed;
          player.skillTimer = active.channel.tail;
        } else if (skillElapsed >= active.channel.entrance) {
          channelPull(state, active, player, dt);
          /*
           * The vortex's ticks, on the reference's own 0.300s beat. This is not
           * the hit loop below: how many there are depends on how long the player
           * holds, and `hits`/`hitAt` describe a fixed list.
           */
          var holdEnd = Math.min(skillElapsed, active.channel.entrance + active.channel.hold);
          while (player.channelTickAt <= holdEnd) {
            channelTick(state, active, player);
            player.channelTickAt += active.channel.tick;
          }
        }
      }

      while (
        player.skillHitsDone < hitCount &&
        skillElapsed >= hitTime(active, player.skillHitsDone, player)
      ) {
        var hitIndex = player.skillHitsDone;
        player.skillHitsDone += 1;
        player.skillHitDone = player.skillHitsDone >= hitCount;

        var skillBox = attackBox(player, active.reach, active.heightPad);
        swingProps(state, skillBox, active.depthReach);
        if (active.buff) {
          /*
           * A buff skill pays its price and goes up; it does not swing.
           *
           * 血之狂暴 is a stance, so the same beat either raises it or takes it
           * down depending on which way it is already pointing - and it does the
           * whole ceremony either way, because the owner's read is that the way
           * out has to look like the way in.
           */
          var alreadyUp = player.buffs[active.buff.id] > 0;
          if (active.buff.toggle && alreadyUp) {
            player.buffs[active.buff.id] = 0;
            pushBanner(state, active.name + " 解除", 1.1);
          } else {
            /*
             * The opening cut, taken off max HP rather than as a flat number so
             * it stays the same fraction of the bar as he levels - 17.5% is how
             * the reference reads (07_血之狂暴 #44: the orb drops 14px with the
             * white loss band showing).
             */
            if (active.buff.open && active.buff.open.hpRatio) {
              spendPlayerHp(state, player, player.maxHp * active.buff.open.hpRatio);
            }
            player.buffs[active.buff.id] = active.buff.duration;
            /*
             * 魔狱血刹's 血气之剑 comes up with the buff and rides next to it: the
             * tier is how far it has been forged (1..8, grown by hits in the next
             * slice) and `player.buffs` has no room for it - it carries seconds.
             * A tier of 1 is the sword the reference shows at the cast, 0.71 of
             * a Slayer-height, and `swordTier` is what raises it.
             */
            if (active.buff.swordTier) player.hellbenterTier = active.buff.swordTier;
            if (active.buff.swordTier) player.hellbenterCharge = 0;
            /* The drain's first tick is a full interval away, not this frame. */
            if (active.buff.drain && active.buff.drain.interval) {
              player.stanceDrainTimer = active.buff.drain.interval;
            }
            /*
             * A timed buff announces itself with a short icon over his head. The
             * stance does not: its read is the red body and the lit slot on the
             * hotbar, and both of those are up for as long as it is.
             */
            if (active.castIcon) {
              player.buffIconTimer = active.castIcon;
              player.buffIconId = active.id;
            }
            if (active.buff.toggle) {
              pushBanner(state, active.name, 1.1);
            }
          }
          /*
           * The second beat goes off either way - it is the ceremony's, not the
           * state's. It is queued here so it lands on the stance's own clock
           * rather than the cast's, and drawn after him (see drawRageGather), so
           * it reads as gathering in his hand rather than as another burst off
           * his body.
           */
          if (active.buff.gather) {
            var gather = active.buff.gather;
            state.effects.push({
              kind: "rageGather",
              delay: gather.delay,
              life: gather.delay + gather.life,
              maxLife: gather.delay + gather.life
            });
          }
        }
        var skillDamage = Math.round(
          (active.damage + (player.level - 1) * active.growth + player.attackBonus) *
            player.skillPower *
            buffScale(player, "attackPower")
        );
        var struck = [];
        if (active.shot && hitIndex === active.shot.hit) {
          /*
           * This cut's box is not on his hands, so there is nothing to test
           * here: the qi leaves him and `updateShots` carries it from now on.
           * See `spawnShot` and the skill's own `shot`.
           */
          spawnShot(state, active.id, skillDamage, hitIndex);
        } else {
          state.enemies.slice().forEach(function (enemy) {
            if (enemy.dead) return;
            /*
             * A radial move is a disc lying on the floor, so depth is part of its
             * distance - and it is the same circle the renderer squashes by
             * DEPTH.scale, which is why there is only one of that constant. Every
             * other move is a box plus the depth reach its own spec asks for.
             */
            if (active.radius > 0 && floorDistance(enemy, player) <= active.radius) {
              applySkillHit(state, enemy, skillDamage, active, hitIndex);
              struck.push(enemy.id);
            } else if (
              active.radius <= 0 &&
              inReachOf(enemy.z, player.z, active.depthReach) &&
              boxesOverlap(skillBox, bodyBox(enemy))
            ) {
              applySkillHit(state, enemy, skillDamage, active, hitIndex);
              struck.push(enemy.id);
            }
          });
        }

        /*
         * Which hit carries the ground wave: the last one by default (the usual
         * shape - the move ends on its heaviest blow), but 崩山裂地斩 splits its
         * hits across the landing and the two eruptions, and its wave belongs to
         * the sword, not to the last tick.
         */
        var waveHit = active.shockwaveHit === undefined ? hitCount - 1 : active.shockwaveHit;
        if (active.shockwave && hitIndex === waveHit) {
          var wave = active.shockwave;
          var extraWave =
            wave.extraWaveFromLevel && player.level >= wave.extraWaveFromLevel ? 1 : 0;
          var waveBox = attackBox(
            player,
            wave.reach + extraWave * 80,
            wave.heightPad + extraWave * 6
          );
          swingProps(state, waveBox, active.depthReach);
          var waveDamage = Math.round(
            (wave.damage + (player.level - 1) * wave.growth + player.attackBonus) *
              player.skillPower
          );
          state.enemies.slice().forEach(function (enemy) {
            if (enemy.dead || struck.indexOf(enemy.id) !== -1) return;
            if (inReachOf(enemy.z, player.z, active.depthReach) && boxesOverlap(waveBox, bodyBox(enemy))) {
              var waveOptions = {};
              if (wave.knockdown) waveOptions.knockdown = wave.knockdown;
              if (wave.launch) {
                waveOptions.launch = wave.launch;
                waveOptions.juggle = true;
              }
              damageEnemy(state, enemy, waveDamage, wave.knockbackX, player.x, waveOptions);
            }
          });
          state.effects.push({
            kind: "shockwave",
            /*
             * Most waves draw the ring the engine gives them; a skill can set
             * `arc: false` to keep the hitbox and the screen shake but drop the
             * ellipse. 崩山击 does (see its spec): the reference shows the fire
             * column and the spikes, never a ring.
             */
            arc: wave.arc === undefined ? true : wave.arc,
            /*
             * Where the drawn arc sits: a fraction of the wave's reach out in
             * front of the caster. 崩山击's wave travels forward, so its arc is
             * drawn a little ahead of him; 大蹦's rift opens *around* him, and
             * its arc has to be the same circle as the fire that comes out of
             * it - 144px out in front it read as a second ring lying beside the
             * flames (owner: 「圈和火焰没合在一起」).
             */
            x: player.x + player.facing * wave.reach *
              (wave.arcOffset === undefined ? 0.4 : wave.arcOffset),
            y: ARENA.groundY,
            /* The ring is a circle on the floor, so it lies where he cast it. */
            z: player.z || 0,
            /* `visual` is how wide the arc is drawn, not how far the wave hits. */
            radius:
              (wave.reach + extraWave * 80) * 0.8 * (wave.visual === undefined ? 1 : wave.visual),
            life: 0.4,
            maxLife: 0.4
          });
        }

        if (active.dash && hitIndex === 0) {
          /* 血魔: flash forward and shrug off hits while doing it. */
          player.vx = player.facing * active.dash;
          player.invuln = Math.max(player.invuln, active.invuln || 0.3);
        }
        if (active.invuln && hitIndex === 0) {
          player.invuln = Math.max(player.invuln, active.invuln);
        }

        if (active.id === "bloodSword") {
          state.effects.push({
            kind: "ghost",
            x: player.x + player.facing * active.reach * (0.4 + hitIndex * 0.2),
            y: player.y - player.height * 0.55,
            radius: active.reach * 0.55,
            life: 0.35,
            maxLife: 0.35
          });
        }
      }
      player.skillTimer = Math.max(0, player.skillTimer - dt);
      if (player.skillTimer === 0) {
        /*
         * A move that carried him puts him back on the exact spot he pressed the
         * key on. The last frame of a cast lands *short* of progress 1 - the
         * timer hits zero between frames - so the recovery's own curve would
         * leave him a couple of px forward of where he started, every time, for
         * good. The clip has him back on 761 too (`docs/adr/0012`).
         *
         * Only on a cast that ran to its end: an interrupted one leaves him
         * wherever the step had got to, which is what being interrupted means.
         */
        if (active.advance && player.castOriginX !== undefined) {
          player.x = player.castOriginX;
        }
        /*
         * The cast is over but the ground is not: whatever it opened goes on
         * burning where it is, which is how the reference ends - him on his
         * feet at 3.97s with the cracks still lit.
         */
        if (!player.fieldSpawned) spawnField(state, active.id, 1, player);
        /*
         * **魔狱血刹's sword goes into the ground here, and both halves of the
         * state go with it.** The tier is what the gate reads to know the move is
         * over, and the buff is what the *renderer* reads to know the sword is on
         * his back - clear one and not the other and the sword is drawn for
         * another forty seconds after it has been put down. (The two are only
         * out of step in one place, which is deliberate: the clock running out
         * leaves the buff at 0 and the tier up, and that gap is what arms the
         * fall - see the gate.)
         */
        if (active.id === "hellbenterSlam") {
          player.hellbenterTier = 0;
          player.hellbenterCharge = 0;
          player.buffs.hellbenter = 0;
        }
        player.skillId = null;
      }
    }
  }

  /**
   * One beat of 嗜魂封魔斩's vortex: whatever it has hold of takes a small hit and
   * is held still for the beat.
   *
   * **Neither this nor the pull below could be measured.** The reference's
   * training room has no monsters in it - the vortex churns over bare floor for
   * three seconds - so what it *does* to an enemy is the owner's ruling (Q4) and
   * the numbers are ours. The beat it lands on is not ours: 0.300s is what the
   * steady stretch autocorrelates to (assets/dnf_effect_picks.md §25).
   */
  function channelTick(state, skill, player) {
    var channel = skill.channel;
    var box = attackBox(player, skill.reach, skill.heightPad);
    var damage = Math.round(
      (channel.tickDamage +
        (player.level - 1) * (channel.tickGrowth || 0) +
        player.attackBonus) *
        player.skillPower *
        buffScale(player, "attackPower")
    );
    state.enemies.slice().forEach(function (enemy) {
      if (enemy.dead) return;
      if (!inReachOf(enemy.z, player.z, skill.depthReach)) return;
      if (!boxesOverlap(box, bodyBox(enemy))) return;
      /*
       * No knockback and no launch: the point of the vortex is that what it
       * catches *stays* in it. The hit goes through `damageEnemy`, so the stance's
       * own hooks - bleed, the blood orb, the miss - ride along without this
       * function knowing about any of them.
       */
      damageEnemy(state, enemy, damage, 0, player.x, { stun: channel.tick });
    });
  }

  /**
   * The vortex's drag, one frame at a time.
   *
   * It moves the enemy rather than setting `vx`, for the reason the caster's own
   * `advance` states his position rather than pushing him (`docs/adr/0012`): the
   * step is small and every frame, and an impulse that short is eaten by the
   * grounded damping before it ever shows on screen. `stopAt` is what keeps the
   * vortex from swallowing its catch - it pulls them to the near end and no
   * closer, so they are still in front of him when the finisher lands.
   */
  function channelPull(state, skill, player, dt) {
    var channel = skill.channel;
    var box = attackBox(player, skill.reach, skill.heightPad);
    var step = channel.pull * dt;
    state.enemies.slice().forEach(function (enemy) {
      if (enemy.dead) return;
      if (!inReachOf(enemy.z, player.z, skill.depthReach)) return;
      if (!boxesOverlap(box, bodyBox(enemy))) return;
      var gap = player.x - enemy.x;
      var distance = Math.abs(gap) - channel.stopAt;
      if (distance <= 0) return;
      enemy.x += (gap < 0 ? -1 : 1) * Math.min(distance, step);
      enemy.vx = 0;
    });
  }

  function applySkillHit(state, enemy, damage, skill, hitIndex) {
    var options = {};
    var lastHit = hitIndex === (skill.hits || 1) - 1;

    if (skill.grab && hitIndex === 0) {
      options.grabbed = skill.grab.hold;
      options.ignoreSuperArmor = true;
    } else if (skill.grab && lastHit) {
      options.knockdown = skill.grab.slamKnockdown;
      options.ignoreSuperArmor = true;
    } else if (skill.juggle && skill.launch) {
      options.launch = skill.launch;
      options.juggle = true;
    } else if (skill.knockdown && lastHit) {
      /*
       * 银光落刃 only has a *chance* of flooring what it lands on, the way the
       * client's own skill does. The roll comes off the state RNG, so a seed
       * still replays exactly.
       */
      if (!skill.knockdownChance || nextRandom(state) < skill.knockdownChance) {
        options.knockdown = skill.knockdown;
      }
    }
    if (skill.stun) options.stun = skill.stun;
    /*
     * No bleed here, and no `skill.bleed` field anywhere: 出血 belongs to
     * 血之狂暴 alone and is landed inside `damageEnemy` for every hit he lands,
     * whichever move it came from (docs/adr/0017).
     */

    var wasAirborne = !enemy.onGround;
    damageEnemy(state, enemy, damage, skill.knockbackX, state.player.x, options);
    if (skill.drain && damage > 0) {
      var healed = Math.round(damage * skill.drain);
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + healed);
      if (healed > 0) {
        state.effects.push({
          kind: "heal",
          text: "+" + healed + " HP",
          x: state.player.x,
          y: state.player.y - state.player.height - 10,
          life: 0.8,
          maxLife: 0.8
        });
      }
    }
    if (!enemy.dead && wasAirborne) {
      state.stats.airHits += 1;
      state.player.airHitTimer = 0.6;
    }
  }

  /*
   * A monster's own floor marks - the ground it is about to slam, and the ring
   * the slam leaves. Both are on the floor under *it*, so both carry its depth:
   * a monster standing four Slayer-heights in has to slam four Slayer-heights in,
   * and the ring has to land around its feet rather than at the front edge of
   * the room. Nothing places a monster at a depth yet (that is slice 5), which is
   * why this reads as a no-op today and stops being one the moment something does.
   */
  function pushTelegraph(state, enemy, label, radius, life, dir) {
    state.effects.push({
      kind: "telegraph",
      text: label,
      x: enemy.x,
      y: ARENA.groundY,
      z: enemy.z || 0,
      radius: radius || 0,
      dir: dir || 0,
      life: life,
      maxLife: life
    });
  }

  function pushShockwave(state, enemy) {
    state.effects.push({
      kind: "shockwave",
      x: enemy.x,
      y: ARENA.groundY,
      z: enemy.z || 0,
      radius: enemy.slam.radius,
      life: 0.45,
      maxLife: 0.45
    });
  }

  function spawnProjectile(state, enemy) {
    var spec = enemy.projectile;
    if (!spec) return null;
    var target = state.player;
    var originX = enemy.x + enemy.facing * (enemy.width / 2 + 2);
    var originY = enemy.y - spec.height;
    var dx = target.x - originX;
    var dy = target.y - target.height / 2 - originY;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    var shot = {
      kind: "enemy_projectile",
      id: state.nextProjectileId++,
      x: originX,
      y: originY,
      /*
       * A shot keeps the depth it was fired from for its whole flight, so the
       * `y` tests that end it on the floor stay exactly as they were: a body's
       * height and a body's depth are different questions.
       */
      z: enemy.z || 0,
      vx: (dx / length) * spec.speed,
      vy: (dy / length) * spec.speed,
      radius: spec.radius,
      damage: enemy.damage,
      life: spec.life,
      maxLife: spec.life,
      traveled: 0,
      maxDistance: spec.maxDistance
    };
    state.projectiles.push(shot);
    return shot;
  }

  function updateProjectiles(state, dt) {
    var player = state.player;
    var remaining = [];

    state.projectiles.forEach(function (shot) {
      shot.life -= dt;
      var stepX = shot.vx * dt;
      var stepY = shot.vy * dt;
      shot.x += stepX;
      shot.y += stepY;
      shot.traveled += Math.sqrt(stepX * stepX + stepY * stepY);

      var spent =
        shot.life <= 0 ||
        shot.traveled >= shot.maxDistance ||
        shot.x <= roomLeft(state) ||
        shot.x >= roomRight(state) ||
        shot.y >= ARENA.groundY;
      if (spent) return;

      var nearPlayer =
        Math.abs(shot.x - player.x) <= player.width / 2 + shot.radius &&
        Math.abs(shot.y - (player.y - player.height / 2)) <= player.height / 2 + shot.radius &&
        /*
         * A shot keeps the depth it was fired from (see spawnProjectile) and
         * travels no closer to the camera, so depth is one more way to not be
         * standing where it is going: the same slack the x test uses, because a
         * body's width is as good a reading of its footprint on the floor as any.
         */
        Math.abs((shot.z || 0) - (player.z || 0)) <= player.width / 2 + shot.radius;
      if (!player.dead && nearPlayer) {
        damagePlayer(state, shot.damage, shot.x);
        return;
      }
      remaining.push(shot);
    });

    state.projectiles = remaining;
  }

  /**
   * 一个身体接下来那一步会不会踩进实心布景里。**这一问要便宜** —— 它每帧每个怪都跑，
   * 而 `routeStep` 那套 BFS 只在答"会"的时候才去查。
   */
  function propBlocksAt(state, x, z, halfWidth, halfDepth) {
    var props = state.props || [];
    for (var i = 0; i < props.length; i += 1) {
      var prop = props[i];
      if (!prop.solid || prop.broken) continue;
      var box = propBox(prop.piece);
      if (!box) continue;
      var centre = prop.x + (box.dx || 0);
      if (Math.abs(x - centre) < halfWidth + box.width / 2 &&
          Math.abs(z - prop.z) < halfDepth + box.depth / 2) return true;
    }
    return false;
  }

  /**
   * 朝玩家走一步：好走就直着走，被挡住就**绕**（`routeStep`）。问的是"再走两帧会在哪"
   * 那一点，不是当前位置 —— 拿当前位置问，已经顶着桶的怪会一直答"没被挡"。
   */
  function walkTowards(state, enemy, player, speed) {
    /*
     * 往前看**六帧**，不是两帧。两帧只够问"下一步会不会踩上去"，而那一点正好压在
     * 盒子的边上（桶的盒子 52 宽、怪半宽 16.5，差 0.2 像素就答"没挡"）—— 于是它
     * 一帧答挡、一帧答不挡，人就看着怪在桶前面原地抖。六帧是十来个像素，
     * 足够在真正贴上之前就决定绕。
     */
    var half = enemy.width / 2;
    var aheadX = enemy.x + enemy.facing * speed * DT * 6;
    if (!propBlocksAt(state, aheadX, enemy.z || 0, half, half)) {
      enemy.vx = enemy.facing * speed;
      return;
    }
    var route = routeStep(state, player.x, player.z || 0, enemy.x, enemy.z || 0);
    enemy.vx = route[0] * speed;
    /*
     * 路网给的是**世界**方向；深度那一轴要换成屏幕速度那一把尺子（`depthSpeedFor`），
     * 和他走位是同一把 —— 不然绕出来那一步会比它自己的横走快三倍。
     */
    if (route[1]) enemy.vz = route[1] * depthSpeedFor(speed);
  }

  function beginEnemyAttack(enemy, kind, windup, duration) {
    enemy.attackKind = kind;
    /* DNF bosses swing through light hits while winding up a heavy skill. */
    enemy.superArmor = kind === "slam";
    enemy.attackWindup = windup;
    enemy.attackDuration = duration;
    enemy.attackTimer = duration;
    enemy.attackHitDone = false;
    enemy.attackRecovered = false;
  }

  function enemyHitsPlayer(enemy, player) {
    return inReachOf(player.z, enemy.z) && boxesOverlap(bodyBox(enemy), bodyBox(player));
  }

  /* A spin sweeps a wider hitbox than the body, so stepping one body-width
   * aside is not enough - the whole lane has to be cleared. Depth works the same
   * way: it reaches wider than a body there too, so the answer to a spin is to
   * be well out of its row rather than a step off it. */
  function spinHitsPlayer(enemy, player, radius) {
    if (!inReachOf(player.z, enemy.z, DEPTH_REACH.spin)) return false;
    var swept = bodyBox(enemy);
    swept.left -= radius * 0.5;
    swept.right += radius * 0.5;
    return boxesOverlap(swept, bodyBox(player));
  }

  /** How far apart two bodies are on the floor, depth included. */
  function floorDistance(a, b) {
    var dx = a.x - b.x;
    var dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * The gap between two bodies' edges along x: 0 when they touch, negative when
   * they overlap.
   *
   * **Every reach in the AI is measured this way, and that is the point.** The
   * distances used to be centre-to-centre, so a monster's reach silently
   * depended on how wide its body was: growing a body by 87 px a side took 87 px
   * off its reach. That is not a hypothetical - enlarging 牛头巨兽 to the size the
   * client draws it pushed it 189 px clear of the Slayer while its `attackRange`
   * was still 74, and **it could not land a single blow**. A reach expressed past
   * the body survives the body changing size, which is what lets the boxes follow
   * the art at all.
   *
   * The numbers were converted one for one - each tuned value minus the body
   * span it was measured against - so the fight on screen is the one the old
   * numbers were tuned for.
   */
  function bodyGap(a, b) {
    return Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  }

  function chooseEnemyAction(state, enemy, player) {
    var delta = player.x - enemy.x;
    var distance = Math.abs(delta);
    /* Reaches are measured past the bodies, not between the centres - see bodyGap. */
    var gap = bodyGap(enemy, player);
    if (!player.dead) enemy.facing = delta >= 0 ? 1 : -1;
    if (player.dead) {
      enemy.vx = 0;
      enemy.vz = 0;
      return;
    }

    /*
     * Monsters walk the second axis too, and this is the one line that makes the
     * whole axis a fight rather than a hiding place: without it the Slayer could
     * stand one row off every melee monster in the game and neither side could
     * land a blow, a standoff he could hold for as long as he liked.
     *
     * They walk onto his row at their own pace rather than snapping onto it, and
     * the pace is the screen pace, so a retreat in depth looks like a retreat
     * sideways. Being slower than he is, a step aside that beats their walk still
     * dodges a swing they have already committed to - which is what the axis is
     * for. Within reach they hold still, or they would jitter across his row.
     *
     * A monster with a live attack keeps the vz it had and the caller damps it,
     * the same way a wind-up damps its vx: committed is committed.
     */
    var rowGap = (player.z || 0) - (enemy.z || 0);
    var rowReach = DEPTH_REACH.melee * SLAYER_HEIGHT;
    enemy.vz =
      Math.abs(rowGap) <= rowReach ? 0 : (rowGap > 0 ? 1 : -1) * depthSpeedFor(enemy.speed);

    if (enemy.behavior === "ranged") {
      /*
       * A ranged monster holds its row the way it holds its distance. Its shots
       * carry whatever row it is standing on (see spawnProjectile), so walking
       * onto the Slayer's row would only put it where he already is - and holding
       * it is what makes room data worth writing: a caster that opens a fight
       * standing back is one he has to walk to, on both axes, while it shoots.
       */
      enemy.vz = 0;
      var keep = enemy.keepRange || enemy.attackRange * 0.6;
      if (gap < keep) {
        enemy.vx = -enemy.facing * enemy.speed;
      } else if (gap > enemy.attackRange) {
        enemy.vx = enemy.facing * enemy.speed;
      } else {
        enemy.vx = 0;
        if (enemy.attackCooldown <= 0) {
          beginEnemyAttack(enemy, "shoot", enemy.baseAttackWindup, enemy.baseAttackDuration);
          pushTelegraph(state, enemy, "AIM", enemy.attackRange * 0.25, enemy.attackWindup, enemy.facing);
        }
      }
      return;
    }

    if (enemy.behavior === "charger") {
      if (gap > enemy.attackRange * 0.8) {
        walkTowards(state, enemy, player, enemy.speed);
      } else {
        enemy.vx = 0;
        if (enemy.attackCooldown <= 0) {
          beginEnemyAttack(enemy, "charge", enemy.baseAttackWindup, enemy.baseAttackDuration);
          enemy.chargeDir = enemy.facing;
          pushTelegraph(state, enemy, "CHARGE", enemy.attackRange, enemy.attackWindup, enemy.facing);
        }
      }
      return;
    }

    if (enemy.behavior === "elite") {
      var spinDash = enemy.spinDash;
      if (
        spinDash &&
        enemy.spinCooldown <= 0 &&
        enemy.attackCooldown <= 0 &&
        /* Commits when the Slayer is close: the sweep punishes a hug, not a retreat. */
        gap <= spinDash.commit
      ) {
        enemy.vx = 0;
        enemy.spinDir = enemy.facing;
        beginEnemyAttack(
          enemy,
          "spin",
          spinDash.windup,
          spinDash.windup + spinDash.duration + spinDash.recovery
        );
        enemy.superArmor = true;
        pushTelegraph(state, enemy, "SPIN", spinDash.radius, spinDash.windup, enemy.facing);
        return;
      }
      if (gap > enemy.attackRange * 0.8) {
        walkTowards(state, enemy, player, enemy.speed);
      } else {
        enemy.vx = 0;
        if (enemy.attackCooldown <= 0) {
          beginEnemyAttack(enemy, "melee", enemy.baseAttackWindup, enemy.baseAttackDuration);
        }
      }
      return;
    }

    var slam = enemy.slam;
    if (slam && enemy.slamCooldown <= 0 && enemy.attackCooldown <= 0 && gap <= slam.commit) {
      enemy.vx = 0;
      beginEnemyAttack(enemy, "slam", slam.windup, slam.windup + slam.recovery);
      pushTelegraph(state, enemy, "SLAM", slam.radius, slam.windup, 0);
      return;
    }

    /* Phase-two bosses close the gap with a super-armoured lunge. */
    var lunge = enemy.phase2 && enemy.phase2.lunge;
    if (
      enemy.phase >= 2 &&
      lunge &&
      enemy.attackCooldown <= 0 &&
      enemy.lungeCooldown <= 0 &&
      gap >= lunge.minGap &&
      gap <= lunge.gap
    ) {
      enemy.vx = 0;
      enemy.chargeSpeed = lunge.speed;
      enemy.chargeFrom = lunge.windup * 0.6;
      enemy.chargeTo = lunge.windup + lunge.recovery * 0.75;
      enemy.chargeDir = enemy.facing;
      beginEnemyAttack(enemy, "charge", lunge.windup, lunge.windup + lunge.recovery);
      enemy.superArmor = true;
      enemy.lungeCooldown = lunge.cooldown;
      pushTelegraph(state, enemy, "LUNGE", lunge.range, lunge.windup, enemy.facing);
      return;
    }

    if (gap > enemy.attackRange * 0.8) {
      walkTowards(state, enemy, player, enemy.speed);
    } else {
      enemy.vx = 0;
      if (enemy.attackCooldown <= 0) {
        beginEnemyAttack(enemy, "melee", enemy.baseAttackWindup, enemy.baseAttackDuration);
      }
    }
  }

  function advanceEnemyAttack(state, enemy, player, dt) {
    var elapsed = enemy.attackDuration - enemy.attackTimer;

    if (enemy.attackKind === "spin") {
      var spin = enemy.spinDash;
      if (!spin) {
        enemy.attackTimer = 0;
        return;
      }
      var spinEnds = spin.windup + spin.duration;
      if (elapsed >= spin.windup && elapsed <= spinEnds) {
        enemy.vx = enemy.spinDir * spin.speed;
        if (!enemy.attackHitDone && spinHitsPlayer(enemy, player, spin.radius)) {
          enemy.attackHitDone = true;
          damagePlayer(state, spin.damage, enemy.x);
        }
      } else if (elapsed > spinEnds) {
        enemy.vx *= 0.35;
        if (!enemy.attackRecovered) {
          enemy.attackRecovered = true;
          enemy.attackCooldown = enemy.attackCooldownMax;
          enemy.spinCooldown = spin.cooldown;
          enemy.superArmor = false;
        }
      }
      enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
      return;
    }

    if (enemy.attackKind === "charge") {
      if (enemy.attackTimer > 0 && elapsed >= enemy.chargeFrom && elapsed <= enemy.chargeTo) {
        enemy.vx = enemy.chargeDir * enemy.chargeSpeed;
        if (!enemy.attackHitDone && enemyHitsPlayer(enemy, player)) {
          enemy.attackHitDone = true;
          damagePlayer(state, enemy.damage, enemy.x);
        }
      } else if (elapsed > enemy.chargeTo) {
        enemy.vx *= 0.4;
        if (!enemy.attackRecovered) {
          enemy.attackRecovered = true;
          enemy.attackCooldown = enemy.attackCooldownMax;
          enemy.superArmor = false;
        }
      }
      enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
      return;
    }

    if (!enemy.attackHitDone && elapsed >= enemy.attackWindup) {
      enemy.attackHitDone = true;
      if (enemy.attackKind === "shoot") {
        spawnProjectile(state, enemy);
        enemy.attackCooldown = enemy.attackCooldownMax;
      } else if (enemy.attackKind === "slam" && enemy.slam) {
        pushShockwave(state, enemy);
        var onGround = player.y >= ARENA.groundY - 26;
        /*
         * A slam is a disc on the floor, so its radius is measured on the floor:
         * its x reach and its depth reach are the same number, and jumping is
         * still the other answer to it (that is the `onGround` clause above).
         */
        if (!player.dead && onGround && floorDistance(player, enemy) <= enemy.slam.radius) {
          damagePlayer(state, enemy.slam.damage, enemy.x);
        }
        enemy.slamCooldown = enemy.slam.cooldown;
        enemy.attackCooldown = enemy.attackCooldownMax;
      } else {
        /*
         * **A whiff is still a swing.** Every other kind here sets the cooldown
         * when its move resolves; melee used to set it only when the blow
         * *landed*. A miss therefore left `attackCooldown` at zero, so the
         * monster that stepped at air re-committed on the very next frame -
         * and because `chooseEnemyAction` does not run during an attack, `vz`
         * was halved every frame for as long as the loop lasted. Stepping one
         * row back did not dodge a committed blow and then get chased; it parked
         * the monster on the spot: it closed depth at about a fourteenth of its
         * walk (measured: 300 z of gap took 18 s instead of 1.2).
         *
         * That is the opposite of what the axis is documented for two screens up
         * ("within reach they hold still" is about holding a *row*, not about
         * holding a wind-up). 录像里的哥布林是一路走到他面前的。
         */
        if (inReachOf(player.z, enemy.z) && bodyGap(enemy, player) <= enemy.attackRange) {
          damagePlayer(state, enemy.damage, enemy.x);
        }
        enemy.attackCooldown = enemy.attackCooldownMax;
      }
    }
    enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
    if (enemy.attackTimer === 0) enemy.superArmor = false;
  }

  function updateEnemies(state, dt) {
    var player = state.player;
    state.enemies.forEach(function (enemy) {
      if (enemy.dead) return;

      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      if (enemy.slam) enemy.slamCooldown = Math.max(0, enemy.slamCooldown - dt);
      enemy.spinCooldown = Math.max(0, enemy.spinCooldown - dt);
      enemy.lungeCooldown = Math.max(0, enemy.lungeCooldown - dt);
      enemy.knockdown = Math.max(0, enemy.knockdown - dt);
      enemy.stun = Math.max(0, enemy.stun - dt);
      if (enemy.grabbed > 0) {
        /* Held in front of the Slayer: no acting, no sliding. */
        enemy.grabbed = Math.max(0, enemy.grabbed - dt);
        enemy.x = clamp(
          player.x + player.facing * 30,
          roomLeft(state) + enemy.width / 2,
          roomRight(state) - enemy.width / 2
        );
        enemy.y = ARENA.groundY;
        enemy.z = player.z || 0;
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.vz = 0;
        enemy.attackTimer = 0;
      }
      if (enemy.bleed) {
        enemy.bleed.remaining -= dt;
        enemy.bleed.timer -= dt;
        if (enemy.bleed.timer <= 0) {
          enemy.bleed.timer += enemy.bleed.interval;
          /* The bleed is the wound's own damage, so it draws no blood orbs. */
          damageEnemy(state, enemy, enemy.bleed.damage, 0, enemy.x, { noBloodOrbs: true });
          if (enemy.dead) return;
        }
        if (enemy.bleed.remaining <= 0) enemy.bleed = null;
      }

      /*
       * Super armour belongs to a live wind-up only. A knockdown, stun or grab
       * zeroes attackTimer mid-attack, so clear it here rather than leaving the
       * boss permanently unstoppable.
       */
      if (enemy.attackTimer <= 0) enemy.superArmor = false;

      if (enemy.hurtTimer > 0) {
        enemy.vx *= 0.86;
        enemy.vz *= 0.86;
      } else if (enemy.attackTimer > 0) {
        enemy.vx *= 0.5;
        enemy.vz *= 0.5;
      } else if (

        !enemy.onGround ||
        enemy.knockdown > 0 ||
        enemy.stun > 0 ||
        enemy.grabbed > 0
      ) {
        /* Launched, knocked down or stunned enemies cannot act. */
        enemy.vx *= 0.98;
        enemy.vz *= 0.98;
      } else {
        chooseEnemyAction(state, enemy, player);
      }

      if (enemy.attackTimer > 0) {
        advanceEnemyAttack(state, enemy, player, dt);
      }

      enemy.vy = Math.min(enemy.vy + PHYSICS.gravity * dt, PHYSICS.maxFallSpeed);
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      enemy.z += enemy.vz * dt;
      if (enemy.y >= ARENA.groundY) {
        enemy.y = ARENA.groundY;
        enemy.vy = 0;
        enemy.onGround = true;
      }
      enemy.x = clamp(
        enemy.x,
        roomLeft(state) + enemy.width / 2,
        roomRight(state) - enemy.width / 2
      );
      /* The band's edges stop it the way the walls do, and it is the room's band. */
      enemy.z = clamp(enemy.z, 0, bandDepth(state.band));
      /* 木桶也挡怪（业主："人和怪都撞得到它"）—— 它只是打不碎。 */
      blockProps(state, enemy, enemy.width / 2, enemy.width / 2);
    });

    updateProjectiles(state, dt);
    separateEnemies(state, state.enemies);
  }

  function separateEnemies(state, enemies) {
    for (var i = 0; i < enemies.length; i++) {
      for (var j = i + 1; j < enemies.length; j++) {
        var a = enemies[i];
        var b = enemies[j];
        if (a.dead || b.dead) continue;
        var minGap = (a.width + b.width) / 2;
        var gap = Math.abs(a.x - b.x);
        if (gap >= minGap) continue;
        /*
         * Two monsters on different rows are not in each other's way, however
         * much their x ranges overlap: the floor has two axes here too, and a
         * body-width is the same reading of "the same spot" it is everywhere
         * else (see the projectile test).
         */
        if (Math.abs((a.z || 0) - (b.z || 0)) >= minGap) continue;
        var push = (minGap - gap) / 2;
        if (a.x <= b.x) {
          a.x = clamp(a.x - push, roomLeft(state) + a.width / 2, roomRight(state) - a.width / 2);
          b.x = clamp(b.x + push, roomLeft(state) + b.width / 2, roomRight(state) - b.width / 2);
        } else {
          a.x = clamp(a.x + push, roomLeft(state) + a.width / 2, roomRight(state) - a.width / 2);
          b.x = clamp(b.x - push, roomLeft(state) + b.width / 2, roomRight(state) - b.width / 2);
        }
      }
    }
  }

  function resolveRoom(state) {
    var alive = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    });
    /*
     * 刚倒下的还躺在地上（白色剪影那一段要走完，`updateDeaths` 收尸），
     * 所以别把他们从名单里划掉（`docs/adr/0034`）。
     */
    state.enemies = state.enemies.filter(function (enemy) {
      return !enemy.dead || enemy.dying > 0;
    });

    if (alive.length === 0 && !state.room.cleared && !state.defeat) {
      state.room.cleared = true;
      var cell = currentCell(state);
      if (cell) cell.cleared = true;
      state.stats.rooms += 1;
      if (state.dungeon && state.cell === state.dungeon.boss) {
        state.victory = true;
        pushBanner(state, (state.stage && state.stage.clearBanner) || "Dungeon cleared!", 2.4);
      } else {
        offerUpgrade(state);
        pushBanner(state, "房间清空 · 选一张强化卡", 1.8);
      }
      return;
    }

    /*
     * 出门：站在一扇开着的门里就换房。门清过房才全开，没清只有进来那扇能走回去
     * （`exitMode`）。卡片还没选完就不放人 —— 强化是清房的报酬，不是路上的选装。
     */
    if (!state.room.cleared || state.upgradeChoice || !state.dungeon) return;
    var dir = doorAt(state);
    if (dir) enterCell(state, dir);
  }

  /**
   * 倒下的人（`docs/adr/0034`）：躺 `DEATH.lie` → **变成自己的白色剪影** `smokeLife()`
   * → 炸成十二块它自己颜色的碎块、从场上拿掉。
   *
   * 剪影就是这只怪自己画的（`enemy.silhouette` 交给渲染层），所以尸体得留到数完；
   * `dying` 是这条线唯一的钟。Boss 例外：只有那一片白，不炸。
   */
  function updateDeaths(state, dt) {
    var buried = false;
    state.enemies.forEach(function (enemy) {
      if (!enemy.dead || !(enemy.dying > 0)) return;
      enemy.dying -= dt;
      if (!enemy.silhouette && enemy.dying <= smokeLife(enemy)) enemy.silhouette = true;
      if (enemy.dying > 0) return;
      enemy.dying = 0;
      enemy.silhouette = false;
      enemy.gone = true;
      buried = true;
      /*
       * 炸开：十几块**它自己的颜色**，飞出去、减速、落地、化掉（`DEATH.chunks`）。
       * Boss 不炸 —— 录像里它只有那一片白。
       */
      if (enemy.type !== "boss") {
        state.effects.push({
          kind: "deathburst",
          x: enemy.x,
          z: enemy.z,
          seed: enemy.id,
          type: enemy.type,
          /* 碎块从**身上**起手，不是从脚底 —— 从脚底起飞读起来像地上冒泡。 */
          height: enemy.height,
          life: DEATH.chunks,
          maxLife: DEATH.chunks
        });
      }
    });
    if (!buried) return;
    state.enemies = state.enemies.filter(function (enemy) {
      return !enemy.gone;
    });
  }

  /**
   * 木桶那 12 帧碎片的钟。
   *
   * 碎片只活 `BREAK_ANIM` 秒，然后那个桶就只剩"这儿曾经有个桶"——美术不再画它，
   * 盒子也不再挡人。天底下没有别的东西要算：他撞上去是位置约束（`blockProps`），
   * 打中它是他那一下自己查的（`hitProps`）。
   */
  function updateBreakables(state) {
    (state.props || []).forEach(function (prop) {
      if (!prop.broken) return;
      if (state.time - prop.brokenAt >= BREAK_ANIM) prop.gone = true;
    });
  }

  /**
   * 把一个身体从实心布景里推出去。
   *
   * 实心的是**木桶和立着的布景**（树、石头、树桩、石柱 —— `docs/adr/0032`），判定在
   * x-z 平面上：两个轴都压上了才算撞上（前后错开就能从它面前走过去）。推的方向按他来的
   * 那一侧，所以擦着走过去不会粘住。盒子的中心带 `dx` 的偏移（树根张的方向、石头偏的
   * 那一边都是量出来的），不然一块斜着长的树根会把半条路挡掉。
   *
   * **没有人绕路**：怪也是这么被挡住的（业主："人和怪都撞得到它"）。所以摆布景的规矩是
   * **别把它摆在小怪必经的直线上**，也别摆进门里（同一条 ADR）。
   */
  function blockProps(state, body, halfWidth, halfDepth) {
    (state.props || []).forEach(function (prop) {
      if (!prop.solid || prop.broken) return;
      var box = propBox(prop.piece);
      if (!box) return;
      var centre = prop.x + (box.dx || 0);
      var spanX = halfWidth + box.width / 2;
      var spanZ = halfDepth + box.depth / 2;
      var dx = body.x - centre;
      var dz = (body.z || 0) - prop.z;
      if (Math.abs(dx) >= spanX || Math.abs(dz) >= spanZ) return;
      /* 推出去走最浅的那条路：哪个轴压得少就推哪个。 */
      var pushX = spanX - Math.abs(dx);
      var pushZ = spanZ - Math.abs(dz);
      if (pushX <= pushZ) {
        body.x = centre + (dx < 0 ? -spanX : spanX);
        body.x = clamp(body.x, roomLeft(state) + halfWidth, roomRight(state) - halfWidth);
        body.vx = 0;
      } else {
        body.z = clamp(prop.z + (dz < 0 ? -spanZ : spanZ), 0, bandDepth(state.band));
        body.vz = 0;
      }
    });
  }

  /**
   * 一团挥击扫过布景。**只有他挥出去的那几下走到这里** —— 怪的挥击、怪的身体都不碰桶
   * （业主的话：「只有人能打碎，怪物打不碎」）。所以这个函数只在他那三条命中路径上
   * （普攻连段、技能那一下、大蹦的冲击波）被叫，怪的命中路径上没有它。
   *
   * 判定和打怪一样是"盒子碰上、深度够得着"，只是深度那一半要加上桶自己的厚度：桶不是
   * 一个点，它占了半格地。
   */
  function swingProps(state, box, reach) {
    (state.props || []).forEach(function (prop) {
      if (!prop.solid || prop.broken) return;
      var spec = breakableSpec(prop.piece);
      if (!spec) return;
      var depthReach = (reach === undefined ? DEPTH_REACH.melee : reach) * SLAYER_HEIGHT;
      if (Math.abs((prop.z || 0) - state.player.z) > depthReach + spec.depth / 2) return;
      /*
       * **这个盒子画在高度轴上，不是屏幕 y 上。** 它原来把桶的落脚点写成
       * `groundY - depthLift(z)` —— 那是**画**它用的那一条（`docs/adr/0047`），
       * 而深度已经由上面那一行单独判过了。两套坐标混在一起，越靠里的桶那个盒子
       * 就越高：深度 0.72 时它整块跑到挥击盒上面 12 像素，于是**站在他面前他也砸不碎**。
       * 怪的身体盒一直是按高度轴写的（`bodyBox` 读 `enemy.y`），桶照同一条走。
       */
      var foot = ARENA.groundY;
      var barrel = {
        left: prop.x - spec.width / 2,
        right: prop.x + spec.width / 2,
        bottom: foot,
        top: foot - spec.height
      };
      if (!boxesOverlap(box, barrel)) return;
      prop.hp -= 1;
      if (prop.hp > 0) return;
      prop.broken = true;
      prop.brokenAt = state.time;
      prop.solid = false;
      state.stats.barrels += 1;
    });
  }

  function updatePickups(state, dt) {
    var player = state.player;
    var remaining = [];

    state.pickups.forEach(function (drop) {
      drop.life -= dt;
      if (drop.life <= 0) return;
      if (drop.kind === "loot") {
        /*
         * **走过去就收，没有拾取键**（`docs/adr/0042`）：录像里他全程没按过拾取。
         * 半径按**身体间距**量 —— 和"够不够得着"同一把尺子（`CONTEXT.md`「身体间距」），
         * 不是两个中心之间的距离；深度也要在同一档上，不然隔着一排就能隔着捡。
         */
        var onRow =
          Math.abs((player.z || 0) - (drop.z || 0)) <= DEPTH_REACH.melee * SLAYER_HEIGHT;
        if (!player.dead && onRow &&
            Math.abs(player.x - drop.x) <= LOOT.reach + player.width / 2) {
          collectLoot(state, drop);
          return;
        }
        remaining.push(drop);
        return;
      }

      /*
       * 血球 is pulled into the Slayer: it homes at his chest instead of
       * falling, so it cannot be lost to gravity or to a jump he is in the
       * middle of - and it is the only thing that goes into `pickups` at all.
       * Monsters used to leave a heal orb on the floor when they died; the
       * owner took that out, so blood has exactly one way back (docs/adr/0021).
       *
       * Where it sits is a function of the clock and not of a speed: it eases
       * out of the monster and into him over `flightSeconds` (see BLOOD_ORB),
       * and the far end of that line is his chest *now*, so walking away with
       * one in the air drags it along.
       */
      drop.progress = Math.min(1, drop.progress + dt / BLOOD_ORB.flightSeconds);
      var eased = drop.progress * drop.progress;
      var targetY = player.y - player.height * CHEST_OF_HEIGHT;
      drop.x = drop.fromX + (player.x - drop.fromX) * eased;
      drop.y = drop.fromY + (targetY - drop.fromY) * eased;
      /*
       * The tail is the ball's own path, sampled every `trailStep` radii
       * rather than every frame: the renderer draws the entries behind the
       * ball, so a fixed spacing is what keeps the tail the same length
       * however fast this particular crossing is (docs/adr/0020).
       */
      var backX = drop.x - drop.trail[0].x;
      var backY = drop.y - drop.trail[0].y;
      var spacing = drop.radius * BLOOD_ORB.trailStep;
      if (backX * backX + backY * backY >= spacing * spacing) {
        drop.trail.unshift({ x: drop.x, y: drop.y });
        if (drop.trail.length > BLOOD_ORB.trailSteps) drop.trail.pop();
      }
      if (!player.dead && drop.progress >= 1) {
        var healed = Math.min(player.maxHp - player.hp, drop.value);
        player.hp += healed;
        state.effects.push({
          kind: "heal",
          text: "+" + Math.round(drop.value) + " HP",
          x: player.x,
          y: player.y - player.height - 10,
          life: 0.8,
          maxLife: 0.8
        });
        /*
         * And what it looks like when the blood lands, which is **two beats**
         * (docs/adr/0020): a flashbulb on his chest - a white core with pale
         * spokes off it (#846-849, `(226,255,255)` at r45) - and then the
         * *drink*: a glass-green sphere closes over him (#850-852, ~0.76
         * Slayer-heights across, `(220,254,220)` at its brightest) and bursts
         * into three green motes that float up off him (#853-855). The flash
         * says "something landed"; the green says his health went up. Only
         * blood orbs push either.
         */
        state.effects.push({
          kind: "bloodFlash",
          x: player.x,
          y: player.y - player.height * CHEST_OF_HEIGHT,
          life: 0.26,
          maxLife: 0.26
        });
        state.effects.push({
          kind: "bloodHeal",
          x: player.x,
          y: player.y - player.height * CHEST_OF_HEIGHT,
          life: 0.42,
          maxLife: 0.42
        });
        return;
      }
      remaining.push(drop);
    });

    state.pickups = remaining;
  }

  /*
   * **镜头跟着他走**（`docs/adr/0035`：房间是"世界"，`ARENA` 只是窗口）。
   *
   * 规矩全部量自录像，逐条见 `CAMERA` 那一块。这里只做一件事：**把他保持在死区里**。
   *
   * - 他到带子边上了才动 —— 没到边上镜头一格都不挪（录像里 71% 的帧镜头位移恰好是 0）；
   * - 一旦要动就**跟他 1:1**，没有平滑、没有滞后（量过：越过边界一帧内就到全速）；
   * - **夹在房间里**：房间比窗口窄就钉死居中，宽就滑，两端停在房间的边上
   *   ——「到墙就停住，他还走他的」；
   * - **纵向不动**（`y` 一直是 0）：录像里 95% 的帧 dy = 0。
   *
   * 它是**幂等**的：同一个 `player.x` 调两次得同一个结果，所以 `beginRoom` 和每帧末尾
   * 都可以放心各叫一次。
   */
  function updateCamera(state) {
    var window = windowWidth();
    var room = roomWidth(state);
    state.camera.y = 0;

    /* 房间还没窗口宽：没有可滑的余量，钉在正中间。 */
    if (room <= window) {
      state.camera.x = (room - window) / 2;
      return;
    }

    /*
     * 死区量的是**屏幕**（世界窗口那 720 里居中的 224/1440），换算到世界要除以
     * `zoom` —— 他在世界里走多远，屏幕上才走出一条带子那么宽。
     */
    var half = (VIEW.width * CAMERA.deadzoneShare) / 2 / CAMERA.zoom;
    var centre = state.camera.x + window / 2;
    var offset = state.player.x - centre;
    if (offset > half) state.camera.x = state.player.x - half - window / 2;
    else if (offset < -half) state.camera.x = state.player.x + half - window / 2;

    state.camera.x = clamp(state.camera.x, 0, room - window);
  }

  function step(state, input, dt) {
    dt = typeof dt === "number" && dt > 0 ? dt : DT;
    input = normalizeInput(input);

    /*
     * **进副本那 2.34 秒不推世界**（`docs/adr/0044`）：录像里那一段是过场与加载，
     * 没有人在动，也不该算进这一局的用时。到点交给 `transition` 那层黑幕淡进来，
     * 关卡名从那一刻开始挂。
     */
    if (state.intro) {
      state.intro.t += dt;
      if (state.intro.t >= introLength()) {
        state.intro = null;
        state.transition = TRANSITION.dur;
        state.titleT = INTRO.title;
      }
      return;
    }

    state.time += dt;
    if (state.titleT > 0) state.titleT = Math.max(0, state.titleT - dt);
    if (state.finishedAt === null && (state.victory || state.defeat)) {
      state.finishedAt = state.time;
    }
    state.effects = state.effects
      .map(function (effect) {
        effect.life -= dt;
        return effect;
      })
      .filter(function (effect) {
        return effect.life > 0;
      });
    /*
     * The ground the skills left burning runs on its own clock, not the caster's
     * (see spawnField): it keeps its frames - and its place - while he recovers,
     * is interrupted or walks away.
     */
    state.fields = state.fields
      .map(function (field) {
        field.clock += dt;
        return field;
      })
      .filter(function (field) {
        return field.clock < field.life;
      });

    if (state.transition > 0) state.transition = Math.max(0, state.transition - dt);
    /*
     * 倒下的人自有它的钟，**通关那一下也得走**：不然 Boss 一死世界就冻住，最后一具
     * 尸体永远躺在那儿 —— 录像里它躺 0.2 秒是要炸开的。
     */
    updateDeaths(state, dt);

    if (state.victory || state.defeat) return state;

    updatePlayer(state, input, dt);
    /*
     * The ground he opened hits on its own clock, right after his own move has
     * run: 火山's beats belong to the spot, and a beat that landed while he was
     * recovering, interrupted or already in the next room still lands here.
     */
    updateFieldTicks(state, dt);
    /*
     * What he threw, after what he did and before what the room does. A qi born
     * on this frame is already in the air on it, which is what the art does too:
     * the row's third stage starts flying on the very column it appears on.
     */
    updateShots(state, dt);
    updateEnemies(state, dt);
    updateTarget(state, dt);
    updateBreakables(state);
    updatePickups(state, dt);
    resolveRoom(state);
    /*
     * Last, and on purpose: the camera reads where everyone ended up this frame,
     * not where they were when it started - and `resolveRoom` may already have
     * begun the next room, which moves the walls it clamps against.
     */
    updateCamera(state);
    return state;
  }

  function runFrames(state, frames, inputForFrame) {
    for (var frame = 0; frame < frames; frame++) {
      var input = typeof inputForFrame === "function" ? inputForFrame(frame, state) : inputForFrame;
      step(state, input);
    }
    return state;
  }

  return {
    FPS: FPS,
    DT: DT,
    ARENA: ARENA,
    /*
     * 世界窗口与房间默认尺寸（`docs/adr/0040`）。渲染那边两个都要：`VIEW` 决定世界画在哪
     * 一块矩形里（其余是黑边），`ROOM` 是铺背景与量墙的默认尺寸。
     */
    VIEW: VIEW,
    ROOM: ROOM,
    DEPTH: DEPTH,
    depthLift: depthLift,
    BAND: BAND,
    bandDepth: bandDepth,
    SLAYER_HEIGHT: SLAYER_HEIGHT,
    DEPTH_REACH: DEPTH_REACH,
    inReachOf: inReachOf,
    PHYSICS: PHYSICS,
    PLAYER: PLAYER,
    ATTACK_STAGES: ATTACK_STAGES,
    swingDuration: swingDuration,
    attackSpeedOf: attackSpeedOf,
    SKILLS: SKILLS,
    SKILL_ORDER: SKILL_ORDER,
    CASTABLE_SKILLS: CASTABLE_SKILLS,
    PROGRESSION: PROGRESSION,
    /* 地上的掉落与它那几个数（`docs/adr/0042`），和左边那栏日志的行数上限。 */
    LOOT: LOOT,
    LOG_LINES: LOG_LINES,
    /* 战斗评分那四个读数（`docs/adr/0041`）—— 面板与结算页读的是同一个函数。 */
    RATING: RATING,
    ratingOf: ratingOf,
    /* 进副本那一串的时长与开关（`docs/adr/0044`）。 */
    INTRO: INTRO,
    introLength: introLength,
    beginIntro: beginIntro,
    pushLog: pushLog,
    BLOOD_ORB: BLOOD_ORB,
    HELLBENTER: HELLBENTER,
    ENEMY_TYPES: ENEMY_TYPES,
    REGION: REGION,
    STAGES: STAGES,
    DEFAULT_STAGE: DEFAULT_STAGE,
    dungeonFor: dungeonFor,
    DUNGEON: MIRKWOOD_DUNGEON,
    MINIMAP_DIR: MINIMAP_DIR,
    MINIMAP_DIRS: MINIMAP_DIRS,
    MINIMAP_STEPS: MINIMAP_STEPS,
    currentCell: currentCell,
    currentSpec: currentSpec,
    doorNeighbour: doorNeighbour,
    doorX: doorX,
    /*
     * 房间是"世界"、`ARENA` 只是窗口（`docs/adr/0035`）：渲染那边也要用这三个，
     * 所以和 `ARENA` 一起出去 —— 它画背景要铺满**房间**，不是铺满窗口。
     */
    roomWidth: roomWidth,
    roomLeft: roomLeft,
    roomRight: roomRight,
    /* 当前目标那一套（左上角那块条）：量出来的数见 `TARGET` 的注释。 */
    TARGET: TARGET,
    /*
     * 撒布景那一张表（`SCATTER` 自己那段有全部依据）。出去是因为**测试要能问
     * "这一件有没有人在用"** —— 撒出来的那批不在任何房间的 `props` 里，
     * 只有这张表点得到它们的名字。
     */
    SCATTER: SCATTER,
    /* 录像像素 → 世界像素。HUD 那边还要再乘一次镜头远近，见 `src/render.js`。 */
    VIDEO_PX: VIDEO_PX,
    /* 一只怪的名字、类别、等级（左上角那块条上写的三样）。 */
    monsterInfo: function (type) {
      return ENEMY_TYPES[type] || null;
    },
    /*
     * 镜头那一组量出来的数（`docs/adr/0035`）。渲染要用 `zoom`，把世界画大；
     * 测试要按 `deadzoneShare` 与 `figure` 复核，所以一起出去。
     */
    CAMERA: CAMERA,
    windowWidth: windowWidth,
    exitMode: exitMode,
    doorAt: doorAt,
    DOOR: DOOR,
    TRANSITION: TRANSITION,
    BREAKABLE: BREAKABLE,
    /* 一件布景画多大（`docs/adr/0050`）—— 怪有 `enemy.height`，布景有它。 */
    PROP_SCALE: PROP_SCALE,
    propScale: propScale,
    SOLID: SOLID,
    blocksDoorway: blocksDoorway,
    doorFloor: doorFloor,
    routeStep: routeStep,
    propBox: propBox,
    BREAK_ANIM: BREAK_ANIM,
    DEATH: DEATH,
    UPGRADES: UPGRADES,
    UPGRADE_ORDER: UPGRADE_ORDER,
    UPGRADES_PER_ROOM: UPGRADES_PER_ROOM,
    DEFAULT_SEED: DEFAULT_SEED,
    clamp: clamp,
    createState: createState,
    createPlayer: createPlayer,
    createEnemy: createEnemy,
    enterCell: enterCell,
    beginRoom: beginRoom,
    goToCell: goToCell,
    updateDeaths: updateDeaths,
    attackBox: attackBox,
    bodyBox: bodyBox,
    boxesOverlap: boxesOverlap,
    damageEnemy: damageEnemy,
    damagePlayer: damagePlayer,
    spawnField: spawnField,
    fieldProgress: fieldProgress,
    enterPhase2: enterPhase2,
    rollUpgradeOptions: rollUpgradeOptions,
    offerUpgrade: offerUpgrade,
    chooseUpgrade: chooseUpgrade,
    grantXp: grantXp,
    spawnProjectile: spawnProjectile,
    updateProjectiles: updateProjectiles,
    updatePickups: updatePickups,
    nextRandom: nextRandom,
    step: step,
    runFrames: runFrames
  };
});
