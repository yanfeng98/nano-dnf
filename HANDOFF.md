# 开发交接 · 2026-11-16

整体目标仍是解决与两段参考录像的全部差异，**尚未完成，业主实玩验收待确认**。本次按业主要求整理交接并 push，后续由下一位接手；不要把下述局部修复当成整体验收。

## 接手顺序

1. 先看 `git status --short` 和最近提交，再读 [CLAUDE.md](CLAUDE.md)、[CONTEXT.md](CONTEXT.md) 与 [ADR0068](docs/adr/0068-reference-videos-take-precedence.md)。以当前文件、真实进程和远端状态重新核实本页快照。
2. 保护下面列出的41个用户改动；确认资源路径与测试进程，再选一个有证据支撑的问题继续。通过条件是能指出旧实现的具体错误及可重复的验证路径。
3. 动手前按问题查 [录像审计总账](docs/reference-video-audit.md) 的最新批次及对应证据。历史结论有撤回，优先读后面的更正。
4. 每项修复完成本地回归、独立提交/push/部署和线上核验，再处理下一项。业主已授权这些推送和部署；整体完成还需要业主实际玩过并认可。

## 当前已验证基点

游戏运行时最新提交：`eedf6d6`（含 `fc13690` 投掷十夫长 `30021` `FlyBomb`、`f469de6` 原生石柱碎石粒子、`eedf6d6` 火弹落地 `stop` 与尾迹淡出）。

| 内容 | 当前证据与限制 |
| --- | --- |
| 普通投掷及燃烧变体 | 原生装备合成、石块纹理、水平速度和逆时针旋转已接入；碰撞/伤害/绝对AI仍待核。 |
| 投掷十夫长（`30021`） | 已替换发光占位物，接入客户端 `GobFlyBomb.obj` / `FlyBomb.ani` / `FlyBomb.img` 与 150ms 逆时针旋转；V2 26–105.5s 30fps 扫描未检出清晰飞行帧，`30022` 爆炸与弹道/伤害仍待核。 |
| 青哥布林 | 已由近战改为远程，实际AI发射30057主冰弹，原生八帧/50ms循环；Z-sine、附属粒子、穿透和AI参数未完成。 |
| 赤、诅咒赤哥布林 | 已由近战改为远程，实际AI发射30047，使用客户端火焰主尾迹与常重力弹道，已补齐 `firemissilegerocenter.ptl` 落地 `stop` 与 0.35s 尾迹淡出；光粒子、随机区域与完整混合/插值仍待核。 |
| 原生石柱碎石 | 已接入 `stonepillardamage.ptl` 8 枚碎石粒子（`StonePillarParticle1..4.ani`、`life 500ms`、`gravity 1200`、落地消失）；旋转支点与碎石伤害数字仍待核。 |
| 本地回归 | 502项单测、60组浏览器串行检查全部退出0。 |
| 发布与线上核验 | `fc13690`（Run `44101644444`）、`f469de6`（Run `44111318520`）、`eedf6d6`（Run `44117972521`）均已部署成功并通过 `npm run test:live` 及对应线上探针。 |

