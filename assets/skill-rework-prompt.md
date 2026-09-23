# 技能重做提示词（模板 + 示例）

给「把某个技能照参考重做到一模一样」这类活儿用的一条提示词。整段喂给下一轮的 agent 即可。
文件里有两份：**空白模板**（只改最上面的填写区）和一份**填好的示例**（崩山裂地斩）。

## 怎么用

- 复制「模板」整段 → **只改最上面那个「填写区」** → 连同文末「开工前先问我」那几条的答案一起贴给
  agent，能省一轮往返。（正文里也有 `{{...}}`，是同一批值；顺手替换当然也行，不替换 agent 会从
  填写区读。）
- 懒得填就从「示例：崩山裂地斩」复制一份，把技能名 / 参考片段 / skillId 三处换掉即可。
- 想改这份模板本身：**只改「模板」那一段**；「示例」只是它的一份快照，不必同步。

---

## 模板

````markdown
# 任务：把「{{技能名}}」照参考重做到一模一样

## 填写区（只改这一段）

```yaml
技能名:   {{技能名}}          # 中文名，如 崩山裂地斩
skillId:  {{skillId}}         # 代码里的 id，如 mountainRift
键位:     {{键位}}            # 如 O
等级:     {{等级}}            # 如 45 级
参考片段: {{参考片段}}        # 参考视频/帧图路径
参考范围: {{参考范围}}        # 如 42.000–46.533s / 136 帧
旁证:     {{旁证，可留空}}    # 客户端自己的预览之类，只看不抄
```

不知道的留空写「待查」，我自己去仓库里找。**参考没吃透之前先别改代码，先来问我。**

## 目标

让游戏里的 `{{skillId}}`（{{技能名}}，{{键位}} 键，{{等级}}）和参考
`{{参考片段}}`（{{参考范围}}）在**动作、节奏、命中时机、位移、特效层次与颜色、落点**上一致。
**参考是唯一的裁判**；其它来源（客户端自己的预览、`.avi` / `.png` 帧表、攻略视频）只当旁证，
和参考冲突时以参考为准，并把冲突写下来告诉我。

## 参考怎么读

- 参考是训练房这类**黑底、一次一个技能、顶部打技能名、底部标「N级技能XX」**的片段最干净，
  正好是 1:1 的官方技能动画；先从它上面量，不要凭感觉。
- 逐帧导出的两把刀：
  ```bash
  ffmpeg -v error -y -i "{{参考片段}}" -vf "select=eq(n\,K)" -frames:v 1 /tmp/f.png
  python3 assets/extract_bilibili_skills.py --detect    # 复算切片点，和 skill-clips/INDEX.txt 对一遍
  ```
- 量之前先对齐比例：先量参考里角色的身高，再量本作角色身高，得出换算比（崩山击那轮约 2.67），
  之后所有尺寸/位移都按这个比折回本作像素。

## 改之前先读（现状）

- `src/core.js` → `SKILLS.{{skillId}}`：时长、`activeFrom/activeTo`、命中段数与判定框、位移、
  `shockwave`、无敌帧等。
- `src/render.js` → `SPRITE.skillClips.{{skillId}}`（身体动作帧 + beats）、
  `EFFECT.draw` / `EFFECT.frontDraw` / `EFFECT.frontRows` / `EFFECT.timing`（特效行、窗口、绘制尺寸）。
- `assets/import_dnf_effects.py` → `PICKS["{{skillId}}"]`（特效层与色板、anchor、stages）、
  `FRONT_ROWS`（画在角色前面的那半）。
- `assets/import_dnf_swordman.py` → `CLIPS["{{skillId}}"]`（身体帧号）。
- `assets/dnf_effect_picks.md` → **先翻有没有这个技能的旧决策**：已有的约定是基线，
  只有和参考冲突时才动，动了要写清依据。
- 烘焙产物：`assets/slayer.png`（身体）、`assets/effects.png`（特效），由上面两个脚本重烘；
  特效表里**一行 = 一个技能，行号 = `SKILL_ORDER` 下标**。

## 工作流

1. **先量后改**：量出起手 / 关键姿势 / 命中那一格 / 收招的帧号，腾空高度与滞空时间，
   以及每块特效的**尺寸和颜色**。
