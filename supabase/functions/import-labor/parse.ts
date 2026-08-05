// Classification + parsing for every report that feeds CrescentOS.
//
// Deliberately dependency-free and I/O-free: it takes a grid of cells (what
// SheetJS hands back for .xls / .xlsx / .csv alike) and returns rows ready to
// load. That keeps it runnable under plain Node for tests as well as Deno.

export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];

export interface Hints {
  filename?: string;
  subject?: string;
  from?: string;
  received?: string; // ISO
}

export type Kind = "clock" | "client" | "revised" | "roster";

export const cellText = (v: Cell): string =>
  (v == null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

const num = (v: Cell): number | null => {
  const x = parseFloat(cellText(v));
  return isNaN(x) ? null : x;
};

const titleCase = (s: string) =>
  s.split(" ").map((x) => (x ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x)).join(" ");

// Only fix names that are uniformly upper/lower; leave "De'Shawn" alone.
export function tidyName(s: Cell): string | null {
  const t = cellText(s);
  if (!t) return null;
  return t === t.toLowerCase() || t === t.toUpperCase() ? titleCase(t) : t;
}

export const normName = (s: string | null): string | null =>
  !s ? null : s.toLowerCase().replace(/[^a-z' -]/g, "").replace(/\s+/g, " ").trim() || null;

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addDays = (iso: string, n: number) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000));

// ---------------------------------------------------------------- classify

export interface Classification {
  kind: Kind | null;
  reason: string;
  /**
   * When `kind` is null: true if we know what the file is and are deliberately
   * not loading it, false if we simply don't recognize it. The caller needs the
   * difference — a deliberate skip is routine, an unrecognized file is
   * something a human should look at.
   */
  recognized?: boolean;
}

/**
 * Which report is this? Decided by the file's own contents wherever possible —
 * the same logical report reaches us from several different senders in several
 * different formats, so sender and filename are only tiebreakers.
 */
export function classify(grid: Grid, hints: Hints = {}): Classification {
  const hay = `${hints.filename || ""} ${hints.subject || ""}`.toLowerCase();

  // Salesforce assignment exports: every one of them has identical columns
  // (Ended GEODIS Assignments, 1st/2nd Shift Crescent Assignments, Active
  // Crescent Assignments), so the report title in the header block is the only
  // safe discriminator. Only the full active Crescent roster may be loaded —
  // anything else would quietly overwrite the roster with the wrong people.
  const hasPersonPlaced = grid.slice(0, 30).some((r) =>
    r && r.some((c) => cellText(c).toLowerCase() === "person placed name")
  );
  if (hasPersonPlaced) {
    const title = grid.slice(0, 12).flatMap((r) => (r || []).map(cellText))
      .find((t) => /assignments/i.test(t) && t.length < 80) || hints.subject || "";
    if (/active/i.test(title) && /crescent/i.test(title)) {
      return { kind: "roster", reason: `Salesforce roster export ("${title.trim()}")` };
    }
    return {
      kind: null, recognized: true,
      reason: `assignments export that is not the active Crescent roster ("${title.trim() || "untitled"}") — not loaded`,
    };
  }

  for (const r of grid.slice(0, 40)) {
    if (!r) continue;
    const cells = r.map((c) => cellText(c).toLowerCase());
    if (cells.includes("badge")) return { kind: "clock", reason: "clock export (Badge column)" };
    if (cells.includes("dept") && cells.some((c) => c.includes("bill rate"))) {
      // Same grid either way; only the sender/subject says which it is.
      return /revis/.test(hay)
        ? { kind: "revised", reason: "revised report (Dept grid + 'revised' in subject/filename)" }
        : { kind: "client", reason: "PLX billing report (Dept grid)" };
    }
  }
  return { kind: null, recognized: false, reason: "unrecognized layout" };
}

// ------------------------------------------------------------------- clock

const BADGE_RE = /plx-*\s*(\d+)/i;

export interface ClockLine {
  report_date: string; shift: string; source: "clock";
  eid: string | null; badge: string;
  clock_in: string | null; clock_out: string | null;
  payable_hours: number | null; duration: number | null;
  line_name: string | null; job_id: string | null; work_order: string | null;
}

const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function parseClockTime(v: Cell): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(+v) ? null : localStamp(v);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(+d) ? null : localStamp(new Date(d.getTime() + d.getTimezoneOffset() * 60000));
  }
  const d = new Date(String(v).replace(/(\d{4})-(\w{3})-(\d{2})/, "$2 $3, $1"));
  return isNaN(+d) ? null : localStamp(d);
}

