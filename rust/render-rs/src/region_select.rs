//! Classic 60/70 《阿拉德大陆》 Gran Floris dungeon selection screen (`meta.region_open`).
//!
//! Layout coordinates are defined in native 800x600 pixels (matching `00002-幽暗密林深处.mp4` @ 5s)
//! and mapped to the canvas logical coordinate space (`VIEW_LEFT..VIEW_LEFT+VIEW_WIDTH`,
//! `0..ARENA_HEIGHT`) via `NATIVE_TO_LOGICAL = 0.9` so every sprite lands 1:1 on native pixels.

use crate::canvas::{Canvas, Rgba, TextAlign};
use crate::hud_classic::{native_x, native_y, NATIVE_TO_LOGICAL};
use crate::sprites::SpriteStore;
use core_rs::constants::VIEW_LEFT;

#[inline]
fn native_w(nw: f32) -> f32 {
    nw * NATIVE_TO_LOGICAL
}

#[inline]
fn native_h(nh: f32) -> f32 {
    nh * NATIVE_TO_LOGICAL
}

/// Interactive actions returned by [`hit_test_region_select`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionSelectAction {
    SelectStage(&'static str),
    EnterDungeon,
    ReturnTown,
    ToggleAbyss,
}

/// Metadata & native 800x600 layout for one Gran Floris dungeon card on the Arad parchment map.
#[derive(Debug, Clone, Copy)]
pub struct RegionCardDef {
    pub id: &'static str,
    pub name: &'static str,
    /// Card slot index in `assets/region.png` (5 columns x 2 rows, 168x73 each).
    pub slot: u32,
    pub playable: bool,
    pub level_text: &'static str,
    pub lore: &'static str,
    /// Crossed-sword node center in native 800x600 pixels.
    pub node_x: f32,
    pub node_y: f32,
    /// Unselected card rect `[x, y, w, h]` in native 800x600 pixels.
    pub rect: [f32; 4],
    /// Selected (enlarged) card rect `[x, y, w, h]` in native 800x600 pixels.
    pub selected_rect: [f32; 4],
}

/// All 6 Gran Floris dungeon cards on the classic 60/70 Arad parchment map.
///
/// Slot indices match `assets/region.png` (`sprite/worldmap/selectdungeonslot/granfloris.img`):
/// - slot 0: 幽暗密林 (playable)
/// - slot 1: 幽暗密林深处 (playable)
/// - slot 3: 雷鸣废墟 (locked/greyed preview)
/// - slot 4: 猛毒雷鸣废墟 (locked/greyed preview)
/// - slot 5: 格拉卡 (locked/greyed preview)
/// - slot 6: 烈焰格拉卡 (locked/greyed preview)
pub const REGION_CARDS: [RegionCardDef; 6] = [
    RegionCardDef {
        id: "mirkwood",
        name: "幽暗密林",
        slot: 0,
        playable: true,
        level_text: "推荐等级：Lv.1~4",
        lore: "午夜，诡谲的怪声从密林传出，惊醒了睡梦中的赫顿玛尔居民。这座被黑暗笼罩的丛林，为什么会传出牛头巨兽的厉嚎？初级勇士们，考验你实力的时候到了！",
        node_x: 213.0,
        node_y: 344.0,
        rect: [136.0, 408.0, 146.0, 64.0],
        selected_rect: [102.0, 410.0, 208.0, 90.0],
    },
    RegionCardDef {
        id: "mirkwooddeep",
        name: "幽暗密林深处",
        slot: 1,
        playable: true,
        level_text: "推荐等级：Lv.6~9",
        lore: "阵阵凄厉的悲叫从幽暗密林深处传来，那是勇士的悲吼，还是悲鸣草的凄鸣？凶恶的猫妖隐在密林深处，势无忌惮的袭击路过的赫顿玛尔居民。勇敢的你，作好抵抗它们的准备了吗？",
        node_x: 164.0,
        node_y: 376.0,
        rect: [48.0, 257.0, 146.0, 64.0],
        selected_rect: [8.0, 232.0, 208.0, 90.0],
    },
    RegionCardDef {
        id: "sunderland",
        name: "雷鸣废墟",
        slot: 3,
        playable: false,
        level_text: "推荐等级：Lv.9~12",
        lore: "闪电不断劈落在这片焦黑的废墟之中，疯狂的落雷凯诺召唤着雷电守护着领地。",
        node_x: 286.0,
        node_y: 298.0,
        rect: [338.0, 336.0, 146.0, 64.0],
        selected_rect: [338.0, 336.0, 146.0, 64.0],
    },
    RegionCardDef {
        id: "sunderlandpoison",
        name: "猛毒雷鸣废墟",
        slot: 4,
        playable: false,
        level_text: "推荐等级：Lv.11~14",
        lore: "剧毒的瘴气弥漫在废墟深处，毒猫王带领着中毒的魔物潜伏在浓雾之中。",
        node_x: 374.0,
        node_y: 286.0,
        rect: [434.0, 227.0, 146.0, 64.0],
        selected_rect: [434.0, 227.0, 146.0, 64.0],
    },
    RegionCardDef {
        id: "grakkarak",
        name: "格拉卡",
        slot: 5,
        playable: false,
        level_text: "推荐等级：Lv.13~16",
        lore: "牛头械王的先祖盘踞在这座古老的丛林祭坛，咆哮声震慑着整片格兰之森。",
        node_x: 392.0,
        node_y: 232.0,
        rect: [447.0, 123.0, 146.0, 64.0],
        selected_rect: [447.0, 123.0, 146.0, 64.0],
    },
    RegionCardDef {
        id: "grakkarakburning",
        name: "烈焰格拉卡",
        slot: 6,
        playable: false,
        level_text: "推荐等级：Lv.15~18",
        lore: "大火吞噬了格拉卡的林地，烈焰彼诺修在熊熊火海中等待着敢于挑战的勇士。",
        node_x: 293.0,
        node_y: 238.0,
        rect: [248.0, 108.0, 146.0, 64.0],
        selected_rect: [248.0, 108.0, 146.0, 64.0],
    },
];

