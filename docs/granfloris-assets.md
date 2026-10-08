# 格兰之森：资源总目录

**这份文档是格兰之森全部素材的唯一入口。** 8 个关卡要做很久，所以它按"照着它一只只做"来写：
每一样东西都给出**客户端绝对路径**、**包内 entry**、**帧数**，以及已知的坑。

- **客户端根**：`/mnt/c/dnf/地下城与勇士`（业主机器上的私服客户端，90 级上限）
- **包目录**：`ImagePacks2/`（3217 个 NPK）与 `ImagePacks2_70/`（2409 个）。
  本文件用到的包**两个目录里都有，且 entry 名一致**。
- **设计要求**见 `docs/adr/0026`；**术语**见 `CONTEXT.md`。
- **对照表**（126 张图）见 `assets/dnf_src/granfloris-probe/`（gitignored，可直接打开）。
- **原始数字**：`python3 assets/gf_roster.py` 会重新 dump 出
  `assets/dnf_src/granfloris-probe/roster.tsv`（包 / entry / 帧数 / 首帧尺寸 / 锚点 / 实际用墨范围）。
  本文件里的数字都是它的输出，不是转述。

> **2026-10-08 的一条教训，写在最前面**：这台客户端的怪物美术**按韩文名的罗马字命名**，
> 不按英文名。第一遍按 `cat` / `tauren` / `kanno` 搜，得出"猫妖不存在"的错误结论；
> 查到韩文名（猫妖 = 루가루 **Lugaru**）之后一条不差全找到了。
> **以后要找任何一只怪，先去查它韩文叫什么，再回来搜。**

## 一、四条硬规矩（做任何一只怪之前先读）

1. **一个 `.img` 里装着全套动作。** `goblin/body0.img` 的 17 帧里，
   **站立 → 走 → 扑击 → 受击仰头 → 倒地 → 爬起** 是连着的。
   **"哪几帧是待机、哪几帧是攻击"不在客户端美术里**——它在 `Script.pvf` 的 `.ani` 里，
   而该文件**全文加密**（GBK / UTF-8 / UTF-16LE / UTF-16BE / Big5 五种编码搜中文关名全部返回 -1，
   也搜不到任何可读 ASCII 路径）。
   **所以：帧数能给，动作边界给不了；动作边界要逐帧人工切，切完铺成对照表交业主用眼睛过。**

2. **每帧的 `(x, y)` 是"把这张位图画在哪"，不是"锚点在哪"。**
   `assets/import_dnf_monsters.py` 的注释里记着这条是怎么定下来的——**渲染三种候选比出来的**，
   不是推出来的：
   - **`画在 (x, y)`** ✅ —— 鬃毛长在头上、脚踩在地面线上；哥布林/牛头/猫妖三家都验过。
   - `anchor − (x, y)` —— 哥布林的脚对，但**牛头巨兽的白鬃毛会飘到头外面去**。
   - `anchor + (x, y)` —— 屏幕上什么都画不出来。

   所以 `(x, y)` 是**这一帧位图的左上角**，落在一张 `.img` 共用的一套坐标里；站立帧的
   **底边就是那套坐标的地面行**（哥布林位图 76 高、y=84 → 地面行 160；巨兽 164 高、y=183 → 347）。
   一帧一张尺寸、一个 `(x, y)`，所以**每一帧都可能是一块不同大小的图**——哥布林第 9 帧是 93×37
   躺在 `(35, 130)`。烘的时候按每帧自己的 `(x, y)` 摆，再把整只怪平移到 cell 的锚点上。
   （`CLAUDE.md` 与 `docs/adr/0025` 第十四节记的"锚点可能在画布外"说的是**特效层**，那批图的规矩不同。）

   **`ImageLink` 帧**（只有 index、没有 `(x, y)`）按它指向的那一帧摆：它说的就是"这一帧就是那一帧"。
   牛头一族用了它，所以读 `frame.x` 的写法会在 Boss 身上崩。

3. **跳过 1×1 空白占位帧。** 有些 `.img` 前面若干帧是真的 **1×1 空白**（锚点写着 (500,0) 或 (1000,0)），
   真身体从后面某一帧才开始。例：`cyclops.img` 的 `[0]..[8]` 九帧是空白，真身体从 `[9]` 起；
   `ghoul` 的 `*rise` / `dendroidb` / `icetiger` 的 `*bitelayer` 也是 1×1。
   **取"第一帧"的写法会把空白当动作帧。** 取"首个有墨的帧"（`gf_contact.py: first_inked`）才对。
   顺带：`link` 帧是另一回事，`ImageLink` 只在**本文件内**做帧复用，`build()` 会递归解引用，
   导入时不用特殊处理。

