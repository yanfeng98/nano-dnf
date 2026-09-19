# 红眼（狂战士）技能特效选型记录

业主逐条看过 `dnf_effect_berserker_candidates.png` 后的确认结果。表里给过两版
编号：第一版 0-313（14 个技能族），第二版 0-137（只留业主点名的 7 个族）。
两版都记在下面，按包/条目查最稳。

## 已确认

| 技能 | 旧编号 | 新编号 | 包/条目 | 帧数 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 崩山击 | 0 | 0 | `hopsmash/b_bottom_01_d.img` | 6 | 业主指定「选择 0」 |
| 十字斩 | 27 | 13 | `gorecross/gorecross_cross.img` | 11 | 与游戏当前选型一致 |
| 抓头 / 噬魂之手（不蓄力） | 51 | 46 | `grabblastblood/blood.img` | 6 | 业主指定 |
| 抓头 / 噬魂之手（蓄力） | 52 | 47 | `grabblastbloodex/exp_blood_normal.img` | 10 | 业主指定，对应 EX 包 |
| 血气之刃 | 22 → 19 | 22 → 19 | `bloodsword/sword_normal.img`（先） → `bloodsword/exp_dodge.img`（后） | 19 / 8 | 业主指定「22 先出然后 19」：血剑先出，再爆 |
| 血之狂暴（双刀 + 吸血球） | 25 + 28 | 25 + 28 | `frenzy/blood-energy.img`（双刀） + `frenzy/blood-stone-0.img`（怪物身上吸的血球） | 20 / 6 | 两段一起用 |

**暴走：业主明确「你就别画了」——不做特效。**

### 2026-09-19 业主看着动画逐包确认（包名 → 技能）

业主看完 `assets/dnf_effect_anim/` 的合成动画后的判定，这一版把「包 ↔ 技能」钉死了：

| 包 | 技能 | 业主原话要点 |
| --- | --- | --- |
| `hopsmash` | 崩山击 | 低跃砸地，多段+冲击波+倒地；落地霸体/无敌，地面裂开血色冲击圈 |
| `gorecross` | 十字斩 | — |
| `grabblastblood` | 噬魂之手（小抓头） | — |
| `grabblastbloodex` | 灭魂之手（大抓头） | — |
| `bloodsword` | 血气之刃（血剑·40 级） | 前方生成巨型血剑→刺入→爆炸；血剑穿刺、血花四溅 |
| `frenzy` | 血之狂暴（双刀） | 普攻变二刀流；双手燃起血色双刀光效 |
| `blastblood` | 怒气爆发 | — |
| `outragebreak` | **崩山裂地斩（大蹦·45 级）** | 召唤血气巨剑砸地→大范围冲击波浮空+岩浆喷发 |
| `bloodboom` | 浴血之怒 | — |
| `bloodmarble` | 魔煞血陨 | — |
| `bloodriven` | 血魔·弑天（二觉 80，大狗） | 变身血魔，召唤血魔扑咬，巨量单体爆发 |

注意 `outragebreak` 是**大蹦**不是怒气爆发，`blastblood` 才是怒气爆发（之前我按名字猜反了）。

两个抓头条目正好分属 `grabblastblood`（不蓄力）与 `grabblastbloodex`（蓄力）
两个客户端包，互相印证。

## 业主判为不对，需要重新找

| 技能 | 这一版用的包 | 业主说明 |
| --- | --- | --- |
| 怒气爆发 | `rage` / `outragebreak` | 不对：应是**先是地上圆圈，然后喷血** |
| 崩山裂地斩 | 未找 | 业主新点名要找（大蹦：血气巨剑砸地 + 冲击波浮空 + 岩浆喷发） |

业主给的技能描述（供后续比对，原文摘录）：

- 崩山击：低跃砸地，多段+冲击波+倒地；落地瞬间霸体/无敌，地面裂开血色冲击圈。
- 血气之刃（血剑·40 级）：前方生成巨型血剑→刺入敌人→爆炸；血剑穿刺、血花四溅。
- 怒气爆发：周身爆发红色怒气圈，多段浮空；地面炸开血气波纹，敌人被掀飞。
- 暴走：力量/攻速/移速暴涨；全身暴走红光，头发/武器冒血气，屏幕边缘泛红。
- 血之狂暴（双刀）：普攻变二刀流；角色双手燃起血色双刀光效。
- 嗜魂之手（大吸）：抓取单体→吸血气→喷发爆炸。

