-- Audit trail for the import-labor ingest endpoint.
--
-- Every attachment that reaches the function lands here — loaded, skipped or
-- failed — so an automated ingest is never silently wrong. Rows are written by
-- the function using the service role, which bypasses RLS.

CREATE TABLE import_log (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  filename     TEXT,
  from_addr    TEXT,
  subject      TEXT,
  kind         TEXT,           -- clock | client | revised | roster | null when unrecognized
  status       TEXT NOT NULL,  -- ok | skipped (known, not loaded) | unrecognized | error
  row_count    INTEGER,
  detail       JSONB           -- { reason, buckets: [{date, shift, rows}], ... }
);

-- The Admin page reads this newest-first.
CREATE INDEX idx_import_log_received ON import_log(received_at DESC);

ALTER TABLE import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read the import log"
  ON import_log
  FOR SELECT
  USING (auth.role() = 'authenticated');
