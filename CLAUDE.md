# nano-dnf

业主的 2D 横版动作游戏（DNF 手感）。**这片仓库的语言不在这个文件里**：

- `CONTEXT.md` —— **术语表**。同一个东西有几个叫法时以它为准（地面带 / 深度 / 身位 / 格 / 贴地锚点 / 参差 / 血剑 / 定身…）。改到某个概念之前先读它那一条。
- `README.md` —— **项目总览、按键与 Rust 构建指南**。
- `rust/MAP.md` / `rust/DECISIONS.md` —— **Rust 工作区模块映射与架构决策**。
- `docs/adr/` —— **历史决定，以及它推翻过什么**。动到一个已经定过的决定时在这里留档，不要只在 commit 里交代。

## 客户端（美术资源的优先出处）

**业主机器上装着客户端：`C:\dnf\地下城与勇士`**（WSL 里就是 `/mnt/c/dnf/地下城与勇士`，同时含 `ImagePacks2_70` / `ImagePacks2`、`SoundPacks_70` / `SoundPacks`、`Script_70.pvf` / `Script.pvf`、`Fonts`、`Music`）。
**优先穷举本地客户端原件；若本地客户端确实无对应 60/70 版原件，允许从参考录像精抠或按像素 1:1 高精重建/生成（见 `docs/adr/0074-1to1-dnf-fidelity-and-asset-fallback.md`）。**

- **这台云开发机上客户端实际在 `/home/luyanfeng/dnf-client/地下城与勇士`**；
  `/mnt/c/...` 在这台机器上不存在。`import_dnf_*.py` 的 `DEFAULT_CLIENT` 目前仍指向
  旧路径，跑脚本要显式传 `--client /home/luyanfeng/dnf-client/地下城与勇士`；
  以后统一修默认值。
- 素材脚本优先读本地客户端、读不到才回落到 GitHub 镜像；本机要显式传 `--client`
  （见上一条），不要依赖默认值。
- 包是按技能分的（`_hellbenter`、`_outragebreak`、`_bloodyrave`…），一条 `.img` 是若干帧。
  列一个包里有什么：

      python3 -c "import sys;sys.path.insert(0,'assets');import import_dnf_effects as M;\
      from pathlib import Path;print(sorted(n for n,_ in M.pack_entries(\
      Path('/mnt/c/dnf/地下城与勇士'),'_hellbenter')))"

- 想先看形状再挑，就照 `assets/dnf_src/bilibili/skill-clips/awakening-grill/probe-entries.png`
  的做法把整个包铺成一张带标注的对照表（那一次是 54 条）。
- **一条 `.img` 回给自己的锚点 `(x, y)`，而且锚点可能在它自己画布外面**（客户端那几条是照
  动画数据定位的）。算 `offset` 时用它没用——`stage_layers` 的顺序是
  `rescale(按底心) → shift(offset)`，正确算法见 `docs/adr/0025` 第十四节。

## 技能图标

**图标只从 `assets/dnf_skillicon_atlas.png` 里挑**，不许自己画、不许从别处截图贴。

那是 `skillicon.img` 的**带标注总表**：16 列、一格 52 px，**第 N 格的左上角是
`(N % 16 * 52, N // 16 * 52)`**（用 `python3 assets/import_dnf_art.py --atlas` 重生成）。
业主在上面指帧号，`assets/import_dnf_art.py` 的 `ICON_FRAMES` 照抄，**挑它的那一行注释里要
写清出处和为什么是这一帧**（已有的例子看 134/135、78/79、176/177）。

**成对的图标是「彩色 + 灰色孪生」**：彩色那格给技能条，灰的那格是它挂上状态时的样子
（`BUFF_ICON_FRAMES`）。挑的时候量一下色度，不要猜哪格是彩的。

已经定下来的：

- **红眼的觉醒（魔狱血刹）= 190**，191 是它的灰孪生。（量过：190 的色度 67.2、191 的 2.9；
  同一个尺子量 78/79 是 71.3/2.9、134/135 是 37.8/2.9。）

这张总表**进版本库**（`.gitignore` 里不许再 ignore 它）：挑过的帧号没有它就没法复核。

## 副本参考录像（实现要照它）

**整场跑图的实机录像**在 `/home/luyanfeng/luyanfeng/dnf-dungeon-videos/` —— **在仓库外面、不进 git**，
一条副本一个文件，命名 **`<五位数序号>-<副本中文名>.mp4`**（序号从 `00001` 起、按下载顺序递增，
副本名用 `rust/core-rs/src/tables.json` 的 `STAGES` 里那个名字；已有 `00001-幽暗密林.mp4`，6 分 03 秒）。
**以后从 B 站下别的副本也放这儿、按同一规则起名**，不要塞进 `assets/`。

**游戏实现要参考这些视频**：场景（地块、树石的摆位与深浅）、地图窗口、房间与门的朝向、
怪的分布与动作节奏 —— **先量再动手**，量出来的数写进代码注释和 ADR，与技能参考片是同一套规矩
（`docs/adr/0005`、`0006`、`0028` 都是这么量出来的）。**别凭印象做；印象和录像对不上时，以录像为准。**

`assets/dnf_src/bilibili/skill-clips/`（gitignored）是**按技能切好的**那种参考片，两边不要混。

## 收工判据

**逐项验证（Rust 工作区）**：每次修改后确认以下检查通过，再提交并推送到远程：

1. `cd rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` 全绿；
2. 若涉及桌面端或音频改动，确认 Windows 交叉编译通过：`cargo zigbuild --release --target x86_64-pc-windows-gnu -p nano-dnf`；
3. **业主在 Windows 实玩过之后确认效果。**

**在他点头之前，不要把视觉或手感改动当成最终验收通过。** 测试替他看不了画面与手感 —— 那两样只有他本人能验收。交给他玩时一并说清楚：改的是哪一招、看什么、按哪些键最快复现。

## 打 tag（版本说明）

**tag 是一份版本说明，不是一个标记。** 用 annotated tag（`git tag -a`），按顺序取
`v0.0.x`（下一个 = `git tag -l --sort=-creatordate | head -1` 的最后一位 +1）。

**先读模板：`git tag -l --format='%(contents)' v0.0.3`。** 新 tag 的正文照它分段，一段不缺：

1. 第一行 `v0.0.x — <一句话的版本标题>`；
2. 一句话说这个项目是什么；
3. 适用平台与运行包说明（Windows 便携版 / Rust 工作区）；
4. `自 v0.0.<上一个> 起`：这一版**实际做了什么**，按【内容】【布景】【手感】…分段；
5. `验证到哪一步`：`cargo test --workspace` 与 `cargo clippy` 的**实跑数字**、Windows 交叉编译及实机验证；
6. `自 v0.0.<上一个> 以来的提交（N 个，按时间顺序）`：
   `git log --oneline --reverse v0.0.<上一个>..HEAD`；
7. `已知没做完`：这一版还欠什么，连同之前版本就欠着的一起写。

**完成判据**：正文含以上全部七段、数字来自实跑、`HEAD` 就是刚推送的提交、远端
`git push origin v0.0.x` 成功。改已有 tag 的说明时，先删远端再推
（`git push origin :refs/tags/v0.0.x`），别让同一版有两个说明。

业主 2026-10-22 的原话：「information 没按照之前 tag 的方式」—— 那一版只写了一行标题。

