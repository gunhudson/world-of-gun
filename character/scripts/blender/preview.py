"""Render turnaround previews of the textured game mesh in a .blend.
  blender -b work/stage2.blend --python scripts/blender/preview.py -- <prefix>
"""
import bpy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
prefix = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "s2"
B = json.load(open(P("work/build.json")))
scene = bpy.context.scene
setup_preview(scene, (700, 1200))
bgn = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND"); bgn.inputs[1].default_value = 0.9
for o in scene.objects:
    if o.type == "LIGHT": bpy.data.objects.remove(o, do_unlink=True)
add_sun(scene, (0.4, 1, -0.6), 1.6)
H = B["height"]
os.makedirs(P("work/preview"), exist_ok=True)
views = {"front": (0, 1, 0), "q": (-0.7, 0.7, -0.08), "side": (-1, 0, 0), "back": (0.3, -1, 0)}
for name, d in views.items():
    render(scene, ortho_cam(scene, "c", (0, 0, H / 2), d, H * 1.08), P(f"work/preview/{prefix}_{name}.png"))
scene.render.resolution_x = scene.render.resolution_y = 900
for name, d in views.items():
    render(scene, ortho_cam(scene, "c", (B["head_x"], 0, H - 0.15), d, 0.44), P(f"work/preview/{prefix}_head_{name}.png"))
