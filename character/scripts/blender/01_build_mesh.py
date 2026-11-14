"""Step 1: body shape + bust shape -> one watertight metric mesh ("high") and a game mesh ("low").

  blender -b --factory-startup --python scripts/blender/01_build_mesh.py

Reads config.json, writes work/stage1.blend and work/build.json (image <-> world mappings).
World frame (Blender): Z up, metres, feet on z=0, character faces -Y (= +Z after glTF export).
"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

C = cfg()
H = C["height_m"]
reset()

# ---------------------------------------------------------------- body
body = import_glb(P(C["body"]["glb"]), "body")
bj = json.load(open(P(C["body"]["front_image"] + ".json")))
v = co(body)
mn, mx = v.min(0), v.max(0)
bx0, by0, bx1, by1 = bj["bbox"]
upx = (mx[2] - mn[2]) / (by1 - by0)                # mesh units per pixel
s_body = H / (mx[2] - mn[2])
mpp = upx * s_body                                 # metres per pixel in the body sheet
cx_px = 0.5 * (C["body"]["head_cx"] + 0.5 * (bx0 + bx1))
x_of = lambda px: (mn[0] + (px - bx0) * (mx[0] - mn[0]) / (bx1 - bx0))
cx_mesh = x_of(cx_px)
v[:, 0] -= cx_mesh
v[:, 2] -= mn[2]
v *= s_body
# pelvis centre -> y = 0
hip_z = (by1 - C["body"]["joints_px"]["hips_y"]) * mpp
sl = v[(np.abs(v[:, 2] - hip_z) < 0.02)]
v[:, 1] -= 0.5 * (sl[:, 1].min() + sl[:, 1].max())
set_co(body, v)
body_img = {"ax": mpp * (mx[0] - mn[0]) / (bx1 - bx0) / upx, "bx": None, "az": -mpp, "bz": by1 * mpp}
# x(px) = (x_of(px) - cx_mesh) * s_body  ->  linear
body_img["ax"] = s_body * (mx[0] - mn[0]) / (bx1 - bx0)
body_img["bx"] = s_body * (mn[0] - cx_mesh) - body_img["ax"] * bx0
wx = lambda px: body_img["ax"] * px + body_img["bx"]
wz = lambda py: body_img["az"] * py + body_img["bz"]
chin_z, crown_z = wz(C["body"]["chin_y"]), wz(C["body"]["head_top_y"])
# the generated body has a long thin neck: seat the head lower than the body sheet's chin landmark says
DROP = float(C.get("neck_drop_m", 0.0)); chin_z -= DROP; crown_z -= DROP
head_x = wx(C["body"]["head_cx"])
print("body m/px", mpp, "chin", chin_z, "crown", crown_z, "head_x", head_x)

# back sheet: same world box, mirrored in x
kj = json.load(open(P(C["body"]["back_image"] + ".json")))
kx0, ky0, kx1, ky1 = kj["bbox"]
wxmin, wxmax = v[:, 0].min(), v[:, 0].max()
back_img = {"ax": -(wxmax - wxmin) / (kx1 - kx0), "az": -H / (ky1 - ky0), "bz": H * ky1 / (ky1 - ky0)}
back_img["bx"] = wxmax - back_img["ax"] * kx0

HAS_BUST = "bust" in C
if not HAS_BUST:
    # body-only character (a config without "bust", for example character/people/<name>/config.json): the head is the body
    # shape's own; a nominal cut under the chin still separates the head's texture set and triangle budget.
    # bust_front becomes a synthetic 1024-square head framing (head about 55 % of the frame) that 02_clay_views uses
    # for the head_F / head_R / head_L / head_B clay renders, which the image model then paints (step 6).
    z_cut = chin_z - C["neck_cut_below_chin_m"]
    hs = (crown_z - chin_z) * 1.8
    bmpp = hs / 1024
    bust_img = {"ax": bmpp, "az": -bmpp}
    bust_img["bx"] = head_x - bust_img["ax"] * 512
    bust_img["bz"] = crown_z + 0.12 * hs          # row 0 of the frame sits a little above the crown
    s_bust = 1.0
    activate(body)
    print("body-only: z_cut", z_cut, "head frame m", hs)
else:
    # ---------------------------------------------------------------- bust
    bust = import_glb(P(C["bust"]["glb"]), "bust")
    uj = json.load(open(P(C["bust"]["front_image"] + ".json")))
    u = co(bust)
    un, ux = u.min(0), u.max(0)
    ux0, uy0, ux1, uy1 = uj["bbox"]
    uupx = (ux[2] - un[2]) / (uy1 - uy0)
    head_units = (C["bust"]["chin_y"] - C["bust"]["head_top_y"]) * uupx
    s_bust = (crown_z - chin_z) / head_units
    bust_chin = ux[2] - (C["bust"]["chin_y"] - uy0) * uupx
    bust_cx = un[0] + (C["bust"]["head_cx"] - ux0) * (ux[0] - un[0]) / (ux1 - ux0)
    u[:, 0] = (u[:, 0] - bust_cx) * s_bust + head_x
    u[:, 2] = (u[:, 2] - bust_chin) * s_bust + chin_z
    u[:, 1] *= s_bust
    z_cut = chin_z - C["neck_cut_below_chin_m"]
    bmpp = uupx * s_bust
    bust_img = {"ax": s_bust * (ux[0] - un[0]) / (ux1 - ux0), "az": -bmpp}
    bust_img["bx"] = head_x - bust_img["ax"] * C["bust"]["head_cx"]
    bust_img["bz"] = chin_z - bust_img["az"] * C["bust"]["chin_y"]

    # depth: seat the bust's head on the body's own (coarser) head
    def head_mid_y(a):
        m = (a[:, 2] > chin_z + 0.04) & (np.abs(a[:, 0] - head_x) < 0.13)
        return 0.5 * (a[m, 1].min() + a[m, 1].max())
    u[:, 1] += head_mid_y(v) - head_mid_y(u)
    nm = (np.abs(v[:, 2] - z_cut) < 0.006) & (np.abs(v[:, 0] - head_x) < 0.05)
    by_ = 0.5 * (v[nm, 1].min() + v[nm, 1].max())          # neck axis = vertical through (head_x, by_)
    print("bust scale", s_bust, "z_cut", z_cut, "neck axis y", by_)

    # ---------------------------------------------------------------- neck: loft the bust onto the body's stump
    # The bust picture and the body picture never agree on the neck (thickness, how high the shoulders sit).
    # So the bust keeps its own shape only above the jaw line; between the cut and the jaw line every
    # horizontal ring of the bust is rescaled so that its outline runs smoothly from the body's outline at
    # the cut to the bust's own outline at the jaw. No step at either end by construction.
    import math as _m
    NT, DZ = 90, 0.0015
    Z0, Z1 = z_cut - 0.014, chin_z + 0.06
    NZ = int((Z1 - Z0) / DZ) + 1
    def polar(a):
        dx, dy = a[:, 0] - head_x, a[:, 1] - by_
        return np.hypot(dx, dy), np.arctan2(dy, dx) % (2 * _m.pi)
    def fill_circ(row):
        idx = np.nonzero(row > 0)[0]
        if len(idx) == 0:
            return row
        x = np.arange(len(row))
        return np.interp(x, np.concatenate([idx - len(row), idx, idx + len(row)]), np.tile(row[idx], 3))
    def outline(a, z0, nz):
        r, th = polar(a)
        iz = np.floor((a[:, 2] - z0) / DZ).astype(int)
        ok = (iz >= 0) & (iz < nz) & (r < 0.30)
        g = np.zeros((nz, NT), np.float32)
        np.maximum.at(g, (iz[ok], np.floor(th[ok] / (2 * _m.pi) * NT).astype(int) % NT), r[ok])
        g = np.stack([fill_circ(row) for row in g])
        for _ in range(2):                                   # light smoothing around and along the neck
            g = 0.25 * np.roll(g, 1, 1) + 0.5 * g + 0.25 * np.roll(g, -1, 1)
            g[1:-1] = 0.25 * g[:-2] + 0.5 * g[1:-1] + 0.25 * g[2:]
        return g
    def sample(g, th, zf):
        """bilinear lookup; th in radians, zf = fractional row index"""
        tf = th / (2 * _m.pi) * NT - 0.5
        t0 = np.floor(tf).astype(int); ft = tf - t0
        z0i = np.clip(np.floor(zf).astype(int), 0, g.shape[0] - 2); fz = np.clip(zf - z0i, 0, 1)
        ga = g[z0i, t0 % NT] * (1 - ft) + g[z0i, (t0 + 1) % NT] * ft
        gb = g[z0i + 1, t0 % NT] * (1 - ft) + g[z0i + 1, (t0 + 1) % NT] * ft
        return ga * (1 - fz) + gb * fz
    sm = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
    G = outline(u, Z0, NZ)                                              # bust outline per ring
    # body outline exactly where the body is cut (one thin ring, no max over height: the neck flares fast)
    zb = z_cut + 0.003
    rb_, thb_ = polar(v[np.abs(v[:, 2] - zb) < 0.002])
    gb = np.zeros(NT, np.float32)
    np.maximum.at(gb, np.floor(thb_[rb_ < 0.30] / (2 * _m.pi) * NT).astype(int) % NT, rb_[rb_ < 0.30])
    gb = fill_circ(gb)
    gb = 0.25 * np.roll(gb, 1) + 0.5 * gb + 0.25 * np.roll(gb, -1)
    r, th = polar(u)
    # jaw line: just under the chin in front, 3 cm above chin level at the nape (y+ is the back of the body)
    ztop = chin_z - 0.006 + 0.040 * sm(-0.6, 0.6, np.sin(th))        # just under the chin in front, 3.4 cm above chin level at the nape
    tfi = th / (2 * _m.pi) * NT - 0.5
    t0 = np.floor(tfi).astype(int); ft = tfi - t0
    r_body = gb[t0 % NT] * (1 - ft) + gb[(t0 + 1) % NT] * ft
    r_top = sample(G, th, (ztop - Z0) / DZ - 0.5)
    r_out = sample(G, th, (u[:, 2] - Z0) / DZ - 0.5)
    sfrac = np.clip((u[:, 2] - zb) / (ztop - zb), 0, 1)
    pw = 1.6 + 0.0 * th                             # front/sides: neck-sized, flare near the cut;
    target = r_top + (r_body - r_top) * (1 - sfrac) ** pw                 # nape: one long gentle slope, no shelf
    target = target * (1.0 + (float(C.get("neck_thicken", 1.0)) - 1.0) * np.sin(np.pi * sfrac))   # thicker neck mid-band, ends untouched
    target = np.where(u[:, 2] < zb, r_body * 0.94, target)               # the overlap skirt hides inside the body
    band = (u[:, 2] < ztop) & (r_out > 1e-4)
    kk = np.where(band, target / np.maximum(r_out, 1e-4), 1.0)
    u[:, 0] = head_x + (u[:, 0] - head_x) * kk
    u[:, 1] = by_ + (u[:, 1] - by_) * kk
    set_co(bust, u)
    print("neck loft: scale range", float(kk[band].min()), float(kk[band].max()))
    if os.environ.get("NECK_DEBUG"):
        names = {0: "left(+x)", NT // 4: "back(+y)", NT // 2: "right(-x)", 3 * NT // 4: "front(-y)"}
        for t_, nm_ in names.items():
            col = [round(float(outline(v[np.abs(v[:, 2] - zz) < 0.003], zz - 0.003, 4).max(0)[t_]), 3) for zz in (z_cut + 0.02, z_cut + 0.01, z_cut, z_cut - 0.01, z_cut - 0.02)]
            print(nm_, "body r at cut+2cm..cut-2cm", col, "| gb", round(float(gb[t_]), 3), "| bust r_top", round(float(G[int((chin_z - 0.006 + 0.036 * (0.5 + 0.5 * _m.sin(2 * _m.pi * (t_ + 0.5) / NT)) - Z0) / DZ), t_]), 3),
                  "| bust r at cut, cut+1cm, cut+2cm, chin", [round(float(G[int((zz - Z0) / DZ), t_]), 3) for zz in (z_cut, z_cut + 0.01, z_cut + 0.02, chin_z)])

    # ---------------------------------------------------------------- cut + union
    def bisect(ob, z, keep_above):
        bm = bmesh.new(); bm.from_mesh(ob.data)
        g = bm.verts[:] + bm.edges[:] + bm.faces[:]
        r = bmesh.ops.bisect_plane(bm, geom=g, plane_co=(0, 0, z), plane_no=(0, 0, 1),
                                   clear_inner=keep_above, clear_outer=not keep_above)
        edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
        bm.to_mesh(ob.data); bm.free(); ob.data.update()

    bisect(body, z_cut + 0.003, keep_above=False)
    bisect(bust, z_cut - 0.010, keep_above=True)
    activate(body); bust.select_set(True)
    bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
high.name = "high"
m = high.modifiers.new("vox", "REMESH")
m.mode = "VOXEL"; m.voxel_size = C["voxel_m"]; m.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier="vox")
# keep the biggest shell only
bm = bmesh.new(); bm.from_mesh(high.data)
bm.verts.ensure_lookup_table()
seen = set(); shells = []
for vert in bm.verts:
    if vert.index in seen:
        continue
    stack = [vert]; comp = []
    seen.add(vert.index)
    while stack:
        a = stack.pop(); comp.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index); stack.append(b)
    shells.append(comp)
shells.sort(key=len, reverse=True)
print("shells", [len(s) for s in shells[:6]])
for comp in shells[1:]:
    bmesh.ops.delete(bm, geom=comp, context="VERTS")
bm.to_mesh(high.data); bm.free()

# blend the seam: smooth only a band around the neck cut (there is no seam on a body-only character)
if HAS_BUST:
    hv = co(high)
    w = np.clip(1.4 * (1 - np.abs(hv[:, 2] - z_cut) / 0.04), 0, 1) * (np.abs(hv[:, 0] - head_x) < 0.16)
    vg = high.vertex_groups.new(name="seam")
    for i in np.nonzero(w > 0)[0]:
        vg.add([int(i)], float(w[i]), "REPLACE")
    smm = high.modifiers.new("sm", "SMOOTH"); smm.factor = 0.5; smm.iterations = 120; smm.vertex_group = "seam"
    activate(high)
    bpy.ops.object.modifier_apply(modifier="sm")
# final exact height
hv = co(high)
hv[:, 2] -= hv[:, 2].min()
k = H / hv[:, 2].max()
hv *= k
set_co(high, hv)
for d in (body_img, back_img, bust_img):
    for key in ("ax", "bx", "az", "bz"):
        d[key] *= k
z_cut *= k; chin_z *= k; crown_z = H; head_x *= k
smooth_shade(high)
print("high tris", tri_count(high), "bbox", hv.min(0), hv.max(0))

# ---------------------------------------------------------------- low (game mesh)
activate(high)
bpy.ops.object.duplicate()
low = bpy.context.view_layer.objects.active
low.name = "low"
# decimate head and body separately (edit-mode decimate only collapses the selected region,
# so the border between the two stays welded) to give the face its own triangle budget
def decimate_region(ob, pick, target_tris):
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    c = np.empty(len(ob.data.polygons) * 3, np.float32)
    ob.data.polygons.foreach_get("center", c)
    sel = pick(c.reshape(-1, 3))
    ob.data.polygons.foreach_set("select", sel)
    n = int(sel.sum())
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.decimate(ratio=min(1.0, target_tris / max(n, 1)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return n

T = C["tris"]
n_head = decimate_region(low, lambda c: c[:, 2] > z_cut, T["head"])
HX, HZ0, HZ1 = 0.1961 * H, 0.3315 * H, 0.5525 * H          # the hands' region of the A-pose, as fractions of the height
n_hand = decimate_region(low, lambda c: (np.abs(c[:, 0]) > HX) & (c[:, 2] < HZ1) & (c[:, 2] > HZ0), T["hands"])
n_body = decimate_region(low, lambda c: (c[:, 2] <= z_cut) & ~((np.abs(c[:, 0]) > HX) & (c[:, 2] < HZ1) & (c[:, 2] > HZ0)), T["body"])
print("region tris before", n_head, n_hand, n_body)
for name in ("seam",):
    if name in low.vertex_groups:
        low.vertex_groups.remove(low.vertex_groups[name])
lv = co(low)
ctr = np.array([np.mean([lv[i] for i in p.vertices], 0) for p in low.data.polygons])
head_faces = int((ctr[:, 2] > z_cut).sum())
print("low tris", tri_count(low), "head tris", head_faces)
smooth_shade(low)

fl = lambda d: {k_: float(v_) for k_, v_ in d.items()}
json.dump({"z_cut": float(z_cut), "chin_z": float(chin_z), "head_x": float(head_x), "height": H,
           "body_front": fl(body_img), "body_back": fl(back_img), "bust_front": fl(bust_img),
           "m_per_px_body": float(mpp * k), "m_per_px_bust": float(bmpp * k)}, open(P("work/build.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=P("work/stage1.blend"))

# ---------------------------------------------------------------- clay previews
scene = bpy.context.scene
setup_preview(scene, (700, 1200))
add_sun(scene, (0.3, 1, -0.5), 3.0)
mat = clay()
for o in (high, low):
    o.data.materials.append(mat)
os.makedirs(P("work/preview"), exist_ok=True)
for o, tag in ((high, "high"), (low, "low")):
    high.hide_render = o is not high
    low.hide_render = o is not low
    for name, dvec in (("front", (0, 1, 0)), ("side", (-1, 0, 0)), ("q", (-0.7, 0.7, 0))):
        render(scene, ortho_cam(scene, "c", (0, 0, H / 2), dvec, H * 1.08), P(f"work/preview/s1_{tag}_{name}.png"))
        render(scene, ortho_cam(scene, "c", (head_x, 0, H - 0.14), dvec, 0.42), P(f"work/preview/s1_{tag}_head_{name}.png"))
