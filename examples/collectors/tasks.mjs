#!/usr/bin/env node
// Example collector 3: a task list (JSON) -> `task.open` and `task.done`, withdrawing tasks that vanished.
//   node tasks.mjs [--dry]
// The open task is stamped with the moment it was seen (the file carries no creation time; nothing is invented).
// Pattern for sources where rows disappear: remember the ids pushed last time and void the ones that are gone now
// (a task deleted or re-opened). A done task is only seen while it stays in the list, so keep finished tasks in the
// file for at least one run, or they earn nothing.
import { readJson, push, withVoids, markOk, main } from "./lib/wog.mjs";

const AREAS = ["strategy", "body", "mind", "things", "people", "joy", "wealth", "connection", "growth", "impact"];

main("tasks", async () => {
  const events = [];
  for (const t of readJson("tasks.json").tasks) {
    const data = { taskId: t.id, title: t.title };
    if (AREAS.includes(String(t.area).toLowerCase())) data.area = t.area.toLowerCase();
    if (t.priority) { data.priority = t.priority; if (/one thing/i.test(t.priority)) data.oneThing = true; }
    if (t.do) data.doDate = t.do;
    if (t.due) data.dueDate = t.due;
    if (t.done) {
      if (!t.doneAt) continue;                              // done but nobody recorded when: do not guess
      events.push({ id: "task.done:" + t.id, ts: t.doneAt, type: "task.done", source: "tasks.json", data: { ...data, completedAt: t.doneAt } });
    } else {
      events.push({ id: "task.open:" + t.id, ts: new Date().toISOString(), type: "task.open", source: "tasks.json", data });
    }
  }
  const { events: all, remember } = withVoids("tasks-pushed", events, "tasks.json");
  await push("tasks", all);
  remember();
  markOk("tasks");
});
