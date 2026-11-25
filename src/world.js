// World: the one SQLite Durable Object. Holds the event log, the derived log (XP, quests,
// levels, achievements), the last good snapshot of every edge feed, item images, read tokens,
// the peer table and the live WebSocket sessions (hibernation API). The reducer (src/reduce.js)
// is pure; this class is storage, schedule and delivery.
import { DurableObject } from "cloudflare:workers";
import { reduce, rulesDoc } from "./reduce.js";
import { ingestInto, fnv } from "./ingest.js";
import { ADAPTERS } from "./adapters.js";
import { brief } from "./brief.js";
import { actEvent, actReply } from "./act.js";
import { phoneEvents } from "./phone.js";
import { glance, glanceEtag } from "./glance.js";
import { syncMarks } from "./marks.js";
import * as T from "./tokens.js";
import { maskEventData, scanValue, moneyType } from "./lib/mask.js";
import { stable } from "./ingest.js";
import { EVENT_TYPES, ROSTER_IDS, MAX_PARTNERS, rosterAssets } from "./rules.js";
import { PROD, isQcTraffic, isQcWorld, QC_REFUSED } from "./worlds.js";
import { seedEvents, seedFeeds } from "./qc-seed.js";
import { cleanEntries, allowEntries, CLIENTLOG_KEEP } from "./clientlog.js";
import { addDays } from "./lib/time.js";
import { parseTs, localDate, validZone, iso, localISO } from "./lib/time.js";
import { sunNow } from "./lib/sun.js";
import * as P from "./peers.js";

