#!/usr/bin/env python3
"""Cut a character-sheet image off its flat grey background.

  uv run --with numpy --with pillow --with scipy python prep_images.py <in.png> <out_prefix>

Writes <out_prefix>_pad.png  (RGB, foreground colours dilated far into the background so that
                              texture projection never samples backdrop grey at the silhouette)
       <out_prefix>_blur.png (the same, blurred: used where a surface faces the view at a grazing angle)
       <out_prefix>_mask.png (L, 255 = figure)
       <out_prefix>_conf.png (L, how far inside the silhouette a pixel is; projection weight)
       <out_prefix>.json     ({"w","h","bbox":[x0,y0,x1,y1]} of the figure in pixels, x1/y1 exclusive)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 22.0
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
h, w, _ = im.shape

# background model: smooth fit through the border pixels (the backdrop has a faint vignette)
yy, xx = np.mgrid[0:h, 0:w]
border = np.zeros((h, w), bool)
border[:6, :] = border[:, :6] = border[:, -6:] = True
if "bust" in out or "head" in out:
    border[-6:, :] = False          # bust: the shirt runs off the bottom edge
else:
    border[-6:, :] = True
A = np.stack([np.ones(border.sum()), xx[border] / w, yy[border] / h, (xx[border] / w) ** 2, (yy[border] / h) ** 2], 1)
bgm = np.zeros_like(im)
Af = np.stack([np.ones(h * w), xx.ravel() / w, yy.ravel() / h, (xx.ravel() / w) ** 2, (yy.ravel() / h) ** 2], 1)
for c in range(3):
    # robust: drop border pixels far from the median (figure touching the edge)
    v = im[..., c][border]
    keep = np.abs(v - np.median(v)) < 25
    coef, *_ = np.linalg.lstsq(A[keep], v[keep], rcond=None)
    bgm[..., c] = (Af @ coef).reshape(h, w)
dist = np.sqrt(((im - bgm) ** 2).sum(-1))
cand_bg = dist < tol
# background = candidate pixels connected to the image border
lab, n = ndi.label(cand_bg)
edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = np.isin(lab, edge_labels[edge_labels > 0])
fg = ~bg
fg = ndi.binary_opening(fg, iterations=1)
lab, n = ndi.label(fg)
if n > 1:
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    fg = lab == (1 + int(np.argmax(sizes)))
fg = ndi.binary_fill_holes(fg) if ("bust" in out or "head" in out) else fg

ys, xs = np.where(fg)
bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]

# pad: erode the mask (the anti-aliased rim and stray hairs are contaminated with backdrop grey),
# copy the nearest clean foreground colour outward, then soften the copied area so it has no streaks
core = ndi.binary_erosion(fg, iterations=6)
idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
pad = im[idx[0], idx[1]]
soft = np.stack([ndi.gaussian_filter(pad[..., c], 5) for c in range(3)], -1)
dist_out = ndi.distance_transform_edt(~core)
t = np.clip(dist_out / 6.0, 0, 1)[..., None]
pad = pad * (1 - t) + soft * t
if os.path.basename(out) in ("body_front", "body_back"):   # not the side views: there the arm lies over the torso
    # the generated mesh's sleeves and shorts end about a centimetre lower than the painted ones, which
    # leaves a skin-coloured rim on every hem: grow dark cloth outward by 10 px (1.2 cm) over lighter pixels
    # (a round footprint: a square one grows a diagonal hem or neckline in 21 px steps, which the bake carried onto
    # the model as a regular stair-stepped sawtooth along the V-neck)
    yy, xx = np.mgrid[-10:11, -10:11]; disk = (xx * xx + yy * yy) <= 10 * 10 + 1
    mn = np.stack([ndi.minimum_filter(pad[..., c], footprint=disk) for c in range(3)], -1)
    grow = (mn @ np.array([0.299, 0.587, 0.114], np.float32)) < 45
    if os.environ.get("HEM_SOLID"):
        # outfit looks (HEM_SOLID=1 from outfits.sh): only a solid dark area is a garment. A heather tank or a shadow has
        # stray pixels under the threshold, and growing each of them made 2 cm dark blotches on the lower back and arms.
        # (an all-black base outfit is unaffected by this; it stays off there so the shipped
        # bake stays byte for byte.)
        dark = (pad @ np.array([0.299, 0.587, 0.114], np.float32)) < 45
        y5, x5 = np.mgrid[-5:6, -5:6]; d5 = (x5 * x5 + y5 * y5) <= 26
        solid = ndi.binary_opening(dark, structure=d5)
        grow &= ndi.binary_dilation(solid, structure=disk)
    grow = ndi.gaussian_filter(grow.astype(np.float32), 1.5)[..., None]
    pad = pad * (1 - grow) + mn * grow
# a mild unsharp mask: the painted pictures are soft and the bake samples them with cubic interpolation,
# so the detail that is there should arrive whole (small radius, no halos at this amount)
pad = np.clip(pad + 0.45 * (pad - np.stack([ndi.gaussian_filter(pad[..., c], 1.2) for c in range(3)], -1)), 0, 255)
blur = np.stack([ndi.gaussian_filter(pad[..., c], 9) for c in range(3)], -1)
Image.fromarray(pad.clip(0, 255).astype(np.uint8)).save(out + "_pad.png")
Image.fromarray(blur.clip(0, 255).astype(np.uint8)).save(out + "_blur.png")
Image.fromarray((fg * 255).astype(np.uint8)).save(out + "_mask.png")
conf = np.clip((ndi.distance_transform_edt(fg) - 2.0) / 8.0, 0, 1)   # 0 at the silhouette, 1 a few px inside
_cfg_path = os.environ.get("CHAR_CONFIG") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")
_cfg = json.load(open(_cfg_path))
if ("bust" in out or "head" in out) and _cfg.get("bust", {}).get("skin_only"):
    # head views texture skin only: give the shirt (dark, connected to the bottom edge) no weight, so a
    # collar painted higher than the mesh's own collar cannot creep up the neck
    lum = im @ np.array([0.299, 0.587, 0.114], np.float32)
    dark = (lum < 70) & fg
    lab2, _ = ndi.label(dark)
    keep = np.unique(lab2[-3:, :]); keep = keep[keep > 0]
    shirt = ndi.binary_dilation(np.isin(lab2, keep), iterations=8)
    conf = conf * (1 - ndi.gaussian_filter(shirt.astype(np.float32), 2))
Image.fromarray((conf * 255).astype(np.uint8)).save(out + "_conf.png")
json.dump({"w": w, "h": h, "bbox": bbox}, open(out + ".json", "w"))
print(out, {"w": w, "h": h, "bbox": bbox}, "fg%", round(100 * fg.mean(), 1))
