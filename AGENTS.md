# nano-dnf — Agent 规范入口

本项目完整协作约定与收工判据以 [CLAUDE.md](CLAUDE.md) 为单一事实源，领域术语以 [CONTEXT.md](CONTEXT.md) 为准。

## `.NPK` 客户端原件优先（硬规则）

- **能用客户端 `.NPK` 原件就必须用原件**：凡涉及角色、NPC、场景布景、UI、状态/受击/死亡/技能特效及 `Music/` / `SoundPacks*` 音频，修改前先穷举本地客户端（`/mnt/c/dnf/地下城与勇士/ImagePacks2_70` 与 `ImagePacks2`）；只要存在对应原件，一律通过 `assets/import_dnf_*.py` 提取烘焙使用，以客户端原件取代手绘图形或占位资源。
- **回退条件**：仅在穷举确认本地客户端确无对应 60/70 原件时，才按 `docs/adr/0074-1to1-dnf-fidelity-and-asset-fallback.md` 从参考录像精抠或 1:1 重建。

## 打 tag 与自动发布

- **七段版本说明模板**：每次发版必须使用 annotated tag（`git tag -a v0.0.x`），严格遵循 [CLAUDE.md](CLAUDE.md) 中的七段版本说明模板（标题 / 简介 / 运行与发布说明 / 自上版以来的变更 / 实跑验证数字 / 提交列表 / 已知未完）。修改已有标签时须先删远端再重推（`git push origin :refs/tags/v0.0.x`）。
- **推送 `v*` 标签自动发布 Windows 便携包**：推送任意以 `v` 开头的标签到远端（`git push origin v*`）会自动触发 [.github/workflows/release.yml](.github/workflows/release.yml)，在 `windows-latest` 上编译 `nano-dnf.exe`、打包 `nano-dnf-windows-x86_64-<tag>.zip`（含 `nano-dnf.exe`、`README.md` 与运行时 `assets/`），并以 tag 正文作为 Release Notes 自动发布到 GitHub Releases（仅本地打标或非 `v*` 标签不会触发；也支持在 Actions 页面手动 `workflow_dispatch`）。

## 参考指针

- 领域术语与口径：[CONTEXT.md](CONTEXT.md)
- 完整开发规范、客户端路径、录像规范与收工判据：[CLAUDE.md](CLAUDE.md)
- 最新交接状态：[HANDOFF.md](HANDOFF.md)
- Rust 模块映射与架构决策：[rust/MAP.md](rust/MAP.md)、[rust/DECISIONS.md](rust/DECISIONS.md)