4. **区域怪的美术朝右**，与 `assets/slayer.png` 同向。本作 `drawEnemy` 现在假设素材朝左
   （`src/render.js:2408` 的 `if (enemy.facing > 0) ctx.scale(-1, 1)`），换素材时把它反过来。

## 二、地区与界面

| 用途 | 包 | entry | 帧 | 尺寸 |
|---|---|---|---|---|
| **选关条**（9 格，每格左边中文关名、右边该关 Boss 头像） | `sprite_worldmap_selectdungeonslot.NPK` | `sprite/worldmap/selectdungeonslot/granfloris.img` | 9 | 168×73 |
| 南部溪谷那格 | 同上 | `…/granflorishill.img` | 1 | 168×73 |
| **地区地图**（羊皮纸） | `sprite_worldmap.NPK` | `sprite/worldmap/granfloris.img` | 1 | 800×600 |
| 同上·山麓 | 同上 | `sprite/worldmap/granflorishillside.img` | 1 | 800×600 |
| 区域过场 | `sprite_map_cutscene.NPK` | `sprite/map/cutscene/granfloris.img` | 1 | 800×600 |
| **副本横幅**（入场动画，图上画着中文关名 + `Gran-Floris 格兰之森`） | `sprite_map_title.NPK` | `sprite/map/title/<代号>.img` | 14 | 首帧 241×58，锚 (19,20)，用墨 266×78 |

`granfloris.img` 9 帧的顺序（逐帧渲染读过，**这是地区地图上那 9 格的权威顺序**）：

| 帧 | 关卡 | 帧 | 关卡 |
|---|---|---|---|
| f0 | 幽暗密林 | f5 | 格拉卡 |
| f1 | 幽暗密林深处 | f6 | 烈焰格拉卡 |
| f2 | 冰霜幽暗密林 | f7 | 暗黑雷鸣废墟 |
| f3 | 雷鸣废墟 | f8 | 亡月雷鸣废墟（转职） |
| f4 | 猛毒雷鸣废墟 | | |

**选关条上的头像不能当素材贴。** 实测过：把头像与怪物 `.img` 在 1.0–6.0 倍（4× 空间）缩放、
左右翻转、任意偏移下做掩膜匹配，最好也只有 **RMSE≈94/255**，且最优解不随"正确的那一帧"收敛；
连全身都进画框的彼诺修那一格也一样。**那 9 张头像是照设定另画的立绘。**
它的用处是**当"哪一具身体属于哪一关"的权威对照**，以及当地区地图的图标。

## 三、地图与地块

格兰之森是第一版内容，**没进现代那套 `sprite_map_<关名>_tile/_obj/_ani` 结构**
（`castleofthedead`、`season4` 那些才是）。它的房间美术是 `sprite_map.NPK`（292 条）里
**5 套纯数字编号**的旧式图层：

- 一套 = `far*`（640 宽全景，底层）+ `mid*`（640 宽中景）+ `obj*`（单件道具，部分带动画）
  + `tile*`（224 宽地面砖，横向平铺）。**不是一张大图直出。**

| 套 | `far` | `mid` | `tile` | 画面 |
|---|---|---|---|---|
| **00** | `00far0` 1f · `00far1` 3f（640×250） | `00mid0` 1f · `00mid1` 1f（640×300） | `00tile` 4f 224×480 | 阴沉蓝绿**云杉**林、雾、远山 |
| **01** | `01far1` 1f 640×375 | `01mid1` 1f 640×380 | `01tile00..03` 224×203/233/233/235 | 明亮**阔叶**绿林 |
| **02** | `02far0` 1f 640×375 | `02mid0` 1f 640×380 | `02tile00..03` | 雾蓝紫阔叶林 |
| **03** | `03far1` 1f 640×348 | `03mid1` 1f 640×380 | `03tile00..03` | **夜色**紫黑林 |
| **04** | `04far0` 1f 640×348 | `04mid0` 1f 640×380 | `04tile00..03` | **橙红落日**云杉林 |

- `obj*` 是单件道具（石拱、树根、门框…），**另有一套 `01obj001..` / `02obj101f..` 的编号**，
  带 `f` 后缀的与不带的是同一形状（`02` 一族带 `f` 孪生）。
- **`f` 后缀 = 覆雪版**（逐张比对过：`02mid0f`、`02tile00f` 都是对应条目同一形状加积雪，
  **不是左右翻转**）。这一族正好对上**冰霜幽暗密林**。
- **哪一套归哪一关，客户端里查不到**——那个绑定写在加密的 `Script.pvf` 里。
  **所以下面的对应是我们的选择，不是客户端的既成事实。**

