//! 2D software renderer (`src/render.js`).

pub mod canvas;
pub mod hud;
pub mod hud_classic;
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

    fn render_800x600(
        state: &State,
        sprites: &SpriteStore,
        fonts: &mut GlyphCache,
        loadout: &[Option<String>],
    ) -> Pixmap {
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("800x600 pixmap");
        let progress = progress_rs::defaults();
        let records = records_rs::empty_store();
        let meta = RenderMeta {
            title: false,
            attract: false,
            paused: false,
            show_help: false,
            loadout,
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
        let mut canvas = Canvas::new(&mut pixmap, fonts);
        render(&mut canvas, state, sprites, &meta);
        pixmap
    }

    fn px_at(pixmap: &Pixmap, x: u32, y: u32) -> [u8; 4] {
        let idx = ((y * pixmap.width() + x) * 4) as usize;
        let d = pixmap.data();
        [d[idx], d[idx + 1], d[idx + 2], d[idx + 3]]
    }

    #[test]
    fn test_classic_bottom_hud_capsules_xp_and_skill_ranks() {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let sprites = SpriteStore::load_from_root(&repo_root);
        let classic = sprites
            .get("hudClassic")
            .expect("assets/hud-classic.png must be loaded as hudClassic");
        assert_eq!(classic.width(), 800);
        assert_eq!(classic.height(), 200);

        let mut fonts = GlyphCache::new(None);
        let loadout = vec![
            Some("ghostSlash".to_string()),
            Some("upSlash".to_string()),
            None,
            None,
            None,
            None,
        ];

        // 1. Full HP & MP, 50% XP
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        state.player.hp = state.player.max_hp;
        state.player.mp = state.player.max_mp;
        state.player.xp = state.player.xp_to_next / 2;

        let full_px = render_800x600(&state, &sprites, &mut fonts, &loadout);
        let hp_top = px_at(&full_px, 29, 525);
        assert!(
            hp_top[0] > 120 && hp_top[1] < 45,
            "full HP capsule top must be red, got {hp_top:?}"
        );
        let mp_top = px_at(&full_px, 771, 525);
        assert!(
            mp_top[2] > 120 && mp_top[0] < 45,
            "full MP capsule top must be blue, got {mp_top:?}"
        );
        let xp_left = px_at(&full_px, 190, 544);
        let xp_right = px_at(&full_px, 290, 544);
        assert!(
            xp_left[1] > 140,
            "50% XP left half must be green, got {xp_left:?}"
        );
        assert!(
            xp_right[1] < 65,
            "50% XP right half must be dark empty track, got {xp_right:?}"
        );

        // 2. Partial HP (50%), low MP (25%), 0% XP + level-up flash pulse
        let mut mid_state = state.clone();
        mid_state.player.hp = mid_state.player.max_hp * 0.5;
        mid_state.player.mp = mid_state.player.max_mp * 0.25;
        mid_state.player.xp = 0;
        mid_state.xp_gauge_flash_until = mid_state.time + 0.5;

        let mid_px = render_800x600(&mid_state, &sprites, &mut fonts, &loadout);
        let hp_top_half = px_at(&mid_px, 29, 525);
        let hp_bot_half = px_at(&mid_px, 29, 575);
        assert!(
            hp_top_half[0] < 55,
            "50% HP upper capsule must be dark empty glass, got {hp_top_half:?}"
        );
        assert!(
            hp_bot_half[0] > 120 && hp_bot_half[1] < 45,
            "50% HP lower capsule must remain red, got {hp_bot_half:?}"
        );
        let mp_mid = px_at(&mid_px, 771, 545);
        let mp_bot = px_at(&mid_px, 771, 585);
        assert!(
            mp_mid[2] < 55,
            "25% MP upper capsule must be dark empty glass, got {mp_mid:?}"
        );
        assert!(
            mp_bot[2] > 120,
            "25% MP bottom capsule must remain blue, got {mp_bot:?}"
        );
        let xp_pulse_end = px_at(&mid_px, 310, 544);
        assert!(
            xp_pulse_end[1] > 150,
            "level-up flash must fill entire XP bar to 100%, got {xp_pulse_end:?}"
        );

        // 3. Skill rank badge (gold Lv.2 in top-right of slot A) & cooldown greying
        let has_gold_badge = (485..512).any(|x| {
            (557..568).any(|y| {
                let p = px_at(&full_px, x, y);
                p[0] > 180 && p[1] > 130 && p[2] < 90
            })
        });
        assert!(
            has_gold_badge,
            "ready slot A (ghostSlash Lv.2) must render gold Lv.X skill rank badge"
        );

        let mut cd_state = state.clone();
        cd_state
            .player
            .skill_cooldowns
            .insert("ghostSlash".to_string(), 3.2);
        let cd_px = render_800x600(&cd_state, &sprites, &mut fonts, &loadout);
        let ready_chroma: u32 = (478..510)
            .flat_map(|x| (560..588).map(move |y| (x, y)))
            .map(|(x, y)| {
                let p = px_at(&full_px, x, y);
                let mx = p[0].max(p[1]).max(p[2]);
                let mn = p[0].min(p[1]).min(p[2]);
                u32::from(mx - mn)
            })
            .sum();
        let cd_chroma: u32 = (478..510)
            .flat_map(|x| (560..588).map(move |y| (x, y)))
            .map(|(x, y)| {
                let p = px_at(&cd_px, x, y);
                let mx = p[0].max(p[1]).max(p[2]);
                let mn = p[0].min(p[1]).min(p[2]);
                u32::from(mx - mn)
            })
            .sum();
        assert!(
            cd_chroma < ready_chroma / 2,
            "cooldown slot A must be visibly greyed/darkened (ready_chroma={ready_chroma}, cd_chroma={cd_chroma})"
        );
    }
}
