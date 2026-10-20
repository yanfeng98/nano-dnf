#!/usr/bin/env python3
"""Extract the dungeon's voices and ambience out of the local DNF client.

`docs/adr/0058`: every monster and the player get the client's own voice, and
the rooms get the client's rain / forest loops and grass footsteps. The files
live in `SoundPacks/*.npk`; this script copies the chosen `.ogg` files into
`assets/sfx/` and writes the manifest the browser loads:

    assets/sfx/manifest.json
      { "files": ["sm_atk_01.ogg", ...],
        "map": { "player_attack": ["sm_atk_01.ogg", ...], ... } }

The logical keys are what `src/main.js` asks for; a key with several files is a
random variant. Only these files ship; the rest of the client's sound packs do
not.

    python3 assets/import_dnf_sounds.py --client "/home/luyanfeng/dnf-client/地下城与勇士"
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "sfx"

SWORDMAN = "sounds_char_swordman.npk"
MON_ACT1 = "sounds_mon_act1.npk"
AMB = "sounds_amb.npk"
AMB_EFFECT = "sounds_effect_amb.npk"

# logical key -> [(pack, entry), ...]
SOUNDS = {
    # ---- player: body, weapon, and one voice per skill -------------------
    "player_attack": [
        (SWORDMAN, "sounds/char/swordman/sm_atk_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_atk_02.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_atk_03.ogg"),
    ],
    "player_hurt": [
        (SWORDMAN, "sounds/char/swordman/sm_dmg_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_dmg_02.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_dmg_03.ogg"),
    ],
    "player_die": [(SWORDMAN, "sounds/char/swordman/sm_die.ogg")],
    "player_jump": [(SWORDMAN, "sounds/char/swordman/sm_jump.ogg")],
    "player_swing": [
        (SWORDMAN, "sounds/char/swordman/sm_triple1.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_triple2.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_triple3.ogg"),
    ],
    "player_skill_upSlash": [(SWORDMAN, "sounds/char/swordman/sm_upslash.ogg")],
    "player_skill_mountainBreaker": [(SWORDMAN, "sounds/char/swordman/sm_boongsan.ogg")],
    "player_skill_crossSlash": [(SWORDMAN, "sounds/char/swordman/sm_gorecross.ogg")],
    "player_skill_bloodSword": [
        (SWORDMAN, "sounds/char/swordman/sm_bloodriven_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_bloodriven_02.ogg"),
    ],
    "player_skill_frenzy": [(SWORDMAN, "sounds/char/swordman/sm_blood_rave_atk.ogg")],
    "player_skill_bloodyRave": [(SWORDMAN, "sounds/char/swordman/sm_blood_rave_storm.ogg")],
    "player_skill_rageBurst": [
        (SWORDMAN, "sounds/char/swordman/sm_bloodboom_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_bloodboom_02.ogg"),
    ],
    "player_skill_bloodSnatch": [(SWORDMAN, "sounds/char/swordman/sm_blood.ogg")],
    "player_skill_graspHead": [
        (SWORDMAN, "sounds/char/swordman/sm_gue_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_gue_02.ogg"),
    ],
    "player_skill_bloodEvil": [(SWORDMAN, "sounds/char/swordman/sm_bghost.ogg")],
    "player_skill_mountainRift": [
        (SWORDMAN, "sounds/char/swordman/sm_outrage_break_01.ogg"),
        (SWORDMAN, "sounds/char/swordman/sm_outrage_break_02.ogg"),
    ],
    "player_skill_berserk": [(SWORDMAN, "sounds/char/swordman/sm_flense.ogg")],
    "player_skill_hellbenter": [(SWORDMAN, "sounds/char/swordman/sm_ancient.ogg")],
    "player_skill_silverFall": [(SWORDMAN, "sounds/char/swordman/sm_wave.ogg")],

    # ---- goblin family ---------------------------------------------------
    "goblin_attack": [
        (MON_ACT1, "sounds/mon/act1/gbn_comm.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_talk_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_talk_02.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_talk_03.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_talk_04.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_talk_05.ogg"),
    ],
    "goblin_hurt": [
        (MON_ACT1, "sounds/mon/act1/gbn_dmg_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_dmg_02.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_dmg_03.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_dmg_04.ogg"),
    ],
    "goblin_die": [
        (MON_ACT1, "sounds/mon/act1/gbn_die_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/gbn_die_02.ogg"),
    ],
    "goblin_throw": [(MON_ACT1, "sounds/mon/act1/gbn_thw.ogg")],
    "goblin_scared": [(MON_ACT1, "sounds/mon/act1/gbn_scared.ogg")],
    "goblin_fright": [(MON_ACT1, "sounds/mon/act1/gbn_fright.ogg")],
    "goblin_spin": [(MON_ACT1, "sounds/mon/act1/gbn_spin.ogg")],
    "goblin_spinattack": [(MON_ACT1, "sounds/mon/act1/gbn_spinatk.ogg")],
    "cursed_attack": [(MON_ACT1, "sounds/mon/act1/bloodgaru_slayer.ogg")],
    "cursed_hurt": [
        (MON_ACT1, "sounds/mon/act1/bloodgaru_dmg_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/bloodgaru_dmg_02.ogg"),
    ],
    "cursed_die": [(MON_ACT1, "sounds/mon/act1/gbn_die_02.ogg")],
    "elite_attack": [(MON_ACT1, "sounds/mon/act1/b_shauta_01.ogg")],
    "elite_idle": [(MON_ACT1, "sounds/mon/act1/gbn_comm.ogg")],

    # ---- tau family (brute and 牛头巨兽) ---------------------------------
    "tau_attack": [
        (MON_ACT1, "sounds/mon/act1/tau_axeswing.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_crash.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_rush.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_comm.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_talk_01.ogg"),
    ],
    "tau_hurt": [
        (MON_ACT1, "sounds/mon/act1/tau_dmg_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_dmg_02.ogg"),
        (MON_ACT1, "sounds/mon/act1/tau_dmg_03.ogg"),
    ],
    "tau_die": [(MON_ACT1, "sounds/mon/act1/tau_die.ogg")],
    "tau_roar": [(MON_ACT1, "sounds/mon/act1/tau_roar.ogg")],
    "tau_breath": [(MON_ACT1, "sounds/mon/act1/tau_breath.ogg")],
    "boss_attack": [
        (MON_ACT1, "sounds/mon/act1/b_taubeast_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/b_tau_talk_01.ogg"),
        (MON_ACT1, "sounds/mon/act1/b_tauarmy_01.ogg"),
    ],
    "boss_roar": [(MON_ACT1, "sounds/mon/act1/b_taubeast_01.ogg")],

    # ---- ambience and footsteps ------------------------------------------
    "rain_loop": [(AMB, "sounds/amb/amb_rain_01.ogg")],
    "forest_loop": [(AMB, "sounds/amb/amb_forest_01.ogg")],
    "step_grass": [
        (AMB_EFFECT, "sounds/effect/amb/grass_pass.ogg"),
        (AMB_EFFECT, "sounds/effect/amb/grasshash.ogg"),
    ],
    "step_monster": [(AMB_EFFECT, "sounds/effect/amb/grass_pass.ogg")],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()
    packs = {}
    handles = []
    OUT.mkdir(parents=True, exist_ok=True)
    files = []
    mapping = {}
    for logical, entries in SOUNDS.items():
        names = []
        for pack_name, entry in entries:
            if pack_name not in packs:
                handle = open(args.client / "SoundPacks" / pack_name, "rb")
                handles.append(handle)
                packs[pack_name] = NPK.open(handle)
            data = None
            for item in packs[pack_name].files:
                if item.name.replace("\\", "/") == entry:
                    data = bytes(item.data)
                    break
            if data is None:
                raise SystemExit(f"{entry} not found in {pack_name}")
            target = OUT / pathlib.Path(entry).name
            target.write_bytes(data)
            if target.name not in files:
                files.append(target.name)
            names.append(target.name)
        mapping[logical] = names
    manifest = {
        "note": "由 assets/import_dnf_sounds.py 从客户端 SoundPacks 抽出；别手改。",
        "files": sorted(files),
        "map": mapping,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(files)} files + manifest.json to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
