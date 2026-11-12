# 石柱碎石：已建立的事实与仍缺失的语义

结论：原生碎石纹理及其旋转获得了正向图像证据；约 179°/s 的旋转模型与观察相容。现有来源不能确定出生时刻、旋转轴、实际总数或发射分布，不能据此补出完整发射器。

## 客户端数据能直接说明什么

- 两套 PVF 都引用 `passiveobject/mapobject/breakableobject/particle/stonepillardamage.ptl`，其粒子 token 列表相同，但原始 PTL SHA256 不同；不能把 token 相同扩张为文件逐字节相同。四个对象引用分别是 `StonePillarParticle1.ani` 至 `4.ani`。来源：[91-pillar-effect-client.json](91-pillar-effect-client.json)，`clients[].particleTokens`、`particleSha256`。
- PTL 明文包含 `[random range] 40`、`[gravity] 1200`、x/z 的 `[move variable 1] 200 200` / `70 70`、`[rotation angle range type] [circle]`、`[rotation angle variable] 50 50`、`[rotation angle] 0 70 0`、`[maximum create number] 8`、`[life time] 500`、`[create area size] 50 30 10`。这是字段和值的证据；这些来源没有提供对应引擎读取实现，尤其不能证明 50、70、40 是某种角度、速度、随机分布或出生范围。来源：[91](91-pillar-effect-client.json)，`clients[].particleTokens`。
- 四个 ANI 都记录属性 `[12,2000]` 与 `[8,6.248279094696045]`，偏移依次为 `(-18,-21)`、`(-11,-13)`、`(-17,-16)`、`(-3,-3)`；原生图尺寸依次为 `19×15`、`15×20`、`26×24`、`8×8`，IMG offset 均为零。按“2000 ms 内旋转 6.248279 rad”的解释，算得 `179.00001°/s`；这是明确写出前提的候选解释，不是该 JSON 本身提供了属性编号的引擎规范，也不能由 ANI 偏移单独确定旋转轴。来源：[91](91-pillar-effect-client.json)，`animations`、`particleImages`；上述单位换算。

## 图像证据及其边界

- 已有 HD 测量包含四条轨迹、36 次匹配，相关分数 `0.9162–0.9638`；一度搜索步长是搜索分辨率，score-drop 角度范围是敏感性诊断，不是统计置信区间。来源：[92 HD 测量](92-pillar-hd-measurement.json)，`tracks`、`limits`；[92 摘要](92-pillar-investigation-summary.json)。
- 独立 room43 事件的六次全周角度复核保留了对象种类：type3 在帧 11–13 的峰值角为 `5°、15°、17°`；type1 在帧 14–16 为 `23°、31°、34°`；主匹配分数为 `0.946539–0.955488`，同种同角的爆发前对照仅 `0.601369–0.640185`。这支持这些时刻确实出现对应原生纹理。来源：[98 room43 测量](98-pillar-room43-debris-measurement.json)（`verified` 内字段 `kind/angle/score/alternatives/preburstControl`）；[纹理对照图](98-pillar-room43-debris-proof.png)；[测量脚本](../../scripts/measure-reference-pillar-debris-room43.py)。源视频 V2 从 83.5 s 起以 30 fps 编号，对照帧 7 为 83.7 s（`source`、`cameraAnchors`）。
- 对两段各三帧的同种序列分别拟合自由角度截距，固定 `179°/s` 的 RMS 角残差分别为 type3 `1.89°`、type1 `1.24°`。计算式为 `r_i=angle_i−179×time_i` 后去均值求 RMS；来源：上述六条原始记录。这是正向相容性证据；六条记录不是六个独立粒子，跨 type3→type1 的种类切换也不能当作同一粒子连续旋转。未知出生相位被自由截距吸收，因此该拟合不确定出生时刻。
- 已有三个轴心模型 HD RMS 分别为图像中心 `2.897 px`、ANI origin `2.686 px`、图像左上角 `3.579 px`；小幅残差差异没有建立唯一轴心，且该比较以具名 gravity1200 为条件消除了未知初始位置/速度。来源：[92 HD 测量](92-pillar-hd-measurement.json)，`pivotModels`、`limits`。
- type4 的爆发前假阳性相关分数曾达 `0.93946`；小纹理的高相关本身不足以计数。PTL 的具名最大值 8 不证明一次实际生成/可见数量等于 8，四种 ANI 引用也不证明每种至少出现一次。来源：[92 摘要](92-pillar-investigation-summary.json)，`type4PreburstFalsePositiveScore`、`decision`；[91](91-pillar-effect-client.json)，`particleTokens`。

