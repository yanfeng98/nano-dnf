//! End-of-run summary table, pace comparison, and share link (`src/summary.js`).

use records_rs::RecordEntry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaceState {
    None,
    Ahead,
    Behind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaceInfo {
    pub state: PaceState,
    pub delta: Option<f64>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SummaryRow {
    pub id: &'static str,
    pub label: &'static str,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SummaryTable {
    pub rows: Vec<SummaryRow>,
}

#[derive(Debug, Clone, Default)]
pub struct RunSummaryInput {
    pub seed: Option<f64>,
    pub seconds: f64,
    pub level: Option<f64>,
    pub kills: Option<f64>,
    pub kill_xp: Option<f64>,
    pub damage_taken: Option<f64>,
    pub room: Option<f64>,
    pub rooms: Option<f64>,
}

/// Format seconds as `m:ss.t`, matching `records_rs::format_seconds`.
pub fn format_seconds(seconds: f64) -> String {
    records_rs::format_seconds(seconds)
}

fn whole(value: Option<f64>, fallback: u64) -> u64 {
    let Some(v) = value else {
        return fallback;
    };
    let n = v.floor();
    if n.is_finite() && n >= 0.0 {
        n as u64
    } else {
        fallback
    }
}

/// JS `Math.round`: halves round toward +infinity.
fn js_math_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        let is_unreserved = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if is_unreserved {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Build a shareable URL preserving unrelated query params and hash.
pub fn seed_url(href: &str, seed: u32, stage: Option<&str>) -> Option<String> {
    if href.is_empty() {
        return None;
    }
    let (without_hash, hash) = match href.find('#') {
        Some(idx) => (&href[..idx], &href[idx..]),
        None => (href, ""),
    };
    let (base, query) = match without_hash.find('?') {
        Some(idx) => (&without_hash[..idx], &without_hash[idx + 1..]),
        None => (without_hash, ""),
    };
    let mut kept: Vec<String> = query
        .split('&')
        .filter(|pair| {
            if pair.is_empty() {
                return false;
            }
            let key = pair.split('=').next().unwrap_or("");
            key != "seed" && (stage.is_none() || key != "stage")
        })
        .map(ToString::to_string)
        .collect();
    kept.push(format!("seed={seed}"));
    if let Some(st) = stage.filter(|s| !s.is_empty()) {
        kept.push(format!("stage={}", encode_uri_component(st)));
    }
    Some(format!("{base}?{}{hash}", kept.join("&")))
}

/// Compare current run clock against the seed's best record.
pub fn pace(seconds: f64, record: Option<&RecordEntry>) -> PaceInfo {
    if !seconds.is_finite() || seconds <= 0.0 {
        return PaceInfo {
            state: PaceState::None,
            delta: None,
            text: None,
        };
    }
    let Some(rec) = record.filter(|r| r.seconds.is_finite() && r.seconds > 0.0) else {
        return PaceInfo {
            state: PaceState::None,
            delta: None,
            text: Some("本种子还没有记录".to_string()),
        };
    };
    let delta = js_math_round((seconds - rec.seconds) * 10.0) / 10.0;
    if delta <= 0.0 {
        PaceInfo {
            state: PaceState::Ahead,
            delta: Some(delta),
            text: Some(format!(
                "领先最佳 {:.1}s（最佳 {}）",
                delta.abs(),
                format_seconds(rec.seconds)
            )),
        }
    } else {
        PaceInfo {
            state: PaceState::Behind,
            delta: Some(delta),
            text: Some(format!(
                "落后最佳 {:.1}s（最佳 {}）",
                delta,
                format_seconds(rec.seconds)
            )),
        }
    }
}

/// Build the rows drawn on the pause/victory summary table.
pub fn describe(run: &RunSummaryInput) -> SummaryTable {
    let level = whole(run.level, 1).max(1);
    let mut rows = vec![
        SummaryRow {
            id: "seed",
            label: "种子",
            value: whole(run.seed, 0).to_string(),
        },
        SummaryRow {
            id: "time",
            label: "用时",
            value: format_seconds(run.seconds),
        },
        SummaryRow {
            id: "level",
            label: "等级",
            value: format!("Lv {level}"),
        },
        SummaryRow {
            id: "kills",
            label: "击杀",
            value: whole(run.kills, 0).to_string(),
        },
        SummaryRow {
            id: "damage",
            label: "承伤",
            value: whole(run.damage_taken, 0).to_string(),
        },
    ];
    let rooms = whole(run.rooms, 0);
    if rooms > 0 {
        let walked = whole(run.room, 0).min(rooms);
        rows.push(SummaryRow {
            id: "reached",
            label: "到达",
            value: format!("走过 {walked} 间 / 图上 {rooms} 格"),
        });
    }
    if let Some(kill_xp) = run.kill_xp {
        if kill_xp.is_finite() && kill_xp >= 0.0 {
            rows.push(SummaryRow {
                id: "killXp",
                label: "击杀经验",
                value: whole(Some(kill_xp), 0).to_string(),
            });
        }
    }
    SummaryTable { rows }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pace_and_url() {
        let rec = RecordEntry {
            seconds: 30.0,
            level: 3,
            clears: 1,
            updated_at: None,
        };
        let ahead = pace(28.4, Some(&rec));
        assert_eq!(ahead.state, PaceState::Ahead);
        assert_eq!(ahead.text.as_deref(), Some("领先最佳 1.6s（最佳 0:30.0）"));

        let url = seed_url(
            "https://x.test/?seed=1&stage=mirkwood#top",
            99,
            Some("mirkwooddeep"),
        );
        assert_eq!(
            url.as_deref(),
            Some("https://x.test/?seed=99&stage=mirkwooddeep#top")
        );
    }

    #[test]
    fn test_describe() {
        let table = describe(&RunSummaryInput {
            seed: Some(7.0),
            seconds: 44.4,
            level: Some(4.0),
            kills: Some(12.0),
            kill_xp: Some(480.0),
            damage_taken: Some(15.0),
            room: Some(3.0),
            rooms: Some(5.0),
        });
        assert_eq!(table.rows.len(), 7);
        assert_eq!(table.rows[5].value, "走过 3 间 / 图上 5 格");
    }
}
