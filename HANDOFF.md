# 开发交接（Rust 桌面版）

> **架构状态（2026-11-23）**：项目已由原浏览器 JS 版本完整迁移至 `rust/` 工作区（Windows 便携版 `nano-dnf.exe`），原 `src/*.js`、`index.html`、`package.json` 与 `tests/` 已在验证通过后移除。
>
> **当前最新进展**：
> - 已补全城镇与地牢内的全部桌面面板交互：
>   - 背包（`I`）`1-9` 使用药水恢复 HP/MP 或穿戴装备，`Backspace` 分解背包首件装备为材料与金币；
>   - 装备（`K`）`1-9` 卸下对应槽位装备回背包；
>   - 任务（`L`）`1-3` 接取与交付任务，击杀任务已按 `state.stats.kills_by_type` 精确统计怪物种类（不再把哥布林计入猫妖击杀）；
>   - 城镇商店（`U`）`1-8` 消耗金币购买药水与装备；
>   - 技能快捷栏配置（`B`）`1-6` 选槽并用 `←`/`→` 切换技能，自动写入 `nano-dnf-save.json` 并在重开地牢时保留；
>   - `Esc` 优先关闭当前打开的面板/配置。
> - 已接入更多原生贴图与音效（`render-rs`、`app/audio.rs`）：
>   - 技能栏冷却/缺蓝状态改用 `skillsDisabled` 原生灰化图标；
>   - 敌方投射物（`30001` 石块、`30021` 炸弹、`30057` 冰弹、`30047` 火弹）已接入 `goblinStone` / `goblinBomb` / `goblinIce` / `goblinFire` 原生精灵帧与旋转/朝向绘制，替换原先的纯色圆球占位；
>   - 血球（`blood_orb`）与地裂波动剑（`normalWave`）飞行物已接入 `effects.png` 原生序列帧（`orbRow=14` / `shotRows.normalWave=31`）；
>   - 鬼斩、上挑、崩山击、嗜魂封魔斩、血气之刃与血之狂暴双刀普攻已接入 `effects.png` 原生挥砍序列帧；
>   - 左上角目标信息栏已接入 `portraits-reference.png` 对应怪物/领主头像与边框；
>   - 普通哥布林（`grunt`）、普通/燃烧投掷哥布林（`caster` / `burningThrower`）与投掷十夫长（`throwerElite`）已优先接入 `goblinReference` / `casterReference` / `throwerReference` 原生独立图集；
>   - 幽暗密林深处（`mirkwooddeep`）入口、领主房及 13/14/23/24/33/42/43 房间已接入对应 `deep*Closeback` 原生近景层与 24 房前景遮挡层（`deepRoom24Foreground`）；
>   - 房间传送门已接入 `nativePathGate` / `nativePathGateEast` / `nativePathGateEastNormal` 与锁定栅栏 `gateBlock` 原生贴图；
>   - 技能斩击已补齐 `crossSlash`、`rageBurst`、`bloodSnatch`、`graspHead`、`bloodEvil`、`mountainRift`、`berserk` 的 `effects.png` 序列帧；
>   - 城镇地图（艾尔文防线）已按 `2520` 宽横版卷轴场景重做：`town.png` 分层拼接（远景/0.35 视差中景/石板路面/左旗帜/东侧发光传送门/前景栏杆）、`npc.png` 8 名动态 NPC（守卫/赛丽亚/敏泰/GSD/卡妮娜/布兰妮/辛达/守卫队长）、`walk` 步行动画与 `bodyRoots` 根骨对齐、`cameraHalfWindow=56` 跟随镜头与靠近 NPC/城门交互；
>   - 底部 HUD 栏与红/蓝球（地牢与城镇共用）已接入 `hud.png` 原生底条、左右球槽、`orbRed`/`orbBlue` 液位裁剪、`xpFill` 经验条与 `slotFrame` 技能框；
>   - 区域选择界面已接入 `region.png` 原生关卡卡片贴图；
>   - 觉醒（魔狱血刹）已接入 `awakening.png` 切入立绘，通关结算与宝箱阶段已接入 `results-reference.png` 魔法阵与宝箱原图；
>   - 地牢战斗新增 `↑ + X` 搓招上挑（`upSlash`）指令支持；
>   - Windows 原生音频已补齐全部核心事件的 `.ogg` 映射：`projectileSpawn`/`projectileHit`（石块/炸弹/冰弹/火弹）、`enemyAttack`（哥布林旋风/牛头斧劈冲撞砸地）、`tau`/`cat` 受击与死亡音、`playerLand`/`playerStep` 脚步音以及 `bloodSword`/`ghostSlash`/`frenzy`/`berserk`/`hellbenter` 技能音效。
> - **仍待处理的外部阻塞项**：整体录像对照还原（第 1–7 项视觉/AI/数值考据）及 Windows 真机实玩验收需要结合实机画面与业主试玩反馈推进。

