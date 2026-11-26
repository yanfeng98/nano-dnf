use core_rs::constants::VIEW_WIDTH;
use core_rs::create_state;
use core_rs::types::CreateStateOptions;
use render_rs::{
    draw_town_hud, draw_town_view, step_town_motion, town_interact_action, Canvas, GlyphCache,
    MapMode, ProgressPanelKind, RenderMeta, SpriteStore, TownMotion, TownNpcAction, TownStepEvent,
    TownView, TownZone, RENDER_HEIGHT, RENDER_WIDTH, TOWN_CAMERA_EASE_K, TOWN_CAMERA_HALF_WINDOW,
    TOWN_DEPTH_SPEED_RATIO, TOWN_WALK_ROW, TOWN_WALK_SPEED, TOWN_ZONE_FADE_DUR, WEST_BRIDGE_WIDTH,
};
use std::path::Path;
use tiny_skia::Pixmap;

#[test]
fn town_movement_depth_speed_ratio_is_0_56() {
    assert!((TOWN_DEPTH_SPEED_RATIO - 0.56).abs() < 1e-9);
    let mut m = TownMotion::enter_alley();
    m.x = 200.0;
    m.z = 20.0;
    m.facing = 1;
    m.camera_x = 0.0;
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
    let mut m = TownMotion::enter_alley();
    m.x = 300.0;
    m.z = 20.0;
    m.facing = 1;
    m.camera_x = 0.0;
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
    let mut m = TownMotion::return_from_dungeon();
    m.x = 800.0;
    m.z = 30.0;
    m.facing = 1;
    m.camera_x = 0.0;
    let dt = 1.0 / 60.0;
    let target = (m.x - TOWN_CAMERA_HALF_WINDOW - VIEW_WIDTH * 0.5)
        .clamp(0.0, WEST_BRIDGE_WIDTH - VIEW_WIDTH);
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
fn hendonmyre_entry_starts_in_seria_room_and_dungeon_return_lands_on_west_bridge() {
    let entry = TownMotion::enter_seria_room();
    assert_eq!(entry.zone, TownZone::SeriaRoom);
    assert_eq!(TownMotion::default().zone, TownZone::SeriaRoom);

    let ret = TownMotion::return_from_dungeon();
    assert_eq!(ret.zone, TownZone::WestBridge);
    assert!(
        ret.x < WEST_BRIDGE_WIDTH * 0.5,
        "dungeon return should spawn on WestBridge near west end, got {}",
        ret.x
    );
    assert_eq!(ret.facing, 1, "returning from Gran Floris faces east (+1)");
    assert_eq!(ret.title_timer, 0.0);
}

#[test]
fn hendonmyre_three_zone_doorways_and_west_bridge_exit_work_end_to_end() {
    assert!((TOWN_ZONE_FADE_DUR - 0.35).abs() < 1e-6);

    // 1. Walk SOUTH out of Seria's Room bottom purple carpet -> fade -> Alley knight-statue archway
    let mut m = TownMotion::enter_seria_room();
    m.z = 2.0;
    let mut saw_fade = false;
    let mut entered_alley = false;
    for _ in 0..45 {
        let ev = step_town_motion(&mut m, 0, -1, 1.0 / 60.0);
        if m.zone_fade_alpha() > 0.1 {
            saw_fade = true;
        }
        if ev == TownStepEvent::ZoneSwitched(TownZone::Alley) {
            entered_alley = true;
        }
    }
    assert!(saw_fade, "exiting SeriaRoom must display smooth black fade");
    assert!(
        entered_alley,
        "walking south out of SeriaRoom must enter Alley"
    );
    assert_eq!(m.zone, TownZone::Alley);
    assert!(
        m.title_timer > 0.0,
        "exiting SeriaRoom into Alley must trigger 赫顿玛尔 / HendonMyre entry title"
    );

    // Finish fade
    for _ in 0..30 {
        step_town_motion(&mut m, 0, 0, 1.0 / 60.0);
    }

    // 2. Walk NORTH back into knight-statue archway -> fade -> Seria's Room
    m.x = 672.0;
    m.z = 96.0;
    let mut reentered_seria = false;
    for _ in 0..45 {
        if step_town_motion(&mut m, 0, 1, 1.0 / 60.0)
            == TownStepEvent::ZoneSwitched(TownZone::SeriaRoom)
        {
            reentered_seria = true;
        }
    }
    assert!(
        reentered_seria,
        "walking north into Alley knight-statue archway must re-enter SeriaRoom"
    );
    assert_eq!(m.zone, TownZone::SeriaRoom);

    // 3. Walk SOUTH through Alley bottom archway -> fade -> Plaza colorful archway (next to Fire Pot)
    let mut m_alley = TownMotion::enter_alley();
    m_alley.x = 432.0;
    m_alley.z = 2.0;
    let mut entered_plaza = false;
    for _ in 0..45 {
        if step_town_motion(&mut m_alley, 0, -1, 1.0 / 60.0)
            == TownStepEvent::ZoneSwitched(TownZone::Plaza)
        {
            entered_plaza = true;
        }
    }
    assert!(
        entered_plaza,
        "walking south through Alley bottom archway must enter Plaza"
    );
    assert_eq!(m_alley.zone, TownZone::Plaza);
    for _ in 0..30 {
        step_town_motion(&mut m_alley, 0, 0, 1.0 / 60.0);
    }

    // 4. Walk NORTH through Plaza colorful archway -> fade -> back to Alley bottom archway
    m_alley.x = 508.0;
    m_alley.z = 96.0;
    let mut back_to_alley = false;
    for _ in 0..45 {
        if step_town_motion(&mut m_alley, 0, 1, 1.0 / 60.0)
            == TownStepEvent::ZoneSwitched(TownZone::Alley)
        {
            back_to_alley = true;
        }
    }
    assert!(
        back_to_alley,
        "walking north through Plaza colorful archway must return to Alley"
    );
    assert_eq!(m_alley.zone, TownZone::Alley);

    // 5. Walk WEST off Plaza west edge -> fade -> WestBridge, then EAST back -> Plaza
    let mut m_bridge = TownMotion::enter_alley();
    m_bridge.zone = TownZone::Plaza;
    m_bridge.x = 92.0;
    m_bridge.z = 36.0;
    let mut entered_bridge = false;
    for _ in 0..45 {
        if step_town_motion(&mut m_bridge, -1, 0, 1.0 / 60.0)
            == TownStepEvent::ZoneSwitched(TownZone::WestBridge)
        {
            entered_bridge = true;
        }
    }
    assert!(
        entered_bridge,
        "walking west off Plaza west edge must black-fade into WestBridge"
    );
    assert_eq!(m_bridge.zone, TownZone::WestBridge);
    for _ in 0..30 {
        step_town_motion(&mut m_bridge, 0, 0, 1.0 / 60.0);
    }
    m_bridge.x = WEST_BRIDGE_WIDTH - 92.0;
    let mut back_to_plaza = false;
    for _ in 0..45 {
        if step_town_motion(&mut m_bridge, 1, 0, 1.0 / 60.0)
            == TownStepEvent::ZoneSwitched(TownZone::Plaza)
        {
            back_to_plaza = true;
        }
    }
    assert!(
        back_to_plaza,
        "walking east off WestBridge must black-fade back into Plaza"
    );
    assert_eq!(m_bridge.zone, TownZone::Plaza);

    // 6. Walk WEST to far-west end of WestBridge -> opens Gran Floris Region Select
    let mut m_west = TownMotion::return_from_dungeon();
    m_west.x = 92.0;
    let mut opened_region = false;
    for _ in 0..40 {
        if step_town_motion(&mut m_west, -1, 0, 1.0 / 60.0) == TownStepEvent::OpenRegion {
            opened_region = true;
            break;
        }
    }
    assert!(
        opened_region,
        "walking west off WestBridge must trigger OpenRegion"
    );

    // 7. Verify authentic NPC interaction mappings across all 4 zones
    assert_eq!(
        town_interact_action(TownZone::SeriaRoom, 360.0, 102.0),
        TownNpcAction::Quest
    );
    assert_eq!(
        town_interact_action(TownZone::SeriaRoom, 185.0, 92.0),
        TownNpcAction::Bag
    );
    assert_eq!(
        town_interact_action(TownZone::Alley, 365.0, 74.0),
        TownNpcAction::Quest
    );
    assert_eq!(
        town_interact_action(TownZone::Alley, 1075.0, 74.0),
        TownNpcAction::Bag
    );
    assert_eq!(
        town_interact_action(TownZone::Alley, 1385.0, 74.0),
        TownNpcAction::Loadout
    );
    assert_eq!(
        town_interact_action(TownZone::Plaza, 344.0, 74.0),
        TownNpcAction::Quest
    );
    assert_eq!(
        town_interact_action(TownZone::Plaza, 1227.0, 74.0),
        TownNpcAction::Shop
    );
    assert_eq!(
        town_interact_action(TownZone::Plaza, 1627.0, 74.0),
        TownNpcAction::Quest
    );
    assert_eq!(
        town_interact_action(TownZone::WestBridge, 100.0, 30.0),
        TownNpcAction::Region
    );
}

#[test]
fn town_renders_800x600_all_three_zones_with_classic_hud_and_foot_ring() {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let sprites = SpriteStore::load_from_root(&repo_root);
    assert!(
        sprites.get("hendonmyre").is_some(),
        "hendonmyre.png atlas must be registered and loaded"
    );
    assert!(
        sprites.get("seriaroom").is_some(),
        "seriaroom.png atlas must be registered and loaded"
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
        (TownZone::SeriaRoom, 360.0, 36.0, 0.0, false, 0.0, 1, 0.0),
        (TownZone::Alley, 432.0, 46.0, 110.0, false, 0.0, 1, 1.0),
        (TownZone::Plaza, 312.0, 32.0, 122.0, true, 0.35, -1, 0.0),
        (TownZone::WestBridge, 390.0, 26.0, 90.0, true, 0.72, -1, 0.0),
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
        let ground_y = if zone == TownZone::SeriaRoom {
            442.0
        } else {
            425.0
        };
        let foot_nx = ((px - cam_x) * (800.0 / 720.0)).round() as u32;
        let foot_ny = ((ground_y - pz) * (600.0 / 540.0)).round() as u32;
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
