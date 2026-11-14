// Screenshot the verify page with a headless browser (npm i -D playwright at the repository root).
//   [BROWSER=webkit] node scripts/shots.mjs <port> <outdir> "<name>|<query>|<w>x<h>" ...
import { chromium, webkit } from "playwright";
const [port, out, ...shots] = process.argv.slice(2);
// BROWSER=webkit runs the same shots in Playwright WebKit (Safari engine)
const browser = process.env.BROWSER === "webkit" ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
try {
  for (const s of shots) {
    const [name, query, size] = s.split("|");
    const [w, h] = (size || "900x1200").split("x").map(Number);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/character/verify/index.html?${query}`);
    await page.waitForFunction("window.__ready", null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}.png`, omitBackground: query.includes("bg=0") });
    if (name === shots[0].split("|")[0]) console.log(JSON.stringify(await page.evaluate("window.__info")));
    if (errs.length) console.log(name, "console errors:", errs.slice(0, 3));
    await page.close();
  }
} finally { await browser.close(); }
