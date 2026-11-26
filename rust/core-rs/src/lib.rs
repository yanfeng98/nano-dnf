//! Deterministic 2D action dungeon crawler simulation core (`src/core.js`).

pub mod combat;
pub mod constants;
pub mod dungeon;
pub mod enemy;
pub mod player;
pub mod pvf_truth;
pub mod tables;
pub mod types;

pub use constants::*;
pub use dungeon::{
    begin_room, current_cell, current_spec, door_at, door_neighbour, door_x, dungeon_for,
    enter_cell, exit_mode, gate_art_rect, go_to_cell, room_left, room_right, room_width,
    route_step, ExitMode, MINIMAP_DIRS,
};
pub use tables::TABLES;
pub use types::*;

use combat::{
    advance_player_level, award_clear_experience, rating_of, update_breakables, update_deaths,
    update_field_ticks, update_pickups, update_shots, update_target,
};
use enemy::{resolve_room, update_enemies, update_waves};
use player::update_player;

pub fn next_random(state: &mut State) -> f64 {
    state.rng_state = state.rng_state.wrapping_add(0x6d2b_79f5);
    let mut t = state.rng_state;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    f64::from(t ^ (t >> 14)) / 4_294_967_296.0
}

pub fn hash32(a: u32, b: u32) -> u32 {
    let mut h = a ^ b.wrapping_mul(0x9e37_79b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35);
    h ^ (h >> 16)
}

pub fn push_log(state: &mut State, text: &str, tone: &str) {
    state.log.push(LogEntry {
        text: text.to_string(),
        tone: tone.to_string(),
    });
    while state.log.len() > LOG_LINES {
        state.log.remove(0);
    }
}

pub fn push_sound(state: &mut State, kind: &str, x: f64, z: f64) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: kind.to_string(),
        x,
        z,
        t: state.time,
        enemy_type: None,
        attack_kind: None,
        skill_id: None,
        stage: None,
        native_object: None,
        enemy_id: None,
    });
}

pub fn push_enemy_sound(state: &mut State, kind: &str, enemy_type: &str, id: u32, x: f64, z: f64) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: kind.to_string(),
        x,
        z,
        t: state.time,
        enemy_type: Some(enemy_type.to_string()),
        attack_kind: None,
        skill_id: None,
        stage: None,
        native_object: None,
        enemy_id: Some(id),
    });
}

pub fn push_enemy_attack_sound(
    state: &mut State,
    enemy_type: &str,
    attack_kind: &str,
    id: u32,
    x: f64,
    z: f64,
) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: "enemyAttack".to_string(),
        x,
        z,
        t: state.time,
        enemy_type: Some(enemy_type.to_string()),
        attack_kind: Some(attack_kind.to_string()),
        skill_id: None,
        stage: None,
        native_object: None,
        enemy_id: Some(id),
    });
}

pub fn push_skill_sound(state: &mut State, skill_id: &str, x: f64, z: f64) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: "playerSkill".to_string(),
        x,
        z,
        t: state.time,
        enemy_type: None,
        attack_kind: None,
        skill_id: Some(skill_id.to_string()),
        stage: None,
        native_object: None,
        enemy_id: None,
    });
}

pub fn push_attack_sound(state: &mut State, stage: usize, x: f64, z: f64) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: "playerAttack".to_string(),
        x,
        z,
        t: state.time,
        enemy_type: None,
        attack_kind: None,
        skill_id: None,
        stage: Some(stage),
        native_object: None,
        enemy_id: None,
    });
}

pub fn push_projectile_sound(
    state: &mut State,
    kind: &str,
    native_object: Option<u32>,
    x: f64,
    z: f64,
) {
    if state.sounds.len() >= 64 {
        state.sounds.remove(0);
    }
    state.sounds.push(SoundEvent {
        kind: kind.to_string(),
        x,
        z,
        t: state.time,
        enemy_type: None,
        attack_kind: None,
        skill_id: None,
        stage: None,
        native_object,
        enemy_id: None,
    });
}

pub fn drain_sounds(state: &mut State) -> Vec<SoundEvent> {
    std::mem::take(&mut state.sounds)
}

