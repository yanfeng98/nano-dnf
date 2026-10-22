/*
 * Procedural dungeon loop: a deterministic note scheduler.
 *
 * Pure data + pure functions so the arrangement can be unit tested without an
 * AudioContext. Loaded as `window.DNFMusic` in the browser and as a CommonJS
 * module in Node; the shell owns the oscillators and the clock.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFMusic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BPM = 96;
  var STEPS_PER_BEAT = 4; /* sixteenth notes */
  var BEATS_PER_BAR = 4;
  var STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

  /* i - VI - III - VII in A minor: the shape of a DNF dungeon theme. */
  var PROGRESSION = [
    { name: "Am", root: 57, tones: [57, 60, 64] },
    { name: "F", root: 53, tones: [53, 57, 60] },
    { name: "C", root: 48, tones: [48, 52, 55] },
    { name: "G", root: 55, tones: [55, 59, 62] }
  ];
  var LOOP_STEPS = PROGRESSION.length * STEPS_PER_BAR;

  /* How long one scheduler step lasts at the theme tempo. */
  var STEP_SECONDS = 60 / BPM / STEPS_PER_BEAT;

  function midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function normalizeStep(step) {
    var value = Math.floor(Number(step));
    if (!isFinite(value)) return 0;
    var wrapped = value % LOOP_STEPS;
    return wrapped < 0 ? wrapped + LOOP_STEPS : wrapped;
  }

  function chordForStep(step) {
    return PROGRESSION[Math.floor(normalizeStep(step) / STEPS_PER_BAR)];
  }

  /**
   * The notes that start on one step of the loop.
   *
   * Always returns an array (often empty): the bass drives the pulse, the lead
   * arpeggiates the chord an octave up, and a hat marks the beat. `freq` is null
   * for percussion, which the shell renders as filtered noise.
   */
  function notesForStep(step) {
    var index = normalizeStep(step);
    var inBar = index % STEPS_PER_BAR;
    var chord = chordForStep(index);
    var notes = [];

    if (inBar === 0 || inBar === 8) {
      notes.push({
        channel: "bass",
        freq: midiToFreq(chord.root - 12),
        type: "triangle",
        gain: 0.22,
        duration: inBar === 0 ? STEP_SECONDS * 7 : STEP_SECONDS * 3
      });
    }

    if (inBar % 2 === 0) {
      var tone = chord.tones[(inBar / 2) % chord.tones.length];
      notes.push({
        channel: "lead",
        freq: midiToFreq(tone + 12),
        type: "square",
        gain: 0.07,
        duration: STEP_SECONDS * 1.6
      });
    }

    if (inBar % 4 === 0) {
      notes.push({
        channel: "hat",
        freq: null,
        gain: 0.05,
        duration: 0.04,
        filterFreq: inBar === 0 ? 2600 : 5200
      });
    }

    return notes;
  }

  /*
   * **放哪一首。**
   *
   * 第三片定的口径是：音乐不再是这个合成器，而是**客户端里那两首**
   * （`docs/adr/0038`）—— 关卡一首、Boss 房另一首，客户端的曲单里就是成对的
   * （`mirkwood.ogg` / `mirkwood_boss.ogg`）。**哪一格是 Boss 房由地牢自己说**
   * （`MIRKWOOD_DUNGEON.bossRoom` 是**房间序号**，不是格子序号），不用另立一张表。
   *
   * 这个函数是**纯的**：它只说"该放哪一首"，不管文件在不在、更不管怎么放。
   * 播放那一段在 `src/main.js`，没文件的时候它会回落到下面这个合成器。
   */
  var TRACKS = {
    /*
     * **开始画面一首，副本一首。** 标题页与地区地图放的是客户端自己的
     * `intro.ogg` —— 它不是副本里的曲子，所以不能借 `room` 那一首顶：
     * 业主 2026-10-17 的原话是「游戏开始的音乐请你也改掉」。进副本
     * （过场插画走完、房间淡进来）才切到 `mirkwood`，Boss 房再切 Boss 那首。
     */
    title: { file: "assets/music/intro.ogg", label: "开始画面" },
    room: { file: "assets/music/mirkwood.ogg", label: "关卡" },
    boss: { file: "assets/music/mirkwood_boss.ogg", label: "Boss 房" },
    /*
     * 幽暗密林深处 的 Boss 曲：频谱比对录像 350-390s 对上客户端 `forest02.ogg`
     * （相关系数 0.78，明显高于 `mirkwood_boss.ogg` 的 0.48）。
     */
    bossDeep: { file: "assets/music/forest02.ogg", label: "幽暗密林深处 Boss" }
  };

  /**
   * Which track belongs on screen.
   *
   * `options.title` is the title/region-map/cutscene state: the caller knows
   * whether the run has actually started, and this module stays pure. Without
   * the flag the old contract holds (a state with no dungeon asks for `room`),
   * so existing callers and tests keep working.
   */
  function trackFor(state, options) {
    if (options && options.title) return "title";
    var dungeon = state && state.dungeon;
    if (!dungeon || dungeon.boss === undefined) return "room";
    /*
     * **`dungeon.boss` 是格子序号**（这一局那张图上 Boss 落在哪一格），和 `state.cell`
     * 同一个坐标系，所以直接比。`MIRKWOOD_DUNGEON.bossRoom` 是**房间序号**，两个
     * 不是一回事，别混。
     */
    if (state.cell !== dungeon.boss) return "room";
    /*
     * 深处的 Boss 房换客户端的 `forest02.ogg`；别的关卡仍用各自的 Boss 曲。
     * 这里读 `stage.id`，因为同一首曲子可能被两个关卡共用，不能只看 "boss"。
     */
    var stageId = state.stage && (state.stage.id || state.stage.code);
    return stageId === "mirkwooddeep" ? "bossDeep" : "boss";
  }

  return {
    BPM: BPM,
    STEP_SECONDS: STEP_SECONDS,
    STEPS_PER_BEAT: STEPS_PER_BEAT,
    BEATS_PER_BAR: BEATS_PER_BAR,
    STEPS_PER_BAR: STEPS_PER_BAR,
    LOOP_STEPS: LOOP_STEPS,
    PROGRESSION: PROGRESSION,
    midiToFreq: midiToFreq,
    normalizeStep: normalizeStep,
    chordForStep: chordForStep,
    notesForStep: notesForStep,
    TRACKS: TRACKS,
    trackFor: trackFor
  };
});
