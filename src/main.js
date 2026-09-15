/*
 * Browser entry point: keyboard input, fixed-step game loop, pause/restart.
 * Depends on window.DNFCore and window.DNFRender.
 */
(function () {
  "use strict";

  var Core = window.DNFCore;
  var Render = window.DNFRender;
  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");

  /* Original art shipped in assets/: a 6x5 frame sheet and four skill icons. */
  var sprites = { slayer: null, skills: null };
  [["slayer", "./assets/slayer.png"], ["skills", "./assets/skills.png"]].forEach(function (entry) {
    var image = new Image();
    image.src = entry[1];
    image.onload = function () {
      sprites[entry[0]] = image;
    };
  });

  /* DNF Slayer layout: arrows move, X attacks, C jumps, A/S/D/F cast skills. */
  var KEY_MAP = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "jump",
    ArrowDown: "down",
    Space: "jump",
    KeyC: "jump",
    KeyX: "attack",
    KeyA: "upSlash",
    KeyS: "mountainBreaker",
    KeyD: "crossSlash",
    KeyF: "ghostSlash"
  };

  var ONE_SHOT_ACTIONS = {
    jump: true,
    attack: true,
    upSlash: true,
    mountainBreaker: true,
    crossSlash: true,
    ghostSlash: true
  };

  var held = { left: false, right: false, down: false, jump: false, attack: false };
  var pressed = { jump: false, attack: false };
  Core.SKILL_ORDER.forEach(function (skillId) {
    held[skillId] = false;
    pressed[skillId] = false;
  });
  var state = Core.createState({ seed: Core.DEFAULT_SEED });
  var paused = false;
  var showHelp = true;
  var accumulator = 0;
  var lastTime = 0;

  function setKey(code, isDown, event) {
    var action = KEY_MAP[code];
    if (!action) return false;
    if (isDown && !held[action] && ONE_SHOT_ACTIONS[action]) {
      pressed[action] = true;
    }
    held[action] = isDown;
    if (event) event.preventDefault();
    return true;
  }

  window.addEventListener("keydown", function (event) {
    if (event.repeat) {
      if (KEY_MAP[event.code]) event.preventDefault();
      return;
    }
    if (event.code === "KeyP") {
      paused = !paused;
      event.preventDefault();
      return;
    }
    if (event.code === "KeyR") {
      restart();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyH") {
      showHelp = !showHelp;
      event.preventDefault();
      return;
    }
    if (showHelp) showHelp = false;
    setKey(event.code, true, event);
  });

  window.addEventListener("keyup", function (event) {
    if (setKey(event.code, false, event) && (event.code === "Space")) {
      pressed.jump = false;
    }
  });

  window.addEventListener("blur", function () {
    Object.keys(held).forEach(function (key) {
      held[key] = false;
    });
    Object.keys(pressed).forEach(function (key) {
      pressed[key] = false;
    });
  });

  function restart() {
    state = Core.createState({ seed: Core.DEFAULT_SEED });
    paused = false;
    accumulator = 0;
  }

  function currentInput() {
    var input = {
      left: held.left,
      right: held.right,
      jump: held.jump || pressed.jump,
      attack: held.attack || pressed.attack,
      skills: {}
    };
    Core.SKILL_ORDER.forEach(function (skillId) {
      input.skills[skillId] = held[skillId] || pressed[skillId];
    });
    return input;
  }

  function consumePressed() {
    Object.keys(pressed).forEach(function (key) {
      pressed[key] = false;
    });
  }

  function frame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    var delta = Math.min(0.1, (timestamp - lastTime) / 1000);
    lastTime = timestamp;

    if (!paused) {
      accumulator += delta;
      var guard = 0;
      while (accumulator >= Core.DT && guard < 5) {
        Core.step(state, currentInput());
        consumePressed();
        accumulator -= Core.DT;
        guard += 1;
      }
      if (guard >= 5) accumulator = 0;
    }

    Render.render(ctx, state, { paused: paused, showHelp: showHelp, sprites: sprites });

    var status = document.getElementById("status");
    if (status) {
      status.textContent =
        "room " +
        (state.roomIndex + 1) +
        "/" +
        Core.ROOMS.length +
        " | hp " +
        Math.round(state.player.hp) +
        " | mp " +
        Math.round(state.player.mp) +
        " | lv " +
        state.player.level +
        " (" +
        Math.round(state.player.xp) +
        "/" +
        state.player.xpToNext +
        " xp)" +
        " | kills " +
        state.stats.kills +
        (state.victory ? " | cleared" : "") +
        (state.defeat ? " | defeated" : "");
    }

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
  window.nanoDnf = {
    getState: function () {
      return state;
    },
    restart: restart
  };
})();
