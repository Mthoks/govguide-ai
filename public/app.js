const PUB_LIST = [
  {
    title: "Basic Conditions of Employment Act 75 of 1997",
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/basic-conditions-employment-act"
  },
  {
    title: "Labour Relations Act 66 of 1995",
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/labour-relations-act"
  },
  {
    title: "Employment Equity Act 55 of 1998",
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/employment-equity-act"
  },
  {
    title: "Public Finance Management Act 1 of 1999",
    src: "treasury.gov.za (National Treasury)",
    url: "https://www.treasury.gov.za/legislation/pfma/default.aspx"
  },
  {
    title: "Treasury Regulations for Departments",
    src: "treasury.gov.za (National Treasury)",
    url: "https://www.treasury.gov.za/legislation/pfma/default.aspx"
  }
];

const CATS = [
  "All",
  "Legislation",
  "Regulations",
  "Departmental policies",
  "Circulars",
  "Guidelines"
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zu", label: "isiZulu" },
  { code: "xh", label: "isiXhosa" },
  { code: "st", label: "Sesotho" },
  { code: "af", label: "Afrikaans" }
];

const ST = {
  cur: ["Current", "cur"],
  sup: ["Superseded", "sup"],
  dra: ["Draft", "dra"],
  rev: ["Under review", "rev"]
};

let U = null;
let DOCS = [];
let LINEAGE = { nodes: [], edges: [] };
let GOV_SUMMARY = null;
let healthInfo = null;
let view = "dash";
let cat = "All";
let stFilter = "All";
let q = "";
let showUpload = false;
let hc = false;
let fs = 16;
let themeMode = "auto";
let liteMode = false;
let language = "en";
let plainMode = false;
let msgs = [];
let tab = "in";

const $ = (s) => document.querySelector(s);
const E = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[c]));

const safeUrl = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
};

const doc = (id) => DOCS.find((d) => d.id === id);
const stTag = (d) => {
  const meta = ST[d.st] || ["Unknown", "lk"];
  return `<span class="tag ${meta[1]}">${E(meta[0])}</span>`;
};
const allowed = (d) =>
  d.allowed !== undefined ? d.allowed : d.role === "citizen" ? d.cls === 1 : d.dept === U.dept && d.cls <= U.lvl;

function toast(t) {
  const e = $("#toast");
  e.textContent = t;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3000);
}

if (window.location.protocol === "file:") {
  $("#fileWarn").style.display = "block";
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const text = await res.text();
  const payloadBytes = new Blob([text]).size;
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { res, data, payloadKb: (payloadBytes / 1024).toFixed(1) };
}

async function checkHealth() {
  const lh = $("#loginHealth");
  const cp = $("#connPill");
  if (window.location.protocol === "file:") {
    if (lh) lh.textContent = "Offline (opened as file:// instead of http://localhost:3000)";
    if (cp) {
      cp.textContent = "Server offline";
      cp.className = "status-pill bad";
    }
    return;
  }
  try {
    const { data: d } = await apiJson("/api/health");
    healthInfo = d;
    if (d.geminiConfigured) {
      if (lh) lh.textContent = `Connected · Gemini (${d.model}) · ${d.knowledgeDocuments} documents`;
      if (cp) {
        cp.textContent = `Gemini (${d.model})`;
        cp.className = "status-pill ok";
      }
    } else {
      if (lh) {
        lh.textContent = `Local Grounded Mode (BM25 + RBAC) · ${d.knowledgeDocuments} documents`;
      }
      if (cp) {
        cp.textContent = "Local Grounded Mode";
        cp.className = "status-pill local";
      }
    }
  } catch {
    if (lh) lh.textContent = "Backend unreachable — start the server with start-govguide.bat";
    if (cp) {
      cp.textContent = "Server offline";
      cp.className = "status-pill bad";
    }
  }
}

function authUI() {
  const up = tab === "up";
  $("#authbox").innerHTML = `
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="${!up}" data-t="in">Employee Sign in</button>
      <button role="tab" aria-selected="${up}" data-t="up">Verify & Register</button>
    </div>
    <form id="af" novalidate>
      <label>Government email
        <input id="ae" type="email" autocomplete="username" placeholder="name@department.gov.za">
      </label>
      <label>Employee (PERSAL) number
        <input id="an" inputmode="numeric" placeholder="8 digits">
      </label>
      <label>${up ? "Create password (8+ characters)" : "Password"}
        <input id="ap" type="password" autocomplete="${up ? "new-password" : "current-password"}">
      </label>
      <div id="aerr" role="alert"></div>
      <button class="btn" type="submit" style="width:100%">${up ? "Verify and register" : "Sign in"}</button>
    </form>
    <div class="citizen-box">
      <h3>Citizen Self-Service Portal</h3>
      <p style="margin:0.2rem 0 0.65rem;font-size:0.86rem;color:var(--ink)">
        Not a government employee? Browse and ask questions on <b>Public Level 1 Legislation</b> (BCEA, LRA, EEA, PFMA, Treasury Regulations) with strict isolation from internal circulars.
      </p>
      <button class="btn secondary sm" id="citizenBtn" type="button">Enter Public Citizen Portal</button>
    </div>
  `;

  document.querySelectorAll(".tabs button").forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.t;
      authUI();
    };
  });

  const err = (t) => {
    $("#aerr").innerHTML = `<div class="warn">${E(t)}</div>`;
  };

  $("#af").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#ae").value.trim().toLowerCase();
    const employeeNumber = $("#an").value.trim();
    const password = $("#ap").value;
    if (!email || !employeeNumber || !password) {
      return err("Fill in your email, employee number, and password.");
    }
    const endpoint = up ? "/api/auth/register" : "/api/auth/login";
    try {
      const { res, data } = await apiJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, employeeNumber, password })
      });
      if (!res.ok) {
        return err(data.error || "Authentication failed.");
      }
      if (up) {
        verified(data.user);
      } else {
        await enterWorkspace(data.user);
      }
    } catch {
      err("Could not reach the GovGuide authentication server.");
    }
  };

  $("#citizenBtn").onclick = async () => {
    try {
      const { res, data } = await apiJson("/api/auth/citizen", { method: "POST" });
      if (!res.ok) return toast(data.error || "Could not open Public Portal.");
      await enterWorkspace(data.user);
    } catch {
      toast("Backend unreachable.");
    }
  };
}

