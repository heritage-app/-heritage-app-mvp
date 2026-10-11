/**
 * Ga numerical parsing + citation resolution (ported from app/rag/utils.py).
 */

const UNITS: Record<number, string> = {
  1: "ekome",
  2: "enyɔ",
  3: "etɛ",
  4: "ejwɛ",
  5: "enumɔ",
  6: "ekpaa",
  7: "kpawo",
  8: "kpaanyɔ",
  9: "nɛɛhu",
};

const UNIT_VALUES: Record<string, number> = Object.fromEntries(
  Object.entries(UNITS).map(([k, v]) => [v, Number(k)])
);

import { modernizeGa } from "./orthography";

/**
 * Fold Ga-specific characters to their ASCII look-alikes for tolerant comparison.
 * Users on standard keyboards type n/e/o for ŋ/ɛ/ɔ (e.g. "Otukwajan" for "Otukwajaŋ"),
 * so archive lookups must compare folded forms, never raw text. Legacy GBV96
 * orthography (š, ſ, ṅ, underdotted vowels) is canonicalized first so both
 * spellings fold to the same key.
 */
export function foldGa(text: string): string {
  return modernizeGa(text)
    .toLowerCase()
    .replace(/ŋ/g, "n")
    .replace(/ɛ/g, "e")
    .replace(/ɔ/g, "o")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Lowercase stray interior capitals — sticky Shift / caps-lock residue from
 * phone keyboards ("NYɔŋmɔ" -> "Nyɔŋmɔ"). All-caps plain-ASCII words
 * (acronyms) are left alone; an all-caps word containing a Ga letter is
 * residue. Same rule as normalizeGaCase in public/index.html.
 */
export function normalizeGaCase(text: string): string {
  return text.replace(/[\p{L}\p{M}]{2,}/gu, (w) => {
    const rest = w.slice(1);
    if (!/\p{Lu}/u.test(rest)) return w;
    if (!/\p{Ll}/u.test(rest) && /^[A-Za-z]+$/.test(w)) return w;
    return w[0] + rest.replace(/\p{Lu}/gu, (ch) => ch.toLowerCase());
  });
}

/** Universal Ga Numerical Formula for 1-999. */
export function numToGa(n: number): string {
  if (n <= 0) return String(n);
  if (n >= 1 && n <= 9) return UNITS[n];
  if (n === 10) return "nyɔŋma";
  if (n >= 11 && n <= 19) return `nyɔŋma kɛ ${UNITS[n - 10]}`;
  if (n % 10 === 0) {
    if (n < 100) return `nyɔŋmai ${UNITS[n / 10]}`;
    if (n === 100) return "oha";
  }
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rem = n % 10;
    return `nyɔŋmai ${UNITS[tens]} kɛ ${UNITS[rem]}`;
  }
  if (n < 1000) {
    // Hundreds mirror the tens: "oha" alone for 100, "ohai {unit}" for 200+,
    // and a remainder joins with "kɛ" ("ohai-enumɔ" = 500 in the GBV96 corpus).
    const hundreds = Math.floor(n / 100);
    const rem = n % 100;
    const base = hundreds === 1 ? "oha" : `ohai ${UNITS[hundreds]}`;
    return rem === 0 ? base : `${base} kɛ ${numToGa(rem)}`;
  }
  return String(n);
}

/** Simple English number-to-word for chapter titles (mirrors BibleRefiner._num_to_en). */
export function numToEn(n: number): string {
  const units: Record<number, string> = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
    6: "Six", 7: "Seven", 8: "Eight", 9: "Nine",
  };
  const teens: Record<number, string> = {
    11: "Eleven", 12: "Twelve", 13: "Thirteen", 14: "Fourteen", 15: "Fifteen",
    16: "Sixteen", 17: "Seventeen", 18: "Eighteen", 19: "Nineteen",
  };
  const tens: Record<number, string> = {
    10: "Ten", 20: "Twenty", 30: "Thirty", 40: "Forty", 50: "Fifty",
    60: "Sixty", 70: "Seventy", 80: "Eighty", 90: "Ninety",
  };
  if (units[n]) return units[n];
  if (teens[n]) return teens[n];
  if (tens[n]) return tens[n];
  if (n < 100) return `${tens[Math.floor(n / 10) * 10]} ${units[n % 10]}`;
  return String(n);
}

