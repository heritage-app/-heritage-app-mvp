/**
 * RAG orchestration (ported from app/rag/service.py).
 * Routes to a Bible engine or a General engine, grounds the answer, then streams
 * it through the Nii Obodai persona. Persistence + background summary/title after.
 */
import type { Env, ChatMessage, RagMode, VerseRecord } from "../types";
import { DEFAULT_TOP_K, MIN_RELEVANCE_SCORE, BOOK_MAP, BIBLE_BOOK_TOKENS } from "../config";
import { numToGa } from "./ga";
import { resolveGaCitation } from "./ga";
import { isFormattableBibleRecord, formatBibleQuote } from "./validator";
import { retrieveContext, formatRetrievedContext, type RetrieveFilters } from "./retriever";
import { listChapters, listVerses } from "./discovery";
import { getVerse } from "../db/bibleVerses";
import { chat, streamChat } from "./llm";
import {
  NII_OBODAI_PERSONA_PROMPT,
  STRICT_GUARDRAIL_PROMPT,
  fill,
} from "./prompts";
import { initializeSession, updateActivity } from "../db/sessions";
import { saveInteraction } from "../db/messages";
import { summarizeConversation, generateTitle } from "./memory";

const GHOSTS = ["Linguistic Engine", "inguistic Engine", "Engine"];

export interface AskParams {
  query: string;
  conversationId: string | null;
  userId: string;
  topK?: number;
  stream?: boolean;
  model?: string;
  mode?: RagMode;
}

/** Stream a grounded answer through the Nii Obodai persona. */
async function* streamPersona(
  env: Env,
  query: string,
  groundedAnswer: string,
  memoryWindow: ChatMessage[],
  model: string | undefined,
  stream: boolean
): AsyncGenerator<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: fill(NII_OBODAI_PERSONA_PROMPT, { grounded_answer: groundedAnswer }) },
    ...memoryWindow,
    { role: "user", content: query },
  ];

  if (!stream) {
    let out = await chat(env, messages, { temperature: 0.7, model });
    for (const ghost of GHOSTS) if (out.startsWith(ghost)) out = out.slice(ghost.length).trim();
    yield out;
    return;
  }

  for await (let token of streamChat(env, messages, { temperature: 0.7, model })) {
    if (token) {
      for (const ghost of GHOSTS) if (token.startsWith(ghost)) token = token.slice(ghost.length).trim();
      yield token;
    }
  }
}

/** Grounding helper: run the strict guardrail prompt over retrieved context. */
async function groundWithGuardrail(
  env: Env,
  query: string,
  contextText: string,
  model?: string
): Promise<string> {
  const prompt = fill(STRICT_GUARDRAIL_PROMPT, {
    query,
    context_text: contextText,
    reference_display: "",
    ga: "",
    en: "",
    source_name: "",
  });
  return chat(env, [{ role: "user", content: prompt }], { temperature: 0, model });
}

