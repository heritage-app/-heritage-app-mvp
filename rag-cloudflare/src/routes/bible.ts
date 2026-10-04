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

export default app;
