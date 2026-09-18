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

### 待业主确认

- 崩山击 → 按客户端技能名应为 `hopsmash`（HopSmash = 跳劈）。
- 血气之刃 → `bloodsword` 包；游戏现在用的是包里的 `sword_normal`（红刀痕），
  同包还有 `exp_normal` / `exp_dodge`（血爆）。另列 `atblastsword`、`bloodboom` 对照。
- 怒气爆发 → `outragebreak` 包；另列 `rage`、`shockwavearea` 对照。
- 暴走 → `frenzy` 包只作参考；按业主说明应做成"头顶一个图标"。
- 血之狂暴 → buffer（开双刀）：暂用 `hellbenter`（一次觉醒）包作候选，
  同样按 buffer 处理，等业主指定。
