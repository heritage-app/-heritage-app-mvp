/**
 * Realign Ga (GBV96) + KJV verse pairs by ordinal position.
 *
 * The crawler joined verses on (book, chapter, verse) — but GBV96 follows
 * Hebrew versification while KJV uses English numbering, so any divergence
 * produced silently wrong pairs (e.g. GBV96 Joel 3:1-5 = KJV Joel 2:28-32
 * was paired with KJV 3:1-5's English).
 *
 * Verse ORDER is identical between editions — only numbering differs — so
 * the nth Ga verse of a book correctly pairs with the nth KJV verse.
 * Record refs stay KJV-style (what users query); the Ga-side labels keep
 * GBV96's own numbering (Yitso/Kuku) for faithful display.
 *
 * Usage: node scripts/realign-bible.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "datasets");

/* Ga label helpers (same as fetch script) */
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

/* GBV96 chapters that exist under Hebrew numbering but weren't crawled
   (KJV chapter counts drove the walk). Key: USFM, value: [ch, verses]. */
const EXTRA_GA_CHAPTERS = { JOL: [[4, 21]] };

const files = readdirSync(DIR).filter((f) => /^ga-bible-.+\.jsonl$/.test(f) && f !== "ga-bible-books.jsonl");
let totalShifted = 0, totalVerse = 0;
const mismatched = [], unchanged = [];

for (const f of files) {
  const path = join(DIR, f);
  const records = readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
  const book = records[0].book;
  const usfm = records[0].id.match(/^bible:([a-z0-9]+):/)?.[1] ?? "";

  // G_seq: GBV96 verses in (ch, v) order. K_seq: KJV verses in (ch, v) order.
  const G = records.filter((r) => r.ga).map((r) => ({ ch: r.chapter_num, v: r.verse_num, ga: r.ga }));
  const K = records.filter((r) => r.en).map((r) => ({ ch: r.chapter_num, v: r.verse_num, en: r.en }));
  G.sort((a, b) => a.ch - b.ch || a.v - b.v);
  K.sort((a, b) => a.ch - b.ch || a.v - b.v);

  // Fetch GBV96 chapters the KJV-driven crawl missed.
  if (EXTRA_GA_CHAPTERS[usfm.toUpperCase()]) {
    for (const [ch] of EXTRA_GA_CHAPTERS[usfm.toUpperCase()]) {
      const r = await fetch(`https://events.bible.com/api/bible/chapter/3.1?id=2712&reference=${usfm.toUpperCase()}.${ch}`);
      const j = await r.json();
      if (j?.content) {
        const vs = parseVerses(j.content);
        for (const [v, ga] of vs) G.push({ ch, v, ga });
        G.sort((a, b) => a.ch - b.ch || a.v - b.v);
        console.log(`  + fetched GBV96 ${usfm.toUpperCase()}.${ch}: ${vs.size} verses`);
      }
    }
  }

  if (G.length !== K.length) {
    mismatched.push(`${f}: G=${G.length} K=${K.length} — NOT realigned`);
    continue;
  }

  const shifted = [];
  const out = K.map((k, i) => {
    const g = G[i];
    if (k.ch !== g.ch || k.v !== g.v) shifted.push(`${book} ${k.ch}:${k.v} <- GBV96 ${g.ch}:${g.v}`);
    const verseRef = `${book} ${k.ch}:${k.v}`;
    const chTitleGa = getGaChapterTitle(g.ch);
    const gaLabel = getGaLabel(g.v);
    return {
      id: `bible:${book.toLowerCase().replace(/\s+/g, "")}:${k.ch}:${k.v}`,
      category: "bible",
      book,
      traditional_book: records[0].traditional_book,
      chapter_num: k.ch,
      chapter_ref: `Chapter ${k.ch}`,
      chapter_title_ga: chTitleGa,
      chapter_title_en: `Chapter ${numToEn(k.ch)}`,
      verse_num: k.v,
      verse_ref: verseRef,
      ga_verse_label: gaLabel,
      reference_display: `${records[0].traditional_book}, ${chTitleGa}, ${gaLabel} (${verseRef})`,
      ga: g.ga,
      en: k.en,
      ga_version_name: "Ŋmãlẽ Kroṅkroṇ Le",
      ga_version_abbr: "GBV96",
      english_version_name: "King James Version",
      english_version_abbr: "KJV",
    };
  });

  writeFileSync(path, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  totalVerse += out.length;
  totalShifted += shifted.length;
  if (shifted.length) console.log(`${f}: realigned ${out.length} verses, ${shifted.length} shifted refs`);
  else unchanged.push(book);
  if (shifted.length) console.log("    e.g.", shifted.slice(0, 3).join(" | "));
}

console.log(`\nDONE: ${totalVerse} verses written, ${totalShifted} refs shifted.`);
if (unchanged.length) console.log(`already aligned: ${unchanged.join(", ")}`);
if (mismatched.length) console.log("!! COUNT MISMATCH (not realigned):\n  " + mismatched.join("\n  "));
