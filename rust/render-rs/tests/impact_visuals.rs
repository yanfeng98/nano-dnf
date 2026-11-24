use core_rs::types::{CreateStateOptions, Effect};
use core_rs::{create_state, trigger_screen_shake};
use render_rs::{
    render, Canvas, GlyphCache, ProgressPanelKind, RenderMeta, SpriteStore, RENDER_HEIGHT,
    RENDER_WIDTH,
};
use std::path::Path;
use tiny_skia::Pixmap;

fn make_meta<'a>(
    loadout: &'a [Option<String>],
    progress: &'a progress_rs::ProgressProfile,
    records: &'a records_rs::RecordStore,
    state: &'a core_rs::types::State,
) -> RenderMeta<'a> {
    RenderMeta {
        title: false,
        attract: false,
        paused: false,
        show_help: false,
        loadout,
        loadout_open: false,
        progress_panel: ProgressPanelKind::None,
        progress,
        records,
        reward: None,
        region_open: false,
        region_selected: "mirkwood",
        hint: None,
        seed: state.seed,
        stage_id: &state.stage_id,
    }
}

fn render_to_pixmap(state: &core_rs::types::State, sprites: &SpriteStore) -> Pixmap {
    let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
    let mut fonts = GlyphCache::new(None);
    let progress = progress_rs::defaults();
    let records = records_rs::empty_store();
    let loadout = vec![Some("upSlash".to_string()); 6];
    let meta = make_meta(&loadout, &progress, &records, state);
    let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
    render(&mut canvas, state, sprites, &meta);
    pixmap
}

#[test]
fn test_impact_flash_renders_bright_yellow_white_starburst_pixels() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    assert!(
        sprites.get("impactFlash").is_some(),
        "SpriteStore must load assets/impact-flash.png"
    );
    assert!(
        sprites.get("damageDigits").is_some(),
        "SpriteStore must load assets/damage-digits.png"
    );

    let mut base_state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    base_state.transition = 0.0;
    base_state.intro_t = None;
    base_state.effects.clear();

    let base_pix = render_to_pixmap(&base_state, &sprites);

    let mut flash_state = base_state.clone();
    let mut eff = Effect::new("hitFlash", 0.15);
    eff.x = flash_state.player.x + 60.0;
    eff.y = flash_state.player.y - 50.0;
    eff.z = flash_state.player.z;
    eff.dir = 1;
    eff.variant = 0;
    eff.radius = 1.0;
    flash_state.effects.push(eff);

    let flash_pix = render_to_pixmap(&flash_state, &sprites);

    let bright_added = base_pix
        .data()
        .chunks_exact(4)
        .zip(flash_pix.data().chunks_exact(4))
        .filter(|(a, b)| b[0] >= 240 && b[1] >= 220 && (b[0] > a[0].saturating_add(40)))
        .count();
    assert!(
        bright_added >= 120,
        "impact starburst flash must add bright white-yellow pixels, got only {bright_added}"
    );
}

