"""
Blender headless script: converts a base FBX (mesh + skeleton) into a GLB,
optionally merging Mixamo animation-only FBX exports as named clips.

Mixamo clips key pose.bones["mixamorig:Hips"]. Character FBXs often use
mixamorig6/7/9/10. Do NOT rename the character armature. Retarget each clip
F-curve onto the character bone whose suffix after the last colon matches
(Hips, Spine, LeftUpLeg, ...). Ch23 already matches mixamorig: and is a no-op.
"""

import os
import re
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


def _fail(exc_type, exc, tb):
    import traceback
    traceback.print_exception(exc_type, exc, tb)
    sys.exit(1)


sys.excepthook = _fail


def joint_suffix(name: str) -> str:
    text = str(name)
    if ':' in text:
        return text.rsplit(':', 1)[-1].lower()
    return text.lower()


def iter_action_fcurves(action):
    """Blender 5 layered actions store F-curves on strip channelbags, not action.fcurves."""
    legacy = getattr(action, 'fcurves', None)
    if legacy is not None:
        for fcurve in legacy:
            yield fcurve
        return
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            bags = []
            channelbags = getattr(strip, 'channelbags', None)
            if channelbags is not None:
                bags.extend(list(channelbags))
            channelbag_fn = getattr(strip, 'channelbag', None)
            if callable(channelbag_fn):
                try:
                    got = channelbag_fn()
                    if got is not None and got not in bags:
                        bags.append(got)
                except TypeError:
                    pass
            elif channelbag_fn is not None and hasattr(channelbag_fn, 'fcurves') and channelbag_fn not in bags:
                bags.append(channelbag_fn)
            for channelbag in bags:
                for fcurve in channelbag.fcurves:
                    yield fcurve


def bones_by_suffix(armature) -> dict:
    mapping = {}
    for bone in armature.data.bones:
        mapping[joint_suffix(bone.name)] = bone.name
    return mapping


def reverse_action(action) -> None:
    """Time-reverse a Mixamo clip (Put Away is a copy of Take Out)."""
    curves = list(iter_action_fcurves(action))
    times = [kp.co.x for fc in curves for kp in fc.keyframe_points]
    if not times:
        return
    t0 = min(times)
    t1 = max(times)
    span = t0 + t1
    for fc in curves:
        snapshots = []
        for kp in fc.keyframe_points:
            snapshots.append((
                kp.co.copy(),
                kp.handle_left.copy(),
                kp.handle_right.copy(),
                kp.handle_left_type,
                kp.handle_right_type,
                kp.interpolation,
            ))
        for kp, (co, hl, hr, hlt, hrt, interp) in zip(fc.keyframe_points, snapshots):
            kp.co.x = span - co.x
            kp.co.y = co.y
            kp.handle_left.x = span - hr.x
            kp.handle_left.y = hr.y
            kp.handle_right.x = span - hl.x
            kp.handle_right.y = hl.y
            kp.handle_left_type = hrt
            kp.handle_right_type = hlt
            kp.interpolation = interp
        fc.update()
    print(f"Reversed clip '{action.name}' time {t0:.3f}..{t1:.3f} (scale -1)")


def uniquify_action(src_action, clip_name: str):
    """Copy so Mixamo's shared mixamo.com action cannot alias another clip."""
    dup = src_action.copy()
    dup.name = clip_name
    dup.use_fake_user = True
    slots = getattr(dup, 'slots', None)
    if slots is not None:
        for slot in slots:
            for attr in ('name_display', 'identifier', 'name_prefix', 'name'):
                if not hasattr(slot, attr):
                    continue
                try:
                    setattr(slot, attr, clip_name)
                except (TypeError, AttributeError, ValueError):
                    pass
    print(f"Unique action '{dup.name}' from '{src_action.name}' id={id(dup)}")
    return dup


def push_nla_clip(armature, action, clip_name: str) -> None:
    if not armature.animation_data:
        armature.animation_data_create()
    tracks = armature.animation_data.nla_tracks
    for track in list(tracks):
        if track.name == clip_name:
            tracks.remove(track)
    track = tracks.new()
    track.name = clip_name
    start = 1
    try:
        start = int(action.frame_range[0])
    except (TypeError, AttributeError, IndexError):
        pass
    strip = track.strips.new(clip_name, max(start, 0), action)
    strip.name = clip_name
    try:
        strip.action = action
    except Exception:
        pass
    print(f"NLA track '{track.name}' action='{action.name}' frames={tuple(action.frame_range)}")


