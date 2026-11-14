#!/usr/bin/env python3
"""Print the input schema of a fal endpoint. usage: schema.py <endpoint_id>"""
import json, sys, urllib.request
eid = sys.argv[1]
req = urllib.request.Request(f"https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={eid}", headers={"User-Agent": "Mozilla/5.0"})
d = json.load(urllib.request.urlopen(req))
S = d["components"]["schemas"]
def show(name):
    s = S[name]
    print(f"## {name}")
    for k, v in s.get("properties", {}).items():
        t = v.get("type") or [x.get("type") or x.get("$ref","").split("/")[-1] for x in v.get("anyOf", v.get("allOf", []))] or v.get("$ref","").split("/")[-1]
        print(f" - {k} ({t}{', required' if k in s.get('required', []) else ''}) default={v.get('default')!r} enum={v.get('enum')} :: {(v.get('description') or '')[:260]}")
for n in S:
    if n.endswith("Input") or (len(sys.argv) > 2 and n.endswith("Output")):
        show(n)
