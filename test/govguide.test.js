import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { DOCS } from "../data/knowledge.js";
import {
  createSessionToken,
  getUserById,
  hashPassword,
  redactPII,
  verifyPassword
} from "../lib/security.js";
import {
  buildLocalFallbackResponse,
  retrieveEvidence,
  sanitizeDocForUser
} from "../lib/retrieval.js";
import { splitIntoSections } from "../lib/parser.js";
import { createApp, createCitedAnswer, generateWithFallback } from "../server.js";

process.env.GEMINI_API_KEY = "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_FILE = path.join(__dirname, "..", "data", "uploads.json");
const GOVERNANCE_FILE = path.join(__dirname, "..", "data", "governance.json");

async function withServer(run) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, { method = "GET", url = "/", headers = {}, body = null } = {}) {
  const requestHeaders = { ...headers };
  let requestBody = body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${url}`, { method, headers: requestHeaders, body: requestBody });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function cookieFor(user) {
  const token = createSessionToken(user);
  return `govguide_session=${encodeURIComponent(token)}`;
}

function buildMultipart({ filename, mimeType, content, fields = {} }) {
  const boundary = `----GovGuideBoundary${Date.now()}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--\r\n`
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.from(parts.join(""), "utf8")
  };
}

test("Security helpers hash passwords and redact personal identifiers", () => {
  const hash = hashPassword("StrongPass#2026");
  assert.equal(verifyPassword("StrongPass#2026", hash), true);
  assert.equal(verifyPassword("incorrect", hash), false);
  const redacted = redactPII("SA ID 9001015009087, email user@gov.za, phone 0821234567");
  assert.equal(redacted.redactedCount, 3);
  assert.doesNotMatch(redacted.text, /9001015009087|user@gov\.za|0821234567/);
});

test("RAG citations are limited to retrieved passages and include versioned source metadata", () => {
  const user = getUserById(1);
  const retrieval = retrieveEvidence(user, DOCS, "What is the overtime rate under BCEA?", 7);
  assert.ok(retrieval.hits.length > 0);

  const hit = retrieval.hits.find((item) => item.doc.id === "bcea") || retrieval.hits[0];
  const result = createCitedAnswer({
    claims: [{
      text: "The passage states the applicable overtime arrangement.",
      citations: [{ id: hit.doc.id, section: hit.sec }]
    }],
    unknown: false
  }, retrieval.hits);
  assert.ok(result);
  assert.match(result.answer, new RegExp(`v${hit.doc.ver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(result.sources[0].section, hit.sec);
  assert.equal(result.sources[0].version, hit.doc.ver);
  assert.equal(createCitedAnswer({
    claims: [{
      text: "Unsupported citation.",
      citations: [{ id: hit.doc.id, section: "Section 999 — invented" }]
    }],
    unknown: false
  }, retrieval.hits), null);

  const supersession = retrieveEvidence(
    user,
    DOCS,
    "Is Overtime Administration Circular 4 of 2019 still valid?",
    7
  );
  const oldPassage = supersession.hits.find((item) => item.doc.id === "ot19");
  assert.ok(oldPassage);
  const currentQuestion = retrieveEvidence(user, DOCS, "What are the overtime rules?", 7);
  assert.equal(currentQuestion.hits.some((item) => item.doc.id === "ot19"), false);
  const warned = createCitedAnswer({
    claims: [{
      text: "The cited circular describes the prior process.",
      citations: [{ id: oldPassage.doc.id, section: oldPassage.sec }]
    }],
    unknown: false
  }, supersession.hits);
  assert.match(warned.answer, /WARNING:.*superseded/i);
  assert.match(warned.answer, /Overtime Administration Circular 2 of 2024 v2\.0/);

  const local = buildLocalFallbackResponse(user, retrieval, DOCS);
  assert.ok(local.sources.length > 0);
  assert.ok(local.sources.every((source) => source.version && source.section));
});

