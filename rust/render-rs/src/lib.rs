//! 2D software renderer (`src/render.js`).

pub mod canvas;
pub mod hud;
pub mod sprites;
pub mod tables;
pub mod world;

pub use canvas::{Canvas, GlyphCache, Rgba, TextAlign};
pub use hud::{draw_loadout_panel, draw_progress_panel, ProgressPanelKind, RenderMeta};
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
            hud::draw_minimap(c, state, sprites);
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
}