/// Native 800x600 hit rect for `开启深渊模式` toggle.
pub const ABYSS_BTN_RECT: [f32; 4] = [590.0, 428.0, 168.0, 28.0];
/// Native 800x600 hit rect for `前往地下城`.
pub const ENTER_BTN_RECT: [f32; 4] = [532.0, 472.0, 200.0, 38.0];
/// Native 800x600 hit rect for `返回城镇`.
pub const RETURN_BTN_RECT: [f32; 4] = [532.0, 514.0, 134.0, 35.0];

// Sprite source rects inside `assets/worldmap-arad.png` (800x720)
const SRC_MAP: [u32; 4] = [0, 0, 800, 600];
const SRC_ENTER_NORM: [u32; 4] = [0, 600, 162, 30];
const SRC_ENTER_HOVER: [u32; 4] = [164, 600, 162, 30];
const SRC_ENTER_GLOW: [u32; 4] = [328, 600, 178, 41];
const SRC_RETURN_NORM: [u32; 4] = [508, 600, 108, 28];
const SRC_RETURN_HOVER: [u32; 4] = [618, 600, 108, 28];
const SRC_RETURN_GLOW: [u32; 4] = [0, 644, 121, 38];
const SRC_ARROW_LEFT: [u32; 4] = [128, 644, 22, 14];
const SRC_ARROW_RIGHT: [u32; 4] = [176, 644, 22, 14];
const SRC_SWORD_NORM: [u32; 4] = [228, 644, 30, 30];
const SRC_SWORD_SEL: [u32; 4] = [262, 644, 30, 30];

const CARD_SRC_W: u32 = 168;
const CARD_SRC_H: u32 = 73;
const CARD_SHEET_COLS: u32 = 5;

#[inline]
fn point_in_rect(px: f32, py: f32, r: [f32; 4]) -> bool {
    px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3]
}

/// Convert logical view coordinates `(ax, ay)` to native 800x600 coordinates.
#[inline]
pub fn view_to_native(ax: f32, ay: f32) -> (f32, f32) {
    (
        (ax - VIEW_LEFT as f32) / NATIVE_TO_LOGICAL,
        ay / NATIVE_TO_LOGICAL,
    )
}

