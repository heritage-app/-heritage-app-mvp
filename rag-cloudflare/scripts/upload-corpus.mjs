// Upload the GhanaNLP corpus chunks as category 'corpus' — indexed for
// semantic retrieval but skipped by the heritage line-scans.
// Usage: node scripts/upload-corpus.mjs [datasets/ga-corpus-01.jsonl ...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const BASE = "https://heritage-admin.heritage-app.workers.dev";
const EMAIL = "corpus-ingest@speakga.local";
const PASSWORD = process.env.HERITAGE_ADMIN_PASSWORD;

const files = process.argv.slice(2);
if (!files.length) files.push(...Array.from({ length: 9 }, (_, i) => `datasets/ga-corpus-${String(i + 1).padStart(2, "0")}.jsonl`));

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  console.error("LOGIN FAILED", login.status, await login.text());
  process.exit(1);
}
const { access_token: token } = await login.json();
console.log("login ok");

for (const path of files) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)]), basename(path));
  form.append("metadata", JSON.stringify({ category: "corpus" }));
  const res = await fetch(`${BASE}/api/v1/admin/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  console.log(basename(path), res.status, (await res.text()).slice(0, 200));
  await new Promise((r) => setTimeout(r, 2000));
}
