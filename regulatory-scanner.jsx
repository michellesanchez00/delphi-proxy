import { useState } from "react";

// ── Device Detection ──────────────────────────────────────────────────────────
function detectMobile() {
  // Check actual device user agent — not screen width
  // This works correctly even inside narrow iframes like Claude artifacts
  var ua = navigator.userAgent || navigator.vendor || window.opera || "";
  var isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
  var isTouchOnly = (navigator.maxTouchPoints > 1) && !window.matchMedia("(pointer: fine)").matches;
  return isMobileUA || isTouchOnly;
}

var IS_MOBILE = detectMobile();

// Apply body class once so CSS can target it
if (IS_MOBILE) {
  document.body.classList.add("is-mobile");
} else {
  document.body.classList.remove("is-mobile");
}

// ── Storage & TTL ─────────────────────────────────────────────────────────────
const TTL_DEFAULT = 10 * 24 * 60 * 60 * 1000;  // 10 days
const TTL_INSCOPE = 20 * 24 * 60 * 60 * 1000;  // 20 days

function saveRegs(regs) {
  try { localStorage.setItem("delphi_regs", JSON.stringify(regs)); } catch(e) {}
}

function loadRegs() {
  try {
    var stored = localStorage.getItem("delphi_regs");
    if (!stored) return [];
    var regs = JSON.parse(stored);
    var now = Date.now();
    // Purge expired regulations
    return regs.filter(function(r) {
      var ttl = r.inScope ? TTL_INSCOPE : TTL_DEFAULT;
      return (now - r.savedAt) < ttl;
    });
  } catch(e) { return []; }
}

function getExpiryLabel(reg) {
  var ttl = reg.inScope ? TTL_INSCOPE : TTL_DEFAULT;
  var ms = ttl - (Date.now() - reg.savedAt);
  if (ms <= 0) return "Expired";
  var hours = Math.floor(ms / 3600000);
  if (hours < 24) return "Expires in " + hours + "h";
  return "Expires in " + Math.floor(hours / 24) + "d";
}

// Collect all controls from all saved regs (excluding current)
function getAllControls(regs, excludeId) {
  var controls = [];
  regs.forEach(function(r) {
    if (r.id === excludeId || !r.analysis) return;
    (r.analysis.controls || []).forEach(function(c) {
      controls.push({ regId: r.id, regTitle: r.title, controlId: c.controlId, title: c.title });
    });
  });
  return controls;
}

function isDuplicate(controlTitle, allControls) {
  var t = controlTitle.toLowerCase().trim();
  return allControls.find(function(c) {
    var sim = c.title.toLowerCase().trim();
    // Simple similarity: check if 60%+ of words match
    var words = t.split(/\s+/);
    var matches = words.filter(function(w) { return w.length > 3 && sim.includes(w); });
    return matches.length >= Math.ceil(words.length * 0.6);
  });
}

const C = {
  bg: "#0a0f1a", panel: "#0f1628", border: "#1e2d4a",
  accent: "#00d4ff", accent3: "#7c3aed", text: "#e2e8f0",
  muted: "#64748b", success: "#10b981", warning: "#f59e0b", critical: "#ef4444",
};

const DEFAULT_SOURCES = [
  { id: 1, icon: "🇪🇺", label: "EC Financial Services", url: "https://finance.ec.europa.eu/regulation-and-supervision/financial-services-legislation_en", description: "EU financial services legislation" },
  { id: 2, icon: "🏛", label: "EP Legislative Observatory", url: "https://oeil.secure.europarl.europa.eu/oeil/home/home.do", description: "European Parliament legislative tracking" },
  { id: 3, icon: "⚖", label: "EU Law Tracker", url: "https://law-tracker.europa.eu/homepage", description: "Track EU law through the legislative process" },
];

const SAMPLE_REGS = [
  { title: "EU AI Act — Article 9 Risk Management", text: "Article 9 of the EU AI Act mandates that providers of high-risk AI systems must establish, implement, document and maintain a risk management system. This system shall consist of a continuous iterative process run throughout the entire lifecycle of a high-risk AI system. It shall ensure that risks associated with AI systems are identified, estimated, and evaluated. Where reasonably foreseeable misuse of the AI system could lead to risks, these shall also be evaluated. Providers must test their AI systems prior to placing them on the market or putting them into service. Compliance deadline: August 2026." },
  { title: "SEC Cybersecurity Disclosure Rule", text: "The Securities and Exchange Commission adopted new rules requiring registrants to disclose material cybersecurity incidents they experience and to disclose on an annual basis material information regarding their cybersecurity risk management, strategy, and governance. Registrants must disclose any cybersecurity incident determined to be material on Form 8-K within four business days of determination. The rule also requires annual disclosures on Form 10-K. Effective date: December 2023 for large accelerated filers, June 2024 for smaller reporting companies." },
];

const MMC_ENTITIES = "Marsh McLennan (MMC parent), Marsh Risk (insurance broking), Guy Carpenter/Marsh Re (reinsurance), Mercer (HR/retirement/investment consulting), Oliver Wyman (management consulting, includes Lippincott and NERA), MMC Securities LLC (SEC broker-dealer), MMC Securities Limited (FCA-regulated UK), MMC Securities Ireland Limited (Central Bank of Ireland), MMA Securities LLC, MMA Asset Management LLC (SEC investment adviser), Victor Insurance, McGriff Insurance Services";

function riskColor(level) {
  return { Critical: C.critical, High: C.warning, Medium: C.accent, Low: C.success }[level] || C.muted;
}

function priorityStyle(p) {
  return {
    Immediate: { background: "#ef444422", border: "1px solid #ef444444", color: C.critical },
    "Short-term": { background: "#f59e0b22", border: "1px solid #f59e0b44", color: C.warning },
    Ongoing: { background: "#10b98122", border: "1px solid #10b98144", color: C.success },
  }[p] || { background: C.border, color: C.muted };
}

const iStyle = {
  width: "100%", background: "#0a0f1acc", border: "1px solid " + C.border,
  borderRadius: 7, color: C.text, fontFamily: "inherit", fontSize: 12,
  padding: "8px 10px", outline: "none", boxSizing: "border-box",
};

// ── Proxy URL — replace with your Vercel deployment URL after deploying ──────
const PROXY_URL = "https://delphi-proxy.vercel.app/api/claude";
// ─────────────────────────────────────────────────────────────────────────────

async function apiCall(messages, maxTokens, useSearch) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens || 4000,
    messages: messages,
  };
  if (useSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || JSON.stringify(data.error);
    if (msg.includes("exceeded_limit") || JSON.stringify(data.error).includes("exceeded_limit")) {
      throw new Error("LIMIT_EXCEEDED");
    }
    throw new Error(msg);
  }
  return (data.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
}

function limitMsg() {
  return "Claude.ai usage limit reached. Please wait a few hours for it to reset, or paste regulation text manually. This limit will not apply once deployed with your own Anthropic API key.";
}

// ── ActionCard ────────────────────────────────────────────────────────────────