pub fn create_player(x: f64) -> Player {
    let mut skill_cooldowns = indexmap::IndexMap::new();
    let mut skill_ranks = indexmap::IndexMap::new();
    for id in &TABLES.castable_skills {
        skill_cooldowns.insert(id.clone(), 0.0);
        skill_ranks.insert(id.clone(), 1);
    }
    Player {
        x,
        y: ARENA_GROUND_Y,
        z: 0.0,
        vx: 0.0,
        vy: 0.0,
        vz: 0.0,
        width: PLAYER_WIDTH,
        walk_width: PLAYER_WALK_WIDTH,
        walk_depth: PLAYER_WALK_DEPTH,
        height: PLAYER_HEIGHT,
        facing: 1,
        on_ground: true,
        hp: PLAYER_MAX_HP,
        max_hp: PLAYER_MAX_HP,
        mp: PLAYER_MAX_MP,
        max_mp: PLAYER_MAX_MP,
        level: 1,
        xp: 0,
        xp_to_next: PROG_BASE_XP_TO_NEXT,
        attack_bonus: 0.0,
        mp_regen: PLAYER_MP_REGEN_PER_SECOND,
        skill_power: 1.0,
        attack_speed: PLAYER_ATTACK_SPEED,
        attack_timer: 0.0,
        attack_duration: PLAYER_ATTACK_DURATION,
        attack_cycle: PLAYER_ATTACK_DURATION + PLAYER_ATTACK_COOLDOWN,
        attack_cooldown: 0.0,
        step_timer: 0.0,
        attack_hit_done: false,
        combo_index: 0,
        combo_timer: 0.0,
        attack_buffer: 0.0,
        jump_buffer: 0.0,
        skill_id: None,
        skill_timer: 0.0,
        skill_hit_done: false,
        skill_hits_done: 0,
        cast_origin_x: None,
        field_spawned: false,
        leap_done: false,
        channel_released_at: None,
        channel_tick_at: 0.0,
        air_hit_timer: 0.0,
        buffs: indexmap::IndexMap::new(),
        hellbenter_tier: 0,
        hellbenter_charge: 0,
        stance_drain_timer: 0.0,
        buff_icon_timer: 0.0,
        buff_icon_id: None,
        skill_cooldowns,
        consumable_cooldowns: [0.0; 6],
        skill_ranks,
        invuln: 0.0,
        solid_invuln: 0.0,
        hurt_timer: 0.0,
        freeze_timer: 0.0,
        dead: false,
        name: None,
    }
}

pub fn create_state(options: &CreateStateOptions<'_>) -> State {
    let seed = options.seed.unwrap_or(DEFAULT_SEED);
    let stage_id = options
        .stage
        .filter(|s| TABLES.stages.contains_key(*s))
        .unwrap_or(DEFAULT_STAGE)
        .to_string();
    // INFALLIBLE: stage_id was just verified to exist in TABLES.stages (or DEFAULT_STAGE)
    let stage = TABLES
        .stages
        .get(&stage_id)
        .expect("INFALLIBLE: resolved stage exists");
    let dungeon = dungeon_for(stage, seed);
    let mut cell = dungeon.as_ref().map(|d| d.entry).unwrap_or(0);
    if let (Some(ref d), Some(c)) = (&dungeon, options.cell) {
        if !d.cells.is_empty() {
            cell = c.min(d.cells.len() - 1);
        }
    }
    let mut player = create_player(options.start_x.unwrap_or(110.0));
    let mut reference_profile = None;
    if options.reference_profile {
        if let Some((lvl, xp, next_xp, cbase, crat, cchan)) = match stage_id.as_str() {
            "mirkwood" => Some((3, 1776, 2098, 1760, 528, 88)),
            "mirkwooddeep" => Some((6, 1103, 7726, 4680, 1404, 234)),
            _ => None,
        } {
            player.name = Some("阿努纳奇".to_string());
            player.skill_ranks.clear();
            match stage_id.as_str() {
                "mirkwood" => {
                    player.skill_ranks.insert("ghostSlash".to_string(), 2);
                    player.skill_ranks.insert("upSlash".to_string(), 1);
                }
                "mirkwooddeep" => {
                    player.skill_ranks.insert("ghostSlash".to_string(), 3);
                    player.skill_ranks.insert("upSlash".to_string(), 1);
                    player.skill_ranks.insert("normalWave".to_string(), 1);
                }
                _ => {}
            }
            while player.level < lvl {
                advance_player_level(&mut player, &stage_id, false);
            }
            player.xp = xp;
            player.xp_to_next = next_xp;
            player.hp = player.max_hp;
            player.mp = player.max_mp;
            reference_profile = Some(ReferenceProfile {
                level: lvl,
                xp,
                clear_base: cbase,
                clear_rating: crat,
                clear_channel: cchan,
            });
        }
    }

    let mut state = State {
        seed,
        stage_id,
        rng_state: seed,
        time: 0.0,
        hit_stop: 0.0,
        skill_buffer: None,
        dungeon,
        cell,
        entry_door: None,
        room: None,
        band_back_y: BAND_DEFAULT_BACK_Y,
        band_visual_back_y: None,
        camera_x: 0.0,
        camera_y: 0.0,
        shake_amp: 0.0,
        shake_timer: 0.0,
        shake_duration: 0.0,
        target: None,
        player,
        enemies: Vec::new(),
        props: Vec::new(),
        projectiles: Vec::new(),
        pickups: Vec::new(),
        effects: Vec::new(),
        sounds: Vec::new(),
        fields: Vec::new(),
        shots: Vec::new(),
        next_enemy_id: 1,
        next_projectile_id: 1,
        stats: Stats {
            last_landed_swing: -1,
            last_hit_at: -99.0,
            ..Default::default()
        },
        log: Vec::new(),
        swing_seq: 0,
        boss_engaged: None,
        intro_t: None,
        title_t: 0.0,
        finished_at: None,
        result_rating: None,
        transition: TRANSITION_DUR,
        victory: false,
        post_clear: false,
        victory_delay: None,
        defeat: false,
        xp_gauge_flash_until: 0.0,
        reference_profile,
        clear_experience: false,
    };
    begin_room(&mut state, None);
    state.transition = TRANSITION_DUR;
    state
}

