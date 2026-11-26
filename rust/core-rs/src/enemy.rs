//! Enemy creation, AI, attacks, projectiles, waves, and room resolution (`src/core.js`).

use crate::combat::{
    block_props_coords, body_box, boxes_overlap, damage_enemy, damage_player, death_lie,
    is_boss_enemy, run_cleared, smoke_life, stop_at_horizontal_prop, DamageEnemyOptions,
};
use crate::constants::*;
use crate::dungeon::{
    current_cell, current_cell_mut, door_at, enter_cell, prop_blocks_at, prop_obstacle, room_left,
    room_right, room_width, route_step,
};
use crate::tables::*;
use crate::types::*;

pub fn floor_distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dz = az - bz;
    (dx * dx + dz * dz).sqrt()
}

pub fn body_gap(ax: f64, aw: f64, bx: f64, bw: f64) -> f64 {
    (ax - bx).abs() - (aw + bw) / 2.0
}

pub fn create_enemy(
    state: &mut State,
    kind: &str,
    x: f64,
    z: f64,
    level: Option<u32>,
    xp: Option<u32>,
) -> Enemy {
    let spec = TABLES
        .enemy_types
        .get(kind)
        .or_else(|| TABLES.enemy_types.get("grunt"))
        // INFALLIBLE: TABLES.enemy_types always contains "grunt"
        .expect("INFALLIBLE: grunt enemy type exists");
    let jitter = (crate::next_random(state) * 2.0 - 1.0) * 14.0;
    let id = state.next_enemy_id;
    state.next_enemy_id += 1;
    let left = room_left(state) + spec.width;
    let right = room_right(state) - spec.width;
    let use_ref = state.reference_profile.is_some();
    let pvf_mon = crate::pvf_truth::monster_truth(kind);
    let sight_range = pvf_mon
        .map(|m| m.sight_world())
        .unwrap_or_else(|| native_ground_x(300.0));
    let attack_cooldown_max = if use_ref && spec.behavior != "boss" {
        pvf_mon
            .map(|m| m.attack_delay_secs())
            .unwrap_or(spec.attack_cooldown)
    } else {
        spec.attack_cooldown
    };

    Enemy {
        id,
        kind: kind.to_string(),
        label: spec.label.clone(),
        race: spec.race.clone(),
        level: level.unwrap_or(spec.level).max(1),
        x: (x + jitter).clamp(left, right),
        y: ARENA_GROUND_Y,
        z,
        vx: 0.0,
        vy: 0.0,
        vz: 0.0,
        width: spec.width,
        height: spec.height,
        facing: -1,
        on_ground: true,
        hp: spec.max_hp,
        max_hp: spec.max_hp,
        damage: spec.damage,
        xp: xp.unwrap_or(spec.xp),
        behavior: spec.behavior.clone(),
        death_style: spec.death_style.clone(),
        bar_color: spec.bar_color.clone(),
        champion: spec.champion.clone(),
        evasion: spec.evasion,
        speed: spec.speed,
        attack_range: spec.attack_range,
        keep_range: spec.keep_range,
        attack_windup: spec.attack_windup,
        attack_duration: spec.attack_duration,
        base_attack_windup: spec.attack_windup,
        base_attack_duration: spec.attack_duration,
        attack_cooldown_max,
        base_speed: spec.speed,
        base_damage: spec.damage,
        base_attack_cooldown_max: attack_cooldown_max,
        attack_cooldown: 0.5,
        step_timer: f64::from(state.next_enemy_id % 5) * 0.07,
        attack_timer: 0.0,
        attack_kind: "melee".to_string(),
        attack_hit_done: false,
        attack_recovered: false,
        projectile: spec.projectile.clone(),
        charge_speed: spec.charge_speed,
        charge_from: spec.charge_from,
        charge_to: spec.charge_to,
        charge_dir: -1,
        slam: spec.slam.clone(),
        base_slam: spec.slam.clone(),
        slam_cooldown: spec.slam.as_ref().map(|s| s.cooldown * 0.5).unwrap_or(0.0),
        lunge: spec.lunge.clone(),
        beam: spec.beam.clone(),
        beam_cooldown: 0.0,
        beam_pulse: 0,
        sweep: spec.sweep.clone(),
        base_sweep: spec.sweep.clone(),
        sweep_cooldown: spec.sweep.as_ref().map(|s| s.cooldown * 0.5).unwrap_or(0.0),
        spin_dash: spec.spin_dash.clone(),
        spin_dir: -1,
        spin_cooldown: spec
            .spin_dash
            .as_ref()
            .map(|s| s.cooldown * 0.4)
            .unwrap_or(0.0),
        lunge_cooldown: 0.0,
        phase: 1,
        phase2: spec.phase2.clone(),
        knockdown: 0.0,
        stun: 0.0,
        grabbed: 0.0,
        bleed: None,
        entering: None,
        super_armor: false,
        knockback_x: spec.knockback_x,
        hurt_timer: 0.0,
        hit_flash_timer: 0.0,
        dead: false,
        dying: 0.0,
        silhouette: false,
        gone: false,
        sight_range,
        activated: !use_ref,
        activation_delay: 0.0,
    }
}

fn push_telegraph(state: &mut State, enemy: &Enemy, label: &str, radius: f64, life: f64, dir: i32) {
    let mut eff = Effect::new("telegraph", life);
    eff.enemy_id = enemy.id;
    eff.text = label.to_string();
    eff.x = enemy.x;
    eff.y = ARENA_GROUND_Y;
    eff.z = enemy.z;
    eff.radius = radius;
    eff.dir = dir;
    state.effects.push(eff);
}

fn push_shockwave(state: &mut State, enemy: &Enemy) {
    let mut eff = Effect::new("shockwave", 0.45);
    eff.x = enemy.x;
    eff.y = ARENA_GROUND_Y;
    eff.z = enemy.z;
    eff.radius = enemy.slam.as_ref().map(|s| s.radius).unwrap_or(0.0);
    state.effects.push(eff);
    crate::trigger_screen_shake(state, 8.5, 0.28);
}

pub fn spawn_projectile(state: &mut State, enemy_idx: usize) {
    let e = &state.enemies[enemy_idx];
    let Some(ref spec) = e.projectile else {
        return;
    };
    let nat = spec.native_object;
    let pvf_proj = if state.reference_profile.is_some() {
        nat.and_then(crate::pvf_truth::projectile_truth)
    } else {
        None
    };
    let proj_speed = pvf_proj
        .filter(|t| t.speed_x > 0)
        .map(|t| crate::constants::native_ground_x(f64::from(t.speed_x)))
        .unwrap_or(spec.speed);
    let proj_gravity = pvf_proj
        .filter(|t| t.gravity > 0)
        .map(|t| crate::constants::native_ground_x(f64::from(t.gravity)))
        .unwrap_or(spec.gravity);
    let proj_piercing = if pvf_proj.is_some_and(|t| t.piercing_power > 0) {
        spec.piercing.max(1)
    } else {
        spec.piercing
    };
    let proj_z_sine_amp = if spec.z_sine_amp == 0.0 {
        pvf_proj
            .filter(|t| t.z_sine_amp > 0)
            .map(|t| crate::constants::native_ground_x(f64::from(t.z_sine_amp)))
            .unwrap_or(0.0)
    } else {
        spec.z_sine_amp
    };
    let proj_z_sine_rad = if spec.z_sine_rad_per_sec == 0.0 {
        pvf_proj
            .filter(|t| t.z_sine_deg_per_sec > 0)
            .map(|t| f64::from(t.z_sine_deg_per_sec).to_radians())
            .unwrap_or(0.0)
    } else {
        spec.z_sine_rad_per_sec
    };
    let origin_x = e.x + f64::from(e.facing) * spec.origin_x.unwrap_or(e.width / 2.0 + 2.0);
    let origin_y = e.y - spec.height;
    let dx = state.player.x - origin_x;
    let dy = state.player.y - state.player.height / 2.0 - origin_y;
    let length = (dx * dx + dy * dy).sqrt();
    let length = if length == 0.0 { 1.0 } else { length };
    let vx = if spec.horizontal {
        f64::from(e.facing)
    } else {
        dx / length
    } * proj_speed;
    let vy = spec
        .initial_vy
        .or_else(|| {
            pvf_proj
                .filter(|t| t.speed_z > 0)
                .map(|t| -crate::constants::native_ground_x(f64::from(t.speed_z)))
        })
        .unwrap_or_else(|| {
            if spec.horizontal {
                0.0
            } else {
                (dy / length) * proj_speed
            }
        });
    let id = state.next_projectile_id;
    state.next_projectile_id += 1;
    let z = e.z;
    state.projectiles.push(Projectile {
        id,
        native_object: nat,
        x: origin_x,
        y: origin_y,
        z,
        vx,
        vy,
        gravity: proj_gravity,
        landing_stop: spec.landing_stop,
        z_sine_amp: proj_z_sine_amp,
        z_sine_rad_per_sec: proj_z_sine_rad,
        osc_y: 0.0,
        piercing: proj_piercing,
        hit_player: false,
        radius: spec.radius,
        damage: e.damage,
        life: spec.life,
        max_life: spec.life,
        traveled: 0.0,
        max_distance: spec.max_distance,
        stopped: false,
        stop_life: 0.0,
        stopped_at: 0.0,
        stop_vx: 0.0,
        stop_vy: 0.0,
        stop_gravity: 0.0,
    });
    crate::push_projectile_sound(state, "projectileSpawn", nat, origin_x, z);
}