const EN_NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Greedily parse a spelled-out English number from the front of a token list
 * ("thirty three", "two hundred and forty", "a hundred"). Returns the value
 * and how many leading tokens it consumed, or null when the first token can't
 * start a number. Values past 999 parse too — callers treat them as
 * out-of-range rather than truncating to a wrong smaller number.
 */
export function parseEnglishNumber(
  tokens: string[]
): { value: number; consumed: number } | null {
  const isNumToken = (w: string | undefined) =>
    w !== undefined &&
    (EN_NUMBER_WORDS[w] !== undefined ||
      w === "hundred" || w === "thousand" || w === "million");
  let total = 0, current = 0, i = 0, used = false;
  while (i < tokens.length) {
    const w = tokens[i];
    if (w === "and" && used && isNumToken(tokens[i + 1])) { i++; continue; }
    if (w === "a" && tokens[i + 1] === "hundred") { current += 1; i++; continue; }
    if (w === "hundred") { current = (current || 1) * 100; used = true; i++; continue; }
    if (w === "thousand" || w === "million") {
      total += (current || 1) * (w === "thousand" ? 1_000 : 1_000_000);
      current = 0; used = true; i++; continue;
    }
    const v = EN_NUMBER_WORDS[w];
    if (v !== undefined) { current += v; used = true; i++; continue; }
    break;
  }
  return used ? { value: total + current, consumed: i } : null;
}

/** Parse a Ga number string into an integer (supports 1-99). */
export function gaToNum(gaText: string): number | null {
  if (!gaText) return null;
  const t = modernizeGa(gaText).toLowerCase().replace(/-/g, " ").trim();

  if (UNIT_VALUES[t]) return UNIT_VALUES[t];
  if (t === "nyɔŋma") return 10;

  const teen = t.match(/nyɔŋma\s+kɛ\s+(\w+)/);
  if (teen) {
    const v = UNIT_VALUES[teen[1]];
    if (v) return 10 + v;
  }

  const tensMatch = t.match(/nyɔŋmai\s+(\w+)/);
  if (tensMatch) {
    const tenVal = UNIT_VALUES[tensMatch[1]];
    if (tenVal) {
      const base = tenVal * 10;
      const rem = t.match(/kɛ\s+(\w+)/);
      if (rem) {
        const rv = UNIT_VALUES[rem[1]];
        if (rv) return base + rv;
      }
      return base;
    }
  }

  const digit = t.match(/\d+/);
  if (digit) return parseInt(digit[0], 10);
  return null;
}

/** Extract chapter/verse from Ga text ("Yitso [Num]", "Kuku ni ji [Num]"). */
export function resolveGaCitation(text: string): { chapter: number | null; verse: number | null } {
  const res: { chapter: number | null; verse: number | null } = { chapter: null, verse: null };
  const t = text.toLowerCase();

  const ch = t.match(/yitso\s+([^,]+)/);
  if (ch) res.chapter = gaToNum(ch[1].trim());

  const v = t.match(/kuku\s+(?:ni\s+ji\s+)?([^:(]+)/);
  if (v) res.verse = gaToNum(v[1].trim().replace(/[,.]+$/, ""));

  return res;
}

/** Build a "Kuku ni ji [word]" verse label. */
export function getGaLabel(num: number): string {
  return `Kuku ni ji ${numToGa(num)}`;
}

/** Build a "Yitso [Word]" chapter title (first word capitalized). */
export function getGaChapterTitle(num: number): string {
  let word = numToGa(num);
  if (word.includes(" ")) {
    const parts = word.split(" ");
    word = `${cap(parts[0])} ${parts.slice(1).join(" ")}`;
  } else {
    word = cap(word);
  }
  return `Yitso ${word}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
