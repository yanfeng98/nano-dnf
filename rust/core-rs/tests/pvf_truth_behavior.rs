use core_rs::dungeon::begin_room;
use core_rs::types::{CreateStateOptions, Input};
use core_rs::{create_state, run_frames};

#[test]
fn test_mirkwood_room4_west_red_goblin_activates_before_green_grunt() {
    // Mirkwood is 4x3; cell (1,1) is index 5 (pinned to room 7: 倒木小径, 普通第四房).
    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        cell: Some(5),
        reference_profile: true,
        ..Default::default()
    });
    // Simulate entering Room 4 from the north door (1,0) -> (1,1), as in V1 170.7-171.6s.
    state.entry_door = Some("N".to_string());
    begin_room(&mut state, Some("N"));

    let red_idx = state
        .enemies
        .iter()
        .position(|e| e.kind == "goblinRed" && e.x < 250.0)
        .expect("west goblinRed in room 4");
    let green_idx = state
        .enemies
        .iter()
        .position(|e| e.kind == "grunt" && e.x < 200.0)
        .expect("west green grunt in room 4");

    // Walk west from the north door toward the west pair.
    let left_input = Input {
        left: true,
        ..Default::default()
    };

    let mut red_activated_frame: Option<usize> = None;
    let mut green_activated_frame: Option<usize> = None;

    for frame in 0..180 {
        run_frames(&mut state, 1, |_, _| left_input);
        if red_activated_frame.is_none() && state.enemies[red_idx].activated {
            red_activated_frame = Some(frame);
        }
        if green_activated_frame.is_none() && state.enemies[green_idx].activated {
            green_activated_frame = Some(frame);
        }
        if red_activated_frame.is_some() && green_activated_frame.is_some() {
            break;
        }
    }

    let rf = red_activated_frame.expect("west goblinRed should activate when approached");
    let gf = green_activated_frame.expect("west green grunt should eventually activate");
    assert!(
        rf < gf,
        "expected west goblinRed to activate before green grunt (red={}, green={})",
        rf,
        gf
    );
}

#[test]
fn test_thrower_elite_bomb_30021_ballistic_arc_and_30022_aoe_explosion() {
    use core_rs::enemy::{create_enemy, spawn_projectile};
    use core_rs::{native_ground_x, ARENA_GROUND_Y};

    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwooddeep"),
        reference_profile: true,
        ..Default::default()
    });
    state.enemies.clear();
    let mut thrower = create_enemy(&mut state, "throwerElite", 220.0, 200.0, Some(6), Some(60));
    thrower.x = 220.0;
    thrower.z = 200.0;
    thrower.facing = 1;
    state.enemies.push(thrower);

    // Place player near where the bomb will land (~220 + 14.26 + 213.96 * 0.896 ≈ 426),
    // outside direct air-hit height so only the 30022 ground AoE blast can hit them.
    state.player.x = 455.0;
    state.player.y = ARENA_GROUND_Y;
    state.player.z = 200.0;
    let initial_hp = state.player.hp;

    spawn_projectile(&mut state, 0);
    assert_eq!(state.projectiles.len(), 1);
    let bomb = &state.projectiles[0];
    assert_eq!(bomb.native_object, Some(30021));
    assert!(
        (bomb.vx - native_ground_x(300.0)).abs() < 1e-3,
        "bomb vx should match PVF aimingbomb.ptl 300 native px/s"
    );
    assert!(
        (bomb.vy + native_ground_x(200.0)).abs() < 1e-3,
        "bomb initial vy should match PVF aimingbomb.ptl upward 200 native px/s"
    );
    assert!(
        (bomb.gravity - native_ground_x(600.0)).abs() < 1e-3,
        "bomb gravity should match PVF aimingbomb.ptl 600 native px/s^2"
    );

    // Step until the bomb lands and explodes (30022 AoE).
    let mut saw_flash = false;
    let mut saw_pieces = false;
    for _ in 0..90 {
        run_frames(&mut state, 1, |_, _| Input::default());
        if state.effects.iter().any(|e| e.kind == "bomb_flash") {
            saw_flash = true;
        }
        if state
            .effects
            .iter()
            .filter(|e| e.kind == "bomb_piece")
            .count()
            >= 20
        {
            saw_pieces = true;
        }
        if state.projectiles.is_empty() {
            break;
        }
    }
    assert!(state.projectiles.is_empty(), "bomb should land and explode");
    assert!(saw_flash, "30021 landing should emit 30022 bomb_flash");
    assert!(
        saw_pieces,
        "30021 landing should emit 20 FlyBombPiece particles"
    );
    assert!(
        state.player.hp < initial_hp,
        "30022 GobFlyBombSub AoE blast should damage nearby player on ground landing"
    );
}