/// Hit-test the region select screen in logical view coordinates `(ax, ay)`.
pub fn hit_test_region_select(selected: &str, ax: f32, ay: f32) -> Option<RegionSelectAction> {
    let (nx, ny) = view_to_native(ax, ay);

    if point_in_rect(nx, ny, ENTER_BTN_RECT) {
        return Some(RegionSelectAction::EnterDungeon);
    }
    if point_in_rect(nx, ny, RETURN_BTN_RECT) {
        return Some(RegionSelectAction::ReturnTown);
    }
    if point_in_rect(nx, ny, ABYSS_BTN_RECT) {
        return Some(RegionSelectAction::ToggleAbyss);
    }

    // Check currently selected playable card first (enlarged rect sits on top).
    for card in &REGION_CARDS {
        if card.playable && card.id == selected && point_in_rect(nx, ny, card.selected_rect) {
            return Some(RegionSelectAction::SelectStage(card.id));
        }
    }

    // Check other playable cards and crossed-sword nodes.
    for card in &REGION_CARDS {
        if !card.playable {
            continue;
        }
        let r = if card.id == selected {
            card.selected_rect
        } else {
            card.rect
        };
        if point_in_rect(nx, ny, r) {
            return Some(RegionSelectAction::SelectStage(card.id));
        }
        let dx = nx - card.node_x;
        let dy = ny - card.node_y;
        if dx * dx + dy * dy <= 18.0 * 18.0 {
            return Some(RegionSelectAction::SelectStage(card.id));
        }
    }

    None
}

/// Draw the classic 60/70 《阿拉德大陆》 Gran Floris dungeon selection screen at native 800x600.
pub fn draw_region_select(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    selected: &str,
    hover: Option<RegionSelectAction>,
    abyss_mode: bool,
) {
    let worldmap = sprites.get("worldmapArad");

    // 1. Parchment 《阿拉德大陆》 full-screen 800x600 background
    if let Some(wm) = worldmap {
        c.draw_image(
            wm,
            SRC_MAP[0],
            SRC_MAP[1],
            SRC_MAP[2],
            SRC_MAP[3],
            native_x(0.0),
            native_y(0.0),
            native_w(800.0),
            native_h(600.0),
            false,
            1.0,
            0.0,
        );
    } else {
        // Fallback parchment when running unit tests without loaded textures
        c.fill_rect(
            native_x(0.0),
            native_y(0.0),
            native_w(800.0),
            native_h(600.0),
            Rgba::new(224, 178, 108, 255),
        );
        c.fill_rect(
            native_x(0.0),
            native_y(0.0),
            native_w(800.0),
            native_h(26.0),
            Rgba::new(66, 44, 32, 255),
        );
        c.fill_rect(
            native_x(0.0),
            native_y(572.0),
            native_w(800.0),
            native_h(28.0),
            Rgba::new(66, 44, 32, 255),
        );
        c.fill_text(
            "阿拉德大陆",
            native_x(140.0),
            native_y(84.0),
            native_w(32.0),
            Rgba::new(72, 34, 18, 255),
            TextAlign::Center,
            None,
        );
    }

    // 2. Callout pointers from each card to its crossed-sword map node
    for card in &REGION_CARDS {
        let is_sel = card.playable && card.id == selected;
        let rect = if is_sel {
            card.selected_rect
        } else {
            card.rect
        };
        draw_callout_pointer(c, rect, card.node_x, card.node_y);
    }

    // 3. Six crossed-sword dungeon nodes on the map
    for card in &REGION_CARDS {
        let is_sel = card.playable && card.id == selected;
        draw_sword_node(c, worldmap, card.node_x, card.node_y, is_sel);
    }

    // 4. Unselected cards first (playable + locked/greyed preview)
    for card in &REGION_CARDS {
        if card.playable && card.id == selected {
            continue;
        }
        let is_hovered = card.playable && hover == Some(RegionSelectAction::SelectStage(card.id));
        draw_dungeon_card(c, sprites, worldmap, card, false, is_hovered);
    }

    // 5. Selected card on top with warm golden glow + difficulty `< >` capsule
    if let Some(sel_card) = REGION_CARDS
        .iter()
        .find(|card| card.playable && card.id == selected)
        .or_else(|| Some(&REGION_CARDS[0]))
    {
        draw_dungeon_card(c, sprites, worldmap, sel_card, true, false);
        draw_tooltip_box(c, sel_card);
    }

    // 6. Bottom-right controls: 开启深渊模式, 前往地下城, 返回城镇
    draw_abyss_toggle(
        c,
        abyss_mode,
        hover == Some(RegionSelectAction::ToggleAbyss),
    );
    draw_enter_button(c, worldmap, hover == Some(RegionSelectAction::EnterDungeon));
    draw_return_button(c, worldmap, hover == Some(RegionSelectAction::ReturnTown));
}

