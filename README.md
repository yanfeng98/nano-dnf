# nano-dnf

通过 code agent 实现一个 DNF 风格的 2D 横版动作地下城游戏，用来检验 code agent 的端到端能力。

## 在线试玩

打开 <https://luyf-lemon-love.space/nano-dnf/>（备用 <https://yanfeng98.github.io/nano-dnf/>）
直接在浏览器里玩，无需本地安装：
清空房间后走到右侧传送门进入下一层，第 4 层击败 Boss 即通关。

该页面由 `.github/workflows/pages.yml` 在 `main` 分支更新时自动测试并部署。

## 当前切片

可玩的第一版垂直切片已经落地：一个不依赖任何第三方库的浏览器游戏，包含移动、跳跃、三段连击、
带前摇的敌人 AI、房间清怪与传送门推进，以及 Boss 房间通关判定。
第二切片补上了清怪回报：击杀掉落回血球，击杀累积经验并升级，升级提升攻击、生命与魔法上限。
第三切片补上了敌人威胁层次：远程术士、直线冲锋兵，以及 Boss 带预警的地面重踏（可跑出范围或跳起躲开）。
第四切片把技能改成 DNF 鬼剑士那一套：上挑 / 崩山击 / 十字斩 / 鬼斩，各带 MP 消耗、独立冷却与随等级成长的伤害，
按键也换成 DNF 布局（方向键移动、`X` 普攻、`C` 跳跃、`A`/`S`/`D`/`F` 技能），HUD 左下角新增技能栏。
第五切片重做了画面：原创鬼剑士像素精灵（待机 / 跑动 / 攻击 / 技能 / 受击 / 跳跃 / 倒地）、金币边框 HUD 与角色头像、
带冷却遮罩的技能图标栏、视差地下城背景（远近拱门、火把、雾气、暗角）、Boss 血条与打击特效。

## 运行

```bash
npm test          # 33 个核心逻辑、技能、触屏布局、成长系统与渲染冒烟测试
npm run test:browser # 无头 Chromium 跑真实页面：键盘 + 触屏两条通路各通关一次
npm run serve     # 起本地静态服务，然后打开 http://localhost:8080
python3 assets/make_slayer_sprites.py   # 可选：重新生成原创精灵图与技能图标
```

直接在浏览器里打开 `index.html` 也可以玩。

## 操作

按键沿用 DNF 鬼剑士布局：方向键移动，`X` 普攻，`C` 跳跃，`A` / `S` / `D` / `F` 释放技能。

| 按键 | 动作 |
| --- | --- |
| `←` / `→` | 左右移动 |
| `C`（也支持 `↑` / `Space`） | 跳跃 |
| `X` | 普攻（连续按出三段连击，伤害 8 / 10 / 15） |
| `A` | 上挑 |
| `S` | 崩山击 |
| `D` | 十字斩 |
| `F` | 鬼斩 |
| `P` | 暂停 |
| `R` | 重开 |
| `H` | 显示/隐藏帮助 |
| `M` | 静音 / 恢复音效（记住上次选择） |
| `T` | 手动切换屏幕虚拟按键 |

## 触屏与音效

- **虚拟按键**：粗指针设备（手机/平板）会自动开启，画布下方出现 ← → 移动、跳、攻，以及
  上挑 / 崩山击 / 十字斩 / 鬼斩四个技能键；技能键上显示官方图标与冷却读秒，右上角是静音开关。
  桌面端按 `T` 或访问 `?touch=1` 也能看到这套按键，且支持多指同时按住（一边按 → 一边按攻击）。
- **音效**：全部用 WebAudio 合成，不加载任何音频文件——命中是钝击声、技能是扫弦、受击是低频噪音、
  击杀是下滑音、升级三音上行、通关四音上行、进房间短促铃声。首次按键/触摸时才创建 `AudioContext`
  （浏览器要求用户手势），`M` 或右上角按钮可静音并记住选择。

## 技能

技能沿用 DNF 的形态：每个技能都有 MP 消耗、独立冷却，并随技能等级（这里等同于角色等级）提升伤害。
HUD 左下角是技能栏，显示按键、技能名、MP 消耗与冷却读秒。

| 技能 | 按键 | MP | 冷却 | 基础伤害 | 每级成长 | 效果 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 上挑 | `A` | 8 | 1.2s | 12 | +3 | 命中把敌人挑飞，浮空期间敌人无法出手 |
| 崩山击 | `S` | 18 | 3.5s | 22 | +4 | 向前跃斩，并沿地面追加冲击波（额外 10 +2/级） |
| 十字斩 | `D` | 14 | 2.5s | 18 | +3 | 十字判定，纵向范围更大 |
| 鬼斩 | `F` | 25 | 5.0s | 34 | +5 | 鬼气重斩，前方最远的单段高伤 |

清空当前房间后右侧传送门点亮，走到最右侧进入下一层；第 4 层击败 Boss 即通关。

## 敌人

| 敌人 | 行为 | 应对 |
| --- | --- | --- |
| 小兵 | 近身挥击，前摇短 | 三段连击硬拼或绕后 |
| 精英 | 高血量近战，前摇长 | 前摇后撤，收招期反击 |
| 术士 | 保持距离，蓄力后射出有限射程的法术弹 | 蓄力时撤出射程，或跳起躲弹 |
| 冲锋兵 | 下蹲预警后高速直线冲锋 | 预警与冲锋期间横向拉开，收招期反击 |
| Boss | 近战，并会施放带预警的地面重踏（圆形范围） | 重踏预警时跑出范围，或跳起躲避 |

