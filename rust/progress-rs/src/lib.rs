//! Cross-run progression: gold, inventory, equipment, quests, cleared stages (`src/progress.js`).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
pub const STORAGE_KEY: &str = "nano-dnf.progress.v1";

pub const EQUIP_SLOTS: [&str; 10] = [
    "weapon", "top", "bottom", "shoulder", "belt", "shoes", "necklace", "bracelet", "ring",
    "support",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemCategory {
    Consumable,
    Material,
    Equipment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub category: ItemCategory,
    pub price: u32,
    pub hp: u32,
    pub mp: u32,
    pub slot: Option<&'static str>,
    pub min_level: Option<u32>,
    pub jobs: &'static [&'static str],
    pub icon: Option<&'static str>,
    pub note: &'static str,
}

pub const ITEMS: [ItemSpec; 9] = [
    ItemSpec {
        id: "hpPotion",
        name: "HP 药水",
        category: ItemCategory::Consumable,
        price: 30,
        hp: 40,
        mp: 0,
        slot: None,
        min_level: None,
        jobs: &[],
        icon: None,
        note: "回复 40 点生命",
    },
    ItemSpec {
        id: "mpPotion",
        name: "MP 药水",
        category: ItemCategory::Consumable,
        price: 30,
        hp: 0,
        mp: 40,
        slot: None,
        min_level: None,
        jobs: &[],
        icon: None,
        note: "回复 40 点法力",
    },
    ItemSpec {
        id: "material",
        name: "下级硬化剂",
        category: ItemCategory::Material,
        price: 12,
        hp: 0,
        mp: 0,
        slot: None,
        min_level: None,
        jobs: &[],
        icon: None,
        note: "铁匠分解与商店回收的材料",
    },
    ItemSpec {
        id: "starterBlade",
        name: "生锈的铁剑",
        category: ItemCategory::Equipment,
        price: 120,
        hp: 0,
        mp: 0,
        slot: Some("weapon"),
        min_level: None,
        jobs: &[],
        icon: None,
        note: "主线奖励；本片装备加成为 0",
    },
    ItemSpec {
        id: "rustyBlade",
        name: "锈蚀短剑",
        category: ItemCategory::Equipment,
        price: 90,
        hp: 0,
        mp: 0,
        slot: Some("weapon"),
        min_level: None,
        jobs: &[],
        icon: None,
        note: "精英掉落；本片装备加成为 0",
    },
    ItemSpec {
        id: "clothArmor",
        name: "粗布上衣",
        category: ItemCategory::Equipment,
        price: 80,
        hp: 0,
        mp: 0,
        slot: Some("top"),
        min_level: None,
        jobs: &[],
        icon: None,
        note: "精英掉落；本片装备加成为 0",
    },
    ItemSpec {
        id: "ancientStaff",
        name: "古老的法杖",
        category: ItemCategory::Equipment,
        price: 2100,
        hp: 0,
        mp: 0,
        slot: Some("weapon"),
        min_level: Some(3),
        jobs: &["mage", "at mage", "creator mage"],
        icon: Some("staffIcon"),
        note: "魔法师武器",
    },
    ItemSpec {
        id: "kunicTotem",
        name: "古老的库尼族图腾",
        category: ItemCategory::Equipment,
        price: 3500,
        hp: 0,
        mp: 0,
        slot: Some("weapon"),
        min_level: Some(5),
        jobs: &["priest"],
        icon: Some("totemIcon"),
        note: "圣职者武器",
    },
    ItemSpec {
        id: "copperRing",
        name: "铜戒指",
        category: ItemCategory::Equipment,
        price: 70,
        hp: 0,
        mp: 0,
        slot: Some("ring"),
        min_level: None,
        jobs: &[],
        icon: None,
        note: "精英掉落；本片装备加成为 0",
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestKind {
    Clear,
    Kill,
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestReward {
    pub gold: u32,
    pub item: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuestSpec {
    pub id: &'static str,
    pub title: &'static str,
    pub npc: &'static str,
    pub kind: QuestKind,
    pub stage: Option<&'static str>,
    pub target: Option<&'static str>,
    pub goal: u32,
    pub reward: QuestReward,
}

pub const QUESTS: [QuestSpec; 3] = [
    QuestSpec {
        id: "main",
        title: "通关幽暗密林深处",
        npc: "seria",
        kind: QuestKind::Clear,
        stage: Some("mirkwooddeep"),
        target: None,
        goal: 1,
        reward: QuestReward {
            gold: 500,
            item: Some("starterBlade"),
        },
    },
    QuestSpec {
        id: "cats",
        title: "击杀 10 只猫妖",
        npc: "minet",
        kind: QuestKind::Kill,
        stage: None,
        target: Some("cat"),
        goal: 10,
        reward: QuestReward {
            gold: 200,
            item: Some("hpPotion"),
        },
    },
    QuestSpec {
        id: "breakables",
        title: "打碎 5 个木桶/宝箱",
        npc: "gsd",
        kind: QuestKind::Break,
        stage: None,
        target: None,
        goal: 5,
        reward: QuestReward {
            gold: 200,
            item: Some("mpPotion"),
        },
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestState {
    Available,
    Active,
    TurnedIn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestProgress {
    pub state: QuestState,
    pub progress: u32,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressProfile {
    pub version: u32,
    pub gold: u32,
    pub items: IndexMap<String, u32>,
    pub equipment: IndexMap<String, Option<String>>,
    pub quests: IndexMap<String, QuestProgress>,
    pub cleared: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UseItemEffect {
    pub hp: u32,
    pub mp: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SalvageResult {
    pub material: u32,
    pub gold: u32,
}

pub fn item_spec(id: &str) -> Option<&'static ItemSpec> {
    ITEMS.iter().find(|item| item.id == id)
}

pub fn quest_spec(id: &str) -> Option<&'static QuestSpec> {
    QUESTS.iter().find(|q| q.id == id)
}

pub fn defaults() -> ProgressProfile {
    let mut items = IndexMap::new();
    items.insert("hpPotion".to_string(), 0);
    items.insert("mpPotion".to_string(), 0);
    items.insert("material".to_string(), 0);

    let mut equipment = IndexMap::new();
    for slot in EQUIP_SLOTS {
        equipment.insert(slot.to_string(), None);
    }

    let mut quests = IndexMap::new();
    for q in QUESTS {
        quests.insert(
            q.id.to_string(),
            QuestProgress {
                state: QuestState::Available,
                progress: 0,
                done: false,
            },
        );
    }

    ProgressProfile {
        version: VERSION,
        gold: 0,
        items,
        equipment,
        quests,
        cleared: Vec::new(),
    }
}

/// Merge raw JSON onto the current profile schema so old saves survive.
pub fn normalize(raw: Option<&serde_json::Value>) -> ProgressProfile {
    let mut out = defaults();
    let Some(obj) = raw.and_then(|v| v.as_object()) else {
        return out;
    };
    if let Some(gold) = obj.get("gold").and_then(|v| v.as_f64()) {
        if gold.is_finite() && gold >= 0.0 {
            out.gold = gold.floor() as u32;
        }
    }
    if let Some(raw_items) = obj.get("items").and_then(|v| v.as_object()) {
        for spec in ITEMS {
            if let Some(cnt) = raw_items.get(spec.id).and_then(|v| v.as_f64()) {
                if cnt.is_finite() && cnt >= 0.0 {
                    out.items.insert(spec.id.to_string(), cnt.floor() as u32);
                }
            }
        }
    }
    if let Some(raw_eq) = obj.get("equipment").and_then(|v| v.as_object()) {
        for slot in EQUIP_SLOTS {
            if let Some(item_id) = raw_eq.get(slot).and_then(|v| v.as_str()) {
                if let Some(spec) = item_spec(item_id) {
                    if spec.category == ItemCategory::Equipment && spec.slot == Some(slot) {
                        out.equipment
                            .insert(slot.to_string(), Some(item_id.to_string()));
                    }
                }
            }
        }
    }
    if let Some(raw_quests) = obj.get("quests").and_then(|v| v.as_object()) {
        for spec in QUESTS {
            let Some(q) = raw_quests.get(spec.id).and_then(|v| v.as_object()) else {
                continue;
            };
            let state = match q.get("state").and_then(|v| v.as_str()) {
                Some("active") => QuestState::Active,
                Some("turnedIn") => QuestState::TurnedIn,
                _ => QuestState::Available,
            };
            let progress = q
                .get("progress")
                .and_then(|v| v.as_f64())
                .filter(|n| n.is_finite() && *n >= 0.0)
                .map(|n| (n as u32).min(spec.goal))
                .unwrap_or(0);
            let done = q.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            out.quests.insert(
                spec.id.to_string(),
                QuestProgress {
                    state,
                    progress,
                    done,
                },
            );
        }
    }
    if let Some(cleared) = obj.get("cleared").and_then(|v| v.as_array()) {
        out.cleared = cleared
            .iter()
            .filter_map(|v| v.as_str().map(ToString::to_string))
            .collect();
    }
    out.version = VERSION;
    out
}

pub fn deserialize(text: &str) -> ProgressProfile {
    if text.is_empty() {
        return defaults();
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(val) => normalize(Some(&val)),
        Err(_) => defaults(),
    }
}

pub fn serialize(profile: &ProgressProfile) -> String {
    serde_json::to_string(profile).unwrap_or_else(|_| "{}".to_string())
}

pub fn add_gold(profile: &mut ProgressProfile, amount: i64) {
    let next = (i64::from(profile.gold) + amount).max(0);
    profile.gold = next.min(i64::from(u32::MAX)) as u32;
}

pub fn add_item(profile: &mut ProgressProfile, id: &str, count: u32) -> bool {
    if item_spec(id).is_none() {
        return false;
    }
    let amount = count.max(1);
    let current = profile.items.get(id).copied().unwrap_or(0);
    profile
        .items
        .insert(id.to_string(), current.saturating_add(amount));
    true
}

pub fn use_item(profile: &mut ProgressProfile, id: &str) -> Option<UseItemEffect> {
    let spec = item_spec(id)?;
    if spec.category != ItemCategory::Consumable {
        return None;
    }
    let count = profile.items.get(id).copied().unwrap_or(0);
    if count == 0 {
        return None;
    }
    profile.items.insert(id.to_string(), count - 1);
    Some(UseItemEffect {
        hp: spec.hp,
        mp: spec.mp,
    })
}

pub fn can_equip(profile: &ProgressProfile, id: &str, job: &str, level: u32) -> bool {
    let Some(spec) = item_spec(id) else {
        return false;
    };
    if spec.category != ItemCategory::Equipment || spec.slot.is_none() {
        return false;
    }
    if profile.items.get(id).copied().unwrap_or(0) == 0 {
        return false;
    }
    if !spec.jobs.is_empty() && !spec.jobs.contains(&job) {
        return false;
    }
    spec.min_level.is_none_or(|min| level >= min)
}

pub fn equip(profile: &mut ProgressProfile, id: &str, job: &str, level: u32) -> bool {
    if !can_equip(profile, id, job, level) {
        return false;
    }
    let Some(spec) = item_spec(id) else {
        return false;
    };
    let Some(slot) = spec.slot else {
        return false;
    };
    let next_count = profile
        .items
        .get(id)
        .copied()
        .unwrap_or(0)
        .saturating_sub(1);
    if next_count == 0 {
        profile.items.shift_remove(id);
    } else {
        profile.items.insert(id.to_string(), next_count);
    }
    let old = profile.equipment.get(slot).and_then(|v| v.clone());
    profile
        .equipment
        .insert(slot.to_string(), Some(id.to_string()));
    if let Some(old_id) = old {
        add_item(profile, &old_id, 1);
    }
    true
}

pub fn salvage(profile: &mut ProgressProfile, id: &str) -> Option<SalvageResult> {
    let spec = item_spec(id)?;
    if spec.category != ItemCategory::Equipment {
        return None;
    }
    let count = profile.items.get(id).copied().unwrap_or(0);
    if count == 0 {
        return None;
    }
    if count == 1 {
        profile.items.shift_remove(id);
    } else {
        profile.items.insert(id.to_string(), count - 1);
    }
    add_item(profile, "material", 2);
    let gold = ((f64::from(spec.price) * 0.4) + 0.5).floor() as u32;
    add_gold(profile, i64::from(gold));
    Some(SalvageResult { material: 2, gold })
}

pub fn accept(profile: &mut ProgressProfile, id: &str) -> bool {
    let Some(q) = profile.quests.get_mut(id) else {
        return false;
    };
    if q.state != QuestState::Available {
        return false;
    }
    q.state = QuestState::Active;
    true
}

pub fn note_kill(profile: &mut ProgressProfile, target: &str, count: u32) {
    for spec in QUESTS {
        if spec.kind != QuestKind::Kill || spec.target != Some(target) {
            continue;
        }
        if let Some(q) = profile.quests.get_mut(spec.id) {
            if q.state == QuestState::Active {
                q.progress = (q.progress + count).min(spec.goal);
                q.done = q.progress >= spec.goal;
            }
        }
    }
}

pub fn note_break(profile: &mut ProgressProfile, count: u32) {
    for spec in QUESTS {
        if spec.kind != QuestKind::Break {
            continue;
        }
        if let Some(q) = profile.quests.get_mut(spec.id) {
            if q.state == QuestState::Active {
                q.progress = (q.progress + count).min(spec.goal);
                q.done = q.progress >= spec.goal;
            }
        }
    }
}

pub fn note_clear(profile: &mut ProgressProfile, stage_id: &str) {
    if !stage_id.is_empty() && !profile.cleared.iter().any(|s| s == stage_id) {
        profile.cleared.push(stage_id.to_string());
    }
    for spec in QUESTS {
        if spec.kind != QuestKind::Clear {
            continue;
        }
        if let Some(req_stage) = spec.stage {
            if req_stage != stage_id {
                continue;
            }
        }
        if let Some(q) = profile.quests.get_mut(spec.id) {
            if q.state == QuestState::Active {
                q.progress = spec.goal;
                q.done = true;
            }
        }
    }
}

pub fn turn_in(profile: &mut ProgressProfile, id: &str) -> Option<QuestReward> {
    let spec = quest_spec(id)?;
    let q = profile.quests.get_mut(id)?;
    if q.state != QuestState::Active || !q.done {
        return None;
    }
    q.state = QuestState::TurnedIn;
    add_gold(profile, i64::from(spec.reward.gold));
    if let Some(item_id) = spec.reward.item {
        add_item(profile, item_id, 1);
    }
    Some(spec.reward)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_equip_swap_and_job_restriction() {
        let mut p = defaults();
        assert!(add_item(&mut p, "starterBlade", 1));
        assert!(add_item(&mut p, "rustyBlade", 1));
        assert!(add_item(&mut p, "ancientStaff", 1));

        assert!(!can_equip(&p, "ancientStaff", "swordman", 5));
        assert!(equip(&mut p, "starterBlade", "swordman", 1));
        assert_eq!(
            p.equipment.get("weapon").and_then(|v| v.as_deref()),
            Some("starterBlade")
        );
        assert!(equip(&mut p, "rustyBlade", "swordman", 1));
        assert_eq!(p.items.get("starterBlade").copied(), Some(1));
    }

    #[test]
    fn test_quest_lifecycle() {
        let mut p = defaults();
        assert!(accept(&mut p, "cats"));
        note_kill(&mut p, "cat", 10);
        let reward = turn_in(&mut p, "cats");
        assert_eq!(reward.map(|r| r.gold), Some(200));
        assert_eq!(p.gold, 200);
        assert_eq!(p.items.get("hpPotion").copied(), Some(1));
    }
}
