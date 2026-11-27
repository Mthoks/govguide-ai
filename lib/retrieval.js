import { DIR } from "../data/knowledge.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "is", "are",
  "was", "were", "be", "with", "what", "which", "who", "how", "when", "where",
  "does", "do", "did", "can", "could", "should", "would", "about", "this",
  "that", "these", "those", "from", "by", "as", "at", "it", "its", "say",
  "says", "tell", "me", "please", "policy", "document", "still", "per"
]);

const LOW_SIGNAL_WORDS = new Set([
  "departmental", "department", "requirement", "requirements",
  "approve", "approving", "approval", "rules", "rule", "valid", "official", "government"
]);

function extractWords(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenize(text) {
  return extractWords(text).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function tokenMatchesWord(tok, word) {
  if (tok === word) return true;
  if (tok.length >= 4 && word.startsWith(tok)) return true;
  if (word.length >= 4 && tok.startsWith(word)) return true;
  return false;
}

export function canAccess(user, doc) {
  return doc.dept === user.dept && doc.cls <= user.lvl;
}

export function sanitizeDocForUser(user, doc) {
  const ok = canAccess(user, doc);
  return {
    id: doc.id,
    dept: doc.dept,
    title: ok ? doc.title : "Restricted document",
    cat: ok ? doc.cat : "Restricted",
    owner: ok ? doc.owner : null,
    ver: ok ? doc.ver : null,
    st: ok ? doc.st : "restricted",
    date: ok ? doc.date : null,
    cls: doc.cls,
    rep: ok ? doc.rep || null : null,
    src: ok ? doc.src : null,
    repository: ok ? doc.repository || null : null,
    url: ok ? doc.url || null : null,
    uploaded: ok && !!doc.uploaded,
    allowed: ok,
    sum: ok ? doc.sum : null,
    sections: ok ? doc.sections || [] : []
  };
}

/**
 * Retrieve the top matching sections from documents the user is cleared for.
 * Also detects if the user is asking about a restricted document in their
 * department or a superseded document with an active replacement.
 */
export function retrieveEvidence(user, allDocs, question, maxHits = 6) {
  const qTokens = tokenize(question);
  const qLower = (question || "").toLowerCase();

  const deptDocs = allDocs.filter((d) => d.dept === user.dept);
  const authorisedDocs = deptDocs.filter((d) => canAccess(user, d));
  const restrictedDocs = deptDocs.filter((d) => !canAccess(user, d));

  const scoreText = (text, boost = 1) => {
    const words = extractWords(text);
    let score = 0;
    const matched = new Set();
    for (const tok of qTokens) {
      if (words.some((w) => tokenMatchesWord(tok, w))) {
        const isLow = LOW_SIGNAL_WORDS.has(tok);
        score += boost * (isLow ? 0.35 : tok.length >= 5 ? 2 : 1.2);
        if (!isLow) matched.add(tok);
      }
    }
    return { score, matched };
  };

  // Check if question strongly matches a restricted document's title/category
  const restrictedMatches = restrictedDocs
    .map((d) => {
      const r = scoreText(`${d.title} ${d.cat} ${d.owner}`, 2);
      return { doc: d, score: r.score, hits: r.matched.size };
    })
    .filter((x) => x.score >= 3 && x.hits >= 1)
    .sort((a, b) => b.score - a.score);

  const hits = [];
  for (const d of authorisedDocs) {
    const docTitleRes = scoreText(`${d.title} ${d.cat} ${d.sum}`, 1.8);
    const sections =
      d.sections && d.sections.length
        ? d.sections
        : [{ sec: "Summary", text: d.sum || "" }];

    for (const s of sections) {
      const secRes = scoreText(`${s.sec} ${s.text}`, 1.5);
      const total = docTitleRes.score + secRes.score;
      const distinctSubstantive = new Set([...docTitleRes.matched, ...secRes.matched]).size;
      if (total > 0 && distinctSubstantive >= 1) {
        hits.push({
          doc: d,
          sec: s.sec,
          text: s.text,
          score: total,
          distinctSubstantive
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);

  // Deduplicate by doc+sec and keep top hits
  const topHits = hits.slice(0, maxHits);

  // If a superseded doc matched, make sure its replacement doc is also included
  const seenIds = new Set(topHits.map((h) => h.doc.id));
  for (const h of [...topHits]) {
    if (h.doc.st === "sup" && h.doc.rep && !seenIds.has(h.doc.rep)) {
      const repDoc = authorisedDocs.find((d) => d.id === h.doc.rep);
      if (repDoc && repDoc.sections?.length) {
        seenIds.add(repDoc.id);
        topHits.push({
          doc: repDoc,
          sec: repDoc.sections[0].sec,
          text: repDoc.sections[0].text,
          score: h.score - 0.1
        });
      }
    }
  }

  // Filter out very weak or off-topic secondary matches
  const topScore = topHits[0]?.score || 0;
  const minScore = Math.max(2.2, topScore * 0.35);
  const strongHits = topHits.filter((h) => h.score >= minScore);
  const asksHistoricalStatus =
    /\b(?:19\d{2}|20\d{2}|old|former|superseded|legacy|replaced|replacement|previous|prior|still valid)\b/.test(qLower);
  const answerableHits = asksHistoricalStatus
    ? strongHits
    : strongHits.filter(
      (hit) =>
        hit.doc.st !== "sup" ||
        !hit.doc.rep ||
        !strongHits.some((currentHit) => currentHit.doc.id === hit.doc.rep && currentHit.doc.st === "cur")
    );

  // Determine departmental referral office
  const deptDir = DIR[user.dept] || {};
  const isProjectQ = /project|budget|approv|tender|procure|expenditure/.test(qLower);
  const referral = isProjectQ && deptDir.project
    ? deptDir.project
    : deptDir.default || "Corporate Services / Legal Services";

  return {
    hits: answerableHits,
    restrictedMatch: restrictedMatches[0]?.doc || null,
    referral
  };
}

/**
 * Honest, grounded local response builder used when GEMINI_API_KEY is not configured.
 */
export function buildLocalFallbackResponse(user, retrieval, allDocs) {
  const { hits, restrictedMatch, referral } = retrieval;

  if (restrictedMatch && hits.length === 0) {
    return {
      answer:
        `A potentially relevant record is above your verified access level (${user.lvlName}), ` +
        `so its title and contents cannot be disclosed. Ask your departmental information owner about access.`,
      sources: [],
      unknown: true,
      referral: "Your departmental information owner",
      mode: "local-fallback"
    };
  }

  if (hits.length === 0) {
    return {
      answer:
        `I couldn't find enough reliable information in your authorised ${user.dept} ` +
        `knowledge base to answer that accurately, so I won't guess.`,
      sources: [],
      unknown: true,
      referral,
      mode: "local-fallback"
    };
  }

  const lines = [];
  const docMap = new Map();
  for (const h of hits.slice(0, 4)) {
    if (!docMap.has(h.doc.id)) docMap.set(h.doc.id, h.doc);
    let prefix = "";
    if (h.doc.st === "sup") {
      const rep = h.doc.rep ? allDocs.find((d) => d.id === h.doc.rep) : null;
      prefix = rep
        ? `[SUPERSEDED — replaced by ${rep.title} (v${rep.ver})] `
        : "[SUPERSEDED] ";
    } else if (h.doc.st === "dra") {
      prefix = "[DRAFT ONLY — NOT IN FORCE] ";
    } else if (h.doc.st === "rev") {
      prefix = "[UNDER REVIEW — verify with owner] ";
    }
    lines.push(`${prefix}${h.doc.title} (${h.sec}, v${h.doc.ver}): ${h.text}`);
  }

  if (restrictedMatch) {
    lines.push(
      `Note: "${restrictedMatch.title}" may also be relevant, but it is restricted above your ${user.lvlName} clearance.`
    );
  }

  return {
    answer: lines.join("\n\n"),
    sources: hits.slice(0, 4).map((h) => ({
      id: h.doc.id,
      title: h.doc.title,
      section: h.sec,
      version: h.doc.ver,
      status: h.doc.st,
      url: h.doc.url || null,
      repository: h.doc.repository || h.doc.src
    })),
    unknown: false,
    referral: null,
    mode: "local-fallback"
  };
}
