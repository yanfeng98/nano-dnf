use core_rs::combat::{damage_enemy, damage_player, DamageEnemyOptions};
use core_rs::types::{CreateStateOptions, Input};
use core_rs::{create_state, step, trigger_screen_shake};

#[test]
fn test_melee_hit_emits_starburst_flash_and_damage_effect() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    assert!(!s.enemies.is_empty());
    s.enemies[0].evasion = 0.0;
    s.effects.clear();

    let rng_before = s.rng_state;
    let px = s.player.x;
    let opts = DamageEnemyOptions {
        hit_stop: 0.05,
        ..Default::default()
    };
    let applied = damage_enemy(&mut s, 0, 25.0, 40.0, px, &opts);
    assert_eq!(applied, 25);
    assert_eq!(
        s.rng_state, rng_before,
        "visual hit feedback must not consume gameplay RNG"
    );

    let flash = s.effects.iter().find(|e| e.kind == "hitFlash");
    assert!(
        flash.is_some(),
        "landing a melee hit must emit a hitFlash starburst effect"
    );
    let dmg = s
        .effects
        .iter()
        .find(|e| e.kind == "damage" && !e.miss)
        .expect("damage effect");
    assert_eq!(dmg.text, "25");
    assert!(!dmg.player_hit);
    assert!(!dmg.critical);
}

#[test]
fn test_miss_never_emits_hit_flash_or_sparks() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    assert!(!s.enemies.is_empty());
    s.enemies[0].evasion = 1.0;
    s.effects.clear();

    let px = s.player.x;
    let opts = DamageEnemyOptions {
        hit_stop: 0.05,
        ..Default::default()
    };
    let applied = damage_enemy(&mut s, 0, 25.0, 40.0, px, &opts);
    assert_eq!(applied, 0);

    assert!(
        s.effects.iter().any(|e| e.kind == "damage" && e.miss),
        "miss must emit a MISS damage effect"
    );
    assert!(
        !s.effects.iter().any(|e| e.kind == "hitFlash"),
        "miss must NEVER emit a hitFlash starburst"
    );
    assert_eq!(
        s.shake_timer, 0.0,
        "miss must NEVER trigger camera screen shake"
    );
}

#[test]
fn test_player_damage_marks_player_hit_red_style() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    s.effects.clear();

    let px = s.player.x;
    let applied = damage_player(&mut s, 14.0, px + 30.0);
    assert_eq!(applied, 14);
    let dmg = s
        .effects
        .iter()
        .find(|e| e.kind == "damage")
        .expect("player damage effect");
    assert_eq!(dmg.text, "14");
    assert!(
        dmg.player_hit,
        "player damage taken must be flagged player_hit for red palette"
    );
    assert!(
        s.effects.iter().any(|e| e.kind == "hitFlash"),
        "player taking damage should emit a compact hitFlash"
    );
}

#[test]
fn test_heavy_hit_marks_critical_damage_style() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    s.enemies[0].evasion = 0.0;
    s.effects.clear();

    let px = s.player.x;
    let opts = DamageEnemyOptions {
        hit_stop: 0.09,
        knockdown: 0.5,
        ..Default::default()
    };
    let applied = damage_enemy(&mut s, 0, 72.0, 80.0, px, &opts);
    assert_eq!(applied, 72);

    let dmg = s
        .effects
        .iter()
        .find(|e| e.kind == "damage" && !e.miss)
        .expect("critical damage effect");
    assert!(
        dmg.critical,
        "heavy/finisher hit should be flagged critical for large orange-gold palette"
    );
}

#[test]
fn test_enemy_hit_sets_hit_flash_timer_even_with_super_armor() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    s.enemies[0].evasion = 0.0;
    s.enemies[0].super_armor = true;
    s.enemies[0].hit_flash_timer = 0.0;

    let px = s.player.x;
    let opts = DamageEnemyOptions {
        hit_stop: 0.05,
        ..Default::default()
    };
    let applied = damage_enemy(&mut s, 0, 20.0, 40.0, px, &opts);
    assert_eq!(applied, 20);
    assert!(
        s.enemies[0].hit_flash_timer > 0.0,
        "hit_flash_timer must trigger even on super-armored enemies"
    );
}

#[test]
fn test_screen_shake_triggers_and_decays_without_perturbing_camera_or_rng() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    s.transition = 0.0;
    let cam_x0 = s.camera_x;
    let cam_y0 = s.camera_y;
    let rng0 = s.rng_state;

    trigger_screen_shake(&mut s, 8.5, 0.25);
    assert!((s.shake_amp - 8.5).abs() < 1e-6);
    assert!((s.shake_timer - 0.25).abs() < 1e-6);
    assert!((s.shake_duration - 0.25).abs() < 1e-6);
    assert_eq!(s.camera_x, cam_x0);
    assert_eq!(s.camera_y, cam_y0);
    assert_eq!(s.rng_state, rng0);

    // Stronger impulse overrides weaker; weaker does not downgrade stronger
    trigger_screen_shake(&mut s, 2.0, 0.10);
    assert!((s.shake_amp - 8.5).abs() < 1e-6);

    // Step past 0.25s and confirm smooth decay to zero
    let inp = Input::default();
    for _ in 0..20 {
        step(&mut s, &inp, None);
    }
    assert_eq!(s.shake_timer, 0.0);
    assert_eq!(s.shake_amp, 0.0);
}
