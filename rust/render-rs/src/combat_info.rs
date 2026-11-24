//! Combat info HUD & world overlays (Ticket 05):
//! - Top-left target panel (avatar, `[人型]`/`[野兽]` race badge, Lv + name, full-width multi-layer boss HP bar)
//! - Top-left combat loot log (underneath target bar; gold Exp/SP/gold, cyan/white/purple item lines)
//! - Right-side persistent live combat rating panel (操作%, 技巧%, 被击数, 评分; metallic italic style, frozen on clear)
//! - Ground loot nameplates (translucent dark rounded plates above dropped gold/materials/equipment)

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::sprites::SpriteStore;
use crate::tables::rect_at;
use core_rs::combat::rating_of;
use core_rs::constants::*;
use core_rs::types::{Enemy, Pickup, State, TargetState};

const TARGET_DEATH_PERIOD: f64 = 0.5;
const TARGET_DEATH_ON: f64 = 0.25;

/// Logical position of the top-left combat loot log (720×540 logical space, mapped to 800×600).
pub const COMBAT_LOG_X: f32 = VIEW_LEFT as f32 + 22.5;
pub const COMBAT_LOG_TOP: f32 = 102.0;
pub const COMBAT_LOG_ROW: f32 = 16.85;
pub const COMBAT_LOG_FONT_SIZE: f32 = 12.5;

/// Logical position of the right-side persistent live combat rating panel.
pub const RATING_PANEL_TOP: f32 = 347.0;
pub const RATING_PANEL_ROW: f32 = 17.5;
pub const RATING_PANEL_VALUE_RIGHT: f32 = VIEW_LEFT as f32 + 667.5;
pub const RATING_PANEL_LABEL_RIGHT: f32 = VIEW_LEFT as f32 + 708.0;

/// Visual HP layer stack for bosses (`BOSS_HP_LAYERS` in `render.js`, ADR 0060/0064).
pub fn boss_hp_layers(kind: &str) -> &'static [&'static str] {
    match kind {
        "boss" => &["alertRed", "alertOrange", "alertGreen"],
        "lugaruBoss" | "deepBoss" => &["alertRed", "alertOrange"],
        _ => &["alertRed"],
    }
}

/// Observed reference HP track width per stage/type/level (`TARGET_WIDTHS` in `render.js`).
pub fn target_track_width(stage_id: &str, enemy: &Enemy) -> f32 {
    match (stage_id, enemy.kind.as_str(), enemy.level) {
        ("mirkwood", "grunt", 4) => 181.0,
        ("mirkwood", "goblinBlue" | "goblinRed" | "caster", 4) => 144.0,
        ("mirkwood", "burningThrower", 4) => 217.0,
        ("mirkwooddeep", "grunt", 4) => 116.0,
        ("mirkwooddeep", "goblinBlue", 6) => 144.0,
        ("mirkwooddeep", "goblinRed", 5) => 116.0,
        ("mirkwooddeep", "goblinRed", 6) => 144.0,
        ("mirkwooddeep", "cat" | "throwerElite", 6) => 162.0,
        ("mirkwooddeep", "cat" | "throwerElite", 7) => 196.0,
        ("mirkwooddeep", "deepElite", 6) => 198.0,
        ("mirkwooddeep", "deepElite", 7) => 240.0,
        _ => 181.0,
    }
}

/// Whether the blinking red death cross on the target avatar is lit on this frame.
pub fn death_cross_visible(enemy: &Enemy, target: &TargetState) -> bool {
    if !enemy.dead {
        return false;
    }
    let age = target.dying.max(0.0);
    ((age + 1e-9) % TARGET_DEATH_PERIOD) < TARGET_DEATH_ON
}

/// Color tone for combat loot log entries matching V1 95s/290s and V2 60s/260s/310s.
pub fn log_tone_color(tone: &str) -> Rgba {
    match tone {
        "gold" => Rgba::new(226, 206, 154, 245),
        "cyan" => Rgba::new(112, 224, 240, 245),
        "purple" => Rgba::new(202, 134, 255, 245),
        "orange" => Rgba::new(236, 118, 56, 245),
        _ => Rgba::new(241, 244, 245, 245),
    }
}

/// Display text for a ground drop nameplate (`65G` for gold coins, item name for loot).
pub fn loot_plate_label(drop: &Pickup) -> String {
    if drop.kind == "gold" {
        format!("{}G", drop.gold)
    } else {
        drop.name.clone()
    }
}

/// Whether the player is standing within pickup reach of a ground drop.
pub fn loot_within_reach(state: &State, drop: &Pickup) -> bool {
    if state.player.dead {
        return false;
    }
    let on_row = (state.player.z - drop.z).abs() <= DEPTH_REACH_MELEE * SLAYER_HEIGHT;
    on_row && (state.player.x - drop.x).abs() <= LOOT_REACH + state.player.width * 0.5
}

