//! Stage-clear results screen, rotating blue magic circle, and Exp breakdown (`src/render.js`).
//!
//! Sequence measured from V1 (`00001-幽暗密林.mp4`, 332–342s) and V2 (`00002-幽暗密林深处.mp4`, 387–397s):
//! 1. 0.00s..0.10s: Clear-room pause (no dark overlay, no magic circle, no stats panel).
//! 2. 0.10s..0.30s: Smooth dark-overlay + giant rotating additive blue magic circle fade-in.
//! 3. 0.50s..3.60s: Clean Chinese-only `战绩` panel (no Korean/English `result.img f0` label overlap),
//!    sequential row count-up (`总分`, `操作`, `技巧`, `被击数`), animated golden progress bars.
//! 4. 3.60s+: Zoom-in circular golden rank seal + additive cyan rune ring (no black square box).
//! 5. 4.20s+: Animated Exp breakdown (`基础`, `评分 30%`, `对应频道 5%` → stage total 2376 / 6318).

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::sprites::SpriteStore;
use core_rs::combat::rating_of;
use core_rs::constants::{ARENA_HEIGHT, VIEW_LEFT, VIEW_WIDTH};
use core_rs::types::State;
use tiny_skia::Pixmap;

/// Pause after boss defeat before the dark overlay and magic circle begin fading in (seconds).
pub const CLEAR_ROOM_PAUSE: f64 = 0.1;
/// Duration of the smooth dark-overlay and magic-circle fade-in (seconds).
pub const BACKDROP_FADE_IN: f64 = 0.2;

const UI_SCALE: f32 = 1.125;

// Native `results-reference.png` (8277×420) frame rectangles `[sx, sy, sw, sh]`.
const ART_MAGIC_CIRCLE: [u32; 4] = [0, 0, 420, 420];
const ART_STATS_PANEL: [u32; 4] = [4346, 0, 455, 190];
const ART_RANK_CIRCLE: [u32; 4] = [4801, 0, 227, 227];
const ART_RANK_BASE_X: u32 = 5028;
const ART_RANK_W: u32 = 141;
const ART_RANK_H: u32 = 142;
const ART_BAR_FILL: [u32; 4] = [6297, 0, 159, 18];
const ART_BAR_FRAME: [u32; 4] = [6456, 0, 163, 22];
const ART_SCORE_SLASH: [u32; 4] = [6619, 0, 32, 32];
const ART_STATS_PERCENT: [u32; 4] = [6651, 0, 15, 13];
const ART_STATS_MINUS: [u32; 4] = [6666, 0, 13, 9];
const ART_XP_PANEL: [u32; 4] = [7662, 0, 252, 199];
const ART_XP_SLOT_GLOW: [u32; 4] = [7914, 0, 116, 16];
const ART_XP_BAR: [u32; 4] = [8030, 0, 247, 29];

const DIGITS_TOTAL: [[u32; 4]; 10] = [
    [6679, 0, 32, 29],
    [6711, 0, 22, 29],
    [6733, 0, 34, 29],
    [6767, 0, 33, 29],
    [6800, 0, 34, 29],
    [6834, 0, 36, 29],
    [6870, 0, 33, 29],
    [6903, 0, 36, 29],
    [6939, 0, 33, 29],
    [6972, 0, 33, 29],
];

const DIGITS_GOLD: [[u32; 4]; 10] = [
    [7005, 0, 19, 17],
    [7024, 0, 14, 17],
    [7038, 0, 19, 17],
    [7057, 0, 19, 17],
    [7076, 0, 19, 17],
    [7095, 0, 20, 17],
    [7115, 0, 19, 17],
    [7134, 0, 21, 17],
    [7155, 0, 19, 17],
    [7174, 0, 19, 17],
];

const DIGITS_RED: [[u32; 4]; 10] = [
    [7193, 0, 19, 17],
    [7212, 0, 14, 17],
    [7226, 0, 19, 17],
    [7245, 0, 19, 17],
    [7264, 0, 19, 17],
    [7283, 0, 20, 17],
    [7303, 0, 19, 17],
    [7322, 0, 21, 17],
    [7343, 0, 19, 17],
    [7362, 0, 19, 17],
];

