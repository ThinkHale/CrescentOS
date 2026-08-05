// CrescentOS — one ingest endpoint for every report that feeds the app.
//
// Callers stay dumb on purpose: Power Automate (and the older Gmail Apps
// Script) POST every attachment they see and this function decides what each
// one is. Adding a new report means changing parse.ts and redeploying — no
// automation edits.
//
// Deploy:
//   supabase secrets set INGEST_KEY=<key>
//   supabase functions deploy import-labor --no-verify-jwt
//
// The name is kept from the original labor-only version so the existing Gmail
// script keeps working without changes.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  classify, parseRoster, resolveLaborBuckets,
  type Grid, type Hints, type Kind,
} from "./parse.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface Payload {
  filename?: string; name?: string;
  content_base64?: string; contentBytes?: string;
  subject?: string; from?: string; received?: string;
  kind?: Kind; date?: string; shift?: string;   // manual overrides
}

async function log(row: Record<string, unknown>) {
  const { error } = await sb.from("import_log").insert(row);
  if (error) console.error("import_log insert failed:", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("INGEST_KEY");
  if (!expected || req.headers.get("x-ingest-key") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  let p: Payload;
  try {
    p = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const filename = p.filename || p.name || "";
  const b64 = p.content_base64 || p.contentBytes || "";
  const hints: Hints = { filename, subject: p.subject, from: p.from, received: p.received };
  const base = { filename, from_addr: p.from ?? null, subject: p.subject ?? null };

  if (!b64) return json({ error: "no attachment content (content_base64 / contentBytes)" }, 400);
  if (!/\.(xls|xlsx|csv)$/i.test(filename)) {
    await log({ ...base, kind: null, status: "skipped", detail: { reason: "not a spreadsheet attachment" } });
    return json({ status: "skipped", reason: "not a spreadsheet attachment", filename });
  }

  // ---- read the workbook -------------------------------------------------
  let grid: Grid;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wb = filename.toLowerCase().endsWith(".csv")
      ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", cellDates: true })
      : XLSX.read(bytes, { type: "array", cellDates: true });
    grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1, defval: null,
    }) as Grid;
  } catch (e) {
    const reason = `could not read the file: ${(e as Error).message}`;
    await log({ ...base, kind: null, status: "error", detail: { reason } });
    return json({ status: "error", reason, filename }, 422);
  }

  // ---- what is it? -------------------------------------------------------
  const auto = classify(grid, hints);
  const kind = p.kind ?? auto.kind;
  if (!kind) {
    // A file we recognize and deliberately don't load is routine — answer 200
    // so the caller leaves it alone. A file we can't identify is not: answer
    // non-200 so it gets moved somewhere a human will see it.
    const status = auto.recognized ? "skipped" : "unrecognized";
    await log({ ...base, kind: null, status, detail: { reason: auto.reason } });
    return json({ status, reason: auto.reason, filename }, auto.recognized ? 200 : 422);
  }

  try {
    if (kind === "roster") return await loadRoster(grid, base, auto.reason);
    return await loadLabor(grid, kind, hints, p, base, auto.reason);
  } catch (e) {
    const reason = (e as Error).message;
    await log({ ...base, kind, status: "error", detail: { reason } });
    return json({ status: "error", kind, reason, filename }, 422);
  }
});

// ---------------------------------------------------------------- roster

async function loadRoster(grid: Grid, base: Record<string, unknown>, why: string) {
  const { rows, skippedInactive } = parseRoster(grid);
  if (!rows.length) throw new Error("no associate rows recognized");

  // Only the columns the export is authoritative for — email, l4_ssn and
  // is_dnr are owned elsewhere and must survive a sync.
  const payload = rows.map((r) => ({
    eid: r.eid, full_name: r.full_name, phone: r.phone, shift: r.shift, name_key: r.name_key,
  }));
  for (let i = 0; i < payload.length; i += 400) {
    const { error } = await sb.from("associates")
      .upsert(payload.slice(i, i + 400), { onConflict: "eid" });
    if (error) throw new Error(error.message);
  }

  const detail = { reason: why, associates: rows.length, skippedInactive };
  await log({ ...base, kind: "roster", status: "ok", row_count: rows.length, detail });
  return json({ status: "ok", kind: "roster", ...detail });
}

// ----------------------------------------------------------------- labor

async function loadLabor(
  grid: Grid, kind: Kind, hints: Hints, p: Payload,
  base: Record<string, unknown>, why: string,
) {
  // A clock export is one bucket; a PLX/Revised workbook is every day of that
  // week that carries hours.
  const buckets = resolveLaborBuckets(grid, kind as "clock" | "client" | "revised", hints, {
    date: p.date, shift: p.shift,
  });
  if (!buckets.length) throw new Error("no data rows recognized");

  const loaded: { date: string; shift: string; rows: number }[] = [];
  for (const b of buckets) {
    // Replace rather than append so re-sending a report is always safe.
    const { error: delErr } = await sb.from("labor_lines").delete()
      .eq("report_date", b.date).eq("shift", b.shift).eq("source", kind);
    if (delErr) throw new Error(delErr.message);
    for (let i = 0; i < b.rows.length; i += 400) {
      const { error } = await sb.from("labor_lines").insert(b.rows.slice(i, i + 400));
      if (error) throw new Error(error.message);
    }
    loaded.push({ date: b.date, shift: b.shift, rows: b.rows.length });
  }

  const total = loaded.reduce((a, b) => a + b.rows, 0);
  const detail = { reason: why, buckets: loaded };
  await log({ ...base, kind, status: "ok", row_count: total, detail });
  return json({ status: "ok", kind, rows: total, buckets: loaded });
}
