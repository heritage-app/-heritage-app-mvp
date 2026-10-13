/**
 * OCR + structuring into {english, ga, topic} pairs for the heritage import flow.
 *
 * - Images (png/jpg/webp): read with a Workers AI vision model (true OCR).
 * - Digital PDFs / text: structured from the extracted text with the chat LLM.
 *   (Scanned PDFs can't be rasterized in a Worker — upload page images instead.)
 *
 * Output is reviewed/edited by an admin before indexing (human-in-the-loop).
 * Output format matches the datasets: {english, ga, topic}
 */
import type { Env, VerseRecord } from "../types";
import { chat, replyText } from "./llm";

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const INSTRUCTION =
  "It is a bilingual English–Ga language guide: an English word/phrase paired with its Ga translation " +
  "(often laid out in two columns or as a list). Extract EVERY English item with its Ga translation. " +
  "Preserve Ga special letters exactly (ɛ ɔ ŋ ã and tilde/macron marks). " +
  "Also infer a short lowercase `topic` label that groups related pairs " +
  '(e.g. "greetings", "days", "months", "pronouns", "family", "food", "numbers", "phrases", "body", "colors", "verbs", "adjectives"). ' +
  'Output ONLY JSON Lines — one object per pair, like {"english":"Good morning","ga":"Ojekoo","topic":"greetings"} — ' +
  "with no commentary, headings, markdown fences, or trailing commas.";

const CHUNK_SIZE = 6000; // chars per LLM call for long documents

interface VisionRun { response?: string; description?: string }

/** Parse JSONL-ish model output into clean {english, ga, topic} records. */
export function parsePairs(text: string): VerseRecord[] {
  const out: VerseRecord[] = [];
  const cleaned = text.replace(/```(?:json|jsonl)?/gi, "").trim();
  for (const raw of cleaned.split("\n")) {
    const line = raw.trim().replace(/,\s*$/, "");
    if (!line.startsWith("{")) continue;
    try {
      const rec = JSON.parse(line);
      const english = String(rec.english ?? rec.en ?? "").trim();
      const ga = String(rec.ga ?? rec.translation ?? "").trim();
      const topic = String(rec.topic ?? rec.category ?? "").trim().toLowerCase() || undefined;
      if (english && ga) out.push({ english, ga, category: "heritage", ...(topic ? { topic } : {}) } as VerseRecord);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Deduplicate records by english+ga key — merges chunks without repeating pairs. */
function dedupeRecords(records: VerseRecord[]): VerseRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${String(r.english).toLowerCase()}|||${String(r.ga).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deterministic pair extraction — no LLM, no quota.
 *
 * Handles already-structured uploads: JSONL, TSV, CSV, and line-delimited
 * `english — ga` / `english -- ga` / `english = ga` formats. Only accepted when
 * the file is *consistently* structured (>=80% of non-empty lines parse into a
 * pair and >=3 pairs found) so prose isn't misread as pairs.
 */
export function tryParseStructuredPairs(text: string): VerseRecord[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 3) return null;

  const records: VerseRecord[] = [];
  let parsed = 0;
  for (const line of lines) {
    const rec = parsePairLine(line);
    if (rec) {
      records.push(rec);
      parsed++;
    }
  }
  if (parsed < 3 || parsed / lines.length < 0.8) return null;
  return dedupeRecords(records);
}

function parsePairLine(line: string): VerseRecord | null {
  // JSONL object: {"english": "...", "ga": "...", ...}
  if (line.startsWith("{")) {
    try {
      const rec = JSON.parse(line.replace(/,\s*$/, ""));
      const english = String(rec.english ?? rec.en ?? "").trim();
      const ga = String(rec.ga ?? rec.translation ?? "").trim();
      const topic = String(rec.topic ?? rec.category ?? "").trim().toLowerCase() || undefined;
      if (english && ga) return { english, ga, category: "heritage", ...(topic ? { topic } : {}) } as VerseRecord;
    } catch {
      /* not JSON */
    }
    return null;
  }

  // Delimited: tab, em/en dash, double hyphen, or equals.
  // Longest/most specific separators first; require non-trivial content each side.
  const sep = /\t| — | – | -- | = | \| /.exec(line);
  if (!sep) return null;
  const english = line.slice(0, sep.index).trim();
  const ga = line.slice(sep.index + sep[0].length).trim();
  // Reject header rows, empty halves, and splits that are really prose.
  if (english.length < 2 || ga.length < 2) return null;
  if (/^(english|en|word|phrase)$/i.test(english)) return null;
  if (/^(ga|translation|meaning)$/i.test(ga)) return null;
  return { english, ga, category: "heritage" } as VerseRecord;
}

/** OCR an uploaded image with the vision model. */
export async function ocrImage(env: Env, bytes: ArrayBuffer): Promise<{ raw: string; records: VerseRecord[] }> {
  const res = (await env.AI.run(VISION_MODEL as any, {
    image: Array.from(new Uint8Array(bytes)),
    prompt: `OCR this image. ${INSTRUCTION}`,
    max_tokens: 2048,
  })) as VisionRun;
  const raw = replyText(res.response ?? res.description).trim();
  return { raw, records: parsePairs(raw) };
}

/**
 * Structure already-extracted text into {english, ga, topic} pairs.
 * Long documents are chunked into CHUNK_SIZE segments so nothing is silently truncated.
 */
export async function textToPairs(
  env: Env,
  text: string,
  model?: string
): Promise<{ raw: string; records: VerseRecord[] }> {
  const cleanText = text.trim();

  // For short texts — single LLM call (original fast path).
  if (cleanText.length <= CHUNK_SIZE) {
    const raw = await chat(
      env,
      [{ role: "user", content: `${INSTRUCTION}\n\nTEXT:\n${cleanText}` }],
      { temperature: 0, maxTokens: 2048, model }
    );
    return { raw, records: parsePairs(raw) };
  }

  // For long texts — chunk and merge.
  const chunks: string[] = [];
  let offset = 0;
  while (offset < cleanText.length) {
    // Prefer to break on a newline near the boundary to avoid cutting a line mid-way.
    let end = Math.min(offset + CHUNK_SIZE, cleanText.length);
    if (end < cleanText.length) {
      const nl = cleanText.lastIndexOf("\n", end);
      if (nl > offset + CHUNK_SIZE * 0.6) end = nl + 1;
    }
    chunks.push(cleanText.slice(offset, end));
    offset = end;
  }

  // Process chunks in batches of 4 to stay within Worker CPU limits.
  const BATCH = 4;
  const rawParts: string[] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((chunk, j) =>
        chat(
          env,
          [{ role: "user", content: `${INSTRUCTION}\n\n[Part ${i + j + 1} of ${chunks.length}]\nTEXT:\n${chunk}` }],
          { temperature: 0, maxTokens: 2048, model }
        )
      )
    );
    rawParts.push(...results);
  }
  const allRecords = rawParts.flatMap(parsePairs);

  const records = dedupeRecords(allRecords);
  return { raw: rawParts.join("\n"), records };
}

