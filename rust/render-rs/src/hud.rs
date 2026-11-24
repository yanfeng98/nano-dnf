//! HUD, minimap, skill bar, loadout/progress panels, and overlays (`src/render.js`).

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::results::ContinueAction;
use crate::sprites::SpriteStore;
use crate::tables::rect_at;
use core_rs::constants::*;
use core_rs::dungeon::MINIMAP_DIR_E;
use core_rs::dungeon::MINIMAP_DIR_N;
use core_rs::dungeon::MINIMAP_DIR_S;
use core_rs::dungeon::MINIMAP_DIR_W;
use core_rs::types::*;
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

/// Top-right dungeon map window presentation mode (ADR 0068 / ADR 0074).
/// Dungeons start in circular `Radar` mode and toggle to fog-free square `Window` mode via Tab or click.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MapMode {
    #[default]
    Radar,
    Window,
}

impl MapMode {
    pub fn toggle(self) -> Self {
        match self {
            Self::Radar => Self::Window,
            Self::Window => Self::Radar,
        }
    }
}

/// Logical 720x540 HUD rectangle for map window layout & hit-testing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MapRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelAction {
    Close,
    InteractSlot(usize),
    SalvageFirst,
    SelectLoadoutSlot(usize),
    AssignLoadoutSkill(usize),
    CycleLoadoutSkill(isize),
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
    pub map_mode: MapMode,
    pub continue_hover: Option<ContinueAction>,
    pub reward_card_hover: Option<usize>,
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
    let bottom = ARENA_HEIGHT as f32;

    crate::hud_classic::draw_bottom_hud(c, state, sprites, meta);

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

    // Current target panel (top-left: avatar, race badge, Lv+name, full-width multi-layer boss HP)
    crate::combat_info::draw_target_panel(c, state, sprites);

    // Combat loot log (top-left directly underneath target bar, hidden behind full-screen title)
    if !meta.title {
        crate::combat_info::draw_combat_log(c, state);
    }

    // Persistent live combat rating panel (right side above bottom HUD; frozen on clear)
    if !meta.title && (!state.victory || state.post_clear) {
        crate::combat_info::draw_rating_panel(c, state, sprites);
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

// --- Top-right dual-mode map window (circular radar + fog-free square map) ---
// Measurements from reference recordings V1 (00001-幽暗密林.mp4) and V2 (00002-幽暗密林深处.mp4),
// matching audits 107/108/110/111 and ADR 0068 / ADR 0074.
const MINIMAP_TILE: f32 = 18.0;
const MINIMAP_SCALE: f32 = 1.125;
const MINIMAP_TITLE_H: f32 = 18.0;
const MINIMAP_MARGIN_RIGHT: f32 = 15.0;
const MINIMAP_WINDOW_TOP: f32 = 28.5;
const RADAR_RING_W: f32 = 104.0;
const RADAR_RING_H: f32 = 104.0;
const RADAR_MARGIN_RIGHT: f32 = 9.0;
const RADAR_TOP: f32 = 23.5;
const RADAR_CIRCLE_CX: f32 = 54.5;
const RADAR_CIRCLE_CY: f32 = 49.5;
const RADAR_CONTENT_OX: f32 = 62.0;
const RADAR_CONTENT_OY: f32 = 57.5;
const RADAR_RADIUS: f32 = 45.0;
const RADAR_MARKER_PIVOT_X: f32 = 6.0;
const RADAR_MARKER_PIVOT_Y: f32 = 10.0;

// Piece rects in `assets/minimap.png`: (sx, sy, sw, sh).
const PIECE_BLANK: (u32, u32, u32, u32) = (0, 18, 18, 18);
const PIECE_BOSS: (u32, u32, u32, u32) = (44, 18, 16, 14);
const PIECE_MARKER: (u32, u32, u32, u32) = (64, 18, 14, 19);
const PIECE_RING: (u32, u32, u32, u32) = (82, 18, 104, 104);
const PIECE_TL: (u32, u32, u32, u32) = (190, 18, 5, 5);
const PIECE_TOP: (u32, u32, u32, u32) = (199, 18, 18, 5);
const PIECE_TR: (u32, u32, u32, u32) = (221, 18, 4, 5);
const PIECE_LEFT: (u32, u32, u32, u32) = (229, 18, 5, 18);
const PIECE_CENTRE: (u32, u32, u32, u32) = (238, 18, 18, 18);
const PIECE_RIGHT: (u32, u32, u32, u32) = (260, 18, 4, 18);
const PIECE_BL: (u32, u32, u32, u32) = (268, 18, 5, 4);
const PIECE_BOTTOM: (u32, u32, u32, u32) = (277, 18, 18, 4);
const PIECE_BR: (u32, u32, u32, u32) = (299, 18, 4, 4);
const PIECE_RADAR_BG: (u32, u32, u32, u32) = (307, 18, 74, 74);
const PIECE_RADAR_COUNTER: (u32, u32, u32, u32) = (385, 18, 54, 23);
const PIECE_RADAR_BUTTON: (u32, u32, u32, u32) = (589, 18, 24, 24);
const PIECE_RADAR_BANNER: (u32, u32, u32, u32) = (617, 18, 202, 23);
const PIECE_RADAR_DIGITS: [(u32, u32, u32, u32); 10] = [
    (443, 18, 11, 13),
    (458, 18, 7, 13),
    (469, 18, 11, 13),
    (484, 18, 11, 13),
    (499, 18, 11, 13),
    (514, 18, 11, 13),
    (529, 18, 11, 13),
    (544, 18, 11, 13),
    (559, 18, 11, 13),
    (574, 18, 11, 13),
];

#[derive(Debug, Clone, Copy)]
struct RadarGeometry {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    centre_x: f32,
    centre_y: f32,
    content_x: f32,
    content_y: f32,
    radius: f32,
}

fn hud_right() -> f32 {
    (VIEW_LEFT + VIEW_WIDTH) as f32
}

fn radar_geometry() -> RadarGeometry {
    let w = RADAR_RING_W * MINIMAP_SCALE;
    let h = RADAR_RING_H * MINIMAP_SCALE;
    let x = hud_right() - RADAR_MARGIN_RIGHT - w;
    let y = RADAR_TOP;
    RadarGeometry {
        x,
        y,
        w,
        h,
        centre_x: x + RADAR_CIRCLE_CX * MINIMAP_SCALE,
        centre_y: y + RADAR_CIRCLE_CY * MINIMAP_SCALE,
        content_x: x + RADAR_CONTENT_OX,
        content_y: y + RADAR_CONTENT_OY,
        radius: RADAR_RADIUS * MINIMAP_SCALE,
    }
}

/// Fixed bounding box of the clickable radar magnifying glass toggle button in logical 720x540 HUD coords.
pub fn radar_button_box() -> MapRect {
    MapRect {
        x: hud_right() - 39.5,
        y: 25.75,
        w: PIECE_RADAR_BUTTON.2 as f32 * MINIMAP_SCALE,
        h: PIECE_RADAR_BUTTON.3 as f32 * MINIMAP_SCALE,
    }
}

/// Center `(cx, cy)` and `radius` of the circular radar disc in logical 720x540 HUD coords.
pub fn radar_disc_bounds() -> (f32, f32, f32) {
    let g = radar_geometry();
    (g.centre_x, g.centre_y, g.radius)
}

/// Outer bounding box of the square dungeon map window for a `cols x rows` dungeon in logical 720x540 HUD coords.
pub fn minimap_window_box(cols: usize, rows: usize) -> MapRect {
    let c = cols.max(1) as f32;
    let r = rows.max(1) as f32;
    let w = (c * MINIMAP_TILE + PIECE_LEFT.2 as f32 + PIECE_RIGHT.2 as f32) * MINIMAP_SCALE;
    let h = (r * MINIMAP_TILE + MINIMAP_TITLE_H + PIECE_TOP.3 as f32 + PIECE_BOTTOM.3 as f32)
        * MINIMAP_SCALE;
    MapRect {
        x: hud_right() - w - MINIMAP_MARGIN_RIGHT,
        y: MINIMAP_WINDOW_TOP,
        w,
        h,
    }
}

/// Returns `true` if a mouse click at logical 720x540 view coordinates `(x, y)` hits the map toggle control.
pub fn hit_test_minimap(x: f32, y: f32, mode: MapMode, cols: usize, rows: usize) -> bool {
    match mode {
        MapMode::Radar => {
            let btn = radar_button_box();
            let bx = x - (btn.x + btn.w * 0.5);
            let by = y - (btn.y + btn.h * 0.5);
            let btn_r = btn.w * 0.5;
            if bx * bx + by * by <= btn_r * btn_r {
                return true;
            }
            let (cx, cy, radius) = radar_disc_bounds();
            let dx = x - cx;
            let dy = y - cy;
            dx * dx + dy * dy <= (radius + 3.0) * (radius + 3.0)
        }
        MapMode::Window => {
            let b = minimap_window_box(cols, rows);
            if x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h {
                return false;
            }
            // Top-right ⊘ close/minimize button in the square map title bar.
            x >= b.x + b.w - 21.0 && y <= b.y + 18.0
        }
    }
}

fn minimap_tile_col(kind: &str, exits: u8) -> Option<u32> {
    if kind == "corr" {
        match exits {
            1 => Some(0),   // corr:N
            2 => Some(1),   // corr:E
            3 => Some(2),   // corr:NE
            4 => Some(3),   // corr:S
            5 => Some(4),   // corr:NS
            6 => Some(5),   // corr:ES
            7 => Some(6),   // corr:NES
            9 => Some(7),   // corr:NW
            10 => Some(8),  // corr:EW
            11 => Some(9),  // corr:NEW
            12 => Some(10), // corr:SW
            13 => Some(11), // corr:NSW
            14 => Some(12), // corr:ESW
            15 => Some(20), // corr:NESW shares room:NESW cross
            8 => Some(17),  // fallback room:W
            _ => None,
        }
    } else {
        match exits {
            1 => Some(13),  // room:N
            2 => Some(14),  // room:E
            3 => Some(2),   // fallback corr:NE
            4 => Some(15),  // room:S
            5 => Some(4),   // fallback corr:NS
            6 => Some(16),  // room:ES
            7 => Some(6),   // fallback corr:NES
            8 => Some(17),  // room:W
            9 => Some(18),  // room:NW
            10 => Some(8),  // fallback corr:EW
            11 => Some(9),  // fallback corr:NEW
            12 => Some(10), // fallback corr:SW
            13 => Some(11), // fallback corr:NSW
            14 => Some(19), // room:ESW
            15 => Some(20), // room:NESW
            _ => None,
        }
    }
}

fn draw_piece(
    c: &mut Canvas<'_>,
    sh: &tiny_skia::Pixmap,
    piece: (u32, u32, u32, u32),
    dx: f32,
    dy: f32,
    dw: f32,
    dh: f32,
) {
    c.draw_image(
        sh, piece.0, piece.1, piece.2, piece.3, dx, dy, dw, dh, false, 1.0, 0.0,
    );
}

fn draw_stage_title_banner(
    c: &mut Canvas<'_>,
    state: &State,
    mm_sheet: Option<&tiny_skia::Pixmap>,
) {
    let right = hud_right();
    let bw = PIECE_RADAR_BANNER.2 as f32 * MINIMAP_SCALE;
    let bh = PIECE_RADAR_BANNER.3 as f32 * MINIMAP_SCALE;
    let bx = right - bw;
    let by = 0.0;
    if let Some(sh) = mm_sheet {
        if sh.width() >= PIECE_RADAR_BANNER.0 + PIECE_RADAR_BANNER.2 {
            draw_piece(c, sh, PIECE_RADAR_BANNER, bx, by, bw, bh);
        } else {
            c.fill_rect(bx, by, bw, bh, Rgba::new(28, 12, 26, 205));
            c.draw_line(
                bx,
                bh - 1.5,
                right,
                bh - 1.5,
                Rgba::new(240, 206, 140, 220),
                1.2,
            );
        }
    } else {
        c.fill_rect(bx, by, bw, bh, Rgba::new(28, 12, 26, 205));
        c.draw_line(
            bx,
            bh - 1.5,
            right,
            bh - 1.5,
            Rgba::new(240, 206, 140, 220),
            1.2,
        );
    }

    let stage_name = core_rs::TABLES
        .stages
        .get(&state.stage_id)
        .map(|s| s.name.as_str())
        .unwrap_or(&state.stage_id);
    // Centered above the radar/map window, clear of the right-edge scroll filigree.
    let text_x = right - 80.0;
    let text_y = 17.0;
    c.fill_text(
        stage_name,
        text_x,
        text_y,
        13.5,
        Rgba::new(248, 236, 208, 255),
        TextAlign::Center,
        Some(Rgba::new(12, 6, 10, 220)),
    );
}

fn draw_radar_header(c: &mut Canvas<'_>, state: &State, mm_sheet: Option<&tiny_skia::Pixmap>) {
    let right = hud_right();
    let btn = radar_button_box();
    let kills = state.stats.kills;
    let text = kills.to_string();

    if let Some(sh) = mm_sheet {
        // Red pouch counter backing (audit 110)
        draw_piece(
            c,
            sh,
            PIECE_RADAR_COUNTER,
            right - 128.25,
            27.0,
            PIECE_RADAR_COUNTER.2 as f32 * MINIMAP_SCALE,
            PIECE_RADAR_COUNTER.3 as f32 * MINIMAP_SCALE,
        );
        // Native orange digits, right-aligned inside the counter pouch
        let mut total_w = 0.0f32;
        for b in text.bytes() {
            let d = (b - b'0') as usize;
            total_w += PIECE_RADAR_DIGITS[d].2 as f32;
        }
        total_w += text.len().saturating_sub(1) as f32;
        let mut dx = right - 74.375 - total_w * MINIMAP_SCALE;
        for b in text.bytes() {
            let d = (b - b'0') as usize;
            let piece = PIECE_RADAR_DIGITS[d];
            draw_piece(
                c,
                sh,
                piece,
                dx,
                32.5,
                piece.2 as f32 * MINIMAP_SCALE,
                piece.3 as f32 * MINIMAP_SCALE,
            );
            dx += (piece.2 as f32 + 1.0) * MINIMAP_SCALE;
        }
        // Native clickable magnifying glass button (audit 111)
        draw_piece(c, sh, PIECE_RADAR_BUTTON, btn.x, btn.y, btn.w, btn.h);
    } else {
        c.fill_round_rect(
            right - 128.25,
            27.0,
            60.0,
            24.0,
            10.0,
            Rgba::new(20, 18, 16, 220),
        );
        c.fill_text(
            &format!("× {text}"),
            right - 98.0,
            43.0,
            12.0,
            Rgba::new(255, 168, 56, 255),
            TextAlign::Center,
            Some(Rgba::new(0, 0, 0, 220)),
        );
        c.fill_ellipse(
            btn.x + btn.w * 0.5,
            btn.y + btn.h * 0.5,
            btn.w * 0.45,
            btn.h * 0.45,
            Rgba::new(110, 168, 240, 230),
        );
    }
}

fn draw_minimap_grid_and_tiles(
    c: &mut Canvas<'_>,
    dun: &Dungeon,
    mm_sheet: Option<&tiny_skia::Pixmap>,
    origin_x: f32,
    origin_y: f32,
    scale: f32,
) {
    let cell_pitch = MINIMAP_TILE * scale;
    // Grid base: blank tile for valid cells, pure black for missing holes (e.g. Mirkwood Deep (0,1)/(4,2))
    for row in 0..dun.rows {
        for col in 0..dun.cols {
            let gx = origin_x + col as f32 * cell_pitch;
            let gy = origin_y + row as f32 * cell_pitch;
            let has_cell = dun
                .cells
                .iter()
                .any(|cell| cell.col == col && cell.row == row);
            if !has_cell {
                c.fill_rect(gx, gy, cell_pitch, cell_pitch, Rgba::new(0, 0, 0, 255));
            } else if let Some(sh) = mm_sheet {
                draw_piece(
                    c,
                    sh,
                    PIECE_BLANK,
                    gx.round(),
                    gy.round(),
                    cell_pitch.round(),
                    cell_pitch.round(),
                );
            } else {
                c.fill_rect(gx, gy, cell_pitch, cell_pitch, Rgba::new(32, 68, 14, 230));
            }
        }
    }

    // ADR 0068: full dungeon layout visible without fog-of-war or '?' masks.
    for cell in &dun.cells {
        let cx = origin_x + cell.col as f32 * cell_pitch;
        let cy = origin_y + cell.row as f32 * cell_pitch;
        if let Some(sh) = mm_sheet {
            if let Some(col_idx) = minimap_tile_col(&cell.kind, cell.exits) {
                c.draw_image(
                    sh,
                    col_idx * 18,
                    0,
                    18,
                    18,
                    cx.round(),
                    cy.round(),
                    cell_pitch,
                    cell_pitch,
                    false,
                    1.0,
                    0.0,
                );
            }
        } else {
            c.fill_rect(
                cx + 2.0,
                cy + 2.0,
                cell_pitch - 4.0,
                cell_pitch - 4.0,
                Rgba::new(112, 116, 47, 230),
            );
            if (cell.exits & MINIMAP_DIR_E) != 0 {
                c.fill_rect(
                    cx + cell_pitch - 2.0,
                    cy + cell_pitch * 0.4,
                    4.0,
                    3.0,
                    Rgba::new(180, 180, 120, 220),
                );
            }
            if (cell.exits & MINIMAP_DIR_W) != 0 {
                c.fill_rect(
                    cx - 2.0,
                    cy + cell_pitch * 0.4,
                    4.0,
                    3.0,
                    Rgba::new(180, 180, 120, 220),
                );
            }
            if (cell.exits & MINIMAP_DIR_N) != 0 {
                c.fill_rect(
                    cx + cell_pitch * 0.4,
                    cy - 2.0,
                    3.0,
                    4.0,
                    Rgba::new(180, 180, 120, 220),
                );
            }
            if (cell.exits & MINIMAP_DIR_S) != 0 {
                c.fill_rect(
                    cx + cell_pitch * 0.4,
                    cy + cell_pitch - 2.0,
                    3.0,
                    4.0,
                    Rgba::new(180, 180, 120, 220),
                );
            }
        }
    }
}

fn draw_map_player_marker(
    c: &mut Canvas<'_>,
    mm_sheet: Option<&tiny_skia::Pixmap>,
    cell_x: f32,
    cell_y: f32,
    cell_size: f32,
) {
    let scale = cell_size / MINIMAP_TILE;
    let w = PIECE_MARKER.2 as f32 * scale;
    let h = PIECE_MARKER.3 as f32 * scale;
    let dx = cell_x + (cell_size - w) * 0.5;
    let dy = cell_y + (cell_size - h) * 0.5;
    if let Some(sh) = mm_sheet {
        draw_piece(
            c,
            sh,
            PIECE_MARKER,
            dx.round(),
            dy.round(),
            w.round(),
            h.round(),
        );
    } else {
        c.fill_rect(
            cell_x + cell_size * 0.35,
            cell_y + cell_size * 0.15,
            cell_size * 0.3,
            cell_size * 0.7,
            Rgba::new(25, 194, 255, 255),
        );
    }
}

fn draw_map_boss_marker(
    c: &mut Canvas<'_>,
    mm_sheet: Option<&tiny_skia::Pixmap>,
    cell_x: f32,
    cell_y: f32,
    cell_size: f32,
) {
    let scale = cell_size / MINIMAP_TILE;
    let w = PIECE_BOSS.2 as f32 * scale;
    let h = PIECE_BOSS.3 as f32 * scale;
    let dx = cell_x + (cell_size - w) * 0.5;
    let dy = cell_y + (cell_size - h) * 0.5;
    if let Some(sh) = mm_sheet {
        draw_piece(
            c,
            sh,
            PIECE_BOSS,
            dx.round(),
            dy.round(),
            w.round(),
            h.round(),
        );
    } else {
        c.fill_ellipse(
            cell_x + cell_size * 0.5,
            cell_y + cell_size * 0.5,
            cell_size * 0.35,
            cell_size * 0.3,
            Rgba::new(233, 74, 0, 255),
        );
    }
}

fn draw_minimap_window_frame(c: &mut Canvas<'_>, mm_sheet: Option<&tiny_skia::Pixmap>, b: MapRect) {
    // Solid brown base (#62543c) under the 50%-black 9-slice centre -> warm (57,48,39) title strip.
    c.fill_rect(b.x, b.y, b.w, b.h, Rgba::new(98, 84, 60, 255));
    if let Some(sh) = mm_sheet {
        let l = PIECE_LEFT.2 as f32 * MINIMAP_SCALE;
        let r = PIECE_RIGHT.2 as f32 * MINIMAP_SCALE;
        let t = PIECE_TOP.3 as f32 * MINIMAP_SCALE;
        let bot = PIECE_BOTTOM.3 as f32 * MINIMAP_SCALE;
        let inner_w = (b.w - l - r).max(0.0);
        let inner_h = (b.h - t - bot).max(0.0);
        draw_piece(
            c,
            sh,
            PIECE_TL,
            b.x.round(),
            b.y.round(),
            l.round(),
            t.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_TR,
            (b.x + b.w - r).round(),
            b.y.round(),
            r.round(),
            t.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_BL,
            b.x.round(),
            (b.y + b.h - bot).round(),
            l.round(),
            bot.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_BR,
            (b.x + b.w - r).round(),
            (b.y + b.h - bot).round(),
            r.round(),
            bot.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_TOP,
            (b.x + l).round(),
            b.y.round(),
            inner_w.round(),
            t.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_BOTTOM,
            (b.x + l).round(),
            (b.y + b.h - bot).round(),
            inner_w.round(),
            bot.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_LEFT,
            b.x.round(),
            (b.y + t).round(),
            l.round(),
            inner_h.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_RIGHT,
            (b.x + b.w - r).round(),
            (b.y + t).round(),
            r.round(),
            inner_h.round(),
        );
        draw_piece(
            c,
            sh,
            PIECE_CENTRE,
            (b.x + l).round(),
            (b.y + t).round(),
            inner_w.round(),
            inner_h.round(),
        );
    } else {
        c.stroke_rect(b.x, b.y, b.w, b.h, Rgba::new(165, 134, 72, 220), 1.5);
    }
}

fn draw_window_close_button(c: &mut Canvas<'_>, b: MapRect) {
    let x = b.x + b.w - 19.0;
    let y = b.y + 4.5;
    c.fill_round_rect(x, y, 15.0, 12.0, 2.5, Rgba::new(196, 186, 166, 220));
    c.stroke_round_rect(x, y, 15.0, 12.0, 2.5, Rgba::new(60, 52, 42, 230), 1.0);
    // ⊘ slash circle glyph
    let cx = x + 7.5;
    let cy = y + 6.0;
    c.stroke_ellipse(cx, cy, 3.6, 3.6, Rgba::new(60, 52, 42, 235), 1.3);
    c.draw_line(
        cx - 2.5,
        cy - 2.5,
        cx + 2.5,
        cy + 2.5,
        Rgba::new(60, 52, 42, 235),
        1.3,
    );
}

pub fn draw_minimap(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore, map_mode: MapMode) {
    let Some(ref dun) = state.dungeon else {
        return;
    };
    let mm_sheet = sprites.get("minimap");
    let here = dun.cells.get(state.cell).or_else(|| dun.cells.first());
    let boss = dun.cells.get(dun.boss);
    let radar = radar_geometry();

    // Top-right dungeon stage title banner (visible in both radar and square map modes).
    draw_stage_title_banner(c, state, mm_sheet);

    if map_mode == MapMode::Radar {
        let cell_pitch = MINIMAP_TILE * MINIMAP_SCALE;
        c.save();
        c.set_clip_circle(radar.centre_x, radar.centre_y, radar.radius);
        // Native radial brown backdrop inside the radar disc (audit 107).
        if let Some(sh) = mm_sheet {
            draw_piece(
                c,
                sh,
                PIECE_RADAR_BG,
                radar.x + 16.0,
                radar.y + 12.0,
                92.0,
                92.0,
            );
        } else {
            c.fill_ellipse(
                radar.centre_x,
                radar.centre_y,
                radar.radius,
                radar.radius,
                Rgba::new(42, 34, 24, 240),
            );
        }

        if let Some(here_cell) = here {
            let origin_x = radar.content_x - (here_cell.col as f32 + 0.5) * cell_pitch;
            let origin_y = radar.content_y - (here_cell.row as f32 + 0.5) * cell_pitch;
            draw_minimap_grid_and_tiles(c, dun, mm_sheet, origin_x, origin_y, MINIMAP_SCALE);

            // Player blue pillar drawn before boss icon so boss red bull-head sits on top in boss room.
            if let Some(sh) = mm_sheet {
                draw_piece(
                    c,
                    sh,
                    PIECE_MARKER,
                    radar.content_x - RADAR_MARKER_PIVOT_X * MINIMAP_SCALE,
                    radar.content_y - RADAR_MARKER_PIVOT_Y * MINIMAP_SCALE,
                    (PIECE_MARKER.2 as f32 * MINIMAP_SCALE).round(),
                    (PIECE_MARKER.3 as f32 * MINIMAP_SCALE).round(),
                );
            } else {
                draw_map_player_marker(
                    c,
                    None,
                    origin_x + here_cell.col as f32 * cell_pitch,
                    origin_y + here_cell.row as f32 * cell_pitch,
                    cell_pitch,
                );
            }

            if let Some(boss_cell) = boss {
                draw_map_boss_marker(
                    c,
                    mm_sheet,
                    origin_x + boss_cell.col as f32 * cell_pitch,
                    origin_y + boss_cell.row as f32 * cell_pitch,
                    cell_pitch,
                );
            }
        }
        c.restore();

        // Ornate gold/brass compass bezel overlaid around the clipped disc.
        if let Some(sh) = mm_sheet {
            draw_piece(c, sh, PIECE_RING, radar.x, radar.y, radar.w, radar.h);
        } else {
            c.stroke_ellipse(
                radar.centre_x,
                radar.centre_y,
                radar.radius,
                radar.radius,
                Rgba::new(205, 185, 130, 240),
                4.0,
            );
        }
        draw_radar_header(c, state, mm_sheet);
        return;
    }

    // Fog-free square map mode: retain native radar rim + header peeking behind the window panel.
    if let Some(sh) = mm_sheet {
        draw_piece(c, sh, PIECE_RING, radar.x, radar.y, radar.w, radar.h);
    }
    draw_radar_header(c, state, mm_sheet);

    let b = minimap_window_box(dun.cols, dun.rows);
    draw_minimap_window_frame(c, mm_sheet, b);

    // Title bar: "地图"
    c.fill_text(
        "地图",
        b.x + b.w * 0.5 + 3.0,
        b.y + 15.5,
        12.0,
        Rgba::new(255, 248, 226, 245),
        TextAlign::Center,
        Some(Rgba::new(20, 16, 12, 200)),
    );

    let grid_left = b.x + PIECE_LEFT.2 as f32 * MINIMAP_SCALE;
    let grid_top = b.y + (MINIMAP_TITLE_H + PIECE_TOP.3 as f32) * MINIMAP_SCALE;
    let cell_pitch = MINIMAP_TILE * MINIMAP_SCALE;

    draw_minimap_grid_and_tiles(c, dun, mm_sheet, grid_left, grid_top, MINIMAP_SCALE);

    // Blue player pillar first, red bull-head boss icon second (boss covers player in boss room).
    if let Some(here_cell) = here {
        draw_map_player_marker(
            c,
            mm_sheet,
            grid_left + here_cell.col as f32 * cell_pitch,
            grid_top + here_cell.row as f32 * cell_pitch,
            cell_pitch,
        );
    }
    if let Some(boss_cell) = boss {
        draw_map_boss_marker(
            c,
            mm_sheet,
            grid_left + boss_cell.col as f32 * cell_pitch,
            grid_top + boss_cell.row as f32 * cell_pitch,
            cell_pitch,
        );
    }

    draw_window_close_button(c, b);
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
            c.draw_image(
                sh,
                0,
                0,
                208,
                176,
                VIEW_LEFT as f32 - 80.0,
                96.0,
                dw,
                dh,
                false,
                0.95,
                0.0,
            );
        }
        let tx = VIEW_LEFT as f32 + 210.0;
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
        let right_margin = (VIEW_LEFT + VIEW_WIDTH) as f32 - 24.0;
        c.fill_text(
            &format!("种子 #{}", meta.seed),
            right_margin,
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
                right_margin,
                160.0,
                14.0,
                Rgba::new(165, 180, 205, 230),
                TextAlign::Right,
                None,
            );
        }
        c.fill_text(
            "按 N 换一个种子",
            right_margin,
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
        let coins = progress_rs::consumable_count(meta.progress, "resurrectCoin");
        if coins > 0 {
            c.fill_round_rect(
                cx - 210.0,
                cy - 122.0,
                420.0,
                224.0,
                10.0,
                Rgba::new(12, 14, 24, 238),
            );
            c.stroke_round_rect(
                cx - 210.0,
                cy - 122.0,
                420.0,
                224.0,
                10.0,
                Rgba::new(228, 190, 96, 230),
                2.0,
            );
            c.fill_text(
                "角色已倒地",
                cx,
                cy - 78.0,
                26.0,
                Rgba::new(255, 110, 102, 255),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 230)),
            );
            if let Some(sheet) = sprites.get("consumables") {
                c.draw_image(
                    sheet,
                    56,
                    0,
                    28,
                    28,
                    cx - 20.0,
                    cy - 54.0,
                    40.0,
                    40.0,
                    false,
                    1.0,
                    0.0,
                );
            }
            c.fill_text(
                "使用复活币复活 [X / Space / 6]",
                cx,
                cy + 14.0,
                17.0,
                Rgba::new(255, 224, 120, 255),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 230)),
            );
            c.fill_text(
                &format!("剩余复活币: {coins} 枚"),
                cx,
                cy + 44.0,
                14.0,
                Rgba::new(186, 230, 255, 245),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220)),
            );
            c.fill_text(
                "F3 重新挑战 · F4 返回城镇",
                cx,
                cy + 78.0,
                13.0,
                Rgba::new(205, 200, 210, 215),
                TextAlign::Center,
                None,
            );
        } else {
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
        }
        return;
    }

    if state.victory && !state.post_clear {
        if let Some(rw) = meta.reward {
            let snap = reward_snapshot(rw);
            match snap.phase {
                RewardPhase::Stats => {
                    c.save();
                    c.set_clip_rect(
                        VIEW_LEFT as f32,
                        0.0,
                        VIEW_WIDTH as f32,
                        ARENA_HEIGHT as f32,
                    );
                    crate::results::draw_result_backdrop(c, sprites, snap.elapsed.max(snap.t));
                    crate::results::draw_recorded_stats(c, state, sprites, snap.t, true);
                    c.restore();
                }
                RewardPhase::Chest
                | RewardPhase::Cards
                | RewardPhase::Reveal
                | RewardPhase::Fade => {
                    crate::results::draw_reward_page(c, state, rw, sprites, meta.reward_card_hover);
                }
                RewardPhase::Done => {}
            }
        } else {
            c.save();
            c.set_clip_rect(
                VIEW_LEFT as f32,
                0.0,
                VIEW_WIDTH as f32,
                ARENA_HEIGHT as f32,
            );
            let elapsed = state
                .finished_at
                .map(|at| (state.time - at).max(0.0))
                .unwrap_or(9.0);
            crate::results::draw_result_backdrop(c, sprites, elapsed);
            crate::results::draw_recorded_stats(c, state, sprites, elapsed, false);
            c.restore();
        }
        return;
    }

    if state.post_clear && meta.progress_panel == ProgressPanelKind::None {
        crate::results::draw_continue(c, sprites, meta.continue_hover);
    }

    if meta.progress_panel != ProgressPanelKind::None {
        draw_progress_panel(c, sprites, meta.progress_panel, meta.progress, None);
    }
}

