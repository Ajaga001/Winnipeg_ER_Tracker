-- 02_weekday_weekend.sql
-- Question: are weekends actually worse than weekdays?
-- A plain average would be skewed by when the scraper happened to run, so this
-- averages each hour of the day first and then averages those hourly means.
-- Every hour counts equally, however often it was sampled.
CREATE OR REPLACE VIEW analysis_weekday_weekend WITH (security_invoker = true) AS
WITH hourly_means AS (
    SELECT
        hospital_id,
        short_name,
        type,
        is_weekend,
        local_hour,
        COUNT(*)                                              AS readings,
        AVG(wait_time_minutes) FILTER (WHERE NOT wait_capped) AS hour_mean
    FROM analysis_readings
    GROUP BY hospital_id, short_name, type, is_weekend, local_hour
),
day_type_means AS (
    SELECT
        hospital_id,
        short_name,
        type,
        is_weekend,
        SUM(readings)       AS readings,
        COUNT(hour_mean)    AS hours_covered,
        AVG(hour_mean)      AS balanced_mean
    FROM hourly_means
    GROUP BY hospital_id, short_name, type, is_weekend
)
SELECT
    hospital_id,
    short_name,
    type,
    (SUM(readings) FILTER (WHERE NOT is_weekend))::INT          AS weekday_readings,
    (SUM(readings) FILTER (WHERE is_weekend))::INT              AS weekend_readings,
    ROUND(MAX(balanced_mean) FILTER (WHERE NOT is_weekend), 0)  AS weekday_mean_minutes,
    ROUND(MAX(balanced_mean) FILTER (WHERE is_weekend), 0)      AS weekend_mean_minutes,
    ROUND(MAX(balanced_mean) FILTER (WHERE is_weekend)
        - MAX(balanced_mean) FILTER (WHERE NOT is_weekend), 0)  AS weekend_minus_weekday_minutes
FROM day_type_means
GROUP BY hospital_id, short_name, type
HAVING COUNT(*) = 2 AND MIN(hours_covered) >= 12;  -- both day types need most of the clock covered
