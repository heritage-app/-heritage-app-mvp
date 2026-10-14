// Ga words from PanLex (via ChiKhaPo, huggingface.co/datasets/ec5ug/chikhapo,
// MIT; PanLex data is CC0) → word_alignments as SUGGESTIONS (status 'inferred',
// source 'panlex…'). Nothing reaches the checked dictionary until an admin
// approves it on the console's Suggested words page (PanLex tab).
//
// Kept: words in ordinary Ga spelling (the phonetic-script entries — č, ǯ, š,
// ː… — are left out), with at most three English senses, that neither the
// dictionary nor the existing suggestions already have. Senses are joined with
// "; " — approving splits them into separate English entries.
//   node scripts/import-panlex.mjs <gaa_eng.jsonl> <vocabulary headwords (D1 --json)>
//        <alignment ga words (D1 --json)> <out.sql>
import fs from "node:fs";

const [LEX, VOCAB, ALIGN, OUT] = process.argv.slice(2);
if (!OUT) { console.error("usage: import-panlex.mjs <gaa_eng.jsonl> <vocab.json> <align.json> <out.sql>"); process.exit(1); }
// Same folding as the alignments table (scripts/import-smol.mjs).
const fold = (s) => String(s || "").toLowerCase().replace(/ŋ/g, "n").replace(/ɛ/g, "e").replace(/ɔ/g, "o")
  .normalize("NFD").replace(/\p{M}/gu, "");
const key = (s) => fold(s).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const SRC = "panlex (via ChiKhaPo; PanLex CC0)";
const PHONETIC = /[čǯšžʃʒːʷʼ…ʔ*_\/\\\d()[\]]/;

const rows = (f, col) => JSON.parse(fs.readFileSync(f, "utf8"))[0].results.map((r) => key(r[col]));
const have = new Set([...rows(VOCAB, "h"), ...rows(ALIGN, "g")]);
const now = new Date().toISOString();
const sql = [];
let phonetic = 0, many = 0, known = 0;
for (const line of fs.readFileSync(LEX, "utf8").trim().split("\n")) {
  const r = JSON.parse(line);
  const ga = String(r.source_word || "").trim().replace(/-$/, "");
  const senses = [...new Set((r.target_translations || []).map((t) => String(t).trim()).filter(Boolean))];
  if (!ga || !senses.length) continue;
  if (PHONETIC.test(ga)) { phonetic++; continue; }
  if (senses.length > 3) { many++; continue; }
  if (have.has(key(ga))) { known++; continue; }
  have.add(key(ga));
  const en = senses.join("; ");
  sql.push(`INSERT OR IGNORE INTO word_alignments (id, english_word, ga_word, english_normalized, ga_normalized, confidence, evidence_count, examples, status, source, created_at)
VALUES (${q(`wa:panlex:${key(ga)}`)}, ${q(en)}, ${q(ga)}, ${q(key(senses[0]))}, ${q(key(ga))}, 0.6, 1, '[]', 'inferred', ${q(SRC)}, ${q(now)});`);
}
fs.writeFileSync(OUT, sql.join("\n") + "\n");
console.log(`PanLex: ${sql.length} suggestions (left out ${phonetic} phonetic-script, ${many} with 4+ senses, ${known} already known) → ${OUT}`);
