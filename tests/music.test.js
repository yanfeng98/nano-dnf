"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Music = require("../src/music.js");
/* 换那一首看的是"这一格是不是 Boss 房"，那件事只有地牢知道（`state.dungeon`）。 */
const Core = require("../src/core.js");

test("the loop is a whole number of bars in A minor", () => {
  assert.equal(Music.STEPS_PER_BAR, Music.STEPS_PER_BEAT * Music.BEATS_PER_BAR);
  assert.equal(Music.LOOP_STEPS, Music.PROGRESSION.length * Music.STEPS_PER_BAR);
  assert.deepEqual(
    Music.PROGRESSION.map((chord) => chord.name),
    ["Am", "F", "C", "G"]
  );
  Music.PROGRESSION.forEach((chord) => {
    assert.equal(chord.tones.length, 3, `${chord.name} is a triad`);
    chord.tones.forEach((tone) => {
      assert.ok(Number.isInteger(tone), `${chord.name} tones are midi notes`);
    });
  });
});

test("every chord in the progression actually sounds", () => {
  Music.PROGRESSION.forEach((chord, bar) => {
    const first = bar * Music.STEPS_PER_BAR;
    const notes = Music.notesForStep(first);
    const bass = notes.find((note) => note.channel === "bass");
    const lead = notes.find((note) => note.channel === "lead");

    assert.ok(bass, `bar ${bar + 1} (${chord.name}) needs a bass note on its downbeat`);
    assert.ok(lead, `bar ${bar + 1} (${chord.name}) needs a lead note on its downbeat`);
    assert.ok(
      Music.PROGRESSION.some((entry) => Math.abs(entry.root - chord.root) < 12),
      `${chord.name} sits inside one octave of the key`
    );
    assert.ok(bass.freq > 40 && bass.freq < 220, `bass ${bass.freq}Hz must be low`);
    assert.ok(lead.freq > 220 && lead.freq < 1200, `lead ${lead.freq}Hz must be up top`);
  });
});

test("the motif is a fixed pattern with rests, not a wall of notes", () => {
  assert.equal(Music.notesForStep(1).length, 0, "step 1 is a rest: the pulse needs air");

  const channels = { bass: 0, lead: 0, hat: 0 };
  for (let step = 0; step < Music.LOOP_STEPS; step += 1) {
    Music.notesForStep(step).forEach((note) => {
      channels[note.channel] = (channels[note.channel] || 0) + 1;
    });
  }
  assert.equal(channels.bass, Music.PROGRESSION.length * 2, "two bass hits per bar");
  assert.equal(channels.hat, Music.PROGRESSION.length * 4, "four hats per bar");
  assert.ok(channels.lead > channels.bass, "the lead carries the melody");
  assert.ok(
    channels.lead + channels.bass + channels.hat < Music.LOOP_STEPS * 3,
    "the arrangement stays sparse enough to hear"
  );
});

test("notes carry everything the shell needs to synthesise them", () => {
  for (let step = 0; step < Music.LOOP_STEPS; step += 1) {
    Music.notesForStep(step).forEach((note) => {
      assert.ok(["bass", "lead", "hat"].includes(note.channel), `unknown channel ${note.channel}`);
      assert.ok(note.duration > 0, "a note needs a duration");
      assert.ok(note.gain > 0 && note.gain < 0.5, `gain ${note.gain} must stay in a sane range`);
      if (note.channel === "hat") {
        assert.equal(note.freq, null, "percussion is noise, not a tone");
        assert.ok(note.filterFreq > 0, "percussion needs a filter frequency");
      } else {
        assert.ok(note.freq > 0, `${note.channel} needs a frequency`);
        assert.ok(note.type, `${note.channel} needs an oscillator type`);
      }
    });
  }
});

test("the loop wraps in both directions", () => {
  assert.equal(Music.normalizeStep(Music.LOOP_STEPS), 0);
  assert.equal(Music.normalizeStep(Music.LOOP_STEPS + 3), 3);
  assert.equal(Music.normalizeStep(-1), Music.LOOP_STEPS - 1);
  assert.equal(Music.normalizeStep(NaN), 0);
  assert.equal(Music.normalizeStep(2.7), 2, "steps are integers");

  for (let step = 0; step < Music.LOOP_STEPS; step += 1) {
    assert.deepEqual(
      Music.notesForStep(step + Music.LOOP_STEPS),
      Music.notesForStep(step),
      "the second pass must sound exactly like the first"
    );
  }
});

