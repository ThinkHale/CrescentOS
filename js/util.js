// ---------- generic helpers ----------
// View registry — declared here (first script) so views.js/labor.js can
// register screens before app.js wires up the router.
const VIEWS = {};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), isErr ? 6000 : 3200);
}

function openModal(html) { $("#modal").innerHTML = html; $("#modal-wrap").classList.remove("hidden"); }
function closeModal() { $("#modal-wrap").classList.add("hidden"); }
document.addEventListener("click", (e) => { if (e.target.id === "modal-wrap") closeModal(); });

// ---------- dates ----------
const todayISO = () => new Date().toLocaleDateString("en-CA");
function fmtDate(d) {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${m}/${dd}/${y.slice(2)}`;
}
function weekEndingSunday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const add = (7 - d.getDay()) % 7; // Sunday = 0
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString("en-CA");
}
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEPT","OCT","NOV","DEC"];

// ---------- numbers ----------
const pct = (v) => (v == null || isNaN(v)) ? "—" : (v * 100).toFixed(1) + "%";
const n0 = (v) => (v == null || isNaN(v)) ? "—" : (+v).toLocaleString();
const n2 = (v) => (v == null || isNaN(v)) ? "—" : (+v).toFixed(2);
const money = (v) => (v == null || isNaN(v)) ? "—" : "$" + (+v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const x = parseFloat(v); return isNaN(x) ? null : x; };

// ---------- name matching ----------
function normName(s) {
  if (!s) return null;
  return s.toLowerCase().replace(/[^a-z' -]/g, "").replace(/\s+/g, " ").trim() || null;
}
// "LAST, FIRST" -> "First Last"
function flipName(s) {
  if (!s || !s.includes(",")) return s;
  const [l, f] = s.split(",").map((x) => x.trim());
  const tc = (w) => w.split(" ").map((x) => x ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x).join(" ");
  return `${tc(f)} ${tc(l)}`;
}
function nameTokens(s) { return (normName(s) || "").split(" ").filter(Boolean); }
// similarity score 0..1 for fuzzy matching
function nameScore(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (normName(a) === normName(b)) return 1;
  let hits = 0;
  for (const x of ta) {
    if (tb.some((y) => y === x)) { hits += 1; continue; }
    if (tb.some((y) => y.length > 2 && x.length > 2 && (y.startsWith(x) || x.startsWith(y)))) hits += 0.7;
  }
  return hits / Math.max(ta.length, tb.length);
}
// Find best associate matches for a free-typed name (and optional EID)
function matchAssociates(roster, query) {
  const q = query.trim();
  if (/^\d{4,9}$/.test(q)) {
    const hit = roster.find((r) => r.eid === q);
    return hit ? [{ ...hit, score: 1 }] : [];
  }
  return roster
    .map((r) => ({ ...r, score: nameScore(r.full_name || "", q) }))
    .filter((r) => r.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// DNR check for a person (by eid / l4 / name) against dnr_list rows
function dnrMatches(dnrRows, { eid, l4_ssn, name }) {
  const nk = normName(name);
  return dnrRows.filter((d) =>
    (eid && d.eid === eid) ||
    (l4_ssn && d.l4_ssn && d.l4_ssn === l4_ssn) ||
    (nk && d.name_key && d.name_key === nk)
  );
}

// ---------- csv ----------
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

function download(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