#[test]
fn test_goblin_fire_30047_landing_stop_and_trail_fade() {
    use core_rs::enemy::{create_enemy, spawn_projectile};
    use core_rs::ARENA_GROUND_Y;

    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    state.enemies.clear();
    let mut red = create_enemy(&mut state, "goblinRed", 150.0, 200.0, Some(4), Some(40));
    red.x = 150.0;
    red.z = 200.0;
    red.facing = 1;
    state.enemies.push(red);
    // Keep player out of the way so fireball lands naturally.
    state.player.x = 80.0;
    state.player.z = 10.0;

    spawn_projectile(&mut state, 0);
    assert_eq!(state.projectiles[0].native_object, Some(30047));
    assert!(state.projectiles[0].landing_stop);

    let mut saw_stopped = false;
    for _ in 0..180 {
        run_frames(&mut state, 1, |_, _| Input::default());
        if let Some(p) = state.projectiles.first() {
            if p.stopped {
                saw_stopped = true;
                assert!((p.y - ARENA_GROUND_Y).abs() < 1e-6);
                assert!(p.stop_life > 0.0 && p.stop_life <= 0.35 + 1e-6);
                break;
            }
        }
    }
    assert!(
        saw_stopped,
        "30047 fireball should enter landing_stop state on ground contact"
    );
}

#[test]
fn test_goblin_ice_30057_oscillation_and_piercing() {
    use core_rs::enemy::{create_enemy, spawn_projectile};
    use core_rs::ARENA_GROUND_Y;

    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    state.enemies.clear();
    let mut blue = create_enemy(&mut state, "goblinBlue", 200.0, 200.0, Some(4), Some(40));
    blue.x = 200.0;
    blue.z = 200.0;
    blue.facing = 1;
    state.enemies.push(blue);
    state.player.x = 260.0;
    state.player.y = ARENA_GROUND_Y;
    state.player.z = 200.0;
    let initial_hp = state.player.hp;

    spawn_projectile(&mut state, 0);
    assert_eq!(state.projectiles[0].native_object, Some(30057));
    assert_eq!(state.projectiles[0].piercing, 50);

    run_frames(&mut state, 30, |_, _| Input::default());
    assert!(
        state.player.hp < initial_hp,
        "30057 iceball should damage player"
    );
    assert_eq!(
        state.projectiles.len(),
        1,
        "30057 iceball with piercing=50 should continue flying after hitting player"
    );
    assert!(state.projectiles[0].hit_player);
    assert_eq!(state.projectiles[0].piercing, 49);
    assert!(
        state.projectiles[0].osc_y.abs() > 0.0,
        "30057 iceball should oscillate vertically"
    );
}

#[test]
fn test_goblin_stone_30001_straight_flight_and_debris() {
    use core_rs::enemy::{create_enemy, spawn_projectile};
    use core_rs::ARENA_GROUND_Y;

    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    state.enemies.clear();
    let mut caster = create_enemy(&mut state, "caster", 200.0, 200.0, Some(4), Some(40));
    caster.x = 200.0;
    caster.z = 200.0;
    caster.facing = 1;
    state.enemies.push(caster);
    state.player.x = 260.0;
    state.player.y = ARENA_GROUND_Y;
    state.player.z = 200.0;

    spawn_projectile(&mut state, 0);
    assert_eq!(state.projectiles[0].native_object, Some(30001));
    assert_eq!(state.projectiles[0].piercing, 0);

    run_frames(&mut state, 25, |_, _| Input::default());
    assert!(
        state.projectiles.is_empty(),
        "30001 stone should be destroyed on hit"
    );
    assert_eq!(
        state
            .effects
            .iter()
            .filter(|e| e.kind == "stone_debris")
            .count(),
        10,
        "30001 stone destroy should emit 10 ThrowStoneDestroy debris particles"
    );
}

#[test]
fn test_drop_loot_uses_pvf_monster_drop_table() {
    use core_rs::combat::drop_loot;
    use core_rs::enemy::create_enemy;
    use std::collections::HashSet;

    let mut state = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    state.pickups.clear();

    let mut caster_drops = HashSet::new();
    for eid in 1..40u32 {
        let mut e = create_enemy(&mut state, "caster", 300.0, 150.0, Some(4), Some(40));
        e.id = eid;
        drop_loot(&mut state, &e);
        if let Some(p) = state.pickups.last() {
            caster_drops.insert(p.name.clone());
        }
    }
    assert!(
        caster_drops.contains("投掷石块"),
        "caster drop_loot should include PVF item 6003 (投掷石块), got {:?}",
        caster_drops
    );
    assert!(
        caster_drops.contains("命运硬币"),
        "caster drop_loot should include PVF item 1047 (命运硬币), got {:?}",
        caster_drops
    );

    let mut red_drops = HashSet::new();
    for eid in 1..40u32 {
        let mut e = create_enemy(&mut state, "goblinRed", 300.0, 150.0, Some(4), Some(40));
        e.id = eid;
        drop_loot(&mut state, &e);
        if let Some(p) = state.pickups.last() {
            red_drops.insert(p.name.clone());
        }
    }
    assert!(
        red_drops.contains("魔力之花") && red_drops.contains("越桔"),
        "goblinRed drop_loot should include PVF hillgab.mob items (越桔, 魔力之花), got {:?}",
        red_drops
    );
}
