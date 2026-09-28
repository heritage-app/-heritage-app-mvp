/**
 * Realign the 9 GBV96/KJV books with verse-count mismatches.
 *
 * Verified causes (checked against actual verse text):
 *  - psalms: GBV96 numbers each psalm's superscription as v.1 (occasionally
 *    v.1-2, e.g. Ps.51) → leading extras are emitted as title records.
 *  - joel: GBV96 has 4 chapters (Hebrew); JOL.4 was missed by the crawl →
 *    refetched here, then pure ordinal.
 *  - mid-chapter splits (GBV96 splits one KJV verse into two):
 *    1Ki 22:44, 1Sa 21:16, 3Jn 1:15, Rev 12:18 → emitted as ga-only records.
 *  - KJV-extra verses: Acts 19:41, 2Co 13:14 → en-only records.
 *  - isa 64:1: its Ga lives inside GBV96 63:19b (half-verse split) → en-only.
 *
 * Usage: node scripts/realign-mismatched.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "datasets");

const UNITS = { 1:"ekome",2:"enyɔ",3:"etɛ",4:"ejwɛ",5:"enumɔ",6:"ekpaa",7:"kpawo",8:"kpaanyɔ",9:"nɛɛhu" };
function numToGa(n) {
  if (n <= 0) return String(n);
  if (n <= 9) return UNITS[n];
  if (n === 10) return "nyɔŋma";
  if (n <= 19) return `nyɔŋma kɛ ${UNITS[n - 10]}`;
  if (n % 10 === 0) return n < 100 ? `nyɔŋmai ${UNITS[n / 10]}` : "oha";
  if (n < 100) return `nyɔŋmai ${UNITS[Math.floor(n / 10)]} kɛ ${UNITS[n % 10]}`;
  return String(n);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const getGaLabel = (n) => `Kuku ni ji ${numToGa(n)}`;
const getGaChapterTitle = (n) => `Yitso ${cap(numToGa(n))}`;
const EN_UNITS = {1:"One",2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",8:"Eight",9:"Nine"};
const EN_TEENS = {11:"Eleven",12:"Twelve",13:"Thirteen",14:"Fourteen",15:"Fifteen",16:"Sixteen",17:"Seventeen",18:"Eighteen",19:"Nineteen"};
const EN_TENS = {10:"Ten",20:"Twenty",30:"Thirty",40:"Forty",50:"Fifty",60:"Sixty",70:"Seventy",80:"Eighty",90:"Ninety"};
function numToEn(n) {
  if (EN_UNITS[n]) return EN_UNITS[n];
  if (EN_TEENS[n]) return EN_TEENS[n];
  if (EN_TENS[n]) return EN_TENS[n];
  return `${EN_TENS[Math.floor(n / 10) * 10]} ${EN_UNITS[n % 10]}`;
}
function decodeEntities(s) {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function parseVerses(html) {
  let h = html
    .replace(/<div class="[rs]\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<div class="ms\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<span class="rq">[\s\S]*?(?=<span class="verse |<\/div>)/g, "")
    .replace(/<span class="label">\d+<\/span>/g, "");
  const out = new Map();
  const re = /<span class="verse v(\d+)[^"]*"\s+data-usfm="[^"]+"[^>]*>([\s\S]*?)(?=<span class="verse |$)/g;
  let m;
  while ((m = re.exec(h))) {
    const parts = [];
    const cr = /<span class="content">([\s\S]*?)<\/span>/g;
    let cm;
    while ((cm = cr.exec(m[2]))) {
      const t = decodeEntities(cm[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    const t = parts.join(" ").trim();
    if (t && !out.has(+m[1])) out.set(+m[1], t);
  }
  return out;
}

/* GBV96 splits a KJV verse in two → emit the Ga-only extra as its own record */
const GA_EXTRA = {
  "1-kings":       [[22, 44]],
  "1-samuel":      [[21, 16]],
  "3-john":        [[1, 15]],
  "revelation":    [[12, 18]],
};
/* KJV has a verse GBV96 folds elsewhere → emit en-only */
const K_EXTRA = {
  "acts":          [[19, 41]],
  "2-corinthians": [[13, 14]],
  "isaiah":        [[64, 1]],
};
/* GBV96 chapters the KJV-driven crawl missed entirely */
const EXTRA_GA_FETCH = {
  "joel": [{ usfm: "JOL", ch: 4 }],
};

const isExtra = (list, ch, v) => (list || []).some(([c, x]) => c === ch && x === v);

function makeRecord(book, trad, kCh, kV, gCh, gV, ga, en, extra) {
  const verseRef = `${book} ${kCh}:${kV}`;
  const chTitleGa = getGaChapterTitle(gCh ?? kCh);
  const gaLabel = getGaLabel(gV ?? kV);
  return {
    id: `bible:${book.toLowerCase().replace(/\s+/g, "")}:${kCh}:${kV}${extra ? ":" + extra : ""}`,
    category: "bible",
    book,
    traditional_book: trad,
    chapter_num: kCh,
    chapter_ref: `Chapter ${kCh}`,
    chapter_title_ga: chTitleGa,
    chapter_title_en: `Chapter ${numToEn(kCh)}`,
    verse_num: kV,
    verse_ref: verseRef,
    ga_verse_label: gaLabel,
    reference_display: `${trad}, ${chTitleGa}, ${gaLabel} (${verseRef})`,
    ga: ga || "",
    en: en || "",
  };
}

