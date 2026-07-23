// ---------- Labor report reconciliation ----------
VIEWS.labor = async () => {
  const d = sessionStorage.getItem("lb_date") || "2026-07-22";
  const s = sessionStorage.getItem("lb_shift") || "1st";
  $("#main").innerHTML = `
    <h1>Labor Reconciliation</h1>
    <p class="sub">Clock export vs Crescent's report vs your revision — differences surface automatically, joined on EID.</p>
    <div class="panel"><div class="inline">
      <div><label class="f">Date</label><input type="date" id="lb-date" value="${d}"></div>
      <div><label class="f">Shift</label><select id="lb-shift">${CONFIG.SHIFTS.map((x) => `<option ${x === s ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <button class="btn" id="lb-load">Load</button>
      <div style="flex:2"></div>
      <div><label class="f">Import file</label><input type="file" id="lb-file" accept=".csv,.xls,.xlsx"></div>
      <div><label class="f">As source</label><select id="lb-source"><option value="clock">Clock export</option><option value="client">Crescent (PLX) report</option><option value="revised">Revised report</option></select></div>
      <button class="btn btn-primary" id="lb-import">⬆️ Import</button>
    </div></div>
    <div id="lb-body"></div>`;
  $("#lb-load").onclick = renderLabor;
  $("#lb-date").onchange = renderLabor;
  $("#lb-shift").onchange = renderLabor;
  $("#lb-import").onclick = importLabor;
  renderLabor();
};

function laborHours(r) {
  return r.source === "clock" ? (+r.payable_hours || 0) : (+r.reg_hours || 0) + (+r.ot_hours || 0) + (+r.dt_hours || 0);
}

async function renderLabor() {
  const date = $("#lb-date").value, shift = $("#lb-shift").value;
  sessionStorage.setItem("lb_date", date);
  sessionStorage.setItem("lb_shift", shift);
  const rows = await fetchAll("labor_lines", "*", (q) => q.eq("report_date", date).eq("shift", shift));
  if (!rows.length) { $("#lb-body").innerHTML = "<div class='panel'><p class='muted'>No labor data for this date/shift. Import the clock export and Crescent's report above.</p></div>"; return; }

  const byEid = {};
  for (const r of rows) {
    const key = r.eid || "?" + (r.badge || r.name);
    const b = (byEid[key] ||= { eid: r.eid, name: null, badge: r.badge, clock: 0, client: 0, revised: 0, has: {}, rate: null, lines: [] });
    b.has[r.source] = true;
    b[r.source] += laborHours(r);
    if (r.name) b.name = flipName(r.name);
    if (r.bill_rate) b.rate = r.bill_rate;
    if (r.line_name) b.lines.push(r.line_name);
  }
  for (const b of Object.values(byEid)) {
    if (!b.name && b.eid) b.name = State.roster.find((x) => x.eid === b.eid)?.full_name || null;
  }
  const hasClient = rows.some((r) => r.source === "client");
  const hasRevised = rows.some((r) => r.source === "revised");
  const list = Object.values(byEid).sort((a, b) => (a.name || "z").localeCompare(b.name || "z"));

  const diffs = list.filter((b) => {
    const base = b.clock, cmp = hasRevised ? b.revised : b.client;
    return (b.has.clock || b.has.client || b.has.revised) && Math.abs(base - cmp) > 0.01;
  });
  const tot = (src) => list.reduce((s, b) => s + b[src], 0);
  const billTot = (src) => list.reduce((s, b) => s + b[src] * (b.rate || 0), 0);

  $("#lb-body").innerHTML = `
    <div class="grid-4">
      <div class="kpi"><div class="l">Clock hours</div><div class="v">${n2(tot("clock"))}</div><div class="d muted">${list.filter((b) => b.has.clock).length} associates</div></div>
      <div class="kpi"><div class="l">Crescent billed</div><div class="v">${n2(tot("client"))}</div><div class="d muted">${money(billTot("client"))}</div></div>
      <div class="kpi"><div class="l">Revised</div><div class="v">${n2(tot("revised"))}</div><div class="d muted">${money(billTot("revised"))}</div></div>
      <div class="kpi"><div class="l">Discrepancies</div><div class="v" style="color:${diffs.length ? "var(--bad)" : "var(--good)"}">${diffs.length}</div>
        <div class="d muted">clock vs ${hasRevised ? "revised" : "client"}</div></div>
    </div>
    <div class="panel mt">
      <div class="inline" style="justify-content:space-between">
        <h2 style="margin:0">Per-associate comparison</h2>
        <div>
          <label style="margin-right:14px"><input type="checkbox" id="lb-diff-only" style="width:auto"> differences only</label>
          <button class="btn btn-sm" id="lb-export">⬇️ Export revised report (xlsx)</button>
        </div>
      </div>
      <div class="table-scroll mt"><table id="lb-table"><thead><tr>
        <th>EID</th><th>Associate</th><th>Line(s)</th><th class="num">Clock hrs</th>
        <th class="num">Crescent hrs</th><th class="num">Revised hrs</th><th class="num">Δ (clock − ${hasRevised ? "revised" : "client"})</th>
        <th class="num">Rate</th><th class="num">$ impact</th><th>Status</th></tr></thead><tbody></tbody></table></div>
    </div>`;

  const renderRows = () => {
    const diffOnly = $("#lb-diff-only").checked;
    const cmpSrc = hasRevised ? "revised" : "client";
    $("#lb-table tbody").innerHTML = list.filter((b) => !diffOnly || Math.abs(b.clock - b[cmpSrc]) > 0.01).map((b) => {
      const delta = b.clock - b[cmpSrc];
      const bad = Math.abs(delta) > 0.01;
      const missing = !b.has.clock ? "no clock record" : (hasClient && !b.has.client && !b.has.revised) ? "not on Crescent report" : "";
      return `<tr>
        <td>${esc(b.eid || "—")}</td><td>${esc(b.name || b.badge || "?")}</td>
        <td class="muted">${esc([...new Set(b.lines)].join(", "))}</td>
        <td class="num">${b.has.clock ? n2(b.clock) : "—"}</td>
        <td class="num">${b.has.client ? n2(b.client) : "—"}</td>
        <td class="num">${b.has.revised ? n2(b.revised) : "—"}</td>
        <td class="num ${bad ? "flag" : ""}">${n2(delta)}</td>
        <td class="num">${b.rate ? money(b.rate) : "—"}</td>
        <td class="num ${bad ? "flag" : ""}">${b.rate ? money(delta * b.rate) : "—"}</td>
        <td>${bad ? "<span class='pill pill-red'>MISMATCH</span>" : missing ? `<span class="pill pill-amber">${missing}</span>` : "<span class='pill pill-green'>OK</span>"}</td>
      </tr>`;
    }).join("");
  };
  $("#lb-diff-only").oninput = renderRows;
  $("#lb-export").onclick = () => exportRevised(date, shift, list);
  renderRows();
}

// ---------- imports ----------
async function importLabor() {
  const file = $("#lb-file").files[0];
  const source = $("#lb-source").value;
  const date = $("#lb-date").value, shift = $("#lb-shift").value;
  if (!file) return toast("Choose a file first", true);
  try {
    let lines = [];
    if (file.name.toLowerCase().endsWith(".csv")) {
      lines = parseClockCSV(await file.text(), date, shift);
      if (source !== "clock") return toast("CSV files are clock exports — set source to Clock", true);
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      lines = parsePLXGrid(grid, date, shift, source);
    }
    if (!lines.length) return toast("No data rows recognized in that file", true);
    // replace existing rows for this date/shift/source
    await sb.from("labor_lines").delete().eq("report_date", date).eq("shift", shift).eq("source", source);
    for (let i = 0; i < lines.length; i += 400) {
      const { error } = await sb.from("labor_lines").insert(lines.slice(i, i + 400));
      if (error) return toast(error.message, true);
    }
    toast(`Imported ${lines.length} ${source} lines ✔`);
    renderLabor();
  } catch (e) {
    toast("Import failed: " + e.message, true);
  }
}

function parseClockCSV(text, date, shift) {
  const rows = parseCSV(text);
  const hdr = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => hdr.indexOf(name.toLowerCase());
  const iBadge = col("Badge"), iIn = col("Clock in time"), iOut = col("Clock out time"),
    iPay = col("Payable hours"), iDur = col("Duration"), iLine = col("Line name"),
    iJob = col("Job ID"), iWO = col("Work Order Code");
  if (iBadge < 0) throw new Error("No 'Badge' column found — is this the clock export?");
  const out = [];
  for (const r of rows.slice(1)) {
    const badge = (r[iBadge] || "").trim();
    if (!badge) continue;
    const m = badge.match(/plx-+(\d+)-/i);
    out.push({
      report_date: date, shift, source: "clock",
      eid: m ? m[1] : null, badge,
      clock_in: parseClockTime(r[iIn]), clock_out: parseClockTime(r[iOut]),
      payable_hours: num(r[iPay]), duration: num(r[iDur]),
      line_name: iLine >= 0 ? r[iLine] : null, job_id: iJob >= 0 ? r[iJob] : null,
      work_order: iWO >= 0 ? r[iWO] : null,
    });
  }
  return out;
}

function parseClockTime(s) {
  if (!s) return null;
  const d = new Date(s.replace(/(\d{4})-(\w{3})-(\d{2})/, "$2 $3, $1"));
  return isNaN(d) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parsePLXGrid(grid, date, shift, source) {
  const hdrI = grid.findIndex((r) => String(r?.[0] ?? "").trim() === "Dept");
  if (hdrI < 0) throw new Error("Couldn't find the 'Dept' header row — is this the PLX/Revised labor report?");
  const dayRow = grid[hdrI - 1] || [];
  const target = DAYNAMES[new Date(date + "T12:00:00").getDay()];
  let dayCol = dayRow.findIndex((c) => String(c ?? "").trim() === target);
  if (dayCol < 0) dayCol = 4;
  const out = [];
  for (const r of grid.slice(hdrI + 1)) {
    if (!r) continue;
    const eidRaw = String(r[1] ?? "").replace(/\.0$/, "").trim();
    const name = String(r[2] ?? "").trim();
    if (!/^\d{4,9}$/.test(eidRaw) && !name) continue;
    if (!/^\d{4,9}$/.test(eidRaw) && /total/i.test(name)) continue;
    if (!name && !eidRaw) continue;
    out.push({
      report_date: date, shift, source,
      eid: /^\d{4,9}$/.test(eidRaw) ? eidRaw : null,
      name: name || null, dept: r[0] != null ? String(r[0]) : null,
      bill_rate: num(r[3]),
      reg_hours: num(r[dayCol]) || 0, reg_amount: num(r[dayCol + 1]) || 0,
      ot_hours: num(r[dayCol + 2]) || 0, ot_amount: num(r[dayCol + 3]) || 0,
      dt_hours: num(r[dayCol + 4]) || 0, dt_amount: num(r[dayCol + 5]) || 0,
    });
  }
  return out.filter((x) => x.eid || x.name);
}