**区域的走道与门户**（跨房间用，**自带配色族**）：
`sprite_map_pathgate.NPK` → `sprite/map/pathgate/granfloris{bush,tree,pathtree,up/side/downdoor,up/side/downgate,up/side/downlight}*.img`，
**共 69 条，每条 1 帧**。树/灌木 01 绿 → 02 黄绿 → 03 秋黄 → 04 红褐 → 05 覆雪白；
门/门框另有黄/白/蓝/绿/橙等 8 色。对照图 `map-granfloris-pathgate.png`。

**可破坏草木**：`sprite_map_breakableobject.NPK` → `sprite/map/breakableobject/grass{1,2}{mirkwood,sunderland,grakkarak}.img`；
`…_actiontreerenew.NPK` → `…/actiontreerenew/actiontree1-{mirkwood,sunderland,grakkarak}.img`。
**只有这三关有专属草木**（幽暗密林 / 雷鸣废墟 / 格拉卡），其余五关没有。

**碉堡**（冰霜幽暗密林那个"躲进去避暴雪"的机制）：
`sprite_map_trap_goblinbunker.NPK` → `sprite/map/trap/goblinbunker/`：
`gobbunk_body`(123×129) · `gobbunk_bodydamaged`(123×128) · `gobbunk_door`/`door2`(2f) ·
`gobbunk_flag`/`flagdamaged`(4f，青绿海盗旗) · `gobbunk_destpieces`(9f) · `gobbunk_floor` · `gobbunk_grass`。
**造这件东西的"碉堡工"这只怪客户端里没有**（见第六节）。

## 四、八关名册

顺序与起始等级见 `docs/adr/0026`。**"建议地块"那一列是我们的选择**，其余都是客户端实读。

| # | 关卡 | 代号 | 等级 | 选关格 | 建议地块 |
|---|---|---|---|---|---|
| 1 | 幽暗密林 | `mirkwood` | 3–5 | f0 | set **01**（明亮绿林） |
| 2 | 幽暗密林深处 | `mirkwooddeep` | 4–7 | f1 | set **02**（雾蓝紫、更暗） |
| 3 | 雷鸣废墟 | `sunderland` | 6–9 | f3 | set **00**（阴沉云杉） |
| 4 | 冰霜幽暗密林 | `mirkwoodfrost` | 6–9 | f2 | set **01** 或 **02** 的 **`f` 覆雪版** |
| 5 | 猛毒雷鸣废墟 | `sunderlandpoison` | 8–11 | f4 | set **03**（夜色） |
| 6 | 格拉卡 | `grakkarak` | 11–14 | f5 | set **00** |
| 7 | 烈焰格拉卡 | `grakkarakburning` | 6–9 | f6 | set **04**（橙红落日） |
| 8 | 暗黑雷鸣废墟 | `sunderlanddark` | 17–20 | f7 | set **03**（夜色） |

**每关的 Boss**（归属有一份客户端内部的独立证据：`SoundPacks/sounds_mon_act1.npk` 里的
Boss 音效名 `b_kinol` / `b_kurogaru` / `b_penril` / `b_shauta` / `b_taubeast` / `b_cwgbn` /
`b_tauarmy`，与美术命名空间一具一具对得上）：

| 关卡 | Boss | 包 | entry | 帧 | 首帧 | 锚点 | 用墨 |
|---|---|---|---|---|---|---|---|
| 幽暗密林 | 牛头巨兽 Tau Beast | `sprite_monster_tau.NPK` | `sprite/monster/tau/body02.img` | 32 | 140×164 | (166,183) | 213×301 |
| 幽暗密林 | 〃 的白鬃（配件，跨包） | `sprite_monster_tau_equipment.NPK` | `…/tau/equipment/hair02.img` | 32 | 48×28 | (242,177) | — |
| 幽暗密林深处 | 库罗猫妖 Kurogaru | `sprite_monster_lugaru.NPK` | `sprite/monster/lugaru/blacklugaru.img` | **37** | 73×75 | (109,175) | 152×103 |
| 雷鸣废墟 | 落雷凯诺 Kinol（**是哥布林**） | `sprite_monster_goblin_event.NPK` | `sprite/monster/goblin/event/kinol.img` | 17 | 50×76 | (77,84) | 102×120 |
| 冰霜幽暗密林 | 冰霜克拉赫 Keraha | `sprite_monster_soceress.NPK` | `sprite/monster/soceress/keraha.img` | 51 | 93×111 | (232,279) | — |
| 猛毒雷鸣废墟 | 芬里尔 Fenrir | `sprite_monster_lugaru.NPK` | `sprite/monster/lugaru/penril.img` | **37** | 73×75 | (109,175) | 152×103 |
| 格拉卡 | 沙乌塔 Tau King Shauta | `sprite_monster_tau.NPK` | `sprite/monster/tau/body05.img` | 32 | 140×164 | (166,183) | 213×301 |
| 格拉卡 | 〃 的红鬃 + 挂饰（配件） | `sprite_monster_tau_equipment.NPK` | `…/equipment/tangashair01.img`(121×97 @195,161) · `tangasacc01.img`(118×85 @159,246) | 32 | | | |
| 烈焰格拉卡 | 烈焰彼诺修 Vinoshu | `sprite_monster_soceress.NPK` | `sprite/monster/soceress/vinoshu.img` | 51 | 93×111 | (232,279) | — |
| 暗黑雷鸣废墟 | 盗尸者骨狱昔 Gulgwish | `sprite_monster_zombie.NPK` | `sprite/monster/zombie/ghoulgwish.img` | 20 | 47×107 | (75,29) | 116×114 |

