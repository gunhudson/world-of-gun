"""Clay preview of a raw generated shape. blender -b --factory-startup --python peek_shape.py -- in.glb out_prefix"""
import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
a = sys.argv[sys.argv.index("--") + 1:]
reset()
ob = import_glb(os.path.abspath(a[0]), "shape")
v = co(ob); mn, mx = v.min(0), v.max(0)
print("bbox", mn, mx, "tris", tri_count(ob))
smooth_shade(ob); ob.data.materials.append(clay())
scene = bpy.context.scene
setup_preview(scene, (800, 1200)); add_sun(scene, (0.3, 1, -0.5), 3.0)
H = mx[2] - mn[2]; c = (mn + mx) / 2
render(scene, ortho_cam(scene, "c", tuple(c), (0, 1, 0), H * 1.05), a[1] + "_front.png")
render(scene, ortho_cam(scene, "c", tuple(c), (-0.7, 0.7, 0), H * 1.05), a[1] + "_q.png")
scene.render.resolution_x = scene.render.resolution_y = 800
hx = mx[0] - 0.09 * H; hz = mn[2] + 0.44 * H
render(scene, ortho_cam(scene, "c", (hx, 0, hz), (0, 1, 0), 0.22 * H), a[1] + "_hand.png")
render(scene, ortho_cam(scene, "c", (hx, 0, hz), (1, 0.3, 0), 0.22 * H), a[1] + "_hand_side.png")