fn draw_callout_pointer(c: &mut Canvas<'_>, rect: [f32; 4], node_x: f32, node_y: f32) {
    // Anchor on the edge of the card closest to (node_x, node_y)
    let ax = node_x.clamp(rect[0] + 10.0, rect[0] + rect[2] - 10.0);
    let ay = node_y.clamp(rect[1] + 8.0, rect[1] + rect[3] - 8.0);
    let dx = node_x - ax;
    let dy = node_y - ay;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 6.0 {
        return;
    }
    let ux = dx / len;
    let uy = dy / len;
    // Tip stops ~14px before node center so it points cleanly at the crossed swords
    let tip_dist = (len - 14.0).max(4.0);
    let tip_x = ax + ux * tip_dist;
    let tip_y = ay + uy * tip_dist;
    let px = -uy * 5.0;
    let py = ux * 5.0;
    let pts = [
        (native_x(ax - px), native_y(ay - py)),
        (native_x(ax + px), native_y(ay + py)),
        (native_x(tip_x), native_y(tip_y)),
    ];
    c.fill_polygon(&pts, Rgba::new(16, 12, 10, 232));
}

fn draw_sword_node(
    c: &mut Canvas<'_>,
    worldmap: Option<&tiny_skia::Pixmap>,
    nx: f32,
    ny: f32,
    selected: bool,
) {
    if selected {
        c.fill_ellipse(
            native_x(nx),
            native_y(ny),
            native_w(16.0),
            native_h(16.0),
            Rgba::new(255, 115, 24, 96),
        );
        c.fill_ellipse(
            native_x(nx),
            native_y(ny),
            native_w(11.0),
            native_h(11.0),
            Rgba::new(255, 195, 72, 130),
        );
    }
    if let Some(wm) = worldmap {
        let src = if selected {
            SRC_SWORD_SEL
        } else {
            SRC_SWORD_NORM
        };
        c.draw_image(
            wm,
            src[0],
            src[1],
            src[2],
            src[3],
            native_x(nx - 15.0),
            native_y(ny - 15.0),
            native_w(30.0),
            native_h(30.0),
            false,
            1.0,
            0.0,
        );
    } else {
        let col = if selected {
            Rgba::new(255, 110, 28, 255)
        } else {
            Rgba::new(195, 200, 210, 255)
        };
        c.fill_ellipse(
            native_x(nx),
            native_y(ny),
            native_w(9.0),
            native_h(9.0),
            col,
        );
    }
}

