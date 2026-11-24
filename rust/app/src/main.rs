//! Native desktop entry point for nano-dnf (`src/main.js`).
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod audio;
mod save;

use attract_rs::{create as create_attract, step_session as step_attract, AttractSession};
use audio::AudioEngine;
use core_rs::constants::*;
use core_rs::types::{CreateStateOptions, Input, State};
use core_rs::{create_state, drain_sounds, step as step_core, TABLES};
use loadout_rs::Loadout;
use music_rs::track_for;
use progress_rs::{note_break, note_clear, note_kill, ProgressProfile};
use records_rs::{record as record_run, RecordStore, RunInput};
use render_rs::{
    draw_town_view, hit_test_loadout_panel, hit_test_progress_panel, render, Canvas, GlyphCache,
    PanelAction, ProgressPanelKind, RenderMeta, SpriteStore, TownView, DEFAULT_WINDOW_HEIGHT,
    DEFAULT_WINDOW_WIDTH, RENDER_HEIGHT, RENDER_WIDTH, VIEW_TO_RENDER_SCALE,
};
use reward_rs::{
    create as create_reward, pick as pick_reward, step as step_reward, take_prize, RewardState,
};
use softbuffer::{Context, Surface};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};
use tiny_skia::Pixmap;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Fullscreen, Window, WindowId};

fn compute_present_rect(
    win_w: usize,
    win_h: usize,
    src_w: usize,
    src_h: usize,
) -> (usize, usize, usize, usize) {
    let win_w = win_w.max(1);
    let win_h = win_h.max(1);
    let src_w = src_w.max(1);
    let src_h = src_h.max(1);
    let scale = (win_w as f64 / src_w as f64).min(win_h as f64 / src_h as f64);
    let dst_w = ((src_w as f64 * scale).round() as usize).clamp(1, win_w);
    let dst_h = ((src_h as f64 * scale).round() as usize).clamp(1, win_h);
    let off_x = (win_w - dst_w) / 2;
    let off_y = (win_h - dst_h) / 2;
    (off_x, off_y, dst_w, dst_h)
}

fn map_window_to_render(win_w: f64, win_h: f64, wx: f64, wy: f64) -> Option<(f32, f32)> {
    let win_w = win_w.max(1.0);
    let win_h = win_h.max(1.0);
    let rw = f64::from(RENDER_WIDTH);
    let rh = f64::from(RENDER_HEIGHT);
    let scale = (win_w / rw).min(win_h / rh);
    let dst_w = rw * scale;
    let dst_h = rh * scale;
    let off_x = (win_w - dst_w) * 0.5;
    let off_y = (win_h - dst_h) * 0.5;
    let rx = ((wx - off_x) / scale) as f32;
    let ry = ((wy - off_y) / scale) as f32;
    if (0.0..=RENDER_WIDTH as f32).contains(&rx) && (0.0..=RENDER_HEIGHT as f32).contains(&ry) {
        Some((rx, ry))
    } else {
        None
    }
}

fn render_to_view_coords(rx: f32, ry: f32) -> (f32, f32) {
    (
        VIEW_LEFT as f32 + rx / VIEW_TO_RENDER_SCALE,
        ry / VIEW_TO_RENDER_SCALE,
    )
}

