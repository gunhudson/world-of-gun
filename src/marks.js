// First-seen times for derived log entries. A quest completion, level-up or achievement is
// stamped by the reducer from the facts of its day, so a later fact on the same day would move
// it. The first time the engine sees such an entry on an open day it writes an `engine.mark`
// event into the log ({ entry, at }); the reducer then always uses that time. Because the mark
// is itself in the log, a replay gives the same times. When the entry disappears (the fact that
// completed it was withdrawn) the mark is voided, so a later completion gets its own time.
// Pure: syncMarks(derived, events, fromDate) -> { add: [events], void: [events] }.
export const MARKED_TYPES = ["quest", "level", "attribute", "achievement"];
const dateOfEntry = e => (e.day && e.day.date) || null;

export function syncMarks(derived, events, entryDates, fromDate) {
  const marks = new Map(); for (const e of events) if (e.type === "engine.mark" && e.data && e.data.entry) marks.set(e.data.entry, e);
  const live = new Map(); for (const e of derived) if (MARKED_TYPES.includes(e.type) && e.source === "engine") live.set(e.id, e);
  const add = [], gone = [];
  for (const [id, e] of live) {
    const date = entryDates.get(id);
    if (!marks.has(id) && date && date >= fromDate) add.push({ id: "engine.mark:" + id, ts: Date.parse(e.ts), type: "engine.mark", source: "engine", data: { entry: id, at: e.ts, date } });
  }
  for (const [id, m] of marks) if (!live.has(id) && m.data.date && m.data.date >= fromDate) gone.push({ id: m.id, type: "engine.mark", source: "engine", void: true });
  return { add, void: gone };
}
