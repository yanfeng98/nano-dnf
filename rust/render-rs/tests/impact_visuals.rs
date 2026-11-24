use core_rs::types::{CreateStateOptions, Effect};
use core_rs::{create_state, trigger_screen_shake};
use render_rs::{
    render, Canvas, GlyphCache, MapMode, ProgressPanelKind, RenderMeta, SpriteStore, RENDER_HEIGHT,
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
        map_mode: MapMode::default(),
        continue_hover: None,
        reward_card_hover: None,
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
    assert!(
        bright_added <= 2200,
        "toned-down hitFlash should stay compact (~45-56 world units), got {bright_added} bright pixels"
    );
}

#[test]
fn test_per_species_monster_gibs_render_distinct_colors_and_settle_on_ground() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    assert!(
        sprites.get("monsterGibs").is_some(),
        "SpriteStore must load assets/monster-gibs.png"
    );
    assert_eq!(render_rs::world::monster_gib_row("grunt"), 0);
    assert_eq!(render_rs::world::monster_gib_row("goblinRed"), 1);
    assert_eq!(render_rs::world::monster_gib_row("cursedRed"), 1);
    assert_eq!(render_rs::world::monster_gib_row("goblinBlue"), 2);
    assert_eq!(render_rs::world::monster_gib_row("throwerElite"), 3);
    assert_eq!(render_rs::world::monster_gib_row("burningThrower"), 4);
    assert_eq!(render_rs::world::monster_gib_row("cat"), 5);
    assert_eq!(render_rs::world::monster_gib_row("lugaruBoss"), 6);
    assert_eq!(render_rs::world::monster_gib_row("deepBoss"), 6);
    assert_eq!(render_rs::world::monster_gib_row("boss"), 7);

    // Bounce + settle physics must clamp horizontal travel after landing & 1st bounce
    let (dx_settled_1, h_settled_1, _) =
        render_rs::world::gib_bounce_state(1.5, 35.0, 120.0, 90.0, 680.0);
    let (dx_settled_2, h_settled_2, _) =
        render_rs::world::gib_bounce_state(3.0, 35.0, 120.0, 90.0, 680.0);
    assert_eq!(h_settled_1, 0.0);
    assert_eq!(h_settled_2, 0.0);
    assert!(
        (dx_settled_1 - dx_settled_2).abs() < 1e-6,
        "gib must rest on the grass without sliding forever ({dx_settled_1} vs {dx_settled_2})"
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

    let render_gibs = |species: &str| {
        let mut s = base_state.clone();
        let mut eff = Effect::new("deathburst", 0.55);
        eff.life = 0.35; // 0.20s elapsed, mid-scatter
        eff.x = s.player.x + 80.0;
        eff.z = s.player.z;
        eff.seed = 42;
        eff.enemy_type = species.to_string();
        eff.height = 76.0;
        s.effects.push(eff);
        render_to_pixmap(&s, &sprites)
    };

    let red_pix = render_gibs("goblinRed");
    let blue_pix = render_gibs("goblinBlue");

    let count_channel_dominant = |p: &Pixmap, red_dom: bool| {
        base_pix
            .data()
            .chunks_exact(4)
            .zip(p.data().chunks_exact(4))
            .filter(|(a, b)| {
                let changed = a[0].abs_diff(b[0]) > 25
                    || a[1].abs_diff(b[1]) > 25
                    || a[2].abs_diff(b[2]) > 25;
                if !changed {
                    return false;
                }
                if red_dom {
                    b[0] > 150 && b[0] > b[2].saturating_add(60)
                } else {
                    b[2] > 140 && b[2] > b[0].saturating_add(40)
                }
            })
            .count()
    };

    let red_gib_px = count_channel_dominant(&red_pix, true);
    let blue_gib_px = count_channel_dominant(&blue_pix, false);
    assert!(
        red_gib_px >= 60,
        "goblinRed deathburst must render distinct crimson gibs, got {red_gib_px}"
    );
    assert!(
        blue_gib_px >= 60,
        "goblinBlue deathburst must render distinct blue gibs, got {blue_gib_px}"
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

#[test]
fn test_basic_attack_renders_white_gold_slash_streak_and_flips_with_facing() {
    let sprites = SpriteStore::load_from_root(Path::new("../.."));
    let slash_sheet = sprites
        .get("basicSlash")
        .expect("SpriteStore must load assets/basic-slash.png as \"basicSlash\"");
    assert_eq!((slash_sheet.width(), slash_sheet.height()), (960, 552));

    let mut no_slash_sprites = SpriteStore::load_from_root(Path::new("../.."));
    no_slash_sprites.sheets.remove("basicSlash");

    let mut base_state = create_state(&CreateStateOptions {
        seed: Some(1),
        stage: Some("mirkwood"),
        reference_profile: true,
        ..Default::default()
    });
    base_state.transition = 0.0;
    base_state.intro_t = None;
    base_state.effects.clear();
    base_state.enemies.clear();
    base_state.player.x = 360.0;
    base_state.player.facing = 1;
    base_state.player.on_ground = true;
    base_state.player.skill_timer = 0.0;
    base_state.player.attack_timer = 0.0;

    // Helper: bounding box and centroid of pixels drawn exclusively by "basicSlash"
    let slash_bbox = |a: &Pixmap, b: &Pixmap| -> (usize, u32, u32, u32, u32, f64) {
        let mut count = 0usize;
        let mut min_x = u32::MAX;
        let mut max_x = 0u32;
        let mut min_y = u32::MAX;
        let mut max_y = 0u32;
        let mut sum_x = 0.0f64;
        let ad = a.data();
        let bd = b.data();
        for y in 0..RENDER_HEIGHT {
            for x in 0..RENDER_WIDTH {
                let i = ((y * RENDER_WIDTH + x) * 4) as usize;
                let (ar, ag, ab) = (ad[i], ad[i + 1], ad[i + 2]);
                let (br, bg, bb) = (bd[i], bd[i + 1], bd[i + 2]);
                let is_bright_gold = br >= 230
                    && bg >= 170
                    && (br > ar.saturating_add(40) || bg > ag.saturating_add(40))
                    && (u16::from(br) + u16::from(bg) + u16::from(bb))
                        > (u16::from(ar) + u16::from(ag) + u16::from(ab) + 100);
                if is_bright_gold {
                    count += 1;
                    min_x = min_x.min(x);
                    max_x = max_x.max(x);
                    min_y = min_y.min(y);
                    max_y = max_y.max(y);
                    sum_x += f64::from(x);
                }
            }
        }
        let cx = if count > 0 { sum_x / count as f64 } else { 0.0 };
        (count, min_x, max_x, min_y, max_y, cx)
    };

    for combo in 0..3usize {
        let mut atk = base_state.clone();
        atk.player.combo_index = combo;
        atk.player.attack_duration = 0.22;
        atk.player.attack_timer = 0.22 * (1.0 - 0.38); // prog = 0.38 (peak lens frame)
        let without_pix = render_to_pixmap(&atk, &no_slash_sprites);
        let with_pix = render_to_pixmap(&atk, &sprites);
        let (count, min_x, max_x, min_y, max_y, _cx) = slash_bbox(&without_pix, &with_pix);
        assert!(
            count >= 220,
            "basic attack combo {combo} must render bright white-gold slash streak, got {count} px"
        );
        if combo == 1 {
            let bw = max_x.saturating_sub(min_x) + 1;
            let bh = max_y.saturating_sub(min_y) + 1;
            assert!(
                bw >= 130 && bw > bh * 4,
                "combo 1 horizontal slash streak must be wide and razor-sharp (got {bw}x{bh})"
            );
        }
    }

    // Verify facing flip shifts the horizontal slash streak to the opposite side of the player
    let mut right_atk = base_state.clone();
    right_atk.player.facing = 1;
    right_atk.player.combo_index = 1;
    right_atk.player.attack_duration = 0.22;
    right_atk.player.attack_timer = 0.22 * (1.0 - 0.38);
    let right_without = render_to_pixmap(&right_atk, &no_slash_sprites);
    let right_with = render_to_pixmap(&right_atk, &sprites);
    let (_, _, _, _, _, right_cx) = slash_bbox(&right_without, &right_with);

    let mut left_atk = base_state.clone();
    left_atk.player.facing = -1;
    left_atk.player.combo_index = 1;
    left_atk.player.attack_duration = 0.22;
    left_atk.player.attack_timer = 0.22 * (1.0 - 0.38);
    let left_without = render_to_pixmap(&left_atk, &no_slash_sprites);
    let left_with = render_to_pixmap(&left_atk, &sprites);
    let (left_count, _, _, _, _, left_cx) = slash_bbox(&left_without, &left_with);
    assert!(
        left_count >= 220,
        "left-facing basic attack must render slash streak, got {left_count} px"
    );
    assert!(
        right_cx > left_cx + 30.0,
        "facing +1 slash centroid ({right_cx:.1}) must lie well right of facing -1 ({left_cx:.1})"
    );

    // Verify bloodRage suppresses the normal basicSlash so it does not double-draw over bloodRage arc
    let mut rage_atk = right_atk.clone();
    rage_atk.player.buffs.insert("bloodRage".to_string(), 10.0);
    let rage_without = render_to_pixmap(&rage_atk, &no_slash_sprites);
    let rage_with = render_to_pixmap(&rage_atk, &sprites);
    let (rage_diff, _, _, _, _, _) = slash_bbox(&rage_without, &rage_with);
    assert_eq!(
        rage_diff, 0,
        "bloodRage basic attack must not render normal basicSlash over its crimson arc"
    );
}

#[test]
fn test_normal_hit_flash_is_compact_directional_slash_while_crit_is_starburst() {
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

    let measure_flash = |gold: bool| -> (usize, u32, u32) {
        let mut s = base_state.clone();
        let mut eff = Effect::new("hitFlash", 0.15);
        eff.x = s.player.x + 60.0;
        eff.y = s.player.y - 50.0;
        eff.z = s.player.z;
        eff.dir = 1;
        eff.variant = 0;
        eff.radius = 1.0;
        eff.gold = gold;
        s.effects.push(eff);
        let pix = render_to_pixmap(&s, &sprites);
        let mut count = 0usize;
        let mut min_x = u32::MAX;
        let mut max_x = 0u32;
        let mut min_y = u32::MAX;
        let mut max_y = 0u32;
        let ad = base_pix.data();
        let bd = pix.data();
        for y in 0..RENDER_HEIGHT {
            for x in 0..RENDER_WIDTH {
                let i = ((y * RENDER_WIDTH + x) * 4) as usize;
                if bd[i] >= 240 && bd[i + 1] >= 200 && bd[i] > ad[i].saturating_add(40) {
                    count += 1;
                    min_x = min_x.min(x);
                    max_x = max_x.max(x);
                    min_y = min_y.min(y);
                    max_y = max_y.max(y);
                }
            }
        }
        let bw = if count > 0 { max_x - min_x + 1 } else { 0 };
        let bh = if count > 0 { max_y - min_y + 1 } else { 0 };
        (count, bw, bh)
    };

    let (norm_px, norm_w, norm_h) = measure_flash(false);
    assert!(
        (120..=1800).contains(&norm_px),
        "normal hitFlash should be compact, got {norm_px} bright px"
    );
    assert!(
        norm_w > norm_h * 2,
        "normal hitFlash must be a directional horizontal slash spark, not a round blob (got {norm_w}x{norm_h})"
    );

    let (crit_px, crit_w, crit_h) = measure_flash(true);
    assert!(
        crit_px >= 250 && crit_h >= 24 && crit_w >= 24,
        "critical/heavy hitFlash (gold=true) must retain compact starburst (got {crit_px} px, {crit_w}x{crit_h})"
    );
}
