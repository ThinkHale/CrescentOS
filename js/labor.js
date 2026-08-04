// ---------- Labor report reconciliation (ported from Labor-Reconcile) ----------
VIEWS.labor = async () => {
  const d = sessionStorage.getItem("lb_date") || "2026-07-22";
  const s = sessionStorage.getItem("lb_shift") || "1st";
  $("#main").innerHTML = `
    <h1>Labor Reconciliation</h1>
    <p class="sub">Clock export vs PLX billing vs your revision — joined on EID, with typo detection and a copy-ready error report.</p>
    <div class="panel"><div class="inline">
      <div><label class="f">Date</label><input type="date" id="lb-date" value="${d}"></div>
      <div><label class="f">Shift</label><select id="lb-shift">${CONFIG.SHIFTS.map((x) => `<option ${x === s ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <button class="btn" id="lb-load">Load</button>
      <div style="flex:2"></div>
      <div><label class="f">Import file</label><input type="file" id="lb-file" accept=".csv,.xls,.xlsx"></div>
      <div><label class="f">As source</label><select id="lb-source">
        <option value="clock">Clock export (CSV or Excel)</option>
        <option value="client">PLX billing report (both shifts)</option>
        <option value="revised">Revised report</option></select></div>
      <button class="btn btn-primary" id="lb-import">⬆️ Import</button>
    </div>
    <p class="muted" style="margin:8px 0 0">Reports can also arrive automatically by email — see README for the Gmail hookup. Manual import always works.</p></div>
    <div id="lb-body"></div>`;
  $("#lb-load").onclick = renderLabor;
  $("#lb-date").onchange = renderLabor;
  $("#lb-shift").onchange = renderLabor;
  $("#lb-import").onclick = importLabor;
  renderLabor();
};

const isIndirectLine = (l) => (l || "").toLowerCase().includes("indirect");
function laborHours(r) {
  return r.source === "clock" ? (+r.payable_hours || 0) : (+r.reg_hours || 0) + (+r.ot_hours || 0) + (+r.dt_hours || 0);
}

let LB = null; // current recon state

async function renderLabor() {
  const date = $("#lb-date").value, shift = $("#lb-shift").value;
  sessionStorage.setItem("lb_date", date);
  sessionStorage.setItem("lb_shift", shift);
  const [rows, notes] = await Promise.all([
    fetchAll("labor_lines", "*", (q) => q.eq("report_date", date).eq("shift", shift)),
    fetchAll("labor_recon_notes", "*", (q) => q.eq("report_date", date).eq("shift", shift)),
  ]);
  if (!rows.length) {
    $("#lb-body").innerHTML = "<div class='panel'><p class='muted'>No labor data for this date/shift. Import the clock export and the PLX billing report above.</p></div>";
    return;
  }
  const noteMap = {};
  for (const n of notes) noteMap[n.eid] = n;

  // aggregate per person: clock rows may be badge-only (name-based badges keep eid null)
  const by = {};
  for (const r of rows) {
    const key = r.eid || "~" + (r.badge || r.name || r.id);
    const b = (by[key] ||= {
      key, eid: r.eid, name: null, badges: new Set(), lines: new Set(),
      clock: 0, clockDir: 0, clockInd: 0, client: 0, revised: 0,
      has: {}, rate: null, clockRowIds: [],
    });
    b.has[r.source] = true;
    const h = laborHours(r);
    b[r.source === "clock" ? "clock" : r.source] += h;
    if (r.source === "clock") {
      isIndirectLine(r.line_name) ? (b.clockInd += h) : (b.clockDir += h);
      b.clockRowIds.push(r.id);
      if (r.badge) b.badges.add(r.badge);
    }
    if (r.line_name) b.lines.add(r.line_name);
    if (r.name) b.name = flipName(r.name);
    if (r.bill_rate) b.rate = r.bill_rate;
  }
  for (const b of Object.values(by)) {
    if (!b.name && b.eid) b.name = State.roster.find((x) => x.eid === b.eid)?.full_name || null;
  }
  const list = Object.values(by).sort((a, b2) => (a.name || "zz").localeCompare(b2.name || "zz"));
  const hasRevised = rows.some((r) => r.source === "revised");
  const cmpSrc = hasRevised ? "revised" : "client";
  const mismatches = list.filter((b) => Math.abs(b.clock - b[cmpSrc]) > 0.01);
  LB = { date, shift, list, noteMap, cmpSrc, hasRevised };

  const tot = (k) => list.reduce((s2, b) => s2 + b[k], 0);
  const suggestions = buildSuggestions(list);

  $("#lb-body").innerHTML = `
    <div class="grid-4">
      <div class="kpi"><div class="l">Clock total</div><div class="v">${n2(tot("clock"))}</div>
        <div class="d muted">${n2(tot("clockDir"))} direct + ${n2(tot("clockInd"))} indirect</div></div>
      <div class="kpi"><div class="l">PLX billed</div><div class="v">${n2(tot("client"))}</div>
        <div class="d muted">${list.filter((b) => b.has.client).length} associates</div></div>
      <div class="kpi"><div class="l">Revised</div><div class="v">${hasRevised ? n2(tot("revised")) : "—"}</div>
        <div class="d muted">${hasRevised ? "sent to Crescent" : "not created yet"}</div></div>
      <div class="kpi"><div class="l">Discrepancies</div><div class="v" style="color:${mismatches.length ? "var(--bad)" : "var(--good)"}">${mismatches.length}</div>
        <div class="d muted">clock vs ${cmpSrc} · ${Object.values(noteMap).filter((n) => n.is_error).length} marked for report</div></div>
    </div>

    ${suggestions.length ? `<div class="panel mt" style="border-color:var(--warn)">
      <h2>💡 Suggested fixes (${suggestions.length})</h2>
      ${suggestions.map((r, i) => `<div class="match-chip">
        <span><b>${esc(r.type)}</b>: ${esc(r.reason)} <span class="muted">— clock ${n2(r.clockHours)}h vs billed ${n2(r.plxHours)}h (${esc(r.plxName || "")})</span></span>
        <button class="btn btn-sm btn-primary" data-fix="${i}">Apply: ${esc(r.fromKey.startsWith("~") ? "link badge to" : "re-EID to")} ${esc(r.toEid)}</button>
      </div>`).join("")}
    </div>` : ""}

    <div class="panel mt">
      <div class="inline" style="justify-content:space-between">
        <h2 style="margin:0">Per-associate comparison</h2>
        <div class="inline">
          <label style="display:flex;align-items:center;gap:5px"><input type="checkbox" id="lb-diff-only" style="width:auto"> differences only</label>
          <button class="btn btn-sm" id="lb-email">✉️ Copy error report</button>
          <button class="btn btn-sm" id="lb-export">⬇️ Export revised (xlsx)</button>
        </div>
      </div>
      <div class="table-scroll mt"><table id="lb-table"><thead><tr>
        <th>EID</th><th>Associate</th><th>Badge</th><th>Lines</th>
        <th class="num">Clock Dir</th><th class="num">Clock Ind</th><th class="num">Clock Total</th>
        <th class="num">PLX billed</th><th class="num">Revised</th><th class="num">Δ</th>
        <th>Status</th><th>Report?</th><th>Note</th></tr></thead><tbody></tbody></table></div>
    </div>`;

  const renderRows = () => {
    const diffOnly = $("#lb-diff-only").checked;
    $("#lb-table tbody").innerHTML = list
      .filter((b) => !diffOnly || Math.abs(b.clock - b[cmpSrc]) > 0.01)
      .map((b) => {
        const delta = b.clock - b[cmpSrc];
        const bad = Math.abs(delta) > 0.01;
        const note = noteMap[b.eid || b.key] || {};
        const missing = !b.has.clock ? "no clock punch" : !b.has.client && !b.has.revised ? "not billed" : "";
        return `<tr>
          <td>${esc(b.eid || "—")}${b.eid ? "" : " <span class='flag' title='badge without numeric EID'>?</span>"}</td>
          <td>${esc(b.name || "?")}</td>
          <td class="muted">${esc([...b.badges][0] || "")}</td>
          <td class="muted">${esc(fmtLines([...b.lines]))}</td>
          <td class="num">${b.has.clock ? n2(b.clockDir) : "—"}</td>
          <td class="num">${b.has.clock ? n2(b.clockInd) : "—"}</td>
          <td class="num">${b.has.clock ? n2(b.clock) : "—"}</td>
          <td class="num">${b.has.client ? n2(b.client) : "—"}</td>
          <td class="num">${b.has.revised ? n2(b.revised) : "—"}</td>
          <td class="num ${bad ? "flag" : ""}">${n2(delta)}</td>
          <td>${bad ? "<span class='pill pill-red'>MISMATCH</span>" : missing ? `<span class="pill pill-amber">${missing}</span>` : "<span class='pill pill-green'>OK</span>"}</td>
          <td><input type="checkbox" data-err="${esc(b.eid || b.key)}" style="width:auto" ${note.is_error ? "checked" : ""}></td>
          <td><input data-note="${esc(b.eid || b.key)}" value="${esc(note.note || "")}" placeholder="…" style="min-width:110px;font-size:12px;padding:4px 6px"></td>
        </tr>`;
      }).join("");
    $$("[data-err]").forEach((cb) => (cb.onchange = () => saveNote(cb.dataset.err, { is_error: cb.checked })));
    $$("[data-note]").forEach((inp) => (inp.onchange = () => saveNote(inp.dataset.note, { note: inp.value || null })));
  };
  $("#lb-diff-only").oninput = renderRows;
  $("#lb-export").onclick = () => exportRevised(date, shift, list);
  $("#lb-email").onclick = () => copyErrorReport(list, noteMap, cmpSrc);
  $$("[data-fix]").forEach((btn) => (btn.onclick = () => applyFix(suggestions[+btn.dataset.fix])));
  renderRows();
}

function fmtLines(lines) {
  const letters = lines.filter((l) => l && !isIndirectLine(l)).map((l) => {
    const m = l.match(/LINE\s*([A-Z]+)/i);
    return m ? m[1].toUpperCase() : l;
  });
  const ind = lines.some(isIndirectLine) ? ["Indirect"] : [];
  return [...new Set([...letters, ...ind])].join("/") && "Line " + [...new Set(letters)].join("/") + (ind.length ? " +Ind" : "") || ind.join("");
}

async function saveNote(eidKey, patch) {
  const row = { report_date: LB.date, shift: LB.shift, eid: eidKey, entered_by: enteredBy(), updated_at: new Date().toISOString(), ...patch };
  const { error } = await sb.from("labor_recon_notes").upsert(row, { onConflict: "report_date,shift,eid" });
  if (error) toast(error.message, true);
  else LB.noteMap[eidKey] = { ...(LB.noteMap[eidKey] || {}), ...row };
}

// ---- typo detection (ported: badge letters vs last name, digit diffs/patterns) ----
function buildSuggestions(list) {
  const recs = [];
  const clockOnly = list.filter((b) => b.has.clock && !b.has.client && !b.has.revised);
  const billedOnly = list.filter((b) => !b.has.clock && (b.has.client || b.has.revised));
  for (const c of clockOnly) {
    const badge = [...c.badges][0] || "";
    const letters = (badge.match(/([A-Za-z]+)\s*$/) || [])[1] || "";
    const cEid = c.eid || "";
    for (const p of billedOnly) {
      if (!p.eid) continue;
      const lastName = ((p.name || "").trim().split(/\s+/).pop() || "");
      const base = { fromKey: c.key, toEid: p.eid, clockHours: c.clock, plxHours: p[LB?.hasRevised ? "revised" : "client"] ?? p.client, plxName: p.name };
      // badge letters match billed last name (covers name-based badges like plx-smith)
      if (letters.length >= 3 && lastName.toLowerCase().startsWith(letters.toLowerCase().slice(0, 3))) {
        recs.push({ ...base, type: "Badge ↔ Name", reason: `badge "${badge}" letters match ${p.name}` });
        continue;
      }
      if (!cEid) continue;
      if (cEid.length === p.eid.length) {
        let diff = 0;
        for (let i = 0; i < cEid.length; i++) if (cEid[i] !== p.eid[i]) diff++;
        if (diff === 1) { recs.push({ ...base, type: "EID typo", reason: `${cEid} vs ${p.eid} (1 digit off)` }); continue; }
      }
      const [sh, lo] = cEid.length < p.eid.length ? [cEid, p.eid] : [p.eid, cEid];
      if (sh && lo.includes(sh) && lo.length - sh.length <= 3) {
        recs.push({ ...base, type: "EID digits", reason: `${cEid} vs ${p.eid} (missing/extra digit${lo.length - sh.length > 1 ? "s" : ""})` });
        continue;
      }
      if (sh.length >= 6) { // sequential digit-pattern match
        let m = 0, j = 0;
        for (let i = 0; i < lo.length && j < sh.length; i++) if (lo[i] === sh[j]) { m++; j++; }
        if (m >= sh.length - 1 && m >= sh.length * 0.8 && Math.abs(cEid.length - p.eid.length) >= 1) {
          recs.push({ ...base, type: "Digit pattern", reason: `${cEid} vs ${p.eid} (similar sequence)` });
        }
      }
    }
  }
  // dedupe by fromKey (keep first suggestion per clock row)
  const seen = new Set();
  return recs.filter((r) => !seen.has(r.fromKey) && seen.add(r.fromKey)).slice(0, 12);
}

async function applyFix(rec) {
  const b = LB.list.find((x) => x.key === rec.fromKey);
  if (!b || !b.clockRowIds.length) return;
  if (!confirm(`Re-assign ${b.clockRowIds.length} clock line(s) from "${b.eid || [...b.badges][0]}" to EID ${rec.toEid}?`)) return;
  const { error } = await sb.from("labor_lines").update({ eid: rec.toEid }).in("id", b.clockRowIds);
  if (error) return toast(error.message, true);
  toast(`Fixed — clock hours now credited to EID ${rec.toEid} ✔`);
  renderLabor();
}

// ---- discrepancy email (ported format) ----
function copyErrorReport(list, noteMap, cmpSrc) {
  const marked = list.filter((b) => noteMap[b.eid || b.key]?.is_error);
  const items = (marked.length ? marked : list.filter((b) => Math.abs(b.clock - b[cmpSrc]) > 0.01));
  if (!items.length) return toast("No discrepancies to report", true);
  const fmtH = (h) => (Math.round(h * 100) / 100 % 1 === 0 ? (Math.round(h * 100) / 100).toFixed(0) : (Math.round(h * 100) / 100).toString());
  const text = items.map((b, i) => {
    const badge = [...b.badges][0] || "";
    const note = noteMap[b.eid || b.key]?.note;
    return `${i + 1}. ${b.name || "EID " + (b.eid || "?")} – worked on ${fmtLines([...b.lines]) || "?"} for ${fmtH(b.clock)} hours, not ${fmtH(b[cmpSrc])} hours${badge ? "\n" + badge : ""}${note ? "\nNote: " + note : ""}`;
  }).join("\n\n");
  openModal(`
    <h2>✉️ Labor discrepancy report — ${fmtDate(LB.date)} ${LB.shift} shift</h2>
    <p class="muted">${marked.length ? marked.length + " marked item(s)" : items.length + " mismatches (none marked — showing all)"} · edit before copying</p>
    <pre class="email" contenteditable="true" id="err-body">${esc(text)}</pre>
    <div class="inline mt">
      <button class="btn btn-primary" id="err-copy">📋 Copy to clipboard</button>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
  $("#err-copy").onclick = async () => {
    await navigator.clipboard.writeText($("#err-body").innerText);
    toast("Copied ✔");
  };
}

// ---------- imports ----------
async function importLabor() {
  const file = $("#lb-file").files[0];
  const source = $("#lb-source").value;
  const date = $("#lb-date").value, shift = $("#lb-shift").value;
  if (!file) return toast("Choose a file first", true);
  try {
    let byShift = {};
    if (file.name.toLowerCase().endsWith(".csv")) {
      if (source !== "clock") return toast("CSV files are clock exports — set source to Clock", true);
      byShift[shift] = parseClockCSV(await file.text(), date, shift);
    } else {
      const buf = await file.arrayBuffer();
      // cellDates so clock in/out come back as Dates instead of Excel serials
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
      // The two report shapes are told apart by their header, not the file
      // extension — both arrive as .xls/.xlsx, and picking the wrong dropdown
      // is the easiest mistake to make.
      const kind = detectGridKind(grid);
      if (kind === "clock" && source !== "clock")
        return toast('That looks like a clock export (Badge column) — set "As source" to Clock export.', true);
      if (kind === "plx" && source === "clock")
        return toast('That looks like a PLX/Revised billing report (Dept column) — set "As source" to PLX billing or Revised.', true);
      if (source === "clock") {
        byShift[shift] = parseClockGrid(grid, date, shift);
      } else if (source === "client") {
        byShift = parsePLXGridBothShifts(grid, date); // billing workbook = both shifts
      } else {
        byShift[shift] = parsePLXGrid(grid, date, shift, source);
      }
    }
    let total = 0;
    for (const [sh, lines] of Object.entries(byShift)) {
      if (!lines.length) continue;
      await sb.from("labor_lines").delete().eq("report_date", date).eq("shift", sh).eq("source", source);
      for (let i = 0; i < lines.length; i += 400) {
        const { error } = await sb.from("labor_lines").insert(lines.slice(i, i + 400));
        if (error) return toast(error.message, true);
      }
      total += lines.length;
    }
    if (!total) return toast("No data rows recognized in that file", true);
    toast(`Imported ${total} ${source} line(s)${source === "client" ? " across both shifts" : ""} ✔`);
    renderLabor();
  } catch (e) {
    toast("Import failed: " + e.message, true);
  }
}

// Badges are hand-configured at the clock, so the format wanders:
// PLX-12345678-XYZ, plx-12345678-xyz, and PLX12345678-XYZ (missing dash) all
// mean the same person. Name-based badges (plx-smith) carry no digits — those
// keep eid null and get matched by the suggestion engine below.
const BADGE_RE = /plx-*\s*(\d+)/i;
const cellText = (v) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

function parseClockCSV(text, date, shift) {
  return parseClockRows(parseCSV(text), date, shift);
}

function parseClockGrid(grid, date, shift) {
  return parseClockRows(grid, date, shift);
}

// Shared by the CSV export and the Excel one — both reduce to rows of cells.
function parseClockRows(rows, date, shift) {
  const hdrI = rows.findIndex((r) => r && r.some((c) => cellText(c).toLowerCase() === "badge"));
  if (hdrI < 0) throw new Error("No 'Badge' column found — is this the clock export?");
  const hdr = rows[hdrI].map((h) => cellText(h).toLowerCase());
  const col = (name) => hdr.indexOf(name.toLowerCase());
  const iBadge = col("Badge"), iIn = col("Clock in time"), iOut = col("Clock out time"),
    iPay = col("Payable hours"), iDur = col("Duration"), iLine = col("Line name"),
    iJob = col("Job ID"), iWO = col("Work Order Code");
  const out = [];
  for (const r of rows.slice(hdrI + 1)) {
    if (!r) continue;
    const badge = cellText(r[iBadge]);
    if (!badge) continue;
    const m = badge.match(BADGE_RE);
    out.push({
      report_date: date, shift, source: "clock",
      eid: m ? m[1] : null, badge,
      clock_in: parseClockTime(r[iIn]), clock_out: parseClockTime(r[iOut]),
      payable_hours: num(r[iPay]), duration: num(r[iDur]),
      line_name: iLine >= 0 ? cellText(r[iLine]) || null : null,
      job_id: iJob >= 0 ? cellText(r[iJob]) || null : null,
      work_order: iWO >= 0 ? cellText(r[iWO]) || null : null,
    });
  }
  return out;
}

const pad2 = (n) => String(n).padStart(2, "0");
const localStamp = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

// Accepts the CSV's "2026-Aug-03 16:30:00", an Excel Date cell, or a serial
// number. Stored as the wall-clock time the report shows — a 16:30 punch is
// 16:30, not shifted into UTC.
function parseClockTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : localStamp(v);
  if (typeof v === "number") {
    // Excel serial: days since 1899-12-30, read in UTC then treated as wall clock
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? null : localStamp(new Date(d.getTime() + d.getTimezoneOffset() * 60000));
  }
  const d = new Date(String(v).replace(/(\d{4})-(\w{3})-(\d{2})/, "$2 $3, $1"));
  return isNaN(d) ? null : localStamp(d);
}

