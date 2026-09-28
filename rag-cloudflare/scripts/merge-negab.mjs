/**
 * Enrich datasets-negab/*.jsonl (fetched text-only NEGAB verses) with the
 * English + label fields from datasets/ga-bible-*.jsonl (GBV96), aligned by
 * chapter:verse. Also scopes ids to `bible:{book}:{ch}:{v}:negab` so both
 * editions coexist in bible_verses / Vectorize.
 *
 * Usage: node scripts/merge-negab.mjs
 * Idempotent: rewrites the enriched fields each run.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEG_DIR = join(__dirname, "..", "datasets-negab");
const GBV_DIR = join(__dirname, "..", "datasets");

const UNITS = { 1:"ekome",2:"enyɔ",3:"etɛ",4:"ejwɛ",5:"enumɔ",6:"ekpaa",7:"kpawo",8:"kpaanyɔ",9:"nɛɛhu" };
const numToGa = (n) => {
  if (n <= 9) return UNITS[n] ?? String(n);
  if (n === 10) return "nyɔŋma";
  if (n <= 19) return `nyɔŋma kɛ ${UNITS[n - 10]}`;
  if (n === 100) return "oha";
  if (n % 10 === 0) return `nyɔŋmai ${UNITS[n / 10]}`;
  return `nyɔŋmai ${UNITS[Math.floor(n / 10)]} kɛ ${UNITS[n % 10]}`;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const numToEn = (n) => `Chapter ${n}`;

for (const fname of readdirSync(NEG_DIR).filter((f) => f.endsWith(".jsonl"))) {
  const gbvFile = join(GBV_DIR, fname);
  const gbv = new Map();
  try {
    for (const line of readFileSync(gbvFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      gbv.set(`${r.chapter_num}:${r.verse_num}`, r);
    }
  } catch { /* no GBV96 counterpart — keep NEGAB anyway */ }

  const out = [];
  for (const line of readFileSync(join(NEG_DIR, fname), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const key = `${r.chapter_num}:${r.verse_num}`;
    const g = gbv.get(key);

    const ch = r.chapter_num, v = r.verse_num;
    const gaLabel = `Kuku ni ji ${numToGa(v)}`;
    const chTitleGa = `Yitso ${cap(numToGa(ch))}`;
    out.push({
      ...r,
      id: `bible:${String(r.book).toLowerCase().replace(/\s+/g, "")}:${ch}:${v}:negab`,
      chapter_ref: `Chapter ${ch}`,
      chapter_title_ga: chTitleGa,
      chapter_title_en: numToEn(ch),
      section_ga: "",
      section_en: "",
      ga_verse_label: gaLabel,
      reference_display: `${r.traditional_book || g?.traditional_book || r.book}, ${chTitleGa}, ${gaLabel} (${r.book} ${ch}:${v})`,
      en: g?.en ?? "",
      english_version_name: "King James Version",
      english_version_abbr: "KJV",
      source_name: fname.replace(/\.jsonl$/, ""),
    });
  }
  writeFileSync(join(NEG_DIR, fname), out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const withEn = out.filter((r) => r.en).length;
  console.log(`${fname}: ${out.length} verses (${withEn} paired with KJV)`);
}
console.log("DONE");
