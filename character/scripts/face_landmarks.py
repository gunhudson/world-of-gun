#!/usr/bin/env python3
"""Face landmarks (mediapipe, 468-point topology) on a front bust sheet, in sheet pixels.

  uv run -q --with mediapipe --with pillow python scripts/face_landmarks.py sheets/bust_front.png work/face_landmarks.json

Writes {"w","h","pts":[[x,y,z],...]} plus the named points 04_rig.py uses for the face morph targets
(eye corners, lids, mouth corners, lips, brows). Pixel y runs down, like the pixel picks in config.json.
"""
import sys, json
import numpy as np
from PIL import Image
import mediapipe as mp

NAMED = {"eyeR_outer": 33, "eyeR_inner": 133, "eyeR_top": 159, "eyeR_bot": 145,
         "eyeL_inner": 362, "eyeL_outer": 263, "eyeL_top": 386, "eyeL_bot": 374,
         "mouthR": 61, "mouthL": 291, "lipTop": 13, "lipBot": 14,
         "browR": 105, "browL": 334, "browR_in": 107, "browL_in": 336, "browR_out": 70, "browL_out": 300,
         "noseTip": 1, "chin": 152, "cheekR": 50, "cheekL": 280}

src, out = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(src).convert("RGB"))
h, w = img.shape[:2]
pts = None
try:
    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True, max_num_faces=1)
    lm = fm.process(img).multi_face_landmarks[0].landmark
    pts = [(p.x * w, p.y * h, p.z * w) for p in lm]
    api = "solutions"
except Exception as e:  # mediapipe >= 0.10 tasks API
    from mediapipe.tasks import python as mpp
    from mediapipe.tasks.python import vision
    import os, urllib.request
    mdl = os.environ.get("FACE_MODEL") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "work", "face_landmarker.task")
    os.makedirs(os.path.dirname(mdl), exist_ok=True)
    if not os.path.exists(mdl):
        urllib.request.urlretrieve("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", mdl)
    det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=mdl), num_faces=1))
    lm = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=img)).face_landmarks[0]
    pts = [(p.x * w, p.y * h, p.z * w) for p in lm]
    api = "tasks"
named = {k: [round(pts[i][0], 1), round(pts[i][1], 1)] for k, i in NAMED.items()}
json.dump({"w": w, "h": h, "api": api, "named": named, "pts": [[round(c, 2) for c in p] for p in pts]}, open(out, "w"), indent=0)
print(api, len(pts))
for k, v in named.items():
    print(f"{k:12s} {v}")
