# Outlook → Power Automate → CrescentOS

One folder, one flow, one endpoint. The flow has **no conditions and no
knowledge of report types** — it forwards every attachment it finds and the
`import-labor` Edge Function decides what each one is. Adding a sixth report
later means editing `supabase/functions/import-labor/parse.ts` and redeploying;
the flow never changes.

```
Outlook rule ─→ CrescentOS/Inbox ─→ Power Automate (4 actions) ─→ /functions/v1/import-labor
                                              │                            │
                                        CrescentOS/Failed          labor_lines · associates
                                        (anything non-200)              + import_log
```

## 1. Folders

Create two mail folders:

- `CrescentOS/Inbox` — what the flow watches
- `CrescentOS/Failed` — where anything the function rejects gets moved

## 2. One Outlook rule

**Settings → Mail → Rules → Add new rule** → *Move to* `CrescentOS/Inbox`.

Keep the rule **loose**. The function rejects and logs whatever it doesn't
recognize, so over-collecting is cheap; missing a report is not. Condition:
*From* any of these —

| Sender | Sends |
|---|---|
| `Reports@peoplenet-us.com` | PLX billing (Morning + Afternoon Labor File, weekly grid) |
| `sphillips@crescentway.com` | 2nd shift clock export (.xlsx) |
| `kmcchesney@crescentway.com` | 1st shift clock export (.csv) |
| `cwalker@crescentway.com` | clock export |
| `james.simms@employbridge.com` | revised labor report |
| `greg.triplett@employbridge.com` | shift labor report |
| `norma.wence@employbridge.com` | PLX temp labor / daily hours |
| `cody.hale@employbridge.com` | Salesforce report results (roster) |

Add a second rule if you'd rather match *Subject contains* `Labor Report` or
`Crescent Assignments` — same destination folder, same result.

> The Salesforce reports all look alike. **Ended GEODIS Assignments**,
> **1st/2nd Shift Crescent Assignments** and **Active Crescent Assignments**
> have identical columns; only the report title inside the workbook tells them
> apart. The function loads the active Crescent roster and logs the rest as
> skipped, so it's safe to let them all through the rule.

## 3. The flow (4 actions)

**Trigger — When a new email arrives in a folder (V3)**

| Setting | Value |
|---|---|
| Folder | `CrescentOS/Inbox` |
| Include Attachments | **Yes** |
| Only with Attachments | **Yes** |

**Action 2 — Apply to each** → over `Attachments`.

Inside the loop:

**Action 3 — HTTP** (premium connector)

- Method: `POST`
- URI: `https://ihiuenqvvvdbclgiitay.supabase.co/functions/v1/import-labor`
- Headers:
  ```
  Content-Type: application/json
  x-ingest-key: <the INGEST_KEY secret>
  ```
- Body:
  ```json
  {
    "filename": "@{items('Apply_to_each')?['Name']}",
    "contentBytes": "@{items('Apply_to_each')?['ContentBytes']}",
    "subject": "@{triggerOutputs()?['body/subject']}",
    "from": "@{triggerOutputs()?['body/from']}",
    "received": "@{triggerOutputs()?['body/receivedDateTime']}"
  }
  ```

Set **Settings → Retry Policy** on this action to *Exponential*, 4 retries.

**Action 4 — Condition:** `outputs('HTTP')['statusCode']` is equal to `200`.
On the **If no** branch, add **Move email (V2)** → message id
`triggerOutputs()?['body/id']`, folder `CrescentOS/Failed`.

That's the whole flow. Everything else lives in the function.

## 4. Deploy the function

```bash
supabase secrets set INGEST_KEY=<generate a long random string>
supabase functions deploy import-labor --no-verify-jwt
supabase db push        # creates import_log
```

`--no-verify-jwt` is required: the callers authenticate with `x-ingest-key`,
not a Supabase JWT.

## What the function does with each file

| Detected by | Loaded as | Dating |
|---|---|---|
| `Badge` column | clock export | Date and shift come from **the punches themselves**. The 2nd shift file arrives ~2:30am the next morning, so the received date would be a day late. |
| `Dept` + `Bill Rate` | PLX billing, or **revised** if the subject/filename says so | The workbook is a whole week — **every day with hours is loaded**, so the week fills in and self-corrects as the twice-daily files land. Week start comes from "For the week ending: 8/9/2026" in the subject. |
| Title `Active Crescent Assignments` | roster → `associates` | Point in time; no date needed. Only `full_name`, `phone`, `shift`, `name_key` are written — email, SSN last-4 and DNR status survive a sync. |
| a report we know but don't want (Ended GEODIS Assignments) | nothing | Logged as `skipped`, left where it is. |
| anything else | nothing | Logged as `unrecognized`, moved to `CrescentOS/Failed`. |

Loads replace rather than append, keyed on `(report_date, shift, source)`, so
re-sending a report is always safe. **Reprocessing = drag the email from
`CrescentOS/Failed` back into `CrescentOS/Inbox`.**

## Checking on it

```sql
select received_at, status, kind, row_count, filename, detail
from import_log order by received_at desc limit 20;
```

| `status` | Meaning | HTTP | Email moves to Failed? |
|---|---|---|---|
| `ok` | loaded | 200 | no |
| `skipped` | recognized, deliberately not loaded (signature image, Ended GEODIS Assignments) | 200 | no |
| `unrecognized` | a spreadsheet we couldn't identify | 422 | **yes** |
| `error` | identified but failed to parse or load | 422 | **yes** |

`detail.buckets` shows exactly which date/shift buckets each file wrote.

## Notes

- These reports are addressed to **`CrescentPark@prologistix.com`** (the
  "TeamGroup - VIP - Crescent Park" list), not to one person. If that resolves
  to a shared mailbox, point the trigger at it — *When a new email arrives in a
  shared mailbox (V2)* — so the automation doesn't stop when whoever owns the
  flow is out or leaves.
- Email signature images arrive as attachments; the function ignores anything
  that isn't `.xls`, `.xlsx` or `.csv`.
- The older `gmail-labor-sync.gs` posts the same payload shape to the same
  endpoint and keeps working unchanged.
