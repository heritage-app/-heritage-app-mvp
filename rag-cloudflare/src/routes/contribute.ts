/**
 * Structured user contribution endpoint.
 *
 * Accepts clean structured data (type, english, ga, category, source, notes)
 * rather than relying on LLM parsing of free-text corrections. This gives
 * higher-quality data and supports contribution types beyond corrections:
 *  - translation: English ↔ Ga word/phrase pair
 *  - bible_verse: a full verse record (book/chapter/verse + ga + en)
 *  - correction: fixes an existing KB entry (linked to interaction_id)
 *  - cultural_note: heritage context, stories, customs
 *
 * All contributions land in `user_contributions` with `pending_review` status.
 * Non-conflicting contributions from 2+ independent users auto-verify.
 */
import type { Env } from "../types";
import { handleUserContribution } from "../rag/learning-from-gaps";
import { resolveUserId } from "../auth/jwt";
import {
  storeAttachments,
  discardAttachments,
  AttachmentError,
  MAX_FILES,
  type Attachment,
} from "./attachments";

export interface ContributeRequest {
  type: "translation" | "bible_verse" | "correction" | "cultural_note" | "document";
  /** Required for every type except `document`. */
  english: string;
  ga: string;
  /** `document` only — what the uploaded source contains. */
  description?: string;
  category?: "bible" | "heritage" | "stories" | "general";
  source?: "user" | "expert" | "book" | "oral_tradition";
  notes?: string;
  interaction_id?: string;
  /** Required for guest (unauthenticated) contributors — provenance/credit. */
  contributor_name?: string;
  contributor_email?: string;
  contributor_location?: string;
  /** For bible_verse type only */
  book?: string;
  chapter?: number;
  verse?: number;
}

/**
 * Read the contribution from either a JSON body or a multipart form.
 * Multipart is what the browser sends once evidence files are attached; the
 * scalar fields carry the same names either way.
 */
async function readBody(
  request: Request
): Promise<{ body: ContributeRequest; files: File[] } | null> {
  const ct = request.headers.get("Content-Type") || "";

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    const num = (k: string) => {
      const v = str(k);
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    // @cloudflare/workers-types narrows getAll() to string[], but a multipart
    // part with a filename really does arrive as a File at runtime.
    const parts = form.getAll("files") as unknown as Array<string | File>;
    const files = parts.filter(
      (f): f is File => typeof f !== "string" && !!f && typeof (f as File).arrayBuffer === "function" && (f as File).size > 0
    );

    return {
      body: {
        type: (str("type") || "translation") as ContributeRequest["type"],
        english: str("english") || "",
        ga: str("ga") || "",
        category: str("category") as ContributeRequest["category"],
        source: str("source") as ContributeRequest["source"],
        description: str("description"),
        notes: str("notes"),
        interaction_id: str("interaction_id"),
        contributor_name: str("contributor_name"),
        contributor_email: str("contributor_email"),
        contributor_location: str("contributor_location"),
        book: str("book"),
        chapter: num("chapter"),
        verse: num("verse"),
      },
      files,
    };
  }

  try {
    return { body: await request.json<ContributeRequest>(), files: [] };
  } catch {
    return null;
  }
}

