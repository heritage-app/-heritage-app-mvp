/**
 * RAG orchestration (ported from app/rag/service.py).
 * Routes to a Bible engine or a General engine, grounds the answer, then streams
 * it through the Nii Obodai persona. Persistence + background summary/title after.
 */
import type { Env, ChatMessage, RagMode, VerseRecord } from "../types";
import { DEFAULT_TOP_K, MIN_RELEVANCE_SCORE, BOOK_MAP, BIBLE_BOOK_TOKENS } from "../config";
import { numToGa, foldGa, resolveGaCitation, parseEnglishNumber } from "./ga";
import { modernizeGa } from "./orthography";
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
import { isInflection, isPartialGa } from "./matching";
import {
  isDissatisfaction,
  isBareNegative,
  isAffirmative,
  isOurAsk,
  askedAboutFromAsk,
  cleanEnglish,
  parseEqualsPair,
  isContributeIntent,
  isNotFoundResponse,
  previousUserQuery,
  previousAssistantAnswer,
  recordNotHelpful,
  type TurnFlag,
} from "./flagging";
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
import { isGuestId } from "../auth/jwt";
import { runAgent, stepTerm } from "./agent";

/** How a turn was answered — returned to the client for the "how I found this" line. */
export interface TurnTrace {
  /** "engine:general" | "engine:bible" = deterministic, no model; "agent" = tool loop. */
  path: string;
  tools?: Array<{ tool: string; found: boolean; term?: string }>;
  model_calls: number;
  /** For agent turns: who wrote the reply (model text that passed the Ga check, or evidence). */
  composed_by?: string;
  ms: number;
}

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
  // Client-sent transcript tail for ephemeral guests: their turns are never
  // persisted, so the browser resends the last assistant message to keep
  // "continue / another story" follow-ups working statelessly.
  context?: string;
  /** The guest's previous question, paired with `context`. */
  prevQuery?: string;
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

/** Word-level normal form: folded, apostrophes dropped, single-spaced. */
const norm = (s: string) =>
  foldGa(s.toLowerCase()).replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// --- List/enumeration detection, shared by the engine's list handler and by
// the not-found flag (which lifts the asked TOPIC for the contribution card).
// Optional fillers may sit between the list verb and the topic: "list THE
// NAMES OF THE months", "what are ALL THE colours", "tell me things ABOUT
// the animals". ---
const LIST_TOPIC_WORDS =
  "months?(?:\\s+of\\s+the\\s+year)?|days?(?:\\s+of\\s+the\\s+week)?|weekdays|colou?rs|numbers?|numerals|animals|birds|insects|fish(?:es)?|body\\s+parts|family(?:\\s+(?:members|words|terms))?|foods?|weather(?:\\s+words)?|greetings|drinks|pronouns|fruits?|samai|symbols?";
const LIST_FILLER = "(?:all|the|names?|of|things\\s+about)\\s+";
const LIST_TOPIC_RE = new RegExp(
  `\\b(?:list|name|enumerate|what\\s+are|which\\s+are|how\\s+many|give\\s+me|show\\s+me|tell\\s+me|all(?:\\s+the)?)\\s+(?:${LIST_FILLER})*(?:\\d+\\s+|ga\\s+)?(?<topic>${LIST_TOPIC_WORDS})\\b`,
  "i"
);
// Whole-query fallback for a bare topic ("months", "the days", "the names of
// the months", "ga months") once trailing punctuation and "in ga" are gone.
const LIST_TOPIC_BARE_RE = new RegExp(
  `^(?:(?:ga|all|the|names?|of|things\\s+about)\\s+)*(${LIST_TOPIC_WORDS})$`,
  "i"
);

/** The topic a list/enumeration question asks for, or null. */
function listTopicOf(query: string): string | null {
  return (
    query.match(LIST_TOPIC_RE)?.groups?.topic ??
    norm(query.trim().replace(/[?!.]+$/, "").replace(/\s+(?:in|into)\s+ga(?:\s+language)?$/i, ""))
      .match(LIST_TOPIC_BARE_RE)?.[1] ??
    null
  );
}