// Native `assets/gui.png` atlas coordinates (generated by `assets/import_dnf_gui.py --table`)
const GUI_SHOP_RECT: [u32; 4] = [0, 0, 291, 380];
const GUI_QUEST_RECT: [u32; 4] = [291, 0, 291, 380];
const GUI_INVENTORY_RECT: [u32; 4] = [582, 0, 291, 410];
const GUI_GOLD_RECT: [u32; 4] = [618, 410, 17, 21];
const GUI_ICON_POTION0: [u32; 4] = [952, 410, 28, 28];
const GUI_ICON_POTION1: [u32; 4] = [980, 410, 28, 28];
const GUI_ICON_POTION2: [u32; 4] = [1008, 410, 28, 28];
const GUI_ICON_POTION3: [u32; 4] = [1036, 410, 28, 28];
const GUI_ICON_MAT0: [u32; 4] = [1064, 410, 28, 28];
const GUI_ICON_WEAPON0: [u32; 4] = [1120, 410, 28, 28];

const GUI_WIN_W: f32 = 291.0;
const GUI_SHOP_H: f32 = 380.0;
const GUI_INV_H: f32 = 410.0;

// Native 7x6 grid inside `stackableshopwindow.img` (`shop` & `loadout`)
const SHOP_GRID_X: f32 = 27.0;
const SHOP_GRID_Y: f32 = 134.0;
const SHOP_GRID_COLS: usize = 7;
const SHOP_GRID_ROWS: usize = 6;
const GRID_PITCH: f32 = 32.0;
const GRID_CELL_W: f32 = 28.0;
const GRID_CELL_H: f32 = 30.0;