fn boss_tile_rect(name: &str) -> [u32; 4] {
    match name {
        "alertGreen" => rect_at(&["PORTRAITS", "alertGreen"]).unwrap_or([3063, 0, 38, 26]),
        "alertOrange" => rect_at(&["PORTRAITS", "alertOrange"]).unwrap_or([3025, 0, 38, 26]),
        _ => rect_at(&["PORTRAITS", "alertRed"]).unwrap_or([2987, 0, 38, 26]),
    }
}

fn draw_race_badge_and_name(
    c: &mut Canvas<'_>,
    enemy: &Enemy,
    tag_x: f32,
    tag_y: f32,
    is_boss: bool,
) {
    let race = if enemy.race.is_empty() {
        if is_boss || matches!(enemy.kind.as_str(), "brute" | "cat") {
            "野兽"
        } else {
            "人型"
        }
    } else {
        enemy.race.as_str()
    };
    let tag_w = 34.0f32;
    let tag_h = 14.0f32;
    c.fill_round_rect(tag_x, tag_y, tag_w, tag_h, 2.0, Rgba::new(6, 6, 8, 245));
    c.stroke_round_rect(
        tag_x,
        tag_y,
        tag_w,
        tag_h,
        2.0,
        Rgba::new(216, 130, 70, 255),
        1.5,
    );
    c.fill_text(
        race,
        tag_x + tag_w * 0.5,
        tag_y + 10.8,
        10.5,
        Rgba::new(243, 141, 76, 255),
        TextAlign::Center,
        None,
    );
    let label = format!("Lv{} {}", enemy.level, enemy.label);
    c.fill_text(
        &label,
        tag_x + tag_w + 5.0,
        tag_y + 11.2,
        11.8,
        Rgba::new(236, 242, 250, 255),
        TextAlign::Left,
        Some(Rgba::new(0, 0, 0, 240)),
    );
}

