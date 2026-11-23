//! Per-stage, per-seed run records (`src/records.js`).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SEEDS: usize = 40;
pub const DEFAULT_STAGE: &str = "mirkwood";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEntry {
    pub seconds: f64,
    pub level: u32,
    pub clears: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStore {
    pub schema_version: u32,
    pub runs: u32,
    pub seeds: IndexMap<String, RecordEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BestOverall {
    pub stage: String,
    pub seed: u32,
    pub seconds: f64,
    pub level: u32,
    pub clears: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunInput<'a> {
    pub stage: Option<&'a str>,
    pub seed: Option<u32>,
    pub seconds: f64,
    pub level: u32,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecordResult {
    pub store: RecordStore,
    pub improved: bool,
    pub entry: Option<RecordEntry>,
}

/// Normalize a numeric or decimal-string seed into `0..=0xffffffff`.
pub fn normalize_seed(seed_num: Option<f64>, seed_str: Option<&str>) -> Option<u32> {
    if let Some(n) = seed_num {
        if n.is_finite() && n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&n) {
            return Some(n as u32);
        }
        return None;
    }
    let s = seed_str?;
    if s.is_empty() || s.len() > 10 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<u32>().ok()
}

/// Normalize a lowercase stage slug (`[a-z][a-z0-9]*`).
pub fn normalize_stage(stage: Option<&str>) -> Option<String> {
    let trimmed = stage?.trim();
    let mut bytes = trimmed.bytes();
    let first = bytes.next()?;
    if !first.is_ascii_lowercase() {
        return None;
    }
    if bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// Build canonical `<stage>:<seed>` key.
pub fn key_for(stage: Option<&str>, seed: u32) -> String {
    let stage_name = normalize_stage(stage).unwrap_or_else(|| DEFAULT_STAGE.to_string());
    format!("{stage_name}:{seed}")
}

/// Parse `<stage>:<seed>` or legacy bare `<seed>` key.
pub fn parse_key(key: &str) -> Option<(String, u32)> {
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() == 1 {
        let seed = normalize_seed(None, Some(parts[0]))?;
        return Some((DEFAULT_STAGE.to_string(), seed));
    }
    if parts.len() != 2 {
        return None;
    }
    let stage = normalize_stage(Some(parts[0]))?;
    let seed = normalize_seed(None, Some(parts[1]))?;
    Some((stage, seed))
}

pub fn empty_store() -> RecordStore {
    RecordStore {
        schema_version: SCHEMA_VERSION,
        runs: 0,
        seeds: IndexMap::new(),
    }
}

fn improves_record(seconds: f64, level: u32, previous: Option<&RecordEntry>) -> bool {
    match previous {
        None => true,
        Some(prev) => seconds < prev.seconds || (seconds == prev.seconds && level > prev.level),
    }
}

fn normalize_raw_entry(raw: &serde_json::Value) -> Option<RecordEntry> {
    let obj = raw.as_object()?;
    let seconds = obj.get("seconds")?.as_f64()?;
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    let level = obj
        .get("level")
        .and_then(|v| v.as_f64())
        .map(|n| n.floor())
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| n as u32)
        .unwrap_or(1);
    let clears = obj
        .get("clears")
        .and_then(|v| v.as_f64())
        .map(|n| n.floor())
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| n as u32)
        .unwrap_or(1);
    let updated_at = obj
        .get("updatedAt")
        .and_then(|v| v.as_f64())
        .map(|n| n.floor())
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| n as u64);
    Some(RecordEntry {
        seconds,
        level,
        clears,
        updated_at,
    })
}

/// Deserialize JSON into a normalized `RecordStore`.
pub fn deserialize(text: &str) -> RecordStore {
    let mut store = empty_store();
    if text.is_empty() {
        return store;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
        return store;
    };
    let Some(obj) = parsed.as_object() else {
        return store;
    };
    if obj.get("schemaVersion").and_then(|v| v.as_u64()) != Some(u64::from(SCHEMA_VERSION)) {
        return store;
    }
    if let Some(runs) = obj.get("runs").and_then(|v| v.as_f64()) {
        let r = runs.floor();
        if r.is_finite() && r > 0.0 {
            store.runs = r as u32;
        }
    }
    if let Some(seeds) = obj.get("seeds").and_then(|v| v.as_object()) {
        for (key, val) in seeds {
            let Some((stage, seed)) = parse_key(key) else {
                continue;
            };
            let Some(entry) = normalize_raw_entry(val) else {
                continue;
            };
            let canonical = key_for(Some(&stage), seed);
            if let Some(previous) = store.seeds.get(&canonical).cloned() {
                let mut winner = if improves_record(entry.seconds, entry.level, Some(&previous)) {
                    entry.clone()
                } else {
                    previous.clone()
                };
                winner.clears = previous.clears.max(entry.clears);
                let max_upd = previous
                    .updated_at
                    .unwrap_or(0)
                    .max(entry.updated_at.unwrap_or(0));
                winner.updated_at = if max_upd > 0 { Some(max_upd) } else { None };
                store.seeds.insert(canonical, winner);
            } else {
                store.seeds.insert(canonical, entry);
            }
        }
    }
    store
}

