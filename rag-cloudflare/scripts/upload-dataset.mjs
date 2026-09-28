// Upload one or more JSONL datasets to the production Worker via /admin/upload.
// Usage: node scripts/upload-dataset.mjs <file1.jsonl> [file2.jsonl ...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const BASE = "https://heritage-rag.heritage-app.workers.dev";
const EMAIL = "ekowfirmino@gmail.com";
const PASSWORD = process.env.HERITAGE_ADMIN_PASSWORD;

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

for (const path of process.argv.slice(2)) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)]), basename(path));
  const res = await fetch(`${BASE}/api/v1/admin/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  console.log(basename(path), res.status, await res.text());
}
