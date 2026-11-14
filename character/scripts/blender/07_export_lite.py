"""Step 7: the phone-tier model. Same skeleton, bone names and morph names as gun.glb, fewer triangles,
1K textures, the activity clips only.

  blender -b work/stage3.blend --python scripts/blender/07_export_lite.py -- [out.glb]
Writes work/out/gun-lite.raw.glb (plain glTF, no compression). build.sh then runs gltfpack on it
(quantization + meshopt) to make work/out/gun-lite.glb.
"""
import bpy, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(a[0]) if a else P("work/out/gun-lite.raw.glb")
# Outfit mode (OUTFIT=<name>, see outfits.sh): same decimation and UVs as the shipped lite model, but the colour and
# roughness maps are baked from work/outfits/<name>/tex instead and written to work/outfits/<name>/tex_lite; no export.
OUTFIT = os.environ.get("OUTFIT") or None
TEX_LITE = P(f"work/outfits/{OUTFIT}/tex_lite") if OUTFIT else P("work/tex_lite")
CLIPS = ("idle", "walking", "training", "sleeping", "working", "eating", "celebrating")
TRIS = {"head": 10000, "hands": 2600, "body": 12400}
TEX = {"color": 1024, "normal": 1024, "orm": 512}
PRE = "mixamorig:"
rig = bpy.data.objects["Armature"]; mesh = bpy.data.objects["gun"]
me = mesh.data
nv = len(me.vertices)

# ---- morphs are a scalar push along the normal: carry them through the decimation as vertex weights
kb = me.shape_keys.key_blocks
def sk_co(name):
    c = np.empty(nv * 3, np.float32); kb[name].data.foreach_get("co", c); return c.reshape(-1, 3)
nrm = np.empty(nv * 3, np.float32); me.vertices.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
basis = sk_co("Basis")
d_h = ((sk_co("heavy") - basis) * nrm).sum(1); d_m = ((sk_co("muscular") - basis) * nrm).sum(1)
k_lean = float(((sk_co("lean") - basis) * nrm).sum(1).min() / -d_h.max())          # lean = -k * heavy
H_MAX, M_OFF, M_RNG = float(d_h.max()) * 1.02, float(-d_m.min()) + 1e-4, float(d_m.max() - d_m.min()) * 1.02 + 2e-4
activate(mesh)
mesh.shape_key_clear()
# untouched copy of the full game mesh: the lite mesh gets new UVs and its textures are re-baked from this
src = mesh.copy(); src.data = mesh.data.copy(); src.name = "gun_full"
bpy.context.scene.collection.objects.link(src)
gh = mesh.vertex_groups.new(name="_morph_h"); gm = mesh.vertex_groups.new(name="_morph_m")
wh = np.clip(d_h / H_MAX, 0, 1); wm = np.clip((d_m + M_OFF) / M_RNG, 0, 1)
for i in range(nv):
    gh.add([i], float(wh[i]), "REPLACE"); gm.add([i], float(wm[i]), "REPLACE")

# ---- decimate head, hands and body to their own budgets (edit-mode decimate keeps UVs and weights)
hand_idx = {g.index for g in mesh.vertex_groups if g.name in (PRE + "LeftHand", PRE + "RightHand")}
vhand = np.array([sum(g.weight for g in v.groups if g.group in hand_idx) > 0.5 for v in me.vertices])
def decimate(pick, target):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    sel = pick()
    me.polygons.foreach_set("select", sel)
    n = int(sel.sum())
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.decimate(ratio=min(1.0, target / max(n, 1)))
    bpy.ops.object.mode_set(mode="OBJECT")
def faces():
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
    hw = np.zeros(len(me.vertices), bool)
    hi = {g.index for g in mesh.vertex_groups if g.name in (PRE + "LeftHand", PRE + "RightHand")}
    for v in me.vertices:
        hw[v.index] = sum(g.weight for g in v.groups if g.group in hi) > 0.5
    fh = np.array([all(hw[i] for i in p.vertices) for p in me.polygons])
    return mi, fh
decimate(lambda: faces()[0] == 0, TRIS["head"])
decimate(lambda: faces()[1], TRIS["hands"])
decimate(lambda: (faces()[0] == 1) & ~faces()[1], TRIS["body"])

# ---- rebuild the morph targets on the new vertices
nv = len(me.vertices)
wh = np.zeros(nv, np.float32); wm = np.zeros(nv, np.float32)
for v in me.vertices:
    for g in v.groups:
        if g.group == gh.index: wh[v.index] = g.weight
        elif g.group == gm.index: wm[v.index] = g.weight
mesh.vertex_groups.remove(gh); mesh.vertex_groups.remove(gm)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
smooth_shade(mesh)
# ---- new UVs (collapsing edges drags the old UVs across island borders) and 1K textures baked from the full mesh
import math
# bake pose: arms and legs spread, so no ray from an arm can reach the torso or from one thigh the other
from mathutils import Matrix
rig.data.pose_position = "POSE"
rig.animation_data.action = None; rig.animation_data.use_nla = False
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
for bone, deg in (("LeftArm", -38), ("RightArm", 38), ("LeftUpLeg", -9), ("RightUpLeg", 9)):
    r = rig.data.bones[PRE + bone].matrix_local.to_3x3()
    rig.pose.bones[PRE + bone].rotation_quaternion = (r.inverted() @ Matrix.Rotation(math.radians(deg), 3, "Y") @ r).to_quaternion()
