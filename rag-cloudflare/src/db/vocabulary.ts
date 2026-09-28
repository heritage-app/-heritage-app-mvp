/**
 * Verified Ga vocabulary retrieval (accuracy-critical; see GA_ACCURACY_AUDIT.md).
 *
 * Guarantees:
 *  - Database-only. Never generates, guesses, or infers vocabulary.
 *  - Integrity-gated: a row is retrievable ONLY if `source` AND `verified_at`
 *    are both present. Unverified rows can never surface.
 *  - Ranking: exact (0) → prefix (1) → controlled fuzzy (2), matched on the
 *    folded/normalized form, always displaying the canonical headword.
 *  - Fuzzy is suppressed when exact/prefix matches exist, capped at edit
 *    distance ≤ 1 (Damerau–Levenshtein), and only for input length ≥ 4.
 *  - Tone-minimal pairs: one normalized form mapping to multiple verified
 *    headwords returns ALL of them, never one silently.
 */
import type { Env } from "../types";

export interface VocabularyRecord {
  id: string;
  headword: string;
  part_of_speech: string | null;
  meanings: string[];
  translations: string[];
  examples: string[];
  variants: string[];
  phonetic: string | null;
  category: string | null;
  source: string | null;
  verified_at: string | null;
  match: "exact" | "prefix" | "fuzzy";
}

interface VocabRow {
  id: string;
  headword: string;
  headword_normalized: string;
  part_of_speech: string | null;
  meanings: string;
  translations: string;
  examples: string;
  variants: string;
  phonetic: string | null;
  category: string | null;
  source: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

const FUZZY_MIN_LEN = 4;
const FUZZY_MAX_DISTANCE = 1;

/** Fold Ga letters to ASCII for matching only (never displayed). */
export function foldGa(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ŋ/g, "n")
    .replace(/ɛ/g, "e")
    .replace(/ɔ/g, "o")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** A row is usable only if it carries provenance. Enforces the integrity gate. */
function isVerified(r: VocabRow): boolean {
  return !!(r.source && r.source.trim() && r.verified_at && r.verified_at.trim());
}

function parseArr(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(r: VocabRow, match: VocabularyRecord["match"]): VocabularyRecord {
  return {
    id: r.id,
    headword: r.headword,
    part_of_speech: r.part_of_speech,
    meanings: parseArr(r.meanings),
    translations: parseArr(r.translations),
    examples: parseArr(r.examples),
    variants: parseArr(r.variants),
    phonetic: r.phonetic,
    category: r.category,
    source: r.source,
    verified_at: r.verified_at,
    match,
  };
}

/** Damerau–Levenshtein distance, short-circuited once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  const prev2 = new Array(bl + 1);
  let prev = new Array(bl + 1);
  let cur = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // transposition
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // no path can beat max anymore
    for (let j = 0; j <= bl; j++) prev2[j] = prev[j];
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[bl];
}

/**
 * Look up verified vocabulary for `query`. Returns ranked, integrity-gated
 * records. Empty array means "no verified match" — the caller must NOT fall
 * back to any generative source.
 */
export async function lookupVocabulary(
  env: Env,
  query: string,
  limit = 8
): Promise<VocabularyRecord[]> {
  const q = foldGa((query || "").trim());
  if (q.length < 2) return [];

  // Exact + prefix in one indexed query. The integrity gate (source/verified_at
  // present) is applied in SQL AND re-checked in JS as defence in depth.
  const like = q.replace(/[%_]/g, (m) => "\\" + m) + "%";
  const res = await env.DB.prepare(
    `SELECT * FROM vocabulary
       WHERE (headword_normalized = ? OR headword_normalized LIKE ? ESCAPE '\\')
         AND source IS NOT NULL AND TRIM(source) <> ''
         AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
       ORDER BY LENGTH(headword_normalized) ASC
       LIMIT 50`
  )
    .bind(q, like)
    .all<VocabRow>();

  const rows = (res.results ?? []).filter(isVerified);
  const out: VocabularyRecord[] = [];
  const seen = new Set<string>();

  // Exact first (all of them — tone-minimal pairs included), then prefix.
  for (const r of rows) {
    if (r.headword_normalized === q) {
      out.push(toRecord(r, "exact"));
      seen.add(r.id);
    }
  }
  for (const r of rows) {
    if (!seen.has(r.id) && r.headword_normalized.startsWith(q)) {
      out.push(toRecord(r, "prefix"));
      seen.add(r.id);
    }
  }

  // Controlled fuzzy ONLY when nothing exact/prefix matched, input is long
  // enough, and the candidate is within edit distance 1. Scans the (small)
  // verified table; still integrity-gated.
  if (out.length === 0 && q.length >= FUZZY_MIN_LEN) {
    const all = await env.DB.prepare(
      `SELECT * FROM vocabulary
         WHERE source IS NOT NULL AND TRIM(source) <> ''
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''`
    ).all<VocabRow>();
    const fuzzy: Array<{ r: VocabRow; d: number }> = [];
    for (const r of (all.results ?? []).filter(isVerified)) {
      const d = editDistance(q, r.headword_normalized, FUZZY_MAX_DISTANCE);
      if (d <= FUZZY_MAX_DISTANCE) fuzzy.push({ r, d });
    }
    fuzzy.sort((a, b) => a.d - b.d || a.r.headword.length - b.r.headword.length);
    for (const { r } of fuzzy) {
      if (!seen.has(r.id)) {
        out.push(toRecord(r, "fuzzy"));
        seen.add(r.id);
      }
    }
  }

  return out.slice(0, limit);
}
