use core_rs::combat::{damage_enemy, swing_props, DamageEnemyOptions};
use core_rs::constants::{band_depth, window_width};
use core_rs::dungeon::{begin_room, exit_mode, prop_obstacle, room_width, ExitMode};
use core_rs::types::{CreateStateOptions, Input, Rect};
use core_rs::{create_state, run_frames, step, ARENA_GROUND_Y};

#[test]
fn test_stone_pillars_damage_to_cracked_then_shatter_and_drop_loot() {
    // Test mirkwooddeep room 2 (苔石庭院) which has non-native `pillarPale` props,
    // and also manually verify a `pillar` prop.
    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwooddeep"),
        reference_profile: true,
        ..Default::default()
    });
    // Find a cell whose room has `pillarPale` props, or set cell 0's room to 2 (苔石庭院).
    if let Some(d) = state.dungeon.as_mut() {
        d.cells[state.cell].room = 2;
        d.cells[state.cell].props = None;
    }
    begin_room(&mut state, None);

    let p_idx = state
        .props
        .iter()
        .position(|p| p.piece == "pillarPale")
        .expect("room 2 (苔石庭院) must contain pillarPale props");

    assert_eq!(state.props[p_idx].hp, 4, "pillar should start with hp=4");
    assert!(state.props[p_idx].solid, "intact pillar should be solid");
    assert!(
        prop_obstacle(&state.props[p_idx], None).is_some(),
        "intact pillar must have walk obstacle"
    );

    let px = state.props[p_idx].x;
    let pz = state.props[p_idx].z;
    let swing_box = Rect {
        left: px - 60.0,
        right: px + 60.0,
        top: ARENA_GROUND_Y - 120.0,
        bottom: ARENA_GROUND_Y + 10.0,
    };

    // Hit 1: hp 4 -> 3, shakes, plays sound, emits debris, stays intact
    state.sounds.clear();
    state.effects.clear();
    swing_props(&mut state, swing_box, None, Some((px, pz)), None);
    assert_eq!(state.props[p_idx].hp, 3);
    assert!(state.props[p_idx].hit_t > 0.0, "hit 1 should trigger shake");
    assert_ne!(state.props[p_idx].piece, "pillarDamagedDecor");
    assert!(
        state.sounds.iter().any(|s| s.kind == "stonePillarBreak"),
        "hit 1 should play stonePillarBreak sound"
    );
    assert!(
        state.effects.iter().any(|e| e.kind == "pillar_debris"),
        "hit 1 should emit pillar_debris particles"
    );

    // Hit 2: hp 3 -> 2, transitions to cracked half-pillar ("pillarDamagedDecor"), still solid
    state.sounds.clear();
    state.effects.clear();
    swing_props(&mut state, swing_box, None, Some((px, pz)), None);
    assert_eq!(state.props[p_idx].hp, 2);
    assert_eq!(
        state.props[p_idx].piece, "pillarDamagedDecor",
        "at hp <= 2 pillar must transition to pillarDamagedDecor"
    );
    assert!(state.props[p_idx].solid, "cracked pillar is still solid");
    assert!(
        prop_obstacle(&state.props[p_idx], None).is_some(),
        "cracked pillar must retain walk obstacle"
    );

    // Hit 3: hp 2 -> 1, still cracked
    swing_props(&mut state, swing_box, None, Some((px, pz)), None);
    assert_eq!(state.props[p_idx].hp, 1);
    assert!(!state.props[p_idx].broken);
    assert!(!state.props[p_idx].gone);

    // Hit 4: hp 1 -> 0, shatters completely, clears solid/obstacle, drops loot
    let pickups_before = state.pickups.len();
    state.sounds.clear();
    state.effects.clear();
    swing_props(&mut state, swing_box, None, Some((px, pz)), None);
    assert_eq!(state.props[p_idx].hp, 0);
    assert!(state.props[p_idx].broken, "shattered pillar must be broken");
    assert!(state.props[p_idx].gone, "shattered pillar must be gone");
    assert!(
        !state.props[p_idx].solid,
        "shattered pillar must clear solid"
    );
    assert!(
        prop_obstacle(&state.props[p_idx], None).is_none(),
        "shattered pillar must remove walk obstacle"
    );
    assert!(
        state.sounds.iter().any(|s| s.kind == "stonePillarBreak"),
        "shatter must play stonePillarBreak sound"
    );
    assert!(
        state
            .effects
            .iter()
            .filter(|e| e.kind == "pillar_debris")
            .count()
            >= 8,
        "shatter must emit a burst of pillar_debris particles"
    );
    assert!(
        state.pickups.len() > pickups_before,
        "shattering a pillar must drop loot or gold"
    );
}

