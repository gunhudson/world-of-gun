#!/usr/bin/env python3
"""Writes prompts/outfits/<outfit>_<view>.txt and prompts/outfits/refs.json for ./outfits.sh gen.

Outfits are defined in outfits.json (copy outfits.example.json): one entry per look, naming the clothes to paint and
the reference photos of the real items. The prompts ask the image model for the SAME sheet picture with only the clothes
changed, so the painted views still overlay the clay renders and the texture bake needs no new alignment logic.

  python3 scripts/outfit_prompts.py [outfits.json]
"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = {
 "front": "Image 1 is the finished FRONT view of a stylised-realistic 3D game character reference: a person standing in an A-pose on a flat light grey background. {refs}\n\nOutput the SAME image as image 1: the identical figure, face, head, skin, hands, pose, body proportions, outline, position and scale in the frame, the identical perfectly even shadowless lighting and the same flat solid light grey background (#c8c8c8). Change ONLY the clothes, as follows:\n{clothes}\nEverything that is not listed stays exactly as in image 1 (accessories, skin tone, hair). Do not move, rotate, resize or reframe anything: the result must overlay image 1 pixel for pixel. No text, no labels, no logos other than the ones described, no border, one figure only.",
 "back": "Image 1 is the finished BACK view of a stylised-realistic 3D game character reference: a person standing in an A-pose, facing away, on a flat light grey background. Image 2 is the new FRONT view of the same character wearing the outfit to reproduce. {refs}\n\nOutput the SAME image as image 1: the identical figure, head, skin, hands, pose, proportions, outline, position and scale in the frame, the identical even shadowless lighting and the same flat light grey background (#c8c8c8). Change ONLY the clothes so that they match image 2 seen from behind:\n{clothes}\nEverything not listed stays exactly as in image 1. Do not move, rotate, resize or reframe anything: the result must overlay image 1 pixel for pixel. No text, no labels, no border, one figure only.",
 "L": "Image 1 is the finished LEFT SIDE view of a stylised-realistic 3D game character reference: a person standing in an A-pose, seen from their left (they face the left edge of the image), on a flat light grey background; it was painted to overlay a clay render exactly. Image 2 is the new FRONT view of the same character wearing the outfit to reproduce. {refs}\n\nOutput the SAME image as image 1: the identical figure, head, skin, hands, pose, proportions, outline, position and scale in the frame, the identical even shadowless lighting and the same flat light grey background (#c8c8c8). Change ONLY the clothes so that they match image 2 seen from the side:\n{clothes}\nEverything not listed stays exactly as in image 1. Do not move, rotate, resize or reframe anything: the result must overlay image 1 pixel for pixel. No text, no labels, no border, one figure only.",
 "R": "Image 1 is the finished RIGHT SIDE view of a stylised-realistic 3D game character reference: a person standing in an A-pose, seen from their right (they face the right edge of the image), on a flat light grey background; it was painted to overlay a clay render exactly. Image 2 is the new FRONT view of the same character wearing the outfit to reproduce. {refs}\n\nOutput the SAME image as image 1: the identical figure, head, skin, hands, pose, proportions, outline, position and scale in the frame, the identical even shadowless lighting and the same flat light grey background (#c8c8c8). Change ONLY the clothes so that they match image 2 seen from the side:\n{clothes}\nEverything not listed stays exactly as in image 1. Do not move, rotate, resize or reframe anything: the result must overlay image 1 pixel for pixel. No text, no labels, no border, one figure only.",
}
if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "outfits.json")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src}: copy outfits.example.json to outfits.json and describe your own outfits")
    outfits = json.load(open(src))
    out = os.path.join(ROOT, "prompts", "outfits"); os.makedirs(out, exist_ok=True)
    for o, d in outfits.items():
        if o.startswith("_"): continue
        for v, t in VIEWS.items():
            open(os.path.join(out, f"{o}_{v}.txt"), "w").write(t.format(refs=d["refs_front"] if v == "front" else d["refs_other"], clothes=d["clothes"]) + "\n")
    json.dump({o: d["refs"] for o, d in outfits.items() if not o.startswith("_")}, open(os.path.join(out, "refs.json"), "w"), indent=1)
    print(sorted(os.listdir(out)))