function ActionCard(props) {
  var action = props.action;
  var index = props.index;
  var open = props.open;
  var onToggle = props.onToggle;
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start", cursor: "pointer" }} onClick={onToggle}>
        <div style={{ background: C.accent + "22", border: "1px solid " + C.accent + "44", color: C.accent, width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold", flexShrink: 0 }}>
          {index + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4, color: C.text }}>{action.title}</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>{action.description}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: "bold", ...priorityStyle(action.priority) }}>{action.priority}</span>
            {action.owner && <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, background: C.border, color: C.muted }}>{"Owner: " + action.owner}</span>}
          </div>
        </div>
        <span style={{ color: C.muted, fontSize: 11, flexShrink: 0, marginTop: 6, display: "inline-block", transform: open ? "rotate(180deg)" : "none" }}>▼</span>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid " + C.border, padding: "14px 18px 18px 60px" }}>
          {action.steps && action.steps.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.18em", color: C.accent, textTransform: "uppercase", marginBottom: 10 }}>◈ How To Proceed</div>
              {action.steps.map(function(step, i) {
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ background: C.accent3 + "33", border: "1px solid " + C.accent3 + "55", color: "#a78bfa", width: 20, height: 20, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: "bold", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{String(step).replace(/^Step \d+:\s*/i, "")}</div>
                  </div>
                );
              })}
            </div>
          )}
          {action.successCriteria && (
            <div style={{ background: C.success + "11", border: "1px solid " + C.success + "33", borderRadius: 7, padding: "10px 14px", display: "flex", gap: 10 }}>
              <span style={{ color: C.success, flexShrink: 0 }}>✓</span>
              <div>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: C.success, textTransform: "uppercase", marginBottom: 4 }}>Done When</div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{action.successCriteria}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SourcesModal ──────────────────────────────────────────────────────────────