fn projectile_height_contact<F: Fn(f64) -> f64>(
    height_at: F,
    mut start: f64,
    mut end: f64,
    top: f64,
    bottom: f64,
) -> Option<f64> {
    let start_y = height_at(start);
    if start_y >= top && start_y <= bottom {
        return Some(start);
    }
    let enter_from_top = start_y < top;
    let edge = if enter_from_top { top } else { bottom };
    let end_y = height_at(end);
    if if enter_from_top {
        end_y < edge
    } else {
        end_y > edge
    } {
        return None;
    }
    for _ in 0..32 {
        let middle = (start + end) / 2.0;
        if if enter_from_top {
            height_at(middle) < edge
        } else {
            height_at(middle) > edge
        } {
            start = middle;
        } else {
            end = middle;
        }
    }
    Some(end)
}

struct OscParams {
    base_y: f64,
    phase: f64,
    span: f64,
    amplitude: f64,
}

#[allow(clippy::too_many_arguments)]
fn projectile_contact(
    player: &Player,
    shot: &Projectile,
    x0: f64,
    mut y0: f64,
    x1: f64,
    y1: f64,
    curve: f64,
    oscillation: Option<OscParams>,
    previous_position: Option<[f64; 3]>,
) -> Option<f64> {
    let radius = shot.radius;
    let left = player.x - player.width / 2.0 - radius;
    let right = player.x + player.width / 2.0 + radius;
    let top = player.y - player.height - radius;
    let bottom = player.y + radius;
    let x0 = x0 + previous_position.map(|p| player.x - p[0]).unwrap_or(0.0);
    let height_offset = previous_position.map(|p| player.y - p[1]).unwrap_or(0.0);
    y0 += height_offset;
    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx == 0.0 && (x0 < left || x0 > right) {
        return None;
    }
    let mut enter_x = if dx == 0.0 {
        0.0
    } else {
        ((if dx > 0.0 { left } else { right }) - x0) / dx
    }
    .max(0.0);
    let mut exit_x = if dx == 0.0 {
        1.0
    } else {
        ((if dx > 0.0 { right } else { left }) - x0) / dx
    }
    .min(1.0);

    let reach = player.width / 2.0 + radius;
    let to_depth = player.z - shot.z;
    let from_depth = previous_position.map(|p| p[2] - shot.z).unwrap_or(to_depth);
    let dz = to_depth - from_depth;
    if dz != 0.0 {
        enter_x = enter_x.max(((if dz > 0.0 { -reach } else { reach }) - from_depth) / dz);
        exit_x = exit_x.min(((if dz > 0.0 { reach } else { -reach }) - from_depth) / dz);
    } else if to_depth.abs() > reach {
        return None;
    }
    if enter_x > exit_x {
        return None;
    }
    if let Some(osc) = oscillation {
        let sine_height = |t: f64| -> f64 {
            osc.base_y - (osc.phase + osc.span * t).sin() * osc.amplitude
                + height_offset * (1.0 - t)
        };
        let slope_ratio = -height_offset / (osc.amplitude * osc.span);
        if slope_ratio.abs() >= 1.0 {
            return projectile_height_contact(sine_height, enter_x, exit_x, top, bottom);
        }
        let turn = slope_ratio.acos();
        let cycle = std::f64::consts::PI * 2.0;
        let entry_phase = osc.phase + osc.span * enter_x;
        let mut first_turn = turn + cycle * (((entry_phase - turn) / cycle).floor() + 1.0);
        let mut second_turn = -turn + cycle * (((entry_phase + turn) / cycle).floor() + 1.0);
        let mut start = enter_x;
        loop {
            let end = ((first_turn.min(second_turn) - osc.phase) / osc.span).clamp(start, exit_x);
            let contact = projectile_height_contact(sine_height, start, end, top, bottom);
            if contact.is_some() || end == exit_x {
                return contact;
            }
            if first_turn < second_turn {
                first_turn += cycle;
            } else {
                second_turn += cycle;
            }
            start = end;
        }
    }
    if curve != 0.0 {
        let height_at = |t: f64| y0 + (dy - curve) * t + curve * t * t;
        let apex = ((curve - dy) / (2.0 * curve)).clamp(enter_x, exit_x);
        let c1 = projectile_height_contact(height_at, enter_x, apex, top, bottom);
        return c1.or_else(|| projectile_height_contact(height_at, apex, exit_x, top, bottom));
    }
    if dy == 0.0 && (y0 < top || y0 > bottom) {
        return None;
    }
    let enter_y = if dy == 0.0 {
        0.0
    } else {
        ((if dy > 0.0 { top } else { bottom }) - y0) / dy
    };
    let exit_y = if dy == 0.0 {
        1.0
    } else {
        ((if dy > 0.0 { bottom } else { top }) - y0) / dy
    };
    let enter = 0.0_f64.max(enter_x).max(enter_y);
    if enter <= 1.0_f64.min(exit_x).min(exit_y) {
        Some(enter)
    } else {
        None
    }
}

fn projectile_travel(vx: f64, vy: f64, gravity: f64, time: f64) -> f64 {
    if gravity == 0.0 {
        return vx.hypot(vy) * time;
    }
    let speed_x = vx.abs();
    let speed_integral = |vertical: f64| -> f64 {
        if speed_x == 0.0 {
            vertical * vertical.abs() / 2.0
        } else {
            (vertical * speed_x.hypot(vertical) + speed_x * speed_x * (vertical / speed_x).asinh())
                / 2.0
        }
    };
    (speed_integral(vy + gravity * time) - speed_integral(vy)) / gravity
}

fn projectile_range_fraction(
    vx: f64,
    vy: f64,
    gravity: f64,
    dt: f64,
    range: f64,
    distance: f64,
) -> f64 {
    if range <= 0.0 || distance <= 0.0 {
        return 0.0;
    }
    if gravity == 0.0 {
        return range / distance;
    }
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..32 {
        let mid = (low + high) / 2.0;
        if projectile_travel(vx, vy, gravity, dt * mid) < range {
            low = mid;
        } else {
            high = mid;
        }
    }
    high
}

