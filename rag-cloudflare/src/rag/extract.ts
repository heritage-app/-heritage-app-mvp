/**
 * Decide what can be read out of a contributed file, and read it.
 *
 * Approving a document contribution indexes its text into the archive, so the
 * one thing this must never do is hand back mojibake. A binary container
 * decoded with TextDecoder produces plausible-looking noise, and noise in the
 * archive is worse than a file a human has to open — hence the explicit
 * allow-list and the `manual` verdict for everything else.
 */

/** What to do with a contributed file once its contribution is approved. */
export type ExtractKind = "text" | "manual";

export interface ExtractResult {
  kind: ExtractKind;
  /** Extracted text — only meaningful when kind === "text". */
  text: string;
  /** Why a file needs a person, shown to the reviewer. */
  reason?: string;
}

/** Decoded straight as UTF-8. */
const PLAIN = ["txt", "md", "markdown", "csv", "tsv", "json", "jsonl"];
const IMAGE = ["jpg", "jpeg", "png", "webp", "heic", "gif"];

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Can this file be indexed without a person reading it first? */
export function isExtractable(name: string): boolean {
  const e = extOf(name);
  return e === "pdf" || e === "docx" || PLAIN.includes(e);
}

/**
 * Pull the text out of a .docx.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body. Workers give us
 * inflate natively, but not ZIP parsing, so fflate does the container and we
 * strip the XML down to its text runs. Paragraph and tab boundaries become
 * whitespace so words don't run together.
 */
async function docxText(content: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(content));
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("no word/document.xml in archive");

  return strFromU8(doc)
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    // The XML entities Word actually emits.
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A decoded string is only usable if it really was text. Binary run through
 * TextDecoder comes back littered with U+FFFD replacement characters and NULs.
 */
function looksLikeText(s: string): boolean {
  if (!s.trim()) return false;
  const sample = s.slice(0, 4000);
  const bad = (sample.match(/[�\u0000]/g) || []).length;
  return bad / sample.length < 0.02;
}

/**
 * Read a contributed file. Never throws for an unreadable file — it returns a
 * `manual` verdict with a reason the reviewer can act on.
 */
export async function extractContributedFile(
  content: ArrayBuffer,
  filename: string
): Promise<ExtractResult> {
  const ext = extOf(filename);

  if (IMAGE.includes(ext)) {
    return { kind: "manual", text: "", reason: "image — download it and type the entries in" };
  }

  if (ext === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const { text } = await extractText(pdf, { mergePages: true });
      const out = Array.isArray(text) ? text.join("\n") : text;
      // A scan has a PDF wrapper but no text layer; Workers can't rasterise it.
      if (out.trim().length < 80) {
        return { kind: "manual", text: "", reason: "scanned PDF with no text layer — download it and type the entries in" };
      }
      return { kind: "text", text: out };
    } catch (e) {
      console.warn("PDF extraction failed:", e);
      return { kind: "manual", text: "", reason: "PDF could not be read — download it and type the entries in" };
    }
  }

  if (ext === "docx") {
    try {
      const out = await docxText(content);
      if (out.trim().length < 20) {
        return { kind: "manual", text: "", reason: "document had no readable text" };
      }
      return { kind: "text", text: out };
    } catch (e) {
      console.warn("DOCX extraction failed:", e);
      return { kind: "manual", text: "", reason: "document could not be read — download it and type the entries in" };
    }
  }

  if (PLAIN.includes(ext)) {
    const out = new TextDecoder("utf-8").decode(content);
    if (!looksLikeText(out)) {
      return { kind: "manual", text: "", reason: "file is not readable text" };
    }
    return { kind: "text", text: out };
  }

  // .doc, .xls, .xlsx and anything else: legacy or sheet containers we can't
  // read in a Worker without producing noise.
  return {
    kind: "manual",
    text: "",
    reason: `.${ext || "file"} can't be read automatically — download it and type the entries in`,
  };
}
