#!/usr/bin/env python3
"""Reproducibly extract DNF Script_70.pvf truth tables for monsters, projectiles,
dungeons/branch rooms, and drop tables into rust/core-rs/src/pvf_truth.json and
docs/pvf-truth.md.

Usage:
    python3 scripts/extract_pvf_truth.py [--pvf /mnt/c/dnf/地下城与勇士/Script_70.pvf]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from client_pvf import PvfArchive  # noqa: E402

DEFAULT_PVF = Path("/mnt/c/dnf/地下城与勇士/Script_70.pvf")
OUT_JSON = REPO_ROOT / "rust" / "core-rs" / "src" / "pvf_truth.json"
OUT_DOC = REPO_ROOT / "docs" / "pvf-truth.md"

# Mapping from core-rs enemy kind -> Script_70.pvf .mob path
MONSTER_SOURCES: dict[str, str] = {
    "grunt": "monster/goblin/goblin.mob",
    "coward": "monster/goblin/cowardgoblin.mob",
    "caster": "monster/goblin/goblinthrower.mob",
    "burningThrower": "monster/goblin/goblinthrower.mob",
    "goblinRed": "monster/goblin/hillgab.mob",
    "cursedRed": "monster/goblin/flaghillgab.mob",
    "goblinBlue": "monster/goblin/seagab.mob",
    "elite": "monster/goblin/goblintaskmaster.mob",
    "deepElite": "monster/goblin/goblintaskmaster.mob",
    "throwerElite": "monster/goblin/goblinthrowertaskmaster.mob",
    "brute": "monster/tau/tauarmy.mob",
    "boss": "monster/tau/taubeast.mob",
    "cat": "monster/lugaru/lugaru.mob",
    "lugaruBoss": "monster/lugaru/kurogaru.mob",
}

# Simplified Chinese display names for PVF stackable IDs (verified from stackable/stackable.kor.str)
ITEM_NAME_ZH: dict[int, tuple[str, str]] = {
    1000: ("野生草莓", "white"),
    1001: ("烤硬的黑面包", "white"),
    1004: ("苎麻花叶", "white"),
    1047: ("命运硬币", "cyan"),
    1062: ("越桔", "white"),
    1065: ("魔力之花", "cyan"),
    6003: ("投掷石块", "white"),
}

PROJECTILE_SPECS: list[dict[str, object]] = [
    {
        "id": 30001,
        "label": "投掷石块",
        "obj": "passiveobject/monster/goblin/throwstone.obj",
        "ptl": "monster/goblin/particle/throwstone.ptl",
        "destroy_ptl": "passiveobject/monster/goblin/particle/throwstonedestroy.ptl",
        "atk": "passiveobject/monster/goblin/attackinfo/throwstone.atk",
    },
    {
        "id": 30021,
        "label": "投掷十夫长炸弹",
        "obj": "passiveobject/monster/goblin/gobflybomb.obj",
        "ptl": "monster/goblin/particle/aimingbomb.ptl",
        "destroy_ptl": "passiveobject/monster/goblin/particle/flybombpiece.ptl",
        "atk": "passiveobject/monster/goblin/attackinfo/flybomb.atk",
    },
    {
        "id": 30022,
        "label": "炸弹爆破子对象",
        "obj": "passiveobject/monster/goblin/gobflybombsub.obj",
        "ptl": None,
        "destroy_ptl": None,
        "atk": "passiveobject/monster/goblin/attackinfo/flybombsub.atk",
    },
    {
        "id": 30047,
        "label": "赤哥布林火弹",
        "obj": "passiveobject/monster/goblin/hillgabsizzle.obj",
        "ptl": "passiveobject/common/particle/firemissilegerocenter.ptl",
        "destroy_ptl": None,
        "atk": "passiveobject/monster/goblin/attackinfo/hillgabsizzle.atk",
    },
    {
        "id": 30057,
        "label": "青哥布林冰弹",
        "obj": "passiveobject/monster/goblin/seagabicicle.obj",
        "ptl": "passiveobject/common/particle/icemissile.ptl",
        "destroy_ptl": None,
        "atk": "passiveobject/monster/goblin/attackinfo/seagabicicle.atk",
    },
]

# Map PVF .mob paths back to core-rs enemy kinds for branch room summaries
MOB_TO_KIND: dict[str, str] = {
    "Goblin/Goblin.mob": "grunt",
    "Goblin/CowardGoblin.mob": "coward",
    "Goblin/GoblinThrower.mob": "caster",
    "Goblin/HillGab.mob": "goblinRed",
    "Goblin/FlagHillGab.mob": "cursedRed",
    "Goblin/SeaGab.mob": "goblinBlue",
    "Goblin/GoblinTaskmaster.mob": "elite",
    "Goblin/GoblinThrowerTaskmaster.mob": "throwerElite",
    "Tau/TauArmy.mob": "brute",
    "Tau/TauBeast.mob": "boss",
    "Lugaru/Lugaru.mob": "cat",
    "Lugaru/Kurogaru.mob": "lugaruBoss",
}


def to_i32(val: int) -> int:
    return val - 0x100000000 if val >= 0x80000000 else val


def parse_sections(tokens: list[list[object]]) -> dict[str, list[list[object]]]:
    sections: dict[str, list[list[object]]] = {}
    cur: str | None = None
    buf: list[object] = []
    for kind, val in tokens:
        if kind == 5 and isinstance(val, str) and val.startswith("["):
            if cur is not None:
                sections.setdefault(cur, []).append(buf)
            cur = val
            buf = []
        else:
            buf.append(val)
    if cur is not None:
        sections.setdefault(cur, []).append(buf)
    return sections


def parse_ability_multipliers(sec: dict[str, list[list[object]]]) -> dict[str, int]:
    out: dict[str, int] = {}
    rows = sec.get("[ability category]", [])
    if not rows:
        return out
    flat = rows[0]
    i = 0
    while i + 2 < len(flat):
        key = flat[i]
        op = flat[i + 1]
        val = flat[i + 2]
        if isinstance(key, str) and op == "*" and isinstance(val, int):
            out[key.strip("[]")] = val
            i += 3
        else:
            i += 1
    return out


def parse_throw_attack(sec: dict[str, list[list[object]]]) -> dict[str, object] | None:
    rows = sec.get("[throw attack]", [])
    if not rows:
        return None
    flat = rows[0]
    kv: dict[str, object] = {}
    i = 0
    while i + 1 < len(flat):
        if isinstance(flat[i], str) and flat[i].startswith("["):
            kv[flat[i]] = flat[i + 1]
            i += 2
        else:
            i += 1
    if "[passive object index]" not in kv:
        return None
    return {
        "passiveObject": int(kv["[passive object index]"]),
        "ptl": str(kv.get("[passive object filename]", "")).replace("\\", "/"),
        "throwFrame": int(kv.get("[throw frame]", 0)),
        "startOffset": [
            int(kv.get("[passive object start x cood]", 0)),
            int(kv.get("[passive object start y cood]", 0)),
            int(kv.get("[passive object start z cood]", 0)),
        ],
        "sound": str(kv.get("[throw sound]", "")),
    }


def parse_drops(sec: dict[str, list[list[object]]]) -> list[dict[str, object]]:
    rows = sec.get("[item]", [])
    if not rows:
        return []
    flat = rows[0]
    drops: list[dict[str, object]] = []
    for i in range(0, len(flat) - 1, 2):
        if isinstance(flat[i], int) and isinstance(flat[i + 1], int):
            item_id = flat[i]
            weight = flat[i + 1]
            zh_name, tone = ITEM_NAME_ZH.get(item_id, (f"物品#{item_id}", "white"))
            drops.append(
                {
                    "itemId": item_id,
                    "name": zh_name,
                    "tone": tone,
                    "weight": weight,
                }
            )
    return drops


def parse_ptl(tokens: list[list[object]]) -> dict[str, object]:
    axis: str | None = None
    data: dict[str, object] = {}
    i = 0
    while i < len(tokens):
        _, val = tokens[i]
        if val in ("[x axis]", "[y axis]", "[z axis]"):
            axis = str(val)[1]
            i += 1
            continue
        if val == "[move type]" and i + 1 < len(tokens):
            data[f"{axis}_move_type"] = str(tokens[i + 1][1]).strip("[]")
            i += 2
            continue
        if val == "[move variable 1]" and i + 2 < len(tokens):
            data[f"{axis}_var1"] = [to_i32(int(tokens[i + 1][1])), to_i32(int(tokens[i + 2][1]))]
            i += 3
            continue
        if val == "[move variable 2]" and i + 2 < len(tokens):
            data[f"{axis}_var2"] = [to_i32(int(tokens[i + 1][1])), to_i32(int(tokens[i + 2][1]))]
            i += 3
            continue
        if val == "[gravity]" and i + 1 < len(tokens):
            data["gravity"] = to_i32(int(tokens[i + 1][1]))
            i += 2
            continue
        if val == "[rotation angle]" and i + 3 < len(tokens):
            data["rotation_angle"] = [
                to_i32(int(tokens[i + 1][1])),
                to_i32(int(tokens[i + 2][1])),
                to_i32(int(tokens[i + 3][1])),
            ]
            i += 4
            continue
        if val == "[life time]" and i + 1 < len(tokens):
            data["life_ms"] = to_i32(int(tokens[i + 1][1]))
            i += 2
            continue
        if val == "[landing type]" and i + 1 < len(tokens):
            data["landing_type"] = str(tokens[i + 1][1]).strip("[]")
            i += 2
            continue
        if val == "[maximum create number]" and i + 1 < len(tokens):
            data["max_create"] = to_i32(int(tokens[i + 1][1]))
            i += 2
            continue
        i += 1
    return data


def parse_map_roster(pvf: PvfArchive, map_path: str, monster_lst: dict[int, str]) -> dict[str, int]:
    toks = pvf.tokens(map_path)
    in_mon = False
    buf: list[object] = []
    for _, v in toks:
        if v == "[monster]":
            in_mon = True
            continue
        if v == "[/monster]":
            in_mon = False
            continue
        if in_mon:
            buf.append(v)
    counts: dict[str, int] = {}
    i = 0
    while i + 9 < len(buf):
        mid = buf[i]
        tag = buf[i + 8]
        if isinstance(mid, int) and isinstance(tag, str) and tag.startswith("["):
            mob_path = monster_lst.get(mid)
            if mob_path and mob_path in MOB_TO_KIND:
                kind = MOB_TO_KIND[mob_path]
                counts[kind] = counts.get(kind, 0) + 1
            i += 10
        else:
            i += 1
    return counts


def extract(pvf_path: Path) -> dict[str, object]:
    with PvfArchive(pvf_path) as pvf:
        mtoks = pvf.tokens("monster/monster.lst")
        monster_lst = {int(mtoks[i][1]): str(mtoks[i + 1][1]) for i in range(0, len(mtoks) - 1, 2)}

        monsters: dict[str, object] = {}
        for kind, mob_path in MONSTER_SOURCES.items():
            sec = parse_sections(pvf.tokens(mob_path))
            sight = int(sec["[sight]"][0][0]) if "[sight]" in sec else 300
            warlike = int(sec["[warlike]"][0][0]) if "[warlike]" in sec else 50
            attack_delay_ms = int(sec["[attack delay]"][0][0]) if "[attack delay]" in sec else 2000
            move_speed = (
                [int(v) for v in sec["[move speed]"][0][:2]]
                if "[move speed]" in sec
                else [300, 300]
            )
            width = [int(v) for v in sec["[width]"][0][:2]] if "[width]" in sec else [40, 10]
            level_range = (
                [int(v) for v in sec["[level]"][0][:2]] if "[level]" in sec else [1, 1]
            )
            categories = (
                [str(v).strip("[]") for v in sec["[category]"][0] if isinstance(v, str)]
                if "[category]" in sec
                else []
            )
            throw_attack = parse_throw_attack(sec)
            if kind == "throwerElite" and throw_attack is None:
                # goblinthrowertaskmaster declares passive object 30021 via [int data]
                int_data = sec.get("[int data]", [[30021]])[0]
                throw_attack = {
                    "passiveObject": int(int_data[0]),
                    "ptl": "monster/goblin/particle/aimingbomb.ptl",
                    "throwFrame": 2,
                    "startOffset": [20, 0, 60],
                    "sound": "THROW_STONE",
                }
            monsters[kind] = {
                "source": mob_path,
                "sight": sight,
                "warlike": warlike,
                "attackDelayMs": attack_delay_ms,
                "moveSpeed": move_speed,
                "width": width,
                "levelRange": level_range,
                "categories": categories,
                "abilityMultipliers": parse_ability_multipliers(sec),
                "throwAttack": throw_attack,
                "drops": parse_drops(sec),
            }

        projectiles: dict[str, object] = {}
        for spec in PROJECTILE_SPECS:
            pid = int(spec["id"])
            obj_path = str(spec["obj"])
            ptl_path = spec["ptl"]
            destroy_ptl_path = spec["destroy_ptl"]
            atk_path = str(spec["atk"])

            osec = parse_sections(pvf.tokens(obj_path))
            piercing_raw = int(osec["[piercing power]"][0][0]) if "[piercing power]" in osec else 0
            piercing = max(0, to_i32(piercing_raw))
            sub_obj = (
                int(osec["[int data]"][0][0])
                if "[int data]" in osec and pid == 30021
                else None
            )

            ptl_data = parse_ptl(pvf.tokens(str(ptl_path))) if ptl_path else {}
            destroy_data = (
                parse_ptl(pvf.tokens(str(destroy_ptl_path))) if destroy_ptl_path else {}
            )

            atk_tokens = pvf.tokens(atk_path)
            asec = parse_sections(atk_tokens)
            damage_bonus = (
                to_i32(int(asec["[damage bonus]"][0][0])) if "[damage bonus]" in asec else 0
            )
            damage_reaction = "damage"
            for idx in range(len(atk_tokens) - 1):
                if atk_tokens[idx][1] == "[damage reaction]":
                    damage_reaction = str(atk_tokens[idx + 1][1]).strip("[]")
                    break
            hit_wav = ""
            if "[hit wav]" in asec:
                for row in asec["[hit wav]"]:
                    if row and str(row[0]):
                        hit_wav = str(row[0])

            speed_x = ptl_data.get("x_var1", [0, 0])[0]
            speed_z = (
                ptl_data.get("z_var1", [0, 0])[0]
                if ptl_data.get("z_move_type") == "straight line"
                else 0
            )
            z_sine_amp = (
                ptl_data.get("z_var1", [0, 0])[0] if ptl_data.get("z_move_type") == "sin" else 0
            )
            z_sine_deg = (
                ptl_data.get("z_var2", [0, 0])[0] if ptl_data.get("z_move_type") == "sin" else 0
            )

            projectiles[str(pid)] = {
                "id": pid,
                "label": spec["label"],
                "objSource": obj_path,
                "ptlSource": ptl_path,
                "destroyPtlSource": destroy_ptl_path,
                "atkSource": atk_path,
                "speedX": speed_x,
                "speedZ": speed_z,
                "gravity": int(ptl_data.get("gravity", 0)),
                "angleDeg": int(ptl_data.get("rotation_angle", [0, 0, 0])[1]),
                "lifeMs": int(ptl_data.get("life_ms", 0)),
                "landingType": str(ptl_data.get("landing_type", "vanish")),
                "piercingPower": piercing,
                "zSineAmp": z_sine_amp,
                "zSineDegPerSec": z_sine_deg,
                "destroyParticleCount": int(destroy_data.get("max_create", 0)),
                "spawnSubObject": sub_obj,
                "damageBonus": damage_bonus,
                "damageReaction": damage_reaction,
                "hitWav": hit_wav,
            }

        stages: dict[str, object] = {}
        stage_map_samples = {
            "mirkwood": (
                "dungeon/act1/mirkwood.dgn",
                [
                    "map/mirkwood/202.map",
                    "map/mirkwood/203.map",
                    "map/mirkwood/207.map",
                    "map/mirkwood/208.map",
                    "map/mirkwood/213.map",
                    "map/mirkwood/218.map",
                ],
            ),
            "mirkwooddeep": (
                "dungeon/act1/mirkwooddeep.dgn",
                [
                    "map/mirkwooddeep/402.map",
                    "map/mirkwooddeep/406.map",
                    "map/mirkwooddeep/408.map",
                    "map/mirkwooddeep/413.map",
                    "map/mirkwooddeep/419.map",
                    "map/mirkwooddeep/425.map",
                ],
            ),
        }
        for stage_id, (dgn_path, sample_maps) in stage_map_samples.items():
            dsec = parse_sections(pvf.tokens(dgn_path))
            basis_level = int(dsec["[basis level]"][0][0]) if "[basis level]" in dsec else 1
            min_level = (
                int(dsec["[minimum required level]"][0][0])
                if "[minimum required level]" in dsec
                else 1
            )
            exp_scale = (
                round(float(dsec["[experience increasing point]"][0][0]), 4)
                if "[experience increasing point]" in dsec
                else 1.0
            )
            champions = [int(v) for v in dsec.get("[champion]", [[]])[0]]
            # Parse breakable drop items from [special passive object item]
            breakable_drops: list[dict[str, object]] = []
            seen_ids: set[int] = set()
            sp_raw = dsec.get("[special passive object item]", [[]])[0]
            for idx in range(len(sp_raw) - 1):
                val = sp_raw[idx]
                if isinstance(val, int) and val in ITEM_NAME_ZH and val not in seen_ids:
                    seen_ids.add(val)
                    zh_name, tone = ITEM_NAME_ZH[val]
                    breakable_drops.append(
                        {
                            "itemId": val,
                            "name": zh_name,
                            "tone": tone,
                            "weight": int(sp_raw[idx + 1]),
                        }
                    )
            branch_rooms = []
            for mp in sample_maps:
                if mp in pvf.entries:
                    roster = parse_map_roster(pvf, mp, monster_lst)
                    branch_rooms.append({"mapSource": mp, "roster": roster})
            stages[stage_id] = {
                "source": dgn_path,
                "basisLevel": basis_level,
                "minLevel": min_level,
                "expScale": exp_scale,
                "championCounts": champions,
                "breakableDrops": breakable_drops,
                "branchRooms": branch_rooms,
            }

        return {
            "sourceArchive": "Script_70.pvf",
            "monsters": monsters,
            "projectiles": projectiles,
            "stages": stages,
        }


def render_markdown(data: dict[str, object]) -> str:
    lines: list[str] = [
        "# Script_70.pvf 真值解包总表",
        "",
        "> 由 `scripts/extract_pvf_truth.py` 直接从本地 `Script_70.pvf` 解包生成，同步嵌入 `rust/core-rs/src/pvf_truth.json`。",
        "> 遵循 ADR 0074：参考录像可观测内容为第一铁律，底层怪物 AI、投射物粒子、支路房间与掉落参数由本表驱动。",
        "",
        "## 1. 怪物 AI 与属性真值（`.mob`）",
        "",
        "| Kind | PVF 源文件 | Sight (px) | Warlike | Attack Delay (ms) | Move Speed | Width (w,d) | Level | 掉落表 (`[item]`) |",
        "| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |",
    ]
    monsters = data["monsters"]
    assert isinstance(monsters, dict)
    for kind, m in monsters.items():
        drops = ", ".join(f"{d['name']}({d['itemId']}:{d['weight']})" for d in m["drops"])
        lines.append(
            f"| `{kind}` | `{m['source']}` | {m['sight']} | {m['warlike']} | {m['attackDelayMs']} | "
            f"{m['moveSpeed'][0]}/{m['moveSpeed'][1]} | {m['width'][0]}×{m['width'][1]} | "
            f"{m['levelRange'][0]}–{m['levelRange'][1]} | {drops} |"
        )

    lines.extend(
        [
            "",
            "## 2. 投射物与粒子真值（`.obj` / `.ptl` / `.atk`）",
            "",
            "| ID | 名称 | VX | VZ | Gravity | Angle | Life (ms) | Landing | Piercing | SubObj | Reaction | 源文件 |",
            "| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |",
        ]
    )
    projectiles = data["projectiles"]
    assert isinstance(projectiles, dict)
    for pid, p in projectiles.items():
        sub = str(p["spawnSubObject"]) if p["spawnSubObject"] else "-"
        lines.append(
            f"| `{pid}` | {p['label']} | {p['speedX']} | {p['speedZ']} | {p['gravity']} | "
            f"{p['angleDeg']}° | {p['lifeMs']} | `{p['landingType']}` | {p['piercingPower']} | "
            f"{sub} | `{p['damageReaction']}` | `{p['objSource']}` |"
        )

    lines.extend(
        [
            "",
            "## 3. 副本成长参数与支路房间名册（`.dgn` / `.map`）",
            "",
        ]
    )
    stages = data["stages"]
    assert isinstance(stages, dict)
    for sid, s in stages.items():
        bdrops = ", ".join(
            f"{d['name']}({d['itemId']}:{d['weight']})" for d in s["breakableDrops"]
        )
        lines.append(f"### `{sid}` (`{s['source']}`)")
        lines.append(
            f"- 基准等级: **Lv.{s['basisLevel']}**（准入 Lv.{s['minLevel']}），经验倍率: **{s['expScale']}**，可破坏物掉落: {bdrops}"
        )
        lines.append("")
        lines.append("| 支路 `.map` | 怪物名册 |")
        lines.append("| --- | --- |")
        for br in s["branchRooms"]:
            roster = ", ".join(f"`{k}`×{v}" for k, v in sorted(br["roster"].items()))
            lines.append(f"| `{br['mapSource']}` | {roster} |")
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pvf", type=Path, default=DEFAULT_PVF, help="Path to Script_70.pvf")
    parser.add_argument("--out-json", type=Path, default=OUT_JSON)
    parser.add_argument("--out-doc", type=Path, default=OUT_DOC)
    args = parser.parse_args()

    data = extract(args.pvf)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.out_doc.parent.mkdir(parents=True, exist_ok=True)
    args.out_doc.write_text(render_markdown(data), encoding="utf-8")
    print(f"Wrote {args.out_json} and {args.out_doc}")


if __name__ == "__main__":
    main()
