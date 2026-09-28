/**
 * Ga language suggestions endpoint.
 *
 * ACCURACY GUARANTEE: the LLM MUST NOT invent vocabulary.
 * Flow: retrieve verified candidates from the D1 `vocabulary` store
 * (integrity-gated: source + verified_at required; exact/prefix/controlled-fuzzy)
 * → optionally let the LLM RE-RANK within that closed set using conversation
 * context. The model can only reorder retrieved records; it cannot add a word,
 * meaning, spelling, or translation (see suggest-rerank.ts). If nothing verified
 * matches, we return an empty set — never a guess. If the model fails, we return
 * the deterministic KB order.
 */

import type { Env } from "../types";
import { lookupVocabulary } from "../db/vocabulary";
import { rerankSuggestions } from "../rag/suggest-rerank";

export interface SuggestionRequest {
  input: string;
  context: string;
  language: "ga" | "en";
  rerank?: boolean; // opt-in LLM re-ranking over the verified candidate set
}

export interface SuggestionResponse {
  suggestions: Array<{
    text: string;
    phonetic?: string;
    english?: string;
    context?: string;
    confidence: number;
    match?: string;
  }>;
}

export async function handleSuggestions(request: Request, env: Env): Promise<Response> {
  try {
    const body: SuggestionRequest = await request.json();
    if (!body || typeof body.input !== "string") {
      return json({ error: "Invalid input" }, 400);
    }

    // 1) Retrieve verified candidates from the knowledge base (never the model).
    let records = await lookupVocabulary(env, body.input, 8);

    // 2) Optional grounded LLM re-rank — reorders WITHIN the retrieved set only,
    //    using conversation context. Cannot add/remove verified vocabulary.
    if (body.rerank && records.length > 1) {
      records = await rerankSuggestions(env, records, body.input, body.context || "");
    }

    const suggestions = records.map((r) => ({
      text: r.headword,                                  // canonical spelling, never folded
      phonetic: r.phonetic ?? undefined,
      english: r.translations[0],
      context: r.meanings[0],
      // Confidence reflects match tier, not model certainty.
      confidence: r.match === "exact" ? 1 : r.match === "prefix" ? 0.9 : 0.8,
      match: r.match,
    }));
    const response: SuggestionResponse = { suggestions };
    return json(response, 200);
  } catch {
    return json({ error: "Internal server error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
