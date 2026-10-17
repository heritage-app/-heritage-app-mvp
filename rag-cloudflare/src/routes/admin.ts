/**
 * Admin routes (ported from app/api/routers/admin.py): stats, documents (list/upload/delete),
 * Bible refine preview/commit, users (list/role).
 */
import { Hono } from "hono";
import type { Env, Variables, DocumentRow, VerseRecord } from "../types";
import { requireAdmin } from "../auth/middleware";
import {
  createDocument,
  updateDocument,
  getDocumentById,
  getAllDocuments,
  countDocuments,
  deleteDocument,
} from "../db/documents";
import { getAllUsers, countUsers, countUsersByRole, updateUserRole } from "../db/users";
import { countSessions } from "../db/sessions";
import { indexFromBytes, indexRefinedRecords, indexHeritageRecords, extractRawText } from "../rag/indexer";
import { getRefinementPreview } from "../rag/refiner";
import { extractContributedFile, isExtractable, extOf } from "../rag/extract";
import { ocrImage, textToPairs, parsePairs, tryParseStructuredPairs } from "../rag/vision";
import { embed } from "../rag/embeddings";
import { foldGa } from "../db/vocabulary";
import { normalizeGaCase } from "../rag/ga";
import { voiceKey } from "./voices";
import { slugifyFilename, timestampSlug, humanFileSize, humanizeTimestamp, nowIso } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", requireAdmin);

// Extensions that decode to garbage (zip/binary containers) — reject explicitly
// rather than letting TextDecoder turn them into noise for the LLM.
const UNSUPPORTED_EXT = /\.(docx?|xlsx?|pptx?|zip|rar|7z|exe|dll|bin|sqlite3?|db|mp3|mp4|wav|mov|epub)$/i;

// --- Stats ---
app.get("/stats", async (c) => {
  const [totalDocs, registeredUsers, guestChats, userChats] = await Promise.all([
    countDocuments(c.env),
    countUsers(c.env),
    countSessions(c.env, true),
    countSessions(c.env, false),
  ]);
  return c.json({
    total_documents: totalDocs,
    registered_users: registeredUsers,
    user_conversations: userChats,
    guest_conversations: guestChats,
    total_conversations: guestChats + userChats,
    status: "operational",
    timestamp: nowIso(),
  });
});

// --- List documents ---
app.get("/documents", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const [docs, total] = await Promise.all([
    getAllDocuments(c.env, limit, offset),
    countDocuments(c.env),
  ]);
  return c.json({
    documents: docs.map((d) => ({
      id: d.id,
      original_filename: d.original_filename,
      public_url: d.public_url ?? "",
      status: d.status,
      category: d.category ?? null,
      metadata: d.metadata ?? null,
      uploaded_at: humanizeTimestamp(d.created_at),
    })),
    total,
  });
});

// --- Upload + index (indexing runs in background via waitUntil) ---
app.post("/upload", async (c) => {
  const adminId = c.get("adminId")!;
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File) || !file.name) {
    return c.json({ detail: "Filename is required" }, 400);
  }

  let docMetadata: Record<string, any> = {};
  if (typeof form["metadata"] === "string") {
    try {
      docMetadata = JSON.parse(form["metadata"]);
    } catch {
      /* ignore */
    }
  }

  const name = file.name.toLowerCase();
  if (UNSUPPORTED_EXT.test(name)) {
    return c.json(
      { detail: `Unsupported file type — '${name.split(".").pop()}' decodes to binary garbage. Upload txt/md/json/jsonl/csv/tsv, a text-layer PDF, or page images instead.` },
      415
    );
  }
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name);
  const isPdf = file.type.includes("pdf") || name.endsWith(".pdf");
  const content = await file.arrayBuffer();
  const fileSize = content.byteLength;
  const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
  const base = file.name.replace(/\.[^.]+$/, "");
  const uniquePath = `${slugifyFilename(base)}_${timestampSlug()}${ext}`;

  docMetadata.file_path = uniquePath;
  docMetadata.filename = file.name;
  docMetadata.uploaded_at = nowIso();

  const docId = crypto.randomUUID();
  const row: DocumentRow = {
    id: docId,
    user_id: adminId,
    original_filename: file.name,
    unique_path: uniquePath,
    public_url: uniquePath,
    category: docMetadata.category ?? null,
    metadata: JSON.stringify(docMetadata),
    status: "uploading",
    created_at: nowIso(),
  };
  await createDocument(c.env, row);

  // Store the binary in R2.
  await c.env.DOCS_BUCKET.put(uniquePath, content, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await updateDocument(c.env, docId, { status: "uploaded" });

  // For images: OCR with vision model, then index as heritage pairs in background.
  if (isImage) {
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await updateDocument(c.env, docId, { status: "indexing" });
          const { records } = await ocrImage(c.env, content);
          if (records.length) {
            const ids = await indexHeritageRecords(c.env, records, { ...docMetadata, category: "heritage" });
            docMetadata.vector_ids = ids;
            docMetadata.record_count = records.length;
            await updateDocument(c.env, docId, {
              status: "indexed",
              category: "heritage",
              metadata: JSON.stringify(docMetadata),
            });
          } else {
            await updateDocument(c.env, docId, { status: "error" });
          }
        } catch (e) {
          console.error(`Background OCR indexing failed for ${docId}:`, e);
          await updateDocument(c.env, docId, { status: "error" });
        }
      })()
    );
    return c.json({
      status: "success",
      file_name: file.name,
      file_size: humanFileSize(fileSize),
      message: `✅ Image uploaded. OCR indexing in progress...`,
      file_url: uniquePath,
    });
  }

  // Background indexing for text/PDF files — continues after the response is sent.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await updateDocument(c.env, docId, { status: "indexing" });
        // For PDFs, check if text extraction actually produced content.
        if (isPdf) {
          const { extractRawText } = await import("../rag/indexer");
          const text = await extractRawText(content, file.name);
          if (text.trim().length < 150) {
            docMetadata.error = "Scanned PDF with no text layer. Re-upload as images for OCR.";
            await updateDocument(c.env, docId, { status: "error", metadata: JSON.stringify(docMetadata) });
            return;
          }
        }
        const { category, ids } = await indexFromBytes(c.env, content, uniquePath, docMetadata);
        docMetadata.vector_ids = ids;
        await updateDocument(c.env, docId, {
          status: "indexed",
          category,
          metadata: JSON.stringify(docMetadata),
        });
      } catch (e) {
        console.error(`Background indexing failed for ${docId}:`, e);
        await updateDocument(c.env, docId, { status: "error" });
      }
    })()
  );

  const categoryMsg = docMetadata.category ? ` as category '${docMetadata.category}'` : "";
  return c.json({
    status: "success",
    file_name: file.name,
    file_size: humanFileSize(fileSize),
    message: `✅ Document '${uniquePath}' uploaded. Indexing in progress${categoryMsg}...`,
    file_url: uniquePath,
    next_step: "Document will be searchable shortly.",
  });
});