**女巫是"裸体 + 三层装束"合成的**：`keraha` / `vinoshu` / `luis` 三具身体像素并不相同
（md5 不同）但**裸体姿势同源**，外观差别来自 **衣 + 发 + 饰**三层：
`clothes01+hair01+acc01` = 红装（彼诺修）、`clothes02+hair02+acc02` = 蓝装（克拉赫），
四件都是 **51 帧**、同锚点（衣 (262,306)、发 (255,286)、饰 (265,275)）。
武器另有 `weaponfire` / `weaponice` / `weapon01/02` / `weapon_a/b`（73×126 @200,230，51–52 帧）。

**每关的杂兵**（这一列是**我们的安排**，不是客户端的）：

| 关卡 | 杂兵 |
|---|---|
| 1 幽暗密林 | 哥布林（`goblin/body0..9`）、投掷哥布林、胆小哥布林 |
| 2 幽暗密林深处 | 猫妖族（`lugaru` 等）、十夫长（`whiteboss` 或 `goblintaskmaster`）、投掷十夫长 |
| 3 雷鸣废墟 | 哥布林、猫妖、牛头兵（`tau/body01`）、冰霜哥布林 |
| 4 冰霜幽暗密林 | 荧光猫妖（`whitelugaru`）、冰虎（`icetiger`）、树妖（`dendroid`）、碉堡（地形） |
| 5 猛毒雷鸣废墟 | 猫妖族、僵尸（`zombie`）、食人花（`monsterflower`） |
| 6 格拉卡 | 牛头族（`tau/body0*`）、赤哥布林 |
| 7 烈焰格拉卡 | 猫妖、牛头前锋、烈焰哥布林 |
| 8 暗黑雷鸣废墟 | 僵尸（`holloweye` / `zombie`）、食尸鬼（`ghoul`）、毒猫王 |

## 五、怪物总表

**哥布林一族** — `sprite_monster_goblin.NPK`：

| entry | 帧 | 首帧 | 锚点 | 用墨 | 用途 |
|---|---|---|---|---|---|
| `goblin/body0.img` … `body9.img` | 17（body9 **21**） | 46×76 | (77,84) | 93×89 | **10 具共用同一套画布 = 同一套画换色**。实测平均色：body0/1 青绿、2 绿、3 蓝灰、4 米白、5 紫、6 褐、7 蓝、8 红、9 薄荷灰 |
| `goblin/whiteboss.img` | 17 | 55×86 | (72,74) | 110×120 | 白毛 + 蓝弯刀，疑**十夫长** |
| `goblin/archer_gonlin.img` | 31 | 46×76 | (77,84) | 93×91 | 弓手（**拼写就是 gonlin**） |
| `goblin/rtrowgoblin.img` | 17 | 46×78 | (77,82) | 91×90 | 投掷 |
| `goblin/goblinunderminer.img` | 22 | 46×88 | (77,72) | 98×94 | 掘地 |
| `goblin/gligeat.img` | 12 | 169×159 | (134,109) | 225×207 | 尖刺装甲车 |
| `goblin/goblincannon.img` | 12 | 121×98 | (33,110) | 125×102 | 炮 |

`GoBlin_event` — `sprite_monster_goblin_event.NPK`：

| entry | 帧 | 首帧 | 锚点 | 用墨 | 用途 |
|---|---|---|---|---|---|
| `goblin/event/cowardgoblin.img` | 17 | 47×76 | (77,84) | 100×113 | **胆小哥布林**（英文直写 coward） |
| `goblin/event/goblintaskmaster.img` | 17 | 50×76 | (77,84) | 102×120 | 持弯刀，疑**十夫长** |
| `goblin/event/kinol.img` | 17 | 50×76 | (77,84) | 102×120 | **落雷凯诺**（雷鸣废墟 Boss） |
| `goblin/event/richgoblin.img` | 17 | 63×94 | (62,67) | 109×103 | 活动款 |

`trowgoblin` — `sprite_monster_trowgoblin.NPK`：
`trowgoblin/rthrowgoblin.img` 17f 46×78 a(77,82) · `trowgoblin/fthrowgoblin.img` 11f 207×135 a(39,108)（发射器）。

