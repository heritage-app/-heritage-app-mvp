/**
 * Document repository (ported from app/storage/repositories/documents.py).
 */
import type { Env, DocumentRow } from "../types";

export async function createDocument(env: Env, doc: DocumentRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO documents (id, user_id, original_filename, unique_path, public_url, category, metadata, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      doc.id,
      doc.user_id,
      doc.original_filename,
      doc.unique_path,
      doc.public_url ?? "",
      doc.category ?? null,
      doc.metadata ?? "{}",
      doc.status,
      doc.created_at
    )
    .run();
}

export async function updateDocument(
  env: Env,
  id: string,
  fields: Partial<Pick<DocumentRow, "status" | "public_url" | "category" | "metadata">>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  if (sets.length === 0) return;
  values.push(id);
  await env.DB.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getDocumentById(env: Env, id: string): Promise<DocumentRow | null> {
  return env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first<DocumentRow>();
}

export async function getAllDocuments(env: Env, limit = 50, offset = 0): Promise<DocumentRow[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<DocumentRow>();
  return res.results ?? [];
}

export async function countDocuments(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
  return row?.c ?? 0;
}

export async function deleteDocument(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
}
