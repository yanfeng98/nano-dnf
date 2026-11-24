//! 2D software renderer (`src/render.js`).

pub mod canvas;
pub mod combat_info;
pub mod hud;
pub mod sprites;
pub mod tables;
pub mod world;

pub use canvas::{Canvas, GlyphCache, Rgba, TextAlign};
pub use hud::{
    draw_loadout_panel, draw_progress_panel, hit_test_loadout_panel, hit_test_minimap,
    hit_test_progress_panel, minimap_window_box, radar_button_box, radar_disc_bounds, MapMode,
    MapRect, PanelAction, ProgressPanelKind, RenderMeta,
};
pub use sprites::SpriteStore;
pub use world::TownView;

use core_rs::constants::*;
use core_rs::types::State;

/// Native DNF 60/70 4:3 internal render buffer width (ADR 0074).
pub const RENDER_WIDTH: u32 = 800;
/// Native DNF 60/70 4:3 internal render buffer height (ADR 0074).
pub const RENDER_HEIGHT: u32 = 600;
/// Default desktop window width (1.5x crisp scale of 800x600).
pub const DEFAULT_WINDOW_WIDTH: u32 = 1200;
/// Default desktop window height (1.5x crisp scale of 800x600).
pub const DEFAULT_WINDOW_HEIGHT: u32 = 900;
/// Uniform scale factor mapping the 720x540 logical 4:3 world/UI window to 800x600 native pixels.
pub const VIEW_TO_RENDER_SCALE: f32 = (RENDER_WIDTH as f32) / (VIEW_WIDTH as f32);

pub fn render(c: &mut Canvas<'_>, state: &State, sprites: &SpriteStore, meta: &RenderMeta<'_>) {
    let overlay_open = meta.title
        || meta.paused
        || meta.show_help
        || meta.region_open
        || (state.victory && !state.post_clear)
        || state.defeat;

    c.clear(Rgba::new(5, 7, 15, 255));

    c.save();
    c.set_clip_rect(
        VIEW_LEFT as f32,
        0.0,
        VIEW_WIDTH as f32,
        ARENA_HEIGHT as f32,
    );
    c.save();
    c.translate(VIEW_LEFT as f32, 0.0);
    c.translate(0.0, ARENA_GROUND_Y as f32);
    c.scale(CAMERA_ZOOM as f32, CAMERA_ZOOM as f32);
    c.translate(0.0, -(ARENA_GROUND_Y as f32));
    c.translate(-(state.camera_x as f32), -(state.camera_y as f32));

    world::draw_backdrop(c, state, sprites);
    world::draw_gates(c, state, sprites);
    world::draw_rain_splashes(c, state, sprites);
    world::draw_world(c, state, sprites);
    world::draw_foreground(c, state, sprites);
    for effect in &state.effects {
        if effect.kind == "banner" && overlay_open {
            continue;
        }
        if state.stage_id == "mirkwooddeep" && effect.kind == "telegraph" {
            continue;
        }
        world::draw_effect(c, state, effect, sprites);
    }
    c.restore();

    world::draw_rain(c, state, sprites, overlay_open);

    // Subtle color grading matching render.js
    let tint = if state.stage_id == "mirkwooddeep" {
        Rgba::new(10, 90, 130, 26)
    } else {
        Rgba::new(255, 248, 230, 20)
    };
    c.fill_rect(
        VIEW_LEFT as f32,
        0.0,
        VIEW_WIDTH as f32,
        ARENA_HEIGHT as f32,
        tint,
    );
    c.restore();

    let hud_hidden = state.defeat || meta.region_open;
    if !hud_hidden {
        hud::draw_hud_video(c, state, sprites, meta);
        if !overlay_open && !state.post_clear {
            hud::draw_minimap(c, state, sprites, meta.map_mode);
        }
    }

    hud::draw_overlay(c, state, sprites, meta);

    if (!overlay_open || meta.attract) && state.transition > 0.0 {
        let alpha = (state.transition / TRANSITION_DUR).clamp(0.0, 1.0) as f32;
        c.fill_rect(
            0.0,
            0.0,
            ARENA_WIDTH as f32,
            ARENA_HEIGHT as f32,
            Rgba::new(0, 0, 0, 255).with_alpha(alpha),
        );
    }
}

