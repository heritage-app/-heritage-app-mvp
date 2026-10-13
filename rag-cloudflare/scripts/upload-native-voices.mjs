// Upload the native voice clips built by build-native-voices.mjs to R2
// (heritage-documents, media/voices/...), where /api/v1/media/* serves them.
//
//   node scripts/upload-native-voices.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: upload-native-voices.mjs <out dir>"); process.exit(1); }
const BUCKET = "heritage-documents", PARALLEL = 4;

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".wav")) files.push(p); } };
walk(path.join(OUT, "voices"));

const put = (file) => new Promise((resolve) => {
  const key = "media/" + path.relative(OUT, file).split(path.sep).join("/");
  execFile("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", "audio/wav", "--remote"],
    { shell: true }, (err, _o, stderr) => resolve({ key, ok: !err, err: err ? String(stderr).slice(-200) : "" }));
});

let done = 0, failed = [];
const queue = [...files];
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (queue.length) {
    const f = queue.shift();
    let r = await put(f);
    if (!r.ok) r = await put(f);
    if (!r.ok) failed.push(r);
    if (++done % 25 === 0 || done === files.length) console.log(`${done}/${files.length}`);
  }
}));
console.log(failed.length ? `failed: ${failed.map((f) => f.key).join(", ")}` : "all uploaded");