**牛头一族** — `sprite_monster_tau.NPK`：

| entry | 帧 | 首帧 | 锚点 | 用墨 |
|---|---|---|---|---|
| `tau/body01.img` … `body06.img` | 32 | 140×164 | (166,183) | 213×301 |
| `tau/body07.img` | 32 | **140×187** | (170,159) | 212×226 | 红面具装甲牛（**只有它更大**） |
| `tau/event_cow.img` | 32 | 140×165 | (166,182) | 223×301 | 围裙黄牛（活动） |
| `tau/firebreath.img` | 2 | 240×230 | (5,9) | | 喷火 |
| `tau/shield.img` | 7 | 105×176 | (1,7) | | 盾 |

配件在 `sprite_monster_tau_equipment.NPK`：`captain_0000..0400`（队长套）、
`tangga_0000..0400` + `tangashair01` + `tangasacc01`（**沙乌塔那一套**）、`metacowaxe`(+grow)、
`hair01/02`、`tattoo01/02`、`armlet01`、`weapon01..03`、`(tn)*` 灰版。

**猫妖一族（Lugaru）** — `sprite_monster_lugaru.NPK`，**全部 73×75 或 80×77 两档画布**：

| entry | 帧 | 首帧 | 锚点 | 用墨 | 是谁 |
|---|---|---|---|---|---|
| `lugaru/lugaru.img` | 37 | 73×75 | (109,175) | 152×103 | 普通猫妖（橙） |
| `lugaru/akaru.img` | 37 | 73×75 | (109,175) | 152×103 | 阿卡鲁（红橙） |
| `lugaru/whitelugaru.img` | 37 | 73×75 | (109,175) | 152×103 | **荧光猫妖** 시로가루（会治疗） |
| `lugaru/blacklugaru.img` | 37 | 73×75 | (109,175) | 152×103 | **库罗猫妖**（金鬃黑身） |
| `lugaru/penril.img` | 37 | 73×75 | (109,175) | 152×103 | **芬里尔**（紫，猛毒雷鸣废墟 Boss） |
| `lugaru/bloodlugaru.img` | 26 | 80×77 | (107,173) | 135×103 | 嗜血猫妖（红） |
| `lugaru/ciel.img` | 26 | 80×77 | (107,173) | 135×103 | 시엘（绿，善变） |
| `lugaru/heart.img` | 26 | 80×77 | (107,173) | 135×103 | 하트넥（蓝） |
| `lugaru/ciel_tail.img` | 26 | 22×26 | (133,191) | | 尾 |
| `lugaru/enchant.img` | 3 | 121×110 | (109,107) | | 加护星光 |
| `lugaru/casting.img` | 11 | 92×101 | (95,177) | | 施法特效 |

配件在 `sprite_monster_lugaru_equipment.NPK`：`teeth`(37f 12×15) · `heart_mask_1/2`(26f 54×79 @140,174) ·
`heart_glow_eyes`(26f 23×16 @174,189) · `ciel_tail` · `akaru_effect1..3`。
属性分支在 `sprite_monster_lugaru_ciel_attribute.NPK`（火/水/光/暗/无 各一套 att_*）。

**僵尸 / 食尸鬼** — `sprite_monster_zombie.NPK`（四具**同为 47×107、锚点 (75,29)**）：

| entry | 帧 | 用墨 | 外观 |
|---|---|---|---|
| `zombie/zombie.img` | 20 | 116×114 | 蓝白 |
| `zombie/holloweye.img` | 20 | 116×114 | **红手红脚红脸**（卡尔扎克的最佳候选） |
| `zombie/nicolzombie.img` | 20 | 116×114 | 黑 |
| `zombie/ghoulgwish.img` | 20 | 116×114 | **盗尸者骨狱昔**（暗黑雷鸣废墟 Boss） |

`sprite_monster_ghoul.NPK`：`ghoul/ghoul.img` · `ghoulmorgan` · `ghoulnomercy` · `ghoulheadless` · `ghoulthrower`
**各 39 帧 63×89 锚点 (221,300)**；`ghoulcurse` 12f；`skull` / `skullbomb` / `skullparticle` 6–7f；
`ghoul*rise` / `ghoulgraveldown` 是 **1×1 占位帧**，别当动作。

**其余可用的怪**：

