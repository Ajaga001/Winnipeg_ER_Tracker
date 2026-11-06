-- 05_rolling_trend.sql
-- Question: are waits getting better or worse over time?
-- A calendar of every date keeps outages as visible gaps instead of squeezing
-- them out of the window. The 7-day average needs 4 days of data, so a thin
-- window shows as a gap rather than a confident-looking line.
CREATE OR REPLACE VIEW analysis_rolling_trend WITH (security_invoker = true) AS
WITH bounds AS (
    SELECT MIN(local_date) AS first_date, MAX(local_date) AS last_date
    FROM analysis_readings
),
calendar AS (
    SELECT generate_series(first_date, last_date, INTERVAL '1 day')::DATE AS local_date
    FROM bounds
),
sites AS (
    SELECT DISTINCT hospital_id, short_name, type
    FROM analysis_readings
),
daily AS (
    SELECT
        hospital_id,
        local_date,
        COUNT(*) AS readings,
        AVG(wait_time_minutes) FILTER (WHERE NOT wait_capped) AS daily_mean
    FROM analysis_readings
    GROUP BY hospital_id, local_date
),
windowed AS (
    SELECT
        s.hospital_id,
        s.short_name,
        s.type,
        c.local_date,
        COALESCE(d.readings, 0) AS readings,
        d.daily_mean,
        AVG(d.daily_mean) OVER seven_days   AS rolling_mean,
        COUNT(d.daily_mean) OVER seven_days AS days_in_window
    FROM sites s
    CROSS JOIN calendar c
    LEFT JOIN daily d
      ON d.hospital_id = s.hospital_id AND d.local_date = c.local_date
    WINDOW seven_days AS (
        PARTITION BY s.hospital_id
        ORDER BY c.local_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )
)
SELECT
    hospital_id,
    short_name,
    type,
    local_date,
    readings,
    ROUND(daily_mean, 0) AS daily_mean_minutes,
    CASE WHEN days_in_window >= 4 THEN ROUND(rolling_mean, 0) END AS rolling_7d_mean_minutes
FROM windowed;