/// Trigger a purely visual camera screen-shake impulse without modifying
/// logical world coordinates (`camera_x`/`camera_y`) or gameplay RNG.
/// Stronger impulses override weaker ones; weaker impulses never downgrade an
/// active stronger shake.
pub fn trigger_screen_shake(state: &mut State, amplitude: f64, duration: f64) {
    if amplitude <= 0.0 || duration <= 0.0 {
        return;
    }
    let current = if state.shake_timer > 0.0 && state.shake_duration > 0.0 {
        state.shake_amp * (state.shake_timer / state.shake_duration).clamp(0.0, 1.0)
    } else {
        0.0
    };
    if amplitude >= current {
        state.shake_amp = amplitude;
        state.shake_timer = duration;
        state.shake_duration = duration;
    }
}

fn decay_screen_shake(state: &mut State, dt: f64) {
    if state.shake_timer > 0.0 {
        state.shake_timer = (state.shake_timer - dt).max(0.0);
        if state.shake_timer <= 1e-6 {
            state.shake_timer = 0.0;
            state.shake_amp = 0.0;
            state.shake_duration = 0.0;
        }
    }
}

pub fn begin_intro(state: &mut State) {
    state.intro_t = Some(0.0);
    state.title_t = 0.0;
}

pub fn update_camera(state: &mut State) {
    let win = window_width();
    let room = room_width(state);
    state.camera_y = 0.0;
    if room <= win {
        state.camera_x = (room - win) / 2.0;
        return;
    }
    let half = (VIEW_WIDTH * CAMERA_DEADZONE_SHARE) / 2.0 / CAMERA_ZOOM;
    let centre = state.camera_x + win / 2.0;
    let offset = state.player.x - centre;
    if offset > half {
        state.camera_x = state.player.x - half - win / 2.0;
    } else if offset < -half {
        state.camera_x = state.player.x + half - win / 2.0;
    }
    state.camera_x = state.camera_x.clamp(0.0, room - win);
}

