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
  /**
   * `wrong` — the user said so. `not_found` — the archive had nothing.
   * `contribute` — the user offered to teach, unprompted.
   * `check` — the answer was worked out from corpus sentences, not verified:
   * ask a speaker to confirm `guess` or correct it.
   */
  kind: "wrong" | "not_found" | "contribute" | "check";
  /** The worked-out Ga, for a `check` card. */
  guess?: string;
  /** Prefill for the English side of the contribution. */
  english: string;
  /** Set when the asked-about term is itself Ga (e.g. a missing-sentence ask
   *  on a headword): the card should collect a usage example, not "the Ga". */
  ga?: string;
  /** The interaction being corrected, when we know it. */
  interaction_id?: string;
  /** "form" when the user already said yes — skip straight past the ask. */
  open?: "form";
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

/**
 * A worked-out (deduced, unverified) answer ends with this line, and names
 * its Ga as "is most likely **X**". It still counts as not found: nothing in
 * the archive is verified for it.
 */
export const DEDUCED_MARKER = "Not a checked entry yet";
export function deducedGuess(text: string): string | null {
  if (!text.includes(DEDUCED_MARKER)) return null;
  return text.match(/is most likely \*\*([^*]+)\*\*/)?.[1] ?? null;
}

export function isNotFoundResponse(text: string): boolean {
  if (text.includes(DEDUCED_MARKER)) return true;
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
 * A bare "yes". The card offers YES/NO buttons, but people type — and a typed
 * "yes" used to be searched like any other message ("I don't have 'yes'
 * yet"). "Hɛɛ" is Ga for yes, so it counts too.
 */
export function isAffirmative(query: string): boolean {
  return /^(yes|yeah|yea|yep|yup|sure|ok|okay|of course|i do|yes i do|i know|i know it|hɛɛ|hee)[.!\s]*$/i
    .test(query.trim());
}

/**
 * Read an explicit "X = Y" teaching without a model.
 *
 * This used to go straight to the LLM, and on the free tier the daily
 * Workers AI allowance runs out: the call threw, the error was swallowed, and
 * the teaching fell through to search and was logged as a knowledge gap. Two
 * owner teachings were lost that way on 2026-09-28.
 *
 * The side carrying Ga letters (ɛ ɔ ŋ, or tone marks) is the Ga. When neither
 * or both do, the caller may still ask the model — and if that fails too, the
 * convention "english = ga" is used and marked as assumed.
 */
export function parseEqualsPair(
  query: string
): { english: string; ga: string; assumed: boolean } | null {
  const parts = query.split("=");
  if (parts.length !== 2) return null;
  const tidy = (s: string) => s.replace(/\s+([,.;!?])/g, "$1").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
  const left = tidy(parts[0]);
  const right = tidy(parts[1]);
  if (!left || !right || left.length > 120 || right.length > 120) return null;

  const hasGa = (s: string) => /[ɛɔŋƐƆŊ]/.test(s) || /[̀-ͯ]/.test(s.normalize("NFD"));
  const lGa = hasGa(left), rGa = hasGa(right);
  if (lGa && !rGa) return { english: right, ga: left, assumed: false };
  if (rGa && !lGa) return { english: left, ga: right, assumed: false };
  return { english: left, ga: right, assumed: true };
}

/**
 * The user is offering to teach, not asking a question.
 *
 * "i would like to share" was searched and answered with the Ga for "Hurry";
 * "let me teach you" was logged as a knowledge gap. Both are in the production
 * gap table — real users say this. It should open the contribution form.
 */
export function isContributeIntent(query: string): boolean {
  const q = query.toLowerCase().trim();
  if (q.length > 80) return false;
  // A translation request or an explicit pair is handled elsewhere.
  if (/\bin\s+ga\b/.test(q) || q.includes("=")) return false;
  return (
    /\b(i'?d|i\s+would|i)\s+(like|love|want)\s+to\s+(share|teach|add|contribute|help|correct)\b/.test(q) ||
    /\b(let|can|may|could)\s+(me|i)\s+(share|teach|add|contribute|help|correct)\b/.test(q) ||
    /\bi\s+(can|could|will)\s+(share|teach|help)\b/.test(q) ||
    /\bteach\s+you\b/.test(q) ||
    /\b(add|share|submit)\s+a\s+(new\s+)?(word|phrase|translation)\b/.test(q) ||
    /\bhow\s+(do|can)\s+i\s+(contribute|add\s+a\s+word)\b/.test(q)
  );
}

/** Our own question text — the two asks the chat layer produces. */
const ASK_MARKERS = ["Do you know the right Ga for", "Do you know what it should say"];

/** True when the last assistant turn was us asking the user for help. */
export function isOurAsk(prevAssistant: string): boolean {
  return ASK_MARKERS.some((m) => prevAssistant.includes(m)) || isNotFoundResponse(prevAssistant);
}

/**
 * Recover what we asked about from the text of the ask itself.
 *
 * Guests persist nothing, and the question they resend is the one that
 * produced the ask — which, after "its wrong", is the complaint. So the reliable
 * source is our own sentence: `...right Ga for "X"?` or `I don't have "X" yet`.
 */
export function askedAboutFromAsk(prevAssistant: string): string {
  const m =
    prevAssistant.match(/right Ga for [“"](.+?)[”"]\?/) ||
    prevAssistant.match(/I don'?t (?:have|know) [“"](.+?)[”"]/);
  return m ? m[1].trim() : "";
}

/**
 * Turn a question into the English side of an entry: "how to say lets eat in
 * ga" should be proposed as "lets eat", not the whole question. Only the
 * framing is removed; if that leaves nothing, the original stands.
 */
export function cleanEnglish(question: string): string {
  let out = question.trim().replace(/[?!.]+$/, "");
  // Framing can stack — "what is | the ga word for | quantum physics" — so
  // strip until nothing more comes off (bounded; each pass removes a prefix).
  const FRAME = /^(please\s+)?(how\s+(do\s+(you|i|we)\s+|to\s+|can\s+i\s+)?(say|write|spell|(ask|tell)(\s+(someone|somebody|a person|people|him|her|them))?)|what\s+(is|do\s+you\s+call)|what'?s|translate|(the\s+)?ga\s+(word\s+)?for)\s+/i;
  // After "how do you say / translate", the rest IS the phrase asked about:
  // "how do you say | what is your name" must keep "what is".
  for (let i = 0; i < 3 && FRAME.test(out); i++) {
    const said = /^(please\s+)?(how\s+(do\s+(you|i|we)\s+|to\s+|can\s+i\s+)?(say|write|spell|(ask|tell)(\s+(someone|somebody|a person|people|him|her|them))?)|translate)\s+/i.test(out);
    out = out.replace(FRAME, "");
    if (said) break;
  }
  out = out
    .replace(/\s+(in|into)\s+ga(\s+language)?$/i, "")
    .replace(/\s+in\s+a\s+sentence$/i, "")
    .replace(/^use\s+/i, "")
    .replace(/^["“']|["”']$/g, "")
    .trim();
  return out || question.trim();
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
    // Skip complaints and bare yes/no — those are replies, not questions.
    if (text && !looksLikeComplaint(text) && !isAffirmative(text) && !isBareNegative(text)) return text;
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
