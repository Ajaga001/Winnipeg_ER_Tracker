-- 03_hospital_ranking.sql
-- Question: which sites have the longest typical and worst-case waits?
-- p50 is a typical wait and p90 is a bad one. Capped readings stay in, because
-- percentiles only need their rank; a p90 of exactly 900 means "at least 15 hours".
-- Sites need 30 readings to be ranked, so new urgent-care data joins by itself.
CREATE OR REPLACE VIEW analysis_hospital_ranking WITH (security_invoker = true) AS
WITH site_percentiles AS (
    SELECT
        hospital_id,
        short_name,
        type,
        COUNT(*) AS readings,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_time_minutes) AS p50_minutes,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_time_minutes) AS p90_minutes
    FROM analysis_readings
    GROUP BY hospital_id, short_name, type
    HAVING COUNT(*) >= 30
)
SELECT
    hospital_id,
    short_name,
    type,
    readings,
    p50_minutes,
    p90_minutes,
    p90_minutes - p50_minutes               AS p50_to_p90_spread_minutes,
    RANK() OVER (ORDER BY p50_minutes DESC) AS p50_rank,
    RANK() OVER (ORDER BY p90_minutes DESC) AS p90_rank
FROM site_percentiles;
