// Phrase deduction by consensus: for an English phrase that appears in several corpus sentences,
// the Ga phrase most of their translations share is very likely its Ga. ("I am happy" appears in
// many sentences; most of their Ga contains "miyɛ miishɛɛ".)
//
// Rules that keep it honest:
//  - at least MIN_SUPPORT sentences must contain the English phrase;
//  - the Ga phrase must be in at least half of them;
//  - it must be specific to them: far more common there than in the corpus as a whole
//    (so filler like "lɛ", "ni", "akɛ" never wins);
//  - among near-equal candidates the longer one wins ("miyɛ miishɛɛ" over "miishɛɛ"),
//    unless the longer one is much rarer.
//
// The app does the same at answer time over corpus_pairs (src/rag/deduce.ts); this is the
// offline tool for trying phrases against the local corpus:
//   node scripts/build-phrase-alignments.mjs datasets --try "i am happy" "computer"
import fs from "node:fs";
import path from "node:path";

const [dir, ...rest] = process.argv.slice(2);
const tryIdx = rest.indexOf("--try");
const tryPhrases = tryIdx >= 0 ? rest.slice(tryIdx + 1) : null;

const MIN_SUPPORT = 3, MAX_N_EN = 4, MAX_N_GA = 4, MIN_SHARE = 0.5, MIN_LIFT = 8;
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ɛ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "n");
const toks = (s) => (s.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).map((t) => t.replace(/’/g, "'"));
const STOP = new Set("the a an of to and or but in on at by for with from as is are was were be been am i you he she it we they me him her us them my your his its our their this that these those do does did not no so if then than there here what who which when where why how will would can could shall should may might must have has had just very also".split(" "));

// Load the corpus (sentence pairs).
const pairs = [];
for (const f of fs.readdirSync(dir).filter((f) => /^ga-corpus-\d+\.jsonl$/.test(f)).sort()) {
  for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.english && r.ga) pairs.push({ en: String(r.english), ga: String(r.ga) });
    } catch { /* skip */ }
  }
}
const enToks = pairs.map((p) => toks(p.en));
const gaToks = pairs.map((p) => toks(p.ga));
const gaFold = gaToks.map((t) => t.map(fold));
console.error(`${pairs.length} sentence pairs`);

// Background: how many sentences contain each Ga n-gram (folded).
const gaDf = new Map();
gaFold.forEach((t) => {
  const seen = new Set();
  for (let n = 1; n <= MAX_N_GA; n++) for (let i = 0; i + n <= t.length; i++) seen.add(t.slice(i, i + n).join(" "));
  for (const g of seen) gaDf.set(g, (gaDf.get(g) || 0) + 1);
});

function deduce(phrase, ids) {
  // Ga n-grams shared by the sentences that contain the English phrase.
  const count = new Map(), surface = new Map();
  for (const id of ids) {
    const t = gaFold[id], orig = gaToks[id], seen = new Set();
    for (let n = 1; n <= MAX_N_GA; n++) for (let i = 0; i + n <= t.length; i++) {
      const k = t.slice(i, i + n).join(" ");
      if (seen.has(k)) continue; seen.add(k);
      count.set(k, (count.get(k) || 0) + 1);
      const s = orig.slice(i, i + n).join(" "), m = surface.get(k) || new Map();
      m.set(s, (m.get(s) || 0) + 1); surface.set(k, m);
    }
  }
  const N = ids.length, total = pairs.length;
  const cands = [];
  for (const [k, c] of count) {
    const share = c / N;
    if (c < MIN_SUPPORT || share < MIN_SHARE) continue;
    const lift = share / ((gaDf.get(k) || 1) / total);
    // Two-letter Ga words ("nu", water) are often filler too ("ni", "lɛ"): only when very specific.
    if (k.split(" ").every((w) => w.length < 3) && lift < 40) continue;
    if (lift < MIN_LIFT) continue;
    cands.push({ k, c, share, lift, n: k.split(" ").length });
  }
  if (!cands.length) return null;
  // Best share first; a longer phrase wins when its share is close (>= 85% of the best's).
  cands.sort((a, b) => b.share - a.share || b.n - a.n);
  let best = cands[0];
  for (const c of cands) if (c.n > best.n && c.share >= best.share * 0.85 && c.k.includes(best.k)) best = c;
  const top = (k) => [...surface.get(k)].sort((a, b) => b[1] - a[1])[0][0].replace(/^./, (ch) => ch.toUpperCase());
  const ga = top(best.k);
  // Multi-word English: the fuller Ga phrase around the core word, when enough sentences share it
  // ("i am happy" → core "miishɛɛ", phrase "Miyɛ miishɛɛ").
  let phraseGa = null, phraseSupport = 0;
  if (phrase.trim().split(/\s+/).length > 1) {
    for (const [k, c] of count) {
      if (k === best.k ||!` ${k} `.includes(` ${best.k} `) || c < MIN_SUPPORT || c / N < 0.3) continue;
      if (c > phraseSupport || (c === phraseSupport && k.length > (phraseGa || "").length)) { phraseGa = k; phraseSupport = c; }
    }
  }
  const examples = ids.filter((id) => ` ${gaFold[id].join(" ")} `.includes(` ${phraseGa || best.k} `)).slice(0, 3).map((id) => pairs[id]);
  return {
    english: phrase, ga, support: best.c, total: N, share: +best.share.toFixed(2), lift: Math.round(best.lift),
    ...(phraseGa ? { phrase_ga: top(phraseGa), phrase_support: phraseSupport } : {}), examples,
  };
}

function idsFor(phrase) {
  const q = toks(phrase), out = [];
  for (let id = 0; id < enToks.length; id++) {
    const t = enToks[id];
    for (let i = 0; i + q.length <= t.length; i++) if (q.every((w, j) => t[i + j] === w)) { out.push(id); break; }
  }
  return out;
}

if (!tryPhrases) { console.error("usage: build-phrase-alignments.mjs <datasets dir> --try <phrase…>"); process.exit(1); }
{
  for (const p of tryPhrases) {
    const ids = idsFor(p);
    const r = ids.length >= MIN_SUPPORT ? deduce(p, ids) : null;
    console.log(`\n"${p}": ${ids.length} sentences →`, r ? `${r.ga}  (${r.support}/${r.total}, share ${r.share}, lift ${r.lift})${r.phrase_ga ? `  · phrase: ${r.phrase_ga} (${r.phrase_support})` : ""}` : "no confident deduction");
    if (r) r.examples.forEach((e) => console.log(`   · ${e.en}  →  ${e.ga}`));
  }
  process.exit(0);
}