## 成长与掉落

| 机制 | 数值 |
| --- | --- |
| 经验 | 小兵 10 / 精英 22 / Boss 80 |
| 升级门槛 | 初始 30 点，之后每级 ×1.6（上限 12 级） |
| 升级收益 | 生命上限 +12、魔法上限 +5、攻击 +2，并立即回复 12 点生命 |
| 掉落 | 精英必掉回血球（+18 HP），小兵 50% 掉落，Boss 掉落 +42 HP |
| 拾取 | 走进回血球即可自动拾取，14 秒未拾取会消失 |

## 结构

| 路径 | 作用 |
| --- | --- |
| `src/core.js` | 纯逻辑内核：物理、连击、伤害、敌人 AI、房间推进。无 DOM 依赖，Node 与浏览器共用 |
| `src/render.js` | Canvas 2D 渲染层：精灵动画、HUD、技能栏、背景与特效，只读状态、不做修改 |
| `src/main.js` | 浏览器入口：DNF 键位映射、精灵图加载、固定步长循环、暂停与重开 |
| `assets/import_dnf_art.py` | 从 DNF 原始 IMG 导入鬼剑士 SD 动画与技能图标，烘焙出下面两张图集 |
| `assets/make_slayer_sprites.py` | 备用：纯原创像素美术生成脚本（不依赖任何外部素材） |
| `assets/slayer.png` | 6×5 张 96×96 精灵帧：待机 / 跑动 / 攻击 / 技能 / 受击·倒地·跳跃·下落 |
| `assets/skills.png` | 四个 32×32 技能图标，顺序与技能栏一致 |
| `index.html` | 页面外壳：标题、画布边框、键位说明与状态栏 |
| `tests/core.test.js` | `node:test` 验证内核行为、成长与掉落、确定性、900 帧稳定性、可通关性、精灵帧选择与渲染冒烟 |

## 美术

角色是 **DNF（地下城与勇士）官方 SD 鬼剑士**动画帧，技能图标取自 DNF 鬼剑士技能图标集，
由 `assets/import_dnf_art.py` 从原始 `.img` 里解码并按游戏的图集规格烘焙：

```bash
pip install pydnfex pillow          # 解析 DNF IMG 需要
python3 assets/import_dnf_art.py    # 输出 assets/slayer.png 与 assets/skills.png
```

脚本会把 `c_swordman.img`（43 帧：站立 / 行走 / 攻击）里的关键帧重排成待机 4 帧、跑动 6 帧、攻击 3 帧、
技能 4 帧，并用受击帧合成出受击、倒地、跳跃、下落；技能图标按上挑 / 崩山击 / 十字斩 / 鬼斩的顺序取 4 张。
对应的原始素材缓存在 `assets/dnf_src/`（已 gitignore）。

需要注意的是：**DNF 美术版权属于 Neople/Nexon**，这里按项目所有者的要求直接使用，仓库的 MIT 许可
只覆盖代码，不覆盖这些图像；如果要公开分发，请自行确认授权，或改用 `assets/make_slayer_sprites.py`
生成的原创像素美术。

技能图标的索引写在 `assets/import_dnf_art.py` 的 `ICON_FRAMES` 里（当前是 `[70, 52, 44, 78]`）。
图标库本身没有名字映射，所以脚本支持导出带编号的对照图供人工挑选：

```bash
python3 assets/import_dnf_art.py --atlas          # 生成 assets/dnf_skillicon_atlas.png（已 gitignore）
python3 assets/import_dnf_art.py --icons 3,5,7,9  # 按指定帧重烘焙四个技能图标
```

`--icons` 的四个数字按技能栏顺序对应 上挑 / 崩山击 / 十字斩 / 鬼斩。

## 验证

除了单元测试，还有一条**浏览器级可玩性证明**（`npm run test:browser`）：起本地静态服务，用无头 Chromium
打开真实页面，用和单元测试同一套策略驱动机器人通关整座地牢，跑**两条通路**——键盘（真实按键事件）与
触屏（真实 DOM 指针事件，`hasTouch` 上下文 + `?touch=1`），并校验控制台无报错、页面无异常、资源全部
200、WebAudio 已初始化。最近一次结果：

```
keyboard victory=true kills=11 damageTaken=7 seconds=73.4 level=4  audio=created/running
touch    victory=true kills=11 damageTaken=7 seconds=72.4 level=4  touchMode=true audio=created/running muteToggle=ok
consoleErrors=[] pageErrors=[] failedRequests=[]
assets: index.html / main.js / render.js / core.js / slayer.png / skills.png / favicon.png 全部 200
```

截图证据：`tests/browser/artifacts/` 下的 `playability-title.png`、`playability-keyboard-fight.png`、
`playability-keyboard-clear.png`、`playability-touch-fight.png`、`playability-touch-clear.png`。

## 设计约定

- 逻辑与渲染分离：`Core.step(state, input)` 是唯一的状态推进入口，便于确定性回归测试。
- 固定步长 1/60 秒，渲染帧率与模拟无关。
- 相同 seed 加相同输入必然得到相同结果，测试用这一点做回归。
- 掉落判定也走同一个确定性随机流，因此回归测试可以逐个比对掉落位置与数值。

## 下一步候选

- 技能树 / SP 加点与技能等级，让升级选择影响打法。
- 指令输入（例如 `↑`+`X` 触发上挑）作为热键之外的 DNF 式操作。
- 移动端触屏按键与音效。
- Boss 多阶段与弹幕组合，进一步加大走位压力。
- 装备与技能树，让升级选择影响打法。
