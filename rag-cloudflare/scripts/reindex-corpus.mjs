// Drive /admin/reindex through each corpus file in rec_limit pages.
// Vector ids are deterministic (file:rec:N), so re-embedding is idempotent.
// Usage: node scripts/reindex-corpus.mjs
const BASE = "https://heritage-admin.heritage-app.workers.dev";
const API = "https://heritage-rag.heritage-app.workers.dev";
const EMAIL = "corpus-ingest@speakga.local";
const PASSWORD = process.env.HERITAGE_ADMIN_PASSWORD;
const PAGE = 400; // records per reindex call (embed batches of 50)
const CONCURRENCY = 3;

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) { console.error("LOGIN FAILED", login.status); process.exit(1); }
const { access_token: token } = await login.json();
console.log("login ok");

const docs = await (await fetch(`${API}/api/v1/admin/documents`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
// Optional argv pattern forces reindex of every matching doc regardless of
// status — the upload's background indexer can mark files 'indexed' without
// having embedded all their records.
const PATTERN = process.argv[2] ? new RegExp(process.argv[2]) : /corpus|parallel|farmer-qa/;
const pending = (docs.documents ?? [])
  .filter((d) => PATTERN.test(d.public_url ?? "") && (process.argv[2] ? true : d.status !== "indexed"))
  .map((d) => d.public_url);
console.log("pending files:", pending.length);

async function drive(path) {
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${API}/api/v1/admin/reindex?path=${encodeURIComponent(path)}&rec_offset=${offset}&rec_limit=${PAGE}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await res.json().catch(() => ({}));
    const r = j.results?.[0] ?? {};
    if (r.error) { console.log(path, "ERROR", String(r.error).slice(0, 160)); return; }
    console.log(path.slice(0, 30), `recs ${r.vectors ?? "?"} next=${r.next_offset}`);
    if (r.next_offset == null) break;
    offset = r.next_offset;
    await new Promise((x) => setTimeout(x, 500));
  }
  console.log(path, "DONE");
}

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  await Promise.all(pending.slice(i, i + CONCURRENCY).map(drive));
}
console.log("all done");
