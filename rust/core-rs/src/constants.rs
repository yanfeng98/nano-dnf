//! Core simulation constants matching `src/core.js`.

pub const FPS: f64 = 60.0;
pub const DT: f64 = 1.0 / FPS;

pub const ARENA_WIDTH: f64 = 960.0;
pub const ARENA_HEIGHT: f64 = 540.0;
pub const ARENA_GROUND_Y: f64 = 430.0;

pub const VIEW_WIDTH: f64 = 720.0;
pub const VIEW_HEIGHT: f64 = ARENA_HEIGHT;
pub const VIEW_LEFT: f64 = (ARENA_WIDTH - VIEW_WIDTH) / 2.0;

pub const ROOM_DEFAULT_WIDTH: f64 = 960.0;
pub const ROOM_LEFT_WALL: f64 = 24.0;
pub const ROOM_RIGHT_WALL: f64 = 936.0;

pub const ART_HEIGHT: f64 = 84.0;
pub const VIDEO_PX: f64 = ART_HEIGHT / 265.0;

pub const CAMERA_FIGURE: f64 = ARENA_HEIGHT / (1080.0 / 265.0);
pub const CAMERA_ZOOM: f64 = CAMERA_FIGURE / ART_HEIGHT;
pub const CAMERA_DEADZONE_SHARE: f64 = 224.0 / 1440.0;

pub fn window_width() -> f64 {
    VIEW_WIDTH / CAMERA_ZOOM
}

pub const NATIVE_SCALE: f64 = (VIEW_WIDTH / 640.0) / CAMERA_ZOOM;

pub fn native_ground_x(native_x: f64) -> f64 {
    native_x * NATIVE_SCALE
}

pub fn native_ground_z(native_y: f64) -> f64 {
    (ARENA_GROUND_Y - native_y * NATIVE_SCALE) / DEPTH_SCALE
}

pub const PHYSICS_GRAVITY: f64 = 2200.0;
pub const PHYSICS_MOVE_SPEED: f64 = 105.0;
pub const PHYSICS_JUMP_VELOCITY: f64 = -760.0;
pub const PHYSICS_MAX_FALL_SPEED: f64 = 1400.0;
pub const PHYSICS_DEPTH_SPEED_RATIO: f64 = 0.40;
pub const PHYSICS_ENEMY_DEPTH_SPEED_RATIO: f64 = 0.75;

pub const DEPTH_SCALE: f64 = 0.22;

pub fn depth_lift(z: f64) -> f64 {
    z * DEPTH_SCALE
}

pub fn enemy_depth_speed(floor_speed: f64) -> f64 {
    (floor_speed * PHYSICS_ENEMY_DEPTH_SPEED_RATIO) / DEPTH_SCALE
}

pub fn depth_speed() -> f64 {
    (PHYSICS_MOVE_SPEED * PHYSICS_DEPTH_SPEED_RATIO) / DEPTH_SCALE
}

pub const BAND_DEFAULT_BACK_Y: f64 = 310.0;

pub fn band_depth(back_y: f64) -> f64 {
    (ARENA_GROUND_Y - back_y) / DEPTH_SCALE
}

pub const SLAYER_HEIGHT: f64 = 156.0;

pub const DEPTH_REACH_MELEE: f64 = 0.3;
pub const DEPTH_REACH_SPIN: f64 = 0.6;
pub const DEPTH_REACH_BREAKABLE: f64 = 1.6;
pub const DEPTH_REACH_FLOOR: f64 = 0.75;

pub fn in_reach_of(z: f64, at: f64, reach: f64) -> bool {
    let half = reach * SLAYER_HEIGHT;
    let from = at - half;
    z >= from && z <= from + half * 2.0
}

pub const ATTACK_STAGE_DAMAGES: [f64; 3] = [8.0, 10.0, 11.0];
pub const HIT_STOP_STAGE: [f64; 3] = [0.05, 0.05, 0.075];
pub const HIT_STOP_KILL: f64 = 0.1;
pub const HIT_STOP_HURT: f64 = 0.0;
pub const SKILL_BUFFER_TTL: f64 = 0.4;

