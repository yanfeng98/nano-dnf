//! HUD, minimap, skill bar, loadout/progress panels, and overlays (`src/render.js`).

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::sprites::SpriteStore;
use core_rs::constants::*;
use core_rs::dungeon::MINIMAP_DIR_E;
use core_rs::dungeon::MINIMAP_DIR_N;
use core_rs::dungeon::MINIMAP_DIR_S;
use core_rs::dungeon::MINIMAP_DIR_W;
use core_rs::types::*;
use loadout_rs::SLOT_KEYS;
use progress_rs::{ProgressProfile, ITEMS, QUESTS};
use records_rs::{format_seconds, RecordStore};
use reward_rs::{snapshot as reward_snapshot, RewardPhase, RewardState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressPanelKind {
    None,
    Bag,
    Quest,
    Equip,
    Shop,
}

pub struct RenderMeta<'a> {
    pub title: bool,
    pub attract: bool,
    pub paused: bool,
    pub show_help: bool,
    pub loadout: &'a [Option<String>],
    pub loadout_open: bool,
    pub progress_panel: ProgressPanelKind,
    pub progress: &'a ProgressProfile,
    pub records: &'a RecordStore,
    pub reward: Option<&'a RewardState>,
    pub region_open: bool,
    pub region_selected: &'a str,
    pub hint: Option<&'a str>,
    pub seed: u32,
    pub stage_id: &'a str,
}

