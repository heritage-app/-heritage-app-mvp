/**
 * Bible record validators + deterministic quote formatter (ported from app/rag/validator.py).
 */
import type { VerseRecord } from "../types";
import { getGaChapterTitle, getGaLabel } from "./ga";

const BAD_MARKERS = [
  "bible in ga language",
  "© bible society of ghana",
  "currently selected",
  "learn more",
  "rights in the",
];

function str(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

/** Minimal retrieval-time validator: reject obvious garbage only. */
export function isRetrievableBibleRecord(meta: Record<string, unknown>): boolean {
  const ga = str(meta.ga).toLowerCase();
  const en = str(meta.en).toLowerCase();
  if (BAD_MARKERS.some((m) => ga.includes(m))) return false;
  if (BAD_MARKERS.some((m) => en.includes(m))) return false;
  return !!(str(meta.ga) || str(meta.en));
}

const REQUIRED = [
  "reference_display",
  "ga_version_name",
  "ga_version_abbr",
  "english_version_name",
  "english_version_abbr",
  "ga",
  "en",
  "source_name",
];

/** Strict quote-time validator: all fields needed for a perfect quote block. */
export function isFormattableBibleRecord(meta: Record<string, unknown>): boolean {
  return REQUIRED.every((k) => str(meta[k]).length > 0);
}

const TRAD_BOOK_FALLBACK: Record<string, string> = {
  genesis: "Mose klɛŋklɛŋ wolo",
  exodus: "Mose wolo ni ji enyɔ",
  leviticus: "Mose wolo ni ji etɛ",
  numbers: "Mose wolo ni ji ejwɛ",
  deuteronomy: "Mose wolo ni ji enumɔ",
};

/** Deterministically format a validated Bible quote (bypasses the LLM). */
export function formatBibleQuote(meta: VerseRecord): string {
  let ref = str(meta.reference_display);
  if (!ref) {
    const book = str(meta.book) || "Genesis";
    const tradBook = str(meta.traditional_book) || TRAD_BOOK_FALLBACK[book.toLowerCase()] || book;
    const chNum = Number(meta.chapter_num ?? 0);
    const gaCh = str(meta.chapter_title_ga) || getGaChapterTitle(chNum);
    const vNum = Number(meta.verse_num ?? 0);
    const gaV = str(meta.ga_label) || getGaLabel(vNum);
    const vRef = str(meta.verse_ref) || `${book} ${chNum}:${vNum}`;
    ref = `${tradBook}, ${gaCh}, ${gaV} (${vRef})`;
  }

  const gaName = str(meta.ga_version_name) || "Ŋmalɛ Krɔŋkrɔŋ Lɛ";
  const gaAbbr = str(meta.ga_version_abbr) || "NEGAB";
  const gaText = str(meta.ga);

  const enName = str(meta.english_version_name) || "King James Version";
  const enAbbr = str(meta.english_version_abbr) || "KJV";
  const enText = str(meta.en);

  let source = str(meta.source_name) || str(meta.filename) || "Bible Archive";
  if (source.includes(".")) source = source.split(".").slice(0, -1).join(".");
  source = source.replace(/_/g, " ").trim();

  return (
    `${ref}\n` +
    `Ga Version: ${gaName} (${gaAbbr}):\n` +
    `${gaText}\n\n` +
    `English Version: ${enName} (${enAbbr}):\n` +
    `${enText}\n\n` +
    `Source: ${source}`
  );
}
