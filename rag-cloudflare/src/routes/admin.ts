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
import { getAllUsers, countUsers, updateUserRole } from "../db/users";
import { countSessions } from "../db/sessions";
import { indexFromBytes, indexRefinedRecords, indexHeritageRecords, extractRawText } from "../rag/indexer";
import { getRefinementPreview } from "../rag/refiner";
import { ocrImage, textToPairs, parsePairs, tryParseStructuredPairs } from "../rag/vision";
import { embed } from "../rag/embeddings";
import { foldGa } from "../db/vocabulary";
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
app.get("/users", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const [users, total] = await Promise.all([getAllUsers(c.env, limit, offset), countUsers(c.env)]);
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
  const ga = row.user_answer.trim();

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

  // Record which vocab row this contribution created so rejection can delete
  // exactly that row — never by shared headword.
  meta.vocab_id = vocabId;
  const metaUpdate = c.env.DB.prepare(
    "UPDATE user_contributions SET ai_issues = ? WHERE id = ?"
  ).bind(JSON.stringify(meta), id);

  try {
    await c.env.DB.batch([statusUpdate, vocabInsert, metaUpdate]);
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

export default app;
