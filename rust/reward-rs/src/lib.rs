//! Post-clear 4-card reward state machine (`src/reward.js`).

use core_rs::constants::{DEFAULT_SEED, DEFAULT_STAGE};
use progress_rs::item_spec;
use serde::{Deserialize, Serialize};

pub const CARD_COUNT: usize = 4;

pub const TIME_STATS: f64 = 10.0;
pub const TIME_CHEST: f64 = 115.0 / 30.0;
pub const TIME_SPREAD: f64 = 1.2;
pub const TIME_FADE_START: f64 = 1.2;
pub const TIME_FLIP: f64 = 1.9;
pub const TIME_PROMPT: f64 = 2.0;
pub const TIME_COUNTDOWN_AT: f64 = 2.5;
pub const TIME_COUNTDOWN: f64 = 3.0;
pub const TIME_REVEAL: f64 = 3.0;
pub const TIME_FADE: f64 = 0.8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RewardPhase {
    Stats,
    Chest,
    Cards,
    Reveal,
    Fade,
    Done,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RewardState {
    pub seed: u32,
    pub stage: String,
    pub item_id: String,
    pub item: String,
    pub gold: u32,
    pub claimed: bool,
    pub phase: RewardPhase,
    pub t: f64,
    pub elapsed: f64,
    pub picked: Option<usize>,
    pub face_up: bool,
    pub countdown: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prize {
    pub item_id: String,
    pub gold: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RewardSnapshot {
    pub phase: RewardPhase,
    pub elapsed: f64,
    pub t: f64,
    pub opacity: f64,
    pub picked: Option<usize>,
    pub face_up: bool,
    pub countdown: u32,
    pub spread: f64,
    pub blue: f64,
    pub prompt_visible: bool,
    pub countdown_visible: bool,
    pub flash: f64,
    pub item: String,
    pub gold: u32,
    pub claimed: bool,
}

pub fn chest_duration(stage: &str) -> f64 {
    if stage == "mirkwooddeep" {
        66.0 / 30.0
    } else {
        TIME_CHEST
    }
}

pub fn create(seed: Option<u32>, stage: Option<&str>) -> Option<RewardState> {
    let st = stage.unwrap_or(DEFAULT_STAGE);
    let (item_id, gold) = match st {
        "mirkwood" => ("ancientStaff", 3526),
        "mirkwooddeep" => ("kunicTotem", 6094),
        _ => return None,
    };
    let item_name = item_spec(item_id).map(|s| s.name).unwrap_or(item_id);
    Some(RewardState {
        seed: seed.unwrap_or(DEFAULT_SEED),
        stage: st.to_string(),
        item_id: item_id.to_string(),
        item: item_name.to_string(),
        gold,
        claimed: false,
        phase: RewardPhase::Stats,
        t: 0.0,
        elapsed: 0.0,
        picked: None,
        face_up: false,
        countdown: 3,
    })
}

fn sync_cards(reward: &mut RewardState) {
    reward.face_up = reward.t + 1e-9 >= TIME_FLIP;
    let left = TIME_COUNTDOWN - (reward.t - TIME_COUNTDOWN_AT).max(0.0);
    reward.countdown = (left - 1e-9).ceil().max(0.0) as u32;
}

pub fn pick(reward: &mut RewardState, index: usize) -> bool {
    if reward.phase != RewardPhase::Cards || reward.picked.is_some() || !reward.face_up {
        return false;
    }
    if index >= CARD_COUNT {
        return false;
    }
    reward.picked = Some(index);
    reward.phase = RewardPhase::Reveal;
    reward.t = 0.0;
    true
}

pub fn step(reward: &mut RewardState, dt: f64) {
    if !dt.is_finite() || dt <= 0.0 {
        return;
    }
    reward.elapsed += dt;
    let mut remaining = dt;
    while remaining > 0.0 {
        let limit = match reward.phase {
            RewardPhase::Stats => TIME_STATS,
            RewardPhase::Chest => chest_duration(&reward.stage),
            RewardPhase::Cards => TIME_COUNTDOWN_AT + TIME_COUNTDOWN,
            RewardPhase::Reveal => TIME_REVEAL,
            RewardPhase::Fade => TIME_FADE,
            RewardPhase::Done => f64::INFINITY,
        };
        let advance = remaining.min((limit - reward.t).max(0.0));
        reward.t += advance;
        remaining -= advance;
        if reward.phase == RewardPhase::Cards {
            sync_cards(reward);
        }
        if reward.t + 1e-9 < limit {
            break;
        }
        match reward.phase {
            RewardPhase::Stats => reward.phase = RewardPhase::Chest,
            RewardPhase::Chest => {
                reward.phase = RewardPhase::Cards;
                reward.face_up = false;
                reward.countdown = 3;
            }
            RewardPhase::Cards => {
                pick(reward, 0);
            }
            RewardPhase::Reveal => reward.phase = RewardPhase::Fade,
            RewardPhase::Fade => reward.phase = RewardPhase::Done,
            RewardPhase::Done => {}
        }
        reward.t = 0.0;
    }
}

pub fn take_prize(reward: &mut RewardState) -> Option<Prize> {
    if reward.picked.is_none() || reward.claimed {
        return None;
    }
    if !matches!(
        reward.phase,
        RewardPhase::Reveal | RewardPhase::Fade | RewardPhase::Done
    ) {
        return None;
    }
    reward.claimed = true;
    Some(Prize {
        item_id: reward.item_id.clone(),
        gold: reward.gold,
    })
}

pub fn snapshot(reward: &RewardState) -> RewardSnapshot {
    let opacity = match reward.phase {
        RewardPhase::Done => 0.0,
        RewardPhase::Fade => 1.0 - (reward.t / TIME_FADE).clamp(0.0, 1.0),
        _ => 1.0,
    };
    let spread = if reward.phase == RewardPhase::Cards {
        (reward.t / TIME_SPREAD).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let blue = if reward.phase == RewardPhase::Cards {
        1.0 - ((reward.t - TIME_FADE_START) / (TIME_FLIP - TIME_FADE_START)).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let flash = if reward.phase == RewardPhase::Cards {
        1.0 - (reward.t / 0.7).clamp(0.0, 1.0)
    } else {
        0.0
    };
    RewardSnapshot {
        phase: reward.phase,
        elapsed: (reward.elapsed * 1000.0).round() / 1000.0,
        t: (reward.t * 1000.0).round() / 1000.0,
        opacity,
        picked: reward.picked,
        face_up: reward.face_up,
        countdown: reward.countdown,
        spread,
        blue,
        prompt_visible: reward.phase == RewardPhase::Cards && reward.t + 1e-9 >= TIME_PROMPT,
        countdown_visible: reward.phase == RewardPhase::Cards
            && reward.t + 1e-9 >= TIME_COUNTDOWN_AT,
        flash,
        item: reward.item.clone(),
        gold: reward.gold,
        claimed: reward.claimed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reward_flow() {
        let mut r = create(Some(42), Some("mirkwood")).expect("reward");
        assert_eq!(r.phase, RewardPhase::Stats);
        step(&mut r, 10.0);
        assert_eq!(r.phase, RewardPhase::Chest);
        step(&mut r, TIME_CHEST);
        assert_eq!(r.phase, RewardPhase::Cards);
        assert!(!pick(&mut r, 1)); // not faceUp yet
        step(&mut r, 2.0);
        assert!(r.face_up);
        assert!(pick(&mut r, 2));
        assert_eq!(r.phase, RewardPhase::Reveal);
        let p = take_prize(&mut r).expect("prize");
        assert_eq!(p.gold, 3526);
        assert!(take_prize(&mut r).is_none());
    }
}