function clockHeader(grid: Grid) {
  const hdrI = grid.findIndex((r) => r && r.some((c) => cellText(c).toLowerCase() === "badge"));
  if (hdrI < 0) throw new Error("No 'Badge' column found — is this the clock export?");
  const hdr = grid[hdrI].map((h) => cellText(h).toLowerCase());
  return { hdrI, col: (name: string) => hdr.indexOf(name.toLowerCase()) };
}

/**
 * The shift date comes from the punches themselves, never from the email's
 * received date: the 2nd shift export arrives around 2:30am the following
 * morning, so anything derived from delivery time is a day late.
 */
export function inferClockDateShift(grid: Grid, hints: Hints = {}): { date: string; shift: string } {
  const { hdrI, col } = clockHeader(grid);
  const iIn = col("Clock in time");
  const stamps: string[] = [];
  for (const r of grid.slice(hdrI + 1)) {
    if (!r) continue;
    const t = parseClockTime(r[iIn]);
    if (t) stamps.push(t);
  }
  if (!stamps.length) throw new Error("No readable clock-in times — cannot date this report.");
  stamps.sort();
  const first = stamps[0];
  const date = first.slice(0, 10);

  const said = `${hints.subject || ""} ${hints.filename || ""}`.match(/([12])(?:st|nd)\s*shift/i);
  // A 2nd shift starts mid-afternoon; 1st starts before dawn.
  const shift = said ? `${said[1]}${said[1] === "1" ? "st" : "nd"}`
    : +first.slice(11, 13) >= 13 ? "2nd" : "1st";
  return { date, shift };
}

