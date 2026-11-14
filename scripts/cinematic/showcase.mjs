#!/usr/bin/env node
// Renders the showcase film offline, shot by shot, through /dev/showcase.html (offline ultra stage + in-frame titles),
// then cuts it with ffmpeg (xfade dissolves between shots), lays the generated score under it (score.mjs) and writes
// public/video/showcase.mp4 (1920x1080, 30 fps, h264 + aac) and showcase.jpg (poster). The shot list is
// public/dev/showcase-shots.js; frames are supersampled (--scale 2 = 3840x2160) and downscaled by ffmpeg.
//
//   node scripts/cinematic/showcase.mjs [--shot name[,name]] [--frames N] [--base http://localhost:8981] [--fps 30]
//                                       [--scale 2] [--crf 25] [--master-crf 16] [--encode-only] [--deliver-only] [--no-audio] [--tall] [--out path]
//
// --tall renders the 9:16 version for phones held upright (public/video/showcase-tall.mp4, 1080x1920 from 2160x3840): the page
// re-frames every shot for the tall frame (showcase.html `?tall=1`), frames go to <shot>-tall/, the score is reused as is.
//
// --shot renders only those shots (their frames replace the old ones) and then cuts the whole film from every shot's
// frames on disk, so one shot can be re-rendered after a stage change. --frames N is a probe: N frames per shot, no cut.
// Frames stay in .render/cinematic/showcase/<shot>/ (about 3 GB for the film) until --no-keep... they are kept by
// default so a re-cut (--encode-only) needs no re-render; delete the folder when done.
// Without --base it starts `wrangler dev --port 8981` itself (needs .dev.vars with DEV=1). One browser, one ffmpeg.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { SHOTS, timeline } = await import(pathToFileURL(join(ROOT, "public", "dev", "showcase-shots.js")).href);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d; };
const ONLY = opt("shot", null) ? String(opt("shot")).split(",") : null;
const FPS = Number(opt("fps", 30));
const LIMIT = Number(opt("frames", 0)) || 0;
const CRF = String(opt("crf", 25));                  // the delivery encode (after a light denoise; the stage's film grain is what costs bits)
const MASTER_CRF = String(opt("master-crf", 16));    // the cut itself, kept under .render for re-deliveries
const DELIVER_ONLY = !!opt("deliver-only", false);   // re-encode the existing master only (seconds, not minutes)
const TALL = !!opt("tall", false);                   // the 9:16 version for phones held upright (showcase-tall.mp4): tall viewport, re-framed shots
const SUFFIX = TALL ? "-tall" : "";
const DSF = Number(opt("scale", 2));
const ENCODE_ONLY = !!opt("encode-only", false);
const NO_AUDIO = !!opt("no-audio", false);
const PORT = 8981;
const WRANGLER = existsSync(join(ROOT, "node_modules", ".bin", "wrangler")) ? join(ROOT, "node_modules", ".bin", "wrangler") : "wrangler";
let BASE = opt("base", null);
const OUT = resolve(String(opt("out", join(ROOT, "public", "video", `showcase${SUFFIX}.mp4`))));
const WORK = join(process.env.WOG_WORK || join(ROOT, ".render"), "cinematic", "showcase");
const W = TALL ? 1080 : 1920, H = TALL ? 1920 : 1080;
for (const n of ONLY || []) if (!SHOTS.find((s) => s.name === n)) throw new Error("unknown shot " + n);

