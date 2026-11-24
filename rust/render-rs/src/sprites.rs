//! Sprite sheet loading and derived sheet generation (`src/render.js`).

use std::collections::HashMap;
use std::path::Path;
use tiny_skia::Pixmap;

pub struct SpriteStore {
    pub sheets: HashMap<String, Pixmap>,
    pub raging_slayer: Option<Pixmap>,
    pub loaded: usize,
    pub total: usize,
}

pub const ASSET_ENTRIES: [(&str, &str); 39] = [
    ("slayer", "assets/slayer-reference.png"),
    ("skills", "assets/skills.png"),
    ("skillsDisabled", "assets/skills-disabled.png"),
    ("skillRanks", "assets/skill-ranks.png"),
    ("effects", "assets/effects.png"),
    ("normalWave", "assets/normal-wave.png"),
    ("normalWaveBody", "assets/normal-wave-body.png"),
    ("rift", "assets/rift.png"),
    ("region", "assets/region.png"),
    ("monsters", "assets/monsters.png"),
    ("throwerReference", "assets/thrower-reference.png"),
    ("goblinReference", "assets/goblin-reference.png"),
    ("casterReference", "assets/caster-reference.png"),
    ("goblinStone", "assets/goblin-stone.png"),
    ("goblinStoneDebris", "assets/goblin-stone-debris.png"),
    ("goblinBomb", "assets/goblin-bomb.png"),
    ("goblinBombFlash", "assets/goblin-bomb-flash.png"),
    ("goblinBombPieces", "assets/goblin-bomb-pieces.png"),
    ("goblinIce", "assets/goblin-ice.png"),
    ("goblinIceAura", "assets/goblin-ice-aura.png"),
    ("goblinFire", "assets/goblin-fire.png"),
    ("forest", "assets/forest.png"),
    ("nativeFlora", "assets/native-flora.png"),
    ("nativePathGate", "assets/native-pathgate.png"),
    ("nativePathGateEast", "assets/native-pathgate-east.png"),
    (
        "nativePathGateEastNormal",
        "assets/native-pathgate-east-normal.png",
    ),
    ("forestDeep", "assets/forest-deep.png"),
    ("deepBossCloseback", "assets/deep-boss-closeback.png"),
    ("deepEntryCloseback", "assets/deep-entry-closeback.png"),
    ("deepRoom42Closeback", "assets/deep-room42-closeback.png"),
    ("deepRoom43Closeback", "assets/deep-room43-closeback.png"),
    ("deepRoom33Closeback", "assets/deep-room33-closeback.png"),
    ("deepRoom23Closeback", "assets/deep-room23-closeback.png"),
    ("deepRoom13Closeback", "assets/deep-room13-closeback.png"),
    ("deepRoom14Closeback", "assets/deep-room14-closeback.png"),
    ("deepRoom24Closeback", "assets/deep-room24-closeback.png"),
    ("deepRoom24Foreground", "assets/deep-room24-foreground.png"),
    ("weather", "assets/weather.png"),
    ("bossdeath", "assets/bossdeath.png"),
];

pub const UI_ASSET_ENTRIES: [(&str, &str); 12] = [
    ("ui", "assets/ui.png"),
    ("hud", "assets/hud.png"),
    ("hudClassic", "assets/hud-classic.png"),
    ("town", "assets/town.png"),
    ("npc", "assets/npc.png"),
    ("gui", "assets/gui.png"),
    ("treeReference", "assets/tree-reference.png"),
    ("treeFruitReference", "assets/tree-fruit-reference.png"),
    ("goblinBunker", "assets/goblin-bunker.png"),
    ("pillarPale", "assets/pillar-pale.png"),
    ("pillarDebris", "assets/pillar-debris.png"),
    ("gateBlock", "assets/gate-block.png"),
];

pub const EXTRA_ASSET_ENTRIES: [(&str, &str); 5] = [
    ("minimap", "assets/minimap.png"),
    ("results", "assets/results-reference.png"),
    ("experienceDigits", "assets/experience-digits.png"),
    ("awakening", "assets/awakening.png"),
    ("portraits", "assets/portraits-reference.png"),
];

impl SpriteStore {
    pub fn load_from_root(root: &Path) -> Self {
        let mut sheets = HashMap::new();
        let all: Vec<(&str, &str)> = ASSET_ENTRIES
            .iter()
            .chain(UI_ASSET_ENTRIES.iter())
            .chain(EXTRA_ASSET_ENTRIES.iter())
            .copied()
            .collect();
        let total = all.len();
        let mut loaded = 0;

        for (key, rel_path) in all {
            let full = root.join(rel_path);
            if let Ok(img) = image::open(&full) {
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                if let Some(mut pixmap) = Pixmap::new(w, h) {
                    // Convert straight RGBA to premultiplied RGBA for tiny_skia
                    let src = rgba.as_raw();
                    let dst = pixmap.data_mut();
                    for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
                        let a = u16::from(s[3]);
                        d[0] = ((u16::from(s[0]) * a + 127) / 255) as u8;
                        d[1] = ((u16::from(s[1]) * a + 127) / 255) as u8;
                        d[2] = ((u16::from(s[2]) * a + 127) / 255) as u8;
                        d[3] = s[3];
                    }
                    sheets.insert(key.to_string(), pixmap);
                }
            }
            loaded += 1;
        }

        let raging_slayer = sheets.get("slayer").and_then(make_raging_sheet);
        Self {
            sheets,
            raging_slayer,
            loaded,
            total,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Pixmap> {
        self.sheets.get(key)
    }
}

fn make_raging_sheet(src: &Pixmap) -> Option<Pixmap> {
    let mut out = Pixmap::new(src.width(), src.height())?;
    for (s, d) in src
        .data()
        .chunks_exact(4)
        .zip(out.data_mut().chunks_exact_mut(4))
    {
        let a = s[3];
        if a == 0 {
            continue;
        }
        let r = s[0];
        let g = s[1];
        let b = s[2];
        // Reddish tint matching render.js ragingSheet
        d[0] = ((u16::from(r) * 140 / 100).min(u16::from(a))) as u8;
        d[1] = (u16::from(g) * 45 / 100) as u8;
        d[2] = (u16::from(b) * 45 / 100) as u8;
        d[3] = a;
    }
    Some(out)
}
