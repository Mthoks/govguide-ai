import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";

const OCR_CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", ".ocr-cache");
let pdfParseFn = null;
async function loadPdfParser() {
  if (!pdfParseFn) {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParseFn = mod.default || mod;
  }
  return pdfParseFn;
}

function getOcrWorkerOptions() {
  fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
  return {
    cachePath: OCR_CACHE_DIR,
    ...(process.env.TESSDATA_PATH ? { langPath: process.env.TESSDATA_PATH } : {})
  };
}

async function extractPdfWithOcr(buffer) {
  const [{ pdf }, { createWorker }] = await Promise.all([
    import("pdf-to-img"),
    import("tesseract.js")
  ]);
  const document = await pdf(buffer, { scale: 2 });
  if (document.length > 30) {
    await document.destroy();
    throw new Error("Scanned PDFs are limited to 30 pages for OCR ingestion.");
  }
  let worker;
  try {
    worker = await createWorker("eng", undefined, getOcrWorkerOptions());
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.length; pageNumber++) {
      const image = await document.getPage(pageNumber);
      const result = await worker.recognize(image);
      if (result.data.text.trim()) pages.push(result.data.text.trim());
    }
    return pages.join("\n\n").trim();
  } finally {
    if (worker) await worker.terminate();
    await document.destroy();
  }
}

async function extractImageWithOcr(buffer) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, getOcrWorkerOptions());
  try {
    const result = await worker.recognize(buffer);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

/**
 * Extract plain text from an uploaded policy/legislation file buffer.
 */
export async function extractTextFromFile(buffer, originalName, mimetype = "") {
  const ext = path.extname(originalName || "").toLowerCase();

  if (ext === ".pdf" || mimetype === "application/pdf") {
    const pdfParse = await loadPdfParser();
    let text = "";
    let textParseError = null;
    try {
      const result = await pdfParse(buffer);
      text = (result.text || "").trim();
    } catch (error) {
      textParseError = error;
    }
    if (text.length >= 80) return text;
    try {
      const ocrText = await extractPdfWithOcr(buffer);
      return ocrText || text;
    } catch (ocrError) {
      if (textParseError) {
        throw new Error(`PDF text extraction failed (${textParseError.message}); OCR failed (${ocrError.message}).`);
      }
      throw ocrError;
    }
  }

  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff"].includes(ext) || mimetype.startsWith("image/")) {
    return extractImageWithOcr(buffer);
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
    `Unsupported file type "${ext || mimetype}". Upload PDF, DOCX, TXT, MD, PNG, JPG, or TIFF.`
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