def retarget_action_fcurves(action, dest_by_suffix: dict) -> tuple:
    """Rewrite pose.bones["mixamorig:Hips"] → pose.bones["mixamorig7:Hips"]."""
    hits = 0
    example = None
    for fcurve in iter_action_fcurves(action):
        if 'pose.bones[' not in fcurve.data_path:
            continue

        def _remap(match, _dest=dest_by_suffix):
            nonlocal hits, example
            old = match.group(1)
            new = _dest.get(joint_suffix(old))
            if not new:
                return match.group(0)
            if old != new:
                hits += 1
                if example is None:
                    example = (old, new)
            return 'pose.bones["' + new + '"]'

        fcurve.data_path = re.sub(r'pose\.bones\["([^"]+)"\]', _remap, fcurve.data_path)
    return hits, example


for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.import_scene.fbx(filepath=base_path)

base_armature = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), None)
if base_armature and base_armature.animation_data:
    if base_armature.animation_data.action:
        base_armature.animation_data.action.use_fake_user = False
    for track in list(base_armature.animation_data.nla_tracks):
        base_armature.animation_data.nla_tracks.remove(track)
    base_armature.animation_data.action = None

dest_by_suffix = bones_by_suffix(base_armature) if base_armature else {}
hips = dest_by_suffix.get('hips')
print(f"Character armature hips={hips} first={[b.name for b in list(base_armature.data.bones)[:3]]}" if base_armature else "No armature")

collected_clip_names = []
stored_actions = {}
if base_armature:
    if not base_armature.animation_data:
        base_armature.animation_data_create()

    for raw_arg in anim_args:
        reverse = False
        if raw_arg.endswith('@@reverse'):
            reverse = True
            raw_arg = raw_arg[: -len('@@reverse')]
        if '=' in raw_arg:
            clip_name, anim_path = raw_arg.split('=', 1)
        else:
            clip_name, anim_path = os.path.splitext(os.path.basename(raw_arg))[0], raw_arg

        action = None
        # Holster is reverse of Draw (unique action). Do not re-import shared mixamo.com.
        if reverse and clip_name != 'Draw' and 'Draw' in stored_actions:
            action = uniquify_action(stored_actions['Draw'], clip_name)
            reverse_action(action)
            print(f"Holster from reversed Draw (skipped reimport {anim_path})")
        else:
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

            imported = anim_armature.animation_data.action
            anim_armature.animation_data.action = None
            action = uniquify_action(imported, clip_name)
            imported.use_fake_user = False

            sample_paths = [fc.data_path for i, fc in enumerate(iter_action_fcurves(action)) if i < 3]
            print(f"Clip '{clip_name}' fcurve0={sample_paths}")

            hits, example = retarget_action_fcurves(action, dest_by_suffix)
            if example:
                print(f"Retargeted '{clip_name}' {example[0]} -> {example[1]} ({hits} fcurves)")
            else:
                print(f"Retargeted '{clip_name}' already matched character bones ({hits} fcurves)")
            if reverse:
                reverse_action(action)

            for obj in new_objects:
                bpy.data.objects.remove(obj, do_unlink=True)

            print(f"Merged animation clip '{clip_name}' from {anim_path}")

        stored_actions[clip_name] = action
        collected_clip_names.append(clip_name)
        push_nla_clip(base_armature, action, clip_name)

    base_armature.animation_data.action = None

    # Mixamo FBX often has empties named mixamorig:Hips while bones are mixamorig7:Hips.
    # The glTF exporter skins those objects, so rename them to the armature bone names
    # (do not rewrite the GLB after export).
    for obj in list(bpy.data.objects):
        if obj == base_armature or obj.type == 'ARMATURE':
            continue
        dest = dest_by_suffix.get(joint_suffix(obj.name))
        if dest and obj.name != dest and 'mixamorig' in obj.name.lower():
            print(f"Rename object {obj.name} -> {dest} ({obj.type})")
            obj.name = dest
    hip_objects = [obj.name for obj in bpy.data.objects if 'hips' in obj.name.lower()]
    print(f"Pre-export hip objects={hip_objects}")
