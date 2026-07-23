// ---------- Shift Entry / Scorecard / Early Leaves / New Starts / Associates / Admin ----------

// ======================================================= SHIFT ENTRY
VIEWS.entry = async () => {
  const d = sessionStorage.getItem("entry_date") || todayISO();
  const s = sessionStorage.getItem("entry_shift") || "1st";
  $("#main").innerHTML = `
    <h1>Shift Entry</h1>
    <p class="sub">Start-of-shift numbers, new starts, early leaves, end-of-shift wrap, and notes — one place.</p>
    <div class="panel">
      <div class="inline">
        <div><label class="f">Date</label><input type="date" id="en-date" value="${d}"></div>
        <div><label class="f">Shift</label><select id="en-shift">${CONFIG.SHIFTS.map((x) => `<option ${x === s ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <button class="btn" id="en-load">Load</button>
      </div>
    </div>
    <div id="en-body"></div>`;
  $("#en-load").onclick = loadEntry;
  $("#en-date").onchange = loadEntry;
  $("#en-shift").onchange = loadEntry;
  loadEntry();
};

async function loadEntry() {
  const date = $("#en-date").value, shift = $("#en-shift").value;
  sessionStorage.setItem("entry_date", date);
  sessionStorage.setItem("entry_shift", shift);
  const [{ data: reps }, els, notes, att] = await Promise.all([
    sb.from("shift_reports").select("*").eq("report_date", date).eq("shift", shift),
    fetchAll("early_leaves", "*", (q) => q.eq("leave_date", date).eq("shift", shift)),
    fetchAll("shift_notes", "*", (q) => q.eq("report_date", date).eq("shift", shift).order("created_at")),
    fetchAll("attendance", "*", (q) => q.eq("report_date", date).eq("shift", shift).eq("is_new_start", true)),
  ]);
  const r = reps?.[0] || {};
  const F = (k, step = "1") => `<input type="number" step="${step}" id="en-${k}" value="${r[k] ?? ""}">`;
  $("#en-body").innerHTML = `
    <div class="row">
      <div class="panel">
        <h2>🟢 Start of shift</h2>
        <div class="row">
          <div><label class="f">Forecasted</label>${F("forecasted")}</div>
          <div><label class="f">Requested</label>${F("requested")}</div>
          <div><label class="f">Required</label>${F("required")}</div>
        </div>
        <div class="row">
          <div><label class="f">Working (direct)</label>${F("working")}</div>
          <div><label class="f">Indirect</label>${F("indirect_working")}</div>
          <div><label class="f">Lines cut</label>${F("lines_cut")}</div>
        </div>
        <div class="row">
          <div><label class="f">Sent home</label>${F("sent_home")}</div>
          <div><label class="f">Daily direct people</label>${F("daily_direct_people")}</div>
          <div></div>
        </div>
      </div>
      <div class="panel">
        <h2>🔴 End of shift</h2>
        <div class="row">
          <div><label class="f">Direct hours worked</label>${F("direct_hours_worked", "0.25")}</div>
          <div><label class="f">Total direct hours</label>${F("total_direct_hours", "0.25")}</div>
        </div>
        <div class="row">
          <div><label class="f">Surveys completed</label>${F("surveys_completed")}</div>
          <div><label class="f">DNRs</label>${F("dnrs")}</div>
        </div>
        <p class="muted mt">Fill % and variance are computed automatically. Early leave count auto-syncs from the entries below (currently <b>${els.length}</b>).</p>
      </div>
    </div>

    <div class="panel">
      <h2>🚀 New starts attending (${att.length})</h2>
      <div class="inline">
        <div style="flex:2"><label class="f">Name or EID</label><input id="ns-att-input" placeholder="Type a name — I’ll match against the tracker"></div>
        <button class="btn" id="ns-att-check">Check &amp; add</button>
      </div>
      <div id="ns-att-suggest"></div>
      <table class="mt"><thead><tr><th>Name</th><th>EID</th><th>Tracker status</th><th>Flags</th><th></th></tr></thead>
        <tbody>${att.map((a) => `<tr><td>${esc(a.associate_name)}</td><td>${esc(a.eid || "—")}</td><td>${a.flag?.includes("NOT_STARTED") ? "<span class='pill pill-amber'>not Started in tracker</span>" : "<span class='pill pill-green'>OK</span>"}</td><td>${a.flag?.includes("DNR") ? "<span class='pill pill-red'>DNR MATCH</span>" : ""}</td><td><button class="btn btn-sm" data-del-att="${a.id}">✕</button></td></tr>`).join("")}</tbody></table>
    </div>

    <div class="panel">
      <h2>🚪 Early leaves this shift (${els.length})</h2>
      <table><thead><tr><th>Associate</th><th>EID</th><th>Line</th><th>Left</th><th>Category</th><th>Corrective action</th><th></th></tr></thead>
      <tbody>${els.map((e) => `<tr>
        <td>${esc(e.associate_name)} ${e.match_status === "needs_review" ? "<span class='flag'>?</span>" : ""}</td>
        <td>${esc(e.eid || "—")}</td><td>${esc(e.line || "")}</td><td>${esc(e.time_left || "")}</td>
        <td>${esc(e.category || "")}</td>
        <td>${caPill(e.corrective_action)}</td>
        <td><button class="btn btn-sm" data-del-el="${e.id}">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn mt" id="el-add">+ Add early leave</button>
    </div>

    <div class="panel">
      <h2>🗒 Shift notes</h2>
      ${notes.map((n) => `<div>📌 ${esc(n.note)} <span class="muted">(${esc(n.entered_by || "")}, ${new Date(n.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})</span></div>`).join("")}
      <div class="inline mt">
        <div style="flex:3"><input id="note-input" placeholder="e.g. Crescent cut Line H at 11:30, sent 6 home"></div>
        <button class="btn" id="note-add">Add note</button>
      </div>
    </div>

    <div class="inline">
      <button class="btn btn-primary" id="en-save">💾 Save shift report</button>
      <button class="btn" id="en-email">✉️ Generate on-premise email</button>
    </div>`;

  $("#en-save").onclick = () => saveEntry(date, shift, els.length);
  $("#en-email").onclick = () => genEmail(date, shift, els, att);
  $("#el-add").onclick = () => elForm({ leave_date: date, shift }, () => loadEntry());
  $("#note-add").onclick = async () => {
    const note = $("#note-input").value.trim();
    if (!note) return;
    const { error } = await sb.from("shift_notes").insert({ report_date: date, shift, note, entered_by: enteredBy() });
    error ? toast(error.message, true) : loadEntry();
  };
  $$("[data-del-el]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this early leave entry?")) return;
    await sb.from("early_leaves").delete().eq("id", b.dataset.delEl);
    loadEntry();
  }));
  $$("[data-del-att]").forEach((b) => (b.onclick = async () => {
    await sb.from("attendance").delete().eq("id", b.dataset.delAtt);
    loadEntry();
  }));
  $("#ns-att-check").onclick = () => checkNewStart(date, shift);
  $("#ns-att-input").addEventListener("keydown", (e) => { if (e.key === "Enter") checkNewStart(date, shift); });
}