#[test]
fn test_mirkwood_pillar_and_native_pillar_both_breakable_with_hit_t_decay() {
    // 1) mirkwood room 2 (兽栏) has regular `pillar` props
    let mut mw = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    if let Some(d) = mw.dungeon.as_mut() {
        d.cells[mw.cell].room = 2;
        d.cells[mw.cell].props = None;
    }
    begin_room(&mut mw, None);
    let idx = mw
        .props
        .iter()
        .position(|p| p.piece == "pillar")
        .expect("mirkwood room 2 (兽栏) must contain pillar props");
    assert_eq!(mw.props[idx].hp, 4);
    let px = mw.props[idx].x;
    let pz = mw.props[idx].z;
    let swing = Rect {
        left: px - 60.0,
        right: px + 60.0,
        top: ARENA_GROUND_Y - 120.0,
        bottom: ARENA_GROUND_Y + 10.0,
    };
    swing_props(&mut mw, swing, None, Some((px, pz)), None);
    assert_eq!(mw.props[idx].hp, 3);
    assert!(mw.props[idx].hit_t > 0.0);
    // Run 20 frames (~0.33s) and verify hit_t decays back to 0.0
    run_frames(&mut mw, 20, |_, _| Input::default());
    assert_eq!(mw.props[idx].hit_t, 0.0, "hit_t should decay to 0.0");

    // 3 more hits shatter it completely
    for _ in 0..3 {
        swing_props(&mut mw, swing, None, Some((px, pz)), None);
    }
    assert!(mw.props[idx].broken && mw.props[idx].gone && !mw.props[idx].solid);

    // 2) mirkwooddeep room 8 (猫妖岔路) has native_pillar props
    let mut deep = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwooddeep"),
        reference_profile: true,
        ..Default::default()
    });
    if let Some(d) = deep.dungeon.as_mut() {
        d.cells[deep.cell].room = 8;
        d.cells[deep.cell].props = None;
    }
    begin_room(&mut deep, None);
    let n_idx = deep
        .props
        .iter()
        .position(|p| p.native_pillar.is_some())
        .expect("mirkwooddeep room 8 must contain native_pillar props");
    assert_eq!(deep.props[n_idx].hp, 4);
    let obs = prop_obstacle(&deep.props[n_idx], None).expect("native_pillar has obstacle");
    let n_swing = Rect {
        left: obs.x - 50.0,
        right: obs.x + 50.0,
        top: ARENA_GROUND_Y - 120.0,
        bottom: ARENA_GROUND_Y + 10.0,
    };
    for _ in 0..2 {
        swing_props(&mut deep, n_swing, None, Some((obs.x, obs.z)), None);
    }
    assert_eq!(deep.props[n_idx].hp, 2);
    assert_eq!(deep.props[n_idx].piece, "pillarDamagedDecor");
    assert!(deep.props[n_idx].solid);
    for _ in 0..2 {
        swing_props(&mut deep, n_swing, None, Some((obs.x, obs.z)), None);
    }
    assert!(deep.props[n_idx].broken && deep.props[n_idx].gone && !deep.props[n_idx].solid);
    assert!(prop_obstacle(&deep.props[n_idx], None).is_none());
}

