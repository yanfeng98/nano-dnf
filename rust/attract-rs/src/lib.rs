//! Title-screen attract-mode self-playing demo (`src/attract.js`).

use core_rs::constants::*;
use core_rs::dungeon::{current_cell, door_neighbour, door_x, route_step, MINIMAP_DIRS};
use core_rs::types::{CreateStateOptions, Enemy, Input, State};
use core_rs::{create_state, step, TABLES};
use std::collections::{HashMap, VecDeque};

pub const SKILL_GAP: f64 = 2.6;
pub const APPROACH: f64 = 58.0;
pub const ROW_REACH: f64 = DEPTH_REACH_MELEE * SLAYER_HEIGHT;
pub const LEAP_GAP: f64 = 120.0;
pub const MAX_SECONDS: f64 = 105.0;
pub const HOLD_SECONDS: f64 = 2.5;

#[derive(Debug, Clone)]
pub struct AttractSession {
    pub seed: u32,
    pub state: State,
    pub seconds: f64,
    pub loops: u32,
    pub phase2_runs: u32,
    pub clears: u32,
    pub skill_wait: f64,
    pub finished: bool,
    pub hold_wait: f64,
    pub counted_phase2: bool,
    pub counted_clear: bool,
}

pub fn create(seed: Option<u32>) -> AttractSession {
    let s = seed.unwrap_or(DEFAULT_SEED);
    let state = create_state(&CreateStateOptions {
        seed: Some(s),
        ..Default::default()
    });
    AttractSession {
        seed: s,
        state,
        seconds: 0.0,
        loops: 0,
        phase2_runs: 0,
        clears: 0,
        skill_wait: 0.0,
        finished: false,
        hold_wait: 0.0,
        counted_phase2: false,
        counted_clear: false,
    }
}

pub fn reset(session: &mut AttractSession) {
    session.state = create_state(&CreateStateOptions {
        seed: Some(session.seed),
        ..Default::default()
    });
    session.seconds = 0.0;
    session.skill_wait = 0.0;
    session.finished = false;
    session.hold_wait = 0.0;
    session.counted_phase2 = false;
    session.counted_clear = false;
}

fn nearest_enemy(state: &State) -> Option<&Enemy> {
    let mut best: Option<&Enemy> = None;
    let mut best_dist = f64::INFINITY;
    for enemy in &state.enemies {
        if enemy.dead {
            continue;
        }
        let d = (enemy.x - state.player.x).abs() + (enemy.z - state.player.z).abs();
        if d < best_dist {
            best = Some(enemy);
            best_dist = d;
        }
    }
    best
}

fn walk(state: &State, input: &mut Input, target_x: f64, target_z: f64) {
    let mut mv = route_step(state, target_x, target_z, None, None, None, false);
    if mv[0] == 0 && mv[1] == 0 {
        let offsets = [[56.0, 0.0], [-56.0, 0.0], [0.0, -48.0], [0.0, 48.0]];
        for off in offsets {
            mv = route_step(
                state,
                target_x + off[0],
                target_z + off[1],
                None,
                None,
                None,
                false,
            );
            if mv[0] != 0 || mv[1] != 0 {
                break;
            }
        }
    }
    if mv[0] > 0 {
        input.right = true;
    } else if mv[0] < 0 {
        input.left = true;
    }
    if mv[1] > 0 {
        input.up = true;
    } else if mv[1] < 0 {
        input.down = true;
    }
}

fn route_to_boss(state: &State) -> Vec<&'static str> {
    let Some(ref dun) = state.dungeon else {
        return Vec::new();
    };
    let start = state.cell;
    let goal = dun.boss;
    if start == goal {
        return Vec::new();
    }
    let mut came: HashMap<usize, Option<(usize, &'static str)>> = HashMap::new();
    came.insert(start, None);
    let mut queue = VecDeque::new();
    queue.push_back(start);
    while let Some(at) = queue.pop_front() {
        for dir in MINIMAP_DIRS {
            let Some(next) = door_neighbour(dun, &dun.cells[at], dir) else {
                continue;
            };
            if came.contains_key(&next) {
                continue;
            }
            came.insert(next, Some((at, dir)));
            queue.push_back(next);
        }
    }
    if !came.contains_key(&goal) {
        return Vec::new();
    }
    let mut steps = Vec::new();
    let mut walk_idx = goal;
    while walk_idx != start {
        if let Some(Some((prev, dir))) = came.get(&walk_idx) {
            steps.push(*dir);
            walk_idx = *prev;
        } else {
            break;
        }
    }
    steps.reverse();
    steps
}