pub fn step(state: &mut State, input: &Input, dt_override: Option<f64>) {
    let dt = dt_override.filter(|&d| d > 0.0).unwrap_or(DT);
    let mut input = *input;

    if let Some(ref mut intro_t) = state.intro_t {
        *intro_t += dt;
        if *intro_t >= intro_length() {
            state.intro_t = None;
            state.transition = TRANSITION_DUR;
            state.title_t = INTRO_TITLE;
        }
        return;
    }

    if state.hit_stop > 0.0 {
        if !state.player.dead {
            if input.attack {
                state.player.attack_buffer = PLAYER_ATTACK_BUFFER;
            }
            if input.jump {
                state.player.jump_buffer = PLAYER_JUMP_BUFFER;
            }
            for sid in &TABLES.skill_order {
                if input.skill_pressed(sid) {
                    state.skill_buffer = Some(SkillBuffer {
                        id: sid.clone(),
                        ttl: SKILL_BUFFER_TTL,
                    });
                }
            }
            if input.skill_pressed("hellbenter") {
                state.skill_buffer = Some(SkillBuffer {
                    id: "hellbenter".to_string(),
                    ttl: SKILL_BUFFER_TTL,
                });
            }
            if let Some(ref mut sb) = state.skill_buffer {
                sb.ttl -= dt;
                if sb.ttl <= 0.0 {
                    state.skill_buffer = None;
                }
            }
        }
        state.time += dt;
        decay_screen_shake(state, dt);
        state.hit_stop -= dt;
        if state.hit_stop < 1e-6 {
            state.hit_stop = 0.0;
        }
        update_target(state, dt);
        return;
    }

    if let Some(ref mut sb) = state.skill_buffer {
        if sb.ttl <= 0.0 {
            state.skill_buffer = None;
        } else {
            if !input.skill_pressed(&sb.id) {
                input.set_skill(&sb.id, true);
            }
            sb.ttl -= dt;
        }
    }

    state.time += dt;
    decay_screen_shake(state, dt);
    if state.title_t > 0.0 {
        state.title_t = (state.title_t - dt).max(0.0);
    }
    if let Some(ref mut vd) = state.victory_delay {
        *vd -= dt;
        if *vd <= 0.0 {
            state.victory_delay = None;
            state.victory = true;
            state.projectiles.clear();
        }
    }
    if state.finished_at.is_none() && (state.victory || state.defeat) {
        state.finished_at = Some(state.time);
        state.result_rating = Some(rating_of(state));
        if state.victory && !state.defeat {
            award_clear_experience(state);
            push_sound(state, "resultRank", state.player.x, state.player.z);
        }
    }

    for ef in &mut state.effects {
        ef.life -= dt;
        if ef.kind == "bomb_piece" {
            ef.x += ef.vx * dt;
            ef.y += ef.vy * dt;
        } else if ef.kind == "pillar_debris" || ef.kind == "stone_debris" {
            let g = ef.gravity;
            if ef.kind == "stone_debris" && ef.y >= ARENA_GROUND_Y {
                ef.y = ARENA_GROUND_Y;
                ef.vx = 0.0;
                ef.vy = 0.0;
            } else {
                ef.x += ef.vx * dt;
                ef.y += ef.vy * dt + 0.5 * g * dt * dt;
                ef.vy += g * dt;
                if ef.kind == "stone_debris" && ef.y >= ARENA_GROUND_Y {
                    ef.y = ARENA_GROUND_Y;
                    ef.vx = 0.0;
                    ef.vy = 0.0;
                }
            }
        }
    }
    state.effects.retain(|ef| {
        if ef.kind == "pillar_debris" && ef.y >= ARENA_GROUND_Y {
            return false;
        }
        ef.life > 0.0
    });

    let mut fields = std::mem::take(&mut state.fields);
    for f in &mut fields {
        f.clock += dt;
    }
    let mut fields_for_ticks = fields.clone();
    fields.retain(|f| f.clock < f.life);
    state.fields = fields;

    if state.transition > 0.0 {
        state.transition = (state.transition - dt).max(0.0);
    }
    update_deaths(state, dt);

    if state.defeat || (state.victory && !state.post_clear) {
        update_target(state, dt);
        return;
    }

    let mut prev_pos = [state.player.x, state.player.y, state.player.z];
    let could_steer = update_player(state, &input, dt, &mut prev_pos);
    update_field_ticks(state, &mut fields_for_ticks);
    // Sync tick_at / ticks back to surviving fields
    for (idx, f) in state.fields.iter_mut().enumerate() {
        if let Some(tf) = fields_for_ticks.get(idx) {
            if tf.skill_id == f.skill_id && (tf.x - f.x).abs() < 1e-6 {
                f.tick_at = tf.tick_at;
                f.ticks = tf.ticks;
            }
        }
    }
    update_shots(state, dt);
    if !state.post_clear {
        update_enemies(state, dt, Some(prev_pos));
        update_waves(state);
        combat::update_bunkers(state, dt);
    }
    update_target(state, dt);
    update_breakables(state, dt);
    update_pickups(state, dt);
    if !state.post_clear && !state.defeat {
        resolve_room(state, &input, could_steer);
    }
    update_camera(state);
    if state.finished_at.is_none() && (state.victory || state.defeat) {
        state.finished_at = Some(state.time);
        state.result_rating = Some(rating_of(state));
    }
}

