// Import Google SMOL (huggingface.co/datasets/google/smol, CC-BY 4.0) for Ga:
//
//   GATITOS  — 4,000 English → Ga words and phrases from professional
//              translators → word_alignments as SUGGESTIONS (status 'inferred',
//              source 'gatitos…'). Nothing reaches the checked dictionary until
//              an admin approves it on the console's Suggested words page.
//              Skipped: lone function words ("is", "a", "to"), and pairs the
//              checked dictionary already has.
//   SMOL sentences + documents → sentence pairs: datasets/ga-smol-sentences.jsonl
//              and the corpus_pairs table (lexical search, deduction), credited.
//
//   node scripts/import-smol.mjs <dir with gatitos_en_gaa.jsonl, smolsent_en_gaa.jsonl,
//        smoldoc_en_gaa.jsonl> <checked vocabulary rows (D1 --json)> <out.sql>
import fs from "node:fs";
import path from "node:path";

const [DIR, VOCAB, OUT] = process.argv.slice(2);
if (!OUT) { console.error("usage: import-smol.mjs <smol dir> <vocab.json> <out.sql>"); process.exit(1); }
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
// Same folding as corpus_pairs (scripts/backfill-corpus-d1.mjs) and the alignments table.
const fold = (s) => String(s || "").toLowerCase().replace(/ŋ/g, "n").replace(/ɛ/g, "e").replace(/ɔ/g, "o")
  .normalize("NFD").replace(/\p{M}/gu, "");
const key = (s) => fold(s).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const tidy = (s) => String(s || "").trim().replace(/\s+([.,?!:;])/g, "$1").replace(/\s+/g, " ");
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const CORPUS_SRC = "Google SMOL (CC-BY 4.0), huggingface.co/datasets/google/smol";
const ALIGN_SRC = "gatitos (Google SMOL, CC-BY 4.0)";

// ---- GATITOS → suggestions
const FUNCTION = new Set(("a an the i you he she it we they me him her us them my your his its our their this that these those " +
  "is are was were be been am do does did have has had will would can could shall should may might must " +
  "to of in on at by for with from as into onto than then so and or but if because while though although also " +
  "there here which who whom whose what when where why how not no yes oh ok okay").split(" "));
const vocab = JSON.parse(fs.readFileSync(VOCAB, "utf8"))[0].results;
const have = new Set();
for (const v of vocab) { let t = []; try { t = JSON.parse(v.translations || "[]"); } catch {} for (const e of t) have.add(`${key(e)}|${key(v.headword)}`); }
const haveEn = new Set([...have].map((p) => p.split("|")[0]));

const sql = [];
let suggested = 0, skippedFn = 0, skippedHave = 0;
const seenIds = new Set();
for (const g of read("gatitos_en_gaa.jsonl")) {
  const en = tidy(g.src);
  const words = key(en).split(" ").filter(Boolean);
  if (!words.length) continue;
  if (words.length === 1 && FUNCTION.has(words[0])) { skippedFn++; continue; }
  for (const raw of g.trgs || []) {
    const ga = tidy(raw);
    if (!ga) continue;
    if (have.has(`${key(en)}|${key(ga)}`)) { skippedHave++; continue; }
    const id = `wa:${key(en)}:${key(ga)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    // A new Ga rendering for an English the dictionary already has is worth a
    // look too; it's flagged in the note so the reviewer can compare.
    const note = haveEn.has(key(en)) ? [{ english: en, ga: "(the dictionary already has other Ga for this English)" }] : [];
    sql.push(`INSERT OR IGNORE INTO word_alignments (id, english_word, ga_word, english_normalized, ga_normalized, confidence, evidence_count, examples, status, source, created_at)
VALUES (${q(id)}, ${q(en)}, ${q(ga)}, ${q(key(en))}, ${q(key(ga))}, 0.95, 1, ${q(JSON.stringify(note))}, 'inferred', ${q(ALIGN_SRC)}, ${q(now)});`);
    suggested++;
  }
}

// ---- SMOL sentences + documents → sentence pairs
const pairs = [];
for (const s of read("smolsent_en_gaa.jsonl")) if (s.src && s.trg) pairs.push({ english: tidy(s.src), ga: tidy(s.trg), from: "smolsent" });
for (const d of read("smoldoc_en_gaa.jsonl")) {
  const n = Math.min((d.srcs || []).length, (d.trgs || []).length);
  for (let i = 0; i < n; i++) if (d.srcs[i] && d.trgs[i]) pairs.push({ english: tidy(d.srcs[i]), ga: tidy(d.trgs[i]), from: `smoldoc:${d.id}` });
}
const seenPairs = new Set();
const unique = pairs.filter((p) => { const k = key(p.english) + "|" + key(p.ga); if (seenPairs.has(k)) return false; seenPairs.add(k); return true; });
fs.writeFileSync("datasets/ga-smol-sentences.jsonl",
  unique.map((p) => JSON.stringify({ english: p.english, ga: p.ga, topic: "smol", source: CORPUS_SRC, ref: p.from })).join("\n") + "\n");
for (const p of unique) {
  sql.push(`INSERT INTO corpus_pairs (english, ga, en_norm, ga_norm, src) VALUES (${q(p.english)}, ${q(p.ga)}, ${q(fold(p.english))}, ${q(fold(p.ga))}, ${q(CORPUS_SRC)});`);
}
// Re-runnable: clear the previous SMOL rows first.
sql.unshift(`DELETE FROM corpus_pairs WHERE src = ${q(CORPUS_SRC)};`);
fs.writeFileSync(OUT, sql.join("\n") + "\n");
console.log(`GATITOS: ${suggested} suggestions (skipped ${skippedFn} function words, ${skippedHave} already in the dictionary)`);
console.log(`SMOL: ${unique.length} sentence pairs → datasets/ga-smol-sentences.jsonl and corpus_pairs`);
console.log(`${sql.length} SQL statements → ${OUT}`);
