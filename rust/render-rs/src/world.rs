//! World, backdrop, rain, gates, props, enemies, player, and effects rendering (`src/render.js`).

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::sprites::SpriteStore;
use crate::tables::{rect_at, RENDER_TABLES};
use core_rs::constants::*;
use core_rs::dungeon::{current_cell, exit_mode, prop_scale, room_width, ExitMode, MINIMAP_DIRS};
use core_rs::types::*;

pub fn floor_y(z: f64) -> f32 {
    (ARENA_GROUND_Y - depth_lift(z)) as f32
}

pub fn feet_y_player(p: &Player) -> f32 {
    (p.y - depth_lift(p.z)) as f32
}

pub fn feet_y_enemy(e: &Enemy) -> f32 {
    (e.y - depth_lift(e.z)) as f32
}

pub fn camera_x(state: &State) -> f32 {
    state.camera_x as f32
}

pub fn scatter_hash(seed: u32, index: usize) -> f64 {
    let mut x = seed.wrapping_add((index as u32).wrapping_mul(0x9e37_79b1));
    x = (x ^ (x >> 15)).wrapping_mul(0x85eb_ca6b);
    x = (x ^ (x >> 13)).wrapping_mul(0xc2b2_ae35);
    x ^= x >> 16;
    f64::from(x) / 4_294_967_296.0
}

pub fn draw_backdrop(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let deep = state.stage_id == "mirkwooddeep";
    let sheet_key = if deep { "forestDeep" } else { "forest" };
    let rw = room_width(state) as f32;
    let cam_x = camera_x(state);

    // Sky / background base
    c.fill_rect(
        0.0,
        0.0,
        rw,
        ARENA_HEIGHT as f32,
        Rgba::new(14, 20, 32, 255),
    );

    if let Some(sheet) = sprites.get(sheet_key) {
        let back_y = state.band_visual_back_y.unwrap_or(state.band_back_y) as f32;
        if let Some([sx, sy, sw, sh]) = rect_at(&["SCENE", "pieces", "far"]) {
            let mut x = -(cam_x * 0.3).rem_euclid(sw as f32);
            while x < rw {
                c.draw_image(
                    sheet, sx, sy, sw, sh, x, 0.0, sw as f32, back_y, false, 1.0, 0.0,
                );
                x += sw as f32;
            }
        }
        if let Some([sx, sy, sw, sh]) = rect_at(&["SCENE", "pieces", "mid"]) {
            let mut x = -(cam_x * 0.15).rem_euclid(sw as f32);
            while x < rw {
                c.draw_image(
                    sheet,
                    sx,
                    sy,
                    sw,
                    sh,
                    x,
                    (back_y - sh as f32).max(0.0),
                    sw as f32,
                    sh as f32,
                    false,
                    1.0,
                    0.0,
                );
                x += sw as f32;
            }
        }
        if deep {
            let cb_key = state.dungeon.as_ref().and_then(|d| {
                if state.cell == d.entry {
                    Some("deepEntryCloseback")
                } else if state.cell == d.boss {
                    Some("deepBossCloseback")
                } else {
                    d.cells
                        .get(state.cell)
                        .and_then(|cell| match (cell.col + 1, cell.row + 1) {
                            (1, 3) => Some("deepRoom13Closeback"),
                            (1, 4) => Some("deepRoom14Closeback"),
                            (2, 3) => Some("deepRoom23Closeback"),
                            (2, 4) => Some("deepRoom24Closeback"),
                            (3, 3) => Some("deepRoom33Closeback"),
                            (4, 2) => Some("deepRoom42Closeback"),
                            (4, 3) => Some("deepRoom43Closeback"),
                            _ => None,
                        })
                }
            });
            if let Some(cb) = cb_key.and_then(|k| sprites.get(k)) {
                c.draw_image(
                    cb,
                    0,
                    0,
                    cb.width(),
                    cb.height(),
                    0.0,
                    0.0,
                    rw,
                    back_y,
                    false,
                    1.0,
                    0.0,
                );
            }
        }
        if let Some([sx, sy, sw, sh]) = rect_at(&["SCENE", "pieces", "tile0"]) {
            let mut x = 0.0f32;
            let ground_h = (ARENA_HEIGHT as f32 - back_y).max(sh as f32);
            while x < rw {
                c.draw_image(
                    sheet, sx, sy, sw, sh, x, back_y, sw as f32, ground_h, false, 1.0, 0.0,
                );
                x += sw as f32;
            }
        } else {
            c.fill_rect(
                0.0,
                back_y,
                rw,
                ARENA_HEIGHT as f32 - back_y,
                if deep {
                    Rgba::new(26, 46, 42, 255)
                } else {
                    Rgba::new(36, 52, 34, 255)
                },
            );
        }
    } else {
        let back_y = state.band_visual_back_y.unwrap_or(state.band_back_y) as f32;
        c.fill_rect(0.0, 0.0, rw, back_y, Rgba::new(17, 23, 38, 255));
        c.fill_rect(
            0.0,
            back_y,
            rw,
            ARENA_HEIGHT as f32 - back_y,
            Rgba::new(44, 42, 68, 255),
        );
    }
}

pub fn draw_rain_splashes(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    if state.stage_id == "mirkwooddeep" {
        return;
    }
    let Some(sheet) = sprites.get("weather") else {
        return;
    };
    let Some(ref room) = state.room else {
        return;
    };
    let Some(frames) = RENDER_TABLES
        .pointer("/WEATHER/raindrop")
        .and_then(|v| v.as_array())
    else {
        return;
    };
    if frames.is_empty() {
        return;
    }
    let left = room.left_wall;
    let right = room.right_wall;
    let depth = band_depth(state.band_back_y);
    let seed = state.seed.wrapping_add((state.cell as u32 + 1) * 7919 + 31);
    for i in 0..14usize {
        let phase = scatter_hash(seed, i * 5 + 1) * 1.2;
        let age = (state.time + phase) % 1.2;
        if age >= 0.35 {
            continue;
        }
        let x = (left + scatter_hash(seed, i * 5 + 2) * (right - left)) as f32;
        let z = scatter_hash(seed, i * 5 + 3) * depth;
        let f_idx = ((age / 0.35) * frames.len() as f64).floor() as usize;
        let f_idx = f_idx.min(frames.len() - 1);
        if let Some(arr) = frames[f_idx].as_array() {
            let sx = arr[0].as_u64().unwrap_or(0) as u32;
            let sy = arr[1].as_u64().unwrap_or(0) as u32;
            let sw = arr[2].as_u64().unwrap_or(0) as u32;
            let sh = arr[3].as_u64().unwrap_or(0) as u32;
            let w = sw as f32 * 0.9;
            let h = sh as f32 * 0.9;
            let alpha = (0.38 * (1.0 - age / 0.35)) as f32;
            c.draw_image(
                sheet,
                sx,
                sy,
                sw,
                sh,
                x - w * 0.5,
                floor_y(z) - h,
                w,
                h,
                false,
                alpha,
                0.0,
            );
        }
    }
}

