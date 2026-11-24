use core_rs::constants::VIEW_WIDTH;
use core_rs::create_state;
use core_rs::types::CreateStateOptions;
use render_rs::{
    draw_town_hud, draw_town_view, step_town_motion, town_interact_action, Canvas, GlyphCache,
    MapMode, ProgressPanelKind, RenderMeta, SpriteStore, TownMotion, TownNpcAction, TownStepEvent,
    TownView, TownZone, EAST_GATE_WIDTH, RENDER_HEIGHT, RENDER_WIDTH, TOWN_CAMERA_EASE_K,
    TOWN_CAMERA_HALF_WINDOW, TOWN_DEPTH_SPEED_RATIO, TOWN_WALK_ROW, TOWN_WALK_SPEED,
    TOWN_ZONE_FADE_DUR, WEST_SQUARE_WIDTH,
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
        ..TownMotion::default()
    };
    let dt = 0.5;
    let ev = step_town_motion(&mut m, 0, 1, dt);
    assert_eq!(ev, TownStepEvent::None);
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
        ..TownMotion::default()
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
        zone: TownZone::EastGate,
        x: 800.0,
        z: 30.0,
        facing: 1,
        camera_x: 0.0,
        walk: 0.0,
        moving: false,
        ..TownMotion::default()
    };
    let dt = 1.0 / 60.0;
    let target =
        (m.x - TOWN_CAMERA_HALF_WINDOW - VIEW_WIDTH * 0.5).clamp(0.0, EAST_GATE_WIDTH - VIEW_WIDTH);
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
fn hendonmyre_entry_and_dungeon_return_spawns_land_in_expected_zones() {
    let entry = TownMotion::enter_west_square();
    assert_eq!(entry.zone, TownZone::WestSquare);
    assert!(
        entry.title_timer > 0.0,
        "first town entry should trigger fading 赫顿玛尔 title"
    );

    let ret = TownMotion::return_from_dungeon();
    assert_eq!(ret.zone, TownZone::EastGate);
    assert!(
        ret.x >= 1260.0,
        "dungeon return should spawn on EastGate white stone bridge (x >= 1260), got {}",
        ret.x
    );
    assert_eq!(ret.title_timer, 0.0);
}

#[test]
fn hendonmyre_zone_transitions_fade_smoothly_in_both_directions_and_open_region() {
    assert!((TOWN_ZONE_FADE_DUR - 0.35).abs() < 1e-6);

    // 1. Walk east to far edge of WestSquare -> fade -> EastGate left side
    let mut m = TownMotion::enter_west_square();
    m.x = WEST_SQUARE_WIDTH - 90.0;
    m.camera_x = WEST_SQUARE_WIDTH - VIEW_WIDTH;

    let mut saw_fade = false;
    let mut switched_to_east = false;
    for _ in 0..60 {
        let ev = step_town_motion(&mut m, 1, 0, 1.0 / 60.0);
        if m.zone_fade_alpha() > 0.1 {
            saw_fade = true;
        }
        if ev == TownStepEvent::ZoneSwitched(TownZone::EastGate) {
            switched_to_east = true;
        }
    }
    assert!(saw_fade, "zone switch must display smooth black fade");
    assert!(
        switched_to_east,
        "walking to far-east of WestSquare must transition to EastGate"
    );
    assert_eq!(m.zone, TownZone::EastGate);
    assert!(
        m.x < 420.0,
        "entering EastGate from west should spawn on left side, got x={}",
        m.x
    );

    // Finish any remaining fade
    for _ in 0..30 {
        step_town_motion(&mut m, 0, 0, 1.0 / 60.0);
    }
    assert_eq!(m.zone_fade_alpha(), 0.0);

    // 2. Walk west to far-west edge of EastGate -> fade -> WestSquare right side
    m.x = 95.0;
    m.camera_x = 0.0;
    let mut switched_to_west = false;
    for _ in 0..60 {
        let ev = step_town_motion(&mut m, -1, 0, 1.0 / 60.0);
        if ev == TownStepEvent::ZoneSwitched(TownZone::WestSquare) {
            switched_to_west = true;
        }
    }
    assert!(
        switched_to_west,
        "walking to far-west of EastGate must transition back to WestSquare"
    );
    assert_eq!(m.zone, TownZone::WestSquare);
    assert!(
        m.x > WEST_SQUARE_WIDTH - 420.0,
        "returning to WestSquare from east should spawn on right side, got x={}",
        m.x
    );

    // 3. Walk east to far-east edge of EastGate -> opens Gran Floris Region Select
    let mut m_east = TownMotion::return_from_dungeon();
    m_east.x = EAST_GATE_WIDTH - 95.0;
    let mut opened_region = false;
    for _ in 0..40 {
        if step_town_motion(&mut m_east, 1, 0, 1.0 / 60.0) == TownStepEvent::OpenRegion {
            opened_region = true;
            break;
        }
    }
    assert!(
        opened_region,
        "walking to far-east edge of EastGate must trigger OpenRegion"
    );

    // 4. Verify G.S.D opens skill loadout in WestSquare
    assert_eq!(
        town_interact_action(TownZone::WestSquare, 515.0, 74.0),
        TownNpcAction::Loadout
    );
}

