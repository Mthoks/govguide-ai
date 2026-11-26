import path from "node:path";
import mammoth from "mammoth";

let pdfParseFn = null;
async function loadPdfParser() {
  if (!pdfParseFn) {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParseFn = mod.default || mod;
  }
  return pdfParseFn;
}

/**
 * Extract plain text from an uploaded policy/legislation file buffer.
 */
export async function extractTextFromFile(buffer, originalName, mimetype = "") {
  const ext = path.extname(originalName || "").toLowerCase();

  if (ext === ".pdf" || mimetype === "application/pdf") {
    const pdfParse = await loadPdfParser();
    const result = await pdfParse(buffer);
    return (result.text || "").trim();
  }

  if (
    ext === ".docx" ||
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || "").trim();
  }

  if (ext === ".txt" || ext === ".md" || ext === ".csv" || mimetype.startsWith("text/")) {
    return buffer.toString("utf8").trim();
  }

  throw new Error(
    `Unsupported file type "${ext || mimetype}". Upload a .pdf, .docx, .txt, or .md file.`
  );
}

/**
 * Split raw extracted document text into searchable section/clause objects.
 */
export function splitIntoSections(rawText, maxChunkChars = 1100) {
  const normalized = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  const headingPattern =
    /^(?:#{1,4}\s+.+|(?:Section|Clause|Regulation|Chapter|Article|Part)\s+\d+[A-Za-z0-9.\-–]*.*|\d+(?:\.\d+){0,2}\s+[A-Z][^\n]{3,80})$/gm;

  const lines = normalized.split("\n");
  const blocks = [];
  let currentHeading = "Section 1 — Document overview";
  let currentBuf = [];

  const flush = () => {
    const text = currentBuf.join("\n").trim();
    if (!text) return;
    if (text.length <= maxChunkChars) {
      blocks.push({ sec: currentHeading, text });
    } else {
      // Split oversized sections on paragraph boundaries
      const paras = text.split(/\n\n+/);
      let part = "";
      let partIdx = 1;
      for (const p of paras) {
        if (part && part.length + p.length + 2 > maxChunkChars) {
          blocks.push({
            sec: partIdx === 1 ? currentHeading : `${currentHeading} (cont. ${partIdx})`,
            text: part.trim()
          });
          part = p;
          partIdx += 1;
        } else {
          part = part ? `${part}\n\n${p}` : p;
        }
      }
      if (part.trim()) {
        blocks.push({
          sec: partIdx === 1 ? currentHeading : `${currentHeading} (cont. ${partIdx})`,
          text: part.trim()
        });
      }
    }
    currentBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingPattern.test(trimmed)) {
      headingPattern.lastIndex = 0;
      flush();
      currentHeading = trimmed.replace(/^#+\s*/, "").slice(0, 90);
    } else {
      headingPattern.lastIndex = 0;
      currentBuf.push(line);
    }
  }
  flush();

  return blocks.slice(0, 80);
}
