/**
 * RAG orchestration (ported from app/rag/service.py).
 * Routes to a Bible engine or a General engine, grounds the answer, then streams
 * it through the Nii Obodai persona. Persistence + background summary/title after.
 */
import type { Env, ChatMessage, RagMode, VerseRecord } from "../types";
import { DEFAULT_TOP_K, MIN_RELEVANCE_SCORE, BOOK_MAP, BIBLE_BOOK_TOKENS } from "../config";
import { numToGa, foldGa, resolveGaCitation } from "./ga";
import { isFormattableBibleRecord, formatBibleQuote } from "./validator";
import { getTradBook } from "./refiner";
import { retrieveContext, formatRetrievedContext, type RetrieveFilters } from "./retriever";
import { retrieveWithExpansion, analyzeQueryComplexity } from "./query-expansion";
import { 
  logKnowledgeGap, 
  generateLearningNotFoundResponse,
  handleUserContribution 
} from "./learning-from-gaps";
import { listChapters, listVerses } from "./discovery";
import { getVerse, listBooks, getRandomVerse } from "../db/bibleVerses";
import { chat, streamChat } from "./llm";
import {
  NII_OBODAI_PERSONA_PROMPT,
  STRICT_GUARDRAIL_PROMPT,
  NOT_IN_ARCHIVE,
  fill,
} from "./prompts";
import { initializeSession, updateActivity } from "../db/sessions";
import { saveInteraction } from "../db/messages";
import { summarizeConversation, generateTitle } from "./memory";

const GHOSTS = ["Linguistic Engine", "inguistic Engine", "Engine"];
const NOT_FOUND_GENERAL =
  "Hmm, I don't have that in my archives yet — try a Ga word, a phrase, or a Bible verse like Genesis 1:1.";

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

/**
 * Grounding helper: run the strict guardrail prompt over retrieved context.
 * Returns the grounded answer, or NOT_IN_ARCHIVE if the context doesn't answer it.
 */
async function groundWithGuardrail(
  env: Env,
  query: string,
  contextText: string,
  model?: string
): Promise<string> {
  const prompt = fill(STRICT_GUARDRAIL_PROMPT, { query, context_text: contextText });
  return chat(env, [{ role: "user", content: prompt }], { temperature: 0, model });
}