// Native 8x4 grid inside `iteminventorywindow.img` (`bag` & `equip`)
const INV_GRID_X: f32 = 19.0;
const INV_GRID_Y: f32 = 176.0;
const INV_GRID_COLS: usize = 8;
const INV_GRID_ROWS: usize = 4;

// Native 10 equipment slot positions inside `iteminventorywindow.img` matching `progress_rs::EQUIP_SLOTS`
// Order: weapon, top, bottom, shoulder, belt, shoes, necklace, bracelet, ring, support
const EQUIP_SLOT_RECTS: [(f32, f32, &str); 10] = [
    (210.0, 78.0, "武器"),
    (49.0, 46.0, "上衣"),
    (81.0, 46.0, "下装"),
    (17.0, 46.0, "护肩"),
    (49.0, 78.0, "腰带"),
    (17.0, 78.0, "鞋"),
    (210.0, 46.0, "项链"),
    (178.0, 46.0, "手镯"),
    (242.0, 46.0, "戒指"),
    (242.0, 78.0, "辅助"),
];
const EQUIP_SLOT_SIZE: f32 = 30.0;

fn panel_origin(w: f32, h: f32) -> (f32, f32) {
    (
        ((ARENA_WIDTH as f32 - w) * 0.5).floor(),
        ((ARENA_HEIGHT as f32 - h) * 0.5).floor(),
    )
}