pub fn draw_rain(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore, overlay_open: bool) {
    if state.stage_id == "mirkwooddeep" || state.room.is_none() || state.intro_t.is_some() {
        return;
    }
    if (state.victory && !state.post_clear) || state.defeat || overlay_open {
        return;
    }
    let Some(sheet) = sprites.get("weather") else {
        return;
    };
    let left = VIEW_LEFT as f32;
    let width = VIEW_WIDTH;
    let height = ARENA_HEIGHT;
    let seed = state.seed.wrapping_add((state.cell as u32 + 1) * 7919);

    c.save();
    c.set_clip_rect(left, 0.0, width as f32, height as f32);
    let layers: [(usize, f64, f64, f64, f32); 2] = [
        (36, 0.55, 420.0, -75.0, 0.16),
        (28, 0.85, 580.0, -105.0, 0.28),
    ];
    for (li, (count, scale_base, speed, wind, alpha)) in layers.into_iter().enumerate() {
        for i in 0..count {
            let h1 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 1);
            let h2 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 2);
            let h3 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 3);
            let sc = (scale_base * (0.8 + h3 * 0.45)) as f32;
            let _w = 4.0 * sc;
            let h = 28.0 * sc;
            let span = height + f64::from(h);
            let drift = h1 * width + state.time * wind;
            let x = left + drift.rem_euclid(width) as f32;
            let y = ((state.time * speed + h2 * span) % span) as f32 - h;
            let _ = sheet;
            c.draw_line(
                x,
                y,
                x - 3.0 * sc,
                y + h,
                Rgba::new(205, 224, 245, 255).with_alpha(alpha),
                1.0,
            );
        }
    }
    c.restore();
}

pub fn draw_gates(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let Some(cell) = current_cell(state) else {
        return;
    };
    let depth = band_depth(state.band_back_y);
    let deep = state.stage_id == "mirkwooddeep";
    let sheet_key = if deep { "forestDeep" } else { "forest" };
    let sheet = sprites.get(sheet_key);

    for dir in MINIMAP_DIRS {
        let mode = exit_mode(state, dir);
        if mode == ExitMode::None {
            continue;
        }
        let open = mode == ExitMode::Open;
        let (gx, gy, gw, gh) = match dir {
            "N" => {
                let x = core_rs::door_x(state, cell, "N") as f32;
                let y = floor_y(depth);
                (x - 42.0, y - 92.0, 84.0, 92.0)
            }
            "S" => {
                let x = core_rs::door_x(state, cell, "S") as f32;
                let y = floor_y(0.0) + 12.0;
                (x - 42.0, y - 34.0, 84.0, 34.0)
            }
            "E" => (
                room_width(state) as f32 - 58.0,
                floor_y(depth * 0.5) - 90.0,
                56.0,
                108.0,
            ),
            _ => (2.0, floor_y(depth * 0.5) - 90.0, 56.0, 108.0),
        };

        let native_gate = match dir {
            "N" | "S" => sprites.get("nativePathGate"),
            "E" | "W" => {
                if deep {
                    sprites
                        .get("nativePathGateEast")
                        .or_else(|| sprites.get("nativePathGateEastNormal"))
                } else {
                    sprites
                        .get("nativePathGateEastNormal")
                        .or_else(|| sprites.get("nativePathGateEast"))
                }
            }
            _ => None,
        };
        if let Some(sh) = native_gate {
            c.draw_image(
                sh,
                0,
                0,
                sh.width(),
                sh.height(),
                gx,
                gy,
                gw,
                gh,
                dir == "W",
                if open { 1.0 } else { 0.85 },
                0.0,
            );
            if !open {
                if let Some(blk) = sprites.get("gateBlock") {
                    c.draw_image(
                        blk,
                        0,
                        0,
                        blk.width(),
                        blk.height(),
                        gx,
                        gy + gh * 0.25,
                        gw,
                        gh * 0.55,
                        false,
                        0.9,
                        0.0,
                    );
                }
            }
        } else if let Some(sh) = sheet {
            let key = if dir == "N" {
                "gateUp"
            } else if dir == "S" {
                "gateDown"
            } else {
                "gate"
            };
            if let Some([sx, sy, sw, sh_h]) = rect_at(&["SCENE", "pieces", key]) {
                c.draw_image(sh, sx, sy, sw, sh_h, gx, gy, gw, gh, dir == "W", 1.0, 0.0);
            }
        } else {
            c.fill_round_rect(
                gx,
                gy,
                gw,
                gh,
                8.0,
                if open {
                    Rgba::new(40, 85, 65, 220)
                } else {
                    Rgba::new(42, 34, 48, 220)
                },
            );
        }

        if open {
            let pulse = (0.35 + 0.25 * (state.time * 5.0).sin()) as f32;
            c.fill_ellipse(
                gx + gw * 0.5,
                gy + gh * 0.6,
                gw * 0.36,
                gh * 0.26,
                Rgba::new(110, 235, 255, 255).with_alpha(pulse),
            );
        }
    }
}

