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

#[derive(Debug, Serialize, Deserialize)]
struct SaveEnvelope {
    records: String,
    progress: String,
    loadout: String,
}

pub fn save_path(root: &Path) -> PathBuf {
    root.join("nano-dnf-save.json")
}

pub fn load_all(
    root: &Path,
    valid_skills: &[&str],
    stage_id: &str,
) -> (RecordStore, ProgressProfile, Loadout) {
    let path = save_path(root);
    let Ok(text) = fs::read_to_string(&path) else {
        return (
            empty_records(),
            default_progress(),
            loadout_rs::create(valid_skills, Some(stage_id)),
        );
    };
    let Ok(env) = serde_json::from_str::<SaveEnvelope>(&text) else {
        return (
            empty_records(),
            default_progress(),
            loadout_rs::create(valid_skills, Some(stage_id)),
        );
    };
    let records = deserialize_records(&env.records);
    let progress = deserialize_progress(&env.progress);
    let loadout = deserialize_loadout(&env.loadout, valid_skills);
    (records, progress, loadout)
}

pub fn save_all(root: &Path, records: &RecordStore, progress: &ProgressProfile, loadout: &Loadout) {
    let env = SaveEnvelope {
        records: serialize_records(records),
        progress: serialize_progress(progress),
        loadout: serialize_loadout(loadout),
    };
    if let Ok(json) = serde_json::to_string_pretty(&env) {
        let _ = fs::write(save_path(root), json);
    }
}
