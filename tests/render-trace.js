"use strict";

/*
 * A recorder for what the renderer draws, frame by frame. A tool, not a test:
 * nothing runs it automatically.
 *
 *   node tests/render-trace.js write /tmp/trace-before.json
 *   node tests/render-trace.js compare /tmp/trace-before.json /tmp/trace-after.json
 *
 * `write` plays two scenarios through the real renderer with a stand-in 2D
 * context that records every call, and hashes each frame. The attract demo
 * covers a whole run on its own (fights, skills, the boss, the upgrade cards)
 * and the Sunken Chapel is entered by hand because a layout drawn from the pool
 * does not always contain it - the collapsing slabs are the one thing on the
 * floor that is drawn as a disc, so they have to be in the sample.
 *
 * `compare` answers the question the depth work keeps needing answered: given a
 * change that claims not to move something, where did it actually move? Equal
 * digests mean every frame matched. Otherwise it reports the first frame that
 * differs, and on that frame it finds the longest run of identical calls at the
 * END of the frame - because a renderer draws back to front, so the tail is
 * whatever was drawn after the thing that changed. That index is the boundary:
 * everything past it is provably untouched, and everything before it is where
 * to look. It is how "only the backdrop moved" was settled rather than argued.
 *
 * Sprites are stubs (no PNG is decoded), so the sprite path still runs its
 * placement maths and its drawImage still lands in the trace with real numbers.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const Core = require("../src/core.js");
const Render = require("../src/render.js");
const Attract = require("../src/attract.js");

const IMAGE = { width: 1, height: 1, nodeName: "IMG" };
const SPRITES = { slayer: IMAGE, skills: IMAGE, effects: IMAGE, rift: IMAGE };

function fmt(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? value : Number(value.toFixed(6));
  }
  if (value === undefined) return "<undefined>";
  if (value === null) return null;
  if (typeof value === "object") return "<" + (value.nodeName || "obj") + ">";
  return value;
}

/*
 * `save`/`restore` are recorded but not honoured, so a style set inside a save
 * block leaks into the rest of the trace. Both sides of a comparison leak
 * identically, which is all this needs.
 */
function makeCtx(records) {
  const target = {
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    }
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      t[prop] = (...args) => records.push([String(prop), ...args.map(fmt)]);
      return t[prop];
    },
    set(t, prop, value) {
      /* Method caching above writes straight to `t`, so only styles land here. */
      records.push(["#" + String(prop), fmt(value)]);
      t[prop] = value;
      return true;
    }
  });
}

function renderOnce(state, records) {
  Render.render(makeCtx(records), state, {
    paused: false,
    showHelp: false,
    attract: true,
    sprites: SPRITES,
    touch: { enabled: false, pressed: [], muted: false, paused: false },
    loadout: null,
    loadoutOpen: false,
    drag: null,
    run: null,
    hint: null
  });
}

/* Every frame is hashed; every SAMPLE_EVERYth one also keeps its calls, so a
 * comparison has something to drill into. The file is a few tens of megabytes
 * at this density, which is why it is a working reference and never committed. */
const SAMPLE_EVERY = 12;

function write(path, attractSeconds, chapelSeconds) {
  const frames = [];
  const callsPerFrame = [];
  const samples = {};

  const capture = (state, index) => {
    const records = [];
    renderOnce(state, records);
    frames.push(crypto.createHash("sha1").update(JSON.stringify(records)).digest("hex").slice(0, 16));
    callsPerFrame.push(records.length);
    if (index % SAMPLE_EVERY === 0) samples[index] = records;
  };

  /* The attract demo plays a whole run by itself, on its own state. */
  const session = Attract.create({ seed: Core.DEFAULT_SEED });
  const attractFrames = Math.round(attractSeconds / Core.DT);
  for (let i = 0; i < attractFrames; i += 1) {
    Attract.step(session, Core.DT);
    if (session.state) capture(session.state, i);
  }

  /* Then the Sunken Chapel, driven by hand: hazards, collapses and the gate. */
  const chapel = Core.createState({ seed: Core.DEFAULT_SEED });
  chapel.layout = [Core.ALTERNATE_ROOM_INDEX];
  Core.startRoom(chapel, 0);
  const chapelFrames = Math.round(chapelSeconds / Core.DT);
  const offset = frames.length;
  for (let i = 0; i < chapelFrames; i += 1) {
    Core.step(chapel, {
      right: i % 120 < 60,
      left: i % 120 >= 60,
      jump: i % 45 === 0,
      attack: i % 30 === 0
    });
    capture(chapel, offset + i);
  }

  const digest = crypto.createHash("sha1").update(frames.join(",")).digest("hex");
  fs.writeFileSync(path, JSON.stringify({ digest, frames, callsPerFrame, samples }, null, 0));
  console.log(
    path,
    "frames=" + frames.length,
    "(attract " + attractFrames + ", chapel " + chapelFrames + ")",
    "digest=" + digest
  );
}

/** How many calls at the END of both frames are identical, in order. */
function commonSuffix(before, after) {
  const max = Math.min(before.length, after.length);
  let run = 0;
  while (
    run < max &&
    JSON.stringify(before[before.length - 1 - run]) === JSON.stringify(after[after.length - 1 - run])
  ) {
    run += 1;
  }
  return run;
}

function compare(beforePath, afterPath) {
  const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const after = JSON.parse(fs.readFileSync(afterPath, "utf8"));

  if (before.digest === after.digest) {
    console.log("IDENTICAL — all " + before.frames.length + " frames match, digest " + before.digest);
    return;
  }

  const frame = before.frames.findIndex((hash, index) => hash !== after.frames[index]);
  const differing = before.frames.filter((hash, index) => hash !== after.frames[index]).length;
  console.log("DIFFERS — " + differing + " of " + before.frames.length + " frames");
  console.log("first differing frame: " + frame);

  /*
   * Drill into the differing frame if it was kept, and into the nearest one
   * before it if it was not: a difference that first shows on frame 13 is still
   * there on frame 12, nine times in ten.
   */
  const kept = Object.keys(before.samples)
    .map(Number)
    .sort((x, y) => x - y);
  const at = kept.includes(frame) ? frame : kept.filter((index) => index < frame).pop();
  if (at === undefined) {
    console.log("(no calls recorded that early; nothing to drill into)");
    return;
  }
  if (at !== frame) console.log("(frame " + frame + " was not kept; drilling into frame " + at + ")");

  const a = before.samples[at];
  const b = after.samples[at];
  const suffix = commonSuffix(a, b);
  console.log("calls per frame: " + a.length + " -> " + b.length + " (" + (b.length - a.length) + ")");
  console.log(
    "identical from call " + (a.length - suffix) + " onward (" + suffix + " calls untouched), " +
      "so the change is confined to the first " + (a.length - suffix)
  );

  const first = a.findIndex((call, index) => JSON.stringify(call) !== JSON.stringify(b[index]));
  if (first !== -1) {
    console.log("first differing call " + first + ":");
    console.log("  before " + JSON.stringify(a[first]));
    console.log("  after  " + JSON.stringify(b[first]));
  }
}

const [mode, one, two, three] = process.argv.slice(2);
if (mode === "write") {
  write(one || "/tmp/render-trace.json", Number(two || 60), Number(three || 24));
} else if (mode === "compare") {
  compare(one, two);
} else {
  console.log("usage: node tests/render-trace.js write <file> [attractSeconds] [chapelSeconds]");
  console.log("       node tests/render-trace.js compare <before.json> <after.json>");
  process.exit(1);
}
