/**
 * Tests for the Ga ASCII-keyboard transliteration (Ghanaian texting
 * convention: 3→ɛ, )→ɔ, n~→ŋ, vowel~→nasal).
 *
 * Runner not yet configured — add Vitest (`npm i -D vitest`) and run `vitest`.
 * Written framework-neutral against Vitest's `describe/it/expect`.
 */
import { describe, it, expect } from "vitest";
import { transcribeGaKey, wordAtEnd, restoreEnglishNN, normalizeGaCase } from "../transliterate";

/** Simulate typing `str` into `value`, applying transcribeGaKey per char. */
function type(value: string, str: string): string {
  let v = value;
  for (const ch of str) {
    const conv = transcribeGaKey(v, v.length, v.length, ch);
    if (conv) {
      v = v.slice(0, conv.start) + conv.insert + v.slice(conv.end);
    } else {
      v += ch;
    }
  }
  return v;
}

describe("3 → ɛ (Ghanaian convention)", () => {
  it("converts when preceded by a letter", () => {
    expect(type("", "gb3")).toBe("gbɛ");
    expect(type("", "k3k3")).toBe("kɛkɛ");
  });

  it("converts retroactively when a letter follows", () => {
    expect(type("", "3y3")).toBe("Ɛyɛ"); // sentence-start → Ɛ
    expect(type("", " 3ba")).toBe(" Ɛba");
  });

  it("capitalises at sentence start", () => {
    expect(type("Hɛɛ. ", "3fe")).toBe("Hɛɛ. Ɛfe");
    expect(type("mid ", "3fe")).toBe("mid ɛfe"); // not sentence end → ɛ
  });

  it("stays a digit in numeric contexts", () => {
    expect(type("Yitso ", "3")).toBe("Yitso 3");
    expect(type("", "3:15")).toBe("3:15");
    expect(type("", "233")).toBe("233");
  });
});

describe(") → ɔ", () => {
  it("converts when preceded by a letter", () => {
    expect(type("", "p)")).toBe("pɔ");
    expect(type("", "h3dz)l)")).toBe("hɛdzɔlɔ");
  });

  it("converts retroactively at word start", () => {
    expect(type("", ")k)")).toBe("Ɔkɔ");
  });

  it("stays literal when closing a real (", () => {
    expect(type("", "(ma)")).toBe("(ma)");
    expect(type("the result (gb", "3)")).toBe("the result (gbɛ)");
  });

  it("stays literal in emoticons / non-letter context", () => {
    expect(type("", ":)")).toBe(":)");
    expect(type("ok ", ")")).toBe("ok )"); // ')' with no letter neighbour
  });
});

describe("~ → nasal marks", () => {
  it("n~ → ŋ, N~ → Ŋ", () => {
    expect(type("", "n~oo")).toBe("ŋoo");
    expect(type("", "N~w3i")).toBe("Ŋwɛi");
  });

  it("ng~ → ŋ (ng-first habit)", () => {
    expect(type("", "ng~ma")).toBe("ŋma");
    expect(type("nyong", "~")).toBe("nyoŋ");
  });

  it("vowel~ → nasal vowel", () => {
    expect(type("", "fa~")).toBe("fã");
    expect(type("", "A~")).toBe("Ã");
    expect(type("a", "3~")).toBe("aɛ̃"); // ɛ + combining tilde
  });

  it("o~ nasalises — it does not produce ŋ", () => {
    expect(type("", "nyo~ma")).toBe("nyõma");
  });

  it("stays literal elsewhere", () => {
    expect(type("", "~")).toBe("~");
    expect(type("", "b~")).toBe("b~");
  });
});

describe("wordAtEnd", () => {
  it("returns the word at caret end", () => {
    expect(wordAtEnd("me pɔ", 5)).toEqual({ word: "pɔ", start: 3 });
  });

  it("is null mid-text or at empty input", () => {
    expect(wordAtEnd("me pɔ", 4)).toBeNull();
    expect(wordAtEnd("", 0)).toBeNull();
    expect(wordAtEnd("abc ", 4)).toBeNull();
  });

  it("handles Ga letters as word chars", () => {
    expect(wordAtEnd("gbɛ", 3)).toEqual({ word: "gbɛ", start: 0 });
  });
});

describe("nn → ŋ", () => {
  it("converts nn, taking case from the first n", () => {
    expect(type("", "nyɔnnmɔ")).toBe("nyɔŋmɔ");
    expect(type("", "NNmalɛ")).toBe("Ŋmalɛ");
    expect(type("", "Nnmalɛ")).toBe("Ŋmalɛ");
  });

  it("builds a double ŋ from four n", () => {
    expect(type("", "jogbannnn")).toBe("jogbaŋŋ");
  });

  it("records the literal keystrokes for Backspace undo", () => {
    expect(transcribeGaKey("n", 1, 1, "n")).toEqual({ start: 0, end: 1, insert: "ŋ", typed: "nn" });
  });

  it("leaves a single n alone", () => {
    expect(type("", "niyeli")).toBe("niyeli");
  });
});

describe("restoreEnglishNN", () => {
  it("puts English words back", () => {
    expect(restoreEnglishNN("diŋer in ga")).toBe("dinner in ga");
    expect(restoreEnglishNN("how do you say fuŋy")).toBe("how do you say funny");
    expect(restoreEnglishNN("caŋot")).toBe("cannot");
  });

  it("handles inflections, y→i, and capitals", () => {
    expect(restoreEnglishNN("chaŋels")).toBe("channels");
    expect(restoreEnglishNN("coŋected")).toBe("connected");
    expect(restoreEnglishNN("fuŋier")).toBe("funnier");
    expect(restoreEnglishNN("DIŊER")).toBe("DINNER");
    expect(restoreEnglishNN("Diŋer")).toBe("Dinner");
  });

  it("never touches Ga", () => {
    expect(restoreEnglishNN("Nyɔŋmɔ")).toBe("Nyɔŋmɔ");
    expect(restoreEnglishNN("Oyiwaladɔŋ")).toBe("Oyiwaladɔŋ");
    expect(restoreEnglishNN("jogbaŋŋ")).toBe("jogbaŋŋ");
    expect(restoreEnglishNN("Maŋ")).toBe("Maŋ");
  });
});

describe("normalizeGaCase", () => {
  it("lowercases interior capitals (caps-lock / sticky-shift residue)", () => {
    expect(normalizeGaCase("NYɔŋmɔ")).toBe("Nyɔŋmɔ");
    expect(normalizeGaCase("NyɔŊmɔ")).toBe("Nyɔŋmɔ");
    expect(normalizeGaCase("ƐYƐ")).toBe("Ɛyɛ");
    expect(normalizeGaCase("miiye NIŊ")).toBe("miiye Niŋ");
    expect(normalizeGaCase("WƆ JOGBAŊŊ")).toBe("Wɔ Jogbaŋŋ");
  });

  it("leaves correct text and ASCII acronyms alone", () => {
    expect(normalizeGaCase("Nyɔŋmɔ")).toBe("Nyɔŋmɔ");
    expect(normalizeGaCase("wɔ jogbaŋŋ")).toBe("wɔ jogbaŋŋ");
    expect(normalizeGaCase("Ama Serwaa")).toBe("Ama Serwaa");
    expect(normalizeGaCase("USA")).toBe("USA");
    expect(normalizeGaCase("OJEKOO")).toBe("OJEKOO");
  });
});
