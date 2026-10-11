"""Index Unity models and the textures their materials use.

Reads C:\\Projects\\SGFD\\Assets in place. Writes a catalog under
C:\\Projects\\phoriginsassets\\library. Does not copy or delete anything.

  python tools/export_unity_library.py
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

UNITY = Path(r"C:\Projects\SGFD\Assets")
OUT = Path(r"C:\Projects\phoriginsassets\library")

MODEL_EXT = {".fbx", ".obj", ".glb", ".gltf", ".dae"}
AUDIO_EXT = {".wav", ".mp3", ".ogg"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".psd", ".exr", ".bmp", ".webp"}

# Later entries win, so _BaseMap overrides _MainTex when both are set.
ROLE_ORDER = (
    ("_MainTex", "baseColor"),
    ("_BaseColorMap", "baseColor"),
    ("_BaseMap", "baseColor"),
    ("_BumpMap", "normal"),
    ("_NormalMap", "normal"),
    ("_MetallicGlossMap", "metallic"),
    ("_MaskMap", "metallic"),
    ("_SpecGlossMap", "specular"),
    ("_OcclusionMap", "occlusion"),
    ("_EmissionMap", "emission"),
    ("_EmissiveColorMap", "emission"),
    ("_ParallaxMap", "height"),
    ("_HeightMap", "height"),
)
ROLE_OF = dict(ROLE_ORDER)

GUID_LINE = re.compile(r"^guid:\s*([0-9a-f]{32})\s*$", re.I | re.M)
MAT_SLOT = re.compile(r"(?m)^[ \t]+21:\s+\d+[ \t]*\r?\n[ \t]+second:\s*(.+?)\s*$")
TEX_SLOT = re.compile(
    r"- (_[A-Za-z0-9]+):\s*\r?\n\s+m_Texture:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([0-9a-f]{32})",
    re.I,
)
MESH_GUID = re.compile(r"m_Mesh:\s*\{[^}]*?guid:\s*([0-9a-f]{32})", re.I | re.S)
PREFAB_REF = re.compile(r"m_Mesh:\s*\{[^}]*?guid:\s*([0-9a-f]{32})[^}]*\}|guid:\s*([0-9a-f]{32}),\s*type:\s*2", re.I | re.S)
MAT_NAME = re.compile(r"(?m)^  m_Name:\s*(.+?)\s*$")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def kind_for(path: Path) -> str:
    parts = {part.lower() for part in path.parts}
    if parts & {"animations", "animators", "animation"}:
        return "animation"
    if "collider" in parts or "colliders" in parts:
        return "collider"
    return "model"


def pack_for(path: Path) -> str:
    try:
        rel = path.relative_to(UNITY)
    except ValueError:
        return path.parent.name
    return rel.parts[0] if rel.parts else path.parent.name


def score_material(mat_path: Path, model_path: Path) -> tuple[int, int]:
    lowered = str(mat_path).lower()
    score = 0
    if "\\urp\\" in lowered or "/urp/" in lowered:
        score += 10
    if "hdrp" in lowered:
        score -= 8
    if "builtin" in lowered:
        score -= 6
    shared = 0
    for a, b in zip(mat_path.parts, model_path.parts):
        if a != b:
            break
        shared += 1
    return score, shared


def main() -> None:
    if not UNITY.is_dir():
        raise SystemExit(f"Unity Assets folder not found: {UNITY}")

    guid_to_path: dict[str, Path] = {}
    mats_by_name: dict[str, list[tuple[Path, dict[str, str]]]] = defaultdict(list)
    mats_by_guid: dict[str, tuple[Path, dict[str, str], str]] = {}
    aliases: dict[str, set[str]] = defaultdict(set)
    prefab_materials: dict[str, list[str]] = defaultdict(list)
    models: list[Path] = []
    audio: list[Path] = []

    for path in UNITY.rglob("*"):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext == ".meta":
            guid = GUID_LINE.search(read_text(path))
            if guid:
                asset = path.with_suffix("")
                if asset.is_file():
                    guid_to_path[guid.group(1).lower()] = asset
            continue
        if ext in MODEL_EXT:
            models.append(path)
        elif ext in AUDIO_EXT:
            audio.append(path)

    for path in UNITY.rglob("*.mat"):
        text = read_text(path)
        textures: dict[str, str] = {}
        found: dict[str, tuple[int, str]] = {}
        for match in TEX_SLOT.finditer(text):
            prop, file_id, guid = match.group(1), int(match.group(2)), match.group(3).lower()
            role = ROLE_OF.get(prop)
            if not role or file_id == 0:
                continue
            image = guid_to_path.get(guid)
            if image is None or image.suffix.lower() not in IMAGE_EXT:
                continue
            priority = next(i for i, (name, _role) in enumerate(ROLE_ORDER) if name == prop)
            previous = found.get(role)
            if previous is None or priority >= previous[0]:
                found[role] = (priority, str(image))
        textures = {role: item[1] for role, item in found.items()}
        names = {path.stem}
        for name in MAT_NAME.findall(text):
            if name and name != " " :
                names.add(name)
        record = (path, textures)
        for name in names:
            mats_by_name[name].append(record)
        mat_meta = GUID_LINE.search(read_text(Path(str(path) + ".meta")))
        if mat_meta:
            mats_by_guid[mat_meta.group(1).lower()] = (path, textures, path.stem)

    for path in UNITY.rglob("*.prefab"):
        text = read_text(path)
        label = path.stem
        current = ""
        seen_for_mesh: dict[str, set[str]] = defaultdict(set)
        for match in PREFAB_REF.finditer(text):
            mesh_guid, mat_guid = match.group(1), match.group(2)
            if mesh_guid:
                current = mesh_guid.lower()
                aliases[current].add(label)
                continue
            if current and mat_guid and mat_guid.lower() not in seen_for_mesh[current]:
                seen_for_mesh[current].add(mat_guid.lower())
                prefab_materials[current].append(mat_guid.lower())

    entries = []
    linked = 0
    missing = 0
    for model in models:
        meta = read_text(Path(str(model) + ".meta"))
        guid_match = GUID_LINE.search(meta)
        model_guid = guid_match.group(1).lower() if guid_match else ""
        slots = []
        seen: set[str] = set()
        for name in MAT_SLOT.findall(meta):
            material = name.strip()
            if not material or material in seen:
                continue
            seen.add(material)
            choices = mats_by_name.get(material, [])
            if not choices:
                missing += 1
                slots.append({"material": material, "textures": {}})
                continue
            mat_path, textures = max(choices, key=lambda item: score_material(item[0], model))
            linked += 1
            slots.append({
                "material": material,
                "materialFile": str(mat_path),
                "textures": textures,
            })
        if not any(slot["textures"] for slot in slots):
            for mat_guid in prefab_materials.get(model_guid, []):
                found = mats_by_guid.get(mat_guid)
                if not found:
                    missing += 1
                    continue
                mat_path, textures, material = found
                if not textures:
                    continue
                linked += 1
                slots.append({
                    "material": material,
                    "materialFile": str(mat_path),
                    "textures": textures,
                })
        entries.append({
            "name": model.stem,
            "pack": pack_for(model),
            "kind": kind_for(model),
            "file": str(model),
            "aliases": sorted(aliases.get(model_guid, [])),
            "slots": slots,
        })

    for clip in audio:
        entries.append({
            "name": clip.stem,
            "pack": pack_for(clip),
            "kind": "audio",
            "file": str(clip),
            "aliases": [],
            "slots": [],
        })

    entries.sort(key=lambda item: (item["name"].lower(), item["file"].lower()))
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {
        "unity": str(UNITY),
        "note": "Paths point at the Unity project. Nothing was copied.",
        "models": [item for item in entries if item["kind"] != "audio"],
        "audio": [item for item in entries if item["kind"] == "audio"],
    }
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")

    lines = []
    for item in entries:
        texture_bits = []
        for slot in item["slots"]:
            parts = [f"{role}={path}" for role, path in slot["textures"].items()]
            texture_bits.append(f"{slot['material']}: {', '.join(parts)}" if parts else slot["material"])
        alias = ",".join(item["aliases"])
        lines.append(
            "\t".join([
                item["name"],
                item["pack"],
                item["kind"],
                alias,
                item["file"],
                " | ".join(texture_bits),
            ])
        )
    (OUT / "index.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    model_count = sum(1 for item in entries if item["kind"] != "audio")
    print(f"models {model_count}")
    print(f"audio {sum(1 for item in entries if item['kind'] == 'audio')}")
    print(f"material slots linked {linked}")
    print(f"material slots missing {missing}")
    print(f"wrote {OUT / 'catalog.json'}")
    print(f"wrote {OUT / 'index.txt'}")


if __name__ == "__main__":
    main()
