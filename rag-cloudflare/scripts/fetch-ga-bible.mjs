/**
 * Crawl the Ga Bible (GBV96 — "Ŋmãlẽ Kroṅkroṇ Le", © Bible Society of Ghana
 * 1896/1992) + KJV English from YouVersion's public JSON chapter API and emit
 * structured bible JSONL datasets, one file per book:
 *   datasets/ga-bible-{Book}.jsonl   (filename contains "bible" → category bible)
 *
 * Usage:
 *   node scripts/fetch-ga-bible.mjs                 # all 66 books
 *   node scripts/fetch-ga-bible.mjs GEN EXO PSA     # named books only
 *   node scripts/fetch-ga-bible.mjs --from MAT      # resume from a book
 *
 * Re-runnable: books whose output file already exists are skipped.
 */
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "datasets");

const GA_VID = 2712;   // GBV96 — Ga (Bible Society of Ghana, 1896/1992)
const EN_VID = 1;      // KJV — public domain; matches engine defaults
const DELAY_MS = 300;
const RETRIES = 3;

const BOOKS = [
  ["GEN","Genesis",50],["EXO","Exodus",40],["LEV","Leviticus",27],["NUM","Numbers",36],
  ["DEU","Deuteronomy",34],["JOS","Joshua",24],["JDG","Judges",21],["RUT","Ruth",4],
  ["1SA","1 Samuel",31],["2SA","2 Samuel",24],["1KI","1 Kings",22],["2KI","2 Kings",25],
  ["1CH","1 Chronicles",29],["2CH","2 Chronicles",36],["EZR","Ezra",10],["NEH","Nehemiah",13],
  ["EST","Esther",10],["JOB","Job",42],["PSA","Psalms",150],["PRO","Proverbs",31],
  ["ECC","Ecclesiastes",12],["SNG","Song of Solomon",8],["ISA","Isaiah",66],["JER","Jeremiah",52],
  ["LAM","Lamentations",5],["EZK","Ezekiel",48],["DAN","Daniel",12],["HOS","Hosea",14],
  ["JOL","Joel",3],["AMO","Amos",9],["OBA","Obadiah",1],["JON","Jonah",4],
  ["MIC","Micah",7],["NAM","Nahum",3],["HAB","Habakkuk",3],["ZEP","Zephaniah",3],
  ["HAG","Haggai",2],["ZEC","Zechariah",14],["MAL","Malachi",4],
  ["MAT","Matthew",28],["MRK","Mark",16],["LUK","Luke",24],["JHN","John",21],
  ["ACT","Acts",28],["ROM","Romans",16],["1CO","1 Corinthians",16],["2CO","2 Corinthians",13],
  ["GAL","Galatians",6],["EPH","Ephesians",6],["PHP","Philippians",4],["COL","Colossians",4],
  ["1TH","1 Thessalonians",5],["2TH","2 Thessalonians",3],["1TI","1 Timothy",6],
  ["2TI","2 Timothy",4],["TIT","Titus",3],["PHM","Philemon",1],["HEB","Hebrews",13],
  ["JAS","James",5],["1PE","1 Peter",5],["2PE","2 Peter",3],["1JN","1 John",5],
  ["2JN","2 John",1],["3JN","3 John",1],["JUD","Jude",1],["REV","Revelation",22],
];

