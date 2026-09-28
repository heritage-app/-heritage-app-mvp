/**
 * RAG orchestration (ported from app/rag/service.py).
 * Routes to a Bible engine or a General engine, grounds the answer, then streams
 * it through the Nii Obodai persona. Persistence + background summary/title after.
 */
import type { Env, ChatMessage, RagMode, VerseRecord } from "../types";
import { DEFAULT_TOP_K, MIN_RELEVANCE_SCORE, BOOK_MAP, BIBLE_BOOK_TOKENS } from "../config";
import { numToGa, foldGa, resolveGaCitation } from "./ga";
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

  // --- Deterministic exact lookup first (D1): citation queries must not depend
  // on the embedding API being up (quota, outage, cold start). ---
  let matchedMeta: VerseRecord | null = null;
  if (isSpecific && requestedV) {
    matchedMeta = await getVerse(env, requestedBook!, requestedCh!, requestedV);
    if (matchedMeta && isFormattableBibleRecord(matchedMeta)) {
      yield `Hɛloo naanyo! Here is the verse you requested:\n\n${formatBibleQuote(matchedMeta)}`;
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
    .filter((w) => w.length > 1 && !stop.has(w) && !nearStop(w) && !/^\d+$/.test(w));

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

  // --- Dictionary lookup (SQL) ---
  if (queryWords.length > 0 && queryWords.length <= 3) {
    const qStr = queryWords.join(" ");
    const foldedQ = foldGa(qStr);
    // Word-level normal form: folded, apostrophes dropped (so "lets" meets
    // "let's"), everything else a single space.
    const norm = (s: string) =>
      foldGa(s.toLowerCase()).replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const needle = norm(qStr);
    // WHOLE words only. A substring test let "lets" match "trip-LETS", so
    // "lets eat in ga" was answered with the Ga for "triplets".
    const hasPhrase = (hay: string) => ` ${norm(hay)} `.includes(` ${needle} `);
    // SQL is only a coarse net: the longest word, apostrophe-free. Precise
    // matching and ranking happen below.
    const probe = [...needle.split(" ")].sort((a, b) => b.length - a.length)[0] ?? needle;
    const likePattern = `%${probe}%`;
    try {
      const vocabSearch = await env.DB.prepare(
        `SELECT headword, headword_normalized, meanings, translations FROM vocabulary
         WHERE (headword_normalized = ?
                -- Apostrophes stripped DB-side too: the probe has none, so
                -- "lets" could otherwise never reach a stored "let's eat".
                OR REPLACE(REPLACE(translations, '''', ''), '’', '') LIKE ?
                OR REPLACE(REPLACE(meanings, '''', ''), '’', '') LIKE ?)
           AND source IS NOT NULL AND TRIM(source) <> ''
           AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
         ORDER BY LENGTH(translations) ASC
         LIMIT 40`
      ).bind(foldedQ, likePattern, likePattern).all<{ headword: string; headword_normalized: string; meanings: string; translations: string }>();

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
        const towardGa = /\bin\s+ga\b|\bhow\s+(do\s+(you|i)\s+|to\s+)?say\b|\btranslate\b/.test(qLow);
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
          const exact = transArr.find((t) => norm(t) === needle);
          const inTrans = transArr.find(hasPhrase);
          const inMean = meanArr.find(hasPhrase);

          let hit: { ga: string; eng: string; gaSide: boolean; rank: number } | null = null;
          if (typedGa && (hw === rawQ || ` ${rawQ} `.includes(` ${hw} `))) {
            // They typed the Ga itself, diacritics and all.
            hit = { ga: row.headword, eng: gaEng, gaSide: true, rank: 0 };
          } else if (exact) {
            hit = { ga: row.headword, eng: exact, gaSide: false, rank: 1 };
          } else if (!towardGa && row.headword_normalized === foldedQ) {
            hit = { ga: row.headword, eng: gaEng, gaSide: true, rank: 2 };
          } else if (inTrans) {
            hit = { ga: row.headword, eng: inTrans, gaSide: false, rank: 3 };
          } else if (inMean) {
            hit = { ga: row.headword, eng: inMean, gaSide: false, rank: 4 };
          }
          if (hit && (!bestHit || hit.rank < bestHit.rank)) bestHit = hit;
          if (bestHit?.rank === 0) break;
        }
        if (bestHit) {
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
        allowedCategories: ["heritage", "stories"],
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
            lines.push(`**Ga:** ${modernizeGa(String(n.metadata.ga ?? ""))}`, `**English:** ${n.metadata.english}`, "");
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
    allowedCategories: ["heritage", "stories"],
  });

  // Semantic retrieval empty (embedding quota blocked, or unindexed file):
  // scan the heritage JSONL archives in R2 directly so phrase/vocab lookups
  // still answer through the same word-overlap matcher below.
  if (!expandedNodes.length && !browseIntent) {
    try {
      const docs = await env.DB.prepare(
        "SELECT unique_path FROM documents WHERE category = 'heritage' AND unique_path LIKE '%.jsonl'"
      ).all<{ unique_path: string }>();
      for (const row of docs.results ?? []) {
        const obj = await env.DOCS_BUCKET.get(row.unique_path);
        if (!obj) continue;
        for (const line of (await obj.text()).split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try {
            const rec = JSON.parse(t);
            if (String(rec.ga ?? "").trim() && String(rec.english ?? "").trim()) {
              expandedNodes.push({ text: "", score: 0, metadata: rec });
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (e) {
      console.warn("archive phrase fallback failed:", e);
    }
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
          lines.push(`**Ga:** ${modernizeGa(String(n.metadata.ga ?? ""))}`, `**English:** ${n.metadata.english}`, "");
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
        lines.push(`**Ga:** ${modernizeGa(String(m.ga ?? ""))}`, `**English:** ${m.english}`);
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
    let matchedCount = 0;
    for (const w of queryWords) {
      let matched = false;
      if (engWords.has(w)) { mcEn++; matched = true; }
      if (gaWords.has(w)) { mcGa++; matched = true; }
      // Near-matches, each for a specific reason and no looser:
      //  - English: an inflection of the same word — "alphabets" ~ "alphabet",
      //    "eating" ~ "eat". NOT a bare prefix: that let "cat" match
      //    "caterpillar".
      //  - Ga: a word being typed out — "otukwaj" ~ "otukwajaŋ" — so the query
      //    must be at least 4 letters and most of the word. NOT the reverse:
      //    that let "share" match the Ga token "sha", and "i would like to
      //    share" was answered with the Ga for "Hurry".
      if (!engWords.has(w) && [...engWords].some((e) => isInflection(w, e))) { mcEn++; matched = true; }
      if (!gaWords.has(w) && [...gaWords].some((g) => isPartialGa(w, g))) { mcGa++; matched = true; }
      if (matched) matchedCount++;
    }
    const mc = mcEn + mcGa;
    // A pair answer is only defensible when EVERY content word in the query
    // matched — otherwise one accidental overlap yields a confident non-answer
    // (e.g. "alphabets in Ga" matching the "a" in "I see a rainbow").
    if (queryWords.length > 0 && matchedCount === queryWords.length) {
      seen.add(key); hits.push({ mc, score: n.score ?? 0, eng, ga, gaSide: mcGa >= mcEn });
    }
  }

  if (hits.length) {
    // Prefer more query-word matches; break ties with shorter Ga phrase
    // (the base term like "Otukwajaŋ" wins over "Otukwajaŋ shishijee mli").
    hits.sort((a, b) => b.mc - a.mc || a.ga.length - b.ga.length || b.score - a.score);
    const gaShown = modernizeGa(hits[0].ga);
    yield hits[0].gaSide
      ? `**${gaShown}** is Ga for “${hits[0].eng}”.`
      : `In Ga, “${hits[0].eng}” is **${gaShown}**.`;
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
        const reply = about
          ? `Oyiwaladɔŋ! Type the Ga for “${about}” in the box below and I'll put it forward for review.`
          : "Oyiwaladɔŋ! Type it in the box below and I'll put it forward for review.";
        yield reply;
        const flag: TurnFlag = {
          kind: isNotFoundResponse(prevA) ? "not_found" : "wrong",
          english: about,
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
  if (targetMode === "auto") {
    const isBible =
      ["bible", "bibele", "verse", "chapter", "scripture"].some((b) => qLow.includes(b)) ||
      BIBLE_BOOK_TOKENS.some((b) => qLow.includes(b)) ||
      (qLow.includes(":") && /\d/.test(qLow));
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
  const notFoundFlag: TurnFlag | undefined = isNotFoundResponse(full)
    ? { kind: "not_found", english: cleanEnglish(query) }
    : undefined;

  if (!ephemeral) {
    for await (const t of persistTurn(env, conversationId, query, full, userId, notFoundFlag)) yield t;
  } else if (notFoundFlag) {
    yield flagOnlyMeta(notFoundFlag);
  }
}

/**
 * The __META__ trailer for a turn that is not persisted (guests). Carries the
 * flag so the client can still render the contribution card; there is no
 * interaction id because nothing was saved.
 */
function flagOnlyMeta(flag: TurnFlag): string {
  return `\n__META__:${JSON.stringify({ flag })}\n`;
}

/** Save a turn + emit the __META__ trailer; swallows its own errors. */
async function* persistTurn(
  env: Env,
  conversationId: string,
  query: string,
  answer: string,
  userId: string,
  flag?: TurnFlag
): AsyncGenerator<string> {
  try {
    const row = await saveInteraction(env, conversationId, query, answer, userId);
    // A flag rides along in the same marker the client already parses, so the
    // contribution card can be rendered against this exact interaction.
    const meta: { interactionId: string; flag?: TurnFlag } = { interactionId: row.id };
    if (flag) meta.flag = { ...flag, interaction_id: row.id };
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