/// Top-left target panel with avatar, `[人型]`/`[野兽]` race badge, `LvX <name>`,
/// and full-width multi-layer boss HP bar (crimson on final bar, V1 290s).
pub fn draw_target_panel(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let Some(ref target) = state.target else {
        return;
    };
    let enemy = &target.enemy;
    let is_boss = enemy.behavior == "boss";
    let is_champ = !is_boss && enemy.champion.is_some();
    let x = VIEW_LEFT as f32 + 6.0;
    let y = 45.5f32;
    let s = 1.125f32;

    if let Some(psheet) = sprites.get("portraits") {
        let pkey = if enemy.kind == "deepBoss" || enemy.kind == "lugaruBoss" {
            "lugaruBoss"
        } else if is_boss {
            "boss"
        } else if enemy.kind == "cursedRed" {
            "goblinRed"
        } else if enemy.kind == "burningThrower" {
            "caster"
        } else if enemy.kind == "charger" {
            "grunt"
        } else {
            enemy.kind.as_str()
        };
        let face_rect = rect_at(&["PORTRAITS", pkey]).or_else(|| rect_at(&["PORTRAITS", "grunt"]));
        let frame_rect = if is_boss {
            [2353u32, 0, 630, 36]
        } else if is_champ {
            [1721, 0, 628, 36]
        } else {
            [495, 0, 626, 32]
        };
        let cap_rect = if is_boss {
            [2983u32, 0, 4, 36]
        } else if is_champ {
            [2349, 0, 4, 19]
        } else {
            [1718, 0, 3, 17]
        };
        let (fx, fy) = if is_boss {
            (5.0f32, 3.0f32)
        } else if is_champ {
            (4.0, 4.0)
        } else {
            (2.0, 2.0)
        };
        let fill_x = if is_boss {
            x + 38.25
        } else {
            x + if is_champ { 34.0 } else { 29.0 } * s
        };
        let fill_y = if is_boss {
            y + 3.375
        } else {
            y + if is_champ { 19.0 } else { 17.0 } * s
        };
        let fill_w = if is_boss {
            534.0f32
        } else {
            target_track_width(&state.stage_id, enemy)
        };
        let fill_h = if is_boss { 29.25f32 } else { 9.0 * s };
        let end_x = fill_x + fill_w;

        c.save();
        c.set_clip_rect(x, y, end_x - x, frame_rect[3] as f32 * s);
        c.draw_image(
            psheet,
            frame_rect[0],
            frame_rect[1],
            frame_rect[2],
            frame_rect[3],
            x,
            y,
            frame_rect[2] as f32 * s,
            frame_rect[3] as f32 * s,
            false,
            1.0,
            0.0,
        );
        c.restore();

        let cap_y = y + if is_boss {
            0.0
        } else if is_champ {
            16.0
        } else {
            15.0
        } * s;
        c.draw_image(
            psheet,
            cap_rect[0],
            cap_rect[1],
            cap_rect[2],
            cap_rect[3],
            end_x,
            cap_y,
            cap_rect[2] as f32 * s,
            cap_rect[3] as f32 * s,
            false,
            1.0,
            0.0,
        );

        if let Some([fsx, fsy, fsw, fsh]) = face_rect {
            c.draw_image(
                psheet,
                fsx,
                fsy,
                fsw,
                fsh,
                x + fx * s,
                y + fy * s,
                24.0 * s,
                24.0 * s,
                false,
                1.0,
                0.0,
            );
        }

        let layers = boss_hp_layers(&enemy.kind);
        let raw_share = if !enemy.dead && enemy.max_hp > 0.0 {
            (enemy.hp / enemy.max_hp).clamp(0.0, 1.0) as f32
        } else {
            0.0
        };
        if !enemy.dead {
            if is_boss {
                let layer_count = layers.len() as f32;
                let amount = raw_share * layer_count;
                let idx = ((amount.ceil() as i32) - 1).clamp(0, layers.len() as i32 - 1) as usize;
                let share = (amount - idx as f32).clamp(0.0, 1.0);
                let tile_w = 42.75f32;
                if idx >= 1 {
                    let bot_rect = boss_tile_rect(layers[idx - 1]);
                    c.save();
                    c.set_clip_rect(fill_x, fill_y, fill_w, fill_h);
                    let mut tx = fill_x;
                    while tx < end_x {
                        c.draw_image(
                            psheet,
                            bot_rect[0],
                            bot_rect[1],
                            bot_rect[2],
                            bot_rect[3],
                            tx,
                            fill_y,
                            tile_w,
                            fill_h,
                            false,
                            1.0,
                            0.0,
                        );
                        tx += tile_w;
                    }
                    c.restore();
                }
                if share > 0.0 {
                    let top_rect = boss_tile_rect(layers[idx]);
                    c.save();
                    c.set_clip_rect(fill_x, fill_y, fill_w * share, fill_h);
                    let mut tx = fill_x;
                    while tx < end_x {
                        c.draw_image(
                            psheet,
                            top_rect[0],
                            top_rect[1],
                            top_rect[2],
                            top_rect[3],
                            tx,
                            fill_y,
                            tile_w,
                            fill_h,
                            false,
                            1.0,
                            0.0,
                        );
                        tx += tile_w;
                    }
                    c.restore();
                }
            } else if raw_share > 0.0 {
                c.save();
                c.set_clip_rect(fill_x, fill_y, fill_w * raw_share, fill_h);
                c.draw_image(
                    psheet, 1121, 0, 597, 9, fill_x, fill_y, fill_w, fill_h, false, 1.0, 0.0,
                );
                c.restore();
            }
        }

        if let Some(ref g) = target.ghost {
            let mut from = g.from as f32;
            let mut to = g.to as f32;
            if is_boss {
                let layer_count = layers.len() as f32;
                let idx = ((raw_share * layer_count).ceil() as i32 - 1).max(0) as f32;
                from = from * layer_count - idx;
                to = to * layer_count - idx;
            }
            let from = from.clamp(0.0, 1.0);
            let to = to.clamp(0.0, 1.0);
            let gw = ((from - to) * fill_w).max(0.0);
            let ga = (1.0 - (g.t / TARGET_GHOST_FADE) as f32).clamp(0.0, 1.0) * 0.95;
            if gw > 0.0 && ga > 0.01 {
                c.fill_rect(
                    fill_x + fill_w * to,
                    fill_y,
                    gw,
                    fill_h,
                    Rgba::new(248, 236, 229, 255).with_alpha(ga),
                );
            }
        }

        if death_cross_visible(enemy, target) {
            let cross_x = if is_boss { x + 5.0 } else { x + 1.5 };
            let cross_y = if is_boss { y + 3.0 } else { y + 1.0 };
            c.draw_image(
                psheet, 471, 0, 24, 24, cross_x, cross_y, 28.0, 28.0, false, 1.0, 0.0,
            );
        }

        let tag_x = if is_boss {
            x + 44.0
        } else {
            x + if is_champ { 36.0 } else { 32.0 } * s
        };
        let tag_y = if is_boss { fill_y + 7.0 } else { y };
        draw_race_badge_and_name(c, enemy, tag_x, tag_y, is_boss);
    } else {
        // Clean procedural fallback when portraits-reference.png is unavailable
        let portrait_s = if is_boss { 36.0f32 } else { 28.0f32 };
        let fill_x = x + portrait_s + 3.0;
        let fill_w = if is_boss {
            534.0f32
        } else {
            target_track_width(&state.stage_id, enemy)
        };
        let fill_h = if is_boss { 29.0f32 } else { 10.0f32 };
        let fill_y = if is_boss { y + 3.5 } else { y + 18.0 };

        c.fill_rect(x, y, portrait_s, portrait_s, Rgba::new(10, 12, 20, 235));
        c.stroke_rect(
            x,
            y,
            portrait_s,
            portrait_s,
            Rgba::new(212, 192, 159, 235),
            1.5,
        );
        c.fill_rect(fill_x, fill_y, fill_w, fill_h, Rgba::new(10, 8, 12, 235));
        let share = if !enemy.dead && enemy.max_hp > 0.0 {
            (enemy.hp / enemy.max_hp).clamp(0.0, 1.0) as f32
        } else {
            0.0
        };
        if share > 0.0 {
            c.fill_rect(
                fill_x + 1.0,
                fill_y + 1.0,
                (fill_w - 2.0) * share,
                fill_h - 2.0,
                Rgba::new(214, 18, 22, 255),
            );
        }
        c.stroke_rect(
            fill_x,
            fill_y,
            fill_w,
            fill_h,
            Rgba::new(213, 186, 156, 230),
            1.5,
        );
        let tag_x = fill_x + if is_boss { 6.0 } else { 2.0 };
        let tag_y = if is_boss { fill_y + 7.0 } else { y };
        draw_race_badge_and_name(c, enemy, tag_x, tag_y, is_boss);
    }
}

