/**
 * What the archive holds, counted one way everywhere: the landing page, the
 * About and Support pages, and the admin console.
 *
 *   GET /api/v1/archive-stats   public, cached for an hour
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { DATASET_WORD_KEYS, STORIES, POEMS } from "../data/archive";
import { numToGa } from "./ga";
import { liveSamai } from "../routes/pages";

/** Must stay identical to foldKey in scripts/build-archive.mjs. */
export function foldKey(s: string): string {
  return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/ɛ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "n").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** How many whole numbers the number engine can say in Ga (1–999 today). */
const NUMBERS_IN_WORDS = (() => { let n = 0; for (let i = 1; i <= 9999; i++) if (numToGa(i) !== String(i)) n++; return n; })();

export interface ArchiveStats {
  words_and_phrases: number;    // distinct Ga words and phrases, vocabulary + imported datasets
  dictionary_entries: number;   // verified vocabulary entries (the checked dictionary)
  numbers_in_words: number;     // numbers Nii Obodai can say in Ga
  bible_verses: number;
  bible_translations: number;
  stories: number;
  poems_and_songs: number;
  samai: number;
  speech_hours: number;
}

export async function archiveStats(env: Env): Promise<ArchiveStats> {
  const [vocab, bible, samai] = await Promise.all([
    env.DB.prepare(
      `SELECT headword FROM vocabulary WHERE source IS NOT NULL AND TRIM(source) <> '' AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''`
    ).all<{ headword: string }>(),
    env.DB.prepare("SELECT COUNT(*) n, COUNT(DISTINCT ga_version_abbr) t FROM bible_verses").first<{ n: number; t: number }>(),
    liveSamai(env),
  ]);
  const rows = vocab.results || [];
  const keys = new Set(DATASET_WORD_KEYS);
  for (const r of rows) { const k = foldKey(r.headword); if (k) keys.add(k); }
  return {
    words_and_phrases: keys.size,
    dictionary_entries: rows.length,
    numbers_in_words: NUMBERS_IN_WORDS,
    bible_verses: bible?.n ?? 0,
    bible_translations: bible?.t ?? 0,
    stories: STORIES.length,
    poems_and_songs: POEMS.length,
    samai: samai.length,
    speech_hours: 0,
  };
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.get("/archive-stats", async (c) => {
  const s = await archiveStats(c.env);
  return c.json(s, 200, { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" });
});
export default app;
