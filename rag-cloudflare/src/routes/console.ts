/**
 * Admin console data (mounted at /api/v1/admin/console):
 *
 *   GET  /overview              figures for the Overview page
 *   GET  /gaps                  unanswered questions, grouped and ranked
 *   POST /gaps/:id/answer       answer one: add it verified, or send it to review
 *   POST /gaps/:id/recheck      ask the question again with today's archive
 *   POST /gaps/:id/dismiss      not worth answering (spam, tests, off-topic)
 *   GET  /flagged               answers people marked wrong or unhelpful
 *   POST /flagged/:id/handled   mark a thumbs-down as dealt with
 *   GET  /activity              what admins did, newest first
 *
 * Answers go through the same approve path as a contribution, so vocabulary,
 * search index and gap resolution stay in one place (routes/admin.ts).
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../auth/middleware";
import { ask } from "../rag/service";
import { isNotFoundResponse } from "../rag/flagging";
import admin from "./admin";
import { archiveStats } from "../rag/archive-stats";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", requireAdmin);

const now = () => new Date().toISOString();

async function logAction(env: Env, adminId: string, action: string, kind: string, ref: string, detail: string) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_actions (at, admin_id, action, ref_kind, ref_id, detail) VALUES (?,?,?,?,?,?)"
    ).bind(now(), adminId, action, kind, ref, detail.slice(0, 300)).run();
  } catch (e) {
    console.warn("admin_actions insert failed (non-critical):", e);
  }
}

/** "how do you say computer in ga?" -> "computer". Used to look the subject up. */
export function subjectOf(query: string): string {
  return query
    .toLowerCase()
    .replace(/[?!.]+$/g, "")
    .replace(/^(please\s+)?(how\s+(do|would|can)\s+(you|i|we)\s+say|what('?s| is| are)( the)?( word for)?|translate|meaning of|what does( the)?)\s+/, "")
    .replace(/\s+(mean|means)$/, "")
    .replace(/\s+(in|into|to)\s+(the\s+)?ga(\s+language)?$/, "")
    .replace(/\s+symbol$/, "")
    .replace(/^(a|an|the)\s+/, "")
    .trim();
}

/** A verified word whose English matches the question's subject, if the archive has one. */
async function archiveHint(env: Env, query: string) {
  const s = subjectOf(query);
  if (!s || s.length > 40) return null;
  return env.DB.prepare(
    `SELECT id, headword, meanings FROM vocabulary
     WHERE verified_at IS NOT NULL AND TRIM(verified_at) <> ''
       AND (LOWER(translations) LIKE ? OR LOWER(meanings) LIKE ? OR LOWER(headword) = ?)
     ORDER BY LENGTH(headword) LIMIT 1`
  ).bind(`%"${s}"%`, `%"${s}%`, s).first<{ id: string; headword: string; meanings: string }>().catch(() => null);
}

const GAP_TYPES: Record<string, string> = {
  words: "query_type NOT LIKE 'bible%' AND query_type != 'flagged_wrong'",
  bible: "query_type LIKE 'bible%'",
  flagged: "query_type = 'flagged_wrong'",
};

/**
 * Uploads index in the background after the response. A big file can outlive that
 * window, leaving its record at "uploading"/"indexing" forever with no category.
 * Anything stuck for 30 minutes is settled: Bible files whose verses were saved are
 * marked indexed (search vectors pending); the rest are marked as failed. Nothing is
 * deleted here; failed uploads are cleared by an admin (POST /documents/clear-failed).
 */
const NO_VERSES = "NOT EXISTS (SELECT 1 FROM bible_verses v WHERE v.source_name = documents.unique_path)";
export async function settleStuckUploads(env: Env) {
  const cutoff = new Date(Date.now() - 30 * 60000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE documents SET category = 'bible', status = 'indexed',
         metadata = json_set(COALESCE(metadata, '{}'),
           '$.record_count', (SELECT COUNT(*) FROM bible_verses v WHERE v.source_name = documents.unique_path),
           '$.vector_pending', json('true'), '$.repaired', 'Verses were saved, but indexing stopped before it finished')
       WHERE status IN ('uploading', 'indexing', 'error') AND category IS NULL AND created_at < ? AND NOT ${NO_VERSES}`
    ).bind(cutoff),
    env.DB.prepare(
      `UPDATE documents SET status = 'error',
         metadata = json_set(COALESCE(metadata, '{}'), '$.error', 'Indexing stopped before it finished, and nothing was saved. Upload the file again.')
       WHERE status IN ('uploading', 'indexing') AND created_at < ? AND ${NO_VERSES}`
    ).bind(cutoff),
  ]).catch((e) => console.warn("settleStuckUploads failed (non-critical):", e));
}

const FAILED = `status = 'error' AND category IS NULL AND ${NO_VERSES}`;

app.post("/documents/clear-failed", async (c) => {
  const adminId = c.get("adminId")!;
  await settleStuckUploads(c.env);
  // Only the record goes: the uploaded file stays in storage, and the backup of what
  // was removed is in the activity log detail.
  const rows = await c.env.DB.prepare(`SELECT original_filename FROM documents WHERE ${FAILED}`).all<{ original_filename: string }>();
  const names = (rows.results || []).map((r) => r.original_filename);
  if (!names.length) return c.json({ status: "ok", removed: 0 });
  const r = await c.env.DB.prepare(`DELETE FROM documents WHERE ${FAILED}`).run();
  await logAction(c.env, adminId, "clear_failed_uploads", "document", "bulk", `Removed ${r.meta.changes} failed upload records: ${names.slice(0, 12).join(", ")}${names.length > 12 ? "…" : ""}`);
  return c.json({ status: "ok", removed: r.meta.changes });
});

/**
 * Files marked "search index pending": their records are saved, but some search
 * vectors may be missing. A Bible file is complete when its first and last verse are
 * in the index (vectors go in verse order); those are cleared here without
 * re-embedding. The rest are listed for the console to re-index (POST /admin/reindex,
 * paged), then marked done with POST /documents/:id/search-index-done.
 */
/** First and last search-entry ids a file should have. Bible files: their verses' ids
 *  (from the verse table, else from the stored file). Other datasets: <path>:rec:<n>. */
async function endIds(env: Env, path: string): Promise<{ ids: string[]; records: number | null }> {
  const ends = await env.DB.prepare(
    `SELECT (SELECT id FROM bible_verses WHERE source_name = ?1 ORDER BY chapter_num, verse_num LIMIT 1) a,
            (SELECT id FROM bible_verses WHERE source_name = ?1 ORDER BY chapter_num DESC, verse_num DESC LIMIT 1) b,
            (SELECT COUNT(*) FROM bible_verses WHERE source_name = ?1) n`
  ).bind(path).first<{ a: string | null; b: string | null; n: number }>();
  if (ends?.a && ends?.b) return { ids: [ends.a, ends.b], records: ends.n };
  // No verses point at this file (e.g. a re-upload of verses another file already
  // saved): read the file itself.
  if (!/\.jsonl$/i.test(path)) return { ids: [], records: null };
  const obj = await env.DOCS_BUCKET.get(path);
  if (!obj) return { ids: [], records: null };
  const lines = (await obj.text()).split("\n").filter((l) => l.trim());
  const parse = (l: string | undefined) => { try { return l ? JSON.parse(l) : null; } catch { return null; } };
  const first = parse(lines[0]), last = parse(lines[lines.length - 1]);
  const idOf = (r: any, i: number) =>
    r?.id ?? (r?.book && r?.chapter_num && r?.verse_num ? `bible:${String(r.book).toLowerCase()}:${r.chapter_num}:${r.verse_num}` : `${path}:rec:${i}`);
  return { ids: lines.length ? [idOf(first, 0), idOf(last, lines.length - 1)] : [], records: lines.length };
}

app.get("/documents/search-index", async (c) => {
  // Checks a batch at a time (?limit, default 40). Complete files are cleared; incomplete
  // ones are marked so the next batch moves on, and every incomplete file is returned.
  const adminId = c.get("adminId")!;
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "40", 10) || 40, 1), 100);
  const PENDING = `json_extract(metadata, '$.vector_pending') = 1 AND status = 'indexed'`;
  const docs = await c.env.DB.prepare(
    `SELECT id, original_filename, unique_path FROM documents
     WHERE ${PENDING} AND COALESCE(json_extract(metadata, '$.vector_check'), '') <> 'incomplete' LIMIT ?`
  ).bind(limit).all<{ id: string; original_filename: string; unique_path: string }>();
  let cleared = 0;
  for (const d of docs.results || []) {
    const { ids, records } = await endIds(c.env, d.unique_path);
    const found = ids.length ? await c.env.VECTORIZE.getByIds(ids).catch(() => []) : [];
    if (ids.length === 2 && found.length === 2) {
      await c.env.DB.prepare("UPDATE documents SET metadata = json_remove(metadata, '$.vector_pending', '$.vector_check') WHERE id = ?").bind(d.id).run();
      cleared++;
    } else {
      await c.env.DB.prepare("UPDATE documents SET metadata = json_set(metadata, '$.vector_check', 'incomplete', '$.record_count', ?) WHERE id = ?")
        .bind(records, d.id).run();
    }
  }
  if (cleared) await logAction(c.env, adminId, "search_index_checked", "document", "bulk", `${cleared} files were already complete in the search index`);
  const [left, incomplete] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) n FROM documents WHERE ${PENDING} AND COALESCE(json_extract(metadata, '$.vector_check'), '') <> 'incomplete'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT id, original_filename name, unique_path path, json_extract(metadata, '$.record_count') records FROM documents WHERE ${PENDING} AND json_extract(metadata, '$.vector_check') = 'incomplete'`)
      .all<{ id: string; name: string; path: string; records: number | null }>(),
  ]);
  return c.json({ cleared, checked: (docs.results || []).length, remaining: left?.n ?? 0, pending: incomplete.results || [] });
});

