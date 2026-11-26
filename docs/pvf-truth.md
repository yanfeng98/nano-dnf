# Script_70.pvf 真值解包总表

> 由 `scripts/extract_pvf_truth.py` 直接从本地 `Script_70.pvf` 解包生成，同步嵌入 `rust/core-rs/src/pvf_truth.json`。
> 遵循 ADR 0074：参考录像可观测内容为第一铁律，底层怪物 AI、投射物粒子、支路房间与掉落参数由本表驱动。

## 1. 怪物 AI 与属性真值（`.mob`）

| Kind | PVF 源文件 | Sight (px) | Warlike | Attack Delay (ms) | Move Speed | Width (w,d) | Level | 掉落表 (`[item]`) |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| `grunt` | `monster/goblin/goblin.mob` | 300 | 60 | 1500 | 300/300 | 40×10 | 1–6 | 野生草莓(1000:50), 命运硬币(1047:200), 苎麻花叶(1004:100) |
| `coward` | `monster/goblin/cowardgoblin.mob` | 250 | 40 | 2000 | 600/600 | 40×10 | 1–99 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `caster` | `monster/goblin/goblinthrower.mob` | 300 | 30 | 3000 | 350/350 | 40×10 | 2–6 | 投掷石块(6003:300), 野生草莓(1000:50), 命运硬币(1047:200), 苎麻花叶(1004:100) |
| `burningThrower` | `monster/goblin/goblinthrower.mob` | 300 | 30 | 3000 | 350/350 | 40×10 | 2–6 | 投掷石块(6003:300), 野生草莓(1000:50), 命运硬币(1047:200), 苎麻花叶(1004:100) |
| `goblinRed` | `monster/goblin/hillgab.mob` | 300 | 30 | 3000 | 400/400 | 40×10 | 3–9 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `cursedRed` | `monster/goblin/flaghillgab.mob` | 350 | 30 | 3000 | 400/400 | 40×10 | 8–16 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `goblinBlue` | `monster/goblin/seagab.mob` | 300 | 30 | 3000 | 400/400 | 40×10 | 10–15 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `elite` | `monster/goblin/goblintaskmaster.mob` | 350 | 90 | 1500 | 500/500 | 40×10 | 7–12 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `deepElite` | `monster/goblin/goblintaskmaster.mob` | 350 | 90 | 1500 | 500/500 | 40×10 | 7–12 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `throwerElite` | `monster/goblin/goblinthrowertaskmaster.mob` | 350 | 30 | 4000 | 400/400 | 40×10 | 5–10 | 投掷石块(6003:100), 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `brute` | `monster/tau/tauarmy.mob` | 300 | 100 | 2000 | 400/400 | 60×20 | 4–9 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `boss` | `monster/tau/taubeast.mob` | 500 | 80 | 2000 | 600/600 | 60×20 | 4–20 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `cat` | `monster/lugaru/lugaru.mob` | 300 | 60 | 2000 | 600/600 | 40×10 | 9–14 | 越桔(1062:50), 魔力之花(1065:100), 命运硬币(1047:200) |
| `lugaruBoss` | `monster/lugaru/kurogaru.mob` | 300 | 70 | 2000 | 600/600 | 40×10 | 8–19 | 烤硬的黑面包(1001:50), 命运硬币(1047:200), 魔力之花(1065:100) |

## 2. 投射物与粒子真值（`.obj` / `.ptl` / `.atk`）

| ID | 名称 | VX | VZ | Gravity | Angle | Life (ms) | Landing | Piercing | SubObj | Reaction | 源文件 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |
| `30001` | 投掷石块 | 250 | 0 | 0 | 0° | 1200 | `vanish` | 0 | - | `damage` | `passiveobject/monster/goblin/throwstone.obj` |
| `30021` | 投掷十夫长炸弹 | 300 | 200 | 600 | 0° | 10000 | `stop` | 0 | 30022 | `none` | `passiveobject/monster/goblin/gobflybomb.obj` |
| `30022` | 炸弹爆破子对象 | 0 | 0 | 0 | 0° | 0 | `vanish` | 1000 | - | `down` | `passiveobject/monster/goblin/gobflybombsub.obj` |
| `30047` | 赤哥布林火弹 | 300 | 0 | 200 | 10° | 3000 | `stop` | 0 | - | `damage` | `passiveobject/monster/goblin/hillgabsizzle.obj` |
| `30057` | 青哥布林冰弹 | 200 | 0 | 0 | 0° | 1500 | `vanish` | 50 | - | `damage` | `passiveobject/monster/goblin/seagabicicle.obj` |

## 3. 副本成长参数与支路房间名册（`.dgn` / `.map`）

### `mirkwood` (`dungeon/act1/mirkwood.dgn`)
- 基准等级: **Lv.4**（准入 Lv.2），经验倍率: **1.0**，可破坏物掉落: 野生草莓(1000:833), 苎麻花叶(1004:833)

| 支路 `.map` | 怪物名册 |
| --- | --- |
| `map/mirkwood/202.map` | `grunt`×6 |
| `map/mirkwood/203.map` | `caster`×2, `goblinBlue`×1, `grunt`×4 |
| `map/mirkwood/207.map` | `caster`×1, `goblinBlue`×1, `goblinRed`×1, `grunt`×2 |
| `map/mirkwood/208.map` | `goblinBlue`×2, `grunt`×4 |
| `map/mirkwood/213.map` | `caster`×3, `goblinRed`×1, `grunt`×2 |
| `map/mirkwood/218.map` | `brute`×2, `caster`×2, `elite`×1, `goblinBlue`×1, `goblinRed`×1, `grunt`×2 |

### `mirkwooddeep` (`dungeon/act1/mirkwooddeep.dgn`)
- 基准等级: **Lv.6**（准入 Lv.3），经验倍率: **1.4**，可破坏物掉落: 野生草莓(1000:3000), 苎麻花叶(1004:1500)

| 支路 `.map` | 怪物名册 |
| --- | --- |
| `map/mirkwooddeep/402.map` | `elite`×2, `grunt`×5, `throwerElite`×2 |
| `map/mirkwooddeep/406.map` | `caster`×3, `elite`×1, `goblinRed`×3, `throwerElite`×2 |
| `map/mirkwooddeep/408.map` | `coward`×1, `goblinBlue`×2, `goblinRed`×3 |
| `map/mirkwooddeep/413.map` | `caster`×5, `cat`×3, `elite`×2 |
| `map/mirkwooddeep/419.map` | `coward`×1, `goblinBlue`×3, `goblinRed`×4 |
| `map/mirkwooddeep/425.map` | `cat`×6 |

