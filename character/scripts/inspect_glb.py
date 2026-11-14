#!/usr/bin/env python3
"""Print the facts that matter about a GLB: size, triangles, bounds, skins, clips, morph targets, textures."""
import json, struct, sys, os
p = sys.argv[1]
f = open(p, "rb"); magic, ver, length = struct.unpack("<III", f.read(12)); clen, _ = struct.unpack("<II", f.read(8)); j = json.loads(f.read(clen))
acc = j["accessors"]
tris = 0; verts = 0
for m in j["meshes"]:
    for pr in m["primitives"]:
        tris += acc[pr["indices"]]["count"] // 3; verts += acc[pr["attributes"]["POSITION"]]["count"]
        a = acc[pr["attributes"]["POSITION"]]
        print(f"  primitive: {acc[pr['indices']]['count'] // 3} tris, {a['count']} verts, min {[round(x, 3) for x in a['min']]} max {[round(x, 3) for x in a['max']]}, attrs {sorted(pr['attributes'])}, targets {len(pr.get('targets', []))}")
    print("  mesh", m["name"], "targetNames", (m.get("extras") or {}).get("targetNames"))
print(f"file {os.path.getsize(p) / 1e6:.2f} MB | triangles {tris} | vertices {verts} | nodes {len(j['nodes'])} | skins {[len(s['joints']) for s in j.get('skins', [])]}")
print("extensions", j.get("extensionsUsed"), "| generator", j["asset"].get("generator"))
for a in j.get("animations", []):
    t = max(acc[s["input"]]["max"][0] for s in a["samplers"])
    print(f"  clip {a['name']:<11} {t:5.2f} s  {len(a['channels'])} channels")
bv = j.get("bufferViews", [])
for im in j.get("images", []):
    print("  image", im.get("name"), im.get("mimeType"), f"{bv[im['bufferView']]['byteLength'] / 1e3:.0f} kB")
print("materials", [(m["name"], sorted(k for k in m if k != "name")) for m in j.get("materials", [])])
print("scene roots", [j["nodes"][i].get("name") for i in j["scenes"][0]["nodes"]])
