//! Classic 60/70 800x600 bottom HUD renderer (`assets/hud-classic.png`, ADR 0074).
//!
//! All layout coordinates are defined in native 800x600 pixels and mapped to the
//! canvas logical coordinate space (`VIEW_LEFT..VIEW_LEFT+VIEW_WIDTH`, `0..ARENA_HEIGHT`)
//! via `NATIVE_TO_LOGICAL = 0.9`, so on an 800x600 buffer (`scale = 10/9`) every
//! sprite lands 1:1 on native pixels.

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::hud::RenderMeta;
use crate::sprites::SpriteStore;
use core_rs::constants::{PROG_MAX_LEVEL, VIEW_LEFT};
use core_rs::types::State;
use loadout_rs::SLOT_KEYS;

/// Logical units per native 800x600 pixel (`720 / 800 = 540 / 600 = 0.9`).
pub const NATIVE_TO_LOGICAL: f32 = 0.9;

/// Native 800x600 Y coordinate of the top of the 800x100 classic bottom HUD.
pub const HUD_TOP_Y: f32 = 500.0;
pub const HUD_NATIVE_W: f32 = 800.0;
pub const HUD_NATIVE_H: f32 = 100.0;

/// Native 800x600 `[x, y, w, h]` of the left HP vertical capsule liquid.
pub const HP_CAPSULE_RECT: [f32; 4] = [5.0, 514.0, 48.0, 83.0];
/// Native 800x600 `[x, y, w, h]` of the right MP vertical capsule liquid.
pub const MP_CAPSULE_RECT: [f32; 4] = [747.0, 514.0, 48.0, 83.0];
/// Native 800x600 `[x, y, w, h]` of the green XP bar track.
pub const XP_BAR_RECT: [f32; 4] = [147.0, 539.0, 183.0, 10.0];
/// Native 800x600 `[x, y, w, h]` of the `Lv. X` label box.
pub const LV_BOX_RECT: [f32; 4] = [86.0, 533.0, 52.0, 14.0];
/// Native 800x600 `[x, y, w, h]` of the central fatigue counter blue box.
pub const FATIGUE_BOX_RECT: [f32; 4] = [385.0, 584.0, 30.0, 11.0];

/// Native 800x600 `[x, y, w, h]` interiors of the 6 left consumable slots (`1..6`).
pub const CONSUMABLE_SLOT_RECTS: [[f32; 4]; 6] = [
    [95.0, 557.0, 35.0, 34.0],
    [133.0, 557.0, 36.0, 34.0],
    [172.0, 557.0, 36.0, 34.0],
    [211.0, 557.0, 35.0, 34.0],
    [249.0, 557.0, 36.0, 34.0],
    [288.0, 557.0, 36.0, 34.0],
];

/// Native 800x600 `[x, y, w, h]` interiors of the 6 right skill quickbar slots (`A..H`).
pub const SKILL_SLOT_RECTS: [[f32; 4]; 6] = [
    [476.0, 557.0, 36.0, 34.0],
    [515.0, 557.0, 35.0, 34.0],
    [553.0, 557.0, 36.0, 34.0],
    [592.0, 557.0, 36.0, 34.0],
    [631.0, 557.0, 35.0, 34.0],
    [669.0, 557.0, 36.0, 34.0],
];

// Sprite sheet source rects inside `assets/hud-classic.png` (800x200)
const SRC_BASE: [u32; 4] = [0, 0, 800, 100];
const SRC_HP_LIQUID: [u32; 4] = [0, 100, 48, 83];
const SRC_MP_LIQUID: [u32; 4] = [50, 100, 48, 83];
const SRC_XP_FILL: [u32; 4] = [100, 100, 183, 10];

/// Daily max fatigue points (classic DNF 60/70 cap).
const MAX_FATIGUE: u32 = 156;

#[inline]
pub fn native_x(nx: f32) -> f32 {
    VIEW_LEFT as f32 + nx * NATIVE_TO_LOGICAL
}

#[inline]
pub fn native_y(ny: f32) -> f32 {
    ny * NATIVE_TO_LOGICAL
}

#[inline]
pub fn native_size(n: f32) -> f32 {
    n * NATIVE_TO_LOGICAL
}

/// Draw the bottom HUD, using the classic 60/70 skin (`hudClassic`) when loaded
/// and falling back to a procedural bar only when assets are absent.
pub fn draw_bottom_hud(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &RenderMeta<'_>,
) {
    if !draw_classic_bottom_hud(c, state, sprites, meta) {
        draw_procedural_fallback(c, state);
    }
}

