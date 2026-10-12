/**
 * Phrase deduction by consensus over the sentence corpus (corpus_pairs).
 *
 * When the archive has no entry for a short English phrase but many corpus
 * sentences contain it, the Ga that most of their translations share is very
 * likely its Ga: the sentences with "I am happy" mostly say "miishɛɛ",
 * usually as "Miyɛ miishɛɛ". The answer is labelled as worked out and not
 * verified, and shows the sentences it came from.
 *
 * Rules that keep it honest (same as scripts/build-phrase-alignments.mjs):
 *  - at least MIN_SUPPORT sentences contain the English phrase as whole words;
 *  - the Ga candidate is in at least half of them;
 *  - it is specific to them: far more common there than across the corpus
 *    (lift), so filler like "lɛ", "ni", "akɛ" never wins; two-letter words
 *    need a much higher lift;
 *  - a longer candidate containing the best wins when its share is close.
 * Otherwise: no answer (the caller keeps its "found inside a phrase" hedge).
 */
import type { Env } from "../types";

const MIN_SUPPORT = 3, MAX_N_GA = 4, MIN_SHARE = 0.5, MIN_LIFT = 8, SHORT_LIFT = 40;
const MAX_ROWS = 300, MAX_CHECKS = 6;

// Same folding as corpus_pairs.en_norm/ga_norm (scripts/backfill-corpus-d1.mjs).
const fold = (s: string) =>
  s.toLowerCase().replace(/ŋ/g, "n").replace(/ɛ/g, "e").replace(/ɔ/g, "o").normalize("NFD").replace(/\p{M}/gu, "");
// The source splits some words around a spaced hyphen ("Wɔ - tsɛ" for Wɔtsɛ):
// rejoin those; a bare "-" is never a word.
const toks = (s: string): string[] =>
  s.normalize("NFC").replace(/(\p{L}) - (\p{L})/gu, "$1$2").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
// Ga function words that only frame a phrase: "lɛ" (the), "he" (about), …
// A candidate that just adds these to the core isn't a fuller phrase.
const GA_FRAME = new Set(["le", "he", "mli", "no", "ni", "ke", "ake", "ye"]);

const FILLER = new Set(
  "the a an of to and or but in on at by for with from as is are was were be been am i you he she it we they me him her us them my your his its our their this that these those do does did not no so if".split(" ")
);

export interface Deduction {
  english: string;
  /** The Ga most of the sentences share (core word or phrase). */
  ga: string;
  support: number;
  total: number;
  /** A fuller Ga phrase around the core word, when several sentences share it. */
  phraseGa?: string;
  phraseSupport?: number;
  examples: { english: string; ga: string }[];
}