// --- Upload preview: file → LLM → JSONL for admin review (no indexing yet) ---
// Supports: images (OCR via vision model), PDFs, plain text, and any UTF-8 file.
// Returns {english, ga, topic} JSONL pairs matching the dataset format.
app.post("/upload/preview", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File) || !file.name) {
    return c.json({ detail: "A file is required" }, 400);
  }

  const name = file.name.toLowerCase();
  if (UNSUPPORTED_EXT.test(name)) {
    return c.json(
      { detail: `Unsupported file type — '${name.split(".").pop()}' decodes to binary garbage. Upload txt/md/json/jsonl/csv/tsv, a text-layer PDF, or page images instead.` },
      415
    );
  }
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name);
  const isPdf = file.type.includes("pdf") || name.endsWith(".pdf");
  const bytes = await file.arrayBuffer();

  try {
    let result: { raw: string; records: VerseRecord[] };
    let note = "";

    if (isImage) {
      // True OCR: vision model reads the image directly.
      result = await ocrImage(c.env, bytes);
      note = "OCR extracted from image via vision model.";
    } else {
      // PDF/text: extract the text layer, then try deterministic parse before the LLM.
      const text = await extractRawText(bytes, file.name);
      if (isPdf && text.trim().length < 150) {
        return c.json(
          { detail: "This PDF appears to be a scanned image with no text layer. Export pages as PNG/JPG and use the image upload instead." },
          422
        );
      }
      const structured = tryParseStructuredPairs(text);
      if (structured) {
        result = { raw: text.slice(0, 8000), records: structured };
        note = `Parsed structured format directly — no AI used (${structured.length} pairs).`;
      } else {
        result = await textToPairs(c.env, text);
        note = isPdf
          ? `Extracted from PDF text layer (${text.length.toLocaleString()} chars).`
          : `Extracted from text file (${text.length.toLocaleString()} chars).`;
      }
    }

    // Build the JSONL string that matches the dataset format exactly.
    const jsonl = result.records
      .map((r) => JSON.stringify({ english: r.english, ga: r.ga, topic: (r as any).topic ?? undefined }))
      .join("\n");

    return c.json({
      file_name: file.name,
      note,
      record_count: result.records.length,
      jsonl,
      // Raw LLM output (for debugging) — truncated to 8000 chars.
      raw_text: result.raw.slice(0, 8000),
      next_step: "Review and edit the JSONL above, then POST it to /admin/heritage/commit to index.",
    });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
      return c.json({ detail: "Extraction timed out — the document may be too large. Try splitting it into smaller sections or uploading fewer pages at a time." }, 504);
    }
    return c.json({ detail: `Preview extraction failed: ${msg}` }, 500);
  }
});

// --- Delete document (D1 + R2 + Vectorize) ---
app.delete("/documents/:document_id", async (c) => {
  const id = c.req.param("document_id");
  const doc = await getDocumentById(c.env, id);
  if (!doc) return c.json({ detail: "Document not found" }, 404);

  // Remove binary from R2.
  if (doc.unique_path) {
    try {
      await c.env.DOCS_BUCKET.delete(doc.unique_path);
    } catch (e) {
      console.error("R2 delete failed:", e);
    }
  }

  // Remove vectors (ids tracked in metadata during indexing).
  try {
    const meta = doc.metadata ? JSON.parse(doc.metadata) : {};
    const ids: string[] = meta.vector_ids ?? [];
    if (ids.length) await c.env.VECTORIZE.deleteByIds(ids);
  } catch (e) {
    console.error("Vector delete failed:", e);
  }

  await deleteDocument(c.env, id);
  return c.json({ status: "success", message: `Document ${id} completely removed from Heritage system.` });
});

// --- Bible refine: preview ---
app.post("/refine/preview", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ detail: "File is required" }, 400);
  const text = await extractRawText(await file.arrayBuffer(), file.name);
  return c.json(getRefinementPreview(text, file.name));
});

// --- Bible refine: commit ---
app.post("/refine/commit", async (c) => {
  const adminId = c.get("adminId")!;
  type CommitBody = { staged_records?: VerseRecord[]; original_filename?: string };
  const body = await c.req.json<CommitBody>().catch(() => ({} as CommitBody));
  const records = body.staged_records ?? [];
  const filename = body.original_filename ?? "bible.jsonl";
  if (!records.length) return c.json({ detail: "No records provided" }, 400);

  const base = slugifyFilename(filename.replace(/\.[^.]+$/, ""));
  const ts = timestampSlug();
  const jsonlContent = records.map((r) => JSON.stringify(r)).join("\n");
  const jsonlPath = `refined/${base}_${ts}_refined.jsonl`;

  await c.env.DOCS_BUCKET.put(jsonlPath, jsonlContent, {
    httpMetadata: { contentType: "application/jsonl" },
  });

  const docId = crypto.randomUUID();
  const docMetadata = {
    category: "bible",
    filename,
    unique_path: jsonlPath,
    uploaded_at: nowIso(),
    verse_count: records.length,
  };

  await createDocument(c.env, {
    id: docId,
    user_id: adminId,
    original_filename: filename,
    unique_path: jsonlPath,
    public_url: jsonlPath,
    category: "bible",
    metadata: JSON.stringify(docMetadata),
    status: "indexing",
    created_at: nowIso(),
  });

  const ids = await indexRefinedRecords(c.env, records, docMetadata);
  await updateDocument(c.env, docId, {
    status: "indexed",
    metadata: JSON.stringify({ ...docMetadata, vector_ids: ids }),
  });

  return c.json({
    status: "success",
    file_name: filename,
    file_size: `${(jsonlContent.length / 1024).toFixed(2)} KB`,
    message: `✅ ${records.length} Bible verses refined and indexed successfully!`,
    file_url: jsonlPath,
    next_step: "These verses are now searchable in the archive.",
  });
});

