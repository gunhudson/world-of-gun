"""Step 6: USDZ for the native Apple TV app (SceneKit / RealityKit).

  blender -b work/stage3.blend --python scripts/blender/06_export_usdz.py -- [clip] [out.usdz] [texture size]
Texture size: KEEP (default, 2K) or 256 / 512 / 1024 / 2048: the embedded textures are downscaled to it.
Default: the `idle` clip baked on the default time line (one skeletal animation, 30 fps, loops
cleanly), textures embedded, Y-up, metres, facing +Z. USD has one time line per file, so one clip per
file: run again with another clip name and output path for more (e.g. gun-cheer.usdz).
Morph targets are left out (SceneKit plays the skeleton more reliably without blend shapes).
"""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
clip = a[0] if a else "idle"
out = os.path.abspath(a[1]) if len(a) > 1 else P("work/out/gun.usdz")
tex_size = a[2] if len(a) > 2 else "KEEP"
scene = bpy.context.scene
rig = bpy.data.objects["Armature"]; mesh = bpy.data.objects["gun"]
ad = rig.animation_data
ad.use_nla = False
act = ad.nla_tracks[clip].strips[0].action
ad.action = act
if getattr(ad, "action_slot", None) is None and getattr(act, "slots", None):
    ad.action_slot = act.slots[0]
f0, f1 = (int(round(x)) for x in act.frame_range)
scene.render.fps = 30
scene.frame_start, scene.frame_end = f0, f1
scene.frame_set(f0)
# blend shapes off for this export
if mesh.data.shape_keys:
    mesh.shape_key_clear()
# USD preview surface wants plain image -> socket links: split the packed roughness map into its own image
import numpy as np
for m in mesh.data.materials:
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    sep = next((n for n in nt.nodes if n.type == "SEPARATE_COLOR"), None)
    if sep:
        src = sep.inputs[0].links[0].from_node.image
        w, h = src.size
        px = np.empty(w * h * 4, np.float32); src.pixels.foreach_get(px); px = px.reshape(h, w, 4)
        g = px[..., 1]
        ri = bpy.data.images.new(m.name + "_roughness", w, h, alpha=False)
        ri.colorspace_settings.name = "Non-Color"
        ri.pixels.foreach_set(np.stack([g, g, g, np.ones_like(g)], -1).ravel())
        ri.filepath_raw = P(f"work/tex/{m.name}_roughness.png"); ri.file_format = "PNG"; ri.save()
        ri.filepath = ri.filepath_raw
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = ri
        for l in list(bsdf.inputs["Roughness"].links) + list(bsdf.inputs["Metallic"].links):
            nt.links.remove(l)
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = 0.0
for o in list(scene.objects):
    if o not in (rig, mesh):
        bpy.data.objects.remove(o, do_unlink=True)
os.makedirs(os.path.dirname(out), exist_ok=True)
if os.path.exists(out):
    os.remove(out)
bpy.ops.wm.usd_export(
    filepath=out, selected_objects_only=False, export_animation=True,
    export_armatures=True, only_deform_bones=False, export_shapekeys=False,
    export_meshes=True, export_lights=False, export_cameras=False, export_curves=False, export_points=False,
    export_volumes=False, export_hair=False, export_uvmaps=True, export_normals=True, export_mesh_colors=False,
    export_materials=True, generate_preview_surface=True, generate_materialx_network=False,
    export_textures_mode="NEW", overwrite_textures=True, usdz_downscale_size=tex_size,
    convert_orientation=True, export_global_forward_selection="NEGATIVE_Z", export_global_up_selection="Y",
    convert_scene_units="METERS", triangulate_meshes=True, convert_world_material=False,
    export_custom_properties=False, evaluation_mode="RENDER", root_prim_path="/gun")
print("exported", out, os.path.getsize(out), "clip", clip, "frames", f0, f1)