#[test]
fn town_renders_800x600_both_zones_with_classic_hud_and_foot_ring() {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let sprites = SpriteStore::load_from_root(&repo_root);
    assert!(
        sprites.get("hendonmyre").is_some(),
        "hendonmyre.png atlas must be registered and loaded"
    );
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

    let cases = [
        (TownZone::WestSquare, 490.0, 46.0, 130.0, false, 0.0, 1, 1.0),
        (TownZone::EastGate, 480.0, 22.0, 180.0, true, 0.35, 1, 0.0),
        (
            TownZone::EastGate,
            1460.0,
            26.0,
            1220.0,
            true,
            0.72,
            -1,
            0.0,
        ),
    ];

    for (zone, px, pz, cam_x, moving, walk, facing, title_alpha) in cases {
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("800x600 pixmap");
        {
            let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
            draw_town_view(
                &mut canvas,
                &TownView {
                    zone,
                    player_x: px,
                    player_z: pz,
                    facing,
                    camera_x: cam_x,
                    time: 1.5,
                    moving,
                    walk,
                    player_level: 3,
                    player_name: "阿努纳奇",
                    zone_fade_alpha: 0.0,
                    title_alpha,
                },
                &sprites,
            );
            draw_town_hud(&mut canvas, &state, &sprites, &meta);
        }

        // Verify classic bottom HUD HP capsule (left red liquid) & MP capsule (right blue liquid)
        let hp_px = pixmap.pixel(28, 560).expect("hp pixel");
        let mp_px = pixmap.pixel(770, 560).expect("mp pixel");
        assert!(
            hp_px.red() > 140 && hp_px.red() > hp_px.blue().saturating_add(60),
            "expected red HP capsule in classic town HUD for {zone:?}, got {:?}",
            hp_px
        );
        assert!(
            mp_px.blue() > 140 && mp_px.blue() > mp_px.red().saturating_add(60),
            "expected blue MP capsule in classic town HUD for {zone:?}, got {:?}",
            mp_px
        );

        // Verify top-right channel banner is darkened relative to sky
        let banner_px = pixmap.pixel(720, 12).expect("banner pixel");
        assert!(
            banner_px.red() < 90 && banner_px.green() < 90 && banner_px.blue() < 120,
            "expected dark channel banner at top-right for {zone:?}, got {:?}",
            banner_px
        );

        // Verify bright neon-green foot ring under player boots
        let foot_nx = ((px - cam_x) * (800.0 / 720.0)).round() as u32;
        let foot_ny = ((425.0 - pz) * (600.0 / 540.0)).round() as u32;
        let mut bright_green_count = 0usize;
        for y in foot_ny.saturating_sub(14)..=(foot_ny + 14).min(599) {
            for x in foot_nx.saturating_sub(36)..=(foot_nx + 36).min(799) {
                let p = pixmap.pixel(x, y).expect("foot pixel");
                if p.green() >= 210 && p.green() > p.blue().saturating_add(45) {
                    bright_green_count += 1;
                }
            }
        }
        assert!(
            bright_green_count >= 25,
            "expected bright neon-green oval foot ring under player in {zone:?} near ({foot_nx},{foot_ny}), found {bright_green_count} pixels"
        );
    }
}