fn draw_prop(c: &mut Canvas<'_>, state: &State, prop: &Prop, sprites: &SpriteStore) {
    if prop.gone {
        return;
    }
    let x = prop.x as f32;
    let y = floor_y(prop.z);
    let deep = state.stage_id == "mirkwooddeep";
    let sheet_key = if deep { "forestDeep" } else { "forest" };

    if prop.piece == "pillarPale"
        || prop.piece == "pillarDecor"
        || prop.piece == "pillarDamagedDecor"
    {
        if let Some(sh) = sprites.get("pillarPale") {
            let sc = prop.scale.unwrap_or_else(|| prop_scale(&prop.piece));
            let w = sh.width() as f32 * sc[0] as f32;
            let h = sh.height() as f32 * sc[1] as f32;
            c.draw_image(
                sh,
                0,
                0,
                sh.width(),
                sh.height(),
                x - w * 0.5,
                y - h,
                w,
                h,
                false,
                1.0,
                0.0,
            );
            return;
        }
    }

    if let Some(sh) = sprites.get(sheet_key) {
        if let Some([sx, sy, sw, sh_h]) = rect_at(&["SCENE", "pieces", &prop.piece]) {
            let sc = prop.scale.unwrap_or_else(|| prop_scale(&prop.piece));
            let w = sw as f32 * sc[0] as f32;
            let h = sh_h as f32 * sc[1] as f32;
            let alpha = if prop.broken {
                (1.0 - (state.time - prop.broken_at) / BREAK_ANIM).clamp(0.0, 1.0) as f32
            } else {
                1.0
            };
            c.draw_image(
                sh,
                sx,
                sy,
                sw,
                sh_h,
                x - w * 0.5,
                y - h,
                w,
                h,
                false,
                alpha,
                0.0,
            );
            return;
        }
    }

    if prop.solid {
        c.fill_round_rect(
            x - 18.0,
            y - 36.0,
            36.0,
            36.0,
            5.0,
            Rgba::new(112, 82, 52, 230),
        );
    }
}

