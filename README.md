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
| **Labor Recon** | Manual PLX vs clock comparison | Import clock CSV + Crescent .xls, per-EID diff with $ impact, revised report export |
| **Associates** | Nothing (new!) | One profile per EID: contact info, tracker record, early leave history, labor history, DNR status |
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

## Roadmap (groundwork already laid)

- **Email automation:** `new_starts.bg_verified` / `docs_signed` columns are ready to be set
  automatically from background-check and document-signing emails.
- **Staffing planner integration** and automated shift email sending.
- Additional Crescent buildings — add a `site` column to scale to all 4 locations.
