//! Combat boxes, damage, XP, blood orbs, fields, shots, pickups, deaths, and props (`src/core.js`).

use crate::constants::*;
use crate::dungeon::{breakable_spec, prop_box, prop_obstacle, room_left, room_right};
use crate::player::{apply_skill_hit, buff_by_id, buff_sum};
use crate::tables::*;
use crate::types::*;

pub fn is_boss_enemy(enemy: &Enemy) -> bool {
    enemy.behavior == "boss"
}

pub fn death_lie(enemy: &Enemy) -> f64 {
    if is_boss_enemy(enemy) {
        DEATH_BOSS_LIE
    } else {
        DEATH_LIE
    }
}

pub fn smoke_life(enemy: &Enemy) -> f64 {
    if is_boss_enemy(enemy) {
        DEATH_BOSS_SMOKE
    } else {
        DEATH_SHAPE
    }
}

pub fn body_box(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        left: x - width / 2.0,
        right: x + width / 2.0,
        bottom: y,
        top: y - height,
    }
}

pub fn boxes_overlap(a: Rect, b: Rect) -> bool {
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

pub fn attack_box(player: &Player, reach: f64, height_pad: f64, at: Option<f64>) -> Rect {
    let root = at.unwrap_or(player.x);
    let left = if player.facing > 0 {
        root
    } else {
        root - reach
    };
    Rect {
        left,
        right: left + reach,
        bottom: player.y + height_pad,
        top: player.y - player.height - height_pad,
    }
}

pub fn hit_time(skill: &SkillSpec, index: usize, player: &Player) -> f64 {
    if let Some(ref channel) = skill.channel {
        let Some(released) = player.channel_released_at else {
            return f64::INFINITY;
        };
        return released + channel.hits.get(index).copied().unwrap_or(0.0);
    }
    if let Some(ref hit_at) = skill.hit_at {
        return skill.duration * hit_at.get(index).copied().unwrap_or(0.0);
    }
    let count = skill.hits.unwrap_or(1).max(1);
    skill.active_from + index as f64 * ((skill.active_to - skill.active_from) / count as f64)
}

pub fn advance_ahead(skill: &SkillSpec, elapsed: f64) -> f64 {
    let progress = if skill.duration > 0.0 {
        elapsed / skill.duration
    } else {
        1.0
    };
    let ramp = skill.advance_ramp.unwrap_or(0.0);
    if progress <= skill.advance_at {
        return 0.0;
    }
    if progress < skill.advance_at + ramp {
        return skill.advance * ((progress - skill.advance_at) / ramp.max(0.0001));
    }
    let back = skill.advance_back.unwrap_or(1.0);
    if progress <= back {
        return skill.advance;
    }
    let t = ((progress - back) / (1.0 - back).max(0.0001)).min(1.0);
    skill.advance * (1.0 - t)
}

pub fn push_hit_word_effect(state: &mut State, enemy: &Enemy, text: &str) {
    let mut eff = Effect::new("hitWord", HIT_WORD_LIFE);
    eff.text = text.to_string();
    eff.x = enemy.x + HIT_WORD_DX;
    eff.y = enemy.y - enemy.height - 6.0 + HIT_WORD_DY;
    state.effects.push(eff);
}

pub fn push_damage_effect(state: &mut State, x: f64, y: f64, amount: i64) {
    let mut eff = Effect::new("damage", 0.6);
    eff.text = amount.to_string();
    eff.x = x;
    eff.y = y;
    state.effects.push(eff);
}

pub fn push_miss_effect(state: &mut State, enemy: &Enemy) {
    let mut eff = Effect::new("damage", 0.7);
    eff.miss = true;
    eff.text = "MISS".to_string();
    eff.x = enemy.x;
    eff.y = enemy.y - enemy.height - 6.0;
    state.effects.push(eff);
}

pub fn push_banner(state: &mut State, text: &str, life: f64) {
    let mut eff = Effect::new("banner", life);
    eff.text = text.to_string();
    state.effects.push(eff);
}

pub fn spawn_shot(state: &mut State, skill_id: &str, damage: f64, hit_index: usize) {
    let Some(spec) = TABLES.skills.get(skill_id) else {
        return;
    };
    let Some(ref shot) = spec.shot else {
        return;
    };
    let origin = state.player.cast_origin_x.unwrap_or(state.player.x);
    let facing = state.player.facing;
    state.shots.push(Shot {
        skill_id: skill_id.to_string(),
        x: origin + f64::from(facing) * shot.ahead,
        vx: f64::from(facing) * shot.speed,
        z: state.player.z,
        facing,
        y: state.player.y,
        height: shot.height.unwrap_or(state.player.height),
        depth_reach: shot.depth_reach.unwrap_or(DEPTH_REACH_MELEE),
        reach: shot.reach,
        height_pad: shot.height_pad,
        damage,
        hit_index,
        struck: Vec::new(),
        struck_props: Vec::new(),
        life: shot.life,
        max_life: shot.life,
    });
}

fn shot_box(shot: &Shot, from_x: f64) -> Rect {
    let half = shot.reach / 2.0;
    Rect {
        left: from_x.min(shot.x) - half,
        right: from_x.max(shot.x) + half,
        bottom: shot.y + shot.height_pad,
        top: shot.y - shot.height - shot.height_pad,
    }
}

pub fn update_shots(state: &mut State, dt: f64) {
    if state.shots.is_empty() {
        return;
    }
    let count = state.shots.len();
    for s_idx in 0..count {
        if state.shots[s_idx].life <= 0.0 {
            continue;
        }
        let from_x = state.shots[s_idx].x;
        let step_dt = dt.min(state.shots[s_idx].life);
        state.shots[s_idx].x += state.shots[s_idx].vx * step_dt;
        state.shots[s_idx].life -= dt;
        let shot_snapshot = state.shots[s_idx].clone();
        let boxed = shot_box(&shot_snapshot, from_x);
        let mut struck_props = shot_snapshot.struck_props.clone();
        swing_props(
            state,
            boxed,
            Some(shot_snapshot.depth_reach),
            Some((shot_snapshot.x, shot_snapshot.z)),
            Some(&mut struck_props),
        );
        state.shots[s_idx].struck_props = struck_props;

        let enemy_count = state.enemies.len();
        for e_idx in 0..enemy_count {
            let enemy_id = state.enemies[e_idx].id;
            if state.enemies[e_idx].dead || state.shots[s_idx].struck.contains(&enemy_id) {
                continue;
            }
            if !in_reach_of(
                state.enemies[e_idx].z,
                shot_snapshot.z,
                shot_snapshot.depth_reach,
            ) {
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
            state.shots[s_idx].struck.push(enemy_id);
            if let Some(skill) = TABLES.skills.get(&shot_snapshot.skill_id) {
                apply_skill_hit(
                    state,
                    e_idx,
                    shot_snapshot.damage,
                    skill,
                    shot_snapshot.hit_index,
                    Some((shot_snapshot.x, shot_snapshot.facing)),
                );
            }
        }
    }
    state.shots.retain(|s| s.life > 0.0);
}

pub fn loot_for(seed: u32, enemy_id: u32) -> (&'static str, &'static str, u32) {
    let h = crate::hash32(seed, enemy_id);
    let rare = (h & 1) == 0;
    let (name, tone) = if rare {
        (LOOT_CYAN[((h >> 4) as usize) % LOOT_CYAN.len()], "cyan")
    } else {
        (LOOT_WHITE[((h >> 4) as usize) % LOOT_WHITE.len()], "white")
    };
    let gold = 30 + ((h >> 12) % 45);
    (name, tone, gold)
}

pub fn drop_loot(state: &mut State, enemy: &Enemy) {
    let (name, tone, gold) = loot_for(state.seed, enemy.id);
    state.pickups.push(Pickup {
        kind: "loot".to_string(),
        name: name.to_string(),
        tone: tone.to_string(),
        gold,
        exp: 0,
        x: enemy.x,
        y: ARENA_GROUND_Y,
        z: enemy.z,
        radius: 0.0,
        value: 0.0,
        life: LOOT_LIFE,
        from_x: 0.0,
        from_y: 0.0,
        from_z: 0.0,
        progress: 0.0,
        trail: Vec::new(),
    });
}

pub fn drop_breakable_loot(state: &mut State, prop: &Prop) {
    let h = crate::hash32(
        state.seed ^ 0x6d2b_79f5,
        (prop.x * 7.0).round() as u32 + (prop.z * 131.0).round() as u32,
    );
    let max_z = band_depth(state.band_back_y);
    if prop.piece == "chest" {
        let name = LOOT_CYAN[((h >> 4) as usize) % LOOT_CYAN.len()];
        state.pickups.push(Pickup {
            kind: "loot".to_string(),
            name: name.to_string(),
            tone: "cyan".to_string(),
            gold: 60 + ((h >> 12) % 61),
            exp: 0,
            x: prop.x,
            y: ARENA_GROUND_Y,
            z: prop.z.min(max_z),
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        });
    } else if prop.piece == "tomb" {
        state.pickups.push(Pickup {
            kind: "gold".to_string(),
            name: "金币".to_string(),
            tone: "gold".to_string(),
            gold: 20 + ((h >> 12) % 31),
            exp: 0,
            x: prop.x,
            y: ARENA_GROUND_Y,
            z: prop.z.min(max_z),
            radius: 0.0,
            value: 0.0,
            life: LOOT_LIFE,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        });
    }
}

pub fn collect_loot(state: &mut State, drop: &Pickup) {
    state.stats.loot += 1;
    state.stats.gold += drop.gold;
    crate::push_log(state, &format!("获得[{}]1个", drop.name), &drop.tone);
    crate::push_log(state, &format!("获得{}金币", drop.gold), "gold");
}

pub fn collect_gold(state: &mut State, drop: &Pickup) {
    state.stats.loot += 1;
    state.stats.gold += drop.gold;
    crate::push_sound(state, "coinPickup", drop.x, drop.z);
    crate::push_log(state, &format!("获得{}金币", drop.gold), "gold");
}

pub fn advance_player_level(player: &mut Player, stage_id: &str, use_ref: bool) {
    player.level += 1;
    let threshold = if use_ref {
        match (stage_id, player.level) {
            ("mirkwood", 3) => Some(2098),
            ("mirkwood", 4) => Some(3467),
            ("mirkwood", 5) => Some(5469),
            ("mirkwooddeep", 6) => Some(7726),
            ("mirkwooddeep", 7) => Some(10568),
            _ => None,
        }
    } else {
        None
    };
    player.xp_to_next = threshold
        .unwrap_or_else(|| ((f64::from(player.xp_to_next) * PROG_GROWTH) + 0.5).floor() as u32);
    player.max_hp += PROG_MAX_HP_PER_LEVEL;
    player.max_mp += PROG_MAX_MP_PER_LEVEL;
    player.attack_bonus += PROG_ATTACK_PER_LEVEL;
}

pub fn grant_xp(state: &mut State, amount: u32) -> u32 {
    if state.player.dead || amount == 0 {
        return 0;
    }
    if state.player.level >= PROG_MAX_LEVEL {
        state.player.xp = 0;
        return 0;
    }
    state.player.xp += amount;
    let mut levels = 0;
    let use_ref = state.reference_profile.is_some();
    let stage_id = state.stage_id.clone();
    while state.player.xp >= state.player.xp_to_next && state.player.level < PROG_MAX_LEVEL {
        state.player.xp -= state.player.xp_to_next;
        advance_player_level(&mut state.player, &stage_id, use_ref);
        state.player.hp = state
            .player
            .max_hp
            .min(state.player.hp + PROG_HEAL_ON_LEVEL_UP);
        state.player.mp = state
            .player
            .max_mp
            .min(state.player.mp + PROG_MAX_MP_PER_LEVEL);
        levels += 1;
    }
    if levels > 0 {
        if state.player.level >= PROG_MAX_LEVEL {
            state.player.xp = 0;
        }
        state.xp_gauge_flash_until = state.time + PROG_LEVEL_UP_FLASH_DURATION;
        let name = state.player.name.as_deref().unwrap_or("鬼剑士");
        let msg = format!("[{name}]已达到Lv{}", state.player.level);
        crate::push_log(state, &msg, "gold");
        crate::push_sound(state, "levelUp", state.player.x, state.player.z);
    }
    levels
}

pub fn credit_experience(state: &mut State, amount: u32) {
    grant_xp(state, amount);
    crate::push_log(state, &format!("获得{amount}点经验值"), "gold");
    let now = state.time;
    if let Some(caption) = state
        .effects
        .iter_mut()
        .find(|e| e.kind == "pickupText" && (e.awarded_at - now).abs() < 1e-12)
    {
        caption.amount += amount;
        caption.text = format!("{} Exp", caption.amount);
        return;
    }
    let mut eff = Effect::new("pickupText", EXP_FLOAT_DURATION);
    eff.text = format!("{amount} Exp");
    eff.amount = amount;
    eff.awarded_at = now;
    eff.anchor = "player".to_string();
    eff.x = state.player.x;
    eff.y = state.player.y - depth_lift(state.player.z) - ART_HEIGHT - EXP_FLOAT_HEAD_GAP;
    state.effects.push(eff);
}

pub fn award_enemy_experience(state: &mut State, xp: u32) {
    if xp == 0 || state.player.dead {
        return;
    }
    state.stats.kill_xp += xp;
    credit_experience(state, xp);
}

pub fn award_clear_experience(state: &mut State) {
    let Some(ref prof) = state.reference_profile else {
        return;
    };
    if state.clear_experience || state.player.dead {
        return;
    }
    let total = prof.clear_base + prof.clear_rating + prof.clear_channel;
    state.clear_experience = true;
    credit_experience(state, total);
}

pub fn spawn_blood_orb(state: &mut State, enemy: &Enemy) {
    let x = enemy.x;
    let y = enemy.y - enemy.height * 0.55;
    let z = enemy.z;
    state.pickups.push(Pickup {
        kind: "blood_orb".to_string(),
        name: String::new(),
        tone: String::new(),
        gold: 0,
        exp: 0,
        x,
        y,
        z,
        radius: BLOOD_ORB_RADIUS,
        value: BLOOD_ORB_HEAL,
        life: BLOOD_ORB_LIFETIME_SECONDS,
        from_x: x,
        from_y: y,
        from_z: z,
        progress: 0.0,
        trail: vec![[x, y, z]],
    });
    state.stats.blood_orbs += 1;
}

pub fn grow_sword(state: &mut State, hits: u32, kills: u32) {
    let player = &mut state.player;
    if player.buffs.get("hellbenter").copied().unwrap_or(0.0) <= 0.0 {
        return;
    }
    let tier = player.hellbenter_tier.max(1);
    if tier >= HELLBENTER_TIERS {
        player.hellbenter_charge = 0;
        return;
    }
    let charge = player.hellbenter_charge + hits;
    let steps = kills * HELLBENTER_KILL_TIERS + (charge / HELLBENTER_HITS_PER_TIER);
    player.hellbenter_charge = charge % HELLBENTER_HITS_PER_TIER;
    player.hellbenter_tier = HELLBENTER_TIERS.min(tier + steps);
}

pub fn spawn_blood_strand(state: &mut State, enemy: &Enemy) {
    let mut eff = Effect::new("bloodStrand", HELLBENTER_STRAND_LIFE);
    eff.x = enemy.x;
    eff.y = enemy.y - enemy.height * 0.5;
    eff.z = enemy.z;
    state.effects.push(eff);
}

pub fn enter_phase2(state: &mut State, enemy_idx: usize) -> bool {
    let Some(phase2) = state.enemies[enemy_idx].phase2.clone() else {
        return false;
    };
    if state.enemies[enemy_idx].phase >= 2 || state.enemies[enemy_idx].dead {
        return false;
    }
    let e = &mut state.enemies[enemy_idx];
    e.phase = 2;
    e.speed = e.base_speed * phase2.speed_scale;
    e.damage = ((e.base_damage * phase2.damage_scale) + 0.5).floor();
    e.attack_cooldown_max = e.base_attack_cooldown_max * phase2.cooldown_scale;
    e.attack_cooldown = e.attack_cooldown.min(e.attack_cooldown_max);
    e.base_attack_windup *= phase2.windup_scale;

    if let (Some(ref mut slam), Some(ref base_slam)) = (&mut e.slam, &e.base_slam) {
        slam.radius = base_slam.radius * phase2.slam_radius_scale;
        slam.cooldown = base_slam.cooldown * phase2.slam_cooldown_scale;
        e.slam_cooldown = e.slam_cooldown.min(0.6);
    }
    if let Some(ref lunge) = phase2.lunge {
        e.lunge_cooldown = lunge.cooldown * 0.35;
    }
    if e.sweep.is_some() {
        e.sweep_cooldown = e.sweep_cooldown.min(0.6);
    }

    let phase_ring = e
        .slam
        .as_ref()
        .map(|s| s.radius)
        .or_else(|| e.sweep.as_ref().map(|s| s.radius))
        .unwrap_or(e.attack_range);
    let mut shock = Effect::new("shockwave", 0.45);
    shock.x = e.x;
    shock.y = ARENA_GROUND_Y;
    shock.radius = phase_ring;
    shock.gold = e.kind == "lugaruBoss";
    let ex = e.x;
    let ez = e.z;
    let eid = e.id;
    let ekind = e.kind.clone();
    state.effects.push(shock);

    let stage_banner = TABLES
        .stages
        .get(&state.stage_id)
        .and_then(|s| s.boss_banner.as_deref())
        .filter(|s| !s.is_empty());
    let banner = stage_banner.unwrap_or(&phase2.banner);
    if !banner.is_empty() {
        push_banner(state, banner, 1.8);
    }
    crate::push_enemy_sound(state, "bossRoar", &ekind, eid, ex, ez);
    true
}

fn stance_bleed(player: &Player) -> Option<EnemyBleed> {
    if player.buffs.get("bloodRage").copied().unwrap_or(0.0) <= 0.0 {
        return None;
    }
    let buff = buff_by_id("bloodRage")?;
    let spec = buff.bleed.as_ref()?;
    Some(EnemyBleed {
        damage: spec.damage + f64::from(player.level - 1) * spec.growth,
        remaining: spec.duration,
        timer: spec.interval,
        interval: spec.interval,
    })
}

fn slides_off(state: &mut State, enemy_evasion: f64) -> bool {
    if enemy_evasion <= 0.0 {
        return false;
    }
    let miss = enemy_evasion - buff_sum(&state.player, "accuracy");
    if miss <= 0.0 {
        return false;
    }
    crate::next_random(state) < miss
}

pub fn set_target(state: &mut State, enemy_idx: usize) {
    let enemy = &state.enemies[enemy_idx];
    if state
        .target
        .as_ref()
        .is_some_and(|t| t.enemy.id == enemy.id)
    {
        return;
    }
    let share = if enemy.max_hp > 0.0 {
        (enemy.hp / enemy.max_hp).max(0.0)
    } else {
        0.0
    };
    state.target = Some(TargetState {
        enemy: enemy.clone(),
        dying: 0.0,
        share,
        ghost: None,
    });
}

pub fn update_target(state: &mut State, dt: f64) {
    let Some(ref mut target) = state.target else {
        return;
    };
    if let Some(live) = state.enemies.iter().find(|e| e.id == target.enemy.id) {
        target.enemy = live.clone();
    }
    let share = if !target.enemy.dead && target.enemy.max_hp > 0.0 {
        (target.enemy.hp / target.enemy.max_hp).clamp(0.0, 1.0)
    } else {
        0.0
    };
    if share < target.share - 1e-9 {
        target.ghost = Some(TargetGhost {
            from: target.share,
            to: share,
            t: 0.0,
        });
    }
    target.share = share;
    if let Some(ref mut ghost) = target.ghost {
        ghost.t += dt;
        if ghost.t >= TARGET_GHOST_FADE {
            target.ghost = None;
        }
    }
    if target.enemy.dead {
        target.dying += dt;
        let hold = if target.enemy.behavior == "boss" {
            TARGET_BOSS_DEATH_HOLD
        } else {
            TARGET_DEATH_BLINK
        };
        if target.dying + 1e-9 >= hold {
            state.target = None;
        }
    } else {
        target.dying = 0.0;
    }
}

#[derive(Debug, Clone, Default)]
pub struct DamageEnemyOptions {
    pub no_blood_orbs: bool,
    pub hit_stop: f64,
    pub knockback_direction: Option<i32>,
    pub ignore_super_armor: bool,
    pub launch: f64,
    pub juggle: bool,
    pub knockdown: f64,
    pub stun: f64,
    pub grabbed: f64,
}

pub fn damage_enemy(
    state: &mut State,
    enemy_idx: usize,
    amount: f64,
    knockback_x: f64,
    source_x: f64,
    opts: &DamageEnemyOptions,
) -> u32 {
    if state.enemies[enemy_idx].dead {
        return 0;
    }
    let slayer_swing = !opts.no_blood_orbs;
    if slayer_swing {
        set_target(state, enemy_idx);
        let ev = state.enemies[enemy_idx].evasion;
        if slides_off(state, ev) {
            let e_snap = state.enemies[enemy_idx].clone();
            push_miss_effect(state, &e_snap);
            return 0;
        }
    }
    let applied = ((amount + 0.5).floor().max(0.0)) as u32;
    state.enemies[enemy_idx].hp -= f64::from(applied);

    if slayer_swing && applied > 0 && opts.hit_stop > 0.0 {
        let stop = if state.enemies[enemy_idx].hp <= 0.0 {
            HIT_STOP_KILL
        } else {
            opts.hit_stop
        };
        state.hit_stop = state.hit_stop.max(stop);
    }

    if slayer_swing && state.enemies[enemy_idx].hp > 0.0 {
        let e = &state.enemies[enemy_idx];
        let (ekind, eid, ex, ez) = (e.kind.clone(), e.id, e.x, e.z);
        crate::push_enemy_sound(state, "enemyHurt", &ekind, eid, ex, ez);
    }

    state.stats.hits += 1;
    state.stats.damage_dealt += applied;
    if slayer_swing {
        if state.stats.last_landed_swing != state.swing_seq {
            state.stats.last_landed_swing = state.swing_seq;
            state.stats.swings_landed += 1;
        }
        if state.time - state.stats.last_hit_at > 2.0 {
            state.stats.combo_chains += 1;
        }
        state.stats.last_hit_at = state.time;
        state.stats.combo_hits += 1;
        if is_boss_enemy(&state.enemies[enemy_idx]) && state.boss_engaged.is_none() {
            state.boss_engaged = Some(BossEngaged {
                name: state.enemies[enemy_idx].label.clone(),
                at: state.time,
            });
        }
    }

    let ex = state.enemies[enemy_idx].x;
    let ey = state.enemies[enemy_idx].y;
    let eh = state.enemies[enemy_idx].height;
    push_damage_effect(state, ex, ey - eh - 6.0, i64::from(applied));

    if applied > 0
        && slayer_swing
        && state.player.buffs.get("bloodRage").copied().unwrap_or(0.0) > 0.0
    {
        if crate::next_random(state) < BLOOD_ORB_CHANCE {
            let e_snap = state.enemies[enemy_idx].clone();
            spawn_blood_orb(state, &e_snap);
        }
        if let Some(bleed) = stance_bleed(&state.player) {
            state.enemies[enemy_idx].bleed = Some(bleed);
        }
    }

    if applied > 0
        && slayer_swing
        && state.player.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0
    {
        grow_sword(state, 1, 0);
        let e_snap = state.enemies[enemy_idx].clone();
        spawn_blood_strand(state, &e_snap);
    }

    let was_attacking = state.enemies[enemy_idx].attack_timer > 0.0;
    let armored = state.enemies[enemy_idx].super_armor && !opts.ignore_super_armor;
    if armored {
        state.enemies[enemy_idx].vx *= 0.6;
    } else {
        let dir = match opts.knockback_direction {
            Some(1) => 1.0,
            Some(-1) => -1.0,
            _ => {
                if state.enemies[enemy_idx].x >= source_x {
                    1.0
                } else {
                    -1.0
                }
            }
        };
        state.enemies[enemy_idx].vx = dir * knockback_x;
        state.enemies[enemy_idx].hurt_timer = 0.18;
        state.enemies[enemy_idx].attack_timer = 0.0;
    }

    if opts.launch != 0.0 {
        if armored {
            let e_snap = state.enemies[enemy_idx].clone();
            push_hit_word_effect(state, &e_snap, HIT_WORD_TEXT);
        } else {
            state.enemies[enemy_idx].vy = opts.launch;
            state.enemies[enemy_idx].on_ground = false;
            state.enemies[enemy_idx].attack_timer = 0.0;
            state.enemies[enemy_idx].knockdown = 0.0;
        }
    } else if opts.juggle && !state.enemies[enemy_idx].on_ground {
        state.enemies[enemy_idx].vy = state.enemies[enemy_idx].vy.min(-150.0);
    }

    if opts.knockdown > 0.0 && !armored {
        state.enemies[enemy_idx].knockdown = state.enemies[enemy_idx].knockdown.max(opts.knockdown);
        state.enemies[enemy_idx].vy = state.enemies[enemy_idx].vy.min(-170.0);
        state.enemies[enemy_idx].on_ground = false;
        state.enemies[enemy_idx].attack_timer = 0.0;
    }
    if opts.stun > 0.0 && !armored {
        state.enemies[enemy_idx].stun = state.enemies[enemy_idx].stun.max(opts.stun);
        state.enemies[enemy_idx].attack_timer = 0.0;
    }
    if opts.grabbed > 0.0 {
        state.enemies[enemy_idx].grabbed = opts.grabbed;
        state.enemies[enemy_idx].knockdown = 0.0;
        state.enemies[enemy_idx].stun = 0.0;
        state.enemies[enemy_idx].attack_timer = 0.0;
        state.enemies[enemy_idx].super_armor = false;
    }

    if was_attacking
        && (state.enemies[enemy_idx].attack_timer <= 0.0 || state.enemies[enemy_idx].hp <= 0.0)
    {
        state.enemies[enemy_idx].attack_timer = 0.0;
        state.enemies[enemy_idx].super_armor = false;
        let eid = state.enemies[enemy_idx].id;
        state
            .effects
            .retain(|ef| ef.kind != "telegraph" || ef.enemy_id != eid);
    }

    if state.enemies[enemy_idx].hp <= 0.0 {
        state.enemies[enemy_idx].hp = 0.0;
        state.enemies[enemy_idx].dead = true;
        let e_snap = state.enemies[enemy_idx].clone();
        crate::push_enemy_sound(
            state,
            "enemyDie",
            &e_snap.kind,
            e_snap.id,
            e_snap.x,
            e_snap.z,
        );
        let burst_death = e_snap.death_style.as_deref() == Some("burst");
        state.enemies[enemy_idx].dying = if burst_death {
            0.20
        } else {
            death_lie(&e_snap) + smoke_life(&e_snap)
        };
        if burst_death {
            let mut eff = Effect::new("bossburst", 0.45);
            eff.x = e_snap.x;
            eff.z = e_snap.z;
            eff.height = e_snap.height;
            eff.seed = e_snap.id;
            state.effects.push(eff);
        }
        if is_boss_enemy(&e_snap) && !burst_death {
            let mut eff = Effect::new("bossrays", DEATH_BOSS_RAYS);
            eff.x = e_snap.x;
            eff.z = e_snap.z;
            eff.height = e_snap.height;
            eff.source_x = source_x;
            eff.source_z = state.player.z;
            eff.seed = e_snap.id;
            state.effects.push(eff);
        }
        state.stats.kills += 1;
        *state
            .stats
            .kills_by_type
            .entry(e_snap.kind.clone())
            .or_insert(0) += 1;
        if slayer_swing {
            grow_sword(state, 0, 1);
        }
        award_enemy_experience(state, e_snap.xp);
        drop_loot(state, &e_snap);
    } else if let Some(ref p2) = state.enemies[enemy_idx].phase2 {
        if state.enemies[enemy_idx].phase < 2
            && state.enemies[enemy_idx].hp <= state.enemies[enemy_idx].max_hp * p2.hp_ratio
        {
            enter_phase2(state, enemy_idx);
        }
    }
    applied
}

pub fn spawn_field(state: &mut State, skill_id: &str, progress: f64) {
    let Some(spec) = TABLES.skills.get(skill_id) else {
        return;
    };
    let Some(ref field) = spec.field else {
        return;
    };
    if progress < field.from {
        return;
    }
    let span = field.span.unwrap_or((1.0 - field.from) * spec.duration);
    let clock = if field.span.is_some() {
        0.0
    } else {
        ((progress - field.from) * spec.duration).max(0.0)
    };
    let tick_at = field
        .tick
        .as_ref()
        .map(|t| span * t.from + t.interval)
        .unwrap_or(0.0);
    state.fields.push(Field {
        skill_id: skill_id.to_string(),
        from: field.from,
        x: state.player.x + f64::from(state.player.facing) * field.forward,
        y: state.player.y,
        z: state.player.z,
        facing: state.player.facing,
        clock,
        span,
        life: span + field.linger,
        tick_at,
        ticks: 0,
        tier: state.player.hellbenter_tier.max(1),
    });
}

pub fn update_field_ticks(state: &mut State, fields: &mut [Field]) {
    for field in fields.iter_mut() {
        let Some(spec) = TABLES.skills.get(&field.skill_id) else {
            continue;
        };
        let Some(tick) = spec.field.as_ref().and_then(|f| f.tick.as_ref()) else {
            continue;
        };
        if field.clock < 0.0 {
            continue;
        }
        let end = field.life.min(field.span * tick.until.unwrap_or(1.0));
        let through = end.min(field.clock);
        let radius = tick.radius * SLAYER_HEIGHT;
        let forged = f64::from(field.tier.clamp(1, HELLBENTER_TIERS) - 1)
            / f64::from((HELLBENTER_TIERS - 1).max(1));
        let scale = 0.45 + 0.55 * forged;
        while field.tick_at <= through + 1e-9 {
            field.tick_at += tick.interval;
            field.ticks += 1;
            let last = field.tick_at > end + 1e-9;
            let e_len = state.enemies.len();
            for e_idx in 0..e_len {
                if state.enemies[e_idx].dead {
                    continue;
                }
                let dx = state.enemies[e_idx].x - field.x;
                let dz = state.enemies[e_idx].z - field.z;
                if dx * dx > radius * radius || dz.abs() > tick.depth * SLAYER_HEIGHT {
                    continue;
                }
                let amount =
                    ((tick.damage + f64::from(state.player.level - 1) * tick.growth) * scale + 0.5)
                        .floor();
                let opts = DamageEnemyOptions {
                    no_blood_orbs: true,
                    stun: tick.stun,
                    knockdown: if last && tick.knockdown_last {
                        1.1
                    } else {
                        0.0
                    },
                    ..Default::default()
                };
                damage_enemy(state, e_idx, amount, 0.0, field.x, &opts);
            }
        }
    }
}

pub fn field_progress(field: &Field) -> (f64, f64) {
    let at = if field.span > 0.0 {
        (field.clock / field.span).min(1.0)
    } else {
        1.0
    };
    let tail = field.life - field.span;
    let fade = if tail > 0.0 && field.clock > field.span {
        (1.0 - (field.clock - field.span) / tail).max(0.0)
    } else {
        1.0
    };
    (field.from + (1.0 - field.from) * at, fade)
}

pub fn run_cleared(state: &State) -> bool {
    if state.victory || state.victory_delay.is_some() {
        return true;
    }
    !state.defeat
        && state.dungeon.as_ref().is_some_and(|d| state.cell == d.boss)
        && state.enemies.iter().any(|e| e.dead && is_boss_enemy(e))
}

pub fn spend_player_hp(state: &mut State, amount: f64) -> f64 {
    if state.player.dead || run_cleared(state) {
        return 0.0;
    }
    let spent = amount.max(0.0);
    state.player.hp -= spent;
    if state.player.hp <= 0.0 {
        state.player.hp = 0.0;
        state.player.dead = true;
        state.defeat = true;
        crate::push_sound(state, "playerDie", state.player.x, state.player.z);
    }
    spent
}

pub fn update_stance_drain(state: &mut State, dt: f64) {
    let mut drain: Option<SkillBuffDrain> = None;
    for (id, &rem) in &state.player.buffs {
        if rem <= 0.0 {
            continue;
        }
        if let Some(buff) = buff_by_id(id) {
            if let Some(ref d) = buff.drain {
                if d.interval > 0.0 {
                    drain = Some(d.clone());
                }
            }
        }
    }
    let Some(d) = drain else {
        state.player.stance_drain_timer = 0.0;
        return;
    };
    if run_cleared(state) {
        return;
    }
    state.player.stance_drain_timer -= dt;
    while state.player.stance_drain_timer <= 1e-9 && !state.player.dead {
        state.player.stance_drain_timer += d.interval;
        let amt = d.hp + state.player.max_hp * d.hp_ratio;
        spend_player_hp(state, amt);
    }
}

pub fn damage_player(state: &mut State, amount: f64, source_x: f64) -> u32 {
    if state.player.dead || state.player.invuln > 0.0 || run_cleared(state) {
        return 0;
    }
    let applied_f = (amount + 0.5).floor();
    if !applied_f.is_finite() || applied_f <= 0.0 {
        return 0;
    }
    let applied = applied_f as u32;
    state.player.hp -= f64::from(applied);
    crate::push_sound(state, "playerHurt", state.player.x, state.player.z);
    state.stats.damage_taken += applied;
    state.stats.hits_taken += 1;
    if applied > state.stats.max_hit_taken {
        state.stats.max_hit_taken = applied;
    }
    push_damage_effect(
        state,
        state.player.x,
        state.player.y - state.player.height - 6.0,
        i64::from(applied),
    );
    state.player.invuln = PLAYER_INVULN_AFTER_HIT;

    let armored = state
        .player
        .skill_id
        .as_deref()
        .and_then(|id| TABLES.skills.get(id))
        .is_some_and(|s| s.super_armor);
    if applied > 0 && !armored {
        let stop = if state.player.hp <= 0.0 {
            HIT_STOP_KILL
        } else {
            HIT_STOP_HURT
        };
        state.hit_stop = state.hit_stop.max(stop);
    }
    if !armored {
        state.player.hurt_timer =
            PLAYER_HURT_STUN * crate::player::buff_scale(&state.player, "hitRecovery");
        state.player.vx = if state.player.x >= source_x {
            1.0
        } else {
            -1.0
        } * PLAYER_KNOCKBACK_X;
    }
    state.player.attack_timer = 0.0;
    state.player.attack_buffer = 0.0;
    state.player.jump_buffer = 0.0;

    if !armored {
        if let Some(sid) = state.player.skill_id.clone() {
            if let Some(spec) = TABLES.skills.get(&sid) {
                let prog = 1.0 - state.player.skill_timer / spec.duration;
                spawn_field(state, &sid, prog);
            }
        }
        state.player.skill_id = None;
        state.player.skill_timer = 0.0;
        state.skill_buffer = None;
        state.player.combo_timer = 0.0;
    }

    if state.player.hp <= 0.0 {
        state.player.hp = 0.0;
        state.player.dead = true;
        state.defeat = true;
        crate::push_sound(state, "playerDie", state.player.x, state.player.z);
    }
    applied
}

pub fn heal_player(state: &mut State, amount: f64) -> f64 {
    let healed = (state.player.max_hp - state.player.hp).min(amount);
    if healed <= 0.0 {
        return 0.0;
    }
    state.player.hp += healed;
    let displayed = (healed + 0.5).floor() as i64;
    if displayed > 0 {
        let mut eff = Effect::new("heal", 0.8);
        eff.text = format!("+{displayed} HP");
        eff.x = state.player.x;
        eff.y = state.player.y - state.player.height - 10.0;
        eff.z = state.player.z;
        state.effects.push(eff);
    }
    healed
}

fn hit_native_pillar(
    state: &mut State,
    p_idx: usize,
    boxed: Rect,
    reach: Option<f64>,
    source_z: f64,
    struck_props: Option<&mut Vec<usize>>,
) {
    let damaged_at = state.props[p_idx]
        .native_pillar
        .as_ref()
        .map(|np| np.damaged_at)
        .unwrap_or(0.0);
    if damaged_at >= 0.0 {
        return;
    }
    if let Some(ref sp) = struck_props {
        if sp.contains(&p_idx) {
            return;
        }
    }
    let Some(anchor) = prop_obstacle(&state.props[p_idx], None) else {
        return;
    };
    let near_z = anchor.z - 12.0 * NATIVE_SCALE / DEPTH_SCALE;
    let far_z = anchor.z + 14.0 * NATIVE_SCALE / DEPTH_SCALE;
    let depth_reach = reach.unwrap_or(DEPTH_REACH_MELEE) * SLAYER_HEIGHT;
    if source_z < near_z - depth_reach || source_z > far_z + depth_reach {
        return;
    }
    let target = Rect {
        left: anchor.x - 20.0 * NATIVE_SCALE,
        right: anchor.x + 22.0 * NATIVE_SCALE,
        top: ARENA_GROUND_Y - 116.0 * NATIVE_SCALE,
        bottom: ARENA_GROUND_Y + 4.0 * NATIVE_SCALE,
    };
    if !boxes_overlap(boxed, target) {
        return;
    }
    if let Some(sp) = struck_props {
        sp.push(p_idx);
    }
    if let Some(ref mut np) = state.props[p_idx].native_pillar {
        np.damaged_at = state.time;
    }
    state.props[p_idx].piece = "pillarDamagedDecor".to_string();
    crate::push_sound(state, "stonePillarBreak", anchor.x, anchor.z);

    for d in 0..8usize {
        let u = ((d as isize * 37 + anchor.x.round() as isize).rem_euclid(17)) as f64 / 16.0 - 0.5;
        let v = ((d as isize * 53 + anchor.z.round() as isize).rem_euclid(13)) as f64 / 12.0 - 0.5;
        let w = ((d * 29) % 11) as f64 / 10.0;
        let mut eff = Effect::new("pillar_debris", 0.5);
        eff.x = anchor.x + u * 50.0 * NATIVE_SCALE;
        eff.y = ARENA_GROUND_Y - 45.0 * NATIVE_SCALE + v * 30.0 * NATIVE_SCALE;
        eff.z = anchor.z + (u * 10.0 * NATIVE_SCALE) / DEPTH_SCALE;
        eff.vx = (if d.is_multiple_of(2) { 1.0 } else { -1.0 }) * (90.0 + w * 110.0) * NATIVE_SCALE;
        eff.vy = -(70.0 + w * 140.0) * NATIVE_SCALE;
        eff.gravity = 1200.0 * NATIVE_SCALE;
        eff.variant = d % 4;
        eff.spin_dir = if d.is_multiple_of(2) { 1 } else { -1 };
        eff.angle0 = (d as f64 / 8.0) * std::f64::consts::PI * 2.0;
        state.effects.push(eff);
    }
}

pub fn swing_props(
    state: &mut State,
    boxed: Rect,
    reach: Option<f64>,
    source: Option<(f64, f64)>,
    mut struck_props: Option<&mut Vec<usize>>,
) {
    let source_z = source.map(|(_, z)| z).unwrap_or(state.player.z);
    let len = state.props.len();
    for p_idx in 0..len {
        if state.props[p_idx].native_pillar.is_some() {
            hit_native_pillar(
                state,
                p_idx,
                boxed,
                reach,
                source_z,
                struck_props.as_deref_mut(),
            );
            continue;
        }
        if !state.props[p_idx].solid || state.props[p_idx].broken {
            continue;
        }
        if let Some(ref sp) = struck_props {
            if sp.contains(&p_idx) {
                continue;
            }
        }
        let Some(spec) = breakable_spec(&state.props[p_idx].piece) else {
            continue;
        };
        let Some(b) = prop_box(&state.props[p_idx].piece, state.props[p_idx].scale) else {
            continue;
        };
        let depth_reach = reach.unwrap_or(DEPTH_REACH_BREAKABLE) * SLAYER_HEIGHT;
        if (state.props[p_idx].z - source_z).abs() > depth_reach + b.depth / 2.0 {
            continue;
        }
        let centre = state.props[p_idx].x + b.dx;
        let bh = if b.height > 0.0 {
            b.height
        } else {
            spec.height
        };
        let barrel = Rect {
            left: centre - b.width / 2.0,
            right: centre + b.width / 2.0,
            bottom: ARENA_GROUND_Y,
            top: ARENA_GROUND_Y - bh,
        };
        if !boxes_overlap(boxed, barrel) {
            continue;
        }
        if let Some(ref mut sp) = struck_props {
            sp.push(p_idx);
        }
        state.props[p_idx].hp -= 1;
        if state.props[p_idx].hp > 0 {
            continue;
        }
        state.props[p_idx].broken = true;
        state.props[p_idx].broken_at = state.time;
        state.props[p_idx].solid = false;
        state.stats.barrels += 1;
        let prop_snap = state.props[p_idx].clone();
        drop_breakable_loot(state, &prop_snap);
    }
}

pub fn update_pickups(state: &mut State, dt: f64) {
    let mut remaining = Vec::with_capacity(state.pickups.len());
    let pickups = std::mem::take(&mut state.pickups);
    for mut drop in pickups {
        drop.life -= dt;
        if drop.life <= 0.0 {
            continue;
        }
        if drop.kind == "loot" || drop.kind == "gold" {
            let on_row = (state.player.z - drop.z).abs() <= DEPTH_REACH_MELEE * SLAYER_HEIGHT;
            if !state.player.dead
                && on_row
                && (state.player.x - drop.x).abs() <= LOOT_REACH + state.player.width / 2.0
            {
                if drop.kind == "gold" {
                    collect_gold(state, &drop);
                } else {
                    collect_loot(state, &drop);
                }
                continue;
            }
            remaining.push(drop);
            continue;
        }

        drop.progress = (drop.progress + dt / BLOOD_ORB_FLIGHT_SECONDS).min(1.0);
        let eased = drop.progress * drop.progress;
        let target_y = state.player.y - state.player.height * CHEST_OF_HEIGHT;
        drop.x = drop.from_x + (state.player.x - drop.from_x) * eased;
        drop.y = drop.from_y + (target_y - drop.from_y) * eased;
        drop.z = drop.from_z + (state.player.z - drop.from_z) * eased;

        if let Some(first) = drop.trail.first() {
            let back_x = drop.x - first[0];
            let back_y = drop.y - first[1] - depth_lift(drop.z - first[2]);
            let spacing = drop.radius * BLOOD_ORB_TRAIL_STEP;
            if back_x * back_x + back_y * back_y >= spacing * spacing {
                drop.trail.insert(0, [drop.x, drop.y, drop.z]);
                if drop.trail.len() > BLOOD_ORB_TRAIL_STEPS {
                    drop.trail.pop();
                }
            }
        }
        if !state.player.dead && drop.progress >= 1.0 {
            let healed = heal_player(state, drop.value);
            let mut flash = Effect::new("bloodFlash", 0.26);
            flash.x = state.player.x;
            flash.y = state.player.y - state.player.height * CHEST_OF_HEIGHT;
            flash.z = state.player.z;
            state.effects.push(flash);
            if healed > 0.0 {
                let mut bh = Effect::new("bloodHeal", 0.42);
                bh.x = state.player.x;
                bh.y = state.player.y - state.player.height * CHEST_OF_HEIGHT;
                bh.z = state.player.z;
                state.effects.push(bh);
            }
            continue;
        }
        remaining.push(drop);
    }
    state.pickups = remaining;
}

pub fn update_deaths(state: &mut State, dt: f64) {
    let mut buried = false;
    let mut new_effects = Vec::new();
    for enemy in &mut state.enemies {
        if !enemy.dead || enemy.dying <= 0.0 {
            continue;
        }
        enemy.dying -= dt;
        if enemy.death_style.as_deref() != Some("burst")
            && !enemy.silhouette
            && enemy.dying <= smoke_life(enemy)
        {
            enemy.silhouette = true;
        }
        if enemy.dying > 0.0 {
            continue;
        }
        enemy.dying = 0.0;
        enemy.silhouette = false;
        enemy.gone = true;
        buried = true;
        if enemy.death_style.as_deref() == Some("burst") {
            continue;
        }
        let life = if is_boss_enemy(enemy) {
            DEATH_BOSS_CHUNKS
        } else {
            DEATH_CHUNKS
        };
        let mut eff = Effect::new("deathburst", life);
        eff.x = enemy.x;
        eff.z = enemy.z;
        eff.seed = enemy.id;
        eff.enemy_type = enemy.kind.clone();
        eff.height = enemy.height;
        new_effects.push(eff);
    }
    state.effects.extend(new_effects);
    if buried {
        state.enemies.retain(|e| !e.gone);
    }
}

pub fn update_breakables(state: &mut State) {
    for prop in &mut state.props {
        if prop.broken && state.time - prop.broken_at >= BREAK_ANIM {
            prop.gone = true;
        }
    }
}

pub fn stop_at_horizontal_prop(
    state: &State,
    from_x: f64,
    z: f64,
    body_footprint: Option<(f64, f64)>,
    mut x: f64,
) -> f64 {
    if x == from_x {
        return x;
    }
    let rightward = x > from_x;
    for prop in &state.props {
        let Some(b) = prop_obstacle(prop, body_footprint) else {
            continue;
        };
        if (z - b.z).abs() >= b.depth / 2.0 {
            continue;
        }
        let edge = b.x
            + if rightward {
                -b.width / 2.0
            } else {
                b.width / 2.0
            };
        if rightward && from_x <= edge && x > edge {
            x = edge;
        }
        if !rightward && from_x >= edge && x < edge {
            x = edge;
        }
    }
    x
}

pub fn block_props_coords(
    state: &State,
    x: &mut f64,
    z: &mut f64,
    vx: &mut f64,
    vz: &mut f64,
    body_footprint: Option<(f64, f64)>,
) {
    let half_w = body_footprint.map(|(w, _)| w).unwrap_or(34.0) / 2.0;
    let left_wall = room_left(state) + half_w;
    let right_wall = room_right(state) - half_w;
    let max_depth = band_depth(state.band_back_y);
    for prop in &state.props {
        let Some(b) = prop_obstacle(prop, body_footprint) else {
            continue;
        };
        let span_x = b.width / 2.0;
        let span_z = b.depth / 2.0;
        let dx = *x - b.x;
        let dz = *z - b.z;
        if dx.abs() >= span_x || dz.abs() >= span_z {
            continue;
        }
        let push_x = span_x - dx.abs();
        let push_z = span_z - dz.abs();
        if push_x <= push_z {
            *x = (b.x + if dx < 0.0 { -span_x } else { span_x }).clamp(left_wall, right_wall);
            *vx = 0.0;
        } else {
            *z = (b.z + if dz < 0.0 { -span_z } else { span_z }).clamp(0.0, max_depth);
            *vz = 0.0;
        }
    }
}

pub fn rating_of(state: &State) -> ResultRating {
    if let Some(ref existing) = state.result_rating {
        return existing.clone();
    }
    let swings = state.stats.swings;
    let operation = if swings > 0 {
        ((f64::from(state.stats.swings_landed) / f64::from(swings)) * 100.0 + 0.5).floor() as u32
    } else {
        100
    };
    let chains = state.stats.combo_chains;
    let technique = if chains > 0 {
        let ratio = (f64::from(state.stats.combo_hits) / f64::from(chains) / RATING_COMBO_BASELINE)
            .min(1.0);
        (ratio * 100.0 + 0.5).floor() as u32
    } else {
        0
    };
    let hits = state.stats.hits_taken;
    let over = ((state.time - RATING_PAR_SECONDS) / RATING_PAR_SECONDS).max(0.0) * RATING_TIME_COST;
    let grade_raw = if state.reference_profile.is_some() {
        100.0 - f64::from(hits)
    } else {
        100.0 - (f64::from(hits) * RATING_HIT_COST).min(RATING_HIT_COST_CAP) - over
            + ((f64::from(state.player.level.saturating_sub(1)) * RATING_LEVEL_BONUS)
                .min(RATING_LEVEL_BONUS_CAP))
    };
    let grade_score = ((grade_raw + 0.5).floor().clamp(0.0, 100.0)) as u32;
    let operation_points =
        ((f64::from(operation) * RATING_COMPONENT_MAX / 100.0) + 0.5).floor() as u32;
    let technique_points =
        ((f64::from(technique) * RATING_COMPONENT_MAX / 100.0) + 0.5).floor() as u32;
    let max_score = (2.0 * RATING_COMPONENT_MAX) as u32;
    let score = (operation_points + technique_points)
        .saturating_sub(hits)
        .min(max_score);
    let grade = if state.reference_profile.is_some() {
        if grade_score >= 96 {
            "SS"
        } else if grade_score >= 77 {
            "S"
        } else if grade_score >= 75 {
            "A"
        } else if grade_score >= 60 {
            "B"
        } else {
            "C"
        }
    } else if grade_score >= 90 {
        "S"
    } else if grade_score >= 75 {
        "A"
    } else if grade_score >= 60 {
        "B"
    } else {
        "C"
    };
    ResultRating {
        operation,
        technique,
        operation_points,
        technique_points,
        max_score,
        hits,
        score,
        grade: grade.to_string(),
    }
}
