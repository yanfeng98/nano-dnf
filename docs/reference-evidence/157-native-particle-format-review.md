# 157：原生 PTL / ANI 格式的一手源码复核

调研日期：2026-11-16。范围：红、蓝哥布林投射物的格式语义。仅写本报告；未运行客户端、渲染、视频工具或测试，未改运行时。

## 结论

本轮找到独立 ANI 工具作者的原始解析器，但没有找到可核验的 DNF 原生粒子引擎实现或官方格式规范。因此**字节类型和字段名称有源码交叉支持，运动、发射、合成和继承行为仍未获证明**。不能把第三方读写器当成 Neople 引擎实现。[独立解析器原始源码](https://github.com/sjy0727/DNFToolKit/blob/c4d08cec8f675af1c8a640e27737502133eee49e/dnf-toolkit-pvf/src/main/java/com/dnf/toolkit/pvf/parser/AniParser.java)

## 已验证的窄事实

本仓库读取器把 property7 读成两个 float、8 读成 float、10 读成 byte、11 读成 unsigned short、12 读成 signed int；读取器逐帧返回显式属性，没有计算渲染状态或继承状态。这证明当前解析输出的结构，不能证明引擎执行语义。[本地代码](../../scripts/client_animation.py#L12-L36)

独立工具源码将 7 命名为 IMAGE RATE、8 为 IMAGE ROTATE、10 为 INTERPOLATION、11 为 GRAPHIC EFFECT、12 为 DELAY。其 Param 枚举把 8 读为 float、10 读为 byte、11 读为 short；但 7 使用两个 int，且二进制 convert 路径已被注释，活动 convert 处理文本。故它适合交叉核对字段名称，不足以推翻本地 float 解码，更不能证明 pivot、时间单位或渲染公式。[原始源码：类注释、convert 与 Param](https://github.com/sjy0727/DNFToolKit/blob/c4d08cec8f675af1c8a640e27737502133eee49e/dnf-toolkit-pvf/src/main/java/com/dnf/toolkit/pvf/parser/AniParser.java)

已有本地审计明确记录 hillgab 为 range combat、对象类型0、索引30047，关联 firemissilegerocenter.ptl；seagab 为 range combat、类型0、索引30057，关联 icemissile.ptl。它支持恢复远程分类和资源图入口，但不是引擎调用顺序的证明。[原始客户端抽取记录](156-followup-range-actors.json#L5-L23)

## 尚未解决的执行语义

下表的“未知”表示本轮所读源码没有对应执行逻辑，不能由字段英文名称推出答案；独立工具只解析字段，本地工具也只返回数据。[独立源码](https://github.com/sjy0727/DNFToolKit/blob/c4d08cec8f675af1c8a640e27737502133eee49e/dnf-toolkit-pvf/src/main/java/com/dnf/toolkit/pvf/parser/AniParser.java)、[本地读取器](../../scripts/client_animation.py#L4-L36)

| 问题 | 状态 / 实现边界 |
| --- | --- |
| PTL creation frequency 是毫秒间隔还是 Hz | 未知；不可仅凭 20/50 选择。 |
| life time 属于 emitter 还是 child | 未知；需要粒子创建及销毁实现。 |
| changing term / changing type | 未知；未取得枚举及更新公式。 |
| gravity、rotation angle 的轴、符号、单位 | 未知；字段值不能定义坐标系。 |
| ANI7 缩放 pivot 及 IMG offset 组合顺序 | 未知；需要渲染矩阵或原生校准。 |
| ANI8 单位、符号、朝向翻转顺序 | 未知；不可将单个石头的观测无限推广到粒子。 |
| ANI10 的插值对象、端点与环尾行为 | 未知；名称不足以证明线性插值。 |
| ANI11=2 的 blend equation | 未知；“看起来加色”不是源/目标混合因子证明。 |
| 缺失帧属性是否继承 | 未知；本地逐帧列表没有执行继承，不能据此判定引擎默认值。 |
| 隐形 FireMissile object 如何调用 PTL 子图 | 未知；资源关联不等于调度实现。 |
| OBJ int-data 40 / 0 / 0 | 未知；没有找到消费这些槽位的原生类代码。 |

## 校准约束及建议

既有石头分析明确以位移而非录屏时钟判断旋转方向；它使用原生位图模板和 Pillow angle 候选。这是单独的行为观测路径，应保留其适用范围，不应被解析器字段名覆盖。[测量方法](../../scripts/measure-reference-goblin-stone.py#L1-L7)、[模板构造](../../scripts/measure-reference-goblin-stone.py#L27-L35)、[测量输出](156-stone-measurement.json#L1-L23)

建议在实现前把上述未知项保留为显式假设，分别做原生可观测效果校准；尤其不要把火粒子的40.0直接解释成角度制，或因石头接近2π而宣称所有粒子角度字段共享一套单位。这是证据强度建议，不是已验证引擎事实。

## 检索范围

检索组合包括 `DNF ptl creation frequency`、`DNF changing term`、`DNF ANI parser`、`IMAGE ROTATE INTERPOLATION`。有效源码候选为上述 DNFToolKit；另命中知识库、论坛编辑器、脚本教程，未将二手解释作为执行语义证据。没有下载外部图片、二进制或工具。检索未命中不代表规范不存在；本报告不声称已穷尽所有公开代码。

## 有界追加检索：写入器与渲染器

追加检索明确针对 `github DNF ani viewer renderer IMAGE_ROTATE`、`github DNF animation editor GRAPHIC EFFECT`、`github DNF ani renderer ImageRate`、`github DNF AniEditor`、`github DNF ani2gif`、`github DNF animation LINEARDODGE`。本轮没有取得可以审阅旋转转换、变换矩阵、混合因子或继承逻辑的 DNF ANI 写入器/渲染器源码，前述未知项不变。

检索命中 [ANI2GIF 发布页](https://dnf.gamerba.com/thread-3242-1-1.html) 和 [梦太晓编辑器发布页](https://dnf.gamerba.com/thread-3183-1-1.html)，但它们属于论坛工具说明，不能替代原始渲染源代码；未下载或运行发布二进制，也未据这些页面推导任何公式。检索还命中 [ANI 示例知识库](https://github.com/heihuo000/DNF-PVF-file-Reference/blob/main/ANI%E6%96%87%E4%BB%B6%E7%9F%A5%E8%AF%86%E5%BA%93/README.md)，其示例与说明不提供原生引擎执行出处，故没有把其 LINEARDODGE 等解释升级为11=2的映射证明。

名称命中 `FredChen0001/fc_aniEditor` 经[固定树对象0a2a11392a4873738f67d9232c3261402021dc16](https://github.com/FredChen0001/fc_aniEditor/tree/0a2a11392a4873738f67d9232c3261402021dc16)文件清单核查，主要是模型、数据集与训练脚本，未成为本题有效来源。没有为凑足仓库数而将无关实现列作证据。即使之后找到第三方渲染器，也只能首先证明该实现选择，仍须与原生客户端行为独立对照。
