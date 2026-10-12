// Build the GhanaNLP 400k curated slice into archive JSONL chunks.
// Input:  %TEMP%/eng-ga-clean.jsonl  ({eng, ga} per line — already filtered)
// Output: datasets/ga-corpus-NN.jsonl ({english, ga, topic, source})
// Dedupes English against every existing dataset + the local Bible files.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "GhanaNLP Community English-Ga Sentence Pairs 400k (CC-BY-NC-4.0), huggingface.co/datasets/ghananlpcommunity/english-ga-sentence-pairs-400k";
const fold = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const seen = new Set();
for (const f of readdirSync("datasets")) {
  if (!f.endsWith(".jsonl")) continue;
  for (const line of readFileSync(join("datasets", f), "utf8").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const r = JSON.parse(t);
      const en = r.english ?? r.en ?? "";
      if (en) seen.add(fold(en));
    } catch {}
  }
}
console.log(`existing english keys: ${seen.size}`);

const CHUNK = 9500;
const rows = [];
let dups = 0;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  const t = line.trim();
  if (!t) continue;
  const { eng, ga } = JSON.parse(t);
  if (!eng || !ga) continue;
  if (seen.has(fold(eng))) { dups++; continue; }
  seen.add(fold(eng)); // dedupe within the corpus too
  rows.push({ english: eng, ga, topic: "sentences", source: SRC });
}
console.log(`kept ${rows.length}, skipped ${dups} dups`);

let i = 0, part = 0;
while (i < rows.length) {
  part++;
  const slice = rows.slice(i, i + CHUNK);
  const name = `datasets/ga-corpus-${String(part).padStart(2, "0")}.jsonl`;
  writeFileSync(name, slice.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${name}: ${slice.length} records`);
  i += CHUNK;
}
