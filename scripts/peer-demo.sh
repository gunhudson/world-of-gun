#!/bin/bash
# Multiplayer proof between two sandbox worlds on one dev server (docs/MULTIPLAYER.md).
#   WRANGLER_LOG=error wrangler dev --port 8941 &   (with .dev.vars DEV=1: the owner session is implicit, QC ingest key = qc-dev)
#   ./scripts/peer-demo.sh http://localhost:8941
# Two players: world A (qc-peer-a) and world B (qc-peer-b). A invites B, B accepts, both pull. Per-peer share lists and the
# automatic pull. Then the refusals: unsigned, bogus pair, wrong secret, stale timestamp, peering switched off, and production
# untouched (nonce replay: test/peers.test.mjs). Peering between two real deployments: docs/MULTIPLAYER.md.
# Exits 1 on the first assertion that fails. Needs curl and python3. KEEP=1 stops before the teardown (for screenshots).
set -euo pipefail
BASE="${1:-http://localhost:8941}"; QK="${QC_INGEST_KEY:-qc-dev}"
A=qc-peer-a; B=qc-peer-b
J='Content-Type: application/json'
py() { python3 -I -c "$@"; }
check() { local label="$1" got="$2" want="$3"; if [ "$got" == "$want" ]; then echo "  ok   $label"; else echo "  FAIL $label: got [$got] want [$want]"; exit 1; fi; }
api() { curl -s "$BASE$1?world=$2" "${@:3}"; }
status() { curl -s -o /dev/null -w "%{http_code}" "$BASE$1" "${@:2}"; }

echo "1. two fresh sandbox worlds, two different players"
api /api/admin/qc/seed $A -X POST -H "x-world-key: $QK" >/dev/null
api /api/admin/qc/seed $B -X POST -H "x-world-key: $QK" >/dev/null
api /api/ingest $A -X POST -H "x-world-key: $QK" -H "$J" -d '{"events":[{"ts":"2026-11-14T09:00:00+08:00","type":"profile.set","source":"qc-demo","data":{"name":"Player A","birthDate":"2000-01-01"}}]}' >/dev/null
api /api/ingest $B -X POST -H "x-world-key: $QK" -H "$J" -d '{"events":[{"ts":"2026-11-14T09:00:00+08:00","type":"profile.set","source":"qc-demo","data":{"name":"Player B","birthDate":"2001-01-01"}}]}' >/dev/null
check "A is Player A" "$(api /api/state $A | py 'import sys,json; print(json.load(sys.stdin)["character"]["name"])')" "Player A"
check "B is Player B" "$(api /api/state $B | py 'import sys,json; print(json.load(sys.stdin)["character"]["name"])')" "Player B"
check "peering ships off in A" "$(api /api/share $A | py 'import sys,json; d=json.load(sys.stdin); print(d["enabled"], len(d["peers"]))')" "False 0"

echo "2. each owner switches peering on and picks a different share profile"
api /api/share $A -X PUT -H "$J" -d '{"enabled":true,"url":"'"$BASE"'","name":"World A","status":"training for the half marathon","fields":["name","level","activity","streaks","grade","stepsGoal","status","lastSeen"]}' >/dev/null
api /api/share $B -X PUT -H "$J" -d '{"enabled":true,"url":"'"$BASE"'","name":"World B","fields":["name","level","place","grade"]}' >/dev/null
check "A shares 8 fields" "$(api /api/share $A | py 'import sys,json; print(len(json.load(sys.stdin)["fields"]))')" "8"
check "B shares 4 fields" "$(api /api/share $B | py 'import sys,json; print(",".join(json.load(sys.stdin)["fields"]))')" "name,level,place,grade"

echo "3. A invites B (one-time code, handed over out of band); B accepts; A learns where B lives from B's signed hello"
INV=$(api /api/peers/invite $A -X POST -H "$J" -d '{"name":"B (invited)","enabled":true}')
CODE=$(echo "$INV" | py 'import sys,json; d=json.load(sys.stdin); assert d["ok"], d; print(d["code"])')
PAIR=$(echo "$INV" | py 'import sys,json; print(json.load(sys.stdin)["peer"]["id"])')
check "invite is pending on A" "$(api /api/peers $A | py 'import sys,json; print(json.load(sys.stdin)["peers"][0]["status"])')" "invited"
ACC=$(api /api/peers/accept $B -X POST -H "$J" -d "{\"code\":\"$CODE\",\"enabled\":true}")
check "B accepted" "$(echo "$ACC" | py 'import sys,json; d=json.load(sys.stdin); print(d["ok"], d["peer"]["status"], d["peer"]["name"], d["peer"]["world"])')" "True active World A qc-peer-a"
check "A now sees B as active with B's address" "$(api /api/peers $A | py 'import sys,json; p=json.load(sys.stdin)["peers"][0]; print(p["status"], p["name"], p["world"], p["url"].startswith("http"))')" "active World B qc-peer-b True"
check "the same code cannot be accepted twice" "$(api /api/peers/accept $B -X POST -H "$J" -d "{\"code\":\"$CODE\"}" | py 'import sys,json; print(json.load(sys.stdin)["ok"])')" "False"

