import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { DOCS } from "./data/knowledge.js";
import { extractTextFromFile, splitIntoSections } from "./lib/parser.js";
import {
  retrieveEvidence,
  sanitizeDocForUser,
  buildLocalFallbackResponse
} from "./lib/retrieval.js";
import {
  authenticateEmployee,
  clearSessionCookie,
  createRateLimiter,
  createSessionToken,
  extractSessionUser,
  redactPII,
  registerEmployee,
  setSessionCookie
} from "./lib/security.js";
import {
  logAuditEvent,
  recordFeedback,
  recordKnowledgeGap
} from "./lib/audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const UPLOADS_FILE = path.join(__dirname, "data", "uploads.json");

/* ---------- Resilience helpers (retry + backup model) ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errors that are usually temporary on Google's side
const isRetryable = (err) => [429, 500, 503, 504].includes(Number(err?.status));
const isNetworkTimeout = (err) =>
  err?.name === "AbortError" ||
  err?.name === "TimeoutError" ||
  [
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "ETIMEDOUT"
  ].includes(err?.cause?.code) ||
  (err?.name === "TypeError" && /fetch failed/i.test(err.message || ""));

async function generateWithRetry(ai, params, { retries = 2, baseDelay = 800 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      if (!isRetryable(err) || attempt === retries) throw err;
      const delay = baseDelay * 2 ** attempt + Math.random() * 300; // ~0.8s, 1.6s + jitter
      console.warn(
        `Gemini ${params.model} error ${err.status}; retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }
}

export async function generateWithFallback(ai, params, fallbackModel = FALLBACK_MODEL) {
  try {
    return {
      response: await generateWithRetry(ai, params),
      usedModel: params.model
    };
  } catch (primaryError) {
    if ([401, 403].includes(Number(primaryError?.status))) {
      console.warn(`Gemini ${params.model} authorization failed (${primaryError.status})`);
      return { error: primaryError, reason: "credentials" };
    }
    if (isNetworkTimeout(primaryError)) {
      console.warn(`Gemini ${params.model} request timed out or could not connect; using local grounded fallback`);
      return { error: primaryError, reason: "network" };
    }

    console.warn(
      `Gemini ${params.model} failed (${primaryError?.status || "unknown"}); trying backup ${fallbackModel}`
    );
    try {
      return {
        response: await generateWithRetry(
          ai,
          { ...params, model: fallbackModel },
          { retries: 1 }
        ),
        usedModel: fallbackModel
      };
    } catch (backupError) {
      console.warn(
        `Gemini backup ${fallbackModel} failed (${backupError?.status || "unknown"}); using local grounded fallback`
      );
      return {
        error: backupError,
        reason: isNetworkTimeout(backupError)
          ? "network"
          : Number(backupError?.status) === 404
            ? "model"
            : undefined
      };
    }
  }
}

/* ---------- Upload storage ---------- */

function loadUploadedDocs() {
  try {
    if (!fs.existsSync(UPLOADS_FILE)) return [];
    const raw = fs.readFileSync(UPLOADS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((doc) => {
      const summary = redactPII(doc.sum || "");
      let redactedCount = summary.redactedCount;
      const sections = Array.isArray(doc.sections)
        ? doc.sections.map((section) => {
          const safeText = redactPII(section.text || "");
          redactedCount += safeText.redactedCount;
          return { ...section, text: safeText.text };
        })
        : [];
      return {
        ...doc,
        sum: summary.text,
        sections,
        redactedPIICount: (Number(doc.redactedPIICount) || 0) + redactedCount
      };
    });
  } catch {
    return [];
  }
}

function saveUploadedDocs(list) {
  fs.mkdirSync(path.dirname(UPLOADS_FILE), { recursive: true });
  fs.writeFileSync(UPLOADS_FILE, JSON.stringify(list, null, 2), "utf8");
}

function getAllDocs() {
  return [...DOCS, ...loadUploadedDocs()].map((doc) => ({
    ...doc,
    repository: doc.repository || (
      /gov\.za|treasury\.gov\.za/i.test(doc.src || "")
        ? "Government web"
        : /sharepoint|intranet/i.test(doc.src || "")
          ? "SharePoint"
          : "Departmental DMS"
    )
  }));
}

function getGeminiClient() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS }
  });
}

