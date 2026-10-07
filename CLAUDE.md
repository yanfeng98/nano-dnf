# nano-dnf

业主的 2D 横版动作游戏（DNF 手感）。**这片仓库的语言不在这个文件里**：

- `CONTEXT.md` —— **术语表**。同一个东西有几个叫法时以它为准（地面带 / 深度 / 身位 / 格 / 贴地锚点 / 参差 / 血剑 / 定身…）。改到某个概念之前先读它那一条。
- `README.md` —— **切片式 devlog**，记「什么时候改成这样」。业主每一轮的反馈都原样引在里面，动手前先读最近几片，那是他上一次说了什么。
- `docs/adr/` —— **决定，以及它推翻过什么**。动到一个已经定过的决定时在这里留档，不要只在 commit 里交代。

## 客户端（美术资源的唯一出处）

**业主机器上装着客户端：`C:\dnf\地下城与勇士`**（WSL 里就是 `/mnt/c/dnf/地下城与勇士`）。
**要美术素材就去这里找，不要去别处截、不要自己画。** 2026-10-06 业主的原话：
「以后在这个客户端找资源」。

- `assets/import_dnf_effects.py` 的 `DEFAULT_CLIENT` 已经指着它，脚本优先读本地客户端、
  读不到才回落到 GitHub 镜像。
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

## 收工判据

**改完不算完。** 一片的收工条件是下面三件事全过；缺任何一件，这一片就还是**未完成**：

1. `npm test` 全绿、`npm run test:browser` 双通；
2. **`npm run serve` 把游戏起起来交给业主实玩**（http://localhost:8080，键盘和触屏两条路都通）；
3. **业主玩过之后说对了。**

**在他点头之前，不要说「完成」，也不要把这一片写进 README 当已交付。** 测试和抓帧替他看不了画面与手感 —— 那两样只有他本人能验收。交给他玩时一并说清楚：改的是哪一招、看什么、按哪些键最快复现（例：`O` 放大蹦，落地后看第二波火在不在裂盘里）。