const ONLY = process.argv[2]; // pass a book slug to process just one book
for (const slug of Object.keys({ ...GA_EXTRA, ...K_EXTRA, ...EXTRA_GA_FETCH, psalms: 1 })) {
  if (ONLY && slug !== ONLY) continue;
  const file = join(DIR, `ga-bible-${slug}.jsonl`);
  const records = readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  const book = records[0].book;
  const trad = records[0].traditional_book;
  const G = [], K = [];
  for (const r of records) {
    if (r.ga) G.push({ ch: r.chapter_num, v: r.verse_num, ga: r.ga });
    if (r.en) K.push({ ch: r.chapter_num, v: r.verse_num, en: r.en });
  }
  G.sort((a, b) => a.ch - b.ch || a.v - b.v);
  K.sort((a, b) => a.ch - b.ch || a.v - b.v);

  const out = [];

  if (slug === "psalms") {
    /* Chapter-wise: leading (lenG-lenK) GBV96 verses are psalm titles. */
    const byCh = new Set([...G.map((x) => x.ch), ...K.map((x) => x.ch)]);
    let titles = 0;
    for (const ch of [...byCh].sort((a, b) => a - b)) {
      const gCh = G.filter((x) => x.ch === ch), kCh = K.filter((x) => x.ch === ch);
      const d = gCh.length - kCh.length;
      if (d > 0) {
        for (let t = 0; t < d; t++) {
          out.push({ ...makeRecord(book, trad, ch, 0, ch, gCh[t].v, gCh[t].ga, "", `t${t + 1}`), ga_verse_label: "Title" });
          titles++;
        }
      }
      for (let i = 0; i < kCh.length; i++) {
        const g = gCh[i + Math.max(0, d)];
        out.push(makeRecord(book, trad, ch, kCh[i].v, g?.ch ?? ch, g?.v ?? kCh[i].v, g?.ga ?? "", kCh[i].en));
      }
    }
    console.log(`${slug}: ${K.length} verses + ${titles} title records`);
  } else {
    /* Fetch any GBV96 chapters missed by the KJV-driven crawl. */
    for (const { usfm, ch } of EXTRA_GA_FETCH[slug] || []) {
      const r = await fetch(`https://events.bible.com/api/bible/chapter/3.1?id=2712&reference=${usfm}.${ch}`);
      const j = await r.json();
      if (j?.content) {
        const vs = parseVerses(j.content);
        for (const [v, ga] of vs) G.push({ ch, v, ga });
        G.sort((a, b) => a.ch - b.ch || a.v - b.v);
        console.log(`  + GBV96 ${usfm}.${ch}: ${vs.size} verses`);
      }
    }
    const gaSkip = new Set(), kSkip = new Set();
    for (const g of G) if (isExtra(GA_EXTRA[slug], g.ch, g.v)) {
      gaSkip.add(g);
      out.push({ ...makeRecord(book, trad, g.ch, g.v, g.ch, g.v, g.ga, "", "ga"), en: "" });
    }
    for (const k of K) if (isExtra(K_EXTRA[slug], k.ch, k.v)) {
      kSkip.add(k);
      out.push({ ...makeRecord(book, trad, k.ch, k.v, k.ch, k.v, "", k.en, "en"), ga: "" });
    }
    const G2 = G.filter((g) => !gaSkip.has(g)), K2 = K.filter((k) => !kSkip.has(k));
    if (G2.length !== K2.length) { console.log(`${slug}: STILL MISMATCH G=${G2.length} K=${K2.length} — skipped`); continue; }
    let shifted = 0;
    for (let i = 0; i < K2.length; i++) {
      const k = K2[i], g = G2[i];
      if (k.ch !== g.ch || k.v !== g.v) shifted++;
      out.push(makeRecord(book, trad, k.ch, k.v, g.ch, g.v, g.ga, k.en));
    }
    console.log(`${slug}: realigned ${K2.length} pairs (${shifted} shifted) + ${gaSkip.size} ga-only + ${kSkip.size} en-only`);
  }

  out.sort((a, b) => a.chapter_num - b.chapter_num || a.verse_num - b.verse_num || String(a.id).localeCompare(String(b.id)));
  writeFileSync(file, out.map((r) => JSON.stringify({ ...r, ga_version_name: "Ŋmãlẽ Kroṅkroṇ Le", ga_version_abbr: "GBV96", english_version_name: "King James Version", english_version_abbr: "KJV" })).join("\n") + "\n", "utf8");
}
console.log("DONE");
