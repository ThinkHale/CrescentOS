// ---------- supabase client / auth / router / dashboard ----------
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const State = {
  user: null,
  roster: [],       // associates
  dnr: [],          // dnr_list
  lookups: {},      // kind -> [values]
  view: "dashboard",
};

function lu(kind) { return State.lookups[kind] || []; }
function enteredBy() { return (State.user?.email || "").split("@")[0]; }

// ---------- auth ----------
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return startApp(session.user);
  showLogin();
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

async function startApp(user) {
  State.user = user;
  // verify allowlist by attempting a read
  const { data, error } = await sb.from("lookups").select("kind,value,sort").order("sort");
  if (error || !data || data.length === 0) {
    $("#login-error").textContent = error
      ? "Error: " + error.message
      : "Your account exists but has not been granted access yet. Ask an admin to add your email on the Admin page.";
    $("#login-error").classList.remove("hidden");
    await sb.auth.signOut();
    showLogin();
    return;
  }
  State.lookups = {};
  for (const r of data) (State.lookups[r.kind] ||= []).push(r.value);
  await refreshCache();
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-email").textContent = user.email;
  nav(State.view);
}

async function refreshCache() {
  const [ro, dn] = await Promise.all([
    fetchAll("associates", "eid,full_name,phone,email,shift,l4_ssn,name_key,is_dnr"),
    fetchAll("dnr_list", "id,eid,full_name,name_key,l4_ssn,dnr_date,shift,source,offense_category,end_reason"),
  ]);
  State.roster = ro;
  State.dnr = dn;
}

// paginate past PostgREST's 1000-row cap
async function fetchAll(table, select, filter = (q) => q) {
  let out = [], from = 0;
  while (true) {
    const { data, error } = await filter(sb.from(table).select(select)).range(from, from + 999);
    if (error) { toast(error.message, true); break; }
    out = out.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

$("#login-btn").onclick = async () => {
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  if (error) {
    $("#login-error").textContent = error.message;
    $("#login-error").classList.remove("hidden");
    return;
  }
  startApp(data.user);
};
$("#login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#login-btn").click(); });

$("#signup-btn").onclick = async () => {
  const email = $("#login-email").value.trim(), password = $("#login-password").value;
  if (!email || password.length < 8) return toast("Enter an email and a password of 8+ characters", true);
  const { error } = await sb.auth.signUp({ email, password });
  if (error) return toast(error.message, true);
  toast("Account created. If email confirmation is on, check your inbox. An admin must also allowlist your email.");
};

$("#logout-btn").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- router ----------
const VIEWS = {};
function nav(view) {
  State.view = view;
  $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  $("#main").innerHTML = "<p class='muted'>Loading…</p>";
  VIEWS[view]?.();
}
$$(".nav-item").forEach((a) => (a.onclick = () => nav(a.dataset.view)));

// ---------- dashboard ----------
VIEWS.dashboard = async () => {
  const since = new Date(); since.setDate(since.getDate() - 21);
  const sinceISO = since.toLocaleDateString("en-CA");
  const monthStart = todayISO().slice(0, 8) + "01";
  const [reports, elMonth, notes, flags] = await Promise.all([
    fetchAll("shift_reports", "*", (q) => q.gte("report_date", sinceISO).order("report_date")),
    fetchAll("early_leaves", "id,leave_date,category,corrective_action,shift,match_status", (q) => q.gte("leave_date", monthStart)),
    fetchAll("shift_notes", "*", (q) => q.order("created_at", { ascending: false }).limit(8)),
    fetchAll("early_leaves", "id,associate_name,leave_date,shift", (q) => q.eq("match_status", "needs_review").order("leave_date", { ascending: false }).limit(20)),
  ]);

  const latest = reports[reports.length - 1];
  const latestFill = latest && latest.required > 0 ? latest.working / latest.required : null;
  const mtd = reports.filter((r) => r.report_date >= monthStart);
  const mtdReq = mtd.reduce((s, r) => s + (+r.required || 0), 0);
  const mtdWork = mtd.reduce((s, r) => s + (+r.working || 0), 0);
  const dnrQtd = State.dnr.filter((d) => d.source === "PLX-Q2" || (d.dnr_date && d.dnr_date >= "2026-07-01")).length;

  // per-day fill for spark (combine shifts)
  const byDay = {};
  for (const r of reports) {
    const b = (byDay[r.report_date] ||= { req: 0, work: 0 });
    b.req += +r.required || 0; b.work += +r.working || 0;
  }
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const bars = days.map(([d, v]) => {
    const f = v.req > 0 ? v.work / v.req : null;
    const h = f == null ? 4 : Math.max(6, Math.min(100, f * 100));
    return `<div class="bar ${f != null && f < 0.9 ? "low" : ""}" style="height:${h}%" data-tip="${fmtDate(d)}: ${pct(f)} (${v.work}/${v.req})"></div>`;
  }).join("");

  $("#main").innerHTML = `
    <h1>Dashboard</h1>
    <p class="sub">${CONFIG.SITE_NAME} · ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
    <div class="grid-4">
      <div class="kpi"><div class="l">Latest shift fill</div><div class="v">${pct(latestFill)}</div>
        <div class="d muted">${latest ? fmtDate(latest.report_date) + " · " + latest.shift + " · " + n0(latest.working) + "/" + n0(latest.required) : "no data"}</div></div>
      <div class="kpi"><div class="l">MTD fill rate</div><div class="v">${pct(mtdReq ? mtdWork / mtdReq : null)}</div>
        <div class="d muted">${n0(mtdWork)} worked / ${n0(mtdReq)} required</div></div>
      <div class="kpi"><div class="l">Early leaves MTD</div><div class="v">${elMonth.length}</div>
        <div class="d muted">${elMonth.filter((e) => e.corrective_action === "DNR").length} DNR · ${elMonth.filter((e) => e.corrective_action === "Suspension").length} susp.</div></div>
      <div class="kpi"><div class="l">DNR registry</div><div class="v">${State.dnr.length}</div>
        <div class="d muted">${dnrQtd} this quarter</div></div>
    </div>

    <div class="row mt">
      <div class="panel" style="flex:2">
        <h2>Fill rate — last 3 weeks (both shifts)</h2>
        <div class="spark">${bars || "<span class='muted'>No shift reports in range.</span>"}</div>
      </div>
      <div class="panel" style="flex:1">
        <h2>Needs attention</h2>
        ${flags.length ? flags.map((f) => `<div>🔎 <span class="link" data-goto="earlyleaves">${esc(f.associate_name)}</span> <span class="muted">EL ${fmtDate(f.leave_date)} (${esc(f.shift || "?")}) — no EID match</span></div>`).join("") : "<p class='muted'>Nothing flagged. 🎉</p>"}
      </div>
    </div>

    <div class="panel">
      <h2>Recent shift notes</h2>
      ${notes.length ? notes.map((n) => `<div style="margin-bottom:8px">📌 <b>${fmtDate(n.report_date)} ${esc(n.shift)}</b> — ${esc(n.note)} <span class="muted">(${esc(n.entered_by || "")})</span></div>`).join("") : "<p class='muted'>No notes yet — add them from Shift Entry.</p>"}
    </div>`;
  $$("[data-goto]").forEach((el) => (el.onclick = () => nav(el.dataset.goto)));
};

initAuth();
