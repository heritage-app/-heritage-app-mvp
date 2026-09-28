/**
 * GBV96 legacy-orthography → modern Ga orthography transliteration.
 *
 * The 1996 Ga Bible (Ŋmãlẽ Kroṅkroṇ) is typeset in the older Basel-mission
 * orthography; the rest of the corpus and the UI use the modern unified one.
 * This module canonicalizes legacy text for display and matching while the
 * stored corpus remains faithful to the printed source.
 *
 * Letter map (verified against the corpus):
 *   e̱/o̱ (macron-below)  → ɛ/ɔ        underdot marks the open vowel
 *   ṅ/ṇ                  → ŋ          velar nasal
 *   š                    → sh         post-alveolar fricative
 *   ſ                    → s          long s (purely typographic)
 *   tš/tſ                → ts         affricate
 *   dš                   → j          (dš = /dʒ/, written j today)
 *   dſ                   → dz
 *   ā ē ī ō ū (macron)   → doubled vowel (macron marks length)
 *   acute/grave          → dropped    (tone marks aren't written today)
 *   tilde (~)            → kept       (nasalization is still written)
 */

const DIGRAPHS: Array<[RegExp, string]> = [
  [/dš/g, "j"],
  [/Dš/g, "J"],
  [/DŠ/g, "J"],
  [/tš/g, "ts"],
  [/Tš/g, "Ts"],
  [/TŠ/g, "TS"],
  [/dſ/g, "dz"],
  [/Dſ/g, "Dz"],
  [/Dſ/g, "DZ"],
  [/tſ/g, "ts"],
  [/Tſ/g, "Ts"],
  [/Tſ/g, "TS"],
];

const SINGLES: Array<[RegExp, string]> = [
  [/š/g, "sh"],
  [/Š/g, "Sh"],
  [/ſ/g, "s"],
  [/ẞ/g, "SS"],
  [/ṅ/g, "ŋ"],
  [/Ṅ/g, "Ŋ"],
  [/ṇ/g, "ŋ"],
  [/Ṉ/g, "Ŋ"],
  [/ẹ/g, "ɛ"],
  [/Ẹ/g, "Ɛ"],
  [/ọ/g, "ɔ"],
  [/Ọ/g, "Ɔ"],
];

const OPEN_VOWEL: Record<string, string> = {
  e: "ɛ", o: "ɔ", E: "Ɛ", O: "Ɔ", ɛ: "ɛ", ɔ: "ɔ", Ɛ: "Ɛ", Ɔ: "Ɔ",
};

const MACRON_BELOW = "̱"; // ̱
const DOT_BELOW = "̣"; // ̣
const MACRON_ABOVE = "̄"; // ̄
const TILDE = "̃"; // ̃

/** Transliterate GBV96 legacy-orthography text into modern Ga orthography. */
export function modernizeGa(text: string): string {
  if (!text) return "";
  let t = text;

  for (const [re, to] of DIGRAPHS) t = t.replace(re, to);
  for (const [re, to] of SINGLES) t = t.replace(re, to);

  // Consonantal I before a vowel is /j/ (Iehowa → Yehowa, Iesu → Yesu,
  // Ierusalem → Yerusalem); vocalic I stays (Israel, Isak).
  t = t.replace(/\bI(?=[aeiouAEIOU])/g, "Y");

  // Combining-mark passes require decomposed form.
  t = t.normalize("NFD");

  // n + dot-above/below → ŋ (covers combining forms of ṅ/ṇ)
  t = t.replace(/n[̣̇]/g, "ŋ").replace(/N[̣̇]/g, "Ŋ");

  // Vowel clusters: base vowel + run of combining marks.
  t = t.replace(/([aeiouAEIOUɛɔƐƆ])([̀-ͯ]+)/g, (_m, base: string, marks: string) => {
    let b = base;
    if (marks.includes(MACRON_BELOW) || marks.includes(DOT_BELOW)) {
      b = OPEN_VOWEL[b] ?? b;
    }
    const long = marks.includes(MACRON_ABOVE);
    const nasal = marks.includes(TILDE) ? TILDE : "";
    const v = b + nasal;
    return long ? v + v : v;
  });

  // Any stray length/open marks left on consonants carry no meaning today.
  t = t.replace(/[̱̣̄]/g, "");

  return t.normalize("NFC");
}

/** True when the text contains any legacy-orthography characters. */
export function isLegacyGa(text: string): boolean {
  return /[šſṅṆṇṈẹẸọỌ̱̄]|[dt][šſ]/.test(text);
}
