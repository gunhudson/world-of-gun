#!/usr/bin/env python3
"""Minimal fal.ai queue client (stdlib only).

  fal.py upload <file>                      -> prints a hosted URL
  fal.py run <endpoint> <input.json> <out.json> [--cost 0.15 --what "..."]

Key: env FAL_KEY, else the file character/work/.falkey (git-ignored).
Every `run` that completes appends a line to character/work/SPEND.md when --cost is given.
"""
import json, mimetypes, os, sys, time, urllib.request, urllib.error, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def key():
    k = os.environ.get("FAL_KEY")
    if not k:
        k = open(os.path.join(ROOT, "work", ".falkey")).read().strip()
    return k


def http(method, url, body=None, headers=None, raw=False):
    h = {"Authorization": "Key " + key(), "User-Agent": "character-pipeline/1.0"}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = body
        else:
            data = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            b = r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {url}\n{e.read().decode()[:2000]}")
    return b if raw else json.loads(b or b"{}")


def upload(path):
    ct = mimetypes.guess_type(path)[0] or "application/octet-stream"
    init = http("POST", "https://rest.alpha.fal.ai/storage/upload/initiate",
                {"file_name": os.path.basename(path), "content_type": ct})
    req = urllib.request.Request(init["upload_url"], data=open(path, "rb").read(), method="PUT",
                                 headers={"Content-Type": ct})
    urllib.request.urlopen(req, timeout=600).read()
    return init["file_url"]


def run(endpoint, payload, poll=4, timeout=1500):
    sub = http("POST", "https://queue.fal.run/" + endpoint, payload)
    status_url, response_url = sub["status_url"], sub["response_url"]
    t0 = time.time()
    last = None
    while True:
        st = http("GET", status_url)
        if st.get("status") != last:
            last = st.get("status")
            print(f"  [{int(time.time() - t0)}s] {last}", file=sys.stderr, flush=True)
        if last == "COMPLETED":
            break
        if last not in ("IN_QUEUE", "IN_PROGRESS"):
            raise SystemExit(f"unexpected status: {st}")
        if time.time() - t0 > timeout:
            raise SystemExit(f"timeout; request {sub.get('request_id')} still {last}")
        time.sleep(poll)
    return http("GET", response_url)


def ledger(service, what, cost):
    p = os.path.join(ROOT, "work", "SPEND.md")
    new = not os.path.exists(p)
    with open(p, "a") as f:
        if new:
            f.write("# Spend ledger (paid generation calls)\n\n| when (local) | service | what | cost USD |\n|---|---|---|---|\n")
        f.write(f"| {datetime.datetime.now():%Y-%m-%d %H:%M} | {service} | {what} | {cost:.3f} |\n")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "upload":
        print(upload(a[1]))
    elif a[0] == "run":
        endpoint, inp, out = a[1], a[2], a[3]
        cost = float(a[a.index("--cost") + 1]) if "--cost" in a else None
        what = a[a.index("--what") + 1] if "--what" in a else os.path.basename(out)
        res = run(endpoint, json.load(open(inp)))
        json.dump(res, open(out, "w"), indent=1)
        if cost is not None:
            ledger("fal.ai " + endpoint, what, cost)
        print(json.dumps(res)[:1500])
