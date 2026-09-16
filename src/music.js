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
    notesForStep: notesForStep
  };
});
