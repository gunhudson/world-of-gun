"""Step 3: UVs for the game mesh, then bake colour (multi-view projection of the sheet images)
and a tangent-space normal map from the high mesh.

  blender -b work/stage1.blend --python scripts/blender/03_texture.py

Projectors: body front/back sheet, bust front, bust right/left/back (painted over clay renders).
Each is an orthographic projection; they are blended by how squarely the surface faces the view
and cross-faded at the neck. Writes work/tex/*.png and work/stage2.blend.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

B = json.load(open(P("work/build.json")))
V = json.load(open(P("work/clay/views.json")))
# Outfit mode (OUTFIT=<name>, see outfits.sh): the four body views come from work/outfits/<name>/prep (the same sheets
# repainted with other clothes), every mask that decides skin vs cloth still comes from the original pictures, only the
# colour changes; the bake goes to work/outfits/<name>/tex and nothing in work/ is overwritten.
OUTFIT = os.environ.get("OUTFIT") or None
PREP = P(f"work/outfits/{OUTFIT}/prep") if OUTFIT else P("work/prep")
TEX_OUT = P(f"work/outfits/{OUTFIT}/tex") if OUTFIT else P("work/tex")
TEX = {"head": 2048, "body": 2048}
C = cfg()
REACH = C.get("bust", {}).get("neck_reach_below_chin_m", 0.12)   # how far down the neck the head pictures may texture skin
scene = bpy.context.scene
high, low = bpy.data.objects["high"], bpy.data.objects["low"]
for o in (high, low):
    o.data.materials.clear()
    o.hide_render = False
z_cut = B["z_cut"]
z_split = B["chin_z"] - 0.010          # head texture set = everything above the jaw line

# ------------------------------------------------------------------ UVs + material slots on low
mats = {}
for name in ("head", "body"):
    m = bpy.data.materials.new("gun_" + name)
    m.use_nodes = True
    low.data.materials.append(m)
    mats[name] = m
c = np.empty(len(low.data.polygons) * 3, np.float32)
low.data.polygons.foreach_get("center", c)
is_head = c.reshape(-1, 3)[:, 2] > z_split
low.data.polygons.foreach_set("material_index", (~is_head).astype(np.int32))
low.data.uv_layers.new(name="UVMap")
activate(low)
for idx in (0, 1):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    low.data.polygons.foreach_set("select", (is_head if idx == 0 else ~is_head))
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ projection material on high
def load(path, cs="sRGB"):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = cs
    return img

def pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)                            # row 0 = bottom, like UV space

def front_like(tag, d, gain, power, head, prep=None):
    """Projector defined by a linear px mapping in build.json: x = ax*px+bx, z = az*py+bz."""
    f = B[tag]
    prep = prep or (PREP if not head else P("work/prep"))
    img = load(f"{prep}/{tag}_pad.png"); blur = load(f"{prep}/{tag}_blur.png"); conf = load(f"{prep}/{tag}_conf.png", "Non-Color")
    W, Hh = img.size
    A = (1 / (f["ax"] * W), 0, 0); Bc = -f["bx"] / (f["ax"] * W)
    Cv = (0, 0, -1 / (f["az"] * Hh)); D = 1 + f["bz"] / (f["az"] * Hh)
    return dict(img=img, blur=blur, conf=conf, A=A, B=Bc, C=Cv, D=D, d=d, gain=gain, power=power, head=head, eps=1e-3)

def clay_like(k, gain, power, head, prep=None):
    """Projector painted over a clay render (views.json) and aligned by align_views.py."""
    v = V[k]
    d = Vector(v["d"]); cen = Vector(v["center"]); W, Hh = v["W"], v["H"]
    m = max(W, Hh) / v["scale"]                         # clay pixels per metre
    r = d.cross(Vector((0, 0, 1))).normalized()
    prep = prep or (PREP if not head else P("work/prep"))
    al = json.load(open(f"{prep}/{k}_align.json"))
    img = load(f"{prep}/{k}_pad.png"); blur = load(f"{prep}/{k}_blur.png"); conf = load(f"{prep}/{k}_conf.png", "Non-Color")
    s, tx, ty = al["s"], al["tx"], al["ty"]
    # clay px: u = m*(p-c).r + W/2 ; v = H/2 - m*(p-c).z ; painted px = s*clay + t ; uv = (px/W, 1-py/H)
    A = tuple(s * m * r[i] / W for i in range(3)); Bc = (s * (W / 2 - m * cen.dot(r)) + tx) / W
    Cv = (0, 0, s * m / Hh); D = 1 - (s * (Hh / 2 + m * cen.z) + ty) / Hh
    return dict(img=img, blur=blur, conf=conf, A=A, B=Bc, C=Cv, D=D, d=tuple(d), gain=gain, power=power, head=head)

# [kind, picture, view direction (front-like only), gain, power, head picture?]; config "projectors" overrides
# (body-only characters paint head_F / head_R / head_L / head_B over clay renders instead of using a bust sheet)
DEFAULT_PROJ = [["front", "body_front", [0, 1, 0], 1.5, 2.0, False], ["front", "body_back", [0, -1, 0], 1.2, 2.0, False],
                ["clay", "body_R", None, 0.8, 3.0, False], ["clay", "body_L", None, 0.8, 3.0, False],
                ["front", "bust_front", [0, 1, 0], 3.0, 3.0, True],
                ["clay", "head_R", None, 1.0, 3.0, True], ["clay", "head_L", None, 1.0, 3.0, True], ["clay", "head_B", None, 1.0, 2.0, True]]
PROJ_LIST = C.get("projectors", DEFAULT_PROJ)
if os.environ.get("PROJ_ONLY"): PROJ_LIST = [r for r in PROJ_LIST if r[1] in os.environ["PROJ_ONLY"].split(",")]   # debug: a subset of the pictures
mk = lambda kind, n, d, g, pw, h, prep=None: front_like(n, tuple(d), g, pw, h, prep) if kind == "front" else clay_like(n, g, pw, h, prep)
projs = [mk(*row) for row in PROJ_LIST]
# the original body pictures (black tee, black shorts): in outfit mode they decide where cloth is, the outfit pictures what colour it has
projs0 = projs if not OUTFIT else [mk(*row, P("work/prep")) if not row[5] else projs[i] for i, row in enumerate(PROJ_LIST)]

# ---- per-vertex visibility of the high mesh from every projector (so an arm in front of the torso
# ---- or the near leg in front of the far one does not get painted onto what is behind it)
from mathutils.bvhtree import BVHTree
import time
t0 = time.time()
hv = co(high)
hn = np.empty(len(high.data.vertices) * 3, np.float32); high.data.vertices.foreach_get("normal", hn); hn = hn.reshape(-1, 3)
tris = np.empty(len(high.data.loop_triangles) * 3, np.int32) if False else None
high.data.calc_loop_triangles()
polys = [tuple(t.vertices) for t in high.data.loop_triangles]
bvh = BVHTree.FromPolygons([tuple(x) for x in hv.tolist()], polys)
ed = np.empty(len(high.data.edges) * 2, np.int32); high.data.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
deg = np.bincount(ed.ravel(), minlength=len(hv)).astype(np.float32)
for i, pr in enumerate(projs):
    d = np.array(pr["d"], np.float32)
    facing = -(hn @ d)
    cand = np.nonzero(facing > 0.02)[0]
    org = hv[cand] + hn[cand] * 0.0015 - d * 0.0015
    back = Vector((-d).tolist())
    rc = bvh.ray_cast
    hit = np.array([rc(Vector(o), back, 4.0)[0] is not None for o in org.tolist()], bool)
    occ = np.zeros(len(hv), np.float32); occ[cand[hit]] = 1.0
    for _ in range(8):                                   # grow every occluded patch by ~2 cm: painted
        mx = occ.copy()                                  # views never register to the millimetre
        np.maximum.at(mx, ed[:, 0], occ[ed[:, 1]]); np.maximum.at(mx, ed[:, 1], occ[ed[:, 0]])
        occ = mx
    vis = 1.0 - occ
    for _ in range(4):                                   # then soften the edge
        acc = np.zeros(len(hv), np.float32)
        np.add.at(acc, ed[:, 0], vis[ed[:, 1]]); np.add.at(acc, ed[:, 1], vis[ed[:, 0]])
        vis = 0.5 * vis + 0.5 * acc / np.maximum(deg, 1)
    at = high.data.attributes.new(f"vis{i}", "FLOAT", "POINT")
    at.data.foreach_set("value", vis)
    print(f"vis{i}: {100 * vis.mean():.1f}% visible  ({time.time() - t0:.0f}s)", flush=True)

# ---- per-vertex colours from the head pictures and from the body pictures, and who owns what.
# ---- Above the jaw the head pictures own the surface. Down the neck they keep owning it wherever the
# ---- body pictures also show skin (neck, nape, the V of the collar), so the skin has one tone and one
# ---- resolution from the face to the collar and the head/body seam sits on the shirt edge.
chin = B["chin_z"]
smst = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
def vsmooth0(a, n):
    for _ in range(n):
        a_ = np.zeros(len(hv), np.float32)
        np.add.at(a_, ed[:, 0], a[ed[:, 1]]); np.add.at(a_, ed[:, 1], a[ed[:, 0]])
        a = 0.5 * a + 0.5 * a_ / np.maximum(deg, 1)
    return a
per = []
acc = {True: [np.zeros(len(hv), np.float32), np.zeros((len(hv), 3), np.float32)],
       False: [np.zeros(len(hv), np.float32), np.zeros((len(hv), 3), np.float32)]}
for i, pr in enumerate(projs):
    d = np.array(pr["d"], np.float32)
    facing = np.maximum(-(hn @ d), 0)
    u = hv @ np.array(pr["A"], np.float32) + pr["B"]; v = hv @ np.array(pr["C"], np.float32) + pr["D"]
    px = pixels(pr["blur"]); cf = pixels(pr["conf"]); pxs = pixels(pr["img"])
    hh, ww = px.shape[:2]
    xi = np.clip((u * ww).astype(int), 0, ww - 1); yi = np.clip((v * hh).astype(int), 0, hh - 1)
    vis = np.empty(len(hv), np.float32); high.data.attributes[f"vis{i}"].data.foreach_get("value", vis)
    wb = facing ** pr["power"] * pr["gain"] * vis * cf[yi, xi, 0]
    col = px[yi, xi, :3]
    col = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)   # sRGB -> linear
    cs = pxs[yi, xi, :3]; cs = np.where(cs <= 0.04045, cs / 12.92, ((cs + 0.055) / 1.055) ** 2.4)
    per.append((wb, col, cs @ np.array([0.2126, 0.7152, 0.0722], np.float32), cs))   # (weight, blurred colour, sharp luminance, sharp colour)
    acc[pr["head"]][0] += wb; acc[pr["head"]][1] += col * wb[:, None]
# the mask samples (identical to `per` outside outfit mode). Outfit mode: the outfit's own pictures decide skin against
# cloth, by skin tone rather than darkness (a tank bares the shoulders the black tee covered; linen is light, not dark),
# and every rule below reads the class through a synthetic luminance (skin 0.2, cloth 0.0) so the thresholds written
# for the black tee keep working. Until this, the classes came from the original pictures, which painted the tee's
# sleeves and yoke dark over the tank looks' bare shoulders.
def skinlike(c):
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    lum = c @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return (r - b > 0.045) & (r > g) & (g > b * 1.05) & (lum > 0.06) & (lum < 0.75) & ((r - b) / np.maximum(r, 1e-6) > 0.22)
per0 = per
if OUTFIT:
    per0 = []
    for i, (wb, col, l_, cs) in enumerate(per):
        if projs[i]["head"]: per0.append((wb, col, l_, cs)); continue
        lum0 = np.where(skinlike(cs), 0.2, 0.0).astype(np.float32)
        per0.append((wb, np.repeat(lum0[:, None], 3, 1), lum0, cs))
# cloth wins: where one body picture clearly sees dark cloth and another sees skin on the same spot
# (hems never register to the millimetre between pictures), drop the skin one. Hems move a few mm,
# and no skin-coloured rings are left on sleeve and shorts edges.
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
bidx = [i for i, pr in enumerate(projs) if not pr["head"]]
dark_any = np.zeros(len(hv), bool)
for i in bidx:
    dark_any |= (per0[i][0] > 0.05) & ((per0[i][1] @ LUM) < 0.035)
dark_any &= (hv[:, 2] < chin - 0.02) & bool(C.get("cloth_wins", True))   # off for light-clothed, long-haired people: dark hair tips would win over the front
# soft collar: where a sheet looks squarely at the surface it is sharp and keeps its own neckline and hems; a side
# painting's differently drawn (higher) collar yields to it there instead of the other way round. The per-vertex
# "drop" used to flip along the V-neck from vertex to vertex, which is where the stair-stepped line came from.
front_like = [i for i in bidx if PROJ_LIST[i][0] == "front"]
front_sure = np.zeros(len(hv), bool); front_skin = np.zeros(len(hv), bool)
if C.get("soft_collar", True):
    for i in front_like:
        sure = per0[i][0] > 0.6
        front_sure |= sure; front_skin |= sure & (per0[i][2] > 0.09)
for i in bidx:
    drop = dark_any & ((per0[i][1] @ LUM) > 0.09)
    if i in front_like: drop &= ~front_sure
    else: drop |= front_skin & (per0[i][2] < 0.05) & (hv[:, 2] < chin - 0.02)
    keep = vsmooth0((~drop).astype(np.float32), 2)
    if per0 is not per: per0[i] = (per0[i][0] * keep, per0[i][1], per0[i][2], per0[i][3])
    per[i] = (per[i][0] * keep, per[i][1], per[i][2], per[i][3])
    at = high.data.attributes[f"vis{i}"]
    vis = np.empty(len(hv), np.float32); at.data.foreach_get("value", vis); at.data.foreach_set("value", vis * keep)
acc = {True: [np.zeros(len(hv), np.float32), np.zeros((len(hv), 3), np.float32)],
       False: [np.zeros(len(hv), np.float32), np.zeros((len(hv), 3), np.float32)]}
for (wb, col, _l, _c), pr in zip(per0, projs):
    acc[pr["head"]][0] += wb; acc[pr["head"]][1] += col * wb[:, None]
Sh, Sb = acc[True][0], acc[False][0]
Cb = acc[False][1] / np.maximum(Sb, 1e-6)[:, None]
body_skin = ((Cb @ np.array([0.2126, 0.7152, 0.0722], np.float32)) > 0.10) | (Sb < 0.02)
zc = hv[:, 2]
# above the jaw the head pictures own everything (with "head_fallback_body" only where one of them sees the surface:
# body-only characters have no guaranteed all-round head coverage, and the body sheets are honest there)
above = (Sh > 0.05).astype(np.float32) if C.get("head_fallback_body") else 1.0
OWN_BELOW = float(C.get("head_own_below_chin_m", 0.012))   # long hair: let the head paintings own the hair over the shoulders too
# The collar rules ("collar_rules", default on; a second character can switch them off): the head owns
# everything above the jaw line except the flared base of the lofted neck (up-facing surface more than 7 cm off the neck
# axis at jaw height is the shoulder yoke under the collar, and the body pictures decide it), and never where the body
# pictures clearly see dark cloth below the jaw (the collar corners at the shoulder seam, which the painted head views see
# at a grazing angle with their own, differently drawn, collar)
COLLAR = bool(C.get("collar_rules", True))
core = ((np.abs(hv[:, 0] - B["head_x"]) < 0.07) | (zc > chin + 0.03)) if COLLAR else np.ones(len(hv), bool)
bw0 = np.zeros(len(hv), np.float32); bd0 = np.zeros(len(hv), np.float32)
for i in bidx:
    bw0 += per[i][0]; bd0 += per[i][0] * (per0[i][2] < 0.05)          # class from the original pictures (outfit mode repaints only colour)
cloth_vote = (bw0 > 0.05) & (bd0 / np.maximum(bw0, 1e-9) > 0.7) & (zc < chin - 0.012) if COLLAR else np.zeros(len(hv), bool)
yoke = np.zeros(len(hv), bool)
if COLLAR:
    # the lofted neck base flares to the shoulder line by jaw height: up-facing surface more than 7.5 cm off the axis there
    # is trapezius under the shirt (the sheets' collar reaches the neck at the sides), whatever the grazing samples say
    yoke = (np.abs(hv[:, 0] - B["head_x"]) > 0.075) & (zc < chin + 0.01) & (zc > chin - 0.10) & (hn[:, 2] > 0.3)
    if OUTFIT:   # a look may bare the shoulders: the yoke is shirt only where the look's own pictures agree
        osk = np.zeros(len(hv), np.float32); ow = np.zeros(len(hv), np.float32)
        for i in bidx: ow += per[i][0]; osk += per[i][0] * (per0[i][2] > 0.09)
        yoke &= ~((ow > 0.02) & (osk / np.maximum(ow, 1e-9) > 0.5))
    cloth_vote |= yoke
own = np.where((zc > chin - OWN_BELOW) & core, above, np.where(zc > chin - REACH, ((Sh > 0.05) & body_skin).astype(np.float32), 0.0)).astype(np.float32)
own[cloth_vote] = 0.0
# neck skin that no head picture covers (their collar sits higher than the body's): the body pictures
# are paler and much lower resolution there, so it gets the head's own skin colour spread over it
neckfill = ((zc < chin + 0.06) & (zc > chin - REACH) & (Sh <= 0.05) & body_skin & ~cloth_vote & (np.abs(hv[:, 0] - B["head_x"]) < 0.11)).astype(np.float32)
def vsmooth(a, n):
    for _ in range(n):
        a_ = np.zeros(len(hv), np.float32)
        np.add.at(a_, ed[:, 0], a[ed[:, 1]]); np.add.at(a_, ed[:, 1], a[ed[:, 0]])
        a = 0.5 * a + 0.5 * a_ / np.maximum(deg, 1)
    return a
own = vsmooth(own, 6)
nf_soft = vsmooth(neckfill, 3)
head_m = own
high.data.attributes.new("headown", "FLOAT", "POINT").data.foreach_set("value", head_m)
S = np.zeros(len(hv), np.float32); Cs = np.zeros((len(hv), 3), np.float32)
Sl = np.zeros(len(hv), np.float32); Cl = np.zeros((len(hv), 3), np.float32)   # light-only (skin seen as skin)
for (wb, col, _l, _c), (_w0, _c0, l_, _s0), pr in zip(per, per0, projs):   # colour from `per`, the skin/cloth luminance mask from `per0`
    w = wb * (head_m if pr["head"] else 1 - head_m) * (1 - neckfill)
    S += w; Cs += col * w[:, None]
    wl = w * (l_ > 0.085); Sl += wl; Cl += col * wl[:, None]
known = S > 0.06
Cs = np.where(S[:, None] > 1e-6, Cs / np.maximum(S, 1e-6)[:, None], Cs[known].mean(0))
e2 = np.concatenate([ed, ed[:, ::-1]])
e2 = e2[np.argsort(e2[:, 1], kind="stable")]
src = e2[:, 0]; starts = np.searchsorted(e2[:, 1], np.arange(len(hv)))
degf = np.maximum(deg, 1)[:, None]
dst_all = e2[:, 1]
# ---- skin or cloth, per vertex. The shoulder tops and the collar ridge are seen only at grazing angles,
# ---- so their colour used to come from the nearest well-seen vertex, which above the shirt is neck skin:
# ---- that spread a skin-coloured smear over the shoulders. Now every vertex is classed from whatever the
# ---- body pictures see there (sharp pixels, any weight at all), unseen vertices take the class of the
# ---- nearest classed one, and colour is only ever copied or relaxed within a class.
CLOTH_LUM = 0.05                                          # linear luminance: the shirt, shorts and shoes are black
CLEAN_LUM = 0.03                                          # the front and back sheets paint the shirt under 0.017; the side views under 0.045
bw = np.zeros(len(hv), np.float32); bdark = np.zeros(len(hv), np.float32)
Sd = np.zeros(len(hv), np.float32); Cd = np.zeros((len(hv), 3), np.float32)
for i in bidx:
    w_, _b, _l1, c_ = per[i]; l_ = per0[i][2]              # class by the original pictures' luminance; colour from the (outfit) pictures
    isdark = (l_ < CLOTH_LUM).astype(np.float32); isclean = (l_ < CLEAN_LUM).astype(np.float32)
    bw += w_; bdark += w_ * isdark
    Sd += w_ * isclean; Cd += c_ * (w_ * isclean)[:, None]           # sharp pixels: the blurred ones carry the neck and the backdrop
cls = np.where(bw > 1e-4, (bdark / np.maximum(bw, 1e-9) > 0.5).astype(np.float32), 0.0).astype(np.float32)
cls[head_m > 0.5] = 0.0
have = (bw > 1e-4) | (head_m > 0.5)
for it in range(3000):                                   # class of the nearest classed vertex, over the surface
    m = have[src] & ~have[dst_all]
    if not m.any():
        break
    dsts, first = np.unique(dst_all[m], return_index=True)
    cls[dsts] = cls[src[m][first]]; have[dsts] = True
# majority vote over about a centimetre: at the silhouette the samples alternate between the backdrop pad and the
# cloth, which left a jagged skin fringe along the shoulder line
cls[yoke] = 1.0
cls = (vsmooth(cls, 6) > 0.5).astype(np.float32); cls[head_m > 0.5] = 0.0; cls[yoke] = 1.0
cloth = cls > 0.5
Cd = Cd / np.maximum(Sd, 1e-6)[:, None]
known_c = cloth & (Sd > 0.03)                             # cloth seen as cloth: its clean (dark-only) colour
Cs[known_c] = Cd[known_c]
neckband = (head_m < 0.5) & (zc < chin + 0.02) & (zc > chin - REACH) & (np.abs(hv[:, 0] - B["head_x"]) < 0.11)
nb_clean = neckband & ~cloth & (Sl > 0.03)               # neck skin seen as skin: its light-only colour
Cs[nb_clean] = Cl[nb_clean] / np.maximum(Sl[nb_clean], 1e-6)[:, None]
known_s = ~cloth & (known & ~neckband | nb_clean)
unk = np.where(cloth, ~known_c, ~known_s)
def seed(done, allowed):
    """copy colour outward from `done` vertices into `allowed` ones, breadth-first over the surface"""
    done = done.copy()
    for it in range(3000):
        m = done[src] & ~done[dst_all] & allowed[dst_all]
        if not m.any():
            break
        dsts, first = np.unique(dst_all[m], return_index=True)
        Cs[dsts] = Cs[src[m][first]]
        done[dsts] = True
    return done
nfm = neckfill > 0
done = seed(known_s & (head_m > 0.5), nfm & ~cloth)     # neck: from head-owned skin only
seed(known_s | done, ~cloth)                             # the rest of the skin: from the nearest seen skin
seed(known_c, cloth)                                     # cloth: from the nearest cloth seen as cloth
# ...then relax it so the seeded patches have no hard borders, never across the skin/cloth line
same = (cls[src] == cls[dst_all]).astype(np.float32)
cnt = np.maximum(np.add.reduceat(same, starts), 1)[:, None]
for it in range(150):
    avg = np.add.reduceat(Cs[src] * same[:, None], starts, axis=0) / cnt
    Cs[unk] = avg[unk]
# the neckline itself ("soft_collar", default on). The fill is one colour per vertex, skin or cloth by the vertex's
# class, so wherever the fill shows (the neck skin the head pictures do not reach, and every clamped texel) the line
# between the two fills zigzags from vertex to vertex over the remeshed lattice: a stair-stepped neckline at close range.
# Inside a band around the class line the shader now carries BOTH fills and picks per texel by the luminance of the
# projected pictures themselves, so the painted neckline draws the edge; the class and the clamp still rule outside it.
neckskin = ((~cloth) & (head_m < 0.5) & (zc < chin + 0.02) & (zc > chin - REACH) & (np.abs(hv[:, 0] - B["head_x"]) < 0.11)).astype(np.float32)
cloth_attr = vsmooth(cls, 1)
fill_skin = Cs.copy(); fill_cloth = Cs.copy(); band_attr = np.zeros(len(hv), np.float32)
if C.get("soft_collar", True):
    SOFT_N = int(C.get("soft_collar_steps", 4))
    grade = vsmooth(cls, SOFT_N)                                           # 0..1 across about SOFT_N edges either side of the line
    def spread(arr, done, n=16):
        """copy `arr` outward from `done` vertices into the rest, breadth-first, n rings at most"""
        done = done.copy()
        for it in range(n):
            m = done[src] & ~done[dst_all]
            if not m.any():
                break
            dsts, first = np.unique(dst_all[m], return_index=True)
            arr[dsts] = arr[src[m][first]]; done[dsts] = True
    spread(fill_skin, ~cloth); spread(fill_cloth, cloth)                   # each vertex near the line knows both fills
    # only where a sharp sheet looks squarely at the line (the V-neck front and back): at grazing angles (the shoulder
    # tops, the old smear) the pictures are a blur of both and the class must keep deciding
    fw = np.zeros(len(hv), np.float32)
    for i, row in enumerate(PROJ_LIST):
        if row[0] == "front" and not row[5]: fw = np.maximum(fw, per[i][0])
    band_attr = (smst(0.04, 0.35, np.minimum(grade, 1 - grade) * 2) * smst(0.3, 0.9, fw) * (head_m < 0.5)).astype(np.float32)
    skinband = ((~cloth) & (grade > 0.04) & (head_m < 0.5)).astype(np.float32)   # skin within reach of the line: dark texels there are clamped to the skin fill too
    neckskin = np.maximum(neckskin, skinband)
    print(f"class soft collar: {int((band_attr > 0.5).sum())} vertices picture-drawn, {int(skinband.sum())} skin-side", flush=True)
    if os.environ.get("TEX_DEBUG3"):
        for z0 in np.arange(-0.02, -0.14, -0.02):
            m = (np.abs(hv[:, 0] - B["head_x"]) < 0.07) & (zc < chin + z0) & (zc >= chin + z0 - 0.02) & (hn[:, 1] < -0.3)
            print(f"front V z-chin {z0:+.2f}: n {m.sum()} cls {cls[m].mean():.2f} head_m {head_m[m].mean():.2f} fw {fw[m].mean():.2f} band>0.5 {(band_attr[m] > 0.5).sum()} nf {nf_soft[m].mean():.2f}")
        sys.stdout.flush(); os._exit(0)
for nm, arr in (("fillskin", fill_skin), ("fillcloth", fill_cloth)):
    high.data.attributes.new(nm, "FLOAT_COLOR", "POINT").data.foreach_set("color", np.concatenate([arr, np.ones((len(hv), 1), np.float32)], 1).ravel())
high.data.attributes.new("band", "FLOAT", "POINT").data.foreach_set("value", band_attr)
# soft collar: below the chin, where the head pictures (skin only, no shirt) overlap the body pictures, the head
# pictures may paint only texels the body pictures show as skin (decided per texel in the shader, so the sheet's own
# neckline draws the edge). Zero on the face, where the body sheets are too coarse to judge.
neckgate = vsmooth(((zc < chin - 0.015) & (head_m > 0.02)).astype(np.float32), 2) if C.get("soft_collar", True) else np.zeros(len(hv), np.float32)
high.data.attributes.new("neckgate", "FLOAT", "POINT").data.foreach_set("value", neckgate.astype(np.float32))
high.data.attributes.new("cloth", "FLOAT", "POINT").data.foreach_set("value", cloth_attr)
high.data.attributes.new("neckfill", "FLOAT", "POINT").data.foreach_set("value", nf_soft * (1 - cls))   # the neck fill stops at the collar
# neck skin under the jaw that the body pictures paint with their (higher, darker) collar, and (soft collar) skin beside
# the line: the clamp below pulls anything dark there back to the skin fill
high.data.attributes.new("neckskin", "FLOAT", "POINT").data.foreach_set("value", vsmooth(neckskin, 1))
print(f"class: {100 * cloth.mean():.1f}% cloth, {100 * known_c.mean():.1f}% cloth seen clean, {100 * (~cloth & ~known_s).mean():.1f}% skin unseen", flush=True)
if os.environ.get("TEX_DEBUG2"):
    # the shoulder tops (the collar smear): what owns them, what sees them, how they were classed
    for x0 in (0.06, 0.09, 0.12, 0.15):
        for z0 in (-0.08, -0.06, -0.04, -0.02, 0.0):
            m = (np.abs(np.abs(hv[:, 0]) - x0) < 0.015) & (zc > chin + z0 - 0.01) & (zc < chin + z0 + 0.01) & (hn[:, 1] < -0.3)
            if m.sum() > 20:
                print(f"front x {x0:.2f} z-chin {z0:+.3f}: n {m.sum()} own {head_m[m].mean():.2f} Sh {Sh[m].mean():.3f} Sb {Sb[m].mean():.3f} cls {cls[m].mean():.2f} nf {nf_soft[m].mean():.2f} S {S[m].mean():.3f} lumCs {(Cs[m] @ LUM).mean():.3f} y {hv[m, 1].mean():+.3f}")
    sys.stdout.flush(); os._exit(0)
if os.environ.get("TEX_DEBUG"):
    yb = hv[(np.abs(hv[:, 0] - B["head_x"]) < 0.02) & (np.abs(zc - chin) < 0.05)][:, 1].max()
    for z0 in np.arange(chin + 0.05, chin - 0.07, -0.01):
        m = (np.abs(hv[:, 0] - B["head_x"]) < 0.02) & (zc < z0) & (zc >= z0 - 0.01) & (hv[:, 1] > 0.02)
        if m.any():
            print(f"nape z-chin {z0 - chin:+.2f}: n {m.sum()} y {hv[m, 1].mean():.3f} nz {hn[m, 2].mean():+.2f} own {head_m[m].mean():.2f} nf {neckfill[m].mean():.2f} Sh {Sh[m].mean():.2f} Sb {Sb[m].mean():.2f} lumCb {(Cb[m] @ LUM).mean():.2f} S {S[m].mean():.2f} Cs {np.round(Cs[m].mean(0), 2)}")
    sys.stdout.flush(); os._exit(0)
fa = high.data.attributes.new("fill", "FLOAT_COLOR", "POINT")
fa.data.foreach_set("color", np.concatenate([Cs, np.ones((len(hv), 1), np.float32)], 1).ravel())
print(f"fill: {100 * unk.mean():.1f}% of the surface diffused ({time.time() - t0:.0f}s)", flush=True)

pm = bpy.data.materials.new("projection")
pm.use_nodes = True
nt = pm.node_tree
nt.nodes.clear()
N = nt.nodes.new
geo = N("ShaderNodeNewGeometry")
sep = N("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Position"], sep.inputs[0])
own_n = N("ShaderNodeAttribute"); own_n.attribute_name = "headown"
inv = N("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
nt.links.new(own_n.outputs["Fac"], inv.inputs[1])

def math(op, a, b=None):
    n = N("ShaderNodeMath"); n.operation = op
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: nt.links.new(x, n.inputs[i])
    return n.outputs[0]

def vdot(vec_out, const):
    n = N("ShaderNodeVectorMath"); n.operation = "DOT_PRODUCT"
    nt.links.new(vec_out, n.inputs[0]); n.inputs[1].default_value = const
    return n.outputs["Value"]

sum_c = None; sum_w = None
sum_cb = None; sum_wb = None; gate = None                 # the body pictures' own blend, for the per-texel skin test below
gate_n = N("ShaderNodeAttribute"); gate_n.attribute_name = "neckgate"
for i, pr in sorted(enumerate(projs), key=lambda t: t[1]["head"]):   # body pictures first: the head ones are gated by their blend
    if pr["head"] and gate is None:
        if sum_cb is not None:
            div = N("ShaderNodeVectorMath"); div.operation = "SCALE"; nt.links.new(sum_cb, div.inputs[0]); nt.links.new(math("DIVIDE", 1.0, math("MAXIMUM", sum_wb, 1e-7)), div.inputs["Scale"])
            skin_tex = N("ShaderNodeMapRange"); skin_tex.interpolation_type = "SMOOTHSTEP"
            skin_tex.inputs["From Min"].default_value = 0.05; skin_tex.inputs["From Max"].default_value = 0.10
            nt.links.new(vdot(div.outputs[0], (0.2126, 0.7152, 0.0722)), skin_tex.inputs["Value"])
            seen_b = N("ShaderNodeMapRange"); seen_b.interpolation_type = "SMOOTHSTEP"
            seen_b.inputs["From Min"].default_value = 0.1; seen_b.inputs["From Max"].default_value = 0.4
            nt.links.new(sum_wb, seen_b.inputs["Value"])
            gate = math("SUBTRACT", 1.0, math("MULTIPLY", math("MULTIPLY", gate_n.outputs["Fac"], math("SUBTRACT", 1.0, skin_tex.outputs[0])), seen_b.outputs[0]))
        else:
            gate = 1.0
    u = math("ADD", vdot(geo.outputs["Position"], pr["A"]), pr["B"])
    v = math("ADD", vdot(geo.outputs["Position"], pr["C"]), pr["D"])
    comb = N("ShaderNodeCombineXYZ"); nt.links.new(u, comb.inputs[0]); nt.links.new(v, comb.inputs[1])
    tex = N("ShaderNodeTexImage"); tex.image = pr["img"]; tex.extension = "EXTEND"; tex.interpolation = "Cubic"
    txb = N("ShaderNodeTexImage"); txb.image = pr["blur"]; txb.extension = "EXTEND"; txb.interpolation = "Linear"
    nt.links.new(comb.outputs[0], tex.inputs["Vector"]); nt.links.new(comb.outputs[0], txb.inputs["Vector"])
    facing = math("MAXIMUM", vdot(geo.outputs["Normal"], tuple(-x for x in pr["d"])), 0.0)
    sharp = N("ShaderNodeMapRange"); sharp.interpolation_type = "SMOOTHSTEP"
    sharp.inputs["From Min"].default_value = 0.2; sharp.inputs["From Max"].default_value = 0.5
    nt.links.new(facing, sharp.inputs["Value"])
    mix = N("ShaderNodeMix"); mix.data_type = "RGBA"
    nt.links.new(sharp.outputs[0], mix.inputs[0]); nt.links.new(txb.outputs["Color"], mix.inputs[6]); nt.links.new(tex.outputs["Color"], mix.inputs[7])
    att = N("ShaderNodeAttribute"); att.attribute_name = f"vis{i}"
    w = math("MULTIPLY", math("POWER", facing, pr["power"]), pr["gain"])
    w = math("MULTIPLY", w, att.outputs["Fac"])
    txc = N("ShaderNodeTexImage"); txc.image = pr["conf"]; txc.extension = "EXTEND"; txc.interpolation = "Linear"
    nt.links.new(comb.outputs[0], txc.inputs["Vector"])
    w = math("MULTIPLY", w, txc.outputs["Color"])
    w = math("MULTIPLY", w, own_n.outputs["Fac"] if pr["head"] else inv.outputs[0])
    if pr["head"] and not isinstance(gate, float): w = math("MULTIPLY", w, gate)
    sc = N("ShaderNodeVectorMath"); sc.operation = "SCALE"
    nt.links.new(mix.outputs[2], sc.inputs[0]); nt.links.new(w, sc.inputs["Scale"])
    if not pr["head"]:
        scb = N("ShaderNodeVectorMath"); scb.operation = "SCALE"; nt.links.new(mix.outputs[2], scb.inputs[0]); nt.links.new(w, scb.inputs["Scale"])
        if sum_cb is None: sum_cb, sum_wb = scb.outputs[0], w
        else:
            adb = N("ShaderNodeVectorMath"); adb.operation = "ADD"; nt.links.new(sum_cb, adb.inputs[0]); nt.links.new(scb.outputs[0], adb.inputs[1]); sum_cb = adb.outputs[0]
            sum_wb = math("ADD", sum_wb, w)
    if sum_c is None:
        sum_c, sum_w = sc.outputs[0], w
    else:
        ad = N("ShaderNodeVectorMath"); ad.operation = "ADD"
        nt.links.new(sum_c, ad.inputs[0]); nt.links.new(sc.outputs[0], ad.inputs[1]); sum_c = ad.outputs[0]
        sum_w = math("ADD", sum_w, w)
fin = N("ShaderNodeVectorMath"); fin.operation = "SCALE"
nt.links.new(sum_c, fin.inputs[0]); nt.links.new(math("DIVIDE", 1.0, math("MAXIMUM", sum_w, 1e-7)), fin.inputs["Scale"])
fillc = N("ShaderNodeAttribute"); fillc.attribute_name = "fill"
trust = N("ShaderNodeMapRange"); trust.interpolation_type = "SMOOTHSTEP"
trust.inputs["From Min"].default_value = 0.03; trust.inputs["From Max"].default_value = 0.12
nt.links.new(sum_w, trust.inputs["Value"])
nfa = N("ShaderNodeAttribute"); nfa.attribute_name = "neckfill"
# the clamp: on cloth anything light (skin blurred over the collar, the shoulder seam, a hem) becomes the
# clean cloth fill; on the neck skin anything dark (a collar painted higher than the mesh's) becomes skin
lum = vdot(fin.outputs[0], (0.2126, 0.7152, 0.0722))
light = N("ShaderNodeMapRange"); light.interpolation_type = "SMOOTHSTEP"
light.inputs["From Min"].default_value = 0.024; light.inputs["From Max"].default_value = 0.045
nt.links.new(lum, light.inputs["Value"])
if OUTFIT:
    # a look's cloth is not black: "light on cloth" means clearly lighter than that look's own cloth fill at this point
    flum = vdot(fillc.outputs["Color"], (0.2126, 0.7152, 0.0722))
    nt.links.new(math("ADD", math("MULTIPLY", flum, 1.8), 0.03), light.inputs["From Min"])
    nt.links.new(math("ADD", math("MULTIPLY", flum, 2.6), 0.06), light.inputs["From Max"])
darkn = N("ShaderNodeMapRange"); darkn.interpolation_type = "SMOOTHSTEP"
darkn.inputs["From Min"].default_value = 0.05; darkn.inputs["From Max"].default_value = 0.11
nt.links.new(lum, darkn.inputs["Value"])
cla = N("ShaderNodeAttribute"); cla.attribute_name = "cloth"
nsa = N("ShaderNodeAttribute"); nsa.attribute_name = "neckskin"
clampf = math("MINIMUM", math("ADD", math("MULTIPLY", cla.outputs["Fac"], light.outputs[0]),
                               math("MULTIPLY", nsa.outputs["Fac"], math("SUBTRACT", 1.0, darkn.outputs[0]))), 1.0)
# soft collar: inside the band the fill is skin or cloth per texel, by the projected luminance, so the painted neckline
# (not the vertex lattice) draws the edge wherever the fill shows
banda = N("ShaderNodeAttribute"); banda.attribute_name = "band"
fsa = N("ShaderNodeAttribute"); fsa.attribute_name = "fillskin"
fca = N("ShaderNodeAttribute"); fca.attribute_name = "fillcloth"
skinness = N("ShaderNodeMapRange"); skinness.interpolation_type = "SMOOTHSTEP"
skinness.inputs["From Min"].default_value = 0.045; skinness.inputs["From Max"].default_value = 0.09
nt.links.new(lum, skinness.inputs["Value"])
feff = N("ShaderNodeMix"); feff.data_type = "RGBA"
nt.links.new(skinness.outputs[0], feff.inputs[0]); nt.links.new(fca.outputs["Color"], feff.inputs[6]); nt.links.new(fsa.outputs["Color"], feff.inputs[7])
fuse = N("ShaderNodeMix"); fuse.data_type = "RGBA"
nt.links.new(banda.outputs["Fac"], fuse.inputs[0]); nt.links.new(fillc.outputs["Color"], fuse.inputs[6]); nt.links.new(feff.outputs[2], fuse.inputs[7])
fmix = N("ShaderNodeMix"); fmix.data_type = "RGBA"
fac = math("MULTIPLY", math("MULTIPLY", trust.outputs[0], math("SUBTRACT", 1.0, nfa.outputs["Fac"])), math("SUBTRACT", 1.0, clampf))
nt.links.new(fac, fmix.inputs[0]); nt.links.new(fuse.outputs[2], fmix.inputs[6]); nt.links.new(fin.outputs[0], fmix.inputs[7])
em = N("ShaderNodeEmission"); nt.links.new(fmix.outputs[2], em.inputs["Color"])
out = N("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs["Surface"])
high.data.materials.append(pm)

# ------------------------------------------------------------------ bake
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.view_settings.view_transform = "Standard"
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.006
scene.render.bake.max_ray_distance = 0.03
scene.render.bake.margin = 10
scene.render.bake.margin_type = "EXTEND"
os.makedirs(TEX_OUT, exist_ok=True)

def target(kind, colorspace):
    imgs = {}
    for name, m in mats.items():
        img = bpy.data.images.new(f"gun_{name}_{kind}", TEX[name], TEX[name], alpha=False)
        img.colorspace_settings.name = colorspace
        node = m.node_tree.nodes.new("ShaderNodeTexImage"); node.image = img; node.name = "bake_" + kind
        for n in m.node_tree.nodes: n.select = False
        node.select = True; m.node_tree.nodes.active = node
        imgs[name] = img
    return imgs

bpy.ops.object.select_all(action="DESELECT")
high.select_set(True); low.select_set(True)
bpy.context.view_layer.objects.active = low
col = target("color", "sRGB")
bpy.ops.object.bake(type="EMIT")
if OUTFIT:                                   # the normal map is geometry only: the shipped one stays
    for name, img in col.items():
        img.filepath_raw = os.path.join(TEX_OUT, f"gun_{name}_color.png"); img.file_format = "PNG"; img.save()
    nor = {}
else:
    nor = target("normal", "Non-Color")
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    for kind, imgs in (("color", col), ("normal", nor)):
        for name, img in imgs.items():
            img.filepath_raw = P(f"work/tex/gun_{name}_{kind}.png"); img.file_format = "PNG"; img.save()

# ------------------------------------------------------------------ roughness from colour (skin 0.55, cloth 0.85)
rough = {}
for name, img in col.items():
    n = TEX[name]
    px = np.empty(n * n * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(n, n, 4)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    skin = np.clip((r - 0.28) / 0.2, 0, 1) * np.clip((r - b * 1.15) / 0.08, 0, 1)
    rgh = 0.86 - 0.3 * skin
    orm = np.ones((n, n, 4), np.float32); orm[..., 1] = rgh; orm[..., 2] = 0.0
    ri = bpy.data.images.new(f"gun_{name}_orm", n, n, alpha=False)
    ri.colorspace_settings.name = "Non-Color"
    ri.pixels.foreach_set(orm.ravel())
    ri.scale(1024, 1024)
    ri.filepath_raw = os.path.join(TEX_OUT, f"gun_{name}_orm.png"); ri.file_format = "PNG"; ri.save()
    rough[name] = ri
if OUTFIT:
    print("outfit", OUTFIT, "baked colour + orm to", TEX_OUT, flush=True); sys.stdout.flush(); os._exit(0)

# ------------------------------------------------------------------ final materials on low
for name, m in mats.items():
    nt2 = m.node_tree
    bsdf = next(n for n in nt2.nodes if n.type == "BSDF_PRINCIPLED")
    c_node = nt2.nodes["bake_color"]; n_node = nt2.nodes["bake_normal"]
    nt2.links.new(c_node.outputs["Color"], bsdf.inputs["Base Color"])
    nm = nt2.nodes.new("ShaderNodeNormalMap")
    nt2.links.new(n_node.outputs["Color"], nm.inputs["Color"]); nt2.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    r_node = nt2.nodes.new("ShaderNodeTexImage"); r_node.image = rough[name]
    sp = nt2.nodes.new("ShaderNodeSeparateColor")
    nt2.links.new(r_node.outputs["Color"], sp.inputs[0])
    nt2.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"]); nt2.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
for img in bpy.data.images:
    if img.filepath_raw.startswith(P("work/tex")):
        img.filepath = img.filepath_raw
high.hide_render = True; high.hide_viewport = True
bpy.ops.wm.save_as_mainfile(filepath=P("work/stage2.blend"))
print("baked", [(k, tuple(i.size)) for k, i in col.items()])