export async function deducePhrase(env: Env, english: string): Promise<Deduction | null> {
  const q = toks(fold(english));
  if (!q.length || q.length > 4 || q.every((w) => FILLER.has(w))) return null;
  const needle = q.join(" ");

  let rows: { english: string; ga: string; en_norm: string }[];
  try {
    const r = await env.DB.prepare(
      "SELECT english, ga, en_norm FROM corpus_pairs WHERE en_norm LIKE ? LIMIT ?"
    ).bind(`%${needle}%`, MAX_ROWS).all<{ english: string; ga: string; en_norm: string }>();
    rows = r.results ?? [];
  } catch {
    return null; // table missing / D1 hiccup: no deduction
  }

  // Whole-word phrase match ("happy", not "unhappy"/"happyish"), one per English sentence.
  const seen = new Set<string>();
  const sents = rows.filter((r) => {
    const t = toks(r.en_norm), k = t.join(" ");
    if (seen.has(k)) return false;
    for (let i = 0; i + q.length <= t.length; i++) {
      if (q.every((w, j) => t[i + j] === w)) { seen.add(k); return true; }
    }
    return false;
  });
  const N = sents.length;
  if (N < MIN_SUPPORT) return null;

  // Ga n-grams shared by those sentences (folded key → count, and the usual spelling).
  const count = new Map<string, number>(), surface = new Map<string, Map<string, number>>();
  const gaKeys = sents.map((s) => {
    const orig = toks(s.ga), f = orig.map((w) => fold(w)), mine = new Set<string>();
    for (let n = 1; n <= MAX_N_GA; n++) {
      for (let i = 0; i + n <= f.length; i++) {
        const k = f.slice(i, i + n).join(" ");
        if (mine.has(k)) continue;
        mine.add(k);
        count.set(k, (count.get(k) ?? 0) + 1);
        const m = surface.get(k) ?? new Map<string, number>();
        const sf = orig.slice(i, i + n).join(" ").toLowerCase();
        m.set(sf, (m.get(sf) ?? 0) + 1);
        surface.set(k, m);
      }
    }
    return mine;
  });

  const shared = [...count].filter(([, c]) => c >= MIN_SUPPORT && c / N >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, MAX_CHECKS);
  if (!shared.length) return null;

  // How common each candidate is across the whole corpus (whole words, punctuation ignored).
  let total = 0;
  const df = new Map<string, number>();
  try {
    const flat = "' ' || replace(replace(replace(replace(replace(replace(ga_norm, ',', ' '), '.', ' '), '?', ' '), '!', ' '), ':', ' '), ';', ' ') || ' '";
    const res = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM corpus_pairs"),
      ...shared.map(([k]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM corpus_pairs WHERE ${flat} LIKE ?`).bind(`% ${k} %`)),
    ]);
    total = Number((res[0].results?.[0] as { n?: number })?.n ?? 0);
    shared.forEach(([k], i) => df.set(k, Number((res[i + 1].results?.[0] as { n?: number })?.n ?? 0)));
  } catch {
    return null;
  }
  if (!total) return null;

  const cands = shared.flatMap(([k, c]) => {
    const share = c / N;
    const lift = share / (Math.max(df.get(k) ?? 0, c) / total);
    const short = k.split(" ").every((w) => w.length < 3);
    if (lift < (short ? SHORT_LIFT : MIN_LIFT)) return [];
    return [{ k, c, share, n: k.split(" ").length }];
  });
  if (!cands.length) return null;
  cands.sort((a, b) => b.share - a.share || b.n - a.n);
  let best = cands[0];
  const framingOnly = (longer: string, core: string) =>
    ` ${longer} `.replace(` ${core} `, " ").trim().split(" ").every((w) => GA_FRAME.has(w));
  for (const c of cands) {
    if (c.n > best.n && c.share >= best.share * 0.85 && ` ${c.k} `.includes(` ${best.k} `) && !framingOnly(c.k, best.k)) best = c;
  }
  // "Wɔshia lɛ" is "the house of ours": without "the" in the question, drop
  // the trailing "lɛ" — the shorter form is in at least as many sentences.
  if (!q.includes("the")) {
    const stem = best.k.replace(/( (le|he))+$/, "");
    if (stem && stem !== best.k && count.has(stem)) best = { ...best, k: stem, c: count.get(stem)! };
  }

  const display = (k: string) => {
    const s = [...(surface.get(k) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? k;
    return s.replace(/^./, (ch: string) => ch.toUpperCase());
  };

  // Multi-word English: the fuller Ga phrase around the core word ("Miyɛ miishɛɛ").
  let phraseKey: string | null = null, phraseSupport = 0;
  if (q.length > 1) {
    for (const [k, c] of count) {
      if (k === best.k || !` ${k} `.includes(` ${best.k} `) || framingOnly(k, best.k) || c < MIN_SUPPORT || c / N < 0.3) continue;
      if (c > phraseSupport || (c === phraseSupport && k.length > (phraseKey ?? "").length)) { phraseKey = k; phraseSupport = c; }
    }
  }

  const shown = phraseKey ?? best.k;
  const examples = sents
    .filter((_, i) => gaKeys[i].has(shown))
    .sort((a, b) => a.english.length - b.english.length)
    .slice(0, 3)
    .map((s) => ({ english: s.english, ga: s.ga.replace(/(\p{L}) - (\p{L})/gu, "$1$2") }));

  return {
    english,
    ga: display(best.k),
    support: best.c,
    total: N,
    ...(phraseKey ? { phraseGa: display(phraseKey), phraseSupport } : {}),
    examples,
  };
}
