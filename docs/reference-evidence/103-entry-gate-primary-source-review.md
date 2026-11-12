# 103：入口门未清房回退的一手资料复核

调研日期：2026-11-13。目标范围：参考视频对应的早期 Act1 幽暗密林、约 3–9 级普通战斗房；问题是**当前房间仍有怪物时，能否经来时入口返回上一房间**，不是能否继续前往新房间，也不是退出整个地下城。

## 结论

本轮没有找到可以直接判定上述历史行为的官方指南、公告或手册。因此既不能把现有 `entryDoor` 回退特例标成“已由原版证实”，也不能仅凭视频入口栅栏可见而将其反转成“原版必然禁止回退”。本报告未提出运行时修改。

“清怪后才能进入下一房间”即使得到资料支持，也不自动回答“能否退回上一房间”：方向、房间状态和特殊副本规则都需要分别核实。当前外部资料没有补齐这个缺口。

## 本地直接证据与边界

[103-room24-west-gate-source.json](103-room24-west-gate-source.json) 保留了 `mirkwoodleftnormal.obj` 的字符串和整数数据。字符串同时引用 `GranFlorisLeftCloseDoor.ani` 和 `GranFlorisLeftOpenDoor.ani`；原始整数序列尚未具有可靠的引擎语义解释。因此它证明存在开、关视觉资源，不能独立证明由哪种房间状态触发，也不能证明角色碰撞或传送条件。

同一来源注明开门、淡出、灯光时序，以及入口通行与可见栅栏的关系尚未解决。参考视频的入口栅栏像素属于视觉证据；在没有角色实际尝试穿越入口的片段、同年代官方规则或已解释的客户端控制逻辑时，不升级为碰撞规则证据。[来源](103-room24-west-gate-source.json)

按文件名轻量检查 `/mnt/c/dnf/地下城与勇士` 的顶层和下一层，未发现独立的 HTML、CHM、PDF、README 或 help/guide 手册。仅命中两个 `sprite_interface_newstyle_windows_guide.NPK` 和 `Music/job_guide.ogg`。没有解包 NPK、扫描 PVF 或运行客户端。**这个有限目录检查不能证明客户端没有内嵌帮助。**

## 已检查的官方资料为何不能回答历史问题

| 第一方来源 | 可支持的窄结论 | 历史适用性限制 |
| --- | --- | --- |
| [Neople：Aeterna — Contents](https://www.dfoneople.com/news/updates/2242/Aeterna/Contents) | 页面明确讨论 Aeterna，并要求先完成 100 级 Act 任务；其 dungeon structure / clear conditions 是该内容的说明。 | 不是早期 3–9 级幽暗密林；不能将其清怪条件外推到早期入口门。 |
| [Neople：Additional Updates（3436）](https://www.dfoneople.com/news/updates/3436/Additional-Updates) | Mechanic 调整涉及跨房后上一房间机器人的清理；页面还讨论 105 级装备。 | 只证明该现代版本有跨房行为，未说明房间是否清空、通过哪扇门，更不证明早期入口可否回退。 |
| [Neople：Tower of Dazzlement — Overview](https://www.dfoneople.com/news/updates/1326/Overview) | 官方叙事描述进入塔后门被封住。 | 属于特定塔内容的叙事，不能作为普通地下城逐房门控规则。 |

以上官方页面只用于限定检索命中的适用范围；本报告没有用其中任一项判定目标入口规则。

## 检索记录与未决项

通过搜索引擎检索 Tencent `dnf.qq.com`、Nexon `df.nexon.com` / `dnf.nexon.com` 与 Neople `dfoneople.com`，组合“房间／消灭／门／返回上一个房间”、`room / monsters / doors / previous room / defeat all` 和韩文 `이전 방 / 몬스터를 모두 / 문`，并加入 2008、新手、地下城等历史限定。命中主要是现代特殊内容、无关页面和第三方攻略；未发现直接回答目标行为的一手页面。

尝试打开的基础指南候选地址 `https://www.dfoneople.com/gameinfo/guide/Basic-Information/Gameplay`、`https://dnf.qq.com/web2015/guide/guide.htm` 和 `https://df.nexon.com/guide?no=41` 未能经当前网页工具读取。它们只是失败的定位尝试，**不视为已读资料，也不推断其是否包含所需规则**。

搜索无结果和页面读取失败只描述本次检索的覆盖范围，不构成“官方从未说明”“旧版允许”或“旧版禁止”的证据。官方站内社区、官方合作专区和来源不明的怀旧服页面也不能仅凭域名、合作标识或“官网”标题被视作开发商规则文档；本轮未以此类内容作证明。

要解除未决状态，仍需同年代且明确区分返回入口与前进出口的第一方手册/公告，或参考视频中未清房实际跨回入口的连续操作证据，或经可靠解释的合法客户端传送条件。视觉门板状态与通行状态应继续分开记录。
