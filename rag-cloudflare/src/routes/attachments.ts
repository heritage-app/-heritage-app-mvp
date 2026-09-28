/**
 * Evidence attachments for user contributions.
 *
 * A contributor can attach a photo of a notebook page, a PDF of a printed
 * source, or a word list. These are EVIDENCE FOR A HUMAN REVIEWER — they are
 * stored in R2 alongside the contribution and are never parsed, embedded or
 * indexed. That is why .docx/.xlsx are accepted here while `/admin/upload`
 * rejects them: nothing downstream tries to read them as text.
 *
 * Uploading requires a signed-in account. Guests may still contribute text;
 * they just cannot push binaries into the bucket.
 */
import type { Env } from "../types";

/** Per-file cap. Workers can hold the whole body in memory, so keep it modest. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 4;

/**
 * Accepted kinds, keyed by extension. The MIME type a browser reports is
 * advisory (Android often sends application/octet-stream), so the extension is
 * authoritative and the stored content type comes from this table.
 */
const ALLOWED: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  // Plain text: read and indexed directly on approval (see rag/extract.ts).
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
};

export interface Attachment {
  key: string;
  name: string;
  type: string;
  size: number;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Strip anything that could escape the key prefix or confuse a Content-Disposition. */
function safeName(name: string): string {
  return (name.split(/[\\/]/).pop() || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export class AttachmentError extends Error {}

/**
 * Validate and store the uploaded files. Returns the attachment records to
 * embed in the contribution's metadata.
 *
 * Files are written under a caller-supplied batch id so the whole set can be
 * keyed before the D1 row exists — that keeps the contribution a single write.
 * On a later failure the caller should call `discardAttachments`.
 */
export async function storeAttachments(
  env: Env,
  batchId: string,
  files: File[]
): Promise<Attachment[]> {
  if (files.length > MAX_FILES) {
    throw new AttachmentError(`At most ${MAX_FILES} files per contribution.`);
  }

  // Validate the WHOLE set before writing anything. Rejecting file 4 after
  // file 1 is already in R2 would leave an orphan no row ever points at.
  const checked: Array<{ file: File; name: string; contentType: string }> = [];
  for (const file of files) {
    const name = safeName(file.name || "file");
    const contentType = ALLOWED[extOf(name)];
    if (!contentType) {
      throw new AttachmentError(
        `“${name}” is not an accepted file type. Use JPG, PNG, PDF, DOCX or XLSX.`
      );
    }
    if (file.size <= 0) {
      throw new AttachmentError(`“${name}” is empty.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new AttachmentError(
        `“${name}” is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB per file.`
      );
    }
    checked.push({ file, contentType, name });
  }

  const out: Attachment[] = [];
  try {
    let i = 0;
    for (const { file, name, contentType } of checked) {
      const key = `contrib/${batchId}/${i++}-${name}`;
      await env.DOCS_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: {
          contentType,
          // Evidence is downloaded/inspected, never rendered as part of the app.
          contentDisposition: `attachment; filename="${name}"`,
        },
      });
      out.push({ key, name, type: contentType, size: file.size });
    }
  } catch (e) {
    // A write failed part-way — take back the ones that landed.
    await discardAttachments(env, out);
    throw e;
  }
  return out;
}

/** Best-effort cleanup when the contribution write fails after upload. */
export async function discardAttachments(env: Env, items: Attachment[]): Promise<void> {
  for (const a of items) {
    try {
      await env.DOCS_BUCKET.delete(a.key);
    } catch (e) {
      console.error("Failed to discard orphaned attachment", a.key, e);
    }
  }
}

/**
 * Serve one attachment to a reviewer.
 * GET /api/v1/contributions/:id/attachments/:index
 *
 * Any signed-in account may read them — the review queue is a community
 * "+1 vote" mechanism, and a reviewer cannot judge evidence they cannot open.
 * Guests and anonymous callers are refused: these files carry whatever personal
 * detail the contributor photographed.
 */
export async function handleGetAttachment(
  request: Request,
  env: Env,
  contributionId: string,
  index: number
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT ai_issues FROM user_contributions WHERE id = ?"
  )
    .bind(contributionId)
    .first<{ ai_issues: string | null }>();

  if (!row) return json({ error: "Contribution not found" }, 404);

  let meta: { attachments?: Attachment[] } = {};
  try {
    meta = JSON.parse(row.ai_issues || "{}");
  } catch {
    /* unreadable metadata — treated as no attachments */
  }

  const list = Array.isArray(meta.attachments) ? meta.attachments : [];
  const item = list[index];
  if (!item) return json({ error: "Attachment not found" }, 404);

  const obj = await env.DOCS_BUCKET.get(item.key);
  if (!obj) return json({ error: "Attachment is no longer stored" }, 410);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Content-Type", item.type);
  headers.set("Content-Length", String(item.size));
  headers.set("X-Content-Type-Options", "nosniff");
  // Never cached by a shared cache — these are private to reviewers.
  headers.set("Cache-Control", "private, max-age=0, no-store");
  return new Response(obj.body, { headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