function htmlToText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const text = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title.replace(/<[^>]+>/g, "").trim(), text };
}

function documentMetadata(user, body, defaults = {}) {
  const allowedStatuses = ["cur", "sup", "dra", "rev"];
  const requestedClass = Number(body.cls || 1);
  if (!Number.isInteger(requestedClass) || requestedClass < 1 || requestedClass > user.lvl) {
    throw Object.assign(new Error("You cannot assign a classification above your verified clearance."), { status: 403 });
  }
  const status = body.st || defaults.st;
  if (!allowedStatuses.includes(status)) {
    throw Object.assign(new Error("Choose a valid document status."), { status: 400 });
  }
  const metadata = {
    title: String(body.title || defaults.title || "").trim().slice(0, 180),
    cat: String(body.cat || defaults.cat || "Departmental policies").trim().slice(0, 80),
    owner: String(body.owner || user.unit).trim().slice(0, 120),
    ver: String(body.ver || "").trim().slice(0, 60),
    st: status,
    date: String(body.date || "Unknown").slice(0, 30),
    cls: requestedClass
  };
  if (!metadata.title || !metadata.ver) {
    throw Object.assign(new Error("Provide a document title and version."), { status: 400 });
  }
  return metadata;
}

function isFollowUpQuestion(question) {
  const text = question.toLowerCase();
  return /^(and|also|what about|how about|then|in that case)\b/.test(text) ||
    /\b(it|they|them|this|that|these|those|there|above|same)\b/.test(text);
}

function persistUploadedDoc(doc) {
  const existing = loadUploadedDocs();
  existing.push(doc);
  saveUploadedDocs(existing);
}

export function createCitedAnswer(parsed, evidenceHits) {
  const evidence = new Map(
    evidenceHits.map((hit) => [`${hit.doc.id}\u0000${hit.sec}`, hit])
  );
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  const citedHits = new Map();
  const cleanClaims = [];
  for (const claim of claims) {
    if (typeof claim?.text !== "string" || !claim.text.trim() || !Array.isArray(claim.citations) || !claim.citations.length) {
      return null;
    }
    const citations = [];
    for (const citation of claim.citations) {
      const hit = citation && evidence.get(`${citation.id}\u0000${citation.section}`);
      if (!hit) return null;
      citedHits.set(`${hit.doc.id}\u0000${hit.sec}`, hit);
      citations.push(hit);
    }
    cleanClaims.push({ text: claim.text.trim(), citations });
  }
  if (!parsed.unknown && !cleanClaims.length) return null;

  const sources = [...citedHits.values()].map(({ doc, sec }) => ({
    id: doc.id,
    title: doc.title,
    section: sec,
    version: doc.ver,
    status: doc.st,
    replacementId: doc.rep || null,
    url: doc.url || null,
    repository: doc.repository || doc.src
  }));
  const sourceByKey = new Map(sources.map((source) => [`${source.id}\u0000${source.section}`, source]));
  let answer = cleanClaims
    .map((claim) => {
      const refs = claim.citations.map((hit) => {
        const source = sourceByKey.get(`${hit.doc.id}\u0000${hit.sec}`);
        return `[${source.title} — ${source.section}, v${source.version}]`;
      });
      return `${claim.text} ${refs.join(" ")}`;
    })
    .join("\n\n");
  const statusWarnings = [];
  for (const source of sources) {
    if (source.status === "sup") {
      const replacement = source.replacementId
        ? evidenceHits.find((hit) => hit.doc.id === source.replacementId)?.doc
        : null;
      statusWarnings.push(
        replacement
          ? `WARNING: ${source.title} v${source.version} is superseded. Do not rely on it; use ${replacement.title} v${replacement.ver}.`
          : `WARNING: ${source.title} v${source.version} is superseded. Do not rely on it.`
      );
    } else if (source.status === "dra") {
      statusWarnings.push(`WARNING: ${source.title} v${source.version} is a draft and is not approved or in force.`);
    } else if (source.status === "rev") {
      statusWarnings.push(`WARNING: ${source.title} v${source.version} is under review; confirm with its owner before relying on it.`);
    }
  }
  if (statusWarnings.length) answer = `${[...new Set(statusWarnings)].join("\n\n")}\n\n${answer}`;
  return {
    answer: parsed.unknown && !answer ? "The available passages do not contain enough information to answer this." : answer,
    unknown: Boolean(parsed.unknown),
    referral: parsed.unknown ? parsed.referral || null : null,
    sources
  };
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const authRateLimit = createRateLimiter({ windowMs: 15 * 60_000, max: 12 });
const chatRateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });
const uploadRateLimit = createRateLimiter({ windowMs: 60_000, max: 8 });

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const result = authenticateEmployee(req.body?.email, req.body?.employeeNumber, req.body?.password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  setSessionCookie(res, createSessionToken(result.user));
  res.json({ user: result.user });
});

