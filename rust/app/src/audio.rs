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
        music_enabled: bool,
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
                music_enabled: true,
                asset_root: asset_root.to_path_buf(),
                sfx_cache: HashMap::new(),
            }
        }

        fn music_volume(&self) -> f32 {
            if self.muted || !self.music_enabled {
                0.0
            } else {
                0.35
            }
        }

        pub fn toggle_mute(&mut self) {
            self.muted = !self.muted;
            let vol = self.music_volume();
            if let Some(ref sink) = self.music_sink {
                sink.set_volume(vol);
            }
        }

        pub fn toggle_music(&mut self) -> bool {
            self.music_enabled = !self.music_enabled;
            let vol = self.music_volume();
            if let Some(ref sink) = self.music_sink {
                sink.set_volume(vol);
            }
            self.music_enabled
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
                        sink.set_volume(self.music_volume());
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
                let is_tau = matches!(ev.enemy_type.as_deref(), Some("boss" | "tau" | "deepBoss"));
                let (file, vol) = match ev.kind.as_str() {
                    "playerJump" => (Some("assets/sfx/sm_jump.ogg"), 0.45),
                    "playerLand" | "playerStep" => (Some("assets/sfx/grass_pass.ogg"), 0.18),
                    "playerAttack" => (
                        match ev.stage.unwrap_or(0) {
                            0 => Some("assets/sfx/sm_triple1.ogg"),
                            1 => Some("assets/sfx/sm_triple2.ogg"),
                            _ => Some("assets/sfx/sm_triple3.ogg"),
                        },
                        0.45,
                    ),
                    "playerSkill" => (
                        match ev.skill_id.as_deref() {
                            Some("upSlash") => Some("assets/sfx/sm_upslash.ogg"),
                            Some("normalWave") => Some("assets/sfx/sm_wave.ogg"),
                            Some("crossSlash") => Some("assets/sfx/sm_gorecross.ogg"),
                            Some("mountainBreaker") => Some("assets/sfx/sm_boongsan.ogg"),
                            Some("bloodyRave") => Some("assets/sfx/sm_blood_rave_atk.ogg"),
                            Some("rageBurst") => Some("assets/sfx/sm_bloodboom_01.ogg"),
                            Some("mountainRift") => Some("assets/sfx/sm_outrage_break_01.ogg"),
                            Some("bloodSword") => Some("assets/sfx/sm_blood.ogg"),
                            Some("ghostSlash") => Some("assets/sfx/sm_bghost.ogg"),
                            Some("frenzy") => Some("assets/sfx/sm_flense.ogg"),
                            Some("berserk") => Some("assets/sfx/sm_ancient.ogg"),
                            Some("hellbenter" | "hellbenterSlam") => {
                                Some("assets/sfx/sm_bloodriven_01.ogg")
                            }
                            _ => Some("assets/sfx/sm_atk_01.ogg"),
                        },
                        0.45,
                    ),
                    "playerHurt" => (Some("assets/sfx/sm_dmg_01.ogg"), 0.45),
                    "playerDie" => (Some("assets/sfx/sm_die.ogg"), 0.5),
                    "enemyHurt" => (
                        if is_tau {
                            Some("assets/sfx/tau_dmg_01.ogg")
                        } else if ev.enemy_type.as_deref() == Some("cat") {
                            Some("assets/sfx/bloodgaru_dmg_01.ogg")
                        } else {
                            Some("assets/sfx/gbn_dmg_01.ogg")
                        },
                        0.42,
                    ),
                    "enemyDie" => (
                        if is_tau {
                            Some("assets/sfx/tau_die.ogg")
                        } else {
                            Some("assets/sfx/gbn_die_01.ogg")
                        },
                        0.45,
                    ),
                    "enemyAttack" => (
                        if is_tau {
                            match ev.attack_kind.as_deref() {
                                Some("lunge" | "charge") => Some("assets/sfx/tau_rush.ogg"),
                                Some("slam") => Some("assets/sfx/tau_crash.ogg"),
                                _ => Some("assets/sfx/tau_axeswing.ogg"),
                            }
                        } else if matches!(ev.attack_kind.as_deref(), Some("spin" | "spinDash")) {
                            Some("assets/sfx/gbn_spinatk.ogg")
                        } else {
                            Some("assets/sfx/gbn_comm.ogg")
                        },
                        0.38,
                    ),
                    "projectileSpawn" => (
                        match ev.native_object {
                            Some(30001) => Some("assets/sfx/throw_stone.ogg"),
                            Some(30021) => Some("assets/sfx/throw_bomb.ogg"),
                            Some(30057) => Some("assets/sfx/icicle_fire.ogg"),
                            Some(30047) => Some("assets/sfx/sizzle_fire.ogg"),
                            _ => Some("assets/sfx/gbn_thw.ogg"),
                        },
                        0.4,
                    ),
                    "projectileHit" => (
                        match ev.native_object {
                            Some(30057) => Some("assets/sfx/icicle_hit.ogg"),
                            Some(30047) => Some("assets/sfx/sizzle_hit.ogg"),
                            _ => None,
                        },
                        0.4,
                    ),
                    "bossRoar" => (Some("assets/sfx/tau_roar.ogg"), 0.5),
                    "coinPickup" => (Some("assets/sfx/coin_pick_01.ogg"), 0.45),
                    "bombExplosion" => (Some("assets/sfx/bomb_ex.ogg"), 0.5),
                    "stonePillarBreak" => (Some("assets/sfx/tstone_break.ogg"), 0.48),
                    _ => (None, 0.45),
                };
                if let Some(rel) = file {
                    self.play_sfx(rel, vol);
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

    pub struct AudioEngine {
        music_enabled: bool,
    }

    impl AudioEngine {
        pub fn new(_asset_root: &Path) -> Self {
            Self {
                music_enabled: true,
            }
        }

        pub fn toggle_mute(&mut self) {}

        pub fn toggle_music(&mut self) -> bool {
            self.music_enabled = !self.music_enabled;
            self.music_enabled
        }

        pub fn sync_track(&mut self, _track: TrackId) {}

        pub fn play_events(&mut self, _events: &[SoundEvent]) {}
    }
}

pub use win_audio::AudioEngine;
