#!/usr/bin/env python3
"""Free shape-only image-to-3D via the tencent/Hunyuan3D-2.1 Space (fits the anonymous ZeroGPU limit).
usage: hf_hunyuan21_shape.py <out.glb> <front.png> [back.png]"""
import os, shutil, sys, json
from gradio_client import Client, handle_file
out = sys.argv[1]; imgs = sys.argv[2:]
c = Client("tencent/Hunyuan3D-2.1")
mv = len(imgs) > 1
res = c.predict(api_name="/shape_generation",
    image=None if mv else handle_file(imgs[0]),
    mv_image_front=handle_file(imgs[0]) if mv else None,
    mv_image_back=handle_file(imgs[1]) if mv else None, mv_image_left=None, mv_image_right=None,
    steps=30, guidance_scale=5.0, seed=1234, octree_resolution=int(os.environ.get("OCTREE", "384")),
    check_box_rembg=True, num_chunks=8000, randomize_seed=False)
print(json.dumps([str(r)[:300] for r in res], indent=1))
p = res[0]["value"] if isinstance(res[0], dict) else res[0]
shutil.copy(p, out); print("saved", out, os.path.getsize(out))
