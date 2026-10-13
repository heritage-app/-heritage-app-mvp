/**
 * Public, crawlable pages on speakga.org, rendered from the verified archive:
 *
 *   /learn-ga             topic hub
 *   /learn-ga/:topic      checked Ga words for one topic (greetings, numbers, ...)
 *   /samai                Ga samai symbols
 *   /samai/:slug          one symbol, every documented reading with its source
 *   /about, /support      the project, and how to support the research (live figures)
 *
 * Only verified vocabulary (source + verified_at) is published, the same gate the
 * app answers from. Samai readings appear once their dataset has been imported.
 * On app.speakga.org these paths redirect to speakga.org.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../types";
import { hostKind, SITE } from "./seo";
import { SAMAI, type SamaiSymbol } from "../data/samai";
import { archiveStats } from "../rag/archive-stats";

type C = Context<{ Bindings: Env; Variables: Variables }>;
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

export interface Topic { slug: string; title: string; h1: string; blurb: string; cats: string[]; ask: string }
export const TOPICS: Topic[] = [
  { slug: "greetings", title: "Greetings", h1: "Greetings in Ga", blurb: "Say good morning, welcome someone, ask how they are and say goodbye the way Ga speakers do.", cats: ["greeting", "expressions"], ask: "how do you greet someone in Ga" },
  { slug: "everyday-phrases", title: "Everyday phrases", h1: "Everyday Ga phrases", blurb: "Short phrases for daily life: yes and no, thank you, please, and the things people say every day.", cats: ["phrase", "general"], ask: "teach me some everyday Ga phrases" },
  { slug: "numbers", title: "Numbers", h1: "Numbers in Ga", blurb: "Count in Ga, from one to ten and on to the tens. Ga builds bigger numbers from the small ones.", cats: ["number", "numbers"], ask: "how do you count in Ga" },
  { slug: "days-months-and-time", title: "Days, months and time", h1: "Days, months and time in Ga", blurb: "The days of the week, the months of the year, and words for today, tomorrow, morning and night.", cats: ["time", "days", "months"], ask: "what are the days of the week in Ga" },
  { slug: "family", title: "Family", h1: "Family words in Ga", blurb: "Mother, father, children, brothers and sisters, and the wider family.", cats: ["family"], ask: "how do you say mother in Ga" },
  { slug: "people-and-chieftaincy", title: "People and chieftaincy", h1: "People and chieftaincy in Ga", blurb: "Words for people, roles and the Ga chieftaincy: chiefs, elders and the titles of a traditional state.", cats: ["people", "chief", "chieftaincy"], ask: "what is a chief called in Ga" },
  { slug: "body-and-health", title: "Body and health", h1: "Body and health in Ga", blurb: "Parts of the body, and how to talk about feeling unwell.", cats: ["body", "sickness"], ask: "how do you say head in Ga" },
  { slug: "food-and-market", title: "Food and the market", h1: "Food and the market in Ga", blurb: "Food, cooking and shopping: what to say at the market and in the kitchen.", cats: ["food", "market", "shop", "kitchen"], ask: "how do you say food in Ga" },
  { slug: "home", title: "Around the home", h1: "Around the home in Ga", blurb: "Everyday things in and around the house.", cats: ["household"], ask: "how do you say house in Ga" },
  { slug: "animals", title: "Animals", h1: "Animals in Ga", blurb: "Animals, birds, fish and insects.", cats: ["animals", "birds", "fish", "insects"], ask: "how do you say dog in Ga" },
  { slug: "weather", title: "Weather", h1: "Weather in Ga", blurb: "Sun, rain, wind and sky, and how to talk about the weather.", cats: ["weather"], ask: "how do you say rain in Ga" },
  { slug: "describing-things", title: "Describing things", h1: "Describing things in Ga", blurb: "Colours, sizes and qualities: the words that describe people and things.", cats: ["descriptive", "colours"], ask: "how do you say beautiful in Ga" },
  { slug: "directions-and-travel", title: "Directions and travel", h1: "Directions and travel in Ga", blurb: "Left, right, near and far, and getting around.", cats: ["directions", "travel", "post-office"], ask: "how do you ask for directions in Ga" },
  { slug: "school-and-books", title: "School and books", h1: "School and books in Ga", blurb: "School, reading and the names of books.", cats: ["school", "book"], ask: "how do you say school in Ga" },
  { slug: "music", title: "Music", h1: "Music in Ga", blurb: "Drums, songs and dance.", cats: ["music"], ask: "how do you say drum in Ga" },
  { slug: "bible-words", title: "Bible words", h1: "Bible words in Ga", blurb: "Names and words from the Ga Bible: God, the books of the Bible, chapter and verse.", cats: ["bible"], ask: "how do you say God in Ga" },
];

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const ask = (q: string) => `https://app.speakga.org/?q=${encodeURIComponent(q)}`;
const fmt = (n: number) => n.toLocaleString("en-GB");
const json = <T>(s: string | null | undefined, d: T): T => { try { return JSON.parse(s || "") as T; } catch { return d; } };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ data */

interface Word { id: string; ga: string; english: string; also: string[]; phonetic: string | null; example: { ga: string; en: string } | null; source: string }

async function wordsFor(env: Env, cats: string[]): Promise<Word[]> {
  const rows = await env.DB.prepare(
    `SELECT id, headword, meanings, translations, phonetic, examples, source FROM vocabulary
     WHERE category IN (${cats.map(() => "?").join(",")})
       AND source IS NOT NULL AND TRIM(source) <> '' AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''
     ORDER BY id`
  ).bind(...cats).all<{ id: string; headword: string; meanings: string; translations: string; phonetic: string | null; examples: string; source: string }>();
  const seen = new Map<string, Word>();
  for (const r of rows.results || []) {
    const meanings = json<string[]>(r.meanings, []).filter(Boolean);
    const english = meanings[0] || json<string[]>(r.translations, [])[0] || "";
    if (!r.headword || !english) continue;
    const key = r.headword.toLowerCase().trim();
    const exRaw = json<any[]>(r.examples, []).find((e) => (typeof e === "string" ? e.trim() : e?.ga));
    let example: Word["example"] = null;
    if (typeof exRaw === "string") {
      const [ga, en] = exRaw.split(/\s+[—–-]\s+/);
      // Skip notes that aren't usage examples (e.g. a list of letters).
      const letters = (ga || "").split(/\s+/).filter((w) => w.length === 1).length;
      if (ga && en && letters < 3 && ga.trim().toLowerCase() !== key) example = { ga: ga.trim(), en: en.trim() };
    } else if (exRaw?.ga) example = { ga: String(exRaw.ga), en: String(exRaw.english || exRaw.en || "") };
    const prev = seen.get(key);
    if (prev) { for (const m of meanings) if (m !== prev.english && !prev.also.includes(m)) prev.also.push(m); continue; }
    seen.set(key, { id: r.id, ga: r.headword.trim(), english: cap(english), also: meanings.slice(1).map(cap), phonetic: r.phonetic, example, source: r.source });
  }
  return [...seen.values()];
}