fn is_fullscreen_toggle(code: KeyCode, held_keys: &HashSet<KeyCode>) -> bool {
    matches!(code, KeyCode::Enter | KeyCode::NumpadEnter)
        && (held_keys.contains(&KeyCode::AltLeft) || held_keys.contains(&KeyCode::AltRight))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScreenMode {
    Title,
    Region,
    Town,
    Playing,
}

fn find_asset_root() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("assets").is_dir() {
                return dir.to_path_buf();
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("assets").is_dir() {
        return cwd;
    }
    if let Some(parent) = cwd.parent() {
        if parent.join("assets").is_dir() {
            return parent.to_path_buf();
        }
    }
    cwd
}

fn load_font_blobs(root: &Path) -> Vec<Vec<u8>> {
    let candidates = [
        root.join("assets/font.ttf"),
        PathBuf::from("C:\\Windows\\Fonts\\msyh.ttc"),
        PathBuf::from("C:\\Windows\\Fonts\\simhei.ttf"),
        PathBuf::from("C:\\Windows\\Fonts\\simsun.ttc"),
        PathBuf::from("C:\\Windows\\Fonts\\segoeui.ttf"),
        PathBuf::from("C:\\Windows\\Fonts\\arial.ttf"),
        PathBuf::from("C:\\Windows\\Fonts\\tahoma.ttf"),
        PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"),
        PathBuf::from("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
        PathBuf::from("/usr/share/fonts/truetype/arphic/uming.ttc"),
        PathBuf::from("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        PathBuf::from("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    ];
    candidates
        .into_iter()
        .filter_map(|p| std::fs::read(&p).ok())
        .collect()
}

struct AppState {
    window: Option<Rc<Window>>,
    surface: Option<Surface<Rc<Window>, Rc<Window>>>,
    pixmap: Pixmap,
    fonts: GlyphCache,
    sprites: SpriteStore,
    audio: AudioEngine,
    asset_root: PathBuf,
    mode: ScreenMode,
    state: State,
    attract: AttractSession,
    records: RecordStore,
    progress: ProgressProfile,
    loadout: Loadout,
    reward: Option<RewardState>,
    paused: bool,
    show_help: bool,
    loadout_open: bool,
    loadout_slot: usize,
    progress_panel: ProgressPanelKind,
    region_selected: String,
    town_x: f64,
    town_z: f64,
    town_facing: i32,
    town_camera_x: f64,
    town_time: f64,
    town_walk: f64,
    town_moving: bool,
    held_keys: HashSet<KeyCode>,
    seen_hints: HashSet<String>,
    active_hint: Option<(String, f64)>,
    recorded_finish: bool,
    last_kills_by_type: HashMap<String, u32>,
    last_barrels: u32,
    cmd_upslash_timer: f64,
    last_tick: Instant,
    accumulator: f64,
    cursor_pos: (f32, f32),
}

impl AppState {
    fn new() -> Self {
        let asset_root = find_asset_root();
        let font_blobs = load_font_blobs(&asset_root);
        let blob_refs: Vec<&[u8]> = font_blobs.iter().map(Vec::as_slice).collect();
        let fonts = GlyphCache::from_font_blobs(&blob_refs);
        let sprites = SpriteStore::load_from_root(&asset_root);
        let audio = AudioEngine::new(&asset_root);
        let valid_skills: Vec<&str> = TABLES.skill_order.iter().map(String::as_str).collect();
        let (records, progress, loadout) =
            save::load_all(&asset_root, &valid_skills, DEFAULT_STAGE);
        let state = create_state(&CreateStateOptions::default());
        let attract = create_attract(Some(DEFAULT_SEED));
        // INFALLIBLE: RENDER_WIDTH=800, RENDER_HEIGHT=600
        let pixmap =
            Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("INFALLIBLE: valid 800x600 pixmap");

        Self {
            window: None,
            surface: None,
            pixmap,
            fonts,
            sprites,
            audio,
            asset_root,
            mode: ScreenMode::Title,
            state,
            attract,
            records,
            progress,
            loadout,
            reward: None,
            paused: false,
            show_help: false,
            loadout_open: false,
            loadout_slot: 0,
            progress_panel: ProgressPanelKind::None,
            region_selected: DEFAULT_STAGE.to_string(),
            town_x: 200.0,
            town_z: 20.0,
            town_facing: 1,
            town_camera_x: 0.0,
            town_time: 0.0,
            town_walk: 0.0,
            town_moving: false,
            held_keys: HashSet::new(),
            seen_hints: HashSet::new(),
            active_hint: None,
            recorded_finish: false,
            last_kills_by_type: HashMap::new(),
            last_barrels: 0,
            cmd_upslash_timer: 0.0,
            last_tick: Instant::now(),
            accumulator: 0.0,
            cursor_pos: (0.0, 0.0),
        }
    }

    fn map_window_cursor(&self, wx: f64, wy: f64) -> Option<(f32, f32)> {
        let win = self.window.as_ref()?;
        let size = win.inner_size();
        map_window_to_render(
            f64::from(size.width.max(1)),
            f64::from(size.height.max(1)),
            wx,
            wy,
        )
    }

    fn toggle_fullscreen(&self) {
        if let Some(ref win) = self.window {
            if win.fullscreen().is_some() {
                win.set_fullscreen(None);
            } else {
                win.set_fullscreen(Some(Fullscreen::Borderless(None)));
            }
        }
    }

    fn handle_click(&mut self, rx: f32, ry: f32) {
        let (ax, ay) = render_to_view_coords(rx, ry);
        if self.loadout_open {
            if let Some(action) = hit_test_loadout_panel(ax, ay) {
                self.apply_panel_action(action);
            }
            return;
        }
        if self.progress_panel != ProgressPanelKind::None {
            if let Some(action) =
                hit_test_progress_panel(self.progress_panel, &self.progress, ax, ay)
            {
                self.apply_panel_action(action);
            }
            return;
        }
        match self.mode {
            ScreenMode::Title => {
                self.mode = ScreenMode::Region;
            }
            ScreenMode::Region => {
                let stages = ["mirkwood", "mirkwooddeep"];
                let bw = 168.0f32;
                let bh = 73.0f32;
                let gap_x = 14.0f32;
                let row_w = 2.0 * bw + gap_x;
                let row_x = (ARENA_WIDTH as f32 - row_w) * 0.5;
                let by = 150.0f32;
                for (i, id) in stages.iter().enumerate() {
                    let bx = row_x + i as f32 * (bw + gap_x);
                    if ax >= bx && ax <= bx + bw && ay >= by && ay <= by + bh {
                        self.region_selected = (*id).to_string();
                        self.restart_run(id, DEFAULT_SEED);
                        return;
                    }
                }
            }
            ScreenMode::Playing => {
                if self.state.victory && !self.state.post_clear {
                    if let Some(ref mut rw) = self.reward {
                        let snap = reward_rs::snapshot(rw);
                        if snap.phase == reward_rs::RewardPhase::Cards {
                            let card_w = 172.125f32;
                            let card_h = 109.125f32;
                            let card_gap = 7.125f32;
                            let card_y = 188.0f32;
                            let start_x = 129.0f32;
                            for i in 0..4usize {
                                let bx = start_x + i as f32 * (card_w + card_gap);
                                if ax >= bx
                                    && ax <= bx + card_w
                                    && ay >= card_y
                                    && ay <= card_y + card_h
                                {
                                    pick_reward(rw, i);
                                    return;
                                }
                            }
                        }
                    }
                } else if self.state.post_clear {
                    let mx = (VIEW_LEFT + VIEW_WIDTH) as f32 - 250.0;
                    let my = 120.0f32;
                    if ax >= mx && ax <= mx + 230.0 {
                        if ay >= my + 42.0 && ay <= my + 68.0 {
                            let st = self.state.stage_id.clone();
                            let seed = self.state.seed;
                            self.restart_run(&st, seed);
                        } else if ay >= my + 68.0 && ay <= my + 94.0 {
                            self.mode = ScreenMode::Region;
                        } else if ay >= my + 94.0 && ay <= my + 124.0 {
                            self.mode = ScreenMode::Town;
                        }
                    }
                }
            }
            ScreenMode::Town => {}
        }
    }

    fn restart_run(&mut self, stage_id: &str, seed: u32) {
        self.state = create_state(&CreateStateOptions {
            seed: Some(seed),
            stage: Some(stage_id),
            reference_profile: true,
            ..Default::default()
        });
        self.reward = None;
        self.paused = false;
        self.show_help = false;
        self.loadout_open = false;
        self.progress_panel = ProgressPanelKind::None;
        self.seen_hints.clear();
        self.active_hint = None;
        self.recorded_finish = false;
        self.last_kills_by_type.clear();
        self.last_barrels = 0;
        self.mode = ScreenMode::Playing;
    }

    fn toggle_progress_panel(&mut self, kind: ProgressPanelKind) {
        self.loadout_open = false;
        self.progress_panel = if self.progress_panel == kind {
            ProgressPanelKind::None
        } else {
            kind
        };
    }

    fn toggle_loadout_panel(&mut self) {
        self.progress_panel = ProgressPanelKind::None;
        self.loadout_open = !self.loadout_open;
    }

    fn apply_panel_action(&mut self, action: PanelAction) {
        match action {
            PanelAction::Close => {
                self.loadout_open = false;
                self.progress_panel = ProgressPanelKind::None;
            }
            PanelAction::InteractSlot(idx) => self.interact_panel_slot(idx),
            PanelAction::SalvageFirst => self.salvage_first_equipment(),
            PanelAction::SelectLoadoutSlot(slot) => {
                if slot < 6 {
                    self.loadout_slot = slot;
                }
            }
            PanelAction::AssignLoadoutSkill(skill_idx) => {
                if let Some(skill_id) = TABLES.skill_order.get(skill_idx) {
                    self.loadout = loadout_rs::assign(
                        &self.loadout,
                        self.loadout_slot,
                        Some(skill_id.as_str()),
                    );
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                }
            }
            PanelAction::CycleLoadoutSkill(delta) => self.cycle_loadout_skill(delta),
        }
    }

    fn cycle_loadout_skill(&mut self, delta: isize) {
        let order = &TABLES.skill_order;
        if order.is_empty() {
            return;
        }
        let cur = self
            .loadout
            .get(self.loadout_slot)
            .and_then(|s| s.as_deref());
        let cur_idx = cur
            .and_then(|id| order.iter().position(|s| s == id))
            .unwrap_or(0) as isize;
        let len = order.len() as isize;
        let next_idx = (cur_idx + delta).rem_euclid(len) as usize;
        let next_id = order[next_idx].as_str();
        self.loadout = loadout_rs::assign(&self.loadout, self.loadout_slot, Some(next_id));
        save::save_all(
            &self.asset_root,
            &self.records,
            &self.progress,
            &self.loadout,
        );
    }

    fn salvage_first_equipment(&mut self) {
        if self.progress_panel != ProgressPanelKind::Bag {
            return;
        }
        let target_id = self
            .progress
            .items
            .iter()
            .find(|(id, &cnt)| {
                cnt > 0
                    && progress_rs::item_spec(id)
                        .is_some_and(|sp| sp.category == progress_rs::ItemCategory::Equipment)
            })
            .map(|(id, _)| id.clone());
        if let Some(id) = target_id {
            if progress_rs::salvage(&mut self.progress, &id).is_some() {
                save::save_all(
                    &self.asset_root,
                    &self.records,
                    &self.progress,
                    &self.loadout,
                );
            }
        }
    }

    fn handle_digit(&mut self, idx: usize) {
        if self.mode == ScreenMode::Playing {
            if let Some(ref mut rw) = self.reward {
                if idx < 4 {
                    pick_reward(rw, idx);
                }
                return;
            }
        }
        if self.loadout_open {
            if idx < 6 {
                self.loadout_slot = idx;
            }
            return;
        }
        self.interact_panel_slot(idx);
    }

    fn interact_panel_slot(&mut self, slot_idx: usize) {
        match self.progress_panel {
            ProgressPanelKind::Bag => {
                let item_id = self
                    .progress
                    .items
                    .iter()
                    .filter(|(_, &cnt)| cnt > 0)
                    .nth(slot_idx)
                    .map(|(id, _)| id.clone());
                let Some(id) = item_id else {
                    return;
                };
                if let Some(eff) = progress_rs::use_item(&mut self.progress, &id) {
                    if self.mode == ScreenMode::Playing && !self.state.defeat {
                        self.state.player.hp = (self.state.player.hp + f64::from(eff.hp))
                            .min(self.state.player.max_hp);
                        self.state.player.mp = (self.state.player.mp + f64::from(eff.mp))
                            .min(self.state.player.max_mp);
                    }
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                } else if progress_rs::equip(
                    &mut self.progress,
                    &id,
                    "berserker",
                    self.state.player.level.max(1),
                ) {
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                }
            }
            ProgressPanelKind::Quest => {
                let Some(q) = progress_rs::QUESTS.get(slot_idx) else {
                    return;
                };
                let changed = progress_rs::accept(&mut self.progress, q.id)
                    || progress_rs::turn_in(&mut self.progress, q.id).is_some();
                if changed {
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                }
            }
            ProgressPanelKind::Equip => {
                let Some(slot) = progress_rs::EQUIP_SLOTS.get(slot_idx) else {
                    return;
                };
                if progress_rs::unequip(&mut self.progress, slot) {
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                }
            }
            ProgressPanelKind::Shop => {
                let Some(it) = progress_rs::ITEMS
                    .iter()
                    .filter(|it| it.category != progress_rs::ItemCategory::Material)
                    .nth(slot_idx)
                else {
                    return;
                };
                if self.progress.gold >= it.price {
                    progress_rs::add_gold(&mut self.progress, -i64::from(it.price));
                    progress_rs::add_item(&mut self.progress, it.id, 1);
                    save::save_all(
                        &self.asset_root,
                        &self.records,
                        &self.progress,
                        &self.loadout,
                    );
                }
            }
            _ => {}
        }
    }

    fn current_input(&self) -> Input {
        let mut inp = Input {
            left: self.held_keys.contains(&KeyCode::ArrowLeft),
            right: self.held_keys.contains(&KeyCode::ArrowRight),
            up: self.held_keys.contains(&KeyCode::ArrowUp),
            down: self.held_keys.contains(&KeyCode::ArrowDown),
            jump: self.held_keys.contains(&KeyCode::KeyC)
                || self.held_keys.contains(&KeyCode::Space),
            attack: self.held_keys.contains(&KeyCode::KeyX),
            skills: [false; 16],
        };
        let slot_codes = [
            KeyCode::KeyA,
            KeyCode::KeyS,
            KeyCode::KeyD,
            KeyCode::KeyF,
            KeyCode::KeyG,
            KeyCode::KeyH,
        ];
        for (i, code) in slot_codes.iter().enumerate() {
            if self.held_keys.contains(code) {
                if let Some(Some(sid)) = self.loadout.get(i) {
                    inp.set_skill(sid, true);
                }
            }
        }
        if self.held_keys.contains(&KeyCode::KeyZ) || self.cmd_upslash_timer > 0.0 {
            inp.set_skill("upSlash", true);
            if self.cmd_upslash_timer > 0.0 {
                inp.attack = false;
            }
        }
        if self.held_keys.contains(&KeyCode::KeyV) {
            inp.set_skill("hellbenter", true);
        }
        inp
    }

    fn tick(&mut self, dt: f64) {
        self.audio.sync_ambient(audio::ambient_for_scene(
            self.mode == ScreenMode::Playing,
            &self.state.stage_id,
        ));
        match self.mode {
            ScreenMode::Title => {
                step_attract(&mut self.attract, Some(dt));
                self.audio.sync_track(track_for(None, None, None, true));
            }
            ScreenMode::Region => {
                self.audio.sync_track(track_for(None, None, None, true));
            }
            ScreenMode::Town => {
                self.audio.sync_track(track_for(None, None, None, true));
                self.town_time += dt;
                if self.loadout_open || self.progress_panel != ProgressPanelKind::None {
                    self.town_moving = false;
                    self.town_walk = 0.0;
                    return;
                }
                let dx = i32::from(self.held_keys.contains(&KeyCode::ArrowRight))
                    - i32::from(self.held_keys.contains(&KeyCode::ArrowLeft));
                let dz = i32::from(self.held_keys.contains(&KeyCode::ArrowUp))
                    - i32::from(self.held_keys.contains(&KeyCode::ArrowDown));
                if dx != 0 {
                    self.town_facing = dx;
                }
                self.town_moving = dx != 0 || dz != 0;
                if self.town_moving {
                    self.town_walk += dt;
                } else {
                    self.town_walk = 0.0;
                }
                self.town_x = (self.town_x + f64::from(dx) * 220.0 * dt).clamp(80.0, 2440.0);
                self.town_z = (self.town_z + f64::from(dz) * 220.0 * 0.5 * dt).clamp(0.0, 100.0);
                let half_win = 56.0;
                let center = self.town_camera_x + VIEW_WIDTH * 0.5;
                if self.town_x < center - half_win {
                    self.town_camera_x = self.town_x + half_win - VIEW_WIDTH * 0.5;
                } else if self.town_x > center + half_win {
                    self.town_camera_x = self.town_x - half_win - VIEW_WIDTH * 0.5;
                }
                self.town_camera_x = self.town_camera_x.clamp(0.0, 2520.0 - VIEW_WIDTH);
            }
            ScreenMode::Playing => {
                let boss_cell = self.state.dungeon.as_ref().map(|d| d.boss);
                self.audio.sync_track(track_for(
                    Some(self.state.cell),
                    boss_cell,
                    Some(&self.state.stage_id),
                    false,
                ));
                if !self.paused && !self.show_help && !self.loadout_open {
                    self.cmd_upslash_timer = (self.cmd_upslash_timer - dt).max(0.0);
                    let inp = self.current_input();
                    step_core(&mut self.state, &inp, Some(dt));
                    let sounds = drain_sounds(&mut self.state);
                    self.audio.play_events(&sounds);

                    for (kind, &total) in &self.state.stats.kills_by_type {
                        let prev = self.last_kills_by_type.get(kind).copied().unwrap_or(0);
                        if total > prev {
                            let dk = total - prev;
                            self.last_kills_by_type.insert(kind.clone(), total);
                            note_kill(&mut self.progress, kind, dk);
                        }
                    }
                    if self.state.stats.barrels > self.last_barrels {
                        let db = self.state.stats.barrels - self.last_barrels;
                        self.last_barrels = self.state.stats.barrels;
                        note_break(&mut self.progress, db);
                    }

                    if let Some((_, ref mut ttl)) = self.active_hint {
                        *ttl -= dt;
                        if *ttl <= 0.0 {
                            self.active_hint = None;
                        }
                    }
                    if self.active_hint.is_none() {
                        if let Some(sel) = hints_rs::select(&self.state, &self.seen_hints) {
                            self.seen_hints.insert(sel.id.to_string());
                            self.active_hint = Some((sel.text.to_string(), sel.life));
                        }
                    }

                    if self.state.victory && !self.recorded_finish {
                        self.recorded_finish = true;
                        let res = record_run(
                            &self.records,
                            &RunInput {
                                stage: Some(&self.state.stage_id),
                                seed: Some(self.state.seed),
                                seconds: self.state.time,
                                level: self.state.player.level,
                                updated_at: None,
                            },
                        );
                        self.records = res.store;
                        note_clear(&mut self.progress, &self.state.stage_id);
                        self.reward =
                            create_reward(Some(self.state.seed), Some(&self.state.stage_id));
                        save::save_all(
                            &self.asset_root,
                            &self.records,
                            &self.progress,
                            &self.loadout,
                        );
                    }

                    if let Some(ref mut rw) = self.reward {
                        step_reward(rw, dt);
                        if let Some(prize) = take_prize(rw) {
                            self.audio.play_events(&[core_rs::types::SoundEvent {
                                kind: "rewardOpen".to_string(),
                                x: self.state.player.x,
                                z: self.state.player.z,
                                t: self.state.time,
                                enemy_type: None,
                                attack_kind: None,
                                skill_id: None,
                                stage: None,
                                native_object: None,
                                enemy_id: None,
                            }]);
                            progress_rs::add_item(&mut self.progress, &prize.item_id, 1);
                            progress_rs::add_gold(&mut self.progress, i64::from(prize.gold));
                            save::save_all(
                                &self.asset_root,
                                &self.records,
                                &self.progress,
                                &self.loadout,
                            );
                        }
                        if reward_rs::snapshot(rw).phase == reward_rs::RewardPhase::Done
                            && self.state.victory
                            && !self.state.post_clear
                        {
                            core_rs::resume_after_clear(&mut self.state);
                        }
                    }
                }
            }
        }
    }

    fn draw_and_present(&mut self) {
        let hover_view = Some(render_to_view_coords(self.cursor_pos.0, self.cursor_pos.1));
        {
            let mut canvas = Canvas::new(&mut self.pixmap, &mut self.fonts);
            if self.mode == ScreenMode::Town {
                let pname = self.state.player.name.as_deref().unwrap_or("鬼剑士");
                draw_town_view(
                    &mut canvas,
                    &TownView {
                        player_x: self.town_x,
                        player_z: self.town_z,
                        facing: self.town_facing,
                        camera_x: self.town_camera_x,
                        time: self.town_time,
                        moving: self.town_moving,
                        walk: self.town_walk,
                        player_level: self.state.player.level.max(1),
                        player_name: pname,
                    },
                    &self.sprites,
                );
                let town_meta = RenderMeta {
                    title: false,
                    attract: false,
                    paused: false,
                    show_help: false,
                    loadout: &self.loadout,
                    loadout_open: self.loadout_open,
                    progress_panel: ProgressPanelKind::None,
                    progress: &self.progress,
                    records: &self.records,
                    reward: None,
                    region_open: false,
                    region_selected: &self.region_selected,
                    hint: None,
                    seed: self.state.seed,
                    stage_id: &self.state.stage_id,
                };
                render_rs::hud::draw_hud_video(&mut canvas, &self.state, &self.sprites, &town_meta);
                if self.progress_panel != ProgressPanelKind::None {
                    render_rs::draw_progress_panel(
                        &mut canvas,
                        &self.sprites,
                        self.progress_panel,
                        &self.progress,
                        hover_view,
                    );
                }
                if self.loadout_open {
                    render_rs::draw_loadout_panel(
                        &mut canvas,
                        &self.sprites,
                        &self.loadout,
                        self.loadout_slot,
                        hover_view,
                    );
                }
            } else {
                let active_state = if self.mode == ScreenMode::Title {
                    &self.attract.state
                } else {
                    &self.state
                };
                let hint_ref = self.active_hint.as_ref().map(|(s, _)| s.as_str());
                let meta = RenderMeta {
                    title: self.mode == ScreenMode::Title,
                    attract: self.mode == ScreenMode::Title,
                    paused: self.paused,
                    show_help: self.show_help,
                    loadout: &self.loadout,
                    loadout_open: self.loadout_open,
                    progress_panel: ProgressPanelKind::None,
                    progress: &self.progress,
                    records: &self.records,
                    reward: self.reward.as_ref(),
                    region_open: self.mode == ScreenMode::Region,
                    region_selected: &self.region_selected,
                    hint: hint_ref,
                    seed: active_state.seed,
                    stage_id: &active_state.stage_id,
                };
                render(&mut canvas, active_state, &self.sprites, &meta);
                if self.progress_panel != ProgressPanelKind::None {
                    render_rs::draw_progress_panel(
                        &mut canvas,
                        &self.sprites,
                        self.progress_panel,
                        &self.progress,
                        hover_view,
                    );
                }
                if self.loadout_open {
                    render_rs::draw_loadout_panel(
                        &mut canvas,
                        &self.sprites,
                        &self.loadout,
                        self.loadout_slot,
                        hover_view,
                    );
                }
            }
        }

        let Some(ref mut surface) = self.surface else {
            return;
        };
        let Some(ref window) = self.window else {
            return;
        };
        let size = window.inner_size();
        let (win_w, win_h) = (size.width.max(1), size.height.max(1));
        if let (Some(nz_w), Some(nz_h)) = (NonZeroU32::new(win_w), NonZeroU32::new(win_h)) {
            let _ = surface.resize(nz_w, nz_h);
        }
        let Ok(mut buffer) = surface.buffer_mut() else {
            return;
        };
        let src = self.pixmap.data();
        let sw = self.pixmap.width() as usize;
        let sh = self.pixmap.height() as usize;
        // Preserve 4:3 aspect ratio with crisp nearest-neighbor scaling and black letterbox/pillarbox
        let (off_x, off_y, dst_w, dst_h) =
            compute_present_rect(win_w as usize, win_h as usize, sw, sh);
        buffer.fill(0);
        for dy in 0..dst_h {
            let sy = (dy * sh) / dst_h;
            let row_off = (off_y + dy) * win_w as usize + off_x;
            let src_row = sy * sw;
            for dx in 0..dst_w {
                let sx = (dx * sw) / dst_w;
                let p = (src_row + sx) * 4;
                let r = u32::from(src[p]);
                let g = u32::from(src[p + 1]);
                let b = u32::from(src[p + 2]);
                buffer[row_off + dx] = (r << 16) | (g << 8) | b;
            }
        }
        let _ = buffer.present();
    }

    fn handle_key(&mut self, code: KeyCode, pressed: bool) {
        if pressed {
            self.held_keys.insert(code);
        } else {
            self.held_keys.remove(&code);
            return;
        }

        if is_fullscreen_toggle(code, &self.held_keys) {
            self.toggle_fullscreen();
            return;
        }

        if code == KeyCode::KeyM {
            self.audio.toggle_mute();
            return;
        }
        if code == KeyCode::F2 {
            let on = self.audio.toggle_music();
            self.active_hint = Some((
                if on {
                    "背景音乐: 开 (F2 切换)".to_string()
                } else {
                    "背景音乐: 关 (F2 切换)".to_string()
                },
                2.0,
            ));
            return;
        }

        match self.mode {
            ScreenMode::Title => {
                self.mode = ScreenMode::Region;
            }
            ScreenMode::Region => match code {
                KeyCode::ArrowUp
                | KeyCode::ArrowDown
                | KeyCode::ArrowLeft
                | KeyCode::ArrowRight => {
                    self.region_selected = if self.region_selected == "mirkwood" {
                        "mirkwooddeep".to_string()
                    } else {
                        "mirkwood".to_string()
                    };
                }
                KeyCode::Enter | KeyCode::Space => {
                    let st = self.region_selected.clone();
                    self.restart_run(&st, DEFAULT_SEED);
                }
                KeyCode::Escape => {
                    self.mode = ScreenMode::Town;
                }
                _ => {}
            },
            ScreenMode::Town => match code {
                KeyCode::Enter | KeyCode::Space => {
                    if !self.loadout_open && self.progress_panel == ProgressPanelKind::None {
                        if (self.town_x - 2420.0).abs() < 75.0 {
                            self.mode = ScreenMode::Region;
                        } else if (self.town_z - 50.0).abs() < 45.0 {
                            if (self.town_x - 650.0).abs() < 65.0
                                || (self.town_x - 900.0).abs() < 65.0
                                || (self.town_x - 1150.0).abs() < 65.0
                            {
                                self.progress_panel = ProgressPanelKind::Quest;
                            } else if (self.town_x - 1400.0).abs() < 65.0 {
                                self.progress_panel = ProgressPanelKind::Shop;
                            } else if (self.town_x - 2000.0).abs() < 65.0 {
                                self.progress_panel = ProgressPanelKind::Bag;
                            } else {
                                self.mode = ScreenMode::Region;
                            }
                        } else {
                            self.mode = ScreenMode::Region;
                        }
                    }
                }
                KeyCode::KeyI => self.toggle_progress_panel(ProgressPanelKind::Bag),
                KeyCode::KeyK => self.toggle_progress_panel(ProgressPanelKind::Equip),
                KeyCode::KeyL => self.toggle_progress_panel(ProgressPanelKind::Quest),
                KeyCode::KeyU => self.toggle_progress_panel(ProgressPanelKind::Shop),
                KeyCode::KeyB => self.toggle_loadout_panel(),
                KeyCode::Backspace => self.salvage_first_equipment(),
                KeyCode::ArrowLeft if self.loadout_open => self.cycle_loadout_skill(-1),
                KeyCode::ArrowRight if self.loadout_open => self.cycle_loadout_skill(1),
                KeyCode::Digit1 => self.handle_digit(0),
                KeyCode::Digit2 => self.handle_digit(1),
                KeyCode::Digit3 => self.handle_digit(2),
                KeyCode::Digit4 => self.handle_digit(3),
                KeyCode::Digit5 => self.handle_digit(4),
                KeyCode::Digit6 => self.handle_digit(5),
                KeyCode::Digit7 => self.handle_digit(6),
                KeyCode::Digit8 => self.handle_digit(7),
                KeyCode::Digit9 => self.handle_digit(8),
                KeyCode::Escape => {
                    if self.loadout_open {
                        self.loadout_open = false;
                    } else if self.progress_panel != ProgressPanelKind::None {
                        self.progress_panel = ProgressPanelKind::None;
                    } else {
                        self.mode = ScreenMode::Region;
                    }
                }
                _ => {}
            },
            ScreenMode::Playing => match code {
                KeyCode::KeyX
                    if !self.paused
                        && !self.show_help
                        && !self.loadout_open
                        && self.held_keys.contains(&KeyCode::ArrowUp) =>
                {
                    self.cmd_upslash_timer = 0.08;
                }
                KeyCode::KeyP => self.paused = !self.paused,
                KeyCode::F1 => self.show_help = !self.show_help,
                KeyCode::Escape => {
                    self.show_help = false;
                    self.loadout_open = false;
                    self.progress_panel = ProgressPanelKind::None;
                }
                KeyCode::F3 => {
                    let st = self.state.stage_id.clone();
                    let seed = self.state.seed;
                    self.restart_run(&st, seed);
                }
                KeyCode::F4 => {
                    self.loadout_open = false;
                    self.progress_panel = ProgressPanelKind::None;
                    self.mode = ScreenMode::Town;
                }
                KeyCode::KeyN => {
                    let st = self.state.stage_id.clone();
                    let next_seed = self.state.seed.wrapping_add(1);
                    self.restart_run(&st, next_seed);
                }
                KeyCode::Digit1 => self.handle_digit(0),
                KeyCode::Digit2 => self.handle_digit(1),
                KeyCode::Digit3 => self.handle_digit(2),
                KeyCode::Digit4 => self.handle_digit(3),
                KeyCode::Digit5 => self.handle_digit(4),
                KeyCode::Digit6 => self.handle_digit(5),
                KeyCode::Digit7 => self.handle_digit(6),
                KeyCode::Digit8 => self.handle_digit(7),
                KeyCode::Digit9 => self.handle_digit(8),
                KeyCode::KeyI => self.toggle_progress_panel(ProgressPanelKind::Bag),
                KeyCode::KeyK => self.toggle_progress_panel(ProgressPanelKind::Equip),
                KeyCode::KeyL => self.toggle_progress_panel(ProgressPanelKind::Quest),
                KeyCode::KeyB => self.toggle_loadout_panel(),
                KeyCode::Backspace => self.salvage_first_equipment(),
                KeyCode::ArrowLeft if self.loadout_open => self.cycle_loadout_skill(-1),
                KeyCode::ArrowRight if self.loadout_open => self.cycle_loadout_skill(1),
                KeyCode::Enter | KeyCode::Space if self.state.victory && !self.state.post_clear => {
                    core_rs::resume_after_clear(&mut self.state);
                }
                _ => {}
            },
        }
    }
}

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("nano-dnf · 鬼剑士的地下城 (Rust)")
            .with_inner_size(LogicalSize::new(
                f64::from(DEFAULT_WINDOW_WIDTH),
                f64::from(DEFAULT_WINDOW_HEIGHT),
            ));
        if let Ok(win) = event_loop.create_window(attrs) {
            let win_rc = Rc::new(win);
            if let Ok(ctx) = Context::new(win_rc.clone()) {
                if let Ok(surf) = Surface::new(&ctx, win_rc.clone()) {
                    self.surface = Some(surf);
                }
            }
            self.window = Some(win_rc);
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                save::save_all(
                    &self.asset_root,
                    &self.records,
                    &self.progress,
                    &self.loadout,
                );
                event_loop.exit();
            }
            WindowEvent::Focused(false) => {
                self.held_keys.clear();
            }
            WindowEvent::CursorMoved { position, .. } => {
                if let Some((rx, ry)) = self.map_window_cursor(position.x, position.y) {
                    self.cursor_pos = (rx, ry);
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: winit::event::MouseButton::Left,
                ..
            } => {
                let (ax, ay) = self.cursor_pos;
                self.handle_click(ax, ay);
            }
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(code),
                        state,
                        ..
                    },
                ..
            } => {
                self.handle_key(code, state == ElementState::Pressed);
            }
            WindowEvent::RedrawRequested => {
                let now = Instant::now();
                let elapsed = (now - self.last_tick).as_secs_f64().min(0.1);
                self.last_tick = now;
                self.accumulator += elapsed;
                while self.accumulator >= DT {
                    self.tick(DT);
                    self.accumulator -= DT;
                }
                self.draw_and_present();
                if let Some(ref win) = self.window {
                    win.request_redraw();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_micros(16_667),
        ));
        if let Some(ref win) = self.window {
            win.request_redraw();
        }
    }
}

