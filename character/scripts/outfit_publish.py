#!/usr/bin/env python3
"""Publish an outfit's baked maps as JPEGs the client swaps in at run time (see outfits.sh):
  public/tex/gun_body_<outfit>.jpg        2048 colour (full model)      public/tex/gun_body_<outfit>_orm.jpg       1024 ORM
  public/tex/gun_body_<outfit>_lite.jpg   1024 colour (lite model)      public/tex/gun_body_<outfit>_lite_orm.jpg  512 ORM
The normal maps are geometry only and stay the model's own."""
import os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
o = sys.argv[1]
src = os.path.join(ROOT, "work", "outfits", o); dst = os.path.join(ROOT, "..", "public", "tex"); os.makedirs(dst, exist_ok=True)
for tex, suffix, q in (("tex", "", 88), ("tex_lite", "_lite", 86)):
    for kind, tail in (("color", ""), ("orm", "_orm")):
        p = os.path.join(src, tex, f"gun_body_{kind}.png"); out = os.path.join(dst, f"gun_body_{o}{suffix}{tail}.jpg")
        Image.open(p).convert("RGB").save(out, quality=q, optimize=True, progressive=False)
        print(os.path.relpath(out, os.path.join(ROOT, "..")), os.path.getsize(out))
