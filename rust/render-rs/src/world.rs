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
        (55, 0.95, 430.0, -76.0, 0.16),
        (40, 1.65, 760.0, -134.0, 0.25),
    ];
    let rain_rects: [(u32, u32, u32, u32); 2] = [(0, 0, 5, 43), (6, 0, 5, 22)];
    for (li, (count, scale_base, speed, wind, alpha)) in layers.into_iter().enumerate() {
        for i in 0..count {
            let h1 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 1);
            let h2 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 2);
            let h3 = scatter_hash(seed.wrapping_add(li as u32 * 997), i * 11 + 3);
            let sc = (scale_base * (0.8 + h3 * 0.45)) as f32;
            let (rx, ry, rw, rh) = rain_rects[(i + li) % rain_rects.len()];
            let w = rw as f32 * sc;
            let h = rh as f32 * sc;
            let span = height + f64::from(h);
            let drift = h1 * width + state.time * wind;
            let x = left + drift.rem_euclid(width) as f32;
            let y = ((state.time * speed + h2 * span) % span) as f32 - h;
            c.draw_image(
                sheet,
                rx,
                ry,
                rw,
                rh,
                x - w * 0.5,
                y,
                w,
                h,
                false,
                alpha,
                0.18,
            );
        }
    }
    c.restore();
}

fn draw_native_gate_part(
    c: &mut Canvas<'_>,
    sh: &tiny_skia::Pixmap,
    gx: f64,
    gz: f64,
    rect: [f64; 4],
    offset: [f64; 2],
    alpha: f32,
) {
    let scale = NATIVE_SCALE as f32;
    let dx = gx as f32 + offset[0] as f32 * scale;
    let dy = floor_y(gz) + offset[1] as f32 * scale;
    let dw = rect[2] as f32 * scale;
    let dh = rect[3] as f32 * scale;
    c.draw_image(
        sh,
        rect[0] as u32,
        rect[1] as u32,
        rect[2] as u32,
        rect[3] as u32,
        dx,
        dy,
        dw,
        dh,
        false,
        alpha,
        0.0,
    );
}

fn parse_gate_part(v: &serde_json::Value) -> Option<([f64; 4], [f64; 2])> {
    let r = v.get("rect")?.as_array()?;
    let o = v.get("offset")?.as_array()?;
    if r.len() < 4 || o.len() < 2 {
        return None;
    }
    Some((
        [
            r[0].as_f64()?,
            r[1].as_f64()?,
            r[2].as_f64()?,
            r[3].as_f64()?,
        ],
        [o[0].as_f64()?, o[1].as_f64()?],
    ))
}

