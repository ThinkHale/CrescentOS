// ---------- client-facing exports (xlsx via SheetJS) ----------

function sheetFromAOA(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

// ---- YTD scorecard: flat sheet + monthly summary ----
async function exportScorecard() {
  toast("Building scorecard export…");
  const rows = await fetchAll("shift_reports", "*", (q) => q.order("report_date"));
  const wb = XLSX.utils.book_new();

  const flatHdr = ["Month", "Week_Ending", "Date", "Day", "Shift", "Forecasted", "Requested", "Required",
    "Working", "Variance", "Daily_Direct_People", "Daily_Fill_Pct", "Total_Direct_Hours", "SLA_Fill",
    "New_Starts", "Sent_Home", "Lines_Cut", "Direct_Hours_Worked", "Surveys_Completed", "Early_Leaves", "DNRs"];
  const flat = [flatHdr];
  for (const r of rows) {
    const d = new Date(r.report_date + "T12:00:00");
    flat.push([MONTHS[d.getMonth()], r.week_ending, r.report_date,
      d.toLocaleDateString("en-US", { weekday: "long" }), r.shift,
      r.forecasted, r.requested, r.required, r.working, r.variance,
      r.daily_direct_people, r.daily_fill_pct, r.total_direct_hours, r.sla_fill,
      r.new_starts, r.sent_home, r.lines_cut, r.direct_hours_worked,
      r.surveys_completed, r.early_leaves, r.dnrs]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(flat, flatHdr.map(() => 13)), "Scorecard_Flat");

  // weekly summary
  const weeks = {};
  for (const r of rows) {
    const w = (weeks[r.week_ending || r.report_date] ||= { req: 0, work: 0, ns: 0, sh: 0, el: 0, dnr: 0, hrs: 0 });
    w.req += +r.required || 0; w.work += +r.working || 0; w.ns += +r.new_starts || 0;
    w.sh += +r.sent_home || 0; w.el += +r.early_leaves || 0; w.dnr += +r.dnrs || 0;
    w.hrs += +r.direct_hours_worked || 0;
  }
  const sum = [["Week Ending", "Required", "Working", "Fill %", "New Starts", "Sent Home", "Early Leaves", "DNRs", "Direct Hours"]];
  for (const [we, w] of Object.entries(weeks).sort()) {
    sum.push([we, w.req, w.work, w.req ? +(w.work / w.req).toFixed(4) : null, w.ns, w.sh, w.el, w.dnr, w.hrs]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(sum, [12, 10, 10, 8, 11, 11, 12, 8, 12]), "Weekly Summary");
  XLSX.writeFile(wb, `Crescent Scorecard ${new Date().getFullYear()} (CrescentOS).xlsx`);
}

// ---- monthly early leave client report ----
async function exportELMonth(ym) {
  toast("Building early leave report…");
  const mr = monthRange(ym);
  const rows = await fetchAll("early_leaves", "*", (q) => q.gte("leave_date", mr.start).lt("leave_date", mr.next).order("leave_date"));
  const wb = XLSX.utils.book_new();
  const hdr = ["Associate Name", "EID", "Line", "Time Left", "Category", "Reason", "Corrective Action", "Date", "Shift", "1st Day/Week?", "Recurring Issue?", "Send Home Details"];
  const aoa = [hdr, ...rows.map((e) => [e.associate_name, e.eid, e.line, e.time_left, e.category, e.reason,
    e.corrective_action, e.leave_date, e.shift,
    e.first_week == null ? "" : e.first_week ? "Yes" : "No",
    e.recurring == null ? "" : e.recurring ? "Yes" : "No", e.details])];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(aoa, [22, 10, 6, 9, 14, 28, 16, 11, 6, 12, 14, 40]), "Early Leaves");

  // summary pivots
  const count = (k) => rows.reduce((m, r) => ((m[r[k] || "—"] = (m[r[k] || "—"] || 0) + 1), m), {});
  const s = [["EARLY LEAVE SUMMARY — " + ym], [],
    ["By Category"], ...Object.entries(count("category")).map(([k, v]) => ["  " + k, v]), [],
    ["By Corrective Action"], ...Object.entries(count("corrective_action")).map(([k, v]) => ["  " + k, v]), [],
    ["By Shift"], ...Object.entries(count("shift")).map(([k, v]) => ["  " + k, v]), [],
    ["Total", rows.length]];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(s, [26, 10]), "Summary");

  // DNRs that month
  const dnrs = rows.filter((r) => r.corrective_action === "DNR");
  const dAoa = [["Date", "Associate Name", "EID", "Shift", "Corrective Action", "Offense Category"],
    ...dnrs.map((e) => [e.leave_date, e.associate_name, e.eid, e.shift, "DNR", e.reason])];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(dAoa, [11, 22, 10, 6, 16, 30]), "DNRs");
  XLSX.writeFile(wb, `Crescent Early Leaves ${ym}.xlsx`);
}

// ---- DNR list export (matches the Q2 DNR List format) ----
async function exportDNR() {
  const rows = State.dnr.filter((d) => d.source && d.source.startsWith("PLX"))
    .sort((a, b) => (a.dnr_date || "").localeCompare(b.dnr_date || ""));
  const wb = XLSX.utils.book_new();
  const aoa = [["Date", "Associate Name", "EID", "L4 SSN", "Shift", "Corrective Action", "Offense Category"],
    ...rows.map((d) => [d.dnr_date, d.full_name, d.eid, d.l4_ssn, d.shift, "DNR", d.offense_category || d.end_reason])];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(aoa, [11, 24, 10, 8, 6, 16, 30]), "DNR List");
  XLSX.writeFile(wb, `Crescent DNR List (CrescentOS).xlsx`);
}

// ---- revised labor report (Dept/File/Name/Bill Rate + Reg/OT/DT for the day) ----
function exportRevised(date, shift, list) {
  const day = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const wb = XLSX.utils.book_new();
  const aoa = [
    ["Based on Bill Rates — Revised " + shift + " Shift Labor Report " + fmtDate(date) + " (CrescentOS)"],
    [], [],
    [null, null, null, null, day],
    ["Dept", "File", "Name", "Bill Rate", "Reg Hrs", "Reg $", "OT Hrs", "OT $", "DT Hrs", "DT $"],
    [],
  ];
  let totH = 0, totD = 0;
  for (const b of list.filter((x) => x.eid)) {
    // revised hours = revised source if present, else clock hours (the corrected truth)
    const hrs = b.has.revised ? b.revised : b.clock;
    const rate = b.rate || 0;
    totH += hrs; totD += hrs * rate;
    aoa.push(["004-251-211", b.eid, b.name ? toLastFirst(b.name) : "", rate || null,
      +hrs.toFixed(2), +(hrs * rate).toFixed(2), 0, 0, 0, 0]);
  }
  aoa.push([]);
  aoa.push([null, null, "Shift Total", null, +totH.toFixed(2), +totD.toFixed(2), 0, 0, 0, 0]);
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(aoa, [12, 10, 24, 9, 9, 10, 8, 8, 8, 8]), "Sheet1");
  XLSX.writeFile(wb, `Revised ${shift} Shift Labor Report ${fmtDate(date).replace(/\//g, "-")}.xlsx`);
}

function toLastFirst(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || name.includes(",")) return name.toUpperCase();
  const last = parts.pop();
  return (last + ", " + parts.join(" ")).toUpperCase();
}
