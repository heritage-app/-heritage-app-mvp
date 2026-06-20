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

/** Parse a Ga number string into an integer (supports 1-99). */
export function gaToNum(gaText: string): number | null {
  if (!gaText) return null;
  const t = gaText.toLowerCase().replace(/-/g, " ").trim();

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
