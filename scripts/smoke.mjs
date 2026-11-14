// Loads every screen and panel on a local dev server with mock data; exits 1 on any uncaught page error.
//   node scripts/smoke.mjs http://localhost:8787      (npm i -D playwright; npx playwright install chromium)
if (!process.argv[2]) { console.error('usage: node scripts/smoke.mjs <base url of a running dev server>'); process.exit(2); }
import { chromium } from 'playwright';
const base = process.argv[2];
const routes = ['screen=select','screen=world','screen=world&panel=character','screen=world&panel=character&tab=wardrobe','screen=world&panel=character&tab=body','screen=world&panel=bags','screen=world&panel=quests','screen=world&panel=map','screen=world&panel=treasury','screen=world&panel=party','screen=world&panel=needs','screen=world&panel=chronicle','screen=world&panel=signals','screen=world&panel=share','overlay=1'];
const b = await chromium.launch({ args: [...(process.platform === "darwin" ? ["--use-angle=metal"] : []), "--enable-webgl", "--ignore-gpu-blocklist"] });
const errs = [];
for (const [tag, vp, extra] of [['d', { width: 1440, height: 900 }, {}], ['m', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]) {
  const ctx = await b.newContext({ viewport: vp, ...extra }); const p = await ctx.newPage();
  let cur = ''; p.on('pageerror', e => errs.push(`${tag} ${cur}: ${String(e).slice(0, 200)}`));
  for (const q of routes) { cur = q; const r = await p.goto(`${base}/?mock=1&${q}`, { waitUntil: 'load', timeout: 30000 }); if (!r || r.status() !== 200) errs.push(`${tag} ${q}: HTTP ${r && r.status()}`); await p.waitForTimeout(2500);
    if (!q.startsWith('overlay')) { const ok = await p.evaluate(() => !!document.querySelector('canvas') && document.body.innerText.length > 40); if (!ok) errs.push(`${tag} ${q}: page did not render`); } }
  await ctx.close();
}
await b.close();
if (errs.length) { console.log('SMOKE FAILED'); for (const e of [...new Set(errs)]) console.log('  ' + e); process.exit(1); }
console.log('smoke ok: ' + routes.length + ' routes x 2 sizes, no page errors');
