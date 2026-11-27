import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactPII } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOV_FILE = path.join(__dirname, "..", "data", "governance.json");

const DEFAULT_STATE = {
  auditLogs: [],
  accessRequests: [],
  feedback: [],
  knowledgeGaps: []
};

function loadState() {
  try {
    if (!fs.existsSync(GOV_FILE)) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(fs.readFileSync(GOV_FILE, "utf8"));
    return {
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      accessRequests: Array.isArray(parsed.accessRequests) ? parsed.accessRequests : [],
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
      knowledgeGaps: Array.isArray(parsed.knowledgeGaps) ? parsed.knowledgeGaps : []
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(GOV_FILE), { recursive: true });
  fs.writeFileSync(GOV_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function logAuditEvent({
  actor,
  action,
  targetId = null,
  department = null,
  outcome = "allowed",
  details = ""
}) {
  const state = loadState();
  const safeDetails = redactPII(details).text;
  const entry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actorId: actor?.id ?? null,
    actorName: actor?.name || "Anonymous",
    actorRole: actor?.role || "employee",
    actorClearance: actor?.lvlName || "Public",
    department: department || actor?.dept || "Public Legislation",
    action,
    targetId,
    outcome,
    details: safeDetails.slice(0, 260)
  };
  state.auditLogs.unshift(entry);
  state.auditLogs = state.auditLogs.slice(0, 500);
  saveState(state);
  return entry;
}

export function recordKnowledgeGap({ actor, department, question, topScore = 0 }) {
  const state = loadState();
  const safeQ = redactPII(question).text.trim().slice(0, 180);
  if (!safeQ) return null;
  const norm = safeQ.toLowerCase();
  const existing = state.knowledgeGaps.find(
    (g) => g.department === department && g.normalized === norm
  );
  if (existing) {
    existing.count += 1;
    existing.lastAskedAt = new Date().toISOString();
    existing.lastAskedBy = actor?.title || actor?.name || "Employee";
  } else {
    state.knowledgeGaps.unshift({
      id: `gap-${Date.now()}`,
      department,
      question: safeQ,
      normalized: norm,
      count: 1,
      topScore: Number(topScore.toFixed(2)),
      status: "open",
      lastAskedAt: new Date().toISOString(),
      lastAskedBy: actor?.title || actor?.name || "Employee"
    });
    state.knowledgeGaps = state.knowledgeGaps.slice(0, 200);
  }
  saveState(state);
  return true;
}

export function createAccessRequest({ user, docId, docTitle, owner, reason }) {
  const state = loadState();
  const safeReason = redactPII(reason || "Operational policy verification required.").text.trim();
  const duplicate = state.accessRequests.find(
    (r) => r.requesterId === user.id && r.docId === docId && r.status === "pending"
  );
  if (duplicate) {
    return duplicate;
  }
  const reqItem = {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    requesterId: user.id,
    requesterName: user.name,
    requesterTitle: user.title,
    requesterClearance: user.lvlName,
    department: user.dept,
    docId,
    docTitle,
    owner,
    reason: safeReason.slice(0, 300),
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null
  };
  state.accessRequests.unshift(reqItem);
  state.accessRequests = state.accessRequests.slice(0, 200);
  saveState(state);
  logAuditEvent({
    actor: user,
    action: "ACCESS_REQUEST_CREATED",
    targetId: docId,
    outcome: "pending_review",
    details: `Requested access to "${docTitle}" (owner: ${owner})`
  });
  return reqItem;
}

export function resolveAccessRequest({ resolver, requestId, status, note = "" }) {
  const state = loadState();
  const item = state.accessRequests.find(
    (r) => r.id === requestId && r.department === resolver.dept
  );
  if (!item) return null;
  item.status = status === "approved" ? "approved" : "declined";
  item.reviewedBy = `${resolver.name} (${resolver.title})`;
  item.reviewedAt = new Date().toISOString();
  item.reviewNote = redactPII(note).text.slice(0, 240);
  saveState(state);
  logAuditEvent({
    actor: resolver,
    action: `ACCESS_REQUEST_${item.status.toUpperCase()}`,
    targetId: item.docId,
    outcome: item.status,
    details: `${item.status} access request from ${item.requesterName} for ${item.docTitle}`
  });
  return item;
}

export function recordFeedback({ user, question, helpful, flagReason = "", docIds = [] }) {
  const state = loadState();
  const entry = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    department: user.dept,
    question: redactPII(question).text.slice(0, 180),
    helpful: Boolean(helpful),
    flagReason: redactPII(flagReason).text.slice(0, 240),
    docIds: Array.isArray(docIds) ? docIds.slice(0, 6) : []
  };
  state.feedback.unshift(entry);
  state.feedback = state.feedback.slice(0, 200);
  saveState(state);
  logAuditEvent({
    actor: user,
    action: entry.helpful ? "FEEDBACK_HELPFUL" : "FEEDBACK_FLAGGED",
    targetId: entry.docIds[0] || null,
    outcome: entry.helpful ? "positive" : "needs_review",
    details: entry.flagReason || `Question: ${entry.question}`
  });
  return entry;
}

export function getGovernanceSummary(user, allDocs) {
  const state = loadState();
  const isCitizen = user.role === "citizen";
  const deptDocs = isCitizen
    ? allDocs.filter((d) => d.cls === 1)
    : allDocs.filter((d) => d.dept === user.dept);

  const statusCounts = { cur: 0, sup: 0, dra: 0, rev: 0 };
  const clearanceCounts = { 1: 0, 2: 0, 3: 0 };
  let uploadedCount = 0;
  for (const d of deptDocs) {
    if (statusCounts[d.st] !== undefined) statusCounts[d.st] += 1;
    if (clearanceCounts[d.cls] !== undefined) clearanceCounts[d.cls] += 1;
    if (d.uploaded) uploadedCount += 1;
  }

  const deptFilter = (item) =>
    isCitizen ? item.department === "Public Legislation" : item.department === user.dept;

  const deptFeedback = state.feedback.filter(deptFilter);
  const helpfulCount = deptFeedback.filter((f) => f.helpful).length;
  const flaggedFeedback = deptFeedback.filter((f) => !f.helpful);

  const deptRequests = state.accessRequests.filter(deptFilter);
  const visibleRequests =
    user.lvl >= 3
      ? deptRequests
      : deptRequests.filter((r) => r.requesterId === user.id);

  const deptLogs = state.auditLogs.filter(deptFilter);
  const visibleLogs =
    user.lvl >= 3
      ? deptLogs.slice(0, 40)
      : deptLogs.filter((l) => l.actorId === user.id).slice(0, 20);

  const gaps = state.knowledgeGaps
    .filter(deptFilter)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const blockedCount = deptLogs.filter((l) => l.outcome === "blocked_clearance").length;
  const totalQueries = deptLogs.filter((l) => l.action === "QUERY_EXECUTED").length;

  return {
    scope: isCitizen ? "Public Legislation" : user.dept,
    canApproveRequests: user.role === "employee" && user.lvl >= 3,
    corpusHealth: {
      totalDocuments: deptDocs.length,
      authorisedForUser: deptDocs.filter((d) => d.cls <= user.lvl).length,
      uploadedDocuments: uploadedCount,
      statusCounts,
      clearanceCounts,
      currencyRate: deptDocs.length
        ? Math.round((statusCounts.cur / deptDocs.length) * 100)
        : 100
    },
    usage: {
      totalQueries,
      blockedClearanceAttempts: blockedCount,
      feedbackTotal: deptFeedback.length,
      helpfulRate: deptFeedback.length
        ? Math.round((helpfulCount / deptFeedback.length) * 100)
        : null,
      openFlags: flaggedFeedback.length,
      pendingAccessRequests: deptRequests.filter((r) => r.status === "pending").length
    },
    knowledgeGaps: gaps,
    accessRequests: visibleRequests,
    flaggedFeedback: user.lvl >= 3 ? flaggedFeedback.slice(0, 15) : [],
    auditLogs: visibleLogs
  };
}

function csvCell(val) {
  const s = String(val ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export function exportAuditCsv(user, allDocs) {
  const summary = getGovernanceSummary(user, allDocs);
  const headers = [
    "id",
    "timestamp",
    "actorName",
    "actorRole",
    "actorClearance",
    "department",
    "action",
    "targetId",
    "outcome",
    "details"
  ];
  const lines = [headers.join(",")];
  for (const row of summary.auditLogs) {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  }
  return lines.join("\r\n");
}