app.post("/documents/:id/search-index-done", async (c) => {
  const adminId = c.get("adminId")!;
  const d = await c.env.DB.prepare("SELECT original_filename FROM documents WHERE id = ?").bind(c.req.param("id")).first<{ original_filename: string }>();
  if (!d) return c.json({ detail: "Document not found" }, 404);
  await c.env.DB.prepare("UPDATE documents SET metadata = json_remove(metadata, '$.vector_pending', '$.vector_check') WHERE id = ?").bind(c.req.param("id")).run();
  await logAction(c.env, adminId, "search_index_finished", "document", c.req.param("id"), d.original_filename);
  return c.json({ status: "ok" });
});

app.get("/overview", async (c) => {
  const db = c.env.DB;
  await settleStuckUploads(c.env);
  const one = <T>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).first<T>().catch(() => null);
  const all = <T>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).all<T>().then((r) => r.results || []).catch(() => [] as T[]);
  const since14 = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const [q, daily, gaps, flagged, contrib, vocab, bible, docs, users, sessions, feedback, samaiDocs, archive, failed, searchPending] = await Promise.all([
    one<{ total: number; week: number }>(`SELECT COUNT(*) total, SUM(date(created_at) >= ?) week FROM interactions`, since7),
    all<{ day: string; n: number }>(`SELECT date(created_at) day, COUNT(*) n FROM interactions WHERE date(created_at) >= ? GROUP BY 1 ORDER BY 1`, since14),
    one<{ open: number; asks: number; total: number }>(`SELECT SUM(status='pending') open, SUM(CASE WHEN status='pending' THEN frequency ELSE 0 END) asks, COUNT(*) total FROM knowledge_gaps`),
    one<{ n: number }>(`SELECT COUNT(*) n FROM response_feedback f WHERE f.rating = 'not_helpful'
      AND NOT EXISTS (SELECT 1 FROM admin_actions a WHERE a.ref_kind='feedback' AND a.ref_id=f.id)`),
    one<{ pending: number; total: number; approved: number }>(`SELECT SUM(status='pending_review') pending, COUNT(*) total, SUM(status='approved') approved FROM user_contributions`),
    one<{ verified: number; total: number }>(`SELECT SUM(verified_at IS NOT NULL AND TRIM(verified_at) <> '') verified, COUNT(*) total FROM vocabulary`),
    all<{ source: string; n: number }>(`SELECT COALESCE(ga_version_abbr,'other') source, COUNT(*) n FROM bible_verses GROUP BY 1 ORDER BY n DESC`),
    all<{ category: string; n: number }>(`SELECT COALESCE(category,'none') category, COUNT(*) n FROM documents GROUP BY 1 ORDER BY n DESC`),
    one<{ total: number; admins: number }>(`SELECT COUNT(*) total, SUM(role='admin') admins FROM users`),
    one<{ n: number; people: number }>(`SELECT COUNT(*) n, COUNT(DISTINCT user_id) people FROM chat_sessions`),
    one<{ total: number; down: number }>(`SELECT COUNT(*) total, SUM(rating='not_helpful') down FROM response_feedback`),
    all<{ original_filename: string }>(`SELECT DISTINCT original_filename FROM documents WHERE original_filename LIKE 'ga-samai%'`),
    archiveStats(c.env).catch(() => null),
    one<{ n: number }>(`SELECT COUNT(*) n FROM documents WHERE ${FAILED}`),
    one<{ n: number }>(`SELECT COUNT(*) n FROM documents WHERE json_extract(metadata, '$.vector_pending') = 1 AND status = 'indexed'`),
  ]);

  // Distinct symbols each samai dataset adds (datasets/ga-samai*.jsonl; the
  // Okaikoi file repeats 6 of the first 8 and adds 8 more).
  const SAMAI_DATASETS: Record<string, number> = { "ga-samai.jsonl": 8, "ga-samai-okaikoi.jsonl": 8, "ga-samai-okaikoi-review.jsonl": 4 };
  const imported = new Set(samaiDocs.map((d) => d.original_filename));
  const samaiLive = [...imported].reduce((n, f) => n + (SAMAI_DATASETS[f] ?? 0), 0);
  const samaiReady = Object.entries(SAMAI_DATASETS).filter(([f]) => f !== "ga-samai-okaikoi-review.jsonl" && !imported.has(f)).reduce((n, [, v]) => n + v, 0);

  return c.json({
    questions: { total: q?.total ?? 0, week: q?.week ?? 0, daily, since: since14 },
    gaps: { open: gaps?.open ?? 0, asks: gaps?.asks ?? 0, total: gaps?.total ?? 0 },
    flagged_open: (flagged?.n ?? 0),
    contributions: { pending: contrib?.pending ?? 0, total: contrib?.total ?? 0, approved: contrib?.approved ?? 0 },
    vocabulary: { verified: vocab?.verified ?? 0, total: vocab?.total ?? 0 },
    bible,
    documents: docs,
    samai: { live: samaiLive, ready: samaiReady, review: imported.has("ga-samai-okaikoi-review.jsonl") ? 0 : 4 },
    users: { total: users?.total ?? 0, admins: users?.admins ?? 0 },
    conversations: { total: sessions?.n ?? 0, people: sessions?.people ?? 0 },
    feedback: { total: feedback?.total ?? 0, down: feedback?.down ?? 0 },
    speech_hours: 0,
    archive,
    failed_uploads: failed?.n ?? 0,
    search_index_pending: searchPending?.n ?? 0,
  });
});