async function topicCounts(env: Env): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT category, COUNT(DISTINCT LOWER(TRIM(headword))) n FROM vocabulary
     WHERE source IS NOT NULL AND TRIM(source) <> '' AND verified_at IS NOT NULL AND TRIM(verified_at) <> '' GROUP BY category`
  ).all<{ category: string; n: number }>();
  const byCat = Object.fromEntries((rows.results || []).map((r) => [r.category, r.n]));
  return Object.fromEntries(TOPICS.map((t) => [t.slug, t.cats.reduce((n, c) => n + (byCat[c] || 0), 0)]));
}

/** URL slug for a headword: ASCII-folded, punctuation stripped, spaces to hyphens. */
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[''ʼ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

interface VocabEntry {
  slug: string; ga: string; pos: string | null; phonetic: string | null;
  english: string[]; examples: { ga: string; en: string }[]; category: string; source: string;
}

/** Every verified vocabulary entry, merged by slug (one page per headword). */
async function vocabBySlug(env: Env): Promise<Map<string, VocabEntry>> {
  const rows = await env.DB.prepare(
    `SELECT headword, headword_normalized, part_of_speech, meanings, translations, phonetic, examples, category, source FROM vocabulary
     WHERE source IS NOT NULL AND TRIM(source) <> '' AND verified_at IS NOT NULL AND TRIM(verified_at) <> '' ORDER BY id`
  ).all<{ headword: string; headword_normalized: string; part_of_speech: string | null; meanings: string; translations: string; phonetic: string | null; examples: string; category: string; source: string }>();
  const map = new Map<string, VocabEntry>();
  for (const r of rows.results || []) {
    const slug = slugify(r.headword_normalized || r.headword || "");
    if (!slug) continue;
    const meanings = [...json<string[]>(r.meanings, []), ...json<string[]>(r.translations, [])]
      .map((m) => String(m).trim()).filter(Boolean);
    const examples = json<any[]>(r.examples, [])
      .map((e) => {
        if (typeof e === "string") {
          const [ga, en] = e.split(/\s+[—–-]\s+/);
          return ga && en ? { ga: ga.trim(), en: en.trim() } : null;
        }
        return e?.ga ? { ga: String(e.ga), en: String(e.english || e.en || "") } : null;
      })
      .filter((x): x is { ga: string; en: string } => !!x);
    const prev = map.get(slug);
    if (prev) {
      for (const m of meanings) if (!prev.english.some((e) => e.toLowerCase() === m.toLowerCase())) prev.english.push(cap(m));
      for (const e of examples) if (prev.examples.length < 4 && !prev.examples.some((p) => p.ga === e.ga)) prev.examples.push(e);
      if (!prev.phonetic && r.phonetic) prev.phonetic = r.phonetic;
      continue;
    }
    if (!meanings.length) continue;
    map.set(slug, {
      slug, ga: (r.headword || "").trim(), pos: r.part_of_speech, phonetic: r.phonetic,
      english: [...new Set(meanings.map(cap))], examples, category: r.category || "", source: r.source,
    });
  }
  return map;
}

/** Up to `n` corpus sentences containing the headword (used only when the entry lacks examples). */
async function corpusExamples(env: Env, headwordNorm: string, n = 3): Promise<{ ga: string; en: string }[]> {
  const probe = slugify(headwordNorm).replace(/-/g, " ");
  if (!probe) return [];
  const rows = await env.DB.prepare(
    `SELECT english, ga, ga_norm FROM corpus_pairs WHERE ga_norm LIKE '%' || ? || '%' LIMIT 40`
  ).bind(probe).all<{ english: string; ga: string; ga_norm: string }>().catch(() => ({ results: [] as any[] }));
  const words = probe.split(" ");
  const out: { ga: string; en: string }[] = [];
  for (const r of rows.results || []) {
    const toks = String(r.ga_norm || "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const hit = toks.some((_, i) => words.every((w, j) => toks[i + j] === w));
    if (!hit || !r.ga || !r.english || r.ga.length > 140) continue;
    out.push({ ga: String(r.ga).trim(), en: String(r.english).trim() });
    if (out.length >= n) break;
  }
  return out;
}

/** Samai symbols with only the readings whose dataset is in the archive. */
export async function liveSamai(env: Env): Promise<SamaiSymbol[]> {
  const rows = await env.DB.prepare("SELECT DISTINCT original_filename f FROM documents WHERE original_filename LIKE 'ga-samai%'")
    .all<{ f: string }>().catch(() => ({ results: [] as { f: string }[] }));
  const imported = new Set((rows.results || []).map((r) => r.f));
  return SAMAI
    .map((s) => ({ ...s, readings: s.readings.filter((r) => imported.has(r.dataset)) }))
    .filter((s) => s.readings.length)
    .map((s) => ({ ...s, name: s.readings[0].name }));
}

/** Every public page, for the sitemap. */
export async function sitePages(env: Env): Promise<Array<{ path: string; images?: string[] }>> {
  const [counts, samai, vocab] = await Promise.all([topicCounts(env), liveSamai(env), vocabBySlug(env)]);
  return [
    { path: "/translate" },
    { path: "/learn-ga" },
    ...TOPICS.filter((t) => counts[t.slug] > 0).map((t) => ({ path: `/learn-ga/${t.slug}` })),
    { path: "/ga-words" },
    ...[...vocab.keys()].map((slug) => ({ path: `/ga-words/${slug}` })),
    { path: "/samai", images: samai.map((s) => s.readings[0].image) },
    ...samai.map((s) => ({ path: `/samai/${s.slug}`, images: s.readings.map((r) => r.image) })),
    { path: "/about" },
    { path: "/support" },
  ];
}

/* ---------------------------------------------------------------- layout */

const CSS = `
:root{--bg:#FFFFFF;--app:#FBF7F1;--paper-2:#F7F1E8;--line:#EBE1D2;--ink:#16130F;--ink-2:rgba(22,19,15,.76);--muted:rgba(22,19,15,.66);
--gold:#F2B33D;--gold-ink:#7A5200;--gold-soft:rgba(242,179,61,.16);--sage:#E3F1E4;--sage-ink:#1F7A4A;--blush:#FBE4E3;--blush-ink:#A3312A;
--display:"Bricolage Grotesque","Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;--sans:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--max:1180px;color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html{background:#fff}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:clip}
a{color:inherit}
h1,h2,h3{font-family:var(--display);font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:0;text-wrap:balance}
p{margin:0}
.wrap{max-width:var(--max);margin:0 auto;padding-inline:clamp(16px,5vw,40px)}
.eyebrow{font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-ink)}
.lede{font-size:clamp(17px,1.5vw,19px);color:var(--ink-2);max-width:62ch}
.btn{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 22px;border-radius:999px;font-weight:700;font-size:15.5px;text-decoration:none;border:1.5px solid transparent;font-family:var(--sans)}
.btn-ink{background:var(--ink);color:#fff}.btn-gold{background:var(--gold);color:#1a1205}.btn-line{border-color:var(--line);background:#fff}
:focus-visible{outline:3px solid var(--gold);outline-offset:3px;border-radius:10px}
header{position:sticky;top:0;z-index:30;background:color-mix(in srgb,#fff 86%,transparent);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);border-bottom:1px solid transparent}
.nav{display:flex;align-items:center;gap:24px;height:72px}
.brand{display:flex;align-items:center;flex:none}.brand img{height:38px;width:auto;display:block}
.links{display:flex;gap:26px;margin:0 0 0 auto;padding:0;list-style:none}
.links a{text-decoration:none;font-weight:600;font-size:15px;color:var(--ink-2)}.links a:hover,.links a[aria-current]{color:var(--ink)}
.links a[aria-current]{box-shadow:0 2px 0 var(--gold)}
.nav .btn{min-height:42px;padding:0 18px;font-size:15px}
@media (max-width:820px){.links{display:none}.nav .btn{margin-left:auto}.brand img{height:32px}}
.crumbs{font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;padding-top:22px}
.crumbs a{text-decoration:none}.crumbs a:hover{color:var(--ink)}
.hero{padding-block:clamp(20px,4vw,44px) clamp(24px,4vw,40px);display:grid;gap:16px}
.hero h1{font-size:clamp(36px,5.4vw,64px)}
.hero .row{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:var(--paper-2);text-decoration:none;font-weight:600;font-size:14.5px;color:var(--ink-2)}
.chip b{font-weight:700;color:var(--muted);font-size:12.5px}
.chip:hover{background:var(--gold-soft);color:var(--ink)}
@media (max-width:640px){.chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-inline:calc(-1 * clamp(16px,5vw,40px));padding-inline:clamp(16px,5vw,40px)}.chips::-webkit-scrollbar{display:none}.chip{white-space:nowrap}}.chip[aria-current]{background:var(--ink);color:#fff}.chip[aria-current] b{color:rgba(255,255,255,.7)}
.sec{padding-block:clamp(28px,4vw,48px)}
.words{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;list-style:none;margin:0;padding:0}
.w{background:var(--app);border-radius:20px;padding:18px 18px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.w .ga{font:800 23px/1.15 var(--display);letter-spacing:-.02em;overflow-wrap:anywhere}
.w .en{font-weight:600;color:var(--ink-2)}
.w .ph{font-size:13.5px;color:var(--muted)}.w .ph span{font-weight:700;color:var(--gold-ink)}
.w .also{font-size:13.5px;color:var(--muted)}
.w .ex{margin-top:4px;padding-top:10px;border-top:1px solid var(--line);font-size:14px;color:var(--ink-2)}
.w .ex i{font-style:normal;font-weight:700;color:var(--ink)}
.w a.askw{margin-top:auto;padding-top:8px;font-size:13.5px;font-weight:700;color:var(--gold-ink);text-decoration:none}
.w a.askw:hover{text-decoration:underline}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{display:flex;flex-direction:column;gap:8px;padding:20px;border-radius:22px;background:var(--app);text-decoration:none;min-width:0}
.card:hover{background:var(--gold-soft)}
.card h2,.card h3{font-size:22px}
.card p{color:var(--ink-2);font-size:15px}
.card .n{font-size:13.5px;font-weight:700;color:var(--gold-ink);margin-top:auto}
.sym{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:22px 16px 18px;border-radius:22px;background:var(--app);text-decoration:none}
.sym:hover{background:var(--gold-soft)}
.sym img{width:min(150px,60%);height:auto;aspect-ratio:1;object-fit:contain}
.sym h2{font-size:21px}.sym p{font-size:14px;color:var(--ink-2)}
.symbol{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:clamp(24px,5vw,64px);align-items:start;padding-block:clamp(16px,3vw,32px)}
@media (max-width:820px){.symbol{grid-template-columns:1fr}}
.symbol .art{background:var(--app);border-radius:28px;padding:clamp(24px,5vw,48px);display:grid;place-items:center}
.symbol .art img{width:100%;max-width:300px;height:auto;aspect-ratio:1;object-fit:contain}
.reading{padding:20px 0;border-top:1px solid var(--line);display:grid;gap:8px}
.reading:first-of-type{border-top:0;padding-top:0}
.reading .m{font:700 clamp(20px,2.2vw,26px)/1.3 var(--display);letter-spacing:-.015em}
.reading .src{font-size:14px;color:var(--muted)}
.reading .note{font-size:15px;color:var(--ink-2);background:var(--paper-2);border-radius:14px;padding:12px 14px}
.reading img.alt{width:96px;height:96px;object-fit:contain;background:var(--app);border-radius:14px;padding:8px}
.cta{background:var(--ink);color:#fff;border-radius:28px;padding:clamp(24px,4vw,44px);display:grid;grid-template-columns:1fr auto;gap:18px 28px;align-items:center}
.cta h2{font-size:clamp(26px,3vw,36px)}.cta p{color:rgba(255,255,255,.75);margin-top:8px}
.cta .row{display:flex;flex-wrap:wrap;gap:10px}
@media (max-width:760px){.cta{grid-template-columns:1fr}}
.prose{display:grid;gap:16px;max-width:70ch;font-size:17.5px;color:var(--ink-2)}
.prose h2{font-size:clamp(24px,2.6vw,32px);color:var(--ink);margin-top:18px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:820px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.stat{background:var(--app);border-radius:20px;padding:18px}
.stat b{display:block;font:800 clamp(28px,3.4vw,40px)/1 var(--display);letter-spacing:-.03em}
.stat span{display:block;font-weight:700;margin-top:8px}.stat small{display:block;color:var(--muted);font-size:13.5px;margin-top:2px}
.stat.gap b{color:var(--blush-ink)}
.src-list{font-size:14px;color:var(--muted)}
footer{border-top:1px solid var(--line);padding-block:40px calc(40px + env(safe-area-inset-bottom,0px));font-size:14px;color:var(--muted);margin-top:clamp(32px,5vw,64px)}
.f-row{display:flex;flex-wrap:wrap;gap:16px 32px;justify-content:space-between;align-items:center}
.f-links{display:flex;flex-wrap:wrap;gap:8px 22px;list-style:none;margin:0;padding:0}
.f-links a{text-decoration:none}.f-links a:hover{color:var(--ink)}
.brand-sm img{height:30px}
`;

const NAV: Array<[string, string]> = [["/translate", "Translate"], ["/learn-ga", "Learn Ga"], ["/ga-words", "Ga words"], ["/samai", "Samai"], ["/about", "About"], ["/support", "Support"]];

function page(o: { path: string; title: string; description: string; body: string; jsonld?: object[]; image?: string; section?: string }): string {
  const url = `${SITE}${o.path}`;
  const image = o.image ? (o.image.startsWith("http") ? o.image : `${SITE}${o.image}`) : `${SITE}/img/og/speakga-share.png`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebPage", "@id": `${url}#page`, url, name: o.title, description: o.description, inLanguage: "en", isPartOf: { "@id": `${SITE}/#website` }, publisher: { "@id": `${SITE}/#org` } },
    ...(o.jsonld || []),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#FFFFFF">
<meta property="og:type" content="website"><meta property="og:site_name" content="SpeakGa"><meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}"><meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.title)}"><meta name="twitter:description" content="${esc(o.description)}"><meta name="twitter:image" content="${esc(image)}">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header><div class="wrap nav">
  <a class="brand" href="/"><img src="/img/brand/speakga-logo.png" width="515" height="144" alt="SpeakGa"></a>
  <ul class="links">${NAV.map(([h, l]) => `<li><a href="${h}"${o.section === h ? ' aria-current="page"' : ""}>${l}</a></li>`).join("")}</ul>
  <a class="btn btn-ink" href="https://app.speakga.org/">Try SpeakGa</a>
</div></header>
<main>${o.body}</main>
<footer><div class="wrap f-row">
  <a class="brand brand-sm" href="/"><img src="/img/brand/speakga-logo.png" width="515" height="144" alt="SpeakGa"></a>
  <ul class="f-links"><li><a href="https://app.speakga.org/">Open the app</a></li><li><a href="/translate">Translate to Ga</a></li><li><a href="/learn-ga">Learn Ga</a></li><li><a href="/ga-words">Ga words</a></li><li><a href="/samai">Ga samai</a></li><li><a href="/about">About</a></li><li><a href="/support">Support the research</a></li><li><a href="/#give">Contribute</a></li></ul>
  <span>© 2026 Codetrain Foundation</span>
</div></footer>
<script>(function(){function t(e){try{var d=JSON.stringify({e:e,p:location.pathname,r:document.referrer});if(!(navigator.sendBeacon&&navigator.sendBeacon("/api/v1/e",d)))fetch("/api/v1/e",{method:"POST",body:d,keepalive:true})}catch(_){}}t("pageview");document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a&&/^https:\\/\\/app\\.speakga\\.org/.test(a.href))t("start")},true)})();</script>
</body>
</html>`;
}

const crumbs = (items: Array<[string, string?]>) =>
  `<nav class="crumbs wrap" aria-label="Breadcrumb">${items.map(([l, h], i) => (h ? `<a href="${h}">${esc(l)}</a>` : `<span aria-current="page">${esc(l)}</span>`) + (i < items.length - 1 ? "<span>/</span>" : "")).join("")}</nav>`;
const crumbLd = (items: Array<[string, string]>) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${path}` })),
});
const contributeCta = (lead: string) => `<section class="sec wrap"><div class="cta"><div><h2>${lead}</h2><p>SpeakGa grows when Ga speakers add what's missing. Every entry is checked before it's published.</p></div><div class="row"><a class="btn btn-gold" href="/#give">Add a word</a><a class="btn btn-line" style="color:var(--ink)" href="https://app.speakga.org/">Ask Nii Obodai</a></div></div></section>`;