fn main() {
    let event_loop = match EventLoop::new() {
        Ok(el) => el,
        Err(err) => {
            eprintln!("Failed to initialize event loop: {err}");
            return;
        }
    };
    let mut app = AppState::new();
    let _ = event_loop.run_app(&mut app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_present_rect_preserves_4_3_aspect_ratio() {
        // Default 1200x900 window fills edge-to-edge at 1.5x
        assert_eq!(
            compute_present_rect(1200, 900, RENDER_WIDTH as usize, RENDER_HEIGHT as usize),
            (0, 0, 1200, 900)
        );
        // 1920x1080 widescreen fullscreen pillarboxes to centered 1440x1080
        assert_eq!(
            compute_present_rect(1920, 1080, RENDER_WIDTH as usize, RENDER_HEIGHT as usize),
            (240, 0, 1440, 1080)
        );
        // 800x1000 tall window letterboxes to centered 800x600
        assert_eq!(
            compute_present_rect(800, 1000, RENDER_WIDTH as usize, RENDER_HEIGHT as usize),
            (0, 200, 800, 600)
        );
    }

    #[test]
    fn test_mouse_mapping_to_800x600_and_view_coords() {
        // Default 1200x900 window: center (600, 450) -> (400, 300) in 800x600 -> (480, 270) in view
        let (rx, ry) = map_window_to_render(1200.0, 900.0, 600.0, 450.0).expect("inside");
        assert!((rx - 400.0).abs() < 1e-3);
        assert!((ry - 300.0).abs() < 1e-3);
        let (lx, ly) = render_to_view_coords(rx, ry);
        assert!((lx - 480.0).abs() < 1e-3);
        assert!((ly - 270.0).abs() < 1e-3);

        // 1920x1080 widescreen: pillarbox click returns None; content top-left (240, 0) -> (0, 0)
        assert!(map_window_to_render(1920.0, 1080.0, 100.0, 540.0).is_none());
        let (rx0, ry0) = map_window_to_render(1920.0, 1080.0, 240.0, 0.0).expect("top-left");
        assert!(rx0.abs() < 1e-3);
        assert!(ry0.abs() < 1e-3);
        let (lx0, ly0) = render_to_view_coords(rx0, ry0);
        assert!((lx0 - VIEW_LEFT as f32).abs() < 1e-3);
        assert!(ly0.abs() < 1e-3);
    }

    #[test]
    fn test_alt_enter_fullscreen_toggle_detection() {
        let mut held = HashSet::new();
        assert!(!is_fullscreen_toggle(KeyCode::Enter, &held));

        held.insert(KeyCode::AltLeft);
        assert!(is_fullscreen_toggle(KeyCode::Enter, &held));
        assert!(is_fullscreen_toggle(KeyCode::NumpadEnter, &held));
        assert!(!is_fullscreen_toggle(KeyCode::Space, &held));

        held.clear();
        held.insert(KeyCode::AltRight);
        assert!(is_fullscreen_toggle(KeyCode::Enter, &held));
    }
}