/// Top-left combat loot log directly underneath the target bar (V1 95s/290s, V2 60s/260s/310s).
/// No background box; up to 8 fixed slots scrolling upward as older lines drop off the top.
pub fn draw_combat_log(c: &mut Canvas<'_>, state: &State) {
    if state.log.is_empty() {
        return;
    }
    let outline = Rgba::new(8, 10, 16, 235);
    for (i, entry) in state.log.iter().enumerate() {
        let baseline_y = COMBAT_LOG_TOP + COMBAT_LOG_FONT_SIZE * 0.85 + i as f32 * COMBAT_LOG_ROW;
        let col = log_tone_color(&entry.tone);
        c.fill_text(
            &entry.text,
            COMBAT_LOG_X,
            baseline_y,
            COMBAT_LOG_FONT_SIZE,
            col,
            TextAlign::Left,
            Some(outline),
        );
    }
}

/// Draw native DNF white metallic italic digits from `results-reference.png` (`drawStatsNumber` "combat").
fn draw_combat_stat_digits(
    c: &mut Canvas<'_>,
    sheet: &tiny_skia::Pixmap,
    text: &str,
    right_x: f32,
    y: f32,
    alpha: f32,
) -> bool {
    const DIGITS: [[u32; 4]; 10] = [
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
    const PERCENT: [u32; 4] = [6651, 0, 15, 13];
    const MINUS: [u32; 4] = [6666, 0, 13, 9];
    const SCALE: f32 = 1.125;
    const OVERLAP: f32 = 2.0;

    let mut glyphs: Vec<[u32; 4]> = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let g = match ch {
            '0'..='9' => DIGITS[(ch as u8 - b'0') as usize],
            '%' => PERCENT,
            '-' => MINUS,
            _ => return false,
        };
        glyphs.push(g);
    }
    if glyphs.is_empty() {
        return false;
    }
    let total_w: f32 = glyphs.iter().map(|g| (g[2] as f32 - OVERLAP) * SCALE).sum();
    let mut x = right_x - total_w;
    for g in glyphs {
        c.draw_image(
            sheet,
            g[0],
            g[1],
            g[2],
            g[3],
            x,
            y,
            g[2] as f32 * SCALE,
            g[3] as f32 * SCALE,
            false,
            alpha,
            0.0,
        );
        x += (g[2] as f32 - OVERLAP) * SCALE;
    }
    true
}

/// Right-side persistent live combat rating panel (`操作`, `技巧`, `被击数`, `评分`).
/// Driven by `core_rs::combat::rating_of(state)` (updates live in combat; freezes on clear).
pub fn draw_rating_panel(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let rating = rating_of(state);
    let rows = [
        (format!("{}%", rating.operation), "操作"),
        (format!("{}%", rating.technique), "技巧"),
        (rating.hits.to_string(), "被击数"),
        (rating.grade.clone(), "评分"),
    ];
    let native_labels: [([u32; 4], [f32; 2]); 4] = [
        (
            rect_at(&["RESULT_ART", "combatOperation"]).unwrap_or([7530, 0, 31, 18]),
            [VIEW_LEFT as f32 + 677.0, 347.0],
        ),
        (
            rect_at(&["RESULT_ART", "combatTechnique"]).unwrap_or([7561, 0, 31, 18]),
            [VIEW_LEFT as f32 + 678.0, 365.0],
        ),
        (
            rect_at(&["RESULT_ART", "combatHits"]).unwrap_or([7592, 0, 42, 18]),
            [VIEW_LEFT as f32 + 664.0, 383.0],
        ),
        (
            rect_at(&["RESULT_ART", "combatRating"]).unwrap_or([7634, 0, 28, 18]),
            [VIEW_LEFT as f32 + 677.0, 400.0],
        ),
    ];
    let results_sheet = sprites.get("results");
    let alpha = 0.88f32;
    let scale = 1.125f32;

    for (idx, (val, label)) in rows.iter().enumerate() {
        let y = RATING_PANEL_TOP + idx as f32 * RATING_PANEL_ROW;
        let drawn_digits = if idx < 3 {
            if let Some(sheet) = results_sheet {
                let right_x = VIEW_LEFT as f32 + if idx == 2 { 658.75 } else { 669.0 };
                draw_combat_stat_digits(c, sheet, val, right_x, y + 2.0, alpha)
            } else {
                false
            }
        } else {
            false
        };
        if !drawn_digits {
            let value_x = match idx {
                2 => RATING_PANEL_VALUE_RIGHT - 10.0,
                3 => RATING_PANEL_VALUE_RIGHT - 7.0,
                _ => RATING_PANEL_VALUE_RIGHT,
            };
            c.fill_text_metallic_italic(val, value_x, y + 13.5, 13.5, TextAlign::Right, alpha);
        }

        if let Some(sheet) = results_sheet {
            let (rect, pos) = native_labels[idx];
            c.draw_image(
                sheet,
                rect[0],
                rect[1],
                rect[2],
                rect[3],
                pos[0],
                pos[1],
                rect[2] as f32 * scale,
                rect[3] as f32 * scale,
                false,
                alpha,
                0.0,
            );
        } else {
            c.fill_text_metallic_italic(
                label,
                RATING_PANEL_LABEL_RIGHT,
                y + 13.5,
                13.0,
                TextAlign::Right,
                alpha,
            );
        }
    }
}