2. 把量到的东西摆成对照图（参考帧 vs 我挑的帧），**先给我确认**再定帧号。
3. 改身体动作 → 重烘 `assets/slayer.png`；改特效 → 改 `PICKS`/`FRONT_ROWS` → 重烘 `assets/effects.png`。
4. 改 `SKILLS.{{skillId}}` 与 `SPRITE`/`EFFECT`。
5. 实机核对：`CAPTURE_OUT=/tmp/xxx node tests/browser/capture-effect.mjs {{skillId}} 30 0.08 480`
   （慢放时钟、逐帧截图、每张记录施法进度）。
6. 跑 `npm test` 与 `npm run test:browser`，改掉/新增受影响的断言。
7. 在 `assets/dnf_effect_picks.md` 追加一节：**我的原话 + 量到的数据 + 改了什么 + 依据 + 核对命令**。
8. commit（conventional 风格，参考 `git log`）→ `git push origin main` → 等 GitHub Pages 的
   build/deploy/verify 三个 job 全绿 → 用 `last-modified` 和 `effects.png` 的字节数确认线上就是
   新构建（旧文件可能被 CDN 缓存），再告诉我可以试了。

## 已知坑（上一轮真踩过的，别重踩）

- **色板后缀**：同一套形状在包里常有 `xxx_d.img` / `xxx_n.img` 两条，`_d` 往往是暗色复制品。
  取之前算一遍不透明像素的平均 RGB，和参考里同一部位比。（地刺：`_d`=(149,1,0)、
  `_n`=(232,40,0)、参考=(229,59,14) → 用 `_n`。）「颜色不对」十有八九是取错色板。
- **锚点要用「几何中心」不是「包围盒边」**：扇形/圆环类的层，对准落点的是它**炸开的那个中心**，
  不是下边缘。拿下边缘贴地面会让整块高半个身位（原话：「位置有点高」）。
- **每层放大倍数不一样**：`stack` 只能给所有层一个 scale；`stages` 能逐层给
  `frames` / `scale` / `offset` / `from` / `until`。参考里各块相对尺寸先量清楚再逐层设。
- **地面上的东西别跟着人飞**：绘制默认按 `player.y` 摆，人腾空时特效会飘在半空；
  钉在地面的行要 `EFFECT.draw.<skill>.ground = true`。
- **引擎会给每道地面波画一个椭圆「范围圈」**：参考里没有就写 `shockwave.arc: false`
  （判定框/击退/震屏都保留，只是不画圈）。
- **改身体 clip 的帧数会挪动同一行的后续段**（如 `rageBurst.first` / `crossSlash.first` /
  `silverFall` / `jump`），有测试盯着，改完立刻 `npm test`。
- **无敌帧默认会闪**：参考里不闪就同时设 `player.solidInvuln`（真挨打 `hurtTimer` 仍然闪）。
- **参考里火比落地早开**这类事要自己钉 `EFFECT.timing.<skill> = { from, to }`，
  默认窗口是按 `activeFrom` 算的一个比例。
- **别把快照当证据**：`tests/browser/artifacts/*.png` 是浏览器测试整批重生成的，按仓库惯例一起提交，
  但要单独看 `git status`，别混进无关改动。工作区可能本来就有别人的改动，不要顺手 commit。

## 开工前先问我（答案会直接改变实现，别自己默认）

1. 「一模一样」对齐到什么程度——**只对齐画面，还是连物理判定/伤害/位移一起**？
2. 参考片开头的**站立/预备**要不要保留，还是按键就直接从第一个动作开始？
3. 身体动作帧**由我先挑好给你确认**，还是你直接定？
4. 参考里的位移/弧线要不要按参考放大——本作可以给单个技能**专属重力**
   （见 `SKILLS.mountainBreaker.leapGravity`，全局重力做不到「又高又短」）。
5. 参考里的落地/范围特效要不要一起对齐？

## 验收标准

- 关键帧的逐帧对照图（参考 vs 实机）动作、落点、特效层次与颜色都对得上，图先给我过目。
- `npm test` 与 `npm run test:browser` 全绿；受影响的断言已更新，关键约束（帧数、beats、锚点、
  色板、scale、timing、`arc`/`ground` 这类开关）都有测试钉住。