## 公共仓库能否补足语义

检查对象为该项目自身的公共仓库（不是已确认为本地客户端引擎来源的官方源码） `https://gitgud.io/16ww/servers5a3.git`，固定提交 `6ab71b72ad4e2e7c8a200cc9956087025c7d57a6`。该提交的 `changelog.d/20261104-client-upstream-exe-tracking.docs.md` 描述上游 EXE 版本跟踪、摘要核验与补丁检查；`scripts/client/local-patches/UPSTREAM.md` 登记 V207–V211 的 EXE 摘要、客户端补丁及配套开关。这两份来源建立的是该项目的发行/补丁追踪关系，没有给出 PTL 解释器、ANI 属性读取或石柱发射实现，也未证明其 EXE 与本地被提取客户端相同。[固定提交文件](https://gitgud.io/16ww/servers5a3/-/blob/6ab71b72ad4e2e7c8a200cc9956087025c7d57a6/scripts/client/local-patches/UPSTREAM.md)。

本次[固定提交路径扫描](98-pillar-external-source-scope.json)记录完整路径清单的SHA256、路径数与复现命令，未找到 particle/stonepillar 源码路径；这只说明路径检索未命中，不能证明仓库任何文件内容都没有相关实现。因此上述公共文档不能补足 PTL 50/70/40 或对象 `int75` 的含义；当前证据集中也没有 `int75` 的权威读取实现。出生时间/初相位、轴心、总数、各类抽样概率、发射方向/位置/速度分布及随机取值方式继续保持未知。来源：上述固定提交文档、路径扫描记录及 [91](91-pillar-effect-client.json)/[92](92-pillar-hd-measurement.json) 明列的证据边界。


## 时间基准敏感性：不能据残差选定轴心

[时钟模型诊断](98-pillar-particle-clock-models.json)使用相同 42 个观测（旧 36 点加 room43 六点）、六条轨迹，固定候选重力 1200，以视频时间或 `angle/179` 为时间基准，对每条轨迹分别消去初始位置与速度。[计算脚本](../../scripts/compare-reference-pillar-particle-clocks.py)先按候选轴心修正纹理中心，再从纵向位置减去 `600t²`，对两坐标分别拟合常数与一次时间项；输出是全部坐标分量残差的 RMS 乘原生到 HD 的 2.25 倍，并非二维距离 RMS。两个时钟都减去本轨迹首个时间，这不会改变自由初始位置/速度模型的拟合空间。来源：脚本 `correction`、`physical`、`design`、`residuals` 的计算。

| 时间假设 | 图像中心 RMS（HD px） | ANI origin RMS（HD px） | ANI origin 的残差优势 |
| --- | ---: | ---: | ---: |
| 视频时间 | 2.771879 | 2.599397 | 0.172482 |
| angle/179 | 2.225825 | 2.203401 | 0.022424 |

这些差值直接来自同一诊断 JSON 的 `models`；仅改变时间假设便使两轴心的差异显著收缩，说明轴心比较受时间模型混杂，不能从较小误差选定唯一轴心。角度和位置来自同一图像拟合，误差相关；角度构造的时间不是独立真值。新增两条轨迹各仅三点，每坐标又拟合两个系数，剩余约束很少。因此较低残差既不证明 hit-stop，也不证明真实引擎时钟、原生重力单位或积分方式。来源：上述脚本及诊断 `limits`。

## 初相位的条件排除不等于 PTL 解码

room43 测量的 `conditionalInitialAngleModels` 明确限制：精灵从候选初始角 `0°/50°/70°` 开始，以正向 `179°/s` 旋转，年龄在 `0–0.5s`；脚本只在各自 `[offset, offset+89.5°]` 角区间内取最佳纹理分数。在六个观测上，50°/70°模型允许角区间内的最高分均不超过 0.8234，而实际主峰最低 0.946539。因此图像证据反对这一明确、简单的“正向精灵初始角偏移 50° 或 70°”假设。来源：[98 room43 测量](98-pillar-room43-debris-measurement.json)，`verified[].conditionalInitialAngleModels`；[测量脚本](../../scripts/measure-reference-pillar-debris-room43.py)，区间筛选式。

该检查同时依赖正转、匀速、最大年龄与初始角确指精灵朝向等前提；它不排除其他坐标/符号/发射方向定义，也没有证明 PTL 中的 50 或 70 本来表示精灵初始角。不能据此解码 `[rotation angle variable]`、`[rotation angle]` 或其他 PTL 字段。来源：同一条件模型定义及 [91 客户端 token](91-pillar-effect-client.json) 未包含引擎读取实现的边界。