/// Select the cell index in `assets/ground-loot.png` (8 x 48x48 cells) for a ground pickup.
///
/// Layout:
/// - 0: gold coin pile
/// - 1: red HP potion vial
/// - 2: blue MP potion vial
/// - 3: material pouch
/// - 4: fate / resurrect gold coin
/// - 5: rare crystal / gem pile
/// - 6: weapon (katana)
/// - 7: armor / equipment
pub fn ground_loot_cell(drop: &Pickup) -> u32 {
    if drop.kind == "gold" {
        return 0;
    }
    let name = drop.name.as_str();
    if name.contains("MP") || name.contains("魔力") || name.contains("魔法") {
        2
    } else if name.contains("HP") || name.contains("生命") || name.contains("药剂") {
        1
    } else if name.contains("硬币") || name.contains("复活币") {
        4
    } else if name.contains("太刀")
        || name.contains("剑")
        || name.contains("法杖")
        || name.contains("图腾")
        || name.contains("斧")
        || name.contains("枪")
        || name.contains("棒")
    {
        6
    } else if name.contains("护")
        || name.contains("甲")
        || name.contains("靴")
        || name.contains("腰带")
        || name.contains("戒指")
        || name.contains("项链")
        || name.contains("手镯")
        || name.contains("衣")
        || name.contains("裤")
    {
        7
    } else if drop.tone == "purple"
        || name.contains("晶")
        || name.contains("宝石")
        || name.contains("魔石")
    {
        5
    } else {
        3
    }
}