fn point_in_rect(px: f32, py: f32, x: f32, y: f32, w: f32, h: f32) -> bool {
    px >= x && px <= x + w && py >= y && py <= y + h
}

fn shop_items() -> Vec<&'static progress_rs::ItemSpec> {
    ITEMS
        .iter()
        .filter(|it| it.category != progress_rs::ItemCategory::Material)
        .collect()
}

fn bag_entries(progress: &ProgressProfile) -> Vec<(&str, u32)> {
    progress
        .items
        .iter()
        .filter(|(_, &cnt)| cnt > 0)
        .map(|(id, &cnt)| (id.as_str(), cnt))
        .collect()
}

fn draw_gui_button(c: &mut Canvas<'_>, x: f32, y: f32, w: f32, h: f32, label: &str, hovered: bool) {
    let bg = if hovered {
        Rgba::new(72, 60, 38, 245)
    } else {
        Rgba::new(34, 30, 24, 240)
    };
    let border = if hovered {
        Rgba::new(245, 210, 120, 255)
    } else {
        Rgba::new(160, 134, 82, 230)
    };
    c.fill_round_rect(x, y, w, h, 3.0, bg);
    c.stroke_round_rect(x, y, w, h, 3.0, border, 1.2);
    c.fill_text(
        label,
        x + w * 0.5,
        y + h * 0.68,
        11.0,
        Rgba::new(245, 224, 168, 255),
        TextAlign::Center,
        None,
    );
}

