"""Import a prop FBX, bind textures from a folder, export a packed GLB.

Usage:
  blender -b --python tools/convert-prop-glb.py -- <input.fbx> <output.glb> [texture_dir]
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
if len(argv) < 2:
    raise SystemExit("Usage: blender -b --python convert-prop-glb.py -- <in.fbx> <out.glb> [texture_dir]")

input_path = os.path.abspath(argv[0])
output_path = os.path.abspath(argv[1])
texture_dir = os.path.abspath(argv[2]) if len(argv) > 2 else ""

if not os.path.isfile(input_path):
    raise SystemExit(f"FBX not found: {input_path}")

os.makedirs(os.path.dirname(output_path), exist_ok=True)


def _fail(exc_type, exc, tb):
    import traceback

    traceback.print_exception(exc_type, exc, tb)
    sys.exit(1)


sys.excepthook = _fail

bpy.ops.wm.read_factory_settings(use_empty=True)

ext = os.path.splitext(input_path)[1].lower()
if ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=input_path, automatic_bone_orientation=True, use_anim=False)
elif ext in {".glb", ".gltf"}:
    bpy.ops.import_scene.gltf(filepath=input_path)
else:
    raise SystemExit(f"Unsupported input: {ext}")


IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".bmp", ".webp"}


def classify_map(name: str) -> str | None:
    n = name.lower().replace("\\", "/")
    stem = os.path.splitext(os.path.basename(n))[0]
    tokens = stem.replace("-", "_").replace(" ", "_")
    if any(k in tokens for k in ("normal", "_n", "nrm", "norm", "bump")) and "ao" not in tokens:
        return "normal"
    if any(k in tokens for k in ("metal", "metallic", "metalness", "_m")) and "rough" not in tokens:
        return "metallic"
    if any(k in tokens for k in ("rough", "rgh", "_r")):
        return "roughness"
    if any(k in tokens for k in ("metalrough", "orm", "arm", "mrao")):
        return "orm"
    if any(k in tokens for k in ("ao", "occlusion", "ambient")):
        return "ao"
    if any(k in tokens for k in ("emiss", "glow", "light")):
        return "emission"
    if any(k in tokens for k in ("height", "disp", "displacement")):
        return "height"
    if any(k in tokens for k in ("spec",)):
        return "specular"
    if any(k in tokens for k in ("opac", "alpha", "transp")):
        return "opacity"
    if any(k in tokens for k in ("albedo", "basecolor", "base_color", "diffuse", "color", "col", "alb", "diff")):
        return "albedo"
    return None


def collect_textures(folder: str) -> dict[str, str]:
    found: dict[str, str] = {}
    if not folder or not os.path.isdir(folder):
        return found
    for root, _dirs, files in os.walk(folder):
        for name in files:
            extn = os.path.splitext(name)[1].lower()
            if extn not in IMAGE_EXT:
                continue
            kind = classify_map(name)
            if not kind:
                continue
            path = os.path.join(root, name)
            # Prefer larger / later files if duplicates.
            if kind not in found or os.path.getsize(path) > os.path.getsize(found[kind]):
                found[kind] = path
    return found


def load_image(path: str, non_color: bool) -> bpy.types.Image:
    image = bpy.data.images.load(path, check_existing=True)
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return image


def ensure_principled(material: bpy.types.Material) -> bpy.types.ShaderNodeBsdfPrincipled:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if output:
            links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return principled


def tex_node(material: bpy.types.Material, image: bpy.types.Image) -> bpy.types.ShaderNodeTexImage:
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.location = (-480, 0)
    return node


def apply_maps(material: bpy.types.Material, maps: dict[str, str]) -> None:
    principled = ensure_principled(material)
    nodes = material.node_tree.nodes
    links = material.node_tree.links

    if "albedo" in maps:
        img = load_image(maps["albedo"], False)
        node = tex_node(material, img)
        node.location = (-480, 280)
        links.new(node.outputs["Color"], principled.inputs["Base Color"])
        if img.channels >= 4:
            links.new(node.outputs["Alpha"], principled.inputs["Alpha"])
    if "opacity" in maps:
        img = load_image(maps["opacity"], True)
        node = tex_node(material, img)
        node.location = (-480, 140)
        links.new(node.outputs["Color"], principled.inputs["Alpha"])
        material.blend_method = "CLIP"

    if "normal" in maps:
        img = load_image(maps["normal"], True)
        node = tex_node(material, img)
        node.location = (-480, -40)
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.location = (-200, -40)
        links.new(node.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], principled.inputs["Normal"])

    if "orm" in maps:
        img = load_image(maps["orm"], True)
        node = tex_node(material, img)
        node.location = (-480, -280)
        sep = nodes.new("ShaderNodeSeparateColor")
        sep.location = (-240, -280)
        links.new(node.outputs["Color"], sep.inputs["Color"])
        if "Metallic" in principled.inputs:
            links.new(sep.outputs["Green"], principled.inputs["Metallic"])
        if "Roughness" in principled.inputs:
            links.new(sep.outputs["Blue"], principled.inputs["Roughness"])
    else:
        if "metallic" in maps:
            img = load_image(maps["metallic"], True)
            node = tex_node(material, img)
            node.location = (-480, -280)
            links.new(node.outputs["Color"], principled.inputs["Metallic"])
        else:
            if "Metallic" in principled.inputs:
                principled.inputs["Metallic"].default_value = 0.85
        if "roughness" in maps:
            img = load_image(maps["roughness"], True)
            node = tex_node(material, img)
            node.location = (-480, -460)
            links.new(node.outputs["Color"], principled.inputs["Roughness"])
        else:
            if "Roughness" in principled.inputs:
                principled.inputs["Roughness"].default_value = 0.35
        if "ao" in maps and "AO" in principled.inputs:
            img = load_image(maps["ao"], True)
            node = tex_node(material, img)
            node.location = (-480, 80)
            links.new(node.outputs["Color"], principled.inputs["AO"])

    if "emission" in maps:
        img = load_image(maps["emission"], False)
        node = tex_node(material, img)
        node.location = (-480, 480)
        key = "Emission Color" if "Emission Color" in principled.inputs else "Emission"
        if key in principled.inputs:
            links.new(node.outputs["Color"], principled.inputs[key])
        if "Emission Strength" in principled.inputs:
            principled.inputs["Emission Strength"].default_value = 1.0

    if "specular" in maps and "Specular IOR Level" in principled.inputs:
        img = load_image(maps["specular"], True)
        node = tex_node(material, img)
        node.location = (-480, -620)
        links.new(node.outputs["Color"], principled.inputs["Specular IOR Level"])


maps = collect_textures(texture_dir)
print("TEXTURE MAPS", json.dumps(maps, indent=2))

if maps:
    mesh_mats = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if not obj.data.materials:
            mat = bpy.data.materials.new(name="tt_pistol")
            obj.data.materials.append(mat)
        for slot in obj.material_slots:
            if slot.material:
                mesh_mats.append(slot.material)
            else:
                mat = bpy.data.materials.new(name="tt_pistol")
                slot.material = mat
                mesh_mats.append(mat)
    seen = set()
    for mat in mesh_mats:
        if mat.name in seen:
            continue
        seen.add(mat.name)
        apply_maps(mat, maps)
        mat.use_backface_culling = True

# World-space bounds of mesh geometry.
min_c = [math.inf, math.inf, math.inf]
max_c = [-math.inf, -math.inf, -math.inf]
mesh_names = []
depsgraph = bpy.context.evaluated_depsgraph_get()
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    mesh_names.append(obj.name)
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        for vert in mesh.vertices:
            w = obj.matrix_world @ vert.co
            for i in range(3):
                min_c[i] = min(min_c[i], w[i])
                max_c[i] = max(max_c[i], w[i])
    finally:
        evaluated.to_mesh_clear()

if not math.isfinite(min_c[0]):
    raise SystemExit("No mesh geometry in FBX.")

size = [max_c[i] - min_c[i] for i in range(3)]
# Barrel is the longest axis (typical pistol).
axis = max(range(3), key=lambda i: size[i])
center = [(min_c[i] + max_c[i]) * 0.5 for i in range(3)]
muzzle = center[:]
muzzle[axis] = max_c[axis]
grip = center[:]
grip[axis] = min_c[axis] + size[axis] * 0.22
# Drop grip toward the magazine / handle (usually -Z in Mixamo FBX or -Y).
up_axis = min(range(3), key=lambda i: size[i] if i != axis else math.inf)
grip[up_axis] = min_c[up_axis] + size[up_axis] * 0.35

# Root empty so Babylon parents one node.
if "tt_pistol_root" in bpy.data.objects:
    root = bpy.data.objects["tt_pistol_root"]
else:
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = "tt_pistol_root"

for obj in list(bpy.data.objects):
    if obj == root:
        continue
    if obj.parent is None:
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted() @ obj.matrix_world

bpy.ops.object.empty_add(type="PLAIN_AXES", location=grip)
grip_empty = bpy.context.active_object
grip_empty.name = "pistol_grip"
grip_empty.parent = root
grip_empty.matrix_parent_inverse = root.matrix_world.inverted() @ grip_empty.matrix_world

bpy.ops.object.empty_add(type="PLAIN_AXES", location=muzzle)
muzzle_empty = bpy.context.active_object
muzzle_empty.name = "pistol_muzzle"
muzzle_empty.parent = grip_empty
muzzle_empty.matrix_parent_inverse = grip_empty.matrix_world.inverted() @ muzzle_empty.matrix_world

# Point muzzle empty +Y toward barrel (Babylon flash uses local +Y as barrel).
direction = [0.0, 0.0, 0.0]
direction[axis] = 1.0
# Align empty +Y with barrel.
muzzle_empty.rotation_euler = (0, 0, 0)

meta = {
    "min": min_c,
    "max": max_c,
    "size": size,
    "axis": axis,
    "muzzle": muzzle,
    "grip": grip,
    "meshes": mesh_names,
    "maps": {k: os.path.basename(v) for k, v in maps.items()},
}
print("PISTOL_META", json.dumps(meta))
meta_path = os.path.splitext(output_path)[0] + "-meta.json"
with open(meta_path, "w", encoding="utf8") as handle:
    json.dump(meta, handle, indent=2)

# Select hierarchy for export.
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for obj in bpy.data.objects:
    obj.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_extras=True,
)

print(f"Converted {input_path} -> {output_path}")
print(f"Wrote {meta_path}")
