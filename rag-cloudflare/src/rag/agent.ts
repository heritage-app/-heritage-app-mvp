/**
 * The agent's reasoning layer — the fallback that runs only after the
 * deterministic engines in service.ts found nothing.
 *
 * Contract (what makes this safe to put in front of learners):
 *  1. The model PLANS: it chooses tools and their arguments. It never has the
 *     last word on Ga text.
 *  2. Every Ga claim in the model's reply — each **bold** span, and every word
 *     written with Ga letters or tone marks — must appear verbatim (folded) in
 *     a tool result from this turn. A reply that fails is discarded and the
 *     answer is composed from the evidence instead.
 *  3. Scripture is never re-typed by the model: a verse the tools returned is
 *     emitted exactly as formatBibleQuote produced it.
 *  4. No evidence, no answer: if every tool came back empty, the reply is the
 *     standard not-found message (which carries the contribute flag), whatever
 *     the model wrote.
 *  5. Bounded: a fixed number of model calls and a wall-clock deadline.
 *
 * Gap logging and guessed words are the caller's business, not the model's:
 * the model used to call record_gap itself (so test traffic filled the gap
 * list) and derive_word surfaced inferred Ga as answers.
 */
import type { Env, ChatMessage } from "../types";
import { getVerse, listBooks, listChapters, listVerses, getRandomVerse } from "../db/bibleVerses";
import { formatBibleQuote, isFormattableBibleRecord } from "./validator";
import { retrieveContext, formatRetrievedContext } from "./retriever";
import { foldGa } from "./ga";
import { isInflection, isPartialGa } from "./matching";
import { modernizeGa } from "./orthography";

/** Model calls per turn, including the planning ones. */
const MAX_MODEL_CALLS = 4;
/** Stop planning after this long; answer from whatever evidence exists. */
const DEADLINE_MS = 20_000;

const SYSTEM = `You are Nii Obodai, a Ga-language heritage assistant. You answer ONLY from the archive, through the tools.

How to work:
- Bible: a named book/chapter/verse -> lookup_verse. A topic ("a verse about love") -> search_archive(scope="bible"). Structure questions -> list_books / list_chapters / list_verses.
- Ga words and phrases: vocab_lookup first, then phrase_overlap, then search_archive(scope="heritage").
- Culture, history, stories: search_archive(scope="heritage").
- Pass tools the SUBJECT of the question, not the question: for "what do you call a place to sleep in ga", look up "bed".
- A lookup that returns rows which don't fit is not the end: try the plain English word or a close synonym ("sleeping place" -> "bed", "physician" -> "doctor") before giving up.

How to answer:
- Put every piece of Ga text in **bold**, copied exactly from a tool result. Your reply is checked: Ga that is not in a tool result is rejected.
- Never translate, compose or guess Ga yourself. Never re-type a Bible verse — just say which verse it is; the system prints it.
- If the tools don't answer the question, reply exactly: NOT_IN_ARCHIVE
- One or two short sentences. No greetings.`;

const TOOLS = [
  {
    name: "lookup_verse",
    description: "Exact Bible verse lookup by citation (Ga + English KJV).",
    parameters: {
      type: "object",
      properties: {
        book: { type: "string", description: "English book name, e.g. 'Genesis', 'John'" },
        chapter: { type: "integer" },
        verse: { type: "integer" },
      },
      required: ["book", "chapter", "verse"],
    },
  },
  {
    name: "list_books",
    description: "List the Bible books in the archive.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_chapters",
    description: "List chapter numbers and Ga chapter titles for a book.",
    parameters: { type: "object", properties: { book: { type: "string" } }, required: ["book"] },
  },
  {
    name: "list_verses",
    description: "List verse numbers and Ga verse labels for a chapter.",
    parameters: {
      type: "object",
      properties: { book: { type: "string" }, chapter: { type: "integer" } },
      required: ["book", "chapter"],
    },
  },
  {
    name: "random_verse",
    description: "A random verse, optionally from one book.",
    parameters: { type: "object", properties: { book: { type: "string", description: "optional" } } },
  },
  {
    name: "search_archive",
    description: "Semantic search. scope='bible' searches verses; scope='heritage' searches vocabulary, phrases, stories, poems and cultural records.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Descriptive English" },
        scope: { type: "string", enum: ["bible", "heritage"] },
      },
      required: ["query", "scope"],
    },
  },
  {
    name: "vocab_lookup",
    description: "Verified Ga dictionary: look up an English word/phrase or a Ga headword.",
    parameters: {
      type: "object",
      properties: { term: { type: "string", description: "One English word or short phrase, or a Ga word" } },
      required: ["term"],
    },
  },
  {
    name: "phrase_overlap",
    description: "Find Ga/English sentence pairs in the archive containing every given word. Use when vocab_lookup misses.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The English (or Ga) words to find" } },
      required: ["query"],
    },
  },
];