test("the chord under a step follows its bar", () => {
  assert.equal(Music.chordForStep(0).name, "Am");
  assert.equal(Music.chordForStep(Music.STEPS_PER_BAR - 1).name, "Am");
  assert.equal(Music.chordForStep(Music.STEPS_PER_BAR).name, "F");
  assert.equal(Music.chordForStep(Music.LOOP_STEPS - 1).name, "G");
});

test("midi converts to concert pitch", () => {
  assert.equal(Math.round(Music.midiToFreq(69)), 440, "A4 is 440Hz");
  assert.equal(Math.round(Music.midiToFreq(57)), 220, "A3 is an octave down");
  assert.equal(Math.round(Music.midiToFreq(81)), 880);
});

test("the tempo gives a usable sixteenth-note step", () => {
  assert.equal(Music.BPM, 96);
  assert.ok(
    Math.abs(Music.STEP_SECONDS - 60 / 96 / 4) < 1e-9,
    "a step is a sixteenth at the theme tempo"
  );
  const loopSeconds = Music.STEP_SECONDS * Music.LOOP_STEPS;
  assert.ok(loopSeconds > 8 && loopSeconds < 14, `the loop should run ~10s, got ${loopSeconds}`);
});

/*
 * **进 Boss 房换那一首**（`docs/adr/0038`）。第三片定的口径是音乐改成读文件：
 * 关卡一首、Boss 房另一首。这条只管"该放哪一首" —— 文件在不在、怎么放，
 * 是 `src/main.js` 那一段的事（没文件时它回落到现在这个合成器）。
 */
test("走到 Boss 房那一格就换成 Boss 那一首", () => {
  assert.ok(Music.TRACKS.room.file && Music.TRACKS.boss.file, "两首都要有文件");
  assert.notEqual(Music.TRACKS.room.file, Music.TRACKS.boss.file, "两首不能是同一个文件");
  /*
   * **开始画面有自己的一首**（业主 2026-10-17：「游戏开始的音乐请你也改掉」）。
   * 它不能借 `room` 顶上：进副本要听得出换了一首。
   */
  assert.ok(Music.TRACKS.title.file, "开始画面也要有文件");
  assert.notEqual(Music.TRACKS.title.file, Music.TRACKS.room.file);
  assert.notEqual(Music.TRACKS.title.file, Music.TRACKS.boss.file);

  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  /* `dungeon.boss` 是**格子序号**，和 `state.cell` 同一个坐标系。 */
  const bossCell = state.dungeon.boss;
  assert.ok(typeof bossCell === "number", "地牢要说得出 Boss 落在哪一格");

  let sawBoss = false;
  state.dungeon.cells.forEach((cell, index) => {
    state.cell = index;
    const want = Music.trackFor(state);
    if (index === bossCell) {
      sawBoss = true;
      assert.equal(want, "boss", `第 ${index} 格是 Boss 房，该放 Boss 那一首`);
    } else {
      assert.equal(want, "room", `第 ${index} 格不是 Boss 房，该放关卡那一首`);
    }
  });
  assert.ok(sawBoss, "这一关要真的有一格是 Boss 房");
  /* 没有地牢的时候不许炸：标题页、地区地图都会问到它。 */
  assert.equal(Music.trackFor(null), "room");
  assert.equal(Music.trackFor({}), "room");
});

/*
 * **还没进副本 = 开始画面那一首。** 标题、地区地图与进副本那 2.34 秒过场都由
 * 调用方标成 `title`；房间淡进来、`state.intro` 清掉之后才轮到副本曲。
 */
test("标题、地区地图与进副本过场放开始画面那一首", () => {
  const state = Core.createState({ seed: Core.DEFAULT_SEED });
  assert.equal(Music.trackFor(null, { title: true }), "title");
  assert.equal(Music.trackFor(state, { title: true }), "title",
    "地牢已经建好、但过场还在走的时候，仍然是开始画面那一首");
  assert.equal(Music.trackFor(state), "room",
    "不传 title 时保持原来的口径：副本里默认放关卡曲");
});