## 业主判为无关，已删除

- 狱血魔神：不是技能，而是狂战士一次觉醒的名字。
- 血之挽歌：不是狂战士的技能。
- 血气爆发 / 致命血殒 / 献祭 / 崩山裂地斩 / 剑雷系对照：业主说剩下的不对，
  且明确「其他的不用找」。

## 技能英文名的权威来源

客户端每个技能都带一段预览视频，文件名就是技能内部英文名：

    /mnt/c/dnf/dnf_90/客户端/DNF/Video/Swordman/<SkillName>.avi

视频内容是 Neople 加密的（只有首个 I 帧是明文），但**文件名**足以把技能内部名
钉死，且与特效包名一一对应（下划线后的部分）：

| 内部名 | 包 | 对应的红眼技能 |
| --- | --- | --- |
| `HopSmash` | `sprite_character_swordman_effect_hopsmash.NPK` | 崩山击（跳劈） |
| `GoreCross` | `..._gorecross.NPK` | 十字斩（业主已确认） |
| `BloodSword` | `..._bloodsword.NPK` | 血气之刃 |
| `Frenzy` | `..._frenzy.NPK` | 暴走 |
| `GrabBlastBlood` / `GrabBlastBloodEx` | `..._grabblastblood.NPK` / `..._grabblastbloodex.NPK` | 抓头（不蓄力 / 蓄力，业主已确认） |
| `OutRageBreak` | `..._outragebreak.NPK` | 怒气爆发 |
| `BloodyRave` | `..._bloodyrave.NPK` | 血气爆发 |
| `Hellbenter` | `..._hellbenter.NPK` | 狱血魔神（一次觉醒） |

之前按关键字猜包是错的：`chargecrash` 并不是崩山击，`hopsmash` 才是。

## 第二版候选（只保留业主点名的族）

编号 0-137，`assets/dnf_effect_berserker_<family>.png` 每族一张全帧条带：

| 技能 | 新编号 | 文件 | 包 |
| --- | --- | --- | --- |
| 崩山击（已定） | 0-6 | `dnf_effect_berserker_hop-smash.png` | `hopsmash` |
| 十字斩（已定） | 7-18 | `dnf_effect_berserker_gore-cross.png` | `gorecross` |
| 血气之刃（待确认） | 19-32 | `dnf_effect_berserker_blood-sword.png` | 只放 `bloodsword`（血剑本体 + 血爆），去掉了上一版混进来的蓝色 `atblastsword` |
| 暴走（待确认，buffer） | 33-40 | `dnf_effect_berserker_frenzy.png` | 只放 `frenzy`（武器/身上血气） |
| 抓头（已定） | 41-62 | `dnf_effect_berserker_grab-head.png` | `grabblastblood` + `grabblastbloodex` |
| 怒气爆发（待确认） | 63-79 | `dnf_effect_berserker_outrage-break.png` | 只放 `outragebreak`（地面血环 + 血爆） |
| 血之狂暴（待确认，buffer 双刀） | 80-101 | `dnf_effect_berserker_blood-rage.png` | `atblooddance`（`blooddance_hand` / `whipsword` 对应"双手血色双刀"） |

### 全包目录（找不到就按包名指）

175 个鬼剑士特效包，每包一行（包名 + 最亮条目 + 4 帧）：
`dnf_effect_catalog_1.png` … `dnf_effect_catalog_5.png`。

### 2026-09-19 第三轮：两张窄清单

`dnf_effect_berserker_mountain-rift.png`（崩山裂地斩，与崩山击对照，行号从 0 起）：

| 行 | 包/条目 | 说明 |
| --- | --- | --- |
| 0 | `hopsmash/b_bottom_01_d.img` | 崩山击，业主已定 |
| 1 | `hopsmash/b_bottom_02_d.img` | 同包兄弟条目，画面上最像崩山击 |
| 2 | `hopsmash/b_bottom_01_n.img` | 01 的 n 版 |
| 3 | `hopsmash/b_bottom_02_n.img` | 02 的 n 版 |
| 4 | `hopsmash/d-end.img` | 火 + 蓝收尾 |
| 5 | `chagecrashex/upper.img` | 金色大回旋 |
| 6 | `chargecrash/down-slash.img` | 火焰下劈 |
| 7 | `chargecrash/damage-front.img` | 火焰爆炸 |
| 8 | `chargecrash/dash.img` | 红焰拖尾 |
| 9 | `atmountaincrash/groundcrash_force.img` | 砸地冲击圈 |