fn draw_item_icon(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    item_id: &str,
    dx: f32,
    dy: f32,
    size: f32,
) {
    if item_id == "ancientStaff" || item_id == "kunicTotem" {
        let key = if item_id == "ancientStaff" {
            "staffIcon"
        } else {
            "totemIcon"
        };
        if let (Some(sheet), Some(r)) = (sprites.get("results"), rect_at(&["RESULT_ART", key])) {
            c.draw_image(
                sheet, r[0], r[1], r[2], r[3], dx, dy, size, size, false, 1.0, 0.0,
            );
            return;
        }
    }
    if let Some(sheet) = sprites.get("consumables") {
        let cell_idx = match item_id {
            "hpPotion" => Some(0u32),
            "mpPotion" => Some(1u32),
            "resurrectCoin" => Some(2u32),
            _ => None,
        };
        if let Some(idx) = cell_idx {
            c.draw_image(
                sheet,
                idx * 28,
                0,
                28,
                28,
                dx,
                dy,
                size,
                size,
                false,
                1.0,
                0.0,
            );
            return;
        }
    }
    let rect = match item_id {
        "hpPotion" => GUI_ICON_POTION0,
        "mpPotion" => GUI_ICON_POTION1,
        "material" => GUI_ICON_MAT0,
        "clothArmor" => GUI_ICON_POTION2,
        "copperRing" => GUI_ICON_POTION3,
        _ => GUI_ICON_WEAPON0,
    };
    if let Some(gui) = sprites.get("gui") {
        c.draw_image(
            gui, rect[0], rect[1], rect[2], rect[3], dx, dy, size, size, false, 1.0, 0.0,
        );
    } else {
        c.fill_rect(dx, dy, size, size, Rgba::new(180, 145, 80, 220));
    }
}

fn draw_gui_window(c: &mut Canvas<'_>, sprites: &SpriteStore, rect: [u32; 4], ox: f32, oy: f32) {
    let w = rect[2] as f32;
    let h = rect[3] as f32;
    if let Some(gui) = sprites.get("gui") {
        c.draw_image(
            gui, rect[0], rect[1], rect[2], rect[3], ox, oy, w, h, false, 1.0, 0.0,
        );
    } else {
        c.fill_round_rect(ox, oy, w, h, 6.0, Rgba::new(18, 22, 32, 240));
        c.stroke_round_rect(ox, oy, w, h, 6.0, Rgba::new(210, 176, 100, 220), 1.5);
    }
}