app.get("/gaps", async (c) => {
  const status = ["pending", "dismissed", "resolved", "user_contributed"].includes(c.req.query("status") || "") ? c.req.query("status")! : "pending";
  const type = GAP_TYPES[c.req.query("type") || ""] || "1=1";
  const order = c.req.query("sort") === "newest" ? "COALESCE(last_seen, timestamp) DESC" : "frequency DESC, COALESCE(last_seen, timestamp) DESC";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, query, query_type, context, frequency, timestamp, last_seen, user_submitted_answer
       FROM knowledge_gaps WHERE status = ? AND ${type} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).bind(status, limit, offset).all<Record<string, any>>(),
    c.env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(frequency),0) asks FROM knowledge_gaps WHERE status = ? AND ${type}`).bind(status).first<{ n: number; asks: number }>(),
  ]);

  const gaps = await Promise.all((rows.results || []).map(async (g) => {
    const hint = status === "pending" ? await archiveHint(c.env, g.query) : null;
    let meaning = "";
    try { meaning = hint ? (JSON.parse(hint.meanings || "[]")[0] || "") : ""; } catch {}
    const shown = /Answer shown:\s*(.+)$/.exec(g.context || "")?.[1] || null;
    return {
      id: g.id,
      query: g.query,
      subject: subjectOf(g.query),
      kind: g.query_type === "flagged_wrong" ? "flagged" : String(g.query_type).startsWith("bible") ? "bible" : "word",
      reason: g.context,
      answer_shown: shown,
      asked: g.frequency,
      first_asked: g.timestamp,
      last_asked: g.last_seen || g.timestamp,
      answer: g.user_submitted_answer,
      archive_has: hint ? { id: hint.id, ga: hint.headword, meaning } : null,
    };
  }));
  return c.json({ gaps, total: total?.n ?? 0, asks: total?.asks ?? 0 });
});

app.post("/gaps/:id/answer", async (c) => {
  const adminId = c.get("adminId")!;
  const gap = await c.env.DB.prepare("SELECT id, query FROM knowledge_gaps WHERE id = ?").bind(c.req.param("id")).first<{ id: string; query: string }>();
  if (!gap) return c.json({ detail: "Question not found" }, 404);
  const body = await c.req.json<{ english?: string; ga?: string; category?: string; source?: string; then?: string }>().catch(() => ({} as any));
  const english = String(body.english || "").trim();
  const ga = String(body.ga || "").trim();
  if (!english || !ga) return c.json({ detail: "Both the English and the Ga are needed." }, 400);
  const verified = body.then !== "review";

  // The answer becomes a contribution by this admin, then (if verified) is
  // approved through the normal path, which writes vocabulary and the index.
  const contribId = crypto.randomUUID();
  const meta = { type: "translation", source: "admin_inbox", gap_id: gap.id, source_note: String(body.source || "").slice(0, 120) };
  await c.env.DB.prepare(
    `INSERT INTO user_contributions (id, original_query, user_answer, category, timestamp, status, confidence_score, agreement_score, contribution_count, ai_issues, contributor_id)
     VALUES (?, ?, ?, ?, ?, 'pending_review', 1, 0, 1, ?, ?)`
  ).bind(contribId, english, ga, (body.category || "general").slice(0, 40), now(), JSON.stringify(meta), adminId).run();

  if (verified) {
    const req = new Request(new URL(`/contributions/${contribId}/approve`, c.req.url), {
      method: "POST",
      headers: { Cookie: c.req.header("Cookie") || "", Authorization: c.req.header("Authorization") || "" },
    });
    const res = await admin.fetch(req, c.env, c.executionCtx);
    if (!res.ok) {
      const d = await res.json<{ detail?: string }>().catch(() => ({} as { detail?: string }));
      return c.json({ detail: d.detail || "Saving the answer failed." }, res.status as 400);
    }
  }
  await c.env.DB.prepare("UPDATE knowledge_gaps SET status = ?, user_submitted_answer = ? WHERE id = ?")
    .bind(verified ? "resolved" : "user_contributed", ga, gap.id).run();
  await logAction(c.env, adminId, verified ? "answer" : "send_to_review", "gap", gap.id, `“${gap.query}” → ${ga} (${english})`);
  return c.json({ status: "ok", verified, contribution_id: contribId });
});

app.post("/gaps/:id/recheck", async (c) => {
  const adminId = c.get("adminId")!;
  const gap = await c.env.DB.prepare("SELECT id, query, frequency, last_seen FROM knowledge_gaps WHERE id = ?")
    .bind(c.req.param("id")).first<{ id: string; query: string; frequency: number; last_seen: string | null }>();
  if (!gap) return c.json({ detail: "Question not found" }, 404);

  // Ask as a guest so nothing is saved. A miss logs the gap again, so the
  // count is put back afterwards: checking must not look like another ask.
  let text = "";
  try {
    for await (const t of ask(c.env, { query: gap.query, conversationId: null, userId: "guest_admin-recheck", stream: false, mode: "agent" })) text += t;
  } catch (e) {
    return c.json({ detail: `Couldn't run the question: ${String(e).slice(0, 120)}` }, 502);
  }
  text = text.replace(/\n__META__:\{[^\n]*\}\n?/g, "").trim();
  await c.env.DB.prepare("UPDATE knowledge_gaps SET frequency = ?, last_seen = ? WHERE id = ?").bind(gap.frequency, gap.last_seen, gap.id).run();

  const answered = !!text && !isNotFoundResponse(text);
  return c.json({ answered, response: text.slice(0, 1200) });
});