/** Dedicated Bible RAG engine with strict archival fidelity. */
async function* askBible(
  env: Env,
  query: string,
  memoryWindow: ChatMessage[],
  topK: number,
  stream: boolean,
  model?: string,
  // Agent mode: stop (yield nothing) where the engine would otherwise call the
  // model or give up, so the agent can take over with its tools.
  strict = false
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

  const refMatch = qLow.match(
    new RegExp(`(${BIBLE_BOOK_TOKENS.join("|")})\\s+(\\d+)(?:[\\s:.]+(\\d+))?`)
  );
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
      ? `Hɛloo naanyo!\n\n${formatBibleQuote(v)}`
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

  // --- Deterministic exact lookup first (D1): citation queries must not depend
  // on the embedding API being up (quota, outage, cold start). ---
  let matchedMeta: VerseRecord | null = null;
  if (isSpecific && requestedV) {
    matchedMeta = await getVerse(env, requestedBook!, requestedCh!, requestedV);
    if (matchedMeta && isFormattableBibleRecord(matchedMeta)) {
      yield `Hɛloo naanyo!\n\n${formatBibleQuote(matchedMeta)}`;
      return;
    }
  }

  // --- Retrieval (semantic fallback — may be unavailable during AI quota exhaustion) ---
  const filters: RetrieveFilters | undefined = isSpecific
    ? { category: "bible", book: requestedBook!, chapter_num: requestedCh!, ...(requestedV ? { verse_num: requestedV } : {}) }
    : undefined;

  let nodes: Awaited<ReturnType<typeof retrieveContext>> = [];
  try {
    nodes = await retrieveContext(env, query, {
      topK: effectiveTopK,
      filters,
      allowedCategories: ["bible"],
    });
  } catch (e) {
    console.error("retrieveContext failed (embeddings unavailable):", e);
  }

  // --- Exact-match validation (prefer the deterministic D1 record when specific) ---
  let validationFailed = false;
  if (isSpecific && requestedV) {
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
    grounded = `Hɛloo naanyo!\n\n${formatBibleQuote(matchedMeta)}`;
  } else {
    // Non-exact bible request ("quote a verse", "a verse about light", etc.).
    const relevant = nodes.filter((n) => (n.score ?? 0) >= MIN_RELEVANCE_SCORE);
    if (relevant.length === 0) {
      if (strict) return;
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
        grounded = `Hɛloo naanyo!\n\n${quotes}`;
      } else {
        if (strict) return;
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
  model?: string,
  /** See askBible. */
  strict = false
): AsyncGenerator<string> {
  // Numeric range table: "count from 1 to 10"
  const rangeMatch = query.match(/(\d+)\s+to\s+(\d+)/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start > 0 && start <= end && end <= 999 && end - start <= 50) {
      const lines = ["Hɛloo naanyo!\n", "| Number | Ga Translation |", "| :--- | :--- |"];
      for (let n = start; n <= end; n++) lines.push(`| **${n}** | ${cap(numToGa(n))} |`);
      yield lines.join("\n"); // deterministic numeric table
      return;
    }
  }

  // --- Self-referential questions about Nii Obodai: answered directly so
  // they can never reach retrieval or the knowledge-gap flow. ---
  const selfStripped = query.trim().replace(/[?!.]+$/, "");
  const NII_MEANING_RE =
    /what does nii obodai mean|what is nii obodai|meaning of nii obodai/i;
  if (
    /^(?:who are you|what are you|what['’]?s your name|what is your name|who is nii obodai|what does nii obodai mean|what is nii obodai|meaning of nii obodai|what can you do|introduce yourself|tell me about yourself)\b/i.test(
      selfStripped
    )
  ) {
    yield NII_MEANING_RE.test(selfStripped)
      ? "**Nii** is a Ga honorific for a man — seniority or lineage. **Obodai** is a name; together Nii Obodai is the name your Ga guide answers to."
      : "Atsɛɔ mi **Nii Obodai** — your Ga guide. I answer Ga words, phrases, Bible verses, stories and culture from an archive people have checked — and when I don't know something, you can teach me.";
    return;
  }

  // --- Learn-intent ("teach me ga", "i want to learn ga"): answered with
  // concrete next steps. Fires before the dictionary path on purpose — "i am
  // learning ga" is itself a verified entry, but the ask here is the intent,
  // not the phrase. ---
  if (
    /^(?:teach\s+me\s+(?:ga|the\s+ga\s+language)|i\s+want\s+to\s+learn\s+ga|i\s+am\s+learning\s+ga|help\s+me\s+learn\s+ga|where\s+do\s+i\s+start|how\s+do\s+i\s+(?:learn|start\s+learning)\s+ga)\b/i.test(
      selfStripped
    )
  ) {
    yield "Let's begin. Greetings first: **Ojekoo** (good morning), **Oshwiee** (good afternoon), **M'naokoo** (good evening). Ask me: \"days of the week\", \"colours in ga\", \"count 1 to 10\", or \"use mi in a sentence\" — and I'll answer from the archive.";
    return;
  }

  const qLow = query.toLowerCase();
  const singleNums = [...query.matchAll(/\b(\d+)\b/g)].map((m) => m[1]);

  // Spelled-out English numbers ("number thirty-three in ga") count as the
  // numeric subject too; consumed number words are never content words.
  const numTokens = qLow.match(/[\p{L}\p{N}]+/gu) ?? [];
  const spelledNums: number[] = [];
  const numWordSet = new Set<string>();
  for (let i = 0; i < numTokens.length; ) {
    const parsed = parseEnglishNumber(numTokens.slice(i));
    if (parsed) {
      spelledNums.push(parsed.value);
      for (let j = i; j < i + parsed.consumed; j++) numWordSet.add(numTokens[j]);
      i += parsed.consumed;
    } else i++;
  }

  // Tokens that don't count as "content" when deciding what the query is about.
  const stop = new Set([
    "in", "ga", "the", "a", "an", "is", "are", "what", "how", "do", "does", "you",
    "say", "said", "tell", "me", "to", "of", "for", "your", "my", "i", "we", "they",
    "translate", "translation", "number", "numeral", "count", "spell", "word",
    "mean", "means", "meaning", "language", "english", "version",
    "so", "this", "that", "it", "he", "she", "can", "could", "would", "should",
    "please", "just", "like", "as", "at", "by", "with", "from", "about",
    "then", "there", "here", "where", "when", "why", "who", "which",
    "if", "or", "and", "but", "not", "no", "yes", "ok", "okay", "now",
    "his", "her", "their", "our", "us", "them", "these", "those"
  ]);
  // Content words: exclude stopwords AND bare numbers. Folded (ŋ→n, ɛ→e, ɔ→o) so
  // Ga words typed on a standard keyboard compare equal to archive spelling.
  // Typos of LONG stopwords ("emnglish", "translte") are treated as stopwords
  // too. The limits matter: applied to short words, one edit from a stopword
  // swallowed real vocabulary — "eat" (at), "dog" (do), "boy", "man", "two",
  // "son", "hand" — 39 English words from the archive's own translations. Those
  // queries then answered "I don't have it" for entries that were verified.
  const edit1 = (a: string, b: string): boolean => {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  };
  const nearStop = (w: string) => w.length >= 6 && [...stop].some((s) => s.length >= 5 && edit1(w, s));
  const queryWords = [...foldGa(qLow).matchAll(/[\p{L}\p{N}'-]+/gu)]
    .map((m) => m[0])
    .filter((w) => w.length > 1 && !stop.has(w) && !nearStop(w) && !/^\d+$/.test(w)
      && !w.split("-").every((p) => numWordSet.has(p)));

  // Coverage gate for English-side phrase-pair hits. A query built only from
  // question-framing words ("how old is the ga language") overlaps every
  // "how old are you?" entry without meaning it — with no content words any
  // English-side hit is coincidence, and with 3+ the record's English-or-Ga
  // tokens must cover at least 60% of them. Below that the whole-word match
  // gates are already strict enough. ("old"/"new"/"its" are framing here.)
  const coverStop = new Set([...stop, "old", "new", "its"]);
  const coverWords = norm(query).split(" ").filter((w) => w && !coverStop.has(w));
  const coversQuery = (eng: string, ga: string): boolean => {
    if (!coverWords.length) return false;
    if (coverWords.length < 3) return true;
    const have = new Set(
      [...norm(eng).split(" "), ...norm(ga).split(" ")].filter(Boolean)
    );
    return coverWords.filter((w) => have.has(w)).length >= Math.ceil(coverWords.length * 0.6);
  };

  // --- Number translation: fire only when a number is the actual subject (no other
  // content words), so "21 in Ga" works but "1 Samuel" / "21st May" don't misfire. ---
  const wantsNumber =
    /\b(?:in|to)\s+ga\b/.test(qLow) ||
    /\b(?:translate|translation|number|count|spell)\b/.test(qLow) ||
    /^\s*\d+\s*$/.test(query.trim()) ||
    // A bare spelled-out number ("thirty three") asks the same thing.
    (spelledNums.length > 0 && numWordSet.size === numTokens.length);
  if (wantsNumber && (singleNums.length || spelledNums.length) && queryWords.length === 0) {
    const num = singleNums.length ? parseInt(singleNums[0], 10) : spelledNums[0];
    const ga = numToGa(num);
    yield ga === String(num)
      ? `I can translate Ga numbers from 1 to 999 — **${num}** is outside that range.`
      : `**${num}** in Ga is **${ga}**.`;
    return;
  }

  // --- Dictionary lookup (SQL) ---
  // (norm is the module-level helper: folded, apostrophes dropped — so "lets"
  // meets "let's" — everything else a single space.)

  // The heritage Ga/English records, read straight out of the JSONL archives in
  // R2 — the same corpus phrase_overlap scans. Used by the "in a sentence"
  // usage search and by the semantic-empty fallback below.
  const readHeritageRecords = async (): Promise<Record<string, any>[]> => {
    try {
      const docs = await env.DB.prepare(
        "SELECT unique_path FROM documents WHERE category = 'heritage' AND unique_path LIKE '%.jsonl'"
      ).all<{ unique_path: string }>();
      const out: Record<string, any>[] = [];
      for (const row of docs.results ?? []) {
        const obj = await env.DOCS_BUCKET.get(row.unique_path);
        if (!obj) continue;
        for (const line of (await obj.text()).split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try {
            const rec = JSON.parse(t);
            // Bible/verse records carry `en`, not `english` — normalise so
            // every corpus record exposes the same field downstream.
            if (rec.english == null && rec.en != null) rec.english = rec.en;
            if (String(rec.ga ?? "").trim() && String(rec.english ?? "").trim()) out.push(rec);
          } catch { /* skip malformed lines */ }
        }
      }
      return out;
    } catch (e) {
      console.warn("heritage record scan failed:", e);
      return [];
    }
  };

  // Tautology guard: when the best answer's gloss just restates the word
  // ("homowo" -> "**Homowo** is Ga for 'homowo'"), the heritage records often
  // carry a real description under the same Ga name — prefer it. Returns the
  // longest description that is meaningfully longer (>=30 chars) than the
  // gloss, truncated at ~200 chars on a sentence/semicolon boundary.
  const longerDescription = async (needleStr: string, gloss: string): Promise<string | null> => {
    try {
      const fNeedle = foldGa(needleStr.trim());
      if (!fNeedle) return null;
      let best: string | null = null;
      for (const r of await readHeritageRecords()) {
        if (foldGa(String(r.ga ?? "").trim()) !== fNeedle) continue;
        const en = String(r.english ?? "").trim();
        if (en.length >= gloss.length + 30 && (!best || en.length > best.length)) best = en;
      }
      if (best && best.length > 200) {
        const cut = best.slice(0, 200);
        const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(";"));
        best = (at > 60 ? cut.slice(0, at + 1) : cut.trimEnd() + "…").trim();
      }
      return best;
    } catch {
      return null;
    }
  };

  // Is `gloss` another rendering of `needle`, or a different concept that
  // merely contains the word? "good morning" is not a rendering of "good";
  // "bad person", "the good" and "severely bad" are renderings of the word.
  // Negated glosses ("not good", "opposite of bad") name the opposite.
  const GENERIC_NOUNS = new Set([
    "person", "people", "man", "men", "woman", "women",
    "human", "being", "thing", "things", "one", "ones",
  ]);
  const isOtherRendering = (gloss: string, needle: string) => {
    if (/\b(not|no|never|opposite|opposed|contrary)\b/i.test(gloss)) return false;
    const words = norm(gloss).split(" ").filter(Boolean);
    if (!` ${words.join(" ")} `.includes(` ${needle} `)) return false;
    if (words.slice(-needle.split(" ").length).join(" ") === needle) return true;
    if (words.length > 4) return true;
    return words.some((w) => GENERIC_NOUNS.has(w));
  };

  // "Fɔŋ" lists "Efɔŋ" among its accepted spellings — the two rows are one
  // lexeme, not two renderings. Merge only when one row names the other as a
  // variant AND one folded form is a suffix of the other, so distinct forms
  // like Kpakpa/Kpaapa keep their own lines.
  const sameLexeme = (aGa: string, aSp: string[], bGa: string, bSp: string[]) => {
    const fa = foldGa(aGa), fb = foldGa(bGa);
    if (fa === fb) return true;
    const claims =
      aSp.map(foldGa).includes(fb) || [...bSp, bGa].map(foldGa).includes(fa);
    return claims && (fa.endsWith(fb) || fb.endsWith(fa));
  };
  // The whole phrase with only the question framing removed ("how do you say
  // X in ga" -> X), stopwords KEPT. Matching only the stopword-stripped words
  // answered "right now" with the Ga for "right", "this afternoon" with "good
  // afternoon", and could never find "brother in law" (searched as "brother
  // law") or single-word entries like "no" and "we".
  // A question framed toward Ga ("X in ga", "how do you say X") names X in
  // ENGLISH. Any match on the Ga side of an entry is then a coincidence of
  // spelling: "man" = folded "Maŋ" (herring), "shade" = the start of
  // "Shadebua" (hedgehog). Both matchers skip the Ga side for these.
  const towardGa = /\bin\s+ga\b|\bhow\s+(do\s+(you|i)\s+|to\s+)?say\b|\btranslate\b/.test(qLow);
  const phrase = norm(cleanEnglish(query));
  // ...but "what is" / "how do you say" can be the phrase itself: "what is
  // this?" is an entry, and stripping its framing searched for "this". Try the
  // query with only the trailing "in ga" removed first.
  const fullPhrase = norm(query.trim().replace(/[?!.]+$/, "").replace(/\s+(in|into)\s+ga(\s+language)?$/i, ""));
  const phraseWords = phrase ? phrase.split(" ").length : 0;
  // "tell me a Ga story" asks for a story, not the Ga word for "story" —
  // the dictionary step must not answer it ("In Ga, 'story' is Adesa").
  const asksToTell = /\b(tell|read|recite|sing|share|give|show)\b[\s\S]*\b(stor(?:y|ies)|tales?|folktales?|legends?|poems?|poetry|songs?)\b/i.test(query);

  // --- Lists: "list the months in ga", "colours", "the days of the week",
  // "name the animals". Named sets are resolved member by member from the
  // archive and gaps are printed, never skipped; generic topics list the
  // single-word entries of their category. Thin results fall through. ---
  const listTopic = listTopicOf(query);
  if (
    !asksToTell && listTopic &&
    !/\bin\s+a\s+sentence\b/i.test(query) &&
    !/^\s*(?:how\s+do\s+you\s+say|what\s+is\s+the\s+ga\s+for|translate)\b/i.test(query)
  ) {
    const tw = norm(listTopic).replace(/\s+of\s+the\s+(?:week|year)$/, "");
    const key =
      /^month/.test(tw) ? "months" :
      /^day|^weekday/.test(tw) ? "days" :
      /^colo/.test(tw) ? "colours" :
      /^num/.test(tw) ? "numbers" :
      /^bod/.test(tw) ? "body" :
      /^famil/.test(tw) ? "family" :
      /^food/.test(tw) ? "food" :
      /^weather/.test(tw) ? "weather" :
      /^fruit/.test(tw) ? "fruits" :
      /^fish/.test(tw) ? "fish" :
      /^drink/.test(tw) ? "drinks" :
      /^pronoun/.test(tw) ? "pronouns" :
      /^greet/.test(tw) ? "greetings" :
      /^insect/.test(tw) ? "insects" :
      /^bird/.test(tw) ? "birds" :
      /^animal/.test(tw) ? "animals" :
      /^samai|^symb/.test(tw) ? "samai" : null;
    const LISTS: Record<string, { title: string; members?: string[]; cats: string[]; htopics: string[] }> = {
      months: { title: "The months of the year in Ga (nyɔji)", cats: ["months"], htopics: ["months"],
        members: ["january","february","march","april","may","june","july","august","september","october","november","december"] },
      days: { title: "The days of the week in Ga", cats: ["days","phrase","time"], htopics: ["days"],
        members: ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"] },
      colours: { title: "Colours in Ga", cats: ["colours"], htopics: ["colours"],
        members: ["black","white","red","green","blue","yellow","brown","grey"] },
      numbers: { title: "Numbers 1 to 10 in Ga", cats: ["number"], htopics: ["numerals","numbers"] },
      animals: { title: "Animals in Ga", cats: ["animals"], htopics: ["animals"] },
      birds: { title: "Birds in Ga", cats: ["birds"], htopics: ["birds"] },
      insects: { title: "Insects in Ga", cats: ["insects"], htopics: ["insects"] },
      fish: { title: "Fish in Ga", cats: ["fish"], htopics: ["fish"] },
      body: { title: "Body parts in Ga", cats: ["body"], htopics: ["body"] },
      family: { title: "Family in Ga", cats: ["family"], htopics: ["family"] },
      food: { title: "Food in Ga", cats: ["food"], htopics: ["food"] },
      weather: { title: "Weather in Ga", cats: ["weather"], htopics: ["weather"] },
      greetings: { title: "Greetings in Ga", cats: ["greeting"], htopics: ["greetings"] },
      drinks: { title: "Drinks in Ga", cats: ["food"], htopics: ["drinks"] },
      pronouns: { title: "Pronouns in Ga", cats: [], htopics: ["pronouns"] },
      fruits: { title: "Fruits in Ga", cats: ["food"], htopics: ["fruits","food"] },
      samai: { title: "Ga samai symbols in the archive", cats: [], htopics: ["samai"] },
    };
    const spec = key ? LISTS[key] : null;
    if (spec) {
      try {
        const jList = (s: string | null | undefined): string[] => {
          try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
        };
        const gaToks = (s: string) => foldGa(s).match(/[\p{L}\p{N}'-]+/gu) ?? [];
        const glosses = (r: Record<string, any>) => [...jList(r.translations), ...jList(r.meanings)];
        const members = spec.members ?? [];
        const conds: string[] = [];
        const binds: string[] = [];
        if (spec.cats.length) {
          conds.push(`category IN (${spec.cats.map(() => "?").join(",")})`);
          binds.push(...spec.cats);
        }
        if (members.length) {
          conds.push(members.map(() => "(translations LIKE ? OR meanings LIKE ?)").join(" OR "));
          binds.push(...members.flatMap((m) => [`%${m}%`, `%${m}%`]));
        }
        let vRows: Record<string, any>[] = [];
        if (conds.length) {
          const vr = await env.DB.prepare(
            `SELECT headword, headword_normalized, translations, meanings FROM vocabulary
             WHERE (${conds.map((c) => `(${c})`).join(" OR ")})
               AND source IS NOT NULL AND TRIM(source) <> ''
               AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
             ORDER BY LENGTH(headword_normalized) ASC LIMIT 300`
          ).bind(...binds).all<Record<string, any>>();
          vRows = vr.results ?? [];
        }
        let recs: Record<string, any>[] | null = null;
        const getRecs = async () => (recs ??= await readHeritageRecords());
        const pushGa = (list: string[], seen: Set<string>, ga: string) => {
          const f = foldGa(ga);
          if (ga && !seen.has(f)) { seen.add(f); list.push(ga); }
        };

        let rows: string[] = [];
        let tail = "";
        if (key === "numbers") {
          rows = Array.from({ length: 10 }, (_, i) => `| **${i + 1}** | **${cap(numToGa(i + 1))}** |`);
          tail = "Ask for any number up to 999, or “count from 11 to 20”.";
        } else if (members.length) {
          for (const m of members) {
            const gas: string[] = [];
            const seen = new Set<string>();
            for (const r of vRows) {
              if (gaToks(String(r.headword ?? "")).length !== 1) continue;
              if (glosses(r).some((g) => norm(g) === m)) pushGa(gas, seen, String(r.headword));
            }
            if (!gas.length) {
              const hrs = (await getRecs()).filter((r) => {
                const tn = gaToks(String(r.ga ?? "")).length;
                return tn >= 1 && tn <= 2 && norm(String(r.english ?? "")) === m;
              });
              hrs.sort((a, b) => Number(spec.htopics.includes(norm(String(b.topic ?? "")))) - Number(spec.htopics.includes(norm(String(a.topic ?? "")))));
              for (const r of hrs) pushGa(gas, seen, modernizeGa(String(r.ga ?? "").trim()));
            }
            rows.push(`| ${cap(m)} | ${gas.length ? gas.map((g) => `**${g}**`).join(" / ") : "— (not in the archive yet)"} |`);
          }
          if (key === "months") tail = "Traditionally the Ga year began with **Gbo** (September). Ask about any month for its meaning.";
        } else {
          const seenGa = new Set<string>();
          const items: { en: string; ga: string }[] = [];
          for (const r of vRows) {
            const hw = String(r.headword ?? "").trim();
            const tn = gaToks(hw).length;
            if (tn < 1 || tn > 2) continue;
            const f = foldGa(hw);
            if (seenGa.has(f)) continue;
            seenGa.add(f);
            items.push({ en: glosses(r)[0] ?? "", ga: hw });
          }
          items.sort((a, b) => a.en.localeCompare(b.en));
          if (items.length < 5) {
            for (const r of await getRecs()) {
              if (!spec.htopics.includes(norm(String(r.topic ?? "")))) continue;
              const ga = modernizeGa(String(r.ga ?? "").trim());
              const tn = gaToks(ga).length;
              if (tn < 1 || tn > 2) continue;
              const f = foldGa(ga);
              const en = String(r.english ?? "").trim();
              if (seenGa.has(f) || !en) continue;
              seenGa.add(f);
              items.push({ en, ga });
            }
            items.sort((a, b) => a.en.localeCompare(b.en));
          }
          if (key === "samai") {
            // Samai records carry a long description in `english` — truncate
            // each at the first of ";", " — ", or 80 chars (ellipsis-safe)
            // and list the symbols by their Ga name.
            for (const it of items) {
              let e = it.en;
              const bounds = [e.indexOf(";"), e.indexOf(" — ")].filter((i) => i > 0);
              const at = bounds.length ? Math.min(...bounds) : -1;
              const cut = at > 0 && at <= 80 ? at : e.length > 80 ? 80 : -1;
              if (cut > 0) e = e.slice(0, cut).trimEnd() + "…";
              it.en = e;
            }
            items.sort((a, b) => a.ga.localeCompare(b.ga));
          }
          const shown = items.slice(0, 30);
          if (shown.length >= 3) {
            rows = shown.map((it) => `| ${cap(it.en)} | **${it.ga}** |`);
            tail = "Ask about any of these for more, or say “use X in a sentence”.";
          }
        }
        if (rows.length) {
          yield `**${spec.title}**\n\n| English | Ga |\n| :--- | :--- |\n${rows.join("\n")}${tail ? `\n\n${tail}` : ""}`;
          return;
        }
      } catch (e) {
        console.warn("[ask] list handler failed, falling through:", e);
      }
    }
  }

  // --- "Difference between A and B" / "A vs B" / "compare A and B": resolve
  // both terms in the verified vocabulary (Ga headword folded, or an exact
  // English translation) and answer them side by side. If neither term
  // resolves, fall through to the normal flow. ---
  const diffMatch =
    query.match(/(?:difference|distinction|contrast)(?:\s+between)?\s+["“']?(.+?)["”']?\s+(?:and|vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i) ||
    query.match(/^["“']?(.+?)["”']?\s+(?:vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i) ||
    query.match(/^compare\s+["“']?(.+?)["”']?\s+(?:and|with|to|vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i);
  if (diffMatch) {
    const unquote = (s: string) => (s ?? "").trim().replace(/^["“']+|["”']+$/g, "").trim();
    const termA = unquote(diffMatch[1]);
    const termB = unquote(diffMatch[2]);
    if (termA && termB) {
      try {
        const jArr = (s: string): string[] => {
          try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
        };
        const lookupTerm = async (term: string): Promise<{ ga: string; gloss: string } | null> => {
          const f = foldGa(norm(term));
          const n = norm(term);
          if (!f || !n) return null;
          const res = await env.DB.prepare(
            `SELECT headword, headword_normalized, translations, meanings FROM vocabulary
             WHERE (headword_normalized = ? OR translations LIKE ? OR meanings LIKE ?)
               AND source IS NOT NULL AND TRIM(source) <> ''
               AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
             ORDER BY LENGTH(translations) ASC LIMIT 20`
          ).bind(f, `%${n}%`, `%${n}%`).all<{
            headword: string; headword_normalized: string;
            translations: string; meanings: string;
          }>();
          let byTrans: { ga: string; gloss: string } | null = null;
          for (const r of res.results ?? []) {
            const ts = jArr(r.translations);
            const ms = jArr(r.meanings);
            if ((r.headword_normalized ?? "").trim() === f) {
              return { ga: r.headword, gloss: ts.slice(0, 2).join("; ") || ms[0] || term };
            }
            const exactT = ts.find((t) => norm(t) === n);
            if (!byTrans && exactT) byTrans = { ga: r.headword, gloss: exactT };
          }
          return byTrans;
        };
        const hitA = await lookupTerm(termA);
        const hitB = await lookupTerm(termB);
        if (hitA || hitB) {
          const line = (term: string, hit: { ga: string; gloss: string } | null) =>
            hit ? `- **${hit.ga}** — “${hit.gloss}”` : `- “${cap(term)}” — not in the archive yet.`;
          yield `${line(termA, hitA)}\n*vs*\n${line(termB, hitB)}`;
          return;
        }
      } catch (e) { console.warn("[ask] difference lookup failed, falling through:", e); }
    }
  }

  // Verified-vocabulary lookup shared by the pronunciation and
  // "is X a bad word" branches: a headword match wins, then an exact
  // English translation/meaning.
  const lookupVerified = async (
    term: string
  ): Promise<{ ga: string; gloss: string; spellings: string[] } | null> => {
    const f = foldGa(norm(term));
    const n = norm(term);
    if (!f || !n) return null;
    try {
      const res = await env.DB.prepare(
        `SELECT headword, headword_normalized, translations, meanings, variants FROM vocabulary
         WHERE (headword_normalized = ? OR translations LIKE ? OR meanings LIKE ?)
           AND source IS NOT NULL AND TRIM(source) <> ''
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
         ORDER BY LENGTH(translations) ASC LIMIT 20`
      ).bind(f, `%${n}%`, `%${n}%`).all<{
        headword: string; headword_normalized: string;
        translations: string; meanings: string; variants: string;
      }>();
      const jArr = (s: string): string[] => {
        try {
          const v = JSON.parse(s || "[]");
          return Array.isArray(v) ? v.map(String) : [];
        } catch { return []; }
      };
      let byTrans: { ga: string; gloss: string; spellings: string[] } | null = null;
      for (const r of res.results ?? []) {
        const ts = jArr(r.translations);
        const ms = jArr(r.meanings);
        if ((r.headword_normalized ?? "").trim() === f) {
          return {
            ga: r.headword,
            gloss: ts.slice(0, 3).join("; ") || ms[0] || term,
            spellings: jArr(r.variants).filter(Boolean),
          };
        }
        const exactT = [...ts, ...ms].find((t) => norm(t) === n);
        if (!byTrans && exactT) {
          byTrans = { ga: r.headword, gloss: exactT, spellings: jArr(r.variants).filter(Boolean) };
        }
      }
      return byTrans;
    } catch (e) {
      console.warn("[ask] verified lookup failed:", e);
      return null;
    }
  };

  // --- "How to pronounce X" / "pronunciation of X": the archive holds no
  // audio, but the verified entry is still worth showing — answer with the
  // headword, its gloss, and the Ga letter guide. Unknown terms fall through
  // to the normal lookup. ---
  const pronounceMatch =
    query.match(/\bhow\s+(?:do\s+(?:you|i|we)\s+|to\s+|can\s+i\s+)?pronounce\s+["“']?(.+?)["”']?\s*(?:in\s+ga(?:\s+language)?)?\s*[?!.]*$/i) ||
    query.match(/\bpronunciation\s+of\s+["“']?(.+?)["”']?\s*(?:in\s+ga(?:\s+language)?)?\s*[?!.]*$/i);
  if (pronounceMatch?.[1]) {
    const pTerm = pronounceMatch[1]
      .trim()
      .replace(/^(?:the\s+)?(?:word|phrase|term)\s+/i, "")
      .trim();
    const pHit = pTerm ? await lookupVerified(pTerm) : null;
    if (pHit) {
      yield `**${pHit.ga}** — “${pHit.gloss}”.` +
        (pHit.spellings.length ? ` *(also spelled: ${pHit.spellings.join(", ")})*` : "") +
        ` — Pronunciation/audio isn't in the archive yet; the letter guide: ɛ = 'eh', ɔ = 'aw', ŋ = 'ng', ã/ɛ̃/ɔ̃ nasal.`;
      return;
    }
  }

  // --- "Is X a bad/good/rude word": a meta question about a headword's
  // register. Answer with the verified gloss, then say whether the gloss
  // itself carries the asked judgement. Unknown terms fall through. ---
  const metaAsk = query.match(
    /^is\s+["“']?(.+?)["”']?\s+(?:a\s+|an\s+)?(bad|good|rude|offensive|polite|positive|negative|strong|swear|slang)\b/i
  );
  if (metaAsk?.[1]) {
    const mTerm = metaAsk[1]
      .trim()
      .replace(/^(?:the\s+)?(?:word|phrase|term)\s+/i, "")
      .trim();
    const mHit = mTerm ? await lookupVerified(mTerm) : null;
    if (mHit) {
      const adj = norm(metaAsk[2] ?? "");
      const agrees =
        adj.length >= 3 && norm(mHit.gloss).split(" ").some((w) => w === adj);
      yield `**${mHit.ga}** — “${mHit.gloss}”` +
        (mHit.spellings.length ? ` *(also spelled: ${mHit.spellings.join(", ")})*` : "") +
        `.\n${agrees ? "So yes — that's part of its meaning." : "Its gloss says nothing about that."}`;
      return;
    }
  }

  // "X in a sentence" wants an example, not the bare translation. Accepts
  // "use X in a sentence", "the word X in a sentence", "make a sentence
  // with X", "give me a sentence using X".
  const sentenceAsk =
    query.match(/\b(?:use|put|say)\s+(?:it\s+)?["“']?(.+?)["”']?\s+in\s+a\s+sentence\b/i) ||
    query.match(/^(?:(?:the\s+)?(?:word|phrase|term)\s+)?["“']?(.+?)["”']?\s+in\s+a\s+sentence\b/i) ||
    query.match(/\b(?:make|give|show|write|compose|form)\b(?:\s+me)?\s+a\s+sentence\s+(?:with|using|for|containing|that\s+uses?)\s+["“']?(.+?)["”']?\s*[?!.]*$/i);
  const sentenceWord = (sentenceAsk?.[1] ?? "")
    .trim()
    .replace(/^(?:the\s+)?(?:word|phrase|term)\s+/i, "")
    .replace(/^["“']+|["”']+$/g, "")
    .trim();
  // Pronouns ("use it in a sentence") name nothing — let the normal flow try.
  if (sentenceWord && !/^(it|this|that|them|one)$/i.test(sentenceWord)) {
    const needleS = norm(sentenceWord);
    const foldedS = foldGa(needleS);
    try {
      // Gather EVERY verified entry the term could mean — a word like "bad"
      // has several Ga renderings (Efɔŋ, Gbonyo, Basabasa) — plus the phrase
      // entries that show those words in use ("Nuu efɔŋ", "Gbɔmɔ efɔŋ").
      const sRes = await env.DB.prepare(
        `SELECT headword, headword_normalized, translations, meanings, examples, variants FROM vocabulary
         WHERE (headword_normalized = ? OR headword_normalized LIKE ?
                OR translations LIKE ? OR meanings LIKE ?)
           AND source IS NOT NULL AND TRIM(source) <> ''
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
         ORDER BY LENGTH(translations) ASC LIMIT 40`
      ).bind(foldedS, `%${foldedS}%`, `%${needleS}%`, `%${needleS}%`).all<{
        headword: string; headword_normalized: string; translations: string;
        meanings: string; examples: string; variants: string;
      }>();
      const rows = sRes.results ?? [];
      const j = (s: string): any[] => {
        try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
      };
      const hasNeedle = (s: string) => !!needleS && ` ${norm(s)} `.includes(` ${needleS} `);

      // Three buckets: the word itself (an entry whose translation is exactly
      // the term, or whose headword is the Ga term), single-word near-matches
      // (other renderings), and phrase entries that show the word in use.
      const exacts: Array<{ ga: string; gloss: string; spellings: string[] }> = [];
      const related: Array<{ ga: string; gloss: string }> = [];
      const usage: Array<{ ga: string; english: string }> = [];
      const examp: Array<{ ga: string; english: string }> = [];
      const seenHw = new Set<string>();
      for (const r of rows) {
        const trans: string[] = j(r.translations).map(String);
        const means: string[] = j(r.meanings).map(String);
        const hwKey = r.headword.toLowerCase();
        if (seenHw.has(hwKey)) continue;
        const exactT = trans.find((t) => norm(t) === needleS);
        const inside = [...trans, ...means].find(hasNeedle);
        const single = !/\s/.test((r.headword_normalized ?? "").trim());
        const hwHasNeedle = ` ${r.headword_normalized ?? ""} `.includes(` ${foldedS} `);
        if (r.headword_normalized === foldedS || exactT) {
          seenHw.add(hwKey);
          exacts.push({
            ga: r.headword,
            gloss: exactT ?? (trans.slice(0, 3).join("; ") || means[0] || sentenceWord),
            spellings: j(r.variants).map(String).filter(Boolean),
          });
          for (const e of j(r.examples)) {
            const g = typeof e === "string" ? e : String(e?.ga ?? e?.example_ga ?? "");
            const en = typeof e === "string" ? "" : String(e?.english ?? e?.en ?? "");
            if (g.trim()) examp.push({ ga: g.trim(), english: en.trim() });
          }
        } else if (inside || hwHasNeedle) {
          seenHw.add(hwKey);
          if (single) {
            // A single-word headword whose gloss names a different concept
            // ("Owɔŋ = good morning" for "good") or the opposite ("Ekpakpa =
            // the opposite of bad" for "bad") is not another rendering.
            const gloss = inside ?? trans[0] ?? means[0] ?? "";
            if (inside && isOtherRendering(inside, needleS)) related.push({ ga: r.headword, gloss });
          } else {
            usage.push({ ga: r.headword, english: inside ?? trans[0] ?? means[0] ?? "" });
          }
        }
      }

      // Merge orthographic variants of the same lexeme ("Fɔŋ" names "Efɔŋ"
      // among its spellings) so the answer doesn't list one word twice.
      for (let i = exacts.length - 1; i > 0; i--) {
        const c = exacts[i];
        const target = exacts.slice(0, i).find((e) =>
          sameLexeme(e.ga, e.spellings, c.ga, c.spellings)
        );
        if (target) {
          target.spellings = [
            ...new Set([...target.spellings, c.ga, ...c.spellings]),
          ].filter((s) => foldGa(s) !== foldGa(target.ga));
          exacts.splice(i, 1);
        }
      }

      if (exacts.length) {
        // Sentences, best first: curated examples, attested phrase entries
        // (phrases containing the primary headword rank first — "use Efɔŋ in
        // a sentence" should show Efɔŋ usage), then — only when both are
        // empty — a scan of the heritage sentence archives themselves. The
        // "no example" answer comes only after all three miss.
        const primaryWords = foldGa(exacts[0].ga).match(/[\p{L}\p{N}'-]+/gu) ?? [];
        const usesPrimary = (ga: string) => {
          const gw = foldGa(ga).match(/[\p{L}\p{N}'-]+/gu) ?? [];
          // Inflected forms count: "Misuɔmɔ" is suɔmɔ usage even though the
          // word never stands alone in it. Only whole tokens that share a
          // substring — never arbitrary substrings ("in" ⊂ "fine").
          return primaryWords.every((w) =>
            gw.some((t) => t === w || (w.length >= 4 && t.length >= 4 && (t.includes(w) || w.includes(t))))
          );
        };
        // A Ga needle never appears inside the translations of the phrases
        // that use it: "Misumɔ bo" is stored as "i love you" — the gloss,
        // not the word. Fetch usage phrases by the gloss words too, so a Ga
        // word asked "in a sentence" finds the entries that show it in use.
        // Collect usage-search keys only from NON-negated gloss clauses:
        // "bad; not good" offers "bad", never "good" — otherwise "Nyɔŋmɔ hi"
        // ("god is good") gets listed as a use of Efɔŋ.
        const NEGATED_CLAUSE = /\b(not|no|never|opposite|opposed)\b/i;
        const glossKeys = [
          ...new Set(
            exacts
              .flatMap((e) =>
                e.gloss
                  .split(";")
                  .filter((c) => !NEGATED_CLAUSE.test(c))
                  .flatMap((c) => norm(c).split(" "))
              )
              .filter((w) => w.length >= 4)
          ),
        ].slice(0, 5);
        if (glossKeys.length) {
          const clauses = glossKeys.map(() => "(translations LIKE ? OR meanings LIKE ?)").join(" OR ");
          const uRes = await env.DB.prepare(
            `SELECT headword, headword_normalized, translations, meanings FROM vocabulary
             WHERE (${clauses})
               AND source IS NOT NULL AND TRIM(source) <> ''
               AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
             ORDER BY LENGTH(headword_normalized) ASC LIMIT 40`
          ).bind(...glossKeys.flatMap((k) => [`%${k}%`, `%${k}%`])).all<{
            headword: string; headword_normalized: string;
            translations: string; meanings: string;
          }>();
          for (const r of uRes.results ?? []) {
            const hw = (r.headword_normalized ?? "").trim();
            if (!hw.includes(" ") || seenHw.has(r.headword.toLowerCase())) continue;
            const ts = j(r.translations).map(String);
            const ms = j(r.meanings).map(String);
            const en =
              ts.find((t) => norm(t).split(" ").some((w) => glossKeys.includes(w))) ??
              ms.find((t) => norm(t).split(" ").some((w) => glossKeys.includes(w))) ??
              ts[0] ?? ms[0] ?? "";
            usage.push({ ga: r.headword, english: en });
            seenHw.add(r.headword.toLowerCase());
          }
        }
        // One attested phrase for the asked word, then the other renderings in
        // use — "Nuu efɔŋ" and "Nuu gbonyo" side by side IS the variation.
        const byLen = (a: { ga: string }, b: { ga: string }) => a.ga.length - b.ga.length;
        const prim = usage.filter((u) => usesPrimary(u.ga)).sort(byLen);
        const rest = usage.filter((u) => !usesPrimary(u.ga)).sort(byLen);
        const usageTop = rest.length
          ? [prim[0], ...rest].filter(Boolean).slice(0, 3)
          : prim.slice(0, 3);
        let sents = [...examp, ...usageTop];
        if (!sents.length) {
          const recs = await readHeritageRecords();
          const seenS = new Set<string>();
          const toSent = (rec: Record<string, any>) => ({
            ga: modernizeGa(String(rec.ga).trim()),
            english: String(rec.english).trim(),
          });
          const push = (rec: Record<string, any>, into: Record<string, any>[]) => {
            const s = toSent(rec);
            const key = s.ga.toLowerCase();
            if (s.ga && !seenS.has(key)) { seenS.add(key); into.push(s); }
          };
          const gaHits: Record<string, any>[] = [];
          const enHits: Record<string, any>[] = [];
          // A usage example needs at least two Ga tokens and can't be the bare
          // headword itself — "Tsatsu — 'ant'" is the entry, not a sentence.
          const exactFolds = new Set(exacts.map((e) => foldGa(e.ga)));
          const isSent = (ga: string) => {
            const f = foldGa(ga);
            return (f.match(/[\p{L}\p{N}'-]+/gu) ?? []).length >= 2 && !exactFolds.has(f);
          };
          for (const rec of recs) {
            if (!isSent(String(rec.ga ?? ""))) continue;
            if (usesPrimary(String(rec.ga ?? ""))) gaHits.push(rec);
            else if (glossKeys.length && norm(String(rec.english ?? "")).split(" ").some((w) => glossKeys.includes(w))) enHits.push(rec);
          }
          // Bible verses live in their own table (the R2 docs are category
          // 'bible', outside the scan) — real Ga sentences worth showing.
          // The folded probe finds old-orthography forms ("suomo̱" → suomɔ).
          if (!gaHits.length) {
            try {
              const bRes = await env.DB.prepare(
                "SELECT ga, en AS english FROM bible_verses WHERE ga LIKE ? OR ga LIKE ? LIMIT 12"
              ).bind(`%${needleS}%`, `%${foldedS}%`).all<{ ga: string; english: string }>();
              for (const r of bRes.results ?? []) {
                if (isSent(String(r.ga)) && usesPrimary(String(r.ga))) gaHits.push(r as Record<string, any>);
              }
            } catch { /* verse probe is best-effort */ }
          }
          const tmp: { ga: string; english: string }[] = [];
          for (const r of gaHits) push(r, tmp);
          for (const r of enHits) push(r, tmp);
          sents = tmp.sort((a, b) => a.ga.length - b.ga.length);
        }
        const parts: string[] = [
          exacts.length > 1
            ? `“${cap(sentenceWord)}” in Ga can be ${exacts.map((e) => `**${e.ga}**`).join(" or ")}.`
            : `**${exacts[0].ga}** — “${exacts[0].gloss}”.`,
        ];
        if (exacts[0].spellings.length) parts.push(`*(also spelled: ${exacts[0].spellings.join(", ")})*`);
        if (related.length) {
          parts.push(
            `“${cap(sentenceWord)}” can also be:\n` +
            related.slice(0, 4).map((r) => `- **${r.ga}** — “${r.gloss}”`).join("\n")
          );
        }
        if (sents.length) {
          parts.push("Used in the archive:\n" + sents.slice(0, 3).map((s) => `- **${s.ga}**${s.english ? ` — “${s.english}”` : ""}`).join("\n"));
          yield parts.join("\n\n");
        } else {
          // The not-found marker wording is deliberate — it attaches the
          // contribution card so the user can teach the sentence.
          yield `${parts.join("\n\n")}\n\nI don't have a sentence using it yet. Do you know one? Share the Ga and English version and I'll add it.`;
        }
        return;
      } else {
        // No dictionary entry for the term — but a Ga-looking (or short) word
        // may still be USED in the archive. Scan the heritage sentences and
        // the Bible verses for the folded needle tokens themselves (the same
        // containment rule as usesPrimary above, minus the headword).
        const needleToks = foldedS.match(/[\p{L}\p{N}'-]+/gu) ?? [];
        const looksGa =
          /[ɛɔŋ]/.test(sentenceWord) ||
          /[̀-ͯ]/.test(sentenceWord.normalize("NFD")) ||
          foldedS.length <= 8;
        if (needleToks.length > 0 && needleToks.length <= 3 && looksGa) {
          const usesNeedle = (ga: string) => {
            const gw = foldGa(ga).match(/[\p{L}\p{N}'-]+/gu) ?? [];
            return needleToks.every((w) =>
              gw.some((t) => t === w || (w.length >= 4 && t.length >= 4 && (t.includes(w) || w.includes(t))))
            );
          };
          // A real usage needs at least two Ga tokens — a bare headword is the
          // entry, not a sentence.
          const isSent = (ga: string) =>
            (foldGa(ga).match(/[\p{L}\p{N}'-]+/gu) ?? []).length >= 2;
          const found: { ga: string; english: string }[] = [];
          const seenS = new Set<string>();
          const push = (ga: string, english: string) => {
            const key = ga.toLowerCase();
            if (ga && !seenS.has(key)) { seenS.add(key); found.push({ ga, english }); }
          };
          for (const rec of await readHeritageRecords()) {
            const ga = String(rec.ga ?? "").trim();
            if (isSent(ga) && usesNeedle(ga)) {
              push(modernizeGa(ga), String(rec.english ?? "").trim());
            }
          }
          try {
            const bRes = await env.DB.prepare(
              "SELECT ga, en AS english FROM bible_verses WHERE ga LIKE ? OR ga LIKE ? LIMIT 12"
            ).bind(`%${needleS}%`, `%${foldedS}%`).all<{ ga: string; english: string }>();
            for (const r of bRes.results ?? []) {
              const ga = String(r.ga ?? "").trim();
              if (isSent(ga) && usesNeedle(ga)) {
                push(modernizeGa(ga), String(r.english ?? "").trim());
              }
            }
          } catch { /* verse probe is best-effort */ }
          if (found.length) {
            found.sort((a, b) => a.ga.length - b.ga.length);
            yield `**${sentenceWord}** — I couldn't find its dictionary entry, but the archive uses it:\n` +
              found.slice(0, 3).map((s) => `- **${s.ga}**${s.english ? ` — “${s.english}”` : ""}`).join("\n");
            return;
          }
        }
      }
    } catch (e) { console.error("Sentence example lookup failed", e); }
    // No entry — fall through to the normal lookup/gap flow.
  }
  if (!asksToTell && ((queryWords.length > 0 && queryWords.length <= 3) || (phraseWords > 0 && phraseWords <= 5))) {
    const qStr = queryWords.length ? queryWords.join(" ") : phrase;
    const foldedQ = foldGa(qStr);
    const needle = norm(qStr);
    // WHOLE words only. A substring test let "lets" match "trip-LETS", so
    // "lets eat in ga" was answered with the Ga for "triplets".
    const hasPhrase = (hay: string) => ` ${norm(hay)} `.includes(` ${needle} `);
    // SQL is only a coarse net: the longest word, apostrophe-free. Precise
    // matching and ranking happen below.
    const probe = [...(needle || phrase).split(" ")].sort((a, b) => b.length - a.length)[0] ?? needle;
    const likePattern = `%${probe}%`;
    try {
      const vocabSearch = await env.DB.prepare(
        `SELECT headword, headword_normalized, meanings, translations, variants FROM vocabulary
         WHERE (headword_normalized = ?
                -- Apostrophes stripped DB-side too: the probe has none, so
                -- "lets" could otherwise never reach a stored "let's eat".
                OR REPLACE(REPLACE(translations, '''', ''), '’', '') LIKE ?
                OR REPLACE(REPLACE(meanings, '''', ''), '’', '') LIKE ?)
           AND source IS NOT NULL AND TRIM(source) <> ''
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
         -- Newest first among equals: an approved correction must beat the
         -- entry it corrects even if that one is somehow still verified.
         ORDER BY LENGTH(translations) ASC, verified_at DESC
         LIMIT 40`
      ).bind(foldedQ, likePattern, likePattern).all<{ headword: string; headword_normalized: string; meanings: string; translations: string; variants: string }>();

      if (vocabSearch.results && vocabSearch.results.length > 0) {
        // Rank rather than take the first row: a Ga headword match, then an
        // exact English translation, then the phrase inside a translation,
        // then inside a meaning. Previously LIMIT 5 over a substring LIKE could
        // return five near-misses and drop the exact entry entirely.
        // Folding makes English and Ga collide: "man" folds equal to the Ga
        // headword "Maŋ" (herring), "son" to "Sɔŋ" (lobster). A FOLDED Ga match
        // is therefore weaker than an exact English translation — someone who
        // meant Maŋ would usually have typed the ŋ — and when the question is
        // framed toward Ga ("X in ga", "how do you say X") it is never used.
        const typedGa = /[ɛɔŋ]/.test(qLow) || /[̀-ͯ]/.test(qLow.normalize("NFD"));
        const rawQ = qLow.replace(/[?!.]+$/, "").trim();

        let bestHit: { ga: string; eng: string; gaSide: boolean; rank: number } | null = null;
        for (const row of vocabSearch.results) {
          let transArr: string[] = [];
          let meanArr: string[] = [];
          try { transArr = JSON.parse(row.translations || "[]"); } catch {}
          try { meanArr = JSON.parse(row.meanings || "[]"); } catch {}

          const hw = (row.headword || "").toLowerCase().trim();
          const gaEng = transArr[0] || meanArr[0] || qStr;
          const exactFull = transArr.find((t) => norm(t) === fullPhrase);
          const exactPhrase = transArr.find((t) => norm(t) === phrase);
          const exact = transArr.find((t) => norm(t) === needle);
          const inTrans = transArr.find(hasPhrase);
          const inMean = meanArr.find(hasPhrase);

          let hit: { ga: string; eng: string; gaSide: boolean; rank: number } | null = null;
          if (typedGa && (hw === rawQ || ` ${rawQ} `.includes(` ${hw} `))) {
            // They typed the Ga itself, diacritics and all.
            hit = { ga: row.headword, eng: gaEng, gaSide: true, rank: 0 };
          } else if (exactFull && fullPhrase) {
            // The query, framing and all, is an entry ("what is this?").
            hit = { ga: row.headword, eng: exactFull, gaSide: false, rank: 0.4 };
          } else if (exactPhrase && phrase) {
            // The whole phrase, stopwords and all, is an entry's translation.
            hit = { ga: row.headword, eng: exactPhrase, gaSide: false, rank: 0.5 };
          } else if (exact) {
            hit = { ga: row.headword, eng: exact, gaSide: false, rank: 1 };
          } else if (!towardGa && row.headword_normalized === foldedQ) {
            hit = { ga: row.headword, eng: gaEng, gaSide: true, rank: 2 };
          } else if (inTrans) {
            hit = { ga: row.headword, eng: inTrans, gaSide: false, rank: 3 };
          } else if (inMean) {
            hit = { ga: row.headword, eng: inMean, gaSide: false, rank: 4 };
          }
          // An English-side hit whose tokens don't cover the query's content
          // words is a framing coincidence ("how old is the ga language" ~
          // "how old are you?") — reject it like a non-match. Whole-query
          // exact hits (rank < 1) are exempt: the query IS the entry.
          if (hit && !hit.gaSide && hit.rank >= 1 && !coversQuery(hit.eng, hit.ga)) hit = null;
          if (hit && (!bestHit || hit.rank < bestHit.rank)) bestHit = hit;
          if (bestHit?.rank === 0) break;
        }
        if (bestHit) {
          // A whole-word hit inside a LONGER phrase isn't the word itself:
          // "good" must not be claimed as "good night". Report the phrase it
          // appears in and ask for the word (same as the phrase-pair path).
          const contentWords = (s: string) =>
            (foldGa(s.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? [])
              .filter((w) => w.length > 1 && !stop.has(w) && !nearStop(w)).length;
          if (
            !bestHit.gaSide &&
            contentWords(bestHit.eng) > Math.max(contentWords(needle), 1)
          ) {
            const word = cleanEnglish(query);
            await logKnowledgeGap(env, query, "general", "Word only found inside a phrase");
            yield `I don't have a Ga word for “${word}” on its own yet — but it appears in this phrase from the archive:\n\n` +
              `**${modernizeGa(bestHit.ga)}** — “${bestHit.eng}”\n\nKnow the Ga word? Share it and I'll put it forward for review.`;
            return;
          }
          if (!bestHit.gaSide) {
            // Every entry that translates the term EXACTLY is an accepted
            // rendering — "bad man" is both **Nuu gbonyo** and **Nuu efɔŋ**.
            // Single-word rows containing the term in a longer translation or
            // meaning are other renderings ("bad" -> Gbonyo, Basabasa), and
            // multi-word rows are the word in use. Previously only the first
            // row survived the ranking; the rest of the archive's knowledge
            // about the word was thrown away.
            const exacts: Array<{ ga: string; meaning?: string; spellings: string[] }> = [];
            const related: Array<{ ga: string; gloss: string }> = [];
            const inUse = new Map<string, string[]>();
            const seenV = new Set<string>();
            for (const row of vocabSearch.results) {
              let tArr: string[] = [], mArr: string[] = [], vArr: string[] = [];
              try { tArr = JSON.parse(row.translations || "[]"); } catch {}
              try { mArr = JSON.parse(row.meanings || "[]"); } catch {}
              try { vArr = JSON.parse(row.variants || "[]"); } catch {}
              const hwKey = row.headword.toLowerCase();
              if (seenV.has(hwKey)) continue;
              const exactT = tArr.find((t) => norm(t) === needle);
              const inside = [...tArr, ...mArr].find(hasPhrase);
              const single = !/\s/.test((row.headword_normalized ?? "").trim());
              if (exactT) {
                seenV.add(hwKey);
                const meaning = mArr.find((m) => norm(m) !== norm(exactT));
                exacts.push({ ga: row.headword, meaning, spellings: vArr });
              } else if (inside) {
                seenV.add(hwKey);
                if (single) {
                  // Skip glosses naming a different concept or the opposite.
                  if (isOtherRendering(inside, needle)) related.push({ ga: row.headword, gloss: inside });
                } else {
                  const g = inUse.get(inside) ?? [];
                  g.push(row.headword);
                  inUse.set(inside, g);
                }
              }
            }
            // Merge orthographic variants of the same lexeme ("Fɔŋ" names
            // "Efɔŋ" among its spellings) so one word isn't listed twice.
            for (let i = exacts.length - 1; i > 0; i--) {
              const c = exacts[i];
              const target = exacts.slice(0, i).find((e) =>
                sameLexeme(e.ga, e.spellings, c.ga, c.spellings)
              );
              if (target) exacts.splice(i, 1);
            }
            // Groups that show the variation itself ("bad man" -> Nuu gbonyo
            // AND Nuu efɔŋ) lead the In-use list.
            const inUseGroups = [...inUse.entries()].sort((a, b) => b[1].length - a[1].length);
            const inUseLines = inUseGroups.slice(0, 4).map(
              ([eng, gas]) => `- “${eng}” → ${gas.slice(0, 3).map((g) => `**${g}**`).join(" or ")}`
            );
            const relatedLines = related.slice(0, 4).map((r) => `- **${r.ga}** — “${r.gloss}”`);

            if (exacts.length > 1) {
              const parts = [
                `In Ga, “${needle}” can be:`,
                ...exacts.slice(0, 4).map((e) => `- **${e.ga}**${e.meaning ? ` — “${e.meaning}”` : ""}`),
              ];
              if (relatedLines.length) parts.push("", "Other renderings in the archive:", ...relatedLines);
              if (inUseLines.length) parts.push("", "In use:", ...inUseLines);
              yield parts.join("\n");
              return;
            }
            if (queryWords.length === 1 && (related.length || inUse.size)) {
              const parts = [`In Ga, “${bestHit.eng}” is **${bestHit.ga}**.`];
              if (relatedLines.length) parts.push("", "Other renderings in the archive:", ...relatedLines);
              if (inUseLines.length) parts.push("", "In use:", ...inUseLines);
              yield parts.join("\n");
              return;
            }
          }
          // Tautology guard: "what is homowo" -> "**Homowo** is Ga for
          // 'homowo'" tells the asker nothing. Prefer a real description
          // stored under the same Ga name in the heritage records.
          if (norm(bestHit.eng) === needle) {
            const desc = await longerDescription(needle, bestHit.eng);
            if (desc) {
              yield `**${bestHit.ga}** — “${desc}”`;
              return;
            }
          }
          yield bestHit.gaSide
            ? `**${bestHit.ga}** is Ga for “${bestHit.eng}”.`
            : `In Ga, “${bestHit.eng}” is **${bestHit.ga}**.`;
          return;
        }
      }
    } catch (e) {
      console.error("Vocab lookup failed", e);
    }
  }

  // Deterministic fallback for browse intents when semantic retrieval is
  // empty — e.g. embeddings quota-blocked so the vectors were never indexed.
  // Reads the uploaded datasets straight out of R2 via the documents table;
  // records carry the same metadata shape as vectorized nodes.
  const BROWSE_FILE_PREFIXES: Record<"story" | "poem" | "song", string[]> = {
    poem: ["ga-poetry%"],
    song: ["ga-folkways-adowa%", "ga-poetry%"],
    story: ["ga-storybooks%"],
  };
  const browseArchiveRecords = async (
    kind: "story" | "poem" | "song"
  ): Promise<Record<string, any>[]> => {
    const prefixes = BROWSE_FILE_PREFIXES[kind];
    const where = prefixes.map(() => "unique_path LIKE ?").join(" OR ");
    try {
      const docs = await env.DB.prepare(
        `SELECT unique_path FROM documents WHERE ${where} ORDER BY unique_path`
      ).bind(...prefixes).all<{ unique_path: string }>();
      const out: Record<string, any>[] = [];
      for (const row of docs.results ?? []) {
        const obj = await env.DOCS_BUCKET.get(row.unique_path);
        if (!obj) continue;
        for (const line of (await obj.text()).split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try {
            const rec = JSON.parse(t);
            // Bible/verse records carry `en`, not `english` — normalise so
            // every corpus record exposes the same field downstream.
            if (rec.english == null && rec.en != null) rec.english = rec.en;
            if (String(rec.ga ?? "").trim() && String(rec.english ?? "").trim()) out.push(rec);
          } catch { /* skip malformed lines */ }
        }
      }
      return out;
    } catch (e) {
      console.warn("browseArchiveRecords fallback failed:", e);
      return [];
    }
  };

  // A record with no Ga side is a bare English note — print it as a plain
  // sentence, not a labelled "English:" line — and don't print the same line
  // twice. (A bare "does ga have tones" once surfaced as two raw "English: …"
  // lines.)
  const seenPairLines = new Set<string>();
  const pushPairLines = (lines: string[], ga: string, english: string) => {
    const g = modernizeGa(String(ga ?? "").trim());
    const e = String(english ?? "").trim();
    const out = g && e
      ? [`**Ga:** ${g}`, `**English:** ${e}`]
      : g ? [`**Ga:** ${g}`] : e ? [e] : [];
    for (const l of out) {
      const k = norm(l.replace(/\*\*/g, ""));
      if (k && seenPairLines.has(k)) continue;
      if (k) seenPairLines.add(k);
      lines.push(l);
    }
  };

  const phraseTopK = Math.max(topK, 20);
  const complexity = analyzeQueryComplexity(query);
  const dynamicTopK = complexity === 'high' ? 25 : complexity === 'medium' ? 15 : phraseTopK;

  // --- Browse intent: "tell me a story / poem / song". The raw phrasing embeds
  // poorly ("tell me ga story with the emnglish version" ranks story records too
  // low), so retrieval uses a canonical probe: intent kind + any topical content
  // words ("story about fishermen" → "story fishermen"). ---
  const browseIntent = ((): { topics: string[]; kind: "story" | "poem" | "song" } | null => {
    if (/\b(stor(?:y|ies)|tale|folktale|legend)\b/.test(qLow))
      return { topics: ["storybooks-ghana", "storybooks-ghana-title"], kind: "story" };
    if (/\b(poem|poetry|wiemo|wiemɔ)\b/.test(qLow)) return { topics: ["poetry"], kind: "poem" };
    if (/\b(songs?|lala)\b/.test(qLow)) return { topics: ["music-heritage", "poetry"], kind: "song" };
    return null;
  })();
  const INTENT_WORDS = new Set([
    "story", "stories", "tale", "folktale", "legend",
    "poem", "poetry", "song", "songs", "lala", "wiemo", "wiemɔ",
  ]);

  // --- Follow-up continuation: "tell me more / continue / next" right after a
  // story or poem serve. The previous answer embeds the served Ga text verbatim,
  // so anything already in the last assistant message can be excluded and the
  // same story continues with its not-yet-shown records. ---
  const lastAsst = [...memoryWindow].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const wantsMore =
    /\b(more|continues?|go on|keep going|carry on|what (?:happened|happens) next|and then)\b/i.test(qLow) ||
    /^\s*next[.!?\s]*$/i.test(qLow);
  if (wantsMore && lastAsst.includes("**Ga:**")) {
    const titleM = lastAsst.match(/story from \*([^*]+)\*|here is \*([^*]+)\*/i);
    const hint = (titleM?.[1] ?? titleM?.[2] ?? "").trim();
    const shown = new Set(
      [...lastAsst.matchAll(/\*\*Ga:\*\*\s*([\s\S]*?)(?=\n\*\*English:)/g)].map((m) => m[1].trim())
    );
    try {
      const { nodes: moreNodes } = await retrieveWithExpansion(env, `story ${hint}`.trim(), {
        topK: 40,
        allowedCategories: ["heritage", "stories", "corpus"],
      });
      // Semantic retrieval may be empty (embeddings quota-blocked) — continue
      // straight from the archive instead of giving up on the story.
      let candidates: Array<{ text: string; score: number; metadata: Record<string, any> }> = moreNodes;
      if (!candidates.length) {
        const recs = [
          ...(await browseArchiveRecords("story")),
          ...(await browseArchiveRecords("poem")),
          ...(await browseArchiveRecords("song")),
        ].filter((r) => !/-title$/.test(String(r.topic ?? "")));
        candidates = recs.map((m) => ({ text: "", score: 0, metadata: m }));
      }
      const groups = new Map<string, typeof candidates>();
      for (const n of candidates) {
        const md = n.metadata ?? {};
        if (!String(md.ga ?? "").trim() || !String(md.english ?? "").trim()) continue;
        const key = String(md.story ?? md.poem ?? md.title ?? "?");
        const g = groups.get(key) ?? [];
        g.push(n);
        groups.set(key, g);
      }
      // The continuing story is whichever group already contains a shown record.
      // Display text is modernized, so compare modernized forms of the archive
      // metadata — raw-vs-modernized mismatches would silently lose the group.
      const shownFolded = new Set([...shown].map((s) => modernizeGa(s)));
      let grp = [...groups.values()].find((g) =>
        g.some((n) => shownFolded.has(modernizeGa(String(n.metadata?.ga ?? "").trim())))
      );
      if (!grp && hint) {
        grp = [...groups.values()].find((g) =>
          g.some((n) => foldGa(String(n.metadata?.title ?? "")).includes(foldGa(hint)))
        );
      }
      if (grp) {
        const fresh = grp.filter(
          (n) => !shownFolded.has(modernizeGa(String(n.metadata?.ga ?? "").trim()))
        );
        if (fresh.length) {
          const lines = ["Here is more of the story:\n"];
          for (const n of fresh) {
            pushPairLines(lines, String(n.metadata.ga ?? ""), String(n.metadata.english ?? ""));
            lines.push("");
          }
          yield lines.join("\n");
          return;
        }
        yield "That is all of this story in my archive — ask me for *another story* and I'll tell a different one.";
        return;
      }
    } catch (e) {
      console.error("continuation retrieval failed:", e);
    }
    // Couldn't identify the same story — fall through to normal handling.
  }

  const probe = browseIntent
    ? `${browseIntent.kind} ${queryWords.filter((w) => !INTENT_WORDS.has(w)).join(" ")}`.trim()
    : query;

  // Use intelligent retrieval with expansion
  const { nodes: expandedNodes } = await retrieveWithExpansion(env, probe, {
    topK: dynamicTopK,
    allowedCategories: ["heritage", "stories", "corpus"],
  });

  // Semantic retrieval empty (embedding quota blocked, or unindexed file):
  // scan the heritage JSONL archives in R2 directly so phrase/vocab lookups
  // still answer through the same word-overlap matcher below.
  if (!expandedNodes.length && !browseIntent) {
    const recs = await readHeritageRecords();
    for (const rec of recs) expandedNodes.push({ text: "", score: 0, metadata: rec });
  }

  const nodes = expandedNodes.filter((n) => (n.score ?? 0) >= MIN_RELEVANCE_SCORE);

  // Serve browse intents bilingually and deterministically (never let the LLM
  // re-serialize — it drops the English side). Topic-scoped via record metadata.
  if (browseIntent) {
    const browseOk = (m: Record<string, any>) => {
      if (!browseIntent.topics.includes(String(m.topic ?? ""))) return false;
      if (browseIntent.kind === "song") return String(m.genre ?? "").startsWith("song") || !!m.poem;
      return String(m.english ?? "").trim() !== "" && String(m.ga ?? "").trim() !== "";
    };
    let withPair = expandedNodes.filter((n) => browseOk(n.metadata ?? {}));
    if (!withPair.length) {
      // Semantic retrieval came back empty — serve straight from the archive.
      // The file prefixes already scope the corpus, so the topic whitelist is
      // relaxed here (e.g. song records tagged topic "heritage" still count).
      const recs = await browseArchiveRecords(browseIntent.kind);
      let pool = recs;
      if (browseIntent.kind === "song") {
        // Prefer real song records (song-text/-fragment/-description genres);
        // fall back to poem records only if no song-tagged lines exist.
        const songs = recs.filter((m) => String(m.genre ?? "").startsWith("song"));
        pool = songs.length ? songs : recs.filter((m) => !!m.poem);
      } else if (browseIntent.kind === "story") {
        pool = recs.filter((m) => !/-title$/.test(String(m.topic ?? "")));
      } else {
        // Poem: drop glossary entries like the "Wiemo lala" terminology record.
        pool = recs.filter((m) => String(m.genre ?? "") !== "terminology");
      }
      withPair = pool.map((m) => ({ text: "", score: 0, metadata: m }));
    }
    if (withPair.length) {
      withPair.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const another = /\b(another|different|again|one more|new)\b/.test(qLow);
      // A bare "tell me a poem/story/song" carries no topical preference, so any
      // archive entry is an equally good answer — rotate instead of always
      // serving the top scorer. Topical queries keep relevance ordering.
      const hasTopic = queryWords.some((w) => !INTENT_WORDS.has(w));
      const pick = <T,>(arr: T[]): T =>
        arr[another || !hasTopic ? Math.floor(Math.random() * arr.length) : 0];
      // "Another" should never repeat the piece just served — exclude whichever
      // title the previous answer carried.
      const prevTitle = (lastAsst.match(/here is(?: a ga \w+ from)? \*([^*]+)\*/i)?.[1] ?? "").trim();
      const notPrev = (title: string) =>
        !prevTitle || !foldGa(title).includes(foldGa(prevTitle));
      const lines: string[] = [];

      if (browseIntent.kind === "story") {
        // Group candidates by story id → serve up to 3 pairs from a single story.
        const groups = new Map<string, typeof withPair>();
        for (const n of withPair) {
          const k = String(n.metadata?.story ?? n.metadata?.title ?? "?");
          const g = groups.get(k) ?? [];
          g.push(n);
          groups.set(k, g);
        }
        let glist = [...groups.values()].sort((a, b) => (b[0].score ?? 0) - (a[0].score ?? 0));
        // Re-asking bare ("tell me a story" again, or "another") shouldn't repeat
        // the story just shown; topical queries keep their relevance pick.
        if ((another || !hasTopic) && prevTitle) {
          const rest = glist.filter((g) =>
            g.every((n) => notPrev(String(n.metadata?.title ?? "")))
          );
          if (rest.length) glist = rest;
        }
        const grp = pick(glist);
        const title = String(grp[0].metadata?.title ?? "").trim();
        lines.push(title ? `Here is a Ga story from *${title}*:\n` : "Here is a Ga story:\n");
        for (const n of grp) {
          pushPairLines(lines, String(n.metadata.ga ?? ""), String(n.metadata.english ?? ""));
          lines.push("");
        }
      } else {
        // Poem/song: prefer complete "(full)" records, else the top-scored pair.
        const fulls = withPair.filter((n) =>
          /\([^)]*\bfull\b[^)]*\)/i.test(String(n.metadata?.title ?? ""))
        );
        let pool = fulls.length ? fulls : withPair;
        if ((another || !hasTopic) && prevTitle) {
          const rest = pool.filter((n) => notPrev(String(n.metadata?.title ?? "")));
          if (rest.length) pool = rest;
        }
        const node = pick(pool);
        const m = node.metadata as Record<string, any>;
        const title = String(m.title ?? "").replace(/\s*\((?:[^)]*,\s*)?full\)\s*/i, "").trim();
        lines.push(title ? `Here is *${title}*:\n` : `Here is a Ga ${browseIntent.kind}:\n`);
        pushPairLines(lines, String(m.ga ?? ""), String(m.english ?? ""));
        if (m.note) lines.push(`\n*${String(m.note).slice(0, 200)}*`);
      }
      yield lines.join("\n");
      return;
    }
  }

  // --- Phrase-pair lookup: answer with a pair only when the query names the English
  // or the Ga term (folded whole-word overlap), not merely a loose embedding match.
  // Scans below-threshold candidates too: Ga-word queries embed poorly with the
  // English embedding model, but an exact folded word match is the stronger signal. ---

  const hits: Array<{ mc: number; score: number; eng: string; ga: string; gaSide: boolean; image: string }> = [];
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
    let matchedCount = 0;
    for (const w of queryWords) {
      let matched = false;
      if (engWords.has(w)) { mcEn++; matched = true; }
      if (!towardGa && gaWords.has(w)) { mcGa++; matched = true; }
      // Near-matches, each for a specific reason and no looser:
      //  - English: an inflection of the same word — "alphabets" ~ "alphabet",
      //    "eating" ~ "eat". NOT a bare prefix: that let "cat" match
      //    "caterpillar".
      //  - Ga: a word being typed out — "otukwaj" ~ "otukwajaŋ" — so the query
      //    must be at least 4 letters and most of the word. NOT the reverse:
      //    that let "share" match the Ga token "sha", and "i would like to
      //    share" was answered with the Ga for "Hurry".
      if (!engWords.has(w) && [...engWords].some((e) => isInflection(w, e))) { mcEn++; matched = true; }
      if (!towardGa && !gaWords.has(w) && [...gaWords].some((g) => isPartialGa(w, g))) { mcGa++; matched = true; }
      if (matched) matchedCount++;
    }
    const mc = mcEn + mcGa;
    // A pair answer is only defensible when EVERY content word in the query
    // matched — otherwise one accidental overlap yields a confident non-answer
    // (e.g. "alphabets in Ga" matching the "a" in "I see a rainbow").
    if (queryWords.length > 0 && matchedCount === queryWords.length) {
      const gaSide = mcGa >= mcEn;
      // English-side pair sharing only the question framing ("how old is the
      // ga language" ~ "how old are you?") is a coincidence — drop the hit.
      if (gaSide || coversQuery(eng, ga)) {
        seen.add(key);
        hits.push({ mc, score: n.score ?? 0, eng, ga, gaSide, image: String(n.metadata?.image ?? "") });
      }
    }
  }

  if (hits.length) {
    // Prefer more query-word matches; break ties with shorter Ga phrase
    // (the base term like "Otukwajaŋ" wins over "Otukwajaŋ shishijee mli").
    hits.sort((a, b) => b.mc - a.mc || a.ga.length - b.ga.length || b.score - a.score);
    const gaShown = modernizeGa(hits[0].ga);
    // One or two English words asked for, found only inside a whole sentence
    // ("shade" in "Let us move into the shade"). Answering "In Ga, 'Let us
    // move into the shade' is …" reads as if the word itself were known.
    // Say what we have, and ask for the word itself.
    const engToks = foldGa(hits[0].eng.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? [];
    const engContent = engToks.filter((w) => w.length > 1 && !stop.has(w) && !nearStop(w)).length;
    // A definitional record leads with the queried concept ("needle — a
    // samai symbol…", "vigilance and unity…"), unlike a word that merely
    // appears mid-sentence ("let us move into the shade"). Leading-position
    // matches are the answer itself, not a hedge.
    const leadWindow = engToks.slice(0, queryWords.length + 3);
    const definitional = queryWords.length > 0 && queryWords.every((w) => leadWindow.includes(w));
    if (!hits[0].gaSide && queryWords.length <= 2 && engContent > queryWords.length && !definitional) {
      const word = cleanEnglish(query);
      await logKnowledgeGap(env, query, "general", "Word only found inside a sentence");
      yield `I don't have a Ga word for “${word}” on its own yet — but it appears in this phrase from the archive:\n\n` +
        `**${gaShown}** — “${hits[0].eng}”` +
        (hits[0].image ? `\n\n![${gaShown}](${hits[0].image})` : "") +
        `\n\nKnow the Ga word? Share it and I'll put it forward for review.`;
      return;
    }
    // Same tautology guard as the direct-lookup path: a gloss that merely
    // restates the asked word ("homowo" -> "homowo") is replaced by a real
    // description from the heritage records when one exists.
    const needleH = norm(queryWords.join(" "));
    if (needleH && norm(hits[0].eng) === needleH) {
      const desc = await longerDescription(needleH, hits[0].eng);
      if (desc) {
        yield `**${gaShown}** — “${desc}”` +
          (hits[0].image ? `\n\n![${gaShown}](${hits[0].image})` : "");
        return;
      }
    }
    yield (
      (hits[0].gaSide
        ? `**${gaShown}** is Ga for “${hits[0].eng}”.`
        : `In Ga, “${hits[0].eng}” is **${gaShown}**.`) +
      // Records can carry an image (Ga samai symbols, …) — the chat renders
      // markdown, so the image is emitted inline.
      (hits[0].image ? `\n\n![${gaShown}](${hits[0].image})` : "")
    );
    return;
  }

  if (strict) return; // the agent answers from here, or says not-found itself

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
    // Records with no Ga side reach the answer as bare "English: …" lines —
    // print them as plain sentences, and don't repeat near-identical lines.
    const seenAns = new Set<string>();
    const tidied: string[] = [];
    for (const raw of answer.split("\n")) {
      const line = raw.replace(/^(\s*[-*•]?\s*)\*{0,2}English:\*{0,2}\s+/i, "$1");
      const k = norm(line.replace(/\*\*/g, ""));
      if (k && seenAns.has(k)) continue;
      if (k) seenAns.add(k);
      tidied.push(line);
    }
    yield tidied.join("\n");
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
  // Agent mode: the deterministic engines answer first (no model, verified
  // data); the tool-using agent runs only when they have nothing.
  const agentMode = params.mode === "agent";
  const started = Date.now();

  const qLow = query.toLowerCase().trim();
  // Guests are ephemeral — answered but never written to D1.
  const ephemeral = isGuestId(userId);

  const greetings = ["hi", "hello", "hey", "hɛloo", "manye", "ojekoo", "good morning", "how are you"];
  if (greetings.includes(qLow)) {
    let full = "";
    for await (const t of streamPersona(env, query, "", [], model, stream)) {
      full += t;
      yield t;
    }
    if (conversationId && !ephemeral) {
      for await (const t of persistTurn(env, conversationId, query, full, userId)) yield t;
    }
    return;
  }

  const citationMatch = new RegExp(
    `(${BIBLE_BOOK_TOKENS.join("|")})\\s+\\d+(?:[\\s:.]+\\d+)?`
  ).test(qLow);
  if (citationMatch) mode = "bible";

  if (conversationId === null) {
    conversationId = crypto.randomUUID();
    if (!ephemeral) {
      try {
        await initializeSession(env, conversationId, userId);
      } catch (e) {
        // Best-effort: a session-insert failure (e.g. D1 write quota) must not
        // kill the answer — the turn can still be answered without persistence.
        console.error("Session init failed:", e);
      }
    }
  }

  const ctx = await getConversationContextSafe(env, conversationId, userId, model);
  const memoryWindow = ctx;
  // Guests persist nothing, so their window is always empty — rehydrate the
  // last assistant turn from the client-sent context so continuation logic
  // (which reads memoryWindow) works for them too.
  if (
    params.context &&
    !memoryWindow.some((m) => m.role === "assistant")
  ) {
    // The question first, then its answer — flagging reads the question to
    // know what a guest's "that's wrong" is about.
    if (params.prevQuery?.trim()) {
      memoryWindow.push({ role: "user", content: params.prevQuery.trim().slice(0, 500) });
    }
    memoryWindow.push({ role: "assistant", content: params.context });
  }

  const correctionResponse = await detectAndHandleCorrection(env, query, memoryWindow, userId);
  if (correctionResponse) {
    yield correctionResponse;
    if (!ephemeral) {
      for await (const t of persistTurn(env, conversationId, query, correctionResponse, userId)) yield t;
    }
    // Title/summary are generated lazily by getConversationContext when missing
    // and persisted there — no per-turn regeneration needed here.
    return;
  }

  // --- An offer to teach ("i would like to share", "let me teach you") ---
  // Not a question: searching it answered with a coincidental match, and
  // logging it filled knowledge_gaps with offers of help. Open the form.
  if (isContributeIntent(query)) {
    // Offered right after we asked about a word ("I don't have 'god' yet")?
    // Then that word is what they mean to teach — prefill it.
    const prevA = previousAssistantAnswer(memoryWindow);
    const about = isOurAsk(prevA) ? cleanEnglish(askedAboutFromAsk(prevA)) : "";
    const reply = about
      ? `Wonderful — thank you! Put the Ga for “${about}” below and I'll put it forward for review.`
      : "Wonderful — thank you! What would you like to share? Put the English and the Ga below and I'll put it forward for review.";
    yield reply;
    const flag: TurnFlag = { kind: "contribute", english: about, open: "form" };
    if (!ephemeral) {
      for await (const t of persistTurn(env, conversationId, query, reply, userId, flag)) yield t;
    } else {
      yield flagOnlyMeta(flag);
    }
    return;
  }

  // --- A reply to OUR question ("Do you know the right Ga for X?") ---
  // The card offers YES/NO buttons, but people type. A typed "yes" was being
  // searched ("I don't have 'yes' yet") and a typed "no" read as a fresh
  // complaint. Answer them as what they are: replies to our ask.
  {
    const prevA = previousAssistantAnswer(memoryWindow);
    if (isOurAsk(prevA) && (isAffirmative(query) || isBareNegative(query))) {
      const about = cleanEnglish(askedAboutFromAsk(prevA) || previousUserQuery(memoryWindow));
      if (isAffirmative(query)) {
        // When the subject is itself a Ga word ("Suɔmɔ in a sentence"), the
        // contribution wanted is a usage example, not "the Ga for" it.
        let gaTerm = "";
        if (about) {
          try {
            const hw = await env.DB.prepare(
              `SELECT headword FROM vocabulary WHERE headword_normalized = ?
                 AND verified_at IS NOT NULL AND TRIM(verified_at) <> '' LIMIT 1`
            ).bind(foldGa(about)).first<{ headword: string }>();
            if (hw) gaTerm = hw.headword;
          } catch { /* fall through to the generic ask */ }
        }
        const reply = gaTerm
          ? `Oyiwaladɔŋ! Type a sentence using “${gaTerm}” — Ga and English — in the box below and I'll put it forward for review.`
          : about
            ? `Oyiwaladɔŋ! Type the Ga for “${about}” in the box below and I'll put it forward for review.`
            : "Oyiwaladɔŋ! Type it in the box below and I'll put it forward for review.";
        yield reply;
        const flag: TurnFlag = {
          kind: isNotFoundResponse(prevA) ? "not_found" : "wrong",
          english: about,
          ga: gaTerm || undefined,
          open: "form",
        };
        if (!ephemeral) {
          for await (const t of persistTurn(env, conversationId, query, reply, userId, flag)) yield t;
        } else {
          yield flagOnlyMeta(flag);
        }
      } else {
        const bow = "No problem at all. I've added it to the list the keepers work through — thank you for asking.";
        yield bow;
        if (!ephemeral) {
          for await (const t of persistTurn(env, conversationId, query, bow, userId)) yield t;
        }
      }
      return;
    }
  }

  // --- Flagged turn: the user is telling us the last answer was wrong ---
  // This runs AFTER detectAndHandleCorrection, which handles the better case
  // where they also supplied the right answer. Here they have not, so the turn
  // is never searched and never logged as a knowledge gap — doing either is
  // what turned "its close but not the exact" into a phonetics footnote and
  // filled knowledge_gaps with complaints.
  if (isDissatisfaction(query, memoryWindow)) {
    const askedAbout = previousUserQuery(memoryWindow);
    const wasNotFound = isNotFoundResponse(previousAssistantAnswer(memoryWindow));

    // A bare "no" right after we asked for help means "I don't know it
    // either", not "you are wrong". Let them go, and keep the gap logged.
    if (wasNotFound && isBareNegative(query)) {
      const bow = "No problem at all. I've added it to the list the keepers work through — thank you for asking.";
      yield bow;
      if (!ephemeral) {
        for await (const t of persistTurn(env, conversationId, query, bow, userId)) yield t;
      }
      return;
    }

    if (!ephemeral) {
      await recordNotHelpful(env, conversationId, userId, query);
    }

    const reply = askedAbout
      ? `Sorry about that — I got it wrong. Do you know the right Ga for “${cleanEnglish(askedAbout)}”?`
      : "Sorry about that — I got it wrong. Do you know what it should say?";
    yield reply;

    const flag: TurnFlag = { kind: "wrong", english: cleanEnglish(askedAbout) };
    if (!ephemeral) {
      for await (const t of persistTurn(env, conversationId, query, reply, userId, flag)) yield t;
    } else {
      // Guests persist nothing, but the card is theirs too.
      yield flagOnlyMeta(flag);
    }
    return;
  }

  let targetMode = mode;
  if (targetMode === "auto" || targetMode === "agent") {
    const isBible =
      ["bible", "bibele", "verse", "chapter", "scripture"].some((b) => qLow.includes(b)) ||
      BIBLE_BOOK_TOKENS.some((b) => qLow.includes(b)) ||
      (qLow.includes(":") && /\d/.test(qLow));
    targetMode = isBible ? "bible" : "general";
  }

  let full = "";
  let trace: TurnTrace | undefined;
  try {
    const engine =
      targetMode === "bible"
        ? askBible(env, query, memoryWindow, topK, stream, model, agentMode)
        : askGeneral(env, query, memoryWindow, topK, stream, model, agentMode);

    for await (const token of engine) {
      full += token;
      yield token;
    }

    if (agentMode) {
      if (full.trim()) {
        trace = { path: `engine:${targetMode}`, model_calls: 0, ms: Date.now() - started };
      } else {
        const scope = targetMode === "bible" ? "bible" : "general";
        let text: string | null = null;
        // The tool loop costs up to four model calls — cap it per user.
        const limited = env.AGENT_LIMITER
          ? !(await env.AGENT_LIMITER.limit({ key: userId }).catch(() => ({ success: true }))).success
          : false;
        if (limited) {
          text = "I'm answering a lot of questions right now — please ask again in a minute.";
          trace = { path: "agent:rate_limited", model_calls: 0, ms: Date.now() - started };
        } else {
          const r = await runAgent(env, query, memoryWindow, scope);
          text = r.text;
          trace = {
            path: "agent",
            tools: r.steps.map((st) => ({ tool: st.tool, found: st.found, term: stepTerm(st) })),
            model_calls: r.modelCalls,
            composed_by: r.composedBy,
            ms: Date.now() - started,
          };
          if (!text) {
            // Logged here, once, by the system — never by the model.
            await logKnowledgeGap(env, query, "agent", "Engines and agent tools found nothing");
            text = generateLearningNotFoundResponse(query, scope);
          }
        }
        full = text;
        yield text;
      }
    }
  } catch (e) {
    console.error("RAG Router Error:", e);
    yield "Hɛloo! I'm having trouble routing your request. Please try again in a moment.";
    return;
  }

  // Persistence is best-effort — a saveInteraction/updateActivity failure
  // (e.g. D1 daily write quota) must never corrupt an already-good answer.
  // Guests skip persistence entirely (ephemeral conversations).
  // The archive had nothing: offer the contribution card instead of leaving
  // the invitation as prose the user can't act on. The gap itself is already
  // logged by the engine — this only adds the affordance.
  // An enumeration question that still missed ("list the names of the
  // months") flags its TOPIC rather than the whole question, so the
  // contribution card asks for something a speaker can answer ('Do you know
  // the Ga for "months"?'). The same matcher the list handler uses extracts
  // it — a match that produced no rows still names the gap correctly.
  const flagTopic = listTopicOf(query);
  let notFoundFlag: TurnFlag | undefined = isNotFoundResponse(full)
    ? { kind: "not_found", english: flagTopic ?? cleanEnglish(query) }
    : undefined;

  // "Suɔmɔ in a sentence" produced a not-found flag whose `english` is the Ga
  // word itself — the card would ask "Do you know the Ga for 'Suɔmɔ'?", which
  // is backwards. When the subject is a known Ga headword, carry it in `ga`
  // and prefill `english` with its gloss so the contribution has a direction.
  if (notFoundFlag?.english) {
    try {
      const hw = await env.DB.prepare(
        `SELECT headword, translations FROM vocabulary
         WHERE headword_normalized = ?
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> '' LIMIT 1`
      ).bind(foldGa(notFoundFlag.english)).first<{ headword: string; translations: string }>();
      if (hw) {
        const gloss = String((() => { try { return JSON.parse(hw.translations || "[]")[0] ?? ""; } catch { return ""; } })());
        notFoundFlag = { ...notFoundFlag, ga: hw.headword, english: gloss || notFoundFlag.english };
      }
    } catch { /* flag stays as-is */ }
  }

  if (!ephemeral) {
    for await (const t of persistTurn(env, conversationId, query, full, userId, notFoundFlag, trace)) yield t;
  } else if (notFoundFlag || trace) {
    yield flagOnlyMeta(notFoundFlag, trace);
  }
}

/**
 * The __META__ trailer for a turn that is not persisted (guests). Carries the
 * flag so the client can still render the contribution card; there is no
 * interaction id because nothing was saved.
 */
function flagOnlyMeta(flag?: TurnFlag, trace?: TurnTrace): string {
  return `\n__META__:${JSON.stringify({ flag, trace })}\n`;
}

/** Save a turn + emit the __META__ trailer; swallows its own errors. */
async function* persistTurn(
  env: Env,
  conversationId: string,
  query: string,
  answer: string,
  userId: string,
  flag?: TurnFlag,
  trace?: TurnTrace
): AsyncGenerator<string> {
  try {
    const row = await saveInteraction(env, conversationId, query, answer, userId);
    // A flag rides along in the same marker the client already parses, so the
    // contribution card can be rendered against this exact interaction.
    const meta: { interactionId: string; flag?: TurnFlag; trace?: TurnTrace } = { interactionId: row.id };
    if (flag) meta.flag = { ...flag, interaction_id: row.id };
    if (trace) meta.trace = trace;
    yield `\n__META__:${JSON.stringify(meta)}\n`;
  } catch (e) {
    console.error("saveInteraction failed:", e);
  }
  try {
    await updateActivity(env, conversationId);
  } catch (e) {
    console.error("updateActivity failed:", e);
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

async function detectAndHandleCorrection(
  env: Env,
  query: string,
  memoryWindow: ChatMessage[],
  userId?: string
): Promise<string | null> {
  const lastAssistanceMessage = memoryWindow.filter(m => m.role === 'assistant').pop();

  // FIX 1: Match ALL not-found response invitation variants
  const wasPrompted = lastAssistanceMessage && (
    lastAssistanceMessage.content.includes("Share both Ga and English") ||
    lastAssistanceMessage.content.includes("Share the Ga and English") ||
    lastAssistanceMessage.content.includes("I'll add it")
  );

  const qLow = query.toLowerCase().trim();

  // FIX 2: Broader correction detection — covers subject-first, negation, and explicit patterns
  const explicitCorrection =
    /^(actually|correction|no\b|nah\b|wrong\b|wait\b|thats?\s+not)/.test(qLow) ||
    // "X means/is Y in Ga" or "X in Ga means/is Y" (both directions)
    /\b(means?|is)\s+.+\bin\s+ga\b/i.test(qLow) ||
    /\bin\s+ga\b.+\b(means?|is)\b/i.test(qLow) ||
    // "the Ga word for X is Y" or "Ga for X is Y"
    /\b(ga|ga\s+word)\s+(for|is|means)\b/i.test(qLow) ||
    // "X ga for Y" or "Y ga for X"
    /\bga\s+for\b/i.test(qLow) ||
    qLow.includes("=");
    // NOTE: ':' deliberately excluded — every Bible citation ("John 3:16")
    // contains one and would wrongly trigger correction parsing.

  // FIX 6: Reduce false positives — "no" alone without correction context is not a correction
  const isBareNo = /^(no|nah|nope)[.!?]*$/i.test(qLow);
  if (!wasPrompted && isBareNo) return null;

  if (!wasPrompted && !explicitCorrection) {
    return null;
  }

  // FIX 3: Include conversation context so the LLM knows what's being corrected
  const prevBotMessage = lastAssistanceMessage?.content?.slice(0, 300) || "";

  const prompt = `You are a Ga language correction assistant. The user is correcting a translation mistake.

${prevBotMessage ? `What the assistant previously said (INCORRECT or INCOMPLETE):
"${prevBotMessage}"

` : ""}User's correction message: "${query}"

Your task:
1. Identify the English word/phrase being corrected.
2. Identify the correct Ga translation the user is providing.
3. Ignore correction markers like "no", "actually", "wrong", "wait" — they are NOT part of the terms.
4. If the user says "no X in Ga means/is Y", then X is English and Y is Ga.

Respond ONLY with valid JSON:
{"english": "the english word or phrase", "ga": "the correct ga word or phrase"}
If you cannot determine both terms, return {"english": "", "ga": ""}.`;

  // Deterministic first: "X = Y" names its own sides, and the side carrying Ga
  // letters is the Ga. The model is only asked when the direction is genuinely
  // unclear — and if it is unavailable (the free-tier daily allowance runs
  // out), the pair is still kept rather than searched and lost.
  const eq = parseEqualsPair(query);
  let pair: { english: string; ga: string; assumed: boolean } | null =
    eq && !eq.assumed ? eq : null;

  if (!pair) {
    try {
      const response = await chat(env, [{ role: 'system', content: prompt }], { temperature: 0 });
      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        const json = JSON.parse(match[0]);
        if (json.english?.trim() && json.ga?.trim()) {
          pair = { english: json.english.trim(), ga: json.ga.trim(), assumed: false };
        }
      }
    } catch (e) {
      console.error("Correction model unavailable:", e);
    }
  }
  // Model unavailable or unsure, but the user plainly wrote a pair: keep it
  // with the "english = ga" convention and let a reviewer confirm the order.
  if (!pair && eq) pair = eq;

  try {
    if (pair) {
      const eng = pair.english;
      const ga = pair.ga;

      // Record the contribution
      const contribResult = await handleUserContribution(env, eng, ga, "general", userId);

      // Never claim to have learned something that was not saved. On the free
      // tier D1 refuses writes once the daily limit is hit.
      if (!contribResult.success) {
        return `Oyiwaladɔŋ for teaching me **${eng}** → **${ga}** — but I couldn't save it just now. ` +
          `Please send it again a little later so it isn't lost.`;
      }

      // Tiered auto-promotion: a single user's correction should NOT enter the
      // verified KB on its own — it could be wrong. Instead:
      //  - 1st contribution (no prior, no conflict): stage into vocabulary with
      //    verified_at = NULL so it's invisible to lookups (integrity gate blocks it).
      //  - 2nd agreeing contribution: upgrade the staged row to verified (set
      //    verified_at = now) AND embed into Vectorize so it's semantically retrievable.
      //  - Conflict: leave for admin resolution; don't touch vocabulary.
      if (contribResult.success && !contribResult.hasConflict) {
        try {
          const foldedGa = foldGa(ga);
          const now = new Date().toISOString();

          // Is there already a staged (unverified) row for this Ga term?
          const staged = await env.DB.prepare(
            `SELECT id, verified_at FROM vocabulary
             WHERE headword_normalized = ? AND source = 'user_correction'`
          ).bind(foldedGa).first<{ id: string; verified_at: string | null }>();

          if (staged && !staged.verified_at) {
            // Second agreeing contribution → verify + embed into Vectorize.
            await env.DB.prepare(
              `UPDATE vocabulary SET verified_at = ?, meanings = ?, translations = ? WHERE id = ?`
            ).bind(now, JSON.stringify([eng]), JSON.stringify([eng]), staged.id).run();

            try {
              const { embed } = await import("./embeddings");
              const nodeText = `English: ${eng}\nGa: ${ga}`;
              const [vector] = await embed(env, [nodeText]);
              if (vector) {
                await env.VECTORIZE.upsert([{
                  id: `contrib:${staged.id}`,
                  values: vector,
                  metadata: {
                    category: "heritage",
                    english: eng,
                    ga,
                    source: "user_correction",
                    text: nodeText,
                  },
                }]);
              }
            } catch (e) {
              console.error("Failed to embed verified correction into Vectorize:", e);
            }
          } else if (!staged) {
            // First contribution → stage as unverified (won't surface in lookups).
            const vocabId = crypto.randomUUID();
            await env.DB.prepare(
              `INSERT OR REPLACE INTO vocabulary
               (id, headword, headword_normalized, meanings, translations, category, source, verified_at)
               VALUES (?, ?, ?, ?, ?, ?, 'user_correction', NULL)`
            ).bind(
              vocabId,
              ga,
              foldedGa,
              JSON.stringify([eng]),
              JSON.stringify([eng]),
              "general"
            ).run();
          }
          // If staged && verified_at is set, a prior agreeing pair already verified
          // this term — just increment agreement via handleUserContribution (done).
        } catch (e) {
          console.error("Failed to tier-promote correction to vocabulary:", e);
        }
      }

      // Re-answer the original question with the corrected translation
      const originalQuery = lastAssistanceMessage
        ? memoryWindow.filter(m => m.role === 'user').pop()?.content || query
        : query;

      const wasStaged = !contribResult.hasConflict;
      const orderNote = pair.assumed
        ? `

(I read it as English = Ga. If it's the other way round, say so and a reviewer will swap it.)`
        : "";
      return `Oyiwaladɔŋ (Thank you)! I've noted that **${eng}** is **${ga}** in Ga.${orderNote}

${contribResult.hasConflict
  ? `Note: This differs from a previous answer, so it will be reviewed by an admin.`
  : wasStaged
    ? `I've noted this. If another speaker confirms it, it'll be added to my verified archive.`
    : `I've updated my knowledge.`
}

**${originalQuery}**
**${eng}** in Ga is **${ga}**.`;
    }
  } catch (e) {
    console.error("Failed to parse correction JSON", e);
  }

  return null;
}