`dnf_effect_berserker_rage-burst.png`（怒气爆发，先地上圆圈后喷血）：

| 行 | 包/条目 | 说明 |
| --- | --- | --- |
| 0 | `bloodriven/riven_circle.img` | 红圈 + 斩击 |
| 1 | `bloodriven/riven_circle_dodge.img` | 同上 dodge 版 |
| 2 | `bloodmarble/08boom_floor.img` | 地面血爆 |
| 3 | `outragebreak/outragebreak_floor.img` | 地面血环（业主否过） |
| 4 | `outragebreak/outragebreak_bloodsexp_1_none.img` | 血爆 1 |
| 5 | `outragebreak/outragebreak_bloodsexp_2_none.img` | 血爆 2 |
| 6 | `blastblood/blood_floor.img` | 血红地面 |
| 7 | `bloodboom/bloodboom_finish2.img` | 血爆收尾 |

工具也新增了两种查法（`assets/make_berserker_effect_menu.py`）：

- `--find "<regex>"`：按包名/条目名在**全库**里扫（先用名字过滤再解码，几十秒出图）
- `--similar <pack>/<entry>.img`：拿一条现成特效做 32×32 彩色签名，全库按 MSE 找最像的

### 待业主确认

- 崩山击 → 按客户端技能名应为 `hopsmash`（HopSmash = 跳劈）。
- 血气之刃 → `bloodsword` 包；游戏现在用的是包里的 `sword_normal`（红刀痕），
  同包还有 `exp_normal` / `exp_dodge`（血爆）。另列 `atblastsword`、`bloodboom` 对照。
- 怒气爆发 → `outragebreak` 包；另列 `rage`、`shockwavearea` 对照。
- 暴走 → `frenzy` 包只作参考；按业主说明应做成"头顶一个图标"。
- 血之狂暴 → buffer（开双刀）：暂用 `hellbenter`（一次觉醒）包作候选，
  同样按 buffer 处理，等业主指定。

## 2026-09-19 角色动作（sm_body0048，红眼觉醒皮肤，210 帧）

业主说明：那 117 套身体图是**同一套动作的不同时装**，`sm_body0048.img` 是红眼觉醒皮肤。
按业主给的动作描述，我在 210 帧里对出：

| 技能 | 业主描述 | 我找到的帧区间 | 依据 |
| --- | --- | --- | --- |
| 崩山击 | 跳起来，往前一段距离，剑砸到地上 | **127-141** | 129-132 起手抬臂、133-138 下劈/落地蹲身（脚离地最高 33px）、139-141 起身 |
| 十字斩 | 画十字，然后十字向前攻击 | 候选 A `34-48`、B `104-116`、C `142-156` | C 是长距离前刺（剑前伸并保持 12 帧），A/B 是连续挥砍 |

对照图：`assets/dnf_src/skill-motion-candidates.png`（同一比例、带帧号）。
另外 210 帧全帧图在 `assets/dnf_src/full-frames-sm_body0048/`。

待业主确认帧区间后落地：把该区间接成技能的**角色动作**，并让十字斩的十字**向前飞出**
（现在刀光是原地播放）。

## 2026-09-19 技能预览视频已破解

客户端每个技能都带一段官方预览视频（`Video/<职业>/<技能英文名>.avi`）。它外面套的是
「Neople Video File」容器，**不是真加密**：

- 前 32 字节是文件头（含明文长度），随后 **1024 字节明文**；
- 之后每个字节 = 明文自身 **异或 1024 字节前的明文**，所以可以从头迭代解出全文件；
- 解开后是普通 AVI（MPEG-1，160×90），可正常解码。

已用 `assets/decode_skill_videos.py` 把鬼剑士全部 **84 段**技能视频解密并导出到
`assets/dnf_src/skill-videos/`：每段一个 `.mp4`（可直接播放）+ 一张带帧号的
`<名字>.png` 全帧图 + `INDEX.txt`。

对照结论（与业主描述一致）：

- `HopSmash`（崩山击）：0-13 起手抬剑 → 14-27 前跃砸地、火焰冲击 → 28-49 蓝色冲击波
  → 50-57 收招。
- `GoreCross`（十字斩）：0-14 挥砍 → 17-33 十字成形并**向前推出** → 34-41 收招。

