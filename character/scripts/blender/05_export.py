"""Step 5: export the rigged, animated character as a GLB.

  blender -b work/stage3.blend --python scripts/blender/05_export.py -- [out.glb]
Default output: work/out/gun.glb (Y-up, metres, feet at the origin, facing +Z). Nothing is written to
public/ here: ./publish.sh copies the verified files there atomically (temp name, then rename),
because the live app reads public/models/gun.glb while builds run.
"""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(a[0]) if a else P("work/out/gun.glb")
rig = bpy.data.objects["Armature"]; mesh = bpy.data.objects["gun"]
ad = rig.animation_data
ad.action = None; ad.use_nla = True
for tr in ad.nla_tracks:
    tr.mute = False; tr.is_solo = False
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
for k in mesh.data.shape_keys.key_blocks:
    k.value = 0.0
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
    export_skins=True, export_all_influences=False, export_def_bones=False,
    export_morph=True, export_morph_normal=False, export_morph_tangent=False,
    export_normals=True, export_tangents=True, export_texcoords=True, export_materials="EXPORT",
    export_image_format="JPEG", export_jpeg_quality=88,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_frame_range=False, export_optimize_animation_size=False, export_anim_slide_to_zero=True,
    export_rest_position_armature=True, export_cameras=False, export_lights=False, export_extras=False)
print("exported", out, os.path.getsize(out))
