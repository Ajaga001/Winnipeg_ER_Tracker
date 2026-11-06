-- 002_wait_capped.sql
-- The source reports "15 hrs" as a ceiling, so 900 minutes means "at least 15
-- hours", not exactly 15. Flag those readings so analysis can treat them as
-- censored. raw_wait_time and wait_time_minutes are left untouched.
--
-- Safe to run more than once. daily_wait_time_stats is dropped and rebuilt
-- because a materialized view's columns can't be altered; it is derived from
-- wait_times_log, so no source data is lost.

ALTER TABLE wait_times_log
    ADD COLUMN IF NOT EXISTS wait_capped BOOLEAN NOT NULL DEFAULT FALSE;

-- One-time backfill of historical readings (115 rows as of 2026-11-06).
UPDATE wait_times_log
SET wait_capped = TRUE
WHERE wait_time_minutes >= 900
  AND NOT wait_capped;

DROP MATERIALIZED VIEW IF EXISTS daily_wait_time_stats;

-- The mean excludes capped readings because 900 isn't their true value. The
-- median keeps them: it only needs their rank, and "at least 900" ranks correctly.
CREATE MATERIALIZED VIEW daily_wait_time_stats AS
SELECT
    hospital_id,
    DATE(scraped_at AT TIME ZONE 'America/Winnipeg')    AS stat_date,
    COUNT(*)                                            AS reading_count,
    COUNT(*) FILTER (WHERE wait_capped)                 AS capped_reading_count,
    ROUND((AVG(wait_time_minutes)
        FILTER (WHERE NOT wait_capped))::NUMERIC, 1)    AS avg_wait_minutes,
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

-- New columns must go last for CREATE OR REPLACE VIEW.
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
    wtl.scrape_status,
    wtl.wait_capped
FROM  wait_times_log wtl
JOIN  hospitals h ON h.id = wtl.hospital_id
WHERE h.is_active
ORDER BY wtl.hospital_id, wtl.scraped_at DESC;
