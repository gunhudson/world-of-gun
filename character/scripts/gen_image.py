#!/usr/bin/env python3
"""Reference-conditioned image generation (character sheet) with OpenAI or Gemini.

  gen_image.py openai <model> <out.png> <prompt.txt> <size> <quality> ref1.jpg ref2.jpg ...
  gen_image.py gemini <model> <out.png> <prompt.txt> <aspect> <res>   ref1.jpg ref2.jpg ...

Keys: env OPENAI_API_KEY / GEMINI_API_KEY, else the files character/work/.openaikey / .geminikey (git-ignored).
Prompts are templates: {{KEY}} placeholders are filled from character/appearance.json (copy appearance.example.json).
Appends each call and a rough cost estimate to character/work/SPEND.md (rates are estimates: check current pricing).
"""
import base64, json, mimetypes, os, re, sys, uuid, urllib.request, urllib.error, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ledger(service, what, cost):
    p = os.path.join(ROOT, "work", "SPEND.md")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    new = not os.path.exists(p)
    with open(p, "a") as f:
        if new:
            f.write("# Spend ledger (paid generation calls)\n\n| when (local) | service | what | cost USD |\n|---|---|---|---|\n")
        f.write(f"| {datetime.datetime.now():%Y-%m-%d %H:%M} | {service} | {what} | {cost:.3f} |\n")


def secret(env, fname):
    if os.environ.get(env):
        return os.environ[env].strip()
    p = os.path.join(ROOT, "work", fname)
    if not os.path.exists(p):
        raise SystemExit(f"no key: set {env} or put it in {p}")
    return open(p).read().strip()


def fill(text):
    """Replace {{KEY}} placeholders from appearance.json."""
    keys = set(re.findall(r"\{\{([A-Z_]+)\}\}", text))
    if not keys:
        return text
    path = os.path.join(ROOT, "appearance.json")
    if not os.path.exists(path):
        raise SystemExit("missing character/appearance.json: copy appearance.example.json and describe your own character")
    vals = json.load(open(path))
    missing = sorted(k for k in keys if k not in vals)
    if missing:
        raise SystemExit("appearance.json lacks: " + ", ".join(missing))
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: str(vals[m.group(1)]), text)


def post(url, data, headers):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}\n{e.read().decode()[:1500]}")


def openai(model, out, prompt, size, quality, refs):
    key = secret("OPENAI_API_KEY", ".openaikey")
    b = "----b" + uuid.uuid4().hex
    parts = []
    def field(k, v):
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    field("model", model); field("prompt", prompt); field("size", size); field("quality", quality)
    field("output_format", "png")
    for r in refs:
        ct = mimetypes.guess_type(r)[0] or "image/jpeg"
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="image[]"; filename="{os.path.basename(r)}"\r\nContent-Type: {ct}\r\n\r\n'.encode()
                     + open(r, "rb").read() + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    d = post("https://api.openai.com/v1/images/edits", b"".join(parts),
             {"Authorization": "Bearer " + key, "Content-Type": "multipart/form-data; boundary=" + b})
    open(out, "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
    u = d.get("usage", {})
    det = u.get("input_tokens_details", {})
    cost = (det.get("text_tokens", 0) * 5 + det.get("image_tokens", 0) * 8 + u.get("output_tokens", 0) * 30) / 1e6
    ledger(f"OpenAI {model}", f"{os.path.basename(out)} ({size}, {quality}, {len(refs)} refs; {u.get('input_tokens')} in / {u.get('output_tokens')} out tokens)", cost)
    print(out, u, f"~${cost:.3f}")


def gemini(model, out, prompt, aspect, res, refs):
    key = secret("GEMINI_API_KEY", ".geminikey")
    parts = [{"text": prompt}]
    for r in refs:
        parts.append({"inline_data": {"mime_type": mimetypes.guess_type(r)[0] or "image/jpeg",
                                      "data": base64.b64encode(open(r, "rb").read()).decode()}})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect, "imageSize": res}}}
    d = post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
             json.dumps(body).encode(), {"Content-Type": "application/json", "x-goog-api-key": key})
    img = None
    for c in d.get("candidates", []):
        for p in c.get("content", {}).get("parts", []):
            if "inlineData" in p:
                img = p["inlineData"]["data"]
    if not img:
        raise SystemExit("no image: " + json.dumps(d)[:1200])
    open(out, "wb").write(base64.b64decode(img))
    u = d.get("usageMetadata", {})
    # rough per-million-token rates (estimates, check current pricing)
    rate_out = 120 if "pro" in model else 60 if "3.1" in model else 30
    rate_in = 2 if "pro" in model else 0.5 if "3.1" in model else 0.3
    cost = (u.get("promptTokenCount", 0) * rate_in + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * rate_out) / 1e6
    ledger(f"Google {model}", f"{os.path.basename(out)} ({aspect}, {res}, {len(refs)} refs; {u.get('promptTokenCount')} in / {u.get('candidatesTokenCount')} out tokens)", cost)
    print(out, u, f"~${cost:.3f}")


if __name__ == "__main__":
    prov, model, out, pf, a, b = sys.argv[1:7]
    refs = sys.argv[7:]
    prompt = fill(open(pf).read().strip())
    (openai if prov == "openai" else gemini)(model, out, prompt, a, b, refs)