fn draw_dungeon_card(
    c: &mut Canvas<'_>,
    sprites: &SpriteStore,
    worldmap: Option<&tiny_skia::Pixmap>,
    card: &RegionCardDef,
    selected: bool,
    hovered: bool,
) {
    let rect = if selected {
        card.selected_rect
    } else {
        card.rect
    };
    let x = native_x(rect[0]);
    let y = native_y(rect[1]);
    let w = native_w(rect[2]);
    let h = native_h(rect[3]);

    if selected {
        // Warm golden-white outer glow matching classic 60/70 selected dungeon card
        c.fill_round_rect(
            x - native_w(6.0),
            y - native_h(6.0),
            w + native_w(12.0),
            h + native_h(12.0),
            native_w(10.0),
            Rgba::new(255, 226, 132, 72),
        );
        c.fill_round_rect(
            x - native_w(3.0),
            y - native_h(3.0),
            w + native_w(6.0),
            h + native_h(6.0),
            native_w(7.0),
            Rgba::new(255, 244, 194, 145),
        );
    } else if hovered {
        c.fill_round_rect(
            x - native_w(3.0),
            y - native_h(3.0),
            w + native_w(6.0),
            h + native_h(6.0),
            native_w(6.0),
            Rgba::new(255, 224, 128, 95),
        );
    }

    // Card art from `assets/region.png` (or `region_locked` greyscale sheet for locked previews)
    let sheet = if card.playable {
        sprites.get("region")
    } else {
        sprites
            .region_locked
            .as_ref()
            .or_else(|| sprites.get("region"))
    };

    if let Some(rsh) = sheet {
        let sx = (card.slot % CARD_SHEET_COLS) * CARD_SRC_W;
        let sy = (card.slot / CARD_SHEET_COLS) * CARD_SRC_H;
        c.draw_image(
            rsh,
            sx,
            sy,
            CARD_SRC_W,
            CARD_SRC_H,
            x,
            y,
            w,
            h,
            false,
            if card.playable { 1.0 } else { 0.88 },
            0.0,
        );
        if !card.playable && sprites.region_locked.is_none() {
            c.fill_round_rect(x, y, w, h, native_w(4.0), Rgba::new(40, 36, 32, 145));
        }
    } else {
        c.fill_round_rect(
            x,
            y,
            w,
            h,
            native_w(4.0),
            if card.playable {
                Rgba::new(30, 52, 42, 235)
            } else {
                Rgba::new(52, 50, 46, 215)
            },
        );
        c.fill_text(
            card.name,
            x + native_w(10.0),
            y + native_h(22.0),
            native_w(13.0),
            Rgba::new(240, 236, 220, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 220)),
        );
    }

    // Ornate dark-gold / bronze border
    let border_col = if selected {
        Rgba::new(252, 232, 162, 255)
    } else if hovered {
        Rgba::new(238, 204, 118, 240)
    } else if card.playable {
        Rgba::new(196, 174, 126, 225)
    } else {
        Rgba::new(98, 92, 82, 215)
    };
    c.stroke_round_rect(
        x,
        y,
        w,
        h,
        native_w(4.0),
        Rgba::new(18, 14, 10, 240),
        native_w(2.6),
    );
    c.stroke_round_rect(
        x + native_w(1.0),
        y + native_h(1.0),
        w - native_w(2.0),
        h - native_h(2.0),
        native_w(3.0),
        border_col,
        if selected {
            native_w(1.6)
        } else {
            native_w(1.1)
        },
    );

    // Ornate top-center crest notch matching DNF 60/70 card frame
    let crest_cx = rect[0] + rect[2] * 0.5;
    let crest_y = rect[1];
    let crest_pts = [
        (native_x(crest_cx - 8.0), native_y(crest_y + 1.0)),
        (native_x(crest_cx), native_y(crest_y - 4.0)),
        (native_x(crest_cx + 8.0), native_y(crest_y + 1.0)),
        (native_x(crest_cx), native_y(crest_y + 4.0)),
    ];
    c.fill_polygon(&crest_pts, border_col);

    // Difficulty `< >` capsule below the selected card
    if selected {
        let cap_w = 64.0f32;
        let cap_h = 18.0f32;
        let cap_x = rect[0] + (rect[2] - cap_w) * 0.5;
        let cap_y = rect[1] + rect[3] - 7.0;
        let lx = native_x(cap_x);
        let ly = native_y(cap_y);
        let lw = native_w(cap_w);
        let lh = native_h(cap_h);
        c.fill_round_rect(lx, ly, lw, lh, native_w(8.0), Rgba::new(34, 32, 30, 245));
        c.stroke_round_rect(
            lx,
            ly,
            lw,
            lh,
            native_w(8.0),
            Rgba::new(212, 194, 148, 240),
            native_w(1.3),
        );
        // Center divider
        c.draw_line(
            native_x(cap_x + cap_w * 0.5),
            native_y(cap_y + 2.0),
            native_x(cap_x + cap_w * 0.5),
            native_y(cap_y + cap_h - 2.0),
            Rgba::new(12, 10, 10, 235),
            native_w(1.5),
        );
        if let Some(wm) = worldmap {
            c.draw_image(
                wm,
                SRC_ARROW_LEFT[0],
                SRC_ARROW_LEFT[1],
                SRC_ARROW_LEFT[2],
                SRC_ARROW_LEFT[3],
                native_x(cap_x + 6.0),
                native_y(cap_y + 2.0),
                native_w(22.0),
                native_h(14.0),
                false,
                0.85,
                0.0,
            );
            c.draw_image(
                wm,
                SRC_ARROW_RIGHT[0],
                SRC_ARROW_RIGHT[1],
                SRC_ARROW_RIGHT[2],
                SRC_ARROW_RIGHT[3],
                native_x(cap_x + cap_w - 28.0),
                native_y(cap_y + 2.0),
                native_w(22.0),
                native_h(14.0),
                false,
                0.85,
                0.0,
            );
        }
    }
}

