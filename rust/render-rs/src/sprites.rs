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

pub const UI_ASSET_ENTRIES: [(&str, &str); 13] = [
    ("ui", "assets/ui.png"),
    ("hud", "assets/hud.png"),
    ("hudClassic", "assets/hud-classic.png"),
    ("consumables", "assets/consumables.png"),
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

pub const EXTRA_ASSET_ENTRIES: [(&str, &str); 7] = [
    ("minimap", "assets/minimap.png"),
    ("results", "assets/results-reference.png"),
    ("experienceDigits", "assets/experience-digits.png"),
    ("awakening", "assets/awakening.png"),
    ("portraits", "assets/portraits-reference.png"),
    ("impactFlash", "assets/impact-flash.png"),
    ("damageDigits", "assets/damage-digits.png"),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
    }

    fn cell_pixels(
        sheet: &Pixmap,
        row: u32,
        col: u32,
        cell_w: u32,
        cell_h: u32,
    ) -> impl Iterator<Item = (u32, u32, &[u8])> {
        let w = sheet.width();
        let data = sheet.data();
        let x0 = col * cell_w;
        let y0 = row * cell_h;
        (0..cell_h).flat_map(move |dy| {
            (0..cell_w).map(move |dx| {
                let idx = (((y0 + dy) * w + (x0 + dx)) * 4) as usize;
                (dx, dy, &data[idx..idx + 4])
            })
        })
    }

    #[test]
    fn reference_slayer_sheet_geometry_appearance_and_raging_variant() {
        let store = SpriteStore::load_from_root(&repo_root());
        let slayer = store.get("slayer").expect("slayer-reference.png loaded");
        assert_eq!((slayer.width(), slayer.height()), (13312, 2640));

        // Verify key combat + town animation rows are non-empty.
        let required_cells: &[(u32, u32, &str)] = &[
            (0, 0, "idle"),
            (0, 3, "idle_end"),
            (1, 0, "run"),
            (1, 7, "run_end"),
            (2, 0, "attack"),
            (2, 3, "attack_slash"),
            (3, 0, "skill"),
            (4, 0, "extras_hit"),
            (4, 2, "extras_knockdown"),
            (5, 0, "clips"),
            (6, 0, "clips2"),
            (7, 2, "bloodblade"),
            (8, 0, "flare"),
            (9, 0, "rage"),
            (11, 0, "awaken"),
            (12, 0, "town_walk"),
            (12, 7, "town_walk_end"),
            (13, 0, "ghostSlash"),
            (14, 0, "normalWave"),
        ];
        for &(row, col, label) in required_cells {
            let opaque = cell_pixels(slayer, row, col, 208, 176)
                .filter(|(_, _, px)| px[3] > 24)
                .count();
            assert!(
                opaque > 150,
                "expected non-empty slayer cell for {label} ({row},{col}), got {opaque} opaque px"
            );
        }

        // Verify reference appearance (white spiky hair, cream vest, grey pants, no legacy royal-blue coat/pants).
        for &(row, col, label) in &[(0, 0, "idle"), (1, 0, "run"), (12, 0, "town_walk")] {
            let mut royal_blue = 0usize;
            let mut bright_hair = 0usize;
            let mut min_y = 176u32;
            for (_dx, dy, px) in cell_pixels(slayer, row, col, 208, 176) {
                let a = px[3];
                if a < 128 {
                    continue;
                }
                min_y = min_y.min(dy);
                // Unpremultiply for color checks
                let r = (u16::from(px[0]) * 255 / u16::from(a)).min(255) as u8;
                let g = (u16::from(px[1]) * 255 / u16::from(a)).min(255) as u8;
                let b = (u16::from(px[2]) * 255 / u16::from(a)).min(255) as u8;
                if b > 120 && b > r.saturating_add(40) && b > g.saturating_add(20) {
                    royal_blue += 1;
                }
                if (55..95).contains(&dy) && r >= 200 && g >= 195 && b >= 175 {
                    bright_hair += 1;
                }
            }
            assert!(
                royal_blue <= 5,
                "{label} still has {royal_blue} legacy royal-blue avatar pixels"
            );
            assert!(
                bright_hair >= 15,
                "{label} missing bright ivory/white hair pixels (got {bright_hair})"
            );
            if matches!(label, "idle" | "town_walk") {
                assert!(
                    min_y >= 73,
                    "{label} hair silhouette extends too high (min_y={min_y}, expected >= 73 for classic spiky hair without rooster-comb crest)"
                );
            }
        }

        // Verify raging_slayer preserves exact dimensions and alpha mask with red tint.
        let raging = store
            .raging_slayer
            .as_ref()
            .expect("raging_slayer derived sheet");
        assert_eq!((raging.width(), raging.height()), (13312, 2640));
        for &(row, col) in &[(0, 0), (1, 0), (12, 0)] {
            let mut sum_r = 0u64;
            let mut sum_g = 0u64;
            let mut sum_b = 0u64;
            for ((_, _, s), (_, _, d)) in
                cell_pixels(slayer, row, col, 208, 176).zip(cell_pixels(raging, row, col, 208, 176))
            {
                assert_eq!(s[3], d[3], "raging_slayer alpha mismatch");
                if d[3] > 64 {
                    sum_r += u64::from(d[0]);
                    sum_g += u64::from(d[1]);
                    sum_b += u64::from(d[2]);
                }
            }
            assert!(
                sum_r > sum_g * 2 && sum_r > sum_b * 2,
                "raging_slayer cell ({row},{col}) not strongly red-tinted: R={sum_r} G={sum_g} B={sum_b}"
            );
        }

        // Verify native normalWaveBody also matches reference appearance.
        let wave_body = store
            .get("normalWaveBody")
            .expect("normal-wave-body.png loaded");
        assert_eq!((wave_body.width(), wave_body.height()), (9 * 384, 320));
        let wave_opaque = cell_pixels(wave_body, 0, 0, 384, 320)
            .filter(|(_, _, px)| px[3] > 24)
            .count();
        assert!(wave_opaque > 500, "normalWaveBody frame 0 empty");
    }
}
