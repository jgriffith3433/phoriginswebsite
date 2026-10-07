"""
Blender headless script: converts a base FBX (mesh + skeleton) into a GLB,
optionally merging in one or more Mixamo "animation-only" FBX exports
(same rig, no mesh) as additional named animation clips in the output file.

Usage:
  blender -b --python build_character_glb.py -- <base.fbx> <output.glb> [clipName=anim.fbx ...]

Each trailing argument is either:
  - a bare path to an animation FBX (clip name derived from the filename), or
  - "clipName=path/to/anim.fbx" to explicitly name the clip.

Mixamo animation-only exports share bone names with the base character rig,
so their actions are compatible with the base armature without retargeting.
Blender's glTF exporter (export_animation_mode='ACTIONS') exports every
action compatible with an armature as its own animation clip, regardless of
whether that action is currently assigned to the armature. That's what lets
one GLB carry multiple named clips (e.g. "Idle", "Walk", "Run").
"""

import os
import sys
import bpy

argv = sys.argv
argv = argv[argv.index("--") + 1:]
if len(argv) < 2:
    raise SystemExit(
        "Usage: blender -b --python build_character_glb.py -- "
        "<base.fbx> <output.glb> [clipName=anim.fbx ...]"
    )

base_path = argv[0]
output_path = argv[1]
anim_args = argv[2:]

if not os.path.exists(base_path):
    raise SystemExit(f"Base FBX not found: {base_path}")

output_dir = os.path.dirname(output_path)
if output_dir:
    os.makedirs(output_dir, exist_ok=True)

# Start from a truly empty scene -- the default startup file can include a
# camera/light/cube which would otherwise get exported alongside the model.
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.import_scene.fbx(filepath=base_path)

base_armature = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), None)
if base_armature and base_armature.animation_data and base_armature.animation_data.action:
    base_armature.animation_data.action.use_fake_user = True

collected_clip_names = []
if base_armature:
    for raw_arg in anim_args:
        if '=' in raw_arg:
            clip_name, anim_path = raw_arg.split('=', 1)
        else:
            clip_name, anim_path = os.path.splitext(os.path.basename(raw_arg))[0], raw_arg

        if not os.path.exists(anim_path):
            print(f"WARNING: animation FBX not found, skipping: {anim_path}")
            continue

        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=anim_path)
        new_objects = [obj for obj in bpy.data.objects if obj not in before]
        anim_armature = next((obj for obj in new_objects if obj.type == 'ARMATURE'), None)

        if not anim_armature or not anim_armature.animation_data or not anim_armature.animation_data.action:
            print(f"WARNING: no animation action found in {anim_path}, skipping")
            for obj in new_objects:
                bpy.data.objects.remove(obj, do_unlink=True)
            continue

        action = anim_armature.animation_data.action
        action.name = clip_name
        action.use_fake_user = True
        anim_armature.animation_data.action = None

        for obj in new_objects:
            bpy.data.objects.remove(obj, do_unlink=True)

        collected_clip_names.append(clip_name)
        print(f"Merged animation clip '{clip_name}' from {anim_path}")
elif anim_args:
    print("WARNING: base FBX has no armature; ignoring requested animation clips.")

# Mixamo/mobile characters typically arrive with several 4K PNG texture maps
# (diffuse/normal/specular/glossiness/emissive) baked straight from the DCC
# tool. Embedded losslessly, those alone can balloon a GLB to 100MB+ and blow
# well past mobile GPU texture-memory budgets. Downscale every image before
# export -- this shrinks both the on-disk file and the decoded GPU memory
# footprint, which is what actually matters on a phone.
MAX_TEXTURE_SIZE = int(os.environ.get('PH_MAX_TEXTURE_SIZE', '1024'))
for img in bpy.data.images:
    width, height = img.size
    if width <= 0 or height <= 0:
        continue
    longest = max(width, height)
    if longest <= MAX_TEXTURE_SIZE:
        continue
    scale = MAX_TEXTURE_SIZE / longest
    new_width = max(1, round(width * scale))
    new_height = max(1, round(height * scale))
    print(f"Resizing texture '{img.name}' from {width}x{height} to {new_width}x{new_height}")
    img.scale(new_width, new_height)

bpy.ops.object.select_all(action='DESELECT')

export_kwargs = dict(
    filepath=output_path,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_animations=True,
    # AUTO re-encodes opaque textures as JPEG (much smaller than PNG) and
    # keeps PNG only where alpha is actually needed; unused images/textures
    # (e.g. maps not wired into any exported channel) are dropped entirely.
    export_image_format='AUTO',
    export_jpeg_quality=85,
    export_image_quality=85,
    export_unused_images=False,
    export_unused_textures=False,
)

# export_animation_mode is only present on newer glTF exporter versions; fall
# back gracefully so this still works against older Blender builds.
try:
    bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **export_kwargs)
except TypeError:
    bpy.ops.export_scene.gltf(**export_kwargs)

print(f"Exported GLB to {output_path}")
if collected_clip_names:
    print(f"Animation clips: {', '.join(collected_clip_names)}")
