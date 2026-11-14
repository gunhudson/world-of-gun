// Photo mode: a still of what is on the stage (the squad shot, a member on the dais, the world) at twice the screen,
// captioned with the wordmark and the date, then shared as a file where the device can (phones) or downloaded.
// Nothing leaves his device unless he picks a share target himself.
import { h } from "./dom.js";

const PAD = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;

async function caption(blob) {
  const bmp = await createImageBitmap(blob);
  const W = bmp.width, H = bmp.height;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); g.drawImage(bmp, 0, 0); bmp.close?.();
  const font = (getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "").trim() || 'Didot, "Bodoni 72", "Hoefler Text", serif';
  const px = Math.round(Math.min(W, H) * 0.026), m = Math.round(Math.min(W, H) * 0.045);
  try { await document.fonts.load(`400 ${px}px ${font}`); } catch {}
  const text = (str, size, x, y, align, track) => {
    g.save(); g.font = `400 ${size}px ${font}`; g.letterSpacing = `${track}em`; g.textAlign = align; g.textBaseline = "alphabetic";
    g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = size * 0.35; g.shadowOffsetY = size * 0.06;
    g.fillStyle = "rgba(255, 243, 214, 0.92)"; g.fillText(str, x, y); g.restore();
  };
  text("WORLD OF GUN", px, m, H - m, "left", 0.26);
  const d = new Date();
  text(d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase(), Math.round(px * 0.6), W - m, H - m, "right", 0.2);
  return { blob: await new Promise((res) => cv.toBlob(res, "image/png")), width: W, height: H };
}

// Returns { ok, how: "shared" | "saved" | "cancelled" | "failed", name, width, height }.
export async function takePhoto(app, kind = "world") {
  const raw = await app.stage.capture({ scale: 2 }).catch(() => null);
  if (!raw) return { ok: false, how: "failed" };
  const { blob, width, height } = await caption(raw);
  const name = `world-of-gun-${kind}-${isoDay(new Date())}.png`;
  const touch = matchMedia("(hover: none)").matches;
  if (touch && navigator.share && typeof File === "function") {
    try {
      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "World of Gun" }); return { ok: true, how: "shared", name, width, height }; }
    } catch (e) { if (e && e.name === "AbortError") return { ok: false, how: "cancelled", name }; }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name, style: { display: "none" } }); document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  return { ok: true, how: "saved", name, width, height };
}
