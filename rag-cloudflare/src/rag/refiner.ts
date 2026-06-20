/**
 * BibleRefiner — extraction + refinement of Bible documents into high-fidelity
 * verse records (ported from the BibleRefiner class in app/rag/indexer.py).
 *
 * Supported inputs on Workers: txt/md/json/jsonl natively, and PDF via `unpdf`.
 * (PyMuPDF/python-docx have no Workers equivalent; DOCX is treated as plain text.)
 */
import type { VerseRecord } from "../types";
import { numToGa, numToEn, getGaLabel, getGaChapterTitle } from "./ga";

const BOOK_MAPPING: Record<string, string> = {
  genesis: "Mose klɛŋklɛŋ wolo",
  exodus: "Mose wolo ni ji enyɔ",
  leviticus: "Mose wolo ni ji etɛ",
  numbers: "Mose wolo ni ji ejwɛ",
  deuteronomy: "Mose wolo ni ji enumɔ",
  joshua: "Yoshua wolo",
  judges: "Kojolɔi awolo",
  ruth: "Rut wolo",
  psalms: "Lalafo Wolo",
  proverbs: "Abɛi awolo",
};

export function getTradBook(bookName: string): string {
  return BOOK_MAPPING[bookName.toLowerCase()] ?? bookName;
}

/** Unified high-fidelity text template for indexing Bible verses (mutates r with defaults). */
export function buildBibleNodeText(r: VerseRecord): string {
  const gaName = r.ga_version_name || "Ŋmalɛ Krɔŋkrɔŋ Lɛ";
  const gaAbbr = r.ga_version_abbr || "NEGAB";
  const enName = r.english_version_name || "King James Version";
  const enAbbr = r.english_version_abbr || "KJV";

  let refDisplay = r.reference_display;
  if (!refDisplay) {
    const tradBook = r.traditional_book || getTradBook(r.book ?? "");
    const gaCh = r.chapter_title_ga || getGaChapterTitle(r.chapter_num ?? 0);
    const gaV = r.ga_label || getGaLabel(r.verse_num ?? 0);
    const vRef = r.verse_ref || `${r.book} ${r.chapter_num}:${r.verse_num}`;
    refDisplay = `${tradBook}, ${gaCh}, ${gaV} (${vRef})`;
    r.reference_display = refDisplay;
  }

  r.ga_version_name = gaName;
  r.ga_version_abbr = gaAbbr;
  r.english_version_name = enName;
  r.english_version_abbr = enAbbr;

  return (
    "METADATA:\n" +
    `reference_display: ${refDisplay}\n` +
    `verse_ref: ${r.verse_ref}\n` +
    `ga_version_name: ${gaName}\n` +
    `ga_version_abbr: ${gaAbbr}\n` +
    `english_version_name: ${enName}\n` +
    `english_version_abbr: ${enAbbr}\n` +
    `source_name: ${r.source_name ?? "Bible Archive"}\n\n` +
    `Ga Content:\n${(r.ga ?? "").trim()}\n\n` +
    `English Content:\n${(r.en ?? "").trim()}`
  );
}

const NOISE_PHRASES = [
  "Currently Selected:",
  "Bible in Ga Language",
  "© Bible Society of Ghana",
  "Learn More",
  "Rights in the",
  "©",
];

const HEADER_PATTERN =
  /(Genesis|J[ɛɛƐeE]n[ɛɛƐeE]sis|Exodus|Psalms|Mose|Job|Matthew|Mark|Luke|John|Revelation)\s+(?:Chapter|Yitso|YITSƖ|Yitso\s+ni\s+ji)?\s*(\d+)/gi;

