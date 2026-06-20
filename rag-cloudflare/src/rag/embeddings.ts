/**
 * Embeddings via Workers AI (@cf/baai/bge-base-en-v1.5, 768 dims).
 * Replaces the local HuggingFace embeddings used in the Python system.
 */
import type { Env } from "../types";

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res: any = await env.AI.run(env.EMBEDDING_MODEL as any, { text: texts });
  return res.data as number[][];
}

export async function embedOne(env: Env, text: string): Promise<number[]> {
  const [v] = await embed(env, [text]);
  return v;
}