线上：[主入口](https://luyf-lemon-love.space/nano-dnf/) / [备用Pages](https://yanfeng98.github.io/nano-dnf/)。方向键移动，X普攻，C跳跃，A/S/D/F/G/H技能。普通关入口房有诅咒赤，第二格有赤、青；拉开距离可观察投射物。

本机交接时 `npm run serve` 仍在运行，父进程PID315550，日志 `/tmp/nano158-serve.log`，端口8080。接手时重新检查；远端8080需要VS Code端口转发或SSH转发才能在业主本机打开，服务端200不等于实玩验收。

## 用户未提交改动：保留原样

以下是开始本轮前就存在的用户编辑，**不属于本次修复**：

- `scripts/probe-reference-hair.py`。
- `tests/browser/artifacts/` 下40张已跟踪PNG。

具体路径及交接时SHA256在 [用户工作区清单](docs/reference-evidence/handoff-user-worktree-2026-11-16.json)。本次交接提交不含其内容。

完整浏览器回归会覆盖这些PNG。运行前单独备份全部原有脏文件；结束后先保存新产物到 `/tmp`，恢复原本干净的已跟踪产物，再将备份中的40张**全部**写回并逐项核对哈希，包括测试后碰巧变成干净状态的文件。明确列出自己的暂存路径，保留用户编辑在工作区。

本次最后一份备份在 `/tmp/nano159-existing-artifacts/manifest.json`，测试新产物在 `/tmp/nano159-generated-artifacts/`；临时目录可能消失，接手后自己建立新的备份。

## 下一步优先处理的差异（完整清单）

以下汇总当前所有已知未关闭的问题；完整历史取证与边界以 [录像审计总账](docs/reference-video-audit.md) 及各专项复核文档为准，本清单不代替实玩验收。

1. **投射物与怪物占位继续还原。**
   - **火弹（`30047`）：** 已补齐 `landingStop`（落地停滞与 0.35s 尾迹淡出）；主尾迹仍过于规则，光粒子、随机区域、完整混合/插值/属性继承，以及精确出生角/出生点/完整寿命仍未知（读取下一节后再修改参数）。
   - **冰弹（`30057`）：** 仅接入原生8帧/50ms循环；Z-sine公式、`IceMissile2`用途、水粒子及穿透未接入；V1 107–115.9秒尚未找到高置信度连续飞行匹配（最高NCC 0.673）。
   - **普通石块（`30001`）：** 碰撞、伤害与绝对AI仍待核实。
   - **投掷十夫长（`30021`）与 `whiteboss` 占位：** 投掷十夫长已接入客户端 `FlyBomb` 图与 150ms 旋转，但 `30022` 爆炸与弹道/伤害仍待核；`src/render.js` 第4580行附近仍保留旧 `goblin` 动作表作为 `whiteboss` 占位，尚未做独立源码与姿态核查。
2. **远程AI与战斗规则。** 当前青/赤/诅咒赤借用现有ranged间距，保留旧攻击持续/冷却；这些不是录像原值。碰撞半径9、通用落地销毁及伤害仍是待核代理。
3. **人物外观、运动与技能。**
   - **外观装扮：** 见 [人物外观复核](docs/player-appearance-review.md)。当前默认蓝上衣、窄裤与录像浅色上衣、宽松深色裤装、白色向上尖束发型明显不符；`scripts/probe-reference-hair.py` 仍在排查皮肤/发型/面饰组合，尚未找到同时解释 42/46/185 三姿势的候选。
   - **运动比例与技能：** 角色跑速（1.89 vs 录像 1.25 身位/秒）、深度轴比例（0.75 vs 录像 0.56）、怪物体型缩放不一致，以及施法层深度排序、指令输入（如 `↑+X`）、技能树/SP、整体技能与战斗绝对时序等仍待核对或取舍（见 [历史候选](docs/historical-next-step-candidates.md)）。
4. **经验成长与升级反馈。** 初始经验（当前0 vs 录像两关约 136/160、22/160）、升级阈值（目前普通关Lv3阈值77与录像斜率明显不符，第121/128/134/145/150批已收紧约束但尚无唯一公式，不能取区间中点冒充原值）、经验条轨道/比例、经验到账相位、浮字英文 `Exp` 后缀/字距，以及原生升级光柱/金色英文图字均未统一还原。
5. **房间内容、空间与场景交互。**
   - **房间名册与摆位：** 仍有未核普通房使用占位名册；已校正数量的房间，精确X/纵深/激活/波次/AI也未全部证明。普通第二格最终为8只/320经验（151批），深处领主房最终为8只/810经验（148批）；149批6/240、147批9/870均被后续证据推翻。
   - **石柱碎石与门叶规则：** 42/43/33/23/13房石柱已接入阻挡/抖动/破损音效及 `stonepillardamage.ptl` 8 枚碎石粒子，旋转支点、伤害数字及破损后完整引擎规则仍开放（90–98批）；门叶原生淡出时钟、门光与入口物理规则未完全定案（103–106批）。
   - **房间宽度与画幅：** 房间宽度仍统一使用最小档11.4身位（录像有11.4/13.3/15.1三档），画幅比录像4:3宽33%（历史决策暂未动）。
6. **城镇、HUD、小地图与战绩结算。**
   - **城镇：** 见 [城镇参考复核](docs/town-reference-review.md)。220px/s移速、10fps步频、纵深/斜向速度与镜头缓动仍属待实玩校准参数；云层构图、NPC分布、石板与栏杆原件等未完全对齐录像。
   - **HUD与小地图：** 原版胶囊血/蓝条皮肤与中央大型圆盘菜单未找到原件；冠军光环尺寸/亮度、方图背后底色/阴影/内容层、放大镜上半合成/悬停/按下及增长闪光、边框皮肤/字形仍开放（109–114批）。
   - **战绩与奖励结算：** 见 [战绩与奖励参考复核](docs/results-reference-review.md)。大魔法阵旋转与叠加混合、状态阶段时长、宝箱依次翻面/辉光与爆闪、第一张牌重复金色高亮规则、经验分解、Continue阶段、逐行淡入以及结算中文字形（`msjh.ttf`）匹配均未完成。
   - **评级、文本与音效：** 评级常数（`parSeconds`、受击扣分等）未验证；`格蘭之森` 繁简未统一；逐事件音效仍待补齐。
7. **实玩验收与工作区管理。** 所有自动化回归仅验证局部像素与不崩溃（机器人通关仍偏残血），尚未经业主真人实玩确认手感与难度；本地41个未提交用户改动在跑 `npm run test:browser` 前需按上文流程备份与恢复。

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
