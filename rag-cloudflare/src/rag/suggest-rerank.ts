/**
 * Grounded LLM re-ranking for autocomplete suggestions.
 *
 * The LLM is used ONLY to reorder/select from a closed set of already-retrieved,
 * verified vocabulary records — using the user's partial input and conversation
 * context for relevance. It is structurally incapable of adding vocabulary:
 *
 *  - Input to the model is the candidate list ONLY (id + headword + gloss).
 *  - Output is parsed as a list of ids; any id NOT in the candidate set is
 *    discarded. The model cannot introduce a new word, spelling, meaning, or
 *    translation — all displayed data comes from the verified record, never the
 *    model.
 *  - Verified candidates the model omits are appended in their original
 *    deterministic order, so re-ranking never DROPS a verified match.
 *  - Any failure (parse error, empty, neuron/quota error) falls back to the
 *    deterministic KB order. Accuracy never depends on the model succeeding.
 */
import type { Env } from "../types";
import type { VocabularyRecord } from "../db/vocabulary";
import { chat } from "./llm";

const RERANK_SYSTEM = `You are a ranking function for a VERIFIED Ga-language dictionary autocomplete.
You are given the user's partial input, optional conversation context, and a fixed
list of CANDIDATE suggestions (each with an id). Your ONLY job is to order the
candidates by relevance to what the user is likely typing next.

STRICT RULES:
- You may ONLY use ids from the candidate list.
- You may NOT invent words, meanings, translations, or ids.
- You may NOT add anything not in the list.
- If a candidate is irrelevant, simply place it later — do not remove it.
- Output ONLY a JSON array of ids, most relevant first. No prose, no code fences.
Example output: ["vocab:0003","vocab:0012","vocab:0001"]`;

/**
 * Reorder verified candidates with the LLM, strictly within the retrieved set.
 * Returns a new array containing exactly the same records, reordered — or the
 * original array unchanged on any failure. Never adds or removes records.
 */
export async function rerankSuggestions(
  env: Env,
  candidates: VocabularyRecord[],
  input: string,
  context: string,
  model?: string
): Promise<VocabularyRecord[]> {
  // Nothing to reorder, or too few to be worth a model call.
  if (candidates.length < 2) return candidates;

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const catalogue = candidates.map((c) => ({
    id: c.id,
    ga: c.headword,
    gloss: c.translations[0] || c.meanings[0] || "",
  }));

  const user =
    `User is typing: "${input}"\n` +
    (context ? `Conversation context:\n${context.slice(0, 600)}\n` : "") +
    `\nCANDIDATES (the ONLY allowed suggestions):\n${JSON.stringify(catalogue)}\n\n` +
    `Return a JSON array of ids from the candidates above, most relevant first.`;

  let raw: string;
  try {
    raw = await chat(
      env,
      [
        { role: "system", content: RERANK_SYSTEM },
        { role: "user", content: user },
      ],
      { temperature: 0, maxTokens: 256, model }
    );
  } catch {
    return candidates; // neuron/quota/network error → deterministic order
  }

  // Parse the first JSON array of strings we find.
  let ids: unknown;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    ids = m ? JSON.parse(m[0]) : null;
  } catch {
    return candidates;
  }
  if (!Array.isArray(ids)) return candidates;

  // Keep only ids that exist in the retrieved set (drops any hallucinated id),
  // preserve order, dedup, then append any verified candidate the model omitted.
  const ordered: VocabularyRecord[] = [];
  const used = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && byId.has(id) && !used.has(id)) {
      ordered.push(byId.get(id)!);
      used.add(id);
    }
  }
  if (ordered.length === 0) return candidates; // model gave nothing usable
  for (const c of candidates) if (!used.has(c.id)) ordered.push(c);
  return ordered;
}