pub fn draw_player(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let p = &state.player;
    if p.dead {
        return;
    }
    if p.invuln > 0.0 && p.solid_invuln <= 0.0 && ((state.time * 24.0) as i32) % 2 == 0 {
        return;
    }
    let px = p.x as f32;
    let py = feet_y_player(p);
    let ground_y = floor_y(p.z);

    // Shadow
    c.fill_ellipse(px, ground_y, 20.0, 6.0, Rgba::new(0, 0, 0, 110));

    let raging = p.buffs.get("bloodRage").copied().unwrap_or(0.0) > 0.0;
    let sheet = if raging {
        sprites
            .raging_slayer
            .as_ref()
            .or_else(|| sprites.get("slayer"))
    } else {
        sprites.get("slayer")
    };

    if let Some(sh) = sheet {
        let cell_w = 208u32;
        let cell_h = 176u32;
        let anchor_x = 88.0f32;
        let anchor_y = 156.0f32;
        let (row, col) = player_sprite_frame(state, p);
        let sx = (col % 64) * cell_w;
        let sy = (row * cell_h).min(sh.height().saturating_sub(cell_h));
        let dw = cell_w as f32;
        let dh = cell_h as f32;
        let flip = p.facing < 0;
        let draw_x = if flip {
            px - (dw - anchor_x)
        } else {
            px - anchor_x
        };
        let draw_y = py - anchor_y;
        c.draw_image(
            sh, sx, sy, cell_w, cell_h, draw_x, draw_y, dw, dh, flip, 1.0, 0.0,
        );
    } else {
        c.fill_round_rect(
            px - 15.0,
            py - 64.0,
            30.0,
            64.0,
            6.0,
            Rgba::new(220, 72, 68, 255),
        );
    }

    // Blood sword on back when hellbenter is active
    if p.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0 {
        let tier = p.hellbenter_tier.max(1) as f32;
        let len = 36.0 + tier * 5.0;
        let back_x = px - p.facing as f32 * 10.0;
        c.draw_line(
            back_x,
            py - 28.0,
            back_x - p.facing as f32 * 12.0,
            py - 28.0 - len,
            Rgba::new(210, 28, 42, 230),
            4.0 + tier * 0.5,
        );
    }

    if let Some(ref name) = p.name {
        c.fill_text(
            name,
            px,
            py - 72.0,
            11.0,
            Rgba::new(240, 245, 255, 240),
            TextAlign::Center,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    }
}

fn player_sprite_frame(state: &State, p: &Player) -> (u32, u32) {
    if p.hurt_timer > 0.0 {
        return (4, 0);
    }
    if p.skill_timer > 0.0 {
        let tick = ((state.time * 16.0) as u32) % 6;
        return (3, tick);
    }
    if p.attack_timer > 0.0 {
        let elapsed = p.attack_duration - p.attack_timer;
        let prog = if p.attack_duration > 0.0 {
            (elapsed / p.attack_duration).clamp(0.0, 0.99)
        } else {
            0.0
        };
        let (first, frames) = match p.combo_index {
            0 => (0, 7),
            1 => (7, 9),
            _ => (16, 7),
        };
        let col = first + ((prog * frames as f64) as u32).min(frames - 1);
        return (2, col);
    }
    if !p.on_ground {
        return (4, 2);
    }
    if p.vx.abs() > 5.0 || p.vz.abs() > 5.0 {
        let col = ((state.time * 15.0) as u32) % 8;
        return (1, col);
    }
    let col = ((state.time * 6.0) as u32) % 4;
    (0, col)
}

pub fn draw_enemy(c: &mut Canvas<'_>, state: &State, enemy: &Enemy, sprites: &SpriteStore) {
    let ex = enemy.x as f32;
    let ey = feet_y_enemy(enemy);
    let ground_y = floor_y(enemy.z);
    let w = enemy.width as f32;
    let h = enemy.height as f32;

    c.fill_ellipse(
        ex,
        ground_y,
        (w * 0.55).max(14.0),
        5.0,
        Rgba::new(0, 0, 0, 100),
    );

    if let Some(ref champ) = enemy.champion {
        let aura_col = if champ == "champfire" {
            Rgba::new(255, 110, 40, 120)
        } else {
            Rgba::new(150, 70, 220, 120)
        };
        c.stroke_ellipse(ex, ground_y, (w * 0.7).max(20.0), 8.0, aura_col, 2.0);
    }

    if enemy.silhouette {
        c.fill_round_rect(
            ex - w * 0.5,
            ey - h,
            w,
            h,
            6.0,
            Rgba::new(245, 250, 255, 230),
        );
        return;
    }

    let custom_sheet = match enemy.kind.as_str() {
        "grunt" => sprites.get("goblinReference").map(|sh| (sh, 0u32, 76.0f32)),
        "caster" | "burningThrower" => sprites.get("casterReference").map(|sh| (sh, 0u32, 80.0f32)),
        "throwerElite" => sprites
            .get("throwerReference")
            .map(|sh| (sh, 0u32, 86.0f32)),
        _ => None,
    };
    let sheet_and_row = custom_sheet.or_else(|| {
        sprites.get("monsters").map(|sh| {
            let (row, stand_h) = match enemy.kind.as_str() {
                "grunt" => (0, 76.0f32),
                "coward" => (1, 76.0),
                "caster" | "burningThrower" => (2, 80.0),
                "brute" => (3, 164.0),
                "elite" | "throwerElite" => (4, 86.0),
                "boss" => (5, 164.0),
                "goblinBlue" => (6, 76.0),
                "goblinRed" | "cursedRed" => (7, 76.0),
                "cat" => (8, 74.0),
                "deepElite" => (9, 75.0),
                "lugaruBoss" => (10, 74.0),
                _ => (0, 76.0),
            };
            (sh, row, stand_h)
        })
    });
    let drawn = if let Some((sh, row, stand_h)) = sheet_and_row {
        let cell_w = 360u32;
        let cell_h = 420u32;
        let anchor_x = 180.0f32;
        let anchor_y = 260.0f32;
        let max_col = (sh.width() / cell_w).saturating_sub(1);
        let col = if enemy.attack_timer > 0.0 {
            (1 + (((state.time * 10.0) as u32) % 4)).min(max_col)
        } else if enemy.vx.abs() > 2.0 {
            (11 + (((state.time * 10.0) as u32) % 6)).min(max_col)
        } else {
            0
        };
        let sx = col * cell_w;
        let sy = (row * cell_h).min(sh.height().saturating_sub(cell_h));
        let scale = h / stand_h;
        let dw = cell_w as f32 * scale;
        let dh = cell_h as f32 * scale;
        let flip = enemy.facing < 0;
        let draw_x = if flip {
            ex - (cell_w as f32 - anchor_x) * scale
        } else {
            ex - anchor_x * scale
        };
        let draw_y = ey - anchor_y * scale;
        c.draw_image(
            sh,
            sx,
            sy,
            cell_w,
            cell_h,
            draw_x,
            draw_y,
            dw,
            dh,
            flip,
            if enemy.dead { 0.45 } else { 1.0 },
            0.0,
        );
        true
    } else {
        false
    };

    if !drawn {
        let body_col = match enemy.kind.as_str() {
            "goblinRed" | "cursedRed" | "burningThrower" => Rgba::new(196, 68, 56, 255),
            "goblinBlue" => Rgba::new(68, 126, 206, 255),
            "boss" | "lugaruBoss" => Rgba::new(146, 54, 46, 255),
            _ => Rgba::new(82, 164, 88, 255),
        };
        c.fill_round_rect(ex - w * 0.5, ey - h, w, h, 5.0, body_col);
    }

    if !enemy.dead && enemy.hp < enemy.max_hp && enemy.behavior != "boss" {
        let bw = w.max(32.0);
        let ratio = (enemy.hp / enemy.max_hp).clamp(0.0, 1.0) as f32;
        c.fill_rect(
            ex - bw * 0.5,
            ey - h - 10.0,
            bw,
            4.0,
            Rgba::new(20, 20, 26, 210),
        );
        c.fill_rect(
            ex - bw * 0.5,
            ey - h - 10.0,
            bw * ratio,
            4.0,
            Rgba::new(220, 56, 56, 255),
        );
    }
}

pub fn draw_world(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    struct WorldItem {
        z: f64,
        kind: u8,
        idx: usize,
    }
    let mut items = Vec::new();
    for (idx, p) in state.props.iter().enumerate() {
        if !p.gone {
            items.push(WorldItem {
                z: p.sort_z.unwrap_or(p.z),
                kind: 0,
                idx,
            });
        }
    }
    for (idx, e) in state.enemies.iter().enumerate() {
        if !e.gone {
            items.push(WorldItem {
                z: e.z,
                kind: 1,
                idx,
            });
        }
    }
    for (idx, p) in state.pickups.iter().enumerate() {
        items.push(WorldItem {
            z: p.z,
            kind: 2,
            idx,
        });
    }
    for (idx, f) in state.fields.iter().enumerate() {
        items.push(WorldItem {
            z: f.z,
            kind: 3,
            idx,
        });
    }
    for (idx, pr) in state.projectiles.iter().enumerate() {
        items.push(WorldItem {
            z: pr.z,
            kind: 4,
            idx,
        });
    }
    for (idx, sh) in state.shots.iter().enumerate() {
        items.push(WorldItem {
            z: sh.z,
            kind: 5,
            idx,
        });
    }
    items.push(WorldItem {
        z: state.player.z,
        kind: 6,
        idx: 0,
    });

    items.sort_by(|a, b| b.z.total_cmp(&a.z));

    for item in items {
        match item.kind {
            0 => draw_prop(c, state, &state.props[item.idx], sprites),
            1 => draw_enemy(c, state, &state.enemies[item.idx], sprites),
            2 => {
                let drop = &state.pickups[item.idx];
                let dx = drop.x as f32;
                let dy = if drop.kind == "blood_orb" {
                    (drop.y - depth_lift(drop.z)) as f32
                } else {
                    floor_y(drop.z)
                };
                if drop.kind == "blood_orb" {
                    if let Some(eff) = sprites.get("effects") {
                        let frame = ((state.time / 0.1) as u32) % 6;
                        c.draw_image(
                            eff,
                            frame * 128,
                            14 * 128,
                            128,
                            128,
                            dx - 24.0,
                            dy - 24.0,
                            48.0,
                            48.0,
                            false,
                            1.0,
                            0.0,
                        );
                    } else {
                        c.fill_ellipse(dx, dy, 8.0, 8.0, Rgba::new(225, 42, 54, 230));
                    }
                } else {
                    let col = if drop.tone == "cyan" {
                        Rgba::new(88, 224, 245, 255)
                    } else if drop.tone == "gold" {
                        Rgba::new(242, 198, 72, 255)
                    } else {
                        Rgba::new(235, 240, 248, 255)
                    };
                    c.fill_round_rect(
                        dx - 28.0,
                        dy - 16.0,
                        56.0,
                        14.0,
                        3.0,
                        Rgba::new(14, 18, 28, 210),
                    );
                    c.fill_text(&drop.name, dx, dy - 5.0, 10.0, col, TextAlign::Center, None);
                }
            }
            3 => {
                let f = &state.fields[item.idx];
                let (_, fade) = core_rs::combat::field_progress(f);
                let fx = f.x as f32;
                let fy = floor_y(f.z);
                c.fill_ellipse(
                    fx,
                    fy,
                    86.0,
                    22.0,
                    Rgba::new(230, 58, 36, 255).with_alpha(0.45 * fade as f32),
                );
                c.stroke_ellipse(
                    fx,
                    fy,
                    86.0,
                    22.0,
                    Rgba::new(255, 175, 70, 255).with_alpha(0.75 * fade as f32),
                    2.0,
                );
            }
            4 => {
                let pr = &state.projectiles[item.idx];
                let px = pr.x as f32;
                let py = (pr.y + pr.osc_y - depth_lift(pr.z)) as f32;
                let age = (pr.max_life - pr.life).max(0.0);
                let rot = -((age / 0.15) as f32) * std::f32::consts::TAU;
                let flip = pr.vx < 0.0;
                let drawn = match pr.native_object {
                    Some(30001) => sprites.get("goblinStone").map(|sh| {
                        c.draw_image(
                            sh,
                            0,
                            0,
                            32,
                            32,
                            px - 16.0,
                            py - 16.0,
                            32.0,
                            32.0,
                            false,
                            1.0,
                            rot,
                        );
                    }),
                    Some(30021) => sprites.get("goblinBomb").map(|sh| {
                        c.draw_image(
                            sh,
                            0,
                            0,
                            32,
                            32,
                            px - 16.0,
                            py - 16.0,
                            32.0,
                            32.0,
                            false,
                            1.0,
                            rot,
                        );
                    }),
                    Some(30057) => sprites.get("goblinIce").map(|sh| {
                        let frame = ((age / 0.05) as u32) % 8;
                        c.draw_image(
                            sh,
                            frame * 64,
                            0,
                            64,
                            64,
                            px - 32.0,
                            py - 32.0,
                            64.0,
                            64.0,
                            flip,
                            1.0,
                            0.0,
                        );
                    }),
                    Some(30047) => sprites.get("goblinFire").map(|sh| {
                        let frame = ((age / 0.05) as u32) % 9;
                        c.draw_image(
                            sh,
                            frame * 128,
                            0,
                            128,
                            128,
                            px - 44.0,
                            py - 44.0,
                            88.0,
                            88.0,
                            flip,
                            1.0,
                            0.0,
                        );
                    }),
                    _ => None,
                };
                if drawn.is_none() {
                    let r = pr.radius as f32;
                    let col = match pr.native_object {
                        Some(30021) => Rgba::new(245, 130, 42, 255),
                        Some(30047) => Rgba::new(255, 92, 36, 255),
                        _ => Rgba::new(195, 205, 220, 255),
                    };
                    c.fill_ellipse(px, py, r, r, col);
                }
            }
            5 => {
                let sh = &state.shots[item.idx];
                let sx = sh.x as f32;
                let sy = (sh.y - depth_lift(sh.z) - 24.0) as f32;
                let age = (sh.max_life - sh.life).max(0.0);
                if sh.skill_id == "normalWave" {
                    if let Some(eff) = sprites.get("effects") {
                        let frame = (((age / 0.06667) as u32).min(4)) % 5;
                        c.draw_image(
                            eff,
                            frame * 128,
                            31 * 128,
                            128,
                            128,
                            sx - 72.0,
                            sy - 72.0,
                            144.0,
                            144.0,
                            sh.facing < 0,
                            0.92,
                            0.0,
                        );
                    } else {
                        c.fill_ellipse(sx, sy, 28.0, 18.0, Rgba::new(225, 58, 72, 200));
                    }
                } else {
                    c.fill_ellipse(sx, sy, 28.0, 18.0, Rgba::new(225, 58, 72, 200));
                }
            }
            6 => draw_player(c, state, sprites),
            _ => {}
        }
    }

    // Active skill / rage slash visual
    let flip = state.player.facing < 0;
    if state.player.skill_timer > 0.0 {
        let px = state.player.x as f32 + state.player.facing as f32 * 44.0;
        let py = feet_y_player(&state.player) - 32.0;
        let skill_spec = match state.player.skill_id.as_deref() {
            Some("ghostSlash") => Some((1u32, 6u32)),
            Some("upSlash") => Some((2, 9)),
            Some("mountainBreaker") => Some((3, 6)),
            Some("crossSlash") => Some((4, 34)),
            Some("rageBurst") => Some((8, 36)),
            Some("bloodSnatch") => Some((9, 19)),
            Some("graspHead") => Some((10, 31)),
            Some("bloodEvil") => Some((11, 15)),
            Some("mountainRift") => Some((12, 45)),
            Some("berserk") => Some((13, 13)),
            Some("bloodyRave") => Some((20, 12)),
            Some("bloodSword") => Some((22, 8)),
            _ => None,
        };
        if let (Some((row, frames)), Some(eff)) = (skill_spec, sprites.get("effects")) {
            let dur = state
                .player
                .skill_id
                .as_deref()
                .and_then(|id| core_rs::TABLES.skills.get(id))
                .map(|sk| sk.duration.max(0.1))
                .unwrap_or(0.5);
            let prog = (1.0 - (state.player.skill_timer / dur)).clamp(0.0, 0.999);
            let max_col = (eff.width() / 128).saturating_sub(1);
            let frame = ((prog * frames as f64) as u32).min(max_col);
            c.draw_image(
                eff,
                frame * 128,
                row * 128,
                128,
                128,
                px - 64.0,
                py - 64.0,
                128.0,
                128.0,
                flip,
                0.9,
                0.0,
            );
        } else {
            c.fill_ellipse(px, py, 36.0, 24.0, Rgba::new(235, 68, 76, 110));
        }
    } else if state.player.attack_timer > 0.0 {
        let px = state.player.x as f32 + state.player.facing as f32 * 38.0;
        let py = feet_y_player(&state.player) - 32.0;
        if state.player.buffs.contains_key("bloodRage") {
            if let Some(eff) = sprites.get("effects") {
                let dur = state.player.attack_duration.max(0.1);
                let prog = (1.0 - (state.player.attack_timer / dur)).clamp(0.0, 0.999);
                let frame = (prog * 8.0) as u32;
                c.draw_image(
                    eff,
                    frame * 128,
                    16 * 128,
                    128,
                    128,
                    px - 64.0,
                    py - 64.0,
                    128.0,
                    128.0,
                    flip,
                    0.9,
                    0.0,
                );
            } else {
                c.fill_ellipse(px, py, 28.0, 18.0, Rgba::new(235, 68, 76, 110));
            }
        } else {
            c.fill_ellipse(px, py, 26.0, 18.0, Rgba::new(235, 242, 255, 110));
        }
    }
}

pub fn draw_foreground(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    if state.stage_id != "mirkwooddeep" {
        return;
    }
    let Some(cell) = current_cell(state) else {
        return;
    };
    if (cell.col + 1, cell.row + 1) == (2, 4) {
        if let Some(fg) = sprites.get("deepRoom24Foreground") {
            let rw = room_width(state) as f32;
            let fh = fg.height() as f32;
            c.draw_image(
                fg,
                0,
                0,
                fg.width(),
                fg.height(),
                0.0,
                ARENA_HEIGHT as f32 - fh,
                rw,
                fh,
                false,
                1.0,
                0.0,
            );
        }
    }
}

pub fn draw_effect(c: &mut Canvas<'_>, state: &State, effect: &Effect) {
    let alpha = if effect.max_life > 0.0 {
        (effect.life / effect.max_life).clamp(0.0, 1.0) as f32
    } else {
        1.0
    };
    match effect.kind.as_str() {
        "damage" => {
            let x = effect.x as f32;
            let y = (effect.y - depth_lift(effect.z)) as f32 - (1.0 - alpha) * 18.0;
            let col = if effect.miss {
                Rgba::new(190, 205, 225, 255).with_alpha(alpha)
            } else {
                Rgba::new(255, 214, 72, 255).with_alpha(alpha)
            };
            c.fill_text(
                &effect.text,
                x,
                y,
                16.0,
                col,
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
            );
        }
        "hitWord" => {
            let x = effect.x as f32;
            let y = (effect.y - depth_lift(effect.z)) as f32;
            c.fill_text(
                &effect.text,
                x,
                y,
                13.0,
                Rgba::new(228, 231, 237, 255).with_alpha(alpha),
                TextAlign::Left,
                Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
            );
        }
        "pickupText" => {
            let x = state.player.x as f32;
            let y = feet_y_player(&state.player) - 82.0 - (1.0 - alpha) * 22.0;
            c.fill_text(
                &effect.text,
                x,
                y,
                14.0,
                Rgba::new(150, 245, 165, 255).with_alpha(alpha),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
            );
        }
        "shockwave" if effect.arc => {
            let r = (effect.radius as f32) * (0.6 + 0.4 * (1.0 - alpha));
            let col = if effect.gold {
                Rgba::new(245, 205, 88, 255)
            } else {
                Rgba::new(235, 92, 68, 255)
            };
            c.stroke_ellipse(
                effect.x as f32,
                floor_y(effect.z),
                r,
                r * DEPTH_SCALE as f32,
                col.with_alpha(alpha),
                3.0,
            );
        }
        "telegraph" => {
            let r = effect.radius.max(24.0) as f32;
            c.stroke_ellipse(
                effect.x as f32,
                floor_y(effect.z),
                r,
                r * DEPTH_SCALE as f32,
                Rgba::new(255, 72, 72, 255).with_alpha(0.65),
                2.0,
            );
        }
        "heal" => {
            let x = effect.x as f32;
            let y = (effect.y - depth_lift(effect.z)) as f32 - (1.0 - alpha) * 16.0;
            c.fill_text(
                &effect.text,
                x,
                y,
                13.0,
                Rgba::new(110, 245, 140, 255).with_alpha(alpha),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 200).with_alpha(alpha)),
            );
        }
        "banner" => {
            let cx = (VIEW_LEFT + VIEW_WIDTH * 0.5) as f32 - camera_x(state);
            c.fill_text(
                &effect.text,
                cx,
                150.0,
                22.0,
                Rgba::new(255, 225, 130, 255).with_alpha(alpha),
                TextAlign::Center,
                Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
            );
        }
        "bomb_flash" | "bossburst" => {
            c.fill_ellipse(
                effect.x as f32,
                (effect.y - depth_lift(effect.z)) as f32,
                38.0 * (1.2 - alpha * 0.5),
                28.0 * (1.2 - alpha * 0.5),
                Rgba::new(255, 220, 140, 255).with_alpha(alpha),
            );
        }
        _ => {}
    }
}

