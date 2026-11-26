//! Native BGM, ambient loop, and SFX playback via `rodio` on Windows (`src/music.js` + `src/main.js`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmbientMode {
    None,
    Forest,
    ForestRain,
}

/// Choose ambient audio loops for the active scene (ADR 0063: mirkwood has rain, mirkwooddeep does not).
pub fn ambient_for_scene(in_dungeon: bool, stage_id: &str) -> AmbientMode {
    if !in_dungeon {
        AmbientMode::None
    } else if stage_id == "mirkwood" {
        AmbientMode::ForestRain
    } else {
        AmbientMode::Forest
    }
}

/// Compute `(forest_volume, rain_volume)` respecting mute and music toggles.
#[cfg(any(target_os = "windows", test))]
pub fn ambient_volumes_for(mode: AmbientMode, muted: bool, music_enabled: bool) -> (f32, f32) {
    if muted || !music_enabled {
        return (0.0, 0.0);
    }
    match mode {
        AmbientMode::None => (0.0, 0.0),
        AmbientMode::Forest => (0.22, 0.0),
        AmbientMode::ForestRain => (0.22, 0.20),
    }
}

#[cfg(target_os = "windows")]
mod win_audio {
    use super::{ambient_volumes_for, AmbientMode};
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
        forest_sink: Option<Sink>,
        rain_sink: Option<Sink>,
        current_track: Option<TrackId>,
        current_bgm_file: Option<String>,
        current_ambient: AmbientMode,
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
                forest_sink: None,
                rain_sink: None,
                current_track: None,
                current_bgm_file: None,
                current_ambient: AmbientMode::None,
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

        fn refresh_volumes(&self) {
            let vol = self.music_volume();
            if let Some(ref sink) = self.music_sink {
                sink.set_volume(vol);
            }
            let (forest_vol, rain_vol) =
                ambient_volumes_for(self.current_ambient, self.muted, self.music_enabled);
            if let Some(ref sink) = self.forest_sink {
                sink.set_volume(forest_vol);
            }
            if let Some(ref sink) = self.rain_sink {
                sink.set_volume(rain_vol);
            }
        }

        pub fn toggle_mute(&mut self) {
            self.muted = !self.muted;
            self.refresh_volumes();
        }

        pub fn toggle_music(&mut self) -> bool {
            self.music_enabled = !self.music_enabled;
            self.refresh_volumes();
            self.music_enabled
        }

        #[cfg(test)]
        pub fn current_ambient(&self) -> AmbientMode {
            self.current_ambient
        }

        #[cfg(test)]
        pub fn effective_ambient_volumes(&self) -> (f32, f32) {
            ambient_volumes_for(self.current_ambient, self.muted, self.music_enabled)
        }

        fn spawn_loop_sink(&self, rel: &str, volume: f32) -> Option<Sink> {
            let handle = self.handle.as_ref()?;
            let path = self.asset_root.join(rel);
            let bytes = fs::read(&path).ok()?;
            let decoder = Decoder::new(Cursor::new(bytes)).ok()?;
            let sink = Sink::try_new(handle).ok()?;
            sink.set_volume(volume);
            sink.append(decoder.repeat_infinite());
            Some(sink)
        }

        pub fn sync_ambient(&mut self, mode: AmbientMode) {
            if self.current_ambient == mode {
                return;
            }
            self.current_ambient = mode;
            let (forest_vol, rain_vol) =
                ambient_volumes_for(self.current_ambient, self.muted, self.music_enabled);

            let want_forest = matches!(mode, AmbientMode::Forest | AmbientMode::ForestRain);
            let want_rain = matches!(mode, AmbientMode::ForestRain);

            if !want_forest {
                if let Some(old) = self.forest_sink.take() {
                    old.stop();
                }
            } else if self.forest_sink.is_none() {
                self.forest_sink = self.spawn_loop_sink("assets/sfx/amb_forest_01.ogg", forest_vol);
            } else if let Some(ref sink) = self.forest_sink {
                sink.set_volume(forest_vol);
            }

            if !want_rain {
                if let Some(old) = self.rain_sink.take() {
                    old.stop();
                }
            } else if self.rain_sink.is_none() {
                self.rain_sink = self.spawn_loop_sink("assets/sfx/amb_rain_01.ogg", rain_vol);
            } else if let Some(ref sink) = self.rain_sink {
                sink.set_volume(rain_vol);
            }
        }

