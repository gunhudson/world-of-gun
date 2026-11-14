// Two worlds, one codebase. Production holds the owner's real events (its Durable Object is
// named "gun", the player's id). "qc" is the sandbox: the same engine over an empty log, fed only
// by what is pushed to it, for testing clients and collectors without touching production.
// Pure decisions live here so they can be tested; src/index.js wires them to requests.
//
// Which world a request reaches:
//   - a key decides by which secret it matches: a production key always and only reaches
//     production, a QC key always and only reaches QC worlds (plain "qc" unless a marker names one);
//   - a read token decides by its prefix (wogr_ production, wogq_ / wogq-<name>_ its QC world);
//   - an owner session reaches production unless the request says `?world=qc[-name]` or `x-world: qc[-name]`.
// An explicit marker that disagrees with the credential is refused (409): it never redirects.
export const PROD = "gun", QC = "qc";
// The sandbox has namespaces so separate pieces of work do not collide: "qc" (shared) and "qc-<name>" (qc-ui, qc-ios ...),
// each its own instance with its own log, seed and reset. All of them are "the QC world" to a QC key.
const QC_NAME = /^qc(?:-[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)?$/;
export const isQcWorld = w => typeof w === "string" && QC_NAME.test(w);

/** The explicit marker on a request: "" (none), "gun", "qc", "qc-<name>", or null when it is not a known world. */
export function askedWorld(query, header) {
  const v = String(query ?? header ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v === "gun" || v === "prod" || v === "production") return PROD;
  return QC_NAME.test(v) ? v : null;
}
/**
 * cred: what the credential is.
 *   null                      an owner session: it follows the marker (production when there is none)
 *   "gun"                     a production key or token: production, always and only
 *   "qc"                      a QC key: any QC world, never production; with no marker it means plain "qc"
 *   { exact: "<world>" }      a read token: exactly the world that minted it
 * -> { world } | { status, error }
 */
export function decideWorld(cred, asked) {
  if (asked === null) return { status: 400, error: "unknown world; use world=qc or world=qc-<name> (lowercase letters, digits, hyphen) for the sandbox, or leave it out for production" };
  if (!cred) return { world: asked || PROD };
  const exact = typeof cred === "object" ? cred.exact : null, cls = exact ? (isQcWorld(exact) ? QC : PROD) : cred;
  const toProd = "this is a production credential and the request asks for a QC world; nothing was done. Use the QC key or a QC token (docs/EVENTS.md, 'Test against the QC world').";
  const toQc = "this is a QC credential and the request asks for production; nothing was done. A QC key or token only reaches QC worlds.";
  if (cls === PROD) return asked && asked !== PROD ? { status: 409, error: toProd } : { world: PROD };
  if (asked === PROD) return { status: 409, error: toQc };
  if (exact) return asked && asked !== exact ? { status: 409, error: "this token belongs to the world " + exact + " and the request asks for " + asked + "; nothing was done." } : { world: exact };
  return { world: asked || QC };
}
/** wogr_<hex> production · wogq_<hex> the shared QC world · wogq-<name>_<hex> the QC world qc-<name> */
export function tokenWorld(token) {
  const m = /^(wogr|wogq(-[a-z0-9-]+)?)_/.exec(String(token || ""));
  return !m ? null : m[1] === "wogr" ? PROD : QC + (m[2] || "");
}
export const tokenPrefix = world => (isQcWorld(world) ? "wogq" + world.slice(2) + "_" : "wogr_");

// ---- the production guard: test traffic names itself, and production refuses it
const qcName = s => /^qc(?:[-_.:]|$)/i.test(s) || /simulator/i.test(s);
/** True for a source, device id or event id that belongs to testing: `qc-…`, `phone:qc-…`, `manual:qc`, anything with "simulator". */
export function isQcTraffic(source, id) {
  return String(source || "").split(":").some(qcName) || (typeof id === "string" && /^(?:phone|act):qc(?:[-_.:]|$)/i.test(id)) || (typeof id === "string" && /simulator/i.test(id));
}
export const QC_REFUSED = "test traffic is not accepted by the production world (source or device id starts with qc, or names a simulator). Send it to the QC world: QC keys, or x-world: qc on a session. See docs/EVENTS.md, 'Test against the QC world'.";