/// Ground loot nameplate + authentic DNF field-drop sprite on the ground band (V2 60s/260s).
pub fn draw_loot_plate(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    drop: &Pickup,
    dx: f32,
    dy: f32,
) {
    // Subtle ground contact shadow beneath the dropped item
    c.fill_ellipse(dx, dy - 1.0, 10.5, 3.8, Rgba::new(0, 0, 0, 118));

    let mut plate_lift = 16.0f32;
    if let Some(sheet) = sprites.get("groundLoot") {
        const CELL: u32 = 48;
        let max_col = (sheet.width() / CELL).saturating_sub(1);
        let col = ground_loot_cell(drop).min(max_col);
        let draw_sz = 34.0f32;
        // Ground anchor inside each 48x48 cell is at y=44 -> align bottom flush with `dy + 2`
        c.draw_image(
            sheet,
            col * CELL,
            0,
            CELL,
            CELL,
            dx - draw_sz * 0.5,
            dy - draw_sz + 3.0,
            draw_sz,
            draw_sz,
            false,
            1.0,
            0.0,
        );
        plate_lift = 19.0;
    } else if drop.kind == "gold" {
        c.fill_ellipse(dx - 2.0, dy - 3.0, 3.6, 2.2, Rgba::new(235, 188, 52, 255));
        c.fill_ellipse(dx + 2.2, dy - 2.5, 3.4, 2.0, Rgba::new(252, 224, 96, 255));
        c.stroke_ellipse(
            dx - 2.0,
            dy - 3.0,
            3.6,
            2.2,
            Rgba::new(120, 82, 16, 220),
            0.9,
        );
    } else {
        let item_col = match drop.tone.as_str() {
            "cyan" => Rgba::new(110, 214, 232, 245),
            "purple" => Rgba::new(196, 126, 248, 245),
            _ => Rgba::new(208, 204, 194, 245),
        };
        c.fill_round_rect(dx - 5.0, dy - 7.0, 10.0, 6.0, 2.0, item_col);
        c.stroke_round_rect(
            dx - 5.0,
            dy - 7.0,
            10.0,
            6.0,
            2.0,
            Rgba::new(30, 34, 42, 230),
            1.0,
        );
    }

    let ready = loot_within_reach(state, drop);
    let label = loot_plate_label(drop);
    let font_size = 9.5f32;
    let text_w = c.fonts.measure_text(&label, font_size);
    let pw = (text_w + 14.0).max(32.0);
    let ph = 16.5f32;
    let plate_x = dx - pw * 0.5;
    let plate_y = dy - plate_lift - ph;

    c.fill_round_rect(plate_x, plate_y, pw, ph, 3.0, Rgba::new(10, 14, 20, 200));
    let edge_col = if ready {
        Rgba::new(198, 240, 74, 250)
    } else {
        Rgba::new(222, 228, 236, 230)
    };
    let edge_w = if ready { 1.8 } else { 1.3 };
    c.stroke_round_rect(plate_x, plate_y, pw, ph, 3.0, edge_col, edge_w);

    let text_col = match drop.tone.as_str() {
        "gold" => Rgba::new(240, 212, 122, 255),
        "cyan" => Rgba::new(126, 218, 228, 255),
        "purple" => Rgba::new(208, 142, 255, 255),
        _ => Rgba::new(242, 245, 248, 255),
    };
    c.fill_text(
        &label,
        dx,
        plate_y + ph - 4.5,
        font_size,
        text_col,
        TextAlign::Center,
        Some(Rgba::new(0, 0, 0, 200)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::GlyphCache;
    use crate::{RENDER_HEIGHT, RENDER_WIDTH};
    use core_rs::combat::{collect_gold, collect_loot, set_target};
    use core_rs::create_state;
    use core_rs::types::{CreateStateOptions, LogEntry};
    use std::path::Path;
    use tiny_skia::Pixmap;

    fn test_fonts() -> GlyphCache {
        for p in [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ] {
            if let Ok(bytes) = std::fs::read(p) {
                return GlyphCache::new(Some(&bytes));
            }
        }
        GlyphCache::new(None)
    }

    fn count_non_black_pixels(pixmap: &Pixmap, x0: u32, y0: u32, x1: u32, y1: u32) -> usize {
        let w = pixmap.width();
        let data = pixmap.data();
        let mut count = 0;
        for y in y0..y1.min(pixmap.height()) {
            for x in x0..x1.min(w) {
                let i = ((y * w + x) * 4) as usize;
                if data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15 {
                    count += 1;
                }
            }
        }
        count
    }

    #[test]
    fn test_boss_hp_layers_and_track_widths() {
        assert_eq!(
            boss_hp_layers("boss"),
            &["alertRed", "alertOrange", "alertGreen"]
        );
        assert_eq!(boss_hp_layers("lugaruBoss"), &["alertRed", "alertOrange"]);
        assert_eq!(boss_hp_layers("grunt"), &["alertRed"]);
    }

    #[test]
    fn test_death_cross_blinks_on_half_second_period() {
        let mut state = create_state(&CreateStateOptions::default());
        set_target(&mut state, 0);
        let mut target = state.target.clone().expect("target");
        target.enemy.dead = true;
        target.dying = 0.1;
        assert!(death_cross_visible(&target.enemy, &target));
        target.dying = 0.35;
        assert!(!death_cross_visible(&target.enemy, &target));
        target.dying = 0.6;
        assert!(death_cross_visible(&target.enemy, &target));
    }

    #[test]
    fn test_target_panel_renders_normal_and_boss_full_width_bar() {
        let sprites = SpriteStore::load_from_root(Path::new(".."));
        let mut fonts = test_fonts();

        // Normal goblin target
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        set_target(&mut state, 0);
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        pixmap.fill(tiny_skia::Color::BLACK);
        {
            let mut c = Canvas::new(&mut pixmap, &mut fonts);
            draw_target_panel(&mut c, &state, &sprites);
        }
        // Top-left target region (normal width ~220px) has pixels; far right of boss bar is empty
        assert!(count_non_black_pixels(&pixmap, 10, 45, 240, 100) > 500);
        assert_eq!(count_non_black_pixels(&pixmap, 450, 45, 620, 100), 0);

        // Boss target (full-width crimson bar at low HP)
        let boss_cell = state.dungeon.as_ref().map(|d| d.boss);
        let mut boss_state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            cell: boss_cell,
            reference_profile: true,
            ..Default::default()
        });
        let boss_idx = boss_state
            .enemies
            .iter()
            .position(|e| e.behavior == "boss")
            .expect("boss enemy");
        boss_state.enemies[boss_idx].hp = boss_state.enemies[boss_idx].max_hp * 0.25;
        set_target(&mut boss_state, boss_idx);
        let mut boss_pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        boss_pixmap.fill(tiny_skia::Color::BLACK);
        {
            let mut c = Canvas::new(&mut boss_pixmap, &mut fonts);
            draw_target_panel(&mut c, &boss_state, &sprites);
        }
        // Full-width boss bar extends past x=450 in 800x600
        assert!(count_non_black_pixels(&boss_pixmap, 450, 45, 620, 100) > 400);
    }

    #[test]
    fn test_combat_log_renders_underneath_top_left_target_bar() {
        let mut fonts = test_fonts();
        let mut state = create_state(&CreateStateOptions::default());
        state.log = vec![
            LogEntry {
                text: "获得40点经验值".to_string(),
                tone: "gold".to_string(),
            },
            LogEntry {
                text: "获得[生锈的铁片]1个".to_string(),
                tone: "cyan".to_string(),
            },
            LogEntry {
                text: "获得SP点数1".to_string(),
                tone: "gold".to_string(),
            },
        ];
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        pixmap.fill(tiny_skia::Color::BLACK);
        {
            let mut c = Canvas::new(&mut pixmap, &mut fonts);
            draw_combat_log(&mut c, &state);
        }
        // Top-left log region (y=105..220 in 800x600) has rendered text; bottom-left is clean
        assert!(count_non_black_pixels(&pixmap, 15, 105, 260, 220) > 100);
        assert_eq!(count_non_black_pixels(&pixmap, 15, 420, 260, 520), 0);
    }

    #[test]
    fn test_rating_panel_renders_on_right_side_and_respects_frozen_result() {
        let sprites = SpriteStore::load_from_root(Path::new(".."));
        let mut fonts = test_fonts();
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.stats.swings = 20;
        state.stats.swings_landed = 17; // 85%
        state.stats.combo_chains = 4;
        state.stats.combo_hits = 14;
        state.stats.hits_taken = 0;

        let live = rating_of(&state);
        assert_eq!(live.operation, 85);
        assert_eq!(live.hits, 0);
        assert_eq!(live.grade, "SS");

        // Freeze rating on stage clear and verify subsequent hits do not alter frozen rating
        state.result_rating = Some(live.clone());
        state.stats.hits_taken = 25;
        let frozen = rating_of(&state);
        assert_eq!(frozen.hits, 0);
        assert_eq!(frozen.grade, "SS");

        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        pixmap.fill(tiny_skia::Color::BLACK);
        {
            let mut c = Canvas::new(&mut pixmap, &mut fonts);
            draw_rating_panel(&mut c, &state, &sprites);
        }
        // Right side above bottom HUD (x=640..800, y=380..480 in 800x600) has rendered pixels
        assert!(count_non_black_pixels(&pixmap, 640, 380, 800, 480) > 250);
    }

    #[test]
    fn test_loot_plate_labels_and_pickup_writes_combat_log() {
        let mut state = create_state(&CreateStateOptions::default());
        let gold_drop = Pickup {
            kind: "gold".to_string(),
            name: "金币".to_string(),
            tone: "gold".to_string(),
            gold: 65,
            exp: 0,
            x: 320.0,
            y: ARENA_GROUND_Y,
            z: 60.0,
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        };
        let item_drop = Pickup {
            kind: "loot".to_string(),
            name: "生锈的铁片".to_string(),
            tone: "cyan".to_string(),
            gold: 44,
            exp: 0,
            x: 360.0,
            y: ARENA_GROUND_Y,
            z: 60.0,
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        };
        assert_eq!(loot_plate_label(&gold_drop), "65G");
        assert_eq!(loot_plate_label(&item_drop), "生锈的铁片");

        let sprites = SpriteStore::load_from_root(Path::new("../.."));
        assert!(
            sprites.get("groundLoot").is_some(),
            "SpriteStore must load assets/ground-loot.png"
        );
        assert_eq!(ground_loot_cell(&gold_drop), 0);
        assert_eq!(ground_loot_cell(&item_drop), 3);

        let mut potion_drop = item_drop.clone();
        potion_drop.name = "诺顿的新手HP药剂".to_string();
        assert_eq!(ground_loot_cell(&potion_drop), 1);

        let mut mp_drop = item_drop.clone();
        mp_drop.name = "诺顿的新手MP药剂".to_string();
        assert_eq!(ground_loot_cell(&mp_drop), 2);

        let mut coin_drop = item_drop.clone();
        coin_drop.name = "命运硬币".to_string();
        assert_eq!(ground_loot_cell(&coin_drop), 4);

        let mut weapon_drop = item_drop.clone();
        weapon_drop.name = "古老的太刀".to_string();
        assert_eq!(ground_loot_cell(&weapon_drop), 6);

        let mut fonts = test_fonts();
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        pixmap.fill(tiny_skia::Color::BLACK);
        {
            let mut c = Canvas::new(&mut pixmap, &mut fonts);
            draw_loot_plate(&mut c, &state, &sprites, &gold_drop, 320.0, 400.0);
            draw_loot_plate(&mut c, &state, &sprites, &item_drop, 420.0, 400.0);
        }
        // Verify both nameplates and authentic ground loot sprites rendered non-black pixels
        assert!(count_non_black_pixels(&pixmap, 180, 370, 460, 460) > 250);
        // Verify gold pile sprite itself has golden pixels on the ground band beneath the nameplate
        let gold_pixels = pixmap
            .data()
            .chunks_exact(4)
            .filter(|px| px[0] >= 200 && px[1] >= 150 && px[2] <= 80)
            .count();
        assert!(
            gold_pixels >= 40,
            "expected authentic gold pile sprite pixels, got {gold_pixels}"
        );

        state.log.clear();
        collect_loot(&mut state, &item_drop);
        collect_gold(&mut state, &gold_drop);
        assert_eq!(state.stats.gold, 109);
        assert_eq!(state.stats.loot, 2);
        assert!(state
            .log
            .iter()
            .any(|l| l.text == "获得[生锈的铁片]1个" && l.tone == "cyan"));
        assert!(state
            .log
            .iter()
            .any(|l| l.text == "获得65金币" && l.tone == "gold"));
    }

    #[test]
    fn test_full_frame_combat_info_renders_all_four_regions() {
        let sprites = SpriteStore::load_from_root(Path::new("../.."));
        let mut fonts = test_fonts();
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let loadout = vec![
            Some("upSlash".to_string()),
            Some("ghostSlash".to_string()),
            Some("normalWave".to_string()),
            None,
            None,
            None,
        ];

        // Full combat frame with normal target, combat log, live rating, and ground loot plates
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        state.enemies[0].hp = state.enemies[0].max_hp * 0.6;
        set_target(&mut state, 0);
        state.stats.swings = 20;
        state.stats.swings_landed = 17;
        state.stats.combo_chains = 4;
        state.stats.combo_hits = 14;
        state.log = vec![
            LogEntry {
                text: "获得40点经验值".to_string(),
                tone: "gold".to_string(),
            },
            LogEntry {
                text: "获得[最下级硬化剂]1个".to_string(),
                tone: "cyan".to_string(),
            },
            LogEntry {
                text: "获得[炉岩炭]1个".to_string(),
                tone: "cyan".to_string(),
            },
            LogEntry {
                text: "获得SP点数1".to_string(),
                tone: "gold".to_string(),
            },
            LogEntry {
                text: "获得65金币".to_string(),
                tone: "gold".to_string(),
            },
        ];
        state.pickups.push(Pickup {
            kind: "loot".to_string(),
            name: "生锈的铁片".to_string(),
            tone: "cyan".to_string(),
            gold: 44,
            exp: 0,
            x: state.player.x + 110.0,
            y: ARENA_GROUND_Y,
            z: state.player.z,
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        });
        state.pickups.push(Pickup {
            kind: "gold".to_string(),
            name: "金币".to_string(),
            tone: "gold".to_string(),
            gold: 65,
            exp: 0,
            x: state.player.x + 200.0,
            y: ARENA_GROUND_Y,
            z: state.player.z + 25.0,
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        });
        let meta = crate::RenderMeta {
            title: false,
            attract: false,
            paused: false,
            show_help: false,
            loadout: &loadout,
            loadout_open: false,
            progress_panel: crate::ProgressPanelKind::None,
            progress: &progress,
            records: &records,
            reward: None,
            region_open: false,
            region_selected: "mirkwood",
            hint: None,
            seed: state.seed,
            stage_id: &state.stage_id,
            map_mode: crate::MapMode::Radar,
            continue_hover: None,
            reward_card_hover: None,
        };
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pixmap, &mut fonts);
            crate::render(&mut c, &state, &sprites, &meta);
        }
        if let Ok(dir) = std::env::var("NANO_DNF_DUMP_T05") {
            let _ = std::fs::create_dir_all(&dir);
            let _ = pixmap.save_png(Path::new(&dir).join("t05_normal_combat.png"));
        }

        // Boss frame matching V1 290s (full-width crimson boss HP bar + [野兽] badge + log + rating)
        let boss_cell = state.dungeon.as_ref().map(|d| d.boss);
        let mut boss_state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            cell: boss_cell,
            reference_profile: true,
            ..Default::default()
        });
        boss_state.transition = 0.0;
        boss_state.intro_t = None;
        let boss_idx = boss_state
            .enemies
            .iter()
            .position(|e| e.behavior == "boss")
            .expect("boss");
        boss_state.enemies[boss_idx].hp = boss_state.enemies[boss_idx].max_hp * 0.28;
        set_target(&mut boss_state, boss_idx);
        boss_state.stats.swings = 20;
        boss_state.stats.swings_landed = 17;
        boss_state.stats.combo_chains = 4;
        boss_state.stats.combo_hits = 14;
        boss_state.stats.hits_taken = 12;
        boss_state.log = state.log.clone();
        let mut boss_pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("boss pixmap");
        {
            let mut c = Canvas::new(&mut boss_pixmap, &mut fonts);
            crate::render(&mut c, &boss_state, &sprites, &meta);
        }
        if let Ok(dir) = std::env::var("NANO_DNF_DUMP_T05") {
            let _ = boss_pixmap.save_png(Path::new(&dir).join("t05_boss_combat.png"));
        }
        assert!(count_non_black_pixels(&boss_pixmap, 450, 45, 620, 100) > 400);
    }
}
