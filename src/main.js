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

  var KEY_MAP = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "jump",
    KeyW: "jump",
    Space: "jump",
    KeyJ: "attack",
    KeyK: "skill"
  };

  var held = { left: false, right: false, jump: false, attack: false, skill: false };
  var pressed = { jump: false, attack: false, skill: false };
  var state = Core.createState({ seed: Core.DEFAULT_SEED });
  var paused = false;
  var showHelp = true;
  var accumulator = 0;
  var lastTime = 0;

  function setKey(code, isDown, event) {
    var action = KEY_MAP[code];
    if (!action) return false;
    if (isDown && !held[action] && (action === "jump" || action === "attack" || action === "skill")) {
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
    held.left = held.right = held.jump = held.attack = held.skill = false;
    pressed.jump = pressed.attack = pressed.skill = false;
  });

  function restart() {
    state = Core.createState({ seed: Core.DEFAULT_SEED });
    paused = false;
    accumulator = 0;
  }

  function currentInput() {
    return {
      left: held.left,
      right: held.right,
      jump: held.jump || pressed.jump,
      attack: held.attack || pressed.attack,
      skill: held.skill || pressed.skill
    };
  }

  function consumePressed() {
    pressed.jump = false;
    pressed.attack = false;
    pressed.skill = false;
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

    Render.render(ctx, state, { paused: paused, showHelp: showHelp });

    var status = document.getElementById("status");
    if (status) {
      status.textContent =
        "room " +
        (state.roomIndex + 1) +
        "/" +
        Core.ROOMS.length +
        " | hp " +
        Math.round(state.player.hp) +
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