pub fn render_loading(c: &mut Canvas<'_>, loaded: usize, total: usize) {
    hud::render_loading(c, loaded, total);
}

pub fn draw_town(
    c: &mut Canvas<'_>,
    player_x: f64,
    player_z: f64,
    facing: i32,
    sprites: &SpriteStore,
) {
    world::draw_town(c, player_x, player_z, facing, sprites);
}

pub fn draw_town_view(c: &mut Canvas<'_>, view: &TownView<'_>, sprites: &SpriteStore) {
    world::draw_town_view(c, view, sprites);
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_rs::{create_state, types::CreateStateOptions};
    use std::path::Path;
    use tiny_skia::Pixmap;

    #[test]
    fn test_render_frame_without_panic() {
        let mut pixmap = Pixmap::new(ARENA_WIDTH as u32, ARENA_HEIGHT as u32).expect("pixmap");
        let mut fonts = GlyphCache::new(None);
        let sprites = SpriteStore::load_from_root(Path::new(".."));
        let mut state = create_state(&CreateStateOptions::default());
        state.transition = 0.0;
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let loadout = vec![Some("ghostSlash".to_string()); 6];
        let meta = RenderMeta {
            title: false,
            attract: false,
            paused: false,
            show_help: false,
            loadout: &loadout,
            loadout_open: false,
            progress_panel: ProgressPanelKind::None,
            progress: &progress,
            records: &records,
            reward: None,
            region_open: false,
            region_selected: "mirkwood",
            hint: None,
            seed: state.seed,
            stage_id: &state.stage_id,
            map_mode: MapMode::default(),
        };
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);
        // Verify non-black pixels were actually drawn
        assert!(pixmap
            .data()
            .chunks_exact(4)
            .any(|px| px[0] > 0 || px[1] > 0 || px[2] > 0));

        // Verify flipped player rendering produces pixels without panic
        let mut flipped_state = state.clone();
        flipped_state.player.facing = -1;
        let mut pixmap_flip = Pixmap::new(ARENA_WIDTH as u32, ARENA_HEIGHT as u32).expect("pixmap");
        let mut canvas_flip = Canvas::new(&mut pixmap_flip, &mut fonts);
        render(&mut canvas_flip, &flipped_state, &sprites, &meta);
        assert!(pixmap_flip
            .data()
            .chunks_exact(4)
            .any(|px| px[0] > 0 || px[1] > 0 || px[2] > 0));
    }

    #[test]
    fn test_native_800x600_renders_edge_to_edge_without_side_black_bars() {
        assert_eq!(RENDER_WIDTH, 800);
        assert_eq!(RENDER_HEIGHT, 600);
        assert_eq!(DEFAULT_WINDOW_WIDTH, 1200);
        assert_eq!(DEFAULT_WINDOW_HEIGHT, 900);

        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("800x600 pixmap");
        let mut fonts = GlyphCache::new(None);
        let sprites = SpriteStore::load_from_root(Path::new(".."));
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let loadout = vec![Some("upSlash".to_string()); 6];
        let meta = RenderMeta {
            title: false,
            attract: false,
            paused: false,
            show_help: false,
            loadout: &loadout,
            loadout_open: false,
            progress_panel: ProgressPanelKind::None,
            progress: &progress,
            records: &records,
            reward: None,
            region_open: false,
            region_selected: "mirkwood",
            hint: None,
            seed: state.seed,
            stage_id: &state.stage_id,
            map_mode: MapMode::default(),
        };
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);

        // Check that leftmost and rightmost edges inside the world band are NOT the (5, 7, 15) clear color
        let clear = [5u8, 7, 15];
        let has_world_pixels_at_x = |x: u32| -> bool {
            (100..500).any(|y| {
                let idx = ((y * RENDER_WIDTH + x) * 4) as usize;
                let px = &pixmap.data()[idx..idx + 3];
                px != clear
            })
        };
        assert!(
            has_world_pixels_at_x(2),
            "left edge (x=2) must render world pixels, not a black pillarbox bar"
        );
        assert!(
            has_world_pixels_at_x(RENDER_WIDTH - 3),
            "right edge (x=797) must render world pixels, not a black pillarbox bar"
        );
    }

    #[test]
    fn test_map_mode_default_is_radar_and_toggles() {
        assert_eq!(MapMode::default(), MapMode::Radar);
        assert_eq!(MapMode::Radar.toggle(), MapMode::Window);
        assert_eq!(MapMode::Window.toggle(), MapMode::Radar);
    }

    #[test]
    fn test_hit_test_minimap_radar_and_window() {
        // Radar mode: clicking magnifying glass button center toggles to window
        let btn = radar_button_box();
        let bx = btn.x + btn.w * 0.5;
        let by = btn.y + btn.h * 0.5;
        assert!(hit_test_minimap(bx, by, MapMode::Radar, 4, 3));

        // Radar mode: clicking radar disc center toggles to window
        let (cx, cy, r) = radar_disc_bounds();
        assert!(hit_test_minimap(cx, cy, MapMode::Radar, 4, 3));

        // Radar mode: clicking far outside radar misses
        assert!(!hit_test_minimap(cx - r - 60.0, cy, MapMode::Radar, 4, 3));
        assert!(!hit_test_minimap(200.0, 300.0, MapMode::Radar, 4, 3));

        // Window mode (4x3 Mirkwood and 5x4 Mirkwood Deep): top-right ⊘ button hits
        for &(cols, rows) in &[(4usize, 3usize), (5, 4)] {
            let b = minimap_window_box(cols, rows);
            assert!(hit_test_minimap(
                b.x + b.w - 10.0,
                b.y + 8.0,
                MapMode::Window,
                cols,
                rows
            ));
            // Window body (below title bar) does not trigger close button
            assert!(!hit_test_minimap(
                b.x + b.w * 0.5,
                b.y + b.h * 0.6,
                MapMode::Window,
                cols,
                rows
            ));
            // Outside window misses
            assert!(!hit_test_minimap(
                b.x - 10.0,
                b.y + 8.0,
                MapMode::Window,
                cols,
                rows
            ));
        }
    }

    #[test]
    fn test_canvas_circle_clip_masks_outside_and_restores() {
        let mut pixmap = Pixmap::new(100, 100).expect("pixmap");
        let mut fonts = GlyphCache::new(None);
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        canvas.clear(Rgba::new(0, 0, 0, 255));
        canvas.save();
        canvas.set_clip_circle(50.0, 50.0, 20.0);
        canvas.fill_rect(0.0, 0.0, 100.0, 100.0, Rgba::new(255, 0, 0, 255));
        canvas.restore();
        // Pixel at center (50, 50) must be red; corner (5, 5) must stay black
        let center_idx = (50 * 100 + 50) * 4;
        let corner_idx = (5 * 100 + 5) * 4;
        assert_eq!(canvas.pixmap.data()[center_idx], 255);
        assert_eq!(canvas.pixmap.data()[corner_idx], 0);
        // After restore, drawing at (5, 5) succeeds
        canvas.fill_rect(0.0, 0.0, 10.0, 10.0, Rgba::new(0, 255, 0, 255));
        assert_eq!(canvas.pixmap.data()[corner_idx + 1], 255);
    }

    #[test]
    fn test_dual_mode_minimap_renders_distinct_radar_and_square_views() {
        let sprites = SpriteStore::load_from_root(Path::new(".."));
        let mut fonts = GlyphCache::new(None);
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let loadout = vec![Some("upSlash".to_string()); 6];

        let probe = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        let boss_cell = probe.dungeon.as_ref().map(|d| d.boss);
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            cell: boss_cell,
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;

        let render_mode = |mode: MapMode, fonts: &mut GlyphCache| -> Pixmap {
            let meta = RenderMeta {
                title: false,
                attract: false,
                paused: false,
                show_help: false,
                loadout: &loadout,
                loadout_open: false,
                progress_panel: ProgressPanelKind::None,
                progress: &progress,
                records: &records,
                reward: None,
                region_open: false,
                region_selected: "mirkwood",
                hint: None,
                seed: state.seed,
                stage_id: &state.stage_id,
                map_mode: mode,
            };
            let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
            let mut canvas = Canvas::new(&mut pixmap, fonts);
            render(&mut canvas, &state, &sprites, &meta);
            pixmap
        };

        let radar_px = render_mode(MapMode::Radar, &mut fonts);
        let window_px = render_mode(MapMode::Window, &mut fonts);

        // Top-right map quadrant must differ significantly between radar and square map modes
        let mut diff_pixels = 0usize;
        for y in 25..180u32 {
            for x in 600..795u32 {
                let idx = ((y * RENDER_WIDTH + x) * 4) as usize;
                if radar_px.data()[idx..idx + 3] != window_px.data()[idx..idx + 3] {
                    diff_pixels += 1;
                }
            }
        }
        assert!(
            diff_pixels > 500,
            "expected radar and square map modes to differ visually, got {diff_pixels} diff pixels"
        );

        // In boss room under square map mode, boss red bull-head is drawn on top of player blue pillar
        let dun = state.dungeon.as_ref().expect("dungeon");
        let boss = &dun.cells[dun.boss];
        let b = minimap_window_box(dun.cols, dun.rows);
        let grid_left = b.x + 5.0 * 1.125;
        let grid_top = b.y + (18.0 + 5.0) * 1.125;
        let pitch = 18.0 * 1.125;
        let boss_cx = ((grid_left + (boss.col as f32 + 0.5) * pitch - VIEW_LEFT as f32)
            * VIEW_TO_RENDER_SCALE) as u32;
        let boss_cy = ((grid_top + (boss.row as f32 + 0.5) * pitch) * VIEW_TO_RENDER_SCALE) as u32;
        let mut has_boss_red = false;
        for dy in -5i32..=5 {
            for dx in -5i32..=5 {
                let px = (boss_cx as i32 + dx).clamp(0, RENDER_WIDTH as i32 - 1) as u32;
                let py = (boss_cy as i32 + dy).clamp(0, RENDER_HEIGHT as i32 - 1) as u32;
                let idx = ((py * RENDER_WIDTH + px) * 4) as usize;
                let (r, g, bl) = (
                    window_px.data()[idx],
                    window_px.data()[idx + 1],
                    window_px.data()[idx + 2],
                );
                if r > 180 && g < 110 && bl < 60 {
                    has_boss_red = true;
                }
            }
        }
        assert!(
            has_boss_red,
            "expected boss red bull-head pixels on top of player marker in boss room"
        );
    }

    #[test]
    fn test_native_gui_panels_render_and_hit_test() {
        let mut fonts = GlyphCache::new(None);
        let root = if Path::new("assets/gui.png").exists() {
            Path::new(".")
        } else if Path::new("../assets/gui.png").exists() {
            Path::new("..")
        } else {
            Path::new("../..")
        };
        let sprites = SpriteStore::load_from_root(root);
        assert!(sprites.get("gui").is_some(), "assets/gui.png must load");

        let mut progress = progress_rs::defaults();
        progress_rs::add_gold(&mut progress, 500);
        progress_rs::add_item(&mut progress, "hpPotion", 3);
        progress_rs::add_item(&mut progress, "starterBlade", 1);
        progress_rs::equip(&mut progress, "starterBlade", "berserker", 3);

        let loadout: Vec<Option<String>> = core_rs::TABLES
            .skill_order
            .iter()
            .take(6)
            .cloned()
            .map(Some)
            .collect();

        // Render every panel kind onto a clean pixmap and verify native gui.png pixels are drawn
        for kind in [
            ProgressPanelKind::Bag,
            ProgressPanelKind::Equip,
            ProgressPanelKind::Quest,
            ProgressPanelKind::Shop,
        ] {
            let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
            let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
            draw_progress_panel(&mut canvas, &sprites, kind, &progress, Some((480.0, 270.0)));
            let non_zero = pixmap
                .data()
                .chunks_exact(4)
                .filter(|px| px[3] > 0 && (px[0] > 0 || px[1] > 0 || px[2] > 0))
                .count();
            assert!(
                non_zero > 20_000,
                "panel {kind:?} should render full native gui.png frame, got {non_zero} pixels"
            );
        }

        // Loadout panel
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        draw_loadout_panel(&mut canvas, &sprites, &loadout, 1, Some((480.0, 270.0)));
        let non_zero = pixmap
            .data()
            .chunks_exact(4)
            .filter(|px| px[3] > 0 && (px[0] > 0 || px[1] > 0 || px[2] > 0))
            .count();
        assert!(
            non_zero > 20_000,
            "loadout panel should render native gui.png frame"
        );

        // Hit-testing Shop: origin (334, 80), 7x6 grid at (334+27, 80+134) = (361, 214)
        assert_eq!(
            hit_test_progress_panel(ProgressPanelKind::Shop, &progress, 370.0, 224.0),
            Some(PanelAction::InteractSlot(0))
        );
        assert_eq!(
            hit_test_progress_panel(ProgressPanelKind::Shop, &progress, 370.0 + 32.0, 224.0),
            Some(PanelAction::InteractSlot(1))
        );
        assert_eq!(
            hit_test_progress_panel(
                ProgressPanelKind::Shop,
                &progress,
                334.0 + 150.0,
                80.0 + 340.0
            ),
            Some(PanelAction::Close)
        );

        // Hit-testing Bag: origin (334, 65), 8x4 grid at (334+19, 65+176) = (353, 241)
        assert_eq!(
            hit_test_progress_panel(ProgressPanelKind::Bag, &progress, 362.0, 250.0),
            Some(PanelAction::InteractSlot(0))
        );
        assert_eq!(
            hit_test_progress_panel(
                ProgressPanelKind::Bag,
                &progress,
                334.0 + 160.0,
                65.0 + 354.0
            ),
            Some(PanelAction::SalvageFirst)
        );
        assert_eq!(
            hit_test_progress_panel(
                ProgressPanelKind::Bag,
                &progress,
                334.0 + 230.0,
                65.0 + 354.0
            ),
            Some(PanelAction::Close)
        );

        // Hit-testing Equip: weapon slot at (334+210, 65+78) = (544, 143)
        assert_eq!(
            hit_test_progress_panel(ProgressPanelKind::Equip, &progress, 558.0, 157.0),
            Some(PanelAction::InteractSlot(0))
        );

        // Hit-testing Quest: row 0 at (334+22, 80+32) = (356, 112)
        assert_eq!(
            hit_test_progress_panel(ProgressPanelKind::Quest, &progress, 400.0, 124.0),
            Some(PanelAction::InteractSlot(0))
        );

        // Hit-testing Loadout: slot 2 at (334+32+2*38, 80+34) = (442, 114), skill 0 at (361, 214)
        assert_eq!(
            hit_test_loadout_panel(455.0, 128.0),
            Some(PanelAction::SelectLoadoutSlot(2))
        );
        assert_eq!(
            hit_test_loadout_panel(370.0, 224.0),
            Some(PanelAction::AssignLoadoutSkill(0))
        );
        assert_eq!(
            hit_test_loadout_panel(334.0 + 40.0, 80.0 + 84.0),
            Some(PanelAction::CycleLoadoutSkill(-1))
        );
        assert_eq!(
            hit_test_loadout_panel(334.0 + 240.0, 80.0 + 84.0),
            Some(PanelAction::CycleLoadoutSkill(1))
        );
    }
}
