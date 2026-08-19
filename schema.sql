-- =============================================================
-- Manitoba ER Wait Times – Supabase / PostgreSQL Schema
-- =============================================================
-- Run this in the Supabase SQL editor (or psql) to set up your
-- database. Execute top-to-bottom; everything is idempotent.
-- =============================================================


-- -------------------------------------------------------------
-- 1. HOSPITALS
-- Reference table – one row per physical hospital/urgent care.
-- Rarely updated; drives all foreign keys in wait_times_log.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitals (
    id              SERIAL          PRIMARY KEY,
    name            TEXT            NOT NULL UNIQUE,        -- "Health Sciences Centre - Adult Emergency"
    short_name      TEXT            NOT NULL,               -- "HSC Adult" – used in charts/labels
    type            TEXT            NOT NULL                -- 'emergency' | 'urgent_care'
                        CHECK (type IN ('emergency', 'urgent_care')),
    region          TEXT            NOT NULL DEFAULT 'WRHA',-- health authority region
    city            TEXT            NOT NULL DEFAULT 'Winnipeg',
    address         TEXT,
    latitude        NUMERIC(9, 6),
    longitude       NUMERIC(9, 6),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,  -- set FALSE if a site closes
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Seed with the seven WRHA ED/UC sites the scraper covers
INSERT INTO hospitals (name, short_name, type, region)
VALUES
    ('Health Sciences Centre - Adult Emergency',    'HSC Adult',     'emergency',   'WRHA'),
    ('Health Sciences Centre - Children''s Emergency', 'HSC Children''s', 'emergency', 'WRHA'),
    ('Grace Hospital',                              'Grace',         'emergency',   'WRHA'),
    ('St. Boniface Hospital',                       'St. Boniface',  'emergency',   'WRHA'),
    ('Concordia Hospital',                          'Concordia',     'emergency',   'WRHA'),
    ('Seven Oaks General Hospital',                 'Seven Oaks',    'emergency',   'WRHA'),
    ('Victoria Hospital',                           'Victoria',      'urgent_care', 'WRHA'),
    ('Pan Am Clinic Urgent Care',                   'Pan Am',        'urgent_care', 'WRHA')
ON CONFLICT (name) DO NOTHING;

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hospitals_updated_at ON hospitals;
CREATE TRIGGER hospitals_updated_at
    BEFORE UPDATE ON hospitals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -------------------------------------------------------------
-- 2. WAIT_TIMES_LOG
-- Append-only log – one row per hospital per scrape run.
-- Never update rows here; always insert new ones.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wait_times_log (
    id                  BIGSERIAL       PRIMARY KEY,
    hospital_id         INTEGER         NOT NULL
                            REFERENCES hospitals(id) ON DELETE RESTRICT,
    scraped_at          TIMESTAMPTZ     NOT NULL,           -- UTC timestamp from the scraper
    raw_wait_time       TEXT,                               -- original string e.g. "2h 15m"
    wait_time_minutes   INTEGER                             -- parsed total minutes; NULL = not posted
                            CHECK (wait_time_minutes IS NULL OR wait_time_minutes >= 0),
    patients_waiting    INTEGER                             -- headcount shown on the page; NULL = not posted
                            CHECK (patients_waiting IS NULL OR patients_waiting >= 0),
    scrape_status       TEXT            NOT NULL DEFAULT 'ok'
                            CHECK (scrape_status IN ('ok', 'site_down', 'parse_error', 'no_data')),
    notes               TEXT,                               -- optional free-text for anomalies
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()

    -- No updated_at – this table is append-only
);

-- Prevent exact duplicate scrapes (same hospital, same timestamp)
CREATE UNIQUE INDEX IF NOT EXISTS wait_times_log_hospital_scraped_at_uidx
    ON wait_times_log (hospital_id, scraped_at);


-- -------------------------------------------------------------
-- 3. INDEXES FOR COMMON QUERY PATTERNS
-- -------------------------------------------------------------

-- "Give me all readings for hospital X over the last N days"
CREATE INDEX IF NOT EXISTS wait_times_log_hospital_time_idx
    ON wait_times_log (hospital_id, scraped_at DESC);

-- "Give me the latest reading across all hospitals"
CREATE INDEX IF NOT EXISTS wait_times_log_scraped_at_idx
    ON wait_times_log (scraped_at DESC);

-- "Filter by scrape health (e.g. show only errors)"
CREATE INDEX IF NOT EXISTS wait_times_log_status_idx
    ON wait_times_log (scrape_status)
    WHERE scrape_status <> 'ok';


-- -------------------------------------------------------------
-- 4. MATERIALIZED VIEW – DAILY AGGREGATES
-- Refreshed by the scheduler after each scrape cycle.
-- Powers the trend charts without re-scanning the full log.
-- -------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_wait_time_stats AS
SELECT
    hospital_id,
    DATE(scraped_at AT TIME ZONE 'America/Winnipeg')    AS stat_date,
    COUNT(*)                                            AS reading_count,
    ROUND(AVG(wait_time_minutes)::NUMERIC, 1)           AS avg_wait_minutes,
    MIN(wait_time_minutes)                              AS min_wait_minutes,
    MAX(wait_time_minutes)                              AS max_wait_minutes,
    PERCENTILE_CONT(0.5) WITHIN GROUP
        (ORDER BY wait_time_minutes)                    AS median_wait_minutes
FROM  wait_times_log
WHERE scrape_status = 'ok'
  AND wait_time_minutes IS NOT NULL
GROUP BY hospital_id, DATE(scraped_at AT TIME ZONE 'America/Winnipeg')
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS daily_stats_hospital_date_uidx
    ON daily_wait_time_stats (hospital_id, stat_date);


-- -------------------------------------------------------------
-- 5. HELPER VIEW – LATEST READING PER HOSPITAL
-- Useful for a "current status" snapshot on the dashboard.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW latest_wait_times AS
SELECT DISTINCT ON (wtl.hospital_id)
    h.id                AS hospital_id,
    h.name              AS hospital_name,
    h.short_name,
    h.type,
    wtl.scraped_at,
    wtl.raw_wait_time,
    wtl.wait_time_minutes,
    wtl.patients_waiting,
    wtl.scrape_status
FROM  wait_times_log wtl
JOIN  hospitals h ON h.id = wtl.hospital_id
ORDER BY wtl.hospital_id, wtl.scraped_at DESC;


-- -------------------------------------------------------------
-- 6. ROW-LEVEL SECURITY (Supabase)
-- Public read, no public write. Inserts only from service role.
-- -------------------------------------------------------------
ALTER TABLE hospitals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wait_times_log   ENABLE ROW LEVEL SECURITY;

-- Anyone can read hospitals
CREATE POLICY IF NOT EXISTS "hospitals_public_read"
    ON hospitals FOR SELECT USING (TRUE);

-- Anyone can read wait time logs
CREATE POLICY IF NOT EXISTS "wait_times_log_public_read"
    ON wait_times_log FOR SELECT USING (TRUE);

-- Only the service role (your Python backend) can insert logs
CREATE POLICY IF NOT EXISTS "wait_times_log_service_insert"
    ON wait_times_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