        pub fn sync_track(&mut self, track: TrackId) {
            if self.current_track == Some(track) && self.current_bgm_file.is_none() {
                return;
            }
            self.current_track = Some(track);
            self.current_bgm_file = None;
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

        pub fn sync_bgm_file(&mut self, rel: &str) {
            if self.current_bgm_file.as_deref() == Some(rel) {
                return;
            }
            let path = self.asset_root.join(rel);
            let Ok(bytes) = fs::read(&path) else {
                self.sync_track(music_rs::track_for(None, None, None, true));
                return;
            };
            self.current_bgm_file = Some(rel.to_string());
            self.current_track = None;
            let Some(ref handle) = self.handle else {
                return;
            };
            if let Some(old) = self.music_sink.take() {
                old.stop();
            }
            if let Ok(decoder) = Decoder::new(Cursor::new(bytes)) {
                if let Ok(sink) = Sink::try_new(handle) {
                    sink.set_volume(self.music_volume());
                    sink.append(decoder.repeat_infinite());
                    self.music_sink = Some(sink);
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
                        } else if matches!(ev.enemy_type.as_deref(), Some("cat" | "lugaruBoss")) {
                            Some("assets/sfx/bloodgaru_slayer.ogg")
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
                    "coinPickup" => {
                        let idx = ((ev.t * 100.0) as usize) % 5;
                        let files = [
                            "assets/sfx/coin_pick_01.ogg",
                            "assets/sfx/coin_pick_02.ogg",
                            "assets/sfx/coin_pick_03.ogg",
                            "assets/sfx/coin_pick_04.ogg",
                            "assets/sfx/coin_pick_05.ogg",
                        ];
                        (Some(files[idx]), 0.45)
                    }
                    "bombExplosion" => (Some("assets/sfx/bomb_ex.ogg"), 0.5),
                    "stonePillarBreak" => (Some("assets/sfx/tstone_break.ogg"), 0.48),
                    "levelUp" => (Some("assets/sfx/levup.ogg"), 0.52),
                    "gateOpen" => (Some("assets/sfx/ev_gate.ogg"), 0.48),
                    "resultRank" => (Some("assets/sfx/result_r1.ogg"), 0.5),
                    "rewardOpen" => (Some("assets/sfx/reward_open1.ogg"), 0.5),
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
    #[cfg(test)]
    use super::ambient_volumes_for;
    use super::AmbientMode;
    use core_rs::types::SoundEvent;
    use music_rs::TrackId;
    use std::path::Path;

    pub struct AudioEngine {
        muted: bool,
        music_enabled: bool,
        current_ambient: AmbientMode,
    }

    impl AudioEngine {
        pub fn new(_asset_root: &Path) -> Self {
            Self {
                muted: false,
                music_enabled: true,
                current_ambient: AmbientMode::None,
            }
        }

        pub fn toggle_mute(&mut self) {
            self.muted = !self.muted;
        }

        pub fn toggle_music(&mut self) -> bool {
            self.music_enabled = !self.music_enabled;
            self.music_enabled
        }

        #[cfg(test)]
        pub fn current_ambient(&self) -> AmbientMode {
            self.current_ambient
        }

        #[cfg(test)]
        pub fn effective_ambient_volumes(&self) -> (f32, f32) {
            ambient_volumes_for(self.current_ambient, self.muted, self.music_enabled)
        }

        pub fn sync_ambient(&mut self, mode: AmbientMode) {
            self.current_ambient = mode;
        }

        pub fn sync_track(&mut self, _track: TrackId) {}

        pub fn sync_bgm_file(&mut self, _rel: &str) {}

        pub fn play_events(&mut self, _events: &[SoundEvent]) {}
    }
}

pub use win_audio::AudioEngine;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_ambient_for_scene_matches_adr_0063() {
        assert_eq!(ambient_for_scene(false, "mirkwood"), AmbientMode::None);
        assert_eq!(ambient_for_scene(true, "mirkwood"), AmbientMode::ForestRain);
        assert_eq!(ambient_for_scene(true, "mirkwooddeep"), AmbientMode::Forest);
    }

    #[test]
    fn test_ambient_respects_mute_and_music_toggles() {
        let mut eng = AudioEngine::new(Path::new("."));
        eng.sync_ambient(AmbientMode::ForestRain);
        assert_eq!(eng.current_ambient(), AmbientMode::ForestRain);
        let (f, r) = eng.effective_ambient_volumes();
        assert!(f > 0.0 && r > 0.0);

        eng.toggle_mute();
        assert_eq!(eng.effective_ambient_volumes(), (0.0, 0.0));
        eng.toggle_mute();
        assert_eq!(eng.effective_ambient_volumes(), (f, r));

        assert!(!eng.toggle_music());
        assert_eq!(eng.effective_ambient_volumes(), (0.0, 0.0));
        assert!(eng.toggle_music());
        assert_eq!(eng.effective_ambient_volumes(), (f, r));

        eng.sync_ambient(AmbientMode::Forest);
        let (f2, r2) = eng.effective_ambient_volumes();
        assert!(f2 > 0.0 && r2 == 0.0);
    }
}
