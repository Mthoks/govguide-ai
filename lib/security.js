import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USERS } from "../data/knowledge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SECRET_FILE = path.join(DATA_DIR, ".session-secret");

export const SESSION_COOKIE = "govguide_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const CITIZEN_USER = Object.freeze({
  id: 0,
  role: "citizen",
  name: "Public Citizen",
  title: "Citizen Self-Service",
  dept: "Public Legislation",
  unit: "Public Access Portal",
  lvl: 1,
  lvlName: "Public"
});

const EMPLOYEE_REGISTRY = [
  { emp: "11204567", email: "thandi.mokoena@labour.gov.za", uid: 1 },
  { emp: "11208890", email: "sipho.dlamini@labour.gov.za", uid: 2 },
  { emp: "22013345", email: "lerato.naidoo@treasury.gov.za", uid: 3 }
];

let cachedSecret = null;
function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    return Buffer.from(process.env.SESSION_SECRET.trim(), "utf8");
  }
  if (cachedSecret) return cachedSecret;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (hex.length >= 64) {
        cachedSecret = Buffer.from(hex, "hex");
        return cachedSecret;
      }
    }
  } catch {
    // Fall through to generate a fresh secret
  }
  const fresh = crypto.randomBytes(32);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, fresh.toString("hex"), { encoding: "utf8", mode: 0o600 });
  } catch {
    // Keep in-memory secret if disk write is unavailable
  }
  cachedSecret = fresh;
  return cachedSecret;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Re-seed default demo account if corrupted
  }
  const seeded = {
    "thandi.mokoena@labour.gov.za": hashPassword("govguide")
  };
  saveAccounts(seeded);
  return seeded;
}

function saveAccounts(accounts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
}

export function findEmployeeRecord(email, empNo) {
  const normEmail = String(email || "").trim().toLowerCase();
  const normEmp = String(empNo || "").trim();
  return EMPLOYEE_REGISTRY.find((r) => r.email === normEmail && r.emp === normEmp) || null;
}

export function getUserById(userId) {
  if (userId === 0) return CITIZEN_USER;
  const emp = USERS.find((u) => u.id === userId);
  return emp ? { ...emp, role: "employee" } : null;
}

export function authenticateEmployee(email, empNo, password) {
  const rec = findEmployeeRecord(email, empNo);
  if (!rec) {
    return {
      ok: false,
      status: 403,
      code: "NOT_EMPLOYED",
      error:
        "We couldn't verify these details against the government employee registry. GovGuide employee workspaces are restricted to verified officials; citizens can use the Public Legislation Portal instead."
    };
  }
  const accounts = loadAccounts();
  const stored = accounts[rec.email];
  if (!stored) {
    return {
      ok: false,
      status: 401,
      code: "NOT_REGISTERED",
      error: "Your employment is verified, but you haven't registered yet. Choose Register to set your password."
    };
  }
  if (!verifyPassword(password, stored)) {
    return {
      ok: false,
      status: 401,
      code: "BAD_PASSWORD",
      error: "Incorrect password. Please try again."
    };
  }
  const user = getUserById(rec.uid);
  return { ok: true, user };
}

export function registerEmployee(email, empNo, password) {
  const rec = findEmployeeRecord(email, empNo);
  if (!rec) {
    return {
      ok: false,
      status: 403,
      code: "NOT_EMPLOYED",
      error:
        "We couldn't verify these details against the government employee registry. Contact your department's HR office if you believe this is an error."
    };
  }
  const accounts = loadAccounts();
  if (accounts[rec.email]) {
    return {
      ok: false,
      status: 409,
      code: "ALREADY_REGISTERED",
      error: "An account already exists for this employee record. Please sign in."
    };
  }
  if (typeof password !== "string" || password.length < 8) {
    return {
      ok: false,
      status: 400,
      code: "WEAK_PASSWORD",
      error: "Your password must be at least 8 characters long."
    };
  }
  accounts[rec.email] = hashPassword(password);
  saveAccounts(accounts);
  const user = getUserById(rec.uid);
  return { ok: true, user };
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function createSessionToken(user) {
  const payload = {
    uid: user.id,
    role: user.role || (user.id === 0 ? "citizen" : "employee"),
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(8).toString("hex")
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) {
      return null;
    }
    const user = getUserById(payload.uid);
    if (!user) return null;
    return user;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const cookies = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function extractSessionUser(req) {
  const cookies = parseCookies(req);
  const bearer = req.headers?.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim()
    : null;
  const headerToken = req.headers?.["x-session-token"];
  const token = cookies[SESSION_COOKIE] || bearer || headerToken;
  return verifySessionToken(token);
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/**
 * POPIA-aligned PII redaction before persisting queries to audit logs or sending to external models.
 * Masks South African 13-digit ID numbers, 8-digit PERSAL numbers, email addresses, and phone numbers.
 */
export function redactPII(text) {
  const raw = String(text || "");
  let redactedCount = 0;
  let cleaned = raw
    // 13-digit SA ID number
    .replace(/\b\d{13}\b/g, () => {
      redactedCount += 1;
      return "[REDACTED-SA-ID]";
    })
    // Email addresses
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
      redactedCount += 1;
      return "[REDACTED-EMAIL]";
    })
    // SA phone numbers (+27 or 06/07/08/01x)
    .replace(/(?:\+27|0)\s?(?:\d[\s-]?){8,9}\d\b/g, () => {
      redactedCount += 1;
      return "[REDACTED-PHONE]";
    })
    // 8-digit PERSAL employee number when preceded by PERSAL/employee context
    .replace(/\b(persal|employee\s*(?:no|number|id)?)\s*[:#]?\s*(\d{8})\b/gi, (_m, label) => {
      redactedCount += 1;
      return `${label} [REDACTED-PERSAL]`;
    });

  return { text: cleaned, redactedCount };
}

export function isSafeHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function createRateLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "local";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({
        error: "Too many requests. Please wait a moment before trying again."
      });
    }
    next();
  };
}