// --- OCR/extract preview: image/PDF/text -> proposed {english, ga} JSONL (for review) ---
app.post("/ocr/preview", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ detail: "File is required" }, 400);

  const name = file.name.toLowerCase();
  if (UNSUPPORTED_EXT.test(name)) {
    return c.json(
      { detail: `Unsupported file type — '${name.split(".").pop()}' decodes to binary garbage. Upload txt/md/json/jsonl/csv/tsv, a text-layer PDF, or page images instead.` },
      415
    );
  }
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name);
  const isPdf = file.type.includes("pdf") || name.endsWith(".pdf");
  const bytes = await file.arrayBuffer();
  const engine = typeof form["engine"] === "string" ? form["engine"] : "auto";

  try {
    let result: { raw: string; records: VerseRecord[] };
    let note = "";

    if (engine === "vision" || (engine === "auto" && isImage)) {
      // Vision OCR: send image to vision model.
      result = await ocrImage(c.env, bytes);
      note = "OCR extracted via vision model.";
    } else if (engine === "text" || (engine === "auto" && !isImage)) {
      // Text extract: use PDF text layer or raw text.
      const text = await extractRawText(bytes, file.name);
      if (isPdf && text.trim().length < 150) {
        // Scanned PDF — a Worker can't rasterize pages, and the vision model
        // receives raw PDF bytes (not an image) if we pass them through.
        return c.json(
          { detail: "This PDF is a scan with no text layer. Workers can't rasterize PDF pages — export pages as PNG/JPG and upload those for vision OCR." },
          422
        );
      }
      // Structured files (JSONL/TSV/CSV/dash-delimited) parse exactly — no LLM.
      const structured = tryParseStructuredPairs(text);
      if (structured) {
        result = { raw: text.slice(0, 8000), records: structured };
        note = `Parsed structured format directly — no AI used (${structured.length} pairs).`;
      } else {
        result = await textToPairs(c.env, text);
        note = isPdf ? "Extracted from the PDF text layer." : "Extracted from text.";
      }
    } else {
      return c.json({ detail: `Unknown engine "${engine}". Use "auto", "vision", or "text".` }, 400);
    }

    return c.json({
      file_name: file.name,
      engine,
      note,
      record_count: result.records.length,
      jsonl: result.records.map((r) => JSON.stringify(r)).join("\n"),
      raw_text: result.raw.slice(0, 8000),
    });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
      return c.json({ detail: "Extraction timed out — the document may be too large. Try splitting it into smaller sections or uploading fewer pages at a time." }, 504);
    }
    return c.json({ detail: `OCR/extract failed: ${msg}` }, 500);
  }
});

// --- Heritage commit: reviewed/edited JSONL pairs -> index as heritage ---
app.post("/heritage/commit", async (c) => {
  const adminId = c.get("adminId")!;
  type Body = { jsonl?: string; original_filename?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));

  // Accept either a JSONL string or an array of records.
  const records: VerseRecord[] = [];
  for (const raw of (body.jsonl ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      const english = String(r.english ?? r.en ?? "").trim();
      const ga = String(r.ga ?? "").trim();
      if (english && ga) records.push({ english, ga, category: "heritage" } as VerseRecord);
    } catch {
      /* skip */
    }
  }
  if (!records.length) return c.json({ detail: "No valid {english, ga} records provided" }, 400);

  const filename = body.original_filename ?? "ocr-import.jsonl";
  const base = slugifyFilename(filename.replace(/\.[^.]+$/, ""));
  const path = `heritage/${base}_${timestampSlug()}.jsonl`;
  const jsonlContent = records.map((r) => JSON.stringify(r)).join("\n");

  await c.env.DOCS_BUCKET.put(path, jsonlContent, { httpMetadata: { contentType: "application/jsonl" } });

  const docId = crypto.randomUUID();
  const docMeta = { category: "heritage", filename, unique_path: path, file_path: path, record_count: records.length };
  await createDocument(c.env, {
    id: docId,
    user_id: adminId,
    original_filename: filename,
    unique_path: path,
    public_url: path,
    category: "heritage",
    metadata: JSON.stringify(docMeta),
    status: "indexing",
    created_at: nowIso(),
  });

  const ids = await indexHeritageRecords(c.env, records, docMeta);
  await updateDocument(c.env, docId, { status: "indexed", metadata: JSON.stringify({ ...docMeta, vector_ids: ids }) });

  return c.json({
    status: "success",
    file_name: filename,
    message: `✅ ${records.length} heritage phrases indexed successfully!`,
    file_url: path,
    next_step: "These phrases are now searchable in the General archive.",
  });
});

// --- Users list ---
// ?group=team → console roles (admin, moderator); ?group=members → everyone
// else (the app's crowd). ?q= filters email/names. The response always carries
// a per-role breakdown so the console can show counts without another call.
const USER_GROUPS: Record<string, string[]> = {
  team: ["admin", "moderator"],
  members: ["member", "user"],
};
app.get("/users", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const group = USER_GROUPS[c.req.query("group") ?? ""];
  const q = (c.req.query("q") ?? "").trim() || undefined;
  const filter = { roles: group, q };
  const [users, total, counts] = await Promise.all([
    getAllUsers(c.env, limit, offset, filter),
    countUsers(c.env, filter),
    countUsersByRole(c.env),
  ]);
  return c.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      display_name: u.display_name,
      first_name: u.first_name,
      last_name: u.last_name,
      dob: u.dob,
      created_at: humanizeTimestamp(u.created_at),
    })),
    total,
    counts,
  });
});

// --- Update user role ---
app.patch("/users/:target_user_id/role", async (c) => {
  const targetId = c.req.param("target_user_id");
  const role = c.req.query("role");
  if (!role || !["admin", "moderator", "user", "member"].includes(role)) {
    return c.json({ detail: "Invalid role. Must be 'admin', 'moderator', 'user', or 'member'." }, 400);
  }
  const ok = await updateUserRole(c.env, targetId, role);
  if (!ok) return c.json({ detail: "User not found or role unchanged." }, 404);
  return c.json({ status: "success", message: `User role updated to ${role}.` });
});

