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
    draw_region_select, draw_town_hud, draw_town_view, hit_test_consumable_slot, hit_test_continue,
    hit_test_loadout_panel, hit_test_minimap, hit_test_progress_panel, hit_test_region_select,
    hit_test_reward_card, render, step_town_motion, town_interact_action, Canvas, ContinueAction,
    GlyphCache, MapMode, PanelAction, ProgressPanelKind, RegionSelectAction, RenderMeta,
    SpriteStore, TownMotion, TownNpcAction, TownStepEvent, TownView, DEFAULT_WINDOW_HEIGHT,
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
    player_name: String,
    reward: Option<RewardState>,
    paused: bool,
    show_help: bool,
    loadout_open: bool,
    loadout_slot: usize,
    progress_panel: ProgressPanelKind,
    map_mode: MapMode,
    region_selected: String,
    region_abyss: bool,
    town: TownMotion,
    town_time: f64,
    held_keys: HashSet<KeyCode>,
    seen_hints: HashSet<String>,
    active_hint: Option<(String, f64)>,
    recorded_finish: bool,
    last_kills_by_type: HashMap<String, u32>,
    last_barrels: u32,
    last_gold: u32,
    last_loot: u32,
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
        let (records, progress, loadout, player_name) =
            save::load_all(&asset_root, &valid_skills, DEFAULT_STAGE);
        let mut state = create_state(&CreateStateOptions {
            stage: Some(DEFAULT_STAGE),
            reference_profile: true,
            ..Default::default()
        });
        state.player.name = Some(player_name.clone());
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
            player_name,
            reward: None,
            paused: false,
            show_help: false,
            loadout_open: false,
            loadout_slot: 0,
            progress_panel: ProgressPanelKind::None,
            map_mode: MapMode::Radar,
            region_selected: DEFAULT_STAGE.to_string(),
            region_abyss: false,
            town: TownMotion::enter_seria_room(),
            town_time: 0.0,
            held_keys: HashSet::new(),
            seen_hints: HashSet::new(),
            active_hint: None,
            recorded_finish: false,
            last_kills_by_type: HashMap::new(),
            last_barrels: 0,
            last_gold: 0,
            last_loot: 0,
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
                self.town = TownMotion::enter_seria_room();
                self.mode = ScreenMode::Town;
            }
            ScreenMode::Region => {
                if let Some(action) = hit_test_region_select(&self.region_selected, ax, ay) {
                    match action {
                        RegionSelectAction::SelectStage(id) => {
                            if self.region_selected == id {
                                self.restart_run(id, DEFAULT_SEED);
                            } else {
                                self.region_selected = id.to_string();
                            }
                        }
                        RegionSelectAction::EnterDungeon => {
                            let st = self.region_selected.clone();
                            self.restart_run(&st, DEFAULT_SEED);
                        }
                        RegionSelectAction::ReturnTown => {
                            self.mode = ScreenMode::Town;
                        }
                        RegionSelectAction::ToggleAbyss => {
                            self.region_abyss = !self.region_abyss;
                        }
                    }
                }
            }
            ScreenMode::Playing => {
                if self.state.victory && !self.state.post_clear {
                    if let Some(card_idx) = hit_test_reward_card(ax, ay) {
                        if let Some(ref mut rw) = self.reward {
                            if pick_reward(rw, card_idx) {
                                self.claim_reward_prize();
                            }
                        }
                    }
                } else if self.state.post_clear {
                    if let Some(action) = hit_test_continue(ax, ay) {
                        match action {
                            ContinueAction::Retry => {
                                let st = self.state.stage_id.clone();
                                let seed = self.state.seed;
                                self.restart_run(&st, seed);
                            }
                            ContinueAction::SelectStage => {
                                self.mode = ScreenMode::Region;
                            }
                            ContinueAction::ReturnTown => {
                                self.town = TownMotion::return_from_dungeon();
                                self.mode = ScreenMode::Town;
                            }
                        }
                    }
                } else if !self.paused && !self.show_help {
                    if let Some(slot_idx) = hit_test_consumable_slot(ax, ay) {
                        if try_use_consumable_slot(&mut self.state, &mut self.progress, slot_idx) {
                            self.persist_save();
                        }
                        return;
                    }
                    if !self.state.defeat {
                        if let Some(ref dun) = self.state.dungeon {
                            if hit_test_minimap(ax, ay, self.map_mode, dun.cols, dun.rows) {
                                self.map_mode = self.map_mode.toggle();
                            }
                        }
                    }
                }
            }
            ScreenMode::Town => {}
        }
    }

    fn persist_save(&self) {
        save::save_all(
            &self.asset_root,
            &self.records,
            &self.progress,
            &self.loadout,
            &self.player_name,
        );
    }

    fn restart_run(&mut self, stage_id: &str, seed: u32) {
        self.state = create_state(&CreateStateOptions {
            seed: Some(seed),
            stage: Some(stage_id),
            reference_profile: true,
            ..Default::default()
        });
        self.state.player.name = Some(self.player_name.clone());
        self.reward = None;
        self.paused = false;
        self.show_help = false;
        self.loadout_open = false;
        self.progress_panel = ProgressPanelKind::None;
        self.map_mode = MapMode::Radar;
        self.seen_hints.clear();
        self.active_hint = None;
        self.recorded_finish = false;
        self.last_kills_by_type.clear();
        self.last_barrels = 0;
        self.last_gold = 0;
        self.last_loot = 0;
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
                    self.persist_save();
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
        self.persist_save();
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
                self.persist_save();
            }
        }
    }

    fn play_reward_open_sfx(&mut self) {
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
    }

    fn claim_reward_prize(&mut self) {
        let prize = self.reward.as_mut().and_then(take_prize);
        if let Some(prize) = prize {
            self.play_reward_open_sfx();
            progress_rs::add_item(&mut self.progress, &prize.item_id, 1);
            progress_rs::add_gold(&mut self.progress, i64::from(prize.gold));
            self.persist_save();
        }
    }

    fn handle_digit(&mut self, idx: usize) {
        if self.mode == ScreenMode::Playing && self.state.victory && !self.state.post_clear {
            if let Some(ref mut rw) = self.reward {
                if idx < 4 && pick_reward(rw, idx) {
                    self.claim_reward_prize();
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
        if self.mode == ScreenMode::Playing
            && self.progress_panel == ProgressPanelKind::None
            && !self.paused
            && !self.show_help
            && idx < 6
        {
            if try_use_consumable_slot(&mut self.state, &mut self.progress, idx) {
                self.persist_save();
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
                if id == "resurrectCoin" {
                    return;
                }
                if let Some(eff) = progress_rs::use_item(&mut self.progress, &id) {
                    if self.mode == ScreenMode::Playing && !self.state.defeat {
                        self.state.player.hp = (self.state.player.hp + f64::from(eff.hp))
                            .min(self.state.player.max_hp);
                        self.state.player.mp = (self.state.player.mp + f64::from(eff.mp))
                            .min(self.state.player.max_mp);
                    }
                    self.persist_save();
                } else if progress_rs::equip(
                    &mut self.progress,
                    &id,
                    "berserker",
                    self.state.player.level.max(1),
                ) {
                    self.persist_save();
                }
            }
            ProgressPanelKind::Quest => {
                let Some(q) = progress_rs::QUESTS.get(slot_idx) else {
                    return;
                };
                let changed = progress_rs::accept(&mut self.progress, q.id)
                    || progress_rs::turn_in(&mut self.progress, q.id).is_some();
                if changed {
                    self.persist_save();
                }
            }
            ProgressPanelKind::Equip => {
                let Some(slot) = progress_rs::EQUIP_SLOTS.get(slot_idx) else {
                    return;
                };
                if progress_rs::unequip(&mut self.progress, slot) {
                    self.persist_save();
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
                    self.persist_save();
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
                let bgm = match self.town.zone {
                    render_rs::TownZone::SeriaRoom => "assets/music/gate_new.ogg",
                    render_rs::TownZone::Alley
                    | render_rs::TownZone::Plaza
                    | render_rs::TownZone::WestBridge => "assets/music/hendonmyre_new.ogg",
                };
                self.audio.sync_bgm_file(bgm);
                self.town_time += dt;
                if self.loadout_open || self.progress_panel != ProgressPanelKind::None {
                    self.town.moving = false;
                    self.town.walk = 0.0;
                    return;
                }
                let dx = i32::from(self.held_keys.contains(&KeyCode::ArrowRight))
                    - i32::from(self.held_keys.contains(&KeyCode::ArrowLeft));
                let dz = i32::from(self.held_keys.contains(&KeyCode::ArrowUp))
                    - i32::from(self.held_keys.contains(&KeyCode::ArrowDown));
                if step_town_motion(&mut self.town, dx, dz, dt) == TownStepEvent::OpenRegion {
                    self.mode = ScreenMode::Region;
                }
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
                    sync_collected_loot(
                        &mut self.progress,
                        &mut self.last_gold,
                        &mut self.last_loot,
                        &self.state,
                    );

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
                        self.persist_save();
                    }

                    let mut chest_opened = false;
                    if let Some(ref mut rw) = self.reward {
                        let prev_phase = rw.phase;
                        step_reward(rw, dt);
                        chest_opened = should_play_chest_open_sfx(prev_phase, rw.phase);
                    }
                    if chest_opened {
                        self.play_reward_open_sfx();
                    }
                    self.claim_reward_prize();
                    if self.reward.as_ref().is_some_and(|rw| {
                        reward_rs::snapshot(rw).phase == reward_rs::RewardPhase::Done
                    }) && self.state.victory
                        && !self.state.post_clear
                    {
                        core_rs::resume_after_clear(&mut self.state);
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
                let pname = self
                    .state
                    .player
                    .name
                    .as_deref()
                    .unwrap_or(&self.player_name);
                draw_town_view(
                    &mut canvas,
                    &TownView {
                        zone: self.town.zone,
                        player_x: self.town.x,
                        player_z: self.town.z,
                        facing: self.town.facing,
                        camera_x: self.town.camera_x,
                        time: self.town_time,
                        moving: self.town.moving,
                        walk: self.town.walk,
                        player_level: self.state.player.level.max(1),
                        player_name: pname,
                        zone_fade_alpha: self.town.zone_fade_alpha(),
                        title_alpha: self.town.title_alpha(),
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
                    map_mode: self.map_mode,
                    continue_hover: None,
                    reward_card_hover: None,
                };
                draw_town_hud(&mut canvas, &self.state, &self.sprites, &town_meta);
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
            } else if self.mode == ScreenMode::Region {
                let region_hover = if self.progress_panel == ProgressPanelKind::None
                    && !self.loadout_open
                {
                    hover_view
                        .and_then(|(ax, ay)| hit_test_region_select(&self.region_selected, ax, ay))
                } else {
                    None
                };
                draw_region_select(
                    &mut canvas,
                    &self.sprites,
                    &self.region_selected,
                    region_hover,
                    self.region_abyss,
                );
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
                let continue_hover = if active_state.post_clear
                    && !self.paused
                    && !self.show_help
                    && self.progress_panel == ProgressPanelKind::None
                {
                    hover_view.and_then(|(ax, ay)| hit_test_continue(ax, ay))
                } else {
                    None
                };
                let reward_card_hover = if active_state.victory && !active_state.post_clear {
                    hover_view.and_then(|(ax, ay)| hit_test_reward_card(ax, ay))
                } else {
                    None
                };
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
                    map_mode: self.map_mode,
                    continue_hover,
                    reward_card_hover,
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
                self.town = TownMotion::enter_seria_room();
                self.mode = ScreenMode::Town;
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
                        match town_interact_action(self.town.zone, self.town.x, self.town.z) {
                            TownNpcAction::Quest => {
                                self.progress_panel = ProgressPanelKind::Quest;
                            }
                            TownNpcAction::Loadout => {
                                self.loadout_open = true;
                            }
                            TownNpcAction::Shop => {
                                self.progress_panel = ProgressPanelKind::Shop;
                            }
                            TownNpcAction::Bag => {
                                self.progress_panel = ProgressPanelKind::Bag;
                            }
                            TownNpcAction::Region => {
                                self.mode = ScreenMode::Region;
                            }
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
                KeyCode::KeyX | KeyCode::Space | KeyCode::Digit6
                    if self.state.defeat
                        && !self.paused
                        && !self.show_help
                        && !self.loadout_open
                        && self.progress_panel == ProgressPanelKind::None =>
                {
                    if try_resurrect_on_defeat(&mut self.state, &mut self.progress) {
                        self.persist_save();
                    }
                }
                KeyCode::KeyX
                    if !self.paused
                        && !self.show_help
                        && !self.loadout_open
                        && self.held_keys.contains(&KeyCode::ArrowUp) =>
                {
                    self.cmd_upslash_timer = 0.08;
                }
                KeyCode::Tab
                    if !self.paused
                        && !self.show_help
                        && !self.state.victory
                        && !self.state.defeat
                        && !self.state.post_clear =>
                {
                    self.map_mode = self.map_mode.toggle();
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
                    self.town = TownMotion::return_from_dungeon();
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
                self.persist_save();
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

fn try_resurrect_on_defeat(state: &mut State, progress: &mut ProgressProfile) -> bool {
    if !state.defeat && !state.player.dead {
        return false;
    }
    if progress_rs::consumable_count(progress, "resurrectCoin") == 0 {
        return false;
    }
    if core_rs::combat::resurrect_player(state) {
        progress_rs::consume_resurrect_coin(progress);
        return true;
    }
    false
}

fn try_use_consumable_slot(
    state: &mut State,
    progress: &mut ProgressProfile,
    slot_idx: usize,
) -> bool {
    let Some(&Some(item_id)) = progress_rs::CONSUMABLE_QUICKBAR_SLOTS.get(slot_idx) else {
        return false;
    };
    if item_id == "resurrectCoin" {
        return try_resurrect_on_defeat(state, progress);
    }
    if state.defeat || state.player.dead {
        return false;
    }
    if state.player.consumable_cooldowns[slot_idx] > 0.0 {
        return false;
    }
    if progress_rs::consumable_count(progress, item_id) == 0 {
        return false;
    }
    let Some(spec) = progress_rs::item_spec(item_id) else {
        return false;
    };
    if core_rs::combat::apply_consumable_effect(
        state,
        slot_idx,
        spec.name,
        f64::from(spec.hp),
        f64::from(spec.mp),
    ) {
        progress_rs::use_item(progress, item_id);
        return true;
    }
    false
}

fn should_play_chest_open_sfx(prev: reward_rs::RewardPhase, next: reward_rs::RewardPhase) -> bool {
    prev == reward_rs::RewardPhase::Chest && next == reward_rs::RewardPhase::Cards
}

fn loot_item_id_for_log_line(text: &str) -> Option<&'static str> {
    let rest = text.strip_prefix("获得[")?;
    let name = rest.split(']').next()?;
    let id = match name {
        "诺顿的新手HP药剂" | "HP 药水" | "野生草莓" | "越桔" | "烤硬的黑面包" => {
            "hpPotion"
        }
        "MP 药水" | "冰冻水" | "魔力之花" => "mpPotion",
        "复活币" | "命运硬币" => "resurrectCoin",
        "古老的法杖" => "ancientStaff",
        "古老的库尼族图腾" => "kunicTotem",
        "粗布上衣" => "clothArmor",
        "锈蚀短剑" => "rustyBlade",
        "生锈的铁剑" => "starterBlade",
        "铜戒指" => "copperRing",
        _ => "material",
    };
    Some(id)
}

fn sync_collected_loot(
    progress: &mut ProgressProfile,
    last_gold: &mut u32,
    last_loot: &mut u32,
    state: &State,
) {
    if state.stats.gold > *last_gold {
        let dg = state.stats.gold - *last_gold;
        *last_gold = state.stats.gold;
        progress_rs::add_gold(progress, i64::from(dg));
    }
    if state.stats.loot > *last_loot {
        let dl = (state.stats.loot - *last_loot) as usize;
        *last_loot = state.stats.loot;
        let item_ids: Vec<&'static str> = state
            .log
            .iter()
            .rev()
            .filter_map(|entry| loot_item_id_for_log_line(&entry.text))
            .take(dl)
            .collect();
        for item_id in item_ids {
            progress_rs::add_item(progress, item_id, 1);
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

    #[test]
    fn test_sync_collected_loot_updates_gold_and_bag() {
        let mut progress = progress_rs::defaults();
        let initial_gold = progress.gold;
        let initial_mat = progress.items.get("material").copied().unwrap_or(0);
        let initial_hp = progress.items.get("hpPotion").copied().unwrap_or(0);

        let mut state = create_state(&CreateStateOptions {
            stage: Some(DEFAULT_STAGE),
            reference_profile: true,
            ..Default::default()
        });
        let drop1 = core_rs::types::Pickup {
            kind: "loot".to_string(),
            name: "生锈的铁片".to_string(),
            tone: "white".to_string(),
            gold: 44,
            exp: 0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            radius: 0.0,
            value: 0.0,
            life: 10.0,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        };
        let drop2 = core_rs::types::Pickup {
            kind: "loot".to_string(),
            name: "诺顿的新手HP药剂".to_string(),
            tone: "cyan".to_string(),
            gold: 65,
            exp: 0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            radius: 0.0,
            value: 0.0,
            life: 10.0,
            from_x: 0.0,
            from_y: 0.0,
            from_z: 0.0,
            progress: 0.0,
            trail: Vec::new(),
        };
        core_rs::combat::collect_loot(&mut state, &drop1);
        core_rs::combat::collect_loot(&mut state, &drop2);

        let mut last_gold = 0;
        let mut last_loot = 0;
        sync_collected_loot(&mut progress, &mut last_gold, &mut last_loot, &state);

        assert_eq!(progress.gold, initial_gold + 109);
        assert_eq!(
            progress.items.get("material").copied().unwrap_or(0),
            initial_mat + 1
        );
        assert_eq!(
            progress.items.get("hpPotion").copied().unwrap_or(0),
            initial_hp + 1
        );
        // Second call with no new pickups is a no-op
        sync_collected_loot(&mut progress, &mut last_gold, &mut last_loot, &state);
        assert_eq!(progress.gold, initial_gold + 109);
    }

    #[test]
    fn test_consumable_quickbar_usage_stack_decrement_and_cooldown() {
        let mut progress = progress_rs::defaults();
        let mut state = create_state(&CreateStateOptions {
            stage: Some(DEFAULT_STAGE),
            reference_profile: true,
            ..Default::default()
        });
        state.player.hp = (state.player.max_hp - 60.0).max(1.0);
        state.player.mp = (state.player.max_mp - 50.0).max(0.0);
        let hp0 = state.player.hp;
        let mp0 = state.player.mp;

        // Slot 0 = HP potion
        assert!(try_use_consumable_slot(&mut state, &mut progress, 0));
        assert_eq!(progress_rs::consumable_count(&progress, "hpPotion"), 4);
        assert!((state.player.hp - (hp0 + 40.0).min(state.player.max_hp)).abs() < 1e-6);

        // Cooldown gates immediate reuse without consuming stack
        assert!(!try_use_consumable_slot(&mut state, &mut progress, 0));
        assert_eq!(progress_rs::consumable_count(&progress, "hpPotion"), 4);

        // Slot 1 = MP potion
        assert!(try_use_consumable_slot(&mut state, &mut progress, 1));
        assert_eq!(progress_rs::consumable_count(&progress, "mpPotion"), 4);
        assert!((state.player.mp - (mp0 + 40.0).min(state.player.max_mp)).abs() < 1e-6);

        // Unbound slot 2 is a no-op
        assert!(!try_use_consumable_slot(&mut state, &mut progress, 2));

        // Depleted stack refuses use
        progress.items.insert("hpPotion".to_string(), 0);
        state.player.consumable_cooldowns[0] = 0.0;
        assert!(!try_use_consumable_slot(&mut state, &mut progress, 0));
    }

    #[test]
    fn test_resurrect_coin_revives_defeated_player_and_stops_at_zero() {
        let mut progress = progress_rs::defaults();
        let mut state = create_state(&CreateStateOptions {
            stage: Some(DEFAULT_STAGE),
            reference_profile: true,
            ..Default::default()
        });
        assert_eq!(progress_rs::consumable_count(&progress, "resurrectCoin"), 3);

        // Cannot resurrect while alive
        assert!(!try_resurrect_on_defeat(&mut state, &mut progress));
        assert!(!try_use_consumable_slot(&mut state, &mut progress, 5));
        assert_eq!(progress_rs::consumable_count(&progress, "resurrectCoin"), 3);

        // Defeat player -> slot 5 (digit 6) consumes 1 coin and revives in-place
        let max_hp = state.player.max_hp;
        core_rs::combat::spend_player_hp(&mut state, max_hp + 10.0);
        assert!(state.defeat);
        assert!(try_use_consumable_slot(&mut state, &mut progress, 5));
        assert!(!state.defeat);
        assert!(!state.player.dead);
        assert!((state.player.hp - state.player.max_hp).abs() < 1e-6);
        assert!((state.player.mp - state.player.max_mp).abs() < 1e-6);
        assert!(state.player.invuln > 0.0);
        assert_eq!(progress_rs::consumable_count(&progress, "resurrectCoin"), 2);

        // Deplete coins to 0 -> defeat stays active
        progress.items.insert("resurrectCoin".to_string(), 0);
        core_rs::combat::spend_player_hp(&mut state, max_hp + 10.0);
        assert!(state.defeat);
        assert!(!try_resurrect_on_defeat(&mut state, &mut progress));
        assert!(state.defeat);
    }

    #[test]
    fn test_pvf_drop_log_lines_map_to_expected_bag_items() {
        assert_eq!(
            loot_item_id_for_log_line("获得[野生草莓]"),
            Some("hpPotion")
        );
        assert_eq!(loot_item_id_for_log_line("获得[越桔]"), Some("hpPotion"));
        assert_eq!(
            loot_item_id_for_log_line("获得[烤硬的黑面包]"),
            Some("hpPotion")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[魔力之花]"),
            Some("mpPotion")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[命运硬币]"),
            Some("resurrectCoin")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[古老的库尼族图腾]"),
            Some("kunicTotem")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[铜戒指]"),
            Some("copperRing")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[苎麻花叶]"),
            Some("material")
        );
        assert_eq!(
            loot_item_id_for_log_line("获得[投掷石块]"),
            Some("material")
        );
        assert_eq!(loot_item_id_for_log_line("获得 35 金币"), None);
    }

    #[test]
    fn test_chest_open_sfx_fires_only_on_chest_to_cards_transition() {
        use reward_rs::RewardPhase;
        assert!(should_play_chest_open_sfx(
            RewardPhase::Chest,
            RewardPhase::Cards
        ));
        assert!(!should_play_chest_open_sfx(
            RewardPhase::Stats,
            RewardPhase::Chest
        ));
        assert!(!should_play_chest_open_sfx(
            RewardPhase::Cards,
            RewardPhase::Cards
        ));
        assert!(!should_play_chest_open_sfx(
            RewardPhase::Cards,
            RewardPhase::Reveal
        ));
    }
}
