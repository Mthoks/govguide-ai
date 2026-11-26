import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { USERS, DOCS } from "./data/knowledge.js";
import { extractTextFromFile, splitIntoSections } from "./lib/parser.js";
import {
  retrieveEvidence,
  sanitizeDocForUser,
  buildLocalFallbackResponse
} from "./lib/retrieval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const UPLOADS_FILE = path.join(__dirname, "data", "uploads.json");

function loadUploadedDocs() {
  try {
    if (!fs.existsSync(UPLOADS_FILE)) return [];
    const raw = fs.readFileSync(UPLOADS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUploadedDocs(list) {
  fs.mkdirSync(path.dirname(UPLOADS_FILE), { recursive: true });
  fs.writeFileSync(UPLOADS_FILE, JSON.stringify(list, null, 2), "utf8");
}

function getAllDocs() {
  return [...DOCS, ...loadUploadedDocs()];
}

function getGeminiClient() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get("/api/health", (_req, res) => {
  const keyConfigured = Boolean((process.env.GEMINI_API_KEY || "").trim());
  const uploaded = loadUploadedDocs();
  res.json({
    ok: true,
    geminiConfigured: keyConfigured,
    mode: keyConfigured ? "gemini" : "local-fallback",
    model: MODEL,
    knowledgeDocuments: DOCS.length + uploaded.length,
    builtInDocuments: DOCS.length,
    uploadedDocuments: uploaded.length
  });
});

app.get("/api/docs", (req, res) => {
  const userId = Number(req.query.userId);
  const user = USERS.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: "Unrecognised or missing employee session." });
  }
  const deptDocs = getAllDocs()
    .filter((d) => d.dept === user.dept)
    .map((d) => sanitizeDocForUser(user, d));
  res.json({ docs: deptDocs });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const user = USERS.find((u) => u.id === userId);
    if (!user) {
      return res.status(401).json({ error: "Sign in as a verified employee before uploading." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Choose a .pdf, .docx, .txt, or .md file to upload." });
    }

    const title = (req.body.title || req.file.originalname.replace(/\.[^.]+$/, "")).trim();
    const cat = (req.body.cat || "Departmental policies").trim();
    const st = ["cur", "sup", "dra", "rev"].includes(req.body.st) ? req.body.st : "cur";
    const cls = Math.min(user.lvl, Math.max(1, Number(req.body.cls || 1)));
    const ver = (req.body.ver || "1.0").trim();
    const owner = (req.body.owner || user.unit).trim();

    const text = await extractTextFromFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    if (!text) {
      return res.status(400).json({ error: "No readable text could be extracted from that file." });
    }

    const sections = splitIntoSections(text);
    const newDoc = {
      id: `up-${Date.now()}`,
      dept: user.dept,
      title: title || req.file.originalname,
      cat,
      owner,
      ver,
      st,
      date: new Date().toISOString().slice(0, 10),
      cls,
      src: `Uploaded file: ${req.file.originalname}`,
      sum: text.slice(0, 220).replace(/\s+/g, " ") + (text.length > 220 ? "…" : ""),
      sections,
      uploaded: true
    };

    const existing = loadUploadedDocs();
    existing.push(newDoc);
    saveUploadedDocs(existing);

    res.status(201).json({
      doc: sanitizeDocForUser(user, newDoc),
      sectionCount: sections.length
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not process uploaded file." });
  }
});

app.delete("/api/upload/:id", (req, res) => {
  const userId = Number(req.query.userId);
  const user = USERS.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: "Sign in first." });
  }
  const existing = loadUploadedDocs();
  const target = existing.find((d) => d.id === req.params.id && d.dept === user.dept);
  if (!target) {
    return res.status(404).json({ error: "Uploaded document not found in your department." });
  }
  if (target.cls > user.lvl) {
    return res.status(403).json({ error: "Insufficient clearance to remove this document." });
  }
  saveUploadedDocs(existing.filter((d) => d.id !== req.params.id));
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  try {
    const userId = Number(req.body?.userId);
    const question = String(req.body?.question || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    const user = USERS.find((u) => u.id === userId);
    if (!user) {
      return res.status(401).json({ error: "Unrecognised or expired employee session." });
    }
    if (!question) {
      return res.status(400).json({ error: "Please enter a question." });
    }

    const allDocs = getAllDocs();
    const retrieval = retrieveEvidence(user, allDocs, question, 7);
    const ai = getGeminiClient();

    if (!ai) {
      return res.json(buildLocalFallbackResponse(user, retrieval, allDocs));
    }

    // If the user asked specifically about a document above their clearance and nothing else matches
    if (retrieval.restrictedMatch && retrieval.hits.length === 0) {
      return res.json({
        answer:
          `A matching document ("${retrieval.restrictedMatch.title}") exists in ${user.dept}, ` +
          `but it is classified above your verified access level (${user.lvlName}). ` +
          `Contents cannot be disclosed. Contact ${retrieval.restrictedMatch.owner} to request access.`,
        sources: [],
        unknown: true,
        referral: retrieval.restrictedMatch.owner,
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
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Employee" : "GovGuide"}: ${m.text}`)
      .join("\n");

    const systemInstruction = `You are GovGuide AI, a careful South African public-sector policy and legislation assistant.
Logged-in employee: ${user.name}, ${user.title}, Department of ${user.dept}, clearance level ${user.lvlName}.

STRICT GROUNDING RULES:
1. Answer ONLY using the AUTHORISED PASSAGES provided below. Never invent legal sections, clauses, numbers, or policy rules not present in the passages.
2. Always cite the exact document title and section/clause in your answer.
3. Check document status carefully:
   - "sup" = Superseded: clearly warn the employee NOT to rely on it and point to its replacement document.
   - "dra" = Draft: clearly warn it is a draft only and NOT approved or in force.
   - "rev" = Under review: advise verifying with the document owner before relying on it.
4. If the passages do not contain enough evidence to answer the question reliably, set unknown=true, say clearly that you cannot answer from the available authorised documents, and set referral to "${retrieval.referral}".
5. Never reveal or speculate about restricted documents above the employee's clearance.${
      retrieval.restrictedMatch
        ? ` (Note: "${retrieval.restrictedMatch.title}" exists in the department but is above this employee's clearance — if relevant, mention only its restricted status and owner "${retrieval.restrictedMatch.owner}", never its contents.)`
        : ""
    }`;

    const userPrompt = `AUTHORISED DOCUMENT CATALOGUE (${user.dept}):
${authorisedSummaryList}

AUTHORISED PASSAGES RETRIEVED:
${evidenceBlock}

${recentHistory ? `RECENT CONVERSATION:\n${recentHistory}\n\n` : ""}CURRENT QUESTION:
${question}`;

    const response = await ai.models.generateContent({
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
            sources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Exact doc_id from the retrieved passages" },
                  section: { type: Type.STRING, description: "Exact section or clause cited" }
                },
                required: ["id", "section"]
              }
            }
          },
          required: ["answer", "unknown", "sources"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const validIds = new Set(
      allDocs.filter((d) => d.dept === user.dept && d.cls <= user.lvl).map((d) => d.id)
    );
    const cleanSources = (Array.isArray(parsed.sources) ? parsed.sources : []).filter(
      (s) => s && typeof s.id === "string" && validIds.has(s.id)
    );

    res.json({
      answer: parsed.answer || "I couldn't generate a grounded response.",
      unknown: Boolean(parsed.unknown),
      referral: parsed.unknown ? parsed.referral || retrieval.referral : null,
      sources: cleanSources,
      mode: "gemini"
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(502).json({
      error:
        err?.message ||
        "Gemini API request failed. Verify GEMINI_API_KEY and GEMINI_MODEL in .env."
    });
  }
});

app.listen(PORT, () => {
  const keySet = Boolean((process.env.GEMINI_API_KEY || "").trim());
  console.log(`GovGuide AI running at http://localhost:${PORT}`);
  console.log(
    keySet
      ? `Mode: Live Gemini (${MODEL})`
      : "Mode: Local Grounded Fallback (add GEMINI_API_KEY to .env for live Gemini)"
  );
});
