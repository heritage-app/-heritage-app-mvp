/**
 * Fetch NEGAB (Ŋmalɛ Krɔŋkrɔŋ Lɛ, Bible.com version 2708 — modern Ga orthography)
 * into datasets-negab/ga-bible-{book}.jsonl, same shape as datasets/ (GBV96),
 * then diff against the GBV96 datasets to report verse coverage + text distance.
 *
 * Usage:
 *   node scripts/fetch-negab.mjs                # all books
 *   node scripts/fetch-negab.mjs GEN PSA        # named books
 *   node scripts/fetch-negab.mjs --compare-only # skip fetch, just diff
 */
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "datasets-negab");
const GBV_DIR = join(__dirname, "..", "datasets");

const NEGAB_VID = 2708;
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
const getGaLabel = (n) => `Kuku ni ji ${numToGa(n)}`;
const getGaChapterTitle = (n) => `Yitso ${cap(numToGa(n))}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChapter(usfm) {
  const url = `https://events.bible.com/api/bible/chapter/3.1?id=${NEGAB_VID}&reference=${usfm}`;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "HeritageArchiveBot/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.content) throw new Error("no content");
      return j;
    } catch (e) {
      if (attempt === RETRIES) { console.error(`  !! ${usfm}: ${e.message}`); return null; }
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

/** NEGAB markup: notes are <span class="note x|f">, headings in .s1/.s2/.ms divs. */
function parseVerses(html) {
  let h = html
    .replace(/<div class="[rs]\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<div class="ms\w*">[\s\S]*?<\/div>/g, "")
    .replace(/<span class="note [\s\S]*?<\/span><\/span>/g, "")
    .replace(/<span class="label">\d+<\/span>/g, "")
    .replace(/<span class="label">#<\/span>/g, "");
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

async function fetchBook(usfm, enName, chapters) {
  const records = [];
  let tradBook = "";
  for (let ch = 1; ch <= chapters; ch++) {
    const j = await fetchChapter(`${usfm}.${ch}`);
    if (!j) continue;
    if (!tradBook) tradBook = (j.reference?.human || "").replace(/\s+\d+$/, "").trim();
    const v = parseVerses(j.content);
    for (const [num, text] of [...v.entries()].sort((a, b) => a[0] - b[0])) {
      records.push({
        id: `bible:${enName.toLowerCase().replace(/\s+/g, "")}:${ch}:${num}`,
        category: "bible",
        book: enName,
        traditional_book: tradBook,
        chapter_num: ch,
        verse_num: num,
        verse_ref: `${enName} ${ch}:${num}`,
        reference_display: `${tradBook}, ${getGaChapterTitle(ch)}, ${getGaLabel(num)} (${enName} ${ch}:${num})`,
        ga: text,
        ga_version_name: "Ŋmalɛ Krɔŋkrɔŋ Lɛ",
        ga_version_abbr: "NEGAB",
      });
    }
    process.stdout.write(`\r  ${usfm}.${ch} — ${v.size} verses   `);
    await sleep(DELAY_MS);
  }
  console.log(`\n  ${enName}: ${records.length} verses`);
  return records;
}

/* ---------- comparison ---------- */
const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zŋɛɔ ]/g, " ").replace(/\s+/g, " ").trim();

function levRatio(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 1;
  const dp = Array.from({ length: la + 1 }, (_, i) => [i, ...Array(lb).fill(0)]);
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[la][lb] / Math.max(la, lb);
}

function compare(bookSlug) {
  const gbvFile = join(GBV_DIR, `ga-bible-${bookSlug}.jsonl`);
  const negFile = join(OUT_DIR, `ga-bible-${bookSlug}.jsonl`);
  if (!existsSync(negFile)) return null;
  const gbv = new Map();
  if (existsSync(gbvFile)) {
    for (const line of readFileSync(gbvFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      gbv.set(`${r.chapter_num}:${r.verse_num}`, r.ga);
    }
  }
  let total = 0, exact = 0, close = 0, missing = 0, sum = 0;
  const diffs = [];
  for (const line of readFileSync(negFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    total++;
    const old = gbv.get(`${r.chapter_num}:${r.verse_num}`);
    if (old === undefined) { missing++; continue; }
    const a = norm(old), b = norm(r.ga);
    const d = levRatio(a, b);
    sum += d;
    if (d === 0) exact++;
    else if (d < 0.15) close++;
    if (diffs.length < 3 && d > 0.15 && d < 0.6) {
      diffs.push(`    ${r.chapter_num}:${r.verse_num}  GBV96: ${old.slice(0,80)}\n           NEGAB: ${r.ga.slice(0,80)}`);
    }
  }
  return { total, exact, close, missing, avg: total ? sum / total : 0, diffs };
}

/* ---------- main ---------- */
const args = process.argv.slice(2);
const compareOnly = args[0] === "--compare-only";
let books = BOOKS;
if (!compareOnly && args.length) books = BOOKS.filter(([u]) => args.includes(u));

mkdirSync(OUT_DIR, { recursive: true });
if (!compareOnly) {
  for (const [usfm, enName, chapters] of books) {
    const slug = enName.toLowerCase().replace(/\s+/g, "-");
    const file = join(OUT_DIR, `ga-bible-${slug}.jsonl`);
    if (existsSync(file)) { console.log(`skip ${enName}`); continue; }
    console.log(`\n=== ${enName} (${usfm}) ===`);
    const records = await fetchBook(usfm, enName, chapters);
    if (records.length) writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
}

console.log("\n=== GBV96 vs NEGAB comparison ===");
let tot = { total: 0, exact: 0, close: 0, missing: 0, sum: 0 };
for (const [, enName] of BOOKS) {
  const slug = enName.toLowerCase().replace(/\s+/g, "-");
  const c = compare(slug);
  if (!c) continue;
  tot.total += c.total; tot.exact += c.exact; tot.close += c.close;
  tot.missing += c.missing; tot.sum += c.avg * c.total;
  console.log(`${enName.padEnd(18)} ${String(c.total).padStart(5)}v  exact:${c.exact} close:${c.close} missing:${c.missing} avgDist:${c.avg.toFixed(2)}`);
  for (const d of c.diffs) console.log(d);
}
if (tot.total) {
  console.log(`\nTOTAL: ${tot.total} NEGAB verses | identical(after-fold): ${tot.exact} | close(<15%): ${tot.close} | missing-in-GBV96: ${tot.missing} | avg edit distance: ${(tot.sum / tot.total).toFixed(2)}`);
}
