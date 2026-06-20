/**
 * Retrieval over Vectorize (ported from app/rag/retriever.py).
 *
 * The Python version searched multiple Qdrant collections; here a single Vectorize
 * index is filtered by the `category` metadata tag to the same effect.
 */
import type { Env, RetrievedNode } from "../types";
import { DEFAULT_TOP_K, type Category } from "../config";
import { embedOne } from "./embeddings";
import { isRetrievableBibleRecord } from "./validator";

export interface RetrieveFilters {
  category?: Category;
  book?: string;
  chapter_num?: number;
  verse_num?: number;
}

export interface RetrieveOptions {
  topK?: number;
  filters?: RetrieveFilters;
  allowedCategories?: Category[];
}

function buildVectorizeFilter(opts: RetrieveOptions): Record<string, any> | undefined {
  const f: Record<string, any> = {};
  const { filters, allowedCategories } = opts;

  if (filters?.category) {
    f.category = { $eq: filters.category };
  } else if (allowedCategories && allowedCategories.length) {
    f.category = allowedCategories.length === 1
      ? { $eq: allowedCategories[0] }
      : { $in: allowedCategories };
  }
  if (filters?.book) f.book = { $eq: filters.book };
  if (filters?.chapter_num != null) f.chapter_num = { $eq: filters.chapter_num };
  if (filters?.verse_num != null) f.verse_num = { $eq: filters.verse_num };

  return Object.keys(f).length ? f : undefined;
}

export async function retrieveContext(
  env: Env,
  query: string,
  opts: RetrieveOptions = {}
): Promise<RetrievedNode[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const vector = await embedOne(env, query);
  const filter = buildVectorizeFilter(opts);

  let matches: VectorizeMatch[] = [];
  try {
    const res = await env.VECTORIZE.query(vector, {
      topK: Math.min(Math.max(topK, 1), 50),
      returnMetadata: "all",
      ...(filter ? { filter } : {}),
    });
    matches = res.matches ?? [];
  } catch (e) {
    console.warn("Vectorize query failed:", e);
    return [];
  }

  // De-dupe by content prefix, validate bible records, sort by score.
  const seen = new Map<string, RetrievedNode>();
  for (const m of matches) {
    const metadata = (m.metadata ?? {}) as Record<string, any>;
    if (metadata.category === "bible" && !isRetrievableBibleRecord(metadata)) continue;

    const text = String(metadata.text ?? metadata.node_text ?? "");
    const key = text.slice(0, 200);
    const node: RetrievedNode = { text, score: m.score ?? 0, metadata };
    const prev = seen.get(key);
    if (!prev || node.score > prev.score) seen.set(key, node);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function formatBibleEvidence(m: Record<string, any>): string {
  const g = (k: string, d = "") => String(m[k] ?? d).trim();
  return (
    "[BIBLE_RECORD]\n" +
    `book=${g("book")}\n` +
    `chapter_num=${g("chapter_num")}\n` +
    `verse_num=${g("verse_num")}\n` +
    `verse_ref=${g("verse_ref")}\n` +
    `reference_display=${g("reference_display")}\n` +
    `ga_version_name=${g("ga_version_name", "Ŋmalɛ Krɔŋkrɔŋ Lɛ")}\n` +
    `ga_version_abbr=${g("ga_version_abbr", "NEGAB")}\n` +
    `english_version_name=${g("english_version_name", "King James Version")}\n` +
    `english_version_abbr=${g("english_version_abbr", "KJV")}\n` +
    `ga=${g("ga")}\n` +
    `en=${g("en")}\n` +
    `source_name=${g("source_name")}\n` +
    "[/BIBLE_RECORD]\n"
  );
}

/** Format retrieved nodes into an LLM-context string. */
export function formatRetrievedContext(nodes: RetrievedNode[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    const meta = node.metadata ?? {};
    if (meta.category === "bible") {
      parts.push(formatBibleEvidence(meta));
      continue;
    }

    let filename = String(meta.filename ?? meta.file_path ?? "Generic Heritage Archive");
    if (filename.includes("\\")) filename = filename.split("\\").pop()!;
    let display = filename.includes(".") ? filename.split(".").slice(0, -1).join(".") : filename;
    display = display.replace(/_\d{8}_\d{6}/g, "");
    const source = display.replace(/_/g, " ").trim();

    let text = node.text;
    if (filename.toLowerCase().includes("phrase") || filename.toLowerCase().endsWith(".jsonl")) {
      const pairs: string[] = [];
      for (let line of text.split("\n")) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith(",")) line = line.slice(1).trim();
        try {
          const rec = JSON.parse(line);
          const eng = String(rec.english ?? "").trim();
          const ga = String(rec.ga ?? "").trim();
          if (eng && ga) pairs.push(`English: ${eng} → Ga: ${ga}`);
        } catch {
          if (line.includes("→") || (line.toLowerCase().includes("english") && line.toLowerCase().includes("ga"))) {
            pairs.push(line);
          }
        }
      }
      if (pairs.length) text = pairs.join("\n");
    }

    parts.push(`[Source: ${source} | Score: ${node.score.toFixed(3)}]\n${text}\n`);
  }

  return parts.join("\n");
}
