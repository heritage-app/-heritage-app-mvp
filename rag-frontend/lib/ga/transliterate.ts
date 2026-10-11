/**
 * Ga ASCII-keyboard transliteration — the Ghanaian texting convention.
 *
 * Standard keyboards can't type ɛ, ɔ, ŋ, ã. Ghanaians already have a texting
 * convention for this, which this module encodes:
 *
 *   3  → ɛ / Ɛ        ("3y3" → "Ɛyɛ")
 *   )  → ɔ / Ɔ        ("p)" → "pɔ", ")k)" → "Ɔkɔ")
 *   nn → ŋ / Ŋ        ("nyɔnnmɔ" → "nyɔŋmɔ"; NN or Nn → Ŋ)
 *   n~ → ŋ / Ŋ        ("n~oo" → "ŋoo")
 *   ng~ → ŋ / Ŋ       (alternative for people who reach for "ng" first)
 *   a~ → ã, e~ → ẽ, i~ → ĩ, o~ → õ, u~ → ũ  (and capitals)
 *   ɛ~ / ɔ~ → ɛ̃ / ɔ̃   (combining tilde)
 *
 * Safety guards keep normal text intact:
 *  - "3" only becomes ɛ when adjacent to a letter, so "Yitso 3" and "3:15"
 *    stay digits. A "3" typed before its letter context (start of "3y3")
 *    converts retroactively when the letter arrives.
 *  - ")" only becomes ɔ when letter-adjacent AND it isn't closing a real "(",
 *    so "(ma)" and ":)" stay literal.
 *  - "~" only fires after n, ng, or a vowel; anywhere else it stays literal.
 *
 * Every conversion records the literal keystrokes in `typed` so callers can
 * restore them on Backspace (standard IME undo behaviour).
 *
 * Pure functions — mirrored in rag-cloudflare/public/index.html.
 */

export interface GaKeyConversion {
  /** Index where replacement begins. */
  start: number;
  /** Index where replacement ends (exclusive). */
  end: number;
  /** Canonical Ga text to insert. */
  insert: string;
  /** The literal characters the user typed (for Backspace undo). */
  typed: string;
}

const LETTER_RE = /\p{L}/u;
const WORD_CHAR_RE = /[\p{L}\p{M}]/u;

function isLetter(ch: string | undefined): boolean {
  return !!ch && LETTER_RE.test(ch);
}

const TILDE_MAP: Record<string, string> = {
  n: "ŋ",
  N: "Ŋ",
  a: "ã",
  e: "ẽ",
  i: "ĩ",
  o: "õ",
  u: "ũ",
  A: "Ã",
  E: "Ẽ",
  I: "Ĩ",
  O: "Õ",
  U: "Ũ",
  "ɛ": "ɛ̃",
  "ɔ": "ɔ̃",
  "Ɛ": "Ɛ̃",
  "Ɔ": "Ɔ̃",
};

/** True when `pos` sits at a sentence start: beginning of input, or after
 *  sentence-ending punctuation plus whitespace. */
