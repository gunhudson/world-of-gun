"""Step 2: clay renders used as layout guides for the image model, so the painted side/back
views line up with the mesh silhouette.

  blender -b work/stage1.blend --python scripts/blender/02_clay_views.py
Writes work/clay/<view>.png (grey-backed, for the image model), <view>_mask.png and views.json.
Views: head_R, head_L, head_B (1024 square, bust framing) and body_R, body_L (1024x1536, full body).
"R" = seen from the character's right side (it faces the right edge of the image), "L" = from its left.
"""
import bpy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

B = json.load(open(P("work/build.json")))
scene = bpy.context.scene
setup_preview(scene, (1024, 1024), transparent=True)
bgn = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
bgn.inputs[0].default_value = (0.58, 0.58, 0.58, 1); bgn.inputs[1].default_value = 1.0
high, low = bpy.data.objects["high"], bpy.data.objects["low"]
low.hide_render = True
high.data.materials.clear(); high.data.materials.append(clay("clay2", (0.8, 0.78, 0.76)))
f = B["bust_front"]
hs = abs(f["ax"]) * 1024                      # same framing as the front bust image
hc = [B["head_x"], -0.01, f["az"] * 512 + f["bz"]]
H = B["height"]
VIEWS = cfg().get("views", ["head_R", "head_L", "head_B", "body_R", "body_L"])   # body-only characters add head_F
views = {
    "head_F": dict(d=(0, 1, 0), center=hc, scale=hs, W=1024, H=1024),
    "head_R": dict(d=(1, 0, 0), center=hc, scale=hs, W=1024, H=1024),
    "head_L": dict(d=(-1, 0, 0), center=hc, scale=hs, W=1024, H=1024),
    "head_B": dict(d=(0, -1, 0), center=hc, scale=hs, W=1024, H=1024),
    "body_R": dict(d=(1, 0, 0), center=[0, -0.02, H / 2], scale=H * 1.06, W=1024, H=1536),
    "body_L": dict(d=(-1, 0, 0), center=[0, -0.02, H / 2], scale=H * 1.06, W=1024, H=1536),
}
views = {k: v for k, v in views.items() if k in VIEWS}
os.makedirs(P("work/clay"), exist_ok=True)
for k, v in views.items():
    d = v["d"]
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    add_sun(scene, (d[0] + 0.25 * d[1], d[1] - 0.25 * d[0], -0.45), 2.2)
    scene.render.resolution_x, scene.render.resolution_y = v["W"], v["H"]
    cam = ortho_cam(scene, "cam" + k, v["center"], d, v["scale"])   # ortho_scale spans the longer side
    base = P(f"work/clay/{k}")
    render(scene, cam, base + "_rgba.png")
    os.system(f'magick "{base}_rgba.png" -background "#949494" -alpha remove -alpha off "{base}.png"')
    os.system(f'magick "{base}_rgba.png" -alpha extract -threshold 50% "{base}_mask.png"')
json.dump(views, open(P("work/clay/views.json"), "w"), indent=1)
