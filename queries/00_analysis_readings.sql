-- 00_analysis_readings.sql
-- Clean base for every analysis view: one row per valid reading, with
-- Winnipeg-local time parts so hour-of-day and weekday mean what a patient
-- would expect, including across daylight saving changes.
CREATE OR REPLACE VIEW analysis_readings WITH (security_invoker = true) AS
WITH local_readings AS (
    SELECT
        l.hospital_id,
        h.short_name,
        h.type,
        l.scraped_at,
        l.scraped_at AT TIME ZONE 'America/Winnipeg' AS local_time,
        l.wait_time_minutes,
        l.wait_capped
    FROM  wait_times_log l
    JOIN  hospitals h ON h.id = l.hospital_id
    WHERE l.scrape_status = 'ok'
      AND l.wait_time_minutes IS NOT NULL
      AND h.is_active
)
SELECT
    hospital_id,
    short_name,
    type,
    scraped_at,
    local_time::DATE                        AS local_date,
    EXTRACT(HOUR FROM local_time)::INT      AS local_hour,
    EXTRACT(ISODOW FROM local_time) >= 6    AS is_weekend,
    wait_time_minutes,
    wait_capped
FROM local_readings;