// Which of the two report shapes is this? Header-based, not extension-based.
function detectGridKind(grid) {
  for (const r of grid.slice(0, 40)) {
    if (!r) continue;
    const cells = r.map((c) => cellText(c).toLowerCase());
    if (cells.includes("badge")) return "clock";
    if (cells.includes("dept")) return "plx";
  }
  return null;
}

const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function plxHeaderInfo(grid, date) {
  const hdrI = grid.findIndex((r) => String(r?.[0] ?? "").trim() === "Dept");
  if (hdrI < 0) throw new Error("Couldn't find the 'Dept' header row — is this the PLX/Revised labor report?");
  const dayRow = grid[hdrI - 1] || [];
  const target = DAYNAMES[new Date(date + "T12:00:00").getDay()];
  let dayCol = dayRow.findIndex((c) => String(c ?? "").trim() === target);
  if (dayCol < 0) dayCol = 4;
  return { hdrI, dayCol };
}

function plxRow(r, dayCol, date, shift, source) {
  const eidRaw = String(r[1] ?? "").replace(/\.0$/, "").trim();
  const name = String(r[2] ?? "").trim();
  const eid = /^\d{4,9}$/.test(eidRaw) ? eidRaw : null;
  if (!eid && (!name || /total/i.test(name))) return null;
  if (!eid && !name) return null;
  return {
    report_date: date, shift, source, eid, name: name || null,
    dept: r[0] != null ? String(r[0]) : null, bill_rate: num(r[3]),
    reg_hours: num(r[dayCol]) || 0, reg_amount: num(r[dayCol + 1]) || 0,
    ot_hours: num(r[dayCol + 2]) || 0, ot_amount: num(r[dayCol + 3]) || 0,
    dt_hours: num(r[dayCol + 4]) || 0, dt_amount: num(r[dayCol + 5]) || 0,
  };
}

function parsePLXGrid(grid, date, shift, source) {
  const { hdrI, dayCol } = plxHeaderInfo(grid, date);
  return grid.slice(hdrI + 1).map((r) => r && plxRow(r, dayCol, date, shift, source)).filter(Boolean);
}

// billing workbook contains 1st shift rows, then "Shift 1 Total", then 2nd shift rows
function parsePLXGridBothShifts(grid, date) {
  const { hdrI, dayCol } = plxHeaderInfo(grid, date);
  const s1End = grid.findIndex((r) => /shift\s*1\s*total/i.test(String(r?.[2] ?? "")));
  const out = { "1st": [], "2nd": [] };
  grid.slice(hdrI + 1).forEach((r, idx) => {
    if (!r) return;
    const absIdx = hdrI + 1 + idx;
    const shift = s1End >= 0 && absIdx > s1End ? "2nd" : "1st";
    const row = plxRow(r, dayCol, date, shift, "client");
    if (row) out[shift].push(row);
  });
  return out;
}