- `assets/dnf_effect_picks.md` 有新的一节，写清我的原话、量到的数据、改法与依据、核对命令。
- 改动只落在 `{{skillId}}` 相关的地方；已推送、Pages 三个 job 全绿、线上资源与本地一致，
  并告诉我线上地址可以试。
````

---

## 示例：崩山裂地斩

把下面这份直接复制，换掉「技能名 / skillId / 键位 / 等级 / 参考片段 / 参考范围」六处就是新任务。

````markdown
# 任务：把「崩山裂地斩」照参考重做到一模一样

## 填写区（照下面这份复制，改这七行就是新任务）

```yaml
技能名:   崩山裂地斩
skillId:  mountainRift
键位:     O
等级:     45 级
参考片段: assets/dnf_src/bilibili/skill-clips/10_崩山裂地斩.mp4
参考范围: 42.000–46.533s / 136 帧
旁证:     assets/dnf_src/skill-videos/OutRageBreak.avi（只看不抄）
```

**参考没吃透之前先别改代码，先来问我。**

## 目标

让游戏里的 `mountainRift`（崩山裂地斩，O 键，45 级）和参考
`assets/dnf_src/bilibili/skill-clips/10_崩山裂地斩.mp4`（42.000–46.533s，136 帧，1440×1080 / 30fps，
训练房巡演里标着「45级技能」的那一段）在**动作、节奏、命中时机、位移、特效层次与颜色、落点**上一致。
**参考是唯一的裁判**；客户端自己的 `OutRageBreak.avi` 和 `assets/dnf_src/skill-videos/` 只当旁证，
和参考冲突时以参考为准，并把冲突写下来告诉我。

## 参考怎么读

- 训练房这段是**黑底、一次一个技能、顶部打技能名、底部标「45级技能崩山裂地斩」**，正好是 1:1
  的官方技能动画；先从它上面量，不要凭感觉。
- 逐帧导出的两把刀：
  ```bash
  ffmpeg -v error -y -i "assets/dnf_src/bilibili/skill-clips/10_崩山裂地斩.mp4" \
    -vf "select=eq(n\,K)" -frames:v 1 /tmp/f.png
  python3 assets/extract_bilibili_skills.py --detect    # 复算切片点，和 skill-clips/INDEX.txt 对一遍
  ```
- 量之前先对齐比例：参考里角色约 240px 高，本作约 90px，换算比约 2.67（都按参考像素 ÷2.67 折回本作）。

## 改之前先读（现状）

- `src/core.js` → `SKILLS.mountainRift`：duration 2.0s、`activeFrom 0.72`、3 段命中、`radius: 190`、
  `shockwave { reach: 360, visual: 0.7, arcOffset: 0 }`、`shockwaveHit: 0`。
  第八、九轮已经按 `OutRageBreak.avi` 定过一轮，**那些是基线，不要默默推翻**——只有和参考片 10
  冲突时才动，动了要说清依据。
- `src/render.js` → `SPRITE.skillClips.mountainRift = { row: 6, first: 9, frames: 6, beats: [2, 4] }`、
  `EFFECT.draw.mountainRift`（后排 `size: 840`）、`EFFECT.frontDraw.mountainRift`（前排火 `size: 572`）、
  `EFFECT.frontRows/frontFrames.mountainRift = 45`、`EFFECT.timing.mountainRift = { from: 0, to: 0.99 }`。
- `assets/import_dnf_effects.py` → `PICKS["mountainRift"]`（`_outragebreak` pack、`(tn)` 色板、
  `stages`、`length: 45`、anchor `(382, 281)`）+ `FRONT_ROWS` 里的 `mountainRiftFire`（`match:
  mountainRift`）。
- `assets/import_dnf_swordman.py` → `CLIPS["mountainRift"] = [123, 124] + list(range(125, 129))`。
- `assets/dnf_effect_picks.md` → 第八、九轮那两节是 大蹦 的完整决策记录，先读它。
- 烘焙产物：`assets/slayer.png`（身体）、`assets/effects.png`（特效），由上面两个脚本重烘；
  特效表里**一行 = 一个技能，行号 = `SKILL_ORDER` 下标**。

## 工作流