## Rust 验证与构建入口

- 格式、静态检查与全量测试：`cd rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- Windows 交叉编译：`cd rust && cargo zigbuild --release --target x86_64-pc-windows-gnu -p nano-dnf`
- 跨平台说明：`rust/app/src/audio.rs` 仅在 `target_os = "windows"` 启用 `rodio` 原生音频，Linux 本地调试为静音空实现。

---

## 历史 JS 交接基线（2026-11-22，供录像取证对照参考）

整体录像对照和业主实玩验收尚未完成。本次收尾范围是血球跨纵深飞行、拖尾和回血反馈的位置。

## 最新代码基点

- **血球与回血反馈（`5c26ed6`）**。血球在横向、高度和纵深同时飞向角色胸口，拖尾各点记录飞行时的纵深。闪光、治疗光效和回血浮字使用吸收瞬间的角色位置。定向用例覆盖跨排飞行、拖尾与闪光的画布坐标，以及满血、部分回血与完整回血。验证入口为 `node --test --test-name-pattern='blood orb feedback|grasp head heals' tests/core.test.js`。实玩可在开启血之狂暴后打出血球，并趁血球飞行时按上下方向键换排。
- **近期战斗修复**。投射物同帧接触按到达顺序结算，接触检查涵盖玩家横向、纵深和高度移动。近战、冲锋、下砸与旋风在自身覆盖范围内才起手。深处领主使用独立死亡光效和 1.2 秒胜利等待。领主倒下后清除剩余敌人的预警并取消尚未释放的攻击。回血浮字显示实际恢复量，完全闪避的吸血技能不回血。
- **近期经验与结算修复**。两关经验进度按各自击杀账本拟合。战斗评级在发放通关经验前冻结，受击评级已校准到录像观测点。升级光效与经验浮字跟随角色，叠加经验浮字受视口边界约束。
- **近期自动化修复**。机器人会避开树桩、为墙边下砸留出跳跃时间，并在脚本接管控制前释放持续按键。失败日志分别记录按键决策时的坐标、血量和后续采样结果。近期真实键盘回归发生过领主房阵亡，仍需多轮观察稳定性。
- **后续取证入口**。普通第四房可从 V1 170.7–171.6 秒开始，已观察到西侧赤怪先动作，普通怪继续站立。补测另一接近方向或其他可对照场景，再决定触发条件。其余未结项见下方清单。

## 接手顺序

1. 先看 `git status --short` 和最近提交，再读 [CLAUDE.md](CLAUDE.md)、[CONTEXT.md](CONTEXT.md) 与 [ADR0068](docs/adr/0068-reference-videos-take-precedence.md)。以当前文件、真实进程和远端状态重新核实本页快照。
2. 保护现有的 42 个用户改动。确认资源路径与测试进程，再选一个有证据支撑的问题继续。通过条件是能指出旧实现的具体错误及可重复的验证路径。
3. 动手前按问题查 [录像审计总账](docs/reference-video-audit.md) 的最新批次及对应证据。历史结论有撤回，优先读后面的更正。
4. 每项修复完成本地回归、独立提交/push/部署和线上核验，再处理下一项。业主已授权这些推送和部署；整体完成还需要业主实际玩过并认可。

## 2026-11-16 历史快照

当日运行时基点为 `eedf6d6`，含投掷十夫长 `30021`、石柱碎石粒子和火弹落地停滞与尾迹淡出。

| 内容 | 当前证据与限制 |
| --- | --- |
| 普通投掷及燃烧变体 | 原生装备合成、石块纹理、水平速度和逆时针旋转已接入；碰撞/伤害/绝对AI仍待核。 |
| 投掷十夫长（`30021`） | 已替换发光占位物，接入客户端 `GobFlyBomb.obj` / `FlyBomb.ani` / `FlyBomb.img` 与 150ms 逆时针旋转，以及 `30022`（`FlyBombFlash.ani` / `MonsterDieFlash.img`）落地/命中闪光；V2 26–105.5s 30fps 扫描未检出清晰飞行帧，`30022` 其余范围伤害与弹道仍待核。 |
| 青哥布林 | 已由近战改为远程，实际AI发射30057主冰弹，原生八帧/50ms循环；Z-sine、附属粒子、穿透和AI参数未完成。 |
| 赤、诅咒赤哥布林 | 已由近战改为远程，实际AI发射30047，使用客户端火焰主尾迹与常重力弹道，已补齐 `firemissilegerocenter.ptl` 落地 `stop` 与 0.35s 尾迹淡出；光粒子、随机区域与完整混合/插值仍待核。 |
| 原生石柱碎石 | 已接入 `stonepillardamage.ptl` 8 枚碎石粒子（`StonePillarParticle1..4.ani`、`life 500ms`、`gravity 1200`、落地消失）；旋转支点与碎石伤害数字仍待核。 |
| 升级与开门音效 | 已将 `LEVEL_UP` (`levup.ogg`) 与 `ELVEN_GATE` (`ev_gate.ogg`) 接入原生音频清单（71/71），替换原 WebAudio 合成音；其余逐事件音效仍待核。 |
| 普通关领主房 | 已按 V1 236–332s 2fps 日志与目标条校正为 8 只 Lv4 哥布林（4 grunt + 2 caster + 2 goblinBlue，各 40 经验）+ Lv7 牛头巨兽（280 经验），共 9 只 / 600 经验；精确站位/激活仍待核。 |
| 本地回归 | 505项单测、60组浏览器串行检查全部退出0。 |
| 发布与线上核验 | `fc13690`（Run `44101644444`）、`f469de6`（Run `44111318520`）、`eedf6d6`（Run `44117972521`）均已部署成功并通过 `npm run test:live` 及对应线上探针。 |

线上：[主入口](https://luyf-lemon-love.space/nano-dnf/) / [备用Pages](https://yanfeng98.github.io/nano-dnf/)。方向键移动，X普攻，C跳跃，A/S/D/F/G/H技能。普通关入口房有诅咒赤，第二格有赤、青；拉开距离可观察投射物。

本机交接时 `npm run serve` 仍在运行，父进程PID315550，日志 `/tmp/nano158-serve.log`，端口8080。接手时重新检查；远端8080需要VS Code端口转发或SSH转发才能在业主本机打开，服务端200不等于实玩验收。

## 2026-11-19 增量（`bc1e3ea` / `f77ea12` / `990fbb2`）

- `bc1e3ea`：原生音效补入投掷石块 `THROW_STONE`、冰弹 `ICICLE_CREATE/HIT`、火弹 `SIZZLE_CREATE/HIT`、通关 `RESULT_RANK1`、领奖 `REWARD_OPEN1`（客户端 `audio.xml` 条目，`sounds_effect*.npk` / `sounds_ui.npk` 原文件）。Actions 43 `44462548155` 成功，`npm run test:live` 已通过。
- `f77ea12`：冰弹 `30057` 接入 `icemissile.ptl` 的 Z 轴正弦（幅度5、1600°/s）及 `seagabicicle.obj` 穿透力50（单次穿透同一目标只伤一次）。正弦相位/符号、穿透计数语义仍是按声明字段的解释，未被录像唯一证实。Actions `44516228545` 成功，`test:live` 通过。
- `990fbb2`：结算经验面板按录像已观测分项（基础 + 评级30% + 频道5%）依次计数到 2376 / 6318；仅覆盖两个 S 评级样本。
- 本次**未能**解决、且已核实证据不足的项：升级阈值/初始经验（客户端 `exptable.tbl` 两种常见索引解释均被录像排除）、原生升级光柱与金色 LEVELup 字图（客户端仅找到中文/绿橙英文版本，与录像金色版不匹配）、人物外观、跑速/深度比例、房间宽度三档、画幅、城镇/HUD 原件缺失、实玩验收。

## 用户未提交改动：保留原样

以下是开始本轮前就存在的用户编辑，**不属于本次修复**：

- `scripts/probe-reference-hair.py`。
- `tests/browser/artifacts/` 下 41 张已跟踪 PNG。

历史交接的路径和 SHA256 见 [用户工作区清单](docs/reference-evidence/handoff-user-worktree-2026-11-16.json)。本轮 42 个文件已使用本机 `/tmp/nano-goal-original-files.sha256` 核对。运行回归前可按当前 `git status --short` 重新记录哈希。

键盘游玩、深处和城镇冒烟脚本现在将截图输出到各自新建的系统临时目录，并在日志中打印路径。运行旧版脚本时仍需先备份工作区内已有的截图改动。

本次最后一份备份在 `/tmp/nano159-existing-artifacts/manifest.json`，测试新产物在 `/tmp/nano159-generated-artifacts/`；临时目录可能消失，接手后自己建立新的备份。

## 下一步优先处理的差异（完整清单）

以下汇总已知未关闭的问题。完整历史取证与边界见 [录像审计总账](docs/reference-video-audit.md) 和各专项复核文档。

1. **投射物与怪物占位继续还原。**
   - **火弹（`30047`）：** 已补齐 `landingStop`（落地停滞与 0.35s 尾迹淡出）；主尾迹仍过于规则，光粒子、随机区域、完整混合/插值/属性继承，以及精确出生角/出生点/完整寿命仍未知（读取下一节后再修改参数）。
   - **冰弹（`30057`）：** 已接入8帧/50ms循环、Z轴正弦摆动与穿透，碰撞检查覆盖采样间的摆动（`f77ea12`、`d203076`）。正弦相位、穿透计数语义、`IceMissile2`用途和水粒子仍待确认。V1 107–115.9秒尚未找到高置信度连续飞行匹配（最高NCC 0.673）。
   - **普通石块（`30001`）：** 碰撞、伤害与绝对AI仍待核实。
   - **投掷十夫长（`30021`）与 `whiteboss` 占位：** 投掷十夫长已接入客户端 `FlyBomb` 图与 150ms 旋转及 `30022` `FlyBombFlash`（`MonsterDieFlash.img`）落地/命中闪光，弹道/伤害仍待核；`src/render.js` 第4580行附近仍保留旧 `goblin` 动作表作为 `whiteboss` 占位，尚未做独立源码与姿态核查。
2. **远程AI与战斗规则。** 当前青/赤/诅咒赤借用现有ranged间距，保留旧攻击持续/冷却；这些不是录像原值。碰撞半径9、通用落地销毁及伤害仍是待核代理。
3. **人物外观、运动与技能。**
   - **外观装扮：** 见 [人物外观复核](docs/player-appearance-review.md)。当前默认蓝上衣、窄裤与录像浅色上衣、宽松深色裤装、白色向上尖束发型明显不符；`scripts/probe-reference-hair.py` 仍在排查皮肤/发型/面饰组合，尚未找到同时解释 42/46/185 三姿势的候选。
   - **运动比例与技能：** 当前无加成跑速为105世界单位/秒，按历史测量采用的84世界单位/身位口径等于1.25身位/秒（见 [ADR 0039](docs/adr/0039-the-pace-is-the-recordings.md)）。副本玩家纵深投影速度已按两段录像从横向的0.75修正至0.40，纯向上的短样本分别为0.405和0.376，纯向下的样本分别为0.435和0.394。测量方法见 [ADR 0039](docs/adr/0039-the-pace-is-the-recordings.md)。V1 入口一段持棒哥布林追击的纵横比约为0.71–0.75，其他怪物和单轴纵移仍待取证。怪物体型缩放、施法层深度排序、指令输入（如 `↑+X`）、技能树/SP、整体技能与战斗绝对时序也待核对或取舍（见 [历史候选](docs/historical-next-step-candidates.md)）。
4. **经验成长与升级反馈。** 两关参考档已接入经验条拟合得到的初始余额与阈值，并在通关结算前发放一次固定参考经验。有效条宽/零点、其他评级奖励与更高等级阈值仍待核对。经验到账相位、浮字英文 `Exp` 后缀/字距，仍有差异。升级时已提供原创光圈与粒子提示，随角色移动并与底栏同一计时。
5. **房间内容、空间与场景交互。**
   - **房间名册与摆位：** 录像未经过的普通关支路仍使用推定名册；已校正数量的房间，精确X/纵深/激活/波次/AI也未全部证明。普通第二格最终为8只/320经验（151批），第四房 `(1,1)` 为7只/280经验，第五房 `(1,2)` 为9只/400经验；两房分界已用V1 183.5–184.0s小地图蓝点复核。第四房西侧两怪的相对站位已校正，原片先赤后绿开始动作，当前进房后两者立即移动，触发条件待核。普通领主房已按 V1 224–332s 日志核实为9只/600经验（`2 grunt + 2 goblinRed + 2 caster + 2 goblinBlue + boss`），深处领主房最终为8只/810经验（148批）；149批6/240、147批9/870均被后续证据推翻。
   - **石柱碎石与门叶规则：** 42/43/33/23/13房石柱已接入阻挡/抖动/破损音效及 `stonepillardamage.ptl` 8 枚碎石粒子，旋转支点、伤害数字及破损后完整引擎规则仍开放（90–98批）；门叶原生淡出时钟、门光与入口物理规则未完全定案（103–106批）。
   - **房间宽度与画幅：** 普通关第二房 `(2,0)`、第三房 `(1,0)` 和第五房 `(1,2)` 按V1镜头横移下界调整到1278.1、1044.5、1118.4世界单位，墙间距各少48。其他9格仍为960，墙间距为912。深处18格的房宽为600–1437.8，墙间距为552–1389.8。外部画布为960×540，居中的游戏视口为720×540（4:3）。普通关哪些房间需要区别宽度，以及两关各格的左右墙和可走范围与录像的对应关系，仍需逐房核对。
6. **城镇、HUD、小地图与战绩结算。**
   - **城镇：** 见 [城镇参考复核](docs/town-reference-review.md)。220px/s移速、10fps步频、纵深/斜向速度与镜头缓动仍属待实玩校准参数；云层构图、NPC分布、石板与栏杆原件等未完全对齐录像。
   - **HUD与小地图：** 原版胶囊血/蓝条皮肤与中央大型圆盘菜单未找到原件；冠军光环尺寸/亮度、方图背后底色/阴影/内容层、放大镜上半合成/悬停/按下及增长闪光、边框皮肤/字形仍开放（109–114批）。
   - **战绩与奖励结算：** 见 [战绩与奖励参考复核](docs/results-reference-review.md)。大魔法阵旋转与叠加混合、状态阶段时长、宝箱依次翻面/辉光与爆闪、第一张牌重复金色高亮规则、经验分解、Continue阶段、逐行淡入以及结算中文字形（`msjh.ttf`）匹配均未完成。
   - **评级、文本与音效：** 评级常数（`parSeconds`、受击扣分等）未验证；`格蘭之森` 繁简未统一；已补齐 `LEVEL_UP`、`ELVEN_GATE` 与拾金 `coin_pickup`（`coin_pick_01..05.ogg`）原生音效，其余逐事件音效仍待补齐。
7. **键盘回归稳定性与实玩验收。** 自动化回归覆盖通关流程和部分像素断言。机器人仍有历史上的低血量和领主房偶发阵亡，继续观察策略调整后的多轮结果。手感、外观和难度待业主真人实玩确认。

## 火弹取证与实现边界

相关实现：`src/core.js` 的 `goblinFireProjectile` / `spawnProjectile` / `updateProjectiles`，`src/render.js` 的 `nativeThrowGoblin` / `drawProjectile`，`assets/import_dnf_goblin_fire.py`，`tests/browser/goblin-fire.mjs`。

- **录像实测：** V1入口房61.2–61.5秒的十个火尾前端，按固定石柱校正镜头，再按位移拟合y(x)，避免重复/追帧。曲率约`.0009583883`；X337.5屏幕px/s、重力225屏幕px/s²的候选模型最大残差1.590px。其他重力也可能相容，不是唯一参数证明。见 [159-fire-curve.json](docs/reference-evidence/159-fire-curve.json) 与 [原帧裁片](docs/reference-evidence/159-fire-curve-crops.png)。
- **客户端声明：** hillgab→30047→HillGabSizzle，主PTL的X300、gravity200、角度[0,10,0]、life3000，以及MOB出生偏移(20,0,60)。原生场景投影1.125折算为屏幕值；Core世界坐标还要除镜头zoom。客户端z是高度，Core.z是地面纵深，不能混用。
- **实现解释：** 目前将10解释为向上10度；解析常加速度步进已验证不同dt分割一致。原片尚未唯一确认出生角、出生点和完整寿命。
- **图片候选：** 主FireMissile.ani无图，FireMissileParticle1是名称候选入口，未找到原生引擎的显式调用证明。Fire.img首帧在四个隔离前端ROI匹配约.875–.882；运行表现采用61.2秒的scale.7/PIL180度匹配，不等于已解码ANI40.0。
- **发射频率候选：** 当前把creation frequency50解释为50Hz，候选寿命350ms。两幅简化橙色剖面50Hz得分.800/.818，20Hz得分.746/.682；这是有限模型比较，不是引擎语义证明。见 [频率比较](docs/reference-evidence/159-fire-frequency.json)。
- **混合/插值：** 普通/加色及alpha插值模型残差都大，保留为未确认；没有仅凭GRAPHIC EFFECT2采用加色。见 [比较结果](docs/reference-evidence/159-fire-compositing.json) 和 [原始源码调研的未知项](docs/reference-evidence/157-native-particle-format-review.md)。

青弹的V1 107–115.9秒搜索最高NCC仅.673，没有可靠连续飞行匹配；这不证明原片没有冰弹。见 [158-ice-video-search.json](docs/reference-evidence/158-ice-video-search.json)。

## 资源、脚本和验证入口

本机实际客户端是 `/mnt/c/dnf/地下城与勇士`，参考视频是仓库外的 `/home/luyanfeng/luyanfeng/dnf-素材/00001-幽暗密林.mp4`、`00002-幽暗密林深处.mp4`。`CLAUDE.md` 关于云端客户端 `/home/luyanfeng/dnf-client` 的补充段已过时；使用前核实路径，运行旧导入器时显式传 `--client`。美术继续只用业主本机客户端资源。

改火弹轨迹时，先用以下脚本复算证据；命令参数见各自 `--help`：

- `scripts/inspect-reference-v1-second-room.py`：通用V1归一化提帧，历史149文件名前缀不代表实际房间；本次60.9秒/1秒/stride1实际是入口房。
- `scripts/measure-reference-goblin-fire-curve.py`：十点轨迹与固定曲率候选。
- `scripts/inspect-reference-fire-candidate.py`：原始位图模板候选。
- `scripts/compare-reference-fire-frequency.py`、`compare-reference-fire-compositing.py`：有限表现模型比较，保留其限制。
- `assets/import_dnf_goblin_fire.py`、`import_dnf_goblin_ice.py`、`import_dnf_goblin_stone.py`：直接导出原图和来源参数；重复导出应逐字节一致。

临时原帧缓存：`/tmp/nano156-v1-entry`（58–67.9秒/stride3）、`/tmp/nano159-fire-fine`（60.9–61.9秒/stride1）、`/tmp/nano158-v1-blue`（107–115.9秒/stride3）。缺失时从仓库外视频重提，录像画面用于证据，不作游戏素材。

验证命令以 [package.json](package.json) 与 [发布工作流](.github/workflows/pages.yml) 为准。按 `CLAUDE.md`，一次只跑一个本地重任务：完整单测、完整浏览器、独立线上浏览器、ffmpeg/CV顺序排队。

修复后的完整链为 `npm test` → `npm run test:browser` → push并检查对应提交的部署 → `npm run test:live` → 对应功能的独立线上探针。火弹探针接受 `FIRE_URL`/`FIRE_OUT`，冰弹接受 `ICE_URL`/`ICE_OUT`，石块接受 `STONE_URL`/`STONE_OUT`。核验期间保持待核版本的游戏源码和资源不变。

长回归曾多次遭遇退出143。沿用独立监督、真实PID、退出码和输入哈希记录；观察超时后继续查同一进程，确认终止后才重启。本次监督脚本在 `/tmp/nano159-final-regression-runner.py`，最终结果已提交到证据目录；临时脚本若丢失，按此要求重建。最新本地回归PID338892已正常结束，交接时没有本轮待收尾测试。

`git push origin main` 的SSH认证可用；`gh` 当前未认证，Actions状态可通过GitHub公开REST API读取。发布证明和功能截图已经补入本交接提交。后续恢复工作时以新提交及真实线上结果继续记录，不复用旧绿灯证明新的改动。
