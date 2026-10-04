/**
 * Bible reader API — the Library tab reads chapters directly, no model involved.
 *
 *   GET /bible/books                       → all books, canonical order, Ga names
 *   GET /bible/:book/:chapter?edition=…    → one chapter, Ga + English per verse
 *
 * Two Ga editions are stored: NEGAB (modern spelling) and GBV96 (the 1996 text
 * in its original spelling). NEGAB is the default.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { modernizeGa } from "../rag/orthography";
import { foldGa, gaToNum, numToEn } from "../rag/ga";
import { chat } from "../rag/llm";
import { optionalUser } from "../auth/middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const OLD_TESTAMENT = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
  "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
];
const NEW_TESTAMENT = [
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
];
const ORDER = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

/** "1 samuel" / "1-samuel" / "song-of-solomon" → the stored book name. */
function canonicalBook(raw: string): string | null {
  const k = raw.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return ORDER.find((b) => b.toLowerCase() === k) ?? null;
}

app.get("/bible/books", async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT book, MAX(CASE WHEN ga_version_abbr = 'NEGAB' THEN traditional_book END) AS ga_new,
            MAX(traditional_book) AS ga_any, COUNT(DISTINCT chapter_num) AS chapters
       FROM bible_verses GROUP BY book`
  ).all<{ book: string; ga_new: string | null; ga_any: string | null; chapters: number }>();
  const byName = new Map((res.results ?? []).map((r) => [r.book, r]));
  const books = ORDER.filter((b) => byName.has(b)).map((b) => {
    const r = byName.get(b)!;
    return {
      book: b,
      ga: modernizeGa(r.ga_new || r.ga_any || b),
      chapters: r.chapters,
      testament: OLD_TESTAMENT.includes(b) ? "old" : "new",
    };
  });
  return c.json({ books }, 200, { "Cache-Control": "public, max-age=3600" });
});

app.get("/bible/:book/:chapter", async (c) => {
  const book = canonicalBook(c.req.param("book"));
  const chapter = parseInt(c.req.param("chapter"), 10);
  if (!book || !(chapter > 0)) return c.json({ detail: "Unknown book or chapter" }, 404);
  const edition = c.req.query("edition") === "GBV96" ? "GBV96" : "NEGAB";

  const res = await c.env.DB.prepare(
    `SELECT verse_num, ga, en, traditional_book, chapter_title_ga
       FROM bible_verses
      WHERE book = ? AND chapter_num = ? AND ga_version_abbr = ?
      ORDER BY verse_num ASC`
  ).bind(book, chapter, edition).all<{ verse_num: number; ga: string; en: string | null; traditional_book: string | null; chapter_title_ga: string | null }>();
  const rows = res.results ?? [];
  if (!rows.length) return c.json({ detail: "Chapter not found" }, 404);

  // NEGAB sometimes folds two verses into one (Exodus 1:20 carries 21's Ga),
  // so its numbering jumps 20 → 22. Show that verse as "20–21" with both
  // English verses instead of a silent gap. Only single gaps are treated as
  // merges; a run of missing verses is a numbering difference, left alone.
  const verses: { n: number; to?: number; ga: string; en: string }[] =
    rows.map((r) => ({ n: r.verse_num, ga: r.ga, en: r.en ?? "" }));
  if (edition === "NEGAB") {
    const other = await c.env.DB.prepare(
      `SELECT verse_num, en FROM bible_verses
        WHERE book = ? AND chapter_num = ? AND ga_version_abbr = 'GBV96' AND verse_num > 0`
    ).bind(book, chapter).all<{ verse_num: number; en: string | null }>();
    const have = new Set(verses.map((v) => v.n));
    const otherNums = (other.results ?? []).map((r) => r.verse_num);
    const last = Math.max(0, ...otherNums);
    for (const r of other.results ?? []) {
      const n = r.verse_num;
      if (have.has(n) || !have.has(n - 1) || (n < last && !have.has(n + 1))) continue;
      const prev = verses.find((v) => v.n === n - 1)!;
      prev.to = n;
      if (r.en) prev.en = `${prev.en} ${r.en}`.trim();
    }
  }

  const count = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT chapter_num) AS n FROM bible_verses WHERE book = ?"
  ).bind(book).first<{ n: number }>();

  return c.json({
    book,
    ga_book: modernizeGa(rows[0].traditional_book || book),
    chapter,
    chapters: count?.n ?? chapter,
    chapter_title_ga: rows[0].chapter_title_ga ? modernizeGa(rows[0].chapter_title_ga) : null,
    edition,
    // GBV96 is shown as printed — modernising it would defeat the point of the edition.
    verses,
  }, 200, { "Cache-Control": "public, max-age=3600" });
});

/* ------------------------------------------------------------------------
 * Reading help — questions asked from the reader, about the passage open.
 *
 *   GET  /bible/:book/:chapter/:verse/words → the verse's Ga words the
 *        verified dictionary knows (phrases first), plus Ga numbers
 *   POST /bible/:book/:chapter/ask  { verse?, question, history? }
 *
 * The chat path searches the whole archive, so "who is Joseph in this
 * verse?" came back with Matthew 1:16. Here the passage is fixed: the model
 * gets the chapter (English) and the verse (Ga) and answers from them only.
 * ---------------------------------------------------------------------- */

// Grammar words: their dictionary sense ("lɛ" = "him/her") misleads more
// than it helps when the word is doing a different job in the verse.
const GA_STOP = new Set(["le", "ke", "ni", "ji", "ye", "shi", "ne", "nee", "mo", "ake", "he", "ehe", "ame",
  "e", "o", "a", "be", "ko", "hu", "tso", "lee", "no", "mli", "koni", "keke", "hewo", "ehi", "eko", "nii", "ei"]);

type Gloss = { ga: string; en: string };

async function verseRows(env: Env, book: string, chapter: number) {
  const res = await env.DB.prepare(
    `SELECT verse_num, ga, en, ga_version_abbr AS ed, traditional_book FROM bible_verses
      WHERE book = ? AND chapter_num = ? ORDER BY verse_num ASC`
  ).bind(book, chapter).all<{ verse_num: number; ga: string; en: string | null; ed: string; traditional_book: string | null }>();
  const rows = res.results ?? [];
  const pick = (ed: string) => rows.filter((r) => r.ed === ed);
  const ga = pick("NEGAB").length ? pick("NEGAB") : pick("GBV96");
  // English is the same KJV text on both editions; take whichever is fuller.
  const en = new Map<number, string>();
  for (const r of rows) if (r.en && (en.get(r.verse_num)?.length ?? 0) < r.en.length) en.set(r.verse_num, r.en);
  const gaBook = modernizeGa(rows.find((r) => r.traditional_book)?.traditional_book || book);
  return { ga, en, gaBook };
}

async function glossVerse(env: Env, gaText: string): Promise<Gloss[]> {
  const text = modernizeGa(gaText);
  const words = text.split(/[^\p{L}\p{M}'’-]+/u).filter(Boolean);
  const folded = words.map((w) => foldGa(w));
  const out: Gloss[] = [];
  const used: boolean[] = new Array(words.length).fill(false);
  const free = (i: number, n: number) => !used.slice(i, i + n).some(Boolean);
  // Numbers first ("nyɔŋmai kpawo" = 70): the dictionary only knows the parts.
  // Only whole number shapes: "nyɔŋmai X kɛ Y", "nyɔŋma kɛ X", "nyɔŋmai X".
  const unit = (w?: string) => { const u = w ? gaToNum(w) : null; return u !== null && u > 0 && u < 10; };
  for (let i = 0; i < words.length; i++) {
    const f = folded[i];
    let n = 0;
    if (f === "nyonmai" && unit(words[i + 1])) n = folded[i + 2] === "ke" && unit(words[i + 3]) ? 4 : 2;
    else if (f === "nyonma" && folded[i + 1] === "ke" && unit(words[i + 2])) n = 3;
    if (!n || !free(i, n)) continue;
    const phrase = words.slice(i, i + n).join(" ");
    const v = gaToNum(phrase);
    if (v && v > 10) { out.push({ ga: phrase, en: `${numToEn(v)} (${v})` }); used.fill(true, i, i + n); }
  }
  // Then the verified dictionary, longest phrase first.
  const keys = new Set<string>();
  for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) keys.add(folded.slice(i, i + n).join(" "));
  const list = [...keys].filter((k) => k.includes(" ") || !GA_STOP.has(k)).slice(0, 90);
  if (!list.length) return out;
  const res = await env.DB.prepare(
    `SELECT headword_normalized AS k, translations FROM vocabulary
      WHERE headword_normalized IN (${list.map(() => "?").join(",")})
        AND source IS NOT NULL AND TRIM(source) <> ''
        AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
      ORDER BY verified_at DESC`
  ).bind(...list).all<{ k: string; translations: string }>();
  const byKey = new Map<string, string>();
  for (const r of res.results ?? []) {
    if (byKey.has(r.k)) continue;
    let t: string[] = [];
    try { t = JSON.parse(r.translations || "[]"); } catch {}
    if (t.length) byKey.set(r.k, t.slice(0, 2).join("; "));
  }
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (!free(i, n)) continue;
      const en = byKey.get(folded.slice(i, i + n).join(" "));
      if (!en) continue;
      out.push({ ga: words.slice(i, i + n).join(" "), en });
      used.fill(true, i, i + n);
    }
  }
  // Keep verse order.
  return out.sort((a, b) => text.indexOf(a.ga) - text.indexOf(b.ga));
}

app.get("/bible/:book/:chapter/:verse/words", async (c) => {
  const book = canonicalBook(c.req.param("book"));
  const chapter = parseInt(c.req.param("chapter"), 10), verse = parseInt(c.req.param("verse"), 10);
  if (!book || !(chapter > 0) || !(verse >= 0)) return c.json({ detail: "Unknown verse" }, 404);
  const { ga } = await verseRows(c.env, book, chapter);
  const v = ga.find((r) => r.verse_num === verse);
  if (!v) return c.json({ detail: "Verse not found" }, 404);
  return c.json({ words: await glossVerse(c.env, v.ga) }, 200, { "Cache-Control": "public, max-age=3600" });
});

/** Ga the model wrote that isn't in the passage or the word list is not trusted. */
function groundAnswer(text: string, allowed: string, listed: string[]): string {
  const ok = foldGa(allowed);
  const glossed = new Set(listed.map((w) => foldGa(w)));
  // Bold spans must be quotes from the passage or the word list.
  let out = text.replace(/\*\*([^*]+)\*\*/g, (m, inner: string) => (ok.includes(foldGa(inner.trim())) ? m : inner));
  // A sentence carrying a Ga-lettered word found nowhere in the passage is
  // an invented translation — drop it.
  out = out.split(/(?<=[.!?])\s+/).filter((sent) => {
    const gaWords = sent.match(/[\p{L}\p{M}]*[ɛɔŋƐƆŊ][\p{L}\p{M}]*/gu) || [];
    if (!gaWords.every((w) => ok.includes(foldGa(w)))) return false;
    // A meaning claimed for a Ga word must be one the dictionary gives:
    // "kpawo means souls" is the model splitting a number it doesn't know.
    const claims = /\b(mean(s|ing|t)?|which is|stands for|is made up of|in Ga)\b|\*\*[^*]+\*\*\s*\(/i.test(sent);
    if (!claims) return true;
    const quoted = [...sent.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => foldGa(m[1].trim()));
    return quoted.every((q) => glossed.has(q) || q.split(/\s+/).length > 4);
  }).join(" ");
  return out.trim();
}

app.post("/bible/:book/:chapter/ask", optionalUser, async (c) => {
  const book = canonicalBook(c.req.param("book"));
  const chapter = parseInt(c.req.param("chapter"), 10);
  if (!book || !(chapter > 0)) return c.json({ detail: "Unknown book or chapter" }, 404);
  const body = await c.req.json<{ verse?: number; question?: string; history?: { q: string; a: string }[] }>()
    .catch(() => ({} as { verse?: number; question?: string; history?: { q: string; a: string }[] }));
  const question = String(body.question ?? "").trim().slice(0, 400);
  if (!question) return c.json({ detail: "Question is required" }, 400);

  const who = c.get("userId") || c.req.header("CF-Connecting-IP") || "anon";
  if (c.env.AGENT_LIMITER) {
    const r = await c.env.AGENT_LIMITER.limit({ key: `bible:${who}` }).catch(() => ({ success: true }));
    if (!r.success) return c.json({ answer: "I'm answering a lot of questions right now — please ask again in a minute.", words: [] });
  }

  const { ga, en, gaBook } = await verseRows(c.env, book, chapter);
  if (!ga.length) return c.json({ detail: "Chapter not found" }, 404);
  const vn = typeof body.verse === "number" && Number.isInteger(body.verse) ? body.verse : null;
  const v = vn !== null ? ga.find((r) => r.verse_num === vn) ?? null : null;
  const ref = v ? `${book} ${chapter}:${vn}` : `${book} ${chapter}`;
  const words = v ? await glossVerse(c.env, v.ga) : [];

  const chapterEn = [...en.entries()].filter(([n]) => n > 0).map(([n, t]) => `${n}. ${t}`).join("\n").slice(0, 9000);
  const passage = [
    `CHAPTER: ${book} ${chapter} (${gaBook} ${chapter}), King James English:`,
    chapterEn,
    v ? `\nTHE VERSE BEING READ: ${ref}\nGa (NEGAB): ${modernizeGa(v.ga)}\nEnglish: ${en.get(vn!) ?? ""}` : "",
    words.length ? `\nGA WORDS IN THE VERSE (verified dictionary):\n${words.map((w) => `${w.ga} = ${w.en}`).join("\n")}` : "",
  ].join("\n");

  const system = [
    "You are Nii Obodai, a warm, plain-spoken guide helping someone read the Ga Bible.",
    `They are reading ${ref}. Answer their question from the PASSAGE below only.`,
    "- 2 to 5 short sentences, plain English. No greeting, no preamble.",
    "- Point at verse numbers when you use them (\"verse 8 says…\").",
    "- If the passage doesn't answer it, say so in one sentence and say what the passage does say.",
    "- Quote Ga only exactly as written in the verse or the word list, in **bold**. Never translate English into Ga yourself and never invent Ga words.",
    "- Explain the meaning of a Ga word ONLY if it is in the GA WORDS list, using that meaning. Never split a Ga phrase into parts or guess what a part means.",
    "- If asked how to say something in Ga: only point to words from the GA WORDS list; if it isn't there, say this verse's word list doesn't cover it.",
    "- Only talk about words that are in the verse.",
    "- No doctrine or opinion beyond what the text says.",
  ].join("\n");
  const history = (Array.isArray(body.history) ? body.history : []).slice(-2).flatMap((h) => [
    { role: "user" as const, content: String(h.q ?? "").slice(0, 300) },
    { role: "assistant" as const, content: String(h.a ?? "").slice(0, 800) },
  ]);

  let answer = "";
  try {
    answer = await chat(c.env, [
      { role: "system", content: `${system}\n\nPASSAGE\n${passage}` },
      ...history,
      { role: "user", content: question },
    ], { temperature: 0.1, maxTokens: 400 });
  } catch {
    return c.json({ detail: "The model is unavailable right now." }, 503);
  }
  const allowed = [...ga.map((r) => modernizeGa(r.ga)), ...words.map((w) => w.ga), gaBook].join(" \n ");
  answer = groundAnswer(answer, allowed, words.map((w) => w.ga)) || "I couldn't answer that from this passage.";
  return c.json({ answer, ref, words });
});

export default app;
