#!/bin/bash
# Deploy with a safety net: copy the working tree to a snapshot, run the engine tests and the browser smoke test against
# the snapshot, and deploy the snapshot only if both pass. A half-finished edit fails here instead of reaching your worker.
#
#   scripts/deploy.sh            test, smoke, then deploy
#   scripts/deploy.sh --check    test and smoke only, never deploy
#
# Needs: node, rsync, curl, wrangler (npm install puts it in node_modules/.bin), playwright (npm i -D playwright, then
# npx playwright install chromium). Authentication is wrangler's own: `npx wrangler login`, or set CLOUDFLARE_API_TOKEN
# (and CLOUDFLARE_ACCOUNT_ID when the token can see more than one account) in the environment.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1
if [ -x "$ROOT/node_modules/.bin/wrangler" ]; then WRANGLER="$ROOT/node_modules/.bin/wrangler"; else WRANGLER="wrangler"; fi
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/wog-deploy.XXXXXX")"; PORT=$((8900 + RANDOM % 80)); PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null || true; rm -rf "$SNAP"; }
trap cleanup EXIT

rsync -a --exclude .git --exclude .wrangler --exclude .dev.vars --exclude qc --exclude character --exclude node_modules "$ROOT/" "$SNAP/"
printf 'DEV=1\n' > "$SNAP/.dev.vars"          # local owner session for the smoke test; never deployed (it is not a secret store)
cd "$SNAP"

node test/run.mjs > "$SNAP/test.log" 2>&1 || { echo "DEPLOY BLOCKED: engine tests failed"; tail -15 "$SNAP/test.log"; exit 1; }
echo "tests ok"

(WRANGLER_LOG=error "$WRANGLER" dev --port "$PORT" > "$SNAP/dev.log" 2>&1) & PID=$!
UP=0; for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/healthz" && { UP=1; break; }; sleep 1; done
[ "$UP" = 1 ] || { echo "DEPLOY BLOCKED: the dev server did not start"; tail -15 "$SNAP/dev.log"; exit 1; }
# run the smoke script from the real tree so `playwright` resolves from your node_modules
node "$ROOT/scripts/smoke.mjs" "http://localhost:$PORT" || { echo "DEPLOY BLOCKED: smoke test failed"; exit 1; }
kill "$PID" 2>/dev/null || true; PID=""

if [ "$CHECK_ONLY" = 1 ]; then echo "checks passed, not deploying (--check)"; exit 0; fi
rm -f "$SNAP/.dev.vars"
"$WRANGLER" deploy 2>&1 | grep -E "Success|Version ID|Deployed|https://|ERROR|error" || true
echo "deployed from a snapshot of $ROOT at $(date +%H:%M:%S)"