fn draw_tooltip_box(c: &mut Canvas<'_>, card: &RegionCardDef) {
    let tip_w = 314.0f32;
    let tip_h = 128.0f32;
    let sel = card.selected_rect;
    let tx = (sel[0] - 4.0).clamp(4.0, 800.0 - tip_w - 4.0);
    let ty = (sel[1] - tip_h - 4.0).max(98.0);

    let x = native_x(tx);
    let y = native_y(ty);
    let w = native_w(tip_w);
    let h = native_h(tip_h);

    // Dark translucent background panel
    c.fill_round_rect(x, y, w, h, native_w(4.0), Rgba::new(14, 11, 9, 214));
    // Darker header strip for `推荐等级`
    c.fill_rect(
        x + native_w(2.0),
        y + native_h(2.0),
        w - native_w(4.0),
        native_h(26.0),
        Rgba::new(8, 6, 5, 195),
    );
    // Ornate cream-gold top filigree border & thin frame
    c.stroke_round_rect(
        x,
        y,
        w,
        h,
        native_w(4.0),
        Rgba::new(208, 192, 146, 215),
        native_w(1.3),
    );
    c.draw_line(
        x + native_w(6.0),
        y + native_h(28.0),
        x + w - native_w(6.0),
        y + native_h(28.0),
        Rgba::new(150, 134, 96, 175),
        native_w(1.0),
    );

    // Recommended level header
    c.fill_text(
        card.level_text,
        native_x(tx + tip_w * 0.5),
        native_y(ty + 19.0),
        native_w(14.5),
        Rgba::new(248, 232, 174, 255),
        TextAlign::Center,
        Some(Rgba::new(0, 0, 0, 240)),
    );

    // Wrapped authentic DNF lore text (first line indented by 2 full-width spaces)
    let indented = format!("　　{}", card.lore);
    let lines = wrap_cjk_lines(&indented, 20);
    let mut ly = ty + 47.0;
    for line in lines.iter().take(5) {
        c.fill_text(
            line,
            native_x(tx + 12.0),
            native_y(ly),
            native_w(13.0),
            Rgba::new(244, 240, 230, 255),
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 245)),
        );
        ly += 17.5;
    }
}