function extractVerses(block: string): Map<number, string> {
  const pattern = /(\d+)\s*([\s\S]*?)(?=\s*\d+[^\d]|$)/g;
  const labelPrefix = /^\s*Kuku\s+ni\s+ji\s+[\wɛɔŋ]+\s*/i;
  const data = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(block)) !== null) {
    if (m[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    const vNum = parseInt(m[1], 10);
    const vText = (m[2] ?? "").trim();
    const clean = vText.replace(labelPrefix, "").trim();
    if (!data.has(vNum)) data.set(vNum, clean);
  }
  return data;
}

/** Robustly parse multi-chapter interleaved Ga/English blocks into verse records. */
export function parseUnstructured(text: string, filename: string): VerseRecord[] {
  let cleanText = text;
  for (const noise of NOISE_PHRASES) {
    cleanText = cleanText.replace(new RegExp(escapeRegExp(noise), "gi"), " ");
  }

  const matches = [...cleanText.matchAll(HEADER_PATTERN)];
  type ChapterBucket = { ga: string; en: string; book: string };
  const chMap = new Map<number, ChapterBucket>();

  if (matches.length === 0) {
    const parts = cleanText.split(/Genesis\b.*?\d+/i);
    if (parts.length < 2) return [];
    chMap.set(0, { ga: parts[0], en: parts[1], book: "Genesis" });
  } else {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? cleanText.length : cleanText.length;
      const bookStr = matches[i][1];
      const chNum = parseInt(matches[i][2], 10);
      const low = bookStr.toLowerCase();
      const isGa = low.startsWith("j") || low === "mose";
      const content = cleanText.slice(start, end);
      const book = low.includes("exodus") ? "Exodus" : low.includes("psalms") ? "Psalms" : "Genesis";

      if (!chMap.has(chNum)) chMap.set(chNum, { ga: "", en: "", book });
      const bucket = chMap.get(chNum)!;
      if (isGa) bucket.ga += content + "\n";
      else bucket.en += content + "\n";
    }
  }

  const records: VerseRecord[] = [];
  const sortedChapters = [...chMap.entries()].sort((a, b) => a[0] - b[0]);

  for (const [chNum, data] of sortedChapters) {
    const gaData = extractVerses(data.ga);
    const enData = extractVerses(data.en);
    const book = data.book;
    const tradBook = getTradBook(book);
    const chTitleGa = chNum > 0 ? getGaChapterTitle(chNum) : "Bible Archive";

    const verseNums = [...new Set([...gaData.keys(), ...enData.keys()])].sort((a, b) => a - b);
    for (const v of verseNums) {
      records.push({
        id: `bible:${book.toLowerCase()}:${chNum}:${v}`,
        category: "bible",
        source_name: filename.replace(/_/g, " ").split(".")[0],
        book,
        traditional_book: tradBook,
        chapter_num: chNum,
        chapter_ref: `Chapter ${chNum}`,
        chapter_title_ga: chTitleGa,
        chapter_title_en: `Chapter ${numToEn(chNum)}`,
        section_ga: "",
        section_en: "",
        verse_num: v,
        verse_ref: `${book} ${chNum}:${v}`,
        ga_verse_label: getGaLabel(v),
        ga: gaData.get(v) ?? "",
        en: enData.get(v) ?? "",
        ga_version_abbr: "NEGAB",
        english_version_abbr: "KJV",
      });
    }
  }

  return records;
}

/** Parser for the structured Bible JSONL format. */
export function parseBibleJsonl(text: string, filename: string): VerseRecord[] {
  const records: VerseRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let rec: VerseRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.chapter_num != null) rec.chapter_num = parseInt(String(rec.chapter_num), 10);
    if (rec.verse_num != null) rec.verse_num = parseInt(String(rec.verse_num), 10);
    rec.source_name = filename;
    rec.category = "bible";
    records.push(rec);
  }
  return records;
}

/** Returns raw text + refined records for the admin preview endpoint. */
export function getRefinementPreview(text: string, filename: string) {
  const records = parseUnstructured(text, filename);
  const jsonlLines = records.slice(0, 5).map((r) => JSON.stringify(r));
  let jsonlPreview = jsonlLines.join("\n");
  if (records.length > 5) jsonlPreview += `\n... and ${records.length - 5} more verses`;

  return {
    raw_text: text.slice(0, 10000),
    refined_records: records,
    jsonl_preview: jsonlPreview,
    stats: {
      verse_count: records.length,
      chapters: [...new Set(records.map((r) => r.chapter_num))],
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