function isSentenceStart(value: string, pos: number): boolean {
  const before = value.slice(0, pos);
  if (!before.trim()) return true;
  return /[.!?]["'”’)\]]*\s+$/.test(before);
}

/** Unclosed "(" count before `pos`. >0 means a ")" here is a real closer. */
function parenDepth(value: string, pos: number): number {
  let d = 0;
  for (let i = 0; i < pos; i++) {
    if (value[i] === "(") d++;
    else if (value[i] === ")") d = Math.max(0, d - 1);
  }
  return d;
}

/**
 * Map a single incoming keystroke to a Ga conversion, or null to let the
 * character through untouched. Call from a `beforeinput` handler with the
 * current textarea value and selection.
 */
export function transcribeGaKey(
  value: string,
  selStart: number,
  selEnd: number,
  ch: string
): GaKeyConversion | null {
  const prev = selStart > 0 ? value[selStart - 1] : "";
  const next = selEnd < value.length ? value[selEnd] : "";
  const letterAdjacent = isLetter(prev) || isLetter(next);

  if (ch === "3") {
    if (!letterAdjacent) return null;
    const insert = isSentenceStart(value, selStart) ? "Ɛ" : "ɛ";
    return { start: selStart, end: selEnd, insert, typed: "3" };
  }

  if (ch === ")") {
    if (!letterAdjacent || parenDepth(value, selStart) > 0) return null;
    const insert = isSentenceStart(value, selStart) ? "Ɔ" : "ɔ";
    return { start: selStart, end: selEnd, insert, typed: ")" };
  }

  if (ch === "~") {
    // "ng~" → ŋ (replace both chars — covers the "type ng first" habit)
    if ((prev === "g" || prev === "G") && selStart > 1 && /[nN]/.test(value[selStart - 2])) {
      const insert = value[selStart - 2] === "N" ? "Ŋ" : "ŋ";
      return { start: selStart - 2, end: selEnd, insert, typed: value.slice(selStart - 2, selStart) + "~" };
    }
    const mapped = TILDE_MAP[prev];
    if (!mapped) return null;
    return { start: selStart - 1, end: selEnd, insert: mapped, typed: prev + "~" };
  }

  // "nn" → ŋ. The case of the first n decides: "NN" / "Nn" → Ŋ, "nn" → ŋ.
  // English words full of "nn" (dinner, funny, cannot) would be mangled by
  // this on its own; restoreEnglishNN() puts them back when the word ends.
  if ((ch === "n" || ch === "N") && selStart === selEnd && (prev === "n" || prev === "N")) {
    return { start: selStart - 1, end: selEnd, insert: prev === "N" ? "Ŋ" : "ŋ", typed: prev + ch };
  }

  // Retroactive completion: a letter landing after a literal "3" or ")"
  // finishes it. This handles "3y3" → "Ɛyɛ" and ")k)" → "Ɔkɔ", where the
  // first key was typed before any letter context existed.
  if (isLetter(ch) && selStart === selEnd) {
    if (prev === "3") {
      const c = isSentenceStart(value, selStart - 1) ? "Ɛ" : "ɛ";
      return { start: selStart - 1, end: selEnd, insert: c + ch, typed: "3" + ch };
    }
    if (prev === ")" && parenDepth(value, selStart - 1) === 0) {
      const c = isSentenceStart(value, selStart - 1) ? "Ɔ" : "ɔ";
      return { start: selStart - 1, end: selEnd, insert: c + ch, typed: ")" + ch };
    }
  }

  return null;
}

/**
 * English words containing "nn". The nn → ŋ convention would turn "dinner"
 * into "diŋer" — and then "dinner in ga" finds nothing. Inflections are
 * covered by suffix below, so only base forms (plus words where the nn comes
 * from doubling, like "running") need listing.
 *
 * This list cannot be complete. A word missing from it stays converted; the
 * user can Backspace straight after the conversion to undo it.
 */
const ENGLISH_NN = new Set([
  "ann", "anna", "anne", "annie", "inn", "penne", "tonne", "manna", "nanna",
  "dinner", "thinner", "sinner", "winner", "spinner", "beginner", "runner", "gunner",
  "inner", "innermost", "manner", "mannerism", "banner", "tanner", "planner", "scanner", "spanner",
  "funny", "sunny", "bunny", "penny", "nanny", "granny", "skinny", "tinny", "canny", "uncanny",
  "runny", "gunny", "bonny", "johnny", "jenny", "kenny", "lenny", "donna", "cranny", "tyranny",
  "cannot", "cannon", "cannery", "cannabis", "cannibal", "canning",
  "tennis", "inning", "innings", "running", "winning", "beginning", "planning", "spinning",
  "stunning", "cunning", "scanning", "banning", "pinning", "thinning", "tanning", "gunning",
  "planned", "banned", "scanned", "spanned", "tanned", "pinned", "thinned", "manned", "canned",
  "annual", "annually", "annoy", "annex", "anniversary", "announce", "announcement",
  "innocent", "innocence", "innovate", "innovation", "innovative", "innate",
  "connect", "connection", "channel", "tunnel", "funnel", "kennel", "flannel", "fennel",
  "cinnamon", "sonnet", "bonnet", "millennium", "perennial", "biennial", "questionnaire",
  "penniless", "personnel", "antenna", "antennae", "vienna", "sienna", "savanna", "savannah",
  "hosanna", "mannequin", "ennui", "finnish", "zinnia", "tennessee", "minnesota",
  "pennsylvania", "cincinnati", "hennessy",
]);

const EN_SUFFIXES = ["s", "es", "ed", "d", "ing", "er", "ers", "y", "ies", "ly", "ment", "ments"];

function isEnglishNN(word: string): boolean {
  if (ENGLISH_NN.has(word)) return true;
  if (EN_SUFFIXES.some((s) => word.endsWith(s) && ENGLISH_NN.has(word.slice(0, -s.length)))) return true;
  // y → i before a suffix: funnier, sunniest, pennies.
  const yi = word.match(/^(.+)i(er|est|es|ly)$/);
  return !!yi && ENGLISH_NN.has(yi[1] + "y");
}

/**
 * Put "nn" back into English words the nn → ŋ convention converted.
 * Run it on a word as it ends (space / punctuation) and on the whole message
 * before sending. Words that aren't recognisably English are left alone.
 */
export function restoreEnglishNN(text: string): string {
  return text.replace(/[\p{L}\p{M}]+/gu, (w) => {
    if (!/[ŋŊ]/.test(w)) return w;
    const shouting = w === w.toUpperCase();
    const back = w.replace(/ŋ/g, "nn").replace(/Ŋ/g, shouting ? "NN" : "Nn");
    return /^[a-z]+$/i.test(back) && isEnglishNN(back.toLowerCase()) ? back : w;
  });
}

/**
 * Interior capitals are never correct in Ga — they come from sticky Shift /
 * caps-lock residue ("NYɔŋmɔ", "NyɔŊmɔ"), especially on mobile keyboards that
 * re-engage caps after the symbols panel. At a word boundary, lowercase every
 * capital after the first letter. ALL-CAPS pure-ASCII words (acronyms) are
 * left alone; an all-caps word containing a Ga letter is caps residue.
 *
 * Mirrored in rag-cloudflare/public/index.html.
 */
export function normalizeGaCase(text: string): string {
  return text.replace(/[\p{L}\p{M}]{2,}/gu, (w) => {
    const rest = w.slice(1);
    if (!/\p{Lu}/u.test(rest)) return w;
    if (!/\p{Ll}/u.test(rest) && /^[A-Za-z]+$/.test(w)) return w;
    return w[0] + rest.replace(/\p{Lu}/gu, (c) => c.toLowerCase());
  });
}

export interface GaWordAtEnd {
  word: string;
  /** Index where the word starts in the full value. */
  start: number;
}

/**
 * The Ga word ending at the caret — or null when the caret isn't at the end
 * of the input or no word is there. Ghost completion is intentionally
 * end-of-input only: mid-text corrections would need caret-aware mirroring.
 */
export function wordAtEnd(value: string, caret: number): GaWordAtEnd | null {
  if (caret !== value.length || caret === 0) return null;
  let i = caret;
  while (i > 0 && WORD_CHAR_RE.test(value[i - 1])) i--;
  const word = value.slice(i, caret);
  return word ? { word, start: i } : null;
}