function SourcesModal(props) {
  var sources = props.sources;
  var setSources = props.setSources;
  var onClose = props.onClose;
  var [editing, setEditing] = useState(null);
  var [form, setForm] = useState({ icon: "🔗", label: "", url: "", description: "" });

  function startEdit(src) {
    setEditing(src.id);
    setForm({ icon: src.icon || "🔗", label: src.label, url: src.url, description: src.description || "" });
  }
  function cancelEdit() { setEditing(null); setForm({ icon: "🔗", label: "", url: "", description: "" }); }
  function save() {
    if (editing) {
      setSources(function(prev) { return prev.map(function(s) { return s.id === editing ? Object.assign({}, s, form) : s; }); });
    } else {
      setSources(function(prev) { return prev.concat([Object.assign({ id: Date.now() }, form)]); });
    }
    cancelEdit();
  }
  var canSave = form.label.trim() && form.url.trim();

  return (
    <div className="modal-bg" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={function(e) { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-inner" style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 14, width: "100%", maxWidth: 600, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.text }}>🔗 Manage Monitored Sources</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Add, edit or remove regulation websites to monitor</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {sources.map(function(src) {
            return (
              <div key={src.id} style={{ background: "#0a0f1a", border: "1px solid " + (editing === src.id ? C.accent + "66" : C.border), borderRadius: 8, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{src.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, marginBottom: 2 }}>{src.label}</div>
                  <div style={{ fontSize: 10, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.url}</div>
                  {src.description && <div style={{ fontSize: 10, color: C.muted, marginTop: 2, fontStyle: "italic" }}>{src.description}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={function() { startEdit(src); }} style={{ background: C.accent + "18", border: "1px solid " + C.accent + "44", color: C.accent, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>✎ Edit</button>
                  <button onClick={function() { setSources(function(prev) { return prev.filter(function(s) { return s.id !== src.id; }); }); if (editing === src.id) cancelEdit(); }} style={{ background: C.critical + "18", border: "1px solid " + C.critical + "44", color: C.critical, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>✕ Remove</button>
                </div>
              </div>
            );
          })}

          <div style={{ background: "#0a0f1a", border: "1px solid " + (editing ? C.accent + "55" : C.border), borderRadius: 8, padding: "16px", marginTop: 4 }}>
            <div style={{ fontSize: 10, color: editing ? C.accent : C.muted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>{editing ? "✎ Editing Source" : "+ Add New Source"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Icon</div>
                <input type="text" maxLength={2} value={form.icon} onChange={function(e) { setForm(function(f) { return Object.assign({}, f, { icon: e.target.value }); }); }} style={{ ...iStyle, textAlign: "center", fontSize: 20, padding: "5px" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Label *</div>
                <input type="text" placeholder="e.g. FCA Handbook" value={form.label} onChange={function(e) { setForm(function(f) { return Object.assign({}, f, { label: e.target.value }); }); }} style={iStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>URL *</div>
              <input type="text" placeholder="https://..." value={form.url} onChange={function(e) { setForm(function(f) { return Object.assign({}, f, { url: e.target.value }); }); }} style={iStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Description (optional)</div>
              <input type="text" placeholder="Brief description" value={form.description} onChange={function(e) { setForm(function(f) { return Object.assign({}, f, { description: e.target.value }); }); }} style={iStyle} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={!canSave} style={{ background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "8px 18px", borderRadius: 6, cursor: canSave ? "pointer" : "default", fontSize: 11, fontFamily: "inherit", fontWeight: "bold", opacity: canSave ? 1 : 0.4 }}>
                {editing ? "✓ Save Changes" : "+ Add Source"}
              </button>
              {editing && <button onClick={cancelEdit} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Cancel</button>}
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: C.muted }}>{sources.length + " source" + (sources.length !== 1 ? "s" : "") + " configured"}</span>
          <button onClick={onClose} style={{ background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: "bold" }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── ScannerModal ──────────────────────────────────────────────────────────────

function ScannerModal(props) {
  var scanning = props.scanning;
  var scanProgress = props.scanProgress;
  var scanResults = props.scanResults;
  var onClose = props.onClose;
  var onRescan = props.onRescan;
  var onAnalyse = props.onAnalyse;
  var total = scanResults.reduce(function(t, r) { return t + r.regs.length; }, 0);

  return (
    <div className="modal-bg" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={function(e) { if (e.target === e.currentTarget && !scanning) onClose(); }}>
      <div className="modal-inner" style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 14, width: "100%", maxWidth: 800, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.text }}>⟳ Regulatory Horizon Scan</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
              {scanning ? "Scanning sources for regulations..." : (total + " regulations found across " + scanResults.length + " sources")}
            </div>
          </div>
          {!scanning && <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {scanProgress.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {scanProgress.map(function(p, i) {
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0a0f1a", borderRadius: 7, marginBottom: 6, border: "1px solid " + C.border }}>
                    <span>{p.status === "scanning" ? "↻" : p.status === "done" ? "✓" : "⚠"}</span>
                    <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{p.source}</span>
                    <span style={{ fontSize: 11, color: p.status === "done" ? C.success : p.status === "error" ? C.critical : C.accent }}>
                      {p.status === "scanning" ? "Scanning..." : p.status === "done" ? (p.count + " found") : "Error"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {scanResults.map(function(result, si) {
            return (
              <div key={si} style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid " + C.border }}>
                  <span style={{ fontSize: 18 }}>{result.sourceIcon}</span>
                  <span style={{ fontSize: 12, fontWeight: "bold", color: C.text }}>{result.sourceLabel}</span>
                  {result.error
                    ? <span style={{ fontSize: 10, color: C.critical, marginLeft: "auto" }}>{"⚠ " + result.error}</span>
                    : <span style={{ fontSize: 10, color: C.success, marginLeft: "auto" }}>{result.regs.length + " regulation" + (result.regs.length !== 1 ? "s" : "") + " found"}</span>}
                </div>
                {result.regs.length === 0 && !result.error && (
                  <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic", paddingLeft: 8 }}>No regulations identified on this page.</div>
                )}
                {result.regs.map(function(reg, ri) {
                  var statusColor = { "In Force": C.success, "Proposed": C.warning, "Consultation": C.accent, "Upcoming": "#a78bfa" }[reg.status] || C.muted;
                  return (
                    <div key={ri} style={{ background: "#0a0f1a", border: "1px solid " + C.border, borderRadius: 8, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, lineHeight: 1.4 }}>{reg.title}</div>
                          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                            {reg.type && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: C.accent3 + "22", border: "1px solid " + C.accent3 + "44", color: "#a78bfa", fontWeight: "bold", whiteSpace: "nowrap" }}>{reg.type}</span>}
                            {reg.status && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: statusColor + "22", border: "1px solid " + statusColor + "44", color: statusColor, fontWeight: "bold", whiteSpace: "nowrap" }}>{reg.status}</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>{reg.summary}</div>
                        <div style={{ display: "flex", gap: 10 }}>
                          {reg.reference && <span style={{ fontSize: 10, color: C.accent, fontWeight: "bold" }}>{reg.reference}</span>}
                          {reg.jurisdiction && <span style={{ fontSize: 10, color: C.muted }}>{reg.jurisdiction}</span>}
                        </div>
                      </div>
                      <button onClick={function() { onAnalyse(reg); }}
                        style={{ background: C.accent + "18", border: "1px solid " + C.accent + "44", color: C.accent, borderRadius: 5, padding: "5px 10px", cursor: "pointer", fontSize: 10, fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                        + Analyse
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {!scanning && scanResults.length > 0 && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.muted }}>Click + Analyse on any regulation to run a full MMC compliance analysis</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onRescan} style={{ background: C.accent3 + "22", border: "1px solid " + C.accent3 + "55", color: "#a78bfa", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>↻ Re-scan</button>
              <button onClick={onClose} style={{ background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: "bold" }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UploadZone ────────────────────────────────────────────────────────────────

function UploadZone(props) {
  var onFile = props.onFile;
  var uploading = props.uploading;
  async function processFile(file) {
    if (!file) return;
    var name = file.name.replace(/\.[^/.]+$/, "");
    if (file.type === "application/pdf") {
      onFile(name, null, file);
    } else {
      var text = await file.text();
      onFile(name, text, null);
    }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
        {uploading ? "⏳ Extracting text..." : "☁ Upload File (PDF · TXT · MD)"}
      </div>
      <input type="file" accept=".txt,.pdf,.md,.doc,.docx" disabled={uploading}
        onChange={function(e) { var f = e.target.files && e.target.files[0]; if (f) processFile(f); e.target.value = ""; }}
        style={{ display: "block", width: "100%", fontSize: 11, color: C.muted, background: "#0a0f1acc", border: "1px solid " + C.border, borderRadius: 7, padding: "8px 10px", fontFamily: "inherit", cursor: "pointer", boxSizing: "border-box" }} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  var [regulations, setRegulations] = useState(function() { return loadRegs(); });
  var [inputTitle, setInputTitle] = useState("");
  var [inputText, setInputText] = useState("");
  var [selected, setSelected] = useState(null);
  var [analyzing, setAnalyzing] = useState(false);
  var [uploading, setUploading] = useState(false);
  var [activeTab, setActiveTab] = useState("summary");
  var [openActions, setOpenActions] = useState({});
  var [urlInput, setUrlInput] = useState("");
  var [fetchingUrl, setFetchingUrl] = useState(false);
  var [urlError, setUrlError] = useState("");
  var [sources, setSources] = useState(function() {
    try {
      var stored = localStorage.getItem("delphi_sources");
      if (!stored) {
        // First time — save defaults immediately so they persist
        localStorage.setItem("delphi_sources", JSON.stringify(DEFAULT_SOURCES));
        return DEFAULT_SOURCES;
      }
      // Return whatever is stored — user controls additions and deletions
      return JSON.parse(stored);
    } catch(e) {
      return DEFAULT_SOURCES;
    }
  });
  var [showSources, setShowSources] = useState(false);
  var [scanning, setScanning] = useState(false);
  var [scanResults, setScanResults] = useState([]);
  var [scanProgress, setScanProgress] = useState([]);
  var [showScanner, setShowScanner] = useState(false);
  var [showMobileSidebar, setShowMobileSidebar] = useState(false);
  var [mobileView, setMobileView] = useState("home"); // "home" | "detail"

  function updateSources(updater) {
    setSources(function(prev) {
      var next = typeof updater === "function" ? updater(prev) : updater;
      try {
        localStorage.setItem("delphi_sources", JSON.stringify(next));
      } catch(e) {
        console.warn("Could not save sources to localStorage:", e);
      }
      return next;
    });
  }

  async function handleFileUpload(name, text, pdfFile) {
    setInputTitle(name);
    if (pdfFile) {
      setUploading(true);
      try {
        if (!window.pdfjsLib) {
          await new Promise(function(res, rej) {
            var s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        }
        var buf = await pdfFile.arrayBuffer();
        var pdf = await window.pdfjsLib.getDocument({ data: buf, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
        var pages = [];
        for (var i = 1; i <= pdf.numPages; i++) {
          var page = await pdf.getPage(i);
          var tc = await page.getTextContent();
          pages.push(tc.items.map(function(it) { return it.str; }).join(" "));
        }
        var extracted = pages.join("\n\n").trim();
        setInputText(extracted || "[No text extracted — please paste manually]");
      } catch(e) {
        setInputText("[Could not extract PDF — please paste text manually]");
      }
      setUploading(false);
    } else {
      setInputText(text);
    }
  }

  async function fetchFromUrl(url) {
    if (!url.trim()) return;
    setFetchingUrl(true);
    setUrlError("");
    try {
      var domain = url;
      try { domain = new URL(url).hostname.replace("www.", ""); } catch(e) {}
      var prompt = "Search for regulations and legislation published on " + domain + ". The page URL is: " + url + ". Find all named regulations, directives, acts, or consultations available there. List them with their titles, reference numbers, and brief descriptions. Write your findings as plain descriptive text.";
      var raw = await apiCall([{ role: "user", content: prompt }], 2000, true);
      if (!raw.trim()) throw new Error("No content returned.");
      setInputTitle("Regulations from " + domain);
      setInputText(raw);
    } catch(err) {
      var msg = err.message || "";
      if (msg === "LIMIT_EXCEEDED") {
        setUrlError(limitMsg());
      } else {
        setUrlError("Could not retrieve content. Try copying and pasting the regulation text manually.");
      }
    }
    setFetchingUrl(false);
  }

  async function scanAllSources() {
    if (!sources.length) return;
    setScanning(true);
    setShowScanner(true);
    setScanResults([]);
    setScanProgress([]);

    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      var srcLabel = src.label;
      setScanProgress(function(prev) { return prev.concat([{ source: srcLabel, status: "scanning" }]); });
      try {
        var domain = src.url;
        try { domain = new URL(src.url).hostname.replace("www.", ""); } catch(e) {}
        var prompt = "You are a regulatory horizon scanning assistant. Search the website " + domain + " (URL: " + src.url + ") and identify all regulations, directives, legislative acts, and consultations listed there. For each one found provide: title (full name), type (one of: Regulation, Directive, Consultation, Guidance), reference (the official number e.g. 2022/2554/EU, or empty string), status (one of: In Force, Proposed, Consultation, Upcoming), summary (one sentence description), jurisdiction (region or country). Return ONLY a raw JSON array with no markdown. Example format: [{\"title\":\"...\",\"type\":\"...\",\"reference\":\"...\",\"status\":\"...\",\"summary\":\"...\",\"jurisdiction\":\"...\"}]. If nothing found return [].";
        var raw = await apiCall([{ role: "user", content: prompt }], 3000, true);
        var regs = [];
        try {
          var match = raw.match(/\[[\s\S]*\]/);
          if (match) regs = JSON.parse(match[0]);
        } catch(e) { regs = []; }
        var count = regs.length;
        setScanResults(function(prev) { return prev.concat([{ sourceId: src.id, sourceLabel: src.label, sourceIcon: src.icon, regs: regs, error: null }]); });
        setScanProgress(function(prev) { return prev.map(function(p) { return p.source === srcLabel ? { source: p.source, status: "done", count: count } : p; }); });
      } catch(err) {
        var errMsg = err.message === "LIMIT_EXCEEDED" ? "Usage limit reached — try again later" : (err.message || "Unknown error");
        var capturedLabel = srcLabel;
        setScanResults(function(prev) { return prev.concat([{ sourceId: src.id, sourceLabel: src.label, sourceIcon: src.icon, regs: [], error: errMsg }]); });
        setScanProgress(function(prev) { return prev.map(function(p) { return p.source === capturedLabel ? { source: p.source, status: "error" } : p; }); });
      }
    }
    setScanning(false);
  }

  async function analyzeRegulation(reg) {
    setAnalyzing(true);
    var pending = Object.assign({}, reg, { loading: true });
    setSelected(pending);
    setRegulations(function(prev) { return [pending].concat(prev.filter(function(r) { return r.id !== reg.id; })); });
    setOpenActions({});

    var truncated = reg.text.length > 4000 ? reg.text.slice(0, 4000) + "..." : reg.text;
    var prompt = "You are a regulatory compliance expert. Analyze the regulation below and respond with ONLY a valid JSON object. No prose, no markdown, no backticks.\n\nREGULATION TEXT:\n" + truncated + "\n\nReturn this exact JSON (values under 40 words except verbatim legislative fields):\n{\"instrumentType\":\"Regulation or Directive\",\"fullName\":\"Full official name\",\"referenceNumber\":\"e.g. 2022/2554/EU\",\"summary\":\"One sentence\",\"jurisdiction\":\"region\",\"impactAreas\":[\"area1\",\"area2\"],\"chapters\":[{\"number\":\"Chapter I\",\"title\":\"title\"}],\"transitionalPeriod\":\"Verbatim text of article titled Transitional Period or N/A\",\"transpositionDate\":\"Verbatim text of article titled Transposition or N/A\",\"repealOfLegislation\":\"Verbatim text of article titled Repeal or N/A\",\"entryIntoForce\":\"Verbatim text of article titled Entry into force or N/A\",\"effectiveDate\":\"date or TBD\",\"deadline\":\"deadline or Ongoing\",\"riskLevel\":\"Critical\",\"mmcRisk\":{\"rating\":\"Critical\",\"score\":9,\"summary\":\"sentence\",\"financialExposure\":\"sentence\",\"reputationalExposure\":\"sentence\",\"operationalExposure\":\"sentence\",\"mitigatingFactors\":[\"factor1\"]},\"mmcScope\":[{\"entity\":\"name\",\"inScope\":true,\"reason\":\"sentence\"}],\"controls\":[{\"controlId\":\"CTRL-001\",\"title\":\"Short control name\",\"description\":\"What the control requires\",\"category\":\"Governance or Risk or Compliance or Technology or Operational or Reporting\",\"priority\":\"Immediate or Short-term or Ongoing\",\"owner\":\"Responsible team\",\"steps\":[\"Implementation step 1\",\"Implementation step 2\",\"Implementation step 3\"],\"testingCriteria\":\"How to verify the control is operating effectively\",\"articleReference\":\"Article or Section reference\"}]}\n\nRules: instrumentType exactly Regulation or Directive. chapters top-level only. riskLevel and mmcRisk.rating: Critical/High/Medium/Low. mmcRisk.score 1-10. priority: Immediate/Short-term/Ongoing. 6-10 controls with 3-5 steps each. controlId must be unique sequential e.g. CTRL-001. Output ONLY raw JSON.";

    try {
      var raw = await apiCall([{ role: "user", content: prompt }]);
      var match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON found. Got: " + raw.slice(0, 200));
      var analysis = JSON.parse(match[0]);
      var enriched = Object.assign({}, reg, { analysis: analysis, loading: false, savedAt: reg.savedAt || Date.now(), inScope: reg.inScope || false });
      setRegulations(function(prev) {
        var updated = prev.map(function(r) { return r.id === reg.id ? enriched : r; });
        saveRegs(updated);
        return updated;
      });
      setSelected(enriched);
    } catch(err) {
      var errText = err.message === "LIMIT_EXCEEDED" ? limitMsg() : ("Analysis failed: " + err.message);
      var failed = Object.assign({}, reg, { loading: false, error: errText });
      setRegulations(function(prev) { return prev.map(function(r) { return r.id === reg.id ? failed : r; }); });
      setSelected(failed);
    }
    setAnalyzing(false);
  }

  function addRegulation() {
    if (!inputText.trim()) return;
    var reg = { id: Date.now(), title: inputTitle.trim() || ("Regulation " + (regulations.length + 1)), text: inputText.trim(), addedAt: new Date().toLocaleDateString(), savedAt: Date.now(), inScope: false };
    setInputText(""); setInputTitle(""); setActiveTab("summary");
    analyzeRegulation(reg);
  }

  function loadSample(s) {
    var reg = { id: Date.now(), title: s.title, text: s.text, addedAt: new Date().toLocaleDateString(), savedAt: Date.now(), inScope: false };
    setActiveTab("summary");
    analyzeRegulation(reg);
  }

  function handleAnalyseFromScan(reg) {
    var text = (reg.title || "") + ". " + (reg.summary || "") + " Type: " + (reg.type || "") + ". Reference: " + (reg.reference || "N/A") + ". Status: " + (reg.status || "N/A") + ". Jurisdiction: " + (reg.jurisdiction || "N/A") + ".";
    var r = { id: Date.now(), title: reg.title || "Scanned Regulation", text: text, addedAt: new Date().toLocaleDateString(), savedAt: Date.now(), inScope: false };
    setShowScanner(false);
    setActiveTab("summary");
    analyzeRegulation(r);
  }

  var btnP = { width: "100%", background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "bold" };
  var btnS = { width: "100%", background: "transparent", border: "1px solid " + C.border, color: C.muted, padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: "inherit", marginBottom: 5, textAlign: "left", display: "flex", alignItems: "center", gap: 6 };
  var sLabel = { fontSize: 10, color: C.muted, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 7, display: "block" };
  var sHead = { fontSize: 10, letterSpacing: "0.18em", color: C.accent, textTransform: "uppercase", marginBottom: 14 };
  var sumBox = { background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "16px 20px", fontSize: 13, lineHeight: 1.8, color: C.text };
  var metaCard = { background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "13px 16px" };

  var a = selected && selected.analysis ? selected.analysis : null;
  var totalFound = scanResults.reduce(function(t, r) { return t + r.regs.length; }, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'IBM Plex Mono','Courier New',monospace", color: C.text }}>
      <style>{"\n        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');\n        *{box-sizing:border-box;margin:0;}\n        input:focus,textarea:focus{border-color:#00d4ff!important;outline:none;}\n        input[type=file]{font-size:12px}\n        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}\n        @keyframes blink{50%{opacity:0}}\n        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}\n        .fade-in{animation:fadeIn 0.3s ease forwards}\n        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:3px}\n        .hov:hover{background:rgba(0,212,255,0.07)!important}\n        .btnp:hover{background:linear-gradient(135deg,rgba(0,212,255,0.28),rgba(124,58,237,0.28))!important}\n        .tab{cursor:pointer;padding:5px 10px;border-radius:5px;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-family:inherit;border:none;white-space:nowrap;}\n        .ton{background:rgba(0,212,255,0.15);color:#00d4ff;}\n        .toff{color:#64748b;background:transparent;}\n        .toff:hover{color:#94a3b8;}\n        .mobile-only{display:none!important}\n        .mobile-nav{display:none!important}\n        body.is-mobile .desktop-sidebar{display:none!important}\n        body.is-mobile .mobile-only{display:flex!important}\n        body.is-mobile .mobile-nav{display:flex!important}\n        body.is-mobile .app-grid{grid-template-columns:1fr!important}\n        body.is-mobile .main-panel{padding:16px 14px!important}\n        body.is-mobile .hdr{padding:10px 14px!important}\n        body.is-mobile .hdr-scan-label{display:none!important}\n        body.is-mobile .meta-3col{grid-template-columns:1fr 1fr!important}\n        body.is-mobile .risk-3col{grid-template-columns:1fr!important}\n        body.is-mobile .modal-inner{max-width:100%!important;max-height:92vh!important;border-radius:14px 14px 0 0!important;position:fixed!important;bottom:0!important;left:0!important;right:0!important;width:100%!important}\n        body.is-mobile .modal-bg{align-items:flex-end!important;padding:0!important}\n        body.is-mobile .tab-scroll{overflow-x:auto!important;-webkit-overflow-scrolling:touch;padding-bottom:4px}\n        body.is-mobile .tab-scroll::-webkit-scrollbar{display:none}\n      "}</style>

      {/* Header */}
      <div className="hdr" style={{ borderBottom: "1px solid " + C.border, padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.panel, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg," + C.accent + "," + C.accent3 + ")", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚖</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: "bold", letterSpacing: "0.15em", color: C.accent, textTransform: "uppercase" }}>DELPHI</div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Document Extraction for Legal/Policy Harmonization & Implementation</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={scanAllSources} disabled={scanning || !sources.length}
            style={{ background: C.accent3 + "22", border: "1px solid " + C.accent3 + "66", color: "#a78bfa", padding: "5px 14px", borderRadius: 20, fontSize: 11, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit", fontWeight: "bold", opacity: scanning || !sources.length ? 0.5 : 1 }}>
            {scanning ? "↻ " : "⟳ "}<span className="hdr-scan-label">{scanning ? "Scanning..." : "Scan All Sources"}</span>
          </button>
          {totalFound > 0 && !scanning && (
            <button onClick={function() { setShowScanner(true); }}
              style={{ background: C.success + "22", border: "1px solid " + C.success + "44", color: C.success, padding: "5px 14px", borderRadius: 20, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: "bold" }}>
              {"📋 " + totalFound + " Found"}
            </button>
          )}
          <div style={{ background: C.accent + "22", border: "1px solid " + C.accent + "44", color: C.accent, padding: "4px 12px", borderRadius: 20, fontSize: 11 }}>⬡ AI-Powered</div>
        </div>
      </div>

      {/* Body */}
      <div className="app-grid" style={{ display: "grid", gridTemplateColumns: "360px 1fr", minHeight: "calc(100vh - 65px)" }}>

        {/* Sidebar */}
        <div className="desktop-sidebar" style={{ borderRight: "1px solid " + C.border, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid " + C.border }}>
            <span style={sLabel}>Ingest Regulation</span>
            <input type="text" placeholder="Regulation title (optional)..." value={inputTitle} onChange={function(e) { setInputTitle(e.target.value); }} style={{ ...iStyle, marginBottom: 8, display: "block" }} />
            <UploadZone onFile={handleFileUpload} uploading={uploading} />
            <div style={{ marginBottom: 8 }}>
              <span style={{ ...sLabel, marginBottom: 5 }}>🔗 Import from URL</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="text" placeholder="Paste regulation URL..." value={urlInput}
                  onChange={function(e) { setUrlInput(e.target.value); setUrlError(""); }}
                  onKeyDown={function(e) { if (e.key === "Enter") fetchFromUrl(urlInput); }}
                  style={{ ...iStyle, flex: 1, fontSize: 11 }} />
                <button onClick={function() { fetchFromUrl(urlInput); }} disabled={!urlInput.trim() || fetchingUrl}
                  style={{ ...btnP, width: "auto", padding: "0 14px", opacity: !urlInput.trim() || fetchingUrl ? 0.5 : 1 }}>
                  {fetchingUrl ? "..." : "→"}
                </button>
              </div>
              {urlError && <div style={{ fontSize: 10, color: C.critical, marginTop: 5, lineHeight: 1.5 }}>{urlError}</div>}
            </div>
            <textarea placeholder="...or paste regulation text here" value={inputText} onChange={function(e) { setInputText(e.target.value); }}
              rows={4} style={{ ...iStyle, resize: "none", lineHeight: 1.6, marginBottom: 8, display: "block" }} />
            <button className="btnp" style={{ ...btnP, opacity: !inputText.trim() || analyzing || uploading ? 0.5 : 1 }}
              onClick={addRegulation} disabled={!inputText.trim() || analyzing || uploading}>
              {analyzing ? "↻ Analyzing..." : "→ Analyze Regulation"}
            </button>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid " + C.border }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ ...sLabel, marginBottom: 0 }}>Monitored Sources</span>
              <button onClick={function() { setShowSources(true); }} style={{ fontSize: 10, color: C.accent, background: "transparent", border: "1px solid " + C.accent + "44", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>✎ Manage</button>
            </div>
            {sources.map(function(src) {
              return (
                <button key={src.id} className="hov" title={src.description} style={btnS}
                  onClick={function() { setUrlInput(src.url); fetchFromUrl(src.url); }}>
                  <span>{src.icon}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.label}</span>
                </button>
              );
            })}
            <button onClick={function() { setShowSources(true); }} style={{ ...btnS, color: C.accent, borderStyle: "dashed", marginBottom: 0 }}>
              <span>+</span><span>Add source...</span>
            </button>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid " + C.border }}>
            <span style={sLabel}>Sample Regulations</span>
            {SAMPLE_REGS.map(function(s, i) {
              return (
                <button key={i} className="hov" style={btnS} onClick={function() { loadSample(s); }}>
                  <span>+</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title.split("—")[0].trim()}</span>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }}>
            {regulations.length === 0
              ? <div style={{ padding: "20px 18px", color: C.muted, fontSize: 11, textAlign: "center", lineHeight: 1.7 }}>No regulations yet. Upload, paste, or try a sample.</div>
              : regulations.map(function(reg) {
                  return (
                    <div key={reg.id} className="hov"
                      style={{ padding: "12px 18px", borderBottom: "1px solid " + C.border, cursor: "pointer", borderLeft: "3px solid " + (reg.inScope ? C.success : selected && selected.id === reg.id ? C.accent : "transparent"), background: selected && selected.id === reg.id ? C.accent + "0d" : "transparent" }}
                      onClick={function() { setSelected(reg); setActiveTab("summary"); setMobileView("detail"); setShowMobileSidebar(false); }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: "bold", color: C.text, lineHeight: 1.3 }}>{reg.title}</div>
                        <button
                          onClick={function(e) {
                            e.stopPropagation();
                            setRegulations(function(prev) {
                              var updated = prev.map(function(r) { return r.id === reg.id ? Object.assign({}, r, { inScope: !r.inScope }) : r; });
                              saveRegs(updated);
                              return updated;
                            });
                            if (selected && selected.id === reg.id) setSelected(function(prev) { return Object.assign({}, prev, { inScope: !prev.inScope }); });
                          }}
                          style={{ background: reg.inScope ? C.success + "22" : "transparent", border: "1px solid " + (reg.inScope ? C.success + "66" : C.border), color: reg.inScope ? C.success : C.muted, borderRadius: 4, padding: "1px 6px", cursor: "pointer", fontSize: 9, fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {reg.inScope ? "✓ In Scope" : "Set Scope"}
                        </button>
                      </div>
                      <div style={{ fontSize: 9, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {reg.loading
                          ? <span style={{ color: C.accent }}>↻ Analyzing...</span>
                          : reg.analysis
                            ? <span style={{ color: riskColor(reg.analysis.riskLevel) }}>{"● " + reg.analysis.riskLevel + " Risk · " + (reg.analysis.controls || []).length + " Controls"}</span>
                            : <span style={{ color: C.warning }}>⚠ Failed</span>}
                        {reg.savedAt && !reg.loading && reg.analysis && <span style={{ color: reg.inScope ? C.success : C.muted, marginLeft: "auto" }}>{getExpiryLabel(reg)}</span>}
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Main panel */}
        <div className="main-panel" style={{ padding: "32px 40px", overflowY: "auto" }}>
          {!selected ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: C.muted, textAlign: "center", gap: 16 }}>
              <div style={{ fontSize: 52, opacity: 0.2 }}>⚖</div>
              <div style={{ fontSize: 16, fontWeight: "bold", letterSpacing: "0.12em" }}>NO REGULATION SELECTED</div>
              <div style={{ fontSize: 12, lineHeight: 1.8, maxWidth: 340 }}>Upload a file, paste text, import from a URL, or load a sample to generate an AI-powered compliance analysis.</div>
              {IS_MOBILE && <button onClick={function() { setShowMobileSidebar(true); }}
                style={{ background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "12px 28px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: "bold", letterSpacing: "0.1em", marginTop: 8 }}>
                + Analyze a Regulation
              </button>}
            </div>
          ) : selected.loading ? (
            <div>
              <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 24, color: C.text }}>{selected.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 12 }}>
                {[0,1,2].map(function(i) { return <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, display: "inline-block", animation: "blink 1s " + (i * 0.3) + "s step-start infinite" }} />; })}
                <span style={{ marginLeft: 6 }}>Running regulatory analysis...</span>
              </div>
            </div>
          ) : selected.error ? (
            <div style={{ color: C.critical, padding: "24px 0", fontSize: 13, lineHeight: 1.7 }}>{"⚠ " + selected.error}</div>
          ) : a ? (
            <div className="fade-in">
              {/* Mobile back button */}
              {IS_MOBILE && <button onClick={function() { setMobileView("home"); setSelected(null); }}
                style={{ display: "flex", background: "transparent", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, fontFamily: "inherit", marginBottom: 16, padding: 0, alignItems: "center", gap: 6 }}>
                ← Back to list
              </button>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
                <div style={{ flex: 1 }}>
                  {a.instrumentType && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.accent3 + "22", border: "1px solid " + C.accent3 + "44", color: "#a78bfa", padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: "bold", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                      {a.instrumentType === "Directive" ? "📘" : "📗"} {a.instrumentType}
                    </div>
                  )}
                  <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 4, lineHeight: 1.3 }}>{a.fullName || selected.title}</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    {a.referenceNumber && <span style={{ fontSize: 11, color: C.accent, fontWeight: "bold" }}>{a.referenceNumber}</span>}
                    <span style={{ fontSize: 11, color: C.muted }}>{"Added " + selected.addedAt}</span>
                  </div>
                </div>
                <div style={{ background: riskColor(a.riskLevel) + "22", border: "1px solid " + riskColor(a.riskLevel) + "55", color: riskColor(a.riskLevel), padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: "bold", letterSpacing: "0.1em", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {"● " + (a.riskLevel || "").toUpperCase() + " RISK"}
                </div>
              </div>

              <div className="meta-3col" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
                {[["Jurisdiction", a.jurisdiction, null], ["Effective Date", a.effectiveDate, null], ["Compliance Deadline", a.deadline, C.warning]].map(function(item) {
                  return (
                    <div key={item[0]} style={metaCard}>
                      <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{item[0]}</div>
                      <div style={{ fontSize: 13, fontWeight: "bold", color: item[2] || C.text }}>{item[1] || "—"}</div>
                    </div>
                  );
                })}
              </div>


              {/* In Scope / Expiry Banner */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: selected.inScope ? C.success + "11" : C.panel, border: "1px solid " + (selected.inScope ? C.success + "44" : C.border) }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: selected.inScope ? C.success : C.muted, fontWeight: "bold", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
                    {selected.inScope ? "✓ In Scope — Retained for 20 days" : "Not marked in scope — Retained for 10 days"}
                  </div>
                  {selected.savedAt && <div style={{ fontSize: 9, color: C.muted }}>{getExpiryLabel(selected)}</div>}
                </div>
                <button
                  onClick={function() {
                    var updated = !selected.inScope;
                    setRegulations(function(prev) {
                      var next = prev.map(function(r) { return r.id === selected.id ? Object.assign({}, r, { inScope: updated }) : r; });
                      saveRegs(next);
                      return next;
                    });
                    setSelected(Object.assign({}, selected, { inScope: updated }));
                  }}
                  style={{ background: selected.inScope ? C.success + "22" : C.accent + "22", border: "1px solid " + (selected.inScope ? C.success + "66" : C.accent + "66"), color: selected.inScope ? C.success : C.accent, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 10, fontFamily: "inherit", fontWeight: "bold", whiteSpace: "nowrap" }}>
                  {selected.inScope ? "✓ In Scope" : "Mark In Scope"}
                </button>
              </div>

              <div className="tab-scroll" style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid " + C.border, paddingBottom: 12 }}>
                {["summary","mmc","controls","source"].map(function(tab) {
                  return (
                    <button key={tab} className={"tab " + (activeTab === tab ? "ton" : "toff")} onClick={function() { setActiveTab(tab); }}>
                      {tab === "summary" ? "📋 Summary" : tab === "mmc" ? ("🏢 MMC (" + (a.mmcScope ? a.mmcScope.length : 0) + ")") : tab === "controls" ? ("⚡ Controls (" + (a.controls ? a.controls.length : 0) + ")") : "📄 Source"}
                    </button>
                  );
                })}
              </div>

              {activeTab === "summary" && (
                <div>
                  <div style={sHead}>◈ Executive Summary</div>
                  <div style={sumBox}>{a.summary}</div>

                  {a.mmcRisk && (function() {
                    var r = a.mmcRisk;
                    var rc = riskColor(r.rating);
                    var score = Math.min(10, Math.max(1, r.score || 5));
                    return (
                      <div style={{ marginTop: 24 }}>
                        <div style={sHead}>◈ MMC Business Risk Rating</div>
                        <div style={{ background: C.panel, border: "1px solid " + rc + "44", borderRadius: 12, overflow: "hidden" }}>
                          <div style={{ background: rc + "18", borderBottom: "1px solid " + rc + "33", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ fontSize: 11, color: rc, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>MMC-Specific Risk Level</div>
                              <div style={{ fontSize: 22, fontWeight: "bold", color: rc }}>{r.rating}</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 28, fontWeight: "bold", color: rc, lineHeight: 1 }}>{score}</div>
                              <div style={{ fontSize: 10, color: C.muted }}>/ 10</div>
                              <div style={{ width: 80, height: 6, background: C.border, borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
                                <div style={{ width: (score * 10) + "%", height: "100%", background: rc, borderRadius: 3 }} />
                              </div>
                            </div>
                          </div>
                          <div style={{ padding: "14px 20px", borderBottom: "1px solid " + C.border, fontSize: 12, color: C.text, lineHeight: 1.6 }}>{r.summary}</div>
                          <div className="risk-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
                            {[["💰 Financial", r.financialExposure, C.critical], ["📢 Reputational", r.reputationalExposure, C.warning], ["⚙️ Operational", r.operationalExposure, C.accent]].map(function(item, i) {
                              return (
                                <div key={item[0]} style={{ padding: "13px 16px", borderRight: i < 2 ? "1px solid " + C.border : "none", borderTop: "1px solid " + C.border }}>
                                  <div style={{ fontSize: 10, color: item[2], letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>{item[0]}</div>
                                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item[1]}</div>
                                </div>
                              );
                            })}
                          </div>
                          {r.mitigatingFactors && r.mitigatingFactors.length > 0 && (
                            <div style={{ padding: "12px 20px", borderTop: "1px solid " + C.border, background: C.success + "08" }}>
                              <div style={{ fontSize: 10, color: C.success, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>✓ Mitigating Factors</div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {r.mitigatingFactors.map(function(f, i) {
                                  return <span key={i} style={{ background: C.success + "15", border: "1px solid " + C.success + "33", color: C.success, padding: "3px 10px", borderRadius: 4, fontSize: 11 }}>{f}</span>;
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {a.impactAreas && a.impactAreas.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={sHead}>◈ Impact Areas</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {a.impactAreas.map(function(area, i) {
                          return <span key={i} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: "bold", background: C.accent3 + "22", border: "1px solid " + C.accent3 + "44", color: C.accent }}>{area}</span>;
                        })}
                      </div>
                    </div>
                  )}

                  {a.chapters && a.chapters.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={sHead}>◈ Document Structure — Key Chapters</div>
                      <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, overflow: "hidden" }}>
                        {a.chapters.map(function(ch, i) {
                          return (
                            <div key={i} style={{ display: "flex", gap: 14, padding: "10px 16px", borderBottom: i < a.chapters.length - 1 ? "1px solid " + C.border : "none", alignItems: "baseline" }}>
                              <div style={{ fontSize: 10, color: C.accent, fontWeight: "bold", letterSpacing: "0.1em", flexShrink: 0, minWidth: 90 }}>{ch.number}</div>
                              <div style={{ fontSize: 12, color: C.text }}>{ch.title}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 24 }}>
                    <div style={sHead}>◈ Key Legislative Provisions</div>
                    {[
                      { label: "Transitional Period", icon: "⏳", value: a.transitionalPeriod },
                      { label: "Transposition Date", icon: "📅", value: a.transpositionDate },
                      { label: "Repeal of Existing Legislation", icon: "🗑", value: a.repealOfLegislation },
                      { label: "Entry into Force", icon: "✅", value: a.entryIntoForce },
                    ].map(function(item) {
                      var isNA = !item.value || item.value === "N/A";
                      return (
                        <div key={item.label} style={{ background: C.panel, border: "1px solid " + (isNA ? C.border : C.accent + "44"), borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: isNA ? "none" : "1px solid " + C.border, background: isNA ? "transparent" : C.accent + "0a" }}>
                            <span style={{ fontSize: 14 }}>{item.icon}</span>
                            <span style={{ fontSize: 10, fontWeight: "bold", letterSpacing: "0.15em", color: isNA ? C.muted : C.accent, textTransform: "uppercase" }}>{item.label}</span>
                            {isNA && <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted, background: C.border, padding: "1px 7px", borderRadius: 3 }}>N/A</span>}
                          </div>
                          {!isNA && <div style={{ padding: "12px 16px", fontSize: 12, color: C.text, lineHeight: 1.7, fontStyle: "italic", whiteSpace: "pre-wrap" }}>{item.value}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "mmc" && (
                <div>
                  <div style={sHead}>◈ MMC Entity Scope Assessment</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>AI-assessed scope across Marsh McLennan group entities. Always validate with legal counsel.</div>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: C.critical, textTransform: "uppercase", marginBottom: 10 }}>{"● In Scope (" + (a.mmcScope ? a.mmcScope.filter(function(e) { return e.inScope; }).length : 0) + " entities)"}</div>
                    {a.mmcScope && a.mmcScope.filter(function(e) { return e.inScope; }).map(function(e, i) {
                      return (
                        <div key={i} style={{ background: C.panel, border: "1px solid " + C.critical + "33", borderLeft: "3px solid " + C.critical, borderRadius: 8, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>🏢</span>
                          <div><div style={{ fontSize: 13, fontWeight: "bold", color: C.text, marginBottom: 3 }}>{e.entity}</div><div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{e.reason}</div></div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: C.success, textTransform: "uppercase", marginBottom: 10 }}>{"● Out of Scope (" + (a.mmcScope ? a.mmcScope.filter(function(e) { return !e.inScope; }).length : 0) + " entities)"}</div>
                    {a.mmcScope && a.mmcScope.filter(function(e) { return !e.inScope; }).map(function(e, i) {
                      return (
                        <div key={i} style={{ background: C.panel, border: "1px solid " + C.border, borderLeft: "3px solid " + C.success, borderRadius: 8, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12 }}>
                          <span style={{ fontSize: 16, flexShrink: 0, opacity: 0.4 }}>🏢</span>
                          <div><div style={{ fontSize: 13, fontWeight: "bold", color: C.muted, marginBottom: 3 }}>{e.entity}</div><div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{e.reason}</div></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "controls" && (
                <div>
                  {(function() {
                    var allControls = getAllControls(regulations, selected.id);
                    var controls = a.controls || [];
                    var newCount = controls.filter(function(c) { return !isDuplicate(c.title, allControls); }).length;
                    var existCount = controls.length - newCount;
                    return (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                          <div style={sHead}>◈ Compliance Controls</div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {newCount > 0 && <span style={{ fontSize: 9, padding: "3px 9px", borderRadius: 3, background: C.accent + "22", border: "1px solid " + C.accent + "44", color: C.accent, fontWeight: "bold" }}>{newCount + " NEW"}</span>}
                            {existCount > 0 && <span style={{ fontSize: 9, padding: "3px 9px", borderRadius: 3, background: C.border, color: C.muted, fontWeight: "bold" }}>{existCount + " EXISTING"}</span>}
                          </div>
                        </div>
                        {existCount > 0 && newCount > 0 && <div style={{ fontSize: 10, color: C.warning, marginBottom: 14, padding: "8px 12px", background: C.warning + "11", border: "1px solid " + C.warning + "33", borderRadius: 6 }}>⚠ Controls marked EXISTING already appear in a previously analysed regulation. Focus on NEW controls for the incremental delta.</div>}
                        {controls.map(function(ctrl, i) {
                          var dupMatch = isDuplicate(ctrl.title, allControls);
                          var isNew = !dupMatch;
                          var open = !!openActions[i];
                          var catColor = { Governance: "#7c3aed", Risk: C.critical, Compliance: C.warning, Technology: C.accent, Operational: "#10b981", Reporting: "#f59e0b" }[ctrl.category] || C.muted;
                          return (
                            <div key={i} style={{ background: C.panel, border: "1px solid " + (isNew ? C.accent + "44" : C.border), borderLeft: "3px solid " + (isNew ? C.accent : C.border), borderRadius: 9, marginBottom: 10, overflow: "hidden", opacity: isNew ? 1 : 0.65 }}>
                              <div style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }} onClick={function() { setOpenActions(function(prev) { return Object.assign({}, prev, { [i]: !prev[i] }); }); }}>
                                <div style={{ background: C.accent + "22", border: "1px solid " + C.accent + "44", color: C.accent, width: 52, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", flexShrink: 0, letterSpacing: "0.05em" }}>{ctrl.controlId || ("CTRL-" + String(i+1).padStart(3,"0"))}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, flexWrap: "wrap" }}>
                                    <div style={{ fontSize: 12, fontWeight: "bold", color: isNew ? C.text : C.muted }}>{ctrl.title}</div>
                                    <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: isNew ? C.accent + "22" : C.border, border: "1px solid " + (isNew ? C.accent + "44" : C.border), color: isNew ? C.accent : C.muted, fontWeight: "bold", letterSpacing: "0.08em" }}>{isNew ? "NEW" : "EXISTING"}</span>
                                    {ctrl.category && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: catColor + "22", border: "1px solid " + catColor + "44", color: catColor, fontWeight: "bold" }}>{ctrl.category}</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 6 }}>{ctrl.description}</div>
                                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                    {ctrl.priority && <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 9, fontWeight: "bold", ...(ctrl.priority === "Immediate" ? { background: "#ef444422", border: "1px solid #ef444444", color: "#ef4444" } : ctrl.priority === "Short-term" ? { background: "#f59e0b22", border: "1px solid #f59e0b44", color: "#f59e0b" } : { background: "#10b98122", border: "1px solid #10b98144", color: "#10b981" }) }}>{ctrl.priority}</span>}
                                    {ctrl.owner && <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 9, background: C.border, color: C.muted }}>{"Owner: " + ctrl.owner}</span>}
                                    {ctrl.articleReference && <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 9, background: C.accent3 + "22", border: "1px solid " + C.accent3 + "33", color: "#a78bfa" }}>{ctrl.articleReference}</span>}
                                    {dupMatch && <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 9, background: C.border, color: C.muted }}>{"See: " + dupMatch.regTitle}</span>}
                                  </div>
                                </div>
                                <span style={{ color: C.muted, fontSize: 10, flexShrink: 0, marginTop: 4, display: "inline-block", transform: open ? "rotate(180deg)" : "none" }}>▼</span>
                              </div>
                              {open && (
                                <div style={{ borderTop: "1px solid " + C.border, padding: "12px 16px 16px 80px" }}>
                                  {ctrl.steps && ctrl.steps.length > 0 && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.accent, textTransform: "uppercase", marginBottom: 9 }}>◈ Implementation Steps</div>
                                      {ctrl.steps.map(function(step, si) {
                                        return (
                                          <div key={si} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 7 }}>
                                            <div style={{ background: C.accent3 + "33", border: "1px solid " + C.accent3 + "55", color: "#a78bfa", width: 18, height: 18, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: "bold", flexShrink: 0, marginTop: 1 }}>{si + 1}</div>
                                            <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{String(step).replace(/^Step \d+:\s*/i, "")}</div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {ctrl.testingCriteria && (
                                    <div style={{ background: C.success + "11", border: "1px solid " + C.success + "33", borderRadius: 6, padding: "9px 12px", display: "flex", gap: 8 }}>
                                      <span style={{ color: C.success, flexShrink: 0, fontSize: 12 }}>✓</span>
                                      <div>
                                        <div style={{ fontSize: 9, letterSpacing: "0.1em", color: C.success, textTransform: "uppercase", marginBottom: 3 }}>Testing Criteria</div>
                                        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>{ctrl.testingCriteria}</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {controls.length > 0 && (
                          <div style={{ marginTop: 16, padding: "12px 16px", background: C.panel, border: "1px solid " + C.border, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Export new controls to downstream system</div>
                              <div style={{ fontSize: 9, color: C.muted }}>{newCount + " new controls · " + controls.length + " total"}</div>
                            </div>
                            <button
                              onClick={function() {
                                var newControls = controls.filter(function(c) { return !isDuplicate(c.title, allControls); });
                                var payload = { regulationId: selected.id, regulationTitle: selected.title, reference: a.referenceNumber, exportedAt: new Date().toISOString(), controls: newControls };
                                var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                                var url = URL.createObjectURL(blob);
                                var link = document.createElement("a");
                                link.href = url; link.download = "controls-" + (a.referenceNumber || selected.id) + ".json";
                                link.click(); URL.revokeObjectURL(url);
                              }}
                              style={{ background: "linear-gradient(135deg," + C.accent + "22," + C.accent3 + "22)", border: "1px solid " + C.accent, color: C.accent, padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: "inherit", fontWeight: "bold" }}>
                              ↓ Export New Controls (JSON)
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {activeTab === "source" && (
                <div>
                  <div style={sHead}>◈ Source Text</div>
                  <div style={{ ...sumBox, whiteSpace: "pre-wrap", fontSize: 12, color: C.muted, maxHeight: 500, overflowY: "auto" }}>{selected.text}</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {showSources && <SourcesModal sources={sources} setSources={updateSources} onClose={function() { setShowSources(false); }} />}
      {showScanner && <ScannerModal scanning={scanning} scanProgress={scanProgress} scanResults={scanResults} onClose={function() { setShowScanner(false); }} onRescan={scanAllSources} onAnalyse={handleAnalyseFromScan} />}

      {/* Mobile Sidebar Drawer */}
      {IS_MOBILE && showMobileSidebar && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} onClick={function() { setShowMobileSidebar(false); }} />
          <div style={{ position: "relative", width: "88vw", maxWidth: 360, background: C.panel, borderRight: "1px solid " + C.border, overflowY: "auto", animation: "slideUp 0.25s ease", zIndex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: "bold", color: C.accent, letterSpacing: "0.1em" }}>DELPHI</span>
              <button onClick={function() { setShowMobileSidebar(false); }} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid " + C.border }}>
              <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 7, display: "block" }}>Ingest Regulation</span>
              <input type="text" placeholder="Title (optional)..." value={inputTitle} onChange={function(e) { setInputTitle(e.target.value); }} style={{ ...iStyle, marginBottom: 8, display: "block" }} />
              <UploadZone onFile={handleFileUpload} uploading={uploading} />
              <textarea placeholder="Paste regulation text..." value={inputText} onChange={function(e) { setInputText(e.target.value); }} rows={4} style={{ ...iStyle, resize: "none", lineHeight: 1.6, marginBottom: 8, display: "block" }} />
              <button className="btnp" style={{ ...btnP, opacity: !inputText.trim() || analyzing || uploading ? 0.5 : 1 }} onClick={function() { setShowMobileSidebar(false); addRegulation(); }} disabled={!inputText.trim() || analyzing || uploading}>
                {analyzing ? "↻ Analyzing..." : "→ Analyze"}
              </button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.border }}>
              <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 7, display: "block" }}>Sample Regulations</span>
              {SAMPLE_REGS.map(function(s, i) {
                return <button key={i} className="hov" style={btnS} onClick={function() { setShowMobileSidebar(false); loadSample(s); }}><span>+</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title.split("—")[0].trim()}</span></button>;
              })}
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ padding: "10px 16px 4px", fontSize: 9, color: C.muted, letterSpacing: "0.18em", textTransform: "uppercase" }}>Analyzed Regulations</div>
              {regulations.length === 0
                ? <div style={{ padding: "12px 16px", color: C.muted, fontSize: 10, lineHeight: 1.6 }}>No regulations yet.</div>
                : regulations.map(function(reg) {
                    return (
                      <div key={reg.id} className="hov"
                        style={{ padding: "11px 16px", borderBottom: "1px solid " + C.border, cursor: "pointer", borderLeft: "3px solid " + (reg.inScope ? C.success : selected && selected.id === reg.id ? C.accent : "transparent") }}
                        onClick={function() { setSelected(reg); setActiveTab("summary"); setMobileView("detail"); setShowMobileSidebar(false); }}>
                        <div style={{ fontSize: 11, fontWeight: "bold", color: C.text, marginBottom: 3 }}>{reg.title}</div>
                        <div style={{ fontSize: 9, color: C.muted }}>
                          {reg.loading ? <span style={{ color: C.accent }}>↻ Analyzing...</span>
                            : reg.analysis ? <span style={{ color: riskColor(reg.analysis.riskLevel) }}>{"● " + reg.analysis.riskLevel + " · " + (reg.analysis.controls || []).length + " Controls"}</span>
                            : <span style={{ color: C.warning }}>⚠ Failed</span>}
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      {IS_MOBILE && <div className="mobile-nav" style={{ display: "flex", position: "fixed", bottom: 0, left: 0, right: 0, background: C.panel, borderTop: "1px solid " + C.border, zIndex: 150, padding: "8px 0", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        {[
          { icon: "☰", label: "Menu", action: function() { setShowMobileSidebar(true); } },
          { icon: "⟳", label: "Scan", action: scanAllSources, disabled: scanning },
          { icon: "📋", label: "List", action: function() { setMobileView("home"); setSelected(null); } },
          { icon: "⚙", label: "Sources", action: function() { setShowSources(true); } },
        ].map(function(item, i) {
          return (
            <button key={i} onClick={item.disabled ? undefined : item.action}
              style={{ flex: 1, background: "transparent", border: "none", color: item.disabled ? C.muted : C.muted, cursor: item.disabled ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 0", opacity: item.disabled ? 0.4 : 1 }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted }}>{item.label}</span>
            </button>
          );
        })}
      </div>}

      {IS_MOBILE && <div style={{ height: 72 }} />}
    </div>
  );
}
