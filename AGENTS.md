# nano-dnf — Agent 规范入口

本项目完整协作约定与收工判据以 [CLAUDE.md](CLAUDE.md) 为单一事实源，领域术语以 [CONTEXT.md](CONTEXT.md) 为准。

## `.NPK` 客户端原件优先（硬规则）

- **能用客户端 `.NPK` 原件就必须用原件**：凡涉及角色、NPC、场景布景、UI、状态/受击/死亡/技能特效及 `Music/` / `SoundPacks*` 音频，修改前先穷举本地客户端（`/mnt/c/dnf/地下城与勇士/ImagePacks2_70` 与 `ImagePacks2`）；只要存在对应原件，一律通过 `assets/import_dnf_*.py` 提取烘焙使用，以客户端原件取代手绘图形或占位资源。
- **回退条件**：仅在穷举确认本地客户端确无对应 60/70 原件时，才按 `docs/adr/0074-1to1-dnf-fidelity-and-asset-fallback.md` 从参考录像精抠或 1:1 重建。

## 参考指针

- 领域术语与口径：[CONTEXT.md](CONTEXT.md)
- 完整开发规范、客户端路径、录像规范与收工判据：[CLAUDE.md](CLAUDE.md)
- Rust 模块映射与架构决策：[rust/MAP.md](rust/MAP.md)、[rust/DECISIONS.md](rust/DECISIONS.md)