fn draw_procedural_fallback(c: &mut Canvas<'_>, state: &State) {
    let left = VIEW_LEFT as f32;
    let right = (VIEW_LEFT + core_rs::constants::VIEW_WIDTH) as f32;
    let bottom = core_rs::constants::ARENA_HEIGHT as f32;
    let hp_ratio = (state.player.hp / state.player.max_hp.max(1.0)).clamp(0.0, 1.0) as f32;
    let mp_ratio = (state.player.mp / state.player.max_mp.max(1.0)).clamp(0.0, 1.0) as f32;
    let xp_ratio = if state.player.xp_to_next > 0 {
        (state.player.xp as f32 / state.player.xp_to_next as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    c.fill_rect(
        left,
        bottom - 76.0,
        right - left,
        76.0,
        Rgba::new(10, 12, 18, 225),
    );
    c.fill_rect(
        left + 86.0,
        bottom - 16.0,
        (right - left - 172.0) * xp_ratio,
        6.0,
        Rgba::new(125, 225, 110, 255),
    );
    c.fill_rect(
        left + 14.0,
        bottom - 12.0 - 54.0 * hp_ratio,
        28.0,
        54.0 * hp_ratio,
        Rgba::new(210, 38, 46, 255),
    );
    c.fill_rect(
        right - 42.0,
        bottom - 12.0 - 54.0 * mp_ratio,
        28.0,
        54.0 * mp_ratio,
        Rgba::new(42, 116, 225, 255),
    );
}

/// Draw the classic 60/70 bottom HUD if `hudClassic` is loaded.
/// Returns `true` when drawn, or `false` if `hudClassic` is unavailable.
pub fn draw_classic_bottom_hud(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &RenderMeta<'_>,
) -> bool {
    let Some(sheet) = sprites.get("hudClassic") else {
        return false;
    };

    // 1. Base 800x100 classic HUD frame (bezel, central circular hub, quest/buff bar, sockets)
    c.draw_image(
        sheet,
        SRC_BASE[0],
        SRC_BASE[1],
        SRC_BASE[2],
        SRC_BASE[3],
        native_x(0.0),
        native_y(HUD_TOP_Y),
        native_size(HUD_NATIVE_W),
        native_size(HUD_NATIVE_H),
        false,
        1.0,
        0.0,
    );

    // 2. Vertical HP & MP capsule liquids (cropped bottom-up by ratio)
    let hp_ratio = if state.player.max_hp > 0.0 {
        (state.player.hp / state.player.max_hp).clamp(0.0, 1.0) as f32
    } else {
        0.0
    };
    let mp_ratio = if state.player.max_mp > 0.0 {
        (state.player.mp / state.player.max_mp).clamp(0.0, 1.0) as f32
    } else {
        0.0
    };
    draw_vertical_capsule(c, sheet, SRC_HP_LIQUID, HP_CAPSULE_RECT, hp_ratio);
    draw_vertical_capsule(c, sheet, SRC_MP_LIQUID, MP_CAPSULE_RECT, mp_ratio);

    // 3. Green XP bar fill + level-up full-bar pulse
    let xp_ratio = if state.player.xp_to_next > 0 {
        (state.player.xp as f32 / state.player.xp_to_next as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let flash_rem = state.xp_gauge_flash_until - state.time;
    let flashing = state.player.level < PROG_MAX_LEVEL && flash_rem > 0.0;
    let fill_ratio = if state.player.level >= PROG_MAX_LEVEL || flashing {
        1.0
    } else {
        xp_ratio
    };
    if fill_ratio > 0.0 {
        let crop_w = ((SRC_XP_FILL[2] as f32 * fill_ratio).round() as u32).clamp(1, SRC_XP_FILL[2]);
        let dst_w = XP_BAR_RECT[2] * (crop_w as f32 / SRC_XP_FILL[2] as f32);
        c.draw_image(
            sheet,
            SRC_XP_FILL[0],
            SRC_XP_FILL[1],
            crop_w,
            SRC_XP_FILL[3],
            native_x(XP_BAR_RECT[0]),
            native_y(XP_BAR_RECT[1]),
            native_size(dst_w),
            native_size(XP_BAR_RECT[3]),
            false,
            1.0,
            0.0,
        );
    }
    if flashing {
        let pulse_a = (0.18 + 0.16 * (flash_rem * std::f64::consts::PI * 8.0).cos()) as f32;
        c.fill_rect(
            native_x(XP_BAR_RECT[0]),
            native_y(XP_BAR_RECT[1]),
            native_size(XP_BAR_RECT[2]),
            native_size(XP_BAR_RECT[3]),
            Rgba::new(255, 255, 255, 255).with_alpha(pulse_a),
        );
    }

    // 4. Character level (`Lv. X`)
    c.fill_text(
        &format!("Lv. {}", state.player.level),
        native_x(LV_BOX_RECT[0] + 4.0),
        native_y(LV_BOX_RECT[1] + 11.0),
        native_size(11.5),
        Rgba::new(236, 238, 240, 255),
        TextAlign::Left,
        Some(Rgba::new(0, 0, 0, 230)),
    );

    // 5. Central fatigue counter
    let visited = state
        .dungeon
        .as_ref()
        .map(|d| d.cells.iter().filter(|cell| cell.seen).count() as u32)
        .unwrap_or(1);
    let fatigue = MAX_FATIGUE.saturating_sub(visited);
    c.fill_text(
        &fatigue.to_string(),
        native_x(FATIGUE_BOX_RECT[0] + FATIGUE_BOX_RECT[2] * 0.5),
        native_y(FATIGUE_BOX_RECT[1] + 9.5),
        native_size(10.5),
        Rgba::new(112, 214, 248, 255),
        TextAlign::Center,
        Some(Rgba::new(0, 12, 26, 220)),
    );

    // 6. Skill quickbar (6 slots: A S D F G H) with greyed cooldown/OOM & Lv.X rank badges
    draw_skill_quickbar(c, state, sprites, meta);

    true
}

fn draw_vertical_capsule(
    c: &mut Canvas<'_>,
    sheet: &tiny_skia::Pixmap,
    src: [u32; 4],
    dst: [f32; 4],
    ratio: f32,
) {
    if ratio <= 0.0 {
        return;
    }
    let crop_h = ((src[3] as f32 * ratio).round() as u32).clamp(1, src[3]);
    let src_y = src[1] + (src[3] - crop_h);
    let dst_h = dst[3] * (crop_h as f32 / src[3] as f32);
    let dst_y = dst[1] + (dst[3] - dst_h);
    c.draw_image(
        sheet,
        src[0],
        src_y,
        src[2],
        crop_h,
        native_x(dst[0]),
        native_y(dst_y),
        native_size(dst[2]),
        native_size(dst_h),
        false,
        1.0,
        0.0,
    );
}

fn draw_skill_quickbar(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &RenderMeta<'_>,
) {
    for (idx, _key_label) in SLOT_KEYS.iter().enumerate() {
        let slot = SKILL_SLOT_RECTS[idx];
        let Some(Some(skill_id)) = meta.loadout.get(idx) else {
            continue;
        };
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
                    native_x(slot[0]),
                    native_y(slot[1]),
                    native_size(slot[2]),
                    native_size(slot[3]),
                    false,
                    1.0,
                    0.0,
                );
            }
        }

        if cd > 0.0 {
            c.fill_rect(
                native_x(slot[0]),
                native_y(slot[1]),
                native_size(slot[2]),
                native_size(slot[3]),
                Rgba::new(0, 0, 0, 145),
            );
            c.fill_text(
                &format!("{cd:.1}"),
                native_x(slot[0] + slot[2] * 0.5),
                native_y(slot[1] + slot[3] * 0.68),
                native_size(11.0),
                Rgba::new(255, 225, 130, 255),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220)),
            );
        }

        if let Some(&rank) = state.player.skill_ranks.get(skill_id) {
            draw_skill_rank_badge(
                c,
                sprites,
                rank,
                slot[0] + slot[2] - 1.0,
                slot[1] + 2.0,
                disabled,
            );
        }
    }
}