pub fn resume_after_clear(state: &mut State) -> bool {
    if !state.victory || state.defeat {
        return false;
    }
    state.post_clear = true;
    true
}

pub fn run_frames<F: FnMut(usize, &State) -> Input>(
    state: &mut State,
    frames: usize,
    mut input_for_frame: F,
) {
    for frame in 0..frames {
        let input = input_for_frame(frame, state);
        step(state, &input, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_state_and_step() {
        let mut s = create_state(&CreateStateOptions::default());
        assert_eq!(s.stage_id, "mirkwood");
        assert!(!s.enemies.is_empty());
        let x0 = s.player.x;
        let inp = Input {
            right: true,
            ..Default::default()
        };
        run_frames(&mut s, 30, |_, _| inp);
        assert!(s.player.x > x0);
    }

    #[test]
    fn test_combo_and_jump() {
        let mut s = create_state(&CreateStateOptions::default());
        step(
            &mut s,
            &Input {
                jump: true,
                ..Default::default()
            },
            None,
        );
        assert!(!s.player.on_ground);
        assert!(s.player.vy < 0.0);
        run_frames(&mut s, 60, |_, _| Input::default());
        assert!(s.player.on_ground);

        step(
            &mut s,
            &Input {
                attack: true,
                ..Default::default()
            },
            None,
        );
        assert!(s.player.attack_timer > 0.0);
        assert_eq!(s.player.combo_index, 0);
    }

    #[test]
    fn test_mirkwooddeep_dungeon_layout() {
        let s = create_state(&CreateStateOptions {
            stage: Some("mirkwooddeep"),
            ..Default::default()
        });
        let dun = s.dungeon.as_ref().expect("dungeon");
        assert_eq!(dun.cols, 5);
        assert_eq!(dun.rows, 4);
        assert_eq!(dun.cells.len(), 18);
    }

    #[test]
    fn test_reference_profile_skill_ranks() {
        let mirk = create_state(&CreateStateOptions {
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        assert_eq!(mirk.player.skill_ranks.get("ghostSlash").copied(), Some(2));
        assert_eq!(mirk.player.skill_ranks.get("upSlash").copied(), Some(1));

        let deep = create_state(&CreateStateOptions {
            stage: Some("mirkwooddeep"),
            reference_profile: true,
            ..Default::default()
        });
        assert_eq!(deep.player.skill_ranks.get("ghostSlash").copied(), Some(3));
        assert_eq!(deep.player.skill_ranks.get("upSlash").copied(), Some(1));
        assert_eq!(deep.player.skill_ranks.get("normalWave").copied(), Some(1));

        let standard = create_state(&CreateStateOptions::default());
        assert_eq!(
            standard.player.skill_ranks.get("ghostSlash").copied(),
            Some(1)
        );
        assert_eq!(standard.player.skill_ranks.get("upSlash").copied(), Some(1));
    }

    #[test]
    fn test_sound_events_level_up() {
        let mut s = create_state(&CreateStateOptions::default());
        let _ = drain_sounds(&mut s);
        let needed = s.player.xp_to_next;
        assert_eq!(combat::grant_xp(&mut s, needed - 1), 0);
        assert!(drain_sounds(&mut s).iter().all(|e| e.kind != "levelUp"));

        assert_eq!(combat::grant_xp(&mut s, 1), 1);
        let sounds = drain_sounds(&mut s);
        assert_eq!(
            sounds.iter().filter(|e| e.kind == "levelUp").count(),
            1,
            "leveling up should emit exactly one levelUp sound"
        );
    }

    #[test]
    fn test_sound_events_gate_open_on_room_clear() {
        let mut s = create_state(&CreateStateOptions::default());
        let _ = drain_sounds(&mut s);
        // Clear all enemies & pending waves in the entry (non-boss) room
        s.enemies.clear();
        if let Some(ref mut rm) = s.room {
            rm.pending_wave.clear();
            rm.pending_waves.clear();
        }
        step(&mut s, &Input::default(), None);
        let sounds = drain_sounds(&mut s);
        assert_eq!(
            sounds.iter().filter(|e| e.kind == "gateOpen").count(),
            1,
            "clearing a non-boss room should emit gateOpen once"
        );
        // Subsequent ticks should not re-emit gateOpen
        step(&mut s, &Input::default(), None);
        assert!(drain_sounds(&mut s).iter().all(|e| e.kind != "gateOpen"));
    }

    #[test]
    fn test_sound_events_result_rank_on_victory() {
        let mut s = create_state(&CreateStateOptions::default());
        let _ = drain_sounds(&mut s);
        s.victory_delay = Some(DT * 0.5);
        step(&mut s, &Input::default(), None);
        assert!(s.victory);
        let sounds = drain_sounds(&mut s);
        assert_eq!(
            sounds.iter().filter(|e| e.kind == "resultRank").count(),
            1,
            "transitioning to victory should emit resultRank once"
        );
        step(&mut s, &Input::default(), None);
        assert!(drain_sounds(&mut s).iter().all(|e| e.kind != "resultRank"));
    }

    #[test]
    fn test_consumable_heal_mp_cooldown_gating() {
        let mut s = create_state(&CreateStateOptions::default());
        s.player.hp = (s.player.max_hp - 60.0).max(1.0);
        s.player.mp = (s.player.max_mp - 50.0).max(0.0);
        let hp_before = s.player.hp;
        let mp_before = s.player.mp;

        assert!(combat::apply_consumable_effect(
            &mut s,
            0,
            "HP 药水",
            40.0,
            0.0
        ));
        assert!((s.player.hp - (hp_before + 40.0).min(s.player.max_hp)).abs() < 1e-6);
        assert!((s.player.consumable_cooldowns[0] - combat::CONSUMABLE_COOLDOWN_SEC).abs() < 1e-6);
        assert!(s
            .effects
            .iter()
            .any(|e| e.kind == "heal" && e.text.contains("HP")));
        assert!(s.log.iter().any(|l| l.text.contains("HP 药水")));

        // Cooldown gates immediate reuse on slot 0
        assert!(!combat::apply_consumable_effect(
            &mut s,
            0,
            "HP 药水",
            40.0,
            0.0
        ));

        // Slot 1 (MP potion) is independent and succeeds immediately
        assert!(combat::apply_consumable_effect(
            &mut s,
            1,
            "MP 药水",
            0.0,
            40.0
        ));
        assert!((s.player.mp - (mp_before + 40.0).min(s.player.max_mp)).abs() < 1e-6);
        assert!(s
            .effects
            .iter()
            .any(|e| e.kind == "heal" && e.text.contains("MP")));
        assert!(s.log.iter().any(|l| l.text.contains("MP 药水")));

        // Advance simulation past cooldown -> slot 0 becomes ready again
        run_frames(&mut s, 130, |_, _| Input::default());
        assert_eq!(s.player.consumable_cooldowns[0], 0.0);
        assert!(combat::apply_consumable_effect(
            &mut s,
            0,
            "HP 药水",
            40.0,
            0.0
        ));
    }

    #[test]
    fn test_resurrect_player_revives_in_place_with_invuln() {
        let mut s = create_state(&CreateStateOptions::default());
        assert!(!combat::resurrect_player(&mut s));

        let px = s.player.x;
        let pz = s.player.z;
        s.player.mp = 5.0;
        let max_hp = s.player.max_hp;
        combat::spend_player_hp(&mut s, max_hp + 50.0);
        step(&mut s, &Input::default(), None);
        assert!(s.defeat);
        assert!(s.player.dead);
        assert!(!combat::apply_consumable_effect(
            &mut s,
            0,
            "HP 药水",
            40.0,
            0.0
        ));

        assert!(combat::resurrect_player(&mut s));
        assert!(!s.defeat);
        assert!(!s.player.dead);
        assert!(s.finished_at.is_none());
        assert!((s.player.hp - s.player.max_hp).abs() < 1e-6);
        assert!((s.player.mp - s.player.max_mp).abs() < 1e-6);
        assert!(s.player.invuln >= combat::RESURRECT_INVULN_SEC - 1e-6);
        assert!((s.player.x - px).abs() < 1e-6);
        assert!((s.player.z - pz).abs() < 1e-6);
        assert!(s.log.iter().any(|l| l.text.contains("复活币")));
        assert!(s
            .effects
            .iter()
            .any(|e| e.kind == "heal" && e.text.contains("复活")));
    }
}