bpy.context.view_layer.update()
# unwrap in that pose too: projected from the side in the A-pose, the arm lands on top of the torso
rest_co = co(mesh)
ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
posed = np.empty(len(ev.data.vertices) * 3, np.float32); ev.data.vertices.foreach_get("co", posed)
assert len(posed) == rest_co.size
set_co(mesh, posed.reshape(-1, 3))
mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
for idx in (0, 1):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.polygons.foreach_set("select", mi == idx)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.008, area_weight=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
set_co(mesh, rest_co)
old_mats = list(me.materials)
names = [m.name for m in old_mats]
for m in old_mats:
    m.name = m.name + "_full"
me.materials.clear()
mats = {}
for nm in names:
    m = bpy.data.materials.new(nm); m.use_nodes = True
    me.materials.append(m); mats[nm.replace("gun_", "")] = m
me.polygons.foreach_set("material_index", mi)
scene = bpy.context.scene
scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 8
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.008; scene.render.bake.max_ray_distance = 0.02
scene.render.bake.margin = 6; scene.render.bake.margin_type = "EXTEND"
def target(kind, cs):
    out_ = {}
    for nm, m in mats.items():
        img = bpy.data.images.new(f"gun_{nm}_{kind}", TEX[kind], TEX[kind], alpha=False)
        img.colorspace_settings.name = cs
        node = m.node_tree.nodes.new("ShaderNodeTexImage"); node.image = img; node.name = "bake_" + kind
        for n in m.node_tree.nodes: n.select = False
        node.select = True; m.node_tree.nodes.active = node
        out_[nm] = img
    return out_
bpy.ops.object.select_all(action="DESELECT")
src.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
if OUTFIT:                                   # the full mesh wears the outfit's baked maps while the lite maps are baked from it
    for m in old_mats:
        if not m.name.startswith("gun_body"): continue
        for n in m.node_tree.nodes:
            if n.type != "TEX_IMAGE" or not n.image: continue
            kind = "color" if "color" in n.image.name else "orm" if "orm" in n.image.name else None
            if kind:
                im = bpy.data.images.load(P(f"work/outfits/{OUTFIT}/tex/gun_body_{kind}.png"))
                im.colorspace_settings.name = "sRGB" if kind == "color" else "Non-Color"; n.image = im
col = target("color", "sRGB")
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
if not OUTFIT:
    nor = target("normal", "Non-Color")
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
rgh = target("orm", "Non-Color")
bpy.ops.object.bake(type="ROUGHNESS")
os.makedirs(TEX_LITE, exist_ok=True)
for nm, m in mats.items():
    n_ = TEX["orm"]
    px = np.empty(n_ * n_ * 4, np.float32); rgh[nm].pixels.foreach_get(px); px = px.reshape(n_, n_, 4)
    orm = np.ones((n_, n_, 4), np.float32); orm[..., 1] = px[..., 0]; orm[..., 2] = 0.0
    rgh[nm].pixels.foreach_set(orm.ravel())
    for kind, imgs in (("color", col), ("orm", rgh)) if OUTFIT else (("color", col), ("normal", nor), ("orm", rgh)):
        im = imgs[nm]; im.filepath_raw = os.path.join(TEX_LITE, f"gun_{nm}_{kind}.png"); im.file_format = "PNG"; im.save(); im.filepath = im.filepath_raw
    if OUTFIT: continue
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(nt.nodes["bake_color"].outputs["Color"], bsdf.inputs["Base Color"])
    nm_ = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nt.nodes["bake_normal"].outputs["Color"], nm_.inputs["Color"]); nt.links.new(nm_.outputs[0], bsdf.inputs["Normal"])
    sp = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(nt.nodes["bake_orm"].outputs["Color"], sp.inputs[0])
    nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
if OUTFIT:
    print("lite outfit", OUTFIT, "baked colour + orm to", TEX_LITE, flush=True); sys.stdout.flush(); os._exit(0)
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
bpy.data.objects.remove(src, do_unlink=True)
activate(mesh)

# ---- morph targets on the new vertices
pos = co(mesh)
nrm = np.empty(nv * 3, np.float32); me.vertices.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
d_h = wh * H_MAX; d_m = wm * M_RNG - M_OFF
mesh.shape_key_add(name="Basis")
for name, d in (("lean", -k_lean * d_h), ("heavy", d_h), ("muscular", d_m)):
    sk = mesh.shape_key_add(name=name)
    sk.data.foreach_set("co", (pos + nrm * d[:, None]).ravel()); sk.value = 0.0
# the face morphs are sculpted again on the lite vertices from the same landmarks (same names as gun.glb)
import json
from face_morphs import face_morphs, load_landmarks
if os.path.exists(P("work/face_landmarks.json")):
    Bj = json.load(open(P("work/build.json")))
    ed_ = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ed_); ed_ = ed_.reshape(-1, 2)
    for name, d in face_morphs(pos, nrm, ed_, Bj, load_landmarks(P("work/face_landmarks.json")), Bj["chin_z"]).items():
        sk = mesh.shape_key_add(name=name)
        sk.data.foreach_set("co", (pos + d).ravel()); sk.value = 0.0

# ---- clips
ad = rig.animation_data
ad.action = None; ad.use_nla = True
for tr in list(ad.nla_tracks):
    if tr.name not in CLIPS:
        ad.nla_tracks.remove(tr)
    else:
        tr.mute = False; tr.is_solo = False
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
    export_skins=True, export_all_influences=False, export_def_bones=False,
    export_morph=True, export_morph_normal=False, export_morph_tangent=False,
    export_normals=True, export_tangents=False, export_texcoords=True, export_materials="EXPORT",
    export_image_format="JPEG", export_jpeg_quality=90,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_frame_range=False, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
    export_rest_position_armature=True, export_cameras=False, export_lights=False, export_extras=False)
print("exported", out, os.path.getsize(out), "tris", tri_count(mesh), "verts", nv)
