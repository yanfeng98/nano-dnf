/*
 * Browser entry point: keyboard + touch input, WebAudio feedback, fixed-step loop.
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

  var touchMode =
    location.search.indexOf("touch=1") !== -1 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var activePointers = {};
  var touchActions = [];

  var state = Core.createState({ seed: Core.DEFAULT_SEED });
  var paused = false;
  var showHelp = true;
  var accumulator = 0;
  var lastTime = 0;

  /* ---------------------------------------------------------------- audio */
  var audio = { ctx: null, master: null, muted: false };
  try {
    audio.muted = window.localStorage.getItem("nano-dnf-muted") === "1";
  } catch (error) {
    audio.muted = false;
  }

  function ensureAudio() {
    if (audio.ctx) return audio.ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audio.ctx = new Ctor();
    } catch (error) {
      return null;
    }
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.32;
    audio.master.connect(audio.ctx.destination);
    return audio.ctx;
  }

  function tone(freq, duration, type, gain, delay, sweepTo) {
    if (audio.muted) return;
    var context = ensureAudio();
    if (!context) return;
    if (context.state === "suspended" && context.resume) context.resume();
    var start = context.currentTime + (delay || 0);
    var osc = context.createOscillator();
    var envelope = context.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain || 0.2, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope);
    envelope.connect(audio.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noise(duration, gain, delay, filterFreq) {
    if (audio.muted) return;
    var context = ensureAudio();
    if (!context) return;
    var frames = Math.max(1, Math.floor(context.sampleRate * duration));
    var buffer = context.createBuffer(1, frames, context.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    var source = context.createBufferSource();
    source.buffer = buffer;
    var filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq || 1200;
    var envelope = context.createGain();
    envelope.gain.value = gain || 0.15;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(audio.master);
    source.start(context.currentTime + (delay || 0));
  }

  var SOUNDS = {
    swing: function () {
      noise(0.07, 0.12, 0, 1800);
    },
    hit: function () {
      tone(320, 0.07, "square", 0.18, 0, 220);
      noise(0.05, 0.1, 0, 2400);
    },
    heavy: function () {
      tone(150, 0.18, "sawtooth", 0.22, 0, 80);
      noise(0.14, 0.16, 0, 700);
    },
    skill: function () {
      tone(260, 0.22, "triangle", 0.2, 0, 560);
      noise(0.16, 0.12, 0, 900);
    },
    hurt: function () {
      tone(140, 0.24, "square", 0.24, 0, 70);
    },
    kill: function () {
      tone(520, 0.14, "triangle", 0.18, 0, 260);
    },
    levelup: function () {
      [523, 659, 784].forEach(function (freq, index) {
        tone(freq, 0.18, "triangle", 0.2, index * 0.09);
      });
    },
    clear: function () {
      [523, 659, 784, 1046].forEach(function (freq, index) {
        tone(freq, 0.26, "triangle", 0.22, index * 0.14);
      });
    },
    gate: function () {
      tone(880, 0.2, "sine", 0.16, 0);
      tone(1174, 0.24, "sine", 0.14, 0.1);
    }
  };

  function play(kind) {
    var sound = SOUNDS[kind];
    if (sound) sound();
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.32;
    if (!audio.muted) play("gate");
    try {
      window.localStorage.setItem("nano-dnf-muted", audio.muted ? "1" : "0");
    } catch (error) {
      /* private mode: keep the in-memory preference */
    }
    return audio.muted;
  }

  var watch = {
    hits: 0,
    kills: 0,
    hp: state.player.hp,
    level: state.player.level,
    roomIndex: 0,
    victory: false
  };

  function syncSounds() {
    var player = state.player;
    if (state.stats.hits > watch.hits) {
      play(player.skillTimer > 0 ? "skill" : "hit");
    }
    if (state.stats.kills > watch.kills) play("kill");
    if (player.hp < watch.hp) play("hurt");
    if (player.level > watch.level) play("levelup");
    if (state.roomIndex > watch.roomIndex) play("gate");
    if (state.victory && !watch.victory) play("clear");
    watch.hits = state.stats.hits;
    watch.kills = state.stats.kills;
    watch.hp = player.hp;
    watch.level = player.level;
    watch.roomIndex = state.roomIndex;
    watch.victory = state.victory;
  }

  /* ------------------------------------------------------------- controls */
  function setKey(code, isDown, event) {
    var action = KEY_MAP[code];
    if (!action) return false;
    if (isDown && !held[action] && ONE_SHOT_ACTIONS[action]) {
      pressed[action] = true;
    }
    held[action] = isDown;
    if (isDown) ensureAudio();
    if (event) event.preventDefault();
    return true;
  }

  function canvasPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function touchDown(event) {
    if (!touchMode) return;
    if (showHelp) {
      showHelp = false;
      event.preventDefault();
      return;
    }
    var point = canvasPoint(event);
    var action = Render.hitTestTouch(point.x, point.y);
    if (!action) return;
    event.preventDefault();
    ensureAudio();
    if (action === "mute") {
      toggleMute();
      return;
    }
    activePointers[event.pointerId] = action;
    held[action] = true;
    if (ONE_SHOT_ACTIONS[action]) pressed[action] = true;
    if (touchActions.indexOf(action) === -1) touchActions.push(action);
  }

  function touchUp(event) {
    var action = activePointers[event.pointerId];
    if (!action) return;
    delete activePointers[event.pointerId];
    held[action] = false;
    var stillHeld = Object.keys(activePointers).some(function (id) {
      return activePointers[id] === action;
    });
    if (!stillHeld) {
      held[action] = false;
      touchActions = touchActions.filter(function (entry) {
        return entry !== action;
      });
    }
    if (event.preventDefault) event.preventDefault();
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
    if (event.code === "KeyM") {
      toggleMute();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyT") {
      touchMode = !touchMode;
      event.preventDefault();
      return;
    }
    if (showHelp) showHelp = false;
    setKey(event.code, true, event);
  });

  window.addEventListener("keyup", function (event) {
    if (setKey(event.code, false, event) && event.code === "Space") {
      pressed.jump = false;
    }
  });

  canvas.addEventListener("pointerdown", touchDown);
  canvas.addEventListener("pointerup", touchUp);
  canvas.addEventListener("pointercancel", touchUp);
  canvas.addEventListener("pointerleave", touchUp);
  canvas.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  window.addEventListener("blur", function () {
    Object.keys(held).forEach(function (key) {
      held[key] = false;
    });
    Object.keys(pressed).forEach(function (key) {
      pressed[key] = false;
    });
    activePointers = {};
    touchActions = [];
  });

  function restart() {
    state = Core.createState({ seed: Core.DEFAULT_SEED });
    paused = false;
    accumulator = 0;
    watch.hits = 0;
    watch.kills = 0;
    watch.hp = state.player.hp;
    watch.level = state.player.level;
    watch.roomIndex = 0;
    watch.victory = false;
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
        syncSounds();
        consumePressed();
        accumulator -= Core.DT;
        guard += 1;
      }
      if (guard >= 5) accumulator = 0;
    }

    Render.render(ctx, state, {
      paused: paused,
      showHelp: showHelp,
      sprites: sprites,
      touch: { enabled: touchMode, pressed: touchActions, muted: audio.muted }
    });

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
        (touchMode ? " | touch" : "") +
        (audio.muted ? " | muted" : "") +
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
    restart: restart,
    getAudioState: function () {
      return {
        created: !!audio.ctx,
        muted: audio.muted,
        state: audio.ctx ? audio.ctx.state : "none"
      };
    },
    toggleMute: toggleMute,
    setTouchMode: function (enabled) {
      touchMode = !!enabled;
      return touchMode;
    },
    isTouchMode: function () {
      return touchMode;
    }
  };
})();
