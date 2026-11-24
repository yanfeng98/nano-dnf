use core_rs::create_state;
use core_rs::types::CreateStateOptions;
use render_rs::{
    draw_town_hud, draw_town_view, Canvas, GlyphCache, MapMode, ProgressPanelKind, RenderMeta,
    SpriteStore, TownView, TownZone, RENDER_HEIGHT, RENDER_WIDTH,
};
use std::path::{Path, PathBuf};
use tiny_skia::Pixmap;

fn find_font() -> Option<Vec<u8>> {
    let candidates = [
        "/mnt/c/dnf/地下城与勇士/Fonts/msjh.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    ];
    for p in candidates {
        if let Ok(bytes) = std::fs::read(p) {
            return Some(bytes);
        }
    }
    None
}

fn main() {
    let out_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/hm_render"));
    std::fs::create_dir_all(&out_dir).expect("create out_dir");

    let repo_root = Path::new("..");
    let sprites = SpriteStore::load_from_root(repo_root);
    let font_bytes = find_font();
    let mut fonts = GlyphCache::new(font_bytes.as_deref());
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
        stage: Some("mirkwood"),
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
        region_selected: "mirkwood",
        hint: None,
        seed: state.seed,
        stage_id: &state.stage_id,
        map_mode: MapMode::Radar,
        continue_hover: None,
        reward_card_hover: None,
    };

    let shots = [
        (
            "west_12s.png",
            TownZone::WestSquare,
            490.0,
            46.0,
            130.0,
            false,
            0.0,
            1,
            1.0,
        ),
        (
            "east_46s.png",
            TownZone::EastGate,
            480.0,
            32.0,
            180.0,
            true,
            0.35,
            1,
            0.0,
        ),
        (
            "east_50s.png",
            TownZone::EastGate,
            1470.0,
            26.0,
            1260.0,
            true,
            0.45,
            1,
            0.0,
        ),
    ];

    for (filename, zone, px, pz, cam_x, moving, walk, facing, title_alpha) in shots {
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).expect("800x600");
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
        pixmap
            .save_png(out_dir.join(filename))
            .expect("save hendonmyre png");
    }
    println!("Saved 3 Hendon Myre snapshots to {}", out_dir.display());
}