echo "4. both pull: each party gets the other's card with exactly the shared fields"
check "A pulls B" "$(api /api/peers/refresh $A -X POST | py 'import sys,json; d=json.load(sys.stdin); print(d["ok"], d["pulled"], list(d["report"].values())[0]["ok"])')" "True 1 True"
check "B pulls A" "$(api /api/peers/refresh $B -X POST | py 'import sys,json; d=json.load(sys.stdin); print(d["ok"], d["pulled"], list(d["report"].values())[0]["ok"])')" "True 1 True"
check "A's party has B: name, level, place, grade and nothing else" "$(api /api/state $A | py '
import sys,json; s=json.load(sys.stdin); p=[x for x in s["party"] if x.get("peer")]; assert len(p)==1, p; x=p[0]
print(x["name"], x["role"], sorted(x["shared"].keys())==sorted(["name","level","place","grade"]), x["shared"]["level"], x["shared"]["place"], x["peer"]["world"], x["location"])')" "Player B peer True 10 Testville World B Testville"
check "B's party has A: 8 fields, status line through, no place" "$(api /api/state $B | py '
import sys,json; s=json.load(sys.stdin); p=[x for x in s["party"] if x.get("peer")]; assert len(p)==1, p; x=p[0]
print(x["name"], len(x["shared"]), x["shared"]["status"], "place" in x["shared"], x["location"], x["shared"]["streaks"]["steps"]>=0, x["shared"]["stepsGoal"])')" "Player A 8 training for the half marathon False None True False"
check "no raw number crosses: B's card carries no weight, money, steps count, coordinates, tasks or log" "$(api /api/state $A | py '
import sys,json; s=json.load(sys.stdin); x=[x for x in s["party"] if x.get("peer")][0]; t=json.dumps(x)
print(not any(k in t for k in ["weight","gold","lat\"","lon\"","task","\"log\"","kcal","account"]))')" "True"
check "A's state shows the card it hands to B (what leaves)" "$(api /api/state $A | py '
import sys,json; s=json.load(sys.stdin); p=s["peering"]["peers"][0]; print(s["peering"]["enabled"], p["card"]["fields"]==["name","level","activity","streaks","grade","stepsGoal","status","lastSeen"], p["received"]["fields"])')" "True True ['name', 'level', 'place', 'grade']"
check "A's squad board lists self and B" "$(api /api/state $A | py 'import sys,json; s=json.load(sys.stdin); print([m["name"] for m in s["squad"]["members"]])')" "['Player A', 'Player B']"