async function saveEntry(date, shift, elCount) {
  const g = (k) => num($("#en-" + k)?.value);
  const required = g("required"), working = g("working");
  const row = {
    report_date: date, shift, week_ending: weekEndingSunday(date),
    forecasted: g("forecasted"), requested: g("requested"), required, working,
    indirect_working: g("indirect_working"),
    variance: working != null && required != null ? working - required : null,
    daily_fill_pct: working != null && required ? +(working / required).toFixed(6) : null,
    daily_direct_people: g("daily_direct_people"),
    total_direct_hours: g("total_direct_hours"), direct_hours_worked: g("direct_hours_worked"),
    surveys_completed: g("surveys_completed"), sent_home: g("sent_home"), lines_cut: g("lines_cut"),
    dnrs: g("dnrs"), early_leaves: elCount, entered_by: enteredBy(), updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("shift_reports").upsert(row, { onConflict: "report_date,shift" });
  error ? toast(error.message, true) : toast("Shift report saved ✔");
}

function caPill(ca) {
  const map = { DNR: "pill-red", Termination: "pill-red", Suspension: "pill-amber", None: "pill-gray" };
  return `<span class="pill ${map[ca] || "pill-blue"}">${esc(ca || "None")}</span>`;
}

// -------- new start attendance check --------
async function checkNewStart(date, shift) {
  const q = $("#ns-att-input").value.trim();
  if (!q) return;
  const ns = await fetchAll("new_starts", "*", (qq) => qq.or(`name_key.ilike.%${normName(q)}%,eid.eq.${/^\d+$/.test(q) ? q : 0}`));
  let cands = ns.map((r) => ({ ...r, score: /^\d+$/.test(q) ? (r.eid === q ? 1 : 0) : nameScore(r.name, q) }))
    .filter((r) => r.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, 5);
  const box = $("#ns-att-suggest");
  if (!cands.length) {
    box.innerHTML = `<p class="mt">⚠️ <b>No tracker match</b> for “${esc(q)}”. They may not be processed. <button class="btn btn-sm" id="ns-att-force">Add anyway (flag it)</button></p>`;
    $("#ns-att-force").onclick = () => addAttendance(date, shift, { name: q, eid: null, status: null });
    return;
  }
  box.innerHTML = cands.map((c, i) => {
    const dnr = dnrMatches(State.dnr, { eid: c.eid, l4_ssn: c.l4_ssn, name: c.name });
    return `<div class="match-chip" data-i="${i}">
      <span><b>${esc(c.name)}</b> <span class="muted">EID ${esc(c.eid || "—")} · ${esc(c.shift || "")} · processed ${fmtDate(c.process_date) || "—"}</span></span>
      <span>${statusPill(c.status)} ${dnr.length ? "<span class='pill pill-red'>DNR!</span>" : ""}</span></div>`;
  }).join("");
  $$(".match-chip", box).forEach((chip) => (chip.onclick = () => addAttendance(date, shift, cands[+chip.dataset.i])));
}

function statusPill(st) {
  const map = { Started: "pill-green", "CB Updated": "pill-blue", Rejected: "pill-red", Declined: "pill-red", Adjudication: "pill-amber", "BG Pending": "pill-amber", "I-9 Pending": "pill-amber" };
  return `<span class="pill ${map[st] || "pill-gray"}">${esc(st || "not in tracker")}</span>`;
}

async function addAttendance(date, shift, cand) {
  const flags = [];
  if (cand.status !== "Started") flags.push("NOT_STARTED_IN_TRACKER");
  const dnr = dnrMatches(State.dnr, { eid: cand.eid, l4_ssn: cand.l4_ssn, name: cand.name });
  if (dnr.length) flags.push("DNR_MATCH");
  const { error } = await sb.from("attendance").upsert({
    report_date: date, shift, eid: cand.eid, associate_name: cand.name,
    is_new_start: true, flag: flags.join(",") || null, entered_by: enteredBy(),
  }, { onConflict: "report_date,shift,eid" });
  if (error) return toast(error.message, true);
  if (cand.id && cand.status !== "Started" && cand.status !== null) {
    if (confirm(`${cand.name} is "${cand.status}" in the tracker. Mark as Started with today's date?`)) {
      await sb.from("new_starts").update({ status: "Started", actual_start_date: date, updated_at: new Date().toISOString() }).eq("id", cand.id);
    }
  }
  if (dnr.length) toast(`⚠️ ${cand.name} matches the DNR list (${dnr[0].source}). Flagged.`, true);
  else toast("New start recorded ✔");
  $("#ns-att-input").value = "";
  loadEntry();
}

// -------- early leave form --------
function elForm(preset = {}, onDone) {
  const opts = (kind, sel) => lu(kind).map((v) => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  openModal(`
    <h2>${preset.id ? "Edit" : "Add"} early leave</h2>
    <label class="f">Associate (name or EID)</label>
    <input id="elf-who" value="${esc(preset.associate_name || "")}" placeholder="Start typing…">
    <div id="elf-suggest"></div>
    <input type="hidden" id="elf-eid" value="${esc(preset.eid || "")}">
    <div id="elf-linked" class="muted">${preset.eid ? "Linked to EID " + esc(preset.eid) : "Not linked yet — pick a match or save as needs-review"}</div>
    <div class="row">
      <div><label class="f">Date</label><input type="date" id="elf-date" value="${preset.leave_date || todayISO()}"></div>
      <div><label class="f">Shift</label><select id="elf-shift">${CONFIG.SHIFTS.map((x) => `<option ${x === (preset.shift || "1st") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label class="f">Line</label><select id="elf-line"><option></option>${opts("line", preset.line)}</select></div>
      <div><label class="f">Time left</label><input type="time" id="elf-time" value="${preset.time_left || ""}"></div>
    </div>
    <div class="row">
      <div><label class="f">Category</label><select id="elf-cat"><option></option>${opts("el_category", preset.category)}</select></div>
      <div><label class="f">Reason</label><select id="elf-reason"><option></option>${opts("el_reason", preset.reason)}</select></div>
      <div><label class="f">Corrective action</label><select id="elf-ca">${opts("corrective_action", preset.corrective_action || "None")}</select></div>
    </div>
    <div class="row">
      <div><label class="f">1st day/week?</label><select id="elf-fw"><option value="">?</option><option value="true" ${preset.first_week === true ? "selected" : ""}>Yes</option><option value="false" ${preset.first_week === false ? "selected" : ""}>No</option></select></div>
      <div><label class="f">Recurring issue?</label><select id="elf-rec"><option value="">?</option><option value="true" ${preset.recurring === true ? "selected" : ""}>Yes</option><option value="false" ${preset.recurring === false ? "selected" : ""}>No</option></select></div>
    </div>
    <label class="f">Details</label>
    <textarea id="elf-details" rows="2">${esc(preset.details || "")}</textarea>
    <div id="elf-dnr-warn"></div>
    <div class="inline mt">
      <button class="btn btn-primary" id="elf-save">Save</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
    </div>`);

  const who = $("#elf-who");
  who.oninput = () => {
    const m = matchAssociates(State.roster, who.value);
    $("#elf-suggest").innerHTML = m.map((r, i) => `<div class="match-chip" data-i="${i}">
      <span><b>${esc(r.full_name || "(no name)")}</b> <span class="muted">EID ${r.eid} · ${esc(r.shift || "")}</span></span>
      <span>${r.is_dnr ? "<span class='pill pill-red'>DNR</span>" : ""} ${Math.round(r.score * 100)}%</span></div>`).join("");
    $$(".match-chip", $("#elf-suggest")).forEach((chip) => (chip.onclick = () => {
      const r = m[+chip.dataset.i];
      who.value = r.full_name || who.value;
      $("#elf-eid").value = r.eid;
      $("#elf-linked").innerHTML = `Linked to EID <b>${r.eid}</b> ✔` + (r.is_dnr ? " <span class='pill pill-red'>already DNR</span>" : "");
      $("#elf-suggest").innerHTML = "";
    }));
  };
  $("#elf-ca").onchange = () => {
    $("#elf-dnr-warn").innerHTML = $("#elf-ca").value === "DNR"
      ? "<p class='flag mt'>⚠️ Saving with DNR will also add this associate to the DNR registry.</p>" : "";
  };
  $("#elf-save").onclick = async () => {
    const eid = $("#elf-eid").value || null;
    const name = who.value.trim();
    if (!name) return toast("Associate name is required", true);
    const row = {
      eid, associate_name: name, line: $("#elf-line").value || null,
      time_left: $("#elf-time").value || null, category: $("#elf-cat").value || null,
      reason: $("#elf-reason").value || null, corrective_action: $("#elf-ca").value || "None",
      leave_date: $("#elf-date").value, shift: $("#elf-shift").value,
      first_week: $("#elf-fw").value === "" ? null : $("#elf-fw").value === "true",
      recurring: $("#elf-rec").value === "" ? null : $("#elf-rec").value === "true",
      details: $("#elf-details").value || null,
      match_status: eid ? "matched" : "needs_review",
      entered_by: enteredBy(), updated_at: new Date().toISOString(),
    };
    const res = preset.id
      ? await sb.from("early_leaves").update(row).eq("id", preset.id)
      : await sb.from("early_leaves").insert(row);
    if (res.error) return toast(res.error.message, true);
    if (row.corrective_action === "DNR") {
      const a = State.roster.find((r) => r.eid === eid);
      await sb.from("dnr_list").insert({
        eid, full_name: name, name_key: normName(name), l4_ssn: a?.l4_ssn || null,
        dnr_date: row.leave_date, shift: row.shift, source: "PLX",
        offense_category: row.reason,
      });
      if (eid) await sb.from("associates").update({ is_dnr: true }).eq("eid", eid);
      await refreshCache();
    }
    closeModal();
    toast("Early leave saved ✔");
    onDone?.();
  };
}

// -------- on-premise email --------
function genEmail(date, shift, els, att) {
  const g = (k) => $("#en-" + k)?.value || "0";
  const morning = shift === "1st";
  const nsNames = att.map((a) => a.associate_name);
  const body =
`${morning ? "Good morning team," : "Team,"}

Requested: ${g("requested")}
Required: ${g("required")}
Working: ${g("working")}${+g("indirect_working") ? ` plus ${g("indirect_working")} indirect` : ""}

New Starts - ${nsNames.length}${nsNames.length ? "\n" + nsNames.map((n, i) => `  ${i + 1}. ${n}`).join("\n") : "\nNo new starts to record today."}

Send Homes - ${g("sent_home") || 0}${+g("lines_cut") ? `\nLines Cut - ${g("lines_cut")}` : "\nNo lines were cut."}
${els.length ? `Early Leaves - ${els.length}\n` : ""}
All production lines are running at Crescent. Have a wonderful ${morning ? "day" : "evening"}!`;
  openModal(`
    <h2>✉️ ${shift} shift on-premise email — ${fmtDate(date)}</h2>
    <label class="f">Subject</label>
    <input id="em-subject" value="Crescent ${morning ? "5 am" : "2nd Shift"} on premise ${fmtDate(date)}">
    <label class="f">Body (edit freely, then copy)</label>
    <pre class="email" contenteditable="true" id="em-body">${esc(body)}</pre>
    <div class="inline mt">
      <button class="btn btn-primary" id="em-copy">📋 Copy to clipboard</button>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
  $("#em-copy").onclick = async () => {
    await navigator.clipboard.writeText($("#em-subject").value + "\n\n" + $("#em-body").innerText);
    toast("Copied — paste into Outlook ✔");
  };
}

// ======================================================= SCORECARD
VIEWS.scorecard = async () => {
  const ym = sessionStorage.getItem("sc_month") || todayISO().slice(0, 7);
  $("#main").innerHTML = `
    <h1>Scorecard</h1>
    <p class="sub">Daily requests, fill rate, hours and KPI tracking — the source of truth for EOY reporting.</p>
    <div class="panel"><div class="inline">
      <div><label class="f">Month</label><input type="month" id="sc-month" value="${ym}"></div>
      <button class="btn" id="sc-load">Load</button>
      <button class="btn" id="sc-export">⬇️ Export YTD scorecard (xlsx)</button>
    </div></div>
    <div id="sc-body"></div>`;
  $("#sc-load").onclick = renderScorecard;
  $("#sc-month").onchange = renderScorecard;
  $("#sc-export").onclick = exportScorecard;
  renderScorecard();
};

async function renderScorecard() {
  const ym = $("#sc-month").value;
  sessionStorage.setItem("sc_month", ym);
  const rows = await fetchAll("shift_reports", "*", (q) => q.gte("report_date", ym + "-01").lte("report_date", ym + "-31").order("report_date"));
  if (!rows.length) { $("#sc-body").innerHTML = "<div class='panel'><p class='muted'>No data for this month yet.</p></div>"; return; }
  const weeks = {};
  for (const r of rows) (weeks[r.week_ending || "?"] ||= []).push(r);
  const cols = ["forecasted", "requested", "required", "working", "variance", "new_starts", "sent_home", "lines_cut", "early_leaves", "dnrs", "surveys_completed", "direct_hours_worked"];
  const labels = ["Forecast", "Requested", "Required", "Working", "Var", "New Starts", "Sent Home", "Lines Cut", "Early Lv", "DNRs", "Surveys", "Hours"];
  let html = "";
  for (const [we, list] of Object.entries(weeks).sort()) {
    const req = list.reduce((s, r) => s + (+r.required || 0), 0);
    const work = list.reduce((s, r) => s + (+r.working || 0), 0);
    html += `<div class="panel"><h2>Week ending ${fmtDate(we)} <span class="pill ${req && work / req >= 0.95 ? "pill-green" : "pill-amber"}">${pct(req ? work / req : null)} fill</span></h2>
      <div class="table-scroll"><table><thead><tr><th>Date</th><th>Shift</th>${labels.map((l) => `<th class="num">${l}</th>`).join("")}<th class="num">Fill %</th><th></th></tr></thead><tbody>`;
    for (const r of list.sort((a, b) => a.report_date.localeCompare(b.report_date) || a.shift.localeCompare(b.shift))) {
      const fill = r.required > 0 ? r.working / r.required : null;
      html += `<tr><td>${fmtDate(r.report_date)}</td><td>${r.shift}</td>
        ${cols.map((c) => `<td class="num">${n0(r[c])}</td>`).join("")}
        <td class="num">${fill != null && fill < 0.9 ? `<span class="flag">${pct(fill)}</span>` : pct(fill)}</td>
        <td><button class="btn btn-sm" data-edit="${r.report_date}|${r.shift}">✎</button></td></tr>`;
    }
    html += `</tbody></table></div></div>`;
  }
  $("#sc-body").innerHTML = html;
  $$("[data-edit]").forEach((b) => (b.onclick = () => {
    const [d, s] = b.dataset.edit.split("|");
    sessionStorage.setItem("entry_date", d);
    sessionStorage.setItem("entry_shift", s);
    nav("entry");
  }));
}

// ======================================================= EARLY LEAVES
VIEWS.earlyleaves = async () => {
  const ym = sessionStorage.getItem("el_month") || todayISO().slice(0, 7);
  $("#main").innerHTML = `
    <h1>Early Leaves &amp; Corrective Actions</h1>
    <p class="sub">Documented early leaves, corrective actions, and the DNR registry.</p>
    <div class="panel"><div class="inline">
      <div><label class="f">Month</label><input type="month" id="el-month" value="${ym}"></div>
      <div><label class="f">Shift</label><select id="el-shift"><option value="">All</option><option>1st</option><option>2nd</option></select></div>
      <div><label class="f">Corrective action</label><select id="el-ca"><option value="">All</option>${lu("corrective_action").map((v) => `<option>${v}</option>`).join("")}</select></div>
      <button class="btn" id="el-load">Filter</button>
      <button class="btn btn-primary" id="el-new">+ Add</button>
      <button class="btn" id="el-export">⬇️ Monthly client report</button>
      <button class="btn" id="el-export-dnr">⬇️ DNR list</button>
    </div></div>
    <div id="el-summary"></div>
    <div class="panel table-scroll" id="el-table"></div>`;
  const load = () => renderEL();
  $("#el-load").onclick = load; $("#el-month").onchange = load;
  $("#el-shift").onchange = load; $("#el-ca").onchange = load;
  $("#el-new").onclick = () => elForm({}, load);
  $("#el-export").onclick = () => exportELMonth($("#el-month").value);
  $("#el-export-dnr").onclick = exportDNR;
  load();
};

async function renderEL() {
  const ym = $("#el-month").value;
  sessionStorage.setItem("el_month", ym);
  let rows = await fetchAll("early_leaves", "*", (q) => q.gte("leave_date", ym + "-01").lte("leave_date", ym + "-31").order("leave_date"));
  const sh = $("#el-shift").value, ca = $("#el-ca").value;
  if (sh) rows = rows.filter((r) => r.shift === sh);
  if (ca) rows = rows.filter((r) => r.corrective_action === ca);
  const by = (k) => rows.reduce((m, r) => ((m[r[k] || "—"] = (m[r[k] || "—"] || 0) + 1), m), {});
  const chips = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="pill pill-gray" style="margin:2px">${esc(k)}: <b>${v}</b></span>`).join(" ");
  $("#el-summary").innerHTML = `<div class="row">
    <div class="panel"><h2>${rows.length} early leaves</h2>${chips(by("category"))}</div>
    <div class="panel"><h2>Corrective actions</h2>${chips(by("corrective_action"))}</div>
    <div class="panel"><h2>By shift</h2>${chips(by("shift"))}</div></div>`;
  $("#el-table").innerHTML = `<table><thead><tr><th>Date</th><th>Associate</th><th>EID</th><th>Line</th><th>Left</th><th>Shift</th><th>Category</th><th>Reason</th><th>CA</th><th>1st wk</th><th>Recur</th><th></th></tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td>${fmtDate(e.leave_date)}</td>
      <td>${esc(e.associate_name)} ${e.match_status === "needs_review" ? "<span class='flag' title='No EID link'>?</span>" : ""}</td>
      <td>${esc(e.eid || "—")}</td><td>${esc(e.line || "")}</td><td>${esc(e.time_left || "")}</td><td>${esc(e.shift || "")}</td>
      <td>${esc(e.category || "")}</td><td class="muted">${esc((e.reason || "").replace(/^.*? - /, ""))}</td>
      <td>${caPill(e.corrective_action)}</td>
      <td>${e.first_week ? "Yes" : e.first_week === false ? "No" : "?"}</td>
      <td>${e.recurring ? "Yes" : e.recurring === false ? "No" : "?"}</td>
      <td><button class="btn btn-sm" data-el="${e.id}">✎</button></td></tr>`).join("")}</tbody></table>`;
  $$("[data-el]").forEach((b) => (b.onclick = () => {
    const row = rows.find((r) => r.id === +b.dataset.el);
    elForm(row, renderEL);
  }));
}

// ======================================================= NEW STARTS
VIEWS.newstarts = async () => {
  $("#main").innerHTML = `
    <h1>New Start Tracker</h1>
    <p class="sub">Applicant pipeline with live DNR cross-reference. No more spreadsheet.</p>
    <div class="panel"><div class="inline">
      <div style="flex:2"><label class="f">Search</label><input id="ns-q" placeholder="Name, EID, phone…"></div>
      <div><label class="f">Status</label><select id="ns-status"><option value="">All</option>${lu("ns_status").map((v) => `<option>${v}</option>`).join("")}</select></div>
      <div><label class="f">Shift</label><select id="ns-shift"><option value="">All</option><option>1st</option><option>2nd</option></select></div>
      <label style="display:flex;align-items:center;gap:6px;min-width:110px"><input type="checkbox" id="ns-dnr-only" style="width:auto"> DNR flags</label>
      <button class="btn btn-primary" id="ns-add">+ Add applicant</button>
      <button class="btn" id="ns-recheck">🔄 Re-run DNR cross-check</button>
    </div></div>
    <div class="panel"><div id="ns-count" class="muted"></div><div class="table-scroll" id="ns-table"></div></div>`;
  let all = await fetchAll("new_starts", "*", (q) => q.order("process_date", { ascending: false }));
  const render = () => {
    const q = $("#ns-q").value.trim().toLowerCase(), st = $("#ns-status").value, sh = $("#ns-shift").value;
    let rows = all;
    if (q) rows = rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.eid || "").includes(q) || (r.phone || "").includes(q));
    if (st) rows = rows.filter((r) => r.status === st);
    if (sh) rows = rows.filter((r) => r.shift === sh);
    if ($("#ns-dnr-only").checked) rows = rows.filter((r) => r.dnr_flag);
    $("#ns-count").textContent = `${rows.length} of ${all.length} applicants`;
    $("#ns-table").innerHTML = `<table><thead><tr><th>Status</th><th>Name</th><th>EID</th><th>Phone</th><th>Shift</th><th>Processed</th><th>BG cleared</th><th>Started</th><th>DNR flag</th><th>Recruiter</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 400).map((r) => `<tr>
        <td>${statusPill(r.status)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.eid || "—")}</td>
        <td class="muted">${esc(r.phone || "")}</td><td>${esc(r.shift || "")}</td>
        <td>${fmtDate(r.process_date)}</td><td>${fmtDate(r.bg_cleared_date) || (r.bg_verified ? "✔" : "")}</td>
        <td>${fmtDate(r.actual_start_date)}</td>
        <td>${r.dnr_flag ? `<span class="pill pill-red">${esc(r.dnr_flag)}</span>` : ""}</td>
        <td>${esc(r.recruiter || "")}</td><td class="muted">${esc((r.notes || "").slice(0, 40))}</td>
        <td><button class="btn btn-sm" data-ns="${r.id}">✎</button></td></tr>`).join("")}</tbody></table>`;
    $$("[data-ns]").forEach((b) => (b.onclick = () => nsForm(all.find((r) => r.id === +b.dataset.ns), async () => { all = await fetchAll("new_starts", "*", (q2) => q2.order("process_date", { ascending: false })); render(); })));
  };
  ["ns-q", "ns-status", "ns-shift", "ns-dnr-only"].forEach((id) => ($("#" + id).oninput = render));
  $("#ns-add").onclick = () => nsForm({}, async () => { all = await fetchAll("new_starts", "*", (q2) => q2.order("process_date", { ascending: false })); render(); });
  $("#ns-recheck").onclick = async () => {
    let flagged = 0;
    for (const r of all) {
      const hits = dnrMatches(State.dnr, { eid: r.eid, l4_ssn: r.l4_ssn, name: r.name });
      let flag = null;
      if (hits.length) {
        const h = hits[0];
        flag = h.eid && h.eid === r.eid ? "DNR MATCH - EID" : h.l4_ssn && h.l4_ssn === r.l4_ssn ? "DNR MATCH - SSN" : "DNR MATCH - NAME";
      }
      if ((flag || null) !== (r.dnr_flag || null)) {
        await sb.from("new_starts").update({ dnr_flag: flag, updated_at: new Date().toISOString() }).eq("id", r.id);
        r.dnr_flag = flag;
        if (flag) flagged++;
      }
    }
    toast(`DNR cross-check complete — ${flagged} flag change(s).`);
    render();
  };
  render();
};

function nsForm(preset = {}, onDone) {
  openModal(`
    <h2>${preset.id ? "Edit" : "Add"} applicant</h2>
    <div class="row">
      <div><label class="f">Name</label><input id="nsf-name" value="${esc(preset.name || "")}"></div>
      <div><label class="f">EID / CRM #</label><input id="nsf-eid" value="${esc(preset.eid || "")}"></div>
    </div>
    <div class="row">
      <div><label class="f">Status</label><select id="nsf-status">${lu("ns_status").map((v) => `<option ${v === preset.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div><label class="f">Shift</label><select id="nsf-shift"><option></option><option ${preset.shift === "1st" ? "selected" : ""}>1st</option><option ${preset.shift === "2nd" ? "selected" : ""}>2nd</option></select></div>
      <div><label class="f">L4 SSN</label><input id="nsf-l4" value="${esc(preset.l4_ssn || "")}" maxlength="4"></div>
    </div>
    <div class="row">
      <div><label class="f">Phone</label><input id="nsf-phone" value="${esc(preset.phone || "")}"></div>
      <div><label class="f">Email</label><input id="nsf-email" value="${esc(preset.email || "")}"></div>
    </div>
    <div class="row">
      <div><label class="f">Process date</label><input type="date" id="nsf-proc" value="${preset.process_date || ""}"></div>
      <div><label class="f">BG cleared</label><input type="date" id="nsf-bg" value="${preset.bg_cleared_date || ""}"></div>
      <div><label class="f">Actual start</label><input type="date" id="nsf-start" value="${preset.actual_start_date || ""}"></div>
      <div><label class="f">Last contact</label><input type="date" id="nsf-lc" value="${preset.last_contact || ""}"></div>
    </div>
    <div class="row">
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="nsf-bgv" style="width:auto" ${preset.bg_verified ? "checked" : ""}> Background verified</label>
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="nsf-docs" style="width:auto" ${preset.docs_signed ? "checked" : ""}> Docs signed</label>
    </div>
    <div class="row">
      <div><label class="f">Recruiter</label><input id="nsf-rec" value="${esc(preset.recruiter || "")}"></div>
    </div>
    <label class="f">Notes</label><textarea id="nsf-notes" rows="2">${esc(preset.notes || "")}</textarea>
    <div class="inline mt">
      <button class="btn btn-primary" id="nsf-save">Save</button>
      ${preset.id ? `<button class="btn btn-danger" id="nsf-del">Delete</button>` : ""}
      <button class="btn" onclick="closeModal()">Cancel</button>
    </div>`);
  $("#nsf-save").onclick = async () => {
    const name = $("#nsf-name").value.trim();
    if (!name) return toast("Name required", true);
    const eid = $("#nsf-eid").value.trim() || null;
    const l4 = $("#nsf-l4").value.trim() || null;
    const hits = dnrMatches(State.dnr, { eid, l4_ssn: l4, name });
    const row = {
      name, name_key: normName(name), eid, l4_ssn: l4,
      status: $("#nsf-status").value, shift: $("#nsf-shift").value || null,
      phone: $("#nsf-phone").value || null, email: $("#nsf-email").value || null,
      process_date: $("#nsf-proc").value || null, bg_cleared_date: $("#nsf-bg").value || null,
      actual_start_date: $("#nsf-start").value || null, last_contact: $("#nsf-lc").value || null,
      bg_verified: $("#nsf-bgv").checked, docs_signed: $("#nsf-docs").checked,
      recruiter: $("#nsf-rec").value || null, notes: $("#nsf-notes").value || null,
      dnr_flag: hits.length ? (hits[0].eid === eid && eid ? "DNR MATCH - EID" : hits[0].l4_ssn === l4 && l4 ? "DNR MATCH - SSN" : "DNR MATCH - NAME") : null,
      updated_at: new Date().toISOString(),
    };
    const res = preset.id ? await sb.from("new_starts").update(row).eq("id", preset.id) : await sb.from("new_starts").insert(row);
    if (res.error) return toast(res.error.message, true);
    if (row.dnr_flag) toast("⚠️ Saved with DNR flag: " + row.dnr_flag, true); else toast("Saved ✔");
    closeModal(); onDone?.();
  };
  $("#nsf-del") && ($("#nsf-del").onclick = async () => {
    if (!confirm("Delete this applicant?")) return;
    await sb.from("new_starts").delete().eq("id", preset.id);
    closeModal(); onDone?.();
  });
}

// ======================================================= ASSOCIATES
VIEWS.associates = async () => {
  $("#main").innerHTML = `
    <h1>Associates</h1>
    <p class="sub">${State.roster.length} associates, one profile each, keyed by EID.</p>
    <div class="panel"><div class="inline">
      <div style="flex:2"><label class="f">Search</label><input id="as-q" placeholder="Name or EID…"></div>
      <label style="display:flex;align-items:center;gap:6px;min-width:100px"><input type="checkbox" id="as-dnr" style="width:auto"> DNR only</label>
    </div></div>
    <div class="panel table-scroll" id="as-table"></div>`;
  const render = () => {
    const q = $("#as-q").value.trim().toLowerCase();
    let rows = State.roster;
    if (q) rows = rows.filter((r) => (r.full_name || "").toLowerCase().includes(q) || r.eid.includes(q));
    if ($("#as-dnr").checked) rows = rows.filter((r) => r.is_dnr);
    $("#as-table").innerHTML = `<table><thead><tr><th>EID</th><th>Name</th><th>Shift</th><th>Phone</th><th>DNR</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 300).map((r) => `<tr>
        <td><b>${r.eid}</b></td><td>${esc(r.full_name || "—")}</td><td>${esc(r.shift || "")}</td>
        <td class="muted">${esc(r.phone || "")}</td>
        <td>${r.is_dnr ? "<span class='pill pill-red'>DNR</span>" : ""}</td>
        <td><button class="btn btn-sm" data-prof="${r.eid}">Profile</button></td></tr>`).join("")}</tbody></table>
      ${rows.length > 300 ? "<p class='muted'>Showing first 300 — refine your search.</p>" : ""}`;
    $$("[data-prof]").forEach((b) => (b.onclick = () => profile(b.dataset.prof)));
  };
  $("#as-q").oninput = render;
  $("#as-dnr").oninput = render;
  render();
};

async function profile(eid) {
  const a = State.roster.find((r) => r.eid === eid);
  const [els, labor, ns] = await Promise.all([
    fetchAll("early_leaves", "*", (q) => q.eq("eid", eid).order("leave_date", { ascending: false })),
    fetchAll("labor_lines", "*", (q) => q.eq("eid", eid).order("report_date", { ascending: false }).limit(20)),
    fetchAll("new_starts", "*", (q) => q.eq("eid", eid)),
  ]);
  const dnrs = dnrMatches(State.dnr, { eid, l4_ssn: a?.l4_ssn, name: a?.full_name });
  openModal(`
    <h2>${esc(a?.full_name || "EID " + eid)} ${a?.is_dnr ? "<span class='pill pill-red'>DNR</span>" : ""}</h2>
    <p class="muted">EID ${eid} · ${esc(a?.shift || "?")} shift · ${esc(a?.phone || "no phone")} · ${esc(a?.email || "no email")}</p>
    ${dnrs.length ? `<div class="panel" style="border-color:var(--bad)"><b class="flag">DNR record:</b> ${dnrs.map((d) => `${esc(d.source || "")} ${fmtDate(d.dnr_date)} — ${esc(d.offense_category || d.end_reason || "")}`).join("; ")}</div>` : ""}
    ${ns.length ? `<h2 class="mt">Tracker record</h2>${ns.map((r) => `<div>${statusPill(r.status)} processed ${fmtDate(r.process_date)}, started ${fmtDate(r.actual_start_date) || "—"} · recruiter ${esc(r.recruiter || "?")}</div>`).join("")}` : ""}
    <h2 class="mt">Early leaves (${els.length})</h2>
    ${els.length ? `<table><thead><tr><th>Date</th><th>Shift</th><th>Category</th><th>CA</th></tr></thead><tbody>
      ${els.slice(0, 10).map((e) => `<tr><td>${fmtDate(e.leave_date)}</td><td>${esc(e.shift || "")}</td><td>${esc(e.reason || e.category || "")}</td><td>${caPill(e.corrective_action)}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>None recorded.</p>"}
    <h2 class="mt">Recent labor</h2>
    ${labor.length ? `<table><thead><tr><th>Date</th><th>Shift</th><th>Source</th><th class="num">Hours</th></tr></thead><tbody>
      ${labor.slice(0, 10).map((l) => `<tr><td>${fmtDate(l.report_date)}</td><td>${l.shift}</td><td>${l.source}</td><td class="num">${n2(l.source === "clock" ? l.payable_hours : (+l.reg_hours || 0) + (+l.ot_hours || 0) + (+l.dt_hours || 0))}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>No labor lines.</p>"}
    <div class="inline mt"><button class="btn" onclick="closeModal()">Close</button></div>`);
}

// ======================================================= ADMIN
VIEWS.admin = async () => {
  const users = await fetchAll("allowed_users", "*", (q) => q.order("email"));
  $("#main").innerHTML = `
    <h1>Admin</h1>
    <p class="sub">Access control and dropdown values.</p>
    <div class="panel">
      <h2>Allowed users</h2>
      <p class="muted">A person needs BOTH an account (created on the sign-in page) and an entry here.</p>
      <table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.display_name || "")}</td><td>${esc(u.role)}</td>
        <td>${u.email !== State.user.email ? `<button class="btn btn-sm" data-rm-user="${esc(u.email)}">Remove</button>` : "<span class='muted'>you</span>"}</td></tr>`).join("")}</tbody></table>
      <div class="inline mt">
        <div><label class="f">Email</label><input id="au-email" placeholder="teammate@employbridge.com"></div>
        <div><label class="f">Name</label><input id="au-name"></div>
        <div><label class="f">Role</label><select id="au-role"><option>member</option><option>admin</option></select></div>
        <button class="btn btn-primary" id="au-add">Add</button>
      </div>
    </div>
    <div class="panel">
      <h2>Dropdown values</h2>
      <div class="inline">
        <div><label class="f">List</label><select id="lk-kind">${Object.keys(State.lookups).map((k) => `<option>${k}</option>`).join("")}</select></div>
        <div><label class="f">New value</label><input id="lk-value"></div>
        <button class="btn" id="lk-add">Add value</button>
      </div>
      <div id="lk-list" class="mt"></div>
    </div>`;
  $("#au-add").onclick = async () => {
    const email = $("#au-email").value.trim().toLowerCase();
    if (!email.includes("@")) return toast("Valid email required", true);
    const { error } = await sb.from("allowed_users").insert({ email, display_name: $("#au-name").value || null, role: $("#au-role").value });
    error ? toast(error.message, true) : (toast("Added ✔"), nav("admin"));
  };
  $$("[data-rm-user]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove access for ${b.dataset.rmUser}?`)) return;
    await sb.from("allowed_users").delete().eq("email", b.dataset.rmUser);
    nav("admin");
  }));
  const renderLk = () => {
    const kind = $("#lk-kind").value;
    $("#lk-list").innerHTML = lu(kind).map((v) => `<span class="pill pill-gray" style="margin:3px">${esc(v)}</span>`).join(" ");
  };
  $("#lk-kind").onchange = renderLk;
  $("#lk-add").onclick = async () => {
    const kind = $("#lk-kind").value, value = $("#lk-value").value.trim();
    if (!value) return;
    const { error } = await sb.from("lookups").insert({ kind, value, sort: lu(kind).length });
    if (error) return toast(error.message, true);
    (State.lookups[kind] ||= []).push(value);
    $("#lk-value").value = "";
    renderLk();
    toast("Added ✔");
  };
  renderLk();
};