pub fn hit_test_progress_panel(
    panel: ProgressPanelKind,
    progress: &ProgressProfile,
    ax: f32,
    ay: f32,
) -> Option<PanelAction> {
    match panel {
        ProgressPanelKind::None => None,
        ProgressPanelKind::Bag => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_INV_H);
            if point_in_rect(ax, ay, ox + 210.0, oy + 344.0, 56.0, 22.0) {
                return Some(PanelAction::Close);
            }
            if point_in_rect(ax, ay, ox + 146.0, oy + 344.0, 56.0, 22.0) {
                return Some(PanelAction::SalvageFirst);
            }
            let entries = bag_entries(progress);
            for idx in 0..entries.len().min(INV_GRID_COLS * INV_GRID_ROWS) {
                let col = idx % INV_GRID_COLS;
                let row = idx / INV_GRID_COLS;
                let gx = ox + INV_GRID_X + col as f32 * GRID_PITCH;
                let gy = oy + INV_GRID_Y + row as f32 * GRID_PITCH;
                if point_in_rect(ax, ay, gx, gy, GRID_CELL_W, GRID_CELL_H) {
                    return Some(PanelAction::InteractSlot(idx));
                }
            }
            None
        }
        ProgressPanelKind::Equip => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_INV_H);
            if point_in_rect(ax, ay, ox + 210.0, oy + 344.0, 56.0, 22.0) {
                return Some(PanelAction::Close);
            }
            for (idx, &(sx, sy, _)) in EQUIP_SLOT_RECTS.iter().enumerate() {
                if point_in_rect(ax, ay, ox + sx, oy + sy, EQUIP_SLOT_SIZE, EQUIP_SLOT_SIZE) {
                    return Some(PanelAction::InteractSlot(idx));
                }
            }
            None
        }
        ProgressPanelKind::Quest => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
            if point_in_rect(ax, ay, ox + 210.0, oy + 342.0, 56.0, 22.0) {
                return Some(PanelAction::Close);
            }
            for i in 0..QUESTS.len() {
                let rx = ox + 22.0;
                let ry = oy + 32.0 + i as f32 * 38.0;
                if point_in_rect(ax, ay, rx, ry, 228.0, 34.0) {
                    return Some(PanelAction::InteractSlot(i));
                }
            }
            None
        }
        ProgressPanelKind::Shop => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
            if point_in_rect(ax, ay, ox + 138.0, oy + 331.0, 46.0, 22.0) {
                return Some(PanelAction::Close);
            }
            let items = shop_items();
            for idx in 0..items.len().min(SHOP_GRID_COLS * SHOP_GRID_ROWS) {
                let col = idx % SHOP_GRID_COLS;
                let row = idx / SHOP_GRID_COLS;
                let gx = ox + SHOP_GRID_X + col as f32 * GRID_PITCH;
                let gy = oy + SHOP_GRID_Y + row as f32 * GRID_PITCH;
                if point_in_rect(ax, ay, gx, gy, GRID_CELL_W, GRID_CELL_H) {
                    return Some(PanelAction::InteractSlot(idx));
                }
            }
            None
        }
    }
}

pub fn hit_test_loadout_panel(ax: f32, ay: f32) -> Option<PanelAction> {
    let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
    if point_in_rect(ax, ay, ox + 138.0, oy + 331.0, 46.0, 22.0) {
        return Some(PanelAction::Close);
    }
    if point_in_rect(ax, ay, ox + 32.0, oy + 76.0, 24.0, 20.0) {
        return Some(PanelAction::CycleLoadoutSkill(-1));
    }
    if point_in_rect(ax, ay, ox + 230.0, oy + 76.0, 24.0, 20.0) {
        return Some(PanelAction::CycleLoadoutSkill(1));
    }
    for i in 0..6usize {
        let sx = ox + 32.0 + i as f32 * 38.0;
        let sy = oy + 34.0;
        if point_in_rect(ax, ay, sx, sy, 32.0, 32.0) {
            return Some(PanelAction::SelectLoadoutSlot(i));
        }
    }
    let skill_count = core_rs::TABLES
        .skill_order
        .len()
        .min(SHOP_GRID_COLS * SHOP_GRID_ROWS);
    for idx in 0..skill_count {
        let col = idx % SHOP_GRID_COLS;
        let row = idx / SHOP_GRID_COLS;
        let gx = ox + SHOP_GRID_X + col as f32 * GRID_PITCH;
        let gy = oy + SHOP_GRID_Y + row as f32 * GRID_PITCH;
        if point_in_rect(ax, ay, gx, gy, GRID_CELL_W, GRID_CELL_H) {
            return Some(PanelAction::AssignLoadoutSkill(idx));
        }
    }
    None
}

