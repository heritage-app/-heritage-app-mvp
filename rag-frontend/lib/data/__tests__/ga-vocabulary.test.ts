/**
 * Regression tests for the database-only Ga autocomplete.
 * Encodes the accuracy contract from GA_ACCURACY_AUDIT.md.
 *
 * Runner not yet configured — add Vitest (`npm i -D vitest`) and run `vitest`.
 * These are written framework-neutral against Vitest's `describe/it/expect`.
 */
import { describe, it, expect } from "vitest";
import { GA_VOCABULARY, getGaSuggestions, foldGa } from "../ga-vocabulary";

describe("Ga autocomplete — database-only, verified", () => {
  it("returns a verified record for a known word", () => {
    const out = getGaSuggestions("oflo"); // folds to match "Oflɔ"
    expect(out.some((s) => s.text === "Oflɔ")).toBe(true);
  });

  it("returns nothing for an unknown / fake word (no guessing)", () => {
    expect(getGaSuggestions("abcxyz")).toHaveLength(0);
    expect(getGaSuggestions("zzzznotaword")).toHaveLength(0);
  });

  it("only ever returns records that exist in the KB", () => {
    const kb = new Set(GA_VOCABULARY.map((s) => s.text));
    for (const q of ["e", "ny", "kp", "oflo", "genesis", "thank"]) {
      for (const s of getGaSuggestions(q)) expect(kb.has(s.text)).toBe(true);
    }
  });

  it("folds ASCII input to canonical Ga spelling (matching only)", () => {
    // User types plain letters; match resolves to the special-character headword.
    const out = getGaSuggestions("nyonma");
    expect(out.some((s) => s.text === "nyɔŋma")).toBe(true);
    // Never returns a normalized/folded form as display text.
    for (const s of out) expect(s.text).not.toBe(foldGa(s.text));
  });

  it("ranks exact/prefix above substring matches", () => {
    const out = getGaSuggestions("oha"); // "oha" (hundred) should lead
    expect(out[0]?.text).toBe("oha");
  });

  it("does NOT contain the purged poisoned entries", () => {
    const texts = GA_VOCABULARY.map((s) => s.text.toLowerCase());
    for (const bad of ["akwei", "ɛdzɛ", "daabi"]) {
      expect(texts).not.toContain(bad);
    }
    // The verified replacement is present.
    expect(GA_VOCABULARY.some((s) => s.text === "Oyiwaladɔŋ")).toBe(true);
  });

  it("empty / whitespace input yields no suggestions", () => {
    expect(getGaSuggestions("")).toHaveLength(0);
    expect(getGaSuggestions("   ")).toHaveLength(0);
  });
});