elif anim_args:
    print("WARNING: base FBX has no armature; ignoring requested animation clips.")

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

# Mixamo *_nonPBR.fbx Phong becomes Principled metallic~0.5 + specular maps.
# glTF then looks chrome under Babylon PBR. Keep albedo/normals; force dielectric cloth.
MIN_ROUGHNESS = 0.82


def _unlink_socket(node_tree, socket):
    if socket is None:
        return
    for link in list(socket.links):
        node_tree.links.remove(link)


def _set_float(node_tree, node, name, value, unlink=True):
    socket = node.inputs.get(name)
    if socket is None:
        return
    if unlink:
        _unlink_socket(node_tree, socket)
    try:
        socket.default_value = float(value)
    except (TypeError, ValueError):
        pass


def flatten_character_materials():
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            if hasattr(mat, 'metallic'):
                mat.metallic = 0.0
            if hasattr(mat, 'roughness'):
                mat.roughness = max(float(mat.roughness), MIN_ROUGHNESS)
            continue
        tree = mat.node_tree
        for node in tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            _set_float(tree, node, 'Metallic', 0.0)
            roughness = node.inputs.get('Roughness')
            current_rough = float(roughness.default_value) if roughness is not None else MIN_ROUGHNESS
            _set_float(tree, node, 'Roughness', max(current_rough, MIN_ROUGHNESS))
            # Default glTF dielectric specular; drop Mixamo specular textures.
            for spec_name, spec_value in (
                ('Specular IOR Level', 0.5),
                ('Specular', 0.5),
            ):
                sock = node.inputs.get(spec_name)
                if sock is None:
                    continue
                _unlink_socket(tree, sock)
                try:
                    sock.default_value = spec_value
                except (TypeError, ValueError):
                    pass
            tint = node.inputs.get('Specular Tint')
            if tint is not None:
                _unlink_socket(tree, tint)
                try:
                    val = tint.default_value
                    if hasattr(val, '__len__') and len(val) >= 3:
                        tint.default_value = (1.0, 1.0, 1.0, 1.0) if len(val) > 3 else (1.0, 1.0, 1.0)
                    else:
                        tint.default_value = 0.0
                except (TypeError, ValueError):
                    pass
            for extra in ('Coat Weight', 'Clearcoat', 'Sheen Weight', 'Sheen'):
                _set_float(tree, node, extra, 0.0)
    print('Flattened character materials to non-metal / dielectric')


# Hair, lashes, and beards keep texture alpha (cutout cards). Body atlases on
# some Mixamo files are RGBA too; if that alpha stays linked, glTF exports the
# skin as BLEND and the head sorts inside-out. Unlink alpha on everything else.
HAIR_ALPHA_TOKENS = ('hair', 'eyelash', 'lash', 'beard', 'brow')


def force_body_opaque():
    for mat in bpy.data.materials:
        name = mat.name.lower()
        if any(token in name for token in HAIR_ALPHA_TOKENS):
            continue
        if hasattr(mat, 'blend_method'):
            mat.blend_method = 'OPAQUE'
        if not mat.use_nodes or mat.node_tree is None:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            alpha = node.inputs.get('Alpha')
            if alpha is None:
                continue
            _unlink_socket(mat.node_tree, alpha)
            try:
                alpha.default_value = 1.0
            except (TypeError, ValueError):
                pass
    print('Forced non-hair character materials to opaque alpha')


flatten_character_materials()
force_body_opaque()

export_kwargs = dict(
    filepath=output_path,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_animations=True,
    export_image_format='AUTO',
    export_jpeg_quality=85,
    export_image_quality=85,
    export_unused_images=False,
    export_unused_textures=False,
)

exported = False
for mode in ('NLA_TRACKS', 'ACTIONS'):
    try:
        bpy.ops.export_scene.gltf(export_animation_mode=mode, **export_kwargs)
        print(f"glTF export_animation_mode={mode}")
        exported = True
        break
    except TypeError:
        continue
if not exported:
    bpy.ops.export_scene.gltf(**export_kwargs)

print(f"Exported GLB to {output_path}")
if collected_clip_names:
    print(f"Animation clips: {', '.join(collected_clip_names)}")
if hips:
    print(f"Exported hips bone: {hips}")
