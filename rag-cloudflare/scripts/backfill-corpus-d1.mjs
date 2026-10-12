// Backfill the corpus_pairs D1 table — the lexical backstop for the bulk
// sentence corpus (see schema.sql). Reads every corpus JSONL, normalizes
// en/ga for folded LIKE matching, and emits chunked INSERT files under
// tmp/corpus-d1/. Then run:
//   for f in tmp/corpus-d1/*.sql; do npx wrangler d1 execute heritage-db --remote --file "$f"; done
// Re-run (it deletes and rebuilds) after any new corpus upload.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const FILES = readdirSync("datasets").filter(
  (f) => f.startsWith("ga-corpus-") || f.startsWith("ga-farmer-qa-") || f === "ga-parallel-text.jsonl"
);

// foldGa() without modernizeGa — these corpora carry no legacy-orthography
// characters (verified: zero š/ſ/ṅ/ṇ/ẹ/ọ/̱/̣ in the datasets).
const fold = (s) =>
  s
    .toLowerCase()
    .replace(/ŋ/g, "n")
    .replace(/ɛ/g, "e")
    .replace(/ɔ/g, "o")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

// Same display tidy as the chat path: stray quotes and pre-punctuation
// spaces in the source are display noise, and an unbalanced quote marks a
// truncated source row — drop those entirely.
const tidy = (s) =>
  s.trim()
    .replace(/\s+([.,?!:;])/g, "$1")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .trim();
const balanced = (s) => (s.match(/"/g) ?? []).length % 2 === 0;

const sqlStr = (s) => `'${s.replace(/'/g, "''")}'`;

const rows = [];
let dropped = 0;
const seen = new Set();
for (const file of FILES) {
  for (const line of readFileSync(`datasets/${file}`, "utf8").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    const en = tidy(String(rec.english ?? rec.en ?? ""));
    const ga = tidy(String(rec.ga ?? ""));
    if (!en || !ga || !balanced(en) || !balanced(ga)) { dropped++; continue; }
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ en, ga, enN: fold(en), gaN: fold(ga), src: String(rec.source ?? file) });
  }
}
console.log("rows:", rows.length, "dropped:", dropped);

mkdirSync("tmp/corpus-d1", { recursive: true });
const BATCH = 50;  // rows per INSERT (D1 rejects oversized statements)
const PER_FILE = 5000; // rows per wrangler call
let fileIdx = 0, stmts = [];
for (let i = 0; i < rows.length; i += BATCH) {
  const vals = rows
    .slice(i, i + BATCH)
    .map((r) => `(${sqlStr(r.en)},${sqlStr(r.ga)},${sqlStr(r.enN)},${sqlStr(r.gaN)},${sqlStr(r.src)})`)
    .join(",");
  stmts.push(`INSERT INTO corpus_pairs (english,ga,en_norm,ga_norm,src) VALUES${vals};`);
  if (stmts.length * BATCH >= PER_FILE) {
    writeFileSync(`tmp/corpus-d1/part-${String(++fileIdx).padStart(2, "0")}.sql`, stmts.join("\n"));
    stmts = [];
  }
}
if (stmts.length)
  writeFileSync(`tmp/corpus-d1/part-${String(++fileIdx).padStart(2, "0")}.sql`, stmts.join("\n"));
console.log("files:", fileIdx);