app.post("/gaps/:id/resolve", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const body = await c.req.json<{ note?: string }>().catch(() => ({} as { note?: string }));
  const r = await c.env.DB.prepare("UPDATE knowledge_gaps SET status = 'resolved' WHERE id = ?").bind(id).run();
  if (!r.meta.changes) return c.json({ detail: "Question not found" }, 404);
  await logAction(c.env, adminId, "recheck_resolved", "gap", id, body.note || "Answered correctly when checked again");
  return c.json({ status: "ok" });
});

app.post("/gaps/:id/dismiss", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const g = await c.env.DB.prepare("SELECT query FROM knowledge_gaps WHERE id = ?").bind(id).first<{ query: string }>();
  if (!g) return c.json({ detail: "Question not found" }, 404);
  await c.env.DB.prepare("UPDATE knowledge_gaps SET status = 'dismissed' WHERE id = ?").bind(id).run();
  await logAction(c.env, adminId, "dismiss", "gap", id, `“${g.query}”`);
  return c.json({ status: "ok" });
});

app.post("/gaps/:id/reopen", async (c) => {
  const adminId = c.get("adminId")!;
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("UPDATE knowledge_gaps SET status = 'pending' WHERE id = ?").bind(id).run();
  if (!r.meta.changes) return c.json({ detail: "Question not found" }, 404);
  await logAction(c.env, adminId, "reopen", "gap", id, "Put back in the inbox");
  return c.json({ status: "ok" });
});

