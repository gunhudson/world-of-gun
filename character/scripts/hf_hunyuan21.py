#!/usr/bin/env python3
"""Free image-to-3D via the tencent/Hunyuan3D-2.1 Hugging Face Space (ZeroGPU).
usage: hf_hunyuan21.py <out_dir> <front.png> [back.png [left.png [right.png]]]
Set HF_TOKEN for a larger ZeroGPU quota (anonymous works for a run or two a day)."""
import os, shutil, sys, json
from gradio_client import Client, handle_file
out = sys.argv[1]; imgs = sys.argv[2:]
os.makedirs(out, exist_ok=True)
c = Client("tencent/Hunyuan3D-2.1", token=os.environ.get("HF_TOKEN")) if os.environ.get("HF_TOKEN") else Client("tencent/Hunyuan3D-2.1")
mv = len(imgs) > 1
kw = dict(image=None if mv else handle_file(imgs[0]),
          mv_image_front=handle_file(imgs[0]) if mv else None,
          mv_image_back=handle_file(imgs[1]) if len(imgs) > 1 else None,
          mv_image_left=handle_file(imgs[2]) if len(imgs) > 2 else None,
          mv_image_right=handle_file(imgs[3]) if len(imgs) > 3 else None,
          steps=30, guidance_scale=5.0, seed=1234, octree_resolution=int(os.environ.get("OCTREE", "384")),
          check_box_rembg=True, num_chunks=8000, randomize_seed=False)
res = c.predict(api_name="/generation_all", **kw)
print(json.dumps([str(r)[:300] for r in res], indent=1))
for i, r in enumerate(res[:2]):
    p = r["value"] if isinstance(r, dict) and "value" in r else r
    if isinstance(p, str) and os.path.exists(p):
        dst = os.path.join(out, ("shape" if i == 0 else "textured") + os.path.splitext(p)[1])
        shutil.copy(p, dst); print("saved", dst, os.path.getsize(dst))
