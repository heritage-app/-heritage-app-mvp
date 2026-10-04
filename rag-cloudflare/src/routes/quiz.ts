/**
 * Quiz endpoint — serves verified vocabulary as practice questions.
 *
 * Pulls random integrity-gated records (source + verified_at present, same
 * gate as lookupVocabulary) so quizzes only ever drill verified archive data.
 * Scoring lives client-side; this route is read-only.
 *
 * Modes (?mode=):
 *   choice  (default) one English prompt, four Ga options + provenance
 *   match   n Ga/English pairs for the match-pairs board
 *   blank   a multi-word verified entry with one word removed
 *
 * `scramble` and `listen` are client-side presentations of a `choice` item,
 * so they need no server mode of their own.
 *
 * NOTE: `blank` deliberately draws from multi-word VOCABULARY entries rather
 * than bible_verses. The Bible corpus is GBV96 (1896 orthography) and carries
 * OCR apparatus, so blanking a word out of it would drill spellings the rest
 * of the app doesn't use. Revisit once that corpus is normalised.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

interface VocabRow {
  headword: string;
  translations: string | null;
  meanings: string | null;
  phonetic: string | null;
  category: string | null;
  source: string | null;
  verified_at: string | null;
}

interface Entry {
  ga: string;
  en: string;
  gloss: string;
  phonetic: string;
  category: string;
  source: string;
}

/** The integrity gate: source AND verified_at must both be present. */
const GATE = `source IS NOT NULL AND TRIM(source) <> ''
              AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''`;

function firstOf(json: string | null): string {
  if (!json) return "";
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v) && v.length) return String(v[0]);
    return String(v);
  } catch {
    return json;
  }
}

/** Human-readable provenance line for the reveal panel. */
function sourceLine(r: VocabRow): string {
  const src = (r.source || "").trim().replace(/_/g, " ");
  const day = (r.verified_at || "").slice(0, 10);
  return day ? `${src} · verified ${day}` : src;
}

