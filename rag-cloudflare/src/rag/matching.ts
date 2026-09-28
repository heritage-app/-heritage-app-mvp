/**
 * Near-match rules for the phrase-pair matcher.
 *
 * Both used to be bare prefix tests in both directions, which answered
 * confidently from coincidences: "cat" matched "caterpillar", and the English
 * word "share" matched the Ga token "sha" — so "i would like to share" was
 * answered with the Ga for "Hurry". Each rule now allows exactly the one kind
 * of near-match it exists for.
 *
 * Inputs are already folded and lower-cased by the caller.
 */

/** Suffixes that make a different form of the same English word. */
const SUFFIXES = ["s", "es", "ed", "d", "ing", "er", "ers"];

/**
 * True when one English word is an inflection of the other:
 * "alphabets" ~ "alphabet", "eating" ~ "eat", "boxes" ~ "box".
 * The shared stem must be at least 3 letters, so "a"/"is" never qualify.
 */
export function isInflection(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 3) return false;
  return SUFFIXES.some((s) => long === short + s);
}

/**
 * True when `typed` is a Ga word partway through being typed: "otukwaj" ~
 * "otukwajan". It must be at least 4 letters and cover most of the word — a
 * short fragment is a coincidence, not an intent. 0.75, not 0.6: at 0.6 the
 * English "shade" passed as 5/8 of the Ga "Shadebua" (hedgehog).
 */
export function isPartialGa(typed: string, word: string): boolean {
  if (typed === word) return true;
  if (typed.length < 4 || !word.startsWith(typed)) return false;
  return typed.length / word.length >= 0.75;
}
