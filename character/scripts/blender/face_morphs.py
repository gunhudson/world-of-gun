"""Face morph targets, sculpted procedurally from the bust sheet's face landmarks (work/face_landmarks.json,
made by scripts/face_landmarks.py). Used by 04_rig.py on the game mesh and by 07_export_lite.py on the
phone mesh, so both carry the same names: blink, blinkL, blinkR, smile, browUp.

The head is one closed surface with painted eyes, not a rigged face: a blink moves the upper-lid skin
down over the eye and sinks the eye surface behind it (self-intersection is fine at these sizes, the lid
is what the camera sees); the lower lid rises a little. A smile lifts and widens the mouth corners and
pushes the cheeks up; browUp raises the brow line. Sizes are millimetres on a 1.8 m body (they scale with the character).
"""
import json
import numpy as np


def _smooth(disp, ed, nv, it):
    deg = np.bincount(ed.ravel(), minlength=nv).astype(np.float32)
    for _ in range(it):
        acc = np.zeros_like(disp)
        np.add.at(acc, ed[:, 0], disp[ed[:, 1]]); np.add.at(acc, ed[:, 1], disp[ed[:, 0]])
        disp = 0.5 * disp + 0.5 * acc / np.maximum(deg, 1)[:, None]
    return disp


def face_morphs(pos, nrm, ed, build, landmarks, chin_z):
    """pos (nv,3) rest positions in metres (Blender axes: +Z up, the face looks along -Y), nrm (nv,3) vertex normals,
    ed (ne,2) edges, build = work/build.json, landmarks = work/face_landmarks.json. Returns {name: (nv,3) displacement}."""
    nv = len(pos)
    f = build["bust_front"]
    X = lambda px: f["ax"] * px + f["bx"]
    Z = lambda py: f["az"] * py + f["bz"]
    L = landmarks["named"]
    pt = lambda k: np.array([X(L[k][0]), Z(L[k][1])], np.float32)
    # the face: front-facing head vertices (the painted eyes and mouth are on the front half)
    face = (nrm[:, 1] < -0.05) & (pos[:, 2] > chin_z - 0.03)
    xz = pos[:, [0, 2]]
    out = {}

    def ellipse_w(c, rx, rz, p=2.0):
        d = (xz - c) / np.array([rx, rz], np.float32)
        r2 = (d * d).sum(1)
        return np.where(face & (r2 < 1), (1 - r2) ** p, 0).astype(np.float32)

    # ---- blink, one per eye
    for side, o, i, tp, bt in (("R", "eyeR_outer", "eyeR_inner", "eyeR_top", "eyeR_bot"), ("L", "eyeL_outer", "eyeL_inner", "eyeL_top", "eyeL_bot")):
        c = 0.5 * (pt(o) + pt(i)); c[1] = 0.5 * (pt(tp)[1] + pt(bt)[1])
        a = abs(pt(o)[0] - pt(i)[0]) * 0.5            # half width of the eye opening
        b = max(abs(pt(tp)[1] - pt(bt)[1]) * 0.5, 0.003)   # half height
        rx, rz = a * 1.35, b * 4.0                    # region: the eye and the lid skin above it
        d = (xz - c) / np.array([rx, rz], np.float32)
        r2 = (d * d).sum(1)
        inside = face & (r2 < 1)
        dz = xz[:, 1] - c[1]
        wx = np.clip(1 - (d[:, 0] ** 2), 0, 1) ** 0.5    # full strength across the opening, soft at the corners
        disp = np.zeros((nv, 3), np.float32)
        # upper lid and the skin above it: come down to just under the eye's centre line
        up = inside & (dz > 0)
        reach = np.clip(1 - (dz[up] - 1.6 * b) / (rz - 1.6 * b), 0, 1)       # 1 up to 1.6 b above the centre, then fades
        disp[up, 2] = -np.minimum(dz[up] + 0.9 * b, 2.4 * b) * reach * wx[up]
        disp[up, 1] = 0.0006 * reach * wx[up]                                 # and a touch back, so the lid lies on the eye
        # the eye surface itself: sink behind the descending lid and flatten towards the lower lid
        eye = inside & (np.abs(dz) <= b * 1.1)
        disp[eye, 1] += 0.0028 * wx[eye]
        # lower lid: a small rise
        lo = inside & (dz < 0) & (dz > -rz)
        disp[lo, 2] += 0.35 * b * np.clip(1 + dz[lo] / (2.2 * b), 0, 1) * wx[lo]
        out["blink" + side] = _smooth(disp, ed, nv, 2)
    out["blink"] = out["blinkR"] + out["blinkL"]

    # ---- smile: corners up and out, cheeks up and forward, lips a little wider
    disp = np.zeros((nv, 3), np.float32)
    for k, sx in (("mouthR", -1.0), ("mouthL", 1.0)):
        c = pt(k)
        w = ellipse_w(c, 0.030, 0.024, 1.6)
        disp[:, 2] += 0.0038 * w
        disp[:, 0] += 0.0024 * sx * w
        disp[:, 1] += 0.0012 * w                       # the corner tucks back as it rises
    for k in ("cheekR", "cheekL"):
        c = pt(k) + np.array([0, -0.012], np.float32)
        w = ellipse_w(c, 0.034, 0.030, 1.5)
        disp[:, 2] += 0.0020 * w
        disp[:, 1] -= 0.0015 * w                       # cheeks come forward
    out["smile"] = _smooth(disp, ed, nv, 3)

    # ---- browUp: the brow line rises, the skin above it follows
    disp = np.zeros((nv, 3), np.float32)
    for side in ("R", "L"):
        pts = [pt(f"brow{side}_out"), pt(f"brow{side}"), pt(f"brow{side}_in")]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            seg = p1 - p0; ln = max(float(np.dot(seg, seg)), 1e-8)
            tt = np.clip(((xz - p0) @ seg) / ln, 0, 1)
            near = p0 + tt[:, None] * seg
            dd = xz - near
            dist2 = (dd[:, 0] / 0.016) ** 2 + (np.where(dd[:, 1] > 0, dd[:, 1] / 0.026, dd[:, 1] / 0.012)) ** 2
            w = np.where(face & (dist2 < 1), (1 - dist2) ** 1.4, 0)
            disp[:, 2] = np.maximum(disp[:, 2], 0.0032 * w)
    out["browUp"] = _smooth(disp, ed, nv, 3)
    return out


def load_landmarks(path):
    return json.load(open(path))