function send(c: C, html: string, status = 200) {
  return c.html(html, status as 200, { "Cache-Control": "public, max-age=300, s-maxage=3600" });
}

/* ----------------------------------------------------------------- routes */

// The app domain serves the app; these pages live on speakga.org.
export const PAGE_PATHS = ["/translate", "/learn-ga", "/learn-ga/*", "/ga-words", "/ga-words/*", "/samai", "/samai/*", "/about", "/support"];
for (const p of PAGE_PATHS) {
  app.use(p, async (c, next) => {
    if (hostKind(c.req.url) === "app") return c.redirect(`${SITE}${new URL(c.req.url).pathname}`, 301);
    await next();
  });
}

app.get("/learn-ga", async (c) => {
  const counts = await topicCounts(c.env);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const live = TOPICS.filter((t) => counts[t.slug] > 0);
  const body = `${crumbs([["Home", "/"], ["Learn Ga"]])}
<section class="hero wrap"><span class="eyebrow">Learn Ga</span><h1>Ga words and phrases, checked by Ga speakers</h1>
<p class="lede">${fmt(total)} entries from SpeakGa's checked Ga dictionary, in ${live.length} topics. Pick a topic, or ask Nii Obodai, SpeakGa's Ga companion, anything: he also knows phrases from the Language Guide, every number in Ga, the Bible in Ga, stories and poems.</p>
<div class="row"><a class="btn btn-ink" href="https://app.speakga.org/">Ask Nii Obodai</a><a class="btn btn-line" href="/samai">Ga samai symbols</a></div></section>
<section class="sec wrap" style="padding-top:0"><div class="grid">${live.map((t) => `<a class="card" href="/learn-ga/${t.slug}"><h2>${esc(t.title)}</h2><p>${esc(t.blurb)}</p><span class="n">${fmt(counts[t.slug])} words and phrases →</span></a>`).join("")}</div></section>
${contributeCta("Know a Ga word that isn't here?")}`;
  return send(c, page({
    path: "/learn-ga", section: "/learn-ga",
    title: "Learn Ga: words and phrases by topic | SpeakGa",
    description: `Learn the Ga language of Accra with ${fmt(total)} checked dictionary entries by topic: greetings, numbers, family, food, days and more, with pronunciation and examples.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Learn Ga", "/learn-ga"]]), {
      "@context": "https://schema.org", "@type": "ItemList", name: "Ga vocabulary topics",
      itemListElement: live.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/learn-ga/${t.slug}`, name: t.h1 })),
    }],
  }));
});