/** True when the grounding model signalled the answer isn't in the archive. */
function isNotFound(answer: string): boolean {
  const a = answer.trim().toUpperCase();
  // Bare sentinel, or a short reply that contains it (model occasionally adds punctuation).
  return a === NOT_IN_ARCHIVE || (a.includes(NOT_IN_ARCHIVE) && a.length <= NOT_IN_ARCHIVE.length + 12);
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

  // --- Archive overview: "what's in here / what do you have" → list indexed books ---
  const isOverview =
    !/\d/.test(qLow) &&
    [
      "what is there", "what's there", "whats there",
      "what do you have", "what have you", "what can you",
      "what is in", "what's in", "whats in",
      "what is available", "what's available", "whats available",
      "what books", "which books", "what is here", "what's here",
      "show me what", "what can i ask", "contents", "overview",
    ].some((p) => qLow.includes(p));

  if (isOverview) {
    const books = await listBooks(env);
    if (books.length === 0) {
      yield "My Ga Bible archive is currently empty — no books have been indexed yet.";
    } else {
      const lines = books.map(
        (b) =>
          `- **${b.book}**${b.traditional_book ? ` (${b.traditional_book})` : ""} — ${b.chapters} chapter${b.chapters !== 1 ? "s" : ""}, ${b.verses} verse${b.verses !== 1 ? "s" : ""}`
      );
      yield (
        "Here is what is currently in my Ga Bible archive:\n\n" +
        lines.join("\n") +
        "\n\nAsk for a specific verse (e.g. *Genesis 1:1*), or *list verses in Genesis 1*."
      );
    }
    return;
  }

  const isSingular = ["a verse", "any verse", "quote a verse"].some((p) => qLow.includes(p));
  const isPlural = ["verses", "multiple", "list", "all", "chapters"].some((w) => qLow.includes(w));
  const complexity = analyzeQueryComplexity(query);
  const dynamicTopK = complexity === 'high' ? 10 : complexity === 'medium' ? 5 : 3;
  const effectiveTopK = isSingular ? 1 : isPlural ? 25 : dynamicTopK;

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

  // --- Random verse: "quote/give me a (random/any) verse" → pull a fresh one from D1 ---
  const isRandomVerse =
    !isSpecific &&
    /\bverse\b/.test(qLow) &&
    /\b(quote|random|any|give|show|read|another|some)\b/.test(qLow) &&
    !/\b(list|how many|count|chapters?|verses\s+in)\b/.test(qLow);
  if (isRandomVerse) {
    let book: string | null = null;
    for (const b of BIBLE_BOOK_TOKENS) if (qLow.includes(b)) { book = BOOK_MAP[b] ?? cap(b); break; }
    const v = await getRandomVerse(env, book ?? undefined);
    yield v
      ? `Hɛloo naanyo! Here is a verse from the archive:\n\n${formatBibleQuote(v)}`
      : "This is not in my Ga Bible archives.";
    return;
  }

  // --- Book-name translation: "what is Genesis in Ga / Genesis ga name" ---
  // (These Pentateuch books route to the Bible engine; other books resolve in General.)
  if (!isSpecific && /\bin ga\b|\bga name\b|how do you say|\bcalled\b/.test(qLow)) {
    for (const t of ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"]) {
      if (qLow.includes(t)) {
        const eng = t.charAt(0).toUpperCase() + t.slice(1);
        yield `In Ga, the book of **${eng}** is **${getTradBook(t)}**.`;
        return;
      }
    }
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

  const NOT_FOUND = "This is not in my Ga Bible archives.";
  let grounded: string;

  if (isIncomplete) {
    grounded = "The reference is incomplete. Please provide book, chapter, and verse.";
  } else if (isSpecific && (nodes.length === 0 || validationFailed) && !matchedMeta) {
    // Log the knowledge gap for learning
    await logKnowledgeGap(env, query, 'bible_citation', 'Bible verse/chapter not found');
    grounded = generateLearningNotFoundResponse(query, 'bible');
  } else if (matchedMeta && isFormattableBibleRecord(matchedMeta)) {
    grounded = `Hɛloo naanyo! Here is the verse you requested:\n\n${formatBibleQuote(matchedMeta)}`;
  } else {
    // Non-exact bible request ("quote a verse", "a verse about light", etc.).
    const relevant = nodes.filter((n) => (n.score ?? 0) >= MIN_RELEVANCE_SCORE);
    if (relevant.length === 0) {
      // Log the knowledge gap for learning
      await logKnowledgeGap(env, query, 'bible_general', 'Bible content not found');
      grounded = generateLearningNotFoundResponse(query, 'bible');
    } else {
      // The archive is verse-based: quote the most relevant verse(s) with the exact
      // deterministic citation block — never let the LLM re-serialize scripture
      // (which drops the citation/English/source and can truncate).
      const formattable = relevant.filter((n) => isFormattableBibleRecord(n.metadata));
      if (formattable.length) {
        const count = isPlural ? Math.min(formattable.length, 5) : 1;
        const quotes = formattable
          .slice(0, count)
          .map((n) => formatBibleQuote(n.metadata as VerseRecord))
          .join("\n\n———\n\n");
        grounded = `Hɛloo naanyo! Here ${count > 1 ? "are some verses" : "is a verse"} from the archive:\n\n${quotes}`;
      } else {
        const answer = await groundWithGuardrail(env, query, formatRetrievedContext(relevant), model);
        grounded = isNotFound(answer) ? NOT_FOUND : answer;
      }
    }
  }

  // Every bible answer is grounded/deterministic — never routed through the
  // creative persona LLM, which could otherwise introduce outside knowledge.
  yield grounded;
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

  const qLow = query.toLowerCase();
  const singleNums = [...query.matchAll(/\b(\d+)\b/g)].map((m) => m[1]);

  // Tokens that don't count as "content" when deciding what the query is about.
  const stop = new Set([
    "in", "ga", "the", "a", "an", "is", "are", "what", "how", "do", "does", "you",
    "say", "said", "tell", "me", "to", "of", "for", "your", "my", "i", "we", "they",
    "translate", "translation", "number", "numeral", "count", "spell", "word",
    "mean", "means", "meaning", "language", "english",
  ]);
  // Content words: exclude stopwords AND bare numbers. Folded (ŋ→n, ɛ→e, ɔ→o) so
  // Ga words typed on a standard keyboard compare equal to archive spelling.
  const queryWords = [...foldGa(qLow).matchAll(/[\p{L}\p{N}'-]+/gu)]
    .map((m) => m[0])
    .filter((w) => w.length > 1 && !stop.has(w) && !/^\d+$/.test(w));

  // --- Number translation: fire only when a number is the actual subject (no other
  // content words), so "21 in Ga" works but "1 Samuel" / "21st May" don't misfire. ---
  const wantsNumber =
    /\b(?:in|to)\s+ga\b/.test(qLow) ||
    /\b(?:translate|translation|number|count|spell)\b/.test(qLow) ||
    /^\s*\d+\s*$/.test(query.trim());
  if (wantsNumber && singleNums.length && queryWords.length === 0) {
    const num = parseInt(singleNums[0], 10);
    const ga = numToGa(num);
    yield ga === String(num)
      ? `I can translate Ga numbers from 1 to 999 — **${num}** is outside that range.`
      : `**${num}** in Ga is **${ga}**.`;
    return;
  }

  const phraseTopK = Math.max(topK, 20);
  const complexity = analyzeQueryComplexity(query);
  const dynamicTopK = complexity === 'high' ? 25 : complexity === 'medium' ? 15 : phraseTopK;
  
  // Use intelligent retrieval with expansion
  const { nodes: expandedNodes } = await retrieveWithExpansion(env, query, {
    topK: dynamicTopK,
    allowedCategories: ["heritage", "stories"],
  });

  const nodes = expandedNodes.filter((n) => (n.score ?? 0) >= MIN_RELEVANCE_SCORE);

  // --- Phrase-pair lookup: answer with a pair only when the query names the English
  // or the Ga term (folded whole-word overlap), not merely a loose embedding match.
  // Scans below-threshold candidates too: Ga-word queries embed poorly with the
  // English embedding model, but an exact folded word match is the stronger signal. ---

  const hits: Array<{ mc: number; score: number; eng: string; ga: string; gaSide: boolean }> = [];
  const seen = new Set<string>();
  for (const n of expandedNodes) {
    const eng = String(n.metadata?.english ?? "").trim();
    const ga = String(n.metadata?.ga ?? "").trim();
    if (!eng || !ga) continue;
    const key = eng.toLowerCase();
    if (seen.has(key)) continue;
    const engWords = new Set(foldGa(eng.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? []);
    const gaWords = new Set(foldGa(ga.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? []);
    let mcEn = 0;
    let mcGa = 0;
    for (const w of queryWords) {
      if (engWords.has(w)) mcEn++; // whole-word overlap, either direction
      if (gaWords.has(w)) mcGa++;
    }
    const mc = Math.max(mcEn, mcGa);
    if (mc > 0) { seen.add(key); hits.push({ mc, score: n.score ?? 0, eng, ga, gaSide: mcGa > mcEn }); }
  }

  if (hits.length) {
    hits.sort((a, b) => b.mc - a.mc || b.score - a.score);
    const top = hits[0];
    const asLine = (h: (typeof hits)[number]) =>
      h.gaSide ? `**${h.ga}** is Ga for “${h.eng}”.` : `In Ga, “${h.eng}” is **${h.ga}**.`;
    // A clear winner = only hit, or it matches more query words than the runner-up.
    const clearWinner = hits.length === 1 || top.mc > hits[1].mc;
    if (clearWinner) {
      yield asLine(top);
    } else {
      // Genuinely ambiguous: list only the equally-best matches, not weaker partials.
      const tied = hits.filter((h) => h.mc === top.mc).slice(0, 5);
      yield tied.length === 1
        ? asLine(tied[0])
        : `Here's what I have in Ga:\n\n` +
          tied.map((h) => (h.gaSide ? `- **${h.ga}** → “${h.eng}”` : `- “${h.eng}” → **${h.ga}**`)).join("\n");
    }
    return;
  }

  if (nodes.length === 0) {
    // Log the knowledge gap for learning
    await logKnowledgeGap(env, query, 'general', 'General content not found');
    yield generateLearningNotFoundResponse(query, 'general');
    return;
  }

  // Real retrieved context — answer strictly from it, or refuse (never guess).
  const answer = await groundWithGuardrail(env, query, formatRetrievedContext(nodes), model);
  if (isNotFound(answer)) {
    // Log the knowledge gap for learning
    await logKnowledgeGap(env, query, 'general', 'Grounding failed - content not in context');
    yield generateLearningNotFoundResponse(query, 'general');
  } else {
    yield answer;
  }
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
      ["bible", "bibele", "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose", "verse", "chapter", "scripture"].some(
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
