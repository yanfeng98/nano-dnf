//! Core simulation state and entity types (`src/core.js`).

use crate::tables::*;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FloorRect {
    pub x_min: f64,
    pub x_max: f64,
    pub z_min: f64,
    pub z_max: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Input {
    pub left: bool,
    pub right: bool,
    pub up: bool,
    pub down: bool,
    pub jump: bool,
    pub attack: bool,
    pub skills: [bool; 16],
}

impl Input {
    /// Skill index mapping aligned with `TABLES.skill_order` + `hellbenter` at index 14.
    pub fn skill_pressed(&self, skill_id: &str) -> bool {
        if skill_id == "hellbenter" {
            return self.skills[14];
        }
        if let Some(idx) = TABLES.skill_order.iter().position(|id| id == skill_id) {
            if idx < 14 {
                return self.skills[idx];
            }
        }
        false
    }

    pub fn set_skill(&mut self, skill_id: &str, down: bool) {
        if skill_id == "hellbenter" {
            self.skills[14] = down;
            return;
        }
        if let Some(idx) = TABLES.skill_order.iter().position(|id| id == skill_id) {
            if idx < 14 {
                self.skills[idx] = down;
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct Player {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub width: f64,
    pub walk_width: f64,
    pub walk_depth: f64,
    pub height: f64,
    pub facing: i32,
    pub on_ground: bool,
    pub hp: f64,
    pub max_hp: f64,
    pub mp: f64,
    pub max_mp: f64,
    pub level: u32,
    pub xp: u32,
    pub xp_to_next: u32,
    pub attack_bonus: f64,
    pub mp_regen: f64,
    pub skill_power: f64,
    pub attack_speed: f64,
    pub attack_timer: f64,
    pub attack_duration: f64,
    pub attack_cycle: f64,
    pub attack_cooldown: f64,
    pub step_timer: f64,
    pub attack_hit_done: bool,
    pub combo_index: usize,
    pub combo_timer: f64,
    pub attack_buffer: f64,
    pub jump_buffer: f64,
    pub skill_id: Option<String>,
    pub skill_timer: f64,
    pub skill_hit_done: bool,
    pub skill_hits_done: usize,
    pub cast_origin_x: Option<f64>,
    pub field_spawned: bool,
    pub leap_done: bool,
    pub channel_released_at: Option<f64>,
    pub channel_tick_at: f64,
    pub air_hit_timer: f64,
    pub buffs: IndexMap<String, f64>,
    pub hellbenter_tier: u32,
    pub hellbenter_charge: u32,
    pub stance_drain_timer: f64,
    pub buff_icon_timer: f64,
    pub buff_icon_id: Option<String>,
    pub skill_cooldowns: IndexMap<String, f64>,
    pub invuln: f64,
    pub solid_invuln: f64,
    pub hurt_timer: f64,
    pub dead: bool,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EnemyBleed {
    pub damage: f64,
    pub remaining: f64,
    pub timer: f64,
    pub interval: f64,
}

#[derive(Debug, Clone)]
pub struct EnemyEntering {
    pub to_x: f64,
    pub speed: f64,
    pub time: f64,
}

#[derive(Debug, Clone)]
pub struct Enemy {
    pub id: u32,
    pub kind: String,
    pub label: String,
    pub race: String,
    pub level: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub width: f64,
    pub height: f64,
    pub facing: i32,
    pub on_ground: bool,
    pub hp: f64,
    pub max_hp: f64,
    pub damage: f64,
    pub xp: u32,
    pub behavior: String,
    pub death_style: Option<String>,
    pub bar_color: Option<String>,
    pub champion: Option<String>,
    pub evasion: f64,
    pub speed: f64,
    pub attack_range: f64,
    pub keep_range: f64,
    pub attack_windup: f64,
    pub attack_duration: f64,
    pub base_attack_windup: f64,
    pub base_attack_duration: f64,
    pub attack_cooldown_max: f64,
    pub base_speed: f64,
    pub base_damage: f64,
    pub base_attack_cooldown_max: f64,
    pub attack_cooldown: f64,
    pub step_timer: f64,
    pub attack_timer: f64,
    pub attack_kind: String,
    pub attack_hit_done: bool,
    pub attack_recovered: bool,
    pub projectile: Option<EnemyProjectileSpec>,
    pub charge_speed: f64,
    pub charge_from: f64,
    pub charge_to: f64,
    pub charge_dir: i32,
    pub slam: Option<EnemySlamSpec>,
    pub base_slam: Option<EnemySlamSpec>,
    pub slam_cooldown: f64,
    pub lunge: Option<EnemyLungeSpec>,
    pub beam: Option<EnemyBeamSpec>,
    pub beam_cooldown: f64,
    pub beam_pulse: u32,
    pub sweep: Option<EnemySweepSpec>,
    pub base_sweep: Option<EnemySweepSpec>,
    pub sweep_cooldown: f64,
    pub spin_dash: Option<EnemySpinDashSpec>,
    pub spin_dir: i32,
    pub spin_cooldown: f64,
    pub lunge_cooldown: f64,
    pub phase: u32,
    pub phase2: Option<EnemyPhase2Spec>,
    pub knockdown: f64,
    pub stun: f64,
    pub grabbed: f64,
    pub bleed: Option<EnemyBleed>,
    pub entering: Option<EnemyEntering>,
    pub super_armor: bool,
    pub knockback_x: f64,
    pub hurt_timer: f64,
    pub hit_flash_timer: f64,
    pub dead: bool,
    pub dying: f64,
    pub silhouette: bool,
    pub gone: bool,
}

#[derive(Debug, Clone)]
pub struct NativePillarState {
    pub x: f64,
    pub y: f64,
    pub origin_x: f64,
    pub damaged_at: f64,
}

#[derive(Debug, Clone)]
pub struct NativeFootprint {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub depth: f64,
}

#[derive(Debug, Clone)]
pub struct Prop {
    pub piece: String,
    pub x: f64,
    pub z: f64,
    pub scale: Option<[f64; 2]>,
    pub sort_z: Option<f64>,
    pub solid: bool,
    pub scattered: bool,
    pub hp: i32,
    pub broken: bool,
    pub broken_at: f64,
    pub gone: bool,
    pub native_pillar: Option<NativePillarState>,
    pub native_footprint: Option<NativeFootprint>,
    pub native_decoration: Option<NativeDecorationSpec>,
    pub native_animation_started_at: f64,
}

#[derive(Debug, Clone)]
pub struct Cell {
    pub col: usize,
    pub row: usize,
    pub kind: String,
    pub exits: u8,
    pub room: usize,
    pub cleared: bool,
    pub seen: bool,
    pub props: Option<Vec<Prop>>,
}

#[derive(Debug, Clone)]
pub struct Dungeon {
    pub cols: usize,
    pub rows: usize,
    pub cells: Vec<Cell>,
    pub entry: usize,
    pub boss: usize,
    pub north_x: IndexMap<String, f64>,
    pub south_shares_north_x: bool,
}

#[derive(Debug, Clone)]
pub struct RoomWaveItem {
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub level: Option<u32>,
    pub xp: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct RoomState {
    pub name: String,
    pub total: usize,
    pub cleared: bool,
    pub native_gate_opened_at: Option<f64>,
    pub cell: usize,
    pub width: f64,
    pub north_gate_bottom: Option<f64>,
    pub left_wall: f64,
    pub right_wall: f64,
    pub scatter: Option<RoomScatterSpec>,
    pub pending_wave: Vec<RoomWaveItem>,
    pub pending_waves: Vec<Vec<RoomWaveItem>>,
    pub entered_at: f64,
    pub last_wave_at: f64,
    pub wave_triggered: bool,
    pub wave_cap: usize,
    pub wave_spawned: usize,
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub id: u32,
    pub native_object: Option<u32>,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub gravity: f64,
    pub landing_stop: bool,
    pub z_sine_amp: f64,
    pub z_sine_rad_per_sec: f64,
    pub osc_y: f64,
    pub piercing: u32,
    pub hit_player: bool,
    pub radius: f64,
    pub damage: f64,
    pub life: f64,
    pub max_life: f64,
    pub traveled: f64,
    pub max_distance: f64,
    pub stopped: bool,
    pub stop_life: f64,
    pub stopped_at: f64,
    pub stop_vx: f64,
    pub stop_vy: f64,
    pub stop_gravity: f64,
}

#[derive(Debug, Clone)]
pub struct Shot {
    pub skill_id: String,
    pub x: f64,
    pub vx: f64,
    pub z: f64,
    pub facing: i32,
    pub y: f64,
    pub height: f64,
    pub depth_reach: f64,
    pub reach: f64,
    pub height_pad: f64,
    pub damage: f64,
    pub hit_index: usize,
    pub struck: Vec<u32>,
    pub struck_props: Vec<usize>,
    pub life: f64,
    pub max_life: f64,
}

#[derive(Debug, Clone)]
pub struct Field {
    pub skill_id: String,
    pub from: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub facing: i32,
    pub clock: f64,
    pub span: f64,
    pub life: f64,
    pub tick_at: f64,
    pub ticks: u32,
    pub tier: u32,
}

#[derive(Debug, Clone)]
pub struct Pickup {
    pub kind: String,
    pub name: String,
    pub tone: String,
    pub gold: u32,
    pub exp: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub radius: f64,
    pub value: f64,
    pub life: f64,
    pub from_x: f64,
    pub from_y: f64,
    pub from_z: f64,
    pub progress: f64,
    pub trail: Vec<[f64; 3]>,
}

#[derive(Debug, Clone)]
pub struct Effect {
    pub kind: String,
    pub text: String,
    pub miss: bool,
    pub critical: bool,
    pub player_hit: bool,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub gravity: f64,
    pub radius: f64,
    pub dir: i32,
    pub enemy_id: u32,
    pub seed: u32,
    pub enemy_type: String,
    pub height: f64,
    pub source_x: f64,
    pub source_z: f64,
    pub arc: bool,
    pub gold: bool,
    pub delay: f64,
    pub variant: usize,
    pub spin_dir: i32,
    pub angle: f64,
    pub angle0: f64,
    pub amount: u32,
    pub awarded_at: f64,
    pub anchor: String,
    pub life: f64,
    pub max_life: f64,
}

impl Effect {
    pub fn new(kind: &str, life: f64) -> Self {
        Self {
            kind: kind.to_string(),
            text: String::new(),
            miss: false,
            critical: false,
            player_hit: false,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            gravity: 0.0,
            radius: 0.0,
            dir: 0,
            enemy_id: 0,
            seed: 0,
            enemy_type: String::new(),
            height: 0.0,
            source_x: 0.0,
            source_z: 0.0,
            arc: true,
            gold: false,
            delay: 0.0,
            variant: 0,
            spin_dir: 1,
            angle: 0.0,
            angle0: 0.0,
            amount: 0,
            awarded_at: 0.0,
            anchor: String::new(),
            life,
            max_life: life,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoundEvent {
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub t: f64,
    pub enemy_type: Option<String>,
    pub attack_kind: Option<String>,
    pub skill_id: Option<String>,
    pub stage: Option<usize>,
    pub native_object: Option<u32>,
    pub enemy_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEntry {
    pub text: String,
    pub tone: String,
}

#[derive(Debug, Clone)]
pub struct TargetGhost {
    pub from: f64,
    pub to: f64,
    pub t: f64,
}

#[derive(Debug, Clone)]
pub struct TargetState {
    pub enemy: Enemy,
    pub dying: f64,
    pub share: f64,
    pub ghost: Option<TargetGhost>,
}

#[derive(Debug, Clone, Default)]
pub struct Stats {
    pub hits: u32,
    pub kills: u32,
    pub kill_xp: u32,
    pub kills_by_type: IndexMap<String, u32>,
    pub damage_dealt: u32,
    pub damage_taken: u32,
    pub max_hit_taken: u32,
    pub air_hits: u32,
    pub blood_orbs: u32,
    pub rooms: u32,
    pub barrels: u32,
    pub loot: u32,
    pub gold: u32,
    pub swings: u32,
    pub swings_landed: u32,
    pub last_landed_swing: i64,
    pub hits_taken: u32,
    pub combo_chains: u32,
    pub combo_hits: u32,
    pub last_hit_at: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResultRating {
    pub operation: u32,
    pub technique: u32,
    pub operation_points: u32,
    pub technique_points: u32,
    pub max_score: u32,
    pub hits: u32,
    pub score: u32,
    pub grade: String,
}

#[derive(Debug, Clone)]
pub struct SkillBuffer {
    pub id: String,
    pub ttl: f64,
}

#[derive(Debug, Clone)]
pub struct BossEngaged {
    pub name: String,
    pub at: f64,
}

#[derive(Debug, Clone)]
pub struct ReferenceProfile {
    pub level: u32,
    pub xp: u32,
    pub clear_base: u32,
    pub clear_rating: u32,
    pub clear_channel: u32,
}

#[derive(Debug, Clone)]
pub struct State {
    pub seed: u32,
    pub stage_id: String,
    pub rng_state: u32,
    pub time: f64,
    pub hit_stop: f64,
    pub skill_buffer: Option<SkillBuffer>,
    pub dungeon: Option<Dungeon>,
    pub cell: usize,
    pub entry_door: Option<String>,
    pub room: Option<RoomState>,
    pub band_back_y: f64,
    pub band_visual_back_y: Option<f64>,
    pub camera_x: f64,
    pub camera_y: f64,
    pub shake_amp: f64,
    pub shake_timer: f64,
    pub shake_duration: f64,
    pub target: Option<TargetState>,
    pub player: Player,
    pub enemies: Vec<Enemy>,
    pub props: Vec<Prop>,
    pub projectiles: Vec<Projectile>,
    pub pickups: Vec<Pickup>,
    pub effects: Vec<Effect>,
    pub sounds: Vec<SoundEvent>,
    pub fields: Vec<Field>,
    pub shots: Vec<Shot>,
    pub next_enemy_id: u32,
    pub next_projectile_id: u32,
    pub stats: Stats,
    pub log: Vec<LogEntry>,
    pub swing_seq: i64,
    pub boss_engaged: Option<BossEngaged>,
    pub intro_t: Option<f64>,
    pub title_t: f64,
    pub finished_at: Option<f64>,
    pub result_rating: Option<ResultRating>,
    pub transition: f64,
    pub victory: bool,
    pub post_clear: bool,
    pub victory_delay: Option<f64>,
    pub defeat: bool,
    pub xp_gauge_flash_until: f64,
    pub reference_profile: Option<ReferenceProfile>,
    pub clear_experience: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CreateStateOptions<'a> {
    pub seed: Option<u32>,
    pub stage: Option<&'a str>,
    pub cell: Option<usize>,
    pub start_x: Option<f64>,
    pub reference_profile: bool,
}
