use core_rs::constants::ARENA_GROUND_Y;
use core_rs::create_state;
use core_rs::enemy::create_enemy;
use core_rs::types::CreateStateOptions;
use render_rs::world::{champion_affix, draw_enemy, draw_player, floor_y, player_overhead_label};
use render_rs::{Canvas, GlyphCache, Rgba, SpriteStore, RENDER_HEIGHT, RENDER_WIDTH};
use std::path::PathBuf;
use tiny_skia::Pixmap;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("rust dir")
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn load_test_fonts(root: &PathBuf) -> GlyphCache {
    let candidates = [
        root.join("assets/font.ttf"),
        PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"),
        PathBuf::from("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
        PathBuf::from("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        PathBuf::from("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    ];
    let blobs: Vec<Vec<u8>> = candidates
        .into_iter()
        .filter_map(|p| std::fs::read(p).ok())
        .collect();
    let refs: Vec<&[u8]> = blobs.iter().map(Vec::as_slice).collect();
    GlyphCache::from_font_blobs(&refs)
}

fn count_pixels_in_rect<F>(pixmap: &Pixmap, x0: u32, y0: u32, x1: u32, y1: u32, pred: F) -> usize
where
    F: Fn(u8, u8, u8, u8) -> bool,
{
    let w = pixmap.width();
    let h = pixmap.height();
    let data = pixmap.data();
    let mut count = 0usize;
    for y in y0.min(h)..y1.min(h) {
        for x in x0.min(w)..x1.min(w) {
            let idx = ((y * w + x) * 4) as usize;
            if pred(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]) {
                count += 1;
            }
        }
    }
    count
}

#[test]
fn damaged_ordinary_enemy_has_no_floating_hp_bar() {
    let root = repo_root();
    let sprites = SpriteStore::load_from_root(&root);
    let mut fonts = load_test_fonts(&root);

    let mut state = create_state(&CreateStateOptions::default());
    let mut full_hp_enemy = create_enemy(&mut state, "grunt", 360.0, 20.0, Some(4), None);
    full_hp_enemy.hp = full_hp_enemy.max_hp;

    let mut damaged_enemy = full_hp_enemy.clone();
    damaged_enemy.hp = damaged_enemy.max_hp * 0.4;

    let mut pm_full = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
    let mut pm_damaged = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");

    {
        let mut c = Canvas::new(&mut pm_full, &mut fonts);
        c.clear(Rgba::new(10, 12, 18, 255));
        draw_enemy(&mut c, &state, &full_hp_enemy, &sprites);
    }
    {
        let mut c = Canvas::new(&mut pm_damaged, &mut fonts);
        c.clear(Rgba::new(10, 12, 18, 255));
        draw_enemy(&mut c, &state, &damaged_enemy, &sprites);
    }

    assert!(
        pm_full.data() == pm_damaged.data(),
        "damaged ordinary enemy must not render a floating HP bar"
    );
}

#[test]
fn boss_renders_dark_red_outline_and_purple_title() {
    let root = repo_root();
    let sprites = SpriteStore::load_from_root(&root);
    let mut fonts = load_test_fonts(&root);

    let mut state = create_state(&CreateStateOptions::default());
    for kind in ["boss", "lugaruBoss"] {
        let boss = create_enemy(&mut state, kind, 400.0, 20.0, None, None);
        let mut pm = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pm, &mut fonts);
            c.clear(Rgba::new(10, 12, 18, 255));
            draw_enemy(&mut c, &state, &boss, &sprites);
        }

        // Crisp dark-red silhouette outline pixels around boss sprite
        let dark_red_px =
            count_pixels_in_rect(&pm, 0, 0, RENDER_WIDTH, RENDER_HEIGHT, |r, g, b, _| {
                r >= 115 && g <= 38 && b <= 45
            });
        assert!(
            dark_red_px >= 80,
            "boss `{kind}` should render a crisp dark-red silhouette outline (found {dark_red_px} dark-red px)"
        );

        // Purple overhead boss title above the boss
        let purple_title_px =
            count_pixels_in_rect(&pm, 0, 0, RENDER_WIDTH, RENDER_HEIGHT, |r, g, b, _| {
                r >= 150 && g <= 80 && b >= 140
            });
        assert!(
            purple_title_px >= 10,
            "boss `{kind}` should render a purple overhead title (found {purple_title_px} purple px)"
        );
    }
}

