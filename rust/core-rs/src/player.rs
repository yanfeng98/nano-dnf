//! Player movement, normal attack combo, skill casting, channels, and buffs (`src/core.js`).

use crate::combat::{
    advance_ahead, attack_box, block_props_coords, body_box, boxes_overlap, damage_enemy,
    heal_player, hit_time, push_banner, spawn_field, spawn_shot, stop_at_horizontal_prop,
    swing_props, update_stance_drain, DamageEnemyOptions,
};
use crate::constants::*;
use crate::dungeon::{room_left, room_right};
use crate::enemy::floor_distance;
use crate::tables::*;
use crate::types::*;

pub fn buff_by_id(buff_id: &str) -> Option<&'static SkillBuffSpec> {
    for spec in TABLES.skills.values() {
        if let Some(ref buff) = spec.buff {
            if buff.id == buff_id {
                return Some(buff);
            }
        }
    }
    None
}

pub fn buff_scale(player: &Player, field: &str) -> f64 {
    let mut scale = 1.0;
    for (id, &rem) in &player.buffs {
        if rem <= 0.0 {
            continue;
        }
        let Some(buff) = buff_by_id(id) else {
            continue;
        };
        let val = match field {
            "attackSpeed" => buff.attack_speed,
            "attackPower" => buff.attack_power,
            "moveSpeed" => buff.move_speed,
            "cooldownScale" => buff.cooldown_scale,
            "hitRecovery" => buff.hit_recovery,
            _ => None,
        };
        if let Some(v) = val {
            if v != 0.0 {
                scale *= v;
            }
        }
    }
    scale
}

pub fn buff_sum(player: &Player, field: &str) -> f64 {
    let mut total = 0.0;
    for (id, &rem) in &player.buffs {
        if rem <= 0.0 {
            continue;
        }
        let Some(buff) = buff_by_id(id) else {
            continue;
        };
        if field == "accuracy" {
            if let Some(v) = buff.accuracy {
                total += v;
            }
        }
    }
    total
}

pub fn attack_speed_of(player: &Player) -> f64 {
    let speed = player.attack_speed;
    if !speed.is_finite() || speed <= 0.0 {
        return PLAYER_ATTACK_SPEED;
    }
    let base = speed.clamp(MIN_ATTACK_SPEED, MAX_ATTACK_SPEED);
    (base * buff_scale(player, "attackSpeed")).min(MAX_ATTACK_SPEED)
}

pub fn swing_duration(player: &Player) -> f64 {
    PLAYER_ATTACK_DURATION / attack_speed_of(player)
}

pub fn channel_tick(state: &mut State, skill: &SkillSpec) {
    let Some(ref channel) = skill.channel else {
        return;
    };
    let boxed = attack_box(&state.player, skill.reach, skill.height_pad, None);
    let damage = ((channel.tick_damage
        + f64::from(state.player.level - 1) * channel.tick_growth
        + state.player.attack_bonus)
        * state.player.skill_power
        * buff_scale(&state.player, "attackPower")
        + 0.5)
        .floor();
    let depth_reach = skill.depth_reach.unwrap_or(DEPTH_REACH_MELEE);
    let pz = state.player.z;
    let px = state.player.x;
    let count = state.enemies.len();
    for e_idx in 0..count {
        if state.enemies[e_idx].dead {
            continue;
        }
        if !in_reach_of(state.enemies[e_idx].z, pz, depth_reach) {
            continue;
        }
        let eb = body_box(
            state.enemies[e_idx].x,
            state.enemies[e_idx].y,
            state.enemies[e_idx].width,
            state.enemies[e_idx].height,
        );
        if !boxes_overlap(boxed, eb) {
            continue;
        }
        let opts = DamageEnemyOptions {
            stun: channel.tick,
            ..Default::default()
        };
        damage_enemy(state, e_idx, damage, 0.0, px, &opts);
    }
}