pub fn draw_gates(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    let Some(cell) = current_cell(state) else {
        return;
    };
    let deep = state.stage_id == "mirkwooddeep";
    let sheet_key = if deep { "forestDeep" } else { "forest" };
    let sheet = sprites.get(sheet_key);
    let room_spec = core_rs::TABLES
        .stages
        .get(&state.stage_id)
        .and_then(|s| s.rooms.get(cell.room));

    for dir in MINIMAP_DIRS {
        let mode = exit_mode(state, dir);
        if mode == ExitMode::None {
            continue;
        }
        let open = mode == ExitMode::Open;

        if let Some(native) = room_spec
            .and_then(|rs| rs.native_path_gates.as_ref())
            .and_then(|m| m.get(dir))
        {
            let sprite_key = native.sprite.as_deref().unwrap_or("nativePathGate");
            if let Some(sh) = sprites.get(sprite_key) {
                if let Some(v) = native.parts.extra.get("under") {
                    if let Some((r, o)) = parse_gate_part(v) {
                        draw_native_gate_part(c, sh, native.x, native.z, r, o, 1.0);
                    }
                }
                draw_native_gate_part(
                    c,
                    sh,
                    native.x,
                    native.z,
                    native.parts.frame.rect,
                    native.parts.frame.offset,
                    1.0,
                );
                let opened_at = state.room.as_ref().and_then(|r| r.native_gate_opened_at);
                let leaf_alpha = if !cell.cleared {
                    1.0f32
                } else if let Some(t0) = opened_at {
                    (1.0 - (state.time - t0) / 0.5).clamp(0.0, 1.0) as f32
                } else {
                    0.0
                };
                if leaf_alpha > 0.0 {
                    if let Some(v) = native.parts.extra.get("door") {
                        if let Some((r, o)) = parse_gate_part(v) {
                            draw_native_gate_part(c, sh, native.x, native.z, r, o, leaf_alpha);
                        }
                    }
                }
                if open && cell.cleared {
                    if let Some(v) = native.parts.extra.get("light") {
                        if let Some((r, o)) = parse_gate_part(v) {
                            let pulse =
                                (0.62 + 0.2 * (0.5 + 0.5 * (state.time * 3.2).sin())) as f32;
                            let scale = NATIVE_SCALE as f32;
                            let dx = native.x as f32 + o[0] as f32 * scale;
                            let dy = floor_y(native.z) + o[1] as f32 * scale;
                            c.draw_image_additive(
                                sh,
                                r[0] as u32,
                                r[1] as u32,
                                r[2] as u32,
                                r[3] as u32,
                                dx,
                                dy,
                                r[2] as f32 * scale,
                                r[3] as f32 * scale,
                                false,
                                pulse,
                                0.0,
                            );
                        }
                    }
                }
                if let Some(v) = native.parts.extra.get("over") {
                    if let Some((r, o)) = parse_gate_part(v) {
                        draw_native_gate_part(c, sh, native.x, native.z, r, o, 1.0);
                    }
                }
                continue;
            }
        }

        if deep && !open && dir != "N" && dir != "S" {
            continue;
        }

        let (spot_x, spot_bottom) = match dir {
            "E" => (room_width(state) as f32 - 34.0, ARENA_GROUND_Y as f32 + 4.0),
            "W" => (34.0, ARENA_GROUND_Y as f32 + 4.0),
            "S" => (
                core_rs::door_x(state, cell, "S") as f32,
                GATE_DOWN_BOTTOM as f32,
            ),
            _ => (
                core_rs::door_x(state, cell, "N") as f32,
                core_rs::dungeon::gate_art_rect(state, cell, "N").bottom as f32,
            ),
        };

        let (piece, door_piece) = match dir {
            "N" => ("gateUp", "doorUp"),
            "S" => ("gateDown", "doorDown"),
            _ if deep => ("gateBlock", "doorBlock"),
            _ => ("gate", "door"),
        };

        if let Some(sh) = sheet {
            if let Some([sx, sy, sw, sh_h]) = rect_at(&["SCENE", "pieces", piece]) {
                let sc = prop_scale(piece);
                let gw = sw as f32 * sc[0] as f32;
                let gh = sh_h as f32 * sc[1] as f32;
                let mirror = dir == "W";
                let gate_alpha = if !open && !(deep && (dir == "N" || dir == "S")) {
                    0.72
                } else {
                    1.0
                };
                c.draw_image(
                    sh,
                    sx,
                    sy,
                    sw,
                    sh_h,
                    spot_x - gw * 0.5,
                    spot_bottom - gh,
                    gw,
                    gh,
                    mirror,
                    gate_alpha,
                    0.0,
                );
                if !open {
                    if let Some([dsx, dsy, dsw, dsh]) = rect_at(&["SCENE", "pieces", door_piece]) {
                        let dw = dsw as f32 * sc[0] as f32;
                        let dh = dsh as f32 * sc[1] as f32;
                        c.draw_image(
                            sh,
                            dsx,
                            dsy,
                            dsw,
                            dsh,
                            spot_x - dw * 0.5,
                            spot_bottom - dh,
                            dw,
                            dh,
                            mirror,
                            0.85,
                            0.0,
                        );
                    }
                }
            }
        } else {
            let gw = 52.0f32;
            let gh = 82.0f32;
            c.fill_round_rect(
                spot_x - gw * 0.5,
                spot_bottom - gh,
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

    if prop.piece == "pillar"
        || prop.piece == "pillarPale"
        || prop.piece == "pillarDecor"
        || prop.piece == "pillarDamagedDecor"
    {
        if let Some(sh) = sprites.get("pillarPale") {
            let sc = prop.scale.unwrap_or_else(|| prop_scale(&prop.piece));
            let damaged = prop.piece == "pillarDamagedDecor";
            let (sx, sy, sw, sh_h) = if damaged {
                (
                    44u32,
                    0u32,
                    44u32.min(sh.width().saturating_sub(44)),
                    111u32.min(sh.height()),
                )
            } else {
                (0u32, 0u32, 44u32.min(sh.width()), 133u32.min(sh.height()))
            };
            let w = sw as f32 * sc[0] as f32;
            let h = sh_h as f32 * sc[1] as f32;
            let shake_x = if prop.hit_t > 0.0 {
                let amp = (prop.hit_t / 0.22).clamp(0.0, 1.0) as f32 * 3.5;
                ((prop.hit_t * 95.0).sin() as f32) * amp
            } else {
                0.0
            };
            c.draw_image(
                sh,
                sx,
                sy,
                sw,
                sh_h,
                x + shake_x - w * 0.5,
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

    let dedicated = match prop.piece.as_str() {
        "treeReference" => sprites
            .get("treeReference")
            .map(|sh| (sh, 0u32, 0u32, 153u32, 203u32)),
        "treeBossFruit" => sprites
            .get("treeFruitReference")
            .map(|sh| (sh, 0, 0, 153, 203)),
        "goblinBunker" => sprites.get("goblinBunker").map(|sh| (sh, 0, 0, 142, 138)),
        _ => None,
    };
    if let Some((sh, sx, sy, sw, sh_h)) = dedicated {
        let sc = prop.scale.unwrap_or_else(|| prop_scale(&prop.piece));
        let w = sw as f32 * sc[0] as f32;
        let h = sh_h as f32 * sc[1] as f32;
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
            1.0,
            0.0,
        );
        return;
    }

    if let Some(sh) = sprites.get(sheet_key) {
        if let Some([sx, sy, sw, sh_h]) = rect_at(&["SCENE", "pieces", &prop.piece]) {
            let sc = prop.scale.unwrap_or_else(|| prop_scale(&prop.piece));
            let w = sw as f32 * sc[0] as f32;
            let h = sh_h as f32 * sc[1] as f32;
            if prop.broken {
                let age = (state.time - prop.broken_at).max(0.0);
                if age >= BREAK_ANIM {
                    return;
                }
                let alpha = (1.0 - age / BREAK_ANIM).clamp(0.0, 1.0) as f32;
                let left = x - w * 0.5;
                let top = y - h;
                if prop.piece == "barrel" {
                    const BARREL_BREAK: [(&str, f32, f32); 12] = [
                        ("barrel1", 19.0, 28.0),
                        ("barrel2", 11.0, 32.0),
                        ("barrel3", 17.0, 34.0),
                        ("barrel4", 15.0, 32.0),
                        ("barrel5", 23.0, 26.0),
                        ("barrel6", 16.0, 27.0),
                        ("barrel7", 12.0, 31.0),
                        ("barrel8", 19.0, 34.0),
                        ("barrel9", 8.0, 28.0),
                        ("barrel10", 9.0, 28.0),
                        ("barrel11", 17.0, 28.0),
                        ("barrel12", 10.0, 31.0),
                    ];
                    let shown = ((age / BREAK_ANIM) * BARREL_BREAK.len() as f64) as usize;
                    for (idx, (chip, cx_off, cy_off)) in BARREL_BREAK.iter().enumerate() {
                        if idx > shown {
                            break;
                        }
                        if let Some([csx, csy, csw, csh]) = rect_at(&["SCENE", "pieces", chip]) {
                            let cw = csw as f32 * sc[0] as f32;
                            let ch = csh as f32 * sc[1] as f32;
                            c.draw_image(
                                sh,
                                csx,
                                csy,
                                csw,
                                csh,
                                left + cx_off * sc[0] as f32,
                                top + cy_off * sc[1] as f32,
                                cw,
                                ch,
                                false,
                                alpha,
                                0.0,
                            );
                        }
                    }
                    return;
                }
                c.draw_image(sh, sx, sy, sw, sh_h, left, top, w, h, false, alpha, 0.0);
                return;
            }
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
                1.0,
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
    let px = p.x as f32;
    let py = feet_y_player(p);
    let ground_y = floor_y(p.z);

    // Shadow
    c.fill_ellipse(
        px,
        ground_y + 3.0,
        (p.width * 0.75) as f32,
        6.0,
        Rgba::new(0, 0, 0, 86),
    );

    // Foot mark (bright neon-green oval ring on ground, always visible in all live states)
    if let Some(ui) = sprites.get("ui") {
        let fw = 130.0 / (265.0 / 84.0);
        let fh = 43.0 / (265.0 / 84.0);
        for _ in 0..4 {
            c.draw_image_additive(
                ui,
                1175,
                2901,
                81,
                28,
                px - fw * 0.5,
                ground_y - fh * 0.35,
                fw,
                fh,
                false,
                0.85,
                0.0,
            );
        }
    } else {
        c.fill_ellipse(px, ground_y, 20.0, 6.5, Rgba::new(140, 245, 50, 85));
        c.stroke_ellipse(px, ground_y, 20.0, 6.5, Rgba::new(198, 249, 68, 240), 2.2);
    }

    // Level-up golden light ring & particles
    let lvl_rem = state.xp_gauge_flash_until - state.time;
    if lvl_rem > 0.0 {
        let progress = (1.0 - lvl_rem / PROG_LEVEL_UP_FLASH_DURATION).clamp(0.0, 1.0) as f32;
        let radius = p.width as f32 * (0.6 + progress * 0.8);
        let opacity = 1.0 - progress;
        c.stroke_ellipse(
            px,
            ground_y,
            radius,
            radius * 0.18,
            Rgba::new(255, 203, 105, 255).with_alpha(opacity * 0.8),
            2.0,
        );
        for i in 0..6 {
            let angle =
                i as f32 * std::f32::consts::FRAC_PI_3 + progress * std::f32::consts::FRAC_PI_2;
            let sx = px + angle.cos() * radius;
            let sy =
                ground_y + angle.sin() * radius * 0.18 - progress * (44.0 + (i % 3) as f32 * 22.0);
            c.fill_rect(
                sx - 1.0,
                sy - 2.0,
                2.0,
                4.0,
                Rgba::new(255, 230, 165, 255).with_alpha(opacity * 0.85),
            );
        }
    }

    // Blood sword on back when hellbenter is active (not during hellbenterSlam)
    if p.skill_id.as_deref() != Some("hellbenterSlam")
        && p.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0
    {
        if let Some(eff) = sprites.get("effects") {
            let tier = p.hellbenter_tier.clamp(1, 8);
            let sword_row = core_rs::TABLES.skill_order.len() as u32 + 10;
            let col = (tier - 1).min((eff.width() / 128).saturating_sub(1));
            let size = 112.0f32;
            let back_x = px - p.facing as f32 * 8.0;
            let centre_y = py - 1.325 * 84.0 + (0.5 - 0.18) * size;
            c.draw_image(
                eff,
                col * 128,
                sword_row * 128,
                128,
                128,
                back_x - size * 0.5,
                centre_y - size * 0.5,
                size,
                size,
                p.facing < 0,
                0.95,
                0.0,
            );
        } else {
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
    }

    let raging = p.buffs.get("bloodRage").copied().unwrap_or(0.0) > 0.0
        || p.skill_id.as_deref() == Some("hellbenterSlam");
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

        // Mountain Breaker apex yellow flare behind him
        if p.skill_timer > 0.0 && p.skill_id.as_deref() == Some("mountainBreaker") {
            let dur = core_rs::TABLES
                .skills
                .get("mountainBreaker")
                .map(|s| s.duration.max(0.001))
                .unwrap_or(1.3);
            let prog = 1.0 - p.skill_timer / dur;
            if (0.325..=0.35).contains(&prog) {
                let scale = 1.45f32;
                let fw = dw * scale;
                let fh = dh * scale;
                let fx = if flip {
                    px - (fw - anchor_x * scale)
                } else {
                    px - anchor_x * scale
                };
                let fy = py - anchor_y * scale;
                let flare_sy = (8 * cell_h).min(sh.height().saturating_sub(cell_h));
                c.draw_image_additive(
                    sh, sx, flare_sy, cell_w, cell_h, fx, fy, fw, fh, flip, 0.9, 0.0,
                );
            }
        }

        c.draw_image(
            sh, sx, sy, cell_w, cell_h, draw_x, draw_y, dw, dh, flip, 1.0, 0.0,
        );

        // BloodRage front cream crescent arc over the swing
        if p.on_ground
            && p.skill_timer <= 0.0
            && p.attack_timer > 0.0
            && p.buffs.get("bloodRage").copied().unwrap_or(0.0) > 0.0
        {
            let arc_prog = if p.attack_duration > 0.0 {
                (1.0 - p.attack_timer / p.attack_duration).clamp(0.0, 0.999)
            } else {
                0.0
            };
            let arc_col = ((arc_prog * 22.0) as u32).min(21);
            let arc_sx = arc_col * cell_w;
            let arc_sy = (10 * cell_h).min(sh.height().saturating_sub(cell_h));
            c.draw_image_additive(
                sh,
                arc_sx,
                arc_sy,
                cell_w,
                cell_h,
                draw_x + p.facing as f32 * 7.0,
                draw_y + 5.0,
                dw,
                dh,
                flip,
                0.9,
                0.0,
            );
        }
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

    let label = player_overhead_label(p);
    c.fill_text(
        &label,
        px,
        py - 92.0,
        10.5,
        Rgba::new(240, 244, 252, 255),
        TextAlign::Center,
        Some(Rgba::new(16, 12, 24, 240)),
    );
}

pub fn player_overhead_label(p: &Player) -> String {
    let pname = p
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("阿努纳奇");
    format!("Lv.{} {}", p.level, pname)
}

struct SkillBeat {
    frames: u32,
    from: f64,
    until: f64,
    blood: bool,
}

fn eval_skill_beats(prog: f64, default_row: u32, first: u32, beats: &[SkillBeat]) -> (u32, u32) {
    let mut consumed = 0u32;
    for b in beats {
        let span = (b.until - b.from).max(0.0001);
        let local = ((prog - b.from) / span).clamp(0.0, 1.0);
        let step = consumed + ((local * b.frames as f64) as u32).min(b.frames.saturating_sub(1));
        consumed += b.frames;
        if prog <= b.until {
            let row = if b.blood { 7 } else { default_row };
            return (row, first + step);
        }
    }
    let last_blood = beats.last().is_some_and(|b| b.blood);
    let total: u32 = beats.iter().map(|b| b.frames).sum();
    (
        if last_blood { 7 } else { default_row },
        first + total.saturating_sub(1),
    )
}

fn player_sprite_frame(state: &State, p: &Player) -> (u32, u32) {
    if p.dead {
        return (4, 1);
    }
    if p.hurt_timer > 0.0 {
        return (4, 0);
    }
    if p.skill_timer > 0.0 {
        let sk_id = p.skill_id.as_deref().unwrap_or("");
        let dur = core_rs::TABLES
            .skills
            .get(sk_id)
            .map(|s| s.duration.max(0.001))
            .unwrap_or(0.5);
        let prog = (1.0 - p.skill_timer / dur).clamp(0.0, 1.0);
        return match sk_id {
            "upSlash" => (3, 6 + ((prog * 9.0) as u32).min(8)),
            "ghostSlash" => (13, ((prog * 18.0) as u32).min(17)),
            "normalWave" => (14, ((prog * 9.0) as u32).min(8)),
            "mountainBreaker" => eval_skill_beats(
                prog,
                5,
                0,
                &[
                    SkillBeat {
                        frames: 3,
                        from: 0.0,
                        until: 0.29,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.29,
                        until: 0.35,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.35,
                        until: 0.51,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.51,
                        until: 0.78,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.78,
                        until: 0.89,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 1,
                        from: 0.89,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "rageBurst" => eval_skill_beats(
                prog,
                5,
                12,
                &[
                    SkillBeat {
                        frames: 1,
                        from: 0.0,
                        until: 0.04,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 3,
                        from: 0.04,
                        until: 0.5,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 4,
                        from: 0.5,
                        until: 0.7,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.7,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "crossSlash" => eval_skill_beats(
                prog,
                5,
                22,
                &[
                    SkillBeat {
                        frames: 14,
                        from: 0.0,
                        until: 0.647,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 6,
                        from: 0.647,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "frenzy" => eval_skill_beats(
                prog,
                5,
                42,
                &[
                    SkillBeat {
                        frames: 6,
                        from: 0.0,
                        until: 0.52,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 8,
                        from: 0.52,
                        until: 0.85,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 3,
                        from: 0.85,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "mountainRift" => eval_skill_beats(
                prog,
                6,
                0,
                &[
                    SkillBeat {
                        frames: 2,
                        from: 0.0,
                        until: 0.135,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.135,
                        until: 0.285,
                        blood: true,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.285,
                        until: 0.6,
                        blood: true,
                    },
                    SkillBeat {
                        frames: 1,
                        from: 0.6,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "graspHead" => eval_skill_beats(
                prog,
                6,
                21,
                &[
                    SkillBeat {
                        frames: 4,
                        from: 0.0,
                        until: 0.0968,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 3,
                        from: 0.0968,
                        until: 0.1935,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 8,
                        from: 0.1935,
                        until: 0.6774,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.6774,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "berserk" => eval_skill_beats(
                prog,
                6,
                38,
                &[
                    SkillBeat {
                        frames: 4,
                        from: 0.0,
                        until: 0.35,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 6,
                        from: 0.35,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "bloodyRave" => eval_skill_beats(
                prog,
                6,
                48,
                &[
                    SkillBeat {
                        frames: 3,
                        from: 0.0,
                        until: 0.056,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 2,
                        from: 0.056,
                        until: 0.182,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 3,
                        from: 0.182,
                        until: 0.839,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 5,
                        from: 0.839,
                        until: 1.0,
                        blood: false,
                    },
                ],
            ),
            "hellbenter" => eval_skill_beats(
                prog,
                11,
                0,
                &[SkillBeat {
                    frames: 15,
                    from: 0.0,
                    until: 0.5,
                    blood: false,
                }],
            ),
            "hellbenterSlam" => eval_skill_beats(
                prog,
                11,
                15,
                &[
                    SkillBeat {
                        frames: 2,
                        from: 0.0,
                        until: 0.22 / 5.4,
                        blood: false,
                    },
                    SkillBeat {
                        frames: 12,
                        from: 0.22 / 5.4,
                        until: 0.6 / 5.4,
                        blood: false,
                    },
                ],
            ),
            _ => (3, ((prog * 6.0) as u32).min(5)),
        };
    }
    if !p.on_ground && p.attack_timer > 0.0 {
        let elapsed = p.attack_duration - p.attack_timer;
        let prog = if p.attack_duration > 0.0 {
            (elapsed / p.attack_duration).clamp(0.0, 0.99)
        } else {
            0.0
        };
        return (2, 23 + ((prog * 4.0) as u32).min(3));
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
        return (4, if p.vy < 0.0 { 2 } else { 3 });
    }
    if p.vx.abs() > 5.0 || p.vz.abs() > 5.0 {
        let col = ((state.time * 15.0) as u32) % 8;
        return (1, col);
    }
    let col = ((state.time * 6.0) as u32) % 4;
    (0, col)
}

fn enemy_frame(state: &State, enemy: &Enemy) -> u32 {
    let (idle, walk, attack, sweep, down) = match enemy.kind.as_str() {
        "caster" | "burningThrower" => ([0u32, 0], [1, 6], [7, 11], [7, 11], [12, 16]),
        "brute" | "boss" => ([0, 1], [20, 27], [2, 6], [2, 6], [9, 12]),
        "cat" | "lugaruBoss" => ([0, 0], [20, 28], [1, 4], [8, 11], [16, 19]),
        _ => ([0, 0], [11, 16], [0, 4], [0, 4], [5, 9]),
    };
    if enemy.dead || enemy.knockdown > 0.0 {
        return down[1];
    }
    if enemy.attack_timer > 0.0 {
        let range = if enemy.attack_kind == "sweep" {
            sweep
        } else {
            attack
        };
        let dur = enemy.attack_duration.max(0.001);
        let prog = (1.0 - enemy.attack_timer / dur).clamp(0.0, 0.999);
        let span = range[1] - range[0];
        return range[0] + ((prog * (span + 1) as f64) as u32).min(span);
    }
    if enemy.vx.abs() > 1.0 || enemy.vz.abs() > 1.0 {
        let span = walk[1] - walk[0] + 1;
        return walk[0] + ((state.time * 10.0) as u32) % span;
    }
    let span = idle[1] - idle[0] + 1;
    idle[0] + ((state.time * 3.2) as u32) % span
}

pub fn champion_affix(enemy: &Enemy) -> Option<&'static str> {
    let champ = enemy.champion.as_deref()?;
    if champ == "fire" || champ == "champfire" {
        Some("火焰爆炸")
    } else {
        Some("无法浮空")
    }
}

fn draw_champion_aura(
    c: &mut Canvas<'_>,
    state: &State,
    enemy: &Enemy,
    sprites: &SpriteStore,
    back: bool,
) {
    if enemy.dead {
        return;
    }
    let Some(ref champ) = enemy.champion else {
        return;
    };
    let is_fire = champ == "fire" || champ == "champfire";
    let ui_key = match (is_fire, back) {
        (true, true) => "champfireback",
        (true, false) => "champfire",
        (false, true) => "champdarkback",
        (false, false) => "champdark",
    };
    let ex = enemy.x as f32;
    let ey = feet_y_enemy(enemy);
    let ground_y = floor_y(enemy.z);
    let frames = RENDER_TABLES
        .get("UI")
        .and_then(|u| u.get(ui_key))
        .and_then(|v| v.get("frames"))
        .and_then(|f| f.as_array());

    if let (Some(ui), Some(frames)) = (sprites.get("ui"), frames) {
        if !frames.is_empty() {
            const UI_SCALE: f32 = (1.6 * 84.0) / 265.0;
            const AURA_FPS: f64 = 12.0;
            let idx = ((state.time.max(0.0) * AURA_FPS) as usize) % frames.len();
            if let Some(arr) = frames[idx].as_array() {
                if arr.len() >= 4 {
                    let fx = arr[0].as_u64().unwrap_or(0) as u32;
                    let fy = arr[1].as_u64().unwrap_or(0) as u32;
                    let fw = arr[2].as_u64().unwrap_or(0) as u32;
                    let fh = arr[3].as_u64().unwrap_or(0) as u32;
                    let dw = fw as f32 * UI_SCALE * CAMERA_ZOOM as f32;
                    let dh = fh as f32 * UI_SCALE * CAMERA_ZOOM as f32;
                    if back {
                        c.draw_image(
                            ui,
                            fx,
                            fy,
                            fw,
                            fh,
                            ex - dw * 0.5,
                            ey - dh * 0.82,
                            dw,
                            dh,
                            false,
                            0.85,
                            0.0,
                        );
                    } else {
                        c.draw_image_additive(
                            ui,
                            fx,
                            fy,
                            fw,
                            fh,
                            ex - dw * 0.5,
                            ey - dh * 0.82,
                            dw,
                            dh,
                            false,
                            0.85,
                            0.0,
                        );
                    }
                    return;
                }
            }
        }
    }

    // Animated procedural flame fallback when ui.png is unavailable
    let phase = (state.time * 8.0) as f32;
    let pulse = 0.85 + 0.15 * phase.sin();
    let (outer, inner) = if is_fire {
        (Rgba::new(255, 108, 32, 130), Rgba::new(255, 210, 90, 150))
    } else {
        (Rgba::new(178, 56, 238, 135), Rgba::new(236, 140, 255, 160))
    };
    let rx = (enemy.width as f32 * 0.95).max(26.0) * pulse;
    if back {
        c.fill_ellipse(ex, ground_y - 2.0, rx, 10.0 * pulse, outer);
        for i in 0..5 {
            let a = phase + i as f32 * 1.25;
            let fx = ex + (a * 0.7).sin() * (rx * 0.55);
            let fh = 16.0 + (a * 1.3).cos().abs() * 14.0;
            c.fill_ellipse(fx, ground_y - fh * 0.5, 8.0, fh * 0.55, outer);
        }
    } else {
        c.fill_ellipse(ex, ground_y, rx * 0.65, 6.5 * pulse, inner);
    }
}

pub fn draw_enemy(c: &mut Canvas<'_>, state: &State, enemy: &Enemy, sprites: &SpriteStore) {
    let jitter_x = if !enemy.dead && (enemy.hit_flash_timer > 0.0 || enemy.hurt_timer > 0.04) {
        let active_t = enemy.hit_flash_timer.max(enemy.hurt_timer * 0.65);
        let amp = (active_t / 0.12).clamp(0.0, 1.0) as f32 * 2.6;
        amp * ((state.time * 95.0 + f64::from(enemy.id) * 1.7).sin() as f32)
    } else {
        0.0
    };
    let ex = enemy.x as f32 + jitter_x;
    let ey = feet_y_enemy(enemy);
    let ground_y = floor_y(enemy.z);
    let w = enemy.width as f32;
    let h = enemy.height as f32;
    let is_boss = enemy.behavior == "boss";

    if !is_boss {
        c.fill_ellipse(
            ex,
            ground_y,
            (w * 0.55).max(14.0),
            5.0,
            Rgba::new(0, 0, 0, 100),
        );
    }

    draw_champion_aura(c, state, enemy, sprites, true);

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
        let col = enemy_frame(state, enemy).min(max_col);
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
        if enemy.silhouette {
            c.draw_image_white_silhouette(
                sh, sx, sy, cell_w, cell_h, draw_x, draw_y, dw, dh, flip, 1.0,
            );
        } else {
            if is_boss && !enemy.dead {
                c.draw_image_outline(
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
                    Rgba::new(156, 14, 28, 245),
                    1.6,
                );
            }
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
            if !enemy.dead && enemy.hit_flash_timer > 0.0 {
                let flash_alpha = ((enemy.hit_flash_timer / 0.12).clamp(0.0, 1.0) as f32) * 0.65;
                c.draw_image_white_silhouette(
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
                    flash_alpha,
                );
            }
        }
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
        if is_boss && !enemy.dead {
            c.stroke_round_rect(
                ex - w * 0.5 - 1.5,
                ey - h - 1.5,
                w + 3.0,
                h + 3.0,
                6.0,
                Rgba::new(156, 14, 28, 245),
                2.5,
            );
        }
        c.fill_round_rect(ex - w * 0.5, ey - h, w, h, 5.0, body_col);
        if !enemy.dead && enemy.hit_flash_timer > 0.0 {
            let flash_alpha = ((enemy.hit_flash_timer / 0.12).clamp(0.0, 1.0) as f32) * 0.65;
            c.fill_round_rect(
                ex - w * 0.5,
                ey - h,
                w,
                h,
                5.0,
                Rgba::new(255, 255, 255, 255).with_alpha(flash_alpha),
            );
        }
    }

    draw_champion_aura(c, state, enemy, sprites, false);

    if !enemy.dead {
        if is_boss {
            let title_y = ey - h.max(54.0) - 8.0;
            c.fill_text(
                &enemy.label,
                ex,
                title_y,
                10.5,
                Rgba::new(221, 4, 195, 255),
                TextAlign::Center,
                Some(Rgba::new(24, 4, 32, 235)),
            );
        } else if let Some(affix) = champion_affix(enemy) {
            let name_y = ey - h - 10.0;
            let affix_y = name_y - 12.0;
            c.fill_text(
                affix,
                ex,
                affix_y,
                10.0,
                Rgba::new(242, 246, 255, 255),
                TextAlign::Center,
                Some(Rgba::new(16, 10, 24, 235)),
            );
            c.fill_text(
                &enemy.label,
                ex,
                name_y,
                10.0,
                Rgba::new(169, 117, 229, 255),
                TextAlign::Center,
                Some(Rgba::new(24, 4, 32, 235)),
            );
        }
    }
}

const DECAL_PIECES: [&str; 9] = [
    "grassFlower",
    "sprout",
    "flower",
    "bush",
    "grassPatch",
    "leaves",
    "leavesBroad",
    "leavesDense",
    "pebble",
];

pub fn draw_world(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore) {
    for p in &state.props {
        if !p.gone && DECAL_PIECES.contains(&p.piece.as_str()) {
            draw_prop(c, state, p, sprites);
        }
    }

    struct WorldItem {
        z: f64,
        kind: u8,
        idx: usize,
    }
    let mut items = Vec::new();
    for (idx, p) in state.props.iter().enumerate() {
        if !p.gone && !DECAL_PIECES.contains(&p.piece.as_str()) {
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

    items.sort_by(|a, b| b.z.total_cmp(&a.z).then_with(|| a.kind.cmp(&b.kind)));

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
                    let pulse = (0.94 + 0.06 * (state.time * 14.0 + drop.x * 0.05).sin()) as f32;
                    let size = (2.0 * drop.radius as f32 * pulse) / 0.595;
                    let life_alpha = if drop.life < 0.25 {
                        (drop.life / 0.25).max(0.2) as f32
                    } else {
                        1.0
                    };
                    let frame = ((state.time * 14.0 + drop.x * 0.05) as u32) % 6;
                    if let Some(eff) = sprites.get("effects") {
                        for back in (1..drop.trail.len()).rev() {
                            let pt = drop.trail[back];
                            let tx = pt[0] as f32;
                            let ty = (pt[1] - depth_lift(pt[2])) as f32;
                            let ta = life_alpha
                                * 0.5
                                * (1.0 - back as f32 / (drop.trail.len() as f32 + 1.0));
                            c.draw_image(
                                eff,
                                frame * 128,
                                14 * 128,
                                128,
                                128,
                                tx - size * 0.5,
                                ty - size * 0.5,
                                size,
                                size,
                                false,
                                ta,
                                0.0,
                            );
                        }
                        let halo = drop.radius as f32 * 1.25 * pulse;
                        c.fill_ellipse(
                            dx,
                            dy,
                            halo,
                            halo,
                            Rgba::new(225, 42, 66, 110).with_alpha(life_alpha),
                        );
                        c.draw_image(
                            eff,
                            frame * 128,
                            14 * 128,
                            128,
                            128,
                            dx - size * 0.5,
                            dy - size * 0.5,
                            size,
                            size,
                            false,
                            life_alpha,
                            0.0,
                        );
                        let hot = drop.radius as f32 * 0.42 * pulse;
                        c.fill_ellipse(
                            dx,
                            dy,
                            hot,
                            hot,
                            Rgba::new(255, 255, 255, 210).with_alpha(life_alpha),
                        );
                    } else {
                        c.fill_ellipse(dx, dy, 8.0, 8.0, Rgba::new(225, 42, 54, 230));
                    }
                } else {
                    crate::combat_info::draw_loot_plate(c, state, drop, dx, dy);
                }
            }
            3 => {
                let f = &state.fields[item.idx];
                let (prog, fade) = core_rs::combat::field_progress(f);
                let fx = f.x as f32;
                let fy = floor_y(f.z);
                if let Some(rift) = sprites.get("rift") {
                    let size = 501.0f32;
                    let dy = fy - size * 0.25;
                    let max_col = (rift.width() / 384).saturating_sub(1);
                    let col = ((prog.clamp(0.0, 0.999) * 45.0) as u32).min(max_col);
                    let flip = f.facing < 0;
                    let rows: &[u32] = if f.skill_id == "hellbenterSlam" {
                        &[2]
                    } else {
                        &[0, 1]
                    };
                    for &row in rows {
                        c.draw_image(
                            rift,
                            col * 384,
                            row * 384,
                            384,
                            384,
                            fx - size * 0.5,
                            dy - size * 0.5,
                            size,
                            size,
                            flip,
                            fade as f32,
                            0.0,
                        );
                    }
                } else {
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
                        let ice_scale = NATIVE_SCALE as f32;
                        let frame = (((age + 1e-7) / 0.05) as u32) % 8;
                        // Trailing icy mist/sparkle decay particles along the Z-sine path.
                        for step in 1..=4i32 {
                            let trail_dt = f64::from(step) * 0.045;
                            if age < trail_dt {
                                continue;
                            }
                            let t_age = age - trail_dt;
                            let tx = (pr.x - pr.vx * trail_dt) as f32;
                            let t_osc = if pr.z_sine_amp > 0.0 {
                                -(t_age * pr.z_sine_rad_per_sec).sin() * pr.z_sine_amp
                            } else {
                                0.0
                            };
                            let ty = (pr.y + t_osc - depth_lift(pr.z)) as f32;
                            let fade = (1.0 - (trail_dt / 0.22) as f32).clamp(0.0, 1.0);
                            let r = (5.5 - f32::from(step as u8) * 0.8) * ice_scale;
                            c.fill_ellipse(
                                tx,
                                ty,
                                r,
                                r * 0.75,
                                Rgba::new(170, 232, 255, (fade * 140.0) as u8),
                            );
                        }
                        if let Some(aura) = sprites.get("goblinIceAura") {
                            let aura_frame = (((age + 1e-7) / 0.09) as u32) % 15;
                            let aw = 192.0 * ice_scale;
                            let ah = 64.0 * ice_scale;
                            c.draw_image_additive(
                                aura,
                                aura_frame * 192,
                                0,
                                192,
                                64,
                                px - aw * 0.5,
                                py - ah * 0.5,
                                aw,
                                ah,
                                flip,
                                85.0 / 255.0,
                                0.0,
                            );
                        }
                        let iw = 64.0 * ice_scale;
                        let ih = 64.0 * ice_scale;
                        c.draw_image(
                            sh,
                            frame * 64,
                            0,
                            64,
                            64,
                            px - iw * 0.5,
                            py - ih * 0.5,
                            iw,
                            ih,
                            flip,
                            1.0,
                            0.0,
                        );
                    }),
                    Some(30047) => sprites.get("goblinFire").map(|sh| {
                        let fire_scale = NATIVE_SCALE as f32 * 0.7;
                        let emit_end = if pr.stopped { pr.stopped_at } else { age };
                        let ref_vx = if pr.stopped { pr.stop_vx } else { pr.vx };
                        let ref_vy = if pr.stopped { pr.stop_vy } else { pr.vy };
                        let ref_g = if pr.stopped {
                            pr.stop_gravity
                        } else {
                            pr.gravity
                        };
                        let fire_flip = ref_vx < 0.0;
                        let start_em = (((age - 0.35 + 1e-7) / 0.02).ceil().max(0.0)) as i32;
                        let end_em = ((emit_end + 1e-7) / 0.02).floor() as i32;
                        let base_y = pr.y - depth_lift(pr.z);
                        let sz = 128.0 * fire_scale;
                        for em in start_em..=end_em {
                            let birth_age = f64::from(em) * 0.02;
                            let particle_age = (age - birth_age).max(0.0);
                            if particle_age >= 0.35 {
                                continue;
                            }
                            let life_frac = (particle_age / 0.35) as f32;
                            let fire_frame: u32 = if particle_age < 0.23 { 0 } else { 1 };
                            let dt_ref = emit_end - birth_age;
                            let jx = ((((em * 37 + pr.id as i32 * 13).rem_euclid(9)) - 4) as f32)
                                * 0.65
                                * fire_scale;
                            let jy = ((((em * 53 + pr.id as i32 * 7).rem_euclid(9)) - 4) as f32)
                                * 0.65
                                * fire_scale;
                            let fx = (pr.x - ref_vx * dt_ref) as f32 + jx;
                            let fy = (base_y - ref_vy * dt_ref + ref_g * dt_ref * dt_ref * 0.5)
                                as f32
                                + jy;
                            let decay = (1.0 - life_frac).powf(1.25);
                            let alpha = if fire_frame == 0 {
                                (0.45 + 0.55 * decay).clamp(0.0, 1.0)
                            } else {
                                (decay * 0.55).clamp(0.0, 1.0)
                            };
                            let p_sz = sz * (0.88 + 0.18 * (1.0 - life_frac));
                            c.draw_image(
                                sh,
                                fire_frame * 128,
                                0,
                                128,
                                128,
                                fx - p_sz * 0.5,
                                fy - p_sz * 0.5,
                                p_sz,
                                p_sz,
                                fire_flip,
                                alpha,
                                -std::f32::consts::PI,
                            );
                            if particle_age < 0.08 {
                                let glow_a = (1.0 - (particle_age / 0.08) as f32) * 0.42;
                                c.draw_image_additive(
                                    sh,
                                    0,
                                    0,
                                    128,
                                    128,
                                    fx - p_sz * 0.45,
                                    fy - p_sz * 0.45,
                                    p_sz * 0.9,
                                    p_sz * 0.9,
                                    fire_flip,
                                    glow_a,
                                    -std::f32::consts::PI,
                                );
                            }
                        }
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
                let sy = (sh.y - depth_lift(sh.z)) as f32;
                let age = (sh.max_life - sh.life).max(0.0);
                if sh.skill_id == "normalWave" {
                    let frame = (((age + 1e-7) / (1.0 / 15.0)) as u32).min(4);
                    let size = 217.6f32;
                    let drawn = if let Some(nw) = sprites.get("normalWave") {
                        c.draw_image_additive(
                            nw,
                            frame * 320,
                            320,
                            320,
                            320,
                            sx - size * 0.5,
                            sy - size * 0.5,
                            size,
                            size,
                            sh.facing < 0,
                            0.95,
                            0.0,
                        );
                        true
                    } else if let Some(eff) = sprites.get("effects") {
                        c.draw_image_additive(
                            eff,
                            frame * 128,
                            31 * 128,
                            128,
                            128,
                            sx - size * 0.5,
                            sy - size * 0.5,
                            size,
                            size,
                            sh.facing < 0,
                            0.92,
                            0.0,
                        );
                        true
                    } else {
                        false
                    };
                    if !drawn {
                        c.fill_ellipse(sx, sy - 24.0, 28.0, 18.0, Rgba::new(225, 58, 72, 200));
                    }
                } else if sh.skill_id == "crossSlash" {
                    let frame = ((age / 0.05) as u32) % 6;
                    let size = 148.0f32;
                    if let Some(eff) = sprites.get("effects") {
                        c.draw_image_additive(
                            eff,
                            frame * 128,
                            4 * 128,
                            128,
                            128,
                            sx - size * 0.5,
                            sy - size * 0.5 - 32.0,
                            size,
                            size,
                            sh.facing < 0,
                            0.95,
                            0.0,
                        );
                    } else {
                        c.fill_ellipse(sx, sy - 32.0, 32.0, 20.0, Rgba::new(235, 54, 68, 220));
                    }
                } else {
                    c.fill_ellipse(sx, sy - 24.0, 22.0, 14.0, Rgba::new(225, 92, 92, 200));
                }
            }
            6 => draw_player(c, state, sprites),
            _ => {}
        }
    }

    // Active skill / rage slash visual
    let flip = state.player.facing < 0;
    if state.player.skill_timer > 0.0 {
        if let Some(sk_id) = state.player.skill_id.as_deref() {
            let dur = core_rs::TABLES
                .skills
                .get(sk_id)
                .map(|sk| sk.duration.max(0.1))
                .unwrap_or(0.5);
            let prog = (1.0 - (state.player.skill_timer / dur)).clamp(0.0, 0.999);
            let feet = feet_y_player(&state.player);
            let facing_f = state.player.facing as f32;

            if sk_id == "mountainRift" {
                if let Some(rift) = sprites.get("rift") {
                    let max_col = (rift.width() / 384).saturating_sub(1);
                    let frame = ((prog * 45.0) as u32).min(max_col);
                    let size = 501.0f32;
                    let px = state.player.x as f32;
                    let py = floor_y(state.player.z) - 125.0;
                    for row in [0u32, 1u32] {
                        c.draw_image(
                            rift,
                            frame * 384,
                            row * 384,
                            384,
                            384,
                            px - size * 0.5,
                            py - size * 0.5,
                            size,
                            size,
                            flip,
                            0.95,
                            0.0,
                        );
                    }
                }
            } else if sk_id == "normalWave" {
                if let Some(nw) = sprites.get("normalWave") {
                    let max_col = (nw.width() / 320).saturating_sub(1);
                    let frame = ((prog * 5.0) as u32).min(max_col);
                    let size = 217.6f32;
                    let px = state.player.x as f32 + facing_f * 21.76;
                    let py = feet - 21.76;
                    c.draw_image(
                        nw,
                        frame * 320,
                        0,
                        320,
                        320,
                        px - size * 0.5,
                        py - size * 0.5,
                        size,
                        size,
                        flip,
                        0.95,
                        0.0,
                    );
                }
            } else if let (Some(row), Some(eff)) = (
                core_rs::TABLES
                    .skill_order
                    .iter()
                    .position(|id| id == sk_id)
                    .map(|i| i as u32),
                sprites.get("effects"),
            ) {
                let (from, to, frames, dx, dy, size) = match sk_id {
                    "upSlash" => (0.0f64, 1.0f64, 9u32, 34.0f32, -56.0f32, 156.0f32),
                    "mountainBreaker" => (0.38, 0.95, 6, 70.0, -66.0, 264.0),
                    "crossSlash" => (0.0, 1.0, 34, 75.0, -24.0, 405.0),
                    "bloodSword" => (0.0, 1.0, 27, 30.0, -32.0, 182.0),
                    "frenzy" => (0.07, 0.45, 13, 28.0, -62.0, 130.0),
                    "bloodyRave" => (0.0, 1.0, 24, 0.0, -180.0, 720.0),
                    "rageBurst" => (0.0, 0.99, 36, 0.0, -79.0, 317.0),
                    "bloodSnatch" => (0.0, 1.0, 19, 56.0, -46.0, 190.0),
                    "graspHead" => (0.0, 1.0, 31, 0.0, -82.67, 330.67),
                    "bloodEvil" => (0.0, 1.0, 15, 44.0, -30.0, 178.0),
                    "berserk" => (0.0, 1.0, 13, 0.0, -62.0, 130.0),
                    "ghostSlash" => (0.15 / 0.95, 0.45 / 0.95, 6, 31.28, -46.24, 144.16),
                    _ => (0.0, 1.0, 6, 32.0, -40.0, 128.0),
                };
                if prog >= from && prog <= to {
                    let local_p = ((prog - from) / (to - from).max(0.0001)).clamp(0.0, 0.999);
                    let max_col = (eff.width() / 128).saturating_sub(1);
                    let frame = ((local_p * frames as f64) as u32).min(max_col);
                    let px = state.player.x as f32 + facing_f * dx;
                    let py = feet + dy;
                    c.draw_image(
                        eff,
                        frame * 128,
                        row * 128,
                        128,
                        128,
                        px - size * 0.5,
                        py - size * 0.5,
                        size,
                        size,
                        flip,
                        0.92,
                        0.0,
                    );
                    if sk_id == "ghostSlash" {
                        let front_row = core_rs::TABLES.skill_order.len() as u32 + 16;
                        c.draw_image(
                            eff,
                            frame * 128,
                            front_row * 128,
                            128,
                            128,
                            px - size * 0.5,
                            py - size * 0.5,
                            size,
                            size,
                            flip,
                            0.92,
                            0.0,
                        );
                    }
                }
            }
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

pub fn draw_effect(c: &mut Canvas<'_>, state: &State, effect: &Effect, sprites: &SpriteStore) {
    let alpha = if effect.max_life > 0.0 {
        (effect.life / effect.max_life).clamp(0.0, 1.0) as f32
    } else {
        1.0
    };
    match effect.kind.as_str() {
        "damage" => {
            let x = effect.x as f32;
            let age = (1.0 - alpha).clamp(0.0, 1.0);
            let y = (effect.y - depth_lift(effect.z)) as f32 - age * 20.0;
            let draw_alpha = if alpha < 0.30 {
                (alpha / 0.30).clamp(0.0, 1.0)
            } else {
                1.0
            };
            if effect.miss {
                c.fill_text(
                    &effect.text,
                    x,
                    y,
                    14.0,
                    Rgba::new(205, 222, 240, 255).with_alpha(draw_alpha),
                    TextAlign::Center,
                    Some(Rgba::new(10, 14, 22, 235).with_alpha(draw_alpha)),
                );
            } else if let Some(dsh) = sprites.get("damageDigits") {
                const CELL_W: u32 = 24;
                const CELL_H: u32 = 22;
                const DIGIT_ADV: [f32; 10] =
                    [17.0, 11.0, 17.0, 17.0, 17.0, 17.0, 17.0, 17.0, 17.0, 17.0];
                let digits: Vec<usize> = effect
                    .text
                    .chars()
                    .filter_map(|ch| ch.to_digit(10).map(|d| d as usize))
                    .collect();
                if !digits.is_empty() {
                    let row: u32 = if effect.player_hit {
                        2
                    } else if effect.critical {
                        1
                    } else {
                        0
                    };
                    let pop = if age < 0.14 {
                        1.28 - (age / 0.14) * 0.28
                    } else {
                        1.0
                    };
                    let base_scale = if effect.critical { 0.96 } else { 0.72 };
                    let scale = base_scale * pop;
                    let total_w: f32 = digits.iter().map(|&d| DIGIT_ADV[d] * scale).sum();
                    let dw = CELL_W as f32 * scale;
                    let dh = CELL_H as f32 * scale;
                    let mut cur_x = x - total_w * 0.5;
                    for &d in &digits {
                        let adv = DIGIT_ADV[d] * scale;
                        let glyph_x = cur_x + (adv - dw) * 0.5;
                        c.draw_image(
                            dsh,
                            (d as u32) * CELL_W,
                            row * CELL_H,
                            CELL_W,
                            CELL_H,
                            glyph_x,
                            y - dh,
                            dw,
                            dh,
                            false,
                            draw_alpha,
                            0.0,
                        );
                        cur_x += adv;
                    }
                }
            } else {
                let col = if effect.player_hit {
                    Rgba::new(235, 52, 52, 255).with_alpha(draw_alpha)
                } else if effect.critical {
                    Rgba::new(255, 138, 32, 255).with_alpha(draw_alpha)
                } else {
                    Rgba::new(255, 224, 72, 255).with_alpha(draw_alpha)
                };
                let size = if effect.critical { 21.0 } else { 16.0 };
                c.fill_text(
                    &effect.text,
                    x,
                    y,
                    size,
                    col,
                    TextAlign::Center,
                    Some(Rgba::new(0, 0, 0, 230).with_alpha(draw_alpha)),
                );
            }
        }
        "hitFlash" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            let age = (1.0 - alpha).clamp(0.0, 1.0);
            let draw_alpha = if age > 0.72 {
                ((1.0 - age) / 0.28).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let flip = effect.dir < 0;
            if let Some(ish) = sprites.get("impactFlash") {
                const CELL_W: u32 = 144;
                const CELL_H: u32 = 128;
                let col: u32 = if age < 0.48 {
                    0
                } else if age < 0.76 {
                    1
                } else {
                    2
                };
                let row = (effect.variant.min(2)) as u32;
                let base_scale = (effect.radius.max(0.5) as f32) * (0.74 + age * 0.16);
                let dw = CELL_W as f32 * base_scale;
                let dh = CELL_H as f32 * base_scale;
                c.draw_image(
                    ish,
                    col * CELL_W,
                    row * CELL_H,
                    CELL_W,
                    CELL_H,
                    ex - dw * 0.5,
                    ey - dh * 0.5,
                    dw,
                    dh,
                    flip,
                    draw_alpha,
                    0.0,
                );
                if effect.gold && age < 0.65 {
                    let slash_col: u32 = if age < 0.30 { 0 } else { 1 };
                    let slash_scale = base_scale * 0.92;
                    let sdw = CELL_W as f32 * slash_scale;
                    let sdh = CELL_H as f32 * slash_scale;
                    c.draw_image(
                        ish,
                        slash_col * CELL_W,
                        2 * CELL_H,
                        CELL_W,
                        CELL_H,
                        ex - sdw * 0.5,
                        ey - sdh * 0.5,
                        sdw,
                        sdh,
                        flip,
                        draw_alpha * 0.9,
                        0.0,
                    );
                }
            } else {
                // Procedural fallback starburst if sheet is unavailable
                let reach = (effect.radius.max(0.5) as f32) * (36.0 + age * 14.0);
                c.fill_ellipse(
                    ex,
                    ey,
                    reach * 0.55,
                    reach * 0.55,
                    Rgba::new(255, 252, 224, 240).with_alpha(draw_alpha),
                );
            }
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
        "pickupText" | "xp" => {
            let x = if effect.anchor == "player" {
                state.player.x as f32
            } else {
                effect.x as f32
            };
            let base_y = if effect.anchor == "player" {
                feet_y_player(&state.player) - 96.0
            } else {
                (effect.y - depth_lift(effect.z)) as f32
            };
            let y = base_y - (1.0 - alpha) * 20.0;
            let xp_digits: Option<String> = if effect.kind == "xp" && effect.amount > 0 {
                Some(format!("+{}", effect.amount))
            } else if let Some(prefix) = effect.text.strip_suffix(" Exp") {
                if !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit() || ch == '+') {
                    Some(prefix.to_string())
                } else {
                    None
                }
            } else {
                None
            };
            if let (Some(dsh), Some(num_str)) = (sprites.get("experienceDigits"), xp_digits) {
                const ADVANCES: [f32; 11] = [
                    12.0, 7.0, 11.0, 11.0, 11.0, 10.0, 11.0, 11.0, 11.0, 11.0, 10.0,
                ];
                let scale = NATIVE_SCALE as f32;
                let slots: Vec<usize> = num_str
                    .chars()
                    .filter_map(|ch| {
                        if ch == '+' {
                            Some(10)
                        } else {
                            ch.to_digit(10).map(|d| d as usize)
                        }
                    })
                    .collect();
                let num_w: f32 = slots.iter().map(|&s| ADVANCES[s]).sum::<f32>() * scale;
                let gap = scale;
                let exp_w = 18.0 * scale;
                let total_w = num_w + gap + exp_w;
                let edge = camera_x(state);
                let margin = total_w * 0.5 + 5.0 / CAMERA_ZOOM as f32;
                let cx = x.clamp(edge + margin, edge + window_width() as f32 - margin);
                let mut cur_x = cx - total_w * 0.5;
                let cell_sz = 16.0 * scale;
                for &slot in &slots {
                    c.draw_image(
                        dsh,
                        (slot as u32) * 16,
                        0,
                        16,
                        16,
                        cur_x,
                        y - cell_sz,
                        cell_sz,
                        cell_sz,
                        false,
                        alpha,
                        0.0,
                    );
                    cur_x += ADVANCES[slot] * scale;
                }
                c.fill_text(
                    "Exp",
                    cur_x + gap,
                    y - 2.0,
                    10.0,
                    Rgba::new(150, 245, 165, 255).with_alpha(alpha),
                    TextAlign::Left,
                    Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
                );
            } else {
                c.fill_text(
                    &effect.text,
                    x,
                    y,
                    13.0,
                    Rgba::new(150, 245, 165, 255).with_alpha(alpha),
                    TextAlign::Center,
                    Some(Rgba::new(0, 0, 0, 220).with_alpha(alpha)),
                );
            }
        }
        "shockwave" => {
            let r = (effect.radius as f32) * (1.15 - alpha * 0.35);
            let col = if effect.gold {
                Rgba::new(255, 209, 102, 255)
            } else if effect.arc {
                Rgba::new(255, 176, 102, 255)
            } else {
                Rgba::new(235, 92, 68, 255)
            };
            let stroke_w = if effect.gold {
                6.0
            } else if effect.arc {
                4.0
            } else {
                2.5
            };
            c.stroke_ellipse(
                effect.x as f32,
                floor_y(effect.z),
                r,
                r * DEPTH_SCALE as f32,
                col.with_alpha(alpha * 0.85),
                stroke_w,
            );
        }
        "rageGather" => {
            let elapsed = (effect.max_life - effect.life).max(0.0);
            if elapsed >= effect.delay && !state.player.dead {
                let span = (effect.max_life - effect.delay).max(1e-4);
                let t = ((elapsed - effect.delay) / span).clamp(0.0, 1.0) as f32;
                let shrink = if t < 0.6 { 1.0 } else { 1.0 - (t - 0.6) / 0.4 };
                if shrink > 0.0 {
                    let sh = state.player.height as f32 * 1.3;
                    let px = state.player.x as f32;
                    let py = feet_y_player(&state.player) - sh;
                    if let Some(eff) = sprites.get("effects") {
                        let col = ((t * 4.0) as u32).min(3);
                        let sz = 46.0 * shrink;
                        let gx = px + state.player.facing as f32 * sh * 0.4;
                        c.draw_image(
                            eff,
                            col * 128,
                            24 * 128,
                            128,
                            128,
                            gx - sz * 0.5,
                            py - sz * 0.5,
                            sz,
                            sz,
                            state.player.facing < 0,
                            shrink,
                            0.0,
                        );
                    }
                    let star_t = t / 0.45;
                    if star_t <= 1.0 {
                        let star_a = 0.95
                            * if star_t < 0.35 {
                                1.0
                            } else {
                                1.0 - (star_t - 0.35) / 0.65
                            };
                        let half = sh * 0.27;
                        for i in 0..12 {
                            let ang = (i as f32 / 12.0) * std::f32::consts::TAU
                                + std::f32::consts::FRAC_PI_6 * 0.5;
                            let reach = half * if i % 3 == 0 { 1.15 } else { 0.72 };
                            c.draw_line(
                                px + ang.cos() * half * 0.25,
                                py + ang.sin() * half * 0.25,
                                px + ang.cos() * reach,
                                py + ang.sin() * reach,
                                Rgba::new(120, 196, 236, 230).with_alpha(star_a),
                                (sh * 0.022).max(1.0),
                            );
                        }
                        c.fill_ellipse(
                            px,
                            py,
                            half * 0.85,
                            half * 0.22,
                            Rgba::new(255, 255, 255, 240).with_alpha(star_a),
                        );
                        c.fill_ellipse(
                            px,
                            py,
                            half * 0.2,
                            half * 0.72,
                            Rgba::new(255, 255, 255, 240).with_alpha(star_a),
                        );
                    }
                }
            }
        }
        "ghost" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            let r = effect.radius.max(18.0) as f32;
            c.stroke_ellipse(
                ex,
                ey,
                r,
                r * 0.65,
                Rgba::new(148, 92, 235, 255).with_alpha(alpha * 0.75),
                6.0,
            );
        }
        "bloodStrand" => {
            if let Some(eff) = sprites.get("effects") {
                let progress = (1.0 - alpha).clamp(0.0, 1.0);
                let to_x = state.player.x as f32 - state.player.facing as f32 * 4.0;
                let to_y = feet_y_player(&state.player) - state.player.height as f32 * 0.62;
                let sx = effect.x as f32;
                let sy = (effect.y - depth_lift(effect.z)) as f32;
                let hx = sx + (to_x - sx) * progress;
                let hy = sy + (to_y - sy) * progress;
                let dx = hx - sx;
                let dy = hy - sy;
                let len = dx.hypot(dy);
                if len >= 1.0 {
                    let col = ((progress * 4.0) as u32).min(3);
                    let sz = (len / (112.0 / 128.0)) * 1.08;
                    let ang = dy.atan2(dx) + std::f32::consts::FRAC_PI_2;
                    c.draw_image(
                        eff,
                        col * 128,
                        15 * 128,
                        128,
                        128,
                        hx - sz * 0.5,
                        hy - sz * 0.5,
                        sz,
                        sz,
                        false,
                        1.0 - progress * 0.35,
                        ang,
                    );
                }
            }
        }
        "bloodFlash" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            let age = 1.0 - alpha;
            let fa = alpha * (1.0 - age * 0.45);
            let reach = 12.0 + age * 36.0;
            for spoke in 0..14 {
                let ang = (spoke as f32 / 14.0) * std::f32::consts::TAU + 0.35;
                c.draw_line(
                    ex + ang.cos() * reach * 0.35,
                    ey + ang.sin() * reach * 0.35,
                    ex + ang.cos() * reach,
                    ey + ang.sin() * reach,
                    Rgba::new(222, 252, 255, 160).with_alpha(fa),
                    2.0,
                );
            }
            c.fill_ellipse(
                ex,
                ey,
                13.0,
                13.0,
                Rgba::new(255, 255, 255, 235).with_alpha(fa),
            );
        }
        "bloodHeal" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            let age = 1.0 - alpha;
            let opened = (age - 0.25) / 0.75;
            if opened > 0.0 {
                let radius = 34.0f32;
                let sphere = radius * (0.62 + 0.38 * (opened / 0.35).min(1.0));
                let sa = ((1.0 - opened) * 2.6).clamp(0.0, 1.0);
                c.fill_ellipse(
                    ex,
                    ey,
                    sphere,
                    sphere,
                    Rgba::new(150, 240, 180, 105).with_alpha(sa),
                );
                c.stroke_ellipse(
                    ex,
                    ey,
                    sphere,
                    sphere,
                    Rgba::new(214, 255, 224, 175).with_alpha(sa),
                    2.0,
                );
            }
            for mote in 0..3i32 {
                let own = ((age - 0.55) / 0.45).clamp(0.0, 1.0);
                if own <= 0.0 {
                    continue;
                }
                let ang = -std::f32::consts::FRAC_PI_2 + (mote - 1) as f32 * 0.75;
                let travel = 42.0 * own;
                let mx = ex + ang.cos() * travel * 0.7 + (mote - 1) as f32 * 11.0;
                let my = ey + ang.sin() * travel;
                c.fill_ellipse(
                    mx,
                    my,
                    4.5,
                    4.5,
                    Rgba::new(205, 255, 218, 200).with_alpha(1.0 - own),
                );
            }
        }
        "bomb_piece" => {
            if let Some(sh) = sprites.get("goblinBombPieces") {
                let sc = NATIVE_SCALE as f32;
                let sz = 40.0 * sc;
                let ex = effect.x as f32;
                let ey = (effect.y - depth_lift(effect.z)) as f32;
                c.draw_image(
                    sh,
                    ((effect.variant % 4) as u32) * 40,
                    0,
                    40,
                    40,
                    ex - sz * 0.5,
                    ey - sz * 0.5,
                    sz,
                    sz,
                    false,
                    alpha,
                    effect.angle as f32,
                );
            }
        }
        "stone_debris" => {
            if let Some(sh) = sprites.get("goblinStoneDebris") {
                let sc = NATIVE_SCALE as f32;
                let sz = 16.0 * sc;
                let ex = effect.x as f32;
                let ey = (effect.y - depth_lift(effect.z)) as f32;
                c.draw_image(
                    sh,
                    ((effect.variant % 2) as u32) * 16,
                    0,
                    16,
                    16,
                    ex - sz * 0.5,
                    ey - sz * 0.5,
                    sz,
                    sz,
                    false,
                    alpha,
                    0.0,
                );
            }
        }
        "pillar_debris" => {
            if let Some(sh) = sprites.get("pillarDebris") {
                let sc = NATIVE_SCALE as f32;
                let sz = 48.0 * sc;
                let ex = effect.x as f32;
                let ey = (effect.y - depth_lift(effect.z)) as f32;
                let age = (effect.max_life - effect.life).max(0.0);
                let ang = (effect.angle0
                    + f64::from(effect.spin_dir) * ((age / 2.0) % 1.0) * 6.248_279_094_696_045)
                    as f32;
                c.draw_image(
                    sh,
                    ((effect.variant % 4) as u32) * 48,
                    0,
                    48,
                    48,
                    ex - sz * 0.5,
                    ey - sz * 0.5,
                    sz,
                    sz,
                    false,
                    1.0,
                    ang,
                );
            }
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
        "bomb_flash" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            if let Some(sh) = sprites.get("goblinBombFlash") {
                let sc = NATIVE_SCALE as f32;
                let max_l = if effect.max_life > 0.0 {
                    effect.max_life
                } else {
                    0.2
                };
                let age = (max_l - effect.life).max(0.0);
                let t = (age / 0.1).min(1.0) as f32;
                let rate = 0.5 + 1.5 * t;
                let fa = (1.0 - age / max_l).max(0.0) as f32;
                let sz = 103.0 * rate * sc;
                c.draw_image_additive(
                    sh,
                    0,
                    0,
                    103,
                    103,
                    ex - 50.0 * rate * sc,
                    ey - 50.0 * rate * sc,
                    sz,
                    sz,
                    false,
                    fa,
                    0.0,
                );
            } else {
                c.fill_ellipse(
                    ex,
                    ey,
                    38.0 * (1.2 - alpha * 0.5),
                    28.0 * (1.2 - alpha * 0.5),
                    Rgba::new(255, 220, 140, 255).with_alpha(alpha),
                );
            }
        }
        "bossburst" => {
            let ex = effect.x as f32;
            let ey = (effect.y - depth_lift(effect.z)) as f32;
            c.fill_ellipse(
                ex,
                ey,
                38.0 * (1.2 - alpha * 0.5),
                28.0 * (1.2 - alpha * 0.5),
                Rgba::new(255, 220, 140, 255).with_alpha(alpha),
            );
            if let Some(bd) = sprites.get("bossdeath") {
                let bw = bd.width() as f32;
                let bh = bd.height() as f32;
                c.draw_image(
                    bd,
                    0,
                    0,
                    bd.width(),
                    bd.height(),
                    ex - bw * 0.5,
                    ey - 44.0,
                    bw,
                    bh,
                    false,
                    alpha,
                    0.0,
                );
            }
        }
        "deathburst" => {
            let t = (effect.max_life - effect.life).max(0.0);
            let is_boss = effect.enemy_type == "boss" || effect.enemy_type == "deepBoss";
            let count = if is_boss { 12usize } else { 8usize };
            let gravity = if is_boss { 520.0 } else { 640.0 };
            let sheet_key = if state.stage_id == "mirkwooddeep" {
                "forestDeep"
            } else {
                "forest"
            };
            let chunk_prefix = match effect.enemy_type.as_str() {
                "boss" | "deepBoss" => "boss",
                "brute" => "brute",
                "caster" | "burningThrower" => "caster",
                "coward" => "coward",
                "throwerElite" | "deepElite" => "elite",
                _ => "grunt",
            };
            let body = effect.height * 0.45;
            let base_y = floor_y(effect.z);
            let boss_frames: [[u32; 4]; 5] = [
                [0, 0, 29, 29],
                [30, 0, 11, 12],
                [42, 0, 16, 15],
                [59, 0, 22, 21],
                [82, 0, 6, 7],
            ];
            for idx in 0..count {
                let angle = scatter_hash(effect.seed, idx * 6) * std::f64::consts::TAU;
                let speed = if is_boss {
                    80.0 + scatter_hash(effect.seed, idx * 6 + 1) * 140.0
                } else {
                    110.0 + scatter_hash(effect.seed, idx * 6 + 1) * 150.0
                };
                let vx = angle.cos() * speed;
                let vy = if is_boss {
                    45.0 + scatter_hash(effect.seed, idx * 6 + 4) * 130.0
                } else {
                    angle.sin() * speed * 0.55 + 70.0
                };
                let spin = (scatter_hash(effect.seed, idx * 6 + 3) - 0.5) * 11.0;
                let mut x0 = effect.x;
                let mut h0 = body;
                if is_boss {
                    x0 += (scatter_hash(effect.seed, idx * 6 + 5) - 0.5) * effect.height * 0.8;
                    h0 = (body
                        + (scatter_hash(effect.seed, idx * 6 + 7) - 0.5) * effect.height * 0.5)
                        .max(0.0);
                }
                let mut travel = t;
                if is_boss {
                    let land = (vy + (vy * vy + 2.0 * gravity * h0).sqrt()) / gravity;
                    if travel > land {
                        travel = land;
                    }
                }
                let px = (x0 + vx * travel) as f32;
                let h = (h0 + vy * travel - 0.5 * gravity * travel * travel).max(0.0);
                let py = base_y - h as f32;
                let rot = (spin * travel) as f32;
                if is_boss {
                    if let Some(bd) = sprites.get("bossdeath") {
                        let [sx, sy, sw, sh] = boss_frames[idx % boss_frames.len()];
                        if sx + sw <= bd.width() && sy + sh <= bd.height() {
                            c.draw_image(
                                bd,
                                sx,
                                sy,
                                sw,
                                sh,
                                px - sw as f32 * 0.5,
                                py - sh as f32 * 0.5,
                                sw as f32,
                                sh as f32,
                                false,
                                alpha,
                                rot,
                            );
                        }
                    }
                } else if let Some(sh) = sprites.get(sheet_key) {
                    let piece = format!("chunk_{}{}", chunk_prefix, idx % 3);
                    if let Some([sx, sy, sw, sh_h]) = rect_at(&["SCENE", "pieces", &piece]) {
                        c.draw_image(
                            sh,
                            sx,
                            sy,
                            sw,
                            sh_h,
                            px - sw as f32 * 0.4,
                            py - sh_h as f32 * 0.4,
                            sw as f32 * 0.8,
                            sh_h as f32 * 0.8,
                            false,
                            alpha,
                            rot,
                        );
                    }
                }
            }
        }
        "bossrays" => {
            let h = if effect.height > 0.0 {
                effect.height as f32
            } else {
                168.0
            };
            let ox = (if effect.source_x != 0.0 {
                effect.source_x
            } else {
                effect.x
            }) as f32;
            let sz = if effect.source_z != 0.0 {
                effect.source_z
            } else {
                effect.z
            };
            let oy = floor_y(sz) - (SLAYER_HEIGHT as f32) * 0.55;
            let angles = [
                -2.65f32, -2.25, -1.85, -1.45, -1.05, 1.05, 1.45, 1.85, 2.25, 2.65,
            ];
            for (idx, base_a) in angles.iter().enumerate() {
                let angle = base_a + (scatter_hash(effect.seed, idx) as f32 - 0.5) * 0.24;
                let length = h * (2.4 + scatter_hash(effect.seed, idx + 40) as f32 * 1.9);
                let dx = angle.cos();
                let dy = angle.sin();
                c.draw_line(
                    ox + dx * length * 0.04,
                    oy + dy * length * 0.04,
                    ox + dx * length,
                    oy + dy * length,
                    Rgba::new(255, 70, 90, 255).with_alpha(0.40 * alpha),
                    (h * 0.04).max(1.5),
                );
            }
        }
        "bossbeam" => {
            let rw = room_width(state) as f32;
            let h = if effect.height > 0.0 {
                effect.height as f32
            } else {
                28.0
            };
            let base_y = floor_y(effect.z) - h * 0.55;
            let count = 5usize;
            for i in 0..count {
                let offset = (i as f32 - (count as f32 - 1.0) * 0.5) * 11.0;
                let y = base_y + offset;
                let lean = if i % 2 == 0 { 10.0 } else { -10.0 };
                c.draw_line(
                    0.0,
                    y,
                    rw,
                    y + lean,
                    Rgba::new(255, 140, 185, 255).with_alpha(0.75 * alpha),
                    3.0,
                );
            }
        }
        _ => {}
    }
}

/// Total horizontal width of Elvenguard town in logical units.
pub const TOWN_WIDTH: f64 = 2520.0;
pub const TOWN_MIN_X: f64 = 80.0;
pub const TOWN_MAX_X: f64 = 2440.0;
pub const TOWN_MIN_Z: f64 = 0.0;
pub const TOWN_MAX_Z: f64 = 100.0;
pub const TOWN_GATE_X: f64 = 2420.0;
/// Town walking speed in logical px/s (measured from `00002` @ 1.5..2.2s).
pub const TOWN_WALK_SPEED: f64 = 220.0;
/// Depth movement speed ratio relative to horizontal walk speed (ADR / town review: 0.56).
pub const TOWN_DEPTH_SPEED_RATIO: f64 = 0.56;
/// Horizontal camera deadzone half-width around viewport center.
pub const TOWN_CAMERA_HALF_WINDOW: f64 = 56.0;
/// Exponential camera easing rate (1/s): `camera_x += (target - camera_x) * (1 - (-k * dt).exp())`.
pub const TOWN_CAMERA_EASE_K: f64 = 8.5;
/// Dedicated town walk animation row in `slayer-reference.png` (client frames 180–187, 8 frames).
pub const TOWN_WALK_ROW: u32 = 12;

/// Pure simulation state for player movement & camera easing in Elvenguard town.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TownMotion {
    pub x: f64,
    pub z: f64,
    pub facing: i32,
    pub camera_x: f64,
    pub walk: f64,
    pub moving: bool,
}

impl Default for TownMotion {
    fn default() -> Self {
        Self {
            x: 180.0,
            z: 22.0,
            facing: 1,
            camera_x: 0.0,
            walk: 0.0,
            moving: false,
        }
    }
}

/// Step Elvenguard town movement and camera follow by `dt` seconds.
///
/// - Depth speed uses `TOWN_DEPTH_SPEED_RATIO` (`0.56`).
/// - Diagonal movement (`dx != 0 && dz != 0`) is normalized by `1 / sqrt(2)`.
/// - Camera follows the player deadzone with smooth exponential easing.
pub fn step_town_motion(m: &mut TownMotion, dx: i32, dz: i32, dt: f64) {
    let dx = dx.clamp(-1, 1);
    let dz = dz.clamp(-1, 1);
    let dt = dt.max(0.0);

    if dx != 0 {
        m.facing = dx;
    }
    m.moving = dx != 0 || dz != 0;
    if m.moving {
        m.walk += dt;
    } else {
        m.walk = 0.0;
    }

    let mut vx = f64::from(dx);
    let mut vz = f64::from(dz);
    if dx != 0 && dz != 0 {
        vx *= std::f64::consts::FRAC_1_SQRT_2;
        vz *= std::f64::consts::FRAC_1_SQRT_2;
    }

    m.x = (m.x + vx * TOWN_WALK_SPEED * dt).clamp(TOWN_MIN_X, TOWN_MAX_X);
    m.z = (m.z + vz * TOWN_WALK_SPEED * TOWN_DEPTH_SPEED_RATIO * dt).clamp(TOWN_MIN_Z, TOWN_MAX_Z);

    let max_cam = (TOWN_WIDTH - VIEW_WIDTH).max(0.0);
    let center = m.camera_x + VIEW_WIDTH * 0.5;
    let mut target = m.camera_x;
    if m.x < center - TOWN_CAMERA_HALF_WINDOW {
        target = m.x + TOWN_CAMERA_HALF_WINDOW - VIEW_WIDTH * 0.5;
    } else if m.x > center + TOWN_CAMERA_HALF_WINDOW {
        target = m.x - TOWN_CAMERA_HALF_WINDOW - VIEW_WIDTH * 0.5;
    }
    target = target.clamp(0.0, max_cam);
    let alpha = 1.0 - (-TOWN_CAMERA_EASE_K * dt).exp();
    m.camera_x = (m.camera_x + (target - m.camera_x) * alpha).clamp(0.0, max_cam);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TownNpcAction {
    Quest,
    Shop,
    Bag,
    Region,
}

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

// NPCs aligned along the rear balustrade (z = 82) leaving the spawn plaza & main road clear.
const TOWN_NPCS: [TownNpcDef; 8] = [
    TownNpcDef {
        id: "guard",
        x: 440.0,
        z: 82.0,
        label: "守卫",
        frames: &GUARD_FRAMES,
    },
    TownNpcDef {
        id: "seria",
        x: 680.0,
        z: 82.0,
        label: "赛丽亚",
        frames: &SERIA_FRAMES,
    },
    TownNpcDef {
        id: "minet",
        x: 920.0,
        z: 82.0,
        label: "敏泰",
        frames: &MINET_FRAMES,
    },
    TownNpcDef {
        id: "gsd",
        x: 1160.0,
        z: 82.0,
        label: "GSD",
        frames: &GSD_FRAMES,
    },
    TownNpcDef {
        id: "kanna",
        x: 1420.0,
        z: 82.0,
        label: "卡妮娜",
        frames: &KANNA_FRAMES,
    },
    TownNpcDef {
        id: "brownie",
        x: 1700.0,
        z: 82.0,
        label: "布兰妮",
        frames: &BROWNIE_FRAMES,
    },
    TownNpcDef {
        id: "sinda",
        x: 1980.0,
        z: 82.0,
        label: "辛达",
        frames: &SINDA_FRAMES,
    },
    TownNpcDef {
        id: "guardCaptain",
        x: 2240.0,
        z: 82.0,
        label: "守卫队长",
        frames: &CAPTAIN_FRAMES,
    },
];

/// Resolve which town interaction occurs when the player presses Enter/Space at `(player_x, player_z)`.
pub fn town_interact_action(player_x: f64, player_z: f64) -> TownNpcAction {
    if (player_x - TOWN_GATE_X).abs() < 75.0 {
        return TownNpcAction::Region;
    }
    let mut best: Option<(f64, &TownNpcDef)> = None;
    for npc in &TOWN_NPCS {
        let dx = (f64::from(npc.x) - player_x).abs();
        let dz = (f64::from(npc.z) - player_z).abs();
        if dx < 65.0 && dz < 45.0 {
            let dist = dx * dx + dz * dz;
            if best.is_none_or(|(d, _)| dist < d) {
                best = Some((dist, npc));
            }
        }
    }
    match best.map(|(_, n)| n.id) {
        Some("seria" | "minet" | "gsd") => TownNpcAction::Quest,
        Some("kanna") => TownNpcAction::Shop,
        Some("sinda") => TownNpcAction::Bag,
        _ => TownNpcAction::Region,
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
        camera_x: (player_x - VIEW_WIDTH * 0.5).clamp(0.0, TOWN_WIDTH - VIEW_WIDTH),
        time: 0.0,
        moving: false,
        walk: 0.0,
        player_level: 1,
        player_name: "阿努纳奇",
    };
    draw_town_view(c, &view, sprites);
}

pub fn draw_town_view(c: &mut Canvas<'_>, view: &TownView<'_>, sprites: &SpriteStore) {
    const ART_SCALE: f32 = 1.125;
    const MID_Y: f32 = 85.0;
    const ROAD_Y: f32 = 233.0;
    const FRONT_Y: f32 = 430.0;
    const GROUND_Y: f32 = 425.0;
    const GATE_X: f32 = TOWN_GATE_X as f32;
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
        // Far sky, pixel-art clouds & mountains (`hmfar01`, 0.08 subtle parallax)
        let far_w = 640.0 * ART_SCALE;
        let far_h = 242.0 * ART_SCALE;
        let mut fx = -(cam * 0.08).rem_euclid(far_w);
        while fx < vw {
            c.draw_image(sh, 0, 0, 640, 242, fx, 0.0, far_w, far_h, false, 1.0, 0.0);
            fx += far_w;
        }

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
    let mut order: Vec<(f32, Option<usize>)> = TOWN_NPCS
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
            let npc = &TOWN_NPCS[ni];
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
            c.fill_ellipse(px, py + 1.0, 22.0, 6.0, Rgba::new(0, 0, 0, 96));

            // Bright neon-green oval foot ring under player boots (matches 00002 @ 2s / 415s)
            c.fill_ellipse(px, py, 33.0, 10.5, Rgba::new(165, 255, 110, 92));
            c.stroke_ellipse(px, py, 32.0, 10.0, Rgba::new(145, 255, 95, 215), 2.0);
            if let Some(ui) = sprites.get("ui") {
                let fw = 64.0;
                let fh = 22.0;
                for _ in 0..2 {
                    c.draw_image_additive(
                        ui,
                        1175,
                        2901,
                        81,
                        28,
                        px - fw * 0.5,
                        py - fh * 0.48,
                        fw,
                        fh,
                        false,
                        0.75,
                        0.0,
                    );
                }
            }

            if let Some(sh) = sprites.get("slayer") {
                const IDLE_ROOTS: [[f32; 2]; 4] =
                    [[8.48, -5.16], [9.16, -5.16], [9.16, -5.16], [9.16, -5.16]];
                const WALK_ROOTS: [[f32; 2]; 8] = [
                    [-7.92, -5.52],
                    [-4.56, -5.84],
                    [2.12, -5.84],
                    [-10.56, -5.52],
                    [-6.92, -5.52],
                    [-2.96, -5.84],
                    [5.36, -5.84],
                    [9.04, -5.52],
                ];
                let cell_w = 208u32;
                let cell_h = 176u32;
                let anchor_x = 88.0f32;
                let anchor_y = 156.0f32;
                let walking = view.moving && view.walk > 0.0;
                let row = if walking { TOWN_WALK_ROW } else { 0 };
                let col = if walking {
                    ((view.walk * 10.0) as u32) % 8
                } else {
                    ((view.time * 4.0) as u32) % 4
                };
                let root = if walking {
                    WALK_ROOTS[col as usize]
                } else {
                    IDLE_ROOTS[col as usize]
                };
                let flip = view.facing < 0;
                let root_x = if flip { root[0] } else { -root[0] } * PLAYER_SCALE;
                let root_y = -root[1] * PLAYER_SCALE;
                let adj_px = px + root_x;
                let adj_py = py + root_y;
                let draw_x = if flip {
                    adj_px - (cell_w as f32 - anchor_x) * PLAYER_SCALE
                } else {
                    adj_px - anchor_x * PLAYER_SCALE
                };
                c.draw_image(
                    sh,
                    col * cell_w,
                    row * cell_h,
                    cell_w,
                    cell_h,
                    draw_x,
                    adj_py - anchor_y * PLAYER_SCALE,
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
                11.5,
                Rgba::new(252, 250, 244, 255),
                TextAlign::Center,
                Some(Rgba::new(10, 12, 18, 245)),
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

    if let Some(hint) = near_hint {
        c.fill_text(
            &hint,
            (ARENA_WIDTH * 0.5) as f32,
            crate::hud_classic::native_y(crate::hud_classic::HUD_TOP_Y) - 14.0,
            12.0,
            Rgba::new(255, 228, 140, 255),
            TextAlign::Center,
            Some(Rgba::new(0, 0, 0, 230)),
        );
    }
}

/// Draw the town HUD overlay:
/// 1. Classic 60/70 shared bottom HUD (`hud_classic::draw_bottom_hud`)
/// 2. Top-right channel banner (`ch14格兰之森`)
/// 3. Right-side lightweight town menu icons (`决斗场 / 推荐好友 / 队伍信息 / 社区`)
pub fn draw_town_hud(
    c: &mut Canvas<'_>,
    state: &State,
    sprites: &SpriteStore,
    meta: &crate::hud::RenderMeta<'_>,
) {
    crate::hud_classic::draw_bottom_hud(c, state, sprites, meta);
    draw_town_top_right_ui(c);
}

fn draw_town_top_right_ui(c: &mut Canvas<'_>) {
    use crate::hud_classic::{native_size, native_x, native_y};

    // 1. Top-right channel banner (`ch14格兰之森 E`) — matches 00002 @ 2s / 415s
    let bx = native_x(564.0);
    let by = native_y(0.0);
    let bw = native_size(236.0);
    let bh = native_size(24.0);
    // Tapered translucent navy-charcoal fade on the left edge
    c.fill_rect(bx, by, native_size(34.0), bh, Rgba::new(14, 18, 30, 120));
    c.fill_rect(
        bx + native_size(34.0),
        by,
        bw - native_size(34.0),
        bh,
        Rgba::new(14, 18, 30, 205),
    );
    // Warm bronze-gold bottom underline
    c.fill_rect(
        bx + native_size(12.0),
        by + bh - native_size(1.5),
        bw - native_size(12.0),
        native_size(1.5),
        Rgba::new(186, 152, 92, 220),
    );
    c.fill_text(
        "ch14格兰之森",
        native_x(764.0),
        native_y(17.0),
        native_size(13.0),
        Rgba::new(244, 226, 174, 255),
        TextAlign::Right,
        Some(Rgba::new(8, 10, 16, 240)),
    );
    // Small gold channel-grade badge `E` at far right
    c.fill_text(
        "E",
        native_x(782.0),
        native_y(17.0),
        native_size(12.5),
        Rgba::new(255, 214, 122, 255),
        TextAlign::Center,
        Some(Rgba::new(12, 10, 6, 245)),
    );

    // 2. Right-side vertical lightweight menu entries (`决斗场 / 推荐好友 / 队伍信息 / 社区`)
    const MENU_ITEMS: [(&str, [u8; 3], [u8; 3]); 4] = [
        ("决斗场", [198, 72, 60], [242, 232, 210]),
        ("推荐好友", [54, 166, 84], [210, 250, 198]),
        ("队伍信息", [58, 138, 216], [198, 232, 255]),
        ("社区", [186, 56, 72], [250, 214, 128]),
    ];
    for (idx, &(label, badge_rgb, accent_rgb)) in MENU_ITEMS.iter().enumerate() {
        let row_ny = 34.0 + idx as f32 * 33.0;
        let icon_cx = native_x(708.0);
        let icon_cy = native_y(row_ny + 13.0);
        let r = native_size(11.5);

        // Dark rim + colored medallion badge
        c.fill_ellipse(
            icon_cx,
            icon_cy,
            r + native_size(1.5),
            r + native_size(1.5),
            Rgba::new(18, 20, 28, 225),
        );
        c.fill_ellipse(
            icon_cx,
            icon_cy,
            r,
            r,
            Rgba::new(badge_rgb[0], badge_rgb[1], badge_rgb[2], 235),
        );
        c.stroke_ellipse(
            icon_cx,
            icon_cy,
            r,
            r,
            Rgba::new(225, 196, 132, 230),
            native_size(1.2),
        );

        // Simple recognizable inner emblem per entry
        let ac = Rgba::new(accent_rgb[0], accent_rgb[1], accent_rgb[2], 245);
        match idx {
            0 => {
                // Crossed swords
                c.draw_line(
                    icon_cx - native_size(5.5),
                    icon_cy - native_size(5.5),
                    icon_cx + native_size(5.5),
                    icon_cy + native_size(5.5),
                    ac,
                    native_size(2.0),
                );
                c.draw_line(
                    icon_cx + native_size(5.5),
                    icon_cy - native_size(5.5),
                    icon_cx - native_size(5.5),
                    icon_cy + native_size(5.5),
                    ac,
                    native_size(2.0),
                );
            }
            1 => {
                // Shield / friend emblem
                c.fill_round_rect(
                    icon_cx - native_size(4.5),
                    icon_cy - native_size(5.0),
                    native_size(9.0),
                    native_size(9.5),
                    native_size(2.5),
                    ac,
                );
            }
            2 => {
                // Two party silhouettes
                c.fill_ellipse(
                    icon_cx - native_size(3.2),
                    icon_cy - native_size(2.5),
                    native_size(2.6),
                    native_size(2.6),
                    ac,
                );
                c.fill_ellipse(
                    icon_cx + native_size(3.2),
                    icon_cy - native_size(2.0),
                    native_size(2.3),
                    native_size(2.3),
                    ac,
                );
                c.fill_round_rect(
                    icon_cx - native_size(6.2),
                    icon_cy + native_size(1.0),
                    native_size(12.4),
                    native_size(4.8),
                    native_size(2.0),
                    ac,
                );
            }
            _ => {
                // Community crest
                c.fill_round_rect(
                    icon_cx - native_size(5.0),
                    icon_cy - native_size(3.5),
                    native_size(10.0),
                    native_size(7.5),
                    native_size(1.5),
                    ac,
                );
                c.fill_rect(
                    icon_cx - native_size(2.0),
                    icon_cy - native_size(6.0),
                    native_size(4.0),
                    native_size(3.0),
                    ac,
                );
            }
        }

        // Crisp outlined label to the right of the icon
        c.fill_text(
            label,
            native_x(726.0),
            native_y(row_ny + 18.0),
            native_size(13.0),
            Rgba::new(255, 248, 224, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 255)),
        );
    }
}
