//! Embedded render tables deserialized from `tables.json`.

use serde_json::Value;
use std::sync::LazyLock;

pub static RENDER_TABLES: LazyLock<Value> = LazyLock::new(|| {
    // INFALLIBLE: embedded compile-time JSON generated from src/render.js
    serde_json::from_str(include_str!("tables.json")).expect("INFALLIBLE: valid render tables.json")
});

pub fn rect_at(path: &[&str]) -> Option<[u32; 4]> {
    let mut cur = &*RENDER_TABLES;
    for seg in path {
        cur = cur.get(*seg)?;
    }
    let arr = cur.as_array()?;
    if arr.len() < 4 {
        return None;
    }
    Some([
        arr[0].as_u64()? as u32,
        arr[1].as_u64()? as u32,
        arr[2].as_u64()? as u32,
        arr[3].as_u64()? as u32,
    ])
}

pub fn f64_at(path: &[&str]) -> Option<f64> {
    let mut cur = &*RENDER_TABLES;
    for seg in path {
        cur = cur.get(*seg)?;
    }
    cur.as_f64()
}
