/**
 * Ga voices: the dataset recordings (src/data/voices.ts) plus recordings Ga
 * speakers add in the app.
 *
 * A contributed recording is private until an admin approves it: it sits in
 * R2 under voices-pending/ (served only to signed-in users, for the peer
 * check and the admin), and moves to media/voices/user/ on approval. The app
 * plays only what GET /voices lists — a phrase without a recording gets no
 * voice at all.
 *
 *   GET    /voices                  public list: dataset + approved, minus taken-down clips
 *   POST   /voices/record           signed in: a WAV (16 kHz mono, ≤12 s) + phrase + consent
 *   GET    /voices/check            signed in: pending recordings to listen to and vote on
 *   POST   /voices/:id/vote         signed in: right | wrong | poor
 *   GET    /voices/pending/:id/audio signed in: a pending recording's audio
 *   GET    /voices/mine             signed in: your recordings and their status
 *   DELETE /voices/mine/:id         signed in: delete one of yours (consent can be withdrawn)
 * Admin endpoints live in console.ts (/admin/console/voices…).
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireUser } from "../auth/middleware";
import { NATIVE_VOICES } from "../data/voices";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

export const DATASET_CREDIT = "Ga Multispeaker dataset (Ashesi / GhanaNLP, CC BY-NC 4.0)";
export const CONSENT_TEXT =
  "My recording may be played publicly in SpeakGa, credited with my first name. I can delete it from Me at any time.";
const RATE = 16000, MAX_SECS = 12, MIN_SECS = 0.3, MAX_BYTES = 44 + MAX_SECS * RATE * 2;

/** Spelling-tolerant phrase key — the same rule as voiceKey() in public/index.html. */
export function voiceKey(t: string): string {
  return String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/ɛ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "n")
    .replace(/[’'"“”?!.,;:()]/g, "").replace(/n+\b/g, "n").replace(/\s+/g, " ").trim();
}

/** Check a WAV is what the app's recorder produces, and read its length and waveform. */
function inspectWav(buf: ArrayBuffer): { secs: number; peaks: number[] } | string {
  if (buf.byteLength < 46) return "That isn't a WAV recording.";
  if (buf.byteLength > MAX_BYTES) return "The recording is too long — keep it under 12 seconds.";
  const v = new DataView(buf), tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return "That isn't a WAV recording.";
  let p = 12, fmtOk = false, off = -1, len = 0;
  while (p + 8 <= buf.byteLength) {
    const id = tag(p), n = v.getUint32(p + 4, true);
    if (id === "fmt ") {
      fmtOk = v.getUint16(p + 8, true) === 1 && v.getUint16(p + 10, true) === 1 &&
        v.getUint32(p + 12, true) === RATE && v.getUint16(p + 22, true) === 16;
    } else if (id === "data") { off = p + 8; len = Math.min(n, buf.byteLength - off); break; }
    p += 8 + n + (n & 1);
  }
  if (!fmtOk || off < 0) return "The recording must be 16 kHz mono 16-bit WAV.";
  const samples = Math.floor(len / 2), secs = samples / RATE;
  if (secs < MIN_SECS) return "The recording is too short.";
  if (secs > MAX_SECS) return "The recording is too long — keep it under 12 seconds.";
  const peaks = new Array(32).fill(0);
  for (let i = 0; i < samples; i++) {
    const k = Math.floor((i / samples) * 32), s = Math.abs(v.getInt16(off + i * 2, true)) / 32768;
    if (s > peaks[k]) peaks[k] = s;
  }
  return { secs: +secs.toFixed(1), peaks: peaks.map((x) => +x.toFixed(2)) };
}

type Rec = {
  id: string; ga: string; ga_key: string; english: string | null; contributor_name: string | null;
  secs: number; peaks: string; status: string; votes_right: number; votes_wrong: number; votes_poor: number;
  created_at: string; reject_reason: string | null;
};

// Public list. Cached briefly: an approval shows up within a minute.
app.get("/voices", async (c) => {
  const [hiddenRes, recRes, englishRes] = await Promise.all([
    c.env.DB.prepare("SELECT path FROM voice_hidden").all<{ path: string }>().catch(() => ({ results: [] as { path: string }[] })),
    c.env.DB.prepare(
      "SELECT id, ga, ga_key, english, contributor_name, secs, peaks FROM voice_recordings WHERE status = 'approved' ORDER BY reviewed_at"
    ).all<Rec>().catch(() => ({ results: [] as Rec[] })),
    c.env.DB.prepare("SELECT ga_key, english FROM voice_phrases").all<{ ga_key: string; english: string }>()
      .catch(() => ({ results: [] as { ga_key: string; english: string }[] })),
  ]);
  const hidden = new Set((hiddenRes.results ?? []).map((r) => r.path));
  const englishOf = new Map((englishRes.results ?? []).map((r) => [r.ga_key, r.english]));
  type Clip = { url: string; secs: number; peaks: number[]; by: string };
  const byKey = new Map<string, { ga: string; english: string | null; clips: Clip[] }>();
  for (const v of NATIVE_VOICES) {
    const clips = v.clips.filter((k) => !hidden.has(k.path))
      .map((k) => ({ url: `/api/v1/media/${k.path}`, secs: k.secs, peaks: k.peaks, by: DATASET_CREDIT }));
    const key = voiceKey(v.ga);
    if (clips.length) byKey.set(key, { ga: v.ga, english: englishOf.get(key) ?? null, clips });
  }
  for (const r of recRes.results ?? []) {
    let peaks: number[] = [];
    try { peaks = JSON.parse(r.peaks); } catch { /* flat waveform */ }
    const clip = { url: `/api/v1/media/voices/user/${r.id}.wav`, secs: r.secs, peaks, by: `${r.contributor_name || "A SpeakGa speaker"} (SpeakGa)` };
    const e = byKey.get(r.ga_key);
    // An admin's English wins; otherwise the speaker's own, from their contribution.
    if (e) { e.clips.push(clip); e.english ??= r.english || null; }
    else byKey.set(r.ga_key, { ga: r.ga, english: englishOf.get(r.ga_key) ?? (r.english || null), clips: [clip] });
  }
  return c.json(
    {
      source: "Ga Multispeaker Audio Transcribed Dataset (Ashesi Financial Inclusion Speech Dataset, via GhanaNLP), and Ga speakers on SpeakGa",
      license: "Dataset clips: CC BY-NC 4.0. Community clips: shared by their speakers for SpeakGa.",
      voices: [...byKey.values()],
    },
    200,
    { "Cache-Control": "public, max-age=60" }
  );
});

app.post("/voices/record", requireUser, async (c) => {
  const user = c.get("user")!;
  let form: FormData;
  try { form = await c.req.formData(); } catch { return c.json({ error: "Send the recording as a form upload." }, 400); }
  const audio = form.get("audio") as unknown, ga = String(form.get("ga") ?? "").trim(), english = String(form.get("english") ?? "").trim();
  if (!(audio instanceof File)) return c.json({ error: "No recording attached." }, 400);
  if (!ga || ga.length > 200) return c.json({ error: "Say which Ga phrase the recording is of." }, 400);
  if (form.get("consent") !== "1") return c.json({ error: "Tick the box to agree your recording can be played in SpeakGa." }, 400);
  const buf = await audio.arrayBuffer();
  const info = inspectWav(buf);
  if (typeof info === "string") return c.json({ error: info }, 400);

  // A steady trickle only: 20 recordings a day per speaker.
  const today = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM voice_recordings WHERE contributor_id = ? AND created_at > ?"
  ).bind(user.id, new Date(Date.now() - 86400000).toISOString()).first<{ n: number }>();
  if ((today?.n ?? 0) >= 20) return c.json({ error: "That's 20 recordings today — thank you! Add more tomorrow." }, 429);

  const id = crypto.randomUUID(), now = new Date().toISOString(), key = `voices-pending/${id}.wav`;
  await c.env.DOCS_BUCKET.put(key, buf, { httpMetadata: { contentType: "audio/wav" } });
  try {
    await c.env.DB.prepare(
      `INSERT INTO voice_recordings (id, ga, ga_key, english, contributor_id, contributor_name, contribution_id, r2_key,
         secs, peaks, status, consent_text, consent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(
      id, ga, voiceKey(ga), english || null, user.id,
      (user.first_name || user.display_name || "").trim().split(/\s+/)[0] || null,
      String(form.get("contribution_id") ?? "") || null, key,
      info.secs, JSON.stringify(info.peaks), CONSENT_TEXT, now, now
    ).run();
  } catch (e) {
    await c.env.DOCS_BUCKET.delete(key).catch(() => {});
    console.error("voice insert failed:", e);
    return c.json({ error: "Couldn't save the recording — try again." }, 500);
  }
  return c.json({ id, status: "pending", secs: info.secs });
});

// Pending audio: signed-in speakers (peer check) and admins only — never public.
app.get("/voices/pending/:id/audio", requireUser, async (c) => {
  const r = await c.env.DB.prepare("SELECT r2_key, status, contributor_id FROM voice_recordings WHERE id = ?")
    .bind(c.req.param("id")).first<{ r2_key: string; status: string; contributor_id: string }>();
  if (!r || r.status !== "pending") return c.json({ detail: "Not found" }, 404);
  const obj = await c.env.DOCS_BUCKET.get(r.r2_key);
  if (!obj) return c.json({ detail: "Not found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=300" } });
});

app.get("/voices/check", requireUser, async (c) => {
  const user = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.ga, r.english, r.secs, r.peaks, r.votes_right, r.votes_wrong, r.votes_poor
       FROM voice_recordings r
      WHERE r.status = 'pending' AND r.contributor_id <> ?
        AND NOT EXISTS (SELECT 1 FROM voice_votes v WHERE v.recording_id = r.id AND v.user_id = ?)
      ORDER BY r.created_at LIMIT 10`
  ).bind(user.id, user.id).all<Rec>();
  return c.json({
    recordings: (rows.results ?? []).map((r) => ({
      id: r.id, ga: r.ga, english: r.english, secs: r.secs, peaks: safePeaks(r.peaks),
      url: `/api/v1/voices/pending/${r.id}/audio`, votes: { right: r.votes_right, wrong: r.votes_wrong, poor: r.votes_poor },
    })),
  });
});

app.post("/voices/:id/vote", requireUser, async (c) => {
  const user = c.get("user")!, id = c.req.param("id");
  const { verdict } = await c.req.json<{ verdict?: string }>().catch(() => ({ verdict: "" }));
  if (!["right", "wrong", "poor"].includes(String(verdict))) return c.json({ error: "verdict must be right, wrong or poor" }, 400);
  const r = await c.env.DB.prepare("SELECT contributor_id, status FROM voice_recordings WHERE id = ?")
    .bind(id).first<{ contributor_id: string; status: string }>();
  if (!r || r.status !== "pending") return c.json({ error: "This recording isn't waiting for checks." }, 404);
  if (r.contributor_id === user.id) return c.json({ error: "You can't check your own recording." }, 400);
  const prev = await c.env.DB.prepare("SELECT verdict FROM voice_votes WHERE recording_id = ? AND user_id = ?")
    .bind(id, user.id).first<{ verdict: string }>();
  if (prev) return c.json({ ok: true, verdict: prev.verdict });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO voice_votes (recording_id, user_id, verdict, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, verdict, new Date().toISOString()),
    c.env.DB.prepare(`UPDATE voice_recordings SET votes_${verdict} = votes_${verdict} + 1 WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true, verdict });
});

app.get("/voices/mine", requireUser, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, ga, english, secs, peaks, status, reject_reason, created_at FROM voice_recordings
      WHERE contributor_id = ? AND status <> 'removed' ORDER BY created_at DESC LIMIT 100`
  ).bind(c.get("user")!.id).all<Rec>();
  return c.json({
    recordings: (rows.results ?? []).map((r) => ({
      id: r.id, ga: r.ga, english: r.english, secs: r.secs, peaks: safePeaks(r.peaks), status: r.status,
      reason: r.reject_reason, created_at: r.created_at,
      url: r.status === "approved" ? `/api/v1/media/voices/user/${r.id}.wav` : r.status === "pending" ? `/api/v1/voices/pending/${r.id}/audio` : null,
    })),
  });
});

app.delete("/voices/mine/:id", requireUser, async (c) => {
  const r = await c.env.DB.prepare("SELECT id, r2_key FROM voice_recordings WHERE id = ? AND contributor_id = ?")
    .bind(c.req.param("id"), c.get("user")!.id).first<{ id: string; r2_key: string }>();
  if (!r) return c.json({ error: "Not found" }, 404);
  await deleteRecording(c.env, r.id, r.r2_key, "removed", "withdrawn by the speaker", null);
  return c.json({ ok: true });
});

export function safePeaks(s: string): number[] { try { return JSON.parse(s); } catch { return []; } }

/** Delete a recording's audio and mark the row (kept for the audit trail, without audio). */
export async function deleteRecording(env: Env, id: string, r2Key: string, status: "removed" | "rejected", reason: string, by: string | null) {
  await env.DOCS_BUCKET.delete(r2Key).catch(() => {});
  await env.DB.prepare(
    "UPDATE voice_recordings SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = COALESCE(?, reviewed_by) WHERE id = ?"
  ).bind(status, reason, new Date().toISOString(), by, id).run();
}

export default app;