pub const PLAYER_MAX_HP: f64 = 240.0;
pub const PLAYER_MAX_MP: f64 = 100.0;
pub const PLAYER_WIDTH: f64 = 34.0;
pub const PLAYER_WALK_WIDTH: f64 = 40.0 * (VIEW_WIDTH / 640.0) / CAMERA_ZOOM;
pub const PLAYER_WALK_DEPTH: f64 = 10.0 * (VIEW_WIDTH / 640.0) / CAMERA_ZOOM / DEPTH_SCALE;
pub const PLAYER_HEIGHT: f64 = 64.0;
pub const PLAYER_ATTACK_DURATION: f64 = 0.22;
pub const PLAYER_ATTACK_COOLDOWN: f64 = 0.16;
pub const PLAYER_ATTACK_SPEED: f64 = 1.0;
pub const PLAYER_ATTACK_ACTIVE_FROM: f64 = 0.3;
pub const PLAYER_ATTACK_ACTIVE_TO: f64 = 0.64;
pub const PLAYER_ATTACK_REACH: f64 = 68.0;
pub const PLAYER_ATTACK_HEIGHT_PAD: f64 = 10.0;
pub const PLAYER_COMBO_WINDOW: f64 = 0.45;
pub const PLAYER_MAX_COMBO: usize = 3;
pub const PLAYER_ATTACK_BUFFER: f64 = 0.5;
pub const PLAYER_JUMP_BUFFER: f64 = 0.12;
pub const PLAYER_INVULN_AFTER_HIT: f64 = 0.9;
pub const PLAYER_HURT_STUN: f64 = 0.22;
pub const PLAYER_KNOCKBACK_X: f64 = 190.0;
pub const PLAYER_MP_REGEN_PER_SECOND: f64 = 7.0;

pub const MIN_ATTACK_SPEED: f64 = 0.5;
pub const MAX_ATTACK_SPEED: f64 = 3.0;

pub const EXP_FLOAT_DURATION: f64 = 24.0 / 30.0;
pub const EXP_FLOAT_HEAD_GAP: f64 = 18.0;

pub const PROG_BASE_XP_TO_NEXT: u32 = 30;
pub const PROG_GROWTH: f64 = 1.6;
pub const PROG_MAX_HP_PER_LEVEL: f64 = 12.0;
pub const PROG_MAX_MP_PER_LEVEL: f64 = 5.0;
pub const PROG_ATTACK_PER_LEVEL: f64 = 2.0;
pub const PROG_HEAL_ON_LEVEL_UP: f64 = 12.0;
pub const PROG_MAX_LEVEL: u32 = 12;
pub const PROG_LEVEL_UP_FLASH_DURATION: f64 = 7.0 / 6.0;

pub const HELLBENTER_TIERS: u32 = 8;
pub const HELLBENTER_HITS_PER_TIER: u32 = 10;
pub const HELLBENTER_KILL_TIERS: u32 = 1;
pub const HELLBENTER_STRAND_LIFE: f64 = 0.32;

pub const BLOOD_ORB_CHANCE: f64 = 0.34;
pub const BLOOD_ORB_HEAL: f64 = 4.0;
pub const BLOOD_ORB_RADIUS: f64 = 20.0;
pub const BLOOD_ORB_FLIGHT_SECONDS: f64 = 0.55;
pub const BLOOD_ORB_LIFETIME_SECONDS: f64 = 1.2;
pub const BLOOD_ORB_TRAIL_STEPS: usize = 6;
pub const BLOOD_ORB_TRAIL_STEP: f64 = 0.55;
pub const CHEST_OF_HEIGHT: f64 = 0.75;

pub const TRANSITION_DUR: f64 = 0.3;

