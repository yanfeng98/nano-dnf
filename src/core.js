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
    groundY: 460,
    leftWall: 24,
    rightWall: 936
  };

  var PHYSICS = {
    gravity: 2200,
    moveSpeed: 265,
    jumpVelocity: -760,
    maxFallSpeed: 1400
  };

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
       * recovery - but a whole three seconds read as sluggish, so the cast is
       * 1.5s and the blade connects on the landing.
       */
      duration: 1.5,
      /* seconds: the hop starts at 0.33s and lands at ~1.04s, so the blade and
         its ground wave connect at 1.05s - while he is still in the air the box
         sits above the enemies and nothing lands. */
      activeFrom: 1.05,
      activeTo: 1.15,
      reach: 96,
      heightPad: 18,
      knockbackX: 240,
      launch: 0,
      radius: 0,
      hits: 1,
      /* DNF shape: leap smash that knocks the target down. */
      knockdown: 1.1,
      /*
       * The hop carries him forward and, per the owner, has to look like a real
       * jump: -780 peaks about 138px up (gravity is 2200) for ~0.71s in the air,
       * and the 150px/s push covers about 105px before he lands on the smash. It
       * starts just after the raise.
       */
      leap: 150,
      leapUp: -780,
      leapFrom: 0.22,
      /* The leap's landing frames are invulnerable, DNF style: the Slayer is
         committed to the smash and cannot be knocked out of the air - the window
         has to cover the whole hop plus the landing hit, or a grunt standing
         where he comes down cancels the move before the blade connects. */
      leapInvuln: 0.95,
      shockwave: {
        reach: 150,
        damage: 10,
        growth: 2,
        heightPad: 10,
        knockbackX: 200,
        knockdown: 0.7,
        extraWaveFromLevel: 5
      }
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
      duration: 1.05,
      /*
       * The two hits are the two halves of one whirl, and they land as he comes
       * down: the leap starts at 0.13s and lands at ~0.72s (leapUp -640 at
       * gravity 2200), so the blade sweeps on the way down and the rift opens on
       * the landing.
       */
      activeFrom: 0.72,
      activeTo: 0.95,
      /*
       * 大蹦 is the 45-level ultimate: one giant blood sword plus the rift it
       * opens. The owner's read is that its range has to dwarf 崩山击's single
       * smash, so both the sword and the ground wave reach much further than
       * the leap smash does.
       */
      reach: 200,
      heightPad: 36,
      knockbackX: 300,
      launch: 0,
      /*
       * The rift opens around the impact rather than only in front of it: the
       * leap already carries him past whatever he jumped over, and a forward-only
       * box left the ultimate missing the target it landed on.
       */
      radius: 190,
      hits: 2,
      /* DNF shape: leap up, then split the ground with a huge shockwave. */
      leap: 150,
      leapUp: -640,
      leapFrom: 0.12,
      knockdown: 1.4,
      shockwave: {
        reach: 360,
        damage: 18,
        growth: 3,
        heightPad: 30,
        knockbackX: 340,
        knockdown: 1.4,
        extraWaveFromLevel: 4
      }
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
        { type: "caster", x: 600 },
        { type: "elite", x: 780 },
        { type: "charger", x: 920 }
      ]
    },
    {
      /* The alternate: a wider, slower room that trades the charger for bodies. */
      name: "Sunken Chapel",
      enemies: [
        { type: "caster", x: 560 },
        { type: "brute", x: 720 },
        { type: "grunt", x: 860 }
      ],
      /* Two slabs give way on offset cycles, so the safe ground keeps moving. */
      hazards: [
        { x: 640 },
        { x: 850 }
      ]
    },
    {
      name: "Goblin King's Hall",
      enemies: [
        { type: "grunt", x: 520 },
        { type: "boss", x: 740 }
      ]
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
      vx: 0,
      vy: 0,
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
      attackDir: 1,
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
      hurtTimer: 0,
      dead: false
    };
  }

  function createEnemy(state, type, x) {
    var spec = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    var jitter = (nextRandom(state) * 2 - 1) * 14;
    return {
      kind: "enemy",
      id: state.nextEnemyId++,
      type: type,
      x: clamp(x + jitter, ARENA.leftWall + spec.width, ARENA.rightWall - spec.width),
      y: ARENA.groundY,
      vx: 0,
      vy: 0,
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
    state.enemies = spec.enemies.map(function (entry) {
      return createEnemy(state, entry.type, entry.x);
    });
    state.player.x = 110;
    state.player.y = ARENA.groundY;
    state.player.vx = 0;
    state.player.vy = 0;
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
    /* A dive carries its own forward speed down, for the same reason. */
    var divingDown =
      player.skillTimer > 0 && SKILLS[player.skillId] && SKILLS[player.skillId].dive > 0;
    if (direction !== 0) player.facing = direction;
    if (rooted && !dashing && !leaping && !divingDown) {
      player.vx *= 0.25;
    } else if (!rooted) {
      player.vx = direction * PHYSICS.moveSpeed;
    }

    if (input.jump && player.onGround && !rooted) {
      player.vy = PHYSICS.jumpVelocity;
      player.onGround = false;
    }

    if (!player.onGround) {
      player.vy = Math.min(player.vy + PHYSICS.gravity * dt, PHYSICS.maxFallSpeed);
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

    if (player.y >= ARENA.groundY) {
      player.y = ARENA.groundY;
      player.vy = 0;
      player.onGround = true;
    }
    player.x = clamp(
      player.x,
      ARENA.leftWall + player.width / 2,
      ARENA.rightWall - player.width / 2
    );

    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
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
      player.attackDir = player.facing;
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
          if (boxesOverlap(box, bodyBox(enemy))) {
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
          if (active.radius > 0 && Math.abs(enemy.x - player.x) <= active.radius) {
            applySkillHit(state, enemy, skillDamage, active, hitIndex);
            struck.push(enemy.id);
          } else if (active.radius <= 0 && boxesOverlap(skillBox, bodyBox(enemy))) {
            applySkillHit(state, enemy, skillDamage, active, hitIndex);
            struck.push(enemy.id);
          }
        });

        if (active.shockwave && hitIndex === hitCount - 1) {
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
            if (boxesOverlap(waveBox, bodyBox(enemy))) {
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
            x: player.x + player.facing * wave.reach * 0.4,
            y: ARENA.groundY,
            radius: (wave.reach + extraWave * 80) * 0.8,
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
      if (player.skillTimer === 0) player.skillId = null;
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

  function pushTelegraph(state, enemy, label, radius, life, dir) {
    state.effects.push({
      kind: "telegraph",
      text: label,
      x: enemy.x,
      y: ARENA.groundY,
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
        Math.abs(shot.y - (player.y - player.height / 2)) <= player.height / 2 + shot.radius;
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
    return boxesOverlap(bodyBox(enemy), bodyBox(player));
  }

  /* A spin sweeps a wider hitbox than the body, so stepping one body-width
   * aside is not enough - the whole lane has to be cleared. */
  function spinHitsPlayer(enemy, player, radius) {
    var swept = bodyBox(enemy);
    swept.left -= radius * 0.5;
    swept.right += radius * 0.5;
    return boxesOverlap(swept, bodyBox(player));
  }

  function chooseEnemyAction(state, enemy, player) {
    var delta = player.x - enemy.x;
    var distance = Math.abs(delta);
    if (!player.dead) enemy.facing = delta >= 0 ? 1 : -1;
    if (player.dead) {
      enemy.vx = 0;
      return;
    }

    if (enemy.behavior === "ranged") {
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
        if (!player.dead && onGround && Math.abs(player.x - enemy.x) <= enemy.slam.radius) {
          damagePlayer(state, enemy.slam.damage, enemy.x);
        }
        enemy.slamCooldown = enemy.slam.cooldown;
        enemy.attackCooldown = enemy.attackCooldownMax;
      } else if (Math.abs(player.x - enemy.x) <= enemy.attackRange) {
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
        enemy.vx = 0;
        enemy.vy = 0;
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
      } else if (enemy.attackTimer > 0) {
        enemy.vx *= 0.5;
      } else if (
        !enemy.onGround ||
        enemy.knockdown > 0 ||
        enemy.stun > 0 ||
        enemy.grabbed > 0
      ) {
        /* Launched, knocked down or stunned enemies cannot act. */
        enemy.vx *= 0.98;
      } else {
        chooseEnemyAction(state, enemy, player);
      }

      if (enemy.attackTimer > 0) {
        advanceEnemyAttack(state, enemy, player, dt);
      }

      enemy.vy = Math.min(enemy.vy + PHYSICS.gravity * dt, PHYSICS.maxFallSpeed);
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
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
