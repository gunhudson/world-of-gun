#!/usr/bin/env node
// Renders the title fly-over offline, at a quality the live page cannot afford, into public/video/cold-open-<variant>.mp4
// (+ a 1280x720 poster .jpg). Frames come from /dev/stage.html in offline mode (stage.step(dt), see docs/CLIENT.md),
// supersampled at 3840x2160 and downscaled by ffmpeg to 1920x1080 at 30 fps.
//
//   node scripts/cinematic/render.mjs [--variant day|golden|night|all] [--tall] [--base http://localhost:8981] [--seconds 16] [--fps 30]
//                                     [--frames N (test: stop after N frames)] [--crf 20] [--webm] [--encode-only] [--keep-frames]
//
// --tall renders the upright-phone composition (titlePathTall, 1080x1920 from 2160x3840) to cold-open-<variant>-tall.mp4.
//
// Without --base it starts `wrangler dev --port 8981` itself (needs .dev.vars with DEV=1) and stops it afterwards.
// Frames go to .render/cinematic/frames/<variant>/%05d.png (WOG_WORK moves .render) and are deleted after a successful encode unless --keep-frames.
// One browser and one ffmpeg at a time.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d; };
const VARIANT = String(opt("variant", "all"));
const SECONDS = Number(opt("seconds", 16));
const FPS = Number(opt("fps", 30));
const LIMIT = Number(opt("frames", 0)) || 0;
const CRF = String(opt("crf", 20));
const WEBM = !!opt("webm", false);
const ENCODE_ONLY = !!opt("encode-only", false);
const KEEP = !!opt("keep-frames", false);
const PORT = 8981;
const WRANGLER = existsSync(join(ROOT, "node_modules", ".bin", "wrangler")) ? join(ROOT, "node_modules", ".bin", "wrangler") : "wrangler";
let BASE = opt("base", null);
const OUT_DIR = join(ROOT, "public", "video");
const WORK = join(process.env.WOG_WORK || join(ROOT, ".render"), "cinematic");
const TALL = !!opt("tall", false);
const W = TALL ? 1080 : 1920, H = TALL ? 1920 : 1080, DSF = 2;
const SUFFIX = TALL ? "-tall" : "";

// The realms the video is honest about: the tropical coast by day (sun ~35 deg, partly cloudy), the golden hour (sun 6.5 deg in the
// west, played at dusk and dawn so the hand-over to the live sunset sky is not a lighting step) and the bioluminescent night.
const VARIANTS = {
  day: { query: "realm=tropical-coast&phase=day&sun=35,70&weather=partly" },
  golden: { query: "realm=tropical-coast&phase=golden&sun=6.5,252&weather=partly" },
  night: { query: "realm=tropical-coast&phase=night&weather=clear" },
};

// ffmpeg with libx264: FFMPEG=/path/to/ffmpeg, else the one on PATH.
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

