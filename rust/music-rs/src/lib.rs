//! Procedural dungeon loop and track selector (`src/music.js`).

use serde::{Deserialize, Serialize};

pub const BPM: f64 = 96.0;
pub const STEPS_PER_BEAT: usize = 4;
pub const BEATS_PER_BAR: usize = 4;
pub const STEPS_PER_BAR: usize = STEPS_PER_BEAT * BEATS_PER_BAR;
pub const LOOP_STEPS: usize = 4 * STEPS_PER_BAR;
pub const STEP_SECONDS: f64 = 60.0 / BPM / (STEPS_PER_BEAT as f64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chord {
    pub name: &'static str,
    pub root: i32,
    pub tones: [i32; 3],
}

pub const PROGRESSION: [Chord; 4] = [
    Chord {
        name: "Am",
        root: 57,
        tones: [57, 60, 64],
    },
    Chord {
        name: "F",
        root: 53,
        tones: [53, 57, 60],
    },
    Chord {
        name: "C",
        root: 48,
        tones: [48, 52, 55],
    },
    Chord {
        name: "G",
        root: 55,
        tones: [55, 59, 62],
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Bass,
    Lead,
    Hat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WaveType {
    Triangle,
    Square,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicNote {
    pub channel: Channel,
    pub freq: Option<f64>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub wave_type: Option<WaveType>,
    pub gain: f64,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_freq: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackId {
    Title,
    Room,
    Boss,
    BossDeep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackInfo {
    pub id: TrackId,
    pub file: &'static str,
    pub label: &'static str,
}

pub const TRACKS: [TrackInfo; 4] = [
    TrackInfo {
        id: TrackId::Title,
        file: "assets/music/intro.ogg",
        label: "开始画面",
    },
    TrackInfo {
        id: TrackId::Room,
        file: "assets/music/mirkwood.ogg",
        label: "关卡",
    },
    TrackInfo {
        id: TrackId::Boss,
        file: "assets/music/mirkwood_boss.ogg",
        label: "Boss 房",
    },
    TrackInfo {
        id: TrackId::BossDeep,
        file: "assets/music/forest02.ogg",
        label: "幽暗密林深处 Boss",
    },
];

/// Convert MIDI note number to frequency in Hz.
pub fn midi_to_freq(note: f64) -> f64 {
    440.0 * 2.0_f64.powf((note - 69.0) / 12.0)
}

/// Normalize a step index into `0..LOOP_STEPS`.
pub fn normalize_step(step: f64) -> usize {
    let value = step.floor();
    if !value.is_finite() {
        return 0;
    }
    let loop_len = LOOP_STEPS as f64;
    let wrapped = value % loop_len;
    let pos = if wrapped < 0.0 {
        wrapped + loop_len
    } else {
        wrapped
    };
    pos as usize
}

/// Return the chord active at `step`.
pub fn chord_for_step(step: f64) -> &'static Chord {
    let idx = normalize_step(step) / STEPS_PER_BAR;
    &PROGRESSION[idx]
}

/// Return the notes that start on one step of the procedural loop.
pub fn notes_for_step(step: f64) -> Vec<MusicNote> {
    let index = normalize_step(step);
    let in_bar = index % STEPS_PER_BAR;
    let chord = chord_for_step(index as f64);
    let mut notes = Vec::new();

    if in_bar == 0 || in_bar == 8 {
        notes.push(MusicNote {
            channel: Channel::Bass,
            freq: Some(midi_to_freq((chord.root - 12) as f64)),
            wave_type: Some(WaveType::Triangle),
            gain: 0.22,
            duration: if in_bar == 0 {
                STEP_SECONDS * 7.0
            } else {
                STEP_SECONDS * 3.0
            },
            filter_freq: None,
        });
    }

    if in_bar.is_multiple_of(2) {
        let tone = chord.tones[(in_bar / 2) % chord.tones.len()];
        notes.push(MusicNote {
            channel: Channel::Lead,
            freq: Some(midi_to_freq((tone + 12) as f64)),
            wave_type: Some(WaveType::Square),
            gain: 0.07,
            duration: STEP_SECONDS * 1.6,
            filter_freq: None,
        });
    }

    if in_bar.is_multiple_of(4) {
        notes.push(MusicNote {
            channel: Channel::Hat,
            freq: None,
            wave_type: None,
            gain: 0.05,
            duration: 0.04,
            filter_freq: Some(if in_bar == 0 { 2600.0 } else { 5200.0 }),
        });
    }

    notes
}

/// Select which music track belongs on screen.
pub fn track_for(
    cell: Option<usize>,
    boss_cell: Option<usize>,
    stage_id: Option<&str>,
    is_title: bool,
) -> TrackId {
    if is_title {
        return TrackId::Title;
    }
    let Some(boss) = boss_cell else {
        return TrackId::Room;
    };
    if cell != Some(boss) {
        return TrackId::Room;
    }
    if stage_id == Some("mirkwooddeep") {
        TrackId::BossDeep
    } else {
        TrackId::Boss
    }
}

/// Look up track metadata by ID.
pub fn track_info(id: TrackId) -> &'static TrackInfo {
    match id {
        TrackId::Title => &TRACKS[0],
        TrackId::Room => &TRACKS[1],
        TrackId::Boss => &TRACKS[2],
        TrackId::BossDeep => &TRACKS[3],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_and_chords() {
        assert_eq!(normalize_step(-1.0), 63);
        assert_eq!(normalize_step(64.0), 0);
        assert_eq!(normalize_step(f64::NAN), 0);
        assert_eq!(chord_for_step(0.0).name, "Am");
        assert_eq!(chord_for_step(16.0).name, "F");
        assert_eq!(chord_for_step(32.0).name, "C");
        assert_eq!(chord_for_step(48.0).name, "G");
    }

    #[test]
    fn test_notes_for_step_downbeat() {
        let notes = notes_for_step(0.0);
        assert_eq!(notes.len(), 3);
        assert_eq!(notes[0].channel, Channel::Bass);
        assert_eq!(notes[1].channel, Channel::Lead);
        assert_eq!(notes[2].channel, Channel::Hat);
        assert_eq!(notes[2].filter_freq, Some(2600.0));
    }

    #[test]
    fn test_track_for() {
        assert_eq!(
            track_for(Some(0), Some(5), Some("mirkwood"), true),
            TrackId::Title
        );
        assert_eq!(
            track_for(Some(0), None, Some("mirkwood"), false),
            TrackId::Room
        );
        assert_eq!(
            track_for(Some(2), Some(5), Some("mirkwood"), false),
            TrackId::Room
        );
        assert_eq!(
            track_for(Some(5), Some(5), Some("mirkwood"), false),
            TrackId::Boss
        );
        assert_eq!(
            track_for(Some(5), Some(5), Some("mirkwooddeep"), false),
            TrackId::BossDeep
        );
    }
}
