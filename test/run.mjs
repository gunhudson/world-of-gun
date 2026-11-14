// Runs every test file in this folder: `node test/run.mjs`. Exit code 1 if any test fails.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".test.mjs")).sort()) {
  console.log("\n" + f);
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) bad++;
}
console.log(bad ? "\n" + bad + " file(s) failed" : "\nall test files passed");
process.exit(bad ? 1 : 0);