export async function handleContribute(request: Request, env: Env): Promise<Response> {
  const parsed = await readBody(request).catch(() => null);
  if (!parsed) return json({ error: "Invalid request body" }, 400);
  const { body, files } = parsed;

  const { type, english, ga } = body;

  const validTypes = ["translation", "bible_verse", "correction", "cultural_note", "document"];
  if (!type || !validTypes.includes(type)) {
    return json({ error: `type must be one of: ${validTypes.join(", ")}` }, 400);
  }

  // A `document` submission is a SOURCE, not a word pair: the contributor hands
  // over a scan or a file and describes it, and a reviewer transcribes it later.
  // It therefore carries no english/ga, and must never reach the vocabulary
  // insert on approval (see admin.ts).
  const isDocument = type === "document";
  if (isDocument) {
    if (!files.length) {
      return json({ error: "A document contribution needs at least one file." }, 400);
    }
    if (!body.description?.trim()) {
      return json({ error: "Describe what the document contains." }, 400);
    }
  } else {
    if (!english?.trim() || !ga?.trim()) {
      return json({
        error: "Missing required fields: type, english, ga",
        received: { type, english: !!english, ga: !!ga },
      }, 400);
    }
    if (type === "bible_verse" && (!body.book || !body.chapter || !body.verse)) {
      return json({ error: "bible_verse requires book, chapter, verse" }, 400);
    }
  }

  const category = body.category || (type === "bible_verse" ? "bible" : "general");
  const userId = await resolveUserId(request, env);

  // Guests must identify themselves (name + email + location) so reviewers can
  // verify and credit the source. Signed-in users skip this — their account
  // already carries that identity via contributor_id.
  const isGuest = userId === "anonymous" || userId.startsWith("guest_");
  if (isGuest) {
    const name = body.contributor_name?.trim();
    const email = body.contributor_email?.trim();
    const location = body.contributor_location?.trim();
    if (!name || !email || !location) {
      return json({
        error: "Guest contributions require contributor_name, contributor_email and contributor_location — sign in to skip this.",
      }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "contributor_email is not a valid email address" }, 400);
    }
  }

  // Evidence files are for signed-in accounts only. Guests can still contribute
  // text; letting anonymous callers push binaries into R2 is a different risk.
  if (files.length && isGuest) {
    return json({
      error: "Sign in to attach files. Your written contribution can be submitted without them.",
    }, 401);
  }
  if (files.length > MAX_FILES) {
    return json({ error: `At most ${MAX_FILES} files per contribution.` }, 400);
  }

  // Upload BEFORE the D1 write so the attachment list can ride along in the
  // same INSERT — the contribution stays a single statement. Orphaned objects
  // are cleaned up below if that write then fails.
  const batchId = crypto.randomUUID();
  let attachments: Attachment[] = [];
  if (files.length) {
    try {
      attachments = await storeAttachments(env, batchId, files);
    } catch (e) {
      // storeAttachments validates the whole set before writing and rolls back
      // its own partial writes, so nothing is left behind here.
      if (e instanceof AttachmentError) return json({ error: e.message }, 400);
      console.error("Attachment upload failed:", e);
      return json({ error: "Could not store your files — try again." }, 502);
    }
  }

  // Build the canonical query/answer pair. For corrections, `english` is the
  // existing KB term and `ga` is the user's corrected Ga. For translations,
  // they're a new pair. For bible_verse, we store the structured ref too.
  const queryText = isDocument
    ? body.description!.trim()
    : type === "bible_verse"
      ? `${body.book} ${body.chapter}:${body.verse}`
      : english.trim();
  // A document has no Ga answer. The filenames stand in so the review queue
  // reads sensibly and two unrelated submissions never look like agreement.
  const answerText = isDocument
    ? attachments.map((a) => a.name).join(", ")
    : ga.trim();

  // Store as a user_contribution with enriched metadata.
  const metadata = JSON.stringify({
    type,
    source: body.source || "user",
    notes: body.notes || null,
    interaction_id: body.interaction_id || null,
    book: body.book || null,
    chapter: body.chapter || null,
    verse: body.verse || null,
    // For bible_verse, `english` is the English verse text — original_query
    // holds the reference ("John 3:16"), so keep the text here for approval.
    english_text: (english || "").trim(),
    description: isDocument ? body.description!.trim() : null,
    contributor_id: userId,
    contributor_name: isGuest ? body.contributor_name!.trim() : null,
    contributor_email: isGuest ? body.contributor_email!.trim() : null,
    contributor_location: isGuest ? body.contributor_location!.trim() : (body.contributor_location?.trim() || null),
    // Evidence for the reviewer. Stored, never parsed or indexed.
    attachments,
  });

  try {
    // Check for conflicts via the existing learning-from-gaps handler.
    // Metadata goes into the same INSERT — under D1 write pressure a second
    // statement can fail even when the row lands, so don't split the write.
    const result = await handleUserContribution(env, queryText, answerText, category, userId, metadata);

    // Fail closed: if the contribution wasn't stored, don't claim it was.
    if (!result.success || !result.contribution_id) {
      // Nothing points at these objects now — don't leave them in the bucket.
      await discardAttachments(env, attachments);
      return json({
        status: "error",
        message: result.message,
      }, 503);
    }

    // Metadata is already on the row via the INSERT above.

    // bible_verse contributions stay staged in user_contributions only —
    // the structured ref lives in ai_issues metadata. Nothing touches the
    // curated bible_verses table until an admin approves (admin.ts).

    return json({
      status: "ok",
      contribution_id: result.contribution_id,
      type,
      attachments: attachments.length,
      has_conflict: result.hasConflict,
      message: result.message,
      next_step: result.hasConflict
        ? "An admin will review the conflicting answers."
        : "Your contribution is pending review. Once approved it becomes searchable.",
    }, 201);
  } catch (error) {
    console.error("Error handling structured contribution:", error);
    await discardAttachments(env, attachments);
    return json({ error: "Failed to process contribution" }, 500);
  }
}

/** List pending contributions for the current user (or all for admin). */
export async function handleListContributions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending_review";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);

  const rows = await env.DB.prepare(
    `SELECT id, original_query, user_answer, category, status, agreement_score,
            conflict_group_id, ai_issues, timestamp
     FROM user_contributions
     WHERE status = ?
     ORDER BY timestamp DESC
     LIMIT ?`
  ).bind(status, limit).all<{
    id: string;
    original_query: string;
    user_answer: string;
    category: string;
    status: string;
    agreement_score: number;
    conflict_group_id: string | null;
    ai_issues: string;
    timestamp: string;
  }>();

  return json({
    contributions: (rows.results || []).map((r) => {
      let meta: any = {};
      try { meta = JSON.parse(r.ai_issues || "{}"); } catch {}
      return {
        id: r.id,
        query: r.original_query,
        answer: r.user_answer,
        category: r.category,
        status: r.status,
        agreement_score: r.agreement_score,
        has_conflict: !!r.conflict_group_id,
        type: meta.type || "translation",
        source: meta.source || "user",
        notes: meta.notes || null,
        contributor_name: meta.contributor_name || null,
        // Names and sizes only — the bytes come from the attachment route,
        // which requires a signed-in reviewer.
        attachments: (Array.isArray(meta.attachments) ? meta.attachments : []).map(
          (a: { name?: string; type?: string; size?: number }, i: number) => ({
            index: i,
            name: a.name || `file-${i + 1}`,
            type: a.type || "application/octet-stream",
            size: a.size || 0,
          })
        ),
        created_at: r.timestamp,
      };
    }),
    total: rows.results?.length ?? 0,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