fn emit_projectile_destroy_effect(state: &mut State, shot: &Projectile, x: f64, y: f64) {
    if shot.native_object == Some(30021) {
        let mut flash = Effect::new("bomb_flash", 0.2);
        flash.x = x;
        flash.y = y;
        flash.z = shot.z;
        state.effects.push(flash);
        crate::trigger_screen_shake(state, 5.5, 0.20);
        let piece_speed = native_ground_x(700.0);
        for p in 0..20usize {
            let theta = (p as f64 / 20.0) * std::f64::consts::PI * 2.0;
            let u = ((p as isize * 37 + x.round() as isize).rem_euclid(17)) as f64 / 16.0 - 0.5;
            let v =
                ((p as isize * 53 + shot.z.round() as isize).rem_euclid(13)) as f64 / 12.0 - 0.5;
            let mut piece = Effect::new("bomb_piece", 0.15);
            piece.x = x + u * native_ground_x(8.0);
            piece.y = y + v * native_ground_x(8.0);
            piece.z = shot.z + (u * native_ground_x(16.0)) / DEPTH_SCALE;
            piece.vx = theta.cos() * piece_speed;
            piece.vy = theta.sin() * piece_speed;
            piece.angle = theta;
            piece.variant = p % 4;
            state.effects.push(piece);
        }
        return;
    }
    if shot.native_object == Some(30001) {
        for d in 0..10usize {
            let u = ((d as isize * 37 + x.round() as isize).rem_euclid(17)) as f64 / 16.0 - 0.5;
            let v =
                ((d as isize * 53 + shot.z.round() as isize).rem_euclid(13)) as f64 / 12.0 - 0.5;
            let w = ((d * 29) % 11) as f64 / 10.0;
            let dir = if d.is_multiple_of(2) { 1.0 } else { -1.0 };
            let mut deb = Effect::new("stone_debris", 1.0);
            deb.x = x + u * native_ground_x(10.0);
            deb.y = ARENA_GROUND_Y.min(y + v * native_ground_x(10.0));
            deb.z = shot.z + (u * native_ground_x(10.0)) / DEPTH_SCALE;
            deb.vx = dir * native_ground_x(40.0 + w * 60.0);
            deb.vy = -native_ground_x(60.0 + w * 80.0);
            deb.gravity = native_ground_x(1000.0);
            deb.variant = d % 2;
            state.effects.push(deb);
        }
    }
}

pub fn update_projectiles(
    state: &mut State,
    dt: f64,
    previous_position: Option<[f64; 3]>,
    existing_count: usize,
) {
    let left_wall = room_left(state);
    let right_wall = room_right(state);
    let total = state.projectiles.len();
    let mut remaining: Vec<Option<Projectile>> = vec![None; total];
    struct Impact {
        time: f64,
        idx: usize,
        shot: Projectile,
        x: f64,
        y: f64,
        flight_end: f64,
        lands_first: bool,
        landing_time: f64,
        spent: bool,
        from_x: f64,
        from_base_y: f64,
        from_vy: f64,
        step_x: f64,
    }
    let mut impacts = Vec::new();
    let projectiles = std::mem::take(&mut state.projectiles);

    let finish_flight = |state: &mut State,
                         remaining: &mut [Option<Projectile>],
                         idx: usize,
                         mut shot: Projectile,
                         lands_first: bool,
                         landing_time: f64,
                         spent: bool,
                         flight_end: f64,
                         from_x: f64,
                         from_base_y: f64,
                         from_vy: f64,
                         step_x: f64| {
        if lands_first && shot.landing_stop {
            let since_landing = dt - landing_time;
            shot.x = from_x + shot.vx * landing_time;
            shot.y = ARENA_GROUND_Y;
            shot.stopped_at = shot.max_life - shot.life - since_landing;
            shot.stop_vx = shot.vx;
            shot.stop_vy = from_vy + shot.gravity * landing_time;
            shot.stop_gravity = shot.gravity;
            shot.vx = 0.0;
            shot.vy = 0.0;
            shot.gravity = 0.0;
            shot.stopped = true;
            shot.stop_life = shot.life.min(0.35 - since_landing);
            if shot.stop_life > 0.0 {
                remaining[idx] = Some(shot);
            }
            return;
        }
        if spent || shot.y >= ARENA_GROUND_Y {
            let end = flight_end.clamp(0.0, 1.0);
            let end_x = (from_x + step_x * end).clamp(left_wall, right_wall);
            let end_y =
                (from_base_y + from_vy * dt * end + shot.gravity * (dt * end).powi(2) / 2.0)
                    .min(ARENA_GROUND_Y);
            emit_projectile_destroy_effect(state, &shot, end_x, end_y);
            if shot.native_object == Some(30021) {
                crate::push_sound(state, "bombExplosion", end_x, shot.z);
                if !shot.hit_player && !state.player.dead {
                    let blast_radius = native_ground_x(72.0);
                    let on_ground = state.player.y >= ARENA_GROUND_Y - 36.0;
                    if on_ground
                        && in_reach_of(state.player.z, shot.z, DEPTH_REACH_SPIN)
                        && (state.player.x - end_x).abs() <= blast_radius + state.player.width / 2.0
                    {
                        damage_player(state, shot.damage, end_x);
                    }
                }
            }
            return;
        }
        remaining[idx] = Some(shot);
    };

    for (index, mut shot) in projectiles.into_iter().enumerate() {
        shot.life -= dt;
        if shot.stopped {
            shot.stop_life -= dt;
            if shot.stop_life > 0.0 {
                remaining[index] = Some(shot);
            }
            continue;
        }
        let from_x = shot.x;
        let from_base_y = shot.y;
        let from_y = from_base_y + shot.osc_y;
        let from_vy = shot.vy;
        let step_x = shot.vx * dt;
        let gravity = shot.gravity;
        let curve = gravity * dt * dt / 2.0;
        let step_y = from_vy * dt + curve;
        shot.vy += gravity * dt;
        shot.x += step_x;
        shot.y += step_y;

        let mut oscillation = None;
        if shot.z_sine_amp > 0.0 {
            let age = (shot.max_life - shot.life).max(0.0);
            shot.osc_y = -(age * shot.z_sine_rad_per_sec).sin() * shot.z_sine_amp;
            if step_y == 0.0 && curve == 0.0 && shot.z_sine_rad_per_sec > 0.0 {
                oscillation = Some(OscParams {
                    base_y: from_base_y,
                    phase: (age - dt).max(0.0) * shot.z_sine_rad_per_sec,
                    span: dt * shot.z_sine_rad_per_sec,
                    amplitude: shot.z_sine_amp,
                });
            }
        }
        let distance = projectile_travel(shot.vx, from_vy, gravity, dt);
        let range_left = shot.max_distance - shot.traveled;
        shot.traveled += distance;

        let spent = shot.life <= 0.0
            || shot.traveled >= shot.max_distance
            || shot.x <= left_wall
            || shot.x >= right_wall;
        let mut flight_end = f64::INFINITY;
        if shot.life <= 0.0 {
            flight_end = flight_end.min(1.0 + shot.life / dt);
        }
        if shot.traveled >= shot.max_distance {
            flight_end = flight_end.min(projectile_range_fraction(
                shot.vx, from_vy, gravity, dt, range_left, distance,
            ));
        }
        if step_x < 0.0 && shot.x <= left_wall {
            flight_end = flight_end.min((left_wall - from_x) / step_x);
        }
        if step_x > 0.0 && shot.x >= right_wall {
            flight_end = flight_end.min((right_wall - from_x) / step_x);
        }
        if from_x <= left_wall || from_x >= right_wall {
            flight_end = 0.0;
        }
        let fall = ARENA_GROUND_Y - from_base_y;
        let landing_time = if fall <= 0.0 {
            0.0
        } else if shot.y >= ARENA_GROUND_Y {
            let landing_vy = (from_vy * from_vy + 2.0 * gravity * fall).sqrt();
            let lt = if from_vy < 0.0 {
                (landing_vy - from_vy) / gravity
            } else {
                2.0 * fall / (landing_vy + from_vy)
            };
            lt.clamp(0.0, dt)
        } else {
            f64::INFINITY
        };
        let lands_first = landing_time / dt < flight_end;
        flight_end = flight_end.min(landing_time / dt);

        let hit_y = shot.y + shot.osc_y;
        let start_pos = if index < existing_count {
            previous_position
        } else {
            None
        };
        let contact = if !state.player.dead && !shot.hit_player {
            projectile_contact(
                &state.player,
                &shot,
                from_x,
                from_y,
                shot.x,
                hit_y,
                curve,
                oscillation,
                start_pos,
            )
        } else {
            None
        };

        if let Some(c) = contact {
            if c < flight_end {
                impacts.push(Impact {
                    time: c,
                    idx: index,
                    shot,
                    x: from_x + step_x * c,
                    y: from_y + (hit_y - from_y - curve) * c + curve * c * c,
                    flight_end,
                    lands_first,
                    landing_time,
                    spent,
                    from_x,
                    from_base_y,
                    from_vy,
                    step_x,
                });
                continue;
            }
        }
        finish_flight(
            state,
            &mut remaining,
            index,
            shot,
            lands_first,
            landing_time,
            spent,
            flight_end,
            from_x,
            from_base_y,
            from_vy,
            step_x,
        );
    }

    impacts.sort_by(|a, b| a.time.total_cmp(&b.time));
    for mut imp in impacts {
        if state.player.dead {
            finish_flight(
                state,
                &mut remaining,
                imp.idx,
                imp.shot,
                imp.lands_first,
                imp.landing_time,
                imp.spent,
                imp.flight_end,
                imp.from_x,
                imp.from_base_y,
                imp.from_vy,
                imp.step_x,
            );
            continue;
        }
        let dealt = damage_player(state, imp.shot.damage, imp.x);
        if dealt > 0 && imp.shot.native_object == Some(30057) {
            crate::combat::try_freeze_player(state);
        }
        crate::push_projectile_sound(
            state,
            "projectileHit",
            imp.shot.native_object,
            imp.x,
            imp.shot.z,
        );
        if imp.shot.piercing > 0 {
            imp.shot.hit_player = true;
            imp.shot.piercing -= 1;
            finish_flight(
                state,
                &mut remaining,
                imp.idx,
                imp.shot,
                imp.lands_first,
                imp.landing_time,
                imp.spent,
                imp.flight_end,
                imp.from_x,
                imp.from_base_y,
                imp.from_vy,
                imp.step_x,
            );
            continue;
        }
        emit_projectile_destroy_effect(state, &imp.shot, imp.x, imp.y);
    }
    state.projectiles = remaining.into_iter().flatten().collect();
}