/** Dedicated Bible RAG engine with strict archival fidelity. */
async function* askBible(
  env: Env,
  query: string,
  memoryWindow: ChatMessage[],
  topK: number,
  stream: boolean,
  model?: string
): AsyncGenerator<string> {
  const qLow = query.toLowerCase();

  const isSingular = ["a verse", "any verse", "quote a verse"].some((p) => qLow.includes(p));
  const isPlural = ["verses", "multiple", "list", "all", "chapters"].some((w) => qLow.includes(w));
  const effectiveTopK = isSingular ? 1 : isPlural ? 25 : topK;

  const incompleteMatch = /^\s*(?:kuku\s+ni\s+ji|verse|chapter|yitso)\s+\d+\s*$/.test(qLow);
  const isIncomplete = incompleteMatch && !BIBLE_BOOK_TOKENS.some((b) => qLow.includes(b));

  const refMatch = qLow.match(/(genesis|exodus|leviticus|numbers|deuteronomy|mose)\s+(\d+)(?:[\s:]+(\d+))?/);
  const gaRef = resolveGaCitation(qLow);

  const isSpecific = !!(refMatch || gaRef.chapter) && !isIncomplete;
  let requestedBook: string | null = null;
  let requestedCh: number | null = null;
  let requestedV: number | null = null;
  let rawBook: string | null = null;

  if (isSpecific) {
    if (refMatch) {
      rawBook = refMatch[1].toLowerCase();
      requestedCh = parseInt(refMatch[2], 10);
      requestedV = refMatch[3] ? parseInt(refMatch[3], 10) : null;
    }
    if (gaRef.chapter) {
      requestedCh = gaRef.chapter;
      if (gaRef.verse) requestedV = gaRef.verse;
      if (!refMatch) {
        for (const b of BIBLE_BOOK_TOKENS) if (qLow.includes(b)) { rawBook = b; break; }
      }
    }
    requestedBook = rawBook ? BOOK_MAP[rawBook] ?? cap(rawBook) : "Genesis";
  }

  // --- Structural discovery (chapter/verse listing, counting) ---
  const isChapterList = ["chapters in", "list chapters", "available chapters"].some((w) => qLow.includes(w));
  const isVerseList =
    ["verses in", "list verses", "available verses"].some((w) => qLow.includes(w)) ||
    (isSpecific && !!requestedCh && !requestedV);
  const isCounting = ["how many", "count"].some((w) => qLow.includes(w));
  const isStructural = (isChapterList || isVerseList || isCounting) && (!!requestedBook || qLow.includes("genesis"));

  if (isStructural) {
    const bookToUse = requestedBook || "Genesis";
    let grounded: string;
    if (isChapterList) {
      const map = await listChapters(env, bookToUse);
      const list = [...map.entries()].map(([n, t]) => `- ${n} (${t})`).join("\n");
      grounded = `Ye ${bookToUse} wolo lɛ mli lɛ, wɔyɛ yitsoi ${numToGa(map.size)} (${map.size} chapters):\n\n${list}`;
    } else if (isVerseList) {
      const chToUse = requestedCh || 1;
      const map = await listVerses(env, bookToUse, chToUse);
      const list = [...map.entries()].map(([n, l]) => `- ${n} (${l})`).join("\n");
      grounded = `Ye ${bookToUse} Yitso ${numToGa(chToUse)} lɛ mli lɛ, wɔyɛ kukuji ${numToGa(map.size)} (${map.size} verses):\n\n${list}`;
    } else {
      const map = requestedCh ? await listVerses(env, bookToUse, requestedCh) : await listChapters(env, bookToUse);
      grounded = `Wɔyɛ ${numToGa(map.size)} (${map.size}) yɛ archive lɛ mli.`;
    }
    // Structural lists are exact archive data — emit verbatim.
    yield grounded;
    return;
  }

  // --- Retrieval ---
  const filters: RetrieveFilters | undefined = isSpecific
    ? { category: "bible", book: requestedBook!, chapter_num: requestedCh!, ...(requestedV ? { verse_num: requestedV } : {}) }
    : undefined;

  const nodes = await retrieveContext(env, query, {
    topK: effectiveTopK,
    filters,
    allowedCategories: ["bible"],
  });

  // --- Exact-match validation (prefer the deterministic D1 record when specific) ---
  let matchedMeta: VerseRecord | null = null;
  let validationFailed = false;
  if (isSpecific && requestedV) {
    matchedMeta = await getVerse(env, requestedBook!, requestedCh!, requestedV);
    if (!matchedMeta) {
      const exact = nodes.find((n) => {
        const m = n.metadata;
        return (
          String(m.book ?? "").toLowerCase() === requestedBook!.toLowerCase() &&
          Number(m.chapter_num ?? 0) === requestedCh &&
          Number(m.verse_num ?? 0) === requestedV
        );
      });
      if (exact) matchedMeta = exact.metadata as VerseRecord;
      else validationFailed = true;
    }
  } else if (isSpecific && nodes.length === 0) {
    validationFailed = true;
  }

  const archiveLabel = "📍 **Archive Focus: Bible**\n\n";
  let grounded: string;
  // Deterministic answers (refusals, exact quotes, numeric facts) are emitted
  // verbatim — never sent through the persona LLM, which could otherwise
  // hallucinate scripture or reformat a verse.
  let deterministic = true;

  if (isIncomplete) {
    grounded = "The reference is incomplete. Please provide book, chapter, and verse.";
  } else if (isSpecific && (nodes.length === 0 || validationFailed) && !matchedMeta) {
    grounded = "This exact verse or chapter is not in my indexed Bible archive.";
  } else if (matchedMeta && isFormattableBibleRecord(matchedMeta)) {
    grounded = `Hɛloo naanyo! Here is the verse you requested:\n\n${formatBibleQuote(matchedMeta)}`;
  } else if (nodes.length === 0) {
    const numMatch = query.match(/\b(\d+)\b/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      grounded = `The number ${num} in Ga follows the operational counting logic: **${numToGa(num)}**.`;
    } else {
      grounded = "This is not in my Ga Bible archives.";
    }
  } else {
    // We have real retrieved context — let the persona humanize it.
    grounded = await groundWithGuardrail(env, query, formatRetrievedContext(nodes), model);
    deterministic = false;
  }

  if (deterministic) {
    yield archiveLabel + grounded;
  } else {
    yield* streamPersona(env, query, archiveLabel + grounded, memoryWindow, model, stream);
  }
}

