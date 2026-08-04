# 🌙 CrescentOS

Unified operations platform for the ProLogistix on-premise team at Crescent Park (Edwardsville, IL).
Replaces the scorecard workbook, early leave tracker, new start tracker spreadsheet, and manual labor
report reconciliation with one interconnected system keyed on **Employee ID (EID)**.

## What's inside

| Module | Replaces | Highlights |
|---|---|---|
| **Shift Entry** | Daily on-premise emails + scattered notes | Start/end of shift data, new-start attendance with tracker cross-check, early leave submission, shift notes, one-click on-premise email generation |
| **Scorecard** | `Crescent Scorecard 2026.xlsx` | Daily/weekly KPI view, auto fill %, YTD Excel export for EOY reporting |
| **Early Leaves** | `Crescent Early Leaves Q2.xlsx` | Event log + corrective actions, monthly client report export, DNR list export |
| **New Starts** | `30080 New Starts Refresh.xlsx` (Crescent tab) | Full applicant pipeline, live DNR cross-reference (EID → SSN → name), attendance flags when someone shows up but isn't "Started" |
| **Staffing** | `Crescent-Staffing-Planner` (Firebase) | Line sheets with positions, Crescent-direct slots, waitlist/indirect, core-associate auto-fill, lock, copy-previous-day, DNR warnings on entry, one-click sync of working counts into the shift report |
| **Labor Recon** | `Labor-Reconcile` + manual comparison | Clock export import (CSV **or** Excel) + PLX billing import (both shifts auto-split), direct/indirect hours, EID typo detection with one-click fixes, mismatch notes, copy-ready discrepancy email, revised report export, email auto-ingest |
| **Associates** | Nothing (new!) | One profile per EID: contact info, tracker record, early leave history, labor history, DNR status, one-click roster sync from the Active Assignments export |
| **Admin** | — | Access allowlist + dropdown management |

## Architecture

- **Frontend:** static HTML/JS/CSS — no build step. Hostable on GitHub Pages or any static host.
- **Backend:** Supabase project `Crescent` (Postgres + Auth + REST). All data behind Row Level
  Security: a user must be signed in **and** on the `allowed_users` allowlist.
- **Data key:** `associates.eid` — the same number as CRM #, File #, and the middle segment of
  clock badges (`PLX-21484630-BUR`).

## Deploy to GitHub Pages

1. Create a GitHub repo and push this folder:
   ```bash
   git add -A && git commit -m "CrescentOS v1"
   git remote add origin https://github.com/YOUR-USER/crescentos.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
3. Your team visits `https://YOUR-USER.github.io/crescentos/`.

The repo can be public or private (Pages on private repos requires GitHub Pro/Team). The Supabase
anon key in `js/config.js` is designed to be public — data access is enforced by RLS + the allowlist.

## Onboarding a teammate

1. They open the site → **Create account** with email + password.
2. An existing admin opens **Admin → Allowed users** and adds their email.
3. They sign in. Done.

## Local use

Just open `index.html` in a browser, or `python3 -m http.server` in this folder.

## Labor report email auto-ingest

Labor reports can flow in automatically — no manual download/upload:

1. A Supabase Edge Function (`import-labor`) accepts report files, infers
   kind/date/shift from the filename (e.g. `PLX 2nd Labor 7-21.xls`), splits PLX
   billing workbooks into 1st/2nd shift at the "Shift 1 Total" row, and loads
   `labor_lines`. Re-sending a file replaces that date/shift/source cleanly.
2. `automation/gmail-labor-sync.gs` is a Google Apps Script that watches Gmail
   for labor report emails and posts each attachment to the function. Setup
   steps are in the file header (~5 min). Processed threads get labeled
   `CrescentOS/Ingested`.

Manual import on the Labor Recon page always remains available and uses the
same parsing logic.

### The three daily files

| File | Import as | Shape |
|---|---|---|
| `Crescent Labor <shift> <date>.xlsx` | **Clock export** | One row per badge scan: `Badge`, clock in/out, payable hours, `Line name`. Badge `PLX-21484630-BUR` → EID `21484630`. |
| `PLX Labor <shift> <date>.xls` | **PLX billing report** | Weekly grid: `Dept`/`File`/`Name`/`Bill Rate` then Mon–Sun hour columns. Contains **both** shifts, split at the `Shift 1 Total` row; the day column is picked from the report date. |
| `Active Crescent Assignments<stamp>.xlsx` | **Roster sync** (Associates page) | One row per active assignment. Someone holding two assignments (line worker + indirect) becomes one associate. |

The importer identifies the two labor reports by their header row rather than by
file extension — both arrive as Excel — and tells you if the source dropdown
doesn't match the file you picked.

## Roster sync

**Associates → Active assignments export → Sync roster.** Adds anyone new and
refreshes names, shifts, and phone numbers from the export. Before saving it
shows exactly what will change, warns if an active assignment belongs to someone
flagged DNR, and reports how many existing associates are no longer on the
export. Nobody is deleted — labor and early-leave history stays intact.

## Roadmap (groundwork already laid)

- **New-start email automation:** `new_starts.bg_verified` / `docs_signed` columns are ready
  to be set automatically from background-check and document-signing emails (same
  Edge Function pattern as labor ingest).
- Automated shift email sending.
- Additional Crescent buildings — add a `site` column to scale to all 4 locations.
