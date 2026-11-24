use core_rs::constants::VIEW_WIDTH;
use core_rs::create_state;
use core_rs::types::CreateStateOptions;
use render_rs::{
    draw_town_hud, draw_town_view, step_town_motion, Canvas, GlyphCache, MapMode,
    ProgressPanelKind, RenderMeta, SpriteStore, TownMotion, TownView, RENDER_HEIGHT, RENDER_WIDTH,
    TOWN_CAMERA_EASE_K, TOWN_CAMERA_HALF_WINDOW, TOWN_DEPTH_SPEED_RATIO, TOWN_WALK_ROW,
    TOWN_WALK_SPEED,
};
use std::path::Path;
use tiny_skia::Pixmap;

#[test]
fn town_movement_depth_speed_ratio_is_0_56() {
    assert!((TOWN_DEPTH_SPEED_RATIO - 0.56).abs() < 1e-9);
    let mut m = TownMotion {
        x: 200.0,
        z: 20.0,
        facing: 1,
        camera_x: 0.0,
        walk: 0.0,
        moving: false,
    };
    let dt = 0.5;
    step_town_motion(&mut m, 0, 1, dt);
    assert!(
        (m.x - 200.0).abs() < 1e-6,
        "pure depth move must not alter x"
    );
    let expected_z = 20.0 + TOWN_WALK_SPEED * 0.56 * dt;
    assert!(
        (m.z - expected_z).abs() < 1e-6,
        "expected z={expected_z}, got {}",
        m.z
    );
    assert!(m.moving);
    assert!((m.walk - dt).abs() < 1e-6);
}

#[test]
fn town_movement_diagonal_is_normalized() {
    let mut m = TownMotion {
        x: 300.0,
        z: 20.0,
        facing: 1,
        camera_x: 0.0,
        walk: 0.0,
        moving: false,
    };
    let dt = 0.25;
    step_town_motion(&mut m, 1, 1, dt);
    let inv_sqrt2 = std::f64::consts::FRAC_1_SQRT_2;
    let expected_x = 300.0 + TOWN_WALK_SPEED * inv_sqrt2 * dt;
    let expected_z = 20.0 + TOWN_WALK_SPEED * 0.56 * inv_sqrt2 * dt;
    assert!(
        (m.x - expected_x).abs() < 1e-6,
        "expected normalized x={expected_x}, got {}",
        m.x
    );
    assert!(
        (m.z - expected_z).abs() < 1e-6,
        "expected normalized z={expected_z}, got {}",
        m.z
    );
    assert_eq!(m.facing, 1);
}

#[test]
fn town_camera_uses_exponential_easing() {
    let mut m = TownMotion {
        x: 800.0,
        z: 30.0,
        facing: 1,
        camera_x: 0.0,
        walk: 0.0,
        moving: false,
    };
    let dt = 1.0 / 60.0;
    let target = (m.x - TOWN_CAMERA_HALF_WINDOW - VIEW_WIDTH * 0.5).clamp(0.0, 2520.0 - VIEW_WIDTH);
    step_town_motion(&mut m, 0, 0, dt);
    let expected_first = target * (1.0 - (-TOWN_CAMERA_EASE_K * dt).exp());
    assert!(
        m.camera_x > 0.0 && m.camera_x < target * 0.5,
        "camera must ease smoothly rather than snapping; got {} vs target {}",
        m.camera_x,
        target
    );
    assert!(
        (m.camera_x - expected_first).abs() < 1e-4,
        "expected exponential step {expected_first}, got {}",
        m.camera_x
    );

    // After 2 seconds of stepping at 60Hz, camera converges near target
    for _ in 0..120 {
        step_town_motion(&mut m, 0, 0, dt);
    }
    assert!(
        (m.camera_x - target).abs() < 0.5,
        "camera should converge to target={target}, got {}",
        m.camera_x
    );
}

#[test]
fn town_walk_uses_dedicated_row_12() {
    assert_eq!(TOWN_WALK_ROW, 12);
}

#[test]
fn town_renders_800x600_with_classic_hud_and_foot_ring_without_panic() {
    let repo_root = Path::new("..");
    let sprites = SpriteStore::load_from_root(repo_root);
    let mut fonts = GlyphCache::new(None);
    let progress = progress_rs::defaults();
    let records = records_rs::empty_store();
    let loadout = vec![
        Some("upSlash".to_string()),
        Some("ghostSlash".to_string()),
        Some("normalWave".to_string()),
        None,
        None,
        None,
    ];
    let state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwooddeep"),
        reference_profile: true,
        ..Default::default()
    });
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
        region_selected: "mirkwooddeep",
        hint: None,
        seed: state.seed,
        stage_id: &state.stage_id,
        map_mode: MapMode::Radar,
        continue_hover: None,
        reward_card_hover: None,
    };

    for &(moving, walk, facing) in &[(false, 0.0, 1), (true, 0.35, 1), (true, 0.72, -1)] {
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("800x600 pixmap");
        {
            let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
            draw_town_view(
                &mut canvas,
                &TownView {
                    player_x: 180.0,
                    player_z: 22.0,
                    facing,
                    camera_x: 0.0,
                    time: 1.5,
                    moving,
                    walk,
                    player_level: 6,
                    player_name: "阿努纳奇",
                },
                &sprites,
            );
            draw_town_hud(&mut canvas, &state, &sprites, &meta);
        }

        // Verify classic bottom HUD HP capsule (left red liquid) & MP capsule (right blue liquid)
        let hp_px = pixmap.pixel(28, 560).expect("hp pixel");
        let mp_px = pixmap.pixel(770, 560).expect("mp pixel");
        assert!(
            hp_px.red() > 140 && hp_px.red() > hp_px.blue() + 60,
            "expected red HP capsule in classic town HUD, got {:?}",
            hp_px
        );
        assert!(
            mp_px.blue() > 140 && mp_px.blue() > mp_px.red() + 60,
            "expected blue MP capsule in classic town HUD, got {:?}",
            mp_px
        );

        // Verify top-right channel banner is darkened relative to sky
        let banner_px = pixmap.pixel(720, 12).expect("banner pixel");
        assert!(
            banner_px.red() < 90 && banner_px.green() < 90 && banner_px.blue() < 120,
            "expected dark channel banner at top-right, got {:?}",
            banner_px
        );

        // Verify bright neon-green foot ring under player boots (player at logical (180, 403) => native (200, 448))
        let mut bright_green_count = 0usize;
        for y in 438..460 {
            for x in 170..230 {
                let p = pixmap.pixel(x, y).expect("foot pixel");
                if p.green() >= 210 && p.green() > p.blue() + 45 {
                    bright_green_count += 1;
                }
            }
        }
        assert!(
            bright_green_count >= 25,
            "expected bright neon-green oval foot ring under player, found {bright_green_count} pixels"
        );
    }
}
