use attract_rs::{create, step_session};

#[test]
fn test_oracle_1800_frames_matches_js() {
    let mut s = create(Some(20260915));
    for _ in 0..1800 {
        step_session(&mut s, None);
    }
    assert_eq!(s.state.stats.rooms, 2);
    assert_eq!(s.state.cell, 1);
    assert_eq!(s.state.stats.kills, 12);
    assert!((s.state.player.hp - 293.0).abs() < 1e-6);
    assert_eq!(s.state.enemies.iter().filter(|e| !e.dead).count(), 7);
    assert!(!s.state.victory);
    assert!(!s.state.defeat);
}
