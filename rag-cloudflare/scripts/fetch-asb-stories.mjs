// Ga storybooks from the African Storybook Initiative (africanstorybook.org,
// CC-BY 4.0) with their English originals, page by page, for the Library and
// "tell me a story": datasets/ga-storybooks-asb.jsonl (same shape as
// ga-storybooks-ghana.jsonl, plus each page's illustration).
//
// A Ga book is a translation of an English one: the English original is found
// among English books by shared author/illustrator names and confirmed by the
// page illustrations, which translations reuse; pages pair up by illustration.
// Stories already in ga-storybooks-ghana.jsonl are skipped.
//   node scripts/fetch-asb-stories.mjs
import fs from "node:fs";

const SITE = "https://www.africanstorybook.org";
const GA = "15295", EN = "1133"; // the site's language ids
const OUT = "datasets/ga-storybooks-asb.jsonl";

const decode = (s) => String(s || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/\\'/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&atilde;/g, "ã").replace(/&amp;/g, "&");
const text = (html) => decode(String(html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/ɛ|ԑ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "n").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": "SpeakGa archive builder (speakga.org)" } }).catch(() => null);
    if (r?.ok) return r.text();
    await sleep(1500);
  }
  throw new Error("fetch failed: " + url);
}

// Book list: every book on the site with its language, level and people.
const list = await get(`${SITE}/booklist.php`);
const books = [...list.matchAll(/bookItems\.push\(\{id:"(\d+)",title:"([^"]*)".*?author:"([^"]*)",people:"([^"]*)",lang:"(\d+)",level:"(\d+)"/g)]
  .map((m) => ({ id: m[1], title: decode(m[2]), translator: decode(m[3]).trim(), people: decode(m[4]), lang: m[5], level: m[6] }));
// Name words (people are listed with double spaces, but some names contain them too).
const nameWords = (s) => new Set(fold(s.replace(/\(.*?\)/g, " ")).split(" ").filter((w) => w.length > 2));

// One book's pages (illustration + text) and its credits.
async function readBook(id) {
  // The reader names the viewer to use; a revised book's viewer id differs
  // from its list id.
  const reader = await get(`${SITE}/reader.php?id=${id}`);
  const viewer = decode(reader.match(/src="(newviewer\/index\.php\?[^"]+)"/)?.[1] || `newviewer/index.php?id=${id}&bt=3&dual=false`);
  const html = await get(`${SITE}/${viewer}`);
  const pages = [...html.matchAll(/<div class="page-wrapper"[^>]*>([\s\S]*?)(?=<div class="page-wrapper"|<div class="page"><div class="backcover|$)/g)].map((m) => {
    const img = m[1].match(/pages\/(\d+)\.(?:png|jpe?g)/i);
    // Older books put the text in <p>; newer ones in s1-text… blocks with
    // invisible "-" spacer lines between sentences.
    const html = m[1].replace(/<div style="line-height:[^"]*color:transparent;?">-<\/div>/g, " ")
      .replace(/<div[^>]*class="[^"]*page-number[^"]*"[^>]*>[\s\S]*?<\/div>/g, " ");
    let body = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => text(p[1])).filter(Boolean).join(" ");
    if (!body) body = [...html.matchAll(/data-id="s\d+-text"[^>]*>([\s\S]*?)(?=<div data-id="s\d+-(?:image|text)"|$)/g)].map((p) => text(p[1])).filter(Boolean).join(" ");
    return { img: img ? img[1] : "", imgUrl: img ? `${SITE}/illustrations/pages/${img[1]}.${m[1].match(/pages\/\d+\.(png|jpe?g)/i)[1]}` : "", text: body };
  }).filter((p) => p.text);
  const flat = text(html);
  const credit = (label) => (flat.match(new RegExp(`${label} - (.*?) (?:Translation|Illustration|Language|Level|©) `)) || [])[1]?.trim() || "";
  const license = (flat.match(/Creative Commons: ([A-Za-z -]+?\d\.\d)/) || [])[1] || "";
  return { pages, author: credit("Author"), translation: credit("Translation"), illustration: credit("Illustration"), license };
}

const titleRows = fs.readFileSync("datasets/ga-storybooks-ghana.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((r) => /title/.test(r.topic || ""));
const have = new Set(titleRows.map((r) => fold(r.ga)));
const haveEn = new Set(titleRows.map((r) => fold(r.english)));
const gaBooks = books.filter((b) => b.lang === GA);
const enBooks = books.filter((b) => b.lang === EN);
console.log(`${gaBooks.length} Ga books on the site; ${have.size} already in the archive`);

const out = [];
for (const g of gaBooks) {
  if (have.has(fold(g.title))) { console.log(`skip (have it): ${g.title}`); continue; }
  const ga = await readBook(g.id);
  if (!/attribution/i.test(ga.license) || /noncommercial|no ?deriv/i.test(ga.license)) { console.log(`skip (license ${ga.license || "?"}): ${g.title}`); continue; }
  // English candidates: share the Ga book's people other than its translator.
  const tr = nameWords(g.translator);
  const want = [...nameWords(g.people)].filter((w) => !tr.has(w));
  const cands = enBooks
    .map((e) => { const ew = nameWords(e.people); return { e, score: want.filter((w) => ew.has(w)).length }; })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Math.abs(+a.e.level - +g.level) - Math.abs(+b.e.level - +g.level))
    .slice(0, 10);
  const gaImgs = new Set(ga.pages.map((p) => p.img).filter(Boolean));
  let best = null;
  for (const { e } of cands) {
    await sleep(300);
    const en = await readBook(e.id);
    const shared = en.pages.filter((p) => p.img && gaImgs.has(p.img)).length;
    if (!best || shared > best.shared) best = { e, en, shared };
    if (shared === gaImgs.size) break;
  }
  if (!best || best.shared < Math.max(2, Math.ceil(gaImgs.size * 0.6))) { console.log(`skip (no English original found): ${g.title}`); continue; }
  const enByImg = new Map(best.en.pages.map((p) => [p.img, p.text]));
  const story = `asb-${g.id}`, level = `level${g.level}`;
  const source = `African Storybook Initiative, africanstorybook.org (${ga.license}) — ${[
    ga.author && `story by ${ga.author}`, ga.translation && `Ga translation by ${ga.translation}`, ga.illustration && `illustrations by ${ga.illustration}`,
  ].filter(Boolean).join(", ")}`;
  // A second Ga telling of a story we already have (Ankamafio is a retelling of
  // Magozwe) is named by its Ga title so the two stay apart.
  const enTitle = haveEn.has(fold(best.e.title)) ? `${best.e.title} (retold as ${g.title})` : best.e.title;
  haveEn.add(fold(enTitle));
  out.push({ english: enTitle, ga: g.title, topic: "storybooks-ghana-title", story, title: enTitle, level, source });
  let paired = 0;
  for (const p of ga.pages) {
    const en = enByImg.get(p.img);
    if (!en) continue;
    out.push({ english: en, ga: p.text, topic: "storybooks-ghana", story, title: enTitle, level, source, image: p.imgUrl });
    paired++;
  }
  console.log(`${g.title} — “${enTitle}”: ${paired}/${ga.pages.length} pages paired (${ga.license})`);
  await sleep(300);
}
fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`\n${new Set(out.map((r) => r.story)).size} stories, ${out.length} records → ${OUT}`);
