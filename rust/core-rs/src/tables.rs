//! Embedded static data tables deserialized from `tables.json`.

use indexmap::IndexMap;
use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBuffOpen {
    #[serde(default)]
    pub hp_ratio: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBuffDrain {
    #[serde(default)]
    pub interval: f64,
    #[serde(default)]
    pub hp: f64,
    #[serde(default)]
    pub hp_ratio: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBuffBleed {
    pub damage: f64,
    pub growth: f64,
    pub duration: f64,
    pub interval: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBuffGather {
    pub delay: f64,
    pub life: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBuffSpec {
    pub id: String,
    pub duration: Option<f64>,
    #[serde(default)]
    pub toggle: bool,
    #[serde(default)]
    pub attack_speed: Option<f64>,
    #[serde(default)]
    pub attack_power: Option<f64>,
    #[serde(default)]
    pub move_speed: Option<f64>,
    #[serde(default)]
    pub cooldown_scale: Option<f64>,
    #[serde(default)]
    pub hit_recovery: Option<f64>,
    #[serde(default)]
    pub accuracy: Option<f64>,
    #[serde(default)]
    pub sword_tier: Option<u32>,
    #[serde(default)]
    pub open: Option<SkillBuffOpen>,
    #[serde(default)]
    pub drain: Option<SkillBuffDrain>,
    #[serde(default)]
    pub bleed: Option<SkillBuffBleed>,
    #[serde(default)]
    pub gather: Option<SkillBuffGather>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillShotSpec {
    pub hit: usize,
    pub ahead: f64,
    pub speed: f64,
    pub reach: f64,
    pub height_pad: f64,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub depth_reach: Option<f64>,
    pub life: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillShockwaveSpec {
    pub reach: f64,
    pub height_pad: f64,
    pub damage: f64,
    pub growth: f64,
    pub knockback_x: f64,
    #[serde(default, deserialize_with = "de_bool_or_f64")]
    pub knockdown: f64,
    #[serde(default)]
    pub launch: f64,
    #[serde(default)]
    pub extra_wave_from_level: Option<u32>,
    #[serde(default)]
    pub arc: Option<bool>,
    #[serde(default)]
    pub arc_offset: Option<f64>,
    #[serde(default)]
    pub visual: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFieldTickSpec {
    #[serde(default)]
    pub from: f64,
    #[serde(default)]
    pub until: Option<f64>,
    pub interval: f64,
    pub radius: f64,
    pub depth: f64,
    pub damage: f64,
    pub growth: f64,
    #[serde(default)]
    pub stun: f64,
    #[serde(default)]
    pub knockdown_last: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFieldSpec {
    pub from: f64,
    #[serde(default)]
    pub at: Option<f64>,
    #[serde(default)]
    pub span: Option<f64>,
    #[serde(default)]
    pub forward: f64,
    pub linger: f64,
    #[serde(default)]
    pub tick: Option<SkillFieldTickSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillChannelSpec {
    pub entrance: f64,
    pub hold: f64,
    pub tail: f64,
    pub tick: f64,
    pub tick_damage: f64,
    #[serde(default)]
    pub tick_growth: f64,
    pub pull: f64,
    pub stop_at: f64,
    #[serde(default)]
    pub hits: Vec<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGrabSpec {
    pub hold: f64,
    pub slam_knockdown: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum BoolOrF64 {
    Bool(bool),
    Num(f64),
}

fn de_bool_or_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match BoolOrF64::deserialize(deserializer)? {
        BoolOrF64::Bool(true) => Ok(1.0),
        BoolOrF64::Bool(false) => Ok(0.0),
        BoolOrF64::Num(v) => Ok(v),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSpec {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub key: String,
    pub mp: f64,
    pub cooldown: f64,
    pub duration: f64,
    pub active_from: f64,
    pub active_to: f64,
    pub reach: f64,
    pub height_pad: f64,
    #[serde(default)]
    pub depth_reach: Option<f64>,
    #[serde(default)]
    pub radius: f64,
    pub damage: f64,
    pub growth: f64,
    pub knockback_x: f64,
    #[serde(default)]
    pub hits: Option<usize>,
    #[serde(default)]
    pub hit_at: Option<Vec<f64>>,
    #[serde(default)]
    pub launch: f64,
    #[serde(default)]
    pub juggle: bool,
    #[serde(default, deserialize_with = "de_bool_or_f64")]
    pub knockdown: f64,
    #[serde(default)]
    pub knockdown_chance: Option<f64>,
    #[serde(default)]
    pub stun: f64,
    #[serde(default)]
    pub drain: f64,
    #[serde(default)]
    pub dash: f64,
    #[serde(default)]
    pub invuln: f64,
    #[serde(default)]
    pub super_armor: bool,
    #[serde(default)]
    pub ground_only: bool,
    #[serde(default)]
    pub leap: f64,
    #[serde(default)]
    pub leap_from: Option<f64>,
    #[serde(default)]
    pub leap_up: Option<f64>,
    #[serde(default)]
    pub leap_gravity: Option<f64>,
    #[serde(default)]
    pub leap_invuln: Option<f64>,
    #[serde(default)]
    pub dive: f64,
    #[serde(default)]
    pub dive_forward: f64,
    #[serde(default)]
    pub advance: f64,
    #[serde(default)]
    pub advance_at: f64,
    #[serde(default)]
    pub advance_ramp: Option<f64>,
    #[serde(default)]
    pub advance_back: Option<f64>,
    #[serde(default)]
    pub cast_icon: Option<f64>,
    #[serde(default)]
    pub shockwave_hit: Option<usize>,
    #[serde(default)]
    pub buff: Option<SkillBuffSpec>,
    #[serde(default)]
    pub shot: Option<SkillShotSpec>,
    #[serde(default)]
    pub shockwave: Option<SkillShockwaveSpec>,
    #[serde(default)]
    pub field: Option<SkillFieldSpec>,
    #[serde(default)]
    pub channel: Option<SkillChannelSpec>,
    #[serde(default)]
    pub grab: Option<SkillGrabSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyProjectileSpec {
    #[serde(default)]
    pub native_object: Option<u32>,
    pub speed: f64,
    pub radius: f64,
    pub life: f64,
    pub max_distance: f64,
    #[serde(default)]
    pub origin_x: Option<f64>,
    pub height: f64,
    #[serde(default)]
    pub horizontal: bool,
    #[serde(default)]
    pub initial_vy: Option<f64>,
    #[serde(default)]
    pub gravity: f64,
    #[serde(default)]
    pub landing_stop: bool,
    #[serde(default)]
    pub z_sine_amp: f64,
    #[serde(default)]
    pub z_sine_rad_per_sec: f64,
    #[serde(default)]
    pub piercing: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemySlamSpec {
    pub commit: f64,
    pub radius: f64,
    pub windup: f64,
    pub recovery: f64,
    pub cooldown: f64,
    pub damage: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemySweepSpec {
    pub commit: f64,
    pub offset: f64,
    pub radius: f64,
    pub windup: f64,
    pub recovery: f64,
    pub cooldown: f64,
    pub damage: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyLungeSpec {
    pub min_gap: f64,
    pub gap: f64,
    #[serde(default)]
    pub range: f64,
    pub speed: f64,
    pub windup: f64,
    pub recovery: f64,
    pub cooldown: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyBeamSpec {
    pub hp_ratio: f64,
    pub windup: f64,
    pub duration: f64,
    pub cooldown: f64,
    pub range: f64,
    pub damage: f64,
    #[serde(default)]
    pub beams: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemySpinDashSpec {
    pub commit: f64,
    pub radius: f64,
    pub speed: f64,
    pub windup: f64,
    pub duration: f64,
    pub recovery: f64,
    pub cooldown: f64,
    pub damage: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyPhase2Spec {
    pub hp_ratio: f64,
    pub speed_scale: f64,
    pub damage_scale: f64,
    pub cooldown_scale: f64,
    pub windup_scale: f64,
    #[serde(default)]
    pub slam_radius_scale: f64,
    #[serde(default)]
    pub slam_cooldown_scale: f64,
    #[serde(default)]
    pub banner: String,
    #[serde(default)]
    pub lunge: Option<EnemyLungeSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyTypeSpec {
    pub label: String,
    pub race: String,
    #[serde(default = "default_one")]
    pub level: u32,
    #[serde(default = "default_melee")]
    pub behavior: String,
    pub max_hp: f64,
    pub xp: u32,
    pub width: f64,
    pub height: f64,
    pub speed: f64,
    pub damage: f64,
    pub attack_range: f64,
    #[serde(default)]
    pub keep_range: f64,
    pub attack_windup: f64,
    pub attack_duration: f64,
    pub attack_cooldown: f64,
    pub knockback_x: f64,
    #[serde(default)]
    pub evasion: f64,
    #[serde(default)]
    pub death_style: Option<String>,
    #[serde(default)]
    pub bar_color: Option<String>,
    #[serde(default)]
    pub champion: Option<String>,
    #[serde(default)]
    pub charge_speed: f64,
    #[serde(default)]
    pub charge_from: f64,
    #[serde(default)]
    pub charge_to: f64,
    #[serde(default)]
    pub projectile: Option<EnemyProjectileSpec>,
    #[serde(default)]
    pub slam: Option<EnemySlamSpec>,
    #[serde(default)]
    pub sweep: Option<EnemySweepSpec>,
    #[serde(default)]
    pub lunge: Option<EnemyLungeSpec>,
    #[serde(default)]
    pub beam: Option<EnemyBeamSpec>,
    #[serde(default)]
    pub spin_dash: Option<EnemySpinDashSpec>,
    #[serde(default)]
    pub phase2: Option<EnemyPhase2Spec>,
}

fn default_one() -> u32 {
    1
}
fn default_melee() -> String {
    "melee".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomBandSpec {
    pub back_y: f64,
    #[serde(default)]
    pub visual_back_y: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomScatterSpec {
    #[serde(default)]
    pub low: Option<usize>,
    #[serde(default)]
    pub flowers: Option<usize>,
    #[serde(default)]
    pub tall: Option<usize>,
    #[serde(default)]
    pub solid: Option<usize>,
    #[serde(default)]
    pub barrels: Option<usize>,
    #[serde(default)]
    pub stones: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomEnemyEntry {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: f64,
    #[serde(default)]
    pub depth: Option<f64>,
    #[serde(default)]
    pub wave: Option<u32>,
    #[serde(default)]
    pub level: Option<u32>,
    #[serde(default)]
    pub xp: Option<u32>,
    #[serde(default)]
    pub activation_delay: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDecorationSpec {
    pub x: f64,
    pub y: f64,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomPropEntry {
    pub piece: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub depth: Option<f64>,
    #[serde(default)]
    pub scale: Option<[f64; 2]>,
    #[serde(default)]
    pub sort_z: Option<f64>,
    #[serde(default)]
    pub native_pillar: Option<Vec<f64>>,
    #[serde(default)]
    pub native_rock: Option<Vec<f64>>,
    #[serde(default)]
    pub native_decoration: Option<NativeDecorationSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGateFrame {
    pub offset: [f64; 2],
    pub rect: [f64; 4],
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGateParts {
    pub frame: NativeGateFrame,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePathGate {
    pub x: f64,
    pub z: f64,
    pub anchor: [f64; 2],
    #[serde(default)]
    pub sprite: Option<String>,
    pub parts: NativeGateParts,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSpec {
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub north_gate_bottom: Option<f64>,
    #[serde(default)]
    pub cap: Option<usize>,
    #[serde(default)]
    pub band: Option<RoomBandSpec>,
    #[serde(default)]
    pub scatter: Option<RoomScatterSpec>,
    #[serde(default)]
    pub enemies: Vec<RoomEnemyEntry>,
    #[serde(default)]
    pub props: Vec<RoomPropEntry>,
    #[serde(default)]
    pub closeback: Option<serde_json::Value>,
    #[serde(default)]
    pub native_foreground: Option<serde_json::Value>,
    #[serde(default)]
    pub native_path_gates: Option<IndexMap<String, NativePathGate>>,
    #[serde(default)]
    pub native_ground: Option<serde_json::Value>,
    #[serde(default)]
    pub native_mid: Option<serde_json::Value>,
    #[serde(default)]
    pub native_far: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DungeonSpec {
    pub cols: usize,
    pub rows: usize,
    pub shape: Vec<String>,
    pub entry: [usize; 2],
    pub boss: [usize; 2],
    pub entry_room: usize,
    pub boss_room: usize,
    #[serde(default)]
    pub pins: IndexMap<String, usize>,
    #[serde(default)]
    pub north_x: IndexMap<String, f64>,
    #[serde(default)]
    pub south_shares_north_x: bool,
    pub links: Vec<[[usize; 2]; 2]>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSpec {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub boss_banner: Option<String>,
    #[serde(default)]
    pub props_are_measured: bool,
    #[serde(default)]
    pub dungeon: Option<DungeonSpec>,
    #[serde(default)]
    pub rooms: Vec<RoomSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum HitStopValue {
    Single(f64),
    Multi(Vec<f64>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreTables {
    #[serde(rename = "SKILLS")]
    pub skills: IndexMap<String, SkillSpec>,
    #[serde(rename = "SKILL_HIT_STOP")]
    pub skill_hit_stop: IndexMap<String, HitStopValue>,
    #[serde(rename = "SKILL_ORDER")]
    pub skill_order: Vec<String>,
    #[serde(rename = "CASTABLE_SKILLS")]
    pub castable_skills: Vec<String>,
    #[serde(rename = "ENEMY_TYPES")]
    pub enemy_types: IndexMap<String, EnemyTypeSpec>,
    #[serde(rename = "STAGES")]
    pub stages: IndexMap<String, StageSpec>,
}

pub static TABLES: LazyLock<CoreTables> = LazyLock::new(|| {
    // INFALLIBLE: embedded compile-time JSON generated from src/core.js
    serde_json::from_str(include_str!("tables.json")).expect("INFALLIBLE: valid core tables.json")
});

pub fn skill_hit_stop(skill_id: &str, hit_index: usize) -> f64 {
    match TABLES.skill_hit_stop.get(skill_id) {
        None => 0.0,
        Some(HitStopValue::Single(v)) => *v,
        Some(HitStopValue::Multi(list)) => {
            if list.is_empty() {
                0.0
            } else {
                list[hit_index.min(list.len() - 1)]
            }
        }
    }
}
