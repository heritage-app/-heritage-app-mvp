// Capture the real app (app.speakga.org) at laptop and tablet sizes, one image per screen,
// for the landing hero's tablet and laptop frames.
//   node scripts/capture-tour.mjs [outDir]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("C:/Users/pc/AppData/Local/Temp/claude/d--projects-work-projects--heritage-app-mvp-rag-cloudflare/30f0f322-4a2f-45d4-99ee-b46ff839f32e/scratchpad/snap/capture.js");
const puppeteer = require("puppeteer-core");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(HERE, "..", "public", "img", "tour");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://app.speakga.org";
const SIZES = { laptop: { width: 1280, height: 900 }, tablet: { width: 820, height: 1180 } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-first-run", "--hide-scrollbars"] });
  for (const [kind, vp] of Object.entries(SIZES)) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }]);
    // Light theme, and no install prompt over the screen.
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem("theme", "light"); localStorage.setItem("installDismissed", "1"); } catch {} });
    const shot = async (name) => {
      await wait(4000); // let the app's entrance fade finish so no ghost overlay is baked in
      await page.screenshot({ path: `${OUT}/${kind}-${name}.webp`, type: "webp", quality: 80 });
      console.log("saved", kind, name);
    };
    // Navigate via about:blank first so hash-only URL changes actually reload.
    const go = async (url) => {
      await page.goto("about:blank");
      await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 60000 });
      await wait(4500);
    };

    await go("/"); await shot("home");
    await go("/#/learn"); await shot("learn");
    await go("/#/library"); await wait(2500); await shot("library");
    // Ask: the real answer to the tour's question.
    await go("/?q=" + encodeURIComponent("how do you say good morning in Ga"));
    await page.waitForFunction(() => /Ojekoo/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
    await wait(2500); await shot("ask");
    // Teach: the app's Contribute form, filled in as on the phone.
    await go("/");
    const opened = await page.evaluate(() => { const b = document.querySelector('[data-action="contribute"]'); if (b) { b.click(); return true; } return false; });
    if (opened) {
      await wait(900);
      await page.type("#cfEnglish", "congratulations", { delay: 20 }).catch(() => {});
      await page.type("#cfGa", "Omanye", { delay: 20 }).catch(() => {});
      await shot("teach");
    } else console.log("teach: button not found for", kind);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