// --- Contribution review ---
app.get("/contributions", async (c) => {
  const status = c.req.query("status") || "pending_review";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const rows = await c.env.DB.prepare(
    `SELECT id, original_query, user_answer, category, status, agreement_score,
            conflict_group_id, ai_issues, timestamp
     FROM user_contributions
     WHERE status = ?
     ORDER BY timestamp DESC
     LIMIT ? OFFSET ?`
  )
    .bind(status, limit, offset)
    .all<{
      id: string;
      original_query: string;
      user_answer: string;
      category: string;
      status: string;
      agreement_score: number;
      conflict_group_id: string | null;
      ai_issues: string | null;
      timestamp: string;
    }>();

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM user_contributions WHERE status = ?"
  )
    .bind(status)
    .first<{ count: number }>();

  // Recordings that came with these contributions (reviewed on the Voices page).
  const ids = (rows.results || []).map((r) => r.id);
  const recs = ids.length
    ? await c.env.DB.prepare(
        `SELECT contribution_id, id, status FROM voice_recordings WHERE contribution_id IN (${ids.map(() => "?").join(",")})`
      ).bind(...ids).all<{ contribution_id: string; id: string; status: string }>().catch(() => ({ results: [] as { contribution_id: string; id: string; status: string }[] }))
    : { results: [] as { contribution_id: string; id: string; status: string }[] };
  const recBy = new Map((recs.results || []).map((x) => [x.contribution_id, x]));

  return c.json({
    contributions: (rows.results || []).map((r) => {
      let meta: Record<string, any> = {};
      try { meta = JSON.parse(r.ai_issues || "{}"); } catch {}
      return {
        id: r.id,
        query: r.original_query,
        answer: r.user_answer,
        category: r.category,
        status: r.status,
        agreement_score: r.agreement_score,
        conflict_group_id: r.conflict_group_id,
        has_conflict: !!r.conflict_group_id,
        type: meta.type || "translation",
        source: meta.source || "user",
        notes: meta.notes || null,
        contributor_name: meta.contributor_name || null,
        contributor_email: meta.contributor_email || null,
        contributor_location: meta.contributor_location || null,
        created_at: humanizeTimestamp(r.timestamp),
        // Evidence files (names only; bytes via /contributions/:id/attachments/:i).
        attachments: (Array.isArray(meta.attachments) ? meta.attachments : []).map(
          (a: { name?: string; type?: string; size?: number }, i: number) => ({ index: i, name: a.name || `file-${i + 1}`, type: a.type || "", size: a.size || 0 })
        ),
        recording: recBy.has(r.id) ? { id: recBy.get(r.id)!.id, status: recBy.get(r.id)!.status } : null,
      };
    }),
    total: total?.count ?? 0,
  });
});