export function parseClockGrid(grid: Grid, date: string, shift: string): ClockLine[] {
  const { hdrI, col } = clockHeader(grid);
  const iBadge = col("Badge"), iIn = col("Clock in time"), iOut = col("Clock out time"),
    iPay = col("Payable hours"), iDur = col("Duration"), iLine = col("Line name"),
    iJob = col("Job ID"), iWO = col("Work Order Code");
  const out: ClockLine[] = [];
  for (const r of grid.slice(hdrI + 1)) {
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

// --------------------------------------------------------------- PLX / week

const DAYNAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface PLXLine {
  report_date: string; shift: string; source: "client" | "revised";
  eid: string | null; name: string | null; dept: string | null; bill_rate: number | null;
  reg_hours: number; reg_amount: number; ot_hours: number; ot_amount: number;
  dt_hours: number; dt_amount: number;
}

export type LaborLine = ClockLine | PLXLine;
export interface Bucket { date: string; shift: string; rows: LaborLine[] }

/** "For the week ending: 8/9/2026" -> that week's Monday. */
export function weekMondayFromSubject(subject?: string): string | null {
  const m = (subject || "").match(/week\s*ending[:\s]*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return null;
  const sunday = `${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`;
  return addDays(sunday, -6);
}

/** Fallback: the Monday of the week containing `iso`. */
export function mondayOfWeek(iso: string): string {
  const dow = new Date(Date.parse(iso + "T00:00:00Z")).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * The PLX billing workbook is a whole week, cumulative, delivered twice a day,
 * with 1st shift rows above the "Shift 1 Total" row and 2nd shift below. Rather
 * than pulling one day out of it we load every day that has hours, so the week
 * fills in and self-corrects as each file lands. Re-importing is safe: the
 * caller replaces by (date, shift, source).
 */
export function parsePLXWeek(grid: Grid, monday: string, source: "client" | "revised"): Bucket[] {
  const hdrI = grid.findIndex((r) => cellText(r?.[0] ?? null) === "Dept");
  if (hdrI < 0) throw new Error("Couldn't find the 'Dept' header row — is this the PLX/Revised labor report?");
  const dayRow = grid[hdrI - 1] || [];

  // Only exact day-name headers; skips the trailing "Weekly Total" block.
  const dayCols: { day: number; col: number }[] = [];
  dayRow.forEach((c, i) => {
    const d = DAYNAMES.indexOf(cellText(c));
    if (d >= 0) dayCols.push({ day: d, col: i });
  });
  if (!dayCols.length) throw new Error("No weekday columns found in the PLX report header.");

  const s1End = grid.findIndex((r) => /shift\s*1\s*total/i.test(cellText(r?.[2] ?? null)));

  const buckets: Bucket[] = [];
  for (const { day, col } of dayCols) {
    const byShift: Record<string, PLXLine[]> = { "1st": [], "2nd": [] };
    grid.slice(hdrI + 1).forEach((r, idx) => {
      if (!r) return;
      const name = cellText(r[2]);
      if (/total/i.test(name)) return; // dept subtotals and shift totals
      const eidRaw = cellText(r[1]).replace(/\.0$/, "");
      const eid = /^\d{4,9}$/.test(eidRaw) ? eidRaw : null;
      if (!eid && !name) return;
      const reg = num(r[col]) || 0, ot = num(r[col + 2]) || 0, dt = num(r[col + 4]) || 0;
      if (!reg && !ot && !dt) return; // this person didn't work this day
      const shift = s1End >= 0 && hdrI + 1 + idx > s1End ? "2nd" : "1st";
      byShift[shift].push({
        report_date: addDays(monday, day), shift, source, eid, name: name || null,
        dept: cellText(r[0]) || null, bill_rate: num(r[3]),
        reg_hours: reg, reg_amount: num(r[col + 1]) || 0,
        ot_hours: ot, ot_amount: num(r[col + 3]) || 0,
        dt_hours: dt, dt_amount: num(r[col + 5]) || 0,
      });
    });
    for (const [shift, rows] of Object.entries(byShift)) {
      if (rows.length) buckets.push({ date: addDays(monday, day), shift, rows });
    }
  }
  return buckets;
}

// ------------------------------------------------------- bucket resolution

export interface Overrides { date?: string; shift?: string }

/**
 * Turn a labor workbook into the set of (date, shift) buckets to write.
 * A clock export is exactly one bucket; a PLX/Revised workbook is however many
 * days of that week carry hours. Explicit overrides always win over inference.
 */
export function resolveLaborBuckets(
  grid: Grid,
  kind: "clock" | "client" | "revised",
  hints: Hints = {},
  overrides: Overrides = {},
): Bucket[] {
  let buckets: Bucket[];

  if (kind === "clock") {
    const ds = overrides.date && overrides.shift
      ? { date: overrides.date, shift: overrides.shift }
      : inferClockDateShift(grid, hints);
    buckets = [{ ...ds, rows: parseClockGrid(grid, ds.date, ds.shift) }];
  } else {
    const monday = weekMondayFromSubject(hints.subject)
      ?? (overrides.date ? mondayOfWeek(overrides.date) : null)
      ?? (hints.received ? mondayOfWeek(hints.received.slice(0, 10)) : null);
    if (!monday) throw new Error("could not work out which week this report covers");
    buckets = parsePLXWeek(grid, monday, kind);
    if (overrides.date) buckets = buckets.filter((b) => b.date === overrides.date);
    if (overrides.shift) buckets = buckets.filter((b) => b.shift === overrides.shift);
  }

  return buckets.filter((b) => b.rows.length);
}

// ------------------------------------------------------------------ roster

export interface RosterRow {
  eid: string; full_name: string | null; phone: string | null;
  shift: string | null; name_key: string | null; jobs: string[];
}

/**
 * The export carries a title block above the header, a leading blank column and
 * a trailing "Total / Count" row, so columns are located by header text. People
 * holding two assignments (line worker + indirect) collapse to one associate.
 */
export function parseRoster(grid: Grid): { rows: RosterRow[]; skippedInactive: number } {
  const hdrI = grid.findIndex((r) =>
    r && r.some((c) => cellText(c).toLowerCase() === "person placed name")
  );
  if (hdrI < 0) throw new Error("No 'Person Placed Name' column — is this the Active Assignments export?");
  const hdr = grid[hdrI].map((c) => cellText(c).toLowerCase());
  const find = (re: RegExp) => hdr.findIndex((h) => re.test(h));
  const iEid = find(/legacy contact|^file$|crm/), iName = find(/^person placed name$/),
    iPhone = find(/mobile|phone/), iShift = find(/^shift$/),
    iStatus = find(/assignment status/), iJob = find(/job name/);
  if (iEid < 0) throw new Error("No EID column (Legacy Contact ID) found in that export.");

  const byEid = new Map<string, RosterRow>();
  let skippedInactive = 0;
  for (const r of grid.slice(hdrI + 1)) {
    if (!r) continue;
    const eid = cellText(r[iEid]).replace(/\.0$/, "");
    if (!/^\d{4,9}$/.test(eid)) continue; // drops blanks and the Total/Count row
    if (iStatus >= 0 && cellText(r[iStatus]) && !/active/i.test(cellText(r[iStatus]))) {
      skippedInactive++;
      continue;
    }
    const job = iJob >= 0 ? cellText(r[iJob]) : "";
    const prev = byEid.get(eid);
    if (prev) {
      if (job && !prev.jobs.includes(job)) prev.jobs.push(job);
      continue;
    }
    const full_name = tidyName(r[iName]);
    byEid.set(eid, {
      eid, full_name,
      phone: iPhone >= 0 ? cellText(r[iPhone]) || null : null,
      shift: iShift >= 0 ? cellText(r[iShift]) || null : null,
      name_key: normName(full_name),
      jobs: job ? [job] : [],
    });
  }
  return { rows: [...byEid.values()], skippedInactive };
}
