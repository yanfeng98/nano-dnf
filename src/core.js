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

  var ARENA = {
    width: 960,
    height: 540,
    /*
     * The floor sits above the hotbar's band rather than under it: at 460 the
     * bar (which starts at height - 96) covered the ground the Slayer stands on,
     * and the owner asked for the floor to stay visible.
     */
    groundY: 430,
    leftWall: 24,
    rightWall: 936
  };

  var PHYSICS = {
    gravity: 2200,
    moveSpeed: 265,
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
  var ENEMY_TYPES = {
    grunt: {
      behavior: "melee",
      maxHp: 32,
      xp: 10,
      width: 33,
      height: 53,
      speed: 95,
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
      behavior: "melee",
      maxHp: 22,
      xp: 8,
      width: 33,
      height: 53,
      speed: 118,
      damage: 5,
      attackRange: 12,
      attackWindup: 0.24,
      attackDuration: 0.44,
      attackCooldown: 0.9,
      knockbackX: 130
    },
    brute: {
      behavior: "melee",
      maxHp: 68,
      xp: 22,
      width: 68,
      height: 80,
      speed: 68,
      damage: 13,
      attackRange: 17,
      attackWindup: 0.42,
      attackDuration: 0.7,
      attackCooldown: 1.5,
      knockbackX: 200
    },
    caster: {
      behavior: "ranged",
      maxHp: 26,
      xp: 14,
      width: 32,
      height: 55,
      speed: 76,
      damage: 7,
      attackRange: 178,
      keepRange: 118,
      attackWindup: 0.5,
      attackDuration: 0.8,
      attackCooldown: 1.9,
      knockbackX: 130,
      projectile: {
        speed: 330,
        radius: 9,
        life: 1.4,
        maxDistance: 300,
        height: 34
      }
    },
    charger: {
      behavior: "charger",
      maxHp: 46,
      xp: 18,
      width: 36,
      height: 62,
      speed: 64,
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
      speed: 72,
      damage: 16,
      attackRange: 24,
      attackWindup: 0.38,
      attackDuration: 0.72,
      attackCooldown: 1.7,
      knockbackX: 220,
      spinDash: {
        speed: 300,
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
      behavior: "boss",
      /* 回避, the same as the elite's - see the note there. */
      evasion: 0.15,
      maxHp: 260,
      xp: 80,
      width: 172,
      height: 201,
      speed: 88,
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
        radius: 208,
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
          speed: 430,
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
          enemies: [
            { type: "grunt", x: 620 },
            { type: "grunt", x: 790 },
            { type: "grunt", x: 880 }
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
          enemies: [
            { type: "caster", x: 600, depth: 0.34 },
            { type: "grunt", x: 720 },
            { type: "grunt", x: 900 }
          ],
          props: [
            { piece: "trunkBent", x: 210, depth: 1 },
            { piece: "trunkMossy", x: 560, depth: 1 },
            { piece: "wallStone", x: 470, depth: 0.72 },
            { piece: "rockFlat", x: 240, depth: 0.4 },
            { piece: "rockSmall", x: 700, depth: 0.46 },
            { piece: "grass", x: 860, depth: 0.3 },
            { piece: "barrel", x: 110, depth: 0.1 }
          ]
        },
        {
          name: "兽栏",
          enemies: [
            { type: "brute", x: 700 },
            { type: "brute", x: 850 },
            { type: "grunt", x: 560 }
          ],
          props: [
            { piece: "trunkTall", x: 340, depth: 1 },
            { piece: "trunkMossy", x: 700, depth: 1 },
            { piece: "pillar", x: 250, depth: 0.66 },
            { piece: "pillar", x: 800, depth: 0.66 },
            { piece: "barrel", x: 420, depth: 0.42 },
            { piece: "barrel", x: 470, depth: 0.3 },
            { piece: "grass", x: 620, depth: 0.14 }
          ]
        },
        {
          /*
           * 十夫长的营寨, the gauntlet: the ten-captain is the skill check, and
           * the thrower behind him keeps the floor honest while he spins.
           */
          name: "十夫长的营寨",
          enemies: [
            { type: "caster", x: 560, depth: 0.4 },
            { type: "elite", x: 760 },
            { type: "grunt", x: 920 }
          ],
          props: [
            { piece: "trunkTall", x: 120, depth: 1 },
            { piece: "trunkBent", x: 660, depth: 1 },
            { piece: "wallStone", x: 330, depth: 0.78 },
            { piece: "barrel", x: 250, depth: 0.6 },
            { piece: "barrel", x: 300, depth: 0.5 },
            { piece: "barrel", x: 360, depth: 0.44 },
            { piece: "flower", x: 880, depth: 0.22 },
            { piece: "bush", x: 60, depth: 0.16 }
          ]
        },
        {
          /*
           * The alternate: the cowards break and run, so they arrive in a pack -
           * and the floor is theirs, because this is the room they dug. The two
           * slabs give way on offset cycles, so the safe ground keeps moving; the
           * mechanic is 沉没礼拜堂's and survived its room (`docs/adr/0026`),
           * re-hung here where a goblin warren makes it read.
           *
           * Wider than the default floor, which is what the room already is: a
           * warren is something you cross, not a corridor you hold - 150 screen
           * px against 120, so a third more ground to be pushed across.
           */
          name: "胆小鬼的窝",
          enemies: [
            { type: "coward", x: 600 },
            { type: "coward", x: 740 },
            { type: "coward", x: 880 }
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
          hazards: [
            { x: 640 },
            { x: 850 }
          ],
          band: { backY: 280 }
        },
        {
          /*
           * 牛头巨兽的林地. The beast charges on a line, so this floor is a
           * little wider than the default instead of narrower: there has to be
           * somewhere to be that is not in front of it.
           */
          name: "牛头巨兽的林地",
          enemies: [
            { type: "grunt", x: 520 },
            { type: "boss", x: 780 }
          ],
          props: [
            { piece: "trunkTall", x: 210, depth: 1 },
            { piece: "trunkMossy", x: 560, depth: 1 },
            { piece: "trunkBent", x: 900, depth: 1 },
            { piece: "rockFlat", x: 680, depth: 0.62 },
            { piece: "stump", x: 400, depth: 0.44 },
            { piece: "grass", x: 120, depth: 0.2 }
          ],
          band: { backY: 300 }
        }
      ],
      bossIndex: 5,
      gauntletIndex: 3,
      /*
       * The beast's own name, and what it says when it crosses half health -
       * every stage's boss is a different animal, so the banner is the stage's
       * to own rather than the `boss` archetype's.
       */
      bossName: "牛头巨兽",
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
  /* How many combat rooms one run of a stage fights, the gauntlet included. */
  var RUN_COMBAT_ROOMS = 4;

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

  /** How much punishment a room's roster carries, by base health. */
  function roomThreat(stage, index) {
    return stage.rooms[index].enemies.reduce(function (total, entry) {
      var spec = ENEMY_TYPES[entry.type] || ENEMY_TYPES.grunt;
      return total + spec.maxHp;
    }, 0);
  }

  /**
   * The gentlest half of one stage's combat pool. A run opens on one of these:
   * seeding the order used to be able to put the hardest room first, at level one
   * with no upgrades, which is a spike rather than a ramp.
   */
  function rampRooms(stage) {
    var pool = [];
    for (var index = 0; index < stage.bossIndex; index += 1) {
      if (index !== stage.gauntletIndex) pool.push(index);
    }
    pool.sort(function (a, b) {
      return roomThreat(stage, a) - roomThreat(stage, b) || a - b;
    });
    return pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  }

  /**
   * The room order of one stage for one seed: a ramp room, two more, the
   * gauntlet, the boss. It takes the stage now - every stage owns its own
   * pool, its own gauntlet and its own boss, and a run is one stage.
   */
  function layoutForSeed(stage, seed) {
    var next = layoutRandom(seed);
    var ramps = rampRooms(stage);
    var opening = ramps[Math.min(ramps.length - 1, Math.floor(next() * ramps.length))];

    var rest = [];
    for (var index = 0; index < stage.bossIndex; index += 1) {
      if (index !== stage.gauntletIndex && index !== opening) rest.push(index);
    }
    /* Fisher-Yates on a copy, so the pool itself is never reordered. */
    for (var cursor = rest.length - 1; cursor > 0; cursor -= 1) {
      var swap = Math.floor(next() * (cursor + 1));
      if (swap > cursor) swap = cursor;
      var held = rest[cursor];
      rest[cursor] = rest[swap];
      rest[swap] = held;
    }
    return [opening]
      .concat(rest.slice(0, RUN_COMBAT_ROOMS - 2))
      .concat([stage.gauntletIndex, stage.bossIndex]);
  }

  var DEFAULT_SEED = 20260915;

  /*
   * The room map - the little window in the corner of a room showing where in
   * the dungeon you are (`docs/adr/0029`).
   *
   * **It is a grid of cells, and every cell is one tile of the client's own
   * minimap art.** That art comes in fixed shapes: a room with its exits, or a
   * corridor passing through, and only some combinations exist (measured in
   * `assets/import_dnf_minimap.py`; the frames are in `src/render.js` MINIMAP).
   * Of the two-exit rooms the client has exactly **{E,S}** and **{N,W}**, which
   * is why every path below steps west or south and turns one way: those two
   * shapes are the only corners the art can draw.
   *
   * A path is one spot per room of the run, in the order they are fought, so the
   * map is drawn from `state.layout` and never lies about where you have been.
   * Which path a run gets is the seed's, like the room order itself.
   */
  var MINIMAP = {
    cols: 4,
    rows: 3,
    paths: [
      [[0, 3], [0, 2], [1, 2], [1, 1], [2, 1]],
      [[0, 2], [0, 1], [1, 1], [1, 0], [2, 0]],
      [[0, 3], [1, 3], [1, 2], [2, 2], [2, 1]],
      [[0, 2], [1, 2], [1, 1], [2, 1], [2, 0]]
    ]
  };

  /* North, east, south, west - the same bits `assets/import_dnf_minimap.py` uses. */
  var MINIMAP_DIR = { N: 1, E: 2, S: 4, W: 8 };

  /**
   * Where each room of a run sits on the map, and which ways it opens.
   *
   * Returns `{cols, rows, cells: [{col, row, exits}]}` in fight order, so
   * `cells[state.roomIndex]` is the room the player is standing in.
   */
  function minimapFor(seed) {
    var paths = MINIMAP.paths;
    var path = paths[(Math.abs(seed >>> 0) % paths.length)];
    var cells = path.map(function (spot, index) {
      var exits = 0;
      [index - 1, index + 1].forEach(function (other) {
        if (other < 0 || other >= path.length) return;
        var across = path[other][1] - spot[1];
        var down = path[other][0] - spot[0];
        if (across === 1) exits |= MINIMAP_DIR.E;
        if (across === -1) exits |= MINIMAP_DIR.W;
        if (down === 1) exits |= MINIMAP_DIR.S;
        if (down === -1) exits |= MINIMAP_DIR.N;
      });
      return { col: spot[1], row: spot[0], exits: exits };
    });
    return { cols: MINIMAP.cols, rows: MINIMAP.rows, cells: cells };
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
   * Collapsing floor. A hazard warns for long enough to walk out, then breaks
   * under anything still standing on it - mobs included, which is what makes the
   * chapel play differently rather than just longer.
   */
  var HAZARD = {
    radius: 72,
    period: 4.2,
    warn: 1.35,
    collapse: 0.45,
    playerDamage: 12,
    enemyDamage: 24,
    enemyKnockdown: 0.7
  };

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
      x: clamp(x + jitter, ARENA.leftWall + spec.width, ARENA.rightWall - spec.width),
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
      roomIndex: 0,
      room: null,
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
        collapses: 0,
        bloodOrbs: 0
      },
      upgradeChoice: null,
      layout: null,
      victory: false,
      defeat: false
    };
    state.rngState = state.seed >>> 0;
    state.layout = layoutForSeed(state.stage, state.seed);
    /* Where each room of this run sits on the map (`docs/adr/0029`). */
    state.minimap = minimapFor(state.seed);
    state.player = createPlayer(options.startX || 110);
    startRoom(state, options.roomIndex || 0);
    return state;
  }

  function startRoom(state, index) {
    var layout = state.layout || layoutForSeed(state.stage, state.seed);
    state.layout = layout;
    var roomIndex = clamp(index, 0, layout.length - 1);
    var spec = state.stage.rooms[layout[roomIndex]];
    state.roomIndex = roomIndex;
    state.room = { index: roomIndex, name: spec.name, total: spec.enemies.length, cleared: false };
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
    state.enemies = spec.enemies.map(function (entry) {
      var z = entry.depth === undefined ? 0 : entry.depth * bandDepth(state.band);
      return createEnemy(state, entry.type, entry.x, z);
    });
    /*
     * Scenery, in the room's own words: `{piece, x, depth?}`, where `piece` is a
     * name the bake produced (`assets/import_dnf_scene.py`) and `depth` is a
     * share of this room's floor, exactly like an enemy's. Props are art only -
     * nothing collides with them and nothing is ever hit by them - so they are
     * drawn in the depth-sorted pass and nowhere else (`drawProps`).
     */
    state.props = (spec.props || []).map(function (entry) {
      var z = entry.depth === undefined ? 0 : entry.depth * bandDepth(state.band);
      return { piece: entry.piece, x: entry.x, z: z };
    });
    state.player.x = 110;
    state.player.y = ARENA.groundY;
    /* He walks in through the door at the front of the floor, like every room before. */
    state.player.z = 0;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    state.player.onGround = true;
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
    state.upgradeChoice = null;
    state.roomTime = 0;
    state.hazards = (spec.hazards || []).map(function (hazard, index) {
      return {
        x: hazard.x,
        radius: hazard.radius || HAZARD.radius,
        /* Offset the cycles so the whole room never breaks at once. */
        phase: (hazard.phase === undefined ? index * (HAZARD.period / 2) : hazard.phase) % HAZARD.period,
        stage: "dormant",
        warnedCycle: -1,
        resolvedCycle: -1
      };
    });
    state.effects.push({
      kind: "banner",
      text: "房间 " + (roomIndex + 1) + " · " + spec.name,
      life: 1.8,
      maxLife: 1.8
    });
    return state.room;
  }

  function pushDamageEffect(state, x, y, amount) {
    state.effects.push({
      kind: "damage",
      text: String(amount),
      x: x,
      y: y,
      life: 0.7,
      maxLife: 0.7
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
      roomIndex: state.roomIndex,
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
    pushBanner(state, "Gate open - head right", 1.4);
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
    if (slayerSwing && slidesOff(state, enemy)) {
      pushMissEffect(state, enemy);
      return 0;
    }
    var applied = Math.max(0, Math.round(amount));
    enemy.hp -= applied;
    state.stats.hits += 1;
    state.stats.damageDealt += applied;
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
      enemy.vy = opts.launch;
      enemy.onGround = false;
      enemy.attackTimer = 0;
      enemy.knockdown = 0;
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
      state.stats.kills += 1;
      /*
       * A kill is worth more blood than a hit is (docs/adr/0025): the whole body
       * empties into the sword, not one cut's worth. The strand is the same one -
       * a second streak for the same death would be the animation talking, not
       * the rule.
       */
      if (slayerSwing) growSword(state, 0, 1);
      pushBanner(state, enemy.type === "boss" ? "Boss down!" : "Enemy down", 0.9);
      grantXp(state, enemy.xp);
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
      ARENA.leftWall + player.width / 2,
      ARENA.rightWall - player.width / 2
    );
    /*
     * And the band's two edges stop him the way the walls do. The front edge is
     * where the camera is and the back edge is the wall behind the room, so both
     * are hard limits: he is held against them rather than slid along them.
     */
    player.z = clamp(player.z, 0, bandDepth(state.band));

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
        shot.x <= ARENA.leftWall ||
        shot.x >= ARENA.rightWall ||
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
        enemy.vx = enemy.facing * enemy.speed;
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
        enemy.vx = enemy.facing * enemy.speed;
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
      enemy.vx = enemy.facing * enemy.speed;
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
      } else if (inReachOf(player.z, enemy.z) && bodyGap(enemy, player) <= enemy.attackRange) {
        damagePlayer(state, enemy.damage, enemy.x);
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
          ARENA.leftWall + enemy.width / 2,
          ARENA.rightWall - enemy.width / 2
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
        ARENA.leftWall + enemy.width / 2,
        ARENA.rightWall - enemy.width / 2
      );
      /* The band's edges stop it the way the walls do, and it is the room's band. */
      enemy.z = clamp(enemy.z, 0, bandDepth(state.band));
    });

    updateProjectiles(state, dt);
    separateEnemies(state.enemies);
  }

  function separateEnemies(enemies) {
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
          a.x = clamp(a.x - push, ARENA.leftWall + a.width / 2, ARENA.rightWall - a.width / 2);
          b.x = clamp(b.x + push, ARENA.leftWall + b.width / 2, ARENA.rightWall - b.width / 2);
        } else {
          a.x = clamp(a.x + push, ARENA.leftWall + a.width / 2, ARENA.rightWall - a.width / 2);
          b.x = clamp(b.x - push, ARENA.leftWall + b.width / 2, ARENA.rightWall - b.width / 2);
        }
      }
    }
  }

  function resolveRoom(state) {
    var alive = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    });
    state.enemies = alive;

    if (alive.length === 0 && !state.room.cleared && !state.defeat) {
      state.room.cleared = true;
      var isLast = state.roomIndex >= state.layout.length - 1;
      if (isLast) {
        state.victory = true;
        pushBanner(state, (state.stage && state.stage.clearBanner) || "Dungeon cleared!", 2.4);
      } else {
        offerUpgrade(state);
        pushBanner(state, "房间清空 · 选一张强化卡", 1.8);
      }
      return;
    }

    var nearExit = state.player.x >= ARENA.rightWall - 60;
    if (
      state.room.cleared &&
      nearExit &&
      !state.upgradeChoice &&
      state.roomIndex < state.layout.length - 1
    ) {
      startRoom(state, state.roomIndex + 1);
    }
  }

  /**
   * Run the collapsing-floor cycle for the current room.
   *
   * Each hazard is dormant, then cracked (warned, escapable), then briefly
   * broken. Anything grounded inside the slab when it goes takes the hit, so the
   * player can also lure a brute onto one.
   */
  function updateHazards(state, dt) {
    var hazards = state.hazards;
    if (!hazards || hazards.length === 0) return;
    state.roomTime = (state.roomTime || 0) + dt;

    hazards.forEach(function (hazard) {
      var offset = state.roomTime + hazard.phase;
      var local = offset % HAZARD.period;
      var cycle = Math.floor(offset / HAZARD.period);
      var cracking = local < HAZARD.warn;
      var collapsing = !cracking && local < HAZARD.warn + HAZARD.collapse;
      hazard.stage = cracking ? "cracking" : collapsing ? "collapsing" : "dormant";

      if (cracking && hazard.warnedCycle !== cycle) {
        hazard.warnedCycle = cycle;
        state.effects.push({
          kind: "telegraph",
          text: "CRACK",
          x: hazard.x,
          y: ARENA.groundY,
          radius: hazard.radius,
          dir: 0,
          life: HAZARD.warn,
          maxLife: HAZARD.warn
        });
      }
      if (!collapsing || hazard.resolvedCycle === cycle) return;
      hazard.resolvedCycle = cycle;

      var player = state.player;
      var groundedPlayer =
        !player.dead && player.y >= ARENA.groundY - 26 && Math.abs(player.x - hazard.x) <= hazard.radius;
      if (groundedPlayer) damagePlayer(state, HAZARD.playerDamage, hazard.x);

      state.enemies.slice().forEach(function (enemy) {
        if (enemy.dead || !enemy.onGround) return;
        if (Math.abs(enemy.x - hazard.x) > hazard.radius) return;
        damageEnemy(state, enemy, HAZARD.enemyDamage, 0, hazard.x, {
          knockdown: HAZARD.enemyKnockdown,
          noBloodOrbs: true
        });
      });

      /* Its own effect kind, so the shell can give the floor a distinct cue. */
      state.stats.collapses += 1;
      state.effects.push({
        kind: "collapse",
        x: hazard.x,
        y: ARENA.groundY,
        radius: hazard.radius,
        life: 0.6,
        maxLife: 0.6
      });
    });
  }

  function updatePickups(state, dt) {
    var player = state.player;
    var remaining = [];

    state.pickups.forEach(function (drop) {
      drop.life -= dt;
      if (drop.life <= 0) return;

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

  function step(state, input, dt) {
    dt = typeof dt === "number" && dt > 0 ? dt : DT;
    input = normalizeInput(input);

    state.time += dt;
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
    updateHazards(state, dt);
    updatePickups(state, dt);
    resolveRoom(state);
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
    BLOOD_ORB: BLOOD_ORB,
    HELLBENTER: HELLBENTER,
    ENEMY_TYPES: ENEMY_TYPES,
    REGION: REGION,
    STAGES: STAGES,
    DEFAULT_STAGE: DEFAULT_STAGE,
    RUN_COMBAT_ROOMS: RUN_COMBAT_ROOMS,
    layoutForSeed: layoutForSeed,
    roomThreat: roomThreat,
    rampRooms: rampRooms,
    MINIMAP: MINIMAP,
    minimapFor: minimapFor,
    UPGRADES: UPGRADES,
    UPGRADE_ORDER: UPGRADE_ORDER,
    UPGRADES_PER_ROOM: UPGRADES_PER_ROOM,
    HAZARD: HAZARD,
    DEFAULT_SEED: DEFAULT_SEED,
    clamp: clamp,
    createState: createState,
    createPlayer: createPlayer,
    createEnemy: createEnemy,
    startRoom: startRoom,
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