app.post("/contributions/:id/approve", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const now = nowIso();

  const row = await c.env.DB.prepare(
    "SELECT id, original_query, user_answer, category, ai_issues FROM user_contributions WHERE id = ?"
  )
    .bind(id)
    .first<{ id: string; original_query: string; user_answer: string; category: string; ai_issues: string | null }>();

  if (!row) return c.json({ detail: "Contribution not found" }, 404);

  let meta: any = {};
  try { meta = JSON.parse(row.ai_issues || "{}"); } catch {}
  // Phone keyboards leave stray capitals ("NYɔŋmɔ"); an approval must not
  // publish them to every learner.
  const ga = normalizeGaCase(row.user_answer.trim());

  // All core writes go in one atomic batch — under D1 write-cap pressure a
  // mid-sequence failure would otherwise leave "approved" rows with no vocab
  // entry. A cap error returns an honest 503 instead of an opaque 500.
  const statusUpdate = c.env.DB.prepare(
    "UPDATE user_contributions SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?"
  ).bind(adminId, now, id);
  const isQuotaError = (e: unknown) => /row write limit|exceeded D1/i.test(String(e));
  const quotaResponse = (e: unknown) =>
    isQuotaError(e)
      ? c.json({ detail: "D1 daily write limit reached — approve can't complete right now. It resets at midnight UTC; upgrading to Workers Paid removes the cap." }, 503)
      : null;

  // Context for a word: goes to word_context (shown under the word's answer),
  // never to vocabulary.
  if (meta.type === "context") {
    let name: string | null = meta.contributor_name || null;
    if (!name && meta.contributor_id) {
      const u = await c.env.DB.prepare("SELECT first_name, display_name FROM users WHERE id = ?")
        .bind(meta.contributor_id).first<{ first_name: string | null; display_name: string | null }>().catch(() => null);
      name = (u?.first_name || u?.display_name || "").trim().split(/\s+/)[0] || null;
    }
    try {
      await c.env.DB.batch([
        statusUpdate,
        c.env.DB.prepare(
          `INSERT INTO word_context (id, ga, ga_key, english, context, example_ga, example_en, contributor_id, contributor_name, contribution_id, approved_by, approved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), ga, voiceKey(ga), row.original_query, meta.context || null, meta.example_ga || null, meta.example_en || null,
          meta.contributor_id || null, name, row.id, adminId, now),
      ]);
    } catch (e) {
      return quotaResponse(e) ?? (() => { throw e; })();
    }
    return c.json({ status: "success", message: `Context added to “${ga}”. It shows under its answer in the app.` });
  }

  // A `document` submission is a source, not a word pair — it has no Ga answer,
  // so it must never reach the vocabulary insert below.
  //
  // On approval each attached file takes one of two lanes:
  //   text-bearing (pdf with a text layer, docx, txt/md/csv/tsv/json/jsonl)
  //     -> extracted and indexed into the archive, same pipeline as an upload
  //   image, scan, or a container we can't read (.doc/.xls/.xlsx)
  //     -> left in R2 for the reviewer to download and type in
  // Indexing runs after the response so a slow PDF never blocks the approval.
  if (meta.type === "document") {
    const attachments: Array<{ key: string; name: string; type: string; size: number }> =
      Array.isArray(meta.attachments) ? meta.attachments : [];

    const indexed: string[] = [];
    const manual: Array<{ name: string; reason: string }> = [];
    const queued: Array<{ name: string; text: string; docId: string; path: string }> = [];

    for (const a of attachments) {
      if (!isExtractable(a.name)) {
        manual.push({ name: a.name, reason: `${extOf(a.name) || "file"} needs a person — download it and type the entries in` });
        continue;
      }
      const obj = await c.env.DOCS_BUCKET.get(a.key);
      if (!obj) {
        manual.push({ name: a.name, reason: "file is no longer stored" });
        continue;
      }
      const result = await extractContributedFile(await obj.arrayBuffer(), a.name);
      if (result.kind !== "text") {
        manual.push({ name: a.name, reason: result.reason || "needs a person" });
        continue;
      }
      const docId = crypto.randomUUID();
      const path = `contrib-indexed/${row.id}/${slugifyFilename(a.name)}`;
      queued.push({ name: a.name, text: result.text, docId, path });
      indexed.push(a.name);
    }

    try {
      await statusUpdate.run();
    } catch (e) {
      return quotaResponse(e) ?? (() => { throw e; })();
    }

    // Register + index the readable files in the background.
    for (const q of queued) {
      const docMeta = {
        category: row.category === "bible" ? "bible" : "heritage",
        filename: q.name,
        file_path: q.path,
        unique_path: q.path,
        source_name: `contributed document — ${row.original_query}`.slice(0, 160),
        contribution_id: row.id,
        approved_by: adminId,
        approved_at: now,
      };
      await createDocument(c.env, {
        id: q.docId,
        user_id: adminId,
        original_filename: q.name,
        unique_path: q.path,
        public_url: q.path,
        category: docMeta.category,
        metadata: JSON.stringify(docMeta),
        status: "indexing",
        created_at: now,
      });

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const bytes = new TextEncoder().encode(q.text).buffer as ArrayBuffer;
            const { category, ids } = await indexFromBytes(c.env, bytes, q.path, docMeta);
            await updateDocument(c.env, q.docId, {
              status: "indexed",
              category,
              metadata: JSON.stringify({ ...docMeta, vector_ids: ids }),
            });
          } catch (e) {
            console.error(`Indexing contributed document ${q.docId} failed:`, e);
            await updateDocument(c.env, q.docId, { status: "error" });
          }
        })()
      );
    }

    const parts: string[] = [];
    if (indexed.length) parts.push(`Indexing ${indexed.length} file${indexed.length > 1 ? "s" : ""}: ${indexed.join(", ")}.`);
    if (manual.length) parts.push(`Needs you: ${manual.map((m) => `${m.name} (${m.reason})`).join("; ")}.`);
    if (!parts.length) parts.push("Document accepted — no files were attached.");

    return c.json({
      status: "success",
      message: parts.join(" "),
      indexed,
      manual,
      corpus_written: indexed.length > 0,
    });
  }

  // bible_verse contributions go to bible_verses, NOT vocabulary — a verse
  // reference must never become an English headword.
  if (meta.type === "bible_verse" && meta.book && meta.chapter && meta.verse) {
    const verseId = `bible:${String(meta.book).toLowerCase()}:${meta.chapter}:${meta.verse}`;
    const existing = await c.env.DB.prepare(
      "SELECT id, source_name FROM bible_verses WHERE id = ?"
    ).bind(verseId).first<{ id: string; source_name: string | null }>();

    if (existing) {
      try {
        await statusUpdate.run();
      } catch (e) {
        return quotaResponse(e) ?? (() => { throw e; })();
      }
      return c.json({
        status: "success",
        message: "Contribution approved. A curated verse already exists at this reference — the corpus was not overwritten.",
        verse_id: verseId,
        corpus_written: false,
      });
    }

    const verseInsert = c.env.DB.prepare(
      `INSERT INTO bible_verses (id, book, chapter_num, verse_num, verse_ref, ga, en, source_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user_contribution', ?)`
    ).bind(
      verseId,
      meta.book,
      meta.chapter,
      meta.verse,
      `${meta.book} ${meta.chapter}:${meta.verse}`,
      ga,
      meta.english_text || null,
      now
    );
    try {
      await c.env.DB.batch([statusUpdate, verseInsert]);
    } catch (e) {
      return quotaResponse(e) ?? (() => { throw e; })();
    }

    return c.json({
      status: "success",
      message: "Bible verse contribution approved and added to the corpus.",
      verse_id: verseId,
      corpus_written: true,
    });
  }

  const english = row.original_query.trim();
  const category = row.category || "general";

  // Add to vocabulary (integrity-gated: source + verified_at present so it surfaces)
  const vocabId = crypto.randomUUID();
  const vocabInsert = c.env.DB.prepare(
    `INSERT INTO vocabulary (id, headword, headword_normalized, meanings, translations, category, source, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, 'admin_approved', ?)`
  )
    .bind(
      vocabId,
      ga,
      foldGa(ga),
      JSON.stringify([english]),
      JSON.stringify([english]),
      category,
      now
    );

  // A correction REPLACES what was there. Without this the old entry stayed
  // verified next to the new one, both matched "i am eating" equally, and
  // the old answer kept being served after the fix was approved. Only exact
  // matches of this English are retired (hidden, not deleted) and recorded,
  // so rejecting the correction later puts them back. Plain translations
  // are additions — "doctor" can be both Datrɛ and Dɔkita — and retire nothing.
  const retire: Array<{ id: string; verified_at: string }> = [];
  if (meta.type === "correction") {
    const key = (t: string) =>
      foldGa(String(t).toLowerCase()).replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const probe = english.toLowerCase().replace(/['’]/g, "");
    const cands = await c.env.DB.prepare(
      `SELECT id, translations, verified_at FROM vocabulary
       WHERE REPLACE(REPLACE(translations, '''', ''), '’', '') LIKE ?
         AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''`
    ).bind(`%${probe}%`).all<{ id: string; translations: string; verified_at: string }>();
    for (const r of cands.results ?? []) {
      let t: string[] = [];
      try { t = JSON.parse(r.translations || "[]"); } catch {}
      if (t.some((x) => key(x) === key(english))) retire.push({ id: r.id, verified_at: r.verified_at });
    }
  }
  const retireStmts = retire.map((r) =>
    c.env.DB.prepare("UPDATE vocabulary SET verified_at = NULL WHERE id = ?").bind(r.id)
  );

  // Record which vocab row this contribution created so rejection can delete
  // exactly that row — never by shared headword.
  meta.vocab_id = vocabId;
  if (retire.length) meta.superseded = retire;
  const metaUpdate = c.env.DB.prepare(
    "UPDATE user_contributions SET ai_issues = ? WHERE id = ?"
  ).bind(JSON.stringify(meta), id);

  try {
    await c.env.DB.batch([statusUpdate, ...retireStmts, vocabInsert, metaUpdate]);
  } catch (e) {
    return quotaResponse(e) ?? (() => { throw e; })();
  }

  // Embed + upsert into Vectorize so the contribution is semantically retrievable.
  // Deterministic ID allows clean deletion later if needed.
  const vectorId = `contrib:${row.id}`;
  try {
    const nodeText = `English: ${english}\nGa: ${ga}`;
    const [vector] = await embed(c.env, [nodeText]);
    if (vector) {
      await c.env.VECTORIZE.upsert([{
        id: vectorId,
        values: vector,
        metadata: {
          category: "heritage",
          english,
          ga,
          source: "user_contribution",
          contribution_id: row.id,
          verified_by: adminId,
          text: nodeText,
        },
      }]);
    }
  } catch (e) {
    console.error(`Vectorize upsert failed for contribution ${row.id}:`, e);
    // Non-fatal: contribution is still in D1 vocabulary for SQL lookup.
  }

  // Resolve the knowledge gap — best-effort, never blocks an approval.
  try {
    await c.env.DB.prepare(
      "UPDATE knowledge_gaps SET status = 'resolved', user_submitted_answer = ? WHERE query = ?"
    )
      .bind(ga, english.toLowerCase().trim())
      .run();
  } catch (e) {
    console.warn("knowledge_gaps resolve failed (non-critical):", e);
  }

  return c.json({
    status: "success",
    message: "Contribution approved, added to vocabulary, and indexed into Vectorize.",
    vector_id: vectorId,
  });
});

app.post("/contributions/:id/reject", async (c) => {
  const id = c.req.param("id");
  const now = nowIso();

  const row = await c.env.DB.prepare(
    "SELECT id, status, original_query, user_answer, ai_issues FROM user_contributions WHERE id = ?"
  )
    .bind(id)
    .first<{ id: string; status: string; original_query: string; user_answer: string; ai_issues: string | null }>();

  if (!row) return c.json({ detail: "Contribution not found" }, 404);

  try {
    await c.env.DB.prepare(
      "UPDATE user_contributions SET status = 'rejected', reviewed_at = ? WHERE id = ?"
    )
      .bind(now, id)
      .run();
  } catch (e) {
    if (/row write limit|exceeded D1/i.test(String(e))) {
      return c.json({ detail: "D1 daily write limit reached — reject can't complete right now. It resets at midnight UTC; upgrading to Workers Paid removes the cap." }, 503);
    }
    throw e;
  }

  // If previously approved/indexed, remove exactly the rows this contribution created.
  if (row.status === "approved") {
    try { await c.env.VECTORIZE.deleteByIds([`contrib:${id}`]); } catch (e) { console.error("Vector delete failed:", e); }

    let meta: any = {};
    try { meta = JSON.parse(row.ai_issues || "{}"); } catch {}

    try {
      if (meta.type === "bible_verse" && meta.book && meta.chapter && meta.verse) {
        // Remove the corpus row only if it was written by this contribution.
        const verseId = `bible:${String(meta.book).toLowerCase()}:${meta.chapter}:${meta.verse}`;
        await c.env.DB.prepare(
          "DELETE FROM bible_verses WHERE id = ? AND source_name = 'user_contribution'"
        ).bind(verseId).run();
        try { await c.env.VECTORIZE.deleteByIds([verseId]); } catch {}
      } else if (meta.vocab_id) {
        // Exact row this approval created.
        await c.env.DB.prepare(
          "DELETE FROM vocabulary WHERE id = ? AND source = 'admin_approved'"
        ).bind(meta.vocab_id).run();
        // ...and the entries it replaced come back.
        for (const r of (meta.superseded ?? []) as Array<{ id: string; verified_at: string }>) {
          await c.env.DB.prepare(
            "UPDATE vocabulary SET verified_at = ? WHERE id = ? AND verified_at IS NULL"
          ).bind(r.verified_at, r.id).run();
        }
      } else {
        // Legacy rows have no vocab_id — narrow to this exact pair so unrelated
        // entries sharing the headword are never touched.
        await c.env.DB.prepare(
          `DELETE FROM vocabulary WHERE source = 'admin_approved'
           AND headword_normalized = ? AND meanings LIKE ?`
        ).bind(foldGa(row.user_answer), `%${row.original_query.trim()}%`).run();
      }
    } catch (e) {
      // Cleanup best-effort: rejection already committed; a leftover vocab row
      // can be removed on a later reject. Never 500 the rejection itself.
      console.warn("Post-reject cleanup failed (non-critical):", e);
    }
  }

  return c.json({ status: "success", message: "Contribution rejected." });
});

// --- Reindex: re-embed stored R2 documents into Vectorize (slice per call).
// Used when the index must be rebuilt (e.g. account migration) — vectors don't
// export between accounts, so each doc is re-fetched from R2 and re-indexed.
app.post("/reindex", async (c) => {
  const path = c.req.query("path");
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "5", 10) || 5, 1), 10);
  // Optional record-level paging inside a single document — big files
  // (e.g. a 2.5k-verse book) exceed the per-request CPU limit if embedded
  // in one call, so the driver pages through with rec_limit.
  const recOffset = Math.max(parseInt(c.req.query("rec_offset") ?? "0", 10) || 0, 0);
  const recLimit = Math.min(Math.max(parseInt(c.req.query("rec_limit") ?? "0", 10) || 0, 0), 500);
  const docs = path
    ? (await c.env.DB.prepare("SELECT * FROM documents WHERE unique_path = ?").bind(path).all<DocumentRow>()).results
    : await getAllDocuments(c.env, limit, offset);
  const results: Record<string, unknown>[] = [];

  for (const d of docs) {
    try {
      const obj = await c.env.DOCS_BUCKET.get(d.unique_path);
      if (!obj) {
        results.push({ path: d.unique_path, error: "missing in R2" });
        continue;
      }
      const content = await obj.arrayBuffer();
      let docMetadata: Record<string, any> = {};
      try { docMetadata = JSON.parse(d.metadata ?? "{}"); } catch {}

      if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(d.unique_path)) {
        const { records } = await ocrImage(c.env, content);
        const ids = records.length
          ? await indexHeritageRecords(c.env, records, { ...docMetadata, category: "heritage" })
          : [];
        results.push({ path: d.unique_path, vectors: ids.length });
        continue;
      }

      const range = recLimit > 0 ? { offset: recOffset, limit: recLimit } : undefined;
      const { category, ids, total, vectorPending } = await indexFromBytes(
        c.env, content, d.unique_path, docMetadata, range
      );
      const advanced = recOffset + ids.length;
      results.push({
        path: d.unique_path,
        category,
        vectors: ids.length,
        records_total: total,
        next_offset: advanced < total && advanced > recOffset ? advanced : null,
        ...(vectorPending ? { error: "vector embed failed (quota/AI) — vectors pending" } : {}),
      });
    } catch (e) {
      results.push({ path: d.unique_path, error: String(e) });
    }
  }

  return c.json({ offset, processed: results.length, results });
});

// --- Word alignments: English↔Ga word pairs inferred from sentence-pair
// co-occurrence (Dice). /build recomputes from live R2 heritage docs; rows a
// reviewer already promoted/rejected keep their status across rebuilds. ---

const ALIGN_STOP_EN = new Set([
  "in", "ga", "the", "a", "an", "is", "are", "was", "were", "what", "how", "do",
  "does", "did", "you", "your", "yours", "say", "said", "tell", "me", "to",
  "of", "for", "my", "i", "we", "they", "he", "she", "it", "this", "that",
  "these", "those", "and", "or", "but", "not", "no", "yes", "on", "at", "by",
  "with", "from", "about", "as", "so", "if", "then", "there", "here", "where",
  "when", "why", "who", "which", "can", "could", "would", "should", "will",
  "shall", "may", "might", "must", "have", "has", "had", "be", "been", "being",
  "am", "into", "over", "under", "up", "down", "out", "off", "very", "too",
  "also", "just", "now", "than", "then", "please", "lets", "let", "us",
]);
const ALIGN_STOP_GA = new Set([
  "le", "ni", "ke", "mo", "no", "a", "e", "o", "shi", "mli", "he", "koni",
  "saa", "ye", "wo", "bo", "mi", "wo", "noo", "fee", "haa",
]);

function alignWords(s: string): string[] {
  return foldGa(s.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu) ?? [];
}

// Reviewer aid: which checked Ga words already stand for the same English, so
// a suggestion can be approved as a variation instead of rejected outright.
function enKey(t: string): string {
  return foldGa(String(t).toLowerCase()).replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}
async function vocabByEnglish(db: D1Database): Promise<Map<string, { id: string; headword: string }[]>> {
  const rows = await db.prepare(
    "SELECT id, headword, translations FROM vocabulary WHERE verified_at IS NOT NULL AND TRIM(verified_at) <> ''"
  ).all<{ id: string; headword: string; translations: string | null }>();
  const map = new Map<string, { id: string; headword: string }[]>();
  const seen = new Set<string>();
  for (const r of rows.results ?? []) {
    let ts: unknown[] = [];
    try { const v = JSON.parse(r.translations ?? "[]"); if (Array.isArray(v)) ts = v; } catch {}
    for (const t of ts) {
      const k = enKey(String(t));
      const dedupe = `${k}${r.headword.toLowerCase()}`;
      if (!k || seen.has(dedupe)) continue;
      seen.add(dedupe);
      const arr = map.get(k) ?? [];
      arr.push({ id: r.id, headword: r.headword });
      map.set(k, arr);
    }
  }
  return map;
}
app.post("/alignments/build", async (c) => {
  const docs = await c.env.DB.prepare(
    "SELECT unique_path FROM documents WHERE category = 'heritage' AND unique_path LIKE '%.jsonl'"
  ).all<{ unique_path: string }>();

  // Collect every english/ga sentence pair in the archive.
  const pairs: Array<{ eng: string; ga: string }> = [];
  for (const row of docs.results ?? []) {
    const obj = await c.env.DOCS_BUCKET.get(row.unique_path);
    if (!obj) continue;
    for (const line of (await obj.text()).split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const rec = JSON.parse(t);
        const eng = String(rec.english ?? "").trim();
        const ga = String(rec.ga ?? "").trim();
        if (eng && ga) pairs.push({ eng, ga });
      } catch { /* skip malformed */ }
    }
  }
  if (!pairs.length) return c.json({ detail: "no heritage pairs found" }, 400);

  // English words already covered by verified vocabulary don't need inferring.
  const covered = new Set<string>();
  const vocabRows = await c.env.DB.prepare(
    "SELECT translations, meanings FROM vocabulary WHERE verified_at IS NOT NULL AND TRIM(verified_at) <> ''"
  ).all<{ translations: string; meanings: string }>();
  for (const r of vocabRows.results ?? []) {
    for (const field of [r.translations, r.meanings]) {
      try {
        for (const t of JSON.parse(field || "[]")) {
          for (const w of alignWords(String(t))) covered.add(w);
        }
      } catch { /* skip */ }
    }
  }

  // Co-occurrence matrix on folded words.
  const cntE = new Map<string, number>();
  const cntG = new Map<string, number>();
  const cooccur = new Map<string, number>(); // "e|g" -> count
  const examples = new Map<string, Array<{ english: string; ga: string }>>();
  // folded -> lowercase surface form, so stored words keep their diacritics
  const dispE = new Map<string, string>();
  const dispG = new Map<string, string>();
  for (const p of pairs) {
    const ew = new Set(alignWords(p.eng));
    const gw = new Set(alignWords(p.ga));
    for (const w of p.eng.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [])
      if (!dispE.has(foldGa(w))) dispE.set(foldGa(w), w);
    for (const w of p.ga.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [])
      if (!dispG.has(foldGa(w))) dispG.set(foldGa(w), w);
    for (const e of ew) cntE.set(e, (cntE.get(e) ?? 0) + 1);
    for (const g of gw) cntG.set(g, (cntG.get(g) ?? 0) + 1);
    for (const e of ew) {
      if (ALIGN_STOP_EN.has(e) || covered.has(e) || e.length < 2 || /^\d+$/.test(e)) continue;
      for (const g of gw) {
        if (ALIGN_STOP_GA.has(g) || g.length < 2) continue;
        const key = `${e}|${g}`;
        cooccur.set(key, (cooccur.get(key) ?? 0) + 1);
        const ex = examples.get(key) ?? [];
        if (ex.length < 3) ex.push({ english: p.eng, ga: p.ga });
        examples.set(key, ex);
      }
    }
  }

  // Dice per pair; keep each English word's top-3 Ga candidates.
  const byEnglish = new Map<string, Array<{ g: string; dice: number; n: number }>>();
  for (const [key, n] of cooccur) {
    const [e, g] = key.split("|");
    const dice = (2 * n) / ((cntE.get(e) ?? 1) + (cntG.get(g) ?? 1));
    if (n < 2 && dice < 0.4) continue; // single weak sighting — noise
    const arr = byEnglish.get(e) ?? [];
    arr.push({ g, dice, n });
    byEnglish.set(e, arr);
  }

  const now = nowIso();
  const rows: Array<[string, string, string, string, string, number, number, string]> = [];
  for (const [e, cands] of byEnglish) {
    cands.sort((a, b) => b.dice - a.dice || b.n - a.n);
    for (const { g, dice, n } of cands.slice(0, 3)) {
      rows.push([`wa:${e}:${g}`, dispE.get(e) ?? e, dispG.get(g) ?? g, e, g, Number(dice.toFixed(3)), n, JSON.stringify(examples.get(`${e}|${g}`) ?? [])]);
    }
  }

  // Upsert in batches; promoted/rejected rows keep their status on rebuild.
  const stmt = c.env.DB.prepare(
    `INSERT INTO word_alignments (id, english_word, ga_word, english_normalized, ga_normalized, confidence, evidence_count, examples, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       confidence = excluded.confidence,
       evidence_count = excluded.evidence_count,
       examples = excluded.examples,
       status = CASE WHEN word_alignments.status IN ('promoted','rejected')
                 THEN word_alignments.status ELSE 'inferred' END`
  );
  for (let i = 0; i < rows.length; i += 50) {
    await c.env.DB.batch(rows.slice(i, i + 50).map((r) => stmt.bind(...r, now)));
  }

  return c.json({ pairs_scanned: pairs.length, alignments: rows.length });
});

