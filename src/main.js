/*
 * Browser entry point: keyboard + touch input, WebAudio feedback, fixed-step loop.
 * Depends on window.DNFCore, window.DNFRender, window.DNFLoadout and
 * window.DNFRecords.
 */
(function () {
  "use strict";

  var Core = window.DNFCore;
  var Render = window.DNFRender;
  var Loadout = window.DNFLoadout;
  var Records = window.DNFRecords;
  var Music = window.DNFMusic;
  var Hints = window.DNFHints;
  var Attract = window.DNFAttract || null;
  var Summary = window.DNFSummary || null;
  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");

  /*
   * Art shipped in assets/: the player frame sheet, the skill icons and the
   * baked skill effects. The sheets in this working copy are baked from the
   * local DNF client by assets/import_dnf_swordman.py and
   * assets/import_dnf_effects.py; assets/make_slayer_sprites.py regenerates the
   * original licence-clean Slayer art.
   *
   * rift.png is the same bake's big-cell sheet: 大蹦 is drawn far larger than a
   * 128px cell can hold, so its two rows live there instead (see EFFECT.riftRows
   * in render.js).
   */
  var sprites = {
    slayer: null, skills: null, effects: null, rift: null, awakening: null, region: null,
    monsters: null, forest: null, minimap: null
  };
  [
    ["slayer", "./assets/slayer.png"],
    ["skills", "./assets/skills.png"],
    ["effects", "./assets/effects.png"],
    ["rift", "./assets/rift.png"],
    /*
     * The region map's stage cards: the client's own menu art, nine 168x73
     * cards with each stage's name and boss already painted into them
     * (assets/import_dnf_region.py).
     */
    ["region", "./assets/region.png"],
    /*
     * The monsters of 幽暗密林: one row per archetype, frames in the client's
     * own order (assets/import_dnf_monsters.py).
     */
    ["monsters", "./assets/monsters.png"],
    /*
     * 幽暗密林's room art: the client's forest set 02 - far and mid layers, the
     * grass ground strips and the props a room scatters - each cropped to its
     * own ink (assets/import_dnf_scene.py, docs/adr/0028).
     */
    ["forest", "./assets/forest.png"],
    /*
     * The map window: one 18 px tile per cell of the dungeon, plus the two
     * markers, the disc its radar form is cut into and the nine pieces of its
     * own panel (assets/import_dnf_minimap.py).
     */
    ["minimap", "./assets/minimap.png"],
    /*
     * 魔狱血刹's 觉醒插画, and the one piece of art in this folder that is not
     * baked from the client: the client has no 一觉 illustration to bake (see
     * assets/import_awakening_cutin.py), so it is cut out of the reference clip
     * the owner handed over instead.
     */
    ["awakening", "./assets/awakening.png"]
  ].forEach(function (entry) {
    var image = new Image();
    image.src = entry[1];
    image.onload = function () {
      sprites[entry[0]] = image;
    };
  });

  /*
   * DNF Slayer layout: arrows move, X attacks, C jumps, A/S/D/F/G/H are slots.
   *
   * All four arrows move, because the ground has two axes now: up walks into
   * the screen and down walks back towards the camera. That is the client's own
   * arrangement and it costs the up arrow its old job as a jump alias - jump is
   * C, or Space. W and S are no substitute: they are hotbar slots 7 and 1.
   */
  var KEY_MAP = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    Space: "jump",
    KeyC: "jump",
    KeyX: "attack",
    KeyA: "slot0",
    KeyS: "slot1",
    KeyD: "slot2",
    KeyF: "slot3",
    KeyG: "slot4",
    KeyH: "slot5",
    KeyQ: "slot6",
    KeyW: "slot7",
    KeyE: "slot8",
    KeyR: "slot9",
    KeyT: "slot10",
    KeyY: "slot11"
  };

  /* DNF's own default: Z fires the up-slash wherever it sits in the quickbar. */
  Object.keys(Loadout.SKILL_KEYS).forEach(function (code) {
    KEY_MAP[code] = "skill:" + Loadout.SKILL_KEYS[code];
  });

  var ONE_SHOT_ACTIONS = {
    jump: true,
    attack: true,
    /*
     * 魔狱血刹 is the one *skill* key that is a press rather than a hold. The
     * first press raises the sword and the second brings it down, so a held key
     * would walk him through the whole move - raise, fall, raise again - twenty
     * times a second; the other skill keys want the opposite (holding them
     * re-casts the moment the cooldown allows).
     */
    "skill:hellbenter": true
  };

  /* Digit/Numpad 1-3 pick the between-room upgrade card with the same index. */
  var CHOICE_KEYS = {
    Digit1: 0,
    Digit2: 1,
    Digit3: 2,
    Numpad1: 0,
    Numpad2: 1,
    Numpad3: 2
  };

  var held = { left: false, right: false, up: false, down: false, jump: false, attack: false };
  var pressed = { jump: false, attack: false };
  Loadout.SLOT_KEYS.forEach(function (key, index) {
    var action = "slot" + index;
    held[action] = false;
    pressed[action] = false;
    ONE_SHOT_ACTIONS[action] = true;
  });

  /* ---------------------------------------------------------- skill bar */
  var LOADOUT_KEY = "nano-dnf-loadout";
  var loadout = Loadout.create(Core.SKILL_ORDER);
  var loadoutOpen = false;
  var drag = null;
  try {
    var savedLoadout = window.localStorage.getItem(LOADOUT_KEY);
    if (savedLoadout) loadout = Loadout.deserialize(savedLoadout, Core.SKILL_ORDER);
  } catch (error) {
    loadout = Loadout.create(Core.SKILL_ORDER);
  }

  function saveLoadout() {
    try {
      window.localStorage.setItem(LOADOUT_KEY, Loadout.serialize(loadout));
    } catch (error) {
      /* private mode: keep the in-memory loadout */
    }
  }

  var touchMode =
    location.search.indexOf("touch=1") !== -1 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var activePointers = {};
  var touchActions = [];

  /* --------------------------------------------------------------- runs */
  var RECORDS_KEY = "nano-dnf-records";
  var records = Records.emptyStore();
  try {
    var savedRecords = window.localStorage.getItem(RECORDS_KEY);
    if (savedRecords) records = Records.deserialize(savedRecords);
  } catch (error) {
    records = Records.emptyStore();
  }

  function saveRecords() {
    try {
      window.localStorage.setItem(RECORDS_KEY, Records.serialize(records));
    } catch (error) {
      /* private mode: keep the in-memory record */
    }
  }

  /*
   * Which stages are open. A stage unlocks when the one before it in
   * `Core.REGION.stages` has been cleared, so the region is a ramp and not a
   * menu - and the flag is the only thing about a run that outlives it
   * (`docs/adr/0026`: no character, no carried levels).
   */
  var PROGRESS_KEY = "nano-dnf-progress";
  var clearedStages = {};
  try {
    var savedProgress = window.localStorage.getItem(PROGRESS_KEY);
    var parsedProgress = savedProgress ? JSON.parse(savedProgress) : null;
    if (parsedProgress && typeof parsedProgress === "object" && parsedProgress.cleared) {
      Object.keys(parsedProgress.cleared).forEach(function (id) {
        if (parsedProgress.cleared[id] && Core.STAGES[id]) clearedStages[id] = true;
      });
    }
  } catch (error) {
    clearedStages = {};
  }

  function saveProgress() {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ cleared: clearedStages }));
    } catch (error) {
      /* private mode: the unlock lasts for this session only */
    }
  }

  function stageIsOpen(id) {
    if (id === Core.REGION.stages[0]) return true;
    var chain = Core.REGION.stages;
    var spot = chain.indexOf(id);
    if (spot <= 0) return false;
    return !!clearedStages[chain[spot - 1]];
  }

  /* The next stage down the chain, if there is one and it has rooms to fight. */
  function unlockNext(id) {
    var chain = Core.REGION.stages;
    var spot = chain.indexOf(id);
    var next = spot >= 0 && spot + 1 < chain.length ? chain[spot + 1] : null;
    clearedStages[id] = true;
    saveProgress();
    if (next && Core.STAGES[next] && Core.STAGES[next].rooms.length) return next;
    return null;
  }

  /* `?seed=123` pins a run; otherwise the shipped seed is the default. */
  function seedFromUrl() {
    var match = /[?&]seed=(\d{1,10})/.exec(location.search);
    return match ? Number(match[1]) >>> 0 : null;
  }

  function rollSeed() {
    return ((Math.floor(Math.random() * 0xffffffff) >>> 0) || 1) >>> 0;
  }

  var pinnedSeed = seedFromUrl();
  var currentSeed = pinnedSeed === null ? Core.DEFAULT_SEED : pinnedSeed;
  /* Which stage the next run fights; the region map is what changes it. */
  var currentStage = Core.REGION.stages[0];
  var lastRun = null;
  /* The numbers of the run that just ended, frozen at the clear. */
  var finishedRun = null;

  var state = Core.createState({ seed: currentSeed, stage: currentStage });
  var paused = false;
  var showHelp = true;
  /* "window" (the whole dungeon) or "radar" (the disc round the room he is in). */
  var mapMode = "window";
  var accumulator = 0;
  var lastTime = 0;
  /*
   * The title screen is also the demo. It owns its own Core state, so the run
   * waiting behind the overlay is never touched by the fight playing in front
   * of it.
   */
  var attractActive = !!Attract;
  var attract = Attract ? Attract.create({ seed: currentSeed }) : null;
  var attractAccumulator = 0;

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

  /*
   * Music bus: the procedural dungeon loop runs through its own gain node so
   * mute is a single, observable place rather than something every note checks.
   */
  var MUSIC_LEVEL = 0.5;
  var MUSIC_LOOKAHEAD_SECONDS = 0.25;
  var music = { bus: null, timer: null, step: 0, nextNoteTime: 0, scheduled: 0, playing: false };

  function ensureMusicBus() {
    var context = ensureAudio();
    if (!context) return null;
    if (music.bus) return music.bus;
    music.bus = context.createGain();
    music.bus.gain.value = audio.muted ? 0 : MUSIC_LEVEL;
    music.bus.connect(audio.master);
    return music.bus;
  }

  /** One scheduled note. Percussion is filtered noise, everything else a tone. */
  function scheduleMusicNote(context, note, at) {
    if (note.freq === null) {
      var frames = Math.max(1, Math.floor(context.sampleRate * note.duration));
      var buffer = context.createBuffer(1, frames, context.sampleRate);
      var data = buffer.getChannelData(0);
      for (var frame = 0; frame < frames; frame += 1) {
        data[frame] = (Math.random() * 2 - 1) * (1 - frame / frames);
      }
      var source = context.createBufferSource();
      source.buffer = buffer;
      var filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = note.filterFreq || 2000;
      var hat = context.createGain();
      hat.gain.value = note.gain;
      source.connect(filter);
      filter.connect(hat);
      hat.connect(music.bus);
      source.start(at);
      return;
    }

    var osc = context.createOscillator();
    var envelope = context.createGain();
    osc.type = note.type || "square";
    osc.frequency.setValueAtTime(note.freq, at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(note.gain, at + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
    osc.connect(envelope);
    envelope.connect(music.bus);
    osc.start(at);
    osc.stop(at + note.duration + 0.02);
  }

  /** Lookahead scheduler: keep the next fraction of a second queued on the clock. */
  function pumpMusic() {
    var context = audio.ctx;
    if (!context || !music.playing) return;
    while (music.nextNoteTime < context.currentTime + MUSIC_LOOKAHEAD_SECONDS) {
      var notes = Music.notesForStep(music.step);
      for (var index = 0; index < notes.length; index += 1) {
        scheduleMusicNote(context, notes[index], music.nextNoteTime);
        music.scheduled += 1;
      }
      music.step += 1;
      music.nextNoteTime += Music.STEP_SECONDS;
    }
  }

  /** Browsers only allow audio after a gesture, so the loop starts on first input. */
  function startMusic() {
    if (music.playing) return true;
    /* ensureMusicBus returns the gain node; the clock comes from the context. */
    if (!ensureMusicBus()) return false;
    var context = audio.ctx;
    if (context.state === "suspended" && context.resume) context.resume();
    music.playing = true;
    music.nextNoteTime = context.currentTime + 0.05;
    pumpMusic();
    music.timer = window.setInterval(pumpMusic, 60);
    return true;
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
    },
    /* The floor giving way: a low rumble with grit on top, unlike any hit. */
    collapse: function () {
      tone(96, 0.42, "sawtooth", 0.26, 0, 48);
      noise(0.34, 0.2, 0, 420);
      noise(0.2, 0.12, 0.06, 1600);
    }
  };

  function play(kind) {
    var sound = SOUNDS[kind];
    if (sound) sound();
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.32;
    /* Keep the music bus in step with the mute flag, not just the master. */
    if (music.bus) music.bus.gain.value = audio.muted ? 0 : MUSIC_LEVEL;
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
    collapses: 0,
    victory: false
  };

  /**
   * Bank a cleared run once. A defeat is not a record, and the write happens on
   * the victory edge only, so a finished run is never counted twice.
   */
  var runBanked = false;

  /* ---------------------------------------------------------------- hints */
  var hintSeen = {};
  var activeHint = null;

  /** One hint at a time, each landing once per run so it teaches instead of nags. */
  function syncHints() {
    if (activeHint) return;
    var pick = Hints.select(state, hintSeen);
    if (!pick) return;
    hintSeen[pick.id] = true;
    activeHint = { id: pick.id, text: pick.text, life: pick.life, maxLife: pick.life };
  }

  function ageHint(dt) {
    if (!activeHint) return;
    activeHint.life -= dt;
    if (activeHint.life <= 0) activeHint = null;
  }

  function syncRecords() {
    if (!state.victory || runBanked) return;
    runBanked = true;
    var outcome = Records.record(records, {
      stage: currentStage,
      seed: currentSeed,
      seconds: state.time,
      level: state.player.level,
      updatedAt: Date.now()
    });
    records = outcome.store;
    lastRun = { improved: outcome.improved, entry: outcome.entry };
    if (outcome.entry) {
      saveRecords();
      unlockNext(currentStage);
    }
  }

  /*
   * Freeze the run the moment it ends - cleared or lost. The clock and the HUD
   * keep moving behind the finish screen, so the table it draws has to read this
   * snapshot instead of a still-moving state.
   */
  function syncFinishedRun() {
    if (finishedRun || (!state.victory && !state.defeat)) return;
    finishedRun = {
      seed: currentSeed,
      seconds: state.time,
      level: state.player.level,
      upgrades: state.player.upgradesTaken.slice(),
      kills: state.stats.kills,
      damageTaken: state.stats.damageTaken,
      room: state.roomIndex,
      rooms: state.layout.length,
      victory: state.victory
    };
  }

  /* What the title and victory screens need, without leaking storage details. */
  function runSummary() {
    var record = Records.best(records, currentStage, currentSeed);
    var overall = Records.bestOverall(records, currentStage);
    var link = shareLink();
    var run = finishedRun || {
      seed: currentSeed,
      seconds: state.time,
      level: state.player.level,
      upgrades: state.player.upgradesTaken,
      kills: state.stats.kills,
      damageTaken: state.stats.damageTaken,
      room: state.roomIndex,
      rooms: state.layout.length
    };
    var table = Summary
      ? Summary.describe({
          seed: run.seed,
          seconds: run.seconds,
          level: run.level,
          upgrades: run.upgrades,
          kills: run.kills,
          damageTaken: run.damageTaken,
          room: run.room,
          rooms: run.rooms
        })
      : { rows: [] };
    /* The pace line reads the live clock while the run is still going. */
    var clock = finishedRun ? finishedRun.seconds : state.time;
    var paceLine = Summary ? Summary.pace(clock, record) : { state: "none", text: null };
    return {
      seed: currentSeed,
      record: record,
      runs: records.runs,
      lastRun: lastRun,
      improved: !!(lastRun && lastRun.improved),
      rows: table.rows,
      link: link,
      linkText: link ? "本局链接 " + link : null,
      pace: paceLine,
      overallText: overall
        ? "历史最佳 " +
          Records.formatSeconds(overall.seconds) +
          " · 种子 " +
          overall.seed
        : null,
      seedText: "种子 " + currentSeed,
      recordText: record
        ? "本种子最佳 " +
          Records.formatSeconds(record.seconds) +
          " · Lv " +
          record.level +
          " · 已通关 " +
          record.clears +
          " 次（累计 " +
          records.runs +
          " 次）"
        : "本种子还没有通关记录",
      resultText:
        lastRun && lastRun.entry
          ? (lastRun.improved ? "新纪录！ " : "本次 ") +
            Records.formatSeconds(lastRun.entry.seconds) +
            " · Lv " +
            lastRun.entry.level
          : null
    };
  }

  function syncSounds() {
    var player = state.player;
    if (state.stats.hits > watch.hits) {
      play(player.skillTimer > 0 ? "skill" : "hit");
    }
    if (state.stats.kills > watch.kills) play("kill");
    if (player.hp < watch.hp) play("hurt");
    if (player.level > watch.level) play("levelup");
    if (state.roomIndex > watch.roomIndex) play("gate");
    if (state.stats.collapses > watch.collapses) play("collapse");
    if (state.victory && !watch.victory) play("clear");
    watch.hits = state.stats.hits;
    watch.kills = state.stats.kills;
    watch.hp = player.hp;
    watch.level = player.level;
    watch.roomIndex = state.roomIndex;
    watch.collapses = state.stats.collapses;
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
    if (isDown) {
      ensureAudio();
      startMusic();
    }
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

  /*
   * What the map's hit test needs: which of its two forms is up, and whether the
   * top-right corner is already the touch buttons' (they take it, so the window
   * drops below them - see Render.minimapBox).
   */
  function mapMeta() {
    return { map: { mode: mapMode }, touch: { enabled: touchMode } };
  }

  function touchDown(event) {
    if (showHelp) {
      openRegion();
      event.preventDefault();
      return;
    }
    var point = canvasPoint(event);
    if (regionOpen) {
      event.preventDefault();
      ensureAudio();
      var hit = Render.hitTestRegion(point.x, point.y, regionStageIds().length);
      if (hit === null) return;
      if (hit === regionSelection) regionEnter();
      else regionPick(regionStageIds()[hit]);
      return;
    }

    /* The reward chooser owns the pointer while it is open. */
    if (state.upgradeChoice) {
      var cardIndex = Render.hitTestUpgrade(point.x, point.y);
      if (cardIndex !== null) {
        event.preventDefault();
        ensureAudio();
        Core.chooseUpgrade(state, state.upgradeChoice.options[cardIndex]);
        return;
      }
    }

    /*
     * The map, in the corner: its ⊘ (or the disc, in the radar form) switches
     * between the two forms. It is hit-tested before the skill bar only because
     * it sits under it on the screen - neither reaches the other.
     */
    if (Render.hitTestMinimap(point.x, point.y, mapMeta())) {
      mapMode = mapMode === "window" ? "radar" : "window";
      event.preventDefault();
      ensureAudio();
      return;
    }

    /* Skill bar: tap to cast, or start a drag while arranging the loadout. */
    var bar = Render.hitTestLoadout(point.x, point.y, loadoutOpen, touchMode);
    if (bar) {
      event.preventDefault();
      ensureAudio();
      if (loadoutOpen) {
        var dragged = bar.kind === "slot" ? loadout[bar.index] : bar.skillId;
        if (dragged) {
          drag = {
            skillId: dragged,
            /* Which slot it came out of, so dropping it on nothing can clear it. */
            from: bar.kind === "slot" ? bar.index : null,
            x: point.x,
            y: point.y,
            pointerId: event.pointerId
          };
        }
        return;
      }
      if (bar.kind === "slot" && loadout[bar.index]) {
        var slotAction = "slot" + bar.index;
        activePointers[event.pointerId] = slotAction;
        held[slotAction] = true;
        pressed[slotAction] = true;
        if (touchActions.indexOf(slotAction) === -1) touchActions.push(slotAction);
      }
      return;
    }

    /* Movement / jump / attack buttons only exist on touch surfaces. */
    if (!touchMode) return;
    var action = Render.hitTestTouch(point.x, point.y);
    if (!action) return;
    event.preventDefault();
    ensureAudio();
    /* A tap is a gesture too: the soundtrack has to start on the touch path. */
    if (action !== "mute") startMusic();
    if (action === "mute") {
      toggleMute();
      return;
    }
    if (action === "loadout") {
      loadoutOpen = !loadoutOpen;
      drag = null;
      return;
    }
    /* Same toggle as the P key: a touch surface has no keyboard. */
    if (action === "pause") {
      paused = !paused;
      return;
    }
    activePointers[event.pointerId] = action;
    held[action] = true;
    if (ONE_SHOT_ACTIONS[action]) pressed[action] = true;
    if (touchActions.indexOf(action) === -1) touchActions.push(action);
  }

  function touchMove(event) {
    if (!drag) return;
    var point = canvasPoint(event);
    drag.x = point.x;
    drag.y = point.y;
    event.preventDefault();
  }

  function touchUp(event) {
    if (drag && drag.pointerId === event.pointerId) {
      var point = canvasPoint(event);
      var target = Render.hitTestLoadout(point.x, point.y, loadoutOpen, touchMode);
      if (target && target.kind === "slot") {
        loadout = Loadout.assign(loadout, target.index, drag.skillId);
        saveLoadout();
      } else if (target && target.kind === "tile") {
        /* Dropping a bar slot back on its own tile is the other way to empty it. */
        if (drag.from !== null && drag.from !== undefined && loadout[drag.from] === target.skillId) {
          loadout = Loadout.clearSlot(loadout, drag.from);
          saveLoadout();
        }
      } else if (drag.from !== null && drag.from !== undefined) {
        /*
         * Dragged off the bar and let go on nothing: that is how a skill comes
         * out. The bar has more slots than skills, so the owner wants to be able
         * to empty one (上挑 used to be stuck in its slot).
         */
        loadout = Loadout.clearSlot(loadout, drag.from);
        saveLoadout();
      }
      drag = null;
      event.preventDefault();
      return;
    }
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
    /*
     * The region map owns the keyboard while it is up: arrows walk the cards and
     * Enter commits. `F3` on a finished run goes back to it rather than straight
     * into another attempt - picking the stage is the player's next decision.
     */
    if (regionOpen) {
      if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
        regionMove(-1);
        event.preventDefault();
        return;
      }
      if (event.code === "ArrowRight" || event.code === "ArrowDown") {
        regionMove(1);
        event.preventDefault();
        return;
      }
      if (event.code === "Enter" || event.code === "Space") {
        regionEnter();
        event.preventDefault();
        return;
      }
    }
    if (event.code === "F3") {
      if (state.victory || state.defeat) openRegion();
      else restart();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyN") {
      /* A fresh seed is the reason a run is worth repeating. */
      currentSeed = rollSeed();
      restart();
      showHelp = false;
      leaveTitle();
      event.preventDefault();
      return;
    }
    if (event.code === "F1") {
      showHelp = !showHelp;
      if (!showHelp) leaveTitle();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyM") {
      toggleMute();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyB") {
      loadoutOpen = !loadoutOpen;
      drag = null;
      event.preventDefault();
      return;
    }
    /*
     * The map's two forms. `Tab` is the key DNF gives its map, and it is
     * swallowed here: left alone the browser would walk the page's own links
     * instead, and the next Enter would press one.
     */
    if (event.code === "Tab") {
      mapMode = mapMode === "window" ? "radar" : "window";
      event.preventDefault();
      return;
    }
    if (event.code === "F2") {
      touchMode = !touchMode;
      event.preventDefault();
      return;
    }
    /* The between-room reward is picked with 1/2/3 so it works on any layout. */
    var pick = CHOICE_KEYS[event.code];
    if (pick !== undefined && state.upgradeChoice) {
      Core.chooseUpgrade(state, state.upgradeChoice.options[pick]);
      event.preventDefault();
      return;
    }
    if (showHelp) {
      /* Off the title and into the hub, not straight into a run. */
      openRegion();
      event.preventDefault();
      return;
    }
    setKey(event.code, true, event);
  });

  window.addEventListener("keyup", function (event) {
    if (setKey(event.code, false, event) && event.code === "Space") {
      pressed.jump = false;
    }
  });

  canvas.addEventListener("pointerdown", touchDown);
  canvas.addEventListener("pointermove", touchMove);
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
    state = Core.createState({ seed: currentSeed, stage: currentStage });
    paused = false;
    accumulator = 0;
    attractAccumulator = 0;
    /* The demo previews the seed the player is about to get. */
    if (attractActive && Attract) attract = Attract.create({ seed: currentSeed });
    lastRun = null;
    finishedRun = null;
    runBanked = false;
    hintSeen = {};
    activeHint = null;
    watch.hits = 0;
    watch.kills = 0;
    watch.hp = state.player.hp;
    watch.level = state.player.level;
    watch.roomIndex = 0;
    watch.collapses = 0;
    watch.victory = false;
  }

  /* The link that reopens this exact run. */
  function shareLink() {
    if (!Summary || typeof Summary.seedUrl !== "function") return null;
    return Summary.seedUrl(window.location ? window.location.href : "", currentSeed);
  }

  function copyShareLink() {
    var link = shareLink();
    var clipboard = navigator && navigator.clipboard;
    if (!link || !clipboard || typeof clipboard.writeText !== "function") {
      return Promise.resolve(false);
    }
    return clipboard
      .writeText(link)
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  /*
   * The demo belongs to the title screen alone. Retiring it on the first
   * dismissal keeps F1 mid-run showing the frozen real run instead of a replay.
   */
  function leaveTitle() {
    attractActive = false;
  }

  /* ---------------------------------------------------------- region map */

  /*
   * The hub of the whole game: 格兰之森's eight stages, one card each. The cards
   * are the client's own menu art (`assets/region.png`), so the stage's name and
   * its boss are already on them and this screen draws no words of its own
   * except the ones the client did not supply.
   *
   * Stages open in `Core.REGION.stages` order - a stage opens when the one
   * before it is cleared - and the sim is frozen the whole time this is up, the
   * same as every other full-screen overlay.
   */
  var regionOpen = false;
  var regionSelection = 0;

  function regionStageIds() {
    return Core.REGION.stages.filter(function (id) {
      return !!Core.STAGES[id];
    });
  }

  function openRegion() {
    regionOpen = true;
    regionSelection = Math.max(0, regionStageIds().indexOf(currentStage));
    showHelp = false;
    leaveTitle();
    /* Behind the map the run is rebuilt for whichever stage is selected, so the
       attract demo and the first frame of the run are never stale. */
    if (attractActive && Attract) attract = Attract.create({ seed: currentSeed });
  }

  /**
   * Move the cursor onto a stage. **This does not choose it.** Merely walking
   * across the map used to reassign `currentStage`, which is what a run is
   * launched from and what a record is filed under - so arrowing past a card
   * after a win filed the *next* run's name on the last run's record. Only
   * `regionEnter` picks.
   */
  function regionPick(id) {
    if (!id) return;
    regionSelection = Math.max(0, regionStageIds().indexOf(id));
  }

  /** Start the stage the cursor is on, if it is open and built. */
  function regionEnter() {
    var ids = regionStageIds();
    var spot = Math.max(0, Math.min(ids.length - 1, regionSelection));
    var id = ids[spot];
    if (!id || !stageIsOpen(id) || !Core.STAGES[id].rooms.length) return;
    currentStage = id;
    regionOpen = false;
    restart();
  }

  /** Move the cursor, skipping nothing - a locked card is still worth reading. */
  function regionMove(step) {
    var ids = regionStageIds();
    if (!ids.length) return;
    regionSelection = (regionSelection + step + ids.length) % ids.length;
    regionPick(ids[regionSelection]);
  }

  function currentInput() {
    var input = {
      left: held.left,
      right: held.right,
      up: held.up,
      down: held.down,
      jump: held.jump || pressed.jump,
      attack: held.attack || pressed.attack,
      skills: {}
    };
    Core.SKILL_ORDER.forEach(function (skillId) {
      input.skills[skillId] = false;
    });
    loadout.forEach(function (skillId, index) {
      if (!skillId) return;
      var action = "slot" + index;
      if (held[action] || pressed[action]) input.skills[skillId] = true;
    });
    /*
     * A skill's own key works next to its slot, not instead of it - and it keeps
     * working when the skill is not in the bar at all. 上挑 is on Z whatever the
     * arrangement says; the client does the same, and a loadout that happens to
     * leave it out (or a bar restored from an older save) must not be able to
     * take the key away.
     */
    Object.keys(Loadout.SKILL_KEYS).forEach(function (code) {
      var skillId = Loadout.SKILL_KEYS[code];
      var shortcut = "skill:" + skillId;
      var wants = ONE_SHOT_ACTIONS[shortcut]
        ? pressed[shortcut]
        : held[shortcut] || pressed[shortcut];
      if (wants) input.skills[skillId] = true;
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

    /*
     * The dungeon only runs during live play. The title screen is a full-screen
     * overlay, so leaving it up used to let the room-1 enemies beat an idle
     * Slayer to 0 HP before the player pressed anything.
     */
    if (!paused && !showHelp && !regionOpen) {
      accumulator += delta;
      var guard = 0;
      while (accumulator >= Core.DT && guard < 5) {
        Core.step(state, currentInput());
        syncSounds();
        syncHints();
        ageHint(Core.DT);
        syncFinishedRun();
        syncRecords();
        consumePressed();
        accumulator -= Core.DT;
        guard += 1;
      }
      if (guard >= 5) accumulator = 0;
    }

    /*
     * The demo runs on the same fixed step as the game, but against its own
     * state and with no input, sound or record side effects.
     */
    var titleUp = attractActive && showHelp && !!attract;
    if (titleUp) {
      attractAccumulator += delta;
      var demoGuard = 0;
      while (attractAccumulator >= Core.DT && demoGuard < 5) {
        Attract.step(attract, Core.DT);
        attractAccumulator -= Core.DT;
        demoGuard += 1;
      }
      if (demoGuard >= 5) attractAccumulator = 0;
    }

    var meta = {
      paused: titleUp ? false : paused,
      showHelp: showHelp,
      attract: titleUp,
      sprites: sprites,
      touch: { enabled: touchMode, pressed: touchActions, muted: audio.muted, paused: paused },
      loadout: loadout,
      loadoutOpen: loadoutOpen,
      drag: drag,
      run: runSummary(),
      hint: titleUp ? null : activeHint,
      /*
       * The map window's form (`docs/adr/0029`). It is always up - that is what
       * the reference does - and this only picks which of its two shapes it is
       * drawn in: the whole dungeon, or the disc centred on the room he is in.
       */
      map: { mode: mapMode },
      /*
       * The region map, assembled here so render.js never reaches into the
       * storage or the stage table for it (`drawRegionMap`).
       */
      region: regionOpen
        ? {
            open: true,
            selected: regionSelection,
            list: regionStageIds().map(function (id) {
              var spec = Core.STAGES[id];
              var best = Records.bestOverall(records, id);
              /* The card art already carries the stage's name and its boss, so
                 the only line render.js has to draw under a card is this one. */
              var note = "Lv " + spec.level[0] + "–" + spec.level[1];
              if (best) note += " · 最佳 " + Records.formatSeconds(best.seconds);
              if (clearedStages[id]) note += " · 已通关";
              return {
                id: id,
                name: spec.name,
                slot: spec.slot,
                built: spec.rooms.length > 0,
                open: stageIsOpen(id),
                cleared: !!clearedStages[id],
                note: note
              };
            })
          }
        : null
    };
    /* A paused run reports itself from the live state, never from a finished one. */
    if (meta.paused && Summary) meta.liveRows = Summary.liveRun(state, currentSeed).rows;
    Render.render(ctx, titleUp ? attract.state : state, meta);

    var status = document.getElementById("status");
    if (status) {
      status.textContent =
        "room " +
        (state.roomIndex + 1) +
        "/" +
        state.layout.length +
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

  /* Keep the static page hint honest when the dungeon gains or loses rooms. */
  (function describeDungeon() {
    var hint = document.getElementById("dungeon-hint");
    if (!hint) return;
    hint.textContent =
      "清空房间后走到最右侧传送门进入下一层，第 " +
      state.layout.length +
      " 层击败 Boss 即通关。触屏设备会自动显示虚拟按键（也可在地址后加 ?touch=1 强制开启）。";
  })();

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
    getLoadout: function () {
      return loadout.slice();
    },
    setLoadout: function (slots) {
      loadout = Loadout.deserialize(Loadout.serialize(slots || []), Core.SKILL_ORDER);
      saveLoadout();
      return loadout.slice();
    },
    resetLoadout: function () {
      loadout = Loadout.create(Core.SKILL_ORDER);
      saveLoadout();
      return loadout.slice();
    },
    isArranging: function () {
      return loadoutOpen;
    },
    setArranging: function (open) {
      loadoutOpen = !!open;
      drag = null;
      return loadoutOpen;
    },
    setTouchMode: function (enabled) {
      touchMode = !!enabled;
      return touchMode;
    },
    isTouchMode: function () {
      return touchMode;
    },
    getSeed: function () {
      return currentSeed;
    },
    /* Which stage the run is on, and where the region map has got to. */
    getStage: function () {
      return currentStage;
    },
    /* The map window: its form, and the room grid it is drawing. */
    getMap: function () {
      return {
        mode: mapMode,
        grid: state.minimap,
        room: state.roomIndex
      };
    },
    setMapMode: function (mode) {
      mapMode = mode === "radar" ? "radar" : "window";
      return mapMode;
    },
    getProgress: function () {
      return {
        current: currentStage,
        regionOpen: regionOpen,
        selected: regionStageIds()[regionSelection] || null,
        cleared: Object.keys(clearedStages).filter(function (id) {
          return clearedStages[id];
        }),
        open: regionStageIds().filter(stageIsOpen)
      };
    },
    getRecords: function () {
      return JSON.parse(JSON.stringify(records));
    },
    getRunSummary: function () {
      return runSummary();
    },
    getMusicState: function () {
      return {
        started: music.playing,
        step: music.step,
        scheduledNotes: music.scheduled,
        busGain: music.bus ? music.bus.gain.value : null,
        nextNoteTime: music.nextNoteTime,
        stepSeconds: typeof Music === "undefined" ? null : Music.STEP_SECONDS,
        contextState: audio.ctx ? audio.ctx.state : "none"
      };
    },
    getHintState: function () {
      return {
        active: activeHint ? { id: activeHint.id, text: activeHint.text, life: activeHint.life } : null,
        seen: Object.keys(hintSeen),
        available: typeof Hints === "undefined" ? 0 : Hints.HINTS.length
      };
    },
    /* The self-playing title demo, and whether it still owns the screen. */
    getAttract: function () {
      return {
        active: attractActive && showHelp && !!attract,
        retired: !attractActive,
        demo: Attract && attract ? Attract.snapshot(attract) : null
      };
    },
    /* The link that reopens this exact run, and the page's copy control. */
    getShareLink: shareLink,
    copyShareLink: copyShareLink,
    /* The pause overlay's live readout, and whether the run is paused right now. */
    getLiveRows: function () {
      return Summary ? Summary.liveRun(state, currentSeed).rows : [];
    },
    getPace: function () {
      return runSummary().pace;
    },
    isPaused: function () {
      return paused;
    },
    /* 血之狂暴 is a stance: on until it is cast again. */
    isRaging: function () {
      return !!(state.player && state.player.buffs && state.player.buffs.bloodRage > 0);
    },
    /*
     * Manual QA: drive the title demo forward in one go. The browser proof uses
     * it to reach the boss without waiting out the whole dungeon in real time.
     */
    fastForwardAttract: function (seconds) {
      if (!attract || !Attract) return null;
      var budget = Math.max(0, Math.min(300, Number(seconds) || 0));
      var frames = Math.round(budget / Core.DT);
      for (var frame = 0; frame < frames; frame += 1) {
        Attract.step(attract, Core.DT);
      }
      return Attract.snapshot(attract);
    },
    /* Manual QA: show one hint again without waiting for its trigger. */
    previewHint: function (id) {
      var spec = Hints.HINTS.filter(function (hint) {
        return hint.id === id;
      })[0];
      if (!spec) return null;
      activeHint = { id: spec.id, text: spec.text, life: spec.life, maxLife: spec.life };
      return { id: spec.id, text: spec.text };
    }
  };

  /* The copy control lives in the page, so the shell wires it up. */
  (function wireShareButton() {
    var button = document.getElementById("copy-seed");
    var label = document.getElementById("copy-seed-status");
    if (!button) return;
    button.addEventListener("click", function () {
      copyShareLink().then(function (copied) {
        if (label) label.textContent = copied ? "已复制" : "复制失败";
      });
    });
  })();
})();
