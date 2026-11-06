-- 003_scrape_runs.sql
-- One row per scrape cycle, so "when did we last succeed?" has a direct answer.
-- Replaces the old sentinel rows that were written against HSC Adult whenever
-- the whole scrape failed. Existing site_down rows are left in place.
--
-- Safe to run more than once. Only adds a new table.

CREATE TABLE IF NOT EXISTS scrape_runs (
    id                  BIGSERIAL       PRIMARY KEY,
    started_at          TIMESTAMPTZ     NOT NULL,
    finished_at         TIMESTAMPTZ     NOT NULL,
    status              TEXT            NOT NULL
                            CHECK (status IN ('success', 'partial', 'failed')),
    hospitals_parsed    INTEGER         NOT NULL DEFAULT 0,
    error               TEXT
);

CREATE INDEX IF NOT EXISTS scrape_runs_finished_at_idx
    ON scrape_runs (finished_at DESC);

-- No public policies: only the service role, which bypasses RLS, can read or write.
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