/** General-knowledge engine for history, stories, phrases, numerics. */
async function* askGeneral(
  env: Env,
  query: string,
  memoryWindow: ChatMessage[],
  topK: number,
  stream: boolean,
  model?: string
): AsyncGenerator<string> {
  // Numeric range table: "count from 1 to 10"
  const rangeMatch = query.match(/(\d+)\s+to\s+(\d+)/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start > 0 && start <= end && end <= 1000 && end - start <= 50) {
      const lines = ["Here are the numbers you requested:\n", "| Number | Ga Translation |", "| :--- | :--- |"];
      for (let n = start; n <= end; n++) lines.push(`| **${n}** | ${cap(numToGa(n))} |`);
      yield lines.join("\n"); // deterministic numeric table
      return;
    }
  }

  const phraseTopK = Math.max(topK, 20);
  let nodes = await retrieveContext(env, query, {
    topK: phraseTopK,
    allowedCategories: ["heritage", "stories"],
  });
  nodes = nodes.filter((n) => (n.score ?? 0) >= MIN_RELEVANCE_SCORE);

  const singleNums = [...query.matchAll(/\b(\d+)\b/g)].map((m) => m[1]);

  if (nodes.length === 0) {
    // No retrieved context — refuse / give the numeric fact directly, never via the LLM.
    if (singleNums.length) {
      const num = parseInt(singleNums[0], 10);
      yield `**${num}** in Ga is **${numToGa(num)}**.`;
      return;
    }
    yield "This one is not in my archives yet.";
    return;
  }

  // Phrase-aware scan across JSONL chunks
  const stop = new Set(["in", "ga", "the", "a", "an", "is", "are", "what", "how", "do", "you", "say", "tell", "me", "to"]);
  const queryWords = new Set([...query.toLowerCase().matchAll(/\b\w+\b/g)].map((m) => m[0]).filter((w) => !stop.has(w)));

  const phraseHits: Array<[number, string, string]> = [];
  for (const node of nodes) {
    const src = String(node.metadata.filename ?? "");
    if (!(src.toLowerCase().endsWith(".jsonl") || src.toLowerCase().includes("phrase"))) continue;
    for (const rawLine of node.text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        const eng = String(rec.english ?? "").trim();
        const ga = String(rec.ga ?? "").trim();
        if (!eng || !ga) continue;
        const engLower = eng.toLowerCase();
        let matchCount = 0;
        for (const w of queryWords) if (engLower.includes(w)) matchCount++;
        if (matchCount > 0) phraseHits.push([matchCount, eng, ga]);
      } catch {
        // not JSON
      }
    }
  }

  if (phraseHits.length) {
    phraseHits.sort((a, b) => b[0] - a[0]);
    const best = phraseHits.slice(0, 5);
    const grounded = best.map(([, eng, ga]) => `English: ${eng} → Ga: ${ga}`).join("\n");
    yield grounded; // exact phrase pairs — preserve verbatim
    return;
  }

  const grounded = await groundWithGuardrail(env, query, formatRetrievedContext(nodes), model);
  yield* streamPersona(env, query, grounded, memoryWindow, model, stream);
}

