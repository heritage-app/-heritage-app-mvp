/**
 * Bible verse store backing deterministic exact lookups + chapter/verse discovery.
 * The Python version did this with Qdrant `scroll`; Vectorize has no scan, so we
 * mirror every embedded verse into D1 and query it structurally here.
 */
import type { Env, VerseRecord } from "../types";
import { nowIso } from "../utils/time";

export async function upsertVerses(env: Env, records: VerseRecord[]): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO bible_verses
       (id, book, traditional_book, chapter_num, chapter_title_ga, chapter_title_en,
        verse_num, verse_ref, ga_verse_label, reference_display, ga, en,
        ga_version_name, ga_version_abbr, english_version_name, english_version_abbr,
        source_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const created = nowIso();
  const batch = records
    .filter((r) => r.book && r.chapter_num != null && r.verse_num != null)
    .map((r) =>
      stmt.bind(
        r.id ?? `bible:${String(r.book).toLowerCase()}:${r.chapter_num}:${r.verse_num}`,
        r.book ?? null,
        r.traditional_book ?? null,
        r.chapter_num ?? null,
        r.chapter_title_ga ?? null,
        r.chapter_title_en ?? null,
        r.verse_num ?? null,
        r.verse_ref ?? null,
        r.ga_verse_label ?? null,
        r.reference_display ?? null,
        r.ga ?? null,
        r.en ?? null,
        r.ga_version_name ?? null,
        r.ga_version_abbr ?? null,
        r.english_version_name ?? null,
        r.english_version_abbr ?? null,
        r.source_name ?? null,
        created
      )
    );
  if (batch.length) await env.DB.batch(batch);
}

export async function getVerse(
  env: Env,
  book: string,
  chapter: number,
  verse: number
): Promise<VerseRecord | null> {
  return env.DB.prepare(
    "SELECT * FROM bible_verses WHERE book = ? AND chapter_num = ? AND verse_num = ?"
  )
    .bind(book, chapter, verse)
    .first<VerseRecord>();
}

/** chapter_num -> chapter_title_ga, sorted. */
export async function listChapters(env: Env, book: string): Promise<Map<number, string>> {
  const res = await env.DB.prepare(
    `SELECT chapter_num, MAX(chapter_title_ga) AS title
       FROM bible_verses WHERE book = ? GROUP BY chapter_num ORDER BY chapter_num ASC`
  )
    .bind(capitalize(book))
    .all<{ chapter_num: number; title: string | null }>();
  const map = new Map<number, string>();
  for (const r of res.results ?? []) {
    map.set(r.chapter_num, r.title || `Yitso ${r.chapter_num}`);
  }
  return map;
}

/** verse_num -> ga_verse_label, sorted. */
export async function listVerses(
  env: Env,
  book: string,
  chapter: number
): Promise<Map<number, string>> {
  const res = await env.DB.prepare(
    `SELECT verse_num, MAX(ga_verse_label) AS label
       FROM bible_verses WHERE book = ? AND chapter_num = ?
       GROUP BY verse_num ORDER BY verse_num ASC`
  )
    .bind(capitalize(book), chapter)
    .all<{ verse_num: number; label: string | null }>();
  const map = new Map<number, string>();
  for (const r of res.results ?? []) {
    map.set(r.verse_num, r.label || `Kuku ${r.verse_num}`);
  }
  return map;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
