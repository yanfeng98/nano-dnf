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

  function attackSpeedOf(player) {
    var speed = Number(player && player.attackSpeed);
    if (!isFinite(speed) || speed <= 0) return PLAYER.attackSpeed;
    var base = Math.min(MAX_ATTACK_SPEED, Math.max(MIN_ATTACK_SPEED, speed));
    /* 血之狂暴 is the dual-blade stance: it reads as the Slayer swinging faster. */
    var raging = player && player.buffs && player.buffs.bloodRage > 0;
    return Math.min(MAX_ATTACK_SPEED, raging ? base * 1.25 : base);
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
      damage: 18,
      growth: 3,
      duration: 0.42,
      activeFrom: 0.1,
      activeTo: 0.26,
      reach: 84,
      heightPad: 30,
      knockbackX: 180,
      launch: 0,
      radius: 0,
      hits: 2,
      /* DNF shape: cross cut that leaves the target bleeding. */
      bleed: { damage: 4, growth: 1, duration: 3, interval: 1, fromLevel: 2 }
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
       * DNF shape: 血之狂暴 is the dual-blade stance, not a damage move. It
       * costs HP to keep up and buys attack speed and shorter skill cooldowns
       * while it lasts.
       *
       * It is a buffer in the DNF sense: the state has no timer at all (the
       * owner's read of the client is "cast it again to take it down"), so the
       * duration is Infinity and the toggle flag is what turns the second cast
       * into a cancel. Nothing else in the buff machinery changes - the stance
       * is still a number in player.buffs, so attack speed and cooldowns keep
       * reading it the way they always did.
       */
      buff: {
        id: "bloodRage",
        duration: Infinity,
        toggle: true,
        attackSpeed: 1.25,
        cooldownScale: 1.4,
        hpCost: 6
      }
    },
    bloodyRave: {
      id: "bloodyRave",
      name: "血气爆发",
      key: "H",
      mp: 16,
      cooldown: 4.5,
      damage: 16,
      growth: 3,
      duration: 0.5,
      activeFrom: 0.14,
      activeTo: 0.3,
      reach: 104,
      heightPad: 26,
      knockbackX: 90,
      launch: -380,
      radius: 0,
      hits: 1,
      /* DNF shape: a rising wave that lifts whatever it touches. */
      juggle: true,
      shockwave: {
        reach: 170,
        damage: 8,
        growth: 2,
        heightPad: 26,
        knockbackX: 60,
        launch: -340,
        extraWaveFromLevel: 6
      }
    },
    rageBurst: {
      id: "rageBurst",
      name: "怒气爆发",
      key: "T",
      mp: 24,
      cooldown: 6.5,
      damage: 15,
      growth: 3,
      duration: 0.66,
      activeFrom: 0.18,
      activeTo: 0.52,
      reach: 0,
      heightPad: 0,
      knockbackX: 180,
      launch: -430,
      radius: 152,
      hits: 3,
      /* DNF shape: 怒气爆发 erupts around the Slayer - blood pillars out of the
         ground, three hits, and everything caught is lifted into the air. */
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
      name: "抓头",
      key: "U",
      mp: 20,
      cooldown: 7,
      damage: 24,
      growth: 3,
      duration: 0.9,
      activeFrom: 0.1,
      activeTo: 0.6,
      reach: 52,
      heightPad: 12,
      knockbackX: 0,
      launch: 0,
      radius: 0,
      hits: 2,
      /* DNF shape: grab the target, hold it, slam it down and drain some HP. */
      grab: { hold: 0.45, slamKnockdown: 1.1 },
      drain: 0.25,
      ignoresSuperArmor: true
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
    "mountainRift"
  ];
  /*
   * Every skill the Slayer can end up casting, in the order the cooldown table
   * and its countdown walk. 银光落刃 is in here but not in SKILL_ORDER: it has no
   * hotbar slot, no icon and no effect row of its own (SKILL_ORDER drives all
   * three), so it stays a Z-in-the-air move only.
   */
  var CASTABLE_SKILLS = SKILL_ORDER.concat(["silverFall"]);

  var PROGRESSION = {
    baseXpToNext: 30,
    growth: 1.6,
    maxHpPerLevel: 12,
    maxMpPerLevel: 5,
    attackPerLevel: 2,
    healOnLevelUp: 12,
    maxLevel: 12
  };

  var DROPS = {
    orbRadius: 13,
    pickupRadius: 32,
    playerHeal: 18,
    eliteHeal: 30,
    bossHeal: 42,
    gruntDropChance: 0.5,
    lifetimeSeconds: 14,
    gravity: 1500
  };

  /*
   * 血之狂暴 pulls blood out of whatever the Slayer hits: a landed hit has a
   * chance to draw an orb that flies into him and heals on arrival. The orb
   * ignores gravity on purpose - it is being pulled towards him, not dropped.
   */
  var BLOOD_ORB = {
    chance: 0.34,
    heal: 4,
    radius: 9,
    speed: 620,
    lifetimeSeconds: 1.6
  };

  var ENEMY_TYPES = {
    grunt: {
      behavior: "melee",
      maxHp: 32,
      xp: 10,
      width: 30,
      height: 58,
      speed: 95,
      damage: 6,
      attackRange: 46,
      attackWindup: 0.28,
      attackDuration: 0.5,
      attackCooldown: 1.05,
      knockbackX: 150
    },
    brute: {
      behavior: "melee",
      maxHp: 68,
      xp: 22,
      width: 40,
      height: 70,
      speed: 68,
      damage: 13,
      attackRange: 54,
      attackWindup: 0.42,
      attackDuration: 0.7,
      attackCooldown: 1.5,
      knockbackX: 200
    },
    caster: {
      behavior: "ranged",
      maxHp: 26,
      xp: 14,
      width: 30,
      height: 56,
      speed: 76,
      damage: 7,
      attackRange: 210,
      keepRange: 150,
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
      attackRange: 170,
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
      maxHp: 150,
      xp: 45,
      width: 46,
      height: 78,
      speed: 72,
      damage: 16,
      attackRange: 64,
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
        radius: 84,
        damage: 14
      }
    },
    boss: {
      behavior: "boss",
      maxHp: 260,
      xp: 80,
      width: 56,
      height: 96,
      speed: 88,
      damage: 18,
      attackRange: 74,
      attackWindup: 0.36,
      attackDuration: 0.66,
      attackCooldown: 1.15,
      knockbackX: 260,
      chargeSpeed: 430,
      chargeFrom: 0.22,
      chargeTo: 0.62,
      slam: {
        radius: 150,
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
          range: 210,
          minRange: 96,
          speed: 430,
          windup: 0.34,
          recovery: 0.5,
          cooldown: 4.2
        }
      }
    }
  };

  var ROOMS = [
    {
      name: "Forsaken Alley",
      enemies: [
        { type: "grunt", x: 620 },
        { type: "grunt", x: 790 }
      ]
    },
    {
      name: "Bloody Culvert",
      enemies: [
        { type: "grunt", x: 540 },
        { type: "caster", x: 700 },
        { type: "brute", x: 760 },
        { type: "grunt", x: 890 }
      ]
    },
    {
      name: "Ossuary Gate",
      enemies: [
        { type: "charger", x: 600 },
        { type: "brute", x: 760 },
        { type: "brute", x: 870 }
      ]
    },
    {
      /*
       * The gauntlet before the throne: caster pressure, the elite mini-boss and
       * a charger that punishes a Slayer caught mid-air. Spacing is deliberate -
       * each threat needs room to telegraph before the next one commits.
       */
      name: "Broken Span",
      enemies: [
        /*
         * A caster keeps its distance, and it has two axes to keep it on: it
         * opens the fight standing back rather than on the Slayer's row, so the
         * first thing this fight asks for is a step into the screen - and it
         * holds that row (see chooseEnemyAction), so the step has to be taken.
         * `depth` is a share of the room's floor, not a distance: a room that
         * knows how deep its floor is can still say "a third back", and the same
         * number means the same place whatever the floor turns out to be.
         */
        { type: "caster", x: 600, depth: 0.37 },
        { type: "elite", x: 780 },
        { type: "charger", x: 920 }
      ]
    },
    {
      /* The alternate: a wider, slower room that trades the charger for bodies. */
      name: "Sunken Chapel",
      enemies: [
        { type: "caster", x: 560, depth: 0.3 },
        { type: "brute", x: 720 },
        { type: "grunt", x: 860 }
      ],
      /* Two slabs give way on offset cycles, so the safe ground keeps moving. */
      hazards: [
        { x: 640 },
        { x: 850 }
      ],
      /*
       * Wider than the default floor, which is what the room already says it is:
       * 150 screen px against 120, 682 z against 545, so a third more floor to
       * cross and to dodge across. The slabs cover the whole of it either way -
       * they are a timing puzzle, not a walk-around.
       */
      band: { backY: 280 }
    },
    {
      name: "Goblin King's Hall",
      enemies: [
        { type: "grunt", x: 520 },
        { type: "boss", x: 740 }
      ],
      /*
       * And the throne room is the other way: a ledge, 60 screen px against 120.
       * The King's slam is a disc on the floor, so a narrow floor is what makes
       * it bite - there is nowhere to stand aside to, and the way out is the
       * jump it has always had. A room with less floor is a room with fewer
       * answers, which is what the last room should be.
       */
      band: { backY: 370 }
    }
  ];

  /*
   * A run is not the whole pool. The gauntlet always sits directly before the
   * throne; the three rooms ahead of it are drawn from the rest of the pool, so
   * two seeds differ in both order and which room they skip.
   */
  var BOSS_ROOM_INDEX = ROOMS.length - 1;
  var GAUNTLET_ROOM_INDEX = 3;
  var ALTERNATE_ROOM_INDEX = 4;
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
  function roomThreat(index) {
    return ROOMS[index].enemies.reduce(function (total, entry) {
      var spec = ENEMY_TYPES[entry.type] || ENEMY_TYPES.grunt;
      return total + spec.maxHp;
    }, 0);
  }

  /**
   * The gentlest half of the pool. A run opens on one of these: seeding the
   * order used to be able to put the hardest room first, at level one with no
   * upgrades, which is a spike rather than a ramp.
   */
  function rampRooms() {
    var pool = [];
    for (var index = 0; index < BOSS_ROOM_INDEX; index += 1) {
      if (index !== GAUNTLET_ROOM_INDEX) pool.push(index);
    }
    pool.sort(function (a, b) {
      return roomThreat(a) - roomThreat(b) || a - b;
    });
    return pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  }

  /** The room order for one seed: a ramp room, two more, the gauntlet, the boss. */
  function layoutForSeed(seed) {
    var next = layoutRandom(seed);
    var ramps = rampRooms();
    var opening = ramps[Math.min(ramps.length - 1, Math.floor(next() * ramps.length))];

    var rest = [];
    for (var index = 0; index < BOSS_ROOM_INDEX; index += 1) {
      if (index !== GAUNTLET_ROOM_INDEX && index !== opening) rest.push(index);
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
      .concat([GAUNTLET_ROOM_INDEX, BOSS_ROOM_INDEX]);
  }

  var DEFAULT_SEED = 20260915;

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
      airHitTimer: 0,
      /* Timed self-buffs (血之狂暴 is the only one so far). */
      buffs: {},
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
    return {
      left: !!input.left,
      right: !!input.right,
      /* Walking into and out of the screen: the second ground axis. */
      up: !!input.up,
      down: !!input.down,
      jump: !!input.jump,
      attack: !!input.attack,
      skills: {
        upSlash: !!skills.upSlash,
        mountainBreaker: !!skills.mountainBreaker,
        crossSlash: !!skills.crossSlash,
        bloodSword: !!skills.bloodSword,
        frenzy: !!skills.frenzy,
        bloodyRave: !!skills.bloodyRave,
        rageBurst: !!skills.rageBurst,
        bloodSnatch: !!skills.bloodSnatch,
        graspHead: !!skills.graspHead,
        bloodEvil: !!skills.bloodEvil,
        mountainRift: !!skills.mountainRift
      }
    };
  }

  function createState(options) {
    options = options || {};
    var state = {
      seed: typeof options.seed === "number" ? options.seed : DEFAULT_SEED,
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
      nextEnemyId: 1,
      nextProjectileId: 1,
      stats: { hits: 0, kills: 0, damageDealt: 0, damageTaken: 0, airHits: 0, collapses: 0, bloodOrbs: 0 },
      upgradeChoice: null,
      layout: null,
      victory: false,
      defeat: false
    };
    state.rngState = state.seed >>> 0;
    state.layout = layoutForSeed(state.seed);
    state.player = createPlayer(options.startX || 110);
    startRoom(state, options.roomIndex || 0);
    return state;
  }

  function startRoom(state, index) {
    var layout = state.layout || layoutForSeed(state.seed);
    state.layout = layout;
    var roomIndex = clamp(index, 0, layout.length - 1);
    var spec = ROOMS[layout[roomIndex]];
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
    state.pickups = [];
    state.projectiles = [];
    /* A new room is a new floor: nothing he opened in the last one burns here. */
    state.fields = [];
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
      text: "Room " + (roomIndex + 1) + " - " + spec.name,
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

  function attackBox(player, reach, heightPad) {
    var left = player.facing > 0 ? player.x : player.x - reach;
    return {
      left: left,
      right: left + reach,
      bottom: player.y + heightPad,
      top: player.y - player.height - heightPad
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

  function spawnDrop(state, enemy) {
    var value = 0;
    if (enemy.type === "boss") {
      value = DROPS.bossHeal;
    } else if (enemy.type === "elite") {
      /* A mini-boss always pays out: the gauntlet should leave you able to fight. */
      value = DROPS.eliteHeal;
    } else if (enemy.type === "brute" || nextRandom(state) < DROPS.gruntDropChance) {
      value = DROPS.playerHeal;
    }
    if (value <= 0) return null;
    var drop = {
      kind: "heal_orb",
      x: enemy.x,
      y: enemy.y - enemy.height - 18,
      /* It falls where the body was, so it lands on the body's own floor. */
      z: enemy.z || 0,
      vy: -180,
      radius: DROPS.orbRadius,
      value: value,
      life: DROPS.lifetimeSeconds
    };
    state.pickups.push(drop);
    return drop;
  }

  /** The blood 血之狂暴 pulls out of a monster it just hit. */
  function spawnBloodOrb(state, enemy) {
    var orb = {
      kind: "blood_orb",
      x: enemy.x,
      y: enemy.y - enemy.height * 0.55,
      z: enemy.z || 0,
      vy: 0,
      radius: BLOOD_ORB.radius,
      value: BLOOD_ORB.heal,
      life: BLOOD_ORB.lifetimeSeconds,
      speed: BLOOD_ORB.speed
    };
    state.pickups.push(orb);
    state.stats.bloodOrbs += 1;
    return orb;
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
    pushBanner(state, phase2.banner, 1.8);
    return true;
  }

  function damageEnemy(state, enemy, amount, knockbackX, sourceX, options) {
    if (enemy.dead) return 0;
    var opts = options || {};
    var applied = Math.max(0, Math.round(amount));
    enemy.hp -= applied;
    state.stats.hits += 1;
    state.stats.damageDealt += applied;
    pushDamageEffect(state, enemy.x, enemy.y - enemy.height - 6, applied);
    /*
     * 血之狂暴: while the stance is up, a landed hit can draw blood out of the
     * monster. Bleed ticks and the chapel floor hit monsters too, but they are
     * not the Slayer's own swings, so those calls opt out with noBloodOrbs.
     */
    if (applied > 0 && !opts.noBloodOrbs && state.player.buffs.bloodRage > 0) {
      if (nextRandom(state) < BLOOD_ORB.chance) spawnBloodOrb(state, enemy);
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
    if (opts.bleed) {
      enemy.bleed = {
        damage: opts.bleed.damage,
        remaining: opts.bleed.duration,
        timer: opts.bleed.interval
      };
    }
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
      pushBanner(state, enemy.type === "boss" ? "Boss down!" : "Enemy down", 0.9);
      spawnDrop(state, enemy);
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
    var span = (1 - field.from) * spec.duration;
    state.fields.push({
      skillId: skillId,
      from: field.from,
      x: caster.x,
      y: caster.y,
      /*
       * The depth is part of the spot, not a detail of the caster. A rift opened
       * four Slayer-heights into the screen that starts drawing itself on the
       * ground line the moment the arena takes it over is a rift in the wrong
       * place - and it is the handover, not the cast, that used to lose it.
       */
      z: caster.z || 0,
      facing: caster.facing,
      clock: Math.max(0, (progress - field.from) * spec.duration),
      span: span,
      life: span + field.linger
    });
    return state.fields[state.fields.length - 1];
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

  function damagePlayer(state, amount, sourceX) {
    var player = state.player;
    if (player.dead || player.invuln > 0) return 0;
    var applied = Math.max(0, Math.round(amount));
    player.hp -= applied;
    state.stats.damageTaken += applied;
    pushDamageEffect(state, player.x, player.y - player.height - 6, applied);
    player.invuln = PLAYER.invulnAfterHit;
    player.hurtTimer = PLAYER.hurtStun;
    player.vx = (player.x >= sourceX ? 1 : -1) * PLAYER.knockbackX;
    player.attackTimer = 0;
    /*
     * A hit cuts the cast short - and the fire he had already opened stays on
     * the floor where he opened it (see spawnField). The knockback above is a
     * velocity, so his x is still the spot he was standing on.
     */
    var interrupted = player.skillId && SKILLS[player.skillId];
    if (interrupted) {
      spawnField(
        state,
        player.skillId,
        1 - player.skillTimer / interrupted.duration,
        player
      );
    }
    player.skillId = null;
    player.skillTimer = 0;
    player.comboTimer = 0;
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
      player.vx = direction * PHYSICS.moveSpeed;
      player.vz = depthDirection * depthSpeed();
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
    if (player.comboTimer === 0) player.comboIndex = 0;
    player.mp = Math.min(player.maxMp, player.mp + player.mpRegen * dt);

    /* 血之狂暴 shortens every skill's cooldown while it is up. */
    var cooldownScale = player.buffs.bloodRage > 0 ? 1.4 : 1;
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
    var castSkill = wantsAirDive ? "silverFall" : SKILL_ORDER.filter(function (skillId) {
      var spec = SKILLS[skillId];
      return (
        input.skills[skillId] &&
        player.skillTimer <= 0 &&
        (player.attackTimer <= 0 || attackRecovering) &&
        player.skillCooldowns[skillId] <= 0 &&
        player.mp >= spec.mp
      );
    })[0];

    if (castSkill) {
      var skillSpec = SKILLS[castSkill];
      player.mp -= skillSpec.mp;
      player.skillId = castSkill;
      player.skillTimer = skillSpec.duration;
      player.skillHitDone = false;
      player.skillHitsDone = 0;
      player.skillCooldowns[castSkill] = skillSpec.cooldown;
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
      player.attackCooldown <= 0
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
      player.comboTimer = PLAYER.comboWindow;
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
        var damage = PLAYER.comboDamage[player.comboIndex] + player.attackBonus;
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
      var hitSpan = (active.activeTo - active.activeFrom) / hitCount;

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

      while (
        player.skillHitsDone < hitCount &&
        skillElapsed >= active.activeFrom + player.skillHitsDone * hitSpan
      ) {
        var hitIndex = player.skillHitsDone;
        player.skillHitsDone += 1;
        player.skillHitDone = player.skillHitsDone >= hitCount;

        var skillBox = attackBox(player, active.reach, active.heightPad);
        if (active.buff) {
          /*
           * A buff skill pays its HP cost and goes up; it does not swing.
           *
           * 血之狂暴 is a stance rather than a timer (duration: Infinity): it
           * stays up until the skill is cast again, and casting it again takes
           * it down and costs nothing. Everything else keeps the old shape.
           */
          var stanceUp = player.buffs[active.buff.id] > 0;
          if (active.buff.toggle && stanceUp) {
            player.buffs[active.buff.id] = 0;
            state.effects.push({
              kind: "stance",
              up: false,
              x: player.x,
              y: player.y - player.height * 0.5,
              life: 0.5,
              maxLife: 0.5
            });
            pushBanner(state, active.name + " 解除", 1.1);
          } else {
            if (active.buff.hpCost) {
              player.hp = Math.max(1, player.hp - active.buff.hpCost);
            }
            player.buffs[active.buff.id] = active.buff.duration;
            if (active.buff.toggle) {
              state.effects.push({
                kind: "stance",
                up: true,
                x: player.x,
                y: player.y - player.height * 0.5,
                life: 0.5,
                maxLife: 0.5
              });
              pushBanner(state, active.name, 1.1);
            }
          }
        }
        var skillDamage = Math.round(
          (active.damage + (player.level - 1) * active.growth + player.attackBonus) *
            player.skillPower
        );
        var struck = [];
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
         * The cast is over but the ground is not: whatever it opened goes on
         * burning where it is, which is how the reference ends - him on his
         * feet at 3.97s with the cracks still lit.
         */
        spawnField(state, active.id, 1, player);
        player.skillId = null;
      }
    }
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
    if (skill.bleed && hitIndex === 0 && state.player.level >= (skill.bleed.fromLevel || 1)) {
      options.bleed = {
        damage: skill.bleed.damage + (state.player.level - 1) * skill.bleed.growth,
        duration: skill.bleed.duration,
        interval: skill.bleed.interval
      };
    }

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

  function chooseEnemyAction(state, enemy, player) {
    var delta = player.x - enemy.x;
    var distance = Math.abs(delta);
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
      if (distance < keep) {
        enemy.vx = -enemy.facing * enemy.speed;
      } else if (distance > enemy.attackRange) {
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
      if (distance > enemy.attackRange * 0.8) {
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
        distance <= spinDash.radius * 1.35
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
      if (distance > enemy.attackRange * 0.8) {
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
    if (slam && enemy.slamCooldown <= 0 && enemy.attackCooldown <= 0 && distance <= slam.radius * 0.8) {
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
      distance >= lunge.minRange &&
      distance <= lunge.range
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

    if (distance > enemy.attackRange * 0.8) {
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
      } else if (inReachOf(player.z, enemy.z) && Math.abs(player.x - enemy.x) <= enemy.attackRange) {
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
        pushBanner(state, "Dungeon cleared!", 2.4);
      } else {
        offerUpgrade(state);
        pushBanner(state, "Room cleared - choose an upgrade", 1.8);
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

      var sameLevel;
      var closeEnough;
      if (drop.kind === "blood_orb") {
        /*
         * 血球 is pulled into the Slayer: it homes at his chest instead of
         * falling, so it cannot be lost to gravity or to a jump he is in the
         * middle of. The level check that ordinary drops need would drop it
         * the moment he leaves the ground.
         */
        var toX = player.x - drop.x;
        var toY = player.y - player.height * 0.55 - drop.y;
        var distance = Math.sqrt(toX * toX + toY * toY) || 1;
        var step = Math.min(distance, drop.speed * dt);
        drop.x += (toX / distance) * step;
        drop.y += (toY / distance) * step;
        sameLevel = true;
        closeEnough = distance <= DROPS.pickupRadius + player.width / 2;
      } else {
        drop.vy += DROPS.gravity * dt;
        drop.y += drop.vy * dt;
        if (drop.y >= ARENA.groundY - drop.radius) {
          drop.y = ARENA.groundY - drop.radius;
          drop.vy = 0;
        }
        sameLevel =
          Math.abs(drop.y - (player.y - player.height / 2)) <= player.height * 0.9 + drop.radius;
        closeEnough = Math.abs(drop.x - player.x) <= DROPS.pickupRadius + player.width / 2;
      }
      if (!player.dead && closeEnough && sameLevel) {
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
    DROPS: DROPS,
    BLOOD_ORB: BLOOD_ORB,
    ENEMY_TYPES: ENEMY_TYPES,
    ROOMS: ROOMS,
    BOSS_ROOM_INDEX: BOSS_ROOM_INDEX,
    GAUNTLET_ROOM_INDEX: GAUNTLET_ROOM_INDEX,
    ALTERNATE_ROOM_INDEX: ALTERNATE_ROOM_INDEX,
    RUN_COMBAT_ROOMS: RUN_COMBAT_ROOMS,
    layoutForSeed: layoutForSeed,
    roomThreat: roomThreat,
    rampRooms: rampRooms,
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
    spawnDrop: spawnDrop,
    spawnProjectile: spawnProjectile,
    updateProjectiles: updateProjectiles,
    updatePickups: updatePickups,
    nextRandom: nextRandom,
    step: step,
    runFrames: runFrames
  };
});