#[test]
fn test_mirkwood_room4_far_right_enemies_activate_and_prevent_softlock() {
    // Mirkwood cell (1,1) is index 5 (pinned to room 7: 倒木小径, width=960, far-right enemies at x=780, 860).
    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        cell: Some(5),
        reference_profile: true,
        ..Default::default()
    });
    // Enter from the West door so the player is far from x=780, 860 (> 600 world units away).
    state.entry_door = Some("W".to_string());
    begin_room(&mut state, Some("W"));

    let far_right_indices: Vec<usize> = state
        .enemies
        .iter()
        .enumerate()
        .filter(|(_, e)| e.x >= 750.0)
        .map(|(i, _)| i)
        .collect();
    assert!(
        far_right_indices.len() >= 2,
        "倒木小径 must have far-right enemies near x=780 and x=860"
    );
    let initial_xs: Vec<f64> = far_right_indices
        .iter()
        .map(|&i| state.enemies[i].x)
        .collect();

    // Wait 2.0 seconds (120 frames) without moving.
    run_frames(&mut state, 120, |_, _| Input::default());

    for (&idx, &x0) in far_right_indices.iter().zip(initial_xs.iter()) {
        let e = &state.enemies[idx];
        assert!(
            e.activated,
            "far-right enemy {} (kind={}, x={}) must activate within 2.0s to prevent room softlock",
            idx, e.kind, e.x
        );
        assert!(
            e.x < x0 - 1.0,
            "activated far-right enemy {} (kind={}) should walk left toward player (was x={}, now x={})",
            idx, e.kind, x0, e.x
        );
    }
}

#[test]
fn test_mirkwood_cell_1_1_ranged_and_blocked_enemies_enter_viewport_and_clear_opens_gates() {
    // Mirkwood cell (1,1) is index 5 (pinned to room 7: 倒木小径, width=960,
    // rockFlat at x=620, caster at x=780, grunt at x=860, goblinRed at x=182, goblinBlue at x=360).
    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        cell: Some(5),
        reference_profile: true,
        ..Default::default()
    });
    state.entry_door = Some("N".to_string());
    begin_room(&mut state, Some("N"));

    // Position player at the North gate (x = 472) and center camera on the player.
    let north_gate_x = 472.0;
    let north_gate_z = band_depth(state.band_back_y);
    state.player.x = north_gate_x;
    state.player.z = north_gate_z;
    state.camera_x = (north_gate_x - window_width() / 2.0)
        .clamp(0.0, (room_width(&state) - window_width()).max(0.0));

    // Verify existing exits start locked while enemies are alive.
    let active_dirs: Vec<&str> = ["N", "S", "W", "E"]
        .into_iter()
        .filter(|&d| exit_mode(&state, d) != ExitMode::None)
        .collect();
    assert!(
        active_dirs.contains(&"N"),
        "cell (1,1) must have a North gate"
    );
    for &dir in &active_dirs {
        assert_eq!(
            exit_mode(&state, dir),
            ExitMode::Locked,
            "gate {} must start locked before room is cleared",
            dir
        );
    }

    // Step 8 seconds (480 frames), keeping the player alive and anchored at the North gate (x = 472).
    for _ in 0..480 {
        state.player.x = north_gate_x;
        state.player.z = north_gate_z;
        state.player.vx = 0.0;
        state.player.vz = 0.0;
        state.player.hp = state.player.max_hp;
        state.player.invuln = 1.0;
        step(&mut state, &Input::default(), None);
    }

    let cam_l = state.camera_x + 18.0;
    let cam_r = state.camera_x + window_width() - 18.0;

    let living: Vec<_> = state.enemies.iter().filter(|e| !e.dead).collect();
    assert!(
        !living.is_empty(),
        "enemies should still be alive before we kill them"
    );
    for e in &living {
        assert!(
            e.x >= cam_l && e.x <= cam_r,
            "living enemy id={} kind={} (behavior={}) stayed outside visible viewport [{:.1}, {:.1}] at x={:.1}, z={:.1}",
            e.id, e.kind, e.behavior, cam_l, cam_r, e.x, e.z
        );
    }

    // Kill all living enemies and step one frame to resolve the room.
    for idx in 0..state.enemies.len() {
        if !state.enemies[idx].dead {
            let hp = state.enemies[idx].hp + 9999.0;
            let ex = state.enemies[idx].x;
            damage_enemy(&mut state, idx, hp, 0.0, ex, &DamageEnemyOptions::default());
        }
    }
    step(&mut state, &Input::default(), None);

    assert!(
        state.room.as_ref().is_some_and(|r| r.cleared),
        "room must be cleared once all enemies are killed"
    );
    for &dir in &active_dirs {
        assert_eq!(
            exit_mode(&state, dir),
            ExitMode::Open,
            "gate {} must open immediately after all enemies are killed",
            dir
        );
    }
}