test("Restricted documents expose neither title nor body through sanitized library records", () => {
  const sipho = getUserById(2);
  const restricted = DOCS.find((doc) => doc.id === "ben");
  const sanitized = sanitizeDocForUser(sipho, restricted);
  assert.equal(sanitized.allowed, false);
  assert.equal(sanitized.title, "Restricted document");
  assert.equal(sanitized.sum, null);
  assert.deepEqual(sanitized.sections, []);
  assert.equal(sanitized.url, null);
});

test("Parser keeps headings as searchable section citations", () => {
  const sections = splitIntoSections(
    "# Overtime Policy\n\n## Section 1 — Scope\nApplies to all staff.\n\n## Clause 2 — Limits\nMaximum 10 hours weekly."
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0].sec, "Section 1 — Scope");
  assert.equal(sections[1].sec, "Clause 2 — Limits");
});

test("Gemini provider failures try the backup model and identify unavailable backup models", async () => {
  const attemptedModels = [];
  const ai = {
    models: {
      async generateContent({ model }) {
        attemptedModels.push(model);
        throw Object.assign(new Error("provider request failed"), {
          status: model === "primary" ? 400 : 404
        });
      }
    }
  };

  const result = await generateWithFallback(ai, { model: "primary" }, "backup");

  assert.deepEqual(attemptedModels, ["primary", "backup"]);
  assert.equal(result.response, undefined);
  assert.equal(result.error.status, 404);
  assert.equal(result.reason, "model");
});

test("Gemini connection timeouts skip the backup model and return a network-fallback outcome", async () => {
  const attemptedModels = [];
  const timeoutError = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" }
  });
  const ai = {
    models: {
      async generateContent({ model }) {
        attemptedModels.push(model);
        throw timeoutError;
      }
    }
  };

  const result = await generateWithFallback(ai, { model: "primary" }, "backup");

  assert.deepEqual(attemptedModels, ["primary"]);
  assert.equal(result.error, timeoutError);
  assert.equal(result.reason, "network");
});

test("API requires a signed session and ignores caller-supplied user IDs", async (t) => {
  const originalGovernance = fs.existsSync(GOVERNANCE_FILE)
    ? fs.readFileSync(GOVERNANCE_FILE, "utf8")
    : null;
  t.after(() => {
    if (originalGovernance === null) {
      if (fs.existsSync(GOVERNANCE_FILE)) fs.unlinkSync(GOVERNANCE_FILE);
    } else {
      fs.writeFileSync(GOVERNANCE_FILE, originalGovernance, "utf8");
    }
  });
  await withServer(async (baseUrl) => {
    const anonymousDocs = await request(baseUrl, { url: "/api/docs?userId=1" });
    assert.equal(anonymousDocs.status, 401);
    const anonymousChat = await request(baseUrl, {
      method: "POST",
      url: "/api/chat",
      body: { userId: 1, question: "What are overtime rules?" }
    });
    assert.equal(anonymousChat.status, 401);

    const login = await request(baseUrl, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        email: "thandi.mokoena@labour.gov.za",
        employeeNumber: "11204567",
        password: "govguide"
      }
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const docs = await request(baseUrl, {
      url: "/api/docs?userId=2",
      headers: { Cookie: cookie }
    });
    assert.equal(docs.status, 200);
    assert.ok(docs.json.docs.some((doc) => doc.id === "ben" && doc.allowed));
    const levelOneDocs = await request(baseUrl, {
      url: "/api/docs",
      headers: { Cookie: cookieFor(getUserById(2)) }
    });
    const beneficiaryDoc = levelOneDocs.json.docs.find((doc) => doc.id === "ben");
    assert.equal(beneficiaryDoc.allowed, false);
    assert.equal(beneficiaryDoc.title, "Restricted document");
    assert.equal(beneficiaryDoc.sum, null);
    const chat = await request(baseUrl, {
      method: "POST",
      url: "/api/chat",
      headers: { Cookie: cookie },
      body: { userId: 2, question: "What are the overtime rules?" }
    });
    assert.equal(chat.status, 200);
    assert.ok(chat.json.sources.length > 0);
    assert.ok(chat.json.sources.every((source) => source.title && source.section && source.version));
    const contextualFollowUp = await request(baseUrl, {
      method: "POST",
      url: "/api/chat",
      headers: { Cookie: cookie },
      body: {
        question: "What about that?",
        history: [{ role: "user", text: "What are the overtime rules?" }]
      }
    });
    assert.equal(contextualFollowUp.status, 200);
    assert.ok(contextualFollowUp.json.sources.length > 0);
    const unrelatedQuestion = await request(baseUrl, {
      method: "POST",
      url: "/api/chat",
      headers: { Cookie: cookie },
      body: {
        question: "Explain the zyxwv quantum floop regulation.",
        history: [{ role: "user", text: "What are the overtime rules?" }]
      }
    });
    assert.equal(unrelatedQuestion.status, 200);
    assert.equal(unrelatedQuestion.json.unknown, true);
    assert.equal(unrelatedQuestion.json.sources.length, 0);
    const blockedWebImport = await request(baseUrl, {
      method: "POST",
      url: "/api/ingest/web",
      headers: { Cookie: cookie },
      body: { url: "https://example.com/policy", title: "Test", ver: "1.0", st: "cur" }
    });
    assert.equal(blockedWebImport.status, 400);
  });
});