pub fn draw_progress_panel(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    panel: ProgressPanelKind,
    progress: &ProgressProfile,
    hover_pos: Option<(f32, f32)>,
) {
    if panel == ProgressPanelKind::None {
        return;
    }
    let is_hovered = |x: f32, y: f32, w: f32, h: f32| -> bool {
        hover_pos.is_some_and(|(hx, hy)| point_in_rect(hx, hy, x, y, w, h))
    };

    match panel {
        ProgressPanelKind::Bag | ProgressPanelKind::Equip => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_INV_H);
            draw_gui_window(c, sprites, GUI_INVENTORY_RECT, ox, oy);
            // Header tab title overlay
            c.fill_rect(ox + 150.0, oy + 4.0, 96.0, 18.0, Rgba::new(28, 25, 19, 235));
            let title = if panel == ProgressPanelKind::Bag {
                "物品栏 (I)"
            } else {
                "装备栏 (K)"
            };
            c.fill_text(
                title,
                ox + 198.0,
                oy + 17.0,
                11.0,
                Rgba::new(245, 218, 140, 255),
                TextAlign::Center,
                None,
            );

            // Top 10 native equipment slots
            let mut hovered_info: Option<String> = None;
            for (idx, &(sx, sy, label)) in EQUIP_SLOT_RECTS.iter().enumerate() {
                let x = ox + sx;
                let y = oy + sy;
                let slot_key = progress_rs::EQUIP_SLOTS[idx];
                let item_id = progress.equipment.get(slot_key).and_then(|v| v.as_deref());
                let hov = is_hovered(x, y, EQUIP_SLOT_SIZE, EQUIP_SLOT_SIZE);
                if let Some(id) = item_id {
                    draw_item_icon(c, sprites, id, x + 1.0, y + 1.0, 28.0);
                }
                if panel == ProgressPanelKind::Equip && idx < 9 {
                    c.fill_text(
                        &format!("{}", idx + 1),
                        x + 3.0,
                        y + 10.0,
                        9.0,
                        Rgba::new(255, 224, 130, 230),
                        TextAlign::Left,
                        None,
                    );
                }
                if hov {
                    c.stroke_rect(
                        x,
                        y,
                        EQUIP_SLOT_SIZE,
                        EQUIP_SLOT_SIZE,
                        Rgba::new(255, 226, 130, 255),
                        1.5,
                    );
                    let iname = item_id
                        .and_then(|id| ITEMS.iter().find(|it| it.id == id).map(|it| it.name))
                        .unwrap_or("空");
                    hovered_info = Some(format!("{label}: {iname}"));
                }
            }

            // Middle 8x4 inventory grid
            let entries = bag_entries(progress);
            for (idx, &(id, cnt)) in entries
                .iter()
                .take(INV_GRID_COLS * INV_GRID_ROWS)
                .enumerate()
            {
                let col = idx % INV_GRID_COLS;
                let row = idx / INV_GRID_COLS;
                let gx = ox + INV_GRID_X + col as f32 * GRID_PITCH;
                let gy = oy + INV_GRID_Y + row as f32 * GRID_PITCH;
                draw_item_icon(c, sprites, id, gx, gy + 1.0, 28.0);
                if cnt > 1 {
                    c.fill_text(
                        &format!("{cnt}"),
                        gx + 26.0,
                        gy + 27.0,
                        10.0,
                        Rgba::new(255, 245, 200, 255),
                        TextAlign::Right,
                        None,
                    );
                }
                if panel == ProgressPanelKind::Bag && idx < 9 {
                    c.fill_text(
                        &format!("{}", idx + 1),
                        gx + 2.0,
                        gy + 10.0,
                        9.0,
                        Rgba::new(255, 224, 130, 220),
                        TextAlign::Left,
                        None,
                    );
                }
                if is_hovered(gx, gy, GRID_CELL_W, GRID_CELL_H) {
                    c.stroke_rect(
                        gx,
                        gy,
                        GRID_CELL_W,
                        GRID_CELL_H,
                        Rgba::new(255, 226, 130, 255),
                        1.5,
                    );
                    if let Some(spec) = progress_rs::item_spec(id) {
                        hovered_info = Some(format!("{} x{cnt} · {}", spec.name, spec.note));
                    }
                }
            }

            // Status / tooltip bar above the grid
            let status_text = hovered_info.unwrap_or_else(|| {
                if panel == ProgressPanelKind::Bag {
                    "点击或按 1-9 使用/穿戴 · Backspace 分解".to_string()
                } else {
                    "点击上方装备格或按 1-9 卸下装备".to_string()
                }
            });
            c.fill_text(
                &status_text,
                ox + 145.0,
                oy + 166.0,
                10.0,
                Rgba::new(235, 224, 190, 245),
                TextAlign::Center,
                None,
            );

            // Gold value in native bottom gold box
            c.fill_text(
                &format!("{}", progress.gold),
                ox + 44.0,
                oy + 324.0,
                11.0,
                Rgba::new(255, 220, 110, 255),
                TextAlign::Left,
                None,
            );

            // Action buttons
            if panel == ProgressPanelKind::Bag {
                draw_gui_button(
                    c,
                    ox + 146.0,
                    oy + 344.0,
                    56.0,
                    22.0,
                    "分解",
                    is_hovered(ox + 146.0, oy + 344.0, 56.0, 22.0),
                );
            }
            draw_gui_button(
                c,
                ox + 210.0,
                oy + 344.0,
                56.0,
                22.0,
                "关闭",
                is_hovered(ox + 210.0, oy + 344.0, 56.0, 22.0),
            );
        }
        ProgressPanelKind::Quest => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
            draw_gui_window(c, sprites, GUI_QUEST_RECT, ox, oy);
            c.fill_text(
                "任务日志 (L)",
                ox + 145.0,
                oy + 20.0,
                11.0,
                Rgba::new(245, 218, 140, 255),
                TextAlign::Center,
                None,
            );

            let mut detail_idx = 0usize;
            for (i, q) in QUESTS.iter().enumerate() {
                let rx = ox + 22.0;
                let ry = oy + 32.0 + i as f32 * 38.0;
                let hov = is_hovered(rx, ry, 228.0, 34.0);
                if hov {
                    detail_idx = i;
                }
                let qp = progress.quests.get(q.id);
                let prog = qp.map(|p| p.progress).unwrap_or(0);
                let (tag, tag_col) = match qp.map(|p| (&p.state, p.done)) {
                    Some((progress_rs::QuestState::TurnedIn, _)) => {
                        ("[已完成]", Rgba::new(150, 160, 175, 220))
                    }
                    Some((progress_rs::QuestState::Active, true)) => {
                        ("[可交付]", Rgba::new(115, 235, 130, 255))
                    }
                    Some((progress_rs::QuestState::Active, false)) => {
                        ("[进行中]", Rgba::new(125, 200, 255, 255))
                    }
                    _ => ("[可接]", Rgba::new(255, 215, 110, 255)),
                };
                if hov {
                    c.fill_rect(rx, ry, 228.0, 34.0, Rgba::new(72, 62, 40, 160));
                    c.stroke_rect(rx, ry, 228.0, 34.0, Rgba::new(245, 210, 120, 230), 1.0);
                }
                c.fill_text(
                    &format!("[{}] {tag}", i + 1),
                    rx + 6.0,
                    ry + 14.0,
                    10.5,
                    tag_col,
                    TextAlign::Left,
                    None,
                );
                c.fill_text(
                    q.title,
                    rx + 74.0,
                    ry + 14.0,
                    10.5,
                    Rgba::new(238, 242, 250, 245),
                    TextAlign::Left,
                    None,
                );
                c.fill_text(
                    &format!("进度: {prog}/{}  (点击或按 {} 交互)", q.goal, i + 1),
                    rx + 6.0,
                    ry + 28.0,
                    9.5,
                    Rgba::new(185, 195, 210, 225),
                    TextAlign::Left,
                    None,
                );
            }

            // Bottom detail / reward area
            if let Some(q) = QUESTS.get(detail_idx) {
                c.fill_text(
                    &format!("任务奖励 · {}", q.title),
                    ox + 26.0,
                    oy + 242.0,
                    11.0,
                    Rgba::new(245, 216, 130, 255),
                    TextAlign::Left,
                    None,
                );
                if let Some(gui) = sprites.get("gui") {
                    c.draw_image(
                        gui,
                        GUI_GOLD_RECT[0],
                        GUI_GOLD_RECT[1],
                        GUI_GOLD_RECT[2],
                        GUI_GOLD_RECT[3],
                        ox + 28.0,
                        oy + 256.0,
                        17.0,
                        21.0,
                        false,
                        1.0,
                        0.0,
                    );
                }
                c.fill_text(
                    &format!("{} 金币", q.reward.gold),
                    ox + 50.0,
                    oy + 271.0,
                    11.0,
                    Rgba::new(255, 220, 110, 255),
                    TextAlign::Left,
                    None,
                );
                if let Some(item_id) = q.reward.item {
                    draw_item_icon(c, sprites, item_id, ox + 132.0, oy + 252.0, 28.0);
                    let iname = progress_rs::item_spec(item_id)
                        .map(|s| s.name)
                        .unwrap_or(item_id);
                    c.fill_text(
                        iname,
                        ox + 166.0,
                        oy + 271.0,
                        11.0,
                        Rgba::new(235, 240, 250, 245),
                        TextAlign::Left,
                        None,
                    );
                }
            }

            draw_gui_button(
                c,
                ox + 210.0,
                oy + 342.0,
                56.0,
                22.0,
                "关闭",
                is_hovered(ox + 210.0, oy + 342.0, 56.0, 22.0),
            );
        }
        ProgressPanelKind::Shop => {
            let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
            draw_gui_window(c, sprites, GUI_SHOP_RECT, ox, oy);
            // Fill transparent portrait cutout with dark backing
            c.fill_rect(ox + 28.0, oy + 25.0, 72.0, 77.0, Rgba::new(16, 18, 24, 245));

            let items = shop_items();
            let mut preview_idx = 0usize;
            for (idx, it) in items
                .iter()
                .take(SHOP_GRID_COLS * SHOP_GRID_ROWS)
                .enumerate()
            {
                let col = idx % SHOP_GRID_COLS;
                let row = idx / SHOP_GRID_COLS;
                let gx = ox + SHOP_GRID_X + col as f32 * GRID_PITCH;
                let gy = oy + SHOP_GRID_Y + row as f32 * GRID_PITCH;
                draw_item_icon(c, sprites, it.id, gx, gy + 1.0, 28.0);
                if idx < 9 {
                    c.fill_text(
                        &format!("{}", idx + 1),
                        gx + 2.0,
                        gy + 10.0,
                        9.0,
                        Rgba::new(255, 224, 130, 230),
                        TextAlign::Left,
                        None,
                    );
                }
                if is_hovered(gx, gy, GRID_CELL_W, GRID_CELL_H) {
                    preview_idx = idx;
                    c.stroke_rect(
                        gx,
                        gy,
                        GRID_CELL_W,
                        GRID_CELL_H,
                        Rgba::new(255, 226, 130, 255),
                        1.5,
                    );
                }
            }

            // Top preview box (selected/hovered item + player gold)
            if let Some(it) = items.get(preview_idx) {
                draw_item_icon(c, sprites, it.id, ox + 46.0, oy + 44.0, 36.0);
                c.fill_text(
                    it.name,
                    ox + 108.0,
                    oy + 44.0,
                    12.0,
                    Rgba::new(255, 226, 130, 255),
                    TextAlign::Left,
                    None,
                );
                c.fill_text(
                    &format!("价格: {}G  (金币: {}G)", it.price, progress.gold),
                    ox + 108.0,
                    oy + 62.0,
                    10.0,
                    Rgba::new(240, 210, 120, 240),
                    TextAlign::Left,
                    None,
                );
                c.fill_text(
                    it.note,
                    ox + 108.0,
                    oy + 78.0,
                    9.5,
                    Rgba::new(205, 215, 230, 235),
                    TextAlign::Left,
                    None,
                );
                c.fill_text(
                    "点击图标或按 1-8 购买",
                    ox + 108.0,
                    oy + 94.0,
                    9.5,
                    Rgba::new(150, 220, 165, 230),
                    TextAlign::Left,
                    None,
                );
            }

            // Bottom native cutout buttons
            draw_gui_button(c, ox + 94.0, oy + 331.0, 42.0, 22.0, "商店", false);
            draw_gui_button(
                c,
                ox + 138.0,
                oy + 331.0,
                46.0,
                22.0,
                "关闭",
                is_hovered(ox + 138.0, oy + 331.0, 46.0, 22.0),
            );
        }
        ProgressPanelKind::None => {}
    }
}

