-- 01_hourly_heatmap.sql
-- Question: when in the day is each hospital busiest?
-- One row per hospital and hour of day. The mean leaves capped readings out,
-- because 900 is a floor rather than a value. `readings` shows how much evidence
-- sits behind each cell, since the scraper samples some hours far less often.
CREATE OR REPLACE VIEW analysis_hourly_heatmap WITH (security_invoker = true) AS
SELECT
    hospital_id,
    short_name,
    type,
    local_hour,
    COUNT(*)                                                        AS readings,
    COUNT(*) FILTER (WHERE wait_capped)                             AS capped_readings,
    ROUND(AVG(wait_time_minutes) FILTER (WHERE NOT wait_capped), 0) AS mean_wait_minutes,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_time_minutes)  AS median_wait_minutes
FROM analysis_readings
GROUP BY hospital_id, short_name, type, local_hour;
