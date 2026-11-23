//! Onboarding hints selection (`src/hints.js`).

use core_rs::constants::{DEPTH_REACH_MELEE, SLAYER_HEIGHT};
use core_rs::types::State;
use std::collections::HashSet;

pub const LOW_HP_RATIO: f64 = 0.35;
pub const ROW_REACH: f64 = DEPTH_REACH_MELEE * SLAYER_HEIGHT;

#[derive(Debug, Clone, PartialEq)]
pub struct HintSelection {
    pub id: &'static str,
    pub text: &'static str,
    pub life: f64,
    pub priority: usize,
}

pub fn select(state: &State, seen: &HashSet<String>) -> Option<HintSelection> {
    let hints: [(&str, &str, f64, bool); 6] = [
        (
            "lowHp",
            "血量偏低：捡回血球，或先拉开距离",
            4.5,
            state.player.hp > 0.0 && state.player.hp <= state.player.max_hp * LOW_HP_RATIO,
        ),
        (
            "door",
            "清完房间门口会亮，走到那儿去下一间",
            5.0,
            state.room.as_ref().is_some_and(|r| r.cleared),
        ),
        (
            "firstBlood",
            "四段连击：X 连按四下，第四下是收招重击",
            4.0,
            state.stats.kills >= 1,
        ),
        (
            "row",
            "站到怪那一行才打得到它：↑ ↓ 走进 / 走出屏幕",
            5.0,
            {
                let alive: Vec<_> = state.enemies.iter().filter(|e| !e.dead).collect();
                state.player.attack_timer > 0.0
                    && !alive.is_empty()
                    && alive
                        .iter()
                        .all(|e| (e.z - state.player.z).abs() > ROW_REACH)
            },
        ),
        (
            "move",
            "← → ↑ ↓ 移动 · C 跳跃 · X 普攻",
            4.5,
            state.time > 1.5 && state.stats.kills == 0,
        ),
        (
            "awakening",
            "V 觉醒 · 魔狱血刹（身后背剑，再按落下）",
            4.5,
            state.time > 6.0
                && state.stats.kills >= 1
                && state.player.buffs.get("hellbenter").copied().unwrap_or(0.0) <= 0.0,
        ),
    ];

    for (priority, (id, text, life, cond)) in hints.into_iter().enumerate() {
        if seen.contains(id) {
            continue;
        }
        if cond {
            return Some(HintSelection {
                id,
                text,
                life,
                priority,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_rs::{create_state, types::CreateStateOptions};

    #[test]
    fn test_select_move_and_low_hp() {
        let mut s = create_state(&CreateStateOptions::default());
        let seen = HashSet::new();
        assert!(select(&s, &seen).is_none());
        s.time = 2.0;
        assert_eq!(select(&s, &seen).map(|h| h.id), Some("move"));
        s.player.hp = 50.0;
        assert_eq!(select(&s, &seen).map(|h| h.id), Some("lowHp"));
    }
}