app.get("/learn-ga/:topic", async (c) => {
  const t = TOPICS.find((x) => x.slug === c.req.param("topic"));
  if (!t) return notFound(c);
  const [words, counts] = await Promise.all([wordsFor(c.env, t.cats), topicCounts(c.env)]);
  if (!words.length) return notFound(c);
  if (t.slug !== "numbers") words.sort((a, b) => a.english.localeCompare(b.english, "en", { sensitivity: "base" }));
  const sources = [...new Set(words.map((w) => w.source.replace(/\s*\((curated import|promoted from verified dataset)\)\s*$/i, "")))].slice(0, 6);
  const sample = words.slice(0, 3).map((w) => `${w.ga} (${w.english.toLowerCase()})`).join(", ");
  const others = TOPICS.filter((x) => counts[x.slug] > 0);
  const body = `${crumbs([["Home", "/"], ["Learn Ga", "/learn-ga"], [t.title]])}
<section class="hero wrap"><span class="eyebrow">Learn Ga · ${esc(t.title)}</span><h1>${esc(t.h1)}</h1>
<p class="lede">${esc(t.blurb)} ${fmt(words.length)} checked words and phrases${words.some((w) => w.phonetic) ? ", with a pronunciation guide where we have one" : ""}.</p>
<div class="row"><a class="btn btn-ink" href="${ask(t.ask)}">Practise with Nii Obodai</a></div></section>
<section class="wrap"><div class="chips" aria-label="Topics">${others.map((x) => `<a class="chip" href="/learn-ga/${x.slug}"${x.slug === t.slug ? ' aria-current="page"' : ""}>${esc(x.title)} <b>${fmt(counts[x.slug])}</b></a>`).join("")}</div></section>
<section class="sec wrap"><ul class="words">${words.map((w) => `<li class="w" lang="en">
  <span class="ga" lang="gaa">${esc(w.ga)}</span>
  <span class="en">${esc(w.english)}</span>
  ${w.also.length ? `<span class="also">Also: ${esc(w.also.slice(0, 3).join("; "))}</span>` : ""}
  ${w.phonetic ? `<span class="ph">Say it: <span>${esc(w.phonetic)}</span></span>` : ""}
  ${w.example ? `<p class="ex"><i lang="gaa">${esc(w.example.ga)}</i>${w.example.en ? ` — ${esc(w.example.en)}` : ""}</p>` : ""}
  <a class="askw" href="${ask(`how do you say ${w.english.toLowerCase()} in Ga`)}">Ask about it →</a>
</li>`).join("")}</ul>
<p class="src-list" style="margin-top:22px">Sources: ${sources.map(esc).join("; ")}. Every entry is checked before it's published.</p></section>
${contributeCta(`Know another Ga word for ${t.title.toLowerCase()}?`)}`;
  return send(c, page({
    path: `/learn-ga/${t.slug}`, section: "/learn-ga",
    title: `${t.h1}: ${fmt(words.length)} words and phrases | SpeakGa`,
    description: `${t.h1}, checked by Ga speakers: ${sample} and ${fmt(Math.max(words.length - 3, 0))} more, with English meanings${words.some((w) => w.phonetic) ? ", pronunciation" : ""} and examples.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Learn Ga", "/learn-ga"], [t.title, `/learn-ga/${t.slug}`]]), {
      "@context": "https://schema.org", "@type": "DefinedTermSet", "@id": `${SITE}/learn-ga/${t.slug}#terms`, name: t.h1, inLanguage: "gaa",
      hasDefinedTerm: words.slice(0, 200).map((w) => ({ "@type": "DefinedTerm", name: w.ga, description: w.english, inLanguage: "gaa", inDefinedTermSet: `${SITE}/learn-ga/${t.slug}#terms` })),
    }],
  }));
});

