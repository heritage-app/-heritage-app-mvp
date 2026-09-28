/**
 * Flagged turns — recognising "that's wrong" instead of searching it.
 *
 * Every message used to be treated as a question, so "its wrong or its not
 * correct" was looked up in the archive: it missed, and the complaint was
 * written to `knowledge_gaps` as if someone had requested that phrase. Worse,
 * "its close but not the exact" matched a sentence in the phonetics dataset
 * containing "exact" and "close", and was served as a translation.
 *
 * A flagged turn is never searched and never logged as a gap. It records
 * negative feedback against the PREVIOUS interaction — the one that was
 * actually wrong — and invites a correction with the English prefilled.
 */
import type { Env, ChatMessage } from "../types";

/** What the client should render under the answer. */
export interface TurnFlag {
  /** `wrong` — the user said so. `not_found` — the archive had nothing. */
  kind: "wrong" | "not_found";
  /** Prefill for the English side of the contribution. */
  english: string;
  /** The interaction being corrected, when we know it. */
  interaction_id?: string;
}

/**
 * Phrases the not-found responses end with. Kept here so the chat layer can
 * recognise its own output without the copy being duplicated — if
 * learning-from-gaps changes its wording, this list changes with it.
 */
const NOT_FOUND_MARKERS = [
  "Share the Ga and English version and I'll add it",
  "Share both Ga and English and I'll add it",
  "Know it? Share",
  "Know about it? Share",
  "Know the Ga word? Share",
];

export function isNotFoundResponse(text: string): boolean {
  return NOT_FOUND_MARKERS.some((m) => text.includes(m));
}

/**
 * True when the message is the user telling us the last answer was wrong,
 * rather than asking something new.
 *
 * Deliberately NOT anchored to the start of the string: the previous detector
 * used /^(wrong|no|...)/ which is exactly why "its wrong" and "its close
 * but..." both slipped through and got searched.
 */
function looksLikeComplaint(text: string): boolean {
  const q = text.toLowerCase().trim();

  // A complaint is short. A long message is a real one.
  if (q.length > 80) return false;

  // Question words and translation requests mean it IS a query — "how do you
  // say wrong in Ga" must never be read as a complaint.
  if (/\b(how|what|which|who|where|when|translate|meaning|means|spell)\b/.test(q)) return false;
  if (/\bin\s+ga\b/.test(q)) return false;
  // A Ga/English pair is an explicit correction; detectAndHandleCorrection
  // handles those and gives a better answer than this does.
  if (q.includes("=")) return false;

  return (
    /\b(wrong|incorrect|inaccurate|mistake)\b/.test(q) ||
    /\bnot\s+(correct|right|exact|it|accurate|true)\b/.test(q) ||
    /\b(isn'?t|ain'?t)\s+(correct|right|it)\b/.test(q) ||
    /\bclose\s+but\b/.test(q) ||
    /\bthat'?s?\s+not\b/.test(q) ||
    /^(no|nah|nope)\b/.test(q)
  );
}

export function isDissatisfaction(query: string, memoryWindow: ChatMessage[]): boolean {
  // Nothing to be wrong about yet.
  if (!memoryWindow.some((m) => m.role === "assistant")) return false;
  return looksLikeComplaint(query);
}

/** A bare "no" — used to tell "I don't know it either" from "you're wrong". */
export function isBareNegative(query: string): boolean {
  return /^(no|nah|nope|no thanks|not really|i don'?t know|idk)[.!\s]*$/i.test(query.trim());
}

/**
 * The user's previous real question — what a correction would be *about*.
 *
 * Complaints are themselves persisted as user turns, so a second "that's still
 * wrong" would otherwise be treated as a question about the first complaint.
 * Walk back past any complaint to the last genuine question.
 */
export function previousUserQuery(memoryWindow: ChatMessage[]): string {
  const users = memoryWindow.filter((m) => m.role === "user");
  for (let i = users.length - 1; i >= 0; i--) {
    const text = (users[i].content ?? "").trim();
    if (text && !looksLikeComplaint(text)) return text;
  }
  return "";
}

/** The assistant turn being complained about. */
export function previousAssistantAnswer(memoryWindow: ChatMessage[]): string {
  const bots = memoryWindow.filter((m) => m.role === "assistant");
  return (bots[bots.length - 1]?.content ?? "").trim();
}

/**
 * Record that the previous answer was bad, whether or not a correction
 * follows. Best-effort: a failure here must never break the reply.
 */
export async function recordNotHelpful(
  env: Env,
  conversationId: string,
  userId: string,
  comment: string
): Promise<void> {
  try {
    // The turn being complained about is the most recent one in this thread.
    const prev = await env.DB.prepare(
      "SELECT id FROM interactions WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(conversationId)
      .first<{ id: string }>();
    if (!prev) return;

    const existing = await env.DB.prepare(
      "SELECT id FROM response_feedback WHERE interaction_id = ? AND user_id = ?"
    )
      .bind(prev.id, userId)
      .first<{ id: string }>();

    const now = new Date().toISOString();
    if (existing) {
      await env.DB.prepare(
        "UPDATE response_feedback SET rating = 'not_helpful', comment = ?, created_at = ? WHERE id = ?"
      )
        .bind(comment.slice(0, 500), now, existing.id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO response_feedback (id, interaction_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, 'not_helpful', ?, ?)"
      )
        .bind(crypto.randomUUID(), prev.id, userId, comment.slice(0, 500), now)
        .run();
    }
  } catch (e) {
    console.error("recordNotHelpful failed:", e);
  }
}