#[test]
fn champion_renders_animated_flame_aura_and_two_line_overhead_text() {
    let root = repo_root();
    let sprites = SpriteStore::load_from_root(&root);
    let mut fonts = load_test_fonts(&root);

    let mut state = create_state(&CreateStateOptions::default());
    let champ = create_enemy(&mut state, "cursedRed", 400.0, 20.0, Some(4), None);

    let mut pm_t0 = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
    let mut pm_t1 = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
    state.time = 0.0;
    {
        let mut c = Canvas::new(&mut pm_t0, &mut fonts);
        c.clear(Rgba::new(10, 12, 18, 255));
        draw_enemy(&mut c, &state, &champ, &sprites);
    }
    state.time = 0.25;
    {
        let mut c = Canvas::new(&mut pm_t1, &mut fonts);
        c.clear(Rgba::new(10, 12, 18, 255));
        draw_enemy(&mut c, &state, &champ, &sprites);
    }

    assert_eq!(champion_affix(&champ), Some("无法浮空"));
    assert!(
        pm_t0.data() != pm_t1.data(),
        "champion aura must animate over time"
    );

    // Rich glowing magenta/purple flame aura pixels (far more than a 2px thin ellipse)
    let magenta_px =
        count_pixels_in_rect(&pm_t0, 0, 0, RENDER_WIDTH, RENDER_HEIGHT, |r, g, b, _| {
            r >= 110 && b >= 140 && b > g.saturating_add(25)
        });
    assert!(
        magenta_px >= 600,
        "cursedRed champion should render a rich animated magenta/purple flame aura (found {magenta_px} px)"
    );

    // Fire champion should render warm flame aura pixels
    let fire_champ = create_enemy(&mut state, "burningThrower", 400.0, 20.0, Some(4), None);
    assert_eq!(champion_affix(&fire_champ), Some("火焰爆炸"));
    let mut pm_fire = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
    {
        let mut c = Canvas::new(&mut pm_fire, &mut fonts);
        c.clear(Rgba::new(10, 12, 18, 255));
        draw_enemy(&mut c, &state, &fire_champ, &sprites);
    }
    let fire_px =
        count_pixels_in_rect(&pm_fire, 0, 0, RENDER_WIDTH, RENDER_HEIGHT, |r, g, b, _| {
            r >= 170 && g >= 60 && b <= 90
        });
    assert!(
        fire_px >= 600,
        "burningThrower champion should render a rich animated fire flame aura (found {fire_px} px)"
    );
}

#[test]
fn player_foot_ring_visible_on_ground_while_standing_and_jumping() {
    let root = repo_root();
    let sprites = SpriteStore::load_from_root(&root);
    let mut fonts = load_test_fonts(&root);

    let mut state = create_state(&CreateStateOptions::default());
    state.player.x = 400.0;
    state.player.z = 20.0;
    state.player.level = 3;
    state.player.name = None;
    assert_eq!(player_overhead_label(&state.player), "Lv.3 阿努纳奇");
    state.player.name = Some("狱血魔神".to_string());
    assert_eq!(player_overhead_label(&state.player), "Lv.3 狱血魔神");
    state.player.name = None;

    for (label, y_val) in [
        ("standing", ARENA_GROUND_Y),
        ("jumping", ARENA_GROUND_Y - 70.0),
    ] {
        state.player.y = y_val;
        let mut pm = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("pixmap");
        {
            let mut c = Canvas::new(&mut pm, &mut fonts);
            c.clear(Rgba::new(10, 12, 18, 255));
            draw_player(&mut c, &state, &sprites);
        }
        let ground_screen_y = (floor_y(state.player.z) * (RENDER_HEIGHT as f32 / 540.0)) as u32;
        let green_ring_px = count_pixels_in_rect(
            &pm,
            0,
            ground_screen_y.saturating_sub(25),
            RENDER_WIDTH,
            (ground_screen_y + 30).min(RENDER_HEIGHT),
            |r, g, b, _| g >= 160 && g > b.saturating_add(50) && r >= 60,
        );
        assert!(
            green_ring_px >= 80,
            "player neon-green foot ring must remain visible while {label} (found {green_ring_px} px)"
        );
    }
}