fn wrap_cjk_lines(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut count = 0usize;
    for ch in text.chars() {
        cur.push(ch);
        count += 1;
        if count >= max_chars {
            lines.push(std::mem::take(&mut cur));
            count = 0;
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

fn draw_abyss_toggle(c: &mut Canvas<'_>, abyss_mode: bool, hovered: bool) {
    let cx = ABYSS_BTN_RECT[0] + 12.0;
    let cy = ABYSS_BTN_RECT[1] + 14.0;
    let r = 7.0f32;
    let outer = [
        (native_x(cx), native_y(cy - r - 1.5)),
        (native_x(cx + r + 1.5), native_y(cy)),
        (native_x(cx), native_y(cy + r + 1.5)),
        (native_x(cx - r - 1.5), native_y(cy)),
    ];
    let inner = [
        (native_x(cx), native_y(cy - r + 1.0)),
        (native_x(cx + r - 1.0), native_y(cy)),
        (native_x(cx), native_y(cy + r - 1.0)),
        (native_x(cx - r + 1.0), native_y(cy)),
    ];
    c.fill_polygon(&outer, Rgba::new(22, 18, 16, 245));
    let fill = if abyss_mode {
        Rgba::new(212, 92, 245, 255)
    } else if hovered {
        Rgba::new(186, 198, 224, 255)
    } else {
        Rgba::new(138, 146, 164, 255)
    };
    c.fill_polygon(&inner, fill);

    let text_col = if abyss_mode {
        Rgba::new(236, 162, 255, 255)
    } else if hovered {
        Rgba::new(250, 236, 186, 255)
    } else {
        Rgba::new(212, 218, 226, 255)
    };
    c.fill_text(
        "开启深渊模式",
        native_x(ABYSS_BTN_RECT[0] + 26.0),
        native_y(ABYSS_BTN_RECT[1] + 20.0),
        native_w(19.0),
        text_col,
        TextAlign::Left,
        Some(Rgba::new(10, 8, 8, 250)),
    );
}

fn draw_enter_button(c: &mut Canvas<'_>, worldmap: Option<&tiny_skia::Pixmap>, hovered: bool) {
    let r = ENTER_BTN_RECT;
    if let Some(wm) = worldmap {
        if hovered {
            c.draw_image(
                wm,
                SRC_ENTER_GLOW[0],
                SRC_ENTER_GLOW[1],
                SRC_ENTER_GLOW[2],
                SRC_ENTER_GLOW[3],
                native_x(r[0] - 9.0),
                native_y(r[1] - 6.0),
                native_w(r[2] + 18.0),
                native_h(r[3] + 12.0),
                false,
                0.75,
                0.0,
            );
        }
        let src = if hovered {
            SRC_ENTER_HOVER
        } else {
            SRC_ENTER_NORM
        };
        c.draw_image(
            wm,
            src[0],
            src[1],
            src[2],
            src[3],
            native_x(r[0]),
            native_y(r[1]),
            native_w(r[2]),
            native_h(r[3]),
            false,
            1.0,
            0.0,
        );
    } else {
        c.fill_text(
            "前往地下城",
            native_x(r[0] + 28.0),
            native_y(r[1] + 26.0),
            native_w(24.0),
            if hovered {
                Rgba::new(255, 240, 152, 255)
            } else {
                Rgba::new(236, 206, 128, 255)
            },
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 245)),
        );
    }
}

fn draw_return_button(c: &mut Canvas<'_>, worldmap: Option<&tiny_skia::Pixmap>, hovered: bool) {
    let r = RETURN_BTN_RECT;
    if let Some(wm) = worldmap {
        if hovered {
            c.draw_image(
                wm,
                SRC_RETURN_GLOW[0],
                SRC_RETURN_GLOW[1],
                SRC_RETURN_GLOW[2],
                SRC_RETURN_GLOW[3],
                native_x(r[0] - 8.0),
                native_y(r[1] - 5.0),
                native_w(r[2] + 16.0),
                native_h(r[3] + 10.0),
                false,
                0.75,
                0.0,
            );
        }
        let src = if hovered {
            SRC_RETURN_HOVER
        } else {
            SRC_RETURN_NORM
        };
        c.draw_image(
            wm,
            src[0],
            src[1],
            src[2],
            src[3],
            native_x(r[0]),
            native_y(r[1]),
            native_w(r[2]),
            native_h(r[3]),
            false,
            1.0,
            0.0,
        );
    } else {
        c.fill_text(
            "返回城镇",
            native_x(r[0] + 24.0),
            native_y(r[1] + 24.0),
            native_w(20.0),
            if hovered {
                Rgba::new(255, 240, 152, 255)
            } else {
                Rgba::new(230, 200, 126, 255)
            },
            TextAlign::Left,
            Some(Rgba::new(0, 0, 0, 245)),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::GlyphCache;
    use crate::{RENDER_HEIGHT, RENDER_WIDTH};
    use std::path::PathBuf;
    use tiny_skia::Pixmap;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
    }

    fn native_to_view(nx: f32, ny: f32) -> (f32, f32) {
        (native_x(nx), native_y(ny))
    }

    #[test]
    fn mirkwooddeep_uses_slot_1_not_frost_slot_2() {
        let deep = REGION_CARDS
            .iter()
            .find(|c| c.id == "mirkwooddeep")
            .expect("mirkwooddeep card defined");
        assert_eq!(
            deep.slot, 1,
            "mirkwooddeep must use slot 1 (幽暗密林深处), not slot 2 (冰霜幽暗密林)"
        );
        let mirk = REGION_CARDS
            .iter()
            .find(|c| c.id == "mirkwood")
            .expect("mirkwood card defined");
        assert_eq!(mirk.slot, 0);
        // Locked previews map to slots 3, 4, 5, 6
        let locked_slots: Vec<u32> = REGION_CARDS
            .iter()
            .filter(|c| !c.playable)
            .map(|c| c.slot)
            .collect();
        assert_eq!(locked_slots, vec![3, 4, 5, 6]);
    }

    #[test]
    fn hit_test_selects_playable_cards_and_buttons() {
        // Clicking mirkwood card while mirkwooddeep is selected selects mirkwood
        let (ax, ay) = native_to_view(200.0, 440.0);
        assert_eq!(
            hit_test_region_select("mirkwooddeep", ax, ay),
            Some(RegionSelectAction::SelectStage("mirkwood"))
        );

        // Clicking mirkwooddeep card while mirkwood is selected selects mirkwooddeep
        let (ax, ay) = native_to_view(110.0, 285.0);
        assert_eq!(
            hit_test_region_select("mirkwood", ax, ay),
            Some(RegionSelectAction::SelectStage("mirkwooddeep"))
        );

        // Clicking locked sunderland card returns None
        let (ax, ay) = native_to_view(410.0, 368.0);
        assert_eq!(hit_test_region_select("mirkwood", ax, ay), None);

        // Clicking 前往地下城 returns EnterDungeon
        let (ax, ay) = native_to_view(630.0, 490.0);
        assert_eq!(
            hit_test_region_select("mirkwood", ax, ay),
            Some(RegionSelectAction::EnterDungeon)
        );

        // Clicking 返回城镇 returns ReturnTown
        let (ax, ay) = native_to_view(600.0, 530.0);
        assert_eq!(
            hit_test_region_select("mirkwood", ax, ay),
            Some(RegionSelectAction::ReturnTown)
        );

        // Clicking 开启深渊模式 returns ToggleAbyss
        let (ax, ay) = native_to_view(660.0, 442.0);
        assert_eq!(
            hit_test_region_select("mirkwood", ax, ay),
            Some(RegionSelectAction::ToggleAbyss)
        );
    }

    #[test]
    fn renders_800x600_region_select_distinctly_for_both_playable_stages() {
        let sprites = SpriteStore::load_from_root(&repo_root());
        assert!(
            sprites.get("worldmapArad").is_some(),
            "assets/worldmap-arad.png must load into SpriteStore"
        );
        assert!(
            sprites.region_locked.is_some(),
            "greyscale region_locked sheet must be generated from assets/region.png"
        );

        let mut fonts = GlyphCache::new(None);
        let mut pix_mirk = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        {
            let mut canvas = Canvas::new(&mut pix_mirk, &mut fonts);
            draw_region_select(&mut canvas, &sprites, "mirkwood", None, false);
        }

        let mut pix_deep = Pixmap::new(RENDER_WIDTH, RENDER_HEIGHT).unwrap();
        {
            let mut canvas = Canvas::new(&mut pix_deep, &mut fonts);
            draw_region_select(&mut canvas, &sprites, "mirkwooddeep", None, false);
        }

        // Verify parchment warm tones are rendered (not dark blue overlay)
        // Sample clean parchment area near (700, 120)
        let idx = ((120 * RENDER_WIDTH + 700) * 4) as usize;
        let r = pix_mirk.data()[idx];
        let g = pix_mirk.data()[idx + 1];
        let b = pix_mirk.data()[idx + 2];
        assert!(
            r > 170 && g > 130 && r > b + 40,
            "expected warm parchment map background at (700,120), got RGB=({r},{g},{b})"
        );

        // Verify selecting mirkwood vs mirkwooddeep visually changes the frame
        let diff_pixels = pix_mirk
            .data()
            .chunks_exact(4)
            .zip(pix_deep.data().chunks_exact(4))
            .filter(|(a, b)| a != b)
            .count();
        assert!(
            diff_pixels > 20_000,
            "expected significant visual change when switching selected stage, got {diff_pixels} diff pixels"
        );
    }
}
