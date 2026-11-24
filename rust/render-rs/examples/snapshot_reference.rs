use core_rs::types::CreateStateOptions;
use core_rs::{create_state, step};
use render_rs::{
    draw_town, render, Canvas, GlyphCache, ProgressPanelKind, RenderMeta, SpriteStore,
    RENDER_HEIGHT, RENDER_WIDTH,
};
use std::path::{Path, PathBuf};
use tiny_skia::Pixmap;

fn find_font() -> Option<Vec<u8>> {
    let candidates = [
        "/mnt/c/dnf/地下城与勇士/Fonts/msjh.ttf",
        "/mnt/c/Windows/Fonts/msyh.ttc",
        "/mnt/c/Windows/Fonts/simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    for p in candidates {
        if let Ok(bytes) = std::fs::read(p) {
            return Some(bytes);
        }
    }
    None
}

fn save_pixmap(pixmap: &Pixmap, path: &Path) {
    pixmap.save_png(path).expect("save png");
}

fn main() {
    let out_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("../docs/reference-evidence/rust-snapshots"));
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

    // 1. V1 Mirkwood Entry Room (matches 00001-幽暗密林.mp4 @ 58s)
    {
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        for _ in 0..30 {
            step(&mut state, &Default::default(), Some(1.0 / 60.0));
        }
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
        };
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);
        save_pixmap(&pixmap, &out_dir.join("v1_entry.png"));
    }

    // 2. V1 Mirkwood Boss Room (matches 00001-幽暗密林.mp4 @ 290s)
    {
        let probe = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        let boss_cell = probe.dungeon.as_ref().map(|d| d.boss);
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            cell: boss_cell,
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        for _ in 0..20 {
            step(&mut state, &Default::default(), Some(1.0 / 60.0));
        }
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
        };
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);
        save_pixmap(&pixmap, &out_dir.join("v1_boss.png"));
    }

    // 3. V2 Mirkwood Deep Entry Room (matches 00002-幽暗密林深处.mp4 @ 25s)
    {
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwooddeep"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.intro_t = None;
        for _ in 0..30 {
            step(&mut state, &Default::default(), Some(1.0 / 60.0));
        }
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
        };
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);
        save_pixmap(&pixmap, &out_dir.join("v2_entry.png"));
    }

    // 4. V1 Results Screen (matches 00001-幽暗密林.mp4 @ 335s)
    {
        let mut state = create_state(&CreateStateOptions {
            seed: Some(1),
            stage: Some("mirkwood"),
            reference_profile: true,
            ..Default::default()
        });
        state.transition = 0.0;
        state.victory = true;
        let mut reward = reward_rs::create(Some(1), Some("mirkwood")).expect("reward");
        reward.t = 2.0;
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
            reward: Some(&reward),
            region_open: false,
            region_selected: "mirkwood",
            hint: None,
            seed: state.seed,
            stage_id: &state.stage_id,
        };
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        render(&mut canvas, &state, &sprites, &meta);
        save_pixmap(&pixmap, &out_dir.join("v1_results.png"));
    }

    // 5. Town Elvenguard (matches 00002-幽暗密林深处.mp4 @ 415s)
    {
        let mut pixmap = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        let mut canvas = Canvas::new(&mut pixmap, &mut fonts);
        draw_town(&mut canvas, 1180.0, 48.0, 1, &sprites);
        save_pixmap(&pixmap, &out_dir.join("town.png"));
    }

    println!("Saved snapshots to {}", out_dir.display());
}