// Suggested words: GATITOS (Google, professional translations), PanLex word
// lists, and the older co-occurrence guesses. ?source=gatitos|panlex|corpus
// narrows it, ?q= searches both sides, ?offset pages through.
const NAMED_SOURCE = "(source LIKE 'gatitos%' OR source LIKE 'panlex%')";
app.get("/alignments", async (c) => {
  const status = c.req.query("status") || "inferred";
  const minConf = parseFloat(c.req.query("min_confidence") ?? "0") || 0;
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const source = c.req.query("source") || "";
  const q = (c.req.query("q") || "").trim().toLowerCase();
  const where = ["status = ?", "confidence >= ?"], binds: unknown[] = [status, minConf];
  if (source === "gatitos") where.push("source LIKE 'gatitos%'");
  else if (source === "panlex") where.push("source LIKE 'panlex%'");
  else if (source === "corpus") where.push(`(source IS NULL OR NOT ${NAMED_SOURCE})`);
  if (q) { where.push("(english_normalized LIKE ? OR ga_normalized LIKE ? OR lower(english_word) LIKE ? OR lower(ga_word) LIKE ?)"); binds.push(`%${q}%`, `%${foldGa(q)}%`, `%${q}%`, `%${q}%`); }
  const w = where.join(" AND ");
  const [rows, total, counts] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM word_alignments WHERE ${w}
       ORDER BY (source LIKE 'gatitos%') DESC, evidence_count DESC, confidence DESC, english_word LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM word_alignments WHERE ${w}`).bind(...binds).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT SUM(source LIKE 'gatitos%') AS gatitos, SUM(source LIKE 'panlex%') AS panlex, SUM(source IS NULL OR NOT ${NAMED_SOURCE}) AS corpus FROM word_alignments WHERE status = ?`).bind(status).first<{ gatitos: number; panlex: number; corpus: number }>(),
  ]);
  const vocab = await vocabByEnglish(c.env.DB);
  const alignments = (rows.results ?? []).map((row: any) => ({
    ...row,
    existing: (vocab.get(enKey(String(row.english_word).split(";")[0])) ?? []).filter(
      (x) => foldGa(x.headword.toLowerCase()) !== row.ga_normalized
    ),
  }));
  return c.json({ alignments, total: total?.n ?? 0, counts: { gatitos: counts?.gatitos ?? 0, panlex: counts?.panlex ?? 0, corpus: counts?.corpus ?? 0 } });
});