/**
 * Unified RAG entry point. Yields response tokens, then persists the turn.
 * Pass `waitUntil` to defer summary/title generation past the response.
 */
export async function* ask(
  env: Env,
  params: AskParams,
  waitUntil?: (p: Promise<unknown>) => void
): AsyncGenerator<string> {
  const { query, userId } = params;
  const topK = params.topK ?? DEFAULT_TOP_K;
  const stream = params.stream ?? true;
  const model = params.model;
  let conversationId = params.conversationId;
  let mode: RagMode = params.mode ?? "auto";

  const qLow = query.toLowerCase().trim();

  const greetings = ["hi", "hello", "hey", "hɛloo", "manye", "ojekoo", "good morning", "how are you"];
  if (greetings.includes(qLow)) {
    let full = "";
    for await (const t of streamPersona(env, query, "", [], model, stream)) {
      full += t;
      yield t;
    }
    if (conversationId) {
      await saveInteraction(env, conversationId, query, full, userId);
      await updateActivity(env, conversationId);
    }
    return;
  }

  const citationMatch = /(genesis|exodus|leviticus|numbers|deuteronomy|mose)\s+(\d+)(?:[\s:]+(\d+))?/.test(qLow);
  if (citationMatch) mode = "bible";

  if (conversationId === null) {
    conversationId = crypto.randomUUID();
    await initializeSession(env, conversationId, userId);
  }

  const ctx = await getConversationContextSafe(env, conversationId, userId, model);
  const memoryWindow = ctx;

  let targetMode = mode;
  if (targetMode === "auto") {
    const isBible =
      ["genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose", "verse", "chapter", "scripture"].some(
        (b) => qLow.includes(b)
      ) || (qLow.includes(":") && /\d/.test(qLow));
    targetMode = isBible ? "bible" : "general";
  }

  let full = "";
  try {
    const engine =
      targetMode === "bible"
        ? askBible(env, query, memoryWindow, topK, stream, model)
        : askGeneral(env, query, memoryWindow, topK, stream, model);

    for await (const token of engine) {
      full += token;
      yield token;
    }

    await saveInteraction(env, conversationId, query, full, userId);
    await updateActivity(env, conversationId);

    const bg = Promise.allSettled([
      summarizeConversation(env, conversationId, null, model),
      generateTitle(env, conversationId, null, model),
    ]);
    if (waitUntil) waitUntil(bg);
    else await bg;
  } catch (e) {
    console.error("RAG Router Error:", e);
    yield "Hɛloo! I'm having trouble routing your request. Please try again in a moment.";
  }
}

/** Fetch memory window only (context generation is best-effort). */
async function getConversationContextSafe(
  env: Env,
  conversationId: string,
  userId: string,
  model?: string
): Promise<ChatMessage[]> {
  try {
    const { getConversationContext } = await import("./memory");
    const ctx = await getConversationContext(env, conversationId, userId, model);
    return ctx.memoryWindow;
  } catch (e) {
    console.warn("context load failed:", e);
    return [];
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
