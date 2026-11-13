// Reproducible README screenshots. Run `npm run dev` in another terminal, then `npm run screenshots`.
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const base = process.env.BASE || "http://localhost:5174/";
const out = process.env.OUT || "docs";
const browser = await chromium.launch();
const errors = [];
async function shot(name, url, { device, viewport = { width: 1440, height: 1000 }, full = false, clip } = {}) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await (clip ? page.locator(clip) : page).screenshot({ path: `${out}/${name}.png`, fullPage: full && !clip });
  await ctx.close();
}
await shot("overview", "", { viewport: { width: 1440, height: 1060 } });
await shot("message-detail", "?select=m03", { clip: ".work" });
await shot("try-it", "?own", { clip: ".work" });
await shot("review-queue", "?filter=review&select=m05", { clip: ".work" });
await shot("crm-table", "", { clip: "#crm-section" });
await shot("accuracy", "", { clip: "#accuracy" });
await shot("mobile", "?select=m03", { device: "iPhone 13", full: true });
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("no console errors");
