"""Debug: sample the baked colour map at low-mesh loops in a region, and the high mesh's fill / class attributes
there (the collar smear hunt).
  blender -b work/stage2.blend --python scripts/blender/peek_tex.py
"""
import bpy, os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
B = json.load(open(P("work/build.json"))); chin = B["chin_z"]
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
low = bpy.data.objects["low"]; high = bpy.data.objects["high"]
me = low.data
pos = co(low)
nrm = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
pt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", pt)
loop_mat = np.repeat(mi, pt)
imgs = {}
for name in ("head", "body"):
    img = bpy.data.images.load(P(f"work/tex/gun_{name}_color.png"))
    w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a); imgs[name] = (a.reshape(h, w, 4), w, h)
hv = co(high)
hn = np.empty(len(high.data.vertices) * 3, np.float32); high.data.vertices.foreach_get("normal", hn); hn = hn.reshape(-1, 3)
def attr(name, n=1):
    a = np.empty(len(hv) * n, np.float32); high.data.attributes[name].data.foreach_get("value" if n == 1 else "color", a); return a.reshape(-1, n) if n > 1 else a
cloth = attr("cloth"); nf = attr("neckfill"); own = attr("headown"); fill = attr("fill", 4)[:, :3]
for x0 in (0.06, 0.09, 0.12, 0.15):
    for z0 in (-0.04, -0.02, 0.0):
        sel = lambda p, n: (np.abs(np.abs(p[:, 0]) - x0) < 0.015) & (p[:, 2] > chin + z0 - 0.01) & (p[:, 2] < chin + z0 + 0.01) & (n[:, 2] > 0.5)
        m = sel(pos[lv], nrm[lv])
        hm = sel(hv, hn)
        if m.sum() < 10 or hm.sum() < 10: continue
        parts = []
        for matn, mat in ((0, "head"), (1, "body")):
            mm = m & (loop_mat == matn)
            if not mm.any(): continue
            px, w, h = imgs[mat]
            xi = np.clip((uv[mm, 0] * w).astype(int), 0, w - 1); yi = np.clip((uv[mm, 1] * h).astype(int), 0, h - 1)
            c = px[yi, xi, :3]
            parts.append(f"{mat} n{mm.sum()} tex sRGB {c.mean(0).round(2)}")
        print(f"up x {x0:.2f} z-chin {z0:+.2f}: {' | '.join(parts)} || high n{hm.sum()} cloth {cloth[hm].mean():.2f} nf {nf[hm].mean():.2f} own {own[hm].mean():.2f} fill lum {(fill[hm] @ LUM).mean():.3f}")
