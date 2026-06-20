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
export type Category = "bible" | "stories" | "heritage";

export const CATEGORIES: Category[] = ["bible", "stories", "heritage"];

/** Old collection name -> category, kept so retrieval intent reads naturally. */
export const COLLECTION_TO_CATEGORY: Record<string, Category> = {
  bibele_documents: "bible",
  stories_documents: "stories",
  heritage_documents: "heritage",
};

export function getCategory(category: string | null | undefined): Category {
  if (!category) return "heritage";
  const c = category.toLowerCase();
  if (c === "bible" || c === "stories" || c === "heritage") return c;
  return "heritage";
}

/** Books we recognise in queries (lowercased query tokens -> canonical book). */
export const BOOK_MAP: Record<string, string> = {
  genesis: "Genesis",
  mose: "Genesis",
  exodus: "Exodus",
  leviticus: "Leviticus",
  numbers: "Numbers",
  deuteronomy: "Deuteronomy",
};

export const BIBLE_BOOK_TOKENS = [
  "genesis",
  "exodus",
  "leviticus",
  "numbers",
  "deuteronomy",
  "mose",
];