pub fn channel_pull(state: &mut State, skill: &SkillSpec, dt: f64) {
    let Some(ref channel) = skill.channel else {
        return;
    };
    let boxed = attack_box(&state.player, skill.reach, skill.height_pad, None);
    let step = channel.pull * dt;
    let depth_reach = skill.depth_reach.unwrap_or(DEPTH_REACH_MELEE);
    let px = state.player.x;
    let pz = state.player.z;
    let count = state.enemies.len();
    for e_idx in 0..count {
        if state.enemies[e_idx].dead || state.enemies[e_idx].super_armor {
            continue;
        }
        if !in_reach_of(state.enemies[e_idx].z, pz, depth_reach) {
            continue;
        }
        let eb = body_box(
            state.enemies[e_idx].x,
            state.enemies[e_idx].y,
            state.enemies[e_idx].width,
            state.enemies[e_idx].height,
        );
        if !boxes_overlap(boxed, eb) {
            continue;
        }
        let ex = state.enemies[e_idx].x;
        let ez = state.enemies[e_idx].z;
        let ew = state.enemies[e_idx].width;
        let gap = px - ex;
        let distance = gap.abs() - channel.stop_at;
        if distance <= 0.0 {
            continue;
        }
        let dir = if gap < 0.0 { -1.0 } else { 1.0 };
        let pulled_x = ex + dir * distance.min(step);
        let clamped_x = stop_at_horizontal_prop(state, ex, ez, Some((ew, ew)), pulled_x);
        state.enemies[e_idx].x = clamped_x;
        state.enemies[e_idx].vx = 0.0;
    }
}

pub fn apply_skill_hit(
    state: &mut State,
    enemy_idx: usize,
    damage: f64,
    skill: &SkillSpec,
    hit_index: usize,
    source: Option<(f64, i32)>,
) {
    let mut opts = DamageEnemyOptions::default();
    let hits = skill.hits.unwrap_or(1).max(1);
    let last_hit = hit_index == hits - 1;

    if let Some(ref grab) = skill.grab {
        if hit_index == 0 {
            opts.grabbed = grab.hold;
            opts.ignore_super_armor = true;
        } else if last_hit {
            opts.knockdown = grab.slam_knockdown;
            opts.ignore_super_armor = true;
        }
    } else if skill.juggle && skill.launch != 0.0 {
        opts.launch = skill.launch;
        opts.juggle = true;
    } else if skill.knockdown > 0.0 && last_hit {
        let ok = match skill.knockdown_chance {
            None => true,
            Some(ch) => crate::next_random(state) < ch,
        };
        if ok {
            opts.knockdown = skill.knockdown;
        }
    }
    if skill.stun > 0.0 {
        opts.stun = skill.stun;
    }
    let was_airborne = !state.enemies[enemy_idx].on_ground;
    opts.hit_stop = skill_hit_stop(&skill.id, hit_index);
    if let Some((_, facing)) = source {
        opts.knockback_direction = Some(facing);
    }
    let src_x = source.map(|(x, _)| x).unwrap_or(state.player.x);
    let applied = damage_enemy(state, enemy_idx, damage, skill.knockback_x, src_x, &opts);
    if skill.drain > 0.0 && applied > 0 {
        let heal = ((damage * skill.drain) + 0.5).floor();
        heal_player(state, heal);
    }
    if !state.enemies[enemy_idx].dead && was_airborne {
        state.stats.air_hits += 1;
        state.player.air_hit_timer = 0.6;
    }
}

