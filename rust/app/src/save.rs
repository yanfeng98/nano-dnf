//! Portable JSON save/load for records, progress, and loadout.

use loadout_rs::{deserialize as deserialize_loadout, serialize as serialize_loadout, Loadout};
use progress_rs::{
    defaults as default_progress, deserialize as deserialize_progress,
    serialize as serialize_progress, ProgressProfile,
};
use records_rs::{
    deserialize as deserialize_records, empty_store as empty_records,
    serialize as serialize_records, RecordStore,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_PLAYER_NAME: &str = "阿努纳奇";

fn default_player_name() -> String {
    DEFAULT_PLAYER_NAME.to_string()
}

pub fn normalize_player_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        default_player_name()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct SaveEnvelope {
    records: String,
    progress: String,
    loadout: String,
    #[serde(default = "default_player_name")]
    player_name: String,
}

pub fn save_path(root: &Path) -> PathBuf {
    root.join("nano-dnf-save.json")
}

pub fn load_all(
    root: &Path,
    valid_skills: &[&str],
    stage_id: &str,
) -> (RecordStore, ProgressProfile, Loadout, String) {
    let path = save_path(root);
    let Ok(text) = fs::read_to_string(&path) else {
        return (
            empty_records(),
            default_progress(),
            loadout_rs::create(valid_skills, Some(stage_id)),
            default_player_name(),
        );
    };
    let Ok(env) = serde_json::from_str::<SaveEnvelope>(&text) else {
        return (
            empty_records(),
            default_progress(),
            loadout_rs::create(valid_skills, Some(stage_id)),
            default_player_name(),
        );
    };
    let records = deserialize_records(&env.records);
    let progress = deserialize_progress(&env.progress);
    let loadout = deserialize_loadout(&env.loadout, valid_skills);
    let player_name = normalize_player_name(&env.player_name);
    (records, progress, loadout, player_name)
}

pub fn save_all(
    root: &Path,
    records: &RecordStore,
    progress: &ProgressProfile,
    loadout: &Loadout,
    player_name: &str,
) {
    let env = SaveEnvelope {
        records: serialize_records(records),
        progress: serialize_progress(progress),
        loadout: serialize_loadout(loadout),
        player_name: normalize_player_name(player_name),
    };
    if let Ok(json) = serde_json::to_string_pretty(&env) {
        let _ = fs::write(save_path(root), json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nano_dnf_save_{tag}_{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn load_all_defaults_player_name_when_missing_file() {
        let dir = temp_dir("missing");
        let (_, _, _, player_name) = load_all(&dir, &["upSlash"], "mirkwood");
        assert_eq!(player_name, "阿努纳奇");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_all_defaults_player_name_for_legacy_json_or_blank() {
        let dir = temp_dir("legacy");
        let legacy = r#"{"records":"{}","progress":"{}","loadout":"{}"}"#;
        fs::write(save_path(&dir), legacy).expect("write legacy save");
        let (_, _, _, player_name) = load_all(&dir, &["upSlash"], "mirkwood");
        assert_eq!(player_name, "阿努纳奇");

        let blank = r#"{"records":"{}","progress":"{}","loadout":"{}","player_name":"   "}"#;
        fs::write(save_path(&dir), blank).expect("write blank save");
        let (_, _, _, player_name) = load_all(&dir, &["upSlash"], "mirkwood");
        assert_eq!(player_name, "阿努纳奇");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_and_load_roundtrips_custom_player_name() {
        let dir = temp_dir("custom");
        let records = empty_records();
        let progress = default_progress();
        let loadout = loadout_rs::create(&["upSlash"], Some("mirkwood"));
        save_all(&dir, &records, &progress, &loadout, "狱血魔神");
        let (_, _, _, player_name) = load_all(&dir, &["upSlash"], "mirkwood");
        assert_eq!(player_name, "狱血魔神");
        let _ = fs::remove_dir_all(&dir);
    }
}
