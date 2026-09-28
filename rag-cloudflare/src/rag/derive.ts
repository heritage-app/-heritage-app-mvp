/**
 * Word derivation — guesses a single word's Ga from sentence pairs.
 *
 * NOT an answer source. Its output is inferred, often wrong (it offered "mli",
 * which means "inside", for "shade"), and must only ever reach reviewers as a
 * suggestion. Kept for the reviewer "Suggested words" queue; the agent does
 * not call it.
 *
 * Two sources, strongest first: the precomputed word_alignments table (built
 * by /admin/alignments/build), then a runtime pass that subtracts the Ga words
 * already explained by a sentence's other English words.
 */
import type { Env } from "../types";
import { foldGa } from "./ga";

export interface DerivedCandidate {
  english: string;
  ga: string;
  /** Pairs the candidate was seen in. */
  evidence: number;
  confidence?: number;
  examples: Array<{ english: string; ga: string }>;
}

const wordsOf = (s: string) => new Set(foldGa(s.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? []);

export async function deriveCandidates(env: Env, rawTerm: string): Promise<DerivedCandidate[]> {
  const term = foldGa(rawTerm.trim().toLowerCase());
  if (!term) return [];

  const aligned = await env.DB.prepare(
    `SELECT ga_word, english_word, confidence, evidence_count, examples FROM word_alignments
     WHERE english_normalized = ? AND status <> 'rejected'
     ORDER BY confidence DESC, evidence_count DESC LIMIT 3`
  ).bind(term).all<any>().catch(() => ({ results: [] as any[] }));
  if (aligned.results?.length) {
    return aligned.results.map((r: any) => {
      let ex: Array<{ english: string; ga: string }> = [];
      try { ex = JSON.parse(r.examples || "[]"); } catch {}
      return { english: r.english_word, ga: r.ga_word, evidence: r.evidence_count, confidence: r.confidence, examples: ex };
    });
  }

  const docs = await env.DB.prepare(
    "SELECT unique_path FROM documents WHERE category = 'heritage' AND unique_path LIKE '%.jsonl'"
  ).all<{ unique_path: string }>();
  const matches: Array<{ english: string; ga: string }> = [];
  for (const row of docs.results ?? []) {
    const obj = await env.DOCS_BUCKET.get(row.unique_path);
    if (!obj) continue;
    for (const line of (await obj.text()).split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const rec = JSON.parse(t);
        const english = String(rec.english ?? "").trim();
        const ga = String(rec.ga ?? "").trim();
        if (english && ga && wordsOf(english).has(term)) matches.push({ english, ga });
      } catch { /* skip */ }
    }
  }
  if (!matches.length) return [];

  // Ga words explained by the sentences' other English words.
  const explained = new Set<string>();
  for (const p of matches) {
    const others = [...wordsOf(p.english)].filter((w) => w !== term && w.length > 1);
    for (const w of others.slice(0, 8)) {
      const rows = await env.DB.prepare(
        `SELECT headword FROM vocabulary
         WHERE (REPLACE(REPLACE(translations, '''', ''), '’', '') LIKE ?
                OR REPLACE(REPLACE(meanings, '''', ''), '’', '') LIKE ?)
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
         LIMIT 10`
      ).bind(`%${w}%`, `%${w}%`).all<{ headword: string }>();
      for (const r of rows.results ?? []) for (const gw of wordsOf(r.headword)) explained.add(gw);
    }
  }

  // Candidates keep the ORIGINAL spelling (ɛ, ɔ, ŋ): folding is only for
  // comparison — a folded word can't be turned back into the real one.
  const cand = new Map<string, { ga: string; n: number; examples: Array<{ english: string; ga: string }> }>();
  for (const p of matches) {
    for (const original of p.ga.match(/[\p{L}\p{M}'-]+/gu) ?? []) {
      const key = foldGa(original.toLowerCase());
      if (key.length < 2 || explained.has(key)) continue;
      const e = cand.get(key) ?? { ga: original.toLowerCase(), n: 0, examples: [] };
      e.n++;
      if (e.examples.length < 3) e.examples.push(p);
      cand.set(key, e);
    }
  }
  return [...cand.values()]
    .sort((x, y) => y.n - x.n || x.ga.length - y.ga.length)
    .slice(0, 3)
    .map((e) => ({ english: term, ga: e.ga, evidence: e.n, examples: e.examples }));
}