/* ---- Ga helpers (mirror src/rag/ga.ts numToGa/getGaLabel/getGaChapterTitle) ---- */
const UNITS = { 1:"ekome",2:"enyɔ",3:"etɛ",4:"ejwɛ",5:"enumɔ",6:"ekpaa",7:"kpawo",8:"kpaanyɔ",9:"nɛɛhu" };
function numToGa(n) {
  if (n <= 0) return String(n);
  if (n <= 9) return UNITS[n];
  if (n === 10) return "nyɔŋma";
  if (n <= 19) return `nyɔŋma kɛ ${UNITS[n - 10]}`;
  if (n % 10 === 0) {
    if (n < 100) return `nyɔŋmai ${UNITS[n / 10]}`;
    if (n === 100) return "oha";
  }
  if (n < 100) return `nyɔŋmai ${UNITS[Math.floor(n / 10)]} kɛ ${UNITS[n % 10]}`;
  return String(n);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function getGaLabel(n) { return `Kuku ni ji ${numToGa(n)}`; }
function getGaChapterTitle(n) { return `Yitso ${cap(numToGa(n))}`; }
const EN_UNITS = {1:"One",2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",8:"Eight",9:"Nine"};
const EN_TEENS = {11:"Eleven",12:"Twelve",13:"Thirteen",14:"Fourteen",15:"Fifteen",16:"Sixteen",17:"Seventeen",18:"Eighteen",19:"Nineteen"};
const EN_TENS = {10:"Ten",20:"Twenty",30:"Thirty",40:"Forty",50:"Fifty",60:"Sixty",70:"Seventy",80:"Eighty",90:"Ninety"};
function numToEn(n) {
  if (EN_UNITS[n]) return EN_UNITS[n];
  if (EN_TEENS[n]) return EN_TEENS[n];
  if (EN_TENS[n]) return EN_TENS[n];
  if (n < 100) return `${EN_TENS[Math.floor(n / 10) * 10]} ${EN_UNITS[n % 10]}`;
  return String(n);
}

/* ---- fetch + parse ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChapter(vid, usfm) {
  const url = `https://events.bible.com/api/bible/chapter/3.1?id=${vid}&reference=${usfm}`;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "HeritageArchiveBot/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.content) throw new Error("no content");
      return j;
    } catch (e) {
      if (attempt === RETRIES) { console.error(`  !! ${vid}/${usfm}: ${e.message}`); return null; }
      await sleep(1000 * attempt);
    }
  }
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Extract { verseNum -> text } from the API's chapter HTML. */
function parseVerses(html) {
  // Drop reference/heading blocks and footnote containers entirely.
  let h = html
    .replace(/<div class="[rs]\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<div class="ms\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<span class="rq">[\s\S]*?(?=<span class="verse |<\/div>)/g, "")
    .replace(/<span class="f"[\s\S]*?<\/span><\/span>/g, "")
    .replace(/<span class="label">\d+<\/span>/g, "");
  const out = new Map();
  const verseRe = /<span class="verse v(\d+)[^"]*"\s+data-usfm="[^"]+"[^>]*>([\s\S]*?)(?=<span class="verse |$)/g;
  let m;
  while ((m = verseRe.exec(h)) !== null) {
    const vNum = parseInt(m[1], 10);
    const parts = [];
    const contentRe = /<span class="content">([\s\S]*?)<\/span>/g;
    let cm;
    while ((cm = contentRe.exec(m[2])) !== null) {
      const t = decodeEntities(cm[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text && !out.has(vNum)) out.set(vNum, text);
  }
  return out;
}

/** Ga human title "1 Mose 1" -> traditional book "1 Mose". */
function tradBookFrom(human) {
  return (human || "").replace(/\s+\d+$/, "").trim();
}

async function fetchBook(usfm, enName, chapters) {
  const records = [];
  let tradBook = "";
  let chaptersWithContent = 0;
  for (let ch = 1; ch <= chapters; ch++) {
    const ref = `${usfm}.${ch}`;
    const [gaJ, enJ] = await Promise.all([fetchChapter(GA_VID, ref), fetchChapter(EN_VID, ref)]);
    if (!gaJ && !enJ) { console.error(`  ${ref}: both fetches failed`); continue; }
    if (gaJ && !tradBook) tradBook = tradBookFrom(gaJ.reference?.human);
    const gaV = gaJ ? parseVerses(gaJ.content) : new Map();
    const enV = enJ ? parseVerses(enJ.content) : new Map();
    const nums = [...new Set([...gaV.keys(), ...enV.keys()])].sort((a, b) => a - b);
    if (nums.length) chaptersWithContent++;
    for (const v of nums) {
      const verseRef = `${enName} ${ch}:${v}`;
      const chTitleGa = getGaChapterTitle(ch);
      const gaLabel = getGaLabel(v);
      records.push({
        id: `bible:${enName.toLowerCase().replace(/\s+/g, "")}:${ch}:${v}`,
        category: "bible",
        book: enName,
        traditional_book: tradBook,
        chapter_num: ch,
        chapter_ref: `Chapter ${ch}`,
        chapter_title_ga: chTitleGa,
        chapter_title_en: `Chapter ${numToEn(ch)}`,
        verse_num: v,
        verse_ref: verseRef,
        ga_verse_label: gaLabel,
        reference_display: `${tradBook}, ${chTitleGa}, ${gaLabel} (${verseRef})`,
        ga: gaV.get(v) ?? "",
        en: enV.get(v) ?? "",
        ga_version_name: "Ŋmãlẽ Kroṅkroṇ Le",
        ga_version_abbr: "GBV96",
        english_version_name: "King James Version",
        english_version_abbr: "KJV",
      });
    }
    process.stdout.write(`\r  ${usfm}.${ch} — ${nums.length} verses   `);
    await sleep(DELAY_MS);
  }
  console.log(`\n  ${enName}: ${records.length} verses across ${chaptersWithContent}/${chapters} chapters`);
  return records;
}

/* ---- main ---- */
const args = process.argv.slice(2);
let books = BOOKS;
if (args[0] === "--from") {
  const i = BOOKS.findIndex(([u]) => u === args[1]);
  books = BOOKS.slice(Math.max(0, i));
} else if (args.length) {
  books = BOOKS.filter(([u]) => args.includes(u));
}
if (!books.length) { console.error("No matching books."); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
let total = 0, done = 0;
for (const [usfm, enName, chapters] of books) {
  const file = join(OUT_DIR, `ga-bible-${enName.toLowerCase().replace(/\s+/g, "-")}.jsonl`);
  if (existsSync(file)) { console.log(`skip ${enName} (exists)`); continue; }
  console.log(`\n=== ${enName} (${usfm}, ${chapters} ch) ===`);
  const records = await fetchBook(usfm, enName, chapters);
  if (records.length) {
    writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    total += records.length; done++;
    console.log(`  -> ${file}`);
  } else {
    console.log(`  !! no records for ${enName} — book may not exist in GBV96`);
  }
}
console.log(`\nDONE: ${done} books, ${total} verses`);