pub struct TownView<'a> {
    pub player_x: f64,
    pub player_z: f64,
    pub facing: i32,
    pub camera_x: f64,
    pub time: f64,
    pub moving: bool,
    pub walk: f64,
    pub player_level: u32,
    pub player_name: &'a str,
}

pub fn draw_town(
    c: &mut Canvas<'_>,
    player_x: f64,
    player_z: f64,
    facing: i32,
    sprites: &SpriteStore,
) {
    let view = TownView {
        player_x,
        player_z,
        facing,
        camera_x: (player_x - VIEW_WIDTH * 0.5).clamp(0.0, 2520.0 - VIEW_WIDTH),
        time: 0.0,
        moving: false,
        walk: 0.0,
        player_level: 1,
        player_name: "鬼剑士",
    };
    draw_town_view(c, &view, sprites);
}

pub fn draw_town_view(c: &mut Canvas<'_>, view: &TownView<'_>, sprites: &SpriteStore) {
    const ART_SCALE: f32 = 1.125;
    const MID_Y: f32 = 85.0;
    const ROAD_Y: f32 = 233.0;
    const FRONT_Y: f32 = 430.0;
    const GROUND_Y: f32 = 425.0;
    const GATE_X: f32 = 2420.0;
    const PLAYER_SCALE: f32 = 1.577_381;

    c.clear(Rgba::new(5, 7, 12, 255));
    c.save();
    c.set_clip_rect(
        VIEW_LEFT as f32,
        0.0,
        VIEW_WIDTH as f32,
        ARENA_HEIGHT as f32,
    );
    c.translate(VIEW_LEFT as f32, 0.0);

    let cam = view.camera_x as f32;
    let vw = VIEW_WIDTH as f32;

    if let Some(sh) = sprites.get("town") {
        // Far sky/mountains
        let far_h = 242.0 * ART_SCALE;
        c.draw_image(sh, 0, 0, 640, 242, 0.0, 0.0, vw, far_h, false, 1.0, 0.0);

        // Midground buildings (0.35 parallax)
        let mid_w = 895.0 * ART_SCALE;
        let mid_h = 258.0 * ART_SCALE;
        let mid_top = MID_Y;
        let mut mx = -(cam * 0.35).rem_euclid(mid_w);
        while mx < vw {
            c.draw_image(
                sh, 640, 0, 895, 258, mx, mid_top, mid_w, mid_h, false, 1.0, 0.0,
            );
            mx += mid_w;
        }

        // Cobblestone road tiles
        let road_w = 224.0 * ART_SCALE;
        let road_h = 306.0 * ART_SCALE;
        let road_top = ROAD_Y;
        let mut tx = -cam.rem_euclid(road_w);
        while tx < vw {
            c.draw_image(
                sh, 0, 258, 224, 306, tx, road_top, road_w, road_h, false, 1.0, 0.0,
            );
            tx += road_w;
        }

        // Left town banner
        let bw = 164.0 * ART_SCALE;
        let bh = 281.0 * ART_SCALE;
        c.draw_image(
            sh,
            448,
            258,
            164,
            281,
            -50.0 - cam,
            313.0 - bh,
            bw,
            bh,
            false,
            1.0,
            0.0,
        );

        // Elvenguard east dungeon gate + animated door & light
        let gx = GATE_X - cam - 85.0;
        let gw = 170.0 * ART_SCALE;
        let gh = 121.0 * ART_SCALE;
        c.draw_image(
            sh,
            612,
            258,
            170,
            121,
            gx,
            GROUND_Y - 20.0 - gh,
            gw,
            gh,
            false,
            1.0,
            0.0,
        );
        const GATE_DOOR: [[u32; 4]; 10] = [
            [782, 258, 183, 77],
            [965, 258, 183, 77],
            [1148, 258, 183, 77],
            [1331, 258, 183, 77],
            [0, 564, 183, 77],
            [183, 564, 183, 77],
            [366, 564, 183, 77],
            [549, 564, 183, 77],
            [732, 564, 183, 77],
            [915, 564, 183, 77],
        ];
        const GATE_LIGHT: [[u32; 4]; 10] = [
            [1098, 564, 298, 121],
            [0, 685, 298, 121],
            [298, 685, 298, 121],
            [596, 685, 298, 121],
            [894, 685, 298, 121],
            [1192, 685, 298, 121],
            [0, 806, 298, 121],
            [298, 806, 298, 121],
            [596, 806, 298, 121],
            [894, 806, 298, 121],
        ];
        let gframe = ((view.time * 10.0) as usize) % 10;
        let [dx, dy, dw, dh] = GATE_DOOR[gframe];
        c.draw_image(
            sh,
            dx,
            dy,
            dw,
            dh,
            gx - 34.0,
            GROUND_Y - 88.0,
            183.0,
            77.0,
            false,
            1.0,
            0.0,
        );
        let [lx, ly, lw, lh] = GATE_LIGHT[gframe];
        c.draw_image(
            sh,
            lx,
            ly,
            lw,
            lh,
            gx - 70.0,
            GROUND_Y - 90.0,
            298.0,
            121.0,
            false,
            0.85,
            0.0,
        );
    }

    // Actors: 8 NPCs + Player, sorted far (large z) to near (small z)
    struct TownNpcDef {
        id: &'static str,
        x: f32,
        z: f32,
        label: &'static str,
        frames: &'static [[u32; 4]],
    }
    const GUARD_FRAMES: [[u32; 4]; 6] = [
        [860, 319, 73, 191],
        [933, 319, 73, 191],
        [1006, 319, 73, 191],
        [1079, 319, 73, 191],
        [1152, 319, 73, 191],
        [1225, 319, 73, 191],
    ];
    const SERIA_FRAMES: [[u32; 4]; 6] = [
        [0, 0, 62, 143],
        [62, 0, 62, 143],
        [124, 0, 62, 143],
        [186, 0, 62, 143],
        [248, 0, 62, 143],
        [310, 0, 62, 143],
    ];
    const MINET_FRAMES: [[u32; 4]; 6] = [
        [372, 0, 49, 133],
        [421, 0, 49, 133],
        [470, 0, 49, 133],
        [519, 0, 49, 133],
        [568, 0, 49, 133],
        [617, 0, 49, 133],
    ];
    const GSD_FRAMES: [[u32; 4]; 4] = [
        [960, 0, 75, 96],
        [1035, 0, 75, 96],
        [1110, 0, 75, 96],
        [1185, 0, 75, 96],
    ];
    const KANNA_FRAMES: [[u32; 4]; 8] = [
        [1260, 0, 39, 106],
        [1299, 0, 39, 106],
        [1338, 0, 39, 106],
        [1377, 0, 39, 106],
        [1416, 0, 39, 106],
        [1455, 0, 39, 106],
        [1494, 0, 39, 106],
        [1533, 0, 39, 106],
    ];
    const BROWNIE_FRAMES: [[u32; 4]; 6] = [
        [0, 143, 103, 79],
        [103, 143, 103, 79],
        [206, 143, 103, 79],
        [309, 143, 103, 79],
        [412, 143, 103, 79],
        [515, 143, 103, 79],
    ];
    const SINDA_FRAMES: [[u32; 4]; 6] = [
        [1133, 222, 86, 97],
        [1219, 222, 86, 97],
        [1305, 222, 86, 97],
        [1391, 222, 86, 97],
        [1477, 222, 86, 97],
        [0, 319, 86, 97],
    ];
    const CAPTAIN_FRAMES: [[u32; 4]; 6] = [
        [730, 510, 75, 171],
        [805, 510, 75, 171],
        [880, 510, 75, 171],
        [955, 510, 75, 171],
        [1030, 510, 75, 171],
        [1105, 510, 75, 171],
    ];
    const NPCS: [TownNpcDef; 8] = [
        TownNpcDef {
            id: "guard",
            x: 360.0,
            z: 50.0,
            label: "守卫",
            frames: &GUARD_FRAMES,
        },
        TownNpcDef {
            id: "seria",
            x: 650.0,
            z: 50.0,
            label: "赛丽亚",
            frames: &SERIA_FRAMES,
        },
        TownNpcDef {
            id: "minet",
            x: 900.0,
            z: 50.0,
            label: "敏泰",
            frames: &MINET_FRAMES,
        },
        TownNpcDef {
            id: "gsd",
            x: 1150.0,
            z: 50.0,
            label: "GSD",
            frames: &GSD_FRAMES,
        },
        TownNpcDef {
            id: "kanna",
            x: 1400.0,
            z: 50.0,
            label: "卡妮娜",
            frames: &KANNA_FRAMES,
        },
        TownNpcDef {
            id: "brownie",
            x: 1700.0,
            z: 50.0,
            label: "布兰妮",
            frames: &BROWNIE_FRAMES,
        },
        TownNpcDef {
            id: "sinda",
            x: 2000.0,
            z: 50.0,
            label: "辛达",
            frames: &SINDA_FRAMES,
        },
        TownNpcDef {
            id: "guardCaptain",
            x: 2250.0,
            z: 50.0,
            label: "守卫队长",
            frames: &CAPTAIN_FRAMES,
        },
    ];

    let mut order: Vec<(f32, Option<usize>)> = NPCS
        .iter()
        .enumerate()
        .map(|(i, n)| (n.z, Some(i)))
        .collect();
    order.push((view.player_z as f32, None));
    order.sort_by(|a, b| b.0.total_cmp(&a.0));

    let npc_sheet = sprites.get("npc");
    let mut near_hint: Option<String> = None;
    for (_, npc_idx_opt) in order {
        if let Some(ni) = npc_idx_opt {
            let npc = &NPCS[ni];
            let sx = npc.x - cam;
            let bottom = GROUND_Y - npc.z;
            if (npc.x - view.player_x as f32).abs() < 65.0
                && (npc.z - view.player_z as f32).abs() < 45.0
            {
                let action = match npc.id {
                    "seria" | "minet" | "gsd" => "查看任务",
                    "kanna" => "打开商店",
                    "sinda" => "打开背包/分解",
                    _ => "进入副本",
                };
                near_hint = Some(format!("按 [Space/Enter] 与 {} {action}", npc.label));
            }
            if sx < -120.0 || sx > vw + 120.0 {
                continue;
            }
            c.fill_ellipse(sx, bottom, 18.0, 5.0, Rgba::new(0, 0, 0, 105));
            if let Some(nsh) = npc_sheet {
                let fidx = ((view.time * 6.0) as usize) % npc.frames.len();
                let [fx, fy, fw, fh] = npc.frames[fidx];
                let dw = fw as f32 * 0.9;
                let dh = fh as f32 * 0.9;
                c.draw_image(
                    nsh,
                    fx,
                    fy,
                    fw,
                    fh,
                    sx - dw * 0.5,
                    bottom - dh,
                    dw,
                    dh,
                    false,
                    1.0,
                    0.0,
                );
                c.fill_text(
                    npc.label,
                    sx,
                    bottom - dh - 8.0,
                    11.0,
                    Rgba::new(240, 230, 207, 255),
                    TextAlign::Center,
                    Some(Rgba::new(8, 10, 16, 230)),
                );
            }
        } else {
            let px = view.player_x as f32 - cam;
            let py = GROUND_Y - view.player_z as f32;
            c.fill_ellipse(px, py, 20.0, 5.5, Rgba::new(0, 0, 0, 115));
            if let Some(sh) = sprites.get("slayer") {
                let cell_w = 208u32;
                let cell_h = 176u32;
                let anchor_x = 88.0f32;
                let anchor_y = 156.0f32;
                let row = if view.moving && view.walk > 0.0 { 1 } else { 0 };
                let col = if view.moving && view.walk > 0.0 {
                    ((view.walk * 10.0) as u32) % 8
                } else {
                    0
                };
                let flip = view.facing < 0;
                let draw_x = if flip {
                    px - (cell_w as f32 - anchor_x) * PLAYER_SCALE
                } else {
                    px - anchor_x * PLAYER_SCALE
                };
                c.draw_image(
                    sh,
                    col * cell_w,
                    row * cell_h,
                    cell_w,
                    cell_h,
                    draw_x,
                    py - anchor_y * PLAYER_SCALE,
                    cell_w as f32 * PLAYER_SCALE,
                    cell_h as f32 * PLAYER_SCALE,
                    flip,
                    1.0,
                    0.0,
                );
            } else {
                c.fill_round_rect(
                    px - 14.0,
                    py - 60.0,
                    28.0,
                    60.0,
                    5.0,
                    Rgba::new(220, 72, 68, 255),
                );
            }
            c.fill_text(
                &format!("Lv.{} {}", view.player_level, view.player_name),
                px,
                py - 142.0,
                11.0,
                Rgba::new(242, 231, 206, 255),
                TextAlign::Center,
                Some(Rgba::new(24, 24, 24, 230)),
            );
        }
    }

    if (view.player_x as f32 - GATE_X).abs() < 75.0 {
        near_hint = Some("按 [Space/Enter] 进入格兰之森副本选择".to_string());
    }

    // Foreground railing
    if let Some(sh) = sprites.get("town") {
        let road_w = 224.0 * ART_SCALE;
        let rail_h = 81.0 * ART_SCALE;
        let mut fx = -cam.rem_euclid(road_w);
        while fx < vw {
            c.draw_image(
                sh, 224, 258, 224, 81, fx, FRONT_Y, road_w, rail_h, false, 1.0, 0.0,
            );
            fx += road_w;
        }
    }

    c.restore();

    c.fill_text(
        "艾尔文防线 · [←→↑↓] 移动 · [Enter] 交互/进图 · [I] 背包 · [K] 装备 · [L] 任务 · [U] 商店 · [B] 技能",
        (ARENA_WIDTH * 0.5) as f32,
        28.0,
        12.0,
        Rgba::new(235, 220, 175, 240),
        TextAlign::Center,
        Some(Rgba::new(0, 0, 0, 220)),
    );
    if let Some(hint) = near_hint {
        c.fill_text(
            &hint,
            (ARENA_WIDTH * 0.5) as f32,
            ARENA_HEIGHT as f32 - 22.0,
            13.0,
            Rgba::new(255, 228, 140, 255),
            TextAlign::Center,
            Some(Rgba::new(0, 0, 0, 230)),
        );
    }
}