const TICK_MS = 5 * 60000;
const MAX_IMG = 1_500_000;

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.mem = { events: null, feeds: null, logHash: null, state: null };
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, ts0 INTEGER NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL,
        data TEXT NOT NULL, hash TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, void INTEGER NOT NULL DEFAULT 0, recv INTEGER NOT NULL, upd INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_type ON events(type);
      CREATE TABLE IF NOT EXISTS log (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS log_ts ON log(ts);
      CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, ok_at INTEGER, try_at INTEGER, error TEXT, fails INTEGER NOT NULL DEFAULT 0, note TEXT, snapshot TEXT, meta TEXT);
      CREATE TABLE IF NOT EXISTS img (id TEXT PRIMARY KEY, type TEXT NOT NULL, bytes BLOB NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clientlog (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, scope TEXT NOT NULL, label TEXT, sid TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL, last_used INTEGER);
      CREATE TABLE IF NOT EXISTS peers (id TEXT PRIMARY KEY, name TEXT, url TEXT, world TEXT, secret TEXT NOT NULL, share TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
        created INTEGER NOT NULL, accepted INTEGER, last_pull INTEGER, last_error TEXT, last_seen INTEGER, invite_exp INTEGER);
    `);
    // Which world this object is. The QC world (the sandbox) runs no adapters and no tick: only pushed events move it.
    this.worldName = (ctx.id && isQcWorld(ctx.id.name) && ctx.id.name) || (isQcWorld(this.kvGet("world")) && this.kvGet("world")) || PROD;
    this.isQC = isQcWorld(this.worldName);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------------- the QC world (sandbox)
  /** Called by the worker on the object it addresses as "qc". The production object is never addressed this way. */
  markQC(name) {
    if (!isQcWorld(name) || (this.ctx.id && this.ctx.id.name && this.ctx.id.name !== name)) throw new Error("not a QC object");
    if (!this.isQC || this.worldName !== name) { this.kvPut("world", name); this.worldName = name; this.isQC = true; }
    return true;
  }
  async qcReset() {
    if (!this.isQC) return { ok: false, error: "reset exists only in the QC world" };
    const before = this.sql.exec("SELECT COUNT(*) AS n FROM events").toArray()[0].n;
    for (const t of ["events", "log", "feeds", "img", "tokens", "clientlog", "peers"]) this.sql.exec("DELETE FROM " + t);
    this.sql.exec("DELETE FROM kv WHERE k != 'world'");
    this.mem = { events: null, feeds: null, logHash: null, state: null };
    await this.ctx.storage.deleteAlarm();
    this.recompute(Date.now()); this.broadcast([]);
    return { ok: true, world: this.worldName, removed: before };
  }
  async qcSeed(keep) {
    if (!this.isQC) return { ok: false, error: "seed exists only in the QC world" };
    if (!keep) await this.qcReset();
    const now = Date.now(), { res } = this.write(seedEvents(now).map((e, i) => ({ id: e.id || "qc-seed:" + e.type + ":" + i, ...e })), now);
    for (const [id, snapshot] of Object.entries(seedFeeds(now))) this.setFeed(id, { okAt: now, tryAt: now, error: null, fails: 0, note: "synthetic (qc-seed)", snapshot });
    for (const t of new Set(seedEvents(now).map(e => e.type))) this.setFeed("ingest:" + t, { okAt: now, tryAt: now, error: null, fails: 0 });
    this.recompute(Date.now()); this.broadcast([]); await this.armAlarm();
    const st = this.mem.state.state;
    return { ok: true, world: this.worldName, events: res.new + res.revised + res.unchanged, rejected: res.rejected, level: st.character.level, place: st.realm.place, note: "synthetic fixture; feed snapshots are frozen at seed time, seed again to refresh them" };
  }

  // ---------------- storage helpers
  kvGet(k) { const r = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0]; return r ? JSON.parse(r.v) : null; }
  kvPut(k, v) { this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v)); }
  loadEvents() {
    if (!this.mem.events) {
      this.mem.events = this.sql.exec("SELECT id, ts, ts0, upd, type, source, data FROM events WHERE void = 0").toArray()
        .map(r => ({ id: r.id, ts: r.ts, ts0: r.ts0, upd: r.upd, type: r.type, source: r.source, data: JSON.parse(r.data) }));
    }
    return this.mem.events;
  }
  loadFeeds() {
    if (!this.mem.feeds) {
      const out = {};
      for (const r of this.sql.exec("SELECT * FROM feeds").toArray()) {
        out[r.id] = { okAt: r.ok_at, tryAt: r.try_at, error: r.error, fails: r.fails, note: r.note, snapshot: r.snapshot ? JSON.parse(r.snapshot) : null, meta: r.meta ? JSON.parse(r.meta) : null };
      }
      this.mem.feeds = out;
    }
    return this.mem.feeds;
  }
  setFeed(id, patch) {
    const cur = this.loadFeeds()[id] || { okAt: null, tryAt: null, error: null, fails: 0, note: null, snapshot: null, meta: null };
    const f = { ...cur, ...patch };
    this.sql.exec(`INSERT INTO feeds (id, ok_at, try_at, error, fails, note, snapshot, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ok_at = excluded.ok_at, try_at = excluded.try_at, error = excluded.error, fails = excluded.fails, note = excluded.note, snapshot = excluded.snapshot, meta = excluded.meta`,
      id, f.okAt, f.tryAt, f.error, f.fails, f.note, f.snapshot == null ? null : JSON.stringify(f.snapshot), f.meta == null ? null : JSON.stringify(f.meta));
    this.mem.feeds[id] = f;
  }

  // ---------------- ingest (idempotent by event id; same id + same data = no-op, new data = revision)
  write(list, now, opts = {}) {
    const sql = this.sql;
    const store = {
      get: id => sql.exec("SELECT hash, void, data, source FROM events WHERE id = ?", id).toArray()[0],
      insert: (e, hash) => sql.exec("INSERT INTO events (id, ts, ts0, type, source, data, hash, rev, void, recv, upd) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)", e.id, e.ts, e.ts, e.type, e.source, e.body, hash, now, now),
      update: (e, hash) => sql.exec("UPDATE events SET ts = ?, source = ?, data = ?, hash = ?, rev = rev + 1, void = 0, upd = ? WHERE id = ?", e.ts, e.source, e.body, hash, now, e.id),
      void: id => sql.exec("UPDATE events SET void = 1, upd = ?, rev = rev + 1 WHERE id = ?", now, id),
    };
    // facts arriving from outside are refused by production when they name themselves as test traffic
    const out = ingestInto(store, list, now, opts.external && !this.isQC ? { ...opts, refuse: isQcTraffic, refuseReason: QC_REFUSED } : opts);
    if (out.res.changed.length) this.mem.events = null;
    return out;
  }
  async ingest(list) {
    const now = Date.now();
    if (!Array.isArray(list)) return { ok: false, error: "body must be { events: [...] }" };
    if (list.length > 5000) return { ok: false, error: "at most 5000 events per call" };
    const { res, types } = this.write(list, now, { external: true });
    for (const t of types) this.setFeed("ingest:" + t, { okAt: now, tryAt: now, error: null, fails: 0 });
    const changed = res.changed; delete res.changed;
    let fresh = [];
    if (changed.length || types.size) fresh = this.recompute(now);
    if (changed.length || this.mem.activityChanged) this.broadcast(fresh);
    await this.armAlarm();
    return { ok: true, world: this.isQC ? this.worldName : "production", ...res, logEntries: fresh.length };
  }

  /** Sensor events from a phone app (owner session): whitelisted types only, source phone:<deviceId>. */
  async phone(body) {
    const now = Date.now(), p = phoneEvents(body, now);
    if (!p.ok) return p;
    if (!this.isQC && isQcTraffic("phone:" + p.deviceId)) return { ok: false, error: QC_REFUSED };
    const { res, types } = this.write(p.events, now, { external: true });
    for (const t of types) this.setFeed("ingest:" + t, { okAt: now, tryAt: now, error: null, fails: 0 });
    const changed = res.changed; delete res.changed;
    // rejections from both stages, indexed against the request's own events array
    const rejected = [...p.rejected, ...res.rejected.map(r => ({ ...r, i: body.events.findIndex(e => e && p.source + ":" + e.id === r.id) }))];
    let fresh = [];
    if (changed.length || types.size) fresh = this.recompute(now);
    if (changed.length || this.mem.activityChanged) this.broadcast(fresh);
    await this.armAlarm();
    return { ok: true, world: this.isQC ? this.worldName : "production", deviceId: p.deviceId, source: p.source, ...res, accepted: res.accepted, rejected, logEntries: fresh.length, activity: this.mem.state ? this.mem.state.state.character.activity : null };
  }

  // ---------------- recompute: replay the log through the rules, store the derived log, cache the state
  recompute(now = Date.now()) {
    if (!this.mem.state) this.mem.state = this.kvGet("state");
    const before = this.mem.state && this.mem.state.state.character ? this.mem.state.state.character.activity : null;
    // `engine` is the one feed the object writes itself: the moment it saw a level-up or a main-quest anchor
    const feeds = () => ({ ...this.loadFeeds(), engine: { okAt: now, snapshot: { celebrate: this.kvGet("celebrate"), seenClose: this.kvGet("seenClose"), world: this.worldName,
      assets: ((this.mem.assets || (this.mem.assets = this.kvGet("assets"))) || {}).present, images: this.imageIds(), peering: this.peeringSnapshot(),
      // display names from the worker's vars (wrangler.toml); null = the reducer's neutral default
      ownerName: this.envName("OWNER_NAME"), companionName: this.envName("COMPANION_NAME"), guildName: this.envName("GUILD_NAME") } } });
    let { state, derived, tasks, entryDates } = reduce(this.loadEvents(), feeds(), now);
    // First-seen times: mark new completions on the open days, withdraw marks whose entry is gone, and reduce again if any mark was withdrawn
    // (a new mark records the time the entry already has, so it changes nothing now; it stops later facts from moving it).
    const m = syncMarks(derived, this.loadEvents(), entryDates, addDays(state.day.date, -1));
    if (m.add.length || m.void.length) {
      this.write([...m.add, ...m.void], now, { internal: true });
      if (m.void.length) ({ state, derived, tasks, entryDates } = reduce(this.loadEvents(), feeds(), now));
    }
    this.mem.tasks = tasks;
    if (!this.mem.logHash) this.mem.logHash = new Map(this.sql.exec("SELECT id, hash FROM log").toArray().map(r => [r.id, r.hash]));
    const had = this.mem.logHash, firstFill = had.size === 0, next = new Map(), fresh = [];
    for (const e of derived) {
      const body = JSON.stringify(e), hash = fnv(body);
      next.set(e.id, hash);
      const old = had.get(e.id);
      if (old === hash) continue;
      this.sql.exec("INSERT INTO log (id, ts, type, body, hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, type = excluded.type, body = excluded.body, hash = excluded.hash", e.id, Date.parse(e.ts), e.type, body, hash);
      if (old === undefined) fresh.push(e);
    }
    for (const id of had.keys()) if (!next.has(id)) this.sql.exec("DELETE FROM log WHERE id = ?", id);
    this.mem.logHash = next;
    // A bulk change (first fill, a backfill, a rules replay) is not news: clients get the state nudge only.
    const news = firstFill || fresh.length > 40 ? [] : fresh;
    const party = [...news].reverse().find(e => e.type === "level" || e.id.startsWith("quest.done:main"));
    if (party) {                                           // celebrate for a couple of minutes from now, the moment it was seen
      this.kvPut("celebrate", { at: now, id: party.id, text: party.type === "level" ? "level " + party.level + " reached" : "main quest anchor reached" });
      state = reduce(this.loadEvents(), feeds(), now).state;
    }
    this.mem.state = { at: now, state }; this.mem.stale = false;
    this.kvPut("state", { at: now, state });
    const a = state.character.activity;
    if (a && (!before || before.name !== a.name || before.inferred !== a.inferred)) this.mem.activityChanged = { ...a, was: before ? before.name : null };
    return news;
  }
  envName(key) { const v = this.env && this.env[key]; return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null; }
  /** One alarm slot: the next tick, or sooner when the current activity is due to run out. */
  async armAlarm() {
    const now = Date.now(), nextTick = this.isQC ? Infinity : Math.max((this.kvGet("lastTick") || now) + TICK_MS, now + 5000);
    const a = this.mem.state && this.mem.state.state.character && this.mem.state.state.character.activity, u = a && parseTs(a.until);
    let target = u && u + 2000 > now && u + 2000 < nextTick ? u + 2000 : nextTick;
    const pull = this.nextAutoPull(now); if (pull != null && Math.max(pull, now + 5000) < target) target = Math.max(pull, now + 5000);
    if (target === Infinity) return;                       // QC world with nothing due: no alarm at all
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur < now || Math.abs(cur - target) > 3000) await this.ctx.storage.setAlarm(target);
  }
  // ---------------- what exists: static files of the roster, and stored images
  imageIds() { if (!this.mem.images) this.mem.images = this.sql.exec("SELECT id FROM img").toArray().map(r => r.id); return this.mem.images; }
  /**
   * Which roster files (models, portraits) the deployment actually has, asked of the static assets. Cached: checked once when
   * this object starts (which is what a deploy causes) before the first answer, then refreshed in the background at most every
   * 5 minutes. No request pays for it otherwise.
   */
  async ensureAssets() {
    const now = Date.now(), cur = this.mem.assets || (this.mem.assets = this.kvGet("assets"));
    if (cur && this.mem.assetsChecked && now - cur.at < 5 * 60000) return;
    if (this.mem.assetsRun) { if (!cur || !this.mem.assetsChecked) await this.mem.assetsRun; return; }
    // The fixed roster and any partner (a contact whose role is "partner") may have all four files. Party members with a
    // stored portrait (party-<id>) may have a body under /models/<contactId>.glb and -lite.glb; their portraits stay in the store.
    const known = this.mem.state || this.kvGet("state"), idOk = id => /^[a-z0-9][a-z0-9-]*$/.test(id) && !ROSTER_IDS.includes(id);
    const partnerIds = ((known && known.state && known.state.party) || []).filter(p => p.role === "partner" && idOk(p.id)).map(p => p.id).slice(0, MAX_PARTNERS);
    const partyIds = this.imageIds().filter(i => /^party-[a-z0-9][a-z0-9-]*$/.test(i) && !/-sm$/.test(i)).map(i => i.slice(6)).filter(id => idOk(id) && !partnerIds.includes(id)).slice(0, 24);
    const paths = [...[...ROSTER_IDS, ...partnerIds].flatMap(id => Object.values(rosterAssets(id))), ...partyIds.flatMap(id => { const a = rosterAssets(id); return [a.model, a.modelLite]; })];
    const run = (async () => {
      try {
        const prev = new Set((cur && cur.present) || []);
        const settled = await Promise.allSettled(paths.map(async p => {
          const r = await this.env.ASSETS.fetch(new Request("https://assets.local" + p, { method: "HEAD" }));
          return r.status === 200 ? true : r.status === 404 ? false : prev.has(p);
        }));
        const present = paths.filter((p, i) => settled[i].status === "fulfilled" ? settled[i].value : prev.has(p));
        if (!cur || JSON.stringify(cur.present) !== JSON.stringify(present)) this.mem.stale = true;
        this.mem.assets = { at: Date.now(), present }; this.kvPut("assets", this.mem.assets); this.mem.assetsChecked = true;
      } finally { this.mem.assetsRun = null; }
    })();
    this.mem.assetsRun = run;
    if (!cur || !this.mem.assetsChecked) await run; else this.ctx.waitUntil(run);
  }
  /** The contract document. Served from the last recompute; time-of-day fields are refreshed on read. */
  async getState() {
    await this.ensureAssets();
    const now = Date.now();
    if (!this.mem.state) this.mem.state = this.kvGet("state");
    if (!this.mem.state || this.mem.stale || now - this.mem.state.at > 90000) { this.recompute(now); if (this.mem.activityChanged) this.broadcast([]); }
    const s = this.mem.state.state, r = s.realm;
    const realm = { ...r, localTime: r.tz ? localISO(now, r.tz) : null, sun: r.lat != null ? sunNow(now, r.lat, r.lon) : null };
    return { ...s, asOf: iso(now), computedAt: iso(this.mem.state.at), realm };
  }
  /** Newest first. `cursor` is the `next` value of the previous page ("<ts ms>|<id>"); `before` (ISO) starts below a time. */
  getLog(cursor, limit, before) {
    const lim = Math.max(1, Math.min(500, limit || 100));
    let ts = before || 8.64e15, id = "\uffff";
    if (cursor && cursor.includes("|")) { ts = Number(cursor.slice(0, cursor.indexOf("|"))) || ts; id = cursor.slice(cursor.indexOf("|") + 1); }
    const rows = this.sql.exec("SELECT ts, id, body FROM log WHERE ts < ? OR (ts = ? AND id < ?) ORDER BY ts DESC, id DESC LIMIT ?", ts, ts, id, lim).toArray();
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM log").toArray()[0].n, last = rows[rows.length - 1];
    return { total, entries: rows.map(r => JSON.parse(r.body)), next: rows.length === lim ? last.ts + "|" + last.id : null };
  }
  getRules() { return rulesDoc(); }
  // ---------------- client diagnostics: beside the log, never in it (src/clientlog.js)
  clientLogPut(body, meta) {
    try {
      const now = Date.now(), entries = cleanEntries(body, now);
      if (!this.mem.clBuckets) this.mem.clBuckets = new Map();
      const take = allowEntries(this.mem.clBuckets, meta.sess || "?", entries.length, now);
      for (const e of entries.slice(0, take)) this.sql.exec("INSERT INTO clientlog (at, kind, body) VALUES (?, ?, ?)", now, e.kind, JSON.stringify({ ...e, device: meta.device || null, colo: meta.colo || null }));
      if (take) this.sql.exec("DELETE FROM clientlog WHERE id <= (SELECT MAX(id) FROM clientlog) - ?", CLIENTLOG_KEEP);
      return { stored: take, dropped: entries.length - take };
    } catch (e) { return { stored: 0, error: String((e && e.message) || e).slice(0, 120) }; }
  }
  clientLogGet(since, kind, limit) {
    const lim = Math.max(1, Math.min(CLIENTLOG_KEEP, limit || 100));
    const rows = this.sql.exec("SELECT id, at, kind, body FROM clientlog WHERE at > ? AND (? = '' OR kind = ?) ORDER BY id DESC LIMIT ?", since || 0, kind || "", kind || "", lim).toArray();
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM clientlog").toArray()[0].n;
    return { world: this.isQC ? this.worldName : "production", total, count: rows.length, entries: rows.map(r => ({ id: r.id, receivedAt: iso(r.at), ...JSON.parse(r.body) })) };
  }

  // ---------------- glance (widgets, watch, lock screen)
  async getGlance() { const g = glance(await this.getState()); return { body: g, etag: glanceEtag(g) }; }

  // ---------------- scoped read tokens (native widgets): logic in src/tokens.js, rows in SQLite
  tokenStore() {
    const sql = this.sql, row = r => ({ hash: r.hash, scope: r.scope, label: r.label, sid: r.sid, created: r.created, expires: r.expires, lastUsed: r.last_used });
    return {
      get: hash => { const r = sql.exec("SELECT * FROM tokens WHERE hash = ?", hash).toArray()[0]; return r ? row(r) : undefined; },
      all: () => sql.exec("SELECT * FROM tokens").toArray().map(row),
      del: hash => sql.exec("DELETE FROM tokens WHERE hash = ?", hash),
      put: t => sql.exec(`INSERT INTO tokens (hash, scope, label, sid, created, expires, last_used) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hash) DO UPDATE SET label = excluded.label, last_used = excluded.last_used`, t.hash, t.scope, t.label, t.sid, t.created, t.expires, t.lastUsed),
    };
  }
  mintToken(hash, sid, label, now) { return T.mintToken(this.tokenStore(), hash, sid, label, now); }
  checkToken(hash, now) { return T.checkToken(this.tokenStore(), hash, now); }
  revokeTokens(by) { return T.revokeTokens(this.tokenStore(), by); }
  listTokens(now, sid) { return { tokens: T.listTokens(this.tokenStore(), now, sid) }; }

  /** Day-close summaries, newest first (up to the last 400 game days). */
  getDays(limit) {
    const lim = Math.max(1, Math.min(400, limit || 400));
    const days = this.sql.exec("SELECT body FROM log WHERE type = 'day' ORDER BY ts DESC, id DESC LIMIT ?", lim).toArray().map(r => { const e = JSON.parse(r.body); return { ...e.day, closedAt: e.ts, text: e.text }; });
    return { count: days.length, days };
  }
  async getBrief(kind) {
    const k = ["morning", "now", "evening"].includes(kind) ? kind : "now";
    return brief(await this.getState(), k, Date.now());
  }
  /** One manual fact (voice, keypad, ring, watch): becomes an ordinary event with source manual:<channel>. */
  async act(body, channel) {
    const now = Date.now(), before = await this.getState();
    const r = actEvent(body, { now, channel, state: before });
    if (!r.ok) return r;
    const { res } = this.write([r.event], now, { external: true });
    if (res.rejected.length) return { ok: false, error: res.rejected[0].reason };
    this.setFeed("ingest:" + r.type, { okAt: now, tryAt: now, error: null, fails: 0 });
    const fresh = this.recompute(Date.now());
    this.broadcast(fresh);
    await this.armAlarm();
    const e = r.event;
    return { ok: true, world: this.isQC ? this.worldName : "production", duplicate: res.unchanged === 1, event: { id: e.id, ts: iso(e.ts), type: e.type, source: e.source, data: e.data }, ...actReply(r.type, e, r.summary, before, this.mem.state.state) };
  }
  async getDebug() {
    const alarmAt = await this.ctx.storage.getAlarm();
    const feeds = {}; for (const [id, f] of Object.entries(this.loadFeeds())) feeds[id] = { okAt: iso(f.okAt), tryAt: iso(f.tryAt), error: f.error, fails: f.fails, note: f.note, snapshot: id === "fleet" || id === "btc" ? "(in state)" : f.snapshot, meta: f.meta && f.meta.seen ? { ...f.meta, seen: Object.keys(f.meta.seen).length + " keys" } : f.meta };
    const counts = this.sql.exec("SELECT type, COUNT(*) AS n, SUM(void) AS voided, MIN(ts) AS first, MAX(ts) AS last, MAX(upd) AS upd FROM events GROUP BY type ORDER BY type").toArray()
      .map(r => ({ type: r.type, n: r.n, voided: r.voided, first: iso(r.first), last: iso(r.last), updated: iso(r.upd) }));
    return { world: this.isQC ? this.worldName : "production", now: iso(Date.now()), lastTick: iso(this.kvGet("lastTick")), nextAlarm: iso(alarmAt), feeds, events: counts, log: this.sql.exec("SELECT COUNT(*) AS n FROM log").toArray()[0].n,
      images: this.sql.exec("SELECT COUNT(*) AS n FROM img").toArray()[0].n, sockets: this.ctx.getWebSockets().length, dbBytes: this.sql.databaseSize };
  }
  /** Every open task, in the order the state lists them (state.quests.side carries the first SIDE_TASKS_MAX). */
  async getTasks() { await this.getState(); if (!this.mem.tasks) this.recompute(Date.now()); return { total: this.mem.tasks.length, tasks: this.mem.tasks }; }
  /** The client has shown the last day close (the evening brief of a finished day). UI state, not a fact: kept beside the log. */
  async markSeen(date, seen = true) {
    const st = await this.getState(), lc = st.day.lastClose;
    if (!lc) return { ok: false, error: "no closed day yet" };
    if (seen === false) { this.sql.exec("DELETE FROM kv WHERE k = 'seenClose'"); this.recompute(Date.now()); this.broadcast([]); return { ok: true, lastClose: this.mem.state.state.day.lastClose }; }
    const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : lc.date;
    if (d > lc.date) return { ok: false, error: "that day has not closed; the last close is " + lc.date };
    const cur = this.kvGet("seenClose");
    if (!cur || cur.date < d) { this.kvPut("seenClose", { date: d, at: Date.now() }); this.recompute(Date.now()); this.broadcast([]); }
    return { ok: true, lastClose: this.mem.state.state.day.lastClose };
  }
  /** Raw events by source prefix and/or type (voided ones included), newest first, cursor-paged: for verifying a whole history and for finding test traffic. */
  listEvents(prefix, since, limit, cursor, type) {
    const lim = Math.max(1, Math.min(2000, limit || 500)), like = String(prefix || "").replace(/[\\%_]/g, c => "\\" + c) + "%";
    let cts = 8.64e15, cid = "\uffff";
    if (cursor && cursor.includes("|")) { cts = Number(cursor.slice(0, cursor.indexOf("|"))); cid = cursor.slice(cursor.indexOf("|") + 1); if (!Number.isFinite(cts)) return { error: "bad cursor" }; }
    const where = "source LIKE ? ESCAPE '\\' AND ts >= ? AND (? = '' OR type = ?)", args = [like, since || 0, type || "", type || ""];
    const total = this.sql.exec("SELECT COUNT(*) AS n, SUM(void) AS v FROM events WHERE " + where, ...args).toArray()[0];
    const rows = this.sql.exec("SELECT id, ts, type, source, data, rev, void, recv, upd FROM events WHERE " + where + " AND (ts < ? OR (ts = ? AND id < ?)) ORDER BY ts DESC, id DESC LIMIT ?", ...args, cts, cts, cid, lim).toArray();
    const events = rows.map(r => ({ id: r.id, type: r.type, source: r.source, ts: iso(r.ts), receivedAt: iso(r.recv), updatedAt: iso(r.upd), rev: r.rev, void: !!r.void, data: JSON.parse(r.data) }));
    const bySource = {}; for (const e of events) { const b = bySource[e.source] || (bySource[e.source] = { total: 0, live: 0, voided: 0, types: {} }); b.total++; e.void ? b.voided++ : b.live++; b.types[e.type] = (b.types[e.type] || 0) + 1; }
    const last = rows[rows.length - 1];
    return { source: prefix || "", type: type || null, since: iso(since || null), total: total.n, totalLive: total.n - (total.v || 0), count: events.length, live: events.filter(e => !e.void).length,
      next: rows.length === lim ? last.ts + "|" + last.id : null, bySource, events };
  }

  // ---------------- identifier audit: every place a payload rests in this object
  /** Counts of identifier-shaped strings per table. Never returns an identifier: last four characters only. */
  scanIdentifiers() {
    const tables = [], add = (table, rows, hits, note) => {
      const kinds = {}; for (const h of hits) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
      const rowIds = new Set(hits.map(h => h.row));
      tables.push({ table, rows, rowsWithIdentifiers: rowIds.size, identifiers: hits.length, kinds, last4: [...new Set(hits.map(h => h.last4))].slice(0, 12),
        where: [...new Set(hits.map(h => (h.type ? h.type + " " : "") + h.path))].slice(0, 12), ...(note ? { note } : {}) });
    };
    for (const isVoid of [0, 1]) {
      const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT id, type, source, data FROM events WHERE void = ?", isVoid)) {
        n++;
        const strict = moneyType(r.type);
        for (const h of scanValue(JSON.parse(r.data), () => strict)) hits.push({ ...h, row: r.id, type: r.type });
        for (const h of scanValue({ id: r.id, source: r.source }, () => false)) hits.push({ ...h, row: r.id, type: r.type, path: "(" + h.path + " column)" });
      }
      add(isVoid ? "events (voided)" : "events (live)", n, hits, "the data column holds the current revision only; an in-place revision overwrites it and no earlier payload is kept in any table");
    }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT id, type, body FROM log")) { n++; const strict = r.type === "money"; for (const h of scanValue(JSON.parse(r.body), (p, k) => strict && (k === "text" || k === "title"))) hits.push({ ...h, row: r.id, type: r.type }); }
      add("log (derived entries)", n, hits); }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT id, error, note, snapshot, meta FROM feeds")) { n++; for (const h of scanValue({ error: r.error, note: r.note, snapshot: r.snapshot ? JSON.parse(r.snapshot) : null, meta: r.meta ? JSON.parse(r.meta) : null }, () => false)) hits.push({ ...h, row: r.id }); }
      add("feeds (adapter snapshots and meta)", n, hits); }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT k, v FROM kv")) { n++; for (const h of scanValue(JSON.parse(r.v), p => /(^|\.)(treasury|guild)(\.|$)/.test(p))) hits.push({ ...h, row: r.k }); }
      add("kv (cached state document, tick and UI marks)", n, hits); }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT id, type FROM img")) { n++; for (const h of scanValue({ id: r.id }, () => false)) hits.push({ ...h, row: r.id, path: "(id column)" }); }
      add("img (photo bytes are not text; ids scanned)", n, hits); }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT id, body FROM clientlog")) { n++; for (const h of scanValue(JSON.parse(r.body), () => false)) hits.push({ ...h, row: String(r.id) }); }
      add("clientlog (client diagnostics)", n, hits); }
    { const hits = []; let n = 0;
      for (const r of this.sql.exec("SELECT hash, label FROM tokens")) { n++; for (const h of scanValue({ label: r.label }, () => true)) hits.push({ ...h, row: r.hash.slice(0, 12) }); }
      add("tokens (labels)", n, hits); }
    return { scannedAt: iso(Date.now()), tables, total: tables.reduce((s, t) => s + t.identifiers, 0),
      notKept: ["revision history (none: revisions overwrite in place)", "dead-letter or rejected payloads (none: a rejected event is not stored)", "request or debug logs of payloads (none: only error messages are logged)"],
      outsideThisScan: "the platform's 30-day point-in-time recovery of this object's SQLite storage still holds earlier page versions; it cannot be purged from here and ages out on its own" };
  }
  /** Rewrite, in place, every stored event whose payload still holds an identifier: the masked revision is the fact of record. */
  purgeIdentifiers(dry) {
    const now = Date.now(), changed = [], byType = {};
    for (const r of this.sql.exec("SELECT id, type, data, void FROM events").toArray()) {
      const masked = maskEventData(r.type, JSON.parse(r.data)), body = stable(masked);
      if (body === r.data) continue;
      const def = EVENT_TYPES[r.type], key = def && def.key ? def.key(masked) : null, newId = key != null && key !== "" && r.id.startsWith(r.type + ":") ? r.type + ":" + key : r.id;
      byType[r.type] = (byType[r.type] || 0) + 1; changed.push(r.id);
      if (dry) continue;
      if (newId !== r.id && this.sql.exec("SELECT 1 AS x FROM events WHERE id = ?", newId).toArray()[0]) this.sql.exec("DELETE FROM events WHERE id = ?", r.id);   // a masked twin already exists
      else this.sql.exec("UPDATE events SET id = ?, data = ?, hash = ?, rev = rev + 1, upd = ? WHERE id = ?", newId, body, fnv(r.type + "|" + body), now, r.id);
    }
    if (!dry && changed.length) { this.mem.events = null; this.mem.logHash = null; this.recompute(now); this.broadcast([]); }
    return { ok: true, dry: !!dry, events: changed.length, byType };
  }
  getEvents(type, limit) {
    return this.sql.exec("SELECT id, ts, type, source, data, rev, void FROM events WHERE type = ? ORDER BY ts DESC LIMIT ?", type, Math.max(1, Math.min(1000, limit || 50))).toArray()
      .map(r => ({ id: r.id, ts: iso(r.ts), type: r.type, source: r.source, data: JSON.parse(r.data), rev: r.rev, void: !!r.void }));
  }

  // ---------------- the tick: edge adapters, then recompute. Cron and the alarm both land here.
  async tick(force = false, only = null) {
    if (this.isQC) return { skipped: true, world: this.worldName, reason: "the QC world runs no edge adapters and no scheduled tick; it is driven only by pushed events" };
    const now = Date.now(), last = this.kvGet("lastTick") || 0;
    await this.ensureAlarm();
    if (!force && now - last < TICK_MS - 60000) return { skipped: true, lastTick: iso(last) };
    this.kvPut("lastTick", now);
    const feeds = this.loadFeeds(), report = {};
    const due = (this.env && this.env.NO_ADAPTERS === "1" ? [] : ADAPTERS).filter(a => (only ? a.id === only : true) && (force || !feeds[a.id] || feeds[a.id].okAt == null || feeds[a.id].error || now - feeds[a.id].okAt >= a.everyMin * 60000 - 90000));   // margin < the tick guard, so a tick that runs always finds the 5-minute feeds due
    const runOne = async a => {
      const f = this.loadFeeds()[a.id] || {};
      const tz = this.clockZone();
      const c = { now, tz, today: localDate(now, tz), meta: f.meta || null, snapshot: f.snapshot || null, place: this.currentPlace() };
      let timer;
      try {
        const out = await Promise.race([a.run(this.env, c), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timed out after 25 s")), 25000); })]);
        if (out.skip) { if (!out.keep) this.setFeed(a.id, { tryAt: now, note: out.note || f.note || null }); report[a.id] = out.keep ? "cached" : "skipped: " + (out.note || ""); return; }
        const list = [...(out.events || []), ...(out.voids || []).map(id => ({ id, type: id.split(":")[0], source: a.id, void: true }))];
        const { res } = this.write(list, now);
        this.setFeed(a.id, { okAt: now, tryAt: now, error: null, fails: 0, note: out.note || null, snapshot: out.snapshot !== undefined ? out.snapshot : f.snapshot || null, meta: out.meta !== undefined ? out.meta : f.meta || null });
        report[a.id] = { ok: true, new: res.new, revised: res.revised, voided: res.voided, rejected: res.rejected.length ? res.rejected.slice(0, 3) : 0 };
      } catch (err) {
        // A failed run keeps the last good snapshot and meta, records why, and is tried again on the next tick.
        this.setFeed(a.id, { tryAt: now, error: String((err && err.message) || err).slice(0, 300), fails: (f.fails || 0) + 1 });
        report[a.id] = { ok: false, error: String((err && err.message) || err).slice(0, 300) };
      } finally { clearTimeout(timer); }
    };
    // an adapter with the id "steps" (if you write one) runs first: its snapshot carries the device's time zone, which the others are given
    const first = due.find(a => a.id === "steps");
    if (first) await runOne(first);
    await Promise.allSettled(due.filter(a => a.id !== "steps").map(runOne));
    const fresh = this.recompute(Date.now());
    this.broadcast(fresh);
    await this.armAlarm();
    return { ok: true, ran: due.map(a => a.id), report, logEntries: fresh.length, activity: this.mem.state.state.character.activity };
  }
  clockZone() {
    const f = this.loadFeeds(), st = this.mem.state || this.kvGet("state");
    const tz = (st && st.state && st.state.realm && st.state.realm.tz) || (f.steps && f.steps.snapshot && f.steps.snapshot.tz);
    return validZone(tz) ? tz : "UTC";
  }
  currentPlace() {
    const r = this.sql.exec("SELECT data FROM events WHERE type = 'place.arrive' AND void = 0 ORDER BY ts DESC, id DESC LIMIT 1").toArray()[0];
    if (!r) return null;
    const d = JSON.parse(r.data);
    return typeof d.lat === "number" && typeof d.lon === "number" ? { lat: d.lat, lon: d.lon } : null;
  }
  async ensureAlarm() {
    const at = await this.ctx.storage.getAlarm();
    if (at == null || at < Date.now() - 60000) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }
  async alarm() {
    const now = Date.now(), last = this.kvGet("lastTick") || 0;
    try {
      if (!this.isQC && now - last >= TICK_MS - 60000) await this.tick(false);
      else { this.recompute(now); if (this.mem.activityChanged) this.broadcast([]); }   // between ticks: an activity ran out
    } catch (e) { console.log("alarm failed: " + ((e && e.message) || e)); }
    try { await this.autoPull(now); } catch (e) { console.log("auto pull failed: " + ((e && e.message) || e)); }
    await this.armAlarm();
  }
  async replay() { this.mem = { events: null, feeds: null, logHash: null, state: null }; const fresh = this.recompute(Date.now()); this.broadcast([]); return { ok: true, log: this.mem.logHash.size, newEntries: fresh.length }; }

  // ---------------- images (item photos, portraits): pushed with the ingest key, served to sessions
  putImage(id, type, bytes) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return { ok: false, error: "image id must be 1-120 chars of A-Z a-z 0-9 . _ -" };
    if (!/^image\/(webp|png|jpeg|avif|gif)$/.test(type)) return { ok: false, error: "content-type must be image/webp, png, jpeg, avif or gif" };
    if (!bytes || !bytes.byteLength) return { ok: false, error: "empty body" };
    if (bytes.byteLength > MAX_IMG) return { ok: false, error: "image over " + MAX_IMG + " bytes; send a resized webp" };
    this.sql.exec("INSERT INTO img (id, type, bytes, at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, bytes = excluded.bytes, at = excluded.at", id, type, bytes, Date.now());
    this.mem.images = null; this.mem.stale = true;          // state may now point at it
    return { ok: true, id, bytes: bytes.byteLength, url: "/api/img/" + id };
  }
  deleteImage(id) { const had = !!this.sql.exec("SELECT 1 AS x FROM img WHERE id = ?", id).toArray()[0]; this.sql.exec("DELETE FROM img WHERE id = ?", id); this.mem.images = null; this.mem.stale = true; return { ok: true, deleted: had }; }
  getImage(id) {
    const r = this.sql.exec("SELECT type, bytes, at FROM img WHERE id = ?", id).toArray()[0];
    return r ? { type: r.type, bytes: r.bytes, at: r.at } : null;
  }

  // ---------------- peering: other worlds, each run by its own owner (src/peers.js, docs/MULTIPLAYER.md)
  // The settings and the peer table live beside the log; received cards are `peer.card` events (internal: nobody can push one).
  peeringGet() { const s = P.cleanSettings(this.kvGet("peering"), {}); if (!s.name && this.env && typeof this.env.WORLD_NAME === "string" && this.env.WORLD_NAME.trim()) s.name = this.env.WORLD_NAME.trim().slice(0, 60); return s; }
  peeringSet(patch) {
    const next = P.cleanSettings(this.kvGet("peering"), patch);
    this.kvPut("peering", next); this.mem.stale = true;
    this.armAlarm().catch(() => {});                       // autoPull on or off: the next alarm follows
    return { ok: true, peering: this.peeringGet(), world: this.isQC ? this.worldName : "production" };
  }
  peerRows() { return this.sql.exec("SELECT * FROM peers ORDER BY created").toArray(); }
  peerRow(id) { return this.sql.exec("SELECT * FROM peers WHERE id = ?", id).toArray()[0] || null; }
  /** What the state shows: the settings and every peer (never a secret). Expired invites are dropped here. */
  peeringSnapshot() {
    const s = this.peeringGet(), now = Date.now();
    for (const r of this.peerRows()) if (r.status === "invited" && r.invite_exp && r.invite_exp < now) this.sql.exec("DELETE FROM peers WHERE id = ?", r.id);
    return { ...s, peers: this.peerRows().map(P.publicPeer) };
  }
  peerList() { return { ok: true, world: this.isQC ? this.worldName : "production", ...this.peeringSnapshot() }; }
  /** Mint an invite for a friend: a pending peer with a fresh secret. Needs peering on (otherwise the friend's hello would find nothing). */
  peerInvite(body, selfUrl) {
    const s = this.peeringGet();
    if (!s.enabled) return { ok: false, error: "peering is off for this world; turn it on first (PUT /api/share { enabled: true })" };
    if (!s.name) return { ok: false, error: "give this world a display name first (PUT /api/share { name })" };
    const u = P.cleanUrl(s.url || selfUrl); if (!u.ok) return { ok: false, error: "this world's own address (" + String(s.url || selfUrl) + ") is not shareable: " + u.error + "; set it with PUT /api/share { url }" };
    if (this.peerRows().length >= P.MAX_PEERS) return { ok: false, error: "at most " + P.MAX_PEERS + " peers" };
    const now = Date.now(), id = P.randomHex(8), secret = P.randomHex(32), share = P.cleanFields(body && "share" in body ? body.share : s.fields);
    const label = body && typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : null;
    this.sql.exec("INSERT INTO peers (id, name, url, world, secret, share, enabled, status, created, invite_exp) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'invited', ?, ?)", id, label, secret, JSON.stringify(share), body && body.enabled === true ? 1 : 0, now, now + P.INVITE_TTL_MS);
    this.mem.stale = true;
    const code = P.encodeInvite({ pair: id, secret, url: u.url, world: this.isQC ? this.worldName : null, name: s.name, exp: now + P.INVITE_TTL_MS });
    return { ok: true, world: this.isQC ? this.worldName : "production", peer: P.publicPeer(this.peerRow(id)), code, expiresAt: new Date(now + P.INVITE_TTL_MS).toISOString(),
      note: "hand this code to the friend out of band; it is good once, for seven days. Sharing to them stays off until you enable the peer." };
  }
  /** Accept a friend's invite: store the pairing, then tell their world where this one lives (a signed hello). */
  async peerAccept(body, selfUrl) {
    const s = this.peeringGet();
    if (!s.enabled) return { ok: false, error: "peering is off for this world; turn it on first (PUT /api/share { enabled: true })" };
    if (!s.name) return { ok: false, error: "give this world a display name first (PUT /api/share { name })" };
    const inv = P.decodeInvite(body && body.code, Date.now()); if (!inv.ok) return { ok: false, error: inv.error };
    const u = P.cleanUrl(s.url || selfUrl); if (!u.ok) return { ok: false, error: "this world's own address (" + String(s.url || selfUrl) + ") is not shareable: " + u.error + "; set it with PUT /api/share { url }" };
    if (this.peerRow(inv.pair)) return { ok: false, error: "this invite was already accepted here" };
    if (inv.url === u.url && (inv.world || null) === (this.isQC ? this.worldName : null)) return { ok: false, error: "a world cannot peer with itself" };
    if (this.peerRows().length >= P.MAX_PEERS) return { ok: false, error: "at most " + P.MAX_PEERS + " peers" };
    const now = Date.now(), share = P.cleanFields(body && "share" in body ? body.share : s.fields), enabled = body && body.enabled === true ? 1 : 0;
    const helloBody = JSON.stringify({ v: P.PEER_VERSION, url: u.url, world: this.isQC ? this.worldName : null, name: s.name });
    const path = P.peerPath("/api/peer/hello", inv.world);
    let res, text;
    try {
      const h = await P.signRequest(inv.secret, inv.pair, "POST", path, helloBody, now);
      const sig = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined;
      res = await fetch(inv.url + path, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: helloBody, ...(sig ? { signal: sig } : {}) });
      text = await res.text();
    } catch (e) { return { ok: false, error: "could not reach the inviting world: " + String((e && e.message) || e).slice(0, 200) }; }
    if (res.status !== 200) return { ok: false, error: "the inviting world refused the hello (HTTP " + res.status + ")" };
    const v = await P.verifyResponse(inv.secret, n => res.headers.get(n), res.status, text, Date.now());
    if (!v.ok) return { ok: false, error: "the inviting world's answer did not verify: " + v.error };
    let hello = {}; try { hello = JSON.parse(text); } catch {}
    const theirName = typeof hello.name === "string" && hello.name.trim() ? hello.name.trim().slice(0, 60) : inv.name;
    this.sql.exec("INSERT INTO peers (id, name, url, world, secret, share, enabled, status, created, accepted) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)", inv.pair, theirName, inv.url, inv.world, inv.secret, JSON.stringify(share), enabled, now, now);
    this.mem.stale = true; this.armAlarm().catch(() => {});
    return { ok: true, world: this.isQC ? this.worldName : "production", peer: P.publicPeer(this.peerRow(inv.pair)) };
  }
  peerUpdate(id, body) {
    const r = this.peerRow(id); if (!r) return { ok: false, error: "no such peer" };
    const share = body && "share" in body ? JSON.stringify(P.cleanFields(body.share)) : r.share;
    const enabled = body && "enabled" in body ? (body.enabled === true ? 1 : 0) : r.enabled;
    const name = body && typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : r.name;
    this.sql.exec("UPDATE peers SET share = ?, enabled = ?, name = ? WHERE id = ?", share, enabled, name, id);
    this.mem.stale = true; this.armAlarm().catch(() => {});
    return { ok: true, peer: P.publicPeer(this.peerRow(id)) };
  }
  /** Forget a peer: the pairing and the card it sent (their world keeps its own copy of the pairing until they delete it too). */
  peerDelete(id) {
    const had = !!this.peerRow(id);
    this.sql.exec("DELETE FROM peers WHERE id = ?", id);
    const { res } = this.write([{ id: "peer.card:" + id, type: "peer.card", source: "peer:" + id, void: true }], Date.now(), { internal: true });
    this.mem.stale = true; if (res.changed.length) { this.recompute(Date.now()); this.broadcast([]); }
    return { ok: true, deleted: had };
  }
  /** The automatic pull (settings.autoPull, off by default): when the next one is due (the first one at once), or null when there is nothing to pull. */
  nextAutoPull() {
    const s = this.peeringGet();
    if (!s.enabled || !s.autoPull) return null;
    if (!this.peerRows().some(r => r.status === "active" && r.enabled)) return null;
    const last = this.kvGet("lastAutoPull") || 0;
    return last ? last + P.AUTO_PULL_MS : 0;
  }
  /** Runs from the alarm: the same pull the Refresh button does, at most every AUTO_PULL_MS, only while the owner has it on. */
  async autoPull(now = Date.now()) {
    const due = this.nextAutoPull();
    if (due == null || due > now + 3000) return null;
    this.kvPut("lastAutoPull", now);
    return this.peerRefresh(null);
  }
  /** Pull the card from every enabled, active peer (owner-triggered, or the alarm with autoPull on). Each card becomes a `peer.card` event; a failure is recorded on the peer, nothing else. */
  async peerRefresh(onlyId) {
    const s = this.peeringGet(), now = Date.now(), report = {};
    if (!s.enabled) return { ok: false, error: "peering is off for this world" };
    const rows = this.peerRows().filter(r => r.status === "active" && r.enabled && (!onlyId || r.id === onlyId));
    const events = [];
    await Promise.allSettled(rows.map(async r => {
      const path = P.peerPath("/api/peer/card", r.world || null);
      let timer;
      try {
        const h = await P.signRequest(r.secret, r.id, "GET", path, "", Date.now());
        const sig = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined;
        const res = await Promise.race([fetch(r.url + path, { headers: h, ...(sig ? { signal: sig } : {}) }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timed out after 15 s")), 15000); })]);
        const text = await res.text();
        if (res.status !== 200) throw new Error("HTTP " + res.status);
        if (text.length > P.CARD_MAX_BYTES) throw new Error("card too large");
        const v = await P.verifyResponse(r.secret, n => res.headers.get(n), res.status, text, Date.now());
        if (!v.ok) throw new Error(v.error);
        const card = P.cleanCard(JSON.parse(text)); if (!card) throw new Error("not a card");
        events.push({ id: "peer.card:" + r.id, ts: Date.now(), type: "peer.card", source: "peer:" + r.id, data: { peerId: r.id, world: { name: card.world.name || r.name || null, url: r.url, world: r.world || null }, fields: card.fields, values: card.values, cardAt: card.at, receivedAt: new Date().toISOString() } });
        this.sql.exec("UPDATE peers SET last_pull = ?, last_error = NULL, last_seen = ?, name = COALESCE(?, name) WHERE id = ?", Date.now(), Date.now(), card.world.name || null, r.id);
        report[r.id] = { ok: true, fields: card.fields };
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 200);
        this.sql.exec("UPDATE peers SET last_pull = ?, last_error = ? WHERE id = ?", Date.now(), msg, r.id);
        report[r.id] = { ok: false, error: msg };
      } finally { clearTimeout(timer); }
    }));
    const { res } = events.length ? this.write(events, now, { internal: true }) : { res: { changed: [] } };
    this.mem.stale = true;
    const fresh = this.recompute(Date.now()); this.broadcast(fresh);
    return { ok: true, world: this.isQC ? this.worldName : "production", pulled: rows.length, changed: res.changed.length, report };
  }
  /**
   * A request from another world (src/index.js, /api/peer/*). The whole feature is gated: with peering off every answer is 404.
   * A request that is not signed by a known pair is 401 with nothing in it. Answers are signed with the pair's secret.
   */
  async peerRequest(req) {
    const s = this.peeringGet(), now = Date.now();
    const bare = (status, body) => ({ status, body: JSON.stringify(body), headers: {} });
    if (!s.enabled) return bare(404, { error: "not found" });
    const id = String(req.headers["x-peer-id"] || "");
    const r = /^[a-f0-9]{16}$/.test(id) ? this.peerRow(id) : null;
    if (!r) return bare(401, { error: "unauthorized" });
    if (!this.mem.nonces) this.mem.nonces = new Map();
    const v = await P.verifyRequest(r.secret, n => req.headers[n], req.method, req.path, req.body || "", this.mem.nonces, now);
    if (!v.ok) return bare(401, { error: "unauthorized" });
    const signed = async (status, obj) => { const body = JSON.stringify(obj); return { status, body, headers: await P.signResponse(r.secret, status, body, Date.now()) }; };
    if (req.method === "POST" && req.route === "hello") {
      let b = {}; try { b = JSON.parse(req.body || "{}"); } catch { return signed(400, { error: "bad body" }); }
      const u = P.cleanUrl(b.url); if (!u.ok) return signed(400, { error: "bad url: " + u.error });
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : r.name;
      this.sql.exec("UPDATE peers SET url = ?, world = ?, name = ?, status = 'active', accepted = COALESCE(accepted, ?), invite_exp = NULL, last_seen = ? WHERE id = ?", u.url, P.cleanWorld(b.world), name, now, now, id);
      this.armAlarm().catch(() => {});
      this.mem.stale = true;
      return signed(200, { ok: true, v: P.PEER_VERSION, name: s.name });
    }
    if (req.method === "GET" && req.route === "card") {
      if (r.status !== "active") return signed(403, { error: "pairing not completed" });
      if (!r.enabled) return signed(403, { error: "sharing is off for this peer" });
      this.sql.exec("UPDATE peers SET last_seen = ? WHERE id = ?", now, id);
      const card = P.buildCard(await this.getState(), P.cleanFields(JSON.parse(r.share || "[]")), s);
      return signed(200, card);
    }
    return signed(404, { error: "not found" });
  }

  // ---------------- live channel (WebSocket, hibernation API)
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const st = this.mem.state || this.kvGet("state");
    pair[1].send(JSON.stringify({ type: "hello", env: this.isQC ? "qc" : "production", ...(this.isQC ? { world: this.worldName } : {}), asOf: iso(Date.now()), computedAt: st ? iso(st.at) : null }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    if (msg === "state") ws.send(JSON.stringify({ type: "state" }));
  }
  webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch {} }
  webSocketError(ws) { try { ws.close(1011, "error"); } catch {} }
  broadcast(entries) {
    const act = this.mem.activityChanged; this.mem.activityChanged = null;
    const socks = this.ctx.getWebSockets();
    if (!socks.length) return;
    const msgs = (entries || []).slice(-25).map(e => JSON.stringify({ type: "event", event: e }));
    if (act) msgs.push(JSON.stringify({ type: "activity", activity: act }));
    msgs.push(JSON.stringify({ type: "state" }));
    for (const ws of socks) { try { for (const m of msgs) ws.send(m); } catch {} }
  }
}