fn open_door_goal(state: &State) -> Option<(&'static str, f64)> {
    let cell = current_cell(state)?;
    let route = route_to_boss(state);
    let dir = *route.first()?;
    Some((dir, door_x(state, cell, dir)))
}

fn ready_skill(session: &mut AttractSession) -> Option<String> {
    if session.skill_wait > 0.0 {
        return None;
    }
    let player = &session.state.player;
    for sid in &TABLES.skill_order {
        let Some(spec) = TABLES.skills.get(sid) else {
            continue;
        };
        if player.skill_cooldowns.get(sid).copied().unwrap_or(0.0) > 0.0 {
            continue;
        }
        if player.mp < spec.mp {
            continue;
        }
        session.skill_wait = SKILL_GAP;
        return Some(sid.clone());
    }
    None
}

pub fn decide(session: &mut AttractSession) -> Input {
    let mut input = Input::default();
    if session.state.victory || session.state.defeat {
        return input;
    }
    let Some(target) = nearest_enemy(&session.state) else {
        let Some((dir, dx_door)) = open_door_goal(&session.state) else {
            input.right = true;
            return input;
        };
        let doorway_x = match dir {
            "E" => core_rs::room_right(&session.state) - DOOR_SIDE / 2.0,
            "W" => core_rs::room_left(&session.state) + DOOR_SIDE / 2.0,
            _ => dx_door,
        };
        let doorway_z = match dir {
            "N" => band_depth(session.state.band_back_y) - DOOR_DEPTH / 2.0,
            "S" => DOOR_DEPTH / 2.0,
            _ => session.state.player.z,
        };
        walk(&session.state, &mut input, doorway_x, doorway_z);
        return input;
    };

    let dx = target.x - session.state.player.x;
    let dz = target.z - session.state.player.z;
    if dx.abs() > APPROACH || dz.abs() > ROW_REACH {
        let tx = target.x;
        let tz = target.z;
        walk(&session.state, &mut input, tx, tz);
        return input;
    }

    if dx < 0.0 {
        input.left = true;
    } else {
        input.right = true;
    }
    input.attack = true;
    if session.state.player.on_ground && target.y < session.state.player.y - LEAP_GAP {
        input.jump = true;
    }
    if let Some(sid) = ready_skill(session) {
        input.set_skill(&sid, true);
    }
    input
}

pub fn step_session(session: &mut AttractSession, dt_override: Option<f64>) {
    let dt = dt_override.filter(|&d| d > 0.0).unwrap_or(DT);
    if session.finished
        || session.state.victory
        || session.state.defeat
        || session.seconds >= MAX_SECONDS
    {
        if !session.finished {
            session.finished = true;
            session.hold_wait = HOLD_SECONDS;
        }
        session.hold_wait = (session.hold_wait - dt).max(0.0);
        if session.hold_wait == 0.0 {
            session.loops += 1;
            reset(session);
        }
        return;
    }

    session.skill_wait = (session.skill_wait - dt).max(0.0);
    let inp = decide(session);
    step(&mut session.state, &inp, Some(dt));
    session.seconds += dt;

    if let Some(boss) = session.state.enemies.iter().find(|e| e.kind == "boss") {
        if boss.phase >= 2 && !session.counted_phase2 {
            session.counted_phase2 = true;
            session.phase2_runs += 1;
        }
    }
    if session.state.victory && !session.counted_clear {
        session.counted_clear = true;
        session.clears += 1;
    }
    if session.state.victory || session.state.defeat || session.seconds >= MAX_SECONDS {
        session.finished = true;
        session.hold_wait = HOLD_SECONDS;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attract_demo_advances() {
        let mut s = create(None);
        for _ in 0..600 {
            step_session(&mut s, None);
        }
        assert!(s.seconds > 9.0);
        assert!(s.state.stats.swings > 0);
    }
}