## 2026-09-19 已按视频落地的行为

| 技能 | 行为 | 依据 |
| --- | --- | --- |
| 崩山击 | 前跃 + 落地无敌帧 0.22s + 冲击圈放大到 236px | 业主描述 + `HopSmash` 14-27 砸地、28-49 冲击波 |
| 十字斩 | 十字成形后**向前飞出**（46→154px） | 业主描述 + `GoreCross` 17-33 |
| 怒气爆发 | 以自身为中心、半径 152、**3 段**、**浮空**（`launch -430`） | 业主描述 + 参考视频 `BloodBlast` |
| 血之狂暴（原暴走槽位） | 变成**姿态增益**：耗 6 HP、持续 8s、攻速 ×1.25、技能冷却加速 ×1.4，本身不造成伤害 | 业主描述 + `Frenzy` 视频里没有挥砍动作 |

## 2026-09-19 技能 ← 官方视频 ← 身体动作对照

`assets/dnf_src/skill-body-match/` 一张图对一个技能（11 个）：**上半**是该技能客户端
官方预览视频的关键帧，**下半**是 `sm_body0000` 的 31 段身体动作，每段标着
`段号: 起-止 (帧数)`。业主照上半的动作，在下半点一个段号，那段就是该技能的角色动作。
文件名是 `<游戏内 id>-<客户端视频名>`，图里第一行写了中文技能名（`INDEX.txt` 是同一份
对照的纯文本）。

| 中文技能 | 游戏内 id | 官方视频 / 特效包 | 当前身体动作（`src/render.js` skillClips） |
| --- | --- | --- | --- |
| 上挑 | `upSlash` | `UpperSlash` | 身体帧 41-50（技能行第 6 帧起） |
| 崩山击 | `mountainBreaker` | `HopSmash` | 段 17（128-131）+ 段 26 后三帧（206-208） |
| 十字斩 | `crossSlash` | `GoreCross` | 段 1（5-18）+ 段 25（198-203） |
| 怒气爆发 | `rageBurst` | `BloodBlast` | 段 10（76-83） |
| 血气之刃 | `bloodSword` | `BloodSword` | 待点段 |
| 血之狂暴 | `frenzy` | `Frenzy` | 待点段（双刀姿态，视频里没有挥砍） |
| 血气爆发 | `bloodyRave` | `BloodyRave` | 待点段 |
| 嗜血 | `bloodSnatch` | `BloodSnatch` | 待点段 |
| 抓头 | `graspHead` | `GrabBlastBlood` | 待点段（抓取，2 段） |
| 血魔 | `bloodEvil` | `BloodRiven` | 待点段（前冲穿刺） |
| 崩山裂地斩 | `mountainRift` | `OutRageBreak` | 待点段（大蹦，跳劈落地） |

这个客户端里**没有 `BloodSnatch.avi`**（84 段官方预览视频里就没有它，只有特效包
`sprite_character_swordman_effect_bloodsnatch.NPK`），所以嗜血那张图上半是空的，
图里也直接写了这句；嗜血的段号只能按「大吸 / 血波」的描述挑。

`sm_body0000` 的 31 段动作（段号: 帧区间，来自 `--skin sm_body0000` 的切分）：

| 段 | 帧 | 段 | 帧 | 段 | 帧 |
| --- | --- | --- | --- | --- | --- |
| 0 | 1-5 | 11 | 83-92 | 22 | 161-169 |
| 1 | 5-18 | 12 | 92-97 | 23 | 169-178 |
| 2 | 20-29 | 13 | 97-103 | 24 | 178-198 |
| 3 | 31-39 | 14 | 103-114 | 25 | 198-203 |
| 4 | 39-48 | 15 | 114-120 | 26 | 203-208 |
| 5 | 48-57 | 16 | 120-128 | 27 | 208-217 |
| 6 | 57-63 | 17 | 128-131 | 28 | 217-227 |
| 7 | 63-66 | 18 | 131-138 | 29 | 227-237 |
| 8 | 66-72 | 19 | 140-144 | 30 | 237-241 |
| 9 | 72-76 | 20 | 144-158 | | |
| 10 | 76-83 | 21 | 158-161 | | |

点定段号后落地两处：`assets/import_dnf_swordman.py` 的 `CLIPS`（把帧烘进 `clips` /
`clips2` 行）与 `src/render.js` 的 `skillClips`（行号、起始列、帧数、beat 节奏）。