function verified(u) {
  $("#authbox").innerHTML = `
    <h2 style="font-size:1.25rem">Employment verified</h2>
    <p style="color:var(--mut);margin:0.3rem 0">Synced from server HR registry. Clearance cannot be edited by the client.</p>
    <dl>
      <dt>Name</dt><dd>${E(u.name)}</dd>
      <dt>Department</dt><dd>${E(u.dept)}</dd>
      <dt>Unit</dt><dd>${E(u.unit)}</dd>
      <dt>Job title</dt><dd>${E(u.title)}</dd>
      <dt>Access level</dt><dd>${E(u.lvlName)}</dd>
    </dl>
    <button class="btn" id="go" style="width:100%">Continue to my knowledge base</button>
  `;
  $("#go").onclick = () => enterWorkspace(u);
}

async function fetchDocs(queryText = q, category = cat, status = stFilter) {
  try {
    const params = new URLSearchParams();
    if (queryText) params.set("q", queryText);
    if (category && category !== "All") params.set("cat", category);
    if (status && status !== "All") params.set("st", status);
    const { res, data } = await apiJson(`/api/docs?${params.toString()}`);
    if (res.ok && Array.isArray(data.docs)) {
      DOCS = data.docs;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function fetchLineage() {
  try {
    const { res, data } = await apiJson("/api/lineage");
    if (res.ok && Array.isArray(data.nodes)) {
      LINEAGE = data;
    }
  } catch {
    // ignore
  }
}

async function fetchGovernance() {
  try {
    const { res, data } = await apiJson("/api/governance/summary");
    if (res.ok) {
      GOV_SUMMARY = data;
    }
  } catch {
    // ignore
  }
}

async function enterWorkspace(user) {
  U = user;
  msgs = [];
  view = "dash";
  cat = "All";
  stFilter = "All";
  q = "";
  showUpload = false;
  $("#login").style.display = "none";
  $("#app").style.display = "block";
  $("#who").innerHTML = `<b>${E(U.name)}</b><br><span>${E(U.title)} · ${E(U.dept)} (${E(U.lvlName)})</span>`;
  await checkHealth();
  await fetchDocs("", "All", "All");
  render();
  window.scrollTo(0, 0);
}

$("#out").onclick = async () => {
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  U = null;
  DOCS = [];
  GOV_SUMMARY = null;
  tab = "in";
  authUI();
  $("#app").style.display = "none";
  $("#login").style.display = "block";
  closeDrawer();
  checkHealth();
};

// Accessibility & Low-Bandwidth Controls
function setFs(n) {
  fs = Math.min(22, Math.max(13, n));
  document.documentElement.style.setProperty("--fs", `${fs}px`);
}
$("#tA-").onclick = () => setFs(fs - 1);
$("#tA+").onclick = () => setFs(fs + 1);
$("#tHC").onclick = (e) => {
  hc = !hc;
  e.target.setAttribute("aria-pressed", String(hc));
  if (hc) document.documentElement.setAttribute("data-contrast", "hi");
  else document.documentElement.removeAttribute("data-contrast");
};
$("#tTheme").onclick = (e) => {
  const order = ["auto", "light", "dark"];
  themeMode = order[(order.indexOf(themeMode) + 1) % order.length];
  if (themeMode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", themeMode);
  e.target.textContent = `Theme: ${themeMode[0].toUpperCase()}${themeMode.slice(1)}`;
};
$("#tLite").onclick = (e) => {
  liteMode = !liteMode;
  e.target.setAttribute("aria-pressed", String(liteMode));
  if (liteMode) document.documentElement.setAttribute("data-lite", "true");
  else document.documentElement.removeAttribute("data-lite");
  toast(liteMode ? "Low-bandwidth Lite Mode enabled." : "Standard visual mode restored.");
};

function render() {
  const navCounts = {};
  for (const c of CATS) {
    navCounts[c] = c === "All" ? DOCS.length : DOCS.filter((d) => d.cat === c).length;
  }

  $("#side").innerHTML =
    `<button data-v="dash" aria-current="${view === "dash"}">Knowledge library</button>` +
    `<button data-v="chat" aria-current="${view === "chat"}">Ask GovGuide</button>` +
    `<button data-v="lineage" aria-current="${view === "lineage"}">Lineage & compliance</button>` +
    `<button data-v="governance" aria-current="${view === "governance"}">Governance & insights</button>` +
    `<h3>Categories</h3>` +
    CATS.map(
      (c) =>
        `<button data-c="${E(c)}" aria-current="${view === "dash" && cat === c}"><span>${E(c)}</span><span>${navCounts[c]}</span></button>`
    ).join("");

  document.querySelectorAll("#side [data-v]").forEach((b) => {
    b.onclick = async () => {
      view = b.dataset.v;
      if (view === "dash" && q === "" && cat === "All" && stFilter === "All") {
        await fetchDocs("", "All", "All");
      }
      if (view === "lineage") await fetchLineage();
      if (view === "governance") await fetchGovernance();
      render();
    };
  });

  document.querySelectorAll("#side [data-c]").forEach((b) => {
    b.onclick = async () => {
      view = "dash";
      cat = b.dataset.c;
      await fetchDocs(q, cat, stFilter);
      render();
    };
  });

  if (view === "dash") dash();
  else if (view === "chat") chat();
  else if (view === "lineage") renderLineage();
  else renderGovernance();
}

function dash() {
  const isEmployee = U.role === "employee";
  const lvlOpts = [1, 2, 3]
    .filter((l) => l <= U.lvl)
    .map((l) => `<option value="${l}">${["", "Public", "Internal", "Confidential"][l]}</option>`)
    .join("");
  const parentOpts = [
    `<option value="">None (top-level Act/Policy)</option>`,
    ...DOCS.filter(allowed).map((d) => `<option value="${E(d.id)}">${E(d.title)}</option>`)
  ].join("");

  $("#main").innerHTML = `
    <div class="headrow">
      <div>
        <h1 style="font-size:1.7rem">${E(U.dept)}</h1>
        <div class="stats">
          <span>${DOCS.length} matching documents</span>
          <span>${DOCS.filter(allowed).length} authorised for your level</span>
          <span>${DOCS.filter((d) => d.st === "sup").length} superseded</span>
        </div>
      </div>
      ${
        isEmployee
          ? `<button class="btn sm" id="upBtn">${showUpload ? "Close upload" : "+ Upload policy / PDF / Word"}</button>`
          : `<span class="tag cur">Citizen Public Mode (Level 1)</span>`
      }
    </div>
    ${
      showUpload && isEmployee
        ? `<form class="upbox" id="upForm">
            <b>Upload & auto-index a policy document into ${E(U.dept)}</b>
            <div class="upgrid">
              <label>File (.pdf, .docx, .txt, .md)<input id="upFile" type="file" accept=".pdf,.docx,.txt,.md" required></label>
              <label>Title (optional)<input id="upTitle" placeholder="Defaults to filename"></label>
              <label>Category<select id="upCat">${CATS.filter((c) => c !== "All").map((c) => `<option>${E(c)}</option>`).join("")}</select></label>
              <label>Status<select id="upSt"><option value="cur">Current</option><option value="dra">Draft</option><option value="rev">Under review</option><option value="sup">Superseded</option></select></label>
              <label>Clearance level<select id="upCls">${lvlOpts}</select></label>
              <label>Version<input id="upVer" value="1.0"></label>
              <label>Parent legislation (optional)<select id="upParent">${parentOpts}</select></label>
            </div>
            <div id="upErr"></div>
            <button class="btn sm" type="submit" id="upSubmit">Process & add to knowledge base</button>
          </form>`
        : ""
    }
    <div class="search">
      <input id="sq" type="search" placeholder="Full-text search across titles, summaries & internal sections (e.g. 30 days, CCMA, 1.5x)" aria-label="Search documents" value="${E(q)}">
      <button class="btn" id="sb">Search</button>
      ${q ? `<button class="btn ghost sm" id="clearSq">Clear</button>` : ""}
    </div>
    <div class="filter-row" role="group" aria-label="Status filter">
      ${[
        ["All", "All statuses"],
        ["cur", "Current"],
        ["sup", "Superseded"],
        ["dra", "Draft"],
        ["rev", "Under review"]
      ]
        .map(
          ([k, label]) =>
            `<button class="pill-btn" data-st="${k}" aria-pressed="${stFilter === k}">${label}</button>`
        )
        .join("")}
    </div>
    <div class="dl">
      ${
        DOCS.map(
          (d) => `
          <button class="doc ${allowed(d) ? "" : "lock"}" data-d="${E(d.id)}">
            <span class="t">
              <b>${E(d.title)}</b>
              <small>${E(d.cat)} · Owner: ${E(d.owner)} · v${E(d.ver)}${d.url ? " · Public gazette/source" : ""}${d.uploaded ? " · Uploaded" : ""}</small>
              ${
                d.matchedSections && d.matchedSections.length
                  ? `<div class="sec-hits">${d.matchedSections.map((s) => `<span class="sec-hit">Match: ${E(s)}</span>`).join("")}</div>`
                  : ""
              }
            </span>
            ${allowed(d) ? "" : '<span class="tag lk">Restricted</span>'}
            ${stTag(d)}
          </button>`
        ).join("") ||
        `<p>No documents matched that filter. Try different keywords, or use <b>Ask GovGuide</b> for BM25 semantic synonym search.</p>`
      }
    </div>
  `;

  if ($("#upBtn")) {
    $("#upBtn").onclick = () => {
      showUpload = !showUpload;
      render();
    };
  }

  if (showUpload && $("#upForm")) {
    $("#upForm").onsubmit = async (e) => {
      e.preventDefault();
      const file = $("#upFile").files[0];
      if (!file) return;
      const btn = $("#upSubmit");
      btn.disabled = true;
      btn.textContent = "Extracting & indexing sections…";
      $("#upErr").innerHTML = "";
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", $("#upTitle").value.trim());
      fd.append("cat", $("#upCat").value);
      fd.append("st", $("#upSt").value);
      fd.append("cls", $("#upCls").value);
      fd.append("ver", $("#upVer").value.trim() || "1.0");
      fd.append("parentId", $("#upParent").value);
      try {
        const { res, data } = await apiJson("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error(data.error || "Upload failed.");
        showUpload = false;
        await fetchDocs(q, cat, stFilter);
        await checkHealth();
        toast(`Added "${data.doc.title}" (${data.sectionCount} searchable sections).`);
        render();
      } catch (err) {
        $("#upErr").innerHTML = `<div class="warn">${E(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = "Process & add to knowledge base";
      }
    };
  }

  const runSearch = async () => {
    q = $("#sq").value.trim();
    await fetchDocs(q, cat, stFilter);
    render();
    $("#sq") && $("#sq").focus();
  };
  $("#sb").onclick = runSearch;
  $("#sq").onkeydown = (e) => {
    if (e.key === "Enter") runSearch();
  };
  if ($("#clearSq")) {
    $("#clearSq").onclick = async () => {
      q = "";
      await fetchDocs("", cat, stFilter);
      render();
    };
  }
  document.querySelectorAll("[data-st]").forEach((b) => {
    b.onclick = async () => {
      stFilter = b.dataset.st;
      await fetchDocs(q, cat, stFilter);
      render();
    };
  });
  document.querySelectorAll("[data-d]").forEach((b) => {
    b.onclick = () => openDoc(b.dataset.d);
  });
}

function chat() {
  const langOptions = LANGUAGES.map(
    (l) => `<option value="${l.code}" ${language === l.code ? "selected" : ""}>${E(l.label)}</option>`
  ).join("");

  $("#main").innerHTML = `
    <div class="chat">
      <div class="chat-toolbar">
        <div>
          <b>Ask GovGuide AI</b>
          <span style="font-size:0.82rem;color:var(--mut);margin-left:0.4rem">BM25 + RBAC + POPIA PII Shield</span>
        </div>
        <div class="chat-opts">
          <label>Language:
            <select id="langSel" aria-label="Response language">${langOptions}</select>
          </label>
          <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer">
            <input type="checkbox" id="plainChk" ${plainMode ? "checked" : ""}> Plain Language
          </label>
        </div>
      </div>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <div class="qa" id="qa"></div>
      <form class="composer" id="cf">
        <button type="button" class="mic" id="mic" aria-label="Use voice input" title="Voice input">🎤</button>
        <input id="ci" placeholder="Ask about legislation, policy, overtime, tenders, or procedures…" aria-label="Your question" autocomplete="off">
        <button class="btn" type="submit">Ask</button>
      </form>
      <div class="disc">
        ${
          healthInfo?.geminiConfigured
            ? `Gemini-powered (${E(healthInfo.model)})`
            : "Local Grounded Mode (BM25 + Statutory Rules)"
        } · Queries are scrubbed for ID/PERSAL numbers (POPIA) and verified against your ${E(U.lvlName)} clearance.
      </div>
    </div>
  `;

  $("#langSel").onchange = (e) => {
    language = e.target.value;
    toast(`Language set to ${LANGUAGES.find((l) => l.code === language)?.label || language}.`);
  };
  $("#plainChk").onchange = (e) => {
    plainMode = e.target.checked;
    toast(plainMode ? "Plain Language mode on." : "Standard detail mode on.");
  };

  let ex = [];
  if (U.role === "citizen") {
    ex = [
      "What are the maximum overtime hours under the BCEA?",
      "What makes a dismissal unfair under the Labour Relations Act?",
      "Within how many days must government pay creditors?",
      "What does the Employment Equity Act say about discrimination?"
    ];
  } else if (U.dept === "National Treasury") {
    ex = [
      "Which legislation governs public financial management?",
      "What do Treasury Regulations say about paying creditors within 30 days?",
      "What is required for a Bid Evaluation Committee?",
      "What are the requirements for approving a departmental project?"
    ];
  } else {
    ex = [
      "What are the overtime rules?",
      "Is Overtime Circular 4 of 2019 still valid?",
      "What does the policy say about beneficiary selection?",
      "What does the draft remote work policy say?",
      "What are the requirements for approving a departmental project?"
    ];
  }

  $("#qa").innerHTML = msgs.length
    ? ""
    : ex.map((e) => `<button class="chip" type="button">${E(e)}</button>`).join("");
  document.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => ask(c.textContent);
  });
  $("#cf").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#ci").value.trim();
    if (v) {
      $("#ci").value = "";
      ask(v);
    }
  };
  $("#mic").onclick = voice;

  if (!msgs.length) {
    msgs.push({
      r: "a",
      plain: `Hello ${U.name.split(" ")[0]}. Ask me about ${U.dept} documents.`,
      html: `<p>Hello ${E(U.name.split(" ")[0])}. Ask me about documents in <b>${E(U.dept)}</b>. I check document status (superseded/draft/under review), enforce your <b>${E(U.lvlName)}</b> clearance, generate compliance checklists, and explain why each source matched.</p>`,
      docs: []
    });
  }
  paint();
}

function paint() {
  const el = $("#msgs");
  if (!el) return;

  el.innerHTML = msgs
    .map((m, i) => {
      if (m.r === "u") {
        return `<div class="m u">${E(m.t)}</div>`;
      }
      const sourcesHtml =
        m.docs && m.docs.length
          ? `<div class="src"><b style="font-size:0.82rem">Verified Sources</b>${m.docs
              .map(([id, sec]) => {
                const d = doc(id);
                if (!d) return "";
                return `<button class="sc" data-d="${E(id)}"><b>${E(d.title)}</b><span>${E(sec)}</span><span>v${E(d.ver)}</span>${stTag(d)}</button>`;
              })
              .join("")}</div>`
          : "";

      const fbHtml =
        i > 0 && !m.loading
          ? `<div class="fb" data-mi="${i}">
              <span>Human oversight:</span>
              <button aria-label="Helpful" data-f="1">👍 Helpful</button>
              <button aria-label="Flag for review" data-f="0">🚩 Flag for policy review</button>
              ${m.plain ? `<button class="speak-btn" data-speak="${i}" type="button">🔊 Listen</button>` : ""}
              ${m.payloadKb ? `<span style="margin-left:auto">Payload: ${E(m.payloadKb)} KB</span>` : ""}
            </div>`
          : "";

      return `<div class="m a">${m.html}${sourcesHtml}${fbHtml}</div>`;
    })
    .join("");

  el.querySelectorAll(".sc").forEach((b) => {
    b.onclick = () => openDoc(b.dataset.d);
  });

  el.querySelectorAll(".req-access-btn").forEach((b) => {
    b.onclick = async () => {
      const docId = b.dataset.docid;
      const reason = window.prompt("Briefly state your operational reason for requesting access:", "Policy verification for departmental case");
      if (reason === null) return;
      try {
        const { res, data } = await apiJson("/api/access-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, reason })
        });
        if (!res.ok) throw new Error(data.error || "Failed to create request.");
        toast("Access request logged for Level 3 Director review.");
        b.disabled = true;
        b.textContent = "Access Request Submitted";
      } catch (err) {
        toast(err.message);
      }
    };
  });

  el.querySelectorAll(".fb button[data-f]").forEach((b) => {
    b.onclick = async () => {
      const mi = Number(b.parentNode.dataset.mi);
      const helpful = b.dataset.f === "1";
      const msg = msgs[mi] || {};
      let flagReason = "";
      if (!helpful) {
        const input = window.prompt("What needs policy review or correction?", "Needs clearer guidance or updated circular");
        if (input === null) return;
        flagReason = input;
      }
      b.parentNode.querySelectorAll("button[data-f]").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      try {
        await apiJson("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: msg.question || "",
            helpful,
            flagReason,
            docIds: (msg.docs || []).map(([id]) => id)
          })
        });
        toast(helpful ? "Feedback recorded in governance log." : "Flagged for policy owner review.");
      } catch {
        toast("Could not save feedback.");
      }
    };
  });

  el.querySelectorAll(".speak-btn").forEach((b) => {
    b.onclick = () => {
      const mi = Number(b.dataset.speak);
      const text = msgs[mi]?.plain || "";
      if (!("speechSynthesis" in window) || !text) {
        return toast("Text-to-speech is not supported in this browser.");
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-ZA";
      window.speechSynthesis.speak(u);
      toast("Reading answer aloud…");
    };
  });

  el.scrollTop = el.scrollHeight;
}

async function ask(t) {
  msgs.push({ r: "u", t });
  const qa = $("#qa");
  if (qa) qa.innerHTML = "";
  paint();

  const loading = { r: "a", html: "<p>Running BM25 retrieval & clearance checks…</p>", docs: [], loading: true };
  msgs.push(loading);
  paint();

  try {
    if (window.location.protocol === "file:") {
      throw new Error("Opened from disk (file://). Run start-govguide.bat and open http://localhost:3000.");
    }
    const history = msgs
      .slice(0, -1)
      .slice(-10)
      .map((m) => ({
        role: m.r === "u" ? "user" : "assistant",
        text: m.r === "u" ? m.t : m.plain || ""
      }))
      .filter((m) => m.text);

    const { res, data, payloadKb } = await apiJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: t, history, language, plainMode })
    });

    if (!res.ok) throw new Error(data.error || "The AI service could not complete your request.");

    const safeText = E(data.answer || "I couldn’t generate a reliable answer.").replace(/\n/g, "<br>");
    const piiBanner =
      data.piiRedactedCount > 0
        ? `<div class="info"><b>POPIA Privacy Shield:</b> Automatically redacted ${data.piiRedactedCount} sensitive identifier(s) from your query before processing and logging.</div>`
        : "";

    const diffHtml = (data.supersessionAlerts || [])
      .map(
        (s) => `
        <div class="diff-box">
          <b>⚠️ Supersession Alert: ${E(s.supersededTitle)} was replaced by ${E(s.replacementTitle)} (v${E(s.replacementVer)})</b>
          <div class="diff-grid">
            <div class="diff-old"><b>Old Rule (Superseded ${E(s.supersededDate)}):</b><br>${E(s.oldRule)}</div>
            <div class="diff-new"><b>Active Rule (Effective ${E(s.replacementDate)}):</b><br>${E(s.newRule)}</div>
          </div>
        </div>`
      )
      .join("");

    const checklistHtml =
      data.checklists && data.checklists.length
        ? `<div class="checklist">
            <h4>Actionable Compliance Checklist</h4>
            ${data.checklists
              .map(
                (c) => `
                <label class="chk-item ${E(c.level)}">
                  <input type="checkbox">
                  <span>${E(c.text)}</span>
                </label>`
              )
              .join("")}
          </div>`
        : "";

    const explainHtml =
      data.explain && data.explain.length
        ? `<details class="explain">
            <summary>Why this answer? (${data.explain.length} verified evidence passage(s) · RBAC passed)</summary>
            ${data.explain
              .map(
                (ex) => `
                <div class="explain-row">
                  <b>${E(ex.title)}</b>
                  <span>(${E(ex.section)})</span>
                  <span class="tag cur">${E(ex.confidence)}% match</span>
                  <span>BM25: ${E(ex.score)}</span>
                  <span>Terms: ${E((ex.matchedTerms || []).join(", "))}</span>
                </div>`
              )
              .join("")}
          </details>`
        : "";

    const restrictedBtn =
      data.restrictedMatch && U.role === "employee"
        ? `<p><button class="btn sm secondary req-access-btn" data-docid="${E(data.restrictedMatch.id)}" type="button">Request Access from ${E(data.restrictedMatch.owner)}</button></p>`
        : "";

    const modeNote =
      data.mode === "local-fallback"
        ? "Grounded local retrieval (BM25 + statutory rules, no GEMINI_API_KEY configured). Verify the cited source before acting."
        : `Gemini-powered (${E(healthInfo?.model || "gemini")}) grounded exclusively in your authorised knowledge base.`;

    msgs[msgs.length - 1] = {
      r: "a",
      question: t,
      plain: data.answer || "",
      payloadKb,
      html:
        piiBanner +
        (data.unknown ? '<div class="info"><b>Insufficient evidence or restricted access.</b></div>' : "") +
        `<p>${safeText}</p>` +
        diffHtml +
        checklistHtml +
        (data.referral ? `<p><b>Suggested referral:</b> ${E(data.referral)}</p>` : "") +
        restrictedBtn +
        explainHtml +
        `<p class="disc">${modeNote}</p>`,
      docs: (data.sources || []).map((s) => [s.id, s.section || "Relevant source document"]),
      unknown: !!data.unknown
    };
  } catch (err) {
    msgs[msgs.length - 1] = {
      r: "a",
      html: `<div class="warn"><b>Unable to reach GovGuide AI.</b><p>${E(err.message || "Check that the GovGuide server is running.")}</p></div>`,
      docs: []
    };
  }
  paint();
}

function voice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast("Voice input isn’t supported in this browser. Type your question instead.");
    return;
  }
  try {
    const r = new SR();
    r.lang = "en-ZA";
    const b = $("#mic");
    b.classList.add("on");
    r.onresult = (e) => {
      $("#ci").value = e.results[0][0].transcript;
    };
    r.onend = () => b.classList.remove("on");
    r.onerror = () => {
      b.classList.remove("on");
      toast("Couldn’t hear you. Check microphone permission.");
    };
    r.start();
  } catch {
    toast("Voice input is unavailable here.");
  }
}

function renderLineage() {
  const nodes = LINEAGE.nodes || [];
  const byParent = new Map();
  const roots = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const n of nodes) {
    if (n.parentId && nodeIds.has(n.parentId) && n.parentId !== n.id) {
      const list = byParent.get(n.parentId) || [];
      list.push(n);
      byParent.set(n.parentId, list);
    } else {
      roots.push(n);
    }
  }

  const renderNodeTree = (n, depth = 0) => {
    const children = byParent.get(n.id) || [];
    return `
      <div>
        <button class="node-item" data-d="${E(n.id)}" type="button">
          <span>
            <b>${E(n.title)}</b><br>
            <small style="color:var(--mut)">${E(n.cat)} · v${E(n.ver)} · ${E(n.date)}${n.rep ? " · Replaced" : ""}</small>
          </span>
          ${stTag(n)}
        </button>
        ${
          children.length && depth < 4
            ? `<div class="node-children">${children.map((c) => renderNodeTree(c, depth + 1)).join("")}</div>`
            : ""
        }
      </div>
    `;
  };

  $("#main").innerHTML = `
    <div class="headrow">
      <div>
        <h1 style="font-size:1.7rem">Policy Lineage & Compliance Tools</h1>
        <p style="color:var(--mut);margin:0.25rem 0 0">Trace how departmental circulars implement primary legislation, spot superseded rules, and run live statutory compliance checks.</p>
      </div>
    </div>
    <div class="grid-2">
      <div class="tree-card">
        <h2 style="font-size:1.15rem;margin-bottom:0.6rem">Legislation-to-Circular Lineage</h2>
        ${roots.length ? roots.map((r) => renderNodeTree(r)).join("") : "<p>No lineage nodes available.</p>"}
      </div>
      <div class="tree-card">
        <h2 style="font-size:1.15rem;margin-bottom:0.6rem">Interactive Compliance Checker</h2>
        <div class="filter-row">
          <button class="pill-btn" id="simOtBtn" aria-pressed="true" type="button">Overtime (BCEA & Circular 2/2024)</button>
          <button class="pill-btn" id="simScmBtn" aria-pressed="false" type="button">PFMA Payment & BEC Readiness</button>
        </div>
        <div id="simArea"></div>
      </div>
    </div>
  `;

  document.querySelectorAll(".tree-card [data-d]").forEach((b) => {
    b.onclick = () => openDoc(b.dataset.d);
  });

  const renderOtSim = () => {
    $("#simArea").innerHTML = `
      <form class="sim-form" id="otSimForm">
        <label>Ordinary weekly hours worked
          <input type="number" id="simOrd" value="40" min="0" max="80">
        </label>
        <label>Requested overtime hours this week
          <input type="number" id="simWkOt" value="6" min="0" max="40">
        </label>
        <label>Total overtime hours this month (including this request)
          <input type="number" id="simMoOt" value="12" min="0" max="100">
        </label>
        <label>Approval method
          <select id="simApp">
            <option value="ehr">Prior electronic HR workflow approval</option>
            <option value="emerg">Emergency inspection (48h post-facto motivation)</option>
            <option value="hr14">Manual Form HR-14 (2019 Circular)</option>
            <option value="none">No approval obtained</option>
          </select>
        </label>
        <label>Day worked
          <select id="simDay">
            <option value="weekday">Weekday / Saturday (1.5x rate)</option>
            <option value="sunday">Sunday / Public holiday (2x rate if not ordinary)</option>
          </select>
        </label>
        <button class="btn sm" type="submit">Evaluate Compliance</button>
      </form>
      <div id="simResult" style="margin-top:0.75rem"></div>
    `;
    $("#otSimForm").onsubmit = (e) => {
      e.preventDefault();
      const ord = Number($("#simOrd").value);
      const wkOt = Number($("#simWkOt").value);
      const moOt = Number($("#simMoOt").value);
      const app = $("#simApp").value;
      const day = $("#simDay").value;

      const flags = [];
      const notes = [];
      if (ord > 45) flags.push("BCEA s9 breach: Ordinary hours exceed 45 hours/week.");
      if (wkOt > 10) flags.push("BCEA s10 breach: Weekly overtime exceeds statutory 10 hours/week cap.");
      if (app === "hr14") flags.push("Superseded form: Form HR-14 (Circular 4 of 2019) was replaced on 2024-02-01 by Circular 2 of 2024.");
      if (app === "none") flags.push("Circular 2 of 2024 Clause 3 breach: Prior written electronic HR approval is mandatory.");
      if (moOt > 15) notes.push("Circular 2 of 2024 Clause 4: >15 hours/month requires Chief Director sign-off AND Finance budget confirmation.");
      else notes.push("Within supervisor approval threshold (<=15 hours/month).");
      notes.push(day === "sunday" ? "Compensation: 2x basic hourly rate (BCEA s16 / Clause 4) or agreed commuted time off." : "Compensation: 1.5x basic hourly rate (BCEA s10 / Clause 4) or agreed paid time off.");

      $("#simResult").innerHTML = flags.length
        ? `<div class="warn"><b>Non-Compliant / Action Required:</b><ul>${flags.map((f) => `<li>${E(f)}</li>`).join("")}</ul></div><div class="info">${notes.map((n) => `<div>• ${E(n)}</div>`).join("")}</div>`
        : `<div class="okbox"><b>Compliant with BCEA & Circular 2 of 2024:</b>${notes.map((n) => `<div>• ${E(n)}</div>`).join("")}</div>`;
    };
  };

  const renderScmSim = () => {
    $("#simArea").innerHTML = `
      <form class="sim-form" id="scmSimForm">
        <label>Days since valid creditor invoice received
          <input type="number" id="simDays" value="24" min="0" max="180">
        </label>
        <label>Bid Evaluation Committee (BEC) officials present
          <input type="number" id="simBec" value="3" min="0" max="15">
        </label>
        <label>Declarations of interest signed before opening bids?
          <select id="simDoi">
            <option value="yes">Yes — all members signed</option>
            <option value="no">No / pending</option>
          </select>
        </label>
        <button class="btn sm" type="submit">Evaluate PFMA & SCM Readiness</button>
      </form>
      <div id="simResult" style="margin-top:0.75rem"></div>
    `;
    $("#scmSimForm").onsubmit = (e) => {
      e.preventDefault();
      const days = Number($("#simDays").value);
      const bec = Number($("#simBec").value);
      const doi = $("#simDoi").value;
      const flags = [];
      if (days > 30) flags.push("Treasury Regulation 8 breach: Invoice exceeds mandatory 30-day creditor settlement period.");
      if (bec < 3) flags.push("SCM Clause 4 breach: BEC quorum requires at least 3 technical & SCM officials.");
      if (doi !== "yes") flags.push("SCM Clause 4 breach: Every BEC member must sign a declaration of interest BEFORE opening technical submissions.");

      $("#simResult").innerHTML = flags.length
        ? `<div class="warn"><b>PFMA / Treasury Risk Detected:</b><ul>${flags.map((f) => `<li>${E(f)}</li>`).join("")}</ul></div>`
        : `<div class="okbox"><b>Ready & Compliant:</b> Meets Treasury Regulation 8 (30-day payment) and SCM BEC quorum & conflict-of-interest rules (PFMA s38 controls).</div>`;
    };
  };

  renderOtSim();
  $("#simOtBtn").onclick = () => {
    $("#simOtBtn").setAttribute("aria-pressed", "true");
    $("#simScmBtn").setAttribute("aria-pressed", "false");
    renderOtSim();
  };
  $("#simScmBtn").onclick = () => {
    $("#simOtBtn").setAttribute("aria-pressed", "false");
    $("#simScmBtn").setAttribute("aria-pressed", "true");
    renderScmSim();
  };
}

function renderGovernance() {
  const g = GOV_SUMMARY;
  if (!g) {
    $("#main").innerHTML = "<p>Loading governance & insights…</p>";
    return;
  }

  $("#main").innerHTML = `
    <div class="headrow">
      <div>
        <h1 style="font-size:1.7rem">Governance, Analytics & Oversight</h1>
        <p style="color:var(--mut);margin:0.25rem 0 0">Scope: <b>${E(g.scope)}</b> · POPIA-redacted audit trail, knowledge gaps, and human-in-the-loop approvals.</p>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <a class="btn sm ghost" href="/api/governance/export">Export Audit CSV</a>
        <a class="btn sm ghost" href="/api/openapi.json" target="_blank" rel="noopener">OpenAPI Spec</a>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><small>Corpus Currency</small><b>${E(g.corpusHealth.currencyRate)}%</b></div>
      <div class="kpi"><small>Authorised / Total Docs</small><b>${E(g.corpusHealth.authorisedForUser)} / ${E(g.corpusHealth.totalDocuments)}</b></div>
      <div class="kpi"><small>Queries Logged</small><b>${E(g.usage.totalQueries)}</b></div>
      <div class="kpi"><small>Blocked Clearance Checks</small><b>${E(g.usage.blockedClearanceAttempts)}</b></div>
      <div class="kpi"><small>Helpful Rating</small><b>${g.usage.helpfulRate !== null ? `${E(g.usage.helpfulRate)}%` : "N/A"}</b></div>
      <div class="kpi"><small>Pending Access Requests</small><b>${E(g.usage.pendingAccessRequests)}</b></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2 style="font-size:1.15rem;margin-bottom:0.5rem">Unanswered Knowledge Gaps</h2>
        <p style="font-size:0.85rem;color:var(--mut);margin-top:0">Questions where no authorised document met confidence threshold — guides policy authors on missing circulars.</p>
        ${
          g.knowledgeGaps.length
            ? g.knowledgeGaps
                .map(
                  (gap) => `
                  <div style="padding:0.5rem 0;border-bottom:1px solid var(--line);font-size:0.86rem">
                    <b>${E(gap.question)}</b><br>
                    <small style="color:var(--mut)">Asked ${E(gap.count)}x · Last by ${E(gap.lastAskedBy)}</small>
                  </div>`
                )
                .join("")
            : "<p style='color:var(--mut);font-size:0.88rem'>No unanswered knowledge gaps recorded yet.</p>"
        }
      </div>

      <div class="card">
        <h2 style="font-size:1.15rem;margin-bottom:0.5rem">Human Oversight: Access Requests</h2>
        <p style="font-size:0.85rem;color:var(--mut);margin-top:0">${
          g.canApproveRequests
            ? "As a Level 3 (Confidential) Director, you can approve or decline clearance requests."
            : "Your submitted clearance requests appear here."
        }</p>
        ${
          g.accessRequests.length
            ? g.accessRequests
                .map(
                  (r) => `
                  <div style="padding:0.55rem 0;border-bottom:1px solid var(--line);font-size:0.86rem">
                    <b>${E(r.docTitle)}</b> <span class="tag ${r.status === "approved" ? "cur" : r.status === "declined" ? "sup" : "dra"}">${E(r.status)}</span><br>
                    <small style="color:var(--mut)">Requester: ${E(r.requesterName)} (${E(r.requesterTitle)}) · Reason: ${E(r.reason)}</small>
                    ${
                      g.canApproveRequests && r.status === "pending"
                        ? `<div style="display:flex;gap:0.4rem;margin-top:0.4rem">
                            <button class="btn sm resolve-req" data-id="${E(r.id)}" data-st="approved" type="button">Approve</button>
                            <button class="btn sm ghost resolve-req" data-id="${E(r.id)}" data-st="declined" type="button">Decline</button>
                           </div>`
                        : ""
                    }
                  </div>`
                )
                .join("")
            : "<p style='color:var(--mut);font-size:0.88rem'>No access requests in queue.</p>"
        }
      </div>
    </div>

    <h2 style="font-size:1.15rem;margin:1.25rem 0 0.4rem">Immutable POPIA-Safe Audit Trail</h2>
    <div class="tbl-wrap">
      <table class="gov-tbl">
        <thead>
          <tr><th>Time</th><th>Actor</th><th>Clearance</th><th>Action</th><th>Outcome</th><th>Details</th></tr>
        </thead>
        <tbody>
          ${
            g.auditLogs
              .map(
                (l) => `
                <tr>
                  <td>${E(new Date(l.timestamp).toLocaleString())}</td>
                  <td>${E(l.actorName)}</td>
                  <td>${E(l.actorClearance)}</td>
                  <td><code>${E(l.action)}</code></td>
                  <td>${E(l.outcome)}</td>
                  <td>${E(l.details)}</td>
                </tr>`
              )
              .join("") || '<tr><td colspan="6">No audit events recorded yet.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(".resolve-req").forEach((b) => {
    b.onclick = async () => {
      try {
        const { res, data } = await apiJson(
          `/api/access-requests/${encodeURIComponent(b.dataset.id)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: b.dataset.st, note: `Reviewed by ${U.name}` })
          }
        );
        if (!res.ok) throw new Error(data.error || "Could not update request.");
        toast(`Request ${b.dataset.st}.`);
        await fetchGovernance();
        renderGovernance();
      } catch (err) {
        toast(err.message);
      }
    };
  });
}

function openDoc(id) {
  const d = doc(id);
  if (!d) return;
  const ok = allowed(d);
  const dr = $("#drawer");
  const rep = d.rep ? doc(d.rep) : null;
  const linkUrl = safeUrl(d.url);

  const secs =
    ok && d.sections && d.sections.length
      ? d.sections.map((s) => `<div class="excerpt"><b>${E(s.sec)}</b>${E(s.text)}</div>`).join("")
      : "";

  dr.innerHTML = `
    <button class="btn ghost sm" id="cl">Close</button>
    <h2 style="margin-top:0.9rem;font-size:1.3rem">${E(d.title)}</h2>
    <p style="margin:0.5rem 0">${stTag(d)}</p>
    ${
      ok
        ? `<p>${E(d.sum)}</p>`
        : `<div class="warn"><b>Restricted.</b> Classified above your verified ${E(U.lvlName)} clearance. Summaries and clauses are withheld on the server.</div>`
    }
    ${
      d.st === "sup" && rep
        ? `<div class="warn"><b>Superseded document.</b> Replaced by <a href="#" id="rl">${E(rep.title)}</a> (v${E(rep.ver)}, current).</div>`
        : ""
    }
    ${d.st === "dra" ? `<div class="info">Draft only. Not approved or in force.</div>` : ""}
    ${d.st === "rev" ? `<div class="info">Under review. Confirm transitional rules with the owner.</div>` : ""}
    <dl>
      <dt>Type</dt><dd>${E(d.cat)}</dd>
      <dt>Owner</dt><dd>${E(d.owner)}</dd>
      <dt>Version</dt><dd>${E(d.ver)}</dd>
      <dt>Date</dt><dd>${E(d.date)}</dd>
      <dt>Classification</dt><dd>${E(["", "Public", "Internal", "Confidential"][d.cls] || "Public")}</dd>
      <dt>Source</dt><dd>${E(d.src)}</dd>
    </dl>
    ${linkUrl && ok ? `<p><a href="${E(linkUrl)}" target="_blank" rel="noopener">Open official source document</a></p>` : ""}
    ${secs ? `<h3 style="font-size:1rem;margin:0.8rem 0 0.4rem">Document sections</h3>${secs}` : ""}
    <div style="display:flex;gap:0.5rem;margin-top:0.9rem;flex-wrap:wrap">
      ${ok ? `<button class="btn sm" id="askDoc">Ask about this document</button>` : ""}
      ${!ok && U.role === "employee" ? `<button class="btn sm secondary" id="reqDoc">Request Access</button>` : ""}
      ${ok && d.uploaded && U.role === "employee" ? `<button class="btn sm ghost" id="delDoc">Remove upload</button>` : ""}
    </div>
  `;

  dr.classList.add("open");
  dr.setAttribute("aria-hidden", "false");
  $("#cl").onclick = closeDrawer;
  $("#cl").focus();

  if ($("#rl")) {
    $("#rl").onclick = (e) => {
      e.preventDefault();
      openDoc(rep.id);
    };
  }
  if ($("#askDoc")) {
    $("#askDoc").onclick = () => {
      closeDrawer();
      view = "chat";
      render();
      ask(`Summarise ${d.title} and check if it is current.`);
    };
  }
  if ($("#reqDoc")) {
    $("#reqDoc").onclick = async () => {
      const reason = window.prompt("Operational reason for requesting clearance:", "Policy alignment check");
      if (reason === null) return;
      try {
        const { res, data } = await apiJson("/api/access-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: d.id, reason })
        });
        if (!res.ok) throw new Error(data.error || "Request failed");
        toast(`Access request sent to ${d.owner}.`);
        closeDrawer();
      } catch (err) {
        toast(err.message);
      }
    };
  }
  if ($("#delDoc")) {
    $("#delDoc").onclick = async () => {
      try {
        const { res } = await apiJson(`/api/upload/${encodeURIComponent(d.id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        closeDrawer();
        await fetchDocs(q, cat, stFilter);
        await checkHealth();
        render();
        toast("Uploaded document removed.");
      } catch {
        toast("Could not remove document.");
      }
    };
  }
}

function closeDrawer() {
  const d = $("#drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

async function bootstrap() {
  authUI();
  $("#pub").innerHTML = PUB_LIST.map(
    (d) => `<a href="${E(safeUrl(d.url))}" target="_blank" rel="noopener">${E(d.title)}<small>${E(d.src)}</small></a>`
  ).join("");
  await checkHealth();

  // Restore verified server session if active
  if (window.location.protocol !== "file:") {
    try {
      const { res, data } = await apiJson("/api/auth/session");
      if (res.ok && data.authenticated && data.user) {
        await enterWorkspace(data.user);
      }
    } catch {
      // ignore
    }
  }
}

bootstrap();