test("Uploads are assigned to a simulated repository and removed through an authenticated route", async () => {
  const originalUploads = fs.existsSync(UPLOADS_FILE)
    ? fs.readFileSync(UPLOADS_FILE, "utf8")
    : null;
  const originalGovernance = fs.existsSync(GOVERNANCE_FILE)
    ? fs.readFileSync(GOVERNANCE_FILE, "utf8")
    : null;
  const cookie = cookieFor(getUserById(1));
  try {
    const multipart = buildMultipart({
      filename: "travel-policy.txt",
      mimeType: "text/plain",
      content: "Section 1 — Travel Subsistence\nDaily subsistence allowance is R450 per day.",
      fields: {
        title: "Travel Subsistence Policy",
        repository: "SharePoint",
        ver: "1.0",
        cls: "2",
        st: "cur"
      }
    });

    await withServer(async (baseUrl) => {
      const uploaded = await request(baseUrl, {
        method: "POST",
        url: "/api/upload",
        headers: { Cookie: cookie, "Content-Type": multipart.contentType },
        body: multipart.buffer
      });
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.json.doc.repository, "SharePoint");
      assert.equal(uploaded.json.sectionCount, 1);

      const removed = await request(baseUrl, {
        method: "DELETE",
        url: `/api/upload/${encodeURIComponent(uploaded.json.doc.id)}`,
        headers: { Cookie: cookie }
      });
      assert.equal(removed.status, 200);
    });
  } finally {
    if (originalUploads === null) {
      if (fs.existsSync(UPLOADS_FILE)) fs.unlinkSync(UPLOADS_FILE);
    } else {
      fs.writeFileSync(UPLOADS_FILE, originalUploads, "utf8");
    }
    if (originalGovernance === null) {
      if (fs.existsSync(GOVERNANCE_FILE)) fs.unlinkSync(GOVERNANCE_FILE);
    } else {
      fs.writeFileSync(GOVERNANCE_FILE, originalGovernance, "utf8");
    }
  }
});

test("Feedback endpoint records an authenticated rating without storing raw PII", async () => {
  const originalGovernance = fs.existsSync(GOVERNANCE_FILE)
    ? fs.readFileSync(GOVERNANCE_FILE, "utf8")
    : null;
  try {
    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        url: "/api/feedback",
        headers: { Cookie: cookieFor(getUserById(1)) },
        body: {
          question: "Can I contact user@example.gov.za about policy?",
          helpful: false,
          docIds: ["bcea", "not-authorised"]
        }
      });
      assert.equal(response.status, 201);
      const state = JSON.parse(fs.readFileSync(GOVERNANCE_FILE, "utf8"));
      assert.equal(state.feedback[0].question.includes("user@example.gov.za"), false);
      assert.deepEqual(state.feedback[0].docIds, ["bcea"]);
    });
  } finally {
    if (originalGovernance === null) {
      if (fs.existsSync(GOVERNANCE_FILE)) fs.unlinkSync(GOVERNANCE_FILE);
    } else {
      fs.writeFileSync(GOVERNANCE_FILE, originalGovernance, "utf8");
    }
  }
});