app.get("/samai", async (c) => {
  const symbols = await liveSamai(c.env);
  const body = `${crumbs([["Home", "/"], ["Ga samai"]])}
<section class="hero wrap"><span class="eyebrow">Ga samai</span><h1>Ga samai: the symbols of the Ga people</h1>
<p class="lede">Samai means “symbols” in Ga. Like the Akan Adinkra, each samai carries a proverb or a piece of wisdom as a simple drawing. Here are ${symbols.length} of them, with their meanings and where each meaning comes from.</p>
<div class="row"><a class="btn btn-ink" href="${ask("what are Ga samai symbols")}">Ask Nii Obodai about samai</a></div></section>
<section class="sec wrap" style="padding-top:8px"><div class="grid">${symbols.map((s) => `<a class="sym" href="/samai/${s.slug}"><img src="${esc(s.readings[0].image)}" alt="${esc(s.name)} samai symbol" width="400" height="400" loading="lazy"><h2 lang="gaa">${esc(s.name)}</h2><p>${esc(short(s.readings[0].meaning))}</p></a>`).join("")}</div></section>
${contributeCta("Know a samai that isn't here?")}`;
  return send(c, page({
    path: "/samai", section: "/samai",
    title: `Ga samai symbols and their meanings (${symbols.length}) | SpeakGa`,
    description: `Ga samai are traditional Ga symbols that carry proverbs and wisdom, like the Akan Adinkra. See ${symbols.map((s) => s.name).slice(0, 4).join(", ")} and more, with their meanings and sources.`,
    image: symbols[0]?.readings[0].image, body,
    jsonld: [crumbLd([["Home", "/"], ["Ga samai", "/samai"]]), {
      "@context": "https://schema.org", "@type": "ItemList", name: "Ga samai symbols",
      itemListElement: symbols.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/samai/${s.slug}`, name: s.name })),
    }],
  }));
});

function short(s: string): string {
  // "Needle — a samai symbol warning against anger…" -> "Warning against anger…"
  const after = /a samai symbol\s+(\S.*)$/.exec(s)?.[1];
  const t = after ? cap(after) : s.replace(/^["“]|["”]$/g, "").split(/\s+[—–]\s+|;\s/)[0];
  return t.length > 110 ? `${t.slice(0, 107).replace(/\s+\S*$/, "")}…` : t;
}

app.get("/samai/:slug", async (c) => {
  const symbols = await liveSamai(c.env);
  const s = symbols.find((x) => x.slug === c.req.param("slug"));
  if (!s) return notFound(c);
  const first = s.readings[0];
  const others = symbols.filter((x) => x.slug !== s.slug);
  const body = `${crumbs([["Home", "/"], ["Ga samai", "/samai"], [s.name]])}
<section class="wrap symbol">
  <div class="art"><img src="${esc(first.image)}" alt="${esc(s.name)}, a Ga samai symbol" width="400" height="400"></div>
  <div style="display:grid;gap:18px">
    <span class="eyebrow">Ga samai symbol</span>
    <h1 lang="gaa" style="font-size:clamp(40px,5.6vw,68px)">${esc(s.name)}</h1>
    <div>${s.readings.map((r) => `<div class="reading">
      ${s.readings.length > 1 && r !== first ? `<img class="alt" src="${esc(r.image)}" alt="${esc(r.name)} as drawn by ${esc(r.source)}" width="96" height="96" loading="lazy">` : ""}
      <p class="m">${esc(r.meaning)}</p>
      ${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}
      <p class="src">${s.readings.length > 1 ? `${esc(r.name)}, according to ` : "Source: "}${r.source_url ? `<a href="${esc(r.source_url)}" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}${r.image_credit ? `. Drawing: ${esc(r.image_credit)}` : ""}</p>
    </div>`).join("")}</div>
    ${s.readings.length > 1 ? `<p class="src-list">Sources describe this symbol differently. Both readings are kept, each with its source.</p>` : ""}
    <div class="row" style="display:flex;flex-wrap:wrap;gap:10px"><a class="btn btn-ink" href="${ask(`what does the ${s.name} samai mean`)}">Ask Nii Obodai about ${esc(s.name)}</a><a class="btn btn-line" href="/samai">All samai</a></div>
  </div>
</section>
<section class="sec wrap"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">More Ga samai</h2><div class="grid">${others.slice(0, 8).map((x) => `<a class="sym" href="/samai/${x.slug}"><img src="${esc(x.readings[0].image)}" alt="${esc(x.name)} samai symbol" width="400" height="400" loading="lazy"><h3 lang="gaa">${esc(x.name)}</h3><p>${esc(short(x.readings[0].meaning))}</p></a>`).join("")}</div></section>`;
  return send(c, page({
    path: `/samai/${s.slug}`, section: "/samai",
    title: `${s.name}: Ga samai symbol meaning | SpeakGa`,
    description: `${s.name} is a Ga samai symbol. Meaning: ${short(first.meaning)}. Source: ${first.source}.`,
    image: first.image, body,
    jsonld: [crumbLd([["Home", "/"], ["Ga samai", "/samai"], [s.name, `/samai/${s.slug}`]]), {
      "@context": "https://schema.org", "@type": "DefinedTerm", name: s.name, description: first.meaning, inLanguage: "gaa",
      image: first.image.startsWith("http") ? first.image : `${SITE}${first.image}`,
      inDefinedTermSet: { "@type": "DefinedTermSet", name: "Ga samai symbols", url: `${SITE}/samai` },
    }],
  }));
});

// Things people actually type into the app or a search engine.
const POPULAR: string[] = [
  "thank you", "good morning", "good afternoon", "good evening", "how are you",
  "welcome", "goodbye", "see you later", "I love you", "yes", "no", "please",
  "sorry", "what is your name", "my name is", "where are you going", "come here",
  "sit down", "how much", "water", "food", "friend", "God bless you", "help me",
];

app.get("/translate", async (c) => {
  const f = await liveFigures(c.env);
  const body = `${crumbs([["Home", "/"], ["Translate English to Ga"]])}
<section class="hero wrap"><span class="eyebrow">English to Ga translator</span><h1>Translate English to Ga</h1>
<p class="lede">Type an English word or phrase and Nii Obodai answers in Ga from SpeakGa's checked archive: ${fmt(f.words)} words and phrases from the Bureau of Ghana Languages' Ga Language Guide, a UCLA Ga course and more than ${fmt(f.corpus)} example sentences.</p>
<form action="https://app.speakga.org/" method="get" style="display:flex;gap:10px;flex-wrap:wrap;max-width:640px">
  <input type="search" name="q" placeholder="e.g. how do you say thank you in Ga" aria-label="English word or phrase" style="flex:1;min-width:240px;min-height:48px;padding:0 18px;border:1.5px solid var(--line);border-radius:999px;font:inherit">
  <button class="btn btn-ink" type="submit" style="cursor:pointer">Translate to Ga</button>
</form></section>
<section class="sec wrap" style="padding-top:0"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">Popular English to Ga translations</h2>
<div class="grid">${POPULAR.map((p) => `<a class="card" href="${ask(`how do you say ${p} in Ga`)}"><h3>${esc(cap(p))}</h3><p>How do you say “${esc(p)}” in Ga?</p></a>`).join("")}</div></section>
<section class="sec wrap" style="padding-top:0"><div class="prose">
<h2>A translator that says when it doesn't know</h2>
<p>Ga has very little digital language data, so SpeakGa doesn't guess. Nii Obodai answers from an archive checked by Ga speakers, and when a word isn't there yet he says so and the question goes to the review queue. You can browse the checked words under <a href="/ga-words">Ga words A–Z</a> or learn by topic under <a href="/learn-ga">Learn Ga</a>.</p>
</div></section>
${contributeCta("Can't find your translation?")}`;
  return send(c, page({
    path: "/translate", section: "/translate",
    title: "English to Ga translator: words and phrases | SpeakGa",
    description: `Translate English to Ga free with SpeakGa. Checked Ga translations for ${fmt(f.words)} words and phrases — thank you, good morning, numbers, family and more — plus ${fmt(f.corpus)} example sentences.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Translate English to Ga", "/translate"]])],
  }));
});

app.get("/ga-words", async (c) => {
  const vocab = await vocabBySlug(c.env);
  const entries = [...vocab.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const letters = new Map<string, VocabEntry[]>();
  for (const w of entries) {
    const L = (w.slug[0] || "#").replace(/[^a-z]/, "#");
    (letters.get(L) ?? letters.set(L, []).get(L)!).push(w);
  }
  const az = [...letters.keys()].sort();
  const body = `${crumbs([["Home", "/"], ["Ga words"]])}
<section class="hero wrap"><span class="eyebrow">Ga dictionary</span><h1>Ga words and their meanings</h1>
<p class="lede">${fmt(entries.length)} checked Ga words and phrases, A to Z — every one verified by Ga speakers with its English meaning${entries.some((w) => w.phonetic) ? ", pronunciation where we have it" : ""} and example sentences. This is the same dictionary Nii Obodai answers from.</p>
<div class="row"><a class="btn btn-ink" href="/translate">Translate English to Ga</a><a class="btn btn-line" href="${ask("teach me some Ga words")}">Ask Nii Obodai</a></div>
<div class="chips" style="margin-top:14px" aria-label="Jump to a letter">${az.map((L) => `<a class="chip" href="#${L}">${L.toUpperCase()} <b>${fmt(letters.get(L)!.length)}</b></a>`).join("")}</div></section>
${az.map((L) => `<section class="sec wrap" style="padding-block:20px" id="${L}"><h2 style="font-size:clamp(22px,2.4vw,30px);margin-bottom:14px">${L.toUpperCase()}</h2>
<ul class="words">${letters.get(L)!.map((w) => `<li class="w"><a href="/ga-words/${w.slug}" style="text-decoration:none"><span class="ga" lang="gaa">${esc(w.ga)}</span></a><span class="en">${esc(w.english.slice(0, 3).join("; "))}</span></li>`).join("")}</ul></section>`).join("")}
${contributeCta("Know a Ga word that isn't here?")}`;
  return send(c, page({
    path: "/ga-words", section: "/ga-words",
    title: `Ga words A–Z: ${fmt(entries.length)} Ga words and their meaning | SpeakGa`,
    description: `Browse ${fmt(entries.length)} Ga words with English meanings, pronunciation and examples — every entry checked by Ga speakers. From aba (arrive) to numbers, greetings and proverbs.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Ga words", "/ga-words"]]), {
      "@context": "https://schema.org", "@type": "DefinedTermSet", "@id": `${SITE}/ga-words#terms`,
      name: "SpeakGa Ga dictionary", inLanguage: "gaa",
    }],
  }));
});

app.get("/ga-words/:slug", async (c) => {
  const vocab = await vocabBySlug(c.env);
  const w = vocab.get(c.req.param("slug"));
  if (!w) return notFound(c);
  const topic = TOPICS.find((t) => t.cats.includes(w.category));
  const examples = w.examples.length >= 2 ? w.examples : [...w.examples, ...(await corpusExamples(c.env, w.ga, 3 - w.examples.length))];
  const related = [...vocab.values()].filter((x) => x.category === w.category && x.slug !== w.slug).slice(0, 8);
  const first = w.english[0].toLowerCase();
  const desc = `${w.ga} is Ga for “${w.english.slice(0, 3).join("; ").toLowerCase()}”${w.phonetic ? ` (say it: ${w.phonetic})` : ""}. Checked by Ga speakers${w.source ? ` — source: ${w.source.replace(/\s*\((curated import|promoted from verified dataset)\)\s*$/i, "")}` : ""}.`;
  const body = `${crumbs([["Home", "/"], ["Ga words", "/ga-words"], [w.ga]])}
<section class="hero wrap"><span class="eyebrow">Ga word${w.pos ? ` · ${esc(w.pos)}` : ""}</span>
<h1 lang="gaa">${esc(w.ga)}</h1>
<p class="lede"><b lang="gaa">${esc(w.ga)}</b> is Ga for “${esc(w.english.join("; ").toLowerCase())}”.${w.phonetic ? ` Say it: <b>${esc(w.phonetic)}</b>.` : ""}</p>
<div class="row"><a class="btn btn-ink" href="${ask(`what does ${w.ga} mean in Ga`)}">Ask Nii Obodai about ${esc(w.ga)}</a><a class="btn btn-line" href="${ask(`use ${w.ga} in a sentence`)}">Use it in a sentence</a></div></section>
${examples.length ? `<section class="sec wrap" style="padding-top:0"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">${esc(w.ga)} in a sentence</h2>
<div class="grid">${examples.slice(0, 4).map((e) => `<div class="card"><p lang="gaa" style="font-weight:700;color:var(--ink)">${esc(e.ga)}</p><p>“${esc(e.en)}”</p></div>`).join("")}</div>
${w.examples.length < 2 ? `<p class="src-list" style="margin-top:14px">Example sentences from the wider archive — not individually verified like the dictionary entry.</p>` : ""}</section>` : ""}
<section class="sec wrap" style="padding-top:0"><div class="prose">
<h2>How do you say ${esc(first)} in Ga?</h2>
<p>${esc(first.charAt(0).toUpperCase() + first.slice(1))} in Ga is <b lang="gaa">${esc(w.ga)}</b>${w.english.length > 1 ? ` — it can also mean ${esc(w.english.slice(1).join(" and ").toLowerCase())}` : ""}. To hear how it's used in real sentences, ask Nii Obodai in the app.</p>
</div></section>
${related.length ? `<section class="sec wrap" style="padding-top:0"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">More ${topic ? esc(topic.title.toLowerCase()) : "Ga words"}</h2><div class="chips">${related.map((x) => `<a class="chip" href="/ga-words/${x.slug}" lang="gaa">${esc(x.ga)} <b>${esc(x.english[0].toLowerCase())}</b></a>`).join("")}${topic ? `<a class="chip" href="/learn-ga/${topic.slug}">All ${esc(topic.title.toLowerCase())} →</a>` : ""}</div></section>` : ""}
${contributeCta(`Know another way to say ${first} in Ga?`)}`;
  return send(c, page({
    path: `/ga-words/${w.slug}`, section: "/ga-words",
    title: `${w.ga}: "${first}" in Ga | SpeakGa Ga dictionary`,
    description: desc.length > 160 ? desc.slice(0, 157).replace(/\s+\S*$/, "") + "…" : desc,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Ga words", "/ga-words"], [w.ga, `/ga-words/${w.slug}`]]), {
      "@context": "https://schema.org", "@type": "DefinedTerm", name: w.ga, description: w.english.join("; "),
      inLanguage: "gaa", inDefinedTermSet: { "@type": "DefinedTermSet", name: "SpeakGa Ga dictionary", url: `${SITE}/ga-words` },
    }],
  }));
});

async function liveFigures(env: Env) {
  const [s, corpus] = await Promise.all([
    archiveStats(env),
    env.DB.prepare("SELECT COUNT(*) n FROM corpus_pairs").first<{ n: number }>().catch(() => null),
  ]);
  return { words: s.words_and_phrases, dictionary: s.dictionary_entries, numbers: s.numbers_in_words, verses: s.bible_verses, translations: s.bible_translations, stories: s.stories, poems: s.poems_and_songs, samai: s.samai, corpus: corpus?.n ?? 0 };
}

app.get("/about", async (c) => {
  const f = await liveFigures(c.env);
  const body = `${crumbs([["Home", "/"], ["About"]])}
<section class="hero wrap"><span class="eyebrow">About SpeakGa</span><h1>A Ga language companion, built on checked Ga</h1>
<p class="lede">SpeakGa helps people learn and use Ga, the language of Accra and the Ga people of Ghana. It's a free app and a research project by Codetrain Foundation.</p>
<div class="row"><a class="btn btn-ink" href="https://app.speakga.org/">Try SpeakGa</a><a class="btn btn-line" href="/support">Support the research</a></div></section>
<section class="sec wrap" style="padding-top:0"><div class="prose">
<h2>Meet Nii Obodai</h2>
<p>In the app you talk to Nii Obodai, SpeakGa's Ga companion. Ask how to say something, what a word means, or for a verse in Ga, and he answers from the SpeakGa archive. When the archive doesn't have it, he says so instead of guessing, and the question is passed to the team so it can be answered properly.</p>
<h2>What's in the archive</h2>
<p>${fmt(f.words)} Ga words and phrases, including ${fmt(f.dictionary)} entries in SpeakGa's checked dictionary. Every number from 1 to ${fmt(f.numbers)} in Ga words. ${fmt(f.verses)} Bible verses from ${f.translations} full Ga translations alongside English. ${f.stories} stories and ${f.poems} poems and songs, and ${f.samai} samai symbols with their meanings. Sources include the Bureau of Ghana Languages' Ga Language Guide, a 1980 UCLA Ga conversation course and Storybooks Ghana.</p>
<h2>Learn, read and play</h2>
<p>Beyond questions, the app has short lessons, quizzes and word games, the Bible in Ga verse by verse, and Ga stories and poems. It works in any browser and can be installed on a phone.</p>
<h2>Built with Ga speakers</h2>
<p>Anyone can suggest a word, correct an answer or share a source. Every contribution is reviewed before it's published, and people who know Ga decide what goes in.</p>
<h2>Who's behind it</h2>
<p>SpeakGa is built by Codetrain Foundation in Ghana. It's an open research effort to give Ga a place in the digital world: better language data, recorded speech, and AI that only claims what it can back up.</p>
</div></section>
<section class="sec wrap"><div class="grid"><a class="card" href="/learn-ga"><h2>Learn Ga</h2><p>Checked words and phrases by topic.</p><span class="n">Browse topics →</span></a><a class="card" href="/samai"><h2>Ga samai</h2><p>Traditional Ga symbols and their meanings.</p><span class="n">See the symbols →</span></a><a class="card" href="/support"><h2>Support the research</h2><p>Fund, partner or lend your Ga.</p><span class="n">Ways to help →</span></a></div></section>`;
  return send(c, page({
    path: "/about", section: "/about",
    title: "About SpeakGa: the Ga language companion | SpeakGa",
    description: `SpeakGa is a free Ga language app and research project by Codetrain Foundation: ${fmt(f.words)} Ga words and phrases, the Bible in Ga, stories, poems and Ga samai, with an AI companion that answers from checked sources.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["About", "/about"]])],
  }));
});

