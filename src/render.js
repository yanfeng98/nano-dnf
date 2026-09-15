/*
 * Canvas renderer for nano-dnf. Pure drawing: reads state, never mutates it.
 * Loaded as `window.DNFRender` in the browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.DNFRender = factory(root.DNFCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  var ARENA = Core.ARENA;
  var PALETTE = {
    night: "#05070f",
    skyTop: "#0a1020",
    skyMid: "#141d33",
    skyBottom: "#1d2438",
    wallFar: "#111726",
    wallNear: "#1b2338",
    wallEdge: "#2b3757",
    floorTop: "#2c2a44",
    floorBottom: "#120e1e",
    floorLine: "rgba(255, 214, 170, 0.08)",
    gold: "#e3bf72",
    goldDim: "#8c7338",
    hp: "#69e08a",
    hpBack: "#3a1c22",
    mp: "#5aa9ff",
    mpBack: "#1a2740",
    xp: "#ffd66b",
    xpBack: "#3a3218",
    text: "#f2f6ff",
    textDim: "rgba(226, 236, 255, 0.62)",
    danger: "#ff5f6d",
    ghost: "#b98cff"
  };

  /* assets/slayer.png: 6 columns x 5 rows of 96x96 frames. */
  var SPRITE = {
    frameW: 96,
    frameH: 96,
    anchorX: 46,
    anchorY: 88,
    rows: { idle: 0, run: 1, attack: 2, skill: 3, extras: 4 },
    extras: { hurt: 0, dead: 1, jump: 2, fall: 3 }
  };

  /* On-screen controls for touch play, laid out in arena coordinates. */
  var TOUCH_LAYOUT = [
    { action: "left", x: 22, y: 418, w: 86, h: 86, label: "←" },
    { action: "right", x: 120, y: 418, w: 86, h: 86, label: "→" },
    { action: "jump", x: 776, y: 346, w: 76, h: 76, label: "跳" },
    { action: "attack", x: 864, y: 426, w: 88, h: 88, label: "攻" },
    { action: "upSlash", x: 330, y: 452, w: 62, h: 62, label: "上挑" },
    { action: "mountainBreaker", x: 400, y: 452, w: 62, h: 62, label: "崩山" },
    { action: "crossSlash", x: 470, y: 452, w: 62, h: 62, label: "十字" },
    { action: "ghostSlash", x: 540, y: 452, w: 62, h: 62, label: "鬼斩" },
    { action: "mute", x: 878, y: 20, w: 62, h: 44, label: "音" }
  ];

  var SKILL_ACTIONS = ["upSlash", "mountainBreaker", "crossSlash", "ghostSlash"];

  function touchButtons() {
    return TOUCH_LAYOUT.map(function (entry) {
      return {
        action: entry.action,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        label: entry.label
      };
    });
  }

  function hitTestTouch(x, y) {
    for (var i = 0; i < TOUCH_LAYOUT.length; i += 1) {
      var entry = TOUCH_LAYOUT[i];
      if (x >= entry.x && x <= entry.x + entry.w && y >= entry.y && y <= entry.y + entry.h) {
        return entry.action;
      }
    }
    return null;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function panel(ctx, x, y, w, h, radius) {
    ctx.save();
    ctx.fillStyle = "rgba(9, 12, 22, 0.82)";
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.55)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, x + 0.7, y + 0.7, w - 1.4, h - 1.4, radius);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120, 160, 220, 0.22)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, Math.max(2, radius - 2));
    ctx.stroke();
    ctx.restore();
  }

  function bar(ctx, x, y, w, h, ratio, topColor, bottomColor, backColor) {
    ctx.fillStyle = backColor;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    var filled = Math.max(0, Math.min(1, ratio)) * (w - 2);
    if (filled > 1) {
      var gradient = ctx.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, topColor);
      gradient.addColorStop(1, bottomColor);
      ctx.fillStyle = gradient;
      roundRect(ctx, x + 1, y + 1, filled, h - 2, (h - 2) / 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
    ctx.stroke();
  }

  function drawBackdrop(ctx, state) {
    var sky = ctx.createLinearGradient(0, 0, 0, ARENA.groundY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.55, PALETTE.skyMid);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA.width, ARENA.groundY);

    /* far arches, slowly drifting */
    var drift = -((state.time * 6) % 240);
    ctx.fillStyle = PALETTE.wallFar;
    ctx.fillRect(0, 40, ARENA.width, ARENA.groundY - 40);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#0b1120";
    for (var i = -1; i < 6; i += 1) {
      var ax = drift + i * 240;
      ctx.beginPath();
      ctx.moveTo(ax + 30, ARENA.groundY);
      ctx.lineTo(ax + 30, 150);
      ctx.quadraticCurveTo(ax + 90, 90, ax + 150, 150);
      ctx.lineTo(ax + 150, ARENA.groundY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* near wall bricks */
    ctx.strokeStyle = "rgba(120, 150, 210, 0.07)";
    ctx.lineWidth = 1;
    for (var row = 0; row < 9; row += 1) {
      var y = 120 + row * 38;
      if (y > ARENA.groundY) break;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA.width, y);
      ctx.stroke();
      for (var col = -1; col < 16; col += 1) {
        var bx = col * 64 + (row % 2 ? 32 : 0);
        ctx.beginPath();
        ctx.moveTo(bx, y);
        ctx.lineTo(bx, y + 38);
        ctx.stroke();
      }
    }

    /* torches */
    [180, 480, 780].forEach(function (tx, index) {
      var flicker = 0.72 + 0.28 * Math.sin(state.time * 9 + index * 2.1);
      var glow = ctx.createRadialGradient(tx, 250, 4, tx, 250, 130 * flicker);
      glow.addColorStop(0, "rgba(255, 176, 92, 0.34)");
      glow.addColorStop(1, "rgba(255, 150, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tx, 250, 130 * flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a2b1f";
      ctx.fillRect(tx - 3, 250, 6, 34);
      ctx.fillStyle = "#ffcf7a";
      ctx.beginPath();
      ctx.ellipse(tx, 246, 6 * flicker, 11 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    /* floor */
    var floor = ctx.createLinearGradient(0, ARENA.groundY, 0, ARENA.height);
    floor.addColorStop(0, PALETTE.floorTop);
    floor.addColorStop(1, PALETTE.floorBottom);
    ctx.fillStyle = floor;
    ctx.fillRect(0, ARENA.groundY, ARENA.width, ARENA.height - ARENA.groundY);
    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    for (var line = 0; line < 5; line += 1) {
      var ly = ARENA.groundY + 8 + line * 14;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(ARENA.width, ly);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 214, 170, 0.16)";
    ctx.fillRect(0, ARENA.groundY, ARENA.width, 2);
  }

  function drawVignette(ctx, state) {
    var glow = ctx.createRadialGradient(
      ARENA.width / 2,
      ARENA.height * 0.45,
      120,
      ARENA.width / 2,
      ARENA.height * 0.5,
      620
    );
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  }

  function drawGate(ctx, state) {
    var x = ARENA.rightWall + 6;
    var open = state.room && state.room.cleared;
    ctx.save();
    ctx.translate(x, ARENA.groundY - 60);
    ctx.fillStyle = "#0d1220";
    ctx.beginPath();
    ctx.moveTo(-26, 60);
    ctx.lineTo(-26, -22);
    ctx.quadraticCurveTo(0, -64, 26, -22);
    ctx.lineTo(26, 60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = open ? "rgba(255, 214, 140, 0.9)" : "rgba(120, 150, 200, 0.45)";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    if (open) {
      var swirl = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
      swirl.addColorStop(0, "rgba(255, 226, 168, 0.65)");
      swirl.addColorStop(1, "rgba(255, 190, 110, 0)");
      ctx.fillStyle = swirl;
      ctx.beginPath();
      ctx.arc(0, -4, 38 + Math.sin(state.time * 6) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function playerFrame(state, player) {
    var rows = SPRITE.rows;
    if (player.dead) return { row: rows.extras, col: SPRITE.extras.dead };
    if (player.hurtTimer > 0) return { row: rows.extras, col: SPRITE.extras.hurt };
    if (!player.onGround) {
      return { row: rows.extras, col: player.vy < 0 ? SPRITE.extras.jump : SPRITE.extras.fall };
    }
    if (player.skillTimer > 0) {
      var skill = Core.SKILLS[player.skillId];
      var progress = skill ? 1 - player.skillTimer / skill.duration : 0;
      return { row: rows.skill, col: Math.min(3, Math.floor(clamp01(progress) * 4)) };
    }
    if (player.attackTimer > 0) {
      var swing = 1 - player.attackTimer / Core.PLAYER.attackDuration;
      return { row: rows.attack, col: Math.min(2, Math.floor(clamp01(swing) * 3)) };
    }
    if (Math.abs(player.vx) > 8) {
      return { row: rows.run, col: Math.floor(state.time * 12) % 6 };
    }
    return { row: rows.idle, col: Math.floor(state.time * 4) % 4 };
  }

  function drawSpriteFrame(ctx, image, col, row, x, y, flip, scale) {
    var fw = SPRITE.frameW;
    var fh = SPRITE.frameH;
    var size = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      col * fw,
      row * fh,
      fw,
      fh,
      -SPRITE.anchorX * size,
      -SPRITE.anchorY * size,
      fw * size,
      fh * size
    );
    ctx.restore();
  }

  function drawFallbackPlayer(ctx, state, player) {
    var bodyW = player.width;
    var bodyH = player.height;
    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.facing < 0) ctx.scale(-1, 1);
    var swing = player.attackTimer > 0 ? 1 - player.attackTimer / Core.PLAYER.attackDuration : 0;

    ctx.fillStyle = "#6a1020";
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.4, -bodyH * 0.9);
    ctx.lineTo(bodyW * 0.2, -bodyH * 0.86);
    ctx.lineTo(-bodyW * 0.75, -bodyH * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1c2338";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.78, bodyW * 0.72, bodyH * 0.5);
    ctx.fillStyle = "#2c3654";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.78, bodyW * 0.3, bodyH * 0.5);
    ctx.fillStyle = "#bc2a3e";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.72, bodyW * 0.72, 3);
    ctx.fillStyle = "#d8b25a";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.34, bodyW * 0.72, 3);

    ctx.fillStyle = "#121620";
    ctx.fillRect(-bodyW * 0.28, -bodyH * 0.32, bodyW * 0.22, bodyH * 0.32);
    ctx.fillRect(bodyW * 0.06, -bodyH * 0.32, bodyW * 0.22, bodyH * 0.32);

    ctx.fillStyle = "#ecbe98";
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.86, bodyW * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#141822";
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.3, -bodyH * 0.86);
    ctx.lineTo(-bodyW * 0.34, -bodyH * 1.04);
    ctx.lineTo(bodyW * 0.3, -bodyH * 0.98);
    ctx.lineTo(bodyW * 0.2, -bodyH * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5ce0ff";
    ctx.fillRect(bodyW * 0.06, -bodyH * 0.88, 4, 3);

    ctx.strokeStyle = "#ced8e8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH * 0.62);
    ctx.lineTo(bodyW * 0.9, -bodyH * (0.9 - swing * 0.5));
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(ctx, state, sprites) {
    var player = state.player;
    if (player.invuln > 0 && Math.floor(state.time * 20) % 2 === 0 && player.hurtTimer <= 0) return;

    var shadowW = player.width * 0.75;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(player.x, ARENA.groundY + 3, shadowW, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var image = sprites && sprites.slayer;
    if (!image || !image.width) {
      drawFallbackPlayer(ctx, state, player);
      return;
    }
    var frame = playerFrame(state, player);
    ctx.save();
    if (player.hurtTimer > 0 && "filter" in ctx) ctx.filter = "brightness(1.7) saturate(0.6)";
    drawSpriteFrame(ctx, image, frame.col, frame.row, player.x, player.y, player.facing < 0);
    ctx.restore();
  }

  var ENEMY_STYLE = {
    grunt: { body: "#8ad36c", dark: "#3f7a3a", accent: "#d9f2b0", eye: "#ffe066" },
    brute: { body: "#e0a44d", dark: "#8a5a1f", accent: "#ffe0a8", eye: "#ff8a4d" },
    caster: { body: "#79a6ff", dark: "#33518f", accent: "#cfe2ff", eye: "#9ef0ff" },
    charger: { body: "#b07cff", dark: "#5a2f96", accent: "#e8d6ff", eye: "#ffd166" },
    boss: { body: "#e0556d", dark: "#7d1f31", accent: "#ffd0d6", eye: "#ffe066" }
  };

  function drawEnemy(ctx, state, enemy) {
    var style = ENEMY_STYLE[enemy.type] || ENEMY_STYLE.grunt;
    var w = enemy.width;
    var h = enemy.height;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(enemy.x, enemy.y + 3, w * 0.62, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(enemy.x, enemy.y);
    if (enemy.facing > 0) ctx.scale(-1, 1);

    if (enemy.hurtTimer > 0 && "filter" in ctx) ctx.filter = "brightness(1.9)";

    ctx.fillStyle = style.dark;
    roundRect(ctx, -w / 2, -h * 0.72, w, h * 0.72, w * 0.28);
    ctx.fill();
    ctx.fillStyle = style.body;
    roundRect(ctx, -w / 2 + 2, -h * 0.72 + 2, w - 4, h * 0.58, w * 0.26);
    ctx.fill();
    ctx.fillStyle = style.accent;
    ctx.fillRect(-w / 2 + 3, -h * 0.34, w - 6, 3);

    ctx.fillStyle = style.dark;
    ctx.fillRect(-w / 2 - 2, -h * 0.2, 8, h * 0.2);
    ctx.fillRect(w / 2 - 6, -h * 0.2, 8, h * 0.2);

    ctx.fillStyle = style.body;
    ctx.beginPath();
    ctx.arc(0, -h * 0.78, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.eye;
    ctx.beginPath();
    ctx.arc(-w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
    ctx.arc(w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.type === "brute" || enemy.type === "boss") {
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(-w * 0.26, -h * 0.95);
      ctx.lineTo(-w * 0.4, -h * 1.16);
      ctx.lineTo(-w * 0.06, -h * 1.0);
      ctx.closePath();
      ctx.moveTo(w * 0.26, -h * 0.95);
      ctx.lineTo(w * 0.4, -h * 1.16);
      ctx.lineTo(w * 0.06, -h * 1.0);
      ctx.closePath();
      ctx.fill();
    }
    if (enemy.type === "caster") {
      ctx.strokeStyle = style.eye;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w * 0.42, -h * 0.6, 6 + Math.sin(state.time * 6) * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (enemy.type === "charger") {
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(w * 0.3, -h * 0.62);
      ctx.lineTo(w * 0.62, -h * 0.5);
      ctx.lineTo(w * 0.3, -h * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (enemy.attackTimer > 0) {
      var windup = 1 - Math.max(0, enemy.attackTimer / enemy.attackDuration);
      var radius =
        enemy.attackKind === "slam" && enemy.slam ? enemy.slam.radius : enemy.attackRange;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * windup;
      ctx.strokeStyle = "rgba(255, 120, 120, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - h * 0.55, radius * (0.35 + windup * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (enemy.hp < enemy.maxHp) {
      var barW = w + 12;
      var ratio = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      roundRect(ctx, enemy.x - barW / 2, enemy.y - h - 18, barW, 6, 3);
      ctx.fill();
      ctx.fillStyle = enemy.type === "boss" ? PALETTE.danger : "#ff9d5c";
      roundRect(ctx, enemy.x - barW / 2 + 1, enemy.y - h - 17, (barW - 2) * ratio, 4, 2);
      ctx.fill();
      ctx.restore();
    }

    /* DNF-style status tells: bleeding ticks, grounded knockdowns, stunned targets. */
    if (enemy.bleed) {
      ctx.save();
      ctx.fillStyle = "rgba(198, 92, 255, 0.9)";
      for (var drop = 0; drop < 3; drop += 1) {
        var wobble = Math.sin(state.time * 10 + drop) * 3;
        ctx.beginPath();
        ctx.ellipse(
          enemy.x - 10 + drop * 10,
          enemy.y - enemy.height - 26 + wobble,
          2.6,
          4,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
    }
    if (enemy.knockdown > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, enemy.knockdown * 2);
      ctx.strokeStyle = "rgba(255, 226, 160, 0.9)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - 6, enemy.width * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    if (enemy.stun > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, enemy.stun * 3);
      ctx.strokeStyle = "#ffe9a8";
      ctx.lineWidth = 2;
      for (var star = 0; star < 3; star += 1) {
        var angle = state.time * 6 + (star * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(
          enemy.x + Math.cos(angle) * 12,
          enemy.y - enemy.height - 22 + Math.sin(angle) * 5,
          3,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawProjectiles(ctx, state) {
    (state.projectiles || []).forEach(function (shot) {
      var pulse = 0.85 + 0.15 * Math.sin(state.time * 24 + shot.x);
      ctx.save();
      var glow = ctx.createRadialGradient(shot.x, shot.y, 1, shot.x, shot.y, shot.radius * 3.2 * pulse);
      glow.addColorStop(0, "rgba(255, 214, 150, 0.85)");
      glow.addColorStop(1, "rgba(255, 140, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius * 3.2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff0cf";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawPickups(ctx, state) {
    state.pickups.forEach(function (drop) {
      var pulse = 0.8 + 0.2 * Math.sin(state.time * 8 + drop.x);
      ctx.save();
      ctx.globalAlpha = drop.life < 2 ? Math.max(0.25, drop.life / 2) : 1;
      var glow = ctx.createRadialGradient(drop.x, drop.y, 1, drop.x, drop.y, drop.radius * 3 * pulse);
      glow.addColorStop(0, "rgba(150, 255, 180, 0.6)");
      glow.addColorStop(1, "rgba(90, 220, 140, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius * 3 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8dffb0";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(drop.x - drop.radius / 3, drop.y - drop.radius / 3, drop.radius / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawEffect(ctx, state, effect) {
    var alpha = clamp01(effect.life / effect.maxLife);
    if (effect.kind === "damage") {
      var rise = (1 - alpha) * 28;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.6);
      ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.9)";
      ctx.strokeText(effect.text, effect.x, effect.y - rise);
      ctx.fillStyle = "#ffe08a";
      ctx.fillText(effect.text, effect.x, effect.y - rise);
      ctx.restore();
    } else if (effect.kind === "heal") {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 24, 16, 0.9)";
      ctx.strokeText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
      ctx.fillStyle = "#8dffb0";
      ctx.fillText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
      ctx.restore();
    } else if (effect.kind === "banner") {
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.textAlign = "center";
      ctx.font = "700 26px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(10, 12, 22, 0.85)";
      ctx.strokeText(effect.text, ARENA.width / 2, 104);
      var grad = ctx.createLinearGradient(0, 84, 0, 112);
      grad.addColorStop(0, "#fff3c4");
      grad.addColorStop(1, "#e3bf72");
      ctx.fillStyle = grad;
      ctx.fillText(effect.text, ARENA.width / 2, 104);
      ctx.restore();
    } else if (effect.kind === "telegraph") {
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.4 * (1 - alpha);
      ctx.strokeStyle = "#ff8f6b";
      ctx.lineWidth = 2;
      if (effect.radius > 0) {
        ctx.beginPath();
        ctx.ellipse(effect.x, effect.y, effect.radius, effect.radius * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.dir) {
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y);
        ctx.lineTo(effect.x + effect.dir * effect.radius, effect.y);
        ctx.stroke();
      }
      if (effect.text) {
        ctx.globalAlpha = 0.55 + 0.4 * (1 - alpha);
        ctx.fillStyle = "#ffd2c4";
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, effect.x, effect.y - 10);
      }
      ctx.restore();
    } else if (effect.kind === "shockwave") {
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = "#ffb066";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(
        effect.x,
        effect.y,
        effect.radius * (1.15 - alpha * 0.35),
        effect.radius * 0.22 * (1.15 - alpha * 0.35),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    } else if (effect.kind === "ghost") {
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = PALETTE.ghost;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius, -0.95, 0.95);
      ctx.stroke();
      ctx.restore();
    }

    if (effect.kind === "damage") {
      /* sparks around every damage number */
      var spark = 1 - alpha;
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = "#ffd9a0";
      ctx.lineWidth = 2;
      for (var i = 0; i < 5; i += 1) {
        var angle = (i / 5) * Math.PI * 2 + effect.x;
        var inner = 6 + spark * 16;
        var outer = inner + 7;
        ctx.beginPath();
        ctx.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
        ctx.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawHud(ctx, state, sprites) {
    var player = state.player;
    var panelX = 16;
    var panelY = 14;
    var panelW = 322;
    var panelH = 96;
    panel(ctx, panelX, panelY, panelW, panelH, 8);

    var portraitSize = 60;
    var px = panelX + 12;
    var py = panelY + 12;
    ctx.save();
    ctx.fillStyle = "rgba(6, 9, 18, 0.9)";
    roundRect(ctx, px, py, portraitSize, portraitSize, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.6)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, px + 0.7, py + 0.7, portraitSize - 1.4, portraitSize - 1.4, 6);
    ctx.stroke();
    if (sprites && sprites.slayer && sprites.slayer.width) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, px + 2, py + 2, portraitSize - 4, portraitSize - 4, 5);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprites.slayer, 0, 0, SPRITE.frameW, SPRITE.frameH, px - 16, py - 20, 92, 92);
      ctx.restore();
    }
    ctx.restore();

    var infoX = px + portraitSize + 12;
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "700 16px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("鬼剑士 SLAYER", infoX, py + 16);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Lv " + player.level, infoX + 152, py + 16);
    ctx.restore();

    var barX = infoX;
    var barW = panelW - (infoX - panelX) - 14;
    bar(ctx, barX, py + 24, barW, 12, player.hp / player.maxHp, "#8cf0a6", "#37a85c", PALETTE.hpBack);
    bar(ctx, barX, py + 42, barW, 10, player.mp / player.maxMp, "#9ccbff", "#3f7fd8", PALETTE.mpBack);
    bar(ctx, barX, py + 58, barW, 7, player.xp / player.xpToNext, "#ffe9a8", "#d8a83c", PALETTE.xpBack);

    ctx.save();
    ctx.textAlign = "right";
    ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(Math.round(player.hp) + " / " + player.maxHp, barX + barW - 6, py + 34);
    ctx.fillStyle = "rgba(200, 224, 255, 0.92)";
    ctx.fillText(Math.round(player.mp) + " / " + player.maxMp, barX + barW - 6, py + 51);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(Math.round(player.xp) + " / " + player.xpToNext + " XP", barX + barW - 4, py + 65);
    ctx.restore();

    /* room card */
    var roomW = 236;
    var roomX = ARENA.width - roomW - 16;
    panel(ctx, roomX, 14, roomW, 60, 8);
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "700 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText(state.room ? state.room.name : "", roomX + 14, 38);
    var enemiesLeft = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    }).length;
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText(
      "房间 " + (state.roomIndex + 1) + "/" + Core.ROOMS.length + " · 剩余敌人 " + enemiesLeft,
      roomX + 14,
      58
    );
    ctx.restore();

    if (player.comboTimer > 0 && player.comboIndex > 0) {
      ctx.save();
      ctx.textAlign = "right";
      ctx.font = "800 26px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.85)";
      var comboLabel =
        (player.comboIndex + 1) + (player.airHitTimer > 0 ? " AIR COMBO" : " COMBO");
      ctx.strokeText(comboLabel, roomX + roomW - 14, 104);
      ctx.fillStyle = "#ffd66b";
      ctx.fillText(comboLabel, roomX + roomW - 14, 104);
      ctx.restore();
    }

    var boss = state.enemies.find(function (enemy) {
      return !enemy.dead && enemy.type === "boss";
    });
    if (boss) {
      var bossW = 420;
      var bossX = ARENA.width / 2 - bossW / 2;
      panel(ctx, bossX, 84, bossW, 34, 6);
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = PALETTE.text;
      ctx.font = "700 13px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("GOBLIN KING", ARENA.width / 2, 101);
      ctx.restore();
      bar(
        ctx,
        bossX + 12,
        106,
        bossW - 24,
        8,
        boss.hp / boss.maxHp,
        "#ff9aa8",
        "#a8203a",
        "rgba(40, 10, 18, 0.9)"
      );
    }
  }

  function drawSkillBar(ctx, state, sprites) {
    var player = state.player;
    var slotW = 112;
    var slotH = 40;
    var gap = 8;
    var y0 = ARENA.height - 56;

    Core.SKILL_ORDER.forEach(function (skillId, index) {
      var skill = Core.SKILLS[skillId];
      var cooldown = player.skillCooldowns[skillId] || 0;
      var ready = cooldown <= 0 && player.mp >= skill.mp && !player.dead;
      var x = 16 + index * (slotW + gap);

      ctx.save();
      ctx.fillStyle = ready ? "rgba(20, 28, 48, 0.92)" : "rgba(12, 14, 24, 0.92)";
      roundRect(ctx, x, y0, slotW, slotH, 6);
      ctx.fill();
      ctx.strokeStyle = ready ? "rgba(226, 191, 114, 0.85)" : "rgba(96, 106, 136, 0.55)";
      ctx.lineWidth = 1.4;
      roundRect(ctx, x + 0.7, y0 + 0.7, slotW - 1.4, slotH - 1.4, 6);
      ctx.stroke();

      if (sprites && sprites.skills && sprites.skills.width) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = ready ? 1 : 0.55;
        ctx.drawImage(sprites.skills, index * 32, 0, 32, 32, x + 5, y0 + 4, 32, 32);
        ctx.globalAlpha = 1;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(skill.key, x + 42, y0 + 17);
      ctx.fillStyle = ready ? PALETTE.text : "rgba(198, 208, 228, 0.5)";
      ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(skill.name, x + 42, y0 + 33);

      ctx.textAlign = "right";
      if (cooldown > 0) {
        ctx.fillStyle = "rgba(8, 10, 18, 0.62)";
        roundRect(ctx, x + 1, y0 + 1, (slotW - 2) * clamp01(cooldown / skill.cooldown), slotH - 2, 5);
        ctx.fill();
        ctx.fillStyle = "#9ccbff";
        ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif";
        ctx.fillText(cooldown.toFixed(1) + "s", x + slotW - 6, y0 + 25);
      } else {
        ctx.fillStyle = "rgba(150, 206, 255, 0.9)";
        ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
        ctx.fillText("MP " + skill.mp, x + slotW - 6, y0 + 33);
      }
      ctx.restore();
    });
  }

  function drawTouchControls(ctx, state, sprites, meta) {
    var player = state.player;
    var pressed = (meta && meta.pressed) || [];
    var skillIndex = { upSlash: 0, mountainBreaker: 1, crossSlash: 2, ghostSlash: 3 };

    ctx.save();
    TOUCH_LAYOUT.forEach(function (button) {
      var isSkill = SKILL_ACTIONS.indexOf(button.action) !== -1;
      var skill = isSkill ? Core.SKILLS[button.action] : null;
      var cooldown = skill ? player.skillCooldowns[button.action] || 0 : 0;
      var ready = skill ? cooldown <= 0 && player.mp >= skill.mp && !player.dead : true;
      var isDown = pressed.indexOf(button.action) !== -1;
      var fill = isDown ? "rgba(226, 191, 114, 0.32)" : "rgba(16, 20, 34, 0.55)";

      ctx.fillStyle = fill;
      roundRect(ctx, button.x, button.y, button.w, button.h, 14);
      ctx.fill();
      ctx.strokeStyle = isDown ? "rgba(255, 232, 170, 0.95)" : "rgba(226, 191, 114, 0.6)";
      ctx.lineWidth = isDown ? 2.4 : 1.6;
      roundRect(ctx, button.x + 0.8, button.y + 0.8, button.w - 1.6, button.h - 1.6, 13);
      ctx.stroke();

      if (isSkill && sprites && sprites.skills && sprites.skills.width) {
        var size = button.w - 22;
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = ready ? 1 : 0.5;
        ctx.drawImage(
          sprites.skills,
          skillIndex[button.action] * 32,
          0,
          32,
          32,
          button.x + (button.w - size) / 2,
          button.y + 5,
          size,
          size
        );
        ctx.globalAlpha = 1;
        if (cooldown > 0) {
          ctx.fillStyle = "rgba(8, 10, 18, 0.66)";
          roundRect(ctx, button.x + 1, button.y + 1, button.w - 2, button.h - 2, 13);
          ctx.fill();
          ctx.fillStyle = "#9ccbff";
          ctx.font = "700 15px 'Segoe UI', system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(cooldown.toFixed(1), button.x + button.w / 2, button.y + button.h / 2 + 5);
        } else {
          ctx.fillStyle = "rgba(226, 191, 114, 0.9)";
          ctx.font = "600 11px 'PingFang SC', 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h - 6);
        }
      } else {
        ctx.fillStyle = isDown ? "#fff3c4" : "rgba(238, 244, 255, 0.88)";
        ctx.font = "700 " + Math.round(button.h * 0.42) + "px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var label = button.label;
        if (button.action === "mute") label = (meta && meta.muted ? "静" : "音");
        ctx.fillText(label, button.x + button.w / 2, button.y + button.h / 2 + 1);
        ctx.textBaseline = "alphabetic";
      }
    });
    ctx.restore();
  }

  function drawOverlay(ctx, state, meta, sprites) {
    if (state.defeat || state.victory) {
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 16, 0.74)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.textAlign = "center";
      ctx.font = "bold 46px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(10, 12, 22, 0.9)";
      var title = state.defeat ? "YOU DIED" : "DUNGEON CLEARED";
      ctx.strokeText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = state.defeat ? PALETTE.danger : PALETTE.gold;
      ctx.fillText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = "rgba(230, 240, 255, 0.85)";
      ctx.font = "18px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(
        state.defeat ? "按 R 重新开始" : "按 R 再来一次",
        ARENA.width / 2,
        ARENA.height / 2 + 34
      );
      ctx.restore();
      return;
    }
    if (meta && meta.paused) {
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 16, 0.6)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.textAlign = "center";
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 42px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("PAUSED", ARENA.width / 2, ARENA.height / 2);
      ctx.font = "18px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText("按 P 继续", ARENA.width / 2, ARENA.height / 2 + 34);
      ctx.restore();
      return;
    }
    if (meta && meta.showHelp) {
      ctx.save();
      ctx.fillStyle = "rgba(5, 7, 14, 0.86)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);

      if (sprites && sprites.slayer && sprites.slayer.width) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.95;
        drawSpriteFrame(ctx, sprites.slayer, 0, 0, 244, 392, false, 2.6);
        ctx.globalAlpha = 1;
      }

      ctx.textAlign = "left";
      ctx.font = "800 54px 'Segoe UI', system-ui, sans-serif";
      var grad = ctx.createLinearGradient(0, 70, 0, 124);
      grad.addColorStop(0, "#fff4cc");
      grad.addColorStop(1, "#d9a743");
      ctx.fillStyle = grad;
      ctx.fillText("NANO", 344, 108);
      ctx.fillText("DNF", 344, 162);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "600 20px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("鬼剑士 · 地下城试炼", 344, 196);

      var rows = [
        ["← →", "移动"],
        ["C / ↑ / Space", "跳跃"],
        ["X", "普攻（三段连击）"],
        ["A", "上挑（挑飞）"],
        ["S", "崩山击（冲击波）"],
        ["D", "十字斩"],
        ["F", "鬼斩"],
        ["P / R / H", "暂停 / 重开 / 帮助"]
      ];
      ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
      rows.forEach(function (row, index) {
        var y = 236 + index * 26;
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText(row[0], 344, y);
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(row[1], 508, y);
      });

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 14px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("清空房间后走到最右侧传送门，第 4 层击败 Boss 即通关", 344, 462);
      ctx.fillStyle = "#ffd66b";
      ctx.font = "700 16px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("按任意键开始", 344, 496);
      ctx.restore();
    }
  }

  function render(ctx, state, meta) {
    meta = meta || {};
    var sprites = meta.sprites || null;
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);

    var shake = 0;
    state.effects.forEach(function (effect) {
      if (effect.kind === "shockwave") shake = Math.max(shake, effect.life / effect.maxLife);
    });

    ctx.save();
    if (shake > 0) {
      ctx.translate(Math.sin(state.time * 90) * 2.4 * shake, Math.cos(state.time * 77) * 1.6 * shake);
    }
    drawBackdrop(ctx, state);
    drawGate(ctx, state);

    state.enemies.forEach(function (enemy) {
      drawEnemy(ctx, state, enemy);
    });
    drawProjectiles(ctx, state);
    drawPickups(ctx, state);
    drawPlayer(ctx, state, sprites);
    state.effects.forEach(function (effect) {
      drawEffect(ctx, state, effect);
    });
    ctx.restore();

    drawVignette(ctx, state);
    drawHud(ctx, state, sprites);
    if (meta.touch && meta.touch.enabled) {
      drawTouchControls(ctx, state, sprites, meta.touch);
    } else {
      drawSkillBar(ctx, state, sprites);
    }
    drawOverlay(ctx, state, meta, sprites);
  }

  return {
    render: render,
    PALETTE: PALETTE,
    SPRITE: SPRITE,
    touchButtons: touchButtons,
    hitTestTouch: hitTestTouch
  };
});
