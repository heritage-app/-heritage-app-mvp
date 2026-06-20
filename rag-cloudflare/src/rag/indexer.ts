/**
 * Document indexing (ported from app/rag/indexer.py).
 * Extract -> classify -> parse -> chunk -> embed -> upsert to Vectorize.
 * Bible verses are additionally mirrored into D1 for structural lookup/discovery.
 */
import type { Env, VerseRecord } from "../types";
import { getCategory, type Category } from "../config";
import { embed } from "./embeddings";
import { buildBibleNodeText, parseUnstructured, parseBibleJsonl } from "./refiner";
import { upsertVerses } from "../db/bibleVerses";

interface VectorDoc {
  id: string;
  text: string;
  metadata: Record<string, any>;
}

/** Extract UTF-8 text from bytes by extension (PDF via unpdf; others decoded). */
export async function extractRawText(content: ArrayBuffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : text;
    } catch (e) {
      console.warn("PDF extraction failed, falling back to raw decode:", e);
    }
  }
  return new TextDecoder("utf-8").decode(content);
}

function detectCategory(text: string, filePath: string): Category {
  const path = filePath.toLowerCase();
  const sample = text.slice(0, 2000).toLowerCase();
  if (["bible", "bibele", "genesis", "exodus", "psalms", "jɛnɛsis"].some((k) => path.includes(k))) {
    return "bible";
  }
  if (sample.includes("kuku ni ji") || (sample.includes("chapter") && sample.includes("verse"))) {
    return "bible";
  }
  if (["story", "stories", "adese", "folk"].some((k) => path.includes(k))) return "stories";
  return "heritage";
}

/** Lightweight character-based splitter (≈ LlamaIndex SentenceSplitter). */
function chunkText(text: string, chunkSize: number, overlap = 50): string[] {
  const clean = text.trim();
  if (clean.length <= chunkSize) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    // Prefer to break on whitespace near the boundary.
    if (end < clean.length) {
      const ws = clean.lastIndexOf(" ", end);
      if (ws > start + chunkSize * 0.5) end = ws;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

function parseHeritageJsonl(text: string, baseMeta: Record<string, any>): VectorDoc[] {
  const docs: VectorDoc[] = [];
  let i = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let record: Record<string, any>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const english = record.english || record.en || record.phrase || "";
    const ga = record.ga || record.translation || record.ga_text || "";
    const tag = record.category || record.topic || "";

    let nodeText: string;
    if (english && ga) {
      nodeText = `English: ${english}\nGa: ${ga}`;
      if (tag) nodeText = `[${tag}]\n${nodeText}`;
    } else if (english || ga) {
      nodeText = english || ga;
    } else {
      nodeText = Object.entries(record)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
    }
    if (!nodeText.trim()) continue;

    const scalarMeta: Record<string, any> = {};
    for (const [k, v] of Object.entries(record)) {
      if (["string", "number", "boolean"].includes(typeof v)) scalarMeta[k] = v;
    }
    docs.push({
      id: `${baseMeta.file_path}:rec:${i++}`,
      text: nodeText,
      metadata: { ...baseMeta, ...scalarMeta, text: nodeText },
    });
  }
  return docs;
}

/** Upsert prepared docs into Vectorize in embedding batches; returns vector ids. */
async function upsertDocs(env: Env, docs: VectorDoc[]): Promise<string[]> {
  const BATCH = 50;
  const ids: string[] = [];
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const vectors = await embed(env, slice.map((d) => d.text));
    const records = slice.map((d, j) => ({
      id: d.id,
      values: vectors[j],
      metadata: d.metadata,
    }));
    await env.VECTORIZE.upsert(records);
    for (const r of records) ids.push(r.id);
  }
  return ids;
}

/** Directly index pre-refined Bible records (admin refine/commit path). */
export async function indexRefinedRecords(
  env: Env,
  records: VerseRecord[],
  metadata: Record<string, any> = {}
): Promise<string[]> {
  if (!records.length) return [];
  const docs: VectorDoc[] = records.map((r) => {
    const nodeText = buildBibleNodeText(r);
    return {
      id: r.id ?? `bible:${String(r.book).toLowerCase()}:${r.chapter_num}:${r.verse_num}`,
      text: nodeText,
      metadata: { ...metadata, ...r, category: "bible", text: nodeText },
    };
  });
  const ids = await upsertDocs(env, docs);
  await upsertVerses(env, records);
  return ids;
}

/** Index a document from raw bytes (extraction + classification + chunking). */
export async function indexFromBytes(
  env: Env,
  content: ArrayBuffer,
  filePath: string,
  metadata: Record<string, any> = {}
): Promise<{ category: Category; ids: string[] }> {
  const filename = filePath.split("/").pop() ?? filePath;
  const ext = "." + (filename.toLowerCase().split(".").pop() ?? "");
  const text = await extractRawText(content, filename);
  if (!text.trim()) return { category: "heritage", ids: [] };

  const category = metadata.category ? getCategory(metadata.category) : detectCategory(text, filePath);
  const baseMeta = { ...metadata, category, file_path: filePath, filename };

  let docs: VectorDoc[] = [];
  let verseRecords: VerseRecord[] = [];

  if (category === "bible") {
    const records = ext === ".jsonl" ? parseBibleJsonl(text, filename) : parseUnstructured(text, filename);
    for (const r of records) {
      const nodeText = buildBibleNodeText(r);
      docs.push({
        id: r.id ?? `bible:${String(r.book).toLowerCase()}:${r.chapter_num}:${r.verse_num}`,
        text: nodeText,
        metadata: { ...baseMeta, ...r, text: nodeText },
      });
    }
    verseRecords = records;
    if (docs.length === 0) {
      docs = chunkText(text, 2048).map((chunk, i) => ({
        id: `${filePath}:${i}`,
        text: chunk,
        metadata: { ...baseMeta, text: chunk },
      }));
    }
  } else if (ext === ".jsonl") {
    docs = parseHeritageJsonl(text, baseMeta);
    if (docs.length === 0) {
      docs = chunkText(text, 512).map((chunk, i) => ({
        id: `${filePath}:${i}`,
        text: chunk,
        metadata: { ...baseMeta, text: chunk },
      }));
    }
  } else {
    docs = chunkText(text, 1024).map((chunk, i) => ({
      id: `${filePath}:${i}`,
      text: chunk,
      metadata: { ...baseMeta, text: chunk },
    }));
  }

  const ids = await upsertDocs(env, docs);
  if (verseRecords.length) await upsertVerses(env, verseRecords);
  return { category, ids };
}