| 名 | 包 / entry | 帧 | 首帧 | 锚点 |
|---|---|---|---|---|
| 冰虎 | `sprite_monster_icetiger.NPK` → `icetiger/icetiger.img` · `icetiger/shavante.img`（白剑齿虎） | 33 | 174×85 | (143,157) |
| 树妖 | `sprite_monster_dendroid.NPK` → `dendroid/dendroid{f,b}` · `goliden{f,b}` · `rodinglo{f,b}`（三色） | 51 | 173×157 | (54,193) |
| 食人花 | `sprite_monster_monsterflower.NPK` → `monsterflower/auxo.img` | 31 | 91×123 | |
| 暗精灵 | `sprite_monster_darkelf.NPK` → `darkelf/darkelf_guard` · `darkelf_sprit_hunter` · `dingo` · `humpri` · `marve` | 25–34 | 94–179 | |
| 蜘蛛 | `sprite_monster_spider.NPK` → `spider/spider` · `spiderpoison` · `spiderboss` · `tarantulra` | 24–49 | | |
| 石巨人 | `sprite_monster_cyclops.NPK` → `cyclops/cyclops.img` | 46 | **1×1 前 9 帧是空白** | (391,0)，真身体从 `[9]` 起 |
| 狗 | `sprite_monster_dog.NPK` → `dog/*` | 31–35 | | |

## 六、动作边界：客户端不给你，从**录像**里读

**一个 `.img` 装全套动作，而"哪几帧是待机、哪几帧是攻击"不在客户端里**——它在加密的
`Script.pvf` 的 `.ani` 里（第一节）。唯一能**看见**这个边界的地方是录像。

读法（工具是 `assets/match_monster_motions.py`）：**把录像的连续帧裁到那只怪、与它的 `.img`
全帧并排贴在一张图上，两边同尺度**，然后照着读——上面某一格是"走"，就去下面找到同一个姿势，
把帧号记下来。业主可以自己拿这些对照表核。

### 哥布林一族（`sprite_monster_goblin.NPK :: goblin/body0.img`，17 帧）

| 动作 | 帧 | 在哪看到的 |
|---|---|---|
| 待机 | **f0** | 92.46–93.0s，原地不动、同一站姿保持 0.5 秒 |
| 攻击 | **f1–f6** | 93.0–93.9s 切进"上身前俯、棍放到身前低位"并保持；**抬棍起手 f1–f3 没拍到** |
| 倒地 | **f7–f9** | 93.9–94.6s，仰面翻倒、腿蜷起 |
| 起身 | **f10–f11** | **未观测到**（录像里被打倒的哥布林全是死的，没有一只站起来） |
| 行走 | **f12–f16** | 63.0–64.6s，一边迈步一边平移 |
| 受击 | **没有这个姿势** | 这 17 帧里没有专门的受击帧——挨打是**白闪**，不是换姿势 |

**这十具哥布林（`body0`–`body9`）共用同一套 17 姿势**，而且是**量过**的：逐帧比轮廓掩膜，
`cowardgoblin` / `rtrowgoblin` / `goblintaskmaster` 与 `body0` 的 IoU 是 **0.74–0.94**，
`whiteboss` 是 0.65–0.78（**它画得大一圈，约 1.15×**）。所以**一张动作表覆盖整个哥布林家族**，
`whiteboss` 只需要多一个缩放。只有牛头（32 帧）要自己一张表。

### 牛头巨兽（`sprite_monster_tau.NPK :: tau/body02.img`，32 帧）

读法同上，但这一只用的是**剪影叠加**：把候选帧与 `hair02` 的合成剪影按倍率扫过录像，
**最优轮廓叠上去严丝合缝的才算**（Boss 战在录像 236–330s）。

| 动作 | 帧 | 把握 | 录像里的时间码 |
|---|---|---|---|
| 待机 | **f0–f1** | 中 | 237.5–238.0、244.5、295.5、313.0–314.0s（每次只闪 0.5–1 秒） |
| 行走 | **f20–f27**（8 帧循环） | 中高 | 242.2–244.2s 屏幕位移 **+307 px**、250.0–251.5s **−296 px**（地面贴片交叉相关量过，摄像机静止，位移是它自己走的） |
| 攻击（举臂→下砸） | **f2–f3 举臂** → f4–f6 下砸 → f7–f8 收 | 高 | 五次：245.0–247.0s 举臂（保持约 2 秒，**期间前移 +250 px**）→ 247.5–248.0s 落下；252.5–254.5 → 255.0–256.0s；**282.0–284.0 → 284.5–285.0s（玩家在走路没打它 → 是它自己的招）** |
| 倒地 | **f9 → f10 → f11 → f12**（躺的保持帧是 f12） | 高 | 249.0–249.5s；另有 257.0–257.5、279.0–280.5、287.0–288.5、301.5–303.5s 等七处 |
| 起身 | **f13–f15**（弓身撑起）→ f16–f18（半蹲/迈步）→ **f19**（站定） | 高 | 249.7–250.4s |
| 受击 | **没有独立帧** | — | 被打中时**不换姿势、只闪红/白**；够狠的一击直接进 f9–f15 的倒地链 |
| 低头张口族（f7–f8、f16–f18、**f28–f31**） | — | 低 | 疑似咆嗥或挨打后的僵直，**未定性**，不给它派状态名 |

