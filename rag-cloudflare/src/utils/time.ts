/**
 * Time + string helpers (ported from app/api/routes.py humanize_timestamp
 * and app/api/routers/admin.py slugify_filename).
 */

export function nowIso(): string {
  return new Date().toISOString();
}

/** Convert an ISO timestamp into a friendly relative string. */
export function humanizeTimestamp(input: string | null | undefined): string {
  if (!input) return "Unknown";
  const ts = new Date(input);
  if (isNaN(ts.getTime())) return "Unknown";

  const now = Date.now();
  const diffMs = now - ts.getTime();
  const sec = diffMs / 1000;

  if (sec < 60) return "Just now";
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    return `${m} minute${m !== 1 ? "s" : ""} ago`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    return `${h} hour${h !== 1 ? "s" : ""} ago`;
  }
  if (sec < 604800) {
    const d = Math.floor(sec / 86400);
    return d === 1 ? "Yesterday" : `${d} days ago`;
  }
  if (sec < 2592000) {
    const w = Math.floor(sec / 604800);
    return `${w} week${w !== 1 ? "s" : ""} ago`;
  }
  return ts.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
}

/** Sanitize a filename for storage paths, mapping Ga-specific characters. */
export function slugifyFilename(filename: string): string {
  let name = filename.toLowerCase();
  name = name.replace(/ɛ/g, "e").replace(/ɔ/g, "o").replace(/ŋ/g, "n");
  name = name.replace(/[^a-z0-9.\-]/g, "_");
  name = name.replace(/_+/g, "_");
  return name.replace(/^_+|_+$/g, "");
}

export function humanFileSize(bytes: number): string | null {
  if (bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${mb.toFixed(2)} MB`;
}

export function timestampSlug(): string {
  // YYYYMMDD_HHMMSS in UTC
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}
