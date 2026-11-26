//! Dungeon layout, room setup, prop placement, doorway clearance, and BFS routing (`src/core.js`).

use crate::constants::*;
use crate::enemy::create_enemy;
use crate::tables::*;
use crate::types::*;
use indexmap::IndexMap;
use std::collections::{HashMap, VecDeque};

pub const MINIMAP_DIR_N: u8 = 1;
pub const MINIMAP_DIR_E: u8 = 2;
pub const MINIMAP_DIR_S: u8 = 4;
pub const MINIMAP_DIR_W: u8 = 8;

pub const MINIMAP_DIRS: [&str; 4] = ["N", "E", "S", "W"];

pub struct MinimapStep {
    pub dir: &'static str,
    pub dx: isize,
    pub dy: isize,
    pub bit: u8,
    pub back: &'static str,
}

pub const MINIMAP_STEPS: [MinimapStep; 4] = [
    MinimapStep {
        dir: "N",
        dx: 0,
        dy: -1,
        bit: MINIMAP_DIR_N,
        back: "S",
    },
    MinimapStep {
        dir: "E",
        dx: 1,
        dy: 0,
        bit: MINIMAP_DIR_E,
        back: "W",
    },
    MinimapStep {
        dir: "S",
        dx: 0,
        dy: 1,
        bit: MINIMAP_DIR_S,
        back: "N",
    },
    MinimapStep {
        dir: "W",
        dx: -1,
        dy: 0,
        bit: MINIMAP_DIR_W,
        back: "E",
    },
];

pub fn minimap_step(dir: &str) -> Option<&'static MinimapStep> {
    MINIMAP_STEPS.iter().find(|s| s.dir == dir)
}

pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 1 } else { seed },
        }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

pub fn room_width(state: &State) -> f64 {
    state
        .room
        .as_ref()
        .map(|r| r.width)
        .unwrap_or(ROOM_DEFAULT_WIDTH)
}

pub fn room_left(state: &State) -> f64 {
    state
        .room
        .as_ref()
        .map(|r| r.left_wall)
        .unwrap_or(ROOM_LEFT_WALL)
}

pub fn room_right(state: &State) -> f64 {
    state
        .room
        .as_ref()
        .map(|r| r.right_wall)
        .unwrap_or(ROOM_RIGHT_WALL)
}

pub fn cell_key(col: usize, row: usize) -> String {
    format!("{col},{row}")
}

pub fn index_of_cell(cells: &[Cell], col: usize, row: usize) -> Option<usize> {
    cells.iter().position(|c| c.col == col && c.row == row)
}

pub fn current_cell(state: &State) -> Option<&Cell> {
    state.dungeon.as_ref()?.cells.get(state.cell)
}

pub fn current_cell_mut(state: &mut State) -> Option<&mut Cell> {
    let idx = state.cell;
    state.dungeon.as_mut()?.cells.get_mut(idx)
}

pub fn current_spec(state: &State) -> Option<&'static RoomSpec> {
    let cell = current_cell(state)?;
    let stage = TABLES.stages.get(&state.stage_id)?;
    stage.rooms.get(cell.room)
}

pub fn dungeon_for(stage: &StageSpec, seed: u32) -> Option<Dungeon> {
    let dun = stage.dungeon.as_ref()?;
    let mut cells = Vec::new();
    for (row, line) in dun.shape.iter().enumerate() {
        for (col, ch) in line.chars().enumerate() {
            if ch == '.' {
                continue;
            }
            cells.push(Cell {
                col,
                row,
                kind: if ch == 'R' { "room" } else { "corr" }.to_string(),
                exits: 0,
                room: 0,
                cleared: false,
                seen: false,
                props: None,
            });
        }
    }
    for pair in &dun.links {
        let Some(a) = index_of_cell(&cells, pair[0][0], pair[0][1]) else {
            continue;
        };
        let Some(b) = index_of_cell(&cells, pair[1][0], pair[1][1]) else {
            continue;
        };
        let dx = cells[b].col as isize - cells[a].col as isize;
        let dy = cells[b].row as isize - cells[a].row as isize;
        for step in &MINIMAP_STEPS {
            if step.dx == dx && step.dy == dy {
                cells[a].exits |= step.bit;
                if let Some(back) = minimap_step(step.back) {
                    cells[b].exits |= back.bit;
                }
            }
        }
    }
    let mut rng = Mulberry32::new(seed ^ 0x5bf0_3635);
    let mut pinned = std::collections::HashSet::new();
    for &room_idx in dun.pins.values() {
        pinned.insert(room_idx);
    }
    let mut room_deck = Vec::new();
    let mut corr_deck = Vec::new();
    for (idx, spec) in stage.rooms.iter().enumerate() {
        if idx == dun.entry_room || idx == dun.boss_room || pinned.contains(&idx) {
            continue;
        }
        if spec.kind.as_deref() == Some("corr") {
            corr_deck.push(idx);
        } else {
            room_deck.push(idx);
        }
    }
    for deck in [&mut room_deck, &mut corr_deck] {
        let len = deck.len();
        if len > 1 {
            for cursor in (1..len).rev() {
                let swap = ((rng.next_f64() * (cursor + 1) as f64).floor() as usize).min(cursor);
                deck.swap(cursor, swap);
            }
        }
    }
    let mut room_cursor = 0usize;
    let mut corr_cursor = 0usize;
    for cell in &mut cells {
        if cell.col == dun.entry[0] && cell.row == dun.entry[1] {
            cell.room = dun.entry_room;
        } else if cell.col == dun.boss[0] && cell.row == dun.boss[1] {
            cell.room = dun.boss_room;
        } else if let Some(&pin) = dun.pins.get(&cell_key(cell.col, cell.row)) {
            cell.room = pin;
        } else if cell.kind == "corr" {
            cell.room = *corr_deck.get(corr_cursor).unwrap_or(&0);
            corr_cursor += 1;
        } else {
            cell.room = *room_deck.get(room_cursor).unwrap_or(&0);
            room_cursor += 1;
        }
    }
    let entry = index_of_cell(&cells, dun.entry[0], dun.entry[1]).unwrap_or(0);
    let boss = index_of_cell(&cells, dun.boss[0], dun.boss[1]).unwrap_or(0);
    Some(Dungeon {
        cols: dun.cols,
        rows: dun.rows,
        cells,
        entry,
        boss,
        north_x: dun.north_x.clone(),
        south_shares_north_x: dun.south_shares_north_x,
    })
}

