"""Contact-sheet renders of the rigged character in a .blend, to check skinning in motion.
  blender -b work/stage3.blend --python scripts/blender/render_poses.py -- <clip> <frame,frame,...> [view ...]
Writes work/preview/pose_<clip>_<frame>_<view>.png
"""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
a = sys.argv[sys.argv.index("--") + 1:]
clip, frames, views = a[0], [int(x) for x in a[1].split(",")], a[2:] or ["front", "q"]
scene = bpy.context.scene
rig = bpy.data.objects["Armature"]
setup_preview(scene, (640, 900))
next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND").inputs[1].default_value = 0.9
for o in [o for o in scene.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o, do_unlink=True)
add_sun(scene, (0.4, 1, -0.6), 1.6)
ad = rig.animation_data
ad.use_nla = False
if clip != "rest":
    tr = ad.nla_tracks[clip]
    ad.action = tr.strips[0].action
    if getattr(ad, "action_slot", None) is None and getattr(ad.action, "slots", None):
        ad.action_slot = ad.action.slots[0]
V = {"front": (0, 1, 0), "q": (-0.7, 0.7, -0.1), "side": (-1, 0, 0), "back": (0.4, -1, -0.1), "q2": (0.7, 0.7, -0.1)}
for f in frames:
    scene.frame_set(f)
    for v in views:
        render(scene, ortho_cam(scene, "c", (0, 0.1, 0.95), V[v], 2.3), P(f"work/preview/pose_{clip}_{f}_{v}.png"))