fn walk_towards(state: &mut State, enemy_idx: usize, speed: f64) {
    let e = &state.enemies[enemy_idx];
    let ex = e.x;
    let ez = e.z;
    let ew = e.width;
    let ef = e.facing;
    let px = state.player.x;
    let pz = state.player.z;
    let ahead_x = ex + f64::from(ef) * speed * DT * 6.0;

    let corridor_blocked = state.props.iter().any(|prop| {
        let Some(b) = prop_obstacle(prop, Some((ew, ew))) else {
            return false;
        };
        if (ez - b.z).abs() >= b.depth / 2.0 + ROUTE_GRID_STEP / 2.0 {
            return false;
        }
        let half_w = b.width / 2.0 + ROUTE_GRID_STEP / 2.0;
        ex.max(px) > b.x - half_w && ex.min(px) < b.x + half_w
    });

    if !corridor_blocked
        && !prop_blocks_at(state, ahead_x, ez, Some((ew, ew)), ROUTE_GRID_STEP / 2.0)
    {
        state.enemies[enemy_idx].vx = f64::from(ef) * speed;
        return;
    }
    let route = route_step(state, px, pz, Some(ex), Some(ez), Some((ew, ew)), false);
    if state.reference_profile.is_some() {
        let next_rx = ex + f64::from(route[0]) * speed * DT * 4.0;
        let route_hits_prop = route == [0, 0]
            || (route[1] == 0
                && route[0] != 0
                && prop_blocks_at(state, next_rx, ez, Some((ew, ew)), 2.0));
        if route_hits_prop {
            // Coarse grid route stalled or collided with exact prop_obstacle hitbox:
            // steer cleanly around the blocking prop's nearest open Z edge.
            let max_d = band_depth(state.band_back_y);
            let blocking_z = state
                .props
                .iter()
                .filter_map(|prop| prop_obstacle(prop, Some((ew, ew))))
                .find(|b| {
                    let half_w = b.width / 2.0 + ROUTE_GRID_STEP / 2.0;
                    let half_d = b.depth / 2.0 + ROUTE_GRID_STEP / 2.0;
                    (ez - b.z).abs() < half_d
                        && ex.max(px) > b.x - half_w
                        && ex.min(px) < b.x + half_w
                })
                .map(|b| b.z);
            let detour_dir = if ez <= ROUTE_GRID_STEP * 0.75 {
                1.0
            } else if ez >= max_d - ROUTE_GRID_STEP * 0.75 {
                -1.0
            } else if let Some(bz) = blocking_z {
                if ez >= bz {
                    1.0
                } else {
                    -1.0
                }
            } else if ez <= max_d * 0.5 {
                -1.0
            } else {
                1.0
            };
            state.enemies[enemy_idx].vx = f64::from(ef) * speed * 0.25;
            state.enemies[enemy_idx].vz = detour_dir * enemy_depth_speed(speed);
            return;
        }
    }
    state.enemies[enemy_idx].vx = f64::from(route[0]) * speed;
    if route[1] != 0 {
        state.enemies[enemy_idx].vz = f64::from(route[1]) * enemy_depth_speed(speed);
    }
}

fn begin_enemy_attack(state: &mut State, enemy_idx: usize, kind: &str, windup: f64, duration: f64) {
    let (ekind, eid, ex, ez) = {
        let e = &mut state.enemies[enemy_idx];
        e.attack_kind = kind.to_string();
        e.super_armor = kind == "slam";
        e.attack_windup = windup;
        e.attack_duration = duration;
        e.attack_timer = duration;
        e.attack_hit_done = false;
        e.attack_recovered = false;
        (e.kind.clone(), e.id, e.x, e.z)
    };
    crate::push_enemy_attack_sound(state, &ekind, kind, eid, ex, ez);
}

fn enemy_hits_player(enemy: &Enemy, player: &Player) -> bool {
    in_reach_of(player.z, enemy.z, DEPTH_REACH_MELEE)
        && boxes_overlap(
            body_box(enemy.x, enemy.y, enemy.width, enemy.height),
            body_box(player.x, player.y, player.width, player.height),
        )
}

fn spin_hits_player(enemy: &Enemy, player: &Player, radius: f64) -> bool {
    if !in_reach_of(player.z, enemy.z, DEPTH_REACH_SPIN) {
        return false;
    }
    let mut swept = body_box(enemy.x, enemy.y, enemy.width, enemy.height);
    swept.left -= radius * 0.5;
    swept.right += radius * 0.5;
    boxes_overlap(
        swept,
        body_box(player.x, player.y, player.width, player.height),
    )
}