app.get("/support", async (c) => {
  const f = await liveFigures(c.env);
  const mail = "experience@codetrainafrica.com";
  const body = `${crumbs([["Home", "/"], ["Support the research"]])}
<section class="hero wrap"><span class="eyebrow">Support the research</span><h1>Help give Ga a place in the digital future</h1>
<p class="lede">SpeakGa is a research project by Codetrain Foundation. The app works today, but Ga still has very little digital language data. Funding and data partners decide how fast that changes.</p>
<div class="row"><a class="btn btn-ink" href="mailto:${mail}?subject=${encodeURIComponent("SpeakGa: project brief")}">Request the project brief</a><a class="btn btn-line" href="/#give">Contribute a word</a></div></section>
<section class="sec wrap" style="padding-top:0"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">Where the research stands</h2><div class="stats">
<div class="stat"><b>${fmt(f.words)}</b><span>Ga words and phrases</span><small>${fmt(f.dictionary)} in the checked dictionary</small></div>
<div class="stat"><b>${fmt(f.verses)}</b><span>Bible verses in Ga</span><small>${f.translations} full translations, with English</small></div>
<div class="stat"><b>1–${fmt(f.numbers)}</b><span>Numbers in Ga words</span><small>Every number, spelled out</small></div>
<div class="stat"><b>${f.stories + f.poems}</b><span>Stories, poems and songs</span><small>${f.stories} stories, ${f.poems} poems and songs</small></div>
<div class="stat"><b>${f.samai}</b><span>Samai symbols</span><small>With meanings and sources</small></div>
<div class="stat gap"><b>0 hrs</b><span>Recorded Ga speech</span><small>Not started. This needs funding.</small></div>
</div></section>
<section class="sec wrap"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">What your support pays for</h2><div class="grid">
<div class="card"><h3>Verified language data</h3><p>Ga speakers and linguists check and expand the archive: everyday vocabulary, proverbs, idioms and grammar.</p><span class="n">Produces open, reviewed Ga datasets</span></div>
<div class="card"><h3>Recorded speech</h3><p>Recording native speakers of different ages and areas: the groundwork for Ga speech recognition and natural-sounding audio.</p><span class="n">Produces a Ga speech collection</span></div>
<div class="card"><h3>Accuracy and evaluation</h3><p>Measuring how well Nii Obodai answers, with expert review, so the AI only claims what it can back up.</p><span class="n">Produces published benchmarks</span></div>
</div></section>
<section class="sec wrap"><h2 style="font-size:clamp(24px,2.6vw,32px);margin-bottom:16px">Ways to get involved</h2><div class="grid">
<a class="card" href="mailto:${mail}?subject=${encodeURIComponent("SpeakGa: funding the research")}"><h3>Fund the research</h3><p>Foundations, companies and grant makers.</p><span class="n">Request the project brief →</span></a>
<a class="card" href="mailto:${mail}?subject=${encodeURIComponent("SpeakGa: research collaboration")}"><h3>Research with us</h3><p>Universities, linguists and AI labs.</p><span class="n">Propose a collaboration →</span></a>
<a class="card" href="mailto:${mail}?subject=${encodeURIComponent("SpeakGa: sharing Ga data")}"><h3>Share data</h3><p>Archives, publishers, churches and broadcasters with Ga texts or recordings.</p><span class="n">Share a collection →</span></a>
<a class="card" href="/#give"><h3>Lend your Ga</h3><p>Speakers who can check words, add what's missing or record their voice.</p><span class="n">Contribute a word →</span></a>
</div><p class="src-list" style="margin-top:18px">Talk to the team: <a href="mailto:${mail}">${mail}</a></p></section>`;
  return send(c, page({
    path: "/support", section: "/support",
    title: "Support Ga language research | SpeakGa",
    description: `Help build digital resources for the Ga language. SpeakGa has ${fmt(f.words)} Ga words and phrases and ${fmt(f.verses)} Bible verses; recorded Ga speech still needs funding. Fund, partner or share data.`,
    body,
    jsonld: [crumbLd([["Home", "/"], ["Support the research", "/support"]])],
  }));
});

function notFound(c: C) {
  return send(c, page({
    path: new URL(c.req.url).pathname, title: "Page not found | SpeakGa", description: "This page doesn't exist.",
    body: `<section class="hero wrap"><h1>We couldn't find that page</h1><p class="lede">Try a topic in <a href="/learn-ga">Learn Ga</a>, the <a href="/samai">Ga samai</a>, or ask Nii Obodai.</p><div class="row"><a class="btn btn-ink" href="https://app.speakga.org/">Ask Nii Obodai</a></div></section>`,
  }).replace('content="index, follow, max-image-preview:large"', 'content="noindex"'), 404);
}

export default app;
