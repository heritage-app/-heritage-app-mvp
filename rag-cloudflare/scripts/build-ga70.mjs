import fs from "node:fs";

const inPath = process.argv[2];
const outPath = process.argv[3] ?? "datasets/ga-parallel-text.jsonl";
const raw = fs.readFileSync(inPath, "utf8");

// Minimal RFC-4180 CSV parse (quoted fields, embedded commas/newlines).
const rows = [];
let cur = [], f = "", q = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (q) {
    if (c === '"') {
      if (raw[i + 1] === '"') { f += '"'; i++; }
      else q = false;
    } else f += c;
  } else {
    if (c === '"') q = true;
    else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; }
    else if (c !== "\r") f += c;
  }
}
if (f || cur.length) { cur.push(f); rows.push(cur); }
const hdr = rows.shift();
console.log("header:", hdr.join("|"), "rows:", rows.length);

let empty = 0;
const seen = new Set();
const out = [];
const lens = [];
for (const r of rows) {
  const [, en, ga] = r;
  const e = String(en ?? "").trim();
  const g = String(ga ?? "").trim();
  if (!e || !g) { empty++; continue; }
  const k = e.toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  out.push({ en: e, ga: g });
  lens.push(e.split(/\s+/).length);
}
console.log("kept:", out.length, "empty:", empty, "dupes:", rows.length - empty - out.length);
const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
console.log("avg en words:", avg.toFixed(1), "max:", Math.max(...lens));
const religious = out.filter((r) =>
  /jehovah|yehowa|biblia|kristo|bible|church|sɔlemɔ|asɔr|god\b|nyɔŋmɔ/i.test(r.en + " " + r.ga)
).length;
console.log("religious-ish:", religious, `(${((religious / out.length) * 100).toFixed(1)}%)`);
fs.writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join("\n"));
console.log("wrote", outPath);