function ffmpegCmd() {
  const envs = [{}];
  for (const bin of [process.env.FFMPEG, "ffmpeg"].filter(Boolean)) {
    for (const env of envs) {
      const r = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", env: { ...process.env, ...env } });
      if (r.status === 0 && /libx264/.test(r.stdout)) return { bin, env: { ...process.env, ...env } };
    }
  }
  throw new Error("no working ffmpeg with libx264 found (set FFMPEG=/path/to/ffmpeg)");
}
const FF = ffmpegCmd();
const ff = (a, label) => {
  console.log(`[ffmpeg] ${label}`);
  const r = spawnSync(FF.bin, ["-hide_banner", "-loglevel", "warning", "-y", "-threads", "8", ...a], { stdio: "inherit", env: FF.env });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${label})`);
};
async function waitFor(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("dev server did not answer at " + url);
}

async function renderShot(browser, shot) {
  const dir = join(WORK, shot.name + SUFFIX);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/dev/showcase.html${TALL ? "?tall=1" : ""}`, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => window.__ready === true || window.__bootError, null, { timeout: 120000 });
  const t0 = Date.now();
  const info = await page.evaluate((name) => window.show.setup(name), shot.name);
  console.log(`[${shot.name}] ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(info));
  if (info.tier !== "ultra") throw new Error("stage is not on the ultra tier");
  if (info.model !== "glb") console.warn(`[${shot.name}] WARNING: the stand-in is on the dais, not gun.glb`);
  const N = LIMIT || Math.round(shot.dur * FPS), dt = 1 / FPS;
  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    const b64 = await page.evaluate((dt) => window.show.frame(dt).slice(23), dt);
    writeFileSync(join(dir, String(i).padStart(5, "0") + ".jpg"), Buffer.from(b64, "base64"));
    if (i % 60 === 0 || i === N - 1) { const el = (Date.now() - t1) / 1000; console.log(`[${shot.name}] frame ${i + 1}/${N}  ${el.toFixed(0)} s  (${(el / (i + 1)).toFixed(2)} s/frame)`); }
  }
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ shot: shot.name, frames: N, fps: FPS, dur: shot.dur, scale: DSF, at: new Date().toISOString() }));
  await ctx.close();
  if (errs.length) console.log(`[${shot.name}] page errors:`, [...new Set(errs)].slice(0, 5));
  return { frames: N, seconds: (Date.now() - t1) / 1000 };
}

function cut() {
  const tl = timeline(SHOTS);
  const master = join(WORK, `showcase-master${SUFFIX}.mp4`);
  if (!DELIVER_ONLY) cutMaster(tl, master);
  deliver(tl, master);
}
function cutMaster(tl, master) {
  const inputs = [], filters = [];
  SHOTS.forEach((s, i) => {
    const dir = join(WORK, s.name + SUFFIX);
    const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jpg")).length : 0;
    if (n < Math.round(s.dur * FPS)) throw new Error(`shot ${s.name}: ${n} frames on disk, needs ${Math.round(s.dur * FPS)} (render it first)`);
    inputs.push("-framerate", String(FPS), "-i", join(dir, "%05d.jpg"));
    filters.push(`[${i}:v]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p,settb=AVTB,fps=${FPS}[v${i}]`);
  });
  let prev = "[v0]";
  for (let i = 1; i < SHOTS.length; i++) {
    const t = SHOTS[i - 1].trans || 0, off = tl.shots[i].start;
    const label = i === SHOTS.length - 1 ? "[vout]" : `[x${i}]`;
    filters.push(t > 0 ? `${prev}[v${i}]xfade=transition=fade:duration=${t}:offset=${off.toFixed(3)}${label}` : `${prev}[v${i}]concat=n=2:v=1:a=0${label}`);
    prev = label;
  }
  ff([...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", "-c:v", "libx264", "-preset", "medium", "-crf", MASTER_CRF, "-pix_fmt", "yuv420p", "-an", master], "cut (master)");
}
function deliver(tl, master) {
  if (!existsSync(master)) throw new Error("no master at " + master + " (run the cut first)");
  mkdirSync(dirname(OUT), { recursive: true });
  // delivery: a light temporal denoise takes the grain's cost out, then a size-aware encode (peak rate capped for the 20 MB rule)
  const video = join(WORK, `showcase-video${SUFFIX}.mp4`);
  ff(["-i", master, "-vf", "hqdn3d=1.4:1.1:4:4", "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-maxrate", "2400k", "-bufsize", "4800k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-movflags", "+faststart", "-an", video], "deliver");
  // the score
  const cues = join(WORK, "cues.json");
  writeFileSync(cues, JSON.stringify({ fps: FPS, ...tl }, null, 1));
  if (!NO_AUDIO) {
    const wav = join(WORK, "score.wav");
    if (TALL && existsSync(wav)) console.log("[score] reusing " + wav + " (same cut)");     // the tall version is the same cut: same score
    else { const r = spawnSync("node", [join(ROOT, "scripts", "cinematic", "score.mjs"), "--cues", cues, "--out", wav], { stdio: "inherit" }); if (r.status !== 0) throw new Error("score.mjs failed"); }
    ff(["-i", video, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT], "mux");
  } else ff(["-i", video, "-c", "copy", OUT], "copy");
  // poster: the title shot at its marked second
  const ps = SHOTS.find((s) => s.poster != null) || SHOTS[0];
  const pf = Math.min(Math.round(ps.dur * FPS) - 1, Math.round((ps.poster ?? 0) * FPS));
  ff(["-i", join(WORK, ps.name + SUFFIX, String(pf).padStart(5, "0") + ".jpg"), "-vf", `scale=${TALL ? "720:1280" : "1280:720"}:flags=lanczos`, "-q:v", "3", "-update", "1", "-frames:v", "1", OUT.replace(/\.mp4$/, ".jpg")], "poster");
  const mb = (p) => (existsSync(p) ? (statSync(p).size / 1048576).toFixed(2) + " MB" : "-");
  console.log(`${OUT} ${mb(OUT)} · ${OUT.replace(/\.mp4$/, ".jpg")} ${mb(OUT.replace(/\.mp4$/, ".jpg"))} · ${tl.total.toFixed(1)} s`);
  if (statSync(OUT).size > 20 * 1048576) console.warn("WARNING: showcase.mp4 is over 20 MB; raise --crf");
}

async function main() {
  const list = ONLY ? SHOTS.filter((s) => ONLY.includes(s.name)) : SHOTS;
  let dev = null;
  const render = !ENCODE_ONLY && !DELIVER_ONLY;
  if (render) {
    if (!BASE) {
      BASE = `http://localhost:${PORT}`;
      console.log(`starting wrangler dev on ${PORT}`);
      dev = spawn(WRANGLER, ["dev", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore", env: { ...process.env, WRANGLER_LOG: "error" }, detached: true });
    }
    await waitFor(`${BASE}/dev/showcase.html`);
  }
  const report = {};
  try {
    if (render) {
      const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
      for (const s of list) report[s.name] = await renderShot(browser, s);
      await browser.close();
    }
    if (!LIMIT) cut();
  } finally {
    if (dev) { try { process.kill(-dev.pid, "SIGTERM"); } catch {} }
  }
  console.log(JSON.stringify(report));
}
main().catch((e) => { console.error(e); process.exit(1); });
