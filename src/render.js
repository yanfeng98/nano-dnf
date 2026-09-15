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
    skyTop: "#0b1020",
    skyBottom: "#1b2236",
    fog: "rgba(90, 122, 180, 0.10)",
    wallBack: "#141a2b",
    wallMid: "#1d2540",
    floorTop: "#2a2440",
    floorBottom: "#140f22",
    floorLine: "rgba(255, 214, 170, 0.08)",
    player: "#63e6ff",
    playerDark: "#1d7f96",
    playerTrim: "#eafcff",
    blade: "rgba(226, 250, 255, 0.85)",
    grunt: "#8ad36c",
    brute: "#e0a44d",
    caster: "#79a6ff",
    charger: "#b07cff",
    boss: "#e0556d",
    enemyTrim: "#22160f",
    hp: "#54e07a",
    hpBack: "#3a1c22",
    mp: "#5aa9ff",
    mpBack: "#1a2740",
    hudText: "#f3f7ff",
    danger: "#ff5f6d"
  };

  var ENEMY_COLORS = {
    grunt: PALETTE.grunt,
    brute: PALETTE.brute,
    caster: PALETTE.caster,
    charger: PALETTE.charger,
    boss: PALETTE.boss
  };

  function drawBackground(ctx) {
    var gradient = ctx.createLinearGradient(0, 0, 0, ARENA.groundY);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ARENA.width, ARENA.groundY);

    ctx.fillStyle = PALETTE.wallBack;
    ctx.fillRect(0, 120, ARENA.width, 150);

    ctx.fillStyle = PALETTE.wallMid;
    for (var pillar = 40; pillar < ARENA.width; pillar += 160) {
      ctx.fillRect(pillar, 120, 46, 190);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(pillar + 8, 132, 8, 166);
      ctx.fillStyle = PALETTE.wallMid;
    }

    ctx.fillStyle = PALETTE.fog;
    ctx.fillRect(0, 240, ARENA.width, 100);

    var floor = ctx.createLinearGradient(0, ARENA.groundY, 0, ARENA.height);
    floor.addColorStop(0, PALETTE.floorTop);
    floor.addColorStop(1, PALETTE.floorBottom);
    ctx.fillStyle = floor;
    ctx.fillRect(0, ARENA.groundY, ARENA.width, ARENA.height - ARENA.groundY);

    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    for (var line = 0; line <= 5; line++) {
      var y = ARENA.groundY + line * 16 + 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA.width, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, ARENA.groundY);
    ctx.lineTo(ARENA.width, ARENA.groundY);
    ctx.stroke();
  }

  function drawGate(ctx, state) {
    var open = state.room && state.room.cleared && !state.victory;
    ctx.fillStyle = open ? "rgba(120, 255, 200, 0.18)" : "rgba(10, 12, 22, 0.85)";
    ctx.fillRect(ARENA.rightWall - 6, ARENA.groundY - 180, 30, 180);
    ctx.strokeStyle = open ? "rgba(120, 255, 200, 0.65)" : "rgba(120, 140, 190, 0.25)";
    ctx.lineWidth = 3;
    ctx.strokeRect(ARENA.rightWall - 6, ARENA.groundY - 180, 30, 180);
  }

  function drawPlayer(ctx, state) {
    var player = state.player;
    var bodyW = player.width;
    var bodyH = player.height;
    var x = player.x;
    var y = player.y;

    if (player.invuln > 0 && Math.floor(state.time * 20) % 2 === 0) return;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 2, bodyW * 0.7, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PALETTE.playerDark;
    ctx.fillRect(-bodyW / 2, -bodyH * 0.55, bodyW, bodyH * 0.55);

    ctx.fillStyle = PALETTE.player;
    ctx.fillRect(-bodyW / 2, -bodyH, bodyW, bodyH * 0.5);

    ctx.fillStyle = PALETTE.playerTrim;
    ctx.fillRect(-bodyW / 2, -bodyH - 8, bodyW, 9);

    ctx.fillStyle = PALETTE.playerDark;
    var legSwing = player.attackTimer > 0 ? 5 : 0;
    ctx.fillRect(-bodyW / 2 - 2, -bodyH * 0.28, 9, bodyH * 0.28 + legSwing);
    ctx.fillRect(bodyW / 2 - 7, -bodyH * 0.28, 9, bodyH * 0.28 - legSwing);

    if (player.attackTimer > 0) {
      var progress = 1 - player.attackTimer / Core.PLAYER.attackDuration;
      var angle = (player.facing > 0 ? -0.9 : Math.PI + 0.9) + progress * 1.8 * player.facing;
      ctx.strokeStyle = PALETTE.blade;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, -bodyH * 0.6, Core.PLAYER.attackReach * 0.72, angle - 0.7, angle + 0.7);
      ctx.stroke();
    }

    if (player.skillTimer > 0) {
      var skillProgress = 1 - player.skillTimer / Core.SKILL.duration;
      ctx.strokeStyle = "rgba(120, 230, 255, 0.8)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, -bodyH * 0.5, Core.SKILL.radius * (0.5 + skillProgress * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawEnemy(ctx, state, enemy) {
    var color = ENEMY_COLORS[enemy.type] || PALETTE.grunt;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 2, enemy.width * 0.65, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillRect(-enemy.width / 2, -enemy.height, enemy.width, enemy.height * 0.7);
    ctx.fillStyle = PALETTE.enemyTrim;
    ctx.fillRect(-enemy.width / 2, -enemy.height * 0.3, enemy.width, enemy.height * 0.3);

    var eyeDir = enemy.facing >= 0 ? 1 : -1;
    ctx.fillStyle = "#ffdf6b";
    ctx.fillRect(eyeDir * 4 - 3, -enemy.height + 12, 6, 5);

    if (enemy.attackTimer > 0) {
      var windup = 1 - Math.max(0, enemy.attackTimer / enemy.attackDuration);
      var warnRadius =
        enemy.attackKind === "slam" && enemy.slam ? enemy.slam.radius : enemy.attackRange;
      ctx.strokeStyle = "rgba(255, 120, 120, 0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -enemy.height * 0.55, warnRadius * (0.4 + windup * 0.5), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (enemy.hurtTimer > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-enemy.width / 2, -enemy.height, enemy.width, enemy.height * 0.7);
    }
    ctx.restore();

    var barW = enemy.width + 10;
    var ratio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.height - 14, barW, 5);
    ctx.fillStyle = PALETTE.danger;
    ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.height - 14, barW * ratio, 5);
  }

  function drawPickups(ctx, state) {
    state.pickups.forEach(function (drop) {
      var pulse = 0.75 + 0.25 * Math.sin(state.time * 8 + drop.x);
      ctx.save();
      ctx.globalAlpha = drop.life < 2 ? Math.max(0.2, drop.life / 2) : 1;
      ctx.fillStyle = "rgba(140, 255, 170, 0.18)";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius * 2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8dffb0";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(drop.x - drop.radius / 3, drop.y - drop.radius / 3, drop.radius / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawProjectiles(ctx, state) {
    (state.projectiles || []).forEach(function (shot) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 168, 96, 0.28)";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffb066";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawEffects(ctx, state) {
    state.effects.forEach(function (effect) {
      var alpha = Math.max(0, effect.life / effect.maxLife);
      if (effect.kind === "damage") {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#ffd66b";
        ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
        ctx.restore();
      } else if (effect.kind === "heal") {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#8dffb0";
        ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
        ctx.restore();
      } else if (effect.kind === "banner") {
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha * 1.4);
        ctx.fillStyle = PALETTE.hudText;
        ctx.font = "600 22px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, ARENA.width / 2, 96);
        ctx.restore();
      } else if (effect.kind === "telegraph") {
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.35 * (1 - alpha);
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
          ctx.globalAlpha = 0.5 + 0.4 * (1 - alpha);
          ctx.fillStyle = "#ffd2c4";
          ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(effect.text, effect.x, effect.y - 8);
        }
        ctx.restore();
      } else if (effect.kind === "shockwave") {
        ctx.save();
        ctx.globalAlpha = alpha * 0.8;
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
      }
    });
  }

  function drawBar(ctx, x, y, width, height, ratio, color, backColor) {
    ctx.fillStyle = backColor;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * Math.max(0, Math.min(1, ratio)), height);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  function drawHud(ctx, state) {
    var player = state.player;
    ctx.save();
    ctx.fillStyle = "rgba(8, 10, 20, 0.72)";
    ctx.fillRect(16, 16, 320, 104);
    ctx.strokeStyle = "rgba(140, 180, 255, 0.35)";
    ctx.strokeRect(16, 16, 320, 104);

    ctx.fillStyle = PALETTE.hudText;
    ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("SLAYER  Lv " + player.level, 30, 40);
    ctx.fillText(state.room ? state.room.name : "", 30, 114);

    drawBar(ctx, 30, 48, 200, 12, player.hp / player.maxHp, PALETTE.hp, PALETTE.hpBack);
    drawBar(ctx, 30, 66, 150, 10, player.mp / player.maxMp, PALETTE.mp, PALETTE.mpBack);
    drawBar(ctx, 30, 84, 240, 8, player.xp / player.xpToNext, "#ffd66b", "#3a3220");

    ctx.fillStyle = PALETTE.hudText;
    ctx.font = "12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(Math.round(player.hp) + "/" + player.maxHp, 238, 59);
    ctx.fillText("MP", 186, 75);
    ctx.fillText("XP " + Math.round(player.xp) + "/" + player.xpToNext, 278, 92);

    var enemiesLeft = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    }).length;
    ctx.textAlign = "right";
    ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Room " + (state.roomIndex + 1) + "/" + Core.ROOMS.length, ARENA.width - 24, 40);
    ctx.fillText("Enemies " + enemiesLeft, ARENA.width - 24, 62);

    if (player.comboTimer > 0 && player.comboIndex > 0) {
      ctx.fillStyle = "#ffd66b";
      ctx.font = "bold 26px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText((player.comboIndex + 1) + " HIT", ARENA.width - 24, 100);
    }
    ctx.restore();
  }

  function drawOverlay(ctx, state, meta) {
    var title = "";
    var subtitle = "";
    if (state.defeat) {
      title = "YOU DIED";
      subtitle = "Press R to restart the dungeon";
    } else if (state.victory) {
      title = "DUNGEON CLEARED";
      subtitle = "Press R to run it again";
    } else if (meta && meta.paused) {
      title = "PAUSED";
      subtitle = "Press P or Space to resume";
    } else if (meta && meta.showHelp) {
      title = "MOVE / ATTACK";
      subtitle = "A-D or arrows to move, W/Space to jump, J to attack, K for skill, P pause, R restart";
    }
    if (!title) return;

    ctx.save();
    ctx.fillStyle = "rgba(6, 8, 16, 0.72)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    ctx.textAlign = "center";
    ctx.fillStyle = state.defeat ? PALETTE.danger : PALETTE.hudText;
    ctx.font = "bold 46px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(title, ARENA.width / 2, ARENA.height / 2 - 10);
    ctx.fillStyle = "rgba(230, 240, 255, 0.85)";
    ctx.font = "18px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(subtitle, ARENA.width / 2, ARENA.height / 2 + 34);
    ctx.restore();
  }

  function render(ctx, state, meta) {
    meta = meta || {};
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);
    drawBackground(ctx);
    drawGate(ctx, state);

    state.enemies.forEach(function (enemy) {
      drawEnemy(ctx, state, enemy);
    });
    drawProjectiles(ctx, state);
    drawPickups(ctx, state);
    drawPlayer(ctx, state);
    drawEffects(ctx, state);
    drawHud(ctx, state);
    drawOverlay(ctx, state, meta);
  }

  return { render: render, PALETTE: PALETTE };
});