// The statements that approve one suggestion into the checked dictionary. The
// reviewer may correct the Ga spelling, or the English, before approving.
function promoteStatements(
  db: D1Database, adminId: string, row: any,
  byEnglish: Map<string, { id: string; headword: string }[]>,
  edits: { ga?: string; english?: string }
) {
  const ga = normalizeGaCase((edits.ga ?? "").trim() || row.ga_word);
  const english = (edits.english ?? "").trim() || row.english_word;
  const fromGatitos = String(row.source || "").startsWith("gatitos");
  const fromPanlex = String(row.source || "").startsWith("panlex");
  // "collect; gather" — several senses become separate English entries.
  const senses = english.split(/\s*;\s*/).filter(Boolean);

  const existing = (byEnglish.get(enKey(senses[0] ?? english)) ?? []).filter(
    (x) => foldGa(x.headword.toLowerCase()) !== foldGa(ga.toLowerCase())
  );
  const variation = existing.length
    ? `; another way to say it alongside ${existing.map((x) => x.headword).join(", ")}`
    : "";

  const now = nowIso();
  const vid = `vocab:align:${english}:${ga}`;
  const stmts = [
    db.prepare(
      `INSERT OR REPLACE INTO vocabulary
         (id, headword, headword_normalized, part_of_speech, meanings, translations,
          examples, variants, phonetic, category, source, verified_by, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, 'phrase', ?, ?, ?)`
    ).bind(
      vid,
      ga,
      foldGa(ga.toLowerCase()),
      null,
      JSON.stringify(senses),
      JSON.stringify(senses),
      fromGatitos || fromPanlex ? "[]" : row.examples,
      fromGatitos || fromPanlex
        ? `${fromGatitos ? "Google GATITOS (SMOL), CC-BY 4.0" : "PanLex (CC0), via ChiKhaPo"} — reviewer-approved${ga !== row.ga_word || english !== row.english_word ? `, corrected from “${row.english_word}” → ${row.ga_word}` : ""}${variation}`
        : `corpus-alignment (inferred, confidence ${row.confidence}, n=${row.evidence_count}; reviewer-approved${ga !== row.ga_word ? `, corrected from ${row.ga_word}` : ""})${variation}`,
      adminId,
      now
    ),
    db.prepare(
      "UPDATE word_alignments SET status = 'promoted', ga_word = ?, english_word = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
    ).bind(ga, english, adminId, now, row.id),
  ];
  return { stmts, vid };
}