pub fn door_neighbour(dungeon: &Dungeon, cell: &Cell, dir: &str) -> Option<usize> {
    let step = minimap_step(dir)?;
    if (cell.exits & step.bit) == 0 {
        return None;
    }
    let ncol = cell.col as isize + step.dx;
    let nrow = cell.row as isize + step.dy;
    if ncol < 0 || nrow < 0 {
        return None;
    }
    index_of_cell(&dungeon.cells, ncol as usize, nrow as usize)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitMode {
    None,
    Locked,
    Open,
}

pub fn exit_mode(state: &State, dir: &str) -> ExitMode {
    let Some(cell) = current_cell(state) else {
        return ExitMode::None;
    };
    let Some(step) = minimap_step(dir) else {
        return ExitMode::None;
    };
    if (cell.exits & step.bit) == 0 {
        return ExitMode::None;
    }
    if cell.cleared {
        ExitMode::Open
    } else {
        ExitMode::Locked
    }
}

pub fn door_x(state: &State, cell: &Cell, dir: &str) -> f64 {
    let dun = state.dungeon.as_ref();
    let same_axis = dir == "N" || (dir == "S" && dun.is_some_and(|d| d.south_shares_north_x));
    let share = if same_axis {
        dun.and_then(|d| d.north_x.get(&cell_key(cell.col, cell.row)).copied())
            .unwrap_or(DOOR_SHARE)
    } else {
        DOOR_SHARE
    };
    share * room_width(state)
}

pub fn in_door_zone(state: &State, dir: &str) -> bool {
    let Some(cell) = current_cell(state) else {
        return false;
    };
    let p = &state.player;
    if dir == "E" {
        return p.x >= room_right(state) - DOOR_SIDE;
    }
    if dir == "W" {
        return p.x <= room_left(state) + DOOR_SIDE;
    }
    if (p.x - door_x(state, cell, dir)).abs() > DOOR_SPAN {
        return false;
    }
    let deep = band_depth(state.band_back_y);
    if dir == "N" {
        p.z >= deep - DOOR_DEPTH
    } else {
        p.z <= DOOR_DEPTH
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PropBox {
    pub width: f64,
    pub depth: f64,
    pub height: f64,
    pub hp: i32,
    pub dx: f64,
    pub ink: Option<[f64; 2]>,
    pub box_scale: Option<f64>,
}

pub fn breakable_spec(piece: &str) -> Option<PropBox> {
    match piece {
        "barrel" => Some(PropBox {
            width: 52.0,
            depth: 34.0,
            height: 78.0,
            hp: 1,
            dx: 0.0,
            ink: Some([63.0, 78.0]),
            box_scale: None,
        }),
        "chest" => Some(PropBox {
            width: 80.0,
            depth: 30.0,
            height: 56.0,
            hp: 1,
            dx: 0.0,
            ink: Some([86.0, 56.0]),
            box_scale: Some(0.48),
        }),
        "tomb" => Some(PropBox {
            width: 90.0,
            depth: 36.0,
            height: 108.0,
            hp: 1,
            dx: 0.0,
            ink: Some([135.0, 108.0]),
            box_scale: None,
        }),
        "goblinBunker" => Some(PropBox {
            width: 112.0,
            depth: 42.0,
            height: 110.0,
            hp: 3,
            dx: 0.0,
            ink: Some([142.0, 138.0]),
            box_scale: None,
        }),
        _ => None,
    }
}

pub fn is_pillar_piece(piece: &str) -> bool {
    matches!(
        piece,
        "pillar" | "pillarPale" | "pillarDecor" | "pillarDamagedDecor"
    )
}

fn solid_base_spec(piece: &str) -> Option<(f64, f64, [f64; 2])> {
    match piece {
        "trunkTall" => Some((146.0, 4.0, [203.0, 422.0])),
        "trunkBent" => Some((111.0, 6.0, [143.0, 423.0])),
        "trunkMossy" => Some((100.0, -18.0, [160.0, 428.0])),
        "treeLeafy" => Some((84.0, -4.0, [153.0, 203.0])),
        "treeReference" => Some((84.0, 4.0, [153.0, 203.0])),
        "treeBossFruit" => Some((84.0, -4.0, [153.0, 203.0])),
        "stump" => Some((74.0, -4.0, [105.0, 199.0])),
        "pillar" => Some((43.0, 0.0, [44.0, 133.0])),
        "pillarPale" => Some((43.0, 0.0, [44.0, 133.0])),
        "pillarDecor" => Some((43.0, 0.0, [44.0, 133.0])),
        "pillarDamagedDecor" => Some((43.0, 0.0, [44.0, 111.0])),
        "wallStone" => Some((163.0, -1.0, [167.0, 125.0])),
        "rockFlat" => Some((92.0, -20.0, [141.0, 89.0])),
        "rockSmall" => Some((42.0, 0.0, [42.0, 44.0])),
        "firSmall" => Some((42.0, 0.0, [42.0, 59.0])),
        "firMid" => Some((43.0, 0.0, [43.0, 71.0])),
        "firTall" => Some((44.0, 0.0, [44.0, 78.0])),
        "snagTall" => Some((96.0, 20.0, [139.0, 207.0])),
        "fallenTrunk" => Some((223.0, -2.0, [226.0, 340.0])),
        "stumpBroken" => Some((40.0, -19.0, [78.0, 112.0])),
        "trunkHollow" => Some((84.0, 2.0, [133.0, 178.0])),
        "snagShort" => Some((95.0, 0.0, [97.0, 104.0])),
        "snagStub" => Some((84.0, 2.0, [87.0, 101.0])),
        "ruinStone" => Some((139.0, 2.0, [142.0, 103.0])),
        "rockArch" => Some((105.0, -22.0, [195.0, 180.0])),
        "logMossy" => Some((96.0, 24.0, [317.0, 175.0])),
        "treeDead" => Some((74.0, -4.0, [105.0, 277.0])),
        "treeDeadTall" => Some((84.0, 0.0, [175.0, 303.0])),
        _ => None,
    }
}

pub fn prop_scale(piece: &str) -> [f64; 2] {
    match piece {
        "barrel" => [0.74, 0.74],
        "goblinBunker" => [0.7, 0.7],
        "gate" | "door" => [0.80, 0.80],
        "gateUp" | "gateBlock" | "doorBlock" | "doorUp" => [0.68, 0.68],
        "gateDown" | "doorDown" => [0.533, 0.533],
        "pillar" | "pillarPale" | "pillarDecor" | "pillarDamagedDecor" => [0.706, 0.715],
        "trunkTall" | "trunkBent" | "trunkMossy" => [0.45, 1.0],
        "treeLeafy" => [0.54, 0.69],
        "treeReference" => [0.71, 0.715],
        "treeBossFruit" => [0.715, 0.715],
        "grass" => [0.77, 0.62],
        "chest" => [0.72, 0.72],
        "tomb" => [0.50, 0.50],
        "fallenTrunk" => [0.30, 0.30],
        _ => [1.0, 1.0],
    }
}

fn prop_art_base(piece: &str) -> Option<[f64; 2]> {
    match piece {
        "grass" => Some([39.0, 87.0]),
        "grassFlower" => Some([188.0, 78.0]),
        "grassPatch" => Some([110.0, 48.0]),
        "sprout" => Some([126.0, 66.0]),
        "bush" => Some([64.0, 59.0]),
        "goblinBunker" => Some([142.0, 138.0]),
        "flower" => Some([30.0, 55.0]),
        "leaves" | "leavesBroad" | "leavesDense" => Some([126.0, 66.0]),
        "pebble" => Some([24.0, 27.0]),
        _ => None,
    }
}

pub fn prop_art_size(piece: &str, scale_override: Option<[f64; 2]>) -> Option<[f64; 2]> {
    let art = prop_art_base(piece)?;
    let scale = scale_override.unwrap_or_else(|| prop_scale(piece));
    Some([art[0] * scale[0], art[1] * scale[1]])
}

pub fn prop_box(piece: &str, scale_override: Option<[f64; 2]>) -> Option<PropBox> {
    let base = if let Some(b) = breakable_spec(piece) {
        b
    } else {
        let (w, dx, ink) = solid_base_spec(piece)?;
        let depth = (w / 3.0).round().clamp(24.0, 40.0);
        PropBox {
            width: w,
            depth,
            height: 0.0,
            hp: 0,
            dx,
            ink: Some(ink),
            box_scale: None,
        }
    };
    let default_scale = prop_scale(piece);
    let visual_scale = scale_override.unwrap_or(default_scale);
    let scale = match base.box_scale {
        None => visual_scale,
        Some(bs) => [
            bs * visual_scale[0] / default_scale[0],
            bs * visual_scale[1] / default_scale[1],
        ],
    };
    if scale[0] == 1.0 && scale[1] == 1.0 && visual_scale[0] == 1.0 && visual_scale[1] == 1.0 {
        return Some(base);
    }
    Some(PropBox {
        width: base.width * scale[0],
        depth: base.depth * scale[0],
        height: base.height * scale[1],
        hp: base.hp,
        dx: base.dx * scale[0],
        ink: base
            .ink
            .map(|i| [i[0] * visual_scale[0], i[1] * visual_scale[1]]),
        box_scale: base.box_scale,
    })
}

pub fn walk_footprint(
    body_width: f64,
    walk_width: Option<f64>,
    walk_depth: Option<f64>,
) -> (f64, f64) {
    (
        walk_width.unwrap_or(body_width),
        walk_depth.unwrap_or(body_width),
    )
}

#[derive(Debug, Clone, Copy)]
pub struct ObstacleBox {
    pub x: f64,
    pub z: f64,
    pub width: f64,
    pub depth: f64,
}

pub fn prop_obstacle(prop: &Prop, body_footprint: Option<(f64, f64)>) -> Option<ObstacleBox> {
    if !prop.solid || prop.broken || prop.gone {
        return None;
    }
    let mut obs = if prop.native_pillar.is_some() {
        ObstacleBox {
            x: prop.x,
            z: prop.z,
            width: 36.0 * NATIVE_SCALE,
            depth: 16.0 * NATIVE_SCALE / DEPTH_SCALE,
        }
    } else if let Some(ref nf) = prop.native_footprint {
        ObstacleBox {
            x: nf.x * NATIVE_SCALE,
            z: native_ground_z(nf.y),
            width: nf.width * NATIVE_SCALE,
            depth: nf.depth * NATIVE_SCALE / DEPTH_SCALE,
        }
    } else {
        let boxed = prop_box(&prop.piece, prop.scale)?;
        ObstacleBox {
            x: prop.x + boxed.dx,
            z: prop.z,
            width: boxed.width,
            depth: boxed.depth,
        }
    };
    if let Some((bw, bd)) = body_footprint {
        obs.width += bw;
        obs.depth += bd;
    }
    Some(obs)
}

fn rect_overlap(a: Rect, b: Rect) -> bool {
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

pub fn gate_art_rect(state: &State, cell: &Cell, dir: &str) -> Rect {
    if let Some(spec) = TABLES
        .stages
        .get(&state.stage_id)
        .and_then(|s| s.rooms.get(cell.room))
    {
        if let Some(native) = spec.native_path_gates.as_ref().and_then(|m| m.get(dir)) {
            let frame = &native.parts.frame;
            let left = native.x + frame.offset[0] * NATIVE_SCALE;
            let top = ARENA_GROUND_Y - depth_lift(native.z) + frame.offset[1] * NATIVE_SCALE;
            return Rect {
                left,
                right: left + frame.rect[2] * NATIVE_SCALE,
                top,
                bottom: top + frame.rect[3] * NATIVE_SCALE,
            };
        }
    }
    let depth = band_depth(state.band_back_y);
    if dir == "N" || dir == "S" {
        let x = door_x(state, cell, dir);
        if dir == "S" {
            let w = GATE_ART_S[0] * GATE_DOWN_SCALE * CAMERA_ZOOM;
            let h = GATE_ART_S[1] * GATE_DOWN_SCALE * CAMERA_ZOOM;
            let at = ARENA_GROUND_Y + (GATE_DOWN_BOTTOM - ARENA_GROUND_Y) * CAMERA_ZOOM;
            return Rect {
                left: x - w / 2.0,
                right: x + w / 2.0,
                top: at - h,
                bottom: at,
            };
        }
        let spec = TABLES
            .stages
            .get(&state.stage_id)
            .and_then(|s| s.rooms.get(cell.room));
        let bottom = spec
            .and_then(|s| s.north_gate_bottom)
            .unwrap_or_else(|| ARENA_GROUND_Y - depth_lift(depth) + 6.0);
        return Rect {
            left: x - GATE_ART_N[0] / 2.0,
            right: x + GATE_ART_N[0] / 2.0,
            top: bottom - GATE_ART_N[1],
            bottom,
        };
    }
    let cx = if dir == "E" {
        room_width(state) - 34.0
    } else {
        34.0
    };
    let base = ARENA_GROUND_Y + 4.0;
    Rect {
        left: cx - GATE_ART_SIDE[0] / 2.0,
        right: cx + GATE_ART_SIDE[0] / 2.0,
        top: base - GATE_ART_SIDE[1],
        bottom: base,
    }
}

pub fn door_floor(state: &State, cell: &Cell, dir: &str) -> FloorRect {
    let deep = band_depth(state.band_back_y);
    if dir == "E" {
        return FloorRect {
            x_min: room_right(state) - DOOR_CLEAR_SIDE,
            x_max: room_width(state),
            z_min: 0.0,
            z_max: deep,
        };
    }
    if dir == "W" {
        return FloorRect {
            x_min: 0.0,
            x_max: room_left(state) + DOOR_CLEAR_SIDE,
            z_min: 0.0,
            z_max: deep,
        };
    }
    let at = door_x(state, cell, dir);
    let (z_min, z_max) = if dir == "N" {
        (deep - DOOR_CLEAR_DEPTH, deep)
    } else {
        (0.0, DOOR_CLEAR_DEPTH)
    };
    FloorRect {
        x_min: at - DOOR_CLEAR_SPAN,
        x_max: at + DOOR_CLEAR_SPAN,
        z_min,
        z_max,
    }
}

struct CandidateProp<'a> {
    piece: &'a str,
    scale: Option<[f64; 2]>,
    x: f64,
    depth: f64,
}

fn prop_art_rect(entry: &CandidateProp<'_>, depth: f64) -> Option<Rect> {
    let art_size = if let Some(b) = prop_box(entry.piece, entry.scale) {
        b.ink.unwrap_or([b.width, b.width])
    } else {
        prop_art_size(entry.piece, entry.scale)?
    };
    let z = entry.depth * depth;
    let foot = ARENA_GROUND_Y - depth_lift(z);
    Some(Rect {
        left: entry.x - art_size[0] / 2.0,
        right: entry.x + art_size[0] / 2.0,
        top: foot - art_size[1],
        bottom: foot,
    })
}

fn blocks_doorway(state: &State, cell: &Cell, entry: &CandidateProp<'_>, depth: f64) -> bool {
    let Some(art) = prop_art_rect(entry, depth) else {
        return false;
    };
    let z = entry.depth * depth;
    if z > depth + 0.001 {
        return false;
    }
    let box_opt = prop_box(entry.piece, entry.scale);
    for step in &MINIMAP_STEPS {
        if (cell.exits & step.bit) == 0 {
            continue;
        }
        if let Some(ref b) = box_opt {
            let floor = door_floor(state, cell, step.dir);
            let fl = entry.x - b.width / 2.0;
            let fr = entry.x + b.width / 2.0;
            let fn_ = z - b.depth / 2.0;
            let ff = z + b.depth / 2.0;
            if fl < floor.x_max && fr > floor.x_min && fn_ < floor.z_max && ff > floor.z_min {
                return true;
            }
        }
        let gate = gate_art_rect(state, cell, step.dir);
        if rect_overlap(art, gate) {
            return true;
        }
    }
    false
}

fn blocks_door_lane(state: &State, cell: &Cell, x: f64) -> bool {
    for step in &MINIMAP_STEPS {
        if step.dir != "N" && step.dir != "S" {
            continue;
        }
        if (cell.exits & step.bit) == 0 {
            continue;
        }
        if (x - door_x(state, cell, step.dir)).abs() < DOOR_SPAN {
            return true;
        }
    }
    false
}

fn covers_loot(entry: &CandidateProp<'_>, depth: f64, z: f64, placed: &[Prop]) -> bool {
    if entry.piece == "chest" || entry.piece == "tomb" {
        return false;
    }
    let Some(art) = prop_art_rect(entry, depth) else {
        return false;
    };
    for other in placed {
        if other.piece != "chest" && other.piece != "tomb" {
            continue;
        }
        if z > other.z + 0.001 {
            continue;
        }
        let other_cand = CandidateProp {
            piece: &other.piece,
            scale: other.scale,
            x: other.x,
            depth: other.z / depth,
        };
        if let Some(other_art) = prop_art_rect(&other_cand, depth) {
            if rect_overlap(art, other_art) {
                return true;
            }
        }
    }
    false
}

fn overlaps_solid(list: &[Prop], x: f64, z: f64, boxed: &PropBox) -> bool {
    for other in list {
        let Some(ob) = prop_obstacle(other, None) else {
            continue;
        };
        if (x - ob.x).abs() < (boxed.width + ob.width) / 2.0
            && (z - ob.z).abs() < (boxed.depth + ob.depth) / 2.0
        {
            return true;
        }
    }
    false
}

fn is_tree_piece(piece: &str) -> bool {
    matches!(
        piece,
        "treeBossFruit" | "treeReference" | "treeLeafy" | "trunkTall" | "trunkBent" | "trunkMossy"
    )
}

fn make_scattered_prop(piece: &str, x: f64, z: f64, solid: bool, hp: i32) -> Prop {
    Prop {
        piece: piece.to_string(),
        x,
        z,
        scale: None,
        sort_z: None,
        solid,
        scattered: true,
        hp: if is_pillar_piece(piece) { 2 } else { hp },
        hit_t: 0.0,
        broken: false,
        broken_at: -1.0,
        gone: false,
        native_pillar: None,
        native_footprint: None,
        native_decoration: None,
        native_animation_started_at: 0.0,
        spawn_timer: if piece == "goblinBunker" { 2.0 } else { 0.0 },
        spawned_count: 0,
        drops_left: if is_tree_piece(piece) { 2 } else { 0 },
    }
}

fn scatter_props(
    state: &State,
    cell: &Cell,
    rng: &mut Mulberry32,
    already_placed: &[Prop],
) -> Vec<Prop> {
    let mut out = Vec::new();
    let left = room_left(state) + 34.0;
    let right = room_right(state) - 34.0;
    let depth = band_depth(state.band_back_y);
    let per_room = state.room.as_ref().and_then(|r| r.scatter.as_ref());

    let solid_count = per_room.and_then(|s| s.solid).unwrap_or(6);
    let barrel_count = per_room.and_then(|s| s.barrels).unwrap_or(5);
    let stone_piles = per_room.and_then(|s| s.stones).unwrap_or(1);

    let low_pieces = [
        "grassFlower",
        "sprout",
        "bush",
        "grassPatch",
        "leaves",
        "leavesBroad",
        "leavesDense",
        "pebble",
    ];
    let flower_pieces = ["flower"];
    let tall_pieces = ["grass"];

    let decal_groups: [(&[&str], usize); 3] = [
        (&low_pieces, per_room.and_then(|s| s.low).unwrap_or(28)),
        (
            &flower_pieces,
            per_room.and_then(|s| s.flowers).unwrap_or(26),
        ),
        (&tall_pieces, per_room.and_then(|s| s.tall).unwrap_or(8)),
    ];

    for (pieces, count) in decal_groups {
        for _ in 0..count {
            let mut decal: Option<(&str, f64, f64)> = None;
            for _ in 0..6 {
                let piece = pieces[((rng.next_f64() * pieces.len() as f64).floor() as usize)
                    .min(pieces.len() - 1)];
                let x = left + rng.next_f64() * (right - left);
                let d = 0.04 + rng.next_f64() * (0.96 - 0.04);
                let cand = CandidateProp {
                    piece,
                    scale: None,
                    x,
                    depth: d,
                };
                let mut combined: Vec<Prop> = already_placed.to_vec();
                combined.extend(out.iter().cloned());
                if !blocks_doorway(state, cell, &cand, depth)
                    && !blocks_door_lane(state, cell, x)
                    && !covers_loot(&cand, depth, d * depth, &combined)
                {
                    decal = Some((piece, x, d));
                    break;
                }
            }
            if let Some((piece, x, d)) = decal {
                out.push(make_scattered_prop(piece, x, d * depth, false, 0));
            }
        }
    }

    let stone_pieces = ["rockSmall", "pillar"];
    for _ in 0..stone_piles {
        let pile_x = left + rng.next_f64() * (right - left);
        let pile_depth = 0.10 + rng.next_f64() * (0.90 - 0.10);
        let pile_size = 2 + ((rng.next_f64() * 3.0).floor() as usize).min(2);
        for _ in 0..pile_size {
            let sp = stone_pieces[((rng.next_f64() * 2.0).floor() as usize).min(1)];
            let Some(sb) = prop_box(sp, None) else {
                continue;
            };
            let mut stone_at: Option<(f64, f64)> = None;
            for _ in 0..8 {
                let sx = (pile_x + (rng.next_f64() - 0.5) * 74.0).clamp(left, right);
                let sd = (pile_depth + (rng.next_f64() - 0.5) * 0.08).clamp(0.0, 1.0);
                let cand = CandidateProp {
                    piece: sp,
                    scale: None,
                    x: sx,
                    depth: sd,
                };
                let mut combined: Vec<Prop> = already_placed.to_vec();
                combined.extend(out.iter().cloned());
                if !blocks_doorway(state, cell, &cand, depth)
                    && !blocks_door_lane(state, cell, sx)
                    && !overlaps_solid(&out, sx, sd * depth, &sb)
                    && !overlaps_solid(already_placed, sx, sd * depth, &sb)
                    && !covers_loot(&cand, depth, sd * depth, &combined)
                {
                    stone_at = Some((sx, sd));
                    break;
                }
            }
            if let Some((sx, sd)) = stone_at {
                out.push(make_scattered_prop(sp, sx, sd * depth, true, sb.hp));
            }
        }
    }

    for _ in 0..barrel_count {
        let bp = "barrel";
        let Some(bb) = prop_box(bp, None) else {
            continue;
        };
        let mut barrel_at: Option<(f64, f64)> = None;
        for _ in 0..8 {
            let bx = left + rng.next_f64() * (right - left);
            let bd = 0.08 + rng.next_f64() * (0.92 - 0.08);
            let cand = CandidateProp {
                piece: bp,
                scale: None,
                x: bx,
                depth: bd,
            };
            let mut combined: Vec<Prop> = already_placed.to_vec();
            combined.extend(out.iter().cloned());
            if !blocks_doorway(state, cell, &cand, depth)
                && !blocks_door_lane(state, cell, bx)
                && !overlaps_solid(&out, bx, bd * depth, &bb)
                && !overlaps_solid(already_placed, bx, bd * depth, &bb)
                && !covers_loot(&cand, depth, bd * depth, &combined)
            {
                barrel_at = Some((bx, bd));
                break;
            }
        }
        if let Some((bx, bd)) = barrel_at {
            out.push(make_scattered_prop(
                bp,
                bx,
                bd * depth,
                true,
                if bb.hp > 0 { bb.hp } else { 1 },
            ));
        }
    }

    let solid_pieces = [
        "firSmall",
        "firMid",
        "firTall",
        "snagTall",
        "fallenTrunk",
        "stumpBroken",
        "trunkHollow",
        "snagShort",
        "snagStub",
        "ruinStone",
        "rockArch",
        "logMossy",
        "treeDead",
        "treeDeadTall",
    ];
    for _ in 0..solid_count {
        let piece = solid_pieces[((rng.next_f64() * solid_pieces.len() as f64).floor() as usize)
            .min(solid_pieces.len() - 1)];
        let boxed = prop_box(piece, None);
        let mut placed: Option<(f64, f64)> = None;
        for _ in 0..8 {
            let cx = left + rng.next_f64() * (right - left);
            let cd = 0.55 + rng.next_f64() * (0.94 - 0.55);
            let cand = CandidateProp {
                piece,
                scale: None,
                x: cx,
                depth: cd,
            };
            let mut combined: Vec<Prop> = already_placed.to_vec();
            combined.extend(out.iter().cloned());
            let ok = match boxed {
                None => true,
                Some(ref b) => {
                    !blocks_doorway(state, cell, &cand, depth)
                        && !blocks_door_lane(state, cell, cx)
                        && !overlaps_solid(&out, cx, cd * depth, b)
                        && !overlaps_solid(already_placed, cx, cd * depth, b)
                        && !covers_loot(&cand, depth, cd * depth, &combined)
                }
            };
            if ok {
                placed = Some((cx, cd));
                break;
            }
        }
        if let Some((cx, cd)) = placed {
            out.push(make_scattered_prop(
                piece,
                cx,
                cd * depth,
                boxed.is_some(),
                boxed.map(|b| b.hp).unwrap_or(0),
            ));
        }
    }

    out
}

fn nearest_clear_prop_spot(
    state: &State,
    cell: &Cell,
    entry: &RoomPropEntry,
    depth: f64,
    solids: &[Prop],
    lane: bool,
) -> Option<(f64, f64)> {
    let boxed = prop_box(&entry.piece, entry.scale);
    let art = if boxed.is_none() {
        prop_art_size(&entry.piece, entry.scale)
    } else {
        None
    };
    let span = boxed
        .map(|b| b.width / 2.0)
        .or_else(|| art.map(|a| a[0] / 2.0))
        .unwrap_or(0.0);
    let left = room_left(state) + span;
    let right = room_right(state) - span;
    let origin_share = entry.depth.unwrap_or(0.0);
    let origin_z = origin_share * depth;
    let step = 6.0;

    let clear_at = |x: f64, share: f64, allow_cover: bool| -> bool {
        let cand = CandidateProp {
            piece: &entry.piece,
            scale: entry.scale,
            x,
            depth: share,
        };
        let blocked = if lane {
            blocks_doorway(state, cell, &cand, depth)
                || (boxed.is_some() && blocks_door_lane(state, cell, x))
        } else {
            blocks_doorway(state, cell, &cand, depth)
        };
        if blocked {
            return false;
        }
        if let Some(ref b) = boxed {
            if overlaps_solid(solids, x, share * depth, b) {
                return false;
            }
        }
        allow_cover || !covers_loot(&cand, depth, share * depth, solids)
    };

    for pass in 0..2 {
        let allow_cover = pass == 1;
        let mut best: Option<f64> = None;
        let mut x = left;
        while x <= right {
            if clear_at(x, origin_share, allow_cover)
                && best.is_none_or(|b| (x - entry.x).abs() < (b - entry.x).abs())
            {
                best = Some(x);
            }
            x += step;
        }
        if let Some(bx) = best {
            return Some((bx, origin_z));
        }
        let mut nearest: Option<(f64, f64)> = None;
        let mut nearest_score = f64::INFINITY;
        let mut share = 0.0;
        while share <= 1.0001 {
            let dz = share * depth - origin_z;
            let mut along = left;
            while along <= right {
                let dx = along - entry.x;
                let score = dx * dx + dz * dz;
                if score < nearest_score && clear_at(along, share, allow_cover) {
                    nearest_score = score;
                    nearest = Some((along, share * depth));
                }
                along += step;
            }
            share += 0.04;
        }
        if nearest.is_some() {
            return nearest;
        }
    }
    None
}

pub fn prop_blocks_at(
    state: &State,
    x: f64,
    z: f64,
    body_footprint: Option<(f64, f64)>,
    margin: f64,
) -> bool {
    for prop in &state.props {
        if let Some(b) = prop_obstacle(prop, body_footprint) {
            if (x - b.x).abs() < b.width / 2.0 + margin && (z - b.z).abs() < b.depth / 2.0 + margin
            {
                return true;
            }
        }
    }
    false
}

pub fn route_step(
    state: &State,
    target_x: f64,
    target_z: f64,
    from_x: Option<f64>,
    from_z: Option<f64>,
    body_footprint: Option<(f64, f64)>,
    break_props: bool,
) -> [i32; 2] {
    let step = ROUTE_GRID_STEP;
    let left = room_left(state);
    let fp = body_footprint.unwrap_or((state.player.walk_width, state.player.walk_depth));
    let depth = band_depth(state.band_back_y);
    let cols = ((room_right(state) - left) / step).floor().max(1.0) as usize;
    let rows = (depth / step).floor().max(1.0) as usize;
    let margin = step / 2.0;

    let solids: Vec<ObstacleBox> = state
        .props
        .iter()
        .filter(|prop| !(break_props && breakable_spec(&prop.piece).is_some()))
        .filter_map(|prop| prop_obstacle(prop, Some(fp)))
        .collect();

    let blocked = |x: f64, z: f64| -> bool {
        solids.iter().any(|b| {
            (x - b.x).abs() < b.width / 2.0 + margin && (z - b.z).abs() < b.depth / 2.0 + margin
        })
    };
    let cell_x = |x: f64| -> usize {
        (((x - left) / step).floor() as isize).clamp(0, cols as isize - 1) as usize
    };
    let cell_z =
        |z: f64| -> usize { ((z / step).floor() as isize).clamp(0, rows as isize - 1) as usize };
    let seat_x = |i: usize| -> f64 { left + (i as f64 + 0.5) * step };
    let seat_z = |j: usize| -> f64 { (j as f64 + 0.5) * step };

    let from = [
        cell_x(from_x.unwrap_or(state.player.x)),
        cell_z(from_z.unwrap_or(state.player.z)),
    ];
    let mut goal = [cell_x(target_x), cell_z(target_z)];
    if blocked(seat_x(goal[0]), seat_z(goal[1])) {
        let mut best: Option<([usize; 2], usize)> = None;
        for i in 0..cols {
            for j in 0..rows {
                if blocked(seat_x(i), seat_z(j)) {
                    continue;
                }
                let far = i.abs_diff(goal[0]) + j.abs_diff(goal[1]);
                if best.is_none_or(|(_, bf)| far < bf) {
                    best = Some(([i, j], far));
                }
            }
        }
        let Some((at, _)) = best else {
            return [0, 0];
        };
        goal = at;
    }
    if from == goal {
        return [0, 0];
    }

    type RouteCame = HashMap<(usize, usize), Option<((usize, usize), [i32; 2])>>;
    let mut came: RouteCame = HashMap::new();
    came.insert((from[0], from[1]), None);
    let mut queue = VecDeque::new();
    queue.push_back((from[0], from[1]));
    let moves: [[i32; 2]; 4] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let mut found = false;

    while let Some(at) = queue.pop_front() {
        if found {
            break;
        }
        for mv in moves {
            let ni = at.0 as isize + mv[0] as isize;
            let nj = at.1 as isize + mv[1] as isize;
            if ni < 0 || nj < 0 || ni >= cols as isize || nj >= rows as isize {
                continue;
            }
            let next = (ni as usize, nj as usize);
            if came.contains_key(&next) {
                continue;
            }
            if blocked(seat_x(next.0), seat_z(next.1)) {
                continue;
            }
            came.insert(next, Some((at, mv)));
            if next == (goal[0], goal[1]) {
                found = true;
                break;
            }
            queue.push_back(next);
        }
    }
    if !found {
        return [0, 0];
    }
    let mut first = [0, 0];
    let mut walk = (goal[0], goal[1]);
    while walk != (from[0], from[1]) {
        if let Some(Some((prev, step_mv))) = came.get(&walk) {
            first = *step_mv;
            walk = *prev;
        } else {
            break;
        }
    }
    first
}

pub fn door_at(state: &State) -> Option<&'static str> {
    for dir in MINIMAP_DIRS {
        if exit_mode(state, dir) != ExitMode::Open {
            continue;
        }
        if in_door_zone(state, dir) {
            return Some(dir);
        }
    }
    None
}

fn settle_door_landing(state: &mut State, cell: &Cell, dir: &str) {
    let fp = (state.player.walk_width, state.player.walk_depth);
    if !prop_blocks_at(state, state.player.x, state.player.z, Some(fp), 0.0) {
        return;
    }
    let floor = door_floor(state, cell, dir);
    let half = fp.0 / 2.0;
    let mut left = floor.x_min.max(room_left(state) + half);
    let mut right = floor.x_max.min(room_right(state) - half);
    let mut near = floor.z_min.max(0.0);
    let mut far = floor.z_max.min(band_depth(state.band_back_y));
    if dir == "W" {
        left = left.max(room_left(state) + DOOR_SIDE + 1.0);
    }
    if dir == "E" {
        right = right.min(room_right(state) - DOOR_SIDE - 1.0);
    }
    if dir == "S" {
        near = near.max(DOOR_DEPTH + 1.0);
    }
    if dir == "N" {
        far = far.min(band_depth(state.band_back_y) - DOOR_DEPTH - 1.0);
    }
    let mut best: Option<(f64, f64, f64)> = None;
    let mut x = left;
    while x <= right {
        let mut z = near;
        while z <= far {
            let dist = (x - state.player.x).powi(2) + (z - state.player.z).powi(2);
            if best.is_none_or(|(_, _, bd)| dist < bd)
                && !prop_blocks_at(state, x, z, Some(fp), 0.0)
            {
                best = Some((x, z, dist));
            }
            z += 4.0;
        }
        x += 4.0;
    }
    if let Some((bx, bz, _)) = best {
        state.player.x = bx;
        state.player.z = bz;
    } else {
        let mut px = state.player.x;
        let mut pz = state.player.z;
        let mut vx = state.player.vx;
        let mut vz = state.player.vz;
        crate::combat::block_props_coords(state, &mut px, &mut pz, &mut vx, &mut vz, Some(fp));
        state.player.x = px;
        state.player.z = pz;
        state.player.vx = vx;
        state.player.vz = vz;
    }
}

pub fn mark_seen(state: &mut State) {
    if let Some(cell) = current_cell_mut(state) {
        cell.seen = true;
    }
}

pub fn begin_room(state: &mut State, entry_door: Option<&str>) {
    mark_seen(state);
    let Some(cell) = current_cell(state).cloned() else {
        return;
    };
    let Some(stage) = TABLES.stages.get(&state.stage_id) else {
        return;
    };
    let Some(spec) = stage.rooms.get(cell.room) else {
        return;
    };
    let cleared = cell.cleared;
    let width = spec.width.unwrap_or(ROOM_DEFAULT_WIDTH);
    let band_back_y = spec
        .band
        .as_ref()
        .map(|b| b.back_y)
        .unwrap_or(BAND_DEFAULT_BACK_Y);
    let band_visual_back_y = spec.band.as_ref().and_then(|b| b.visual_back_y);
    state.band_back_y = band_back_y;
    state.band_visual_back_y = band_visual_back_y;

    let depth = band_depth(band_back_y);
    let mut first_wave = Vec::new();
    let mut later_waves: IndexMap<u32, Vec<RoomWaveItem>> = IndexMap::new();
    let is_recorded_main_room = stage.dungeon.as_ref().is_some_and(|dun| {
        cell.room == dun.entry_room
            || cell.room == dun.boss_room
            || dun.pins.values().any(|&pinned| pinned == cell.room)
    });
    let pvf_branch = if state.reference_profile.is_some() && !is_recorded_main_room {
        crate::pvf_truth::stage_truth(&state.stage_id).and_then(|st| {
            if st.branch_rooms.is_empty() {
                None
            } else {
                st.branch_rooms.get(cell.room % st.branch_rooms.len())
            }
        })
    } else {
        None
    };
    if let Some(branch) = pvf_branch {
        let total_roster: usize = branch.roster.values().map(|&n| n as usize).sum();
        let mut idx = 0usize;
        for (kind, &count) in &branch.roster {
            for _ in 0..count {
                let (x, z, level, xp, activation_delay) = if let Some(slot) = spec.enemies.get(idx)
                {
                    (
                        slot.x,
                        slot.depth.unwrap_or(0.5) * depth,
                        slot.level,
                        slot.xp,
                        slot.activation_delay,
                    )
                } else {
                    let frac = if total_roster <= 1 {
                        0.5
                    } else {
                        idx as f64 / (total_roster - 1) as f64
                    };
                    let x =
                        ROOM_LEFT_WALL + 160.0 + frac * (width - ROOM_LEFT_WALL - 300.0).max(80.0);
                    let z = (0.28 + ((idx % 3) as f64) * 0.22) * depth;
                    (x, z, None, None, None)
                };
                first_wave.push(RoomWaveItem {
                    kind: kind.clone(),
                    x,
                    z,
                    level,
                    xp,
                    activation_delay,
                });
                idx += 1;
            }
        }
    } else {
        for entry in &spec.enemies {
            let z = entry.depth.unwrap_or(0.0) * depth;
            let item = RoomWaveItem {
                kind: entry.kind.clone(),
                x: entry.x,
                z,
                level: entry.level,
                xp: entry.xp,
                activation_delay: entry.activation_delay,
            };
            let wave = entry.wave.unwrap_or(1);
            if wave <= 1 {
                first_wave.push(item);
            } else {
                later_waves.entry(wave).or_default().push(item);
            }
        }
    }
    let total_enemies = first_wave.len() + later_waves.values().map(Vec::len).sum::<usize>();
    let mut wave_numbers: Vec<u32> = later_waves.keys().copied().collect();
    wave_numbers.sort_unstable();

    let mut pending_wave = Vec::new();
    let mut pending_waves = Vec::new();
    if !cleared && !wave_numbers.is_empty() {
        if let Some(first_later) = later_waves.shift_remove(&wave_numbers[0]) {
            pending_wave = first_later;
        }
        for wn in wave_numbers.into_iter().skip(1) {
            if let Some(w) = later_waves.shift_remove(&wn) {
                pending_waves.push(w);
            }
        }
    }

    state.room = Some(RoomState {
        name: spec.name.clone(),
        total: total_enemies,
        cleared,
        native_gate_opened_at: None,
        cell: state.cell,
        width,
        north_gate_bottom: spec.north_gate_bottom,
        left_wall: ROOM_LEFT_WALL,
        right_wall: width - (ROOM_DEFAULT_WIDTH - ROOM_RIGHT_WALL),
        scatter: spec.scatter.clone(),
        pending_wave,
        pending_waves,
        entered_at: state.time,
        last_wave_at: state.time,
        wave_triggered: false,
        wave_cap: spec.cap.unwrap_or(5),
        wave_spawned: 0,
    });
    state.target = None;

    state.enemies = if cleared {
        Vec::new()
    } else {
        let use_ref = state.reference_profile.is_some();
        first_wave
            .iter()
            .map(|e| {
                let mut enemy = create_enemy(state, &e.kind, e.x, e.z, e.level, e.xp);
                if use_ref {
                    if let Some(delay) = e.activation_delay {
                        enemy.activation_delay = delay;
                    }
                }
                enemy
            })
            .collect()
    };

    if cell.props.is_none() {
        let mut built = Vec::new();
        let make_prop = |entry: &RoomPropEntry, x: f64, z: f64, boxed: Option<PropBox>| -> Prop {
            let native_pillar = entry.native_pillar.as_ref().map(|np| NativePillarState {
                x: *np.first().unwrap_or(&0.0),
                y: *np.get(1).unwrap_or(&0.0),
                origin_x: *np.get(2).unwrap_or(&0.0),
                damaged_at: -1.0,
            });
            let native_footprint = entry.native_rock.as_ref().map(|nr| NativeFootprint {
                x: *nr.first().unwrap_or(&0.0),
                y: *nr.get(1).unwrap_or(&0.0),
                width: 140.0,
                depth: 28.0,
            });
            let solid = boxed.is_some() || native_pillar.is_some();
            let hp = if is_pillar_piece(&entry.piece) || native_pillar.is_some() {
                2
            } else {
                boxed.map(|b| b.hp).unwrap_or(0)
            };
            Prop {
                piece: entry.piece.clone(),
                x,
                z,
                scale: entry.scale,
                sort_z: entry.sort_z,
                solid,
                scattered: false,
                hp,
                hit_t: 0.0,
                broken: false,
                broken_at: -1.0,
                gone: false,
                native_pillar,
                native_footprint,
                native_decoration: entry.native_decoration.clone(),
                native_animation_started_at: if entry.native_decoration.is_some() {
                    state.time
                } else {
                    0.0
                },
                spawn_timer: if entry.piece == "goblinBunker" {
                    2.0
                } else {
                    0.0
                },
                spawned_count: 0,
                drops_left: if is_tree_piece(&entry.piece) { 2 } else { 0 },
            }
        };

        if stage.props_are_measured {
            for entry in &spec.props {
                let share = entry.depth.unwrap_or(0.0);
                let boxed = prop_box(&entry.piece, entry.scale);
                let z = if breakable_spec(&entry.piece).is_some()
                    || is_pillar_piece(&entry.piece)
                    || entry.native_pillar.is_some()
                {
                    (share * depth).clamp(8.0, (depth - 8.0).max(8.0))
                } else {
                    share * depth
                };
                built.push(make_prop(entry, entry.x, z, boxed));
            }
        } else {
            struct Displaced<'a> {
                entry: &'a RoomPropEntry,
                share: f64,
                boxed: Option<PropBox>,
                strict: Vec<f64>,
                relaxed: Vec<f64>,
            }
            let mut displaced = Vec::new();
            for entry in &spec.props {
                let share = entry.depth.unwrap_or(0.0);
                let boxed = prop_box(&entry.piece, entry.scale);
                let cand = CandidateProp {
                    piece: &entry.piece,
                    scale: entry.scale,
                    x: entry.x,
                    depth: share,
                };
                if blocks_doorway(state, &cell, &cand, depth) {
                    displaced.push(Displaced {
                        entry,
                        share,
                        boxed,
                        strict: Vec::new(),
                        relaxed: Vec::new(),
                    });
                } else {
                    built.push(make_prop(entry, entry.x, share * depth, boxed));
                }
            }
            for item in &mut displaced {
                let art = if item.boxed.is_none() {
                    prop_art_size(&item.entry.piece, item.entry.scale)
                } else {
                    None
                };
                let span = item
                    .boxed
                    .map(|b| b.width / 2.0)
                    .or_else(|| art.map(|a| a[0] / 2.0))
                    .unwrap_or(0.0);
                let left = room_left(state) + span;
                let right = room_right(state) - span;
                let mut x = left;
                while x <= right {
                    let cand = CandidateProp {
                        piece: &item.entry.piece,
                        scale: item.entry.scale,
                        x,
                        depth: item.share,
                    };
                    if !blocks_doorway(state, &cell, &cand, depth) {
                        item.relaxed.push(x);
                        if item.boxed.is_none() || !blocks_door_lane(state, &cell, x) {
                            item.strict.push(x);
                        }
                    }
                    x += 6.0;
                }
            }
            displaced.sort_by(|a, b| {
                let loot_a = usize::from(a.entry.piece != "chest" && a.entry.piece != "tomb");
                let loot_b = usize::from(b.entry.piece != "chest" && b.entry.piece != "tomb");
                let count_a = if !a.strict.is_empty() {
                    a.strict.len()
                } else {
                    a.relaxed.len()
                };
                let count_b = if !b.strict.is_empty() {
                    b.strict.len()
                } else {
                    b.relaxed.len()
                };
                loot_a
                    .cmp(&loot_b)
                    .then_with(|| count_a.cmp(&count_b))
                    .then_with(|| a.entry.x.total_cmp(&b.entry.x))
            });
            for item in displaced {
                let best_fn = |spots: &[f64], built: &[Prop]| -> Option<f64> {
                    for pass in 0..2 {
                        let mut found: Option<f64> = None;
                        for &x in spots {
                            if let Some(ref b) = item.boxed {
                                if overlaps_solid(built, x, item.share * depth, b) {
                                    continue;
                                }
                            }
                            let cand = CandidateProp {
                                piece: &item.entry.piece,
                                scale: item.entry.scale,
                                x,
                                depth: item.share,
                            };
                            if pass == 0 && covers_loot(&cand, depth, item.share * depth, built) {
                                continue;
                            }
                            if found
                                .is_none_or(|f| (x - item.entry.x).abs() < (f - item.entry.x).abs())
                            {
                                found = Some(x);
                            }
                        }
                        if found.is_some() {
                            return found;
                        }
                    }
                    None
                };
                let x = best_fn(&item.strict, &built).or_else(|| best_fn(&item.relaxed, &built));
                let spot = match x {
                    Some(vx) => Some((vx, item.share * depth)),
                    None => nearest_clear_prop_spot(state, &cell, item.entry, depth, &built, true)
                        .or_else(|| {
                            nearest_clear_prop_spot(state, &cell, item.entry, depth, &built, false)
                        }),
                };
                if let Some((sx, sz)) = spot {
                    built.push(make_prop(item.entry, sx, sz, item.boxed));
                }
            }
        }
        let mut scatter_rng = Mulberry32::new(
            state
                .seed
                .wrapping_add((state.cell as u32 + 1).wrapping_mul(7919)),
        );
        let scattered = scatter_props(state, &cell, &mut scatter_rng, &built);
        built.extend(scattered);
        if let Some(c) = current_cell_mut(state) {
            c.props = Some(built.clone());
        }
        state.props = built;
    } else if let Some(ref props) = cell.props {
        state.props = props.clone();
    }

    state.player.x = room_left(state) + 86.0;
    state.player.y = ARENA_GROUND_Y;
    state.player.z = 0.0;
    match entry_door {
        Some("E") => state.player.x = room_right(state) - DOOR_STAND,
        Some("W") => state.player.x = room_left(state) + DOOR_STAND,
        Some("N") => {
            state.player.x = door_x(state, &cell, "N");
            state.player.z = depth - DOOR_STAND;
        }
        Some("S") => {
            state.player.x = door_x(state, &cell, "S");
            state.player.z = DOOR_STAND;
        }
        _ => {}
    }
    state.player.vx = 0.0;
    state.player.vy = 0.0;
    state.player.vz = 0.0;
    state.player.on_ground = true;
    if let Some(dir) = entry_door {
        settle_door_landing(state, &cell, dir);
        if dir == "N" || dir == "S" {
            state.camera_x = state.player.x - window_width() / 2.0;
        }
    }
    crate::update_camera(state);
    state.player.attack_timer = 0.0;
    state.player.skill_id = None;
    state.player.skill_timer = 0.0;
    state.player.attack_hit_done = false;
    state.player.skill_hit_done = false;
    state.player.skill_hits_done = 0;
    state.player.combo_timer = 0.0;
    state.player.attack_buffer = 0.0;
    state.player.jump_buffer = 0.0;
    state.skill_buffer = None;
    state.pickups.clear();
    state.projectiles.clear();
    state.fields.clear();
    state.shots.clear();
    state.effects.clear();
}

pub fn enter_cell(state: &mut State, dir: &str) {
    let prev_props = state.props.clone();
    if let Some(c) = current_cell_mut(state) {
        c.props = Some(prev_props);
    }
    let Some(cell) = current_cell(state) else {
        return;
    };
    let Some(dun) = state.dungeon.as_ref() else {
        return;
    };
    let Some(at) = door_neighbour(dun, cell, dir) else {
        return;
    };
    let back = minimap_step(dir).map(|s| s.back.to_string());
    state.cell = at;
    mark_seen(state);
    state.entry_door = back.clone();
    state.transition = TRANSITION_DUR;
    begin_room(state, back.as_deref());
}

pub fn go_to_cell(state: &mut State, index: usize) {
    let Some(dun) = state.dungeon.as_ref() else {
        return;
    };
    if dun.cells.is_empty() {
        return;
    }
    state.cell = index.min(dun.cells.len() - 1);
    state.entry_door = None;
    mark_seen(state);
    begin_room(state, None);
}