fn choose_enemy_action(state: &mut State, enemy_idx: usize) {
    let delta = state.player.x - state.enemies[enemy_idx].x;
    let gap = body_gap(
        state.enemies[enemy_idx].x,
        state.enemies[enemy_idx].width,
        state.player.x,
        state.player.width,
    );
    if !state.player.dead {
        state.enemies[enemy_idx].facing = if delta >= 0.0 { 1 } else { -1 };
    }
    if state.player.dead {
        state.enemies[enemy_idx].vx = 0.0;
        state.enemies[enemy_idx].vz = 0.0;
        return;
    }
    let reserved_lugaru = state.enemies[enemy_idx].kind == "lugaruBoss"
        && state
            .room
            .as_ref()
            .is_some_and(|r| !r.wave_triggered && !r.pending_wave.is_empty());
    if reserved_lugaru {
        state.enemies[enemy_idx].vx = 0.0;
        state.enemies[enemy_idx].vz = 0.0;
        return;
    }

    if !state.enemies[enemy_idx].activated {
        let e = &state.enemies[enemy_idx];
        let damaged = e.hurt_timer > 0.0 || e.hp < e.max_hp;
        let sight_eff = e.sight_range.max(480.0);
        let room_elapsed = state
            .room
            .as_ref()
            .map(|r| state.time - r.entered_at)
            .unwrap_or(0.0);
        let room_fallback = room_elapsed >= 1.5;
        if damaged || (e.activation_delay <= 0.0 && (delta.abs() <= sight_eff || room_fallback)) {
            state.enemies[enemy_idx].activated = true;
        } else {
            state.enemies[enemy_idx].vx = 0.0;
            state.enemies[enemy_idx].vz = 0.0;
            return;
        }
    }

    let row_gap = state.player.z - state.enemies[enemy_idx].z;
    let same_row = in_reach_of(
        state.player.z,
        state.enemies[enemy_idx].z,
        DEPTH_REACH_MELEE,
    );
    let spd = state.enemies[enemy_idx].speed;
    state.enemies[enemy_idx].vz = if same_row {
        0.0
    } else {
        (if row_gap > 0.0 { 1.0 } else { -1.0 }) * enemy_depth_speed(spd)
    };

    let behavior = state.enemies[enemy_idx].behavior.clone();
    if behavior == "ranged" {
        state.enemies[enemy_idx].vz = 0.0;
        let ar = state.enemies[enemy_idx].attack_range;
        let kr = state.enemies[enemy_idx].keep_range;
        let keep = if kr > 0.0 { kr } else { ar * 0.6 };
        let facing = state.enemies[enemy_idx].facing;
        let use_ref = state.reference_profile.is_some();
        let cam_l = state.camera_x + 18.0;
        let cam_r = state.camera_x + window_width() - 18.0;
        let ex = state.enemies[enemy_idx].x;
        let off_screen = use_ref && (ex < cam_l || ex > cam_r);
        if off_screen {
            walk_towards(state, enemy_idx, spd);
        } else if gap < keep {
            let next_back_x = ex - f64::from(facing) * spd * DT;
            let can_backpedal = !use_ref || (next_back_x >= cam_l && next_back_x <= cam_r);
            if can_backpedal {
                state.enemies[enemy_idx].vx = -f64::from(facing) * spd;
            } else {
                state.enemies[enemy_idx].vx = 0.0;
                if state.enemies[enemy_idx].attack_cooldown <= 0.0 {
                    let wu = state.enemies[enemy_idx].base_attack_windup;
                    let dur = state.enemies[enemy_idx].base_attack_duration;
                    begin_enemy_attack(state, enemy_idx, "shoot", wu, dur);
                    let e_snap = state.enemies[enemy_idx].clone();
                    push_telegraph(state, &e_snap, "AIM", ar * 0.25, wu, facing);
                }
            }
        } else if gap > ar {
            walk_towards(state, enemy_idx, spd);
        } else {
            state.enemies[enemy_idx].vx = 0.0;
            if state.enemies[enemy_idx].attack_cooldown <= 0.0 {
                let wu = state.enemies[enemy_idx].base_attack_windup;
                let dur = state.enemies[enemy_idx].base_attack_duration;
                begin_enemy_attack(state, enemy_idx, "shoot", wu, dur);
                let e_snap = state.enemies[enemy_idx].clone();
                push_telegraph(state, &e_snap, "AIM", ar * 0.25, wu, facing);
            }
        }
        return;
    }

    if behavior == "charger" {
        let ar = state.enemies[enemy_idx].attack_range;
        if gap > ar * 0.8 {
            walk_towards(state, enemy_idx, spd);
        } else {
            state.enemies[enemy_idx].vx = 0.0;
            if same_row && state.enemies[enemy_idx].attack_cooldown <= 0.0 {
                let wu = state.enemies[enemy_idx].base_attack_windup;
                let dur = state.enemies[enemy_idx].base_attack_duration;
                let facing = state.enemies[enemy_idx].facing;
                begin_enemy_attack(state, enemy_idx, "charge", wu, dur);
                state.enemies[enemy_idx].charge_dir = facing;
                let e_snap = state.enemies[enemy_idx].clone();
                push_telegraph(state, &e_snap, "CHARGE", ar, wu, facing);
            }
        }
        return;
    }

    if behavior == "elite" {
        if let Some(spin) = state.enemies[enemy_idx].spin_dash.clone() {
            if state.enemies[enemy_idx].spin_cooldown <= 0.0
                && state.enemies[enemy_idx].attack_cooldown <= 0.0
                && gap <= spin.commit
                && in_reach_of(state.player.z, state.enemies[enemy_idx].z, DEPTH_REACH_SPIN)
            {
                let facing = state.enemies[enemy_idx].facing;
                state.enemies[enemy_idx].vx = 0.0;
                state.enemies[enemy_idx].spin_dir = facing;
                begin_enemy_attack(
                    state,
                    enemy_idx,
                    "spin",
                    spin.windup,
                    spin.windup + spin.duration + spin.recovery,
                );
                state.enemies[enemy_idx].super_armor = true;
                let e_snap = state.enemies[enemy_idx].clone();
                push_telegraph(state, &e_snap, "SPIN", spin.radius, spin.windup, facing);
                return;
            }
        }
        let ar = state.enemies[enemy_idx].attack_range;
        if gap > ar * 0.8 {
            walk_towards(state, enemy_idx, spd);
        } else {
            state.enemies[enemy_idx].vx = 0.0;
            if same_row && state.enemies[enemy_idx].attack_cooldown <= 0.0 {
                let wu = state.enemies[enemy_idx].base_attack_windup;
                let dur = state.enemies[enemy_idx].base_attack_duration;
                begin_enemy_attack(state, enemy_idx, "melee", wu, dur);
            }
        }
        return;
    }

    if let Some(slam) = state.enemies[enemy_idx].slam.clone() {
        let fd = floor_distance(
            state.player.x,
            state.player.z,
            state.enemies[enemy_idx].x,
            state.enemies[enemy_idx].z,
        );
        if state.enemies[enemy_idx].slam_cooldown <= 0.0
            && state.enemies[enemy_idx].attack_cooldown <= 0.0
            && gap <= slam.commit
            && fd <= slam.radius
        {
            state.enemies[enemy_idx].vx = 0.0;
            begin_enemy_attack(
                state,
                enemy_idx,
                "slam",
                slam.windup,
                slam.windup + slam.recovery,
            );
            let e_snap = state.enemies[enemy_idx].clone();
            push_telegraph(state, &e_snap, "SLAM", slam.radius, slam.windup, 0);
            return;
        }
    }

    if let Some(beam) = state.enemies[enemy_idx].beam.clone() {
        if state.enemies[enemy_idx].beam_cooldown <= 0.0
            && state.enemies[enemy_idx].attack_cooldown <= 0.0
            && state.enemies[enemy_idx].hp <= state.enemies[enemy_idx].max_hp * beam.hp_ratio
        {
            let facing = state.enemies[enemy_idx].facing;
            state.enemies[enemy_idx].vx = 0.0;
            state.enemies[enemy_idx].beam_pulse = 0;
            begin_enemy_attack(
                state,
                enemy_idx,
                "beam",
                beam.windup,
                beam.windup + beam.duration,
            );
            state.enemies[enemy_idx].beam_cooldown = beam.cooldown;
            state.enemies[enemy_idx].attack_cooldown = state.enemies[enemy_idx].attack_cooldown_max;
            let e_snap = state.enemies[enemy_idx].clone();
            push_telegraph(state, &e_snap, "BEAM", beam.range, beam.windup, facing);
            return;
        }
    }

    if let Some(sweep) = state.enemies[enemy_idx].sweep.clone() {
        if state.enemies[enemy_idx].sweep_cooldown <= 0.0
            && state.enemies[enemy_idx].attack_cooldown <= 0.0
            && gap <= sweep.commit
        {
            let facing = state.enemies[enemy_idx].facing;
            state.enemies[enemy_idx].vx = 0.0;
            begin_enemy_attack(
                state,
                enemy_idx,
                "sweep",
                sweep.windup,
                sweep.windup + sweep.recovery,
            );
            let e_snap = state.enemies[enemy_idx].clone();
            push_telegraph(state, &e_snap, "SWEEP", sweep.radius, sweep.windup, facing);
            return;
        }
    }

    let lunge = if state.enemies[enemy_idx].phase >= 2 {
        state.enemies[enemy_idx]
            .phase2
            .as_ref()
            .and_then(|p| p.lunge.clone())
            .or_else(|| state.enemies[enemy_idx].lunge.clone())
    } else {
        state.enemies[enemy_idx].lunge.clone()
    };
    if let Some(lunge) = lunge {
        if same_row
            && state.enemies[enemy_idx].attack_cooldown <= 0.0
            && state.enemies[enemy_idx].lunge_cooldown <= 0.0
            && gap >= lunge.min_gap
            && gap <= lunge.gap
        {
            let facing = state.enemies[enemy_idx].facing;
            state.enemies[enemy_idx].vx = 0.0;
            state.enemies[enemy_idx].charge_speed = lunge.speed;
            state.enemies[enemy_idx].charge_from = lunge.windup * 0.6;
            state.enemies[enemy_idx].charge_to = lunge.windup + lunge.recovery * 0.75;
            state.enemies[enemy_idx].charge_dir = facing;
            begin_enemy_attack(
                state,
                enemy_idx,
                "charge",
                lunge.windup,
                lunge.windup + lunge.recovery,
            );
            state.enemies[enemy_idx].super_armor = true;
            state.enemies[enemy_idx].lunge_cooldown = lunge.cooldown;
            let e_snap = state.enemies[enemy_idx].clone();
            push_telegraph(state, &e_snap, "LUNGE", lunge.range, lunge.windup, facing);
            return;
        }
    }

    let ar = state.enemies[enemy_idx].attack_range;
    if gap > ar * 0.8 {
        walk_towards(state, enemy_idx, spd);
    } else {
        state.enemies[enemy_idx].vx = 0.0;
        if same_row && state.enemies[enemy_idx].attack_cooldown <= 0.0 {
            let wu = state.enemies[enemy_idx].base_attack_windup;
            let dur = state.enemies[enemy_idx].base_attack_duration;
            begin_enemy_attack(state, enemy_idx, "melee", wu, dur);
        }
    }
}

