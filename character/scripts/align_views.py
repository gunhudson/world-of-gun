#!/usr/bin/env python3
"""Align a painted view with the clay render it was generated from.

  uv run --with numpy --with pillow python align_views.py <clay_mask.png> <painted_mask.png> <row_limit|0> <out.json>

Finds a uniform scale + offset (painted_px = s * clay_px + (tx, ty)) that maximises the IoU of the
two silhouettes; with <row_limit> only the rows above it are compared (head views: clothes drift).
"""
import json, sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("L")) > 127
b = np.asarray(Image.open(sys.argv[2]).convert("L")) > 127
row = int(float(sys.argv[3])) or a.shape[0]
h, w = a.shape
def box(m):
    ys, xs = np.where(m[:row]); return xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
ax0, ax1, ay0, ay1 = box(a); bx0, bx1, by0, by1 = box(b)
full = row >= h
s0 = (by1 - by0) / (ay1 - ay0) if full else (bx1 - bx0) / (ax1 - ax0)
tx0 = 0.5 * (bx0 + bx1) - s0 * 0.5 * (ax0 + ax1); ty0 = by0 - s0 * ay0
st = 3                                              # subsample for speed
yy, xx = np.mgrid[0:row:st, 0:w:st]
A = a[0:row:st, 0:w:st]
def iou(s, tx, ty):
    sx = np.clip(np.rint(s * xx + tx).astype(int), 0, w - 1); sy = np.clip(np.rint(s * yy + ty).astype(int), 0, h - 1)
    bb = b[sy, sx] & (s * yy + ty < (row if not full else h))
    return (A & bb).sum() / max(1, (A | bb).sum())
best = (iou(s0, tx0, ty0), s0, tx0, ty0)
for rng_s, rng_t, n in ((0.04, 16, 9), (0.01, 4, 9), (0.003, 1.5, 7)):
    _, s_, tx_, ty_ = best
    for s in np.linspace(s_ - rng_s, s_ + rng_s, n):
        for tx in np.linspace(tx_ - rng_t, tx_ + rng_t, n):
            for ty in np.linspace(ty_ - rng_t, ty_ + rng_t, n):
                v = iou(s, tx + (s_ - s) * 0.5 * (ax0 + ax1), ty + (s_ - s) * ay0)
                if v > best[0]:
                    best = (v, s, tx + (s_ - s) * 0.5 * (ax0 + ax1), ty + (s_ - s) * ay0)
v, s, tx, ty = best
json.dump({"s": float(s), "tx": float(tx), "ty": float(ty), "iou": float(v)}, open(sys.argv[4], "w"))
print(sys.argv[4], {"s": round(float(s), 4), "tx": round(float(tx), 1), "ty": round(float(ty), 1), "iou": round(float(v), 4)})
