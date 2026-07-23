/**
 * CrescentOS — Gmail labor report auto-ingest
 *
 * Watches Gmail for the Crescent clock exports and PLX/Revised labor report
 * emails, and posts each attachment to the CrescentOS import-labor endpoint.
 * Manual upload in the app keeps working; this just saves the daily download/upload.
 *
 * SETUP (one time, ~5 minutes):
 *   1. Go to https://script.google.com → New project
 *   2. Paste this file, save
 *   3. Run `testRun` once and approve the Gmail permission prompt
 *   4. Triggers (clock icon) → Add Trigger → `processLaborEmails`,
 *      time-driven, every 30 minutes (or hourly)
 *
 * The script labels processed threads "CrescentOS/Ingested" so nothing runs twice.
 */

var INGEST_URL = "https://ihiuenqvvvdbclgiitay.supabase.co/functions/v1/import-labor";
var INGEST_KEY = "cos_ingest_FDpJZ0hfWIjpnsaxLtcNBsz_BVFRcgvi";

// Gmail searches that find the report emails. Tune to your senders/subjects.
var SEARCHES = [
  'has:attachment filename:xls (subject:"Labor" OR subject:"labor")',
  'has:attachment filename:csv subject:"Labor"',
];

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
          if (!/labor/i.test(name) && !/labor/i.test(msg.getSubject())) return;
          try {
            var resp = UrlFetchApp.fetch(INGEST_URL, {
              method: "post",
              contentType: "application/json",
              headers: { "x-ingest-key": INGEST_KEY },
              payload: JSON.stringify({
                filename: name,
                content_base64: Utilities.base64Encode(att.getBytes()),
                // kind/date/shift are inferred from the filename;
                // pass them explicitly here if a report needs overriding:
                // kind: "clock" | "client" | "revised", date: "2026-07-22", shift: "1st"
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