**它的招牌是"冲上去砍一下"**：举臂那 1–2 秒里它同时向前挪（+250 px / −470 px），落下之后才停。
客户端音效包里正好有 `tau_rush` / `tau_axeswing` / `tau_crash` 三个名字对得上。
`tau/firebreath`（吐息）、`tau/shield`（盾）、`metacow*`（大斧）**这场录像里没出现过**。

**「待机」这一条标未定**：f20–f27 在被挡住或残血时也会播，所以"站住"和"走"用的是同一族帧，
只有 f0–f1 是干净的待机候选。**别当既成事实。**

`body01 / 03 / 04 / 06` 与 `body02` **逐帧剪影 XOR = 0.0000（32/32 帧完全相同）** → 共用这张表；
`body05` 差 0.10（多挂件）；`body07`（牛头王）差 0.32 且锚点全不同 → **另一具，必须单独分段**。

### 画多大：一只怪一个倍率，不是一把尺子量到底

**同一个客户端里，不同怪是按不同倍率画的**——这是量出来的，不是推的：

| | 录像里屏幕高 | `.img` 站立帧用墨高 | 倍率 |
|---|---|---|---|
| 哥布林 | ~146–153 px | 76 | **≈2.0** |
| 牛头巨兽 | **574 px** | **164**（**不是**整表用墨 301，那 301 是 f29 一颗杂散像素撑出来的） | **≈3.5** |

也就是说**牛头巨兽相对它自己的美术，比哥布林相对它自己的美术大 1.75 倍**。
这不是量错：站立、躺平（宽 199 → 屏上 687 px）、四足三个独立姿态都给 3.2–3.5。

**折成本作只需要一个数**：**录像里玩家 240 px 高，本作玩家 84 px**，所以

    本作 px = 录像 px × 84 / 240 = 录像 px × 0.35

- 哥布林 153 px → **54**
- 牛头巨兽 574 px → **201**

这两个数写在 `src/render.js` 的 `MONSTER.draw`（**画多大**）。
**它和 `ENEMY_TYPES` 的 `width/height`（碰撞盒）是两个东西，这是故意的**：
那对盒子是玩法，而 AI 的距离判断是**中心到中心**的（`chooseEnemyAction`），
所以**身体变大而距离不变，怪就够不着人了**——实测把 Boss 的盒子放大到 230 宽之后，
它被推开到 189 px 外，而它的 `attackRange` 只有 74，**它一下都打不出来**。
"让碰撞盒跟着美术走"要把每一个怪的距离都重新按身体推导，**那是单独的一片**，不塞进这一片里做。

**哥布林那一行的测法**（好复核）：63.0s 一只行走中的哥布林，在 1080p 录像上叠 10px 网格读数——
头顶耳尖 y≈565 → 后脚底 y≈718 = **屏幕上 153 px**；同姿势用墨高 68–73 px，站立帧 76 px →
`153 / 76 ≈ 2.0`。
**交叉验证**：手里的木棍录像里 ≈87 px，`equipment/weapon1.img` 用墨 46 px → 1.89。

### 录像里没出现的怪（**搜过，不是没找**）

65–235s 每 5s 扫一遍怪物名牌，整段录像里出现过的只有
**哥布林 / 投掷哥布林 / 青哥布林 / 赤哥布林 / 诅咒之赤哥布林 / 燃烧之投掷哥布林**；
全场扫描（3–5s 一张）看到的哥布林外观只有三种：青绿皮持棍的普通哥布林（含青、赤换色）、
**白胡子绿的胆小哥布林**（135s 一带），以及 Boss 房的牛头怪。
**`rtrowgoblin`（蓝钢甲带角盔）、`whiteboss`（金发白皮）、`goblintaskmaster`（金盔鲑红弯刀）
这三副美术在录像里一次都没出现**——它们的帧号靠上面那条"同一套骨架"的实测推过去，
而不是各自看出来的。

**牛头一族整族都没出镜**：0–235s 各房间的杂兵**全是哥布林族**，
`body01/03/04/05/06`（牛头兵那一类）与 `body07`（牛头王）**一只都没拍到**——
它们的分段是**未观测到**，靠"与 `body02` 逐帧剪影 XOR = 0.0000"共用 body02 的表推过去
（`body05` 与 `body07` 除外，见上一节）。

**这条对关卡名册有影响**：业主那张表把「牛头兵」列在幽暗密林里，
但**这支录像的幽暗密林里一只牛头杂兵都没有**（地毯式扫了三段），
所以"幽暗密林有牛头兵"这件事**没有影像证据**——它在这台客户端里到底有没有，**待定**。

## 七、客户端里没有的