echo "5. refusals: unsigned, unknown pair, wrong secret, stale timestamp (replay and nonce rules: test/peers.test.mjs)"
check "unsigned card request -> 401" "$(status "/api/peer/card?world=$B")" "401"
check "unknown pair id -> 401" "$(status "/api/peer/card?world=$B" -H "x-peer-id: 0123456789abcdef" -H "x-peer-ts: $(date +%s)000" -H "x-peer-nonce: 0123456789abcdef" -H "x-peer-sig: 00")" "401"
# a request signed with the wrong secret, by someone who knows the pair id
SIGNED=$(py "
import hmac,hashlib,time,json
pair='$PAIR'; secret='00'*32; ts=str(int(time.time()*1000)); nonce='abcdefabcdef0123'; path='/api/peer/card?world=$B'
body_hash=hashlib.sha256(b'').hexdigest(); msg='\n'.join(['GET',path,ts,nonce,body_hash]).encode()
print(json.dumps({'x-peer-id':pair,'x-peer-ts':ts,'x-peer-nonce':nonce,'x-peer-sig':hmac.new(secret.encode(),msg,hashlib.sha256).hexdigest()}))")
HDRS=(); while IFS= read -r line; do HDRS+=(-H "$line"); done < <(echo "$SIGNED" | py 'import sys,json; [print(k+": "+v) for k,v in json.load(sys.stdin).items()]')
check "right pair id, wrong secret -> 401" "$(status "/api/peer/card?world=$B" "${HDRS[@]}")" "401"
check "stale timestamp -> 401" "$(status "/api/peer/card?world=$B" -H "x-peer-id: $PAIR" -H "x-peer-ts: 1000" -H "x-peer-nonce: 0123456789abcdef" -H "x-peer-sig: 00")" "401"
check "the pull itself never exposes the secret in the state" "$(api /api/state $A | py 'import sys,json; print("secret" in json.dumps(json.load(sys.stdin)["peering"]))')" "False"

echo "5b. per-peer share lists: A narrows what B gets (B's own list, not the default); the next pull carries exactly that"
api /api/peers $A -X POST -H "$J" -d "{\"id\":\"$PAIR\",\"share\":[\"name\",\"level\",\"grade\",\"gold\"]}" >/dev/null
check "A's row for B shows its own list (gold dropped: not in the allowlist)" "$(api /api/peers $A | py 'import sys,json; p=[x for x in json.load(sys.stdin)["peers"] if x["id"]=="'"$PAIR"'"][0]; print(",".join(p["share"]))')" "name,level,grade"
check "A's default list is untouched" "$(api /api/share $A | py 'import sys,json; print(len(json.load(sys.stdin)["fields"]))')" "8"
check "the card A builds for B follows B's list" "$(api /api/state $A | py 'import sys,json; s=json.load(sys.stdin); p=[x for x in s["peering"]["peers"] if x["id"]=="'"$PAIR"'"][0]; print(",".join(p["card"]["fields"]))')" "name,level,grade"
check "B pulls: three fields, no status line" "$(api /api/peers/refresh $B -X POST >/dev/null; api /api/state $B | py 'import sys,json; s=json.load(sys.stdin); x=[x for x in s["party"] if x.get("peer")][0]; print(sorted(x["shared"].keys()))')" "['grade', 'level', 'name']"
api /api/peers $A -X POST -H "$J" -d "{\"id\":\"$PAIR\",\"share\":[\"name\",\"level\",\"activity\",\"streaks\",\"grade\",\"stepsGoal\",\"status\",\"lastSeen\"]}" >/dev/null
check "back to the default list: B's next pull has the eight again" "$(api /api/peers/refresh $B -X POST >/dev/null; api /api/state $B | py 'import sys,json; s=json.load(sys.stdin); x=[x for x in s["party"] if x.get("peer")][0]; print(len(x["shared"]))')" "8"

echo "5c. the automatic pull: off by default; on, the world's alarm pulls within seconds (then every five minutes)"
check "autoPull ships off" "$(api /api/share $B | py 'import sys,json; print(json.load(sys.stdin)["autoPull"])')" "False"
BEFORE=$(api /api/peers $B | py 'import sys,json; print(json.load(sys.stdin)["peers"][0]["lastPullAt"])')
api /api/share $B -X PUT -H "$J" -d '{"autoPull":true}' >/dev/null
sleep 9
AFTER=$(api /api/peers $B | py 'import sys,json; print(json.load(sys.stdin)["peers"][0]["lastPullAt"])')
check "B's peer row shows a pull the alarm made" "$([ "$BEFORE" != "$AFTER" ] && echo moved || echo "same ($BEFORE)")" "moved"
check "autoPull: a later lastAutoPull is remembered beside the settings, never in the card" "$(api /api/state $B | py 'import sys,json; s=json.load(sys.stdin); print(s["peering"]["autoPull"], "lastAutoPull" in json.dumps(s["peering"]["peers"]))')" "True False"
api /api/share $B -X PUT -H "$J" -d '{"autoPull":false}' >/dev/null

[ "${KEEP:-}" = "1" ] && { echo "KEEP=1: pairing left in place for screenshots"; exit 0; }
echo "6. B switches peering off: A's next pull finds nothing (404), B's party keeps the last card it already had"
api /api/share $B -X PUT -H "$J" -d '{"enabled":false}' >/dev/null
check "B's card route is gone" "$(status "/api/peer/card?world=$B" "${HDRS[@]}")" "404"
check "A's pull reports HTTP 404" "$(api /api/peers/refresh $A -X POST | py 'import sys,json; print(list(json.load(sys.stdin)["report"].values())[0]["error"])')" "HTTP 404"
check "A deletes the peer: the card goes with it" "$(api /api/peers $A -X DELETE -H "$J" -d "{\"id\":\"$PAIR\"}" >/dev/null; api /api/state $A | py 'import sys,json; s=json.load(sys.stdin); print(len([x for x in s["party"] if x.get("peer")]), len(s["peering"]["peers"]))')" "0 0"

echo "7. production is untouched: peering off, no peers, the peer route answers 404 with nothing"
check "production share settings" "$(curl -s "$BASE/api/share" | py 'import sys,json; d=json.load(sys.stdin); print(d["enabled"], d["peers"], d["world"])')" "False [] production"
check "production peer route" "$(status "/api/peer/card")" "404"
check "production peer route (signed as the sandbox pair)" "$(status "/api/peer/card" "${HDRS[@]}")" "404"
check "nobody can push a card through ingest" "$(api /api/ingest $A -X POST -H "x-world-key: $QK" -H "$J" -d '{"events":[{"ts":"2026-11-14T09:00:00+08:00","type":"peer.card","source":"qc-demo","data":{"peerId":"deadbeefdeadbeef","fields":["name"],"values":{"name":"Impostor"}}}]}' | py 'import sys,json; d=json.load(sys.stdin); print(d["accepted"], d["rejected"][0]["reason"])')" "0 unknown type \"peer.card\""
echo "peer demo: all checks passed"