1. **先量后改**：量出起手 / 举剑 / 落点 / 收招的帧号，腾空高度与滞空时间，命中那一格，
   以及每块特效的**尺寸和颜色**。
2. 把量到的东西摆成对照图（参考帧 vs 我挑的身体帧 / vs 实机抓帧），**先给我确认**再定帧号。
3. 改身体动作 → 重烘 `assets/slayer.png`；改特效 → 改 `PICKS`/`FRONT_ROWS` → 重烘 `assets/effects.png`。
4. 改 `SKILLS.mountainRift` 与 `SPRITE`/`EFFECT`。
5. 实机核对：`CAPTURE_OUT=/tmp/xxx node tests/browser/capture-effect.mjs mountainRift 30 0.08 480`。
6. 跑 `npm test` 与 `npm run test:browser`，改掉/新增受影响的断言。
7. 在 `assets/dnf_effect_picks.md` 追加一节：**我的原话 + 量到的数据 + 改了什么 + 依据 + 核对命令**。
8. commit → `git push origin main` → 等 Pages 的 build/deploy/verify 三个 job 全绿 →
   用 `last-modified` 和 `effects.png` 的字节数确认线上就是新构建，再告诉我可以试了。

## 已知坑（上一轮真踩过的，别重踩）

- **色板后缀**：同一套形状常有 `xxx_d.img` / `xxx_n.img` 两条，`_d` 往往是暗色复制品。
  取之前算一遍不透明像素的平均 RGB 和参考比。（地刺：`_d`=(149,1,0)、`_n`=(232,40,0)、
  参考=(229,59,14) → 用 `_n`。）
- **锚点要用「几何中心」不是「包围盒边」**：扇形/圆环类的层，对准落点的是它**炸开的那个中心**。
  崩山击上一版拿下边缘贴地面，整块高了半个身位（原话：「位置有点高」）。
- **每层放大倍数不一样**：`stack` 只能给所有层一个 scale；`stages` 能逐层给
  `frames` / `scale` / `offset` / `from` / `until`。
- **地面上的东西别跟着人飞**：钉在地面的行要 `EFFECT.draw.mountainRift.ground = true`。
- **引擎会给每道地面波画一个椭圆「范围圈」**：参考里没有就写 `shockwave.arc: false`。
  （大蹦 现在**特意保留**那个圈：`arcOffset: 0` 让它和火焰合成一个圆——动之前先看参考有没有。）
- **改身体 clip 的帧数会挪动同一行的后续段**（`clips2` 行的 `silverFall` / `jump`），改完立刻 `npm test`。
- **无敌帧默认会闪**：参考里不闪就同时设 `player.solidInvuln`。
- **特效窗口**：`EFFECT.timing.mountainRift` 决定这一行的起止，默认窗口是按 `activeFrom` 算的比例。
- **别把快照当证据**：`tests/browser/artifacts/*.png` 是浏览器测试整批重生成的，按仓库惯例一起提交，
  但要单独看 `git status`，别混进无关改动。

## 开工前先问我（答案会直接改变实现，别自己默认）

1. 「一模一样」对齐到什么程度——**只对齐画面，还是连物理判定/伤害/位移一起**？
2. 参考片开头的**站立/预备**要不要保留，还是按键就直接从第一个动作开始？
3. 身体动作帧**由我先挑好给你确认**，还是你直接定？
4. 参考里的位移/弧线要不要按参考放大——必要时可以给单个技能**专属重力**
   （见 `SKILLS.mountainBreaker.leapGravity`）。
5. 参考里的落地/范围特效要不要一起对齐？

## 验收标准

- 关键帧的逐帧对照图（参考 vs 实机）动作、落点、特效层次与颜色都对得上，图先给我过目。
- `npm test` 与 `npm run test:browser` 全绿；受影响的断言已更新，关键约束（帧数、beats、锚点、
  色板、scale、timing、`arc`/`ground` 这类开关）都有测试钉住。
- `assets/dnf_effect_picks.md` 有新的一节，写清我的原话、量到的数据、改法与依据、核对命令。
- 改动只落在 `mountainRift` 相关的地方；已推送、Pages 三个 job 全绿、线上资源与本地一致，
  并告诉我线上地址可以试。
````