type ToolCall = { name: string; arguments: Record<string, any> };

/** One tool's outcome. `empty` results are not evidence. */
interface ToolResult {
  text: string;
  empty: boolean;
  /** Verbatim scripture blocks, emitted by the system, never by the model. */
  verses?: string[];
  /** Ga/English pairs, for composing an answer when the model's is rejected. */
  pairs?: Array<{ ga: string; english: string }>;
  /** A dictionary entry whose English is exactly the term searched for. */
  exact?: { ga: string; english: string };
}

export interface AgentStep {
  tool: string;
  args: Record<string, any>;
  found: boolean;
}

/** The term a step searched for, for the trace ("vocab_lookup: bed"). */
export function stepTerm(st: AgentStep): string {
  const a = st.args ?? {};
  const v = a.term ?? a.query ?? (a.book ? [a.book, a.chapter, a.verse].filter((x) => x != null).join(" ") : "");
  return String(v).slice(0, 40);
}

export interface AgentResult {
  /** Final reply text, or null when the archive has nothing (caller says not-found). */
  text: string | null;
  steps: AgentStep[];
  modelCalls: number;
  /** How the reply was produced — for the trace. */
  composedBy: "model" | "evidence" | "verse" | "none";
}

const EMPTY = (text: string): ToolResult => ({ text, empty: true });

