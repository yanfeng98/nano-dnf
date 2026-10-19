# 清房不再发强化卡；删卡的余量用基础数值补

**Status**: accepted（2026-10-18）。业主原话：

> 「我不想要通关每一个房间给的加buffer的奖励」

## 决定

**整条「每清一间房 → 三选一强化卡 → 加一种属性」的回路删掉。**

- 清房只做三件事：`room.cleared` / `cell.cleared`、`stats.rooms += 1`、门口亮起来。
  **门在清房那一刻就开**，没有「选完卡才放行」。
- 删掉 `UPGRADES`、`UPGRADE_ORDER`、`UPGRADES_PER_ROOM`、`rollUpgradeOptions`、
  `offerUpgrade`、`chooseUpgrade`、`state.upgradeChoice`、`player.upgradesTaken`。
- 选卡 UI、触屏/键盘 1–3、标题演示的选卡段、`upgrade` 提示、结算表里的「强化」行
  一起删；`hints.js` 的门提示只再看 `room.cleared`。
- **保留**：XP/等级、地上掉落与自动拾取、血之狂暴的血球、技能自己的 buff、
  失败/通关结算里其余各行。

它和等级是两套系统：卡只改 `attackBonus / maxHp / mpRegen / skillPower /
attackSpeed`，战斗逻辑从不读 `upgradesTaken`；`localStorage` 的战绩只存
时间/等级/通关次数，不存卡，所以**没有存档迁移**。

## 代价与补偿

- **同种子的后续随机流会变**：原来每间房发牌要消耗三次 `nextRandom`。没有保留
  「空抽三次」——那道抽签只服务于已经不存在的卡池，留着是替死代码维持轨迹。
- **难度上升**：同一套 bot 在四个种子上的承伤从 38–67 抬到 62–121 / 156–176。
  2026-10-18 实机证明里浏览器 bot 会在第 9 格或领主房被磨死。
- 因此补基础数值，**不是把卡偷偷加回来**：
  - 玩家基础生命 `120 → 176`（满级上限 `156 → 212`）；
  - 领主生命 `260 → 120`；
  - 领主近战 `18 → 13`（二阶段 ×1.2 后 15.6）、重踏 `20 → 15`；
  - 牛头怪（重甲）近战 `13 → 11`。
- 量法：浏览器证明键盘/触屏两条通路都能通关，领主战仍要躲重踏、贴脸仍会挨打；
  只是不再需要靠卡池的数值堆过去。

## 追记（2026-10-18）：领主倒下即通关，不用再清剩下的怪

业主复看：「dnf杀死领主后会有一个特效，并且就通关，不需要再次杀死其他任务」。

原来 `resolveRoom` 要等 Boss 房 `alive.length === 0` 才胜利，领主倒下后还得把
同房的小怪补掉。现在：

- 领主一 `dead`，`resolveRoom` 就把其余小怪从 `state.enemies` 里拿掉，只留领主；
- 领主的**白色剪影**继续演 `DEATH.lie + bossSmoke`，这期间世界照常推进；
- `state.victoryDelay` 到 0 才立 `victory`，所以死亡特效先被看见，再进胜利页；
- 这期间 `resolveRoom` 不放他出门（防止从 Boss 房门口走掉）。

总击杀数的口径跟着改了：**Boss 房只数领主**；其余走过的格子仍然要清光。浏览器证明
允许"领主房小怪在领主倒下前先被杀掉"的那一档（`expectedKills` 到 `maxKills`）。
