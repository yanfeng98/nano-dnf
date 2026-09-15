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

  var PLAYER = {
    maxHp: 120,
    maxMp: 100,
    width: 34,
    height: 64,
    attackDuration: 0.22,
    attackCooldown: 0.16,
    attackActiveFrom: 0.05,
    attackActiveTo: 0.14,
    attackReach: 68,
    attackHeightPad: 10,
    comboDamage: [8, 10, 15],
    comboWindow: 0.45,
    maxCombo: 3,
    invulnAfterHit: 0.9,
    hurtStun: 0.22,
    knockbackX: 190,
    mpRegenPerSecond: 7
  };

  var SKILL = {
    name: "Whirlwind Slash",
    cost: 30,
    damage: 26,
    duration: 0.5,
    activeFrom: 0.12,
    activeTo: 0.34,
    radius: 120,
    knockbackX: 260
  };

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
    bossHeal: 42,
    gruntDropChance: 0.5,
    lifetimeSeconds: 14,
    gravity: 1500
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
      slam: {
        radius: 150,
        damage: 20,
        windup: 0.7,
        recovery: 0.5,
        cooldown: 3.6
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
      name: "Goblin King's Hall",
      enemies: [
        { type: "grunt", x: 520 },
        { type: "boss", x: 740 }
      ]
    }
  ];

  var DEFAULT_SEED = 20260915;

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
      attackTimer: 0,
      attackCooldown: 0,
      attackDir: 1,
      attackHitDone: false,
      comboIndex: 0,
      comboTimer: 0,
      skillTimer: 0,
      skillHitDone: false,
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
      slam: spec.slam || null,
      slamCooldown: spec.slam ? spec.slam.cooldown * 0.5 : 0,
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
    return {
      left: !!input.left,
      right: !!input.right,
      jump: !!input.jump,
      attack: !!input.attack,
      skill: !!input.skill
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
      stats: { hits: 0, kills: 0, damageDealt: 0, damageTaken: 0 },
      victory: false,
      defeat: false
    };
    state.rngState = state.seed >>> 0;
    state.player = createPlayer(options.startX || 110);
    startRoom(state, options.roomIndex || 0);
    return state;
  }

  function startRoom(state, index) {
    var roomIndex = clamp(index, 0, ROOMS.length - 1);
    var spec = ROOMS[roomIndex];
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
    state.player.skillTimer = 0;
    state.player.attackHitDone = false;
    state.player.skillHitDone = false;
    state.player.comboTimer = 0;
    state.pickups = [];
    state.projectiles = [];
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

  function spawnDrop(state, enemy) {
    var value = 0;
    if (enemy.type === "boss") {
      value = DROPS.bossHeal;
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

  function damageEnemy(state, enemy, amount, knockbackX, sourceX) {
    if (enemy.dead) return 0;
    var applied = Math.max(0, Math.round(amount));
    enemy.hp -= applied;
    state.stats.hits += 1;
    state.stats.damageDealt += applied;
    pushDamageEffect(state, enemy.x, enemy.y - enemy.height - 6, applied);
    var direction = enemy.x >= sourceX ? 1 : -1;
    enemy.vx = direction * knockbackX;
    enemy.hurtTimer = 0.18;
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.dead = true;
      state.stats.kills += 1;
      pushBanner(state, enemy.type === "boss" ? "Boss down!" : "Enemy down", 0.9);
      spawnDrop(state, enemy);
      grantXp(state, enemy.xp);
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

    if (direction !== 0) player.facing = direction;
    if (rooted) {
      player.vx *= 0.25;
    } else {
      player.vx = direction * PHYSICS.moveSpeed;
    }

    if (input.jump && player.onGround && !rooted) {
      player.vy = PHYSICS.jumpVelocity;
      player.onGround = false;
    }

    if (!player.onGround) {
      player.vy = Math.min(player.vy + PHYSICS.gravity * dt, PHYSICS.maxFallSpeed);
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
    if (player.comboTimer === 0) player.comboIndex = 0;
    player.mp = Math.min(player.maxMp, player.mp + PLAYER.mpRegenPerSecond * dt);

    if (input.skill && player.skillTimer <= 0 && player.attackTimer <= 0 && player.mp >= SKILL.cost) {
      player.mp -= SKILL.cost;
      player.skillTimer = SKILL.duration;
      player.skillHitDone = false;
    } else if (
      input.attack &&
      player.attackTimer <= 0 &&
      player.skillTimer <= 0 &&
      player.attackCooldown <= 0
    ) {
      player.attackTimer = PLAYER.attackDuration;
      player.attackCooldown = PLAYER.attackDuration + PLAYER.attackCooldown;
      player.attackDir = player.facing;
      player.comboIndex = player.comboTimer > 0 ? (player.comboIndex + 1) % PLAYER.maxCombo : 0;
      player.comboTimer = PLAYER.comboWindow;
      player.attackHitDone = false;
    }

    if (player.attackTimer > 0) {
      var elapsed = PLAYER.attackDuration - player.attackTimer;
      if (!player.attackHitDone && elapsed >= PLAYER.attackActiveFrom && elapsed <= PLAYER.attackActiveTo) {
        player.attackHitDone = true;
        var box = attackBox(player, PLAYER.attackReach, PLAYER.attackHeightPad);
        var damage = PLAYER.comboDamage[player.comboIndex] + player.attackBonus;
        state.enemies.slice().forEach(function (enemy) {
          if (enemy.dead) return;
          if (boxesOverlap(box, bodyBox(enemy))) {
            damageEnemy(state, enemy, damage, 140, player.x);
          }
        });
      }
      player.attackTimer = Math.max(0, player.attackTimer - dt);
    }

    if (player.skillTimer > 0) {
      var skillElapsed = SKILL.duration - player.skillTimer;
      if (!player.skillHitDone && skillElapsed >= SKILL.activeFrom && skillElapsed <= SKILL.activeTo) {
        player.skillHitDone = true;
        state.enemies.slice().forEach(function (enemy) {
          if (enemy.dead) return;
          if (Math.abs(enemy.x - player.x) <= SKILL.radius) {
            damageEnemy(state, enemy, SKILL.damage + player.attackBonus, SKILL.knockbackX, player.x);
          }
        });
      }
      player.skillTimer = Math.max(0, player.skillTimer - dt);
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
    enemy.attackWindup = windup;
    enemy.attackDuration = duration;
    enemy.attackTimer = duration;
    enemy.attackHitDone = false;
    enemy.attackRecovered = false;
  }

  function enemyHitsPlayer(enemy, player) {
    return boxesOverlap(bodyBox(enemy), bodyBox(player));
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

    var slam = enemy.slam;
    if (slam && enemy.slamCooldown <= 0 && distance <= slam.radius * 0.8) {
      enemy.vx = 0;
      beginEnemyAttack(enemy, "slam", slam.windup, slam.windup + slam.recovery);
      pushTelegraph(state, enemy, "SLAM", slam.radius, slam.windup, 0);
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
  }

  function updateEnemies(state, dt) {
    var player = state.player;
    state.enemies.forEach(function (enemy) {
      if (enemy.dead) return;

      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      if (enemy.slam) enemy.slamCooldown = Math.max(0, enemy.slamCooldown - dt);

      if (enemy.hurtTimer > 0) {
        enemy.vx *= 0.86;
      } else if (enemy.attackTimer > 0) {
        enemy.vx *= 0.5;
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
      var isLast = state.roomIndex >= ROOMS.length - 1;
      if (isLast) {
        state.victory = true;
        pushBanner(state, "Dungeon cleared!", 2.4);
      } else {
        pushBanner(state, "Gate open - head right", 1.6);
      }
      return;
    }

    var nearExit = state.player.x >= ARENA.rightWall - 60;
    if (state.room.cleared && nearExit && state.roomIndex < ROOMS.length - 1) {
      startRoom(state, state.roomIndex + 1);
    }
  }

  function updatePickups(state, dt) {
    var player = state.player;
    var remaining = [];

    state.pickups.forEach(function (drop) {
      drop.life -= dt;
      if (drop.life <= 0) return;

      drop.vy += DROPS.gravity * dt;
      drop.y += drop.vy * dt;
      if (drop.y >= ARENA.groundY - drop.radius) {
        drop.y = ARENA.groundY - drop.radius;
        drop.vy = 0;
      }

      var sameLevel = Math.abs(drop.y - (player.y - player.height / 2)) <= player.height * 0.9 + drop.radius;
      var closeEnough = Math.abs(drop.x - player.x) <= DROPS.pickupRadius + player.width / 2;
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
    SKILL: SKILL,
    PROGRESSION: PROGRESSION,
    DROPS: DROPS,
    ENEMY_TYPES: ENEMY_TYPES,
    ROOMS: ROOMS,
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