const writeLimitHit = (e: unknown) => /row write limit|exceeded D1/i.test(String(e));

app.post("/alignments/:id/promote", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM word_alignments WHERE id = ?").bind(id).first<any>();
  if (!row) return c.json({ detail: "Alignment not found" }, 404);
  if (row.status === "promoted") return c.json({ detail: "Already promoted" }, 409);

  const body = await c.req.json<{ ga?: string; english?: string }>().catch(() => ({} as { ga?: string; english?: string }));
  const { stmts, vid } = promoteStatements(c.env.DB, adminId, row, await vocabByEnglish(c.env.DB), body);
  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    if (writeLimitHit(e)) return c.json({ detail: "D1 daily write limit reached — resets at midnight UTC." }, 503);
    throw e;
  }
  return c.json({ status: "success", vocabulary_id: vid });
});

// Approve or reject many suggestions at once (up to 100 per call; the console
// works through "all matching" in chunks). Each item may carry corrections.
app.post("/alignments/bulk", async (c) => {
  const adminId = c.get("adminId")!;
  const body = await c.req.json<{ action?: string; items?: { id: string; ga?: string; english?: string }[] }>()
    .catch(() => ({} as { action?: string; items?: { id: string; ga?: string; english?: string }[] }));
  const action = body.action;
  const items = (body.items ?? []).filter((x) => x && typeof x.id === "string").slice(0, 100);
  if (action !== "approve" && action !== "reject") return c.json({ detail: "action must be approve or reject" }, 400);
  if (!items.length) return c.json({ done: 0, skipped: 0 });

  const ids = items.map((x) => x.id);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM word_alignments WHERE status = 'inferred' AND id IN (${ids.map(() => "?").join(",")})`
  ).bind(...ids).all<any>();
  const found = new Map((rows.results ?? []).map((r) => [r.id, r]));
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  if (action === "reject") {
    for (const id of found.keys())
      stmts.push(c.env.DB.prepare("UPDATE word_alignments SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(adminId, now, id));
  } else {
    const byEnglish = await vocabByEnglish(c.env.DB);
    for (const it of items) {
      const row = found.get(it.id);
      if (row) stmts.push(...promoteStatements(c.env.DB, adminId, row, byEnglish, it).stmts);
    }
  }
  try {
    if (stmts.length) await c.env.DB.batch(stmts);
  } catch (e) {
    if (writeLimitHit(e)) return c.json({ detail: "D1 daily write limit reached — resets at midnight UTC." }, 503);
    throw e;
  }
  return c.json({ done: found.size, skipped: items.length - found.size });
});

app.post("/alignments/:id/reject", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "UPDATE word_alignments SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?"
  ).bind(adminId, nowIso(), id).run();
  if (!res.meta.changes) return c.json({ detail: "Alignment not found" }, 404);
  return c.json({ status: "success", message: "Alignment rejected." });
});

export default app;
