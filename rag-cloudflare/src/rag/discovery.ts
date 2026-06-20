/**
 * Structural Bible discovery (ported from app/rag/discovery.py).
 * Backed by the D1 `bible_verses` table instead of Qdrant scroll.
 */
import type { Env } from "../types";
import { listChapters as dbListChapters, listVerses as dbListVerses } from "../db/bibleVerses";

export async function listChapters(env: Env, book: string): Promise<Map<number, string>> {
  return dbListChapters(env, book);
}

export async function listVerses(
  env: Env,
  book: string,
  chapterNum: number
): Promise<Map<number, string>> {
  return dbListVerses(env, book, chapterNum);
}