pub const DOOR_SIDE: f64 = 60.0;
pub const DOOR_DEPTH: f64 = 46.0;
pub const DOOR_SPAN: f64 = 80.0;
pub const DOOR_STAND: f64 = 74.0;
pub const DOOR_SHARE: f64 = 0.5;

pub const DOOR_CLEAR_SIDE: f64 = DOOR_SIDE + DOOR_STAND;
pub const DOOR_CLEAR_SPAN: f64 = DOOR_SPAN + DOOR_STAND;
pub const DOOR_CLEAR_DEPTH: f64 = DOOR_DEPTH + DOOR_STAND;

pub const GATE_ART_N: [f64; 2] = [157.0, 198.0];
pub const GATE_ART_S: [f64; 2] = [192.0, 118.0];
pub const GATE_ART_SIDE: [f64; 2] = [131.0, 240.0];
pub const GATE_DOWN_BOTTOM: f64 = 482.0;
pub const GATE_DOWN_SCALE: f64 = 0.533;

pub const BREAK_ANIM: f64 = 0.42;

pub const DEATH_LIE: f64 = 0.2;
pub const DEATH_SHAPE: f64 = 0.3;
pub const DEATH_CHUNKS: f64 = 0.45;
pub const DEATH_BOSS_LIE: f64 = 0.02;
pub const DEATH_BOSS_SMOKE: f64 = 0.9;
pub const DEATH_BOSS_CHUNKS: f64 = 3.0;
pub const DEATH_BOSS_RAYS: f64 = 1.8;

pub const LOOT_REACH: f64 = 34.0;
pub const LOOT_LIFE: f64 = 1e9;
pub const LOOT_WHITE: [&str; 6] = [
    "破旧的皮革",
    "碎片",
    "哥布林毛皮",
    "生锈的铁片",
    "煤尘",
    "哥布林手骨",
];
pub const LOOT_CYAN: [&str; 5] = [
    "最下级硬化剂",
    "炉岩炭",
    "冰冻水",
    "诺顿的新手HP药剂",
    "古老的法杖",
];

pub const LOG_LINES: usize = 8;

pub const INTRO_ART_IN: f64 = 0.3;
pub const INTRO_ART_HOLD: f64 = 1.5;
pub const INTRO_ART_OUT: f64 = 0.24;
pub const INTRO_BLACK: f64 = 0.3;
pub const INTRO_TITLE: f64 = 4.2;
pub const INTRO_TITLE_OUT: f64 = 0.17;

pub fn intro_length() -> f64 {
    INTRO_ART_IN + INTRO_ART_HOLD + INTRO_ART_OUT + INTRO_BLACK
}

pub const DEFAULT_STAGE: &str = "mirkwood";
pub const DEFAULT_SEED: u32 = 20260915;

pub const ROUTE_GRID_STEP: f64 = 12.0;

pub const TARGET_DEATH_BLINK: f64 = 1.3;
pub const TARGET_BOSS_DEATH_HOLD: f64 = 1.0;
pub const TARGET_GHOST_FADE: f64 = 0.8;

pub const HIT_WORD_TEXT: &str = "无法浮空";
pub const HIT_WORD_LIFE: f64 = 0.6;
pub const HIT_WORD_DX: f64 = 30.0 * VIDEO_PX;
pub const HIT_WORD_DY: f64 = 10.0 * VIDEO_PX;

pub const RATING_COMPONENT_MAX: f64 = 70.0;
pub const RATING_HIT_COST: f64 = 4.0;
pub const RATING_HIT_COST_CAP: f64 = 50.0;
pub const RATING_PAR_SECONDS: f64 = 300.0;
pub const RATING_TIME_COST: f64 = 30.0;
pub const RATING_LEVEL_BONUS: f64 = 2.0;
pub const RATING_LEVEL_BONUS_CAP: f64 = 10.0;
pub const RATING_COMBO_BASELINE: f64 = 6.0;