fn advance_enemy_attack(state: &mut State, enemy_idx: usize, dt: f64) {
    let elapsed = state.enemies[enemy_idx].attack_duration - state.enemies[enemy_idx].attack_timer;
    let kind = state.enemies[enemy_idx].attack_kind.clone();

    if kind == "spin" {
        let Some(spin) = state.enemies[enemy_idx].spin_dash.clone() else {
            state.enemies[enemy_idx].attack_timer = 0.0;
            return;
        };
        let spin_ends = spin.windup + spin.duration;
        if elapsed >= spin.windup && elapsed <= spin_ends {
            let sdir = state.enemies[enemy_idx].spin_dir;
            state.enemies[enemy_idx].vx = f64::from(sdir) * spin.speed;
            if !state.enemies[enemy_idx].attack_hit_done
                && spin_hits_player(&state.enemies[enemy_idx], &state.player, spin.radius)
            {
                state.enemies[enemy_idx].attack_hit_done = true;
                let ex = state.enemies[enemy_idx].x;
                damage_player(state, spin.damage, ex);
            }
        } else if elapsed > spin_ends {
            state.enemies[enemy_idx].vx *= 0.35;
            if !state.enemies[enemy_idx].attack_recovered {
                state.enemies[enemy_idx].attack_recovered = true;
                state.enemies[enemy_idx].attack_cooldown =
                    state.enemies[enemy_idx].attack_cooldown_max;
                state.enemies[enemy_idx].spin_cooldown = spin.cooldown;
                state.enemies[enemy_idx].super_armor = false;
            }
        }
        state.enemies[enemy_idx].attack_timer =
            (state.enemies[enemy_idx].attack_timer - dt).max(0.0);
        return;
    }

    if kind == "charge" {
        let cf = state.enemies[enemy_idx].charge_from;
        let ct = state.enemies[enemy_idx].charge_to;
        if state.enemies[enemy_idx].attack_timer > 0.0 && elapsed >= cf && elapsed <= ct {
            let cdir = state.enemies[enemy_idx].charge_dir;
            let cspd = state.enemies[enemy_idx].charge_speed;
            state.enemies[enemy_idx].vx = f64::from(cdir) * cspd;
            if !state.enemies[enemy_idx].attack_hit_done
                && enemy_hits_player(&state.enemies[enemy_idx], &state.player)
            {
                state.enemies[enemy_idx].attack_hit_done = true;
                let dmg = state.enemies[enemy_idx].damage;
                let ex = state.enemies[enemy_idx].x;
                damage_player(state, dmg, ex);
            }
        } else if elapsed > ct {
            state.enemies[enemy_idx].vx *= 0.4;
            if !state.enemies[enemy_idx].attack_recovered {
                state.enemies[enemy_idx].attack_recovered = true;
                state.enemies[enemy_idx].attack_cooldown =
                    state.enemies[enemy_idx].attack_cooldown_max;
                state.enemies[enemy_idx].super_armor = false;
            }
        }
        state.enemies[enemy_idx].attack_timer =
            (state.enemies[enemy_idx].attack_timer - dt).max(0.0);
        return;
    }

    if kind == "beam" {
        let Some(beam) = state.enemies[enemy_idx].beam.clone() else {
            state.enemies[enemy_idx].attack_timer = 0.0;
            return;
        };
        let pulse_at = beam.windup + f64::from(state.enemies[enemy_idx].beam_pulse) * 0.18;
        if state.enemies[enemy_idx].beam_pulse < 3 && elapsed >= pulse_at {
            state.enemies[enemy_idx].beam_pulse += 1;
            if state.enemies[enemy_idx].beam_pulse == 1 {
                let mut eff = Effect::new("bossbeam", beam.duration);
                eff.x = state.enemies[enemy_idx].x;
                eff.z = state.enemies[enemy_idx].z;
                eff.height = state.enemies[enemy_idx].height;
                eff.seed = state.enemies[enemy_idx].id;
                state.effects.push(eff);
            }
            let beam_ground = state.player.y >= ARENA_GROUND_Y - 26.0;
            if !state.player.dead && beam_ground {
                let ex = state.enemies[enemy_idx].x;
                damage_player(state, beam.damage, ex);
            }
        }
        state.enemies[enemy_idx].attack_timer =
            (state.enemies[enemy_idx].attack_timer - dt).max(0.0);
        return;
    }

    if kind == "sweep" {
        let Some(sweep) = state.enemies[enemy_idx].sweep.clone() else {
            state.enemies[enemy_idx].attack_timer = 0.0;
            return;
        };
        if !state.enemies[enemy_idx].attack_hit_done && elapsed >= sweep.windup {
            state.enemies[enemy_idx].attack_hit_done = true;
            let ex = state.enemies[enemy_idx].x;
            let ez = state.enemies[enemy_idx].z;
            let ef = state.enemies[enemy_idx].facing;
            let sweep_x = ex + f64::from(ef) * sweep.offset;
            let sweep_dz = state.player.z - ez;
            let on_ground = state.player.y >= ARENA_GROUND_Y - 26.0;
            let in_sweep =
                ((state.player.x - sweep_x).powi(2) + sweep_dz * sweep_dz).sqrt() <= sweep.radius;
            if !state.player.dead && on_ground && in_sweep {
                damage_player(state, sweep.damage, ex);
            }
            state.enemies[enemy_idx].sweep_cooldown = sweep.cooldown;
            state.enemies[enemy_idx].attack_cooldown = state.enemies[enemy_idx].attack_cooldown_max;
        }
        state.enemies[enemy_idx].attack_timer =
            (state.enemies[enemy_idx].attack_timer - dt).max(0.0);
        return;
    }

    if !state.enemies[enemy_idx].attack_hit_done
        && elapsed >= state.enemies[enemy_idx].attack_windup
    {
        state.enemies[enemy_idx].attack_hit_done = true;
        if kind == "shoot" {
            spawn_projectile(state, enemy_idx);
            state.enemies[enemy_idx].attack_cooldown = state.enemies[enemy_idx].attack_cooldown_max;
        } else if kind == "slam" {
            if let Some(slam) = state.enemies[enemy_idx].slam.clone() {
                let e_snap = state.enemies[enemy_idx].clone();
                push_shockwave(state, &e_snap);
                let on_ground = state.player.y >= ARENA_GROUND_Y - 26.0;
                if !state.player.dead
                    && on_ground
                    && floor_distance(state.player.x, state.player.z, e_snap.x, e_snap.z)
                        <= slam.radius
                {
                    damage_player(state, slam.damage, e_snap.x);
                }
                state.enemies[enemy_idx].slam_cooldown = slam.cooldown;
                state.enemies[enemy_idx].attack_cooldown =
                    state.enemies[enemy_idx].attack_cooldown_max;
            }
        } else {
            let e = &state.enemies[enemy_idx];
            if in_reach_of(state.player.z, e.z, DEPTH_REACH_MELEE)
                && body_gap(e.x, e.width, state.player.x, state.player.width) <= e.attack_range
            {
                let (dmg, ex, is_frost) = (e.damage, e.x, e.kind == "goblinBlue");
                let dealt = damage_player(state, dmg, ex);
                if dealt > 0 && is_frost {
                    crate::combat::try_freeze_player(state);
                }
            }
            state.enemies[enemy_idx].attack_cooldown = state.enemies[enemy_idx].attack_cooldown_max;
        }
    }
    state.enemies[enemy_idx].attack_timer = (state.enemies[enemy_idx].attack_timer - dt).max(0.0);
    if state.enemies[enemy_idx].attack_timer == 0.0 {
        state.enemies[enemy_idx].super_armor = false;
    }
}