/// Render `Lv.X` skill rank badge using `assets/skill-ranks.png` (220x24: gold row 0, grey row 12).
fn draw_skill_rank_badge(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    rank: u32,
    native_right: f32,
    native_top: f32,
    grey: bool,
) {
    let Some(sheet) = sprites.get("skillRanks") else {
        return;
    };
    if rank == 0 || rank > 99 {
        return;
    }
    const WIDTHS: [u32; 11] = [12, 8, 12, 12, 12, 12, 12, 12, 12, 12, 18];
    let mut glyphs = Vec::with_capacity(3);
    glyphs.push(10usize); // `Lv.` prefix
    if rank >= 10 {
        glyphs.push((rank / 10) as usize);
    }
    glyphs.push((rank % 10) as usize);

    let scale = 0.72f32;
    let total_w: f32 = glyphs.iter().map(|&g| WIDTHS[g] as f32 * scale).sum();
    let mut nx = native_right - total_w;
    let src_y = if grey { 12u32 } else { 0u32 };
    let dst_h = 11.0 * scale;

    for &g in &glyphs {
        let w = WIDTHS[g];
        let dw = w as f32 * scale;
        c.draw_image(
            sheet,
            (g as u32) * 20,
            src_y,
            w,
            11,
            native_x(nx),
            native_y(native_top),
            native_size(dw),
            native_size(dst_h),
            false,
            1.0,
            0.0,
        );
        nx += dw;
    }
}
