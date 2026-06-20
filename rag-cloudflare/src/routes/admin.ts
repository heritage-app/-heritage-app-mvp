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
import { indexFromBytes, indexRefinedRecords, extractRawText } from "../rag/indexer";
import { getRefinementPreview } from "../rag/refiner";
import { slugifyFilename, timestampSlug, humanFileSize, humanizeTimestamp, nowIso } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", requireAdmin);

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

  // Background indexing — continues after the response is sent.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await updateDocument(c.env, docId, { status: "indexing" });
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

export default app;
