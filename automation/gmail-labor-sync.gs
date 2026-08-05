/**
 * CrescentOS — Gmail labor report auto-ingest
 *
 * Watches Gmail for report emails and posts each attachment to the CrescentOS
 * import-labor endpoint, which identifies each file from its contents (clock
 * export, PLX billing, revised report, or roster) and loads it.
 * Manual upload in the app keeps working; this just saves the daily download/upload.
 *
 * If your reports arrive in Outlook, use automation/outlook-power-automate.md
 * instead — same endpoint, same payload.
 *
 * SETUP (one time, ~5 minutes):
 *   1. Go to https://script.google.com → New project
 *   2. Paste this file, save
 *   3. Project Settings → Script Properties → add INGEST_KEY (same value as
 *      `supabase secrets set INGEST_KEY=...`)
 *   4. Run `testRun` once and approve the Gmail permission prompt
 *   5. Triggers (clock icon) → Add Trigger → `processLaborEmails`,
 *      time-driven, every 30 minutes (or hourly)
 *
 * The script labels processed threads "CrescentOS/Ingested" so nothing runs twice.
 */

var INGEST_URL = "https://ihiuenqvvvdbclgiitay.supabase.co/functions/v1/import-labor";

// Set once under Project Settings → Script Properties → INGEST_KEY, matching
// the value of `supabase secrets set INGEST_KEY=...`. Keeping it out of the
// file means the key is never committed.
function ingestKey_() {
  var k = PropertiesService.getScriptProperties().getProperty("INGEST_KEY");
  if (!k) throw new Error("Script Property INGEST_KEY is not set — see the header of this file.");
  return k;
}

// Gmail searches that find the report emails. Tune to your senders/subjects.
// Keep these loose — the endpoint logs and skips anything it doesn't recognize,
// so over-collecting is cheap and missing a report is not.
var SEARCHES = [
  'has:attachment (subject:"Labor" OR subject:"Assignments")',
];

// Subject/filename must look like one of our reports before it's posted.
var LOOKS_LIKE_REPORT = /labor|assignments/i;

var LABEL = "CrescentOS/Ingested";

function processLaborEmails() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  SEARCHES.forEach(function (q) {
    var threads = GmailApp.search(q + " -label:" + LABEL.replace("/", "-") + " newer_than:7d", 0, 20);
    threads.forEach(function (thread) {
      var ingested = 0;
      thread.getMessages().forEach(function (msg) {
        msg.getAttachments().forEach(function (att) {
          var name = att.getName();
          if (!/\.(xls|xlsx|csv)$/i.test(name)) return;
          if (!LOOKS_LIKE_REPORT.test(name) && !LOOKS_LIKE_REPORT.test(msg.getSubject())) return;
          try {
            var resp = UrlFetchApp.fetch(INGEST_URL, {
              method: "post",
              contentType: "application/json",
              headers: { "x-ingest-key": ingestKey_() },
              payload: JSON.stringify({
                filename: name,
                content_base64: Utilities.base64Encode(att.getBytes()),
                subject: msg.getSubject(),
                from: msg.getFrom(),
                received: msg.getDate().toISOString(),
                // The function identifies the report from its contents and
                // dates it from the data. Override only to force a re-import:
                // kind: "clock" | "client" | "revised" | "roster",
                // date: "2026-08-03", shift: "1st"
              }),
              muteHttpExceptions: true,
            });
            var code = resp.getResponseCode();
            Logger.log(name + " -> " + code + " " + resp.getContentText());
            if (code === 200) ingested++;
          } catch (e) {
            Logger.log("FAILED " + name + ": " + e);
          }
        });
      });
      if (ingested > 0) thread.addLabel(label);
    });
  });
}

function testRun() {
  processLaborEmails();
  Logger.log("Done — check the log above and the Labor Recon page in CrescentOS.");
}
