// Native Ga voices: the clearest recordings of each phrase in the Ga multispeaker
// dataset (ghanaopenai/ga-multispeaker-speech-text-20k — Ashesi Financial
// Inclusion Speech Dataset via GhanaNLP, CC BY-NC 4.0). 116 phrases, ~210
// speakers each; we keep the best 3 per phrase.
//
//   node scripts/build-native-voices.mjs <out dir>
//
// Writes <out dir>/voices/<slug>/<n>.wav (trimmed, levelled, 16 kHz mono) and
// src/data/voices.ts (phrase → clips, for /api/v1/voices). Upload the wavs to R2
// under media/voices/ (scripts/upload-native-voices.mjs). No phrase without a
// recording ever gets a voice: the app shows a player only for these.
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: build-native-voices.mjs <out dir>"); process.exit(1); }
const DS = "dataset=ghanaopenai/ga-multispeaker-speech-text-20k&config=default";
const CANDIDATES = 10, KEEP = 3, RATE = 16000;

// Lines that don't help a learner: the filler "ɛrh", a real phone number, and
// banking lines that are mostly English words.
const ENGLISH = /\b(account|acount|credits?|units|transfer|password|link|screen|network|nɛtwork|balance|checki|send|number|cedis|airtel|tigo|five|hundred|mami)\b/i;
const usable = (t) => t && !/\d/.test(t) && !ENGLISH.test(t) && !/^ɛrh$/i.test(t.trim());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  // The rows service is flaky; a missing page only costs a few candidates.
  console.log("skipped page:", url.split("&").slice(-2).join("&"));
  return null;
}

// 1. Candidate clips per phrase, from the test split, then train if short.
const cands = new Map();
const want = (t) => usable(t) && (cands.get(t)?.length ?? 0) < CANDIDATES;
for (const [split, rows] of [["test", 2800], ["train", 6000]]) {
  for (let off = 0; off < rows; off += 100) {
    const j = await getJson(`https://datasets-server.huggingface.co/rows?${DS}&split=${split}&offset=${off}&length=100`);
    if (!j) continue;
    for (const { row } of j.rows) {
      const t = (row.transcription || "").trim().replace(/\s+/g, " ");
      const src = row.audio_path?.[0]?.src;
      if (src && want(t)) { if (!cands.has(t)) cands.set(t, []); cands.get(t).push(src); }
    }
    if (j.rows.length < 100) break;
  }
  const short = [...cands.values()].filter((v) => v.length < CANDIDATES).length;
  console.log(`${split}: ${cands.size} phrases, ${short} still short of ${CANDIDATES}`);
  if (!short) break;
}

// 2. Score each clip: speech-to-noise ratio, clipping, and a sane length.
function readWav(buf) {
  let p = 12, off = -1, len = 0;
  while (p < buf.length - 8) {
    const id = buf.toString("ascii", p, p + 4), n = buf.readUInt32LE(p + 4);
    if (id === "data") { off = p + 8; len = Math.min(n, buf.length - off); break; }
    p += 8 + n + (n & 1);
  }
  if (off < 0 || buf.readUInt32LE(24) !== RATE || buf.readUInt16LE(22) !== 1) return null;
  const s = new Int16Array(Math.floor(len / 2));
  for (let i = 0; i < s.length; i++) s[i] = buf.readInt16LE(off + i * 2);
  return s;
}
function analyse(s) {
  const fr = 320, rms = [];
  for (let i = 0; i + fr <= s.length; i += fr) { let e = 0; for (let j = i; j < i + fr; j++) e += s[j] * s[j]; rms.push(Math.sqrt(e / fr)); }
  if (rms.length < 5) return null;
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = Math.max(sorted[Math.floor(sorted.length * 0.1)], 1), speech = sorted[Math.floor(sorted.length * 0.95)];
  const gate = noise + (speech - noise) * 0.15;
  let a = rms.findIndex((v) => v > gate), z = rms.length - 1 - [...rms].reverse().findIndex((v) => v > gate);
  if (a < 0) return null;
  a = Math.max(0, a * fr - 0.12 * RATE); z = Math.min(s.length, (z + 1) * fr + 0.12 * RATE);
  let clip = 0; for (const v of s) if (Math.abs(v) >= 32000) clip++;
  return { snr: 20 * Math.log10(speech / noise), clipped: clip / s.length, a, z, secs: (z - a) / RATE };
}
function encode(s, a, z) {
  let max = 1; for (let i = a; i < z; i++) max = Math.max(max, Math.abs(s[i]));
  const g = (32767 * 0.89) / max, n = z - a, out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + n * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(n * 2, 40);
  const peaks = new Array(32).fill(0);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(s[a + i] * g)));
    out.writeInt16LE(v, 44 + i * 2);
    const k = Math.floor((i / n) * 32); peaks[k] = Math.max(peaks[k], Math.abs(v) / 32767);
  }
  return { wav: out, peaks: peaks.map((p) => +p.toFixed(2)) };
}
const slugOf = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/ɛ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "ng").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const entries = [];
for (const [ga, urls] of [...cands].sort((a, b) => a[0].localeCompare(b[0]))) {
  const scored = [];
  for (const u of urls) {
    try {
      const r = await fetch(u); if (!r.ok) continue;
      const s = readWav(Buffer.from(await r.arrayBuffer())); if (!s) continue;
      const m = analyse(s); if (m && m.clipped < 0.002) scored.push({ s, ...m });
    } catch { /* skip clip */ }
  }
  if (!scored.length) { console.log("no usable clips:", ga); continue; }
  // Typical length for this phrase; drop clips far from it (extra talk, long pauses).
  const med = [...scored].sort((x, y) => x.secs - y.secs)[Math.floor(scored.length / 2)].secs;
  const best = scored.filter((c) => c.secs <= med * 1.5 && c.secs >= med * 0.6)
    .sort((x, y) => y.snr - x.snr).slice(0, KEEP);
  const slug = slugOf(ga), dir = path.join(OUT, "voices", slug);
  fs.mkdirSync(dir, { recursive: true });
  const clips = best.map((c, i) => {
    const { wav, peaks } = encode(c.s, c.a, c.z);
    fs.writeFileSync(path.join(dir, `${i + 1}.wav`), wav);
    return { path: `voices/${slug}/${i + 1}.wav`, secs: +c.secs.toFixed(1), peaks };
  });
  entries.push({ ga, clips });
  console.log(`${ga}: ${scored.length} scored → ${clips.map((c) => c.secs + "s").join(", ")}`);
}

const ts = `// Generated by scripts/build-native-voices.mjs — do not edit by hand.
// Recordings: Ga Multispeaker Audio Transcribed Dataset (Ashesi Financial
// Inclusion Speech Dataset, via GhanaNLP), CC BY-NC 4.0. Files live in R2 at
// media/<path>.
export interface NativeVoiceClip { path: string; secs: number; peaks: number[] }
export interface NativeVoice { ga: string; clips: NativeVoiceClip[] }
export const NATIVE_VOICES: NativeVoice[] = ${JSON.stringify(entries)};
`;
fs.writeFileSync("src/data/voices.ts", ts);
console.log(`\n${entries.length} phrases, ${entries.reduce((n, e) => n + e.clips.length, 0)} clips → src/data/voices.ts`);
