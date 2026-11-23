# Migration Map (nano-dnf -> Pure Rust Windows App)

Goal: Port all 11 `src/*.js` modules to pure Rust and ship a standalone, smooth 60fps Windows executable (`nano-dnf.exe`) with portable runtime assets.

See [DECISIONS.md](DECISIONS.md) for ADRs and [GLOSSARY.md](GLOSSARY.md) for naming.

## Units

| Wave | Unit | Source | Rust Crate | State | Notes |
| ---: | --- | --- | --- | --- | --- |
| 0 | `music` | `src/music.js` (165 lines) | `rust/music-rs` | done | Leaf: procedural notes + `trackFor`, clippy+tests pass |
| 0 | `loadout` | `src/loadout.js` (122 lines) | `rust/loadout-rs` | done | Leaf: skill slots & drag/swap, clippy+tests pass |
| 0 | `records` | `src/records.js` (270 lines) | `rust/records-rs` | done | Leaf: per-seed/stage clear records, clippy+tests pass |
| 0 | `summary` | `src/summary.js` (169 lines) | `rust/summary-rs` | done | Leaf: run summary & share link, clippy+tests pass |
| 0 | `progress` | `src/progress.js` (299 lines) | `rust/progress-rs` | done | Leaf: inventory, equipment, XP/gold, clippy+tests pass |
| 1 | `core` | `src/core.js` (9817 lines) | `rust/core-rs` | done | Core simulation, rooms, combat, AI, skills; 1800-frame JS oracle matched 100% |
| 1 | `attract` | `src/attract.js` (355 lines) | `rust/attract-rs` | done | Title attract-mode demo script, clippy+tests+oracle pass |
| 1 | `hints` | `src/hints.js` (147 lines) | `rust/hints-rs` | done | Contextual gameplay hints, clippy+tests pass |
| 1 | `reward` | `src/reward.js` (191 lines) | `rust/reward-rs` | done | Post-clear 4-card reward flow, clippy+tests pass |
| 2 | `render` | `src/render.js` (10904 lines) | `rust/render-rs` | done | Software 2D pixel renderer (`tiny-skia` + `fontdue`, 960x540), clippy+tests pass |
| 3 | `app` | `src/main.js` (2585 lines) | `rust/app` | done | Native Windows/Linux desktop shell (`winit` + `softbuffer` + `rodio`), `nano-dnf.exe` built |

## Out of Scope (Kept as Reference/Tooling)
- `scripts/` (asset importers & Playwright frame-capture scripts)
- `docs/reference-evidence/`
- `tests/` (kept as JS oracle; core assertions mirrored in Rust `cargo test`)