pub fn update_enemies(state: &mut State, dt: f64, previous_player_position: Option<[f64; 3]>) {
    let existing_projectiles = state.projectiles.len();
    let mut cleared = run_cleared(state);
    let count = state.enemies.len();
    for e_idx in 0..count {
        if cleared {
            continue;
        }
        if !state.enemies[e_idx].dead
            && (state.enemies[e_idx].hp <= 0.0 || state.enemies[e_idx].gone)
        {
            state.enemies[e_idx].dead = true;
        }
        if state.enemies[e_idx].dead {
            continue;
        }
        state.enemies[e_idx].hurt_timer = (state.enemies[e_idx].hurt_timer - dt).max(0.0);
        state.enemies[e_idx].hit_flash_timer = (state.enemies[e_idx].hit_flash_timer - dt).max(0.0);
        state.enemies[e_idx].activation_delay =
            (state.enemies[e_idx].activation_delay - dt).max(0.0);
        state.enemies[e_idx].attack_cooldown = (state.enemies[e_idx].attack_cooldown - dt).max(0.0);
        if state.enemies[e_idx].slam.is_some() {
            state.enemies[e_idx].slam_cooldown = (state.enemies[e_idx].slam_cooldown - dt).max(0.0);
        }
        if state.enemies[e_idx].sweep.is_some() {
            state.enemies[e_idx].sweep_cooldown =
                (state.enemies[e_idx].sweep_cooldown - dt).max(0.0);
        }
        if state.enemies[e_idx].beam.is_some() {
            state.enemies[e_idx].beam_cooldown = (state.enemies[e_idx].beam_cooldown - dt).max(0.0);
        }
        state.enemies[e_idx].spin_cooldown = (state.enemies[e_idx].spin_cooldown - dt).max(0.0);
        state.enemies[e_idx].lunge_cooldown = (state.enemies[e_idx].lunge_cooldown - dt).max(0.0);
        state.enemies[e_idx].knockdown = (state.enemies[e_idx].knockdown - dt).max(0.0);
        state.enemies[e_idx].stun = (state.enemies[e_idx].stun - dt).max(0.0);

        if state.enemies[e_idx].grabbed > 0.0 {
            state.enemies[e_idx].grabbed = (state.enemies[e_idx].grabbed - dt).max(0.0);
            let ew = state.enemies[e_idx].width;
            state.enemies[e_idx].x = (state.player.x + f64::from(state.player.facing) * 30.0)
                .clamp(room_left(state) + ew / 2.0, room_right(state) - ew / 2.0);
            state.enemies[e_idx].y = ARENA_GROUND_Y;
            state.enemies[e_idx].z = state.player.z;
            state.enemies[e_idx].vx = 0.0;
            state.enemies[e_idx].vy = 0.0;
            state.enemies[e_idx].vz = 0.0;
            state.enemies[e_idx].attack_timer = 0.0;
        }

        if let Some(mut bleed) = state.enemies[e_idx].bleed.take() {
            let active_time = dt.min(bleed.remaining);
            bleed.remaining -= active_time;
            bleed.timer -= active_time;
            let mut died = false;
            while bleed.timer <= 1e-9 {
                bleed.timer += bleed.interval;
                let ex = state.enemies[e_idx].x;
                let opts = DamageEnemyOptions {
                    no_blood_orbs: true,
                    ..Default::default()
                };
                damage_enemy(state, e_idx, bleed.damage, 0.0, ex, &opts);
                if state.enemies[e_idx].dead {
                    if is_boss_enemy(&state.enemies[e_idx]) {
                        cleared = run_cleared(state);
                    }
                    died = true;
                    break;
                }
            }
            if died {
                continue;
            }
            if bleed.remaining > 1e-9 {
                state.enemies[e_idx].bleed = Some(bleed);
            }
        }

        if let Some(mut entering) = state.enemies[e_idx].entering.take() {
            let enter_dx = entering.to_x - state.enemies[e_idx].x;
            if enter_dx.abs() <= 8.0 || entering.time > 6.0 {
                state.enemies[e_idx].vx = 0.0;
            } else if state.enemies[e_idx].grabbed > 0.0
                || state.enemies[e_idx].knockdown > 0.0
                || !state.enemies[e_idx].on_ground
            {
                // cancel entering
            } else {
                let dir = if enter_dx > 0.0 { 1 } else { -1 };
                state.enemies[e_idx].facing = dir;
                state.enemies[e_idx].vx = f64::from(dir) * entering.speed;
                state.enemies[e_idx].vz = 0.0;
                entering.time += dt;
                state.enemies[e_idx].entering = Some(entering);
            }
        }

        if state.enemies[e_idx].attack_timer <= 0.0 {
            state.enemies[e_idx].super_armor = false;
        }

        if state.enemies[e_idx].hurt_timer > 0.0 {
            state.enemies[e_idx].vx *= 0.86;
            state.enemies[e_idx].vz *= 0.86;
        } else if state.enemies[e_idx].attack_timer > 0.0 {
            state.enemies[e_idx].vx *= 0.5;
            state.enemies[e_idx].vz *= 0.5;
        } else if !state.enemies[e_idx].on_ground
            || state.enemies[e_idx].knockdown > 0.0
            || state.enemies[e_idx].stun > 0.0
            || state.enemies[e_idx].grabbed > 0.0
        {
            state.enemies[e_idx].vx *= 0.98;
            state.enemies[e_idx].vz *= 0.98;
        } else if state.enemies[e_idx].entering.is_none() {
            choose_enemy_action(state, e_idx);
        }

        if state.enemies[e_idx].attack_timer > 0.0 {
            advance_enemy_attack(state, e_idx, dt);
        }

        let lw = room_left(state);
        let rw = room_right(state);
        let max_d = band_depth(state.band_back_y);
        {
            let e = &mut state.enemies[e_idx];
            e.vy = (e.vy + PHYSICS_GRAVITY * dt).min(PHYSICS_MAX_FALL_SPEED);
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.z += e.vz * dt;
            if e.y >= ARENA_GROUND_Y {
                e.y = ARENA_GROUND_Y;
                e.vy = 0.0;
                e.on_ground = true;
            }
            if !e.x.is_finite() {
                e.x = (lw + rw) * 0.5;
            }
            if !e.z.is_finite() {
                e.z = max_d * 0.5;
            }
            e.x = e.x.clamp(lw + e.width / 2.0, rw - e.width / 2.0);
            e.z = e.z.clamp(0.0, max_d);
        }
        {
            let mut ex = state.enemies[e_idx].x;
            let mut ez = state.enemies[e_idx].z;
            let mut vx = state.enemies[e_idx].vx;
            let mut vz = state.enemies[e_idx].vz;
            let ew = state.enemies[e_idx].width;
            block_props_coords(state, &mut ex, &mut ez, &mut vx, &mut vz, Some((ew, ew)));
            state.enemies[e_idx].x = ex;
            state.enemies[e_idx].z = ez;
            state.enemies[e_idx].vx = vx;
            state.enemies[e_idx].vz = vz;
        }

        let walking = state.enemies[e_idx].vx.abs() > 1.0 || state.enemies[e_idx].vz.abs() > 1.0;
        if state.enemies[e_idx].on_ground && walking {
            state.enemies[e_idx].step_timer -= dt;
            if state.enemies[e_idx].step_timer <= 0.0 {
                let (ekind, eid, ex, ez) = {
                    let e = &mut state.enemies[e_idx];
                    e.step_timer = 0.38;
                    (e.kind.clone(), e.id, e.x, e.z)
                };
                crate::push_enemy_sound(state, "enemyStep", &ekind, eid, ex, ez);
            }
        } else {
            state.enemies[e_idx].step_timer = 0.0;
        }
    }

    update_projectiles(state, dt, previous_player_position, existing_projectiles);
    separate_enemies(state);
}

