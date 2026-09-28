/**
 * Re-fetch all 150 Psalms chapters from GBV96 and rebuild psalms records.
 *
 * GBV96 emits superscriptions as a labelled span sharing the verse's data-usfm
 * (e.g. two <span class="verse" data-usfm="PSA.23.1"> blocks: title first, real
 * verse second). The original crawler keyed verses by number and kept the first
 * span, so the title overwrote the real verse 1 text for ~half the psalms.
 *
 * Rule per usfm: collect non-empty .content spans in order; if v1 has >1, the
 * first is the superscription (kept as a verse-0 title record) and the last is
 * the real verse text. Chapters where GBV96 numbers the title as its own verse
 * (span.v1 title + real v1 at v2) are handled by ordinal realignment against
 * KJV, same as realign-mismatched.mjs.
 */
import { readFileSync, writeFileSync } from "fs";

const GA_ID = 2712;
const FILE = new URL("../datasets/ga-bible-psalms.jsonl", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

const strip = (h) =>
  h.replace(/<span class="rq">[\s\S]*?<\/span><\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#\w]+;/g, (m) =>
      ({ "&#353;": "š", "&#353;": "š", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" }[m] ?? m))
    .replace(/\s+/g, " ")
    .trim();

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[m]));

async function fetchChapter(ch) {
  const r = await fetch(`https://events.bible.com/api/bible/chapter/3.1?id=${GA_ID}&reference=PSA.${ch}`);
  if (!r.ok) throw new Error(`PSA.${ch} HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.content) return [];
  // Ordered, per-usfm list of non-empty content spans (excluding .rq cross-refs).
  const spans = [...j.content.matchAll(
    /<span class="verse[^"]*" data-usfm="PSA\.\d+\.(\d+)"[^>]*>([\s\S]*?)<\/span><\/span>|<span class="verse[^"]*" data-usfm="PSA\.\d+\.(\d+)"[^>]*>([\s\S]*?)<\/span>/g
  )];
  const perVerse = new Map(); // vNum -> [content strings in order]
  for (const m of spans) {
    const v = parseInt(m[1] ?? m[3], 10);
    const inner = m[2] ?? m[4] ?? "";
    const content = decode(
      inner
        .replace(/<span class="rq">[\s\S]*/g, "")
        .replace(/<span class="label">[\s\S]*?<\/span>/g, "")
        .replace(/<[^>]+>/g, "")
    ).replace(/\s+/g, " ").trim();
    if (!content || /^\d+$/.test(content)) continue; // skip verse-number labels & empty spans
    if (!perVerse.has(v)) perVerse.set(v, []);
    perVerse.get(v).push(content);
  }
  return [...perVerse.entries()].sort((a, b) => a[0] - b[0]);
}

const records = readFileSync(FILE, "utf8").trim().split("\n").map(JSON.parse);
const book = records[0].book, trad = records[0].traditional_book;
const K = records.filter((r) => r.en).map((r) => ({ ch: r.chapter_num, v: r.verse_num, en: r.en }));
K.sort((a, b) => a.ch - b.ch || a.v - b.v);

// Fetch all chapters with limited concurrency.
const G = [];
for (let i = 1; i <= 150; i += 15) {
  const batch = await Promise.all([...Array(15)].map((_, k) => i + k <= 150 ? fetchChapter(i + k) : []));
  batch.forEach((verses, k) => {
    const ch = i + k;
    for (const [v, contents] of verses) {
      if (v === 1 && contents.length > 1) {
        G.push({ ch, v: -1, ga: contents[0], title: true });
        G.push({ ch, v: 1, ga: contents[contents.length - 1] });
      } else {
        G.push({ ch, v, ga: contents[contents.length - 1] });
      }
    }
  });
  process.stdout.write(`\rfetched ch ${Math.min(i + 14, 150)}/150`);
}
console.log("");
G.sort((a, b) => a.ch - b.ch || a.v - b.v);

const mk = (kCh, kV, gCh, gV, ga, en, suf) => ({
  id: `bible:psalms:${kCh}:${kV}${suf ? ":" + suf : ""}`,
  category: "bible",
  source_name: "ga-bible-psalms.jsonl",
  book,
  traditional_book: trad,
  chapter_num: kCh,
  chapter_ref: `Chapter ${kCh}`,
  chapter_title_ga: `Yitso ${kCh}`,
  chapter_title_en: `Chapter ${kCh}`,
  section_ga: "",
  section_en: "",
  verse_num: kV,
  verse_ref: `Psalms ${kCh}:${kV}`,
  ga_verse_label: `Kuku ni ji ${kV}`,
  reference_display: `${trad}, Yitso ${kCh}, Kuku ni ji ${kV} (Psalms ${kCh}:${kV})`,
  ga, en,
  ga_version_name: "Ŋmãlẽ Kroṅkroṇ Le",
  ga_version_abbr: "GBV96",
  english_version_name: "King James Version",
  english_version_abbr: "KJV",
});

const out = [];
const byCh = new Set([...G.map((x) => x.ch), ...K.map((x) => x.ch)]);
let titles = 0, embedded = 0;
for (const ch of [...byCh].sort((a, b) => a - b)) {
  const gCh = G.filter((x) => x.ch === ch && !x.title);
  const gTitles = G.filter((x) => x.ch === ch && x.title);
  const kCh = K.filter((x) => x.ch === ch);
  // Embedded-title records (same-usfm case)
  for (const t of gTitles) { out.push({ ...mk(ch, 0, ch, 0, t.ga, "", `t${++titles}`), ga_verse_label: "Title" }); }
  // Leading extra GBV96 records are standalone superscriptions
  const d = gCh.length - kCh.length;
  for (let t = 0; t < Math.max(0, d); t++) {
    out.push({ ...mk(ch, 0, ch, gCh[t].v, gCh[t].ga, "", `t${++titles}`), ga_verse_label: "Title" });
  }
  for (let i = 0; i < kCh.length; i++) {
    const g = gCh[i + Math.max(0, d)];
    out.push(mk(ch, kCh[i].v, g?.ch ?? ch, g?.v ?? kCh[i].v, g?.ga ?? "", kCh[i].en));
  }
  if (gTitles.length) embedded++;
}

out.sort((a, b) => a.chapter_num - b.chapter_num || a.verse_num - b.verse_num || String(a.id).localeCompare(String(b.id)));
writeFileSync(FILE, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`DONE: ${out.length} records (${titles} title records, ${embedded} embedded-title chapters), G=${G.length} K=${K.length}`);