pub fn serialize(store: &RecordStore) -> String {
    serde_json::to_string(store).unwrap_or_else(|_| "{}".to_string())
}

pub fn best<'a>(store: &'a RecordStore, stage: Option<&str>, seed: u32) -> Option<&'a RecordEntry> {
    let key = key_for(stage, seed);
    store.seeds.get(&key)
}

/// Fastest clear across the store (optionally filtered to one valid stage).
pub fn best_overall(store: &RecordStore, stage: Option<&str>) -> Option<BestOverall> {
    let wanted = match stage {
        Some(s) => Some(normalize_stage(Some(s))?),
        None => None,
    };
    let mut winner: Option<BestOverall> = None;
    for (key, entry) in &store.seeds {
        let Some((spot_stage, spot_seed)) = parse_key(key) else {
            continue;
        };
        if !entry.seconds.is_finite() || entry.seconds <= 0.0 {
            continue;
        }
        if let Some(ref w) = wanted {
            if &spot_stage != w {
                continue;
            }
        }
        let better = match &winner {
            None => true,
            Some(w) => {
                entry.seconds < w.seconds || (entry.seconds == w.seconds && spot_seed < w.seed)
            }
        };
        if better {
            winner = Some(BestOverall {
                stage: spot_stage,
                seed: spot_seed,
                seconds: entry.seconds,
                level: entry.level,
                clears: entry.clears,
            });
        }
    }
    winner
}

fn prune(seeds: &mut IndexMap<String, RecordEntry>) {
    if seeds.len() <= MAX_SEEDS {
        return;
    }
    let mut keys: Vec<String> = seeds.keys().cloned().collect();
    keys.sort_by_key(|k| seeds.get(k).and_then(|e| e.updated_at).unwrap_or(0));
    let remove_count = keys.len() - MAX_SEEDS;
    for key in keys.into_iter().take(remove_count) {
        seeds.shift_remove(&key);
    }
}

/// Fold one cleared run into the store.
pub fn record(store: &RecordStore, run: &RunInput<'_>) -> RecordResult {
    let Some(seed) = run.seed else {
        return RecordResult {
            store: store.clone(),
            improved: false,
            entry: None,
        };
    };
    if !run.seconds.is_finite() || run.seconds <= 0.0 || run.level == 0 {
        return RecordResult {
            store: store.clone(),
            improved: false,
            entry: None,
        };
    }
    let key = key_for(run.stage, seed);
    let mut seeds = store.seeds.clone();
    let previous = seeds.get(&key).cloned();
    let improved = improves_record(run.seconds, run.level, previous.as_ref());
    let clears = previous.as_ref().map(|p| p.clears).unwrap_or(0) + 1;
    let entry = RecordEntry {
        seconds: if improved {
            run.seconds
        } else {
            previous.as_ref().map(|p| p.seconds).unwrap_or(run.seconds)
        },
        level: if improved {
            run.level
        } else {
            previous.as_ref().map(|p| p.level).unwrap_or(run.level)
        },
        clears,
        updated_at: run
            .updated_at
            .filter(|&u| u > 0)
            .or_else(|| previous.as_ref().and_then(|p| p.updated_at)),
    };
    seeds.insert(key, entry.clone());
    prune(&mut seeds);
    RecordResult {
        store: RecordStore {
            schema_version: SCHEMA_VERSION,
            runs: store.runs + 1,
            seeds,
        },
        improved,
        entry: Some(entry),
    }
}

/// Format seconds as `m:ss.t` (tenths).
pub fn format_seconds(seconds: f64) -> String {
    if !seconds.is_finite() || seconds <= 0.0 {
        return "--".to_string();
    }
    let total = (seconds * 10.0 + 1e-6).floor() as u64;
    let minutes = total / 600;
    let rest = total - minutes * 600;
    let whole = rest / 10;
    let tenths = rest - whole * 10;
    format!("{minutes}:{whole:02}.{tenths}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_and_improve() {
        let s0 = empty_store();
        let r1 = record(
            &s0,
            &RunInput {
                stage: Some("mirkwood"),
                seed: Some(12345),
                seconds: 44.4,
                level: 3,
                updated_at: Some(100),
            },
        );
        assert!(r1.improved);
        assert_eq!(r1.store.runs, 1);
        assert_eq!(format_seconds(44.4), "0:44.4");

        let r2 = record(
            &r1.store,
            &RunInput {
                stage: Some("mirkwood"),
                seed: Some(12345),
                seconds: 50.0,
                level: 4,
                updated_at: Some(200),
            },
        );
        assert!(!r2.improved);
        assert_eq!(r2.entry.as_ref().map(|e| e.clears), Some(2));
        assert_eq!(r2.entry.as_ref().map(|e| e.seconds), Some(44.4));
    }

    #[test]
    fn test_legacy_bare_key_merges() {
        let json = r#"{"schemaVersion":1,"runs":2,"seeds":{"42":{"seconds":30,"level":2,"clears":1},"mirkwood:42":{"seconds":25,"level":3,"clears":2}}}"#;
        let store = deserialize(json);
        let entry = best(&store, Some("mirkwood"), 42);
        assert_eq!(entry.map(|e| e.seconds), Some(25.0));
        assert_eq!(entry.map(|e| e.clears), Some(2));
    }
}
