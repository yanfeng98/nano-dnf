//! Native BGM and SFX playback via `rodio` on Windows (`src/music.js` + `src/main.js`).

#[cfg(target_os = "windows")]
mod win_audio {
    use core_rs::types::SoundEvent;
    use music_rs::{track_info, TrackId};
    use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
    use std::collections::HashMap;
    use std::fs;
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    pub struct AudioEngine {
        _stream: Option<OutputStream>,
        handle: Option<OutputStreamHandle>,
        music_sink: Option<Sink>,
        current_track: Option<TrackId>,
        muted: bool,
        asset_root: PathBuf,
        sfx_cache: HashMap<String, Arc<[u8]>>,
    }

    impl AudioEngine {
        pub fn new(asset_root: &Path) -> Self {
            let (stream, handle) = match OutputStream::try_default() {
                Ok((s, h)) => (Some(s), Some(h)),
                Err(_) => (None, None),
            };
            Self {
                _stream: stream,
                handle,
                music_sink: None,
                current_track: None,
                muted: false,
                asset_root: asset_root.to_path_buf(),
                sfx_cache: HashMap::new(),
            }
        }

        pub fn toggle_mute(&mut self) {
            self.muted = !self.muted;
            if let Some(ref sink) = self.music_sink {
                sink.set_volume(if self.muted { 0.0 } else { 0.35 });
            }
        }

        pub fn sync_track(&mut self, track: TrackId) {
            if self.current_track == Some(track) {
                return;
            }
            self.current_track = Some(track);
            let Some(ref handle) = self.handle else {
                return;
            };
            if let Some(old) = self.music_sink.take() {
                old.stop();
            }
            let info = track_info(track);
            let path = self.asset_root.join(info.file);
            if let Ok(bytes) = fs::read(&path) {
                if let Ok(decoder) = Decoder::new(Cursor::new(bytes)) {
                    if let Ok(sink) = Sink::try_new(handle) {
                        sink.set_volume(if self.muted { 0.0 } else { 0.35 });
                        sink.append(decoder.repeat_infinite());
                        self.music_sink = Some(sink);
                    }
                }
            }
        }

        pub fn play_events(&mut self, events: &[SoundEvent]) {
            if self.muted || self.handle.is_none() {
                return;
            }
            for ev in events {
                let file = match ev.kind.as_str() {
                    "playerJump" => Some("assets/sfx/sm_jump.ogg"),
                    "playerAttack" => match ev.stage.unwrap_or(0) {
                        0 => Some("assets/sfx/sm_triple1.ogg"),
                        1 => Some("assets/sfx/sm_triple2.ogg"),
                        _ => Some("assets/sfx/sm_triple3.ogg"),
                    },
                    "playerSkill" => match ev.skill_id.as_deref() {
                        Some("upSlash") => Some("assets/sfx/sm_upslash.ogg"),
                        Some("normalWave") => Some("assets/sfx/sm_wave.ogg"),
                        Some("crossSlash") => Some("assets/sfx/sm_gorecross.ogg"),
                        Some("mountainBreaker") => Some("assets/sfx/sm_boongsan.ogg"),
                        Some("bloodyRave") => Some("assets/sfx/sm_blood_rave_atk.ogg"),
                        Some("rageBurst") => Some("assets/sfx/sm_bloodboom_01.ogg"),
                        Some("mountainRift") => Some("assets/sfx/sm_outrage_break_01.ogg"),
                        _ => Some("assets/sfx/sm_atk_01.ogg"),
                    },
                    "playerHurt" => Some("assets/sfx/sm_dmg_01.ogg"),
                    "playerDie" => Some("assets/sfx/sm_die.ogg"),
                    "enemyHurt" => Some("assets/sfx/gbn_dmg_01.ogg"),
                    "enemyDie" => Some("assets/sfx/gbn_die_01.ogg"),
                    "bossRoar" => Some("assets/sfx/tau_roar.ogg"),
                    "coinPickup" => Some("assets/sfx/coin_pick_01.ogg"),
                    "bombExplosion" => Some("assets/sfx/bomb_ex.ogg"),
                    "stonePillarBreak" => Some("assets/sfx/tstone_break.ogg"),
                    _ => None,
                };
                if let Some(rel) = file {
                    self.play_sfx(rel, 0.45);
                }
            }
        }

        fn play_sfx(&mut self, rel: &str, volume: f32) {
            let Some(ref handle) = self.handle else {
                return;
            };
            if !self.sfx_cache.contains_key(rel) {
                let path = self.asset_root.join(rel);
                if let Ok(bytes) = fs::read(&path) {
                    self.sfx_cache.insert(rel.to_string(), Arc::from(bytes));
                } else {
                    return;
                }
            }
            let Some(bytes) = self.sfx_cache.get(rel) else {
                return;
            };
            let owned = bytes.to_vec();
            if let Ok(decoder) = Decoder::new(Cursor::new(owned)) {
                if let Ok(sink) = Sink::try_new(handle) {
                    sink.set_volume(volume);
                    sink.append(decoder);
                    sink.detach();
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_audio {
    use core_rs::types::SoundEvent;
    use music_rs::TrackId;
    use std::path::Path;

    pub struct AudioEngine;

    impl AudioEngine {
        pub fn new(_asset_root: &Path) -> Self {
            Self
        }

        pub fn toggle_mute(&mut self) {}

        pub fn sync_track(&mut self, _track: TrackId) {}

        pub fn play_events(&mut self, _events: &[SoundEvent]) {}
    }
}

pub use win_audio::AudioEngine;