pub fn draw_loadout_panel(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    loadout: &[Option<String>],
    selected_slot: usize,
    hover_pos: Option<(f32, f32)>,
) {
    let (ox, oy) = panel_origin(GUI_WIN_W, GUI_SHOP_H);
    draw_gui_window(c, sprites, GUI_SHOP_RECT, ox, oy);
    // Dark backing across top box so quickbar slots are crisp
    c.fill_rect(
        ox + 26.0,
        oy + 23.0,
        228.0,
        81.0,
        Rgba::new(16, 19, 28, 245),
    );

    let is_hovered = |x: f32, y: f32, w: f32, h: f32| -> bool {
        hover_pos.is_some_and(|(hx, hy)| point_in_rect(hx, hy, x, y, w, h))
    };

    c.fill_text(
        "技能快捷栏配置 (B)",
        ox + 145.0,
        oy + 19.0,
        11.0,
        Rgba::new(245, 218, 140, 255),
        TextAlign::Center,
        None,
    );

    let keys = ["A", "S", "D", "F", "G", "H"];
    for (i, key_label) in keys.iter().enumerate() {
        let sx = ox + 32.0 + i as f32 * 38.0;
        let sy = oy + 34.0;
        let is_sel = i == selected_slot;
        let hov = is_hovered(sx, sy, 32.0, 32.0);
        c.fill_rect(sx, sy, 32.0, 32.0, Rgba::new(22, 26, 36, 240));
        if let Some(skill_id) = loadout.get(i).and_then(|s| s.as_deref()) {
            if let Some(s_idx) = core_rs::TABLES
                .skill_order
                .iter()
                .position(|id| id == skill_id)
            {
                if let Some(sheet) = sprites.get("skills") {
                    c.draw_image(
                        sheet,
                        (s_idx as u32) * 32,
                        0,
                        32,
                        32,
                        sx + 2.0,
                        sy + 2.0,
                        28.0,
                        28.0,
                        false,
                        1.0,
                        0.0,
                    );
                }
            }
        }
        let border = if is_sel {
            Rgba::new(255, 224, 110, 255)
        } else if hov {
            Rgba::new(210, 190, 130, 235)
        } else {
            Rgba::new(110, 96, 70, 200)
        };
        c.stroke_rect(sx, sy, 32.0, 32.0, border, if is_sel { 2.0 } else { 1.0 });
        c.fill_text(
            key_label,
            sx + 3.0,
            sy + 11.0,
            9.5,
            Rgba::new(255, 235, 160, 255),
            TextAlign::Left,
            None,
        );
    }

    // Cycle buttons + selected slot skill label
    draw_gui_button(
        c,
        ox + 32.0,
        oy + 76.0,
        24.0,
        20.0,
        "<",
        is_hovered(ox + 32.0, oy + 76.0, 24.0, 20.0),
    );
    draw_gui_button(
        c,
        ox + 230.0,
        oy + 76.0,
        24.0,
        20.0,
        ">",
        is_hovered(ox + 230.0, oy + 76.0, 24.0, 20.0),
    );
    let sel_key = keys.get(selected_slot).copied().unwrap_or("A");
    let sel_skill_id = loadout.get(selected_slot).and_then(|s| s.as_deref());
    let sel_name = sel_skill_id
        .and_then(|id| {
            core_rs::TABLES
                .skills
                .get(id)
                .map(|sk| sk.name.as_str())
                .or(Some(id))
        })
        .unwrap_or("空");
    c.fill_text(
        &format!("[{sel_key}] {sel_name}"),
        ox + 143.0,
        oy + 90.0,
        11.0,
        Rgba::new(255, 230, 145, 255),
        TextAlign::Center,
        None,
    );

    // 7x6 skill library grid using native `skills.png` icons
    let mut hovered_skill: Option<&str> = None;
    for (idx, skill_id) in core_rs::TABLES
        .skill_order
        .iter()
        .take(SHOP_GRID_COLS * SHOP_GRID_ROWS)
        .enumerate()
    {
        let col = idx % SHOP_GRID_COLS;
        let row = idx / SHOP_GRID_COLS;
        let gx = ox + SHOP_GRID_X + col as f32 * GRID_PITCH;
        let gy = oy + SHOP_GRID_Y + row as f32 * GRID_PITCH;
        if let Some(sheet) = sprites.get("skills") {
            c.draw_image(
                sheet,
                (idx as u32) * 32,
                0,
                32,
                32,
                gx,
                gy + 1.0,
                28.0,
                28.0,
                false,
                1.0,
                0.0,
            );
        }
        let is_assigned = sel_skill_id == Some(skill_id.as_str());
        let hov = is_hovered(gx, gy, GRID_CELL_W, GRID_CELL_H);
        if is_assigned {
            c.stroke_rect(
                gx,
                gy,
                GRID_CELL_W,
                GRID_CELL_H,
                Rgba::new(255, 215, 90, 255),
                1.8,
            );
        } else if hov {
            c.stroke_rect(
                gx,
                gy,
                GRID_CELL_W,
                GRID_CELL_H,
                Rgba::new(235, 240, 255, 235),
                1.4,
            );
        }
        if hov {
            hovered_skill = core_rs::TABLES
                .skills
                .get(skill_id)
                .map(|sk| sk.name.as_str())
                .or(Some(skill_id.as_str()));
        }
    }

    let hint = hovered_skill.map_or_else(
        || "点击槽位/技能图标配置 · 1-6 / ←→ / Esc".to_string(),
        |name| format!("点击装备技能: {name}"),
    );
    c.fill_text(
        &hint,
        ox + 145.0,
        oy + 324.0,
        9.5,
        Rgba::new(220, 228, 240, 235),
        TextAlign::Center,
        None,
    );

    draw_gui_button(
        c,
        ox + 138.0,
        oy + 331.0,
        46.0,
        22.0,
        "关闭",
        is_hovered(ox + 138.0, oy + 331.0, 46.0, 22.0),
    );
}