const DIGITS_PERCENT: [[u32; 4]; 10] = [
    [7381, 0, 15, 13],
    [7396, 0, 11, 13],
    [7407, 0, 16, 13],
    [7423, 0, 15, 13],
    [7438, 0, 15, 13],
    [7453, 0, 16, 13],
    [7469, 0, 15, 13],
    [7484, 0, 16, 13],
    [7500, 0, 15, 13],
    [7515, 0, 15, 13],
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DigitFamily {
    Total,
    Gold,
    Red,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpBreakdown {
    pub base: u32,
    pub rating_bonus: u32,
    pub channel_bonus: u32,
    pub shown_total: u32,
    pub rating_active: bool,
    pub channel_active: bool,
    pub credited: bool,
}

fn clamp01(v: f64) -> f32 {
    v.clamp(0.0, 1.0) as f32
}

fn beat_alpha(since: f64, at: f64) -> f32 {
    clamp01((since - at) / 0.3)
}

/// Computes the dark-overlay / magic-circle fade-in opacity after boss defeat:
/// 0.0 during the 0.1s clear-room pause, then linearly ramping 0.0 -> 1.0 over 0.2s.
pub fn backdrop_alpha(elapsed: f64) -> f32 {
    if elapsed < CLEAR_ROOM_PAUSE {
        0.0
    } else {
        clamp01((elapsed - CLEAR_ROOM_PAUSE) / BACKDROP_FADE_IN)
    }
}

/// Computes the sequential Exp breakdown values at results timestamp `t`.
pub fn compute_exp_breakdown(state: &State, t: f64) -> ExpBreakdown {
    let deep = state.stage_id == "mirkwooddeep";
    let (base, rating_bonus, channel_bonus) = if let Some(ref prof) = state.reference_profile {
        (prof.clear_base, prof.clear_rating, prof.clear_channel)
    } else if deep {
        (4680, 1404, 234)
    } else {
        (1760, 528, 88)
    };
    let rating_p = clamp01((t - 5.0) / 0.8) as f64;
    let channel_p = clamp01((t - 5.8) / 0.8) as f64;
    let shown_total = (f64::from(base)
        + f64::from(rating_bonus) * rating_p
        + f64::from(channel_bonus) * channel_p)
        .round() as u32;
    ExpBreakdown {
        base,
        rating_bonus,
        channel_bonus,
        shown_total,
        rating_active: t >= 5.0,
        channel_active: t >= 5.8,
        credited: state.clear_experience,
    }
}

/// Draws the post-clear dark dimmer + ambient glow + giant rotating additive blue magic circle.
/// Respects the 0.1s clear-room pause and 0.2s smooth fade-in.
pub fn draw_result_backdrop(c: &mut Canvas<'_>, sprites: &SpriteStore, elapsed: f64) {
    let alpha = backdrop_alpha(elapsed);
    if alpha <= 0.001 {
        return;
    }

    c.save();
    c.set_clip_rect(
        VIEW_LEFT as f32,
        0.0,
        VIEW_WIDTH as f32,
        ARENA_HEIGHT as f32,
    );
    c.fill_rect(
        VIEW_LEFT as f32,
        0.0,
        VIEW_WIDTH as f32,
        ARENA_HEIGHT as f32,
        Rgba::new(4, 9, 22, 168).with_alpha(alpha),
    );
    if let Some(ui) = sprites.get("ui") {
        c.draw_image_additive(
            ui,
            592,
            3480,
            800,
            600,
            VIEW_LEFT as f32,
            0.0,
            VIEW_WIDTH as f32,
            ARENA_HEIGHT as f32,
            false,
            0.85 * alpha,
            0.0,
        );
    }
    if let Some(res_sheet) = sprites.get("results") {
        // Measured from V1 343.5..354s & V2 397.5..401.5s: 1.125x (472.5px), CCW 2 deg/s, centered at (cx, 270).
        let cx = (VIEW_LEFT + VIEW_WIDTH * 0.5) as f32;
        let cy = 270.0f32;
        let diameter = ART_MAGIC_CIRCLE[2] as f32 * UI_SCALE;
        let half = diameter * 0.5;
        let angle_rad = -(elapsed.max(0.0) * 2.0 * std::f64::consts::PI / 180.0) as f32;
        c.draw_image_additive(
            res_sheet,
            ART_MAGIC_CIRCLE[0],
            ART_MAGIC_CIRCLE[1],
            ART_MAGIC_CIRCLE[2],
            ART_MAGIC_CIRCLE[3],
            cx - half,
            cy - half,
            diameter,
            diameter,
            false,
            alpha,
            angle_rad,
        );
    }
    c.restore();
}

/// Draws the clean Chinese-only `战绩` panel, sequential row count-up, golden bars,
/// bottom-left circular rank seal (with additive rune circle), and bottom-right Exp breakdown.
pub fn draw_recorded_stats(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    t: f64,
    has_reward_flow: bool,
) {
    let fade_in = backdrop_alpha(t);
    if fade_in <= 0.001 {
        return;
    }
    let fade_out = if has_reward_flow {
        clamp01((10.0 - t) / 0.7)
    } else {
        1.0
    };
    let panel_alpha = fade_in * fade_out;
    if panel_alpha <= 0.001 {
        return;
    }

    let left = VIEW_LEFT as f32;
    let rating = rating_of(state);
    let sheet = sprites.get("results");

    if let Some(res_sheet) = sheet {
        draw_clean_stats_panel(c, res_sheet, left, panel_alpha);
    } else {
        c.fill_round_rect(
            left + 104.0,
            68.0,
            512.0,
            214.0,
            8.0,
            Rgba::new(10, 14, 24, 225).with_alpha(panel_alpha),
        );
    }

    // Header "战绩"
    c.fill_text(
        "战绩",
        left + 345.0,
        53.0,
        23.0,
        Rgba::new(240, 215, 154, 255).with_alpha(panel_alpha),
        TextAlign::Center,
        Some(Rgba::new(11, 16, 27, 235).with_alpha(panel_alpha)),
    );

    // Clean Chinese-only row labels (no Korean/English overlap)
    let outline_dark = Some(Rgba::new(11, 16, 27, 235).with_alpha(panel_alpha));
    let label_color = Rgba::new(238, 241, 245, 255).with_alpha(panel_alpha);
    c.fill_text(
        "总分",
        left + 205.0,
        120.0,
        19.0,
        label_color,
        TextAlign::Right,
        outline_dark,
    );
    for (label, ly) in [("操作", 173.0f32), ("技巧", 211.0), ("被击数", 250.0)] {
        c.fill_text(
            label,
            left + 205.0,
            ly,
            17.0,
            label_color,
            TextAlign::Right,
            outline_dark,
        );
    }

    // Total score (t >= 0.5s)
    let total_alpha = panel_alpha * beat_alpha(t, 0.5);
    if total_alpha > 0.001 {
        let total_text = format!("{}/{}", rating.score, rating.max_score);
        if !sheet.is_some_and(|s| {
            draw_stats_number(
                c,
                s,
                &total_text,
                DigitFamily::Total,
                left + 417.125,
                94.75,
                TextAlign::Center,
                total_alpha,
            )
        }) {
            c.fill_text(
                &total_text,
                left + 417.125,
                123.0,
                28.0,
                Rgba::new(255, 255, 255, 255).with_alpha(total_alpha),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220).with_alpha(total_alpha)),
            );
        }
    }

    // Operation (t >= 1.1s) & Technique (t >= 1.9s) sequential count-up + golden progress bars
    let rows = [
        (rating.operation, rating.operation_points, 1.1f64, 154.0f32),
        (rating.technique, rating.technique_points, 1.9f64, 192.0f32),
    ];
    for (pct_target, pts_target, start_t, row_y) in rows {
        if t < start_t {
            continue;
        }
        let row_alpha = panel_alpha * beat_alpha(t, start_t);
        if row_alpha <= 0.001 {
            continue;
        }
        let progress = clamp01((t - start_t) / 0.6) as f64;
        let amount = (f64::from(pct_target) * progress).round() as u32;
        let points = (f64::from(pts_target) * progress).round() as u32;
        let pts_text = points.to_string();
        if !sheet.is_some_and(|s| {
            draw_stats_number(
                c,
                s,
                &pts_text,
                DigitFamily::Gold,
                left + 325.0,
                row_y - 1.0,
                TextAlign::Left,
                row_alpha,
            )
        }) {
            c.fill_text(
                &pts_text,
                left + 328.0,
                row_y + 17.0,
                18.0,
                Rgba::new(243, 215, 85, 255).with_alpha(row_alpha),
                TextAlign::Left,
                None,
            );
        }

        if let Some(res_sheet) = sheet {
            c.draw_image(
                res_sheet,
                ART_BAR_FRAME[0],
                ART_BAR_FRAME[1],
                ART_BAR_FRAME[2],
                ART_BAR_FRAME[3],
                left + 405.0,
                row_y,
                ART_BAR_FRAME[2] as f32 * UI_SCALE,
                ART_BAR_FRAME[3] as f32 * UI_SCALE,
                false,
                row_alpha,
                0.0,
            );
            let share = (amount as f32 / 100.0).clamp(0.0, 1.0);
            if share > 0.0 {
                let sw = ((ART_BAR_FILL[2] as f32) * share).round().max(1.0) as u32;
                c.draw_image(
                    res_sheet,
                    ART_BAR_FILL[0],
                    ART_BAR_FILL[1],
                    sw,
                    ART_BAR_FILL[3],
                    left + 407.25,
                    row_y + 2.25,
                    (ART_BAR_FILL[2] as f32 * UI_SCALE) * share,
                    ART_BAR_FILL[3] as f32 * UI_SCALE,
                    false,
                    row_alpha,
                    0.0,
                );
            }
        }

        let pct_text = format!("{amount}%");
        if !sheet.is_some_and(|s| {
            draw_stats_number(
                c,
                s,
                &pct_text,
                DigitFamily::Percent,
                left + 493.0,
                row_y + 4.0,
                TextAlign::Center,
                row_alpha,
            )
        }) {
            c.fill_text(
                &pct_text,
                left + 493.0,
                row_y + 18.0,
                14.0,
                Rgba::new(255, 255, 255, 255).with_alpha(row_alpha),
                TextAlign::Center,
                Some(Rgba::new(16, 16, 16, 235).with_alpha(row_alpha)),
            );
        }
    }

    // Hits taken (t >= 2.7s)
    if t >= 2.7 {
        let hits_alpha = panel_alpha * beat_alpha(t, 2.7);
        let hits_text = format!("-{}", rating.hits);
        if !sheet.is_some_and(|s| {
            draw_stats_number(
                c,
                s,
                &hits_text,
                DigitFamily::Red,
                left + 360.0,
                234.0,
                TextAlign::Right,
                hits_alpha,
            )
        }) {
            c.fill_text(
                &hits_text,
                left + 360.0,
                250.0,
                18.0,
                Rgba::new(255, 24, 16, 255).with_alpha(hits_alpha),
                TextAlign::Right,
                None,
            );
        }
    }

    // Circular rank seal + additive cyan rune circle (t >= 3.6s, bottom-left)
    if let Some(res_sheet) = sheet {
        if t >= 3.6 {
            let zoom = 1.0 + 0.5 * (1.0 - clamp01((t - 3.6) / 0.4));
            let grade_idx = match rating.grade.as_str() {
                "SSS" => 0,
                "SS" => 1,
                "S" => 2,
                "A" => 3,
                "B" => 4,
                "C" => 5,
                "D" => 6,
                "E" => 7,
                _ => 8,
            };
            let circle_alpha = panel_alpha * beat_alpha(t, 3.9);
            if circle_alpha > 0.001 {
                // Additive blending prevents the black square background of rankCircle from appearing.
                c.draw_image_additive(
                    res_sheet,
                    ART_RANK_CIRCLE[0],
                    ART_RANK_CIRCLE[1],
                    ART_RANK_CIRCLE[2],
                    ART_RANK_CIRCLE[3],
                    left + 81.0,
                    274.0,
                    ART_RANK_CIRCLE[2] as f32 * UI_SCALE,
                    ART_RANK_CIRCLE[3] as f32 * UI_SCALE,
                    false,
                    circle_alpha,
                    0.0,
                );
            }

            let seal_alpha = panel_alpha * beat_alpha(t, 3.6);
            if seal_alpha > 0.001 {
                let seal_w = ART_RANK_W as f32 * UI_SCALE * zoom;
                let seal_h = ART_RANK_H as f32 * UI_SCALE * zoom;
                let seal_cx = left + 208.3125;
                let seal_cy = 399.875;
                c.draw_image(
                    res_sheet,
                    ART_RANK_BASE_X + grade_idx * ART_RANK_W,
                    0,
                    ART_RANK_W,
                    ART_RANK_H,
                    seal_cx - seal_w * 0.5,
                    seal_cy - seal_h * 0.5,
                    seal_w,
                    seal_h,
                    false,
                    seal_alpha,
                    0.0,
                );
                c.fill_text(
                    "评分",
                    left + 266.0,
                    394.0,
                    20.0,
                    Rgba::new(255, 255, 255, 255).with_alpha(seal_alpha),
                    TextAlign::Left,
                    Some(Rgba::new(11, 16, 27, 235).with_alpha(seal_alpha)),
                );
            }
        }

        // Animated Exp breakdown table (t >= 4.2s, bottom-right)
        if t >= 4.2 {
            draw_exp_breakdown(c, state, res_sheet, left, t, panel_alpha);
        }
    }
}