#[test]
fn test_bitmap_damage_numbers_distinguish_normal_critical_and_player_hit() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    let mut base_state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    base_state.transition = 0.0;
    base_state.intro_t = None;
    base_state.effects.clear();
    let base_pix = render_to_pixmap(&base_state, &sprites);

    let render_dmg = |critical: bool, player_hit: bool| {
        let mut s = base_state.clone();
        let mut eff = Effect::new("damage", 0.65);
        eff.text = "88".to_string();
        eff.x = s.player.x + 40.0;
        eff.y = s.player.y - 80.0;
        eff.z = s.player.z;
        eff.critical = critical;
        eff.player_hit = player_hit;
        s.effects.push(eff);
        render_to_pixmap(&s, &sprites)
    };

    let norm_pix = render_dmg(false, false);
    let crit_pix = render_dmg(true, false);
    let red_pix = render_dmg(false, true);

    let changed_pixels = |p: &Pixmap| -> Vec<[u8; 3]> {
        base_pix
            .data()
            .chunks_exact(4)
            .zip(p.data().chunks_exact(4))
            .filter(|(a, b)| {
                a[0].abs_diff(b[0]) > 25 || a[1].abs_diff(b[1]) > 25 || a[2].abs_diff(b[2]) > 25
            })
            .map(|(_, b)| [b[0], b[1], b[2]])
            .collect()
    };

    let norm_diff = changed_pixels(&norm_pix);
    let crit_diff = changed_pixels(&crit_pix);
    let red_diff = changed_pixels(&red_pix);

    assert!(
        crit_diff.len() > norm_diff.len(),
        "critical bitmap damage numbers ({}) must render larger than normal hits ({})",
        crit_diff.len(),
        norm_diff.len()
    );

    let red_dominant = red_diff
        .iter()
        .filter(|px| px[0] > 180 && px[1] < 100 && px[2] < 100)
        .count();
    assert!(
        red_dominant >= 40,
        "player hurt damage number must render distinct red pixels, got {red_dominant}"
    );

    let yellow_dominant = norm_diff
        .iter()
        .filter(|px| px[0] > 200 && px[1] > 170 && px[2] < 120)
        .count();
    assert!(
        yellow_dominant >= 40,
        "normal hit damage number must render distinct yellow pixels, got {yellow_dominant}"
    );
}

#[test]
fn test_enemy_hit_flash_and_micro_jitter_visibly_affect_enemy_pixels() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    let mut idle_state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    idle_state.transition = 0.0;
    idle_state.intro_t = None;
    idle_state.effects.clear();
    assert!(!idle_state.enemies.is_empty());
    idle_state.enemies[0].x = idle_state.player.x + 80.0;
    idle_state.enemies[0].z = idle_state.player.z;
    idle_state.enemies[0].hurt_timer = 0.0;
    idle_state.enemies[0].hit_flash_timer = 0.0;

    let idle_pix = render_to_pixmap(&idle_state, &sprites);

    let mut hurt_state = idle_state.clone();
    hurt_state.time = 0.03;
    hurt_state.enemies[0].hurt_timer = 0.16;
    hurt_state.enemies[0].hit_flash_timer = 0.11;

    let hurt_pix = render_to_pixmap(&hurt_state, &sprites);

    let brightened = idle_pix
        .data()
        .chunks_exact(4)
        .zip(hurt_pix.data().chunks_exact(4))
        .filter(|(a, b)| {
            let la = u16::from(a[0]) + u16::from(a[1]) + u16::from(a[2]);
            let lb = u16::from(b[0]) + u16::from(b[1]) + u16::from(b[2]);
            lb > la + 90
        })
        .count();
    assert!(
        brightened >= 80,
        "enemy hit flash must visibly brighten enemy pixels, got {brightened}"
    );
}

#[test]
fn test_screen_shake_offsets_rendered_world_pixels_without_changing_camera() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    let mut calm_state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    calm_state.transition = 0.0;
    calm_state.intro_t = None;
    calm_state.time = 0.03;
    let cam_x = calm_state.camera_x;
    let cam_y = calm_state.camera_y;

    let calm_pix = render_to_pixmap(&calm_state, &sprites);

    let mut shake_state = calm_state.clone();
    trigger_screen_shake(&mut shake_state, 8.5, 0.28);
    assert_eq!(shake_state.camera_x, cam_x);
    assert_eq!(shake_state.camera_y, cam_y);

    let shake_pix = render_to_pixmap(&shake_state, &sprites);

    let shifted = calm_pix
        .data()
        .chunks_exact(4)
        .zip(shake_pix.data().chunks_exact(4))
        .filter(|(a, b)| {
            a[0].abs_diff(b[0]) > 15 || a[1].abs_diff(b[1]) > 15 || a[2].abs_diff(b[2]) > 15
        })
        .count();
    assert!(
        shifted >= 5000,
        "active screen shake must shift the rendered world viewport pixels, got {shifted}"
    );
}
