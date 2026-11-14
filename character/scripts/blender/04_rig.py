"""Step 4: fit the Mixamo-style skeleton from Xbot.glb to the mesh, skin it, retarget Xbot's clips,
author `cheer` and `sit`, add body morph targets, save work/stage3.blend.

  blender -b work/stage2.blend --python scripts/blender/04_rig.py

Skeleton: same bone names as public/models/standin.glb (the three.js Xbot example model; see THIRD-PARTY.md for its terms), so stage code that
works on the stand-in works on this file. Rest pose = the mesh's own A-pose.
Retargeting copies each source bone's world orientation onto the fitted bone (the fitted rest
orientation is the source rest orientation swung onto the mesh's limb direction, so "same world
orientation" means "same pose"); the hips translation is scaled by leg length.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

C = cfg(); Bj = json.load(open(P("work/build.json")))
H = Bj["height"]; chin_z = Bj["chin_z"]
scene = bpy.context.scene
scene.render.fps = 30
low = bpy.data.objects["low"]
if "high" in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects["high"], do_unlink=True)
low.name = "gun"; low.data.name = "gun"
PRE = "mixamorig:"

# ------------------------------------------------------------------ source rig + clips
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "models", "standin.glb"))
new = [o for o in bpy.data.objects if o not in before]
src = next(o for o in new if o.type == "ARMATURE")
for o in new:
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
src.name = "src_rig"
print("source: LeftArm", tuple(round(c, 3) for c in (src.matrix_world @ src.data.bones["mixamorig:LeftArm"].head_local)),
      "LeftToeBase", tuple(round(c, 3) for c in (src.matrix_world @ src.data.bones["mixamorig:LeftToeBase"].head_local)), "scale", tuple(src.scale))
src_actions = {a.name: a for a in bpy.data.actions}
print("source clips", {k: tuple(round(x) for x in a.frame_range) for k, a in src_actions.items()})
if src.animation_data:
    for tr in list(src.animation_data.nla_tracks):
        src.animation_data.nla_tracks.remove(tr)
    src.animation_data.action = None

# target = copy of the source armature with its object transform applied (bones in metres, world axes)
activate(src)
bpy.ops.object.duplicate()
rig = bpy.context.view_layer.objects.active
rig.name = "Armature"; rig.data.name = "gun_rig"
rig.animation_data_clear()
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ------------------------------------------------------------------ joint positions on the mesh
f = Bj["body_front"]
wx = lambda px: f["ax"] * px + f["bx"]
wz = lambda py: f["az"] * py + f["bz"]
lv = co(low)
J = C["body"]["joints_px"]

def depth_mid(x, z, r=0.03):
    while True:
        m = np.hypot(lv[:, 0] - x, lv[:, 2] - z) < r
        if m.any():
            return 0.5 * (lv[m, 1].min() + lv[m, 1].max())
        r *= 1.5

def slice_center(z, xlo, xhi, dz=0.012):
    m = (np.abs(lv[:, 2] - z) < dz) & (lv[:, 0] > xlo) & (lv[:, 0] < xhi)
    return 0.5 * (lv[m, 0].min() + lv[m, 0].max()), 0.5 * (lv[m, 1].min() + lv[m, 1].max())

T = {}                                     # bone -> new head position
REF_H = 1.8   # the skeleton template stands about this tall; poses and offsets scale from it
k = H / REF_H
hipj_z = 0.51 * H
T["Hips"] = Vector((0, slice_center(hipj_z, -0.2, 0.2)[1], hipj_z + 0.055 * k))
neck_z = wz(J["neck_y"])
eb = rig.data.bones
sz = lambda n: eb[PRE + n].head_local.z
for n in ("Spine", "Spine1", "Spine2"):
    z = T["Hips"].z + (sz(n) - sz("Hips")) / (sz("Neck") - sz("Hips")) * (neck_z - T["Hips"].z)
    T[n] = Vector((0, slice_center(z, -0.13, 0.13)[1] + 0.012, z))
T["Neck"] = Vector((0, slice_center(neck_z, -0.06, 0.06)[1] + 0.012, neck_z))
head_z = chin_z + 0.035
T["Head"] = Vector((0, slice_center(head_z, -0.12, 0.12)[1] + 0.012, head_z))
T["HeadTop_End"] = Vector((0, T["Head"].y, H))
for side, sg, i in (("Left", 1, 1), ("Right", -1, 0)):
    pt = lambda key: Vector((wx(J[key][i][0]), depth_mid(wx(J[key][i][0]), wz(J[key][i][1])), wz(J[key][i][1])))
    T[side + "Arm"] = pt("shoulder"); T[side + "ForeArm"] = pt("elbow"); T[side + "Hand"] = pt("wrist")
    T[side + "HandTip"] = pt("hand_tip")
    T[side + "Shoulder"] = Vector((sg * 0.045 * k, T["Spine2"].y, neck_z - 0.03 * k))
    xlo, xhi = (0.004, 0.45) if sg > 0 else (-0.45, -0.004)
    T[side + "UpLeg"] = Vector((sg * 0.088 * k, T["Hips"].y, hipj_z))
    kz = wz(J["knee_y"]); cxk, cyk = slice_center(kz, xlo, xhi)
    T[side + "Leg"] = Vector((cxk, cyk - 0.005, kz))
    cxa, cya = slice_center(0.14 * k, xlo, xhi)
    T[side + "Foot"] = Vector((cxa, cya + 0.012, 0.10 * k))
    foot = lv[(lv[:, 2] < 0.07) & (lv[:, 0] * sg > 0.004)]
    ytip = foot[:, 1].min(); fx = foot[foot[:, 1] < ytip + 0.09][:, 0].mean()
    T[side + "ToeBase"] = Vector((fx, ytip + 0.08, 0.03)); T[side + "Toe_End"] = Vector((fx, ytip + 0.005, 0.03))

chains = [("Hips", "Spine"), ("Spine", "Spine1"), ("Spine1", "Spine2"), ("Spine2", "Neck"), ("Neck", "Head"), ("Head", "HeadTop_End")]
for s in ("Left", "Right"):
    chains += [(s + "Shoulder", s + "Arm"), (s + "Arm", s + "ForeArm"), (s + "ForeArm", s + "Hand"),
               (s + "UpLeg", s + "Leg"), (s + "Leg", s + "Foot"), (s + "Foot", s + "ToeBase"), (s + "ToeBase", s + "Toe_End")]

# ------------------------------------------------------------------ fit in edit mode
activate(rig)
bpy.ops.object.mode_set(mode="EDIT")
E = rig.data.edit_bones
old = {b.name: (b.head.copy(), b.tail.copy(), b.z_axis.copy()) for b in E}
for b in E:
    b.use_connect = False
xf = {}                                    # explicit bone -> (old_head, new_head, R, s)
for b, child in chains:
    oh = old[PRE + b][0]; oa = old[PRE + child][0]
    nh = T[b]; na = T[child]
    R = (oa - oh).rotation_difference(na - nh).to_matrix()
    xf[PRE + b] = (oh, nh, R, (na - nh).length / (oa - oh).length)
for s in ("Left", "Right"):                # hands aim at the fingertips
    oh = old[PRE + s + "Hand"][0]; oa = old[PRE + s + "HandMiddle4"][0]
    nh = T[s + "Hand"]; na = T[s + "HandTip"]
    xf[PRE + s + "Hand"] = (oh, nh, (oa - oh).rotation_difference(na - nh).to_matrix(), (na - nh).length / (oa - oh).length)

def owner(b):
    while b is not None and b.name not in xf:
        b = b.parent
    return xf[b.name]

# Xbot's joints are world-aligned at rest (every imported bone points straight up, metres long), which
# is useless for heat weighting. Keep the joint positions, re-aim every bone at its child joint, and
# remember each bone's fit rotation so the clips can still be transferred exactly (see retarget).
FIT, newhead = {}, {}
for b in E:
    oh, nh, R, s = owner(b)
    newhead[b.name] = nh + s * (R @ (old[b.name][0] - oh))
    FIT[b.name] = R.copy()
main_child = {PRE + a: PRE + c for a, c in chains}
for sd in ("Left", "Right"):
    main_child[PRE + sd + "Hand"] = PRE + sd + "HandMiddle1"
for b in E:
    h = newhead[b.name]
    c = main_child.get(b.name) or (b.children[0].name if len(b.children) == 1 else None)
    if c and (newhead[c] - h).length > 1e-3:
        t = newhead[c]
    elif b.name.endswith("Eye"):
        t = h + Vector((0, -0.03, 0))
    else:
        d = (h - newhead[b.parent.name]) if b.parent else Vector((0, 0, 1))
        t = h + (d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))) * 0.03
    b.head = h; b.tail = t
    ref = Vector((0, -1, 0))
    if abs((t - h).normalized().dot(ref)) > 0.9:
        ref = Vector((0, 0, 1))
    b.align_roll(ref)
bpy.ops.object.mode_set(mode="OBJECT")
for b in rig.data.bones:
    n = b.name[len(PRE):]
    if n.endswith("_End") or n.endswith("Eye") or (n[-1] == "4" and "Hand" in n):
        b.use_deform = False
    if C.get("rigid_hands") and "Hand" in n and not n.endswith("Hand"):
        b.use_deform = False            # fingers ride on the hand bone

# ------------------------------------------------------------------ skin
bpy.ops.object.select_all(action="DESELECT")
low.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
activate(low)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
# the head must move as one piece: everything above the jaw/nape line is 100 % Head, blended over 2.5 cm
lv = co(low)
near = lv[(lv[:, 2] > chin_z) & (lv[:, 2] < chin_z + 0.03) & (np.abs(lv[:, 0]) < 0.1)]
y_chin, y_nape = near[:, 1].min(), near[:, 1].max()
plane = chin_z - 0.004 + 0.05 * np.clip((lv[:, 1] - y_chin) / (y_nape - y_chin), 0, 1)
t = np.clip((lv[:, 2] - (plane - 0.025)) / 0.025, 0, 1); fh = t * t * (3 - 2 * t)
hg = low.vertex_groups[PRE + "Head"]
for i in np.nonzero(fh > 0)[0]:
    v = low.data.vertices[int(i)]; f_ = float(fh[i]); wh = 0.0
    for g in v.groups:
        if g.group == hg.index:
            wh = g.weight
        else:
            g.weight *= (1 - f_)
    hg.add([int(i)], f_ + (1 - f_) * wh, "REPLACE")
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
nw = np.array([len(v.groups) for v in low.data.vertices])
print("skin: verts", len(nw), "unweighted", int((nw == 0).sum()), "groups", len(low.vertex_groups))

# ------------------------------------------------------------------ pose maths on the fitted rig
bones = sorted(rig.data.bones, key=lambda b: len(b.parent_recursive))
REST = {b.name: b.matrix_local.copy() for b in bones}
PAR = {b.name: (b.parent.name if b.parent else None) for b in bones}
OFF = {b.name: (REST[PAR[b.name]].inverted() @ REST[b.name]) if PAR[b.name] else REST[b.name].copy() for b in bones}
HIPS = PRE + "Hips"

def solve(world_rot, hips_pos, base_local=None):
    """world_rot: bone -> 3x3 armature-space orientation (others keep base_local, default rest-relative
    identity). Returns ({bone: quaternion basis}, hips basis location, {bone: 4x4 pose matrix})."""
    q, pose = {}, {}
    for b in bones:
        n = b.name; p = PAR[n]
        parent_m = (pose[p] @ OFF[n]) if p else OFF[n].copy()
        if n == HIPS:
            parent_m = parent_m.copy(); parent_m.translation = hips_pos
        if n in world_rot:
            basis = parent_m.to_3x3().inverted() @ world_rot[n]
        else:
            basis = (base_local[n].to_matrix() if base_local and n in base_local else Matrix.Identity(3))
        q[n] = basis.to_quaternion()
        pose[n] = parent_m @ basis.to_4x4()
    loc = REST[HIPS].inverted() @ hips_pos
    return q, loc, pose

FEET = [PRE + s + n for s in ("Left", "Right") for n in ("Foot", "ToeBase")]

def write_clip(name, frames, ground="const"):
    """frames: list of (quats, hips_loc_basis, pose). Bakes one action, pushes it to its own NLA track.
    ground: "const" = one height offset for the clip so its lowest foot contact is on the floor
    (keeps the bounce of walk/run); "frame" = re-ground every frame (standing clips); None = as is."""
    Rh = REST[HIPS].to_3x3().inverted()
    low_pt = [min(pose[n].translation.z - REST[n].translation.z for n in FEET) for _, _, pose in frames]
    dzs = [min(low_pt)] * len(frames) if ground == "const" else low_pt if ground == "frame" else [0.0] * len(frames)
    for i, (q, loc, pose) in enumerate(frames):
        d = Vector((0, 0, dzs[i]))
        for m in pose.values():
            m.translation = m.translation - d
        frames[i] = (q, loc - Rh @ d, pose)
    dz = min(dzs)
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    prev = {}
    for fi, (q, loc, pose) in enumerate(frames):
        for b in bones:
            pb = rig.pose.bones[b.name]
            pb.rotation_mode = "QUATERNION"
            qq = q[b.name]
            if b.name in prev and prev[b.name].dot(qq) < 0:
                qq = -qq
            prev[b.name] = qq
            pb.rotation_quaternion = qq
            pb.keyframe_insert("rotation_quaternion", frame=fi)
        hb = rig.pose.bones[HIPS]
        hb.location = loc
        hb.keyframe_insert("location", frame=fi)
    slot = getattr(rig.animation_data, "action_slot", None)
    rig.animation_data.action = None
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 0, act)
    if slot is not None and getattr(st, "action_slot", None) is None:
        st.action_slot = slot
    tr.mute = True
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    print(f"clip {name}: {len(frames)} frames, floor offset {dz * 1000:.1f} mm", flush=True)
    return act

# ------------------------------------------------------------------ retarget Xbot clips
SREST = {b.name: (src.matrix_world @ b.matrix_local) for b in src.data.bones}
kh = REST[HIPS].translation.z / SREST[HIPS].translation.z
SR = {n: m.to_3x3().normalized().inverted() for n, m in SREST.items()}
FITI = {n: m.inverted() for n, m in FIT.items()}
RR = {n: REST[n].to_3x3() for n in REST}
src.animation_data_create()
baked = {}
STANDING = ("idle", "agree", "headShake")
FINGERS = [b.name for b in bones if "Hand" in b.name and not b.name.endswith("Hand")]
LEGS_IN, ARMS_IN, CHIN_UP = 4.5, 7.0, 6.0          # degrees
rotx = lambda deg: Matrix.Rotation(math.radians(-deg), 3, "X")    # +deg = lean back (character faces -Y)
for name in ("idle", "walk", "run", "agree", "headShake", "sad_pose", "sneak_pose"):
    act = src_actions[name]
    src.animation_data.action = act
    if getattr(src.animation_data, "action_slot", None) is None and getattr(act, "slots", None):
        src.animation_data.action_slot = act.slots[0]
    f0, f1 = (int(round(x)) for x in act.frame_range)
    frames = []
    for fr in range(f0, f1 + 1):
        scene.frame_set(fr)
        bpy.context.view_layer.update()
        wr = {}
        for pb in src.pose.bones:       # world delta from the source rest, undone by the fit, applied to our rest
            D = (src.matrix_world @ pb.matrix).to_3x3().normalized() @ SR[pb.name]
            wr[pb.name] = D @ FITI[pb.name] @ RR[pb.name]
        if name in STANDING:            # Xbot stands like a robot: bring feet and arms in, lift the chin
            for sd, sg in (("Left", 1), ("Right", -1)):
                rl = Matrix.Rotation(math.radians(sg * LEGS_IN), 3, "Y")
                for bn in (sd + "UpLeg", sd + "Leg"):
                    wr[PRE + bn] = rl @ wr[PRE + bn]
                ra = Matrix.Rotation(math.radians(sg * ARMS_IN), 3, "Y")
                for bn in wr:
                    if bn.startswith(PRE + sd) and ("Arm" in bn or "Hand" in bn):
                        wr[bn] = ra @ wr[bn]
            for bn in ("Head", "HeadTop_End", "LeftEye", "RightEye"):
                wr[PRE + bn] = rotx(CHIN_UP) @ wr[PRE + bn]
        hp = (src.matrix_world @ src.pose.bones[HIPS].matrix).translation
        hips = REST[HIPS].translation + kh * (hp - SREST[HIPS].translation)
        frames.append(solve(wr, hips))
    if name in ("idle", "agree", "headShake", "walk"):
        # the mesh has mitten-like fingers; Xbot's tight fists read as hooks on it, so half-open them
        for q_, _, _ in frames:
            for bn in FINGERS:
                q_[bn] = Quaternion().slerp(q_[bn], 0.45)
    if name.endswith("_pose"):
        # additive poses: key 0 = reference stance, then the pose held. three.js makes these additive
        # against frame 0 and the stage keeps frames 2-3 of clips longer than 0.09 s (no flicker).
        frames = [frames[0]] + [frames[-1]] * 4
    baked[name] = frames
    write_clip(name, frames, ground={"walk": "const", "run": "const", "sad_pose": None, "sneak_pose": None}.get(name, "frame"))
src.animation_data.action = None

# ------------------------------------------------------------------ authored clips: cheer, sit
def aim(n, d):
    r = RR[PRE + n]
    return (r.col[1].rotation_difference(Vector(d).normalized()).to_matrix() @ r)

def leg_ik(side, hips_m, ankle):
    """Two-bone IK: world orientations for UpLeg/Leg so the ankle reaches `ankle`, knee forward (-Y)."""
    hj = (hips_m @ OFF[PRE + side + "UpLeg"]).translation
    L1 = (REST[PRE + side + "Leg"].translation - REST[PRE + side + "UpLeg"].translation).length
    L2 = (REST[PRE + side + "Foot"].translation - REST[PRE + side + "Leg"].translation).length
    d = Vector(ankle) - hj
    dist = min(d.length, L1 + L2 - 1e-4)
    dh = d.normalized()
    a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(L1 * L1 - a * a, 0))
    fwd = Vector((0, -1, 0)); nrm = (fwd - dh * fwd.dot(dh)).normalized()
    knee = hj + dh * a + nrm * h
    return {PRE + side + "UpLeg": aim(side + "UpLeg", knee - hj), PRE + side + "Leg": aim(side + "Leg", hj + dh * dist - knee),
            PRE + side + "Foot": RR[PRE + side + "Foot"], PRE + side + "ToeBase": RR[PRE + side + "ToeBase"]}

idle0_q = baked["idle"][0][0]
idle0_hips = baked["idle"][0][2][HIPS].translation.copy()
ANK = {s: REST[PRE + s + "Foot"].translation.copy() for s in ("Left", "Right")}
rotz = lambda deg: Matrix.Rotation(math.radians(deg), 3, "Z")
def body_pose(hips_pos, lean=0.0, head=0.0, arms=None, clav=0.0, ankles=None, hip=None, turn=0.0, R=None, legs=None):
    """Key pose. Directions are in the standing frame (x = the character's left, -y = forward, z = up).
    lean / hip / head: chest, pelvis and head pitch in degrees (+ = back). turn: head yaw.
    arms: (upper_dir, fore_dir) for both sides (x mirrored) or {"Left": ..., "Right": ...}; None = idle arms.
    Legs: two-bone IK to `ankles` (default: the standing foot positions), or `legs` = {side: (thigh_dir, shin_dir)}.
    R: rotation applied to the whole body about the hips (lying down)."""
    hip = lean * 0.3 if hip is None else hip
    mix = lambda k: hip + (lean - hip) * k
    hips_r = rotx(hip) @ RR[HIPS]
    wr = {HIPS: hips_r, PRE + "Spine": rotx(mix(0.4)) @ RR[PRE + "Spine"], PRE + "Spine1": rotx(mix(0.7)) @ RR[PRE + "Spine1"],
          PRE + "Spine2": rotx(lean) @ RR[PRE + "Spine2"], PRE + "Neck": rotz(turn * 0.5) @ rotx(lean + head * 0.5) @ RR[PRE + "Neck"],
          PRE + "Head": rotz(turn) @ rotx(lean + head) @ RR[PRE + "Head"]}
    hm = Matrix.Translation(hips_pos) @ hips_r.to_4x4()
    for s in ("Left", "Right"):
        sg = 1 if s == "Left" else -1
        if legs:
            th_, sh_ = legs[s]
            wr[PRE + s + "UpLeg"] = aim(s + "UpLeg", (sg * th_[0], th_[1], th_[2])); wr[PRE + s + "Leg"] = aim(s + "Leg", (sg * sh_[0], sh_[1], sh_[2]))
            wr[PRE + s + "Foot"] = RR[PRE + s + "Foot"]; wr[PRE + s + "ToeBase"] = RR[PRE + s + "ToeBase"]
        else:
            wr.update(leg_ik(s, hm, (ankles or ANK)[s]))
        spec = arms.get(s) if isinstance(arms, dict) else arms
        if spec:
            up, fore = spec
            wr[PRE + s + "Shoulder"] = aim(s + "Shoulder", (sg * 1.0, 0.0, clav))
            wr[PRE + s + "Arm"] = aim(s + "Arm", (sg * up[0], up[1], up[2]))
            wr[PRE + s + "ForeArm"] = aim(s + "ForeArm", (sg * fore[0], fore[1], fore[2]))
            wr[PRE + s + "Hand"] = aim(s + "Hand", (sg * fore[0], fore[1], fore[2]))      # straight wrist
    if R is not None:
        wr = {k_: R @ m_ for k_, m_ in wr.items()}
    base = dict(idle0_q)
    if arms:                                # open hands
        for bn in FINGERS:
            base[bn] = Quaternion()
    return solve(wr, Vector(hips_pos), base_local=base)

def blend(keys, n_frames, loop_breath=0.0):
    """keys: list of (time 0..1, solved pose). Smoothstep between neighbours in local space."""
    out = []
    for fi in range(n_frames):
        t = fi / (n_frames - 1)
        j = max(i for i, (kt, _) in enumerate(keys) if kt <= t + 1e-9)
        j = min(j, len(keys) - 2)
        (t0, a), (t1, b) = keys[j], keys[j + 1]
        u = min(max((t - t0) / (t1 - t0), 0), 1); u = u * u * (3 - 2 * u)
        q = {n: a[0][n].slerp(b[0][n], u) for n in a[0]}
        if loop_breath:
            br = math.sin(2 * math.pi * t)
            for n, amt in (("Spine1", 0.6), ("Spine2", 0.9), ("Neck", -0.5), ("LeftShoulder", 0.4), ("RightShoulder", 0.4)):
                q[PRE + n] = q[PRE + n] @ Quaternion((1, 0, 0), math.radians(loop_breath * amt * br))
        hips = a[2][HIPS].translation.lerp(b[2][HIPS].translation, u)
        # re-solve from local rotations so the pose matrices (floor check) are right
        pose = {}
        for bn in bones:
            n = bn.name; p = PAR[n]
            pm = (pose[p] @ OFF[n]) if p else OFF[n].copy()
            if n == HIPS:
                pm = pm.copy(); pm.translation = hips
            pose[n] = pm @ q[n].to_matrix().to_4x4()
        out.append((q, REST[HIPS].inverted() @ hips, pose))
    return out

idle_key = (idle0_q, None, baked["idle"][0][2])
hp = idle0_hips
ARM_UP = ((0.42, -0.12, 0.90), (0.22, -0.10, 0.97))
ARM_PUMP = ((0.72, -0.15, 0.68), (0.05, -0.12, 1.0))
ARM_READY = ((0.35, -0.25, -0.90), (0.15, -0.80, 0.55))
up = lambda dz=0.0: body_pose(hp + Vector((0, 0.0, dz)), lean=5, head=8, arms=ARM_UP, clav=0.45)
pump = body_pose(hp + Vector((0, 0, -0.035)), lean=2, head=4, arms=ARM_PUMP, clav=0.30)
ready = body_pose(hp + Vector((0, -0.01, -0.07)), lean=-6, head=4, arms=ARM_READY, clav=0.05)
cheer = blend([(0.0, idle_key), (0.13, ready), (0.27, up(0.0)), (0.40, pump), (0.52, up(0.0)), (0.64, pump), (0.76, up(0.0)), (1.0, idle_key)], 72)
write_clip("cheer", cheer, ground="frame")

# seated on a 46 cm seat placed behind the feet: thighs level, shins upright, hands on the thighs
hipj = REST[PRE + "LeftUpLeg"].translation
L1 = (REST[PRE + "LeftLeg"].translation - hipj).length
seat_hips = Vector((0, ANK["Left"].y + L1 * 0.93, REST[HIPS].translation.z - hipj.z + REST[PRE + "LeftLeg"].translation.z + 0.035))
sit_ank = {s: ANK[s] + Vector(((-0.035 if s == "Left" else 0.035), -0.02, 0)) for s in ANK}
sit_pose = body_pose(seat_hips, lean=-4, head=5, arms=((0.10, -0.42, -0.90), (-0.16, -0.90, -0.40)), clav=0.02, ankles=sit_ank)
sit = blend([(0.0, sit_pose), (1.0, sit_pose)], 91, loop_breath=1.2)
write_clip("sit", sit, ground="frame")

# ------------------------------------------------------------------ activity clips (looked up by exact name)
write_clip("walking", list(baked["walk"]), ground=None)          # same motion as `walk`, in place
write_clip("celebrating", list(cheer), ground=None)              # same motion as `cheer`

def seated(lean, head, arms, turn=0.0):
    return body_pose(seat_hips, lean=lean, head=head, arms=arms, clav=0.02, ankles=sit_ank, turn=turn)

# working: seated, forearms forward at desk height, fingers tapping (forearms bob in turn), eyes on the slate
TY_U = (0.14, -0.30, -0.94)
def ty(lz, rz, head=-10, turn=0):
    return seated(-8, head, {"Left": (TY_U, (-0.12, -0.96, lz)), "Right": (TY_U, (-0.12, -0.96, rz))}, turn)
working = blend([(0, ty(0.02, -0.04)), (0.12, ty(-0.05, 0.03)), (0.25, ty(0.03, -0.05, turn=4)), (0.37, ty(-0.04, 0.02, turn=4)),
                 (0.5, ty(0.02, -0.03, head=-14)), (0.62, ty(-0.05, 0.04, head=-14)), (0.75, ty(0.03, -0.04, turn=-4)),
                 (0.87, ty(-0.04, 0.03, turn=-4)), (1.0, ty(0.02, -0.04))], 97, loop_breath=0.8)
write_clip("working", working, ground="frame")

# eating: seated, left forearm resting forward, right hand travels from the table to the mouth and back
ARM_TABLE = ((0.12, -0.32, -0.94), (-0.20, -0.95, -0.08))
ARM_MID = ((0.22, -0.55, -0.80), (-0.45, -0.60, 0.60))
ARM_MOUTH = ((0.30, -0.62, -0.72), (-0.66, 0.05, 0.55))
def eat(right, lean=-6, head=-6):
    return seated(lean, head, {"Left": ARM_TABLE, "Right": right})
eating = blend([(0, eat(ARM_TABLE)), (0.12, eat(ARM_TABLE, head=-12)), (0.30, eat(ARM_MID)), (0.42, eat(ARM_MOUTH, lean=-10, head=-2)),
                (0.55, eat(ARM_MOUTH, lean=-10, head=-2)), (0.70, eat(ARM_MID)), (0.85, eat(ARM_TABLE)), (1.0, eat(ARM_TABLE))], 97, loop_breath=0.5)
write_clip("eating", eating, ground="frame")

# training: bodyweight squat in place, arms reaching forward at the bottom
SIDE = ((0.16, -0.04, -1.0), (0.10, -0.14, -1.0))
sq_top = body_pose(hp, lean=0, head=0, arms=SIDE)
sq_mid = body_pose(hp + Vector((0, 0.10, -0.19)), lean=-17, hip=-17, head=12, arms=((0.12, -0.70, -0.70), (0.05, -0.92, -0.35)))
sq_bot = body_pose(hp + Vector((0, 0.21, -0.40)), lean=-30, hip=-30, head=24, arms=((0.10, -1.0, -0.12), (0.02, -1.0, 0.06)))
training = blend([(0, sq_top), (0.20, sq_mid), (0.42, sq_bot), (0.52, sq_bot), (0.74, sq_mid), (0.90, sq_top), (1.0, sq_top)], 79)
write_clip("training", training, ground="frame")

# sleeping: on its back, centred on the origin, head toward -Z (glTF), one hand on the stomach, slow breath
R_LIE = Matrix.Rotation(math.radians(-90), 3, "X")
tors = lv[(lv[:, 2] > 1.02) & (lv[:, 2] < 1.45) & (np.abs(lv[:, 0]) < 0.15)]
lie_z = float(tors[:, 1].max() - REST[HIPS].translation.y) + 0.004
lie = body_pose(Vector((0, 0.075, lie_z)), lean=0, head=-3, turn=14, R=R_LIE,
                arms={"Left": ((0.30, 0.04, -1.0), (-0.80, -0.42, -0.42)), "Right": ((0.34, 0.10, -1.0), (0.22, 0.14, -1.0))},
                legs={"Left": ((0.09, 0.03, -1.0), (0.03, 0.05, -1.0)), "Right": ((0.12, 0.03, -1.0), (0.05, 0.05, -1.0))})
sleeping = blend([(0, lie), (1.0, lie)], 121, loop_breath=1.2)
write_clip("sleeping", sleeping, ground=None)

# ------------------------------------------------------------------ body morph targets
# driven by the client from real body data (see README): displacement along the normal, weighted by
# which bones own the vertex, so they follow the skeleton and need no extra authoring
activate(low)
nv = len(low.data.vertices)
W = {g.name[len(PRE):]: np.zeros(nv, np.float32) for g in low.vertex_groups}
gi = {g.index: g.name[len(PRE):] for g in low.vertex_groups}
for v in low.data.vertices:
    for g in v.groups:
        W[gi[g.group]][v.index] = g.weight
nrm = np.empty(nv * 3, np.float32); low.data.vertices.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
pos = co(low)
g = lambda *names: sum((W.get(n, 0) for n in names), np.zeros(nv, np.float32))
both = lambda n: g("Left" + n, "Right" + n)
front = 0.55 + 0.45 * np.clip(-nrm[:, 1], 0, 1)                    # bellies grow forward
jowl = g("Head") * np.clip((chin_z + 0.075 - pos[:, 2]) / 0.06, 0, 1) * np.clip((chin_z + 0.11 - pos[:, 2]) / 0.05, 0, 1)
fat = (g("Spine") * 0.040 + g("Spine1") * 0.032) * front + g("Hips") * 0.026 + g("Spine2") * 0.014 + both("UpLeg") * 0.016 \
    + both("Arm") * 0.008 + both("Leg") * 0.006 + both("ForeArm") * 0.004 + g("Neck") * 0.008 + both("Shoulder") * 0.006 + jowl * 0.005
mus = g("Spine2") * 0.013 + both("Shoulder") * 0.012 + both("Arm") * 0.014 + both("ForeArm") * 0.006 + both("UpLeg") * 0.010 \
    + both("Leg") * 0.007 + g("Neck") * 0.006 - g("Spine") * 0.003
def smooth(a, it=6):
    ed = np.empty(len(low.data.edges) * 2, np.int32); low.data.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
    deg = np.bincount(ed.ravel(), minlength=nv).astype(np.float32)
    for _ in range(it):
        acc = np.zeros(nv, np.float32)
        np.add.at(acc, ed[:, 0], a[ed[:, 1]]); np.add.at(acc, ed[:, 1], a[ed[:, 0]])
        a = 0.5 * a + 0.5 * acc / np.maximum(deg, 1)
    return a
# if the image model draws the body more muscular than the subject is, take a few mm off the base shape (config slim_base_m)
slim = sum((both(n) if n in ("Shoulder", "Arm", "ForeArm", "UpLeg", "Leg") else g(n)) * mm for n, mm in C.get("slim_base_m", {}).items())
if not np.isscalar(slim):
    pos = pos - nrm * smooth(slim)[:, None]
    set_co(low, pos)
low.shape_key_add(name="Basis")
for name, disp in (("lean", -0.42 * smooth(fat)), ("heavy", smooth(fat)), ("muscular", smooth(mus))):
    sk = low.shape_key_add(name=name)
    sk.data.foreach_set("co", (pos + nrm * disp[:, None]).ravel())
    sk.value = 0.0
    print(f"morph {name}: max {1000 * np.abs(disp).max():.1f} mm")
# ------------------------------------------------------------------ face morph targets (blink, smile, brow)
# sculpted from the bust sheet's face landmarks (scripts/face_landmarks.py -> work/face_landmarks.json)
from face_morphs import face_morphs, load_landmarks
if os.path.exists(P("work/face_landmarks.json")):
    ed_ = np.empty(len(low.data.edges) * 2, np.int32); low.data.edges.foreach_get("vertices", ed_); ed_ = ed_.reshape(-1, 2)
    for name, disp in face_morphs(pos, nrm, ed_, Bj, load_landmarks(P("work/face_landmarks.json")), chin_z).items():
        sk = low.shape_key_add(name=name)
        sk.data.foreach_set("co", (pos + disp).ravel())
        sk.value = 0.0
        print(f"morph {name}: max {1000 * np.abs(disp).max():.1f} mm on {(np.abs(disp).sum(1) > 1e-5).sum()} verts")
else:
    print("morph face: no work/face_landmarks.json, skipped")

bpy.data.objects.remove(src, do_unlink=True)
for a_ in src_actions.values():             # drop Xbot's own actions, give ours the clean names
    bpy.data.actions.remove(a_)
for tr in rig.animation_data.nla_tracks:
    tr.strips[0].action.name = tr.name; tr.strips[0].name = tr.name
bpy.ops.wm.save_as_mainfile(filepath=P("work/stage3.blend"))
print("tris", tri_count(low), "bones", len(rig.data.bones), "clips", [t.name for t in rig.animation_data.nla_tracks])