function toEntry(r: VocabRow): Entry {
  return {
    ga: (r.headword || "").trim(),
    en: firstOf(r.translations).trim(),
    gloss: firstOf(r.meanings).trim(),
    phonetic: (r.phonetic || "").trim(),
    category: (r.category || "general").trim(),
    source: sourceLine(r),
  };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick `n` distractors closest in length to the answer.
 * Without this the answer is guessable by shape alone — a 14-character phrase
 * next to three 3-letter words needs no Ga at all to spot.
 */
function nearestByLength(answer: string, candidates: string[], n: number): string[] {
  return [...candidates]
    .sort((a, b) => Math.abs(a.length - answer.length) - Math.abs(b.length - answer.length))
    .slice(0, n);
}

/**
 * Learn-page topics → dictionary categories. Bible book names (categories
 * "book"/"bible") are never quizzed: they surfaced English names like
 * "Numbers" as Ga answer options.
 */
export const TOPICS: Record<string, { label: string; cats: string[] }> = {
  greetings: { label: "Greetings", cats: ["greeting", "phrase", "expressions"] },
  family: { label: "Family", cats: ["family", "people"] },
  food: { label: "Food & market", cats: ["food", "kitchen", "market", "shop"] },
  numbers: { label: "Numbers", cats: ["number"] },
  time: { label: "Time & weather", cats: ["time", "days", "months", "weather"] },
  body: { label: "Body & health", cats: ["body", "sickness"] },
  animals: { label: "Animals", cats: ["animals", "birds", "insects", "fish"] },
  home: { label: "Home", cats: ["household"] },
  describing: { label: "Colours & describing", cats: ["colours", "descriptive"] },
  places: { label: "Places & directions", cats: ["directions", "travel", "school", "post-office"] },
  chiefs: { label: "Chieftaincy", cats: ["chief", "chieftaincy"] },
  music: { label: "Music", cats: ["music"] },
};
const NEVER = ["book", "bible"];

/** Random verified entries, de-duped by Ga headword and length-sane. */
async function pool(env: Env, limit: number, topic?: string): Promise<Entry[]> {
  const cats = topic && TOPICS[topic] ? TOPICS[topic].cats : null;
  const where = cats
    ? `AND LOWER(COALESCE(category, '')) IN (${cats.map(() => "?").join(",")})`
    : `AND LOWER(COALESCE(category, '')) NOT IN (${NEVER.map(() => "?").join(",")})`;
  const res = await env.DB.prepare(
    `SELECT headword, translations, meanings, phonetic, category, source, verified_at
       FROM vocabulary WHERE ${GATE} ${where}
       ORDER BY RANDOM() LIMIT ?`
  )
    .bind(...(cats ?? NEVER), limit)
    .all<VocabRow>();

  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const r of res.results ?? []) {
    const e = toEntry(r);
    if (!e.ga || !e.en) continue;
    if (e.ga.length > 40 || e.en.length > 80) continue;
    const k = e.ga.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** Topic counts for the Learn page. */
app.get("/topics", async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT LOWER(COALESCE(category, '')) AS cat, COUNT(*) AS n FROM vocabulary WHERE ${GATE} GROUP BY cat`
  ).all<{ cat: string; n: number }>();
  const by = new Map((res.results ?? []).map((r) => [r.cat, r.n]));
  const topics = Object.entries(TOPICS)
    .map(([id, t]) => ({ id, label: t.label, cats: t.cats, count: t.cats.reduce((a, k) => a + (by.get(k) ?? 0), 0) }))
    .filter((t) => t.count >= 4);
  return c.json({ topics }, 200, { "Cache-Control": "public, max-age=600" });
});

const notEnough = (c: any) =>
  c.json({ detail: "Not enough verified vocabulary for a quiz yet." }, 404);

app.get("/", async (c) => {
  const mode = (c.req.query("mode") || "choice").toLowerCase();
  const topic = (c.req.query("topic") || "").toLowerCase() || undefined;
  const n = Math.min(Math.max(parseInt(c.req.query("n") ?? "6", 10) || 6, 3), 8);

  // --- match: n disjoint pairs ---
  if (mode === "match") {
    let items = await pool(c.env, n * 4, topic);
    if (items.length < n) items = await pool(c.env, n * 4);
    if (items.length < n) return notEnough(c);
    // Distinct English sides too, or two rows read as the same answer.
    const seenEn = new Set<string>();
    const pairs: Entry[] = [];
    for (const e of items) {
      const k = e.en.toLowerCase();
      if (seenEn.has(k)) continue;
      seenEn.add(k);
      pairs.push(e);
      if (pairs.length === n) break;
    }
    if (pairs.length < 3) return notEnough(c);
    return c.json({
      mode: "match",
      pairs: pairs.map((p) => ({ ga: p.ga, en: p.en, source: p.source })),
      order: shuffle(pairs.map((_, i) => i)),
    });
  }

  // --- blank: a multi-word entry with one word removed ---
  if (mode === "blank") {
    const res = await c.env.DB.prepare(
      `SELECT headword, translations, meanings, phonetic, category, source, verified_at
         FROM vocabulary
         WHERE ${GATE} AND headword LIKE '% %'
         ORDER BY RANDOM() LIMIT 20`
    ).all<VocabRow>();

    const phrases = (res.results ?? [])
      .map(toEntry)
      .filter((e) => e.ga && e.en && e.ga.split(/\s+/).length >= 2);

    if (phrases.length) {
      const pick = phrases[0];
      const words = pick.ga.split(/\s+/);
      // Blank a word worth guessing — prefer the longest, never a 1-char token.
      let bi = 0;
      for (let i = 1; i < words.length; i++) {
        if (words[i].length > words[bi].length) bi = i;
      }
      if (words[bi].length >= 2) {
        const answer = words[bi];
        const distractors = phrases
          .slice(1)
          .flatMap((p) => p.ga.split(/\s+/))
          .filter((w) => w.length >= 2 && w.toLowerCase() !== answer.toLowerCase());
        const uniq = nearestByLength(answer, [...new Set(distractors)], 3);
        if (uniq.length >= 2) {
          return c.json({
            mode: "blank",
            question: pick.en,
            phrase: words.map((w, i) => (i === bi ? null : w)),
            answer,
            options: shuffle([answer, ...uniq]),
            gloss: pick.gloss,
            phonetic: pick.phonetic,
            source: pick.source,
          });
        }
      }
    }
    // Not enough multi-word entries — fall through to a choice question rather
    // than failing the whole round.
  }

  // --- choice (default) ---
  // A topic round asks about that topic; distractors come from it too when
  // it has enough words, else from the whole dictionary.
  let items = await pool(c.env, 12, topic);
  if (items.length < 4) {
    const extra = await pool(c.env, 12);
    items = [...items, ...extra.filter((e) => !items.some((x) => x.ga === e.ga))];
  }
  if (items.length < 4) return notEnough(c);

  const pick = items[0];
  const distractors = nearestByLength(pick.ga, items.slice(1).map((x) => x.ga), 3);
  const options = shuffle([pick.ga, ...distractors]);

  return c.json({
    mode: "choice",
    question: pick.en,
    answer: pick.ga,
    options,
    gloss: pick.gloss,
    phonetic: pick.phonetic,
    category: pick.category,
    source: pick.source,
  });
});

export default app;