/// Draws `statsPanel` (455×190 at `1.125x`) in 5 non-overlapping bands so that
/// the embedded Korean/English labels (`총점`, `Total`, `스타일`, `테크닉`, `피격횟수`)
/// are completely excluded without double-blending the semi-transparent background.
fn draw_clean_stats_panel(c: &mut Canvas<'_>, sheet: &Pixmap, left: f32, alpha: f32) {
    let ox = ART_STATS_PANEL[0];
    let px = left + 104.0;
    let py = 68.0;

    let blit_band = |c: &mut Canvas<'_>, sx: u32, sy: u32, sw: u32, sh: u32| {
        c.draw_image(
            sheet,
            ox + sx,
            sy,
            sw,
            sh,
            px + sx as f32 * UI_SCALE,
            py + sy as f32 * UI_SCALE,
            sw as f32 * UI_SCALE,
            sh as f32 * UI_SCALE,
            false,
            alpha,
            0.0,
        );
    };

    // Band 1: top border above Total box (sy = 0..15)
    blit_band(c, 0, 0, 455, 15);

    // Band 2: Total box row (sy = 15..61), excluding native x = 20..434
    blit_band(c, 0, 15, 20, 46);
    blit_band(c, 434, 15, 21, 46);
    // 9-slice wider blue-bordered Total box spanning native x = 20..434, y = 15..61
    let slice_sx = [76u32, 79, 431];
    let slice_sy = [15u32, 18, 58];
    let slice_sw = [3u32, 352, 3];
    let slice_sh = [3u32, 40, 3];
    let slice_dx = [
        px + 20.0 * UI_SCALE,
        px + 23.0 * UI_SCALE,
        px + 431.0 * UI_SCALE,
    ];
    let slice_dy = [
        py + 15.0 * UI_SCALE,
        py + 18.0 * UI_SCALE,
        py + 58.0 * UI_SCALE,
    ];
    let slice_dw = [3.0 * UI_SCALE, 408.0 * UI_SCALE, 3.0 * UI_SCALE];
    let slice_dh = [3.0 * UI_SCALE, 40.0 * UI_SCALE, 3.0 * UI_SCALE];
    for row in 0..3usize {
        for col in 0..3usize {
            let is_center = row == 1 && col == 1;
            let sx = ox + if is_center { 200 } else { slice_sx[col] };
            let sy = if is_center { 30 } else { slice_sy[row] };
            let sw = if is_center { 1 } else { slice_sw[col] };
            let sh = if is_center { 1 } else { slice_sh[row] };
            c.draw_image(
                sheet,
                sx,
                sy,
                sw,
                sh,
                slice_dx[col],
                slice_dy[row],
                slice_dw[col],
                slice_dh[row],
                false,
                alpha,
                0.0,
            );
        }
    }

    // Band 3: gap between Total box and Operation row (sy = 61..70)
    blit_band(c, 0, 61, 455, 9);

    // Band 4: Operation / Technique / Hits rows (sy = 70..165), excluding Korean labels x = 12..70
    blit_band(c, 0, 70, 12, 95);
    c.draw_image(
        sheet,
        ox + 10,
        80,
        1,
        1,
        px + 12.0 * UI_SCALE,
        py + 70.0 * UI_SCALE,
        58.0 * UI_SCALE,
        95.0 * UI_SCALE,
        false,
        alpha,
        0.0,
    );
    blit_band(c, 70, 70, 385, 95);

    // Band 5: bottom border below Hits row (sy = 165..190)
    blit_band(c, 0, 165, 455, 25);
}