pub fn update_player(
    state: &mut State,
    input: &Input,
    dt: f64,
    previous_position: &mut [f64; 3],
) -> bool {
    if state.player.dead {
        return false;
    }
    let was_on_ground = state.player.on_ground;
    if input.attack
        && state.player.attack_timer > 0.0
        && state.player.skill_timer <= 0.0
        && state.player.hurt_timer <= 0.0
    {
        state.player.attack_buffer = PLAYER_ATTACK_BUFFER;
    } else if state.player.attack_buffer > 0.0 {
        state.player.attack_buffer = (state.player.attack_buffer - dt).max(0.0);
    }
    if state.player.jump_buffer > 0.0 {
        state.player.jump_buffer = (state.player.jump_buffer - dt).max(0.0);
    }

    let direction = i32::from(input.right) - i32::from(input.left);
    let was_hurt = state.player.hurt_timer > 0.0;
    let rooted = state.player.attack_timer > 0.0 || state.player.skill_timer > 0.0 || was_hurt;
    let active_spec = state
        .player
        .skill_id
        .as_deref()
        .and_then(|id| TABLES.skills.get(id));
    let dashing = state.player.skill_timer > 0.0 && active_spec.is_some_and(|s| s.dash > 0.0);
    let leaping = state.player.skill_timer > 0.0
        && active_spec.is_some_and(|s| s.leap > 0.0)
        && !state.player.on_ground;
    let diving_down = state.player.skill_timer > 0.0
        && active_spec.is_some_and(|s| s.dive > 0.0)
        && !state.player.on_ground;

    if direction != 0 && state.player.skill_timer <= 0.0 {
        state.player.facing = direction;
    }

    let depth_direction = i32::from(input.up) - i32::from(input.down);
    let carrying = rooted && !dashing && !leaping && !diving_down;
    if carrying {
        state.player.vx *= 0.25;
        state.player.vz *= 0.25;
    } else if !rooted {
        let move_scale = buff_scale(&state.player, "moveSpeed");
        state.player.vx = f64::from(direction) * PHYSICS_MOVE_SPEED * move_scale;
        state.player.vz = f64::from(depth_direction) * depth_speed() * move_scale;
    }

    if (input.jump || state.player.jump_buffer > 0.0) && state.player.on_ground && !rooted {
        state.player.vy = PHYSICS_JUMP_VELOCITY;
        state.player.on_ground = false;
        state.player.jump_buffer = 0.0;
        crate::push_sound(state, "playerJump", state.player.x, state.player.z);
    }

    if !state.player.on_ground {
        let leap_gravity = if leaping {
            active_spec
                .and_then(|s| s.leap_gravity)
                .unwrap_or(PHYSICS_GRAVITY)
        } else {
            PHYSICS_GRAVITY
        };
        state.player.vy = (state.player.vy + leap_gravity * dt).min(PHYSICS_MAX_FALL_SPEED);
        if state.player.skill_timer > 0.0 {
            if let Some(spec) = active_spec {
                if spec.dive > 0.0 {
                    state.player.vy = state.player.vy.max(spec.dive);
                    if state.player.vx == 0.0 {
                        state.player.vx = f64::from(state.player.facing) * spec.dive_forward;
                    }
                }
            }
        }
    }

    state.player.x += state.player.vx * dt;
    state.player.y += state.player.vy * dt;
    state.player.z += state.player.vz * dt;

    if state.player.y >= ARENA_GROUND_Y {
        state.player.y = ARENA_GROUND_Y;
        state.player.vy = 0.0;
        state.player.on_ground = true;
        if state.player.skill_timer > 0.0 && active_spec.is_some_and(|s| s.dive > 0.0) {
            state.player.vx = 0.0;
        }
        if !was_on_ground {
            crate::push_sound(state, "playerLand", state.player.x, state.player.z);
        }
    }

    let half_walk_width = state.player.walk_width / 2.0;
    let walk_left = room_left(state) + half_walk_width;
    let walk_right = room_right(state) - half_walk_width;
    state.player.x = state.player.x.clamp(walk_left, walk_right);
    let walk_depth = band_depth(state.band_back_y);
    state.player.z = state.player.z.clamp(0.0, walk_depth);
    if !rooted && state.player.on_ground {
        if (state.player.x == walk_left && state.player.vx < 0.0)
            || (state.player.x == walk_right && state.player.vx > 0.0)
        {
            state.player.vx = 0.0;
        }
        if (state.player.z == 0.0 && state.player.vz < 0.0)
            || (state.player.z == walk_depth && state.player.vz > 0.0)
        {
            state.player.vz = 0.0;
        }
    }

    {
        let mut px = state.player.x;
        let mut pz = state.player.z;
        let mut vx = state.player.vx;
        let mut vz = state.player.vz;
        let fp = (state.player.walk_width, state.player.walk_depth);
        block_props_coords(state, &mut px, &mut pz, &mut vx, &mut vz, Some(fp));
        state.player.x = px;
        state.player.z = pz;
        state.player.vx = vx;
        state.player.vz = vz;
    }

    let moving = state.player.vx.abs() > 1.0 || state.player.vz.abs() > 1.0;
    if state.player.on_ground && !rooted && moving {
        state.player.step_timer -= dt;
        if state.player.step_timer <= 0.0 {
            crate::push_sound(state, "playerStep", state.player.x, state.player.z);
            state.player.step_timer = 0.3;
        }
    } else {
        state.player.step_timer = 0.0;
    }

    state.player.attack_cooldown = (state.player.attack_cooldown - dt).max(0.0);
    state.player.invuln = (state.player.invuln - dt).max(0.0);
    state.player.solid_invuln = (state.player.solid_invuln - dt).max(0.0);
    state.player.hurt_timer = (state.player.hurt_timer - dt).max(0.0);
    state.player.combo_timer = (state.player.combo_timer - dt).max(0.0);
    state.player.air_hit_timer = (state.player.air_hit_timer - dt).max(0.0);
    for val in state.player.buffs.values_mut() {
        *val = (*val - dt).max(0.0);
    }
    state.player.buff_icon_timer = (state.player.buff_icon_timer - dt).max(0.0);
    update_stance_drain(state, dt);
    if state.player.dead {
        return false;
    }
    if state.player.combo_timer == 0.0 {
        state.player.combo_index = 0;
    }
    state.player.mp = (state.player.mp + state.player.mp_regen * dt).min(state.player.max_mp);

    let cooldown_scale = buff_scale(&state.player, "cooldownScale");
    for cd in state.player.skill_cooldowns.values_mut() {
        *cd = (*cd - dt * cooldown_scale).max(0.0);
    }
    for cd in &mut state.player.consumable_cooldowns {
        *cd = (*cd - dt).max(0.0);
    }
    if was_hurt {
        return false;
    }

    let attack_recovering = state.player.attack_timer > 0.0
        && state.player.attack_duration - state.player.attack_timer
            >= PLAYER_ATTACK_ACTIVE_TO * state.player.attack_duration;
    let can_cast_window =
        state.player.skill_timer <= 0.0 && (state.player.attack_timer <= 0.0 || attack_recovering);

    let silver_fall_spec = TABLES.skills.get("silverFall");
    let wants_air_dive = input.skill_pressed("upSlash")
        && !state.player.on_ground
        && can_cast_window
        && state
            .player
            .skill_cooldowns
            .get("silverFall")
            .copied()
            .unwrap_or(0.0)
            <= 0.0
        && silver_fall_spec.is_some_and(|s| state.player.mp >= s.mp);

    let sword_up = state.player.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0;
    let sword_due = !sword_up && state.player.hellbenter_tier > 0;
    let hellbenter_move = if sword_up || sword_due {
        "hellbenterSlam"
    } else {
        "hellbenter"
    };
    let wants_hellbenter = (input.skill_pressed("hellbenter") || sword_due)
        && can_cast_window
        && state
            .player
            .skill_cooldowns
            .get(hellbenter_move)
            .copied()
            .unwrap_or(0.0)
            <= 0.0
        && TABLES
            .skills
            .get(hellbenter_move)
            .is_some_and(|s| state.player.mp >= s.mp);

    let cast_skill: Option<String> = if wants_air_dive {
        Some("silverFall".to_string())
    } else if wants_hellbenter {
        Some(hellbenter_move.to_string())
    } else if can_cast_window {
        TABLES
            .skill_order
            .iter()
            .find(|sid| {
                let Some(spec) = TABLES.skills.get(*sid) else {
                    return false;
                };
                input.skill_pressed(sid)
                    && (!spec.ground_only || state.player.on_ground)
                    && state
                        .player
                        .skill_cooldowns
                        .get(*sid)
                        .copied()
                        .unwrap_or(0.0)
                        <= 0.0
                    && state.player.mp >= spec.mp
            })
            .cloned()
    } else {
        None
    };

    if let Some(ref sid) = cast_skill {
        if let Some(skill_spec) = TABLES.skills.get(sid) {
            let stance_coming_down = skill_spec.buff.as_ref().is_some_and(|b| {
                b.toggle && state.player.buffs.get(&b.id).copied().unwrap_or(0.0) > 0.0
            });
            if !stance_coming_down {
                state.player.mp -= skill_spec.mp;
            }
            state.player.skill_id = Some(sid.clone());
            state.skill_buffer = None;
            crate::push_skill_sound(state, sid, state.player.x, state.player.z);
            if skill_spec.buff.is_none() {
                state.swing_seq += 1;
                state.stats.swings += 1;
            }
            state.player.cast_origin_x = Some(state.player.x);
            state.player.skill_timer = skill_spec.duration;
            state.player.skill_hit_done = false;
            state.player.field_spawned = false;
            state.player.skill_hits_done = 0;
            state.player.channel_released_at = None;
            state.player.channel_tick_at = skill_spec
                .channel
                .as_ref()
                .map(|c| c.entrance)
                .unwrap_or(0.0);
            state
                .player
                .skill_cooldowns
                .insert(sid.clone(), skill_spec.cooldown);
            if skill_spec.invuln > 0.0 {
                state.player.invuln = state.player.invuln.max(skill_spec.invuln);
                state.player.solid_invuln = state.player.solid_invuln.max(skill_spec.invuln);
            }
            state.player.attack_timer = 0.0;
            state.player.attack_hit_done = false;
            state.player.combo_timer = 0.0;
            state.player.combo_index = 0;
            state.player.attack_buffer = 0.0;
            state.player.jump_buffer = 0.0;
            state.player.leap_done = false;
            if skill_spec.dive > 0.0 && !state.player.on_ground {
                state.player.vy = state.player.vy.max(skill_spec.dive);
                if skill_spec.dive_forward != 0.0 {
                    state.player.vx = f64::from(state.player.facing) * skill_spec.dive_forward;
                }
            }
        }
    } else if (input.attack || state.player.attack_buffer > 0.0)
        && state.player.attack_timer <= 0.0
        && state.player.skill_timer <= 0.0
        && (state.player.attack_cooldown <= 0.0 || state.player.combo_timer > 0.0)
    {
        let next_stage = if state.player.combo_timer > 0.0 {
            (state.player.combo_index + 1) % PLAYER_MAX_COMBO
        } else {
            0
        };
        let dur = swing_duration(&state.player);
        let spd = attack_speed_of(&state.player);
        state.player.attack_duration = dur;
        state.player.attack_timer = dur;
        state.swing_seq += 1;
        state.stats.swings += 1;
        state.player.attack_cycle = dur + PLAYER_ATTACK_COOLDOWN / spd;
        state.player.attack_cooldown = state.player.attack_cycle;
        state.player.combo_index = next_stage;
        state.player.combo_timer = PLAYER_COMBO_WINDOW / spd;
        state.player.attack_hit_done = false;
        state.player.attack_buffer = 0.0;
        crate::push_attack_sound(state, next_stage, state.player.x, state.player.z);
    }

    if state.player.attack_timer > 0.0 {
        let elapsed = state.player.attack_duration - state.player.attack_timer;
        if !state.player.attack_hit_done
            && elapsed >= PLAYER_ATTACK_ACTIVE_FROM * state.player.attack_duration
            && elapsed <= PLAYER_ATTACK_ACTIVE_TO * state.player.attack_duration
        {
            state.player.attack_hit_done = true;
            let boxed = attack_box(
                &state.player,
                PLAYER_ATTACK_REACH,
                PLAYER_ATTACK_HEIGHT_PAD,
                None,
            );
            swing_props(state, boxed, None, None, None);
            let stage = state.player.combo_index;
            let base_dmg = ATTACK_STAGE_DAMAGES.get(stage).copied().unwrap_or(8.0);
            let damage = ((base_dmg + state.player.attack_bonus)
                * buff_scale(&state.player, "attackPower")
                + 0.5)
                .floor();
            let pz = state.player.z;
            let px = state.player.x;
            let enemy_count = state.enemies.len();
            for e_idx in 0..enemy_count {
                if state.enemies[e_idx].dead {
                    continue;
                }
                if !in_reach_of(state.enemies[e_idx].z, pz, DEPTH_REACH_MELEE) {
                    continue;
                }
                let eb = body_box(
                    state.enemies[e_idx].x,
                    state.enemies[e_idx].y,
                    state.enemies[e_idx].width,
                    state.enemies[e_idx].height,
                );
                if boxes_overlap(boxed, eb) {
                    let was_airborne = !state.enemies[e_idx].on_ground;
                    let opts = DamageEnemyOptions {
                        juggle: true,
                        knockdown: if stage == 2 { 0.6 } else { 0.0 },
                        hit_stop: HIT_STOP_STAGE.get(stage).copied().unwrap_or(0.05),
                        ..Default::default()
                    };
                    let kb = if stage == 2 { 220.0 } else { 140.0 };
                    damage_enemy(state, e_idx, damage, kb, px, &opts);
                    if !state.enemies[e_idx].dead && was_airborne {
                        state.stats.air_hits += 1;
                        state.player.air_hit_timer = 0.6;
                    }
                }
            }
        }
        state.player.attack_timer = (state.player.attack_timer - dt).max(0.0);
    }

    if state.player.skill_timer > 0.0 {
        if let Some(active_id) = state.player.skill_id.clone() {
            if let Some(active) = TABLES.skills.get(&active_id) {
                let skill_elapsed = active.duration - state.player.skill_timer;
                let hit_count = active.hits.unwrap_or(1).max(1);

                if active.leap > 0.0
                    && !state.player.leap_done
                    && state.player.on_ground
                    && skill_elapsed >= active.duration * active.leap_from.unwrap_or(0.0)
                {
                    state.player.leap_done = true;
                    state.player.vx = f64::from(state.player.facing) * active.leap;
                    state.player.vy = state.player.vy.min(active.leap_up.unwrap_or(-160.0));
                    state.player.on_ground = false;
                    let linv = active.leap_invuln.unwrap_or(0.3);
                    state.player.invuln = state.player.invuln.max(linv);
                    state.player.solid_invuln = state.player.solid_invuln.max(linv);
                }

                if let Some(ref field) = active.field {
                    if let Some(at) = field.at {
                        if !state.player.field_spawned && skill_elapsed >= at {
                            state.player.field_spawned = true;
                            spawn_field(state, &active.id, 1.0);
                        }
                    }
                }

                if active.id == "hellbenterSlam"
                    && state.player.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0
                    && skill_elapsed >= active.active_from
                {
                    state.player.buffs.insert("hellbenter".to_string(), 0.0);
                }

                if active.advance != 0.0 {
                    let origin = state.player.cast_origin_x.unwrap_or(state.player.x);
                    let target_x = (origin
                        + f64::from(state.player.facing) * advance_ahead(active, skill_elapsed))
                    .clamp(walk_left, walk_right);
                    let fp = (state.player.walk_width, state.player.walk_depth);
                    state.player.x = stop_at_horizontal_prop(
                        state,
                        state.player.x,
                        state.player.z,
                        Some(fp),
                        target_x,
                    );
                }

                if let Some(ref channel) = active.channel {
                    if state.player.channel_released_at.is_none() {
                        let cap = channel.entrance + channel.hold;
                        if skill_elapsed >= channel.entrance
                            && (!input.skill_pressed(&active.id) || skill_elapsed >= cap)
                        {
                            state.player.channel_released_at = Some(skill_elapsed);
                            state.player.skill_timer = channel.tail;
                        } else if skill_elapsed >= channel.entrance {
                            channel_pull(state, active, dt);
                            let hold_end = skill_elapsed.min(cap);
                            while state.player.channel_tick_at <= hold_end {
                                channel_tick(state, active);
                                state.player.channel_tick_at += channel.tick;
                            }
                        }
                    }
                }

                while state.player.skill_hits_done < hit_count
                    && skill_elapsed
                        >= hit_time(active, state.player.skill_hits_done, &state.player)
                {
                    let hit_index = state.player.skill_hits_done;
                    state.player.skill_hits_done += 1;
                    state.player.skill_hit_done = state.player.skill_hits_done >= hit_count;

                    let skill_box =
                        attack_box(&state.player, active.reach, active.height_pad, None);
                    let is_shot_hit = active.shot.as_ref().is_some_and(|s| s.hit == hit_index);
                    if !is_shot_hit {
                        swing_props(state, skill_box, active.depth_reach, None, None);
                    }

                    if let Some(ref buff) = active.buff {
                        let already_up =
                            state.player.buffs.get(&buff.id).copied().unwrap_or(0.0) > 0.0;
                        if buff.toggle && already_up {
                            state.player.buffs.insert(buff.id.clone(), 0.0);
                            push_banner(state, &format!("{} 解除", active.name), 1.1);
                        } else {
                            if let Some(ref open) = buff.open {
                                if open.hp_ratio > 0.0 {
                                    let amt = state.player.max_hp * open.hp_ratio;
                                    crate::combat::spend_player_hp(state, amt);
                                }
                            }
                            state
                                .player
                                .buffs
                                .insert(buff.id.clone(), buff.duration.unwrap_or(f64::INFINITY));
                            if let Some(tier) = buff.sword_tier {
                                state.player.hellbenter_tier = tier;
                                state.player.hellbenter_charge = 0;
                            }
                            if let Some(ref drain) = buff.drain {
                                if drain.interval > 0.0 {
                                    state.player.stance_drain_timer = drain.interval;
                                }
                            }
                            if let Some(ci) = active.cast_icon {
                                state.player.buff_icon_timer = ci;
                                state.player.buff_icon_id = Some(active.id.clone());
                            }
                            if buff.toggle {
                                push_banner(state, &active.name, 1.1);
                            }
                        }
                        if let Some(ref gather) = buff.gather {
                            let mut eff = Effect::new("rageGather", gather.delay + gather.life);
                            eff.delay = gather.delay;
                            state.effects.push(eff);
                        }
                    }

                    let skill_damage = ((active.damage
                        + f64::from(state.player.level - 1) * active.growth
                        + state.player.attack_bonus)
                        * state.player.skill_power
                        * buff_scale(&state.player, "attackPower")
                        + 0.5)
                        .floor();

                    let mut struck_ids = Vec::new();
                    if is_shot_hit {
                        spawn_shot(state, &active.id, skill_damage, hit_index);
                    } else {
                        let pz = state.player.z;
                        let px = state.player.x;
                        let depth_reach = active.depth_reach.unwrap_or(DEPTH_REACH_MELEE);
                        let e_len = state.enemies.len();
                        for e_idx in 0..e_len {
                            if state.enemies[e_idx].dead {
                                continue;
                            }
                            let hit = if active.radius > 0.0 {
                                floor_distance(
                                    state.enemies[e_idx].x,
                                    state.enemies[e_idx].z,
                                    px,
                                    pz,
                                ) <= active.radius
                            } else {
                                let eb = body_box(
                                    state.enemies[e_idx].x,
                                    state.enemies[e_idx].y,
                                    state.enemies[e_idx].width,
                                    state.enemies[e_idx].height,
                                );
                                in_reach_of(state.enemies[e_idx].z, pz, depth_reach)
                                    && boxes_overlap(skill_box, eb)
                            };
                            if hit {
                                struck_ids.push(state.enemies[e_idx].id);
                                apply_skill_hit(
                                    state,
                                    e_idx,
                                    skill_damage,
                                    active,
                                    hit_index,
                                    None,
                                );
                            }
                        }
                    }

                    let wave_hit = active.shockwave_hit.unwrap_or(hit_count - 1);
                    if let Some(ref wave) = active.shockwave {
                        if hit_index == wave_hit {
                            let extra_wave = wave
                                .extra_wave_from_level
                                .filter(|&lvl| state.player.level >= lvl)
                                .map(|_| 1.0)
                                .unwrap_or(0.0);
                            let wave_box = attack_box(
                                &state.player,
                                wave.reach + extra_wave * 80.0,
                                wave.height_pad + extra_wave * 6.0,
                                None,
                            );
                            swing_props(state, wave_box, active.depth_reach, None, None);
                            let wave_damage = ((wave.damage
                                + f64::from(state.player.level - 1) * wave.growth
                                + state.player.attack_bonus)
                                * state.player.skill_power
                                + 0.5)
                                .floor();
                            let depth_reach = active.depth_reach.unwrap_or(DEPTH_REACH_MELEE);
                            let pz = state.player.z;
                            let px = state.player.x;
                            let e_len = state.enemies.len();
                            for e_idx in 0..e_len {
                                if state.enemies[e_idx].dead
                                    || struck_ids.contains(&state.enemies[e_idx].id)
                                {
                                    continue;
                                }
                                let eb = body_box(
                                    state.enemies[e_idx].x,
                                    state.enemies[e_idx].y,
                                    state.enemies[e_idx].width,
                                    state.enemies[e_idx].height,
                                );
                                if in_reach_of(state.enemies[e_idx].z, pz, depth_reach)
                                    && boxes_overlap(wave_box, eb)
                                {
                                    let opts = DamageEnemyOptions {
                                        knockdown: wave.knockdown,
                                        launch: wave.launch,
                                        juggle: wave.launch != 0.0,
                                        hit_stop: skill_hit_stop(&active.id, wave_hit),
                                        ..Default::default()
                                    };
                                    damage_enemy(
                                        state,
                                        e_idx,
                                        wave_damage,
                                        wave.knockback_x,
                                        px,
                                        &opts,
                                    );
                                }
                            }
                            let mut eff = Effect::new("shockwave", 0.4);
                            eff.arc = wave.arc.unwrap_or(true);
                            eff.x = state.player.x
                                + f64::from(state.player.facing)
                                    * wave.reach
                                    * wave.arc_offset.unwrap_or(0.4);
                            eff.y = ARENA_GROUND_Y;
                            eff.z = state.player.z;
                            eff.radius =
                                (wave.reach + extra_wave * 80.0) * 0.8 * wave.visual.unwrap_or(1.0);
                            state.effects.push(eff);
                        }
                    }

                    if active.dash > 0.0 && hit_index == 0 {
                        state.player.vx = f64::from(state.player.facing) * active.dash;
                        let inv = if active.invuln > 0.0 {
                            active.invuln
                        } else {
                            0.3
                        };
                        state.player.invuln = state.player.invuln.max(inv);
                    }
                    if active.invuln > 0.0 && hit_index == 0 {
                        state.player.invuln = state.player.invuln.max(active.invuln);
                    }
                    if active.id == "bloodSword" {
                        let mut eff = Effect::new("ghost", 0.35);
                        eff.x = state.player.x
                            + f64::from(state.player.facing)
                                * active.reach
                                * (0.4 + hit_index as f64 * 0.2);
                        eff.y = state.player.y - state.player.height * 0.55;
                        eff.radius = active.reach * 0.55;
                        state.effects.push(eff);
                    }
                }

                state.player.skill_timer = (state.player.skill_timer - dt).max(0.0);
                if state.player.skill_timer == 0.0 {
                    if active.advance != 0.0 {
                        if let Some(origin) = state.player.cast_origin_x {
                            state.player.x = origin;
                            previous_position[0] = state.player.x;
                        }
                    }
                    if !state.player.field_spawned {
                        spawn_field(state, &active.id, 1.0);
                    }
                    if active.id == "hellbenterSlam" {
                        state.player.hellbenter_tier = 0;
                        state.player.hellbenter_charge = 0;
                        state.player.buffs.insert("hellbenter".to_string(), 0.0);
                    }
                    state.player.skill_id = None;
                }
            }
        }
    }

    !rooted
}