fn separate_enemies(state: &mut State) {
    let wall_left = room_left(state);
    let wall_right = room_right(state);
    let len = state.enemies.len();
    for i in 0..len {
        for j in (i + 1)..len {
            if state.enemies[i].dead || state.enemies[j].dead {
                continue;
            }
            let min_gap = (state.enemies[i].width + state.enemies[j].width) / 2.0;
            let gap = (state.enemies[i].x - state.enemies[j].x).abs();
            if gap >= min_gap || (state.enemies[i].z - state.enemies[j].z).abs() >= min_gap {
                continue;
            }
            let push = (min_gap - gap) / 2.0;
            let (left_idx, right_idx) = if state.enemies[i].x <= state.enemies[j].x {
                (i, j)
            } else {
                (j, i)
            };
            let min_x = wall_left + state.enemies[left_idx].width / 2.0;
            let max_x = wall_right - state.enemies[right_idx].width / 2.0;
            let lx0 = state.enemies[left_idx].x;
            let lz0 = state.enemies[left_idx].z;
            let lw = state.enemies[left_idx].width;
            let rx0 = state.enemies[right_idx].x;
            let rz0 = state.enemies[right_idx].z;
            let rw = state.enemies[right_idx].width;

            let mut left_x =
                stop_at_horizontal_prop(state, lx0, lz0, Some((lw, lw)), (lx0 - push).max(min_x));
            let mut right_x =
                stop_at_horizontal_prop(state, rx0, rz0, Some((rw, rw)), (rx0 + push).min(max_x));
            if left_x > lx0 - push {
                right_x = stop_at_horizontal_prop(
                    state,
                    rx0,
                    rz0,
                    Some((rw, rw)),
                    (left_x + min_gap).min(max_x),
                );
            } else if right_x < rx0 + push {
                left_x = stop_at_horizontal_prop(
                    state,
                    lx0,
                    lz0,
                    Some((lw, lw)),
                    (right_x - min_gap).max(min_x),
                );
            }
            state.enemies[left_idx].x = left_x;
            state.enemies[right_idx].x = right_x;
        }
    }
}

fn spawn_wave_enemy(state: &mut State, entry: &RoomWaveItem) -> Enemy {
    let spec = TABLES
        .enemy_types
        .get(&entry.kind)
        .or_else(|| TABLES.enemy_types.get("grunt"))
        // INFALLIBLE: TABLES.enemy_types always contains "grunt"
        .expect("INFALLIBLE: grunt enemy type exists");
    let left = room_left(state);
    let right = room_right(state);
    let side = match state.entry_door.as_deref() {
        Some("W") => -1.0,
        Some("E") => 1.0,
        _ => {
            if entry.x <= left + room_width(state) / 2.0 {
                -1.0
            } else {
                1.0
            }
        }
    };
    let spawn_x = if side < 0.0 {
        left + spec.width
    } else {
        right - spec.width
    };
    let to_x = entry.x.clamp(left + spec.width, right - spec.width);
    let mut enemy = create_enemy(state, &entry.kind, spawn_x, entry.z, entry.level, entry.xp);
    enemy.x = spawn_x;
    enemy.facing = if to_x >= spawn_x { 1 } else { -1 };
    enemy.entering = Some(EnemyEntering {
        to_x,
        speed: 200.0,
        time: 0.0,
    });
    enemy
}

pub fn update_waves(state: &mut State) {
    let Some(ref room) = state.room else {
        return;
    };
    if room.cleared || state.defeat || run_cleared(state) {
        return;
    }
    let mut alive = state.enemies.iter().filter(|e| !e.dead).count();
    let now = state.time;

    let need_next_wave = {
        let r = state.room.as_ref();
        r.is_some_and(|rm| rm.pending_wave.is_empty() && !rm.pending_waves.is_empty())
    };
    if need_next_wave {
        let since = {
            // INFALLIBLE: checked room is_some above
            let r = state.room.as_ref().expect("INFALLIBLE: room exists");
            now - r.last_wave_at
        };
        if alive > 2 && since < 8.0 {
            return;
        }
        if let Some(ref mut rm) = state.room {
            rm.pending_wave = rm.pending_waves.remove(0);
            rm.last_wave_at = now;
            rm.wave_triggered = false;
        }
    }

    let (has_pending, triggered, elapsed, cap) = {
        let Some(ref rm) = state.room else {
            return;
        };
        (
            !rm.pending_wave.is_empty(),
            rm.wave_triggered,
            now - rm.last_wave_at,
            rm.wave_cap,
        )
    };
    if !has_pending {
        return;
    }
    if !triggered {
        if alive > 2 && elapsed < 8.0 {
            return;
        }
        if let Some(ref mut rm) = state.room {
            rm.wave_triggered = true;
        }
    }

    while alive < cap {
        let next_entry = state.room.as_mut().and_then(|rm| {
            if rm.pending_wave.is_empty() {
                None
            } else {
                Some(rm.pending_wave.remove(0))
            }
        });
        let Some(entry) = next_entry else {
            break;
        };
        let spawned = spawn_wave_enemy(state, &entry);
        state.enemies.push(spawned);
        alive += 1;
        if let Some(ref mut rm) = state.room {
            rm.wave_spawned += 1;
        }
    }
}

pub fn resolve_room(state: &mut State, input: &Input, could_steer: bool) {
    for e in &mut state.enemies {
        if !e.dead && (e.hp <= 0.0 || e.gone) {
            e.dead = true;
        }
    }
    let alive_count = state.enemies.iter().filter(|e| !e.dead).count();
    state
        .enemies
        .retain(|e| !e.dead || (!e.gone && e.dying > 0.0));

    let boss_cell = state.dungeon.as_ref().is_some_and(|d| state.cell == d.boss);
    let boss_idx = if boss_cell {
        state.enemies.iter().position(is_boss_enemy)
    } else {
        None
    };
    let boss_down = boss_cell && boss_idx.is_some_and(|idx| state.enemies[idx].dead);
    let pending = state
        .room
        .as_ref()
        .map(|rm| rm.pending_wave.len() + rm.pending_waves.iter().map(Vec::len).sum::<usize>())
        .unwrap_or(0);

    let alive_bunkers = state
        .props
        .iter()
        .filter(|p| p.piece == "goblinBunker" && !p.broken && !p.gone)
        .count();
    let already_cleared = state.room.as_ref().is_some_and(|r| r.cleared);
    if ((alive_count == 0 && pending == 0 && alive_bunkers == 0) || boss_down)
        && !already_cleared
        && !state.defeat
    {
        let cell_room_idx = current_cell(state).map(|c| c.room);
        let has_native_gates = cell_room_idx
            .and_then(|ridx| TABLES.stages.get(&state.stage_id)?.rooms.get(ridx))
            .is_some_and(|rs| rs.native_path_gates.is_some());
        if let Some(ref mut rm) = state.room {
            rm.cleared = true;
            if has_native_gates {
                rm.native_gate_opened_at = Some(state.time);
            }
        }
        if let Some(c) = current_cell_mut(state) {
            c.cleared = true;
        }
        state.stats.rooms += 1;
        if !boss_cell {
            crate::push_sound(state, "gateOpen", state.player.x, state.player.z);
        }
        if boss_cell && state.victory_delay.is_none() {
            if let Some(ref mut rm) = state.room {
                rm.pending_wave.clear();
                rm.pending_waves.clear();
            }
            if let Some(b_idx) = boss_idx {
                let boss = state.enemies[b_idx].clone();
                state.victory_delay = Some(if boss.death_style.as_deref() == Some("burst") {
                    1.45
                } else {
                    death_lie(&boss) + smoke_life(&boss) + DEATH_BOSS_CHUNKS + 0.35
                });
                state.enemies = vec![boss];
            } else {
                state.enemies.clear();
            }
            state.effects.retain(|ef| ef.kind != "telegraph");
        }
        return;
    }

    if state.victory_delay.is_some() || state.dungeon.is_none() {
        return;
    }
    let Some(dir) = door_at(state) else {
        return;
    };
    let cleared = state.room.as_ref().is_some_and(|r| r.cleared);
    if !cleared {
        let steering_out = could_steer
            && match dir {
                "N" => input.up && !input.down,
                "S" => input.down && !input.up,
                "E" => input.right && !input.left,
                "W" => input.left && !input.right,
                _ => false,
            };
        if !steering_out {
            return;
        }
        let p = &state.player;
        let edge = match dir {
            "N" => band_depth(state.band_back_y) - p.z,
            "S" => p.z,
            "E" => room_right(state) - p.x,
            _ => p.x - room_left(state),
        };
        let margin = if dir == "E" || dir == "W" {
            p.walk_width / 2.0
        } else {
            0.0
        };
        if edge > margin + 8.0 {
            return;
        }
    }
    enter_cell(state, dir);
}
