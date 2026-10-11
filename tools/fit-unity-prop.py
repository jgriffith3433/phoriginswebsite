"""Fit one indexed Unity prop and write a small GLB.

Blender:
  blender -b --python tools/fit-unity-prop.py -- --name Sofa_3seat --pack AtmosphericHouse --height 0.84 --out assets/models/office-sofa.glb
"""

import json
import sys
from pathlib import Path

import bpy
import numpy as np

CATALOG = Path(r"C:\Projects\phoriginsassets\library\catalog.json")
MAX_TEX = 512


def args_after_dd() -> dict[str, str]:
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("pass args after --")
    raw = argv[argv.index("--") + 1 :]
    out: dict[str, str] = {}
    i = 0
    while i < len(raw):
        key = raw[i]
        if not key.startswith("--"):
            raise SystemExit(f"unexpected {key}")
        if i + 1 >= len(raw):
            raise SystemExit(f"missing value for {key}")
        out[key[2:]] = raw[i + 1]
        i += 2
    return out


def find_model(name: str, pack: str) -> tuple[str, str]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    hits = [
        item for item in catalog["models"]
        if item["name"] == name and item["kind"] == "model" and (not pack or item["pack"] == pack)
    ]
    if not hits:
        raise SystemExit(f"no textured model named {name} pack={pack or '*'}")
    item = hits[0]
    albedo = ""
    for slot in item.get("slots", []):
        albedo = slot.get("textures", {}).get("baseColor") or albedo
        if albedo:
            break
    if not albedo:
        raise SystemExit(f"{name} has no base color in the catalog")
    return item["file"], albedo


def mesh_bounds(obj):
    xs, ys, zs = [], [], []
    for vertex in obj.data.vertices:
        point = obj.matrix_world @ vertex.co
        xs.append(point.x)
        ys.append(point.y)
        zs.append(point.z)
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def main() -> None:
    opts = args_after_dd()
    name = opts.get("name") or ""
    pack = opts.get("pack") or ""
    height = float(opts.get("height") or "1")
    out = opts.get("out") or ""
    if not name or not out:
        raise SystemExit("need --name and --out")
    fbx, albedo = find_model(name, pack)
    destination = Path(out)
    if not destination.is_absolute():
        destination = Path(r"C:\Projects\phoriginswebsite") / destination

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no mesh in {fbx}")
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.type == "MESH")
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    prop = bpy.context.view_layer.objects.active
    # FBX parents keep a 0.01 scale and a Z-up rotation. Bake that into the
    # vertices or the glTF file exports the empty and the mesh sits half under the floor.
    bpy.ops.object.select_all(action="DESELECT")
    prop.select_set(True)
    bpy.context.view_layer.objects.active = prop
    if prop.parent:
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)

    minx, maxx, miny, maxy, minz, maxz = mesh_bounds(prop)
    span = max(maxz - minz, 1e-6)
    factor = height / span
    bpy.ops.transform.resize(value=(factor, factor, factor))
    bpy.ops.object.transform_apply(scale=True)
    minx, maxx, miny, maxy, minz, maxz = mesh_bounds(prop)
    prop.location.x -= (minx + maxx) * 0.5
    prop.location.y -= (miny + maxy) * 0.5
    prop.location.z -= minz
    bpy.ops.object.transform_apply(location=True)
    minx, maxx, miny, maxy, minz, maxz = mesh_bounds(prop)
    print(f"fitted {maxx - minx:.3f} x {maxy - miny:.3f} x {maxz - minz:.3f}")

    uvs = prop.data.uv_layers.active
    if uvs is None:
        raise SystemExit(f"{name} has no uvs")
    coords = [loop.uv for loop in uvs.data]
    umin = min(c.x for c in coords)
    umax = max(c.x for c in coords)
    vmin = min(c.y for c in coords)
    vmax = max(c.y for c in coords)
    pad = 0.01
    u0 = max(0.0, umin - pad)
    v0 = max(0.0, vmin - pad)
    u1 = min(1.0, umax + pad)
    v1 = min(1.0, vmax + pad)
    du = max(u1 - u0, 1e-6)
    dv = max(v1 - v0, 1e-6)
    for loop in uvs.data:
        loop.uv.x = (loop.uv.x - u0) / du
        loop.uv.y = (loop.uv.y - v0) / dv

    source = bpy.data.images.load(albedo)
    width, height_px = source.size
    pixels = np.array(source.pixels[:], dtype=np.float32).reshape(height_px, width, 4)
    x0 = int(u0 * width)
    x1 = max(x0 + 1, min(width, int(u1 * width)))
    y0 = int(v0 * height_px)
    y1 = max(y0 + 1, min(height_px, int(v1 * height_px)))
    crop = pixels[y0:y1, x0:x1]
    side = MAX_TEX
    image = bpy.data.images.new(f"{name}-albedo", width=crop.shape[1], height=crop.shape[0])
    image.colorspace_settings.name = "sRGB"
    image.pixels = crop.ravel().tolist()
    image.scale(side, side)

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.04
    prop.data.materials.clear()
    prop.data.materials.append(material)

    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=82,
        export_materials="EXPORT",
    )
    print(f"wrote {destination}")


if __name__ == "__main__":
    main()
