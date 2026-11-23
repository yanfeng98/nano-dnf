# nano-dnf

DNF 风格的 2D 横版动作地下城游戏，现已全面迁移为**纯 Rust 原生桌面端应用**（Windows 便携版 `nano-dnf.exe` + Linux 本地调试），告别浏览器 Canvas 2D 卡顿，提供稳定 60 FPS 固定步长手感与原生音频播放。

> 原先的浏览器 JS 前端（`src/`、`index.html`、`tests/`）已完成迁移并移除；历史开发切片、录像考据与 ADR 决策仍保留在 [docs/](docs/) 与 Git 历史中。

## 游戏特性

- **双阶段冒险流程**：标题自动演示（Attract Mode）→ 区域选择 → 城镇（自由走动、查看背包/装备/任务）→ 地下城战斗 → 通关翻牌结算。
- **两个完整副本**：
  - **幽暗密林（`mirkwood`）**：经典多房间地牢，含普通房、陷阱/塌陷机制与领主战。
  - **幽暗密林深处（`mirkwooddeep`）**：多分支布局、特殊房间近景/前景遮挡、十夫长与狂暴机制。
- **鬼剑士 / 狂战士战斗系统**：
  - 基础三段斩、跳斩、上挑、受击硬直、倒地与 17 个主动/增益技能（含血之狂暴开关、嗜魂封魔斩、怒气爆发、崩山裂地斩、魔狱血刹觉醒等）。
  - 支持固定种子复现（`DEFAULT_SEED`）与按种子/关卡记录历史最快通关成绩。
- **原生渲染与音频**：
  - 基于 `tiny-skia` + `fontdue` + `softbuffer` + `winit` 的 960×540 逻辑分辨率软件渲染器，窗口缩放自动保持 16:9 黑边等比居中。
  - Windows 端使用 `rodio`（WASAPI）播放原生 `.ogg` 背景音乐与战斗音效。
- **便携 JSON 存档**：
  - 通关记录、背包道具、装备槽位、任务进度与技能配置保存在可执行文件同级目录的 `nano-dnf-save.json`。

## 为什么采用 Rust 原生实现

- **消除浏览器 GC 与 Canvas 2D 卡顿**：Rust 无垃圾回收停顿；[render-rs](rust/render-rs) 直接在内存 `960×540` `Pixmap` 中完成 `tiny-skia` 像素合成并经 `softbuffer` 整帧提交，绕开 JS ↔ 浏览器绑定层的状态切换与重绘抖动。
- **贴图预解码与字形缓存**：启动时一次性完成 PNG 解码与预乘 RGBA 转换，配合 `fontdue` 字形缓存，避免战斗切图或中文文字绘制时出现帧时间尖峰。
- **原生控帧与 WASAPI 音频**：使用 `winit` 的 `ControlFlow::WaitUntil` 驱动固定 `60 Hz` 模拟步长，Windows 端通过 `rodio` 直连原生音频接口播放 `.ogg` BGM 与音效，不受浏览器节流限制。
- **零依赖分发与高可维护性**：编译为独立的 `nano-dnf.exe` 便携包，强类型编译期排错与模块化 crate 设计让后续扩展新副本、新技能及 1 秒级全量单测更加稳健。

## 操作按键

