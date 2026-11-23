# Architectural Decision Records (nano-dnf -> Rust)

## ADR-001: Native Windows Desktop App (`nano-dnf.exe`)
Status: accepted (2026-11-23)
Context: The original app is an HTML5 Canvas 2D + WebAudio browser game (`index.html` + `src/*.js`, served statically by `scripts/serve.mjs` in dev). Running in a browser Canvas 2D context causes frame drops/stuttering ("很卡"), and the user wants to play directly on Windows without needing a browser or local server.
Decision: Port the entire game (`src/*.js`) to a standalone native Rust desktop application (`rust/app`, binary `nano-dnf.exe`) targeting `x86_64-pc-windows-gnu` (and `x86_64-unknown-linux-gnu` for local verification). Use native windowing + hardware-accelerated/fast 2D pixel rendering + native audio (`rodio`), keeping a 960x540 logical resolution scaled cleanly to the window at a locked 60 FPS fixed-step loop.
Consequences: Eliminates browser Canvas 2D and JS GC pauses. `scripts/` (asset importers, Playwright capture tools) and `docs/reference-evidence/` remain in JS/Python as reference and test tooling, not ported into the game binary.

## ADR-002: Scope of Port (All 11 `src/*.js` Game Modules)
Status: accepted (2026-11-23)
Context: `rust-anything analyze --whole-app` lists 13 units: 11 game modules under `src/`, plus `scripts/` and `docs/reference-evidence/`.
Decision: Port all 11 modules under `src/` into Rust crates under `rust/` and wire them into `rust/app`:
- Wave 0 (leaf logic): `music`, `loadout`, `records`, `summary`, `progress`
- Wave 1 (core & mid-tier logic): `core`, `attract`, `hints`, `reward`
- Wave 2 (renderer & desktop shell): `render`, `main`
Keep `tests/*.test.js` (587 tests) and `scripts/` as the behavioral oracle and reference.
Consequences: Every gameplay mechanic, room layout, skill, enemy AI, reward flow, progress, and HUD/sprite rendering is ported faithfully to Rust.

## ADR-003: Equivalence Bar & Verification
Status: accepted (2026-11-23)
Context: `core.js`, `loadout.js`, `progress.js`, `records.js`, `summary.js`, `reward.js`, `attract.js`, `hints.js`, and `music.js` are deterministic pure-logic modules with 587 existing unit tests. `render.js` and `main.js` drive Canvas 2D and WebAudio/DOM.
Decision:
1. All pure-logic crates must match the original JS 100% on recorded `rust-anything` cases (`diff` N/N) and pass `rust-anything gate` (fmt, clippy `-D warnings`, cargo test, no unguarded `unwrap`/`panic!`).
2. `core` and all logic crates must also pass Rust unit tests covering the 587 JS test assertions (fixed-step determinism, seeded dungeon layouts, combat/hitstop/skills, XP, rewards, records, progress).
3. `render` and `main` must preserve the exact 960x540 world/HUD coordinates, sprite sheet cropping/anchors, palette, keyboard bindings, and audio playback, with float tolerance `1e-6` where math/rendering differs.
Consequences: Zero gameplay drift between JS and Rust.

## ADR-004: Portable Save Data & Runtime Assets
Status: accepted (2026-11-23)
Context: Original uses browser `localStorage` for `records`, `progress`, `loadout`, and loads ~40 PNGs plus `assets/music/*.ogg` and `assets/sfx/*` at runtime. `assets/` also contains ~4 GB of raw `dnf_src/` and Python baker scripts not used at runtime.
Decision:
1. Replace `localStorage` with a portable JSON save file (`nano-dnf-save.json`) stored next to `nano-dnf.exe` (falling back to current working directory), preserving the exact JS JSON schema.
2. Package a clean portable `dist/nano-dnf-windows/` folder containing `nano-dnf.exe` and ONLY the runtime `assets/` files referenced by `main.js` (PNG sheets, `assets/music/`, `assets/sfx/`), keeping the distribution small and self-contained.
Consequences: User can unzip and double-click `nano-dnf.exe` on Windows immediately.

## ADR-005: UMD Bridging Strategy for `rust-anything`
Status: accepted (2026-11-23)
Context: `src/*.js` modules use UMD IIFE wrappers (`(function (root, factory) { ... })(..., function () { ... })`), so `rust-anything analyze` initially sees 0 top-level exports.
Decision: For each unit crate under `rust/<name>-rs`, use `rust-anything` workflows (`record`, `diff`, `bench`, `gate`) with a thin CommonJS bridge/harness or unit crate structure that invokes the original JS module (`require("../src/<name>.js")`) as ground truth without modifying the original `src/*.js` behavior or breaking `index.html` / `npm test`.
Consequences: Original JS stays 100% intact as reference while every unit is still verified against JS ground truth via `rust-anything`.
