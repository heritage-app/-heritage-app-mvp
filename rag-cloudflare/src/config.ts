/**
 * RAG constants (ported from app/rag/constants.py).
 *
 * The Python system used three separate Qdrant collections. On Cloudflare we use
 * a single Vectorize index and emulate "collections" with a `category` metadata tag.
 */

export const DEFAULT_TOP_K = 5;
export const MIN_RELEVANCE_SCORE = 0.3;
export const MEMORY_WINDOW_SIZE = 10;

/** Logical category for a stored chunk. Maps 1:1 to the old Qdrant collections. */
export type Category = "bible" | "stories" | "heritage" | "corpus";

export const CATEGORIES: Category[] = ["bible", "stories", "heritage", "corpus"];

/** Old collection name -> category, kept so retrieval intent reads naturally. */
export const COLLECTION_TO_CATEGORY: Record<string, Category> = {
  bibele_documents: "bible",
  stories_documents: "stories",
  heritage_documents: "heritage",
};

export function getCategory(category: string | null | undefined): Category {
  if (!category) return "heritage";
  const c = category.toLowerCase();
  if (c === "bible" || c === "stories" || c === "heritage" || c === "corpus") return c;
  return "heritage";
}

/** Books we recognise in queries (lowercased query tokens -> canonical book). */
export const BOOK_MAP: Record<string, string> = {
  genesis: "Genesis", mose: "Genesis", exodus: "Exodus", leviticus: "Leviticus",
  numbers: "Numbers", deuteronomy: "Deuteronomy", joshua: "Joshua", judges: "Judges",
  ruth: "Ruth", "1 samuel": "1 Samuel", "2 samuel": "2 Samuel", "1 kings": "1 Kings",
  "2 kings": "2 Kings", "1 chronicles": "1 Chronicles", "2 chronicles": "2 Chronicles",
  ezra: "Ezra", nehemiah: "Nehemiah", esther: "Esther", job: "Job", psalm: "Psalms",
  psalms: "Psalms", proverbs: "Proverbs", ecclesiastes: "Ecclesiastes",
  "song of solomon": "Song of Solomon", isaiah: "Isaiah", jeremiah: "Jeremiah",
  lamentations: "Lamentations", ezekiel: "Ezekiel", daniel: "Daniel", hosea: "Hosea",
  joel: "Joel", amos: "Amos", obadiah: "Obadiah", jonah: "Jonah", micah: "Micah",
  nahum: "Nahum", habakkuk: "Habakkuk", zephaniah: "Zephaniah", haggai: "Haggai",
  zechariah: "Zechariah", malachi: "Malachi", matthew: "Matthew", mark: "Mark",
  luke: "Luke", john: "John", acts: "Acts", romans: "Romans",
  "1 corinthians": "1 Corinthians", "2 corinthians": "2 Corinthians",
  galatians: "Galatians", ephesians: "Ephesians", philippians: "Philippians",
  colossians: "Colossians", "1 thessalonians": "1 Thessalonians",
  "2 thessalonians": "2 Thessalonians", "1 timothy": "1 Timothy",
  "2 timothy": "2 Timothy", titus: "Titus", philemon: "Philemon",
  hebrews: "Hebrews", james: "James", "1 peter": "1 Peter", "2 peter": "2 Peter",
  "1 john": "1 John", "2 john": "2 John", "3 john": "3 John", jude: "Jude",
  revelation: "Revelation",
};

// Longest-first so multi-word tokens ("1 kings") match before single words ("kings").
export const BIBLE_BOOK_TOKENS = Object.keys(BOOK_MAP).sort((a, b) => b.length - a.length);

// Whole-word book names only: a substring test read "market" as Mark,
// "truth" as Ruth and "most" as Mose, and sent "how do you say I am going to
// the market" to a Bible verse.
export const BIBLE_BOOK_RE = new RegExp(`\b(${BIBLE_BOOK_TOKENS.join("|")})\b`);
// Books whose names are also everyday words or first names ("numbers",
// "judges", "my name is john") mean the Bible only with a chapter number or
// "book of".
const COMMON_WORD_BOOKS = new Set([
  "numbers", "judges", "ruth", "job", "proverbs", "lamentations", "daniel", "joel", "amos",
  "jonah", "joshua", "esther", "matthew", "mark", "luke", "john", "acts", "james", "jude",
  "titus", "revelation", "mose",
]);
export function mentionsBibleBook(q: string): boolean {
  const m = q.toLowerCase().match(BIBLE_BOOK_RE);
  if (!m) return false;
  if (!COMMON_WORD_BOOKS.has(m[1])) return true;
  return new RegExp(`\b${m[1]}\s+\d`).test(q.toLowerCase()) || /\bbook\s+of\b/i.test(q);
}