| 界面 | 按键 | 功能 |
| --- | --- | --- |
| **通用** | `M` | 静音 / 取消静音 |
| **标题界面** | 任意键 | 进入区域选择 |
| **区域选择** | `↑` / `↓` | 切换副本（幽暗密林 / 幽暗密林深处） |
| | `Enter` / `Space` | 进入选中副本 |
| | `Esc` | 进入城镇 |
| **城镇** | 方向键 | 移动角色 |
| | `Enter` / `Space` | 打开区域选择 |
| | `I` / `K` / `L` / `U` | 切换 背包 / 装备 / 任务 / 商店 面板 |
| | `B` | 打开/关闭技能快捷栏配置（`1`–`6` 选槽，`←` / `→` 切换技能） |
| | `1`–`9` / `1`–`3` | 背包使用/穿戴（`1`–`9`、`Backspace` 分解首件装备）、装备面板卸下（`1`–`9`）、商店购买（`1`–`8`）、任务接取/交付（`1`–`3`） |
| | `Esc` | 关闭当前面板；无面板时返回区域选择 |
| **地牢战斗** | 方向键 | 八向移动 |
| | `X` | 普通攻击 / 连击 |
| | `C` / `Space` | 跳跃 |
| | `A` `S` `D` `F` `G` `H` | 快捷栏技能 |
| | `Z` / `V` | 上挑（`upSlash`）/ 觉醒（`hellbenter`） |
| | `1`–`4` | 通关翻牌选择奖励卡片 |
| | `1`–`9` / `1`–`3` | 背包使用药水/穿戴（`1`–`9`、`Backspace` 分解首件装备）、装备面板卸下（`1`–`9`）、任务接取/交付（`1`–`3`） |
| | `B` | 暂停并打开技能快捷栏配置（`1`–`6` 选槽，`←` / `→` 切换技能） |
| | `Enter` | 通关后继续留房探索 |
| | `I` / `K` / `L` | 切换 背包 / 装备 / 任务 面板 |
| | `P` / `F1` | 暂停 / 帮助说明 |
| | `F3` / `N` / `F4` | 重开本局 / 换下一种子 / 返回城镇 |
| | `Esc` | 关闭帮助或面板 |

## 已知待完善项

- 原 JS 阶段遗留的录像还原差异（如部分投射物粒子/AI 时序、角色默认装扮外观、经验成长与升级表现、城镇/HUD/结算细节对齐等）与 Rust 桌面端真机实玩验收记录已整理在 [HANDOFF.md](HANDOFF.md)。

## 项目结构

```text
nano-dnf/
├── rust/                    # Rust Cargo 工作区
│   ├── core-rs/             # 核心模拟：房间布局、战斗、AI、17 技能与数值表
│   ├── render-rs/           # 960x540 软件渲染器（场景、精灵图集、HUD、面板）
│   ├── app/                 # 桌面主程序入口（winit + softbuffer + rodio + JSON 存档）
│   ├── attract-rs/          # 标题自动演示状态机（含 1800 帧等价性测试）
│   ├── hints-rs/            # 局内上下文提示选择器
│   ├── loadout-rs/          # 技能快捷栏配置
│   ├── music-rs/            # 关卡音轨选择与音符调度
│   ├── progress-rs/         # 金币、背包、装备与任务系统
│   ├── records-rs/          # 按种子/关卡记录最快通关
│   ├── reward-rs/           # 通关 4 选 1 翻牌奖励
│   ├── summary-rs/          # 结算战绩与配速摘要
│   ├── DECISIONS.md         # Rust 架构决策记录（ADR）
│   ├── GLOSSARY.md          # 术语对照
│   └── MAP.md               # 模块迁移映射
├── assets/                  # 精灵图集、背景图、OGG 音乐/音效与中文字体
├── docs/                    # 游戏设计约定、素材考据与历史 ADR
├── scripts/                 # 素材提取与辅助脚本（离线开发工具）
└── dist/                    # 本地打包输出目录（gitignored）
```

## 构建、测试与 Windows 打包

### 1. 运行格式检查、Clippy 与全部测试

```bash
cd rust
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### 2. 本地运行（Linux / Windows 原生）

在仓库根目录或已放置 `assets/` 的目录运行：

```bash
cargo run --manifest-path rust/Cargo.toml -p nano-dnf
```

### 3. 在 Linux 上交叉编译 Windows 可执行文件

可通过 `cargo-zigbuild` 从 Linux 交叉编译到 `x86_64-pc-windows-gnu`（无控制台黑框的 GUI 程序；需提前安装 `cargo-zigbuild`、`zig` 与 `x86_64-pc-windows-gnu` target）：

```bash
cd rust
cargo zigbuild --release --target x86_64-pc-windows-gnu -p nano-dnf
```

产物位于 `rust/target/x86_64-pc-windows-gnu/release/nano-dnf.exe`。将 `nano-dnf.exe` 与运行所需的 `assets/`（PNG 图集、`assets/music/*.ogg`、`assets/sfx/*.ogg`、`assets/font.ttf`）放在同一文件夹下即可在 Windows 上直接双击运行。