app.get("/flagged", async (c) => {
  const handled = c.req.query("status") === "handled";
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.rating, f.comment, f.created_at, i.query, i.response, i.is_guest
     FROM response_feedback f LEFT JOIN interactions i ON i.id = f.interaction_id
     WHERE f.rating = 'not_helpful'
       AND ${handled ? "" : "NOT"} EXISTS (SELECT 1 FROM admin_actions a WHERE a.ref_kind='feedback' AND a.ref_id=f.id)
     ORDER BY f.created_at DESC LIMIT 100`
  ).all<Record<string, any>>();
  const items = await Promise.all((rows.results || []).map(async (r) => {
    const hint = r.query ? await archiveHint(c.env, r.query) : null;
    let meaning = "";
    try { meaning = hint ? (JSON.parse(hint.meanings || "[]")[0] || "") : ""; } catch {}
    return {
      id: r.id,
      query: r.query || "(conversation no longer stored)",
      response: String(r.response || "").replace(/\n__META__:\{[^\n]*\}\n?/g, "").slice(0, 900),
      comment: r.comment,
      created_at: r.created_at,
      archive_has: hint ? { id: hint.id, ga: hint.headword, meaning } : null,
    };
  }));
  return c.json({ items });
});

app.post("/flagged/:id/handled", async (c) => {
  const adminId = c.get("adminId")!;
  const body = await c.req.json<{ outcome?: string }>().catch(() => ({} as { outcome?: string }));
  const id = c.req.param("id");
  const f = await c.env.DB.prepare("SELECT id FROM response_feedback WHERE id = ?").bind(id).first();
  if (!f) return c.json({ detail: "Rating not found" }, 404);
  await logAction(c.env, adminId, "feedback_handled", "feedback", id, (body.outcome || "Handled").slice(0, 200));
  return c.json({ status: "ok" });
});

app.get("/activity", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.at, a.action, a.ref_kind, a.detail, COALESCE(u.first_name, u.display_name, u.email) who
     FROM admin_actions a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.at DESC LIMIT 50`
  ).all().catch(() => ({ results: [] }));
  return c.json({ items: rows.results || [] });
});

export default app;
