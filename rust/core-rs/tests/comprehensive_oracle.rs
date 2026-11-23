use core_rs::types::{CreateStateOptions, Input};
use core_rs::{create_state, resume_after_clear, run_frames, step};

#[test]
fn test_skills_and_buffs_deterministic() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwood"),
        ..Default::default()
    });
    // Cast bloodRage (frenzy)
    let mut inp = Input::default();
    inp.set_skill("frenzy", true);
    step(&mut s, &inp, None);
    run_frames(&mut s, 90, |_, _| Input::default());
    assert!(s.player.buffs.get("bloodRage").copied().unwrap_or(0.0) > 0.0);

    // Cast berserk
    let mut inp_b = Input::default();
    inp_b.set_skill("berserk", true);
    step(&mut s, &inp_b, None);
    run_frames(&mut s, 45, |_, _| Input::default());
    assert!(s.player.buffs.get("berserk").copied().unwrap_or(0.0) > 0.0);

    // Cast hellbenter (awakening)
    let mut inp_h = Input::default();
    inp_h.set_skill("hellbenter", true);
    step(&mut s, &inp_h, None);
    run_frames(&mut s, 65, |_, _| Input::default());
    assert!(s.player.buffs.get("hellbenter").copied().unwrap_or(0.0) > 0.0);
    assert_eq!(s.player.hellbenter_tier, 1);
}

#[test]
fn test_mirkwooddeep_reference_profile_and_resume() {
    let mut s = create_state(&CreateStateOptions {
        seed: Some(20260915),
        stage: Some("mirkwooddeep"),
        reference_profile: true,
        ..Default::default()
    });
    assert_eq!(s.player.level, 6);
    assert_eq!(s.player.name.as_deref(), Some("阿努纳奇"));
    assert!(!resume_after_clear(&mut s));
    s.victory = true;
    assert!(resume_after_clear(&mut s));
    assert!(s.post_clear);
}
