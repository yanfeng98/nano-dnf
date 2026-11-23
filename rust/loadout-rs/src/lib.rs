//! Skill loadout hotbar rules (`src/loadout.js`).

pub const SLOT_COUNT: usize = 6;
pub const SLOT_ROW_SIZE: usize = 6;
pub const SLOT_KEYS: [&str; SLOT_COUNT] = ["A", "S", "D", "F", "G", "H"];

pub const DEFAULT_SLOTS: [&str; SLOT_COUNT] = [
    "ghostSlash",
    "upSlash",
    "crossSlash",
    "bloodSword",
    "graspHead",
    "mountainRift",
];

pub type Loadout = Vec<Option<String>>;

/// Return the default direct skill shortcut for a key code.
pub fn skill_for_key_code(code: &str) -> Option<&'static str> {
    match code {
        "KeyZ" => Some("upSlash"),
        "KeyV" => Some("hellbenter"),
        _ => None,
    }
}

/// Return the shortcut label for a skill ID if it has a direct shortcut.
pub fn shortcut_for_skill(skill_id: &str) -> Option<&'static str> {
    match skill_id {
        "upSlash" => Some("Z"),
        "hellbenter" => Some("V"),
        _ => None,
    }
}

/// Build the initial 6-slot loadout filtered by valid skill IDs and stage.
pub fn create(valid_skill_ids: &[&str], stage_id: Option<&str>) -> Loadout {
    let mut defaults: [&str; SLOT_COUNT] = DEFAULT_SLOTS;
    if stage_id == Some("mirkwooddeep") {
        defaults[2] = "normalWave";
    }
    defaults
        .iter()
        .map(|&id| {
            if valid_skill_ids.contains(&id) {
                Some(id.to_string())
            } else {
                None
            }
        })
        .collect()
}

/// Find the slot index containing `skill_id`, or `None`.
pub fn slot_of(loadout: &[Option<String>], skill_id: &str) -> Option<usize> {
    loadout
        .iter()
        .position(|slot| slot.as_deref() == Some(skill_id))
}

/// Drop `skill_id` onto `slot_index`; if it already sits elsewhere, swap.
pub fn assign(loadout: &[Option<String>], slot_index: usize, skill_id: Option<&str>) -> Loadout {
    let mut next = loadout.to_vec();
    if slot_index >= SLOT_COUNT || slot_index >= next.len() {
        return next;
    }
    let Some(id) = skill_id.filter(|s| !s.is_empty()) else {
        next[slot_index] = None;
        return next;
    };
    if let Some(existing) = next.iter().position(|s| s.as_deref() == Some(id)) {
        if existing != slot_index {
            next[existing] = next[slot_index].clone();
        }
    }
    next[slot_index] = Some(id.to_string());
    next
}

/// Swap two slots in the loadout.
pub fn swap(loadout: &[Option<String>], from_index: usize, to_index: usize) -> Loadout {
    let mut next = loadout.to_vec();
    if from_index == to_index || from_index >= next.len() || to_index >= next.len() {
        return next;
    }
    next.swap(from_index, to_index);
    next
}

/// Clear a single slot.
pub fn clear_slot(loadout: &[Option<String>], slot_index: usize) -> Loadout {
    let mut next = loadout.to_vec();
    if slot_index < SLOT_COUNT && slot_index < next.len() {
        next[slot_index] = None;
    }
    next
}

/// Serialize loadout into comma-separated slot IDs.
pub fn serialize(loadout: &[Option<String>]) -> String {
    loadout
        .iter()
        .map(|slot| slot.as_deref().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(",")
}

/// Deserialize comma-separated slot IDs, keeping only valid ones.
pub fn deserialize(text: &str, valid_skill_ids: &[&str]) -> Loadout {
    let parts: Vec<&str> = text.split(',').collect();
    (0..SLOT_COUNT)
        .map(|index| {
            let value = parts.get(index).copied().unwrap_or("").trim();
            if !value.is_empty() && valid_skill_ids.contains(&value) {
                Some(value.to_string())
            } else {
                None
            }
        })
        .collect()
}

/// Slot index for a keyboard code such as `"KeyD"` (`None` if not a slot key).
pub fn slot_for_code(code: &str) -> Option<usize> {
    let suffix = code.strip_prefix("Key")?;
    SLOT_KEYS.iter().position(|&k| k == suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_stage_override() {
        let valid = [
            "ghostSlash",
            "upSlash",
            "crossSlash",
            "normalWave",
            "bloodSword",
        ];
        let l1 = create(&valid, Some("mirkwood"));
        assert_eq!(l1[2].as_deref(), Some("crossSlash"));
        assert_eq!(l1[4], None);

        let l2 = create(&valid, Some("mirkwooddeep"));
        assert_eq!(l2[2].as_deref(), Some("normalWave"));
    }

    #[test]
    fn test_assign_swaps_existing() {
        let valid = ["ghostSlash", "upSlash", "crossSlash"];
        let l = create(&valid, None);
        let l2 = assign(&l, 0, Some("upSlash"));
        assert_eq!(l2[0].as_deref(), Some("upSlash"));
        assert_eq!(l2[1].as_deref(), Some("ghostSlash"));
    }

    #[test]
    fn test_serialize_roundtrip() {
        let valid = ["ghostSlash", "upSlash", "crossSlash"];
        let l = create(&valid, None);
        let s = serialize(&l);
        assert_eq!(s, "ghostSlash,upSlash,crossSlash,,,");
        let l2 = deserialize(&s, &valid);
        assert_eq!(l, l2);
    }

    #[test]
    fn test_slot_for_code() {
        assert_eq!(slot_for_code("KeyA"), Some(0));
        assert_eq!(slot_for_code("KeyH"), Some(5));
        assert_eq!(slot_for_code("KeyZ"), None);
    }
}
