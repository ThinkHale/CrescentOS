// ---------- Staffing Planner (ported from Crescent-Staffing-Planner) ----------
VIEWS.staffing = async () => {
  const d = sessionStorage.getItem("st_date") || todayISO();
  const s = sessionStorage.getItem("st_shift") || "1st";
  $("#main").innerHTML = `
    <h1>Staffing Planner</h1>
    <p class="sub">Build the line sheet, fill positions, and push the working count straight into the shift report.</p>
    <div class="panel"><div class="inline">
      <div><label class="f">Date</label><input type="date" id="st-date" value="${d}"></div>
      <div><label class="f">Shift</label><select id="st-shift">${CONFIG.SHIFTS.map((x) => `<option ${x === s ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <button class="btn" id="st-load">Load</button>
      <div style="flex:1"></div>
      <button class="btn" id="st-core">⭐ Core associates</button>
      <button class="btn" id="st-copy-prev">📋 Copy previous sheet</button>
      <button class="btn" id="st-print">🖨 Print</button>
    </div></div>
    <div id="st-body"></div>`;
  $("#st-load").onclick = loadStaffing;
  $("#st-date").onchange = loadStaffing;
  $("#st-shift").onchange = loadStaffing;
  $("#st-core").onclick = coreModal;
  $("#st-print").onclick = () => window.print();
  $("#st-copy-prev").onclick = copyPreviousSheet;
  loadStaffing();
};

let ST = null; // current sheet state

async function getSheet(date, shift, create = false) {
  const { data } = await sb.from("staffing_sheets").select("*").eq("report_date", date).eq("shift", shift);
  if (data?.length) return data[0];
  if (!create) return null;
  const { data: ins, error } = await sb.from("staffing_sheets")
    .insert({ report_date: date, shift, created_by: enteredBy(), updated_by: enteredBy() }).select();
  if (error) { toast(error.message, true); return null; }
  return ins[0];
}

async function loadStaffing() {
  const date = $("#st-date").value, shift = $("#st-shift").value;
  sessionStorage.setItem("st_date", date);
  sessionStorage.setItem("st_shift", shift);
  const sheet = await getSheet(date, shift);
  if (!sheet) {
    $("#st-body").innerHTML = `<div class="panel">
      <p class="muted">No staffing sheet for ${fmtDate(date)} ${shift} shift yet.</p>
      <div class="inline">
        <button class="btn btn-primary" id="st-create">+ Start new sheet</button>
      </div></div>`;
    $("#st-create").onclick = () => newSheetModal(date, shift);
    return;
  }
  const [lines, extras] = await Promise.all([
    fetchAll("staffing_lines", "*", (q) => q.eq("sheet_id", sheet.id).order("sort")),
    fetchAll("staffing_extras", "*", (q) => q.eq("sheet_id", sheet.id).order("sort")),
  ]);
  const positions = lines.length
    ? await fetchAll("staffing_positions", "*", (q) => q.in("line_id", lines.map((l) => l.id)).order("slot"))
    : [];
  for (const l of lines) l.positions = positions.filter((p) => p.line_id === l.id);
  ST = { sheet, lines, extras, date, shift };
  renderStaffing();
}

function staffingStats() {
  const { lines, extras } = ST;
  const active = lines.filter((l) => !l.is_cut);
  const filled = active.reduce((s, l) => s + l.positions.filter((p) => p.name && !p.is_crescent).length, 0);
  const crescent = active.reduce((s, l) => s + l.positions.filter((p) => p.name && p.is_crescent).length, 0);
  const needed = active.reduce((s, l) => s + l.needed, 0);
  const news = active.reduce((s, l) => s + l.positions.filter((p) => p.name && p.is_new).length, 0)
    + extras.filter((e) => e.name && e.is_new).length;
  return { filled, crescent, needed, news,
    wait: extras.filter((e) => e.kind === "waitlist" && e.name).length,
    ind: extras.filter((e) => e.kind === "indirect" && e.name).length };
}

function renderStaffing() {
  const { sheet, lines, extras } = ST;
  const stats = staffingStats();
  const locked = sheet.locked;
  const slot = (p, line) => {
    const dnr = p.name && p.eid && State.roster.find((r) => r.eid === p.eid)?.is_dnr;
    return `<div class="pos ${p.name ? "filled" : ""} ${p.is_crescent ? "cres" : ""} ${p.is_new ? "newp" : ""}">
      <input data-pos="${p.id}" value="${esc(p.name || "")}" placeholder="${p.is_crescent ? "Crescent slot" : "—"}" ${locked ? "disabled" : ""} autocomplete="off">
      ${dnr ? "<span class='pill pill-red' title='On DNR list!'>DNR</span>" : ""}
      <label title="1st day"><input type="checkbox" data-new="${p.id}" style="width:auto" ${p.is_new ? "checked" : ""} ${locked ? "disabled" : ""}>N</label>
    </div>`;
  };
  $("#st-body").innerHTML = `
    <div class="grid-4">
      <div class="kpi"><div class="l">Filled / Needed</div><div class="v">${stats.filled}/${stats.needed}</div>
        <div class="d muted">+${stats.crescent} Crescent direct</div></div>
      <div class="kpi"><div class="l">New starts</div><div class="v">${stats.news}</div></div>
      <div class="kpi"><div class="l">Waitlist</div><div class="v">${stats.wait}</div></div>
      <div class="kpi"><div class="l">Indirect</div><div class="v">${stats.ind}</div></div>
    </div>
    <div class="inline mt" style="margin-bottom:14px">
      <button class="btn ${locked ? "" : "btn-primary"}" id="st-lock">${locked ? "🔓 Unlock sheet" : "🔒 Lock sheet"}</button>
      <button class="btn" id="st-addline" ${locked ? "disabled" : ""}>+ Add line</button>
      <button class="btn" id="st-sync">📤 Sync counts to Shift Report</button>
      <span class="muted" style="align-self:center">last updated by ${esc(sheet.updated_by || "?")}</span>
    </div>
    <div class="stgrid">
      ${lines.map((l) => `
        <div class="panel stline ${l.is_cut ? "cut" : ""}">
          <div class="inline" style="justify-content:space-between;margin-bottom:6px">
            <b>Line ${esc(l.letter)} <span class="muted">(${l.positions.filter((p) => p.name).length}/${l.needed}${l.positions.some((p) => p.is_crescent) ? "+C" : ""})</span></b>
            <span>
              <button class="btn btn-sm" data-cut="${l.id}" title="${l.is_cut ? "restore line" : "cut line"}">${l.is_cut ? "↩" : "✂"}</button>
              <button class="btn btn-sm" data-edit-line="${l.id}">✎</button>
            </span>
          </div>
          ${l.leads?.length ? `<div class="muted" style="font-size:12px;margin-bottom:6px">Lead: ${esc(l.leads.join(", "))}</div>` : ""}
          ${l.is_cut ? "<div class='pill pill-red'>LINE CUT</div>" : l.positions.map((p) => slot(p, l)).join("")}
        </div>`).join("")}
      <div class="panel stline">
        <b>⏳ Waitlist</b>
        ${extras.filter((e) => e.kind === "waitlist").map((e) => `
          <div class="pos ${e.name ? "filled" : ""}"><input data-extra="${e.id}" value="${esc(e.name || "")}" ${locked ? "disabled" : ""}>
          <label><input type="checkbox" data-extra-new="${e.id}" style="width:auto" ${e.is_new ? "checked" : ""} ${locked ? "disabled" : ""}>N</label>
          <button class="btn btn-sm" data-promote="${e.id}" title="move to first open slot">▲</button></div>`).join("")}
        <button class="btn btn-sm mt" data-add-extra="waitlist" ${locked ? "disabled" : ""}>+ waitlist</button>
      </div>
      <div class="panel stline">
        <b>🔧 Indirect</b>
        ${extras.filter((e) => e.kind === "indirect").map((e) => `
          <div class="pos ${e.name ? "filled" : ""}"><input data-extra="${e.id}" value="${esc(e.name || "")}" ${locked ? "disabled" : ""}></div>`).join("")}
        <button class="btn btn-sm mt" data-add-extra="indirect" ${locked ? "disabled" : ""}>+ indirect</button>
      </div>
    </div>`;
  injectStaffingCSS();

  $("#st-lock").onclick = async () => {
    await sb.from("staffing_sheets").update({ locked: !locked, updated_by: enteredBy(), updated_at: new Date().toISOString() }).eq("id", sheet.id);
    loadStaffing();
  };
  $("#st-addline").onclick = () => lineModal(null);
  $("#st-sync").onclick = syncToShiftReport;
  $$("[data-cut]").forEach((b) => (b.onclick = async () => {
    const l = lines.find((x) => x.id === +b.dataset.cut);
    await sb.from("staffing_lines").update({ is_cut: !l.is_cut }).eq("id", l.id);
    loadStaffing();
  }));
  $$("[data-edit-line]").forEach((b) => (b.onclick = () => lineModal(lines.find((x) => x.id === +b.dataset.editLine))));
  $$("[data-pos]").forEach((inp) => bindNameInput(inp, "staffing_positions", +inp.dataset.pos));
  $$("[data-extra]").forEach((inp) => bindNameInput(inp, "staffing_extras", +inp.dataset.extra));
  $$("[data-new]").forEach((cb) => (cb.onchange = () =>
    sb.from("staffing_positions").update({ is_new: cb.checked }).eq("id", +cb.dataset.new).then(() => touchSheet())));
  $$("[data-extra-new]").forEach((cb) => (cb.onchange = () =>
    sb.from("staffing_extras").update({ is_new: cb.checked }).eq("id", +cb.dataset.extraNew).then(() => touchSheet())));
  $$("[data-add-extra]").forEach((b) => (b.onclick = async () => {
    await sb.from("staffing_extras").insert({ sheet_id: sheet.id, kind: b.dataset.addExtra, sort: extras.length });
    loadStaffing();
  }));
  $$("[data-promote]").forEach((b) => (b.onclick = () => promoteFromWaitlist(+b.dataset.promote)));
}

// name input with roster matching (EID auto-link) — saves on change
function bindNameInput(inp, table, id) {
  inp.onchange = async () => {
    const name = inp.value.trim();
    let eid = null;
    if (name) {
      const m = matchAssociates(State.roster, name);
      if (m.length && m[0].score >= 0.85) {
        eid = m[0].eid;
        if (m[0].is_dnr && !confirm(`⚠️ ${m[0].full_name} (EID ${eid}) is on the DNR list. Keep them on the sheet?`)) {
          inp.value = ""; return;
        }
      }
    }
    const { error } = await sb.from(table).update({ name: name || null, eid }).eq("id", id);
    if (error) return toast(error.message, true);
    touchSheet();
    loadStaffing();
  };
}

async function touchSheet() {
  if (ST) await sb.from("staffing_sheets").update({ updated_by: enteredBy(), updated_at: new Date().toISOString() }).eq("id", ST.sheet.id);
}

async function promoteFromWaitlist(extraId) {
  const e = ST.extras.find((x) => x.id === extraId);
  if (!e?.name) return toast("Empty waitlist row", true);
  for (const l of ST.lines.filter((x) => !x.is_cut)) {
    const open = l.positions.find((p) => !p.name && !p.is_crescent);
    if (open) {
      await sb.from("staffing_positions").update({ name: e.name, eid: e.eid, is_new: e.is_new }).eq("id", open.id);
      await sb.from("staffing_extras").delete().eq("id", extraId);
      toast(`${e.name} → Line ${l.letter} ✔`);
      return loadStaffing();
    }
  }
  toast("No open slots — add a line or bump a needed count", true);
}

// ---- new sheet / line setup ----
async function newSheetModal(date, shift) {
  const core = await fetchAll("core_associates", "*", (q) => q.eq("active", true).order("sort"));
  const letters = [...new Set(core.map((c) => c.line_letter).filter(Boolean))].sort();
  openModal(`
    <h2>New sheet — ${fmtDate(date)} ${shift} shift</h2>
    <p class="muted">One row per line: letter + people needed. Core associates${core.length ? ` (${core.length} active)` : ""} auto-fill their lines; Crescent-flagged regulars get labeled slots.</p>
    <div id="nsh-rows">${(letters.length ? letters : ["A", "B", "C"]).map((L) => `
      <div class="inline nsh-row"><div><label class="f">Line</label><input class="nsh-letter" value="${L}" style="width:70px"></div>
      <div><label class="f">Needed</label><input class="nsh-needed" type="number" value="10" style="width:90px"></div></div>`).join("")}
    </div>
    <button class="btn btn-sm mt" id="nsh-add">+ line</button>
    <div class="inline mt">
      <button class="btn btn-primary" id="nsh-create">Create sheet</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
    </div>`);
  $("#nsh-add").onclick = () => $("#nsh-rows").insertAdjacentHTML("beforeend",
    `<div class="inline nsh-row"><div><label class="f">Line</label><input class="nsh-letter" style="width:70px"></div>
     <div><label class="f">Needed</label><input class="nsh-needed" type="number" value="10" style="width:90px"></div></div>`);
  $("#nsh-create").onclick = async () => {
    const sheet = await getSheet(date, shift, true);
    if (!sheet) return;
    const rows = $$(".nsh-row").map((r) => ({
      letter: $(".nsh-letter", r).value.trim().toUpperCase(),
      needed: parseInt($(".nsh-needed", r).value) || 0,
    })).filter((r) => r.letter);
    let sort = 0;
    for (const r of rows) {
      const coreHere = core.filter((c) => c.line_letter === r.letter);
      const regulars = coreHere.filter((c) => !(c.flags || []).includes("crescent"));
      const crescents = coreHere.filter((c) => (c.flags || []).includes("crescent"));
      const needed = Math.max(0, r.needed - crescents.length);
      const { data: lineIns, error } = await sb.from("staffing_lines")
        .insert({ sheet_id: sheet.id, letter: r.letter, needed, sort: sort++,
                  leads: coreHere.filter((c) => (c.flags || []).includes("lead")).map((c) => c.name) }).select();
      if (error) return toast(error.message, true);
      const lineId = lineIns[0].id;
      const pos = [];
      for (let i = 0; i < needed; i++) {
        const c = regulars[i];
        pos.push({ line_id: lineId, slot: i, name: c?.name || null, eid: c?.eid || null });
      }
      crescents.forEach((c, i) => pos.push({ line_id: lineId, slot: needed + i, name: c.name, eid: c.eid, is_crescent: true }));
      if (pos.length) await sb.from("staffing_positions").insert(pos);
    }
    closeModal();
    loadStaffing();
  };
}

function lineModal(line) {
  openModal(`
    <h2>${line ? "Edit Line " + esc(line.letter) : "Add line"}</h2>
    <div class="row">
      <div><label class="f">Letter</label><input id="lm-letter" value="${esc(line?.letter || "")}"></div>
      <div><label class="f">Needed</label><input id="lm-needed" type="number" value="${line?.needed ?? 10}"></div>
      <div><label class="f">Leads (comma-sep)</label><input id="lm-leads" value="${esc((line?.leads || []).join(", "))}"></div>
    </div>
    <div class="inline mt">
      <button class="btn btn-primary" id="lm-save">Save</button>
      ${line ? '<button class="btn btn-danger" id="lm-del">Delete line</button>' : ""}
      <button class="btn" onclick="closeModal()">Cancel</button>
    </div>`);
  $("#lm-save").onclick = async () => {
    const letter = $("#lm-letter").value.trim().toUpperCase();
    const needed = parseInt($("#lm-needed").value) || 0;
    const leads = $("#lm-leads").value.split(",").map((x) => x.trim()).filter(Boolean);
    if (!letter) return toast("Letter required", true);
    if (line) {
      await sb.from("staffing_lines").update({ letter, needed, leads }).eq("id", line.id);
      const cur = line.positions.filter((p) => !p.is_crescent).length;
      if (needed > cur) {
        await sb.from("staffing_positions").insert(
          Array(needed - cur).fill(0).map((_, i) => ({ line_id: line.id, slot: cur + i })));
      }
    } else {
      const { data } = await sb.from("staffing_lines")
        .insert({ sheet_id: ST.sheet.id, letter, needed, leads, sort: ST.lines.length }).select();
      await sb.from("staffing_positions").insert(
        Array(needed).fill(0).map((_, i) => ({ line_id: data[0].id, slot: i })));
    }
    closeModal();
    loadStaffing();
  };
  $("#lm-del") && ($("#lm-del").onclick = async () => {
    if (!confirm(`Delete Line ${line.letter} and its positions?`)) return;
    await sb.from("staffing_lines").delete().eq("id", line.id);
    closeModal();
    loadStaffing();
  });
}

// ---- core associates ----
async function coreModal() {
  const core = await fetchAll("core_associates", "*", (q) => q.order("line_letter").order("sort"));
  openModal(`
    <h2>⭐ Core associates</h2>
    <p class="muted">Regulars auto-filled onto their line on every new sheet. Flags: <b>lead</b> = line lead, <b>crescent</b> = Crescent direct hire (fills a slot without counting against PLX needed).</p>
    <div class="table-scroll" style="max-height:340px"><table><thead><tr><th>Name</th><th>EID</th><th>Line</th><th>Flags</th><th>Active</th><th></th></tr></thead>
    <tbody>${core.map((c) => `<tr>
      <td>${esc(c.name)}</td><td>${esc(c.eid || "—")}</td><td>${esc(c.line_letter || "")}</td>
      <td>${(c.flags || []).map((f) => `<span class="pill pill-blue">${esc(f)}</span>`).join(" ")}</td>
      <td>${c.active ? "✔" : "—"}</td>
      <td><button class="btn btn-sm" data-core-del="${c.id}">✕</button></td></tr>`).join("")}</tbody></table></div>
    <div class="inline mt">
      <div><label class="f">Name</label><input id="cm-name"></div>
      <div><label class="f">EID</label><input id="cm-eid" style="width:100px"></div>
      <div><label class="f">Line</label><input id="cm-line" style="width:60px"></div>
      <div><label class="f">Flags</label><select id="cm-flag"><option value="">none</option><option>lead</option><option>crescent</option></select></div>
      <button class="btn btn-primary" id="cm-add">Add</button>
    </div>
    <div class="inline mt"><button class="btn" onclick="closeModal()">Close</button></div>`);
  $$("[data-core-del]").forEach((b) => (b.onclick = async () => {
    await sb.from("core_associates").delete().eq("id", +b.dataset.coreDel);
    coreModal();
  }));
  $("#cm-add").onclick = async () => {
    const name = $("#cm-name").value.trim();
    if (!name) return;
    const m = matchAssociates(State.roster, $("#cm-eid").value.trim() || name);
    await sb.from("core_associates").insert({
      name, eid: $("#cm-eid").value.trim() || (m[0]?.score >= 0.9 ? m[0].eid : null),
      line_letter: $("#cm-line").value.trim().toUpperCase() || null,
      flags: $("#cm-flag").value ? [$("#cm-flag").value] : [],
    });
    coreModal();
  };
}

// ---- copy previous sheet ----
async function copyPreviousSheet() {
  const date = $("#st-date").value, shift = $("#st-shift").value;
  const { data: prev } = await sb.from("staffing_sheets").select("*")
    .lt("report_date", date).eq("shift", shift).order("report_date", { ascending: false }).limit(1);
  if (!prev?.length) return toast("No earlier sheet to copy", true);
  if (await getSheet(date, shift)) return toast("A sheet already exists for this date/shift", true);
  const src = prev[0];
  const [srcLines] = [await fetchAll("staffing_lines", "*", (q) => q.eq("sheet_id", src.id).order("sort"))];
  const srcPos = srcLines.length ? await fetchAll("staffing_positions", "*", (q) => q.in("line_id", srcLines.map((l) => l.id))) : [];
  const sheet = await getSheet(date, shift, true);
  for (const l of srcLines) {
    const { data: nl } = await sb.from("staffing_lines")
      .insert({ sheet_id: sheet.id, letter: l.letter, needed: l.needed, leads: l.leads, sort: l.sort }).select();
    const pos = srcPos.filter((p) => p.line_id === l.id)
      .map((p) => ({ line_id: nl[0].id, slot: p.slot, name: p.name, eid: p.eid, is_crescent: p.is_crescent, is_new: false }));
    if (pos.length) await sb.from("staffing_positions").insert(pos);
  }
  toast(`Copied sheet from ${fmtDate(src.report_date)} ✔`);
  loadStaffing();
}

// ---- sync counts into shift_reports ----
async function syncToShiftReport() {
  const stats = staffingStats();
  const { date, shift } = ST;
  const { data: existing } = await sb.from("shift_reports").select("id,required").eq("report_date", date).eq("shift", shift);
  const required = existing?.[0]?.required ?? stats.needed;
  const row = {
    report_date: date, shift, week_ending: weekEndingSunday(date),
    working: stats.filled, indirect_working: stats.ind, new_starts: stats.news,
    required, variance: stats.filled - (required ?? 0),
    daily_fill_pct: required ? +(stats.filled / required).toFixed(6) : null,
    lines_cut: ST.lines.filter((l) => l.is_cut).length,
    entered_by: enteredBy(), updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("shift_reports").upsert(row, { onConflict: "report_date,shift" });
  error ? toast(error.message, true) : toast(`Shift report updated: ${stats.filled} working, ${stats.news} new starts, ${stats.ind} indirect ✔`);
}

function injectStaffingCSS() {
  if ($("#st-css")) return;
  document.head.insertAdjacentHTML("beforeend", `<style id="st-css">
    .stgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .stline { padding: 12px; margin-bottom: 0; }
    .stline.cut { opacity: .55; background: #fff5f5; }
    .pos { display: flex; gap: 5px; align-items: center; margin: 3px 0; }
    .pos input[type=text], .pos input:not([type]) { font-size: 12px; padding: 5px 7px; }
    .pos.filled input:not([type=checkbox]) { background: #f0fdf4; border-color: #bbf7d0; }
    .pos.cres input:not([type=checkbox]) { background: #fdf2f8; border-color: #fbcfe8; }
    .pos.newp input:not([type=checkbox]) { background: #eff6ff; border-color: #bfdbfe; }
    .pos label { font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 2px; }
    @media print { .sidebar, .inline, .kpi, h1, .sub, .panel:first-child { display: none !important; } .main { margin: 0; } .stgrid { grid-template-columns: repeat(4, 1fr); } }
  </style>`);
}