app.post("/api/auth/register", authRateLimit, (req, res) => {
  const result = registerEmployee(req.body?.email, req.body?.employeeNumber, req.body?.password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  setSessionCookie(res, createSessionToken(result.user));
  res.status(201).json({ user: result.user });
});

app.get("/api/auth/session", (req, res) => {
  const user = extractSessionUser(req);
  res.json({ user: user || null });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

function requireSession(req, res, next) {
  const user = extractSessionUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to continue." });
  req.user = user;
  next();
}

app.get("/api/health", (_req, res) => {
  const keyConfigured = Boolean((process.env.GEMINI_API_KEY || "").trim());
  const uploaded = loadUploadedDocs();
  res.json({
    ok: true,
    geminiConfigured: keyConfigured,
    mode: keyConfigured ? "gemini" : "local-fallback",
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
    knowledgeDocuments: DOCS.length + uploaded.length,
    builtInDocuments: DOCS.length,
    uploadedDocuments: uploaded.length
  });
});

app.get("/api/docs", requireSession, (req, res) => {
  const user = req.user;
  const deptDocs = getAllDocs()
    .filter((d) => d.dept === user.dept)
    .map((d) => sanitizeDocForUser(user, d));
  res.json({ docs: deptDocs });
});

app.post("/api/upload", requireSession, uploadRateLimit, upload.single("file"), async (req, res) => {
  try {
    const user = req.user;
    if (!req.file) {
      return res.status(400).json({ error: "Choose a .pdf, .docx, .txt, or .md file to upload." });
    }

    const metadata = documentMetadata(user, req.body, {
      title: req.file.originalname.replace(/\.[^.]+$/, ""),
      st: "rev"
    });
    const repository = ["Departmental DMS", "SharePoint"].includes(req.body.repository)
      ? req.body.repository
      : "Departmental DMS";

    const text = await extractTextFromFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    if (!text) {
      return res.status(400).json({ error: "No readable text could be extracted from that file." });
    }

    const redacted = redactPII(text);
    const sections = splitIntoSections(redacted.text);
    const newDoc = {
      id: `up-${Date.now()}`,
      dept: user.dept,
      ...metadata,
      src: `Uploaded file: ${req.file.originalname}`,
      repository,
      ingestedAt: new Date().toISOString(),
      sum: redacted.text.slice(0, 220).replace(/\s+/g, " ") + (redacted.text.length > 220 ? "..." : ""),
      sections,
      redactedPIICount: redacted.redactedCount,
      uploaded: true
    };

    persistUploadedDoc(newDoc);
    logAuditEvent({
      actor: user,
      action: "DOCUMENT_UPLOADED",
      targetId: newDoc.id,
      details: `Indexed "${newDoc.title}" from ${newDoc.repository}`
    });

    res.status(201).json({
      doc: sanitizeDocForUser(user, newDoc),
      sectionCount: sections.length,
      piiRedactedCount: newDoc.redactedPIICount
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Could not process uploaded file." });
  }
});

app.post("/api/ingest/web", requireSession, uploadRateLimit, async (req, res) => {
  try {
    const user = req.user;
    const inputUrl = new URL(String(req.body?.url || ""));
    const approvedHosts = new Set(["www.gov.za", "gov.za", "www.treasury.gov.za", "treasury.gov.za"]);
    if (
      inputUrl.protocol !== "https:" ||
      inputUrl.username ||
      inputUrl.password ||
      inputUrl.port ||
      !approvedHosts.has(inputUrl.hostname.toLowerCase())
    ) {
      return res.status(400).json({ error: "Only HTTPS sources on gov.za or treasury.gov.za can be ingested." });
    }

    const response = await fetch(inputUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "text/html, application/pdf, text/plain;q=0.9" }
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Source returned HTTP ${response.status}.` });
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["text/html", "text/plain", "application/pdf"].includes(contentType)) {
      return res.status(415).json({ error: "The source must be a public HTML, text, or PDF document." });
    }
    const maxBytes = 5 * 1024 * 1024;
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return res.status(413).json({ error: "Web documents must be 5 MB or smaller." });
      }
      chunks.push(Buffer.from(value));
    }
    const buffer = Buffer.concat(chunks);
    let titleFromPage = "";
    let text;
    if (contentType === "application/pdf") {
      text = await extractTextFromFile(buffer, "web-source.pdf", contentType);
    } else if (contentType === "text/html") {
      const parsed = htmlToText(buffer.toString("utf8"));
      titleFromPage = parsed.title;
      text = parsed.text;
    } else {
      text = buffer.toString("utf8").trim();
    }
    if (!text) {
      return res.status(400).json({ error: "No readable text could be extracted from that web source." });
    }

    const metadata = documentMetadata(user, req.body, { title: titleFromPage, st: "rev" });
    if (!metadata.title || !metadata.ver) {
      return res.status(400).json({ error: "Provide a document title and version before ingesting the source." });
    }
    const redacted = redactPII(text);
    const doc = {
      id: `web-${Date.now()}`,
      dept: user.dept,
      ...metadata,
      src: `Official web source: ${inputUrl.hostname}`,
      repository: "Government web",
      url: inputUrl.href,
      ingestedAt: new Date().toISOString(),
      sum: redacted.text.slice(0, 220).replace(/\s+/g, " ") + (redacted.text.length > 220 ? "..." : ""),
      sections: splitIntoSections(redacted.text),
      redactedPIICount: redacted.redactedCount,
      uploaded: true
    };
    persistUploadedDoc(doc);
    logAuditEvent({
      actor: user,
      action: "DOCUMENT_WEB_INGESTED",
      targetId: doc.id,
      details: `Indexed "${doc.title}" from Government web`
    });
    res.status(201).json({
      doc: sanitizeDocForUser(user, doc),
      sectionCount: doc.sections.length,
      piiRedactedCount: doc.redactedPIICount
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return res.status(504).json({ error: "The official source took too long to respond." });
    }
    res.status(err.status || 400).json({ error: err.message || "Could not ingest the web source." });
  }
});

app.delete("/api/upload/:id", requireSession, (req, res) => {
  const user = req.user;
  const existing = loadUploadedDocs();
  const target = existing.find((d) => d.id === req.params.id && d.dept === user.dept);
  if (!target) {
    return res.status(404).json({ error: "Uploaded document not found in your department." });
  }
  if (target.cls > user.lvl) {
    return res.status(403).json({ error: "Insufficient clearance to remove this document." });
  }
  saveUploadedDocs(existing.filter((d) => d.id !== req.params.id));
  logAuditEvent({
    actor: user,
    action: "DOCUMENT_REMOVED",
    targetId: target.id,
    details: `Removed "${target.title}" from ${target.repository || "the document repository"}`
  });
  res.json({ ok: true });
});

app.post("/api/chat", requireSession, chatRateLimit, async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const user = req.user;
    if (!question) {
      return res.status(400).json({ error: "Please enter a question." });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: "Questions must be 2,000 characters or fewer." });
    }

    const allDocs = getAllDocs();
    const safeQuestion = redactPII(question).text;
    const recentQuestions = history
      .filter((m) => m && m.role === "user" && typeof m.text === "string")
      .slice(-4)
      .map((m) => redactPII(m.text.slice(0, 500)).text)
      .join("\n");
    let retrieval = retrieveEvidence(user, allDocs, safeQuestion, 7);
    if (!retrieval.hits.length && recentQuestions && isFollowUpQuestion(safeQuestion)) {
      retrieval = retrieveEvidence(user, allDocs, `${recentQuestions}\n${safeQuestion}`, 7);
    }
    logAuditEvent({
      actor: user,
      action: "QUERY_EXECUTED",
      details: "Question submitted to authorised corpus"
    });
    const ai = getGeminiClient();

    if (!ai) {
      if (!retrieval.hits.length) {
        recordKnowledgeGap({
          actor: user,
          department: user.dept,
          question: safeQuestion,
          topScore: 0
        });
      }
      return res.json(buildLocalFallbackResponse(user, retrieval, allDocs));
    }

    // If the user asked specifically about a document above their clearance and nothing else matches
    if (retrieval.restrictedMatch && retrieval.hits.length === 0) {
      return res.json({
        answer:
          `A potentially relevant record is above your verified access level (${user.lvlName}), ` +
          `so its title and contents cannot be disclosed. Ask your departmental information owner about access.`,
        sources: [],
        unknown: true,
        referral: "Your departmental information owner",
        mode: "gemini"
      });
    }

    const authorisedSummaryList = allDocs
      .filter((d) => d.dept === user.dept && d.cls <= user.lvl)
      .map(
        (d) =>
          `- id="${d.id}" | title="${d.title}" | status=${d.st} | version=${d.ver}` +
          (d.rep ? ` | replaced_by="${d.rep}"` : "")
      )
      .join("\n");

    const evidenceBlock = retrieval.hits.length
      ? retrieval.hits
        .map(
          (h, idx) =>
            `[${idx + 1}] doc_id="${h.doc.id}" | title="${h.doc.title}" | status=${h.doc.st} | version=${h.doc.ver} | section="${h.sec}"\n${h.text}`
        )
        .join("\n\n")
      : "NO MATCHING PASSAGES FOUND IN AUTHORISED DOCUMENTS.";

    const recentHistory = history
      .filter((m) => m && m.role === "user" && typeof m.text === "string")
      .slice(-4)
      .map((m) => `Employee: ${redactPII(m.text.slice(0, 500)).text}`)
      .join("\n");

    const systemInstruction = `You are GovGuide AI, a careful South African public-sector policy and legislation assistant.
Logged-in employee: ${user.name}, ${user.title}, Department of ${user.dept}, clearance level ${user.lvlName}.

STRICT GROUNDING RULES:
1. Answer ONLY using the AUTHORISED PASSAGES provided below. Never invent legal sections, clauses, numbers, or policy rules not present in the passages.
2. Return factual statements only as separate claims, and attach at least one exact retrieved doc_id and section to every claim. Do not put factual claims outside the claims array.
3. Use conversation history only to understand follow-up context; it is not evidence. Cite the version shown for each cited passage.
4. Check document status carefully:
   - "sup" = Superseded: clearly warn the employee NOT to rely on it and point to its replacement document.
   - "dra" = Draft: clearly warn it is a draft only and NOT approved or in force.
   - "rev" = Under review: advise verifying with the document owner before relying on it.
5. If the passages do not contain enough evidence to answer the question reliably, set unknown=true, say clearly that you cannot answer from the available authorised documents, and set referral to "${retrieval.referral}".
6. Never reveal or speculate about restricted documents above the employee's clearance.`;

    const userPrompt = `AUTHORISED DOCUMENT CATALOGUE (${user.dept}):
${authorisedSummaryList}

AUTHORISED PASSAGES RETRIEVED:
${evidenceBlock}

${recentHistory ? `RECENT CONVERSATION:\n${recentHistory}\n\n` : ""}CURRENT QUESTION:
${safeQuestion}`;

    const params = {
      model: MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: {
              type: Type.STRING,
              description: "Clear plain-language answer grounded only in the retrieved passages."
            },
            unknown: {
              type: Type.BOOLEAN,
              description: "True if the authorised passages do not contain enough information."
            },
            referral: {
              type: Type.STRING,
              description: "Departmental office to contact when unknown is true, else empty string."
            },
            claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: "One factual claim supported by the cited passages" },
                  citations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING, description: "Exact doc_id from a retrieved passage" },
                        section: { type: Type.STRING, description: "Exact section or clause from that passage" }
                      },
                      required: ["id", "section"]
                    }
                  }
                },
                required: ["text", "citations"]
              }
            }
          },
          required: ["claims", "unknown"]
        }
      }
    };

    // Try both provider models, then serve a corpus-grounded local response.
    const generated = await generateWithFallback(ai, params);
    if (!generated.response) {
      return res.json({
        ...buildLocalFallbackResponse(user, retrieval, allDocs),
        notice: generated.reason === "credentials"
          ? "Gemini could not authorize the request. Check the API key and model access; this answer uses local grounded search."
          : generated.reason === "network"
            ? "Gemini could not be reached before the request timed out. Check internet access, firewall, or proxy settings; this answer uses local grounded search."
            : generated.reason === "model"
              ? "The configured backup model is unavailable for this API key. Set GEMINI_FALLBACK_MODEL to a model available to your account; this answer uses local grounded search."
            : "Live Gemini could not complete the request. This answer uses local grounded search."
      });
    }
    const { response, usedModel } = generated;

    let parsed = {};
    try {
      parsed = JSON.parse(response.text || "{}");
    } catch {
      console.warn("Gemini returned non-JSON output; using local grounded fallback");
      return res.json({
        ...buildLocalFallbackResponse(user, retrieval, allDocs),
        notice: "The AI response could not be read, so this answer comes from the offline grounded search."
      });
    }

    if (parsed.unknown) {
      recordKnowledgeGap({
        actor: user,
        department: user.dept,
        question: safeQuestion,
        topScore: retrieval.hits[0]?.score || 0
      });
    }
    const grounded = createCitedAnswer(parsed, retrieval.hits);
    if (!grounded) {
      return res.json(buildLocalFallbackResponse(user, retrieval, allDocs));
    }

    res.json({
      ...grounded,
      referral: grounded.unknown ? grounded.referral || retrieval.referral : null,
      mode: "gemini",
      model: usedModel,
      notice:
        usedModel !== MODEL
          ? "The main AI model was busy, so a backup model answered this question."
          : undefined
    });
  } catch (err) {
    // Keep full details in the server log only; show a friendly message to the user.
    console.error("Chat error:", err);
    const busy = isRetryable(err);
    res.status(busy ? 503 : 502).json({
      error: busy
        ? "The AI service is temporarily busy. Please try again in a moment."
        : "Something went wrong while contacting the AI service. Please try again."
    });
  }
});