pub fn render_loading(c: &mut Canvas<'_>, loaded: usize, total: usize) {
    let ratio = if total > 0 {
        (loaded as f32 / total as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let cx = (ARENA_WIDTH * 0.5) as f32;
    let cy = (ARENA_HEIGHT * 0.42) as f32;
    c.clear(Rgba::new(5, 7, 11, 255));
    c.fill_text(
        "NANO DNF",
        cx,
        cy - 18.0,
        46.0,
        Rgba::new(227, 191, 114, 255),
        TextAlign::Center,
        None,
    );
    c.fill_text(
        "鬼剑士 · 地下城试炼",
        cx,
        cy + 14.0,
        15.0,
        Rgba::new(232, 220, 190, 190),
        TextAlign::Center,
        None,
    );
    let bar_w = 300.0;
    let bar_h = 10.0;
    let bx = cx - bar_w * 0.5;
    let by = cy + 54.0;
    c.fill_round_rect(bx, by, bar_w, bar_h, 5.0, Rgba::new(16, 22, 30, 255));
    c.stroke_round_rect(
        bx,
        by,
        bar_w,
        bar_h,
        5.0,
        Rgba::new(226, 191, 114, 120),
        1.0,
    );
    if ratio > 0.0 {
        c.fill_round_rect(
            bx + 2.0,
            by + 2.0,
            ((bar_w - 4.0) * ratio).max(2.0),
            bar_h - 4.0,
            3.0,
            Rgba::new(186, 152, 82, 255),
        );
    }
}

pub fn draw_hud_video(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &RenderMeta<'_>,
) {
    let left = VIEW_LEFT as f32;
    let right = (VIEW_LEFT + VIEW_WIDTH) as f32;
    let bottom = ARENA_HEIGHT as f32;

    // Bottom HUD bar
    c.fill_rect(
        left,
        bottom - 76.0,
        VIEW_WIDTH as f32,
        76.0,
        Rgba::new(10, 12, 18, 225),
    );
    c.draw_line(
        left,
        bottom - 76.0,
        right,
        bottom - 76.0,
        Rgba::new(165, 134, 72, 200),
        1.5,
    );

    // HP & MP orbs
    let hp_ratio = (state.player.hp / state.player.max_hp).clamp(0.0, 1.0) as f32;
    let mp_ratio = (state.player.mp / state.player.max_mp).clamp(0.0, 1.0) as f32;
    draw_orb(
        c,
        left + 44.0,
        bottom - 38.0,
        28.0,
        hp_ratio,
        Rgba::new(210, 38, 46, 255),
        "HP",
    );
    draw_orb(
        c,
        right - 44.0,
        bottom - 38.0,
        28.0,
        mp_ratio,
        Rgba::new(42, 116, 225, 255),
        "MP",
    );

    // Level & XP bar
    c.fill_text(
        &format!("Lv.{}", state.player.level),
        left + 86.0,
        bottom - 52.0,
        14.0,
        Rgba::new(240, 210, 130, 255),
        TextAlign::Left,
        None,
    );
    let xp_ratio = if state.player.xp_to_next > 0 {
        (state.player.xp as f32 / state.player.xp_to_next as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    c.fill_rect(
        left + 86.0,
        bottom - 16.0,
        VIEW_WIDTH as f32 - 172.0,
        6.0,
        Rgba::new(24, 28, 36, 255),
    );
    c.fill_rect(
        left + 86.0,
        bottom - 16.0,
        (VIEW_WIDTH as f32 - 172.0) * xp_ratio,
        6.0,
        Rgba::new(125, 225, 110, 255),
    );

    // Skill hotbar (6 slots: A S D F G H + V)
    let start_x = left + 150.0;
    let slot_y = bottom - 64.0;
    for (idx, key_label) in SLOT_KEYS.iter().enumerate() {
        let sx = start_x + idx as f32 * 44.0;
        c.fill_round_rect(sx, slot_y, 38.0, 38.0, 4.0, Rgba::new(22, 26, 36, 240));
        c.stroke_round_rect(
            sx,
            slot_y,
            38.0,
            38.0,
            4.0,
            Rgba::new(150, 128, 82, 210),
            1.0,
        );
        if let Some(Some(skill_id)) = meta.loadout.get(idx) {
            if let Some(s_idx) = core_rs::TABLES
                .skill_order
                .iter()
                .position(|id| id == skill_id)
            {
                if let Some(sheet) = sprites.get("skills") {
                    let iw = 32u32;
                    let ih = 32u32;
                    c.draw_image(
                        sheet,
                        (s_idx as u32) * iw,
                        0,
                        iw,
                        ih,
                        sx + 3.0,
                        slot_y + 3.0,
                        32.0,
                        32.0,
                        false,
                        1.0,
                        0.0,
                    );
                }
            }
            let cd = state
                .player
                .skill_cooldowns
                .get(skill_id)
                .copied()
                .unwrap_or(0.0);
            if cd > 0.0 {
                c.fill_rect(sx + 2.0, slot_y + 2.0, 34.0, 34.0, Rgba::new(0, 0, 0, 165));
                c.fill_text(
                    &format!("{cd:.1}"),
                    sx + 19.0,
                    slot_y + 24.0,
                    12.0,
                    Rgba::new(255, 225, 130, 255),
                    TextAlign::Center,
                    None,
                );
            }
        }
        c.fill_text(
            key_label,
            sx + 5.0,
            slot_y + 12.0,
            10.0,
            Rgba::new(230, 215, 170, 230),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    }

    // Current target panel (top-left)
    if let Some(ref target) = state.target {
        let tx = left + 14.0;
        let ty = 14.0;
        let bw = if target.enemy.behavior == "boss" {
            260.0
        } else {
            180.0
        };
        c.fill_round_rect(tx, ty, bw + 44.0, 38.0, 4.0, Rgba::new(12, 16, 24, 215));
        c.fill_text(
            &format!(
                "{} Lv.{} {}",
                target.enemy.race, target.enemy.level, target.enemy.label
            ),
            tx + 8.0,
            ty + 15.0,
            12.0,
            Rgba::new(240, 225, 185, 255),
            TextAlign::Left,
            None,
        );
        c.fill_rect(
            tx + 8.0,
            ty + 22.0,
            bw + 28.0,
            8.0,
            Rgba::new(28, 22, 26, 255),
        );
        c.fill_rect(
            tx + 8.0,
            ty + 22.0,
            (bw + 28.0) * target.share as f32,
            8.0,
            if target.enemy.behavior == "boss" {
                Rgba::new(205, 42, 118, 255)
            } else {
                Rgba::new(220, 56, 52, 255)
            },
        );
    }

    // Log lines (bottom-left above HUD)
    for (i, entry) in state.log.iter().enumerate() {
        let col = match entry.tone.as_str() {
            "gold" => Rgba::new(245, 205, 85, 240),
            "cyan" => Rgba::new(92, 224, 245, 240),
            _ => Rgba::new(232, 238, 248, 230),
        };
        c.fill_text(
            &entry.text,
            left + 12.0,
            bottom - 92.0 - (state.log.len() - 1 - i) as f32 * 16.0,
            11.0,
            col,
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    }

    // Hint bar
    if let Some(hint_text) = meta.hint {
        c.fill_round_rect(
            left + 140.0,
            bottom - 110.0,
            VIEW_WIDTH as f32 - 280.0,
            24.0,
            6.0,
            Rgba::new(12, 18, 28, 215),
        );
        c.fill_text(
            hint_text,
            (VIEW_LEFT + VIEW_WIDTH * 0.5) as f32,
            bottom - 94.0,
            12.0,
            Rgba::new(250, 224, 145, 255),
            TextAlign::Center,
            None,
        );
    }
}

fn draw_orb(c: &mut Canvas<'_>, cx: f32, cy: f32, r: f32, ratio: f32, col: Rgba, label: &str) {
    c.fill_ellipse(cx, cy, r, r, Rgba::new(18, 20, 28, 240));
    if ratio > 0.0 {
        let fill_r = r * ratio.sqrt();
        c.fill_ellipse(cx, cy + (r - fill_r) * 0.4, fill_r, fill_r, col);
    }
    c.stroke_ellipse(cx, cy, r, r, Rgba::new(190, 158, 90, 230), 2.0);
    c.fill_text(
        label,
        cx,
        cy + 5.0,
        11.0,
        Rgba::new(255, 255, 255, 230),
        TextAlign::Center,
        Some(Rgba::new(0, 0, 0, 200)),
    );
}

pub fn draw_minimap(c: &mut Canvas<'_>, state: &State) {
    let Some(ref dun) = state.dungeon else {
        return;
    };
    let tile = 16.0;
    let mw = dun.cols as f32 * tile + 12.0;
    let mh = dun.rows as f32 * tile + 12.0;
    let mx = (VIEW_LEFT + VIEW_WIDTH) as f32 - mw - 12.0;
    let my = 12.0;
    c.fill_round_rect(mx, my, mw, mh, 5.0, Rgba::new(10, 14, 22, 200));
    c.stroke_round_rect(mx, my, mw, mh, 5.0, Rgba::new(165, 134, 72, 180), 1.0);

    for (idx, cell) in dun.cells.iter().enumerate() {
        let cx = mx + 6.0 + cell.col as f32 * tile;
        let cy = my + 6.0 + cell.row as f32 * tile;
        let fill = if idx == state.cell {
            Rgba::new(86, 178, 245, 245)
        } else if cell.cleared {
            Rgba::new(62, 128, 86, 220)
        } else if cell.seen {
            Rgba::new(72, 82, 104, 220)
        } else {
            Rgba::new(26, 30, 42, 200)
        };
        c.fill_rect(cx + 2.0, cy + 2.0, tile - 4.0, tile - 4.0, fill);
        if (cell.exits & MINIMAP_DIR_E) != 0 {
            c.fill_rect(
                cx + tile - 2.0,
                cy + tile * 0.4,
                4.0,
                3.0,
                Rgba::new(180, 180, 200, 180),
            );
        }
        if (cell.exits & MINIMAP_DIR_W) != 0 {
            c.fill_rect(
                cx - 2.0,
                cy + tile * 0.4,
                4.0,
                3.0,
                Rgba::new(180, 180, 200, 180),
            );
        }
        if (cell.exits & MINIMAP_DIR_N) != 0 {
            c.fill_rect(
                cx + tile * 0.4,
                cy - 2.0,
                3.0,
                4.0,
                Rgba::new(180, 180, 200, 180),
            );
        }
        if (cell.exits & MINIMAP_DIR_S) != 0 {
            c.fill_rect(
                cx + tile * 0.4,
                cy + tile - 2.0,
                3.0,
                4.0,
                Rgba::new(180, 180, 200, 180),
            );
        }
        if idx == dun.boss {
            c.fill_ellipse(
                cx + tile * 0.5,
                cy + tile * 0.5,
                3.5,
                3.5,
                Rgba::new(235, 64, 64, 255),
            );
        }
    }
}

pub fn draw_overlay(c: &mut Canvas<'_>, state: &State, meta: &RenderMeta<'_>) {
    let cx = (VIEW_LEFT + VIEW_WIDTH * 0.5) as f32;
    let cy = (ARENA_HEIGHT * 0.5) as f32;

    if meta.region_open {
        c.fill_rect(
            VIEW_LEFT as f32,
            0.0,
            VIEW_WIDTH as f32,
            ARENA_HEIGHT as f32,
            Rgba::new(8, 12, 20, 235),
        );
        c.fill_text(
            "格兰之森 · 选择地下城",
            cx,
            64.0,
            24.0,
            Rgba::new(240, 206, 122, 255),
            TextAlign::Center,
            None,
        );
        let stages = [("mirkwood", "幽暗密林"), ("mirkwooddeep", "幽暗密林深处")];
        for (i, (id, label)) in stages.iter().enumerate() {
            let bx = cx - 150.0;
            let by = 140.0 + i as f32 * 86.0;
            let sel = meta.region_selected == *id;
            c.fill_round_rect(
                bx,
                by,
                300.0,
                64.0,
                8.0,
                if sel {
                    Rgba::new(42, 62, 92, 240)
                } else {
                    Rgba::new(22, 28, 42, 220)
                },
            );
            c.stroke_round_rect(
                bx,
                by,
                300.0,
                64.0,
                8.0,
                if sel {
                    Rgba::new(235, 195, 105, 255)
                } else {
                    Rgba::new(90, 105, 130, 180)
                },
                2.0,
            );
            c.fill_text(
                label,
                cx,
                by + 38.0,
                18.0,
                Rgba::new(240, 245, 255, 255),
                TextAlign::Center,
                None,
            );
        }
        c.fill_text(
            "↑↓ 切换 · Enter/Space 进入 · Esc 回城",
            cx,
            360.0,
            13.0,
            Rgba::new(190, 205, 225, 220),
            TextAlign::Center,
            None,
        );
        return;
    }

    if meta.title {
        c.fill_rect(
            VIEW_LEFT as f32,
            0.0,
            VIEW_WIDTH as f32,
            ARENA_HEIGHT as f32,
            Rgba::new(6, 10, 18, 130),
        );
        c.fill_text(
            "NANO DNF",
            cx,
            180.0,
            48.0,
            Rgba::new(240, 204, 120, 255),
            TextAlign::Center,
            Some(Rgba::new(0, 0, 0, 220)),
        );
        c.fill_text(
            "鬼剑士 · 格兰之森试炼 (Rust 原生版)",
            cx,
            214.0,
            16.0,
            Rgba::new(230, 238, 250, 240),
            TextAlign::Center,
            None,
        );
        if let Some(best) = records_rs::best_overall(meta.records, Some(meta.stage_id)) {
            c.fill_text(
                &format!(
                    "最佳通关: {} (Lv.{})",
                    format_seconds(best.seconds),
                    best.level
                ),
                cx,
                252.0,
                14.0,
                Rgba::new(135, 228, 175, 255),
                TextAlign::Center,
                None,
            );
        }
        c.fill_text(
            "按任意键开始游戏",
            cx,
            340.0,
            18.0,
            Rgba::new(255, 232, 160, 255),
            TextAlign::Center,
            None,
        );
        return;
    }

    if meta.show_help {
        c.fill_round_rect(
            cx - 260.0,
            cy - 160.0,
            520.0,
            320.0,
            10.0,
            Rgba::new(10, 14, 24, 240),
        );
        c.stroke_round_rect(
            cx - 260.0,
            cy - 160.0,
            520.0,
            320.0,
            10.0,
            Rgba::new(220, 186, 108, 220),
            1.5,
        );
        let lines = [
            "操作说明",
            "← → ↑ ↓ : 移动",
            "C / Space : 跳跃 (空中 Z 银光落刃)",
            "X : 三段普攻",
            "A S D F G H : 技能栏 · Z : 上挑 · V : 觉醒(魔狱血刹)",
            "P : 暂停 · N : 换种子 · F3 : 重开 · F4 : 回城 · M : 静音",
            "按 F1 或 Esc 关闭",
        ];
        for (i, line) in lines.iter().enumerate() {
            c.fill_text(
                line,
                cx,
                cy - 120.0 + i as f32 * 36.0,
                14.0,
                Rgba::new(235, 240, 250, 255),
                TextAlign::Center,
                None,
            );
        }
        return;
    }

    if meta.paused {
        c.fill_round_rect(
            cx - 180.0,
            cy - 120.0,
            360.0,
            240.0,
            10.0,
            Rgba::new(10, 14, 24, 235),
        );
        c.stroke_round_rect(
            cx - 180.0,
            cy - 120.0,
            360.0,
            240.0,
            10.0,
            Rgba::new(220, 186, 108, 220),
            1.5,
        );
        c.fill_text(
            "游戏暂停",
            cx,
            cy - 70.0,
            22.0,
            Rgba::new(240, 206, 122, 255),
            TextAlign::Center,
            None,
        );
        c.fill_text(
            &format!(
                "用时: {} · 击杀: {}",
                format_seconds(state.time),
                state.stats.kills
            ),
            cx,
            cy - 20.0,
            14.0,
            Rgba::new(225, 235, 245, 240),
            TextAlign::Center,
            None,
        );
        c.fill_text(
            "P 继续 · F3 重开 · F4 回城",
            cx,
            cy + 50.0,
            13.0,
            Rgba::new(190, 205, 225, 220),
            TextAlign::Center,
            None,
        );
        return;
    }

    if state.defeat {
        c.fill_round_rect(
            cx - 190.0,
            cy - 110.0,
            380.0,
            220.0,
            10.0,
            Rgba::new(18, 10, 14, 235),
        );
        c.fill_text(
            "挑战失败",
            cx,
            cy - 50.0,
            28.0,
            Rgba::new(245, 88, 88, 255),
            TextAlign::Center,
            None,
        );
        c.fill_text(
            "F3 重新挑战 · F4 返回城镇",
            cx,
            cy + 30.0,
            15.0,
            Rgba::new(235, 220, 220, 240),
            TextAlign::Center,
            None,
        );
        return;
    }

    if state.victory && !state.post_clear {
        if let Some(rw) = meta.reward {
            let snap = reward_snapshot(rw);
            if snap.phase != RewardPhase::Done {
                c.fill_round_rect(
                    cx - 240.0,
                    cy - 160.0,
                    480.0,
                    300.0,
                    10.0,
                    Rgba::new(10, 14, 24, 225),
                );
                c.stroke_round_rect(
                    cx - 240.0,
                    cy - 160.0,
                    480.0,
                    300.0,
                    10.0,
                    Rgba::new(220, 186, 108, 220),
                    1.5,
                );
                match snap.phase {
                    RewardPhase::Stats => {
                        c.fill_text(
                            "地下城通关！",
                            cx,
                            cy - 115.0,
                            22.0,
                            Rgba::new(245, 210, 120, 255),
                            TextAlign::Center,
                            None,
                        );
                        let rating = core_rs::combat::rating_of(state);
                        c.fill_text(
                            &format!(
                                "评级 {} ({}分) · 用时 {}",
                                rating.grade,
                                rating.score,
                                format_seconds(state.time)
                            ),
                            cx,
                            cy - 65.0,
                            16.0,
                            Rgba::new(235, 242, 252, 255),
                            TextAlign::Center,
                            None,
                        );
                    }
                    RewardPhase::Chest => {
                        c.fill_text(
                            "奖励宝箱开启中...",
                            cx,
                            cy,
                            20.0,
                            Rgba::new(245, 210, 120, 255),
                            TextAlign::Center,
                            None,
                        );
                    }
                    RewardPhase::Cards | RewardPhase::Reveal | RewardPhase::Fade => {
                        c.fill_text(
                            "请选择奖励卡牌 (按 1-4)",
                            cx,
                            cy - 115.0,
                            18.0,
                            Rgba::new(245, 210, 120, 255),
                            TextAlign::Center,
                            None,
                        );
                        for i in 0..4usize {
                            let card_x = cx - 180.0 + i as f32 * 96.0;
                            let picked = snap.picked == Some(i);
                            c.fill_round_rect(
                                card_x,
                                cy - 60.0,
                                76.0,
                                110.0,
                                6.0,
                                if picked {
                                    Rgba::new(82, 68, 32, 245)
                                } else {
                                    Rgba::new(26, 36, 56, 240)
                                },
                            );
                            c.stroke_round_rect(
                                card_x,
                                cy - 60.0,
                                76.0,
                                110.0,
                                6.0,
                                if snap.face_up {
                                    Rgba::new(240, 202, 108, 255)
                                } else {
                                    Rgba::new(86, 165, 215, 220)
                                },
                                2.0,
                            );
                            c.fill_text(
                                &(i + 1).to_string(),
                                card_x + 38.0,
                                cy,
                                20.0,
                                Rgba::new(240, 245, 255, 255),
                                TextAlign::Center,
                                None,
                            );
                        }
                        if snap.picked.is_some() {
                            c.fill_text(
                                &format!("获得 {} + {} 金币", snap.item, snap.gold),
                                cx,
                                cy + 95.0,
                                15.0,
                                Rgba::new(115, 245, 165, 255),
                                TextAlign::Center,
                                None,
                            );
                        }
                    }
                    RewardPhase::Done => {}
                }
            } else {
                c.fill_text(
                    "通关完成！按 F3 再来一局 · F4 回城",
                    cx,
                    cy,
                    18.0,
                    Rgba::new(245, 210, 120, 255),
                    TextAlign::Center,
                    Some(Rgba::new(0, 0, 0, 220)),
                );
            }
        }
    }

    if meta.progress_panel != ProgressPanelKind::None {
        draw_progress_panel(c, meta.progress_panel, meta.progress);
    }
}

pub fn draw_progress_panel(
    c: &mut Canvas<'_>,
    panel: ProgressPanelKind,
    progress: &ProgressProfile,
) {
    if panel == ProgressPanelKind::None {
        return;
    }
    let cx = ARENA_WIDTH as f32 * 0.5;
    let cy = ARENA_HEIGHT as f32 * 0.5;
    c.fill_round_rect(
        cx - 220.0,
        cy - 150.0,
        440.0,
        300.0,
        8.0,
        Rgba::new(12, 16, 26, 240),
    );
    c.stroke_round_rect(
        cx - 220.0,
        cy - 150.0,
        440.0,
        300.0,
        8.0,
        Rgba::new(210, 176, 100, 220),
        1.5,
    );
    let title_str = match panel {
        ProgressPanelKind::Bag => format!("背包 · 金币 {}", progress.gold),
        ProgressPanelKind::Quest => "任务列表".to_string(),
        ProgressPanelKind::Equip => "当前装备".to_string(),
        ProgressPanelKind::Shop => format!("商店 · 金币 {}", progress.gold),
        ProgressPanelKind::None => String::new(),
    };
    c.fill_text(
        &title_str,
        cx,
        cy - 118.0,
        16.0,
        Rgba::new(245, 210, 120, 255),
        TextAlign::Center,
        None,
    );
    if panel == ProgressPanelKind::Bag {
        let mut row = 0;
        for (id, &cnt) in &progress.items {
            if cnt == 0 {
                continue;
            }
            let name = ITEMS
                .iter()
                .find(|it| it.id == id)
                .map(|it| it.name)
                .unwrap_or(id);
            let idx = row + 1;
            c.fill_text(
                &format!("[{idx}] {name} x{cnt}"),
                cx - 180.0,
                cy - 80.0 + row as f32 * 24.0,
                13.0,
                Rgba::new(230, 238, 250, 240),
                TextAlign::Left,
                None,
            );
            row += 1;
        }
        c.fill_text(
            "按 1-9 使用药水或穿戴装备 · Esc 关闭",
            cx,
            cy + 125.0,
            11.0,
            Rgba::new(175, 190, 215, 220),
            TextAlign::Center,
            None,
        );
    } else if panel == ProgressPanelKind::Equip {
        for (row, (slot, item_opt)) in progress.equipment.iter().enumerate() {
            let item_name = item_opt
                .as_deref()
                .and_then(|id| ITEMS.iter().find(|it| it.id == id).map(|it| it.name))
                .unwrap_or("空");
            c.fill_text(
                &format!("{slot}: {item_name}"),
                cx - 180.0,
                cy - 80.0 + row as f32 * 22.0,
                12.0,
                Rgba::new(230, 238, 250, 240),
                TextAlign::Left,
                None,
            );
        }
    } else if panel == ProgressPanelKind::Quest {
        for (i, q) in QUESTS.iter().enumerate() {
            let qp = progress.quests.get(q.id);
            let prog = qp.map(|p| p.progress).unwrap_or(0);
            let tag = match qp.map(|p| (&p.state, p.done)) {
                Some((progress_rs::QuestState::TurnedIn, _)) => "[已完成]",
                Some((progress_rs::QuestState::Active, true)) => "[可交付]",
                Some((progress_rs::QuestState::Active, false)) => "[进行中]",
                _ => "[可接]",
            };
            let idx = i + 1;
            c.fill_text(
                &format!("[{idx}] {tag} {} ({prog}/{})", q.title, q.goal),
                cx - 190.0,
                cy - 80.0 + i as f32 * 30.0,
                12.0,
                Rgba::new(230, 238, 250, 240),
                TextAlign::Left,
                None,
            );
        }
        c.fill_text(
            "按 1-3 接取或交付任务 · Esc 关闭",
            cx,
            cy + 125.0,
            11.0,
            Rgba::new(175, 190, 215, 220),
            TextAlign::Center,
            None,
        );
    }
}