const wordsOf = (s: string) => new Set(foldGa(s.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? []);

const PHRASE_STOP = new Set([
  "in", "ga", "the", "a", "an", "is", "are", "what", "how", "do", "does",
  "you", "say", "said", "tell", "me", "to", "of", "for", "your", "my",
  "i", "we", "they", "translate", "translation", "word", "mean",
  "means", "meaning", "language", "english", "version", "please",
]);

async function execTool(env: Env, tc: ToolCall): Promise<ToolResult> {
  const a = tc.arguments ?? {};
  try {
    switch (tc.name) {
      case "lookup_verse": {
        const rec = await getVerse(env, String(a.book), Number(a.chapter), Number(a.verse));
        if (!rec || !isFormattableBibleRecord(rec)) return EMPTY("NOT_FOUND");
        const block = formatBibleQuote(rec);
        return { text: block, empty: false, verses: [block] };
      }
      case "random_verse": {
        const rec = await getRandomVerse(env, a.book ? String(a.book) : undefined);
        if (!rec || !isFormattableBibleRecord(rec)) return EMPTY("NOT_FOUND");
        const block = formatBibleQuote(rec);
        return { text: block, empty: false, verses: [block] };
      }
      case "list_books": {
        const books = await listBooks(env);
        return books.length
          ? { text: books.map((b) => b.book).join(", "), empty: false }
          : EMPTY("none");
      }
      case "list_chapters": {
        const map = await listChapters(env, String(a.book));
        if (!map.size) return EMPTY("NOT_FOUND");
        return { text: [...map.entries()].map(([n, t]) => `${n} (${t})`).join(", "), empty: false };
      }
      case "list_verses": {
        const map = await listVerses(env, String(a.book), Number(a.chapter));
        if (!map.size) return EMPTY("NOT_FOUND");
        return { text: [...map.entries()].map(([n, l]) => `${n} (${l})`).join(", "), empty: false };
      }
      case "search_archive": {
        const scope = a.scope === "bible" ? "bible" : "heritage";
        const nodes = await retrieveContext(env, String(a.query ?? ""), {
          topK: 6,
          allowedCategories: scope === "bible" ? ["bible"] : ["stories", "heritage"],
        });
        const relevant = nodes.filter((n) => (n.score ?? 0) >= 0.3).slice(0, 4);
        if (!relevant.length) return EMPTY("NO_MATCH");
        const verses = scope === "bible"
          ? relevant.filter((n) => isFormattableBibleRecord(n.metadata)).map((n) => formatBibleQuote(n.metadata as any))
          : undefined;
        const pairs = relevant
          .map((n) => ({ ga: String(n.metadata?.ga ?? "").trim(), english: String(n.metadata?.english ?? "").trim() }))
          .filter((p) => p.ga && p.english)
          .map((p) => ({ ga: modernizeGa(p.ga), english: p.english }));
        return {
          text: formatRetrievedContext(relevant).slice(0, 4000),
          empty: false,
          verses: verses?.length ? verses : undefined,
          pairs: pairs.length ? pairs : undefined,
        };
      }
      case "vocab_lookup": {
        const term = String(a.term ?? "").trim();
        if (!term) return EMPTY("EMPTY");
        const folded = foldGa(term.toLowerCase()).replace(/['’]/g, "");
        const probe = [...folded.split(/\s+/)].sort((x, y) => y.length - x.length)[0] ?? folded;
        const res = await env.DB.prepare(
          `SELECT headword, translations, meanings FROM vocabulary
           WHERE (headword_normalized = ?
                  OR REPLACE(REPLACE(translations, '''', ''), '’', '') LIKE ?
                  OR REPLACE(REPLACE(meanings, '''', ''), '’', '') LIKE ?)
             AND source IS NOT NULL AND TRIM(source) <> ''
             AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
           ORDER BY LENGTH(translations) ASC, verified_at DESC LIMIT 8`
        ).bind(folded, `%${probe}%`, `%${probe}%`).all<{ headword: string; translations: string; meanings: string }>();
        const rows = res.results ?? [];
        if (!rows.length) return EMPTY("NO_MATCH");
        let exact: { ga: string; english: string } | undefined;
        const pairs = rows.map((r) => {
          let t: string[] = [];
          try { t = JSON.parse(r.translations || "[]"); } catch {}
          const hit = t.find((x) => norm(x) === norm(term));
          if (hit && !exact) exact = { ga: r.headword, english: hit };
          return { ga: r.headword, english: t.join("; ") || String(r.meanings ?? "") };
        });
        return {
          text: pairs.map((p) => `**${p.ga}** = ${p.english}`).join("\n"),
          empty: false,
          pairs,
          exact,
        };
      }
      case "phrase_overlap": {
        const q = String(a.query ?? "").trim().toLowerCase();
        const queryWords = [...foldGa(q).matchAll(/[\p{L}\p{N}'-]+/gu)]
          .map((m) => m[0])
          .filter((w) => w.length > 1 && !PHRASE_STOP.has(w) && !/^\d+$/.test(w));
        if (!queryWords.length) return EMPTY("EMPTY");
        const docs = await env.DB.prepare(
          "SELECT unique_path FROM documents WHERE category = 'heritage' AND unique_path LIKE '%.jsonl'"
        ).all<{ unique_path: string }>();
        const hits: Array<{ english: string; ga: string }> = [];
        const seen = new Set<string>();
        for (const row of docs.results ?? []) {
          const obj = await env.DOCS_BUCKET.get(row.unique_path);
          if (!obj) continue;
          for (const line of (await obj.text()).split("\n")) {
            const t = line.trim();
            if (!t.startsWith("{")) continue;
            let rec: any;
            try { rec = JSON.parse(t); } catch { continue; }
            const english = String(rec.english ?? "").trim();
            const ga = String(rec.ga ?? "").trim();
            if (!english || !ga || seen.has(english.toLowerCase())) continue;
            const ew = wordsOf(english), gw = wordsOf(ga);
            // Every query word must match — one stray overlap is a coincidence.
            const all = queryWords.every((w) =>
              ew.has(w) || [...ew].some((e) => isInflection(w, e)) ||
              gw.has(w) || [...gw].some((g) => isPartialGa(w, g)));
            if (all) {
              seen.add(english.toLowerCase());
              hits.push({ english, ga: modernizeGa(ga) });
            }
          }
        }
        if (!hits.length) return EMPTY("NO_MATCH");
        hits.sort((x, y) => x.ga.length - y.ga.length);
        const top = hits.slice(0, 5);
        return {
          text: top.map((h) => `**${h.ga}** = "${h.english}"`).join("\n"),
          empty: false,
          pairs: top,
        };
      }
      default:
        return EMPTY(`UNKNOWN_TOOL:${tc.name}`);
    }
  } catch (e) {
    console.error(`agent tool ${tc.name} failed:`, e);
    return EMPTY("TOOL_ERROR");
  }
}

/** Whitespace/punctuation-insensitive, folded form for evidence matching. */
const norm = (s: string) =>
  ` ${foldGa(s.normalize("NFC").toLowerCase()).replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

const GA_LETTERS = /[ɛɔŋƐƆŊ]/;
const TONE_MARKS = /[̀-ͯ]/;

/**
 * The Ga claims a reply makes: every **bold** span, plus every word spelled
 * with Ga letters or tone marks outside bold. Exported for tests.
 */
export function gaClaims(reply: string): string[] {
  const claims = [...reply.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim()).filter(Boolean);
  const unbolded = reply.replace(/\*\*[^*]+\*\*/g, " ");
  for (const w of unbolded.match(/[\p{L}\p{M}'’-]+/gu) ?? []) {
    if (GA_LETTERS.test(w) || TONE_MARKS.test(w.normalize("NFD"))) claims.push(w);
  }
  return claims;
}

/** True when every Ga claim in the reply appears in the evidence. */
export function isGrounded(reply: string, evidence: string): boolean {
  const ev = norm(evidence);
  return gaClaims(reply).every((c) => {
    const n = norm(c);
    return n.trim() === "" || ev.includes(n);
  });
}

/** Compose a reply from evidence alone — used when the model's is rejected. */
function composeFromEvidence(results: ToolResult[]): string | null {
  const pairs = results.flatMap((r) => r.pairs ?? []);
  if (!pairs.length) return null;
  const top = pairs.slice(0, 3);
  return [
    "Here is what the archive has closest to that:",
    "",
    ...top.map((p) => `- **${p.ga}** — “${p.english}”`),
  ].join("\n");
}

/**
 * Run the planning loop for one question. `history` is the conversation so
 * far (already trimmed by the caller); `scope` hints where to look first.
 */
export async function runAgent(
  env: Env,
  query: string,
  history: ChatMessage[],
  scope: "bible" | "general"
): Promise<AgentResult> {
  const started = Date.now();
  const steps: AgentStep[] = [];
  const results: ToolResult[] = [];
  let modelCalls = 0;
  let reply = "";

  const messages: any[] = [
    { role: "system", content: SYSTEM + (scope === "bible" ? "\nThis question looks like it is about the Bible." : "") },
    ...history.slice(-4).map((m) => ({ role: m.role, content: String(m.content).slice(0, 800) })),
    { role: "user", content: query },
  ];

  // Identical calls are skipped: this model family re-issues the same call
  // instead of reading its result. Numbers may come back as strings.
  const keyOf = (tc: ToolCall) =>
    `${tc.name}:` + JSON.stringify(Object.keys(tc.arguments ?? {}).sort().map((k) => {
      const v = tc.arguments[k];
      return [k, typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : String(v).toLowerCase()];
    }));
  const done = new Set<string>();

  while (modelCalls < MAX_MODEL_CALLS && Date.now() - started < DEADLINE_MS) {
    const lastCall = modelCalls === MAX_MODEL_CALLS - 1;
    let out: any;
    try {
      out = await env.AI.run(env.LLM_MODEL as any, {
        messages,
        ...(lastCall ? {} : { tools: TOOLS }),
        max_tokens: 400,
        temperature: 0,
      });
    } catch (e) {
      console.error("agent model call failed:", e);
      break;
    }
    modelCalls++;

    const calls: ToolCall[] = (out?.tool_calls ?? []).filter((tc: ToolCall) => !done.has(keyOf(tc)));
    if (!calls.length) {
      reply = String(out?.response ?? "").trim();
      break;
    }
    messages.push({ role: "assistant", content: JSON.stringify(calls) });
    for (const tc of calls.slice(0, 3)) {
      done.add(keyOf(tc));
      const r = await execTool(env, tc);
      results.push(r);
      steps.push({ tool: tc.name, args: tc.arguments ?? {}, found: !r.empty });
      messages.push({ role: "tool", content: r.text });
    }
  }

  // Backstop: the model is good at naming the subject ("physician" ->
  // "doctor") but not reliable at following through — it sometimes searches
  // the phrase archive for its term and gives up without the dictionary.
  // Every term it searched gets a dictionary lookup here, in code.
  const looked = new Set(
    steps.filter((st) => st.tool === "vocab_lookup").map((st) => norm(String(st.args?.term ?? "")))
  );
  for (const st of [...steps]) {
    if (st.tool !== "phrase_overlap" && !(st.tool === "search_archive" && st.args?.scope !== "bible")) continue;
    const term = String(st.args?.query ?? "").trim();
    if (!term || term.split(/\s+/).length > 3 || looked.has(norm(term))) continue;
    looked.add(norm(term));
    const r = await execTool(env, { name: "vocab_lookup", arguments: { term } });
    results.push(r);
    steps.push({ tool: "vocab_lookup", args: { term }, found: !r.empty });
  }

  const found = results.filter((r) => !r.empty);
  if (!found.length) return { text: null, steps, modelCalls, composedBy: "none" };

  // Scripture: print what the tools returned, never the model's rendering.
  const verses = found.flatMap((r) => r.verses ?? []);
  const verseStep = steps.some((s) => s.found && (s.tool === "lookup_verse" || s.tool === "random_verse"));
  if (verses.length && (verseStep || scope === "bible")) {
    const shown = verses.slice(0, verseStep ? 1 : 3);
    return {
      text: `Hɛloo naanyo!\n\n${shown.join("\n\n———\n\n")}`,
      steps, modelCalls, composedBy: "verse",
    };
  }

  const said = reply.replace(/^NOT_IN_ARCHIVE\.?$/i, "").trim();
  const evidence = found.map((r) => r.text).join("\n");
  if (said && !/NOT_IN_ARCHIVE/i.test(said) && isGrounded(said, evidence)) {
    return { text: said, steps, modelCalls, composedBy: "model" };
  }
  // The model chose the word to look up ("a place to sleep" -> "bed") and the
  // dictionary has exactly that word: that entry is the answer, even when
  // the model then failed to write it up.
  const exact = found.find((r) => r.exact)?.exact;
  if (exact) {
    return { text: `In Ga, “${exact.english}” is **${exact.ga}**.`, steps, modelCalls, composedBy: "evidence" };
  }
  // The model declined, or wrote Ga the tools never returned — show evidence
  // only when the model had not already judged it irrelevant.
  if (said && !/NOT_IN_ARCHIVE/i.test(said)) {
    const composed = composeFromEvidence(found);
    if (composed) return { text: composed, steps, modelCalls, composedBy: "evidence" };
  }
  return { text: null, steps, modelCalls, composedBy: "none" };
}