fn draw_exp_breakdown(
    c: &mut Canvas<'_>,
    state: &State,
    sheet: &Pixmap,
    left: f32,
    t: f64,
    panel_alpha: f32,
) {
    let xp_alpha = panel_alpha * beat_alpha(t, 4.2);
    if xp_alpha <= 0.001 {
        return;
    }
    let exp = compute_exp_breakdown(state, t);

    c.draw_image(
        sheet,
        ART_XP_PANEL[0],
        ART_XP_PANEL[1],
        ART_XP_PANEL[2],
        ART_XP_PANEL[3],
        left + 325.0,
        282.0,
        ART_XP_PANEL[2] as f32 * UI_SCALE,
        ART_XP_PANEL[3] as f32 * UI_SCALE,
        false,
        xp_alpha,
        0.0,
    );

    let items: [(&str, usize, usize, u32, bool); 8] = [
        ("评分", 0, 0, exp.rating_bonus, exp.rating_active),
        ("组队", 1, 0, 0, false),
        ("师父", 0, 1, 0, false),
        ("装扮", 1, 1, 0, false),
        ("宠物", 0, 2, 0, false),
        ("活动", 1, 2, 0, false),
        ("黑钻", 0, 3, 0, false),
        ("对应频道", 1, 3, exp.channel_bonus, exp.channel_active),
    ];

    let dark_outline = Some(Rgba::new(11, 16, 27, 235).with_alpha(xp_alpha));
    for (label, col, row, bonus, active) in items {
        let gx = left + 335.0 + col as f32 * 135.0;
        let gy = 321.0 + row as f32 * 38.0;
        c.draw_image_additive(
            sheet,
            ART_XP_SLOT_GLOW[0],
            ART_XP_SLOT_GLOW[1],
            ART_XP_SLOT_GLOW[2],
            ART_XP_SLOT_GLOW[3],
            gx,
            gy,
            ART_XP_SLOT_GLOW[2] as f32 * UI_SCALE,
            ART_XP_SLOT_GLOW[3] as f32 * UI_SCALE,
            false,
            xp_alpha * if active { 1.0 } else { 0.65 },
            0.0,
        );
        let text_color = if active {
            Rgba::new(255, 255, 255, 255)
        } else {
            Rgba::new(140, 150, 164, 255)
        }
        .with_alpha(xp_alpha);
        c.fill_text(
            label,
            gx + 65.0,
            gy + 13.0,
            12.0,
            text_color,
            TextAlign::Center,
            dark_outline,
        );
        if bonus > 0 && active {
            c.fill_text(
                &format!("+{bonus}"),
                gx + 65.0,
                gy - 2.0,
                12.0,
                Rgba::new(158, 255, 122, 255).with_alpha(xp_alpha),
                TextAlign::Center,
                dark_outline,
            );
        }
    }

    // Bottom XP total bar (additive cyan beam, matching V1 341s / V2 395.5s — no black box)
    c.draw_image_additive(
        sheet,
        ART_XP_BAR[0],
        ART_XP_BAR[1],
        ART_XP_BAR[2],
        ART_XP_BAR[3],
        left + 329.0,
        472.0,
        ART_XP_BAR[2] as f32 * UI_SCALE,
        ART_XP_BAR[3] as f32 * UI_SCALE,
        false,
        xp_alpha,
        0.0,
    );
    c.fill_text(
        "经验值",
        left + 356.0,
        493.0,
        14.0,
        Rgba::new(238, 241, 245, 255).with_alpha(xp_alpha),
        TextAlign::Left,
        dark_outline,
    );

    let xp_str = exp.shown_total.to_string();
    if !draw_stats_number(
        c,
        sheet,
        &xp_str,
        DigitFamily::Total,
        left + 505.0,
        473.0,
        TextAlign::Center,
        xp_alpha,
    ) {
        c.fill_text(
            &xp_str,
            left + 505.0,
            495.0,
            24.0,
            Rgba::new(255, 255, 255, 255).with_alpha(xp_alpha),
            TextAlign::Center,
            dark_outline,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_stats_number(
    c: &mut Canvas<'_>,
    sheet: &Pixmap,
    text: &str,
    family: DigitFamily,
    x: f32,
    y: f32,
    align: TextAlign,
    alpha: f32,
) -> bool {
    let font = match family {
        DigitFamily::Total => &DIGITS_TOTAL,
        DigitFamily::Gold => &DIGITS_GOLD,
        DigitFamily::Red => &DIGITS_RED,
        DigitFamily::Percent => &DIGITS_PERCENT,
    };
    let overlap = match family {
        DigitFamily::Total => 4.5f32,
        DigitFamily::Gold | DigitFamily::Red | DigitFamily::Percent => 4.0f32,
    };

    let mut glyphs: Vec<[u32; 4]> = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let g = match ch {
            '/' => ART_SCORE_SLASH,
            '%' => ART_STATS_PERCENT,
            '-' => ART_STATS_MINUS,
            '0'..='9' => font[(ch as u8 - b'0') as usize],
            _ => return false,
        };
        glyphs.push(g);
    }
    if glyphs.is_empty() {
        return false;
    }

    let total_w: f32 = glyphs
        .iter()
        .map(|g| (g[2] as f32 - overlap) * UI_SCALE)
        .sum();
    let mut cur_x = match align {
        TextAlign::Left => x,
        TextAlign::Center => x - total_w * 0.5,
        TextAlign::Right => x - total_w,
    };

    for g in glyphs {
        let top = if family == DigitFamily::Gold && g == ART_STATS_PERCENT {
            y + 2.0 * UI_SCALE
        } else {
            y
        };
        c.draw_image(
            sheet,
            g[0],
            g[1],
            g[2],
            g[3],
            cur_x,
            top,
            g[2] as f32 * UI_SCALE,
            g[3] as f32 * UI_SCALE,
            false,
            alpha,
            0.0,
        );
        cur_x += (g[2] as f32 - overlap) * UI_SCALE;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::{GlyphCache, Rgba};
    use crate::{render, ProgressPanelKind, RenderMeta, RENDER_HEIGHT, RENDER_WIDTH};
    use core_rs::types::CreateStateOptions;
    use core_rs::{combat::rating_of, create_state};
    use std::path::PathBuf;
    use tiny_skia::Pixmap;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
    }

    fn make_victory_state(stage: &str) -> State {
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some(stage),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        state.victory = true;
        state.post_clear = false;
        state.finished_at = Some(100.0);
        state.time = 100.0;
        state.stats.swings = 20;
        state.stats.swings_landed = 17; // 85%
        state.stats.combo_chains = 10;
        state.stats.combo_hits = 23; // ~57%
        state.stats.hits_taken = if stage == "mirkwooddeep" { 23 } else { 15 };
        state.result_rating = Some(rating_of(&state));
        state.clear_experience = true;
        state
    }

    #[test]
    fn test_backdrop_pause_and_smooth_fade_in() {
        assert_eq!(backdrop_alpha(0.0), 0.0);
        assert_eq!(backdrop_alpha(0.05), 0.0);
        assert_eq!(backdrop_alpha(0.099), 0.0);
        assert!((backdrop_alpha(0.20) - 0.5).abs() < 1e-4);
        assert!((backdrop_alpha(0.25) - 0.75).abs() < 1e-4);
        assert_eq!(backdrop_alpha(0.30), 1.0);
        assert_eq!(backdrop_alpha(3.0), 1.0);

        let sprites = SpriteStore::load_from_root(&repo_root());
        let mut fonts = GlyphCache::new(None);

        // At 0.05s (during 0.1s clear-room pause), backdrop must leave background pixels untouched.
        let mut pm_pause = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        let bg = Rgba::new(40, 80, 60, 255);
        {
            let mut c = Canvas::new(&mut pm_pause, &mut fonts);
            c.clear(bg);
            draw_result_backdrop(&mut c, &sprites, 0.05);
        }
        assert!(
            pm_pause
                .data()
                .chunks_exact(4)
                .all(|px| px[0] == 40 && px[1] == 80 && px[2] == 60),
            "0.05s must preserve clear room with zero overlay"
        );

        // At 0.25s (fade-in) and 1.5s vs 3.0s (rotating magic circle), pixels must change and rotate.
        let mut pm_fade = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        let mut pm_15 = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        let mut pm_30 = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        for (pm, t) in [(&mut pm_fade, 0.25), (&mut pm_15, 1.5), (&mut pm_30, 3.0)] {
            let mut c = Canvas::new(pm, &mut fonts);
            c.clear(bg);
            draw_result_backdrop(&mut c, &sprites, t);
        }
        assert_ne!(
            pm_fade.data(),
            pm_pause.data(),
            "0.25s must fade in backdrop"
        );
        assert_ne!(
            pm_15.data(),
            pm_30.data(),
            "magic circle must visibly rotate between 1.5s and 3.0s"
        );
    }

    #[test]
    fn test_stats_panel_has_no_korean_english_label_leak_and_animates_bars() {
        let sprites = SpriteStore::load_from_root(&repo_root());
        let state = make_victory_state("mirkwood");
        // Empty GlyphCache ensures any bright pixels in the left label column would come from raw f0 art.
        let mut fonts = GlyphCache::new(None);

        let mut pm_early = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pm_early, &mut fonts);
            c.clear(Rgba::new(0, 0, 0, 255));
            draw_recorded_stats(&mut c, &state, &sprites, 1.5, true);
        }

        // Check left label column inside panel (logical x=118..182 -> native x=131..202, y=165..280)
        // Must NOT contain bright white Korean label pixels from raw result.img f0.
        let mut bright_korean_leak = 0usize;
        for y in 165..280u32 {
            for x in 131..202u32 {
                let idx = ((y * RENDER_WIDTH + x) * 4) as usize;
                let px = &pm_early.data()[idx..idx + 4];
                if px[0].max(px[1]).max(px[2]) > 90 {
                    bright_korean_leak += 1;
                }
            }
        }
        assert_eq!(
            bright_korean_leak, 0,
            "Korean/English labels from raw result.img f0 leaked into stats panel ({bright_korean_leak} bright px)"
        );

        // At t=1.5s, operation golden bar (logical y=154..179 -> native y=171..199, x=450..650) has golden pixels,
        // while technique bar (logical y=192..217 -> native y=213..241) has NOT appeared yet.
        let count_gold = |pm: &Pixmap, y0: u32, y1: u32| -> usize {
            let mut n = 0;
            for y in y0..y1 {
                for x in 450..650u32 {
                    let idx = ((y * RENDER_WIDTH + x) * 4) as usize;
                    let px = &pm.data()[idx..idx + 4];
                    if px[0] > 180 && px[1] > 140 && px[2] < 120 {
                        n += 1;
                    }
                }
            }
            n
        };
        assert!(
            count_gold(&pm_early, 171, 199) > 100,
            "operation golden bar must appear by t=1.5s"
        );
        assert_eq!(
            count_gold(&pm_early, 213, 241),
            0,
            "technique golden bar must NOT appear yet at t=1.5s"
        );

        // At t=3.0s, both operation and technique golden bars are visible.
        let mut pm_mid = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pm_mid, &mut fonts);
            c.clear(Rgba::new(0, 0, 0, 255));
            draw_recorded_stats(&mut c, &state, &sprites, 3.0, true);
        }
        assert!(
            count_gold(&pm_mid, 213, 241) > 100,
            "technique golden bar must appear by t=3.0s"
        );
    }

    #[test]
    fn test_rank_seal_position_and_additive_circle_without_black_box() {
        let sprites = SpriteStore::load_from_root(&repo_root());
        let state = make_victory_state("mirkwood");
        let mut fonts = GlyphCache::new(None);

        // Render onto a mid-grey background so any opaque black square behind rankCircle is caught!
        let bg = Rgba::new(60, 70, 90, 255);
        let mut pm = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pm, &mut fonts);
            c.clear(bg);
            draw_recorded_stats(&mut c, &state, &sprites, 4.5, true);
        }

        // Top-left corner of rankCircle bounding box (logical (81, 274) -> native (90, 304)):
        // With additive blending, RGB=(0,0,0) in the corner must NOT darken the (60,70,90) background!
        let corner_idx = ((306 * RENDER_WIDTH + 92) * 4) as usize;
        let corner = &pm.data()[corner_idx..corner_idx + 4];
        assert!(
            corner[0] >= 58 && corner[1] >= 68 && corner[2] >= 88,
            "rankCircle corner darkened background to {:?} (black square box bug!)",
            corner
        );

        // Center of circular rank seal on bottom-left (logical (208, 400) -> native (231, 444))
        // must contain golden/warm seal pixels.
        let mut gold_seal_px = 0usize;
        for y in 400..490u32 {
            for x in 180..280u32 {
                let idx = ((y * RENDER_WIDTH + x) * 4) as usize;
                let px = &pm.data()[idx..idx + 4];
                if px[0] > 160 && px[1] > 120 && px[0] > px[2].saturating_add(40) {
                    gold_seal_px += 1;
                }
            }
        }
        assert!(
            gold_seal_px > 500,
            "circular golden rank seal must render on bottom-left, got {gold_seal_px} gold px"
        );

        // Left edge of bottom-right XP bar (logical (329, 472) -> native (366, 525)):
        // Over semi-transparent xpPanel (~50% of (60,70,90) = (30,35,45)), additive xpBar
        // must NOT overwrite it with opaque black (0,0,0)!
        let xp_edge_idx = ((530 * RENDER_WIDTH + 368) * 4) as usize;
        let xp_edge = &pm.data()[xp_edge_idx..xp_edge_idx + 4];
        assert!(
            xp_edge[0] >= 25 && xp_edge[1] >= 30 && xp_edge[2] >= 40,
            "xpBar edge darkened background to {:?} (must be additive, not opaque black box!)",
            xp_edge
        );
    }

    #[test]
    fn test_exp_breakdown_counts_up_to_reference_totals() {
        let mirkwood = make_victory_state("mirkwood");
        let b0 = compute_exp_breakdown(&mirkwood, 4.5);
        assert_eq!(b0.base, 1760);
        assert_eq!(b0.rating_bonus, 528);
        assert_eq!(b0.channel_bonus, 88);
        assert_eq!(b0.shown_total, 1760);
        assert!(!b0.rating_active);
        assert!(!b0.channel_active);

        let b1 = compute_exp_breakdown(&mirkwood, 5.4);
        assert!(b1.rating_active && !b1.channel_active);
        assert!(b1.shown_total > 1760 && b1.shown_total < 2288);

        let b2 = compute_exp_breakdown(&mirkwood, 6.2);
        assert!(b2.rating_active && b2.channel_active);
        assert!(b2.shown_total > 2288 && b2.shown_total < 2376);

        let b3 = compute_exp_breakdown(&mirkwood, 7.0);
        assert_eq!(b3.shown_total, 2376);

        let deep = make_victory_state("mirkwooddeep");
        let d_final = compute_exp_breakdown(&deep, 7.0);
        assert_eq!(d_final.base, 4680);
        assert_eq!(d_final.rating_bonus, 1404);
        assert_eq!(d_final.channel_bonus, 234);
        assert_eq!(d_final.shown_total, 6318);
    }

    #[test]
    fn test_full_results_phase_renders_across_timestamps_without_panic() {
        let sprites = SpriteStore::load_from_root(&repo_root());
        let dump_dir = std::env::var("DUMP_RESULTS_DIR").ok();
        let font_blobs: Vec<Vec<u8>> = if dump_dir.is_some() {
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
            ]
            .into_iter()
            .filter_map(|p| std::fs::read(p).ok())
            .collect()
        } else {
            Vec::new()
        };
        let blob_refs: Vec<&[u8]> = font_blobs.iter().map(Vec::as_slice).collect();
        let mut fonts = GlyphCache::from_font_blobs(&blob_refs);
        let state = make_victory_state("mirkwood");
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let loadout = vec![Some("upSlash".to_string()); 6];

        for ts in [0.05, 0.25, 1.5, 3.0, 5.4, 6.8] {
            let mut rw = reward_rs::create(Some(1), Some("mirkwood")).expect("reward");
            rw.t = ts;
            rw.elapsed = ts;
            let meta = RenderMeta {
                title: false,
                attract: false,
                paused: false,
                show_help: false,
                loadout: &loadout,
                loadout_open: false,
                progress_panel: ProgressPanelKind::None,
                progress: &progress,
                records: &records,
                reward: Some(&rw),
                region_open: false,
                region_selected: "mirkwood",
                hint: None,
                seed: state.seed,
                stage_id: &state.stage_id,
                map_mode: crate::MapMode::Radar,
            };
            let mut pm = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
            let mut c = Canvas::new(&mut pm, &mut fonts);
            render(&mut c, &state, &sprites, &meta);
            if let Some(ref dir) = dump_dir {
                let _ = std::fs::create_dir_all(dir);
                let path = format!("{dir}/results_{ts:.2}.png");
                let _ = pm.save_png(&path);
            }
            assert!(
                pm.data()
                    .chunks_exact(4)
                    .any(|px| px[0] > 0 || px[1] > 0 || px[2] > 0),
                "results frame at t={ts}s must render non-empty pixels"
            );
        }
    }
}
