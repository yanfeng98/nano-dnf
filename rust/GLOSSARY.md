# Domain Glossary (nano-dnf -> Rust)

| Original Term (JS / CONTEXT.md) | Meaning | Rust Name (Module / Type / Fn) |
| --- | --- | --- |
| `ARENA` / 地面带 | Playable 960x540 viewport & ground band (`minY`, `maxY`, `width`, `height`) | `core::ARENA`, `Arena` |
| `VIEW` / 世界窗口 | Centered 4:3 world window (`left: 120, width: 720`) inside 960x540 canvas | `core::VIEW`, `ViewWindow` |
| `DEPTH` / 深度 | Z-axis / ground depth foreshortening (`scale`, `depthLift`) | `core::DEPTH` |
| `CAMERA` / 镜头 | Camera zoom & deadzone (`zoom`, `deadzoneShare`, `figure`) | `core::CAMERA` |
| `STAGES` / 副本 | Dungeon stages (`mirkwood` 幽暗密林, `mirkwooddeep` 幽暗密林深处) | `core::STAGES`, `StageDef` |
| `cell` / 格 | Grid cell index in a seeded dungeon map | `State::cell` (`usize`) |
| `bossRoom` / Boss 房 | Room index vs `dungeon.boss` cell index | `Dungeon::boss` |
| `loadout` / 技能配置 | Quickbar 6 slots (`A,S,D,F,G,H`) + skill rank & cooldowns | `loadout` crate |
| `records` / 战绩 | Per-stage & per-seed best clear time & run count | `records` crate |
| `progress` / 进度与背包 | Persistent XP, level, gold, inventory, equipped weapon | `progress` crate |
| `summary` / 结算汇总 | Run summary table, pace comparison, share URL | `summary` crate |
| `reward` / 通关翻牌 | Post-clear 4-card reward sequence (`战绩 -> 宝箱 -> 四张牌 -> 领奖`) | `reward` crate |
| `attract` / 标题演示 | Deterministic title screen attract-mode demo | `attract` crate |
| `hints` / 提示条 | Contextual gameplay hints | `hints` crate |
| `music` / 音乐调度 | Procedural note scheduler + `TRACKS` / `trackFor` selector | `music` crate |
| `render` / 渲染器 | Pure state-to-frame 2D renderer (sprites, HUD, town, dungeon, effects) | `render` crate |
| `main` / 主壳 | Desktop window, input mapping, fixed-step 60Hz loop, audio, save I/O | `app` (`rust/app`) |
