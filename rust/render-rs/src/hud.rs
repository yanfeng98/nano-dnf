//! HUD, minimap, skill bar, loadout/progress panels, and overlays (`src/render.js`).

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::sprites::SpriteStore;
use crate::tables::rect_at;
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

    let hp_ratio = (state.player.hp / state.player.max_hp).clamp(0.0, 1.0) as f32;
    let mp_ratio = (state.player.mp / state.player.max_mp).clamp(0.0, 1.0) as f32;
    let xp_ratio = if state.player.xp_to_next > 0 {
        (state.player.xp as f32 / state.player.xp_to_next as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };

    // Bottom HUD bar & HP/MP orbs (use native hud.png when loaded, else procedural fallback)
    if let Some(hud_sheet) = sprites.get("hud") {
        c.draw_image(
            hud_sheet, 84, 0, 632, 91, 174.0, 456.0, 612.0, 84.0, false, 1.0, 0.0,
        );
        c.draw_image(
            hud_sheet, 200, 146, 108, 176, 120.0, 452.0, 54.0, 88.0, false, 1.0, 0.0,
        );
        c.draw_image(
            hud_sheet, 308, 146, 108, 176, 786.0, 452.0, 54.0, 88.0, false, 1.0, 0.0,
        );
        if hp_ratio > 0.0 {
            let crop_h = ((144.0 * hp_ratio).round() as u32).clamp(1, 144);
            let src_y = 144 - crop_h;
            let dst_h = 72.0 * (crop_h as f32 / 144.0);
            let dst_y = 460.0 + (72.0 - dst_h);
            c.draw_image(
                hud_sheet, 800, src_y, 76, crop_h, 128.0, dst_y, 38.0, dst_h, false, 1.0, 0.0,
            );
        }
        if mp_ratio > 0.0 {
            let crop_h = ((144.0 * mp_ratio).round() as u32).clamp(1, 144);
            let src_y = 144 - crop_h;
            let dst_h = 72.0 * (crop_h as f32 / 144.0);
            let dst_y = 460.0 + (72.0 - dst_h);
            c.draw_image(
                hud_sheet, 876, src_y, 76, crop_h, 794.0, dst_y, 38.0, dst_h, false, 1.0, 0.0,
            );
        }
        let xp_x = VIEW_LEFT as f32 + 132.0;
        let xp_w = 164.0f32;
        let xp_y = 485.0f32;
        c.fill_rect(xp_x, xp_y, xp_w, 8.0, Rgba::new(0, 0, 0, 204));
        if xp_ratio > 0.0 {
            c.draw_image(
                hud_sheet,
                0,
                146,
                200,
                3,
                xp_x,
                xp_y,
                xp_w * xp_ratio,
                8.0,
                false,
                1.0,
                0.0,
            );
        }
        c.stroke_rect(
            xp_x - 1.5,
            xp_y - 1.5,
            xp_w + 3.0,
            11.0,
            Rgba::new(226, 191, 114, 140),
            1.0,
        );
        c.fill_text(
            &format!("Lv.{}", state.player.level),
            200.0,
            493.0,
            11.0,
            Rgba::new(232, 236, 239, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    } else {
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
        c.fill_text(
            &format!("Lv.{}", state.player.level),
            left + 86.0,
            bottom - 52.0,
            14.0,
            Rgba::new(240, 210, 130, 255),
            TextAlign::Left,
            None,
        );
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
    }

    // Skill hotbar (6 slots: A S D F G H)
    let has_hud = sprites.get("hud").is_some();
    let start_x = if has_hud {
        VIEW_LEFT as f32 + 427.0
    } else {
        left + 150.0
    };
    let slot_y = if has_hud { 500.0 } else { bottom - 44.0 };
    let slot_pitch = if has_hud { 35.0 } else { 40.0 };
    let slot_w = if has_hud { 35.0 } else { 38.0 };
    let slot_h = if has_hud { 36.0 } else { 38.0 };
    let icon_size = if has_hud { 31.0 } else { 32.0 };
    let icon_off = if has_hud { 2.0 } else { 3.0 };
    for (idx, key_label) in SLOT_KEYS.iter().enumerate() {
        let sx = start_x + idx as f32 * slot_pitch;
        if let Some(hud_sheet) = sprites.get("hud") {
            c.draw_image(
                hud_sheet, 952, 0, 40, 39, sx, slot_y, slot_w, slot_h, false, 1.0, 0.0,
            );
        } else {
            c.fill_round_rect(sx, slot_y, slot_w, slot_h, 4.0, Rgba::new(22, 26, 36, 240));
            c.stroke_round_rect(
                sx,
                slot_y,
                slot_w,
                slot_h,
                4.0,
                Rgba::new(150, 128, 82, 210),
                1.0,
            );
        }
        if let Some(Some(skill_id)) = meta.loadout.get(idx) {
            let cd = state
                .player
                .skill_cooldowns
                .get(skill_id)
                .copied()
                .unwrap_or(0.0);
            let mp_cost = core_rs::TABLES
                .skills
                .get(skill_id)
                .map(|sk| sk.mp)
                .unwrap_or(0.0);
            let disabled = cd > 0.0 || state.player.mp < mp_cost;
            if let Some(s_idx) = core_rs::TABLES
                .skill_order
                .iter()
                .position(|id| id == skill_id)
            {
                let sheet_opt = if disabled {
                    sprites
                        .get("skillsDisabled")
                        .or_else(|| sprites.get("skills"))
                } else {
                    sprites.get("skills")
                };
                if let Some(sheet) = sheet_opt {
                    let iw = 32u32;
                    let ih = 32u32;
                    c.draw_image(
                        sheet,
                        (s_idx as u32) * iw,
                        0,
                        iw,
                        ih,
                        sx + icon_off,
                        slot_y + icon_off,
                        icon_size,
                        icon_size,
                        false,
                        1.0,
                        0.0,
                    );
                }
            }
            if cd > 0.0 {
                c.fill_rect(
                    sx + icon_off,
                    slot_y + icon_off,
                    icon_size,
                    icon_size,
                    Rgba::new(0, 0, 0, 165),
                );
                c.fill_text(
                    &format!("{cd:.1}"),
                    sx + slot_w * 0.5,
                    slot_y + slot_h * 0.65,
                    11.0,
                    Rgba::new(255, 225, 130, 255),
                    TextAlign::Center,
                    None,
                );
            }
        }
        c.fill_text(
            key_label,
            sx + 4.0,
            slot_y + 11.0,
            9.0,
            Rgba::new(230, 215, 170, 230),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    }

    // Awakening cut-in illustration (魔狱血刹)
    if let Some(sk_id) = state.player.skill_id.as_deref() {
        if matches!(sk_id, "hellbenter" | "hellbenterSlam") && state.player.skill_timer > 0.0 {
            if let Some(aw) = sprites.get("awakening") {
                let dur = core_rs::TABLES
                    .skills
                    .get(sk_id)
                    .map(|s| s.duration.max(0.2))
                    .unwrap_or(1.0);
                let elapsed = (dur - state.player.skill_timer).max(0.0);
                let alpha = if elapsed < 0.12 {
                    (elapsed / 0.12) as f32
                } else if elapsed > 0.88 {
                    (1.0 - (elapsed - 0.88) / 0.12).clamp(0.0, 1.0) as f32
                } else {
                    1.0
                };
                if alpha > 0.01 {
                    let dw = aw.width() as f32 * 0.5;
                    let dh = aw.height() as f32 * 0.5;
                    let slide = (elapsed / 0.12).min(1.0) as f32;
                    let dx = (VIEW_LEFT + VIEW_WIDTH) as f32 - dw * slide;
                    let dy = 500.0 - dh;
                    c.draw_image(
                        aw,
                        0,
                        0,
                        aw.width(),
                        aw.height(),
                        dx,
                        dy,
                        dw,
                        dh,
                        false,
                        alpha * 0.92,
                        0.0,
                    );
                }
            }
        }
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
        let has_portrait = sprites.get("portraits").is_some();
        let text_x = if has_portrait { tx + 40.0 } else { tx + 8.0 };
        c.fill_round_rect(tx, ty, bw + 60.0, 38.0, 4.0, Rgba::new(12, 16, 24, 215));
        if let Some(psheet) = sprites.get("portraits") {
            let pkey = if target.enemy.kind == "deepBoss" {
                "lugaruBoss"
            } else if target.enemy.behavior == "boss" {
                "boss"
            } else {
                target.enemy.kind.as_str()
            };
            if let Some([sx, sy, sw, sh]) =
                rect_at(&["PORTRAITS", pkey]).or_else(|| rect_at(&["PORTRAITS", "grunt"]))
            {
                c.draw_image(
                    psheet,
                    sx,
                    sy,
                    sw,
                    sh,
                    tx + 6.0,
                    ty + 6.0,
                    26.0,
                    26.0,
                    false,
                    1.0,
                    0.0,
                );
            }
            if let Some([fx, fy, fw, fh]) = rect_at(&["PORTRAITS", "frame"]) {
                c.draw_image(
                    psheet,
                    fx,
                    fy,
                    fw,
                    fh,
                    tx + 4.0,
                    ty + 4.0,
                    30.0,
                    30.0,
                    false,
                    1.0,
                    0.0,
                );
            }
        }
        c.fill_text(
            &format!(
                "{} Lv.{} {}",
                target.enemy.race, target.enemy.level, target.enemy.label
            ),
            text_x,
            ty + 15.0,
            12.0,
            Rgba::new(240, 225, 185, 255),
            TextAlign::Left,
            None,
        );
        c.fill_rect(
            text_x,
            ty + 22.0,
            bw + 12.0,
            8.0,
            Rgba::new(28, 22, 26, 255),
        );
        c.fill_rect(
            text_x,
            ty + 22.0,
            (bw + 12.0) * target.share as f32,
            8.0,
            if target.enemy.behavior == "boss" {
                Rgba::new(205, 42, 118, 255)
            } else {
                Rgba::new(220, 56, 52, 255)
            },
        );
    }

    // Log lines (bottom-left above HUD, hidden behind full-screen title)
    if !meta.title {
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

pub fn draw_minimap(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let Some(ref dun) = state.dungeon else {
        return;
    };
    let tile = 18.0;
    let mw = dun.cols as f32 * tile + 12.0;
    let mh = dun.rows as f32 * tile + 12.0;
    let mx = (VIEW_LEFT + VIEW_WIDTH) as f32 - mw - 12.0;
    let my = 12.0;
    let mm_sheet = sprites.get("minimap");
    if let Some(sh) = mm_sheet {
        // 9-slice minimap frame from minimap.png
        c.draw_image(sh, 190, 18, 5, 5, mx, my, 5.0, 5.0, false, 1.0, 0.0);
        c.draw_image(
            sh,
            199,
            18,
            18,
            5,
            mx + 5.0,
            my,
            mw - 9.0,
            5.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            221,
            18,
            4,
            5,
            mx + mw - 4.0,
            my,
            4.0,
            5.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            229,
            18,
            5,
            18,
            mx,
            my + 5.0,
            5.0,
            mh - 9.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            238,
            18,
            18,
            18,
            mx + 5.0,
            my + 5.0,
            mw - 9.0,
            mh - 9.0,
            false,
            0.88,
            0.0,
        );
        c.draw_image(
            sh,
            260,
            18,
            4,
            18,
            mx + mw - 4.0,
            my + 5.0,
            4.0,
            mh - 9.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            268,
            18,
            5,
            4,
            mx,
            my + mh - 4.0,
            5.0,
            4.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            277,
            18,
            18,
            4,
            mx + 5.0,
            my + mh - 4.0,
            mw - 9.0,
            4.0,
            false,
            1.0,
            0.0,
        );
        c.draw_image(
            sh,
            299,
            18,
            4,
            4,
            mx + mw - 4.0,
            my + mh - 4.0,
            4.0,
            4.0,
            false,
            1.0,
            0.0,
        );
    } else {
        c.fill_round_rect(mx, my, mw, mh, 5.0, Rgba::new(10, 14, 22, 200));
        c.stroke_round_rect(mx, my, mw, mh, 5.0, Rgba::new(165, 134, 72, 180), 1.0);
    }

    for (idx, cell) in dun.cells.iter().enumerate() {
        let cx = mx + 6.0 + cell.col as f32 * tile;
        let cy = my + 6.0 + cell.row as f32 * tile;
        if let Some(sh) = mm_sheet {
            if cell.seen {
                let tile_col = match cell.exits {
                    1 => 13,  // room:N
                    2 => 14,  // room:E
                    3 => 2,   // corr:NE
                    4 => 15,  // room:S
                    5 => 4,   // corr:NS
                    6 => 16,  // room:ES
                    7 => 6,   // corr:NES
                    8 => 17,  // room:W
                    9 => 18,  // room:NW
                    10 => 8,  // corr:EW
                    11 => 9,  // corr:NEW
                    12 => 10, // corr:SW
                    13 => 11, // corr:NSW
                    14 => 19, // room:ESW
                    15 => 20, // room:NESW
                    _ => 0,
                };
                c.draw_image(
                    sh,
                    tile_col * 18,
                    0,
                    18,
                    18,
                    cx,
                    cy,
                    tile,
                    tile,
                    false,
                    1.0,
                    0.0,
                );
            } else {
                c.fill_rect(cx, cy, tile, tile, Rgba::new(14, 18, 26, 230));
                if idx != dun.boss {
                    c.draw_image(sh, 22, 18, 18, 18, cx, cy, tile, tile, false, 0.9, 0.0);
                }
            }
            if idx == state.cell {
                c.draw_image(
                    sh,
                    64,
                    18,
                    14,
                    19,
                    cx + 2.0,
                    cy - 2.0,
                    14.0,
                    19.0,
                    false,
                    1.0,
                    0.0,
                );
            }
            if idx == dun.boss {
                c.draw_image(
                    sh,
                    44,
                    18,
                    16,
                    14,
                    cx + 1.0,
                    cy + 2.0,
                    16.0,
                    14.0,
                    false,
                    1.0,
                    0.0,
                );
            }
        } else {
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
}

pub fn draw_overlay(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &RenderMeta<'_>,
) {
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
        let stages = [
            ("mirkwood", "幽暗密林", 0u32),
            ("mirkwooddeep", "幽暗密林深处", 2u32),
        ];
        let bw = 168.0f32;
        let bh = 73.0f32;
        let gap_x = 14.0f32;
        let row_w = stages.len() as f32 * bw + (stages.len().saturating_sub(1) as f32) * gap_x;
        let row_x = (ARENA_WIDTH as f32 - row_w) * 0.5;
        let by = 150.0f32;
        for (i, (id, label, slot)) in stages.iter().enumerate() {
            let bx = row_x + i as f32 * (bw + gap_x);
            let card_cx = bx + bw * 0.5;
            let sel = meta.region_selected == *id;
            if let Some(rsh) = sprites.get("region") {
                let sx = (slot % 5) * 168;
                let sy = (slot / 5) * 73;
                c.draw_image(rsh, sx, sy, 168, 73, bx, by, bw, bh, false, 1.0, 0.0);
            } else {
                c.fill_round_rect(
                    bx,
                    by,
                    bw,
                    bh,
                    8.0,
                    if sel {
                        Rgba::new(42, 62, 92, 240)
                    } else {
                        Rgba::new(22, 28, 42, 220)
                    },
                );
            }
            c.stroke_round_rect(
                bx,
                by,
                bw,
                bh,
                6.0,
                if sel {
                    Rgba::new(245, 210, 110, 255)
                } else {
                    Rgba::new(90, 105, 130, 180)
                },
                if sel { 2.5 } else { 1.5 },
            );
            c.fill_text(
                label,
                card_cx,
                by + bh + 18.0,
                14.0,
                if sel {
                    Rgba::new(255, 226, 140, 255)
                } else {
                    Rgba::new(210, 220, 235, 220)
                },
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220)),
            );
        }
        c.fill_text(
            "←→ 切换 · Enter/Space 进入 · Esc 回城",
            cx,
            300.0,
            13.0,
            Rgba::new(190, 205, 225, 220),
            TextAlign::Center,
            None,
        );
        return;
    }

    if meta.title {
        c.fill_rect(
            0.0,
            0.0,
            ARENA_WIDTH as f32,
            ARENA_HEIGHT as f32,
            Rgba::new(5, 7, 14, 220),
        );
        if let Some(sh) = sprites.get("slayer") {
            let scale = 2.4f32;
            let dw = 208.0 * scale;
            let dh = 176.0 * scale;
            c.draw_image(sh, 0, 0, 208, 176, -30.0, 96.0, dw, dh, false, 0.95, 0.0);
        }
        let tx = 344.0f32;
        c.fill_text(
            "NANO",
            tx,
            108.0,
            50.0,
            Rgba::new(255, 240, 185, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
        c.fill_text(
            "DNF",
            tx,
            160.0,
            50.0,
            Rgba::new(217, 167, 67, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
        c.fill_text(
            "鬼剑士 · 地下城试炼",
            tx,
            196.0,
            20.0,
            Rgba::new(235, 240, 250, 255),
            TextAlign::Left,
            None,
        );
        let slot_names: Vec<&str> = (0..6)
            .map(|i| {
                meta.loadout
                    .get(i)
                    .and_then(|s| s.as_deref())
                    .and_then(|id| core_rs::TABLES.skills.get(id))
                    .map(|sk| sk.name.as_str())
                    .unwrap_or("空槽")
            })
            .collect();
        let row_3 = format!("{} / {} / {}", slot_names[0], slot_names[1], slot_names[2]);
        let row_4 = format!("{} / {} / {}", slot_names[3], slot_names[4], slot_names[5]);
        let rows = [
            ("← → ↑ ↓", "移动（↑ ↓ 走进 / 走出屏幕）"),
            ("C / Space", "跳跃"),
            ("X", "普攻（连续按键接续连击）"),
            ("A / S / D", row_3.as_str()),
            ("F / G / H", row_4.as_str()),
            ("Z / V", "上挑（空中为银光落刃） / 魔狱血刹"),
            ("B", "配置技能"),
            ("P / F3", "暂停 / 重开"),
        ];
        for (i, (k, desc)) in rows.iter().enumerate() {
            let y = 236.0 + i as f32 * 26.0;
            c.fill_text(
                k,
                tx,
                y,
                14.0,
                Rgba::new(240, 206, 122, 255),
                TextAlign::Left,
                None,
            );
            c.fill_text(
                desc,
                508.0,
                y,
                14.0,
                Rgba::new(230, 236, 246, 245),
                TextAlign::Left,
                None,
            );
        }
        c.fill_text(
            "清空房间后沿地图出口前进，击败关卡领主即可通关。",
            tx,
            462.0,
            14.0,
            Rgba::new(175, 188, 210, 225),
            TextAlign::Left,
            None,
        );
        c.fill_text(
            "按任意键开始",
            tx,
            496.0,
            16.0,
            Rgba::new(255, 214, 107, 255),
            TextAlign::Left,
            None,
        );
        c.fill_text(
            &format!("种子 #{}", meta.seed),
            ARENA_WIDTH as f32 - 60.0,
            132.0,
            17.0,
            Rgba::new(240, 206, 122, 255),
            TextAlign::Right,
            None,
        );
        if let Some(best) = records_rs::best_overall(meta.records, Some(meta.stage_id)) {
            c.fill_text(
                &format!(
                    "最佳通关: {} (Lv.{})",
                    format_seconds(best.seconds),
                    best.level
                ),
                ARENA_WIDTH as f32 - 60.0,
                160.0,
                14.0,
                Rgba::new(165, 180, 205, 230),
                TextAlign::Right,
                None,
            );
        }
        c.fill_text(
            "按 N 换一个种子",
            ARENA_WIDTH as f32 - 60.0,
            188.0,
            14.0,
            Rgba::new(220, 230, 245, 230),
            TextAlign::Right,
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
            "P : 暂停 · N : 换种子 · F2 : 音乐开关 · F3 : 重开 · F4 : 回城 · M : 静音",
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
                if let Some(res_sheet) = sprites.get("results") {
                    c.draw_image(
                        res_sheet,
                        0,
                        0,
                        420,
                        420,
                        cx - 210.0,
                        cy - 210.0,
                        420.0,
                        420.0,
                        false,
                        0.32,
                        (state.time * 0.35) as f32,
                    );
                }
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
                        if let Some(res_sheet) = sprites.get("results") {
                            c.draw_image(
                                res_sheet,
                                420,
                                0,
                                160,
                                142,
                                cx - 80.0,
                                cy - 86.0,
                                160.0,
                                142.0,
                                false,
                                1.0,
                                0.0,
                            );
                        }
                        c.fill_text(
                            "奖励宝箱开启中...",
                            cx,
                            cy + 84.0,
                            18.0,
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
                            let cw = 96.0f32;
                            let ch = 64.0f32;
                            let card_x = cx - 204.0 + i as f32 * 104.0;
                            let card_y = cy - 44.0;
                            let picked = snap.picked == Some(i);
                            if let Some(res_sheet) = sprites.get("results") {
                                c.draw_image(
                                    res_sheet, 2921, 0, 153, 97, card_x, card_y, cw, ch, false,
                                    1.0, 0.0,
                                );
                                if !snap.face_up {
                                    c.draw_image(
                                        res_sheet,
                                        3074,
                                        0,
                                        141,
                                        61,
                                        card_x + 4.0,
                                        card_y + 12.0,
                                        cw - 8.0,
                                        ch - 24.0,
                                        false,
                                        0.92,
                                        0.0,
                                    );
                                }
                                if picked {
                                    c.stroke_round_rect(
                                        card_x - 2.0,
                                        card_y - 2.0,
                                        cw + 4.0,
                                        ch + 4.0,
                                        4.0,
                                        Rgba::new(255, 220, 110, 255),
                                        2.5,
                                    );
                                }
                            } else {
                                c.fill_round_rect(
                                    card_x,
                                    card_y,
                                    cw,
                                    ch,
                                    6.0,
                                    if picked {
                                        Rgba::new(82, 68, 32, 245)
                                    } else {
                                        Rgba::new(26, 36, 56, 240)
                                    },
                                );
                                c.stroke_round_rect(
                                    card_x,
                                    card_y,
                                    cw,
                                    ch,
                                    6.0,
                                    if snap.face_up {
                                        Rgba::new(240, 202, 108, 255)
                                    } else {
                                        Rgba::new(86, 165, 215, 220)
                                    },
                                    2.0,
                                );
                            }
                            c.fill_text(
                                &(i + 1).to_string(),
                                card_x + cw * 0.5,
                                card_y + ch * 0.6,
                                18.0,
                                Rgba::new(255, 240, 195, 255),
                                TextAlign::Center,
                                Some(Rgba::new(0, 0, 0, 220)),
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
            "按 1-9 使用/穿戴 · Backspace 分解首件装备 · Esc 关闭",
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
            let prefix = if row < 9 {
                format!("[{}] ", row + 1)
            } else {
                "    ".to_string()
            };
            c.fill_text(
                &format!("{prefix}{slot}: {item_name}"),
                cx - 180.0,
                cy - 84.0 + row as f32 * 20.0,
                12.0,
                Rgba::new(230, 238, 250, 240),
                TextAlign::Left,
                None,
            );
        }
        c.fill_text(
            "按 1-9 卸下对应装备 · Esc 关闭",
            cx,
            cy + 125.0,
            11.0,
            Rgba::new(175, 190, 215, 220),
            TextAlign::Center,
            None,
        );
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
    } else if panel == ProgressPanelKind::Shop {
        for (row, it) in ITEMS
            .iter()
            .filter(|it| it.category != progress_rs::ItemCategory::Material)
            .enumerate()
        {
            let idx = row + 1;
            c.fill_text(
                &format!("[{idx}] {}  ({}G)", it.name, it.price),
                cx - 180.0,
                cy - 80.0 + row as f32 * 24.0,
                12.0,
                Rgba::new(230, 238, 250, 240),
                TextAlign::Left,
                None,
            );
        }
        c.fill_text(
            "按 1-8 购买 · Esc 关闭",
            cx,
            cy + 125.0,
            11.0,
            Rgba::new(175, 190, 215, 220),
            TextAlign::Center,
            None,
        );
    }
}

pub fn draw_loadout_panel(c: &mut Canvas<'_>, loadout: &[Option<String>], selected_slot: usize) {
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
    c.fill_text(
        "技能快捷栏配置",
        cx,
        cy - 118.0,
        16.0,
        Rgba::new(245, 210, 120, 255),
        TextAlign::Center,
        None,
    );
    let keys = ["A", "S", "D", "F", "G", "H"];
    for (i, key_label) in keys.iter().enumerate() {
        let skill_name = loadout
            .get(i)
            .and_then(|s| s.as_deref())
            .and_then(|id| {
                core_rs::TABLES
                    .skills
                    .get(id)
                    .map(|sk| sk.name.as_str())
                    .or(Some(id))
            })
            .unwrap_or("空");
        let is_sel = i == selected_slot;
        let marker = if is_sel { ">" } else { " " };
        let color = if is_sel {
            Rgba::new(255, 224, 130, 255)
        } else {
            Rgba::new(230, 238, 250, 240)
        };
        c.fill_text(
            &format!("{marker} [{}] {key_label} 键: {skill_name}", i + 1),
            cx - 170.0,
            cy - 76.0 + i as f32 * 30.0,
            13.0,
            color,
            TextAlign::Left,
            None,
        );
    }
    c.fill_text(
        "1-6 选槽 · ←/→ 切换技能 · B / Esc 关闭",
        cx,
        cy + 125.0,
        11.0,
        Rgba::new(175, 190, 215, 220),
        TextAlign::Center,
        None,
    );
}