| 名册项 | 结果 | 能顶它的 |
|---|---|---|
| **卡尔扎克**（红僵尸） | 全客户端条目级 **0 条** | `zombie/holloweye.img`（四具里唯一红手红脚红脸的） |
| **普拉格**（黑种哥布林） | 无同名条目，**且 `goblin` 的 10 具里没有一具是黑的**；只有 2017 活动版（`sprite_monster_event_2017_newyear_proga`）+ 中文活动地图 | `goblin/body3`（最深的蓝灰）或 `body5`（紫） |
| **碉堡工** | **没有这只怪的身体**；**碉堡本身的美术齐全**（见第三节）。韩国攻略说冰霜幽暗密林的机制是**躲进 bunker 避暴雪**，所以"碉堡工"很可能指的是**机制**而不是一只怪 | 把碉堡当**地形物件**用 |
| **园丁鲁尔** | 韩文说它是**猫妖变种**（정원사 랄），但 `lugaru` 包 11 条里没有一条写着 gardener | `lugaru` 一族里现成的一具 |
| **洛兰 / 洛兰深处 / 亡月雷鸣废墟** | **美术都在**（`title/lorien`、`title/lorieninside`、选关格 f8），只是**业主定的 8 关不含它们** | — |

**业主表里与客户端不符的一处**：表里写「猛毒雷鸣废墟 → 落雷凯诺」，但**猛毒雷鸣废墟的 Boss 是
펜릴（Fenrir）**，是一位**猫妖**（`lugaru/penril.img`）；落雷凯诺（키놀）是**雷鸣废墟**的 Boss，
而且它是一只**哥布林**（所以躺在 `goblin_event` 包里）。

## 八、对照表在哪

全部在 `assets/dnf_src/granfloris-probe/`（gitignored）：

- **逐关总表**（含中文关名横幅 + 草木 + 关卡图标）：`map-<代号>-<中文关名>-overview.png`（8 张）
- **选关条**：`map-region-granfloris-slotframes.png`；3 倍放大版 `stageslots-big.png`
- **选关条 vs 5 套地块并排**：`map-slotvssets.png`（决定"哪套给哪关"时看这张）
- **单套地块合成**：`map-set00-composite.png` … `map-set04-composite.png`
- **区域走道门户**：`map-granfloris-pathgate.png`
- **8 张 Boss 并排对照**（左=选关条头像，右=客户端怪物条目）：`boss-<中文名>-match.png`
- **猫妖逐具全帧**：`lugaru-<entry>.png`（8 张）+ `lugaru-heart+mask.png`、`lugaru-whitelugaru+teeth.png`
- **动作证据**：`frames-goblin-body0.png`（body0 全 17 帧）、`frames-zombie.png`（全 20 帧）、
  `strip-keraha.png` / `strip-vinoshu.png`（各 51 帧）
- **朝向证据**：`facing-strips.png`、`facing-zoom.png`
- **全客户端怪物包总览**（857 包各取一帧，用于证否）：`_allpacks-1.png` … `_allpacks-11.png`
- **数据**：`roster.tsv`（本文件全部数字的来源）、`npk-entry-index.tsv`（24 万条包内路径全量索引）

**烘进游戏的两条管线**（不是在 `assets/dnf_src/` 里看，是产出游戏真正加载的图）：

| 脚本 | 产出 | 做什么 |
|---|---|---|
| `assets/import_dnf_region.py` | `assets/region.png`（840×146，9 格） | 选关条那 9 张卡片，地区地图整屏直接用 |
| `assets/import_dnf_monsters.py` | `assets/monsters.png` | 把一局里用到的怪烘成一张表，**一行一只、按客户端自己的帧顺序**；`--report` 打印每只怪的用墨范围（cell 就是照它定的），`--preview` 出对照图 |

`import_dnf_monsters.py` 的 `ROSTER` 是"哪个行为原型长什么样"的唯一出处
（`grunt`/`coward`/`caster`/`brute`/`elite`/`boss` → 包 + 条目），`OVERLAYS` 是叠在身体上的层
（牛头巨兽的白鬃）。**动作边界不在这个脚本里**——它烘全部帧，哪几帧是走、哪几帧是打，
来自录像（见下）。

**看/量用的脚本**（都在 `assets/`）：`gf_roster.py`（本文件的数据源）·
**`assets/match_monster_motions.py`（把录像的连续帧与某只怪的 `.img` 全帧并排贴在一张图上，
用来读动作边界）** · `assets/gf_video_strip.py`（只切录像那一半，用来找片段）·
`gf_strip.py`（一个 `.img` 全帧网格）· `gf_composite.py`（多层合成条，支持跨包）·
`gf_frame.py`（单帧合成）· `gf_boss_sheet.py`（选关条头像 vs 条目并排）·
`gf_contact.py`（contact sheet）· `gf_index.py`（建全量索引）· `gf_link_probe.py`（帧/link/锚点 dump）。