app.post("/api/feedback", requireSession, (req, res) => {
  const user = req.user;
  const question = String(req.body?.question || "").trim();
  if (!question || typeof req.body?.helpful !== "boolean") {
    return res.status(400).json({ error: "Provide the question and a helpful/not-helpful rating." });
  }
  const visibleIds = new Set(
    getAllDocs()
      .filter((doc) => doc.dept === user.dept && doc.cls <= user.lvl)
      .map((doc) => doc.id)
  );
  const docIds = Array.isArray(req.body.docIds)
    ? req.body.docIds.filter((id) => typeof id === "string" && visibleIds.has(id)).slice(0, 6)
    : [];
  const feedback = recordFeedback({
    user,
    question,
    helpful: req.body.helpful,
    flagReason: String(req.body.flagReason || "").slice(0, 300),
    docIds
  });
  res.status(201).json({ id: feedback.id, recorded: true });
});

export function createApp() {
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
app.listen(PORT, () => {
  const keySet = Boolean((process.env.GEMINI_API_KEY || "").trim());
  console.log(`GovGuide AI running at http://localhost:${PORT}`);
  console.log(
    keySet
      ? `Mode: Live Gemini (${MODEL}, backup: ${FALLBACK_MODEL})`
      : "Mode: Local Grounded Fallback (add GEMINI_API_KEY to .env for live Gemini)"
  );
});
}