async function renderFrames(browser, variant, dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  const url = `${BASE}/dev/stage.html?ui=0&offline=1&quality=ultra&mode=title&${VARIANTS[variant].query}`;
  console.log(`[${variant}] ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => window.__ready === true && window.__progress >= 1, null, { timeout: 120000 });
  // the first frames compile programs and settle damped values; render a few silently before the clock starts
  await page.evaluate(() => { for (let i = 0; i < 3; i++) stage.step(0); });
  const info = await page.evaluate(() => { const i = stage.getInfo(); return { tier: i.tier, buffer: i.buffer, render: i.render, offline: stage.offline }; });
  console.log(`[${variant}] stage`, JSON.stringify(info));
  if (!info.offline || info.tier !== "ultra") throw new Error("stage is not in offline/ultra mode");
  const N = LIMIT || Math.round(SECONDS * FPS), dt = 1 / FPS;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    // step + read back in one task: the drawing buffer is only valid until the browser composites
    const b64 = await page.evaluate((dt) => { stage.step(dt); return document.getElementById("stage").toDataURL("image/png").slice(22); }, dt);
    writeFileSync(join(dir, String(i).padStart(5, "0") + ".png"), Buffer.from(b64, "base64"));
    if (i % 30 === 0 || i === N - 1) { const el = (Date.now() - t0) / 1000; console.log(`[${variant}] frame ${i + 1}/${N}  ${el.toFixed(0)} s  (${(el / (i + 1)).toFixed(2)} s/frame)`); }
  }
  const took = (Date.now() - t0) / 1000;
  await ctx.close();
  if (errs.length) console.log(`[${variant}] page errors:`, [...new Set(errs)].slice(0, 5));
  return { frames: N, seconds: took };
}

function encode(variant, dir) {
  mkdirSync(OUT_DIR, { recursive: true });
  const n = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
  if (!n) throw new Error("no frames in " + dir);
  const mp4 = join(OUT_DIR, `cold-open-${variant}${SUFFIX}.mp4`), jpg = join(OUT_DIR, `cold-open-${variant}${SUFFIX}.jpg`), webm = join(OUT_DIR, `cold-open-${variant}${SUFFIX}.webm`);
  const input = ["-framerate", String(FPS), "-i", join(dir, "%05d.png")];
  // lanczos down from 4K; a 2-pixel-aligned 1080p picture; the last frame is the hand-over to the live stage
  ff([...input, "-vf", `scale=${W}:${H}:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    "-movflags", "+faststart", "-an", mp4], `${variant}.mp4`);
  // poster: a frame two thirds in, where the headland has come round
  const posterFrame = Math.min(n - 1, Math.round(n * 0.66));
  ff(["-i", join(dir, String(posterFrame).padStart(5, "0") + ".png"), "-vf", `scale=${TALL ? "720:1280" : "1280:720"}:flags=lanczos`, "-q:v", "3", "-update", "1", "-frames:v", "1", jpg], `${variant}${SUFFIX}.jpg`);
  if (WEBM) ff([...input, "-vf", `scale=${W}:${H}:flags=lanczos`, "-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", webm], `${variant}.webm`);
  const mb = (p) => (existsSync(p) ? (statSync(p).size / 1048576).toFixed(2) + " MB" : "-");
  console.log(`[${variant}${SUFFIX}] ${mp4} ${mb(mp4)} · ${jpg} ${mb(jpg)}${WEBM ? ` · ${webm} ${mb(webm)}` : ""}`);
  if (statSync(mp4).size > 10 * 1048576) console.warn(`[${variant}] WARNING: mp4 is over 10 MB; raise --crf`);
}

async function main() {
  const variants = VARIANT === "all" ? Object.keys(VARIANTS) : VARIANT.split(",");
  for (const v of variants) if (!VARIANTS[v]) throw new Error("unknown variant " + v);
  let dev = null;
  if (!ENCODE_ONLY) {
    if (!BASE) {
      BASE = `http://localhost:${PORT}`;
      console.log(`starting wrangler dev on ${PORT}`);
      dev = spawn(WRANGLER, ["dev", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore", env: { ...process.env, WRANGLER_LOG: "error" }, detached: true });
    }
    await waitFor(`${BASE}/dev/stage.html`);
  }
  const report = {};
  try {
    const browser = ENCODE_ONLY ? null : await chromium.launch({ args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
    for (const v of variants) {
      const dir = join(WORK, "frames", v + SUFFIX);
      const r = ENCODE_ONLY ? { frames: readdirSync(dir).length, seconds: 0 } : await renderFrames(browser, v, dir);
      const t1 = Date.now();
      encode(v, dir);
      report[v] = { ...r, encodeSeconds: (Date.now() - t1) / 1000 };
      if (!KEEP && !LIMIT) rmSync(dir, { recursive: true, force: true });
    }
    await browser?.close();
  } finally {
    if (dev) { try { process.kill(-dev.pid, "SIGTERM"); } catch {} }
  }
  console.log(JSON.stringify(report, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
