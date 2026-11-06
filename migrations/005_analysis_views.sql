-- 005_analysis_views.sql
-- Read-only views behind the Findings page, joined from queries/ in order.
-- Edit the files in queries/; tests/test_queries.py fails if this copy drifts.
-- Adds views only: no table or existing row changes. Safe to run more than once.

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

-- 04_cap_rate.sql
-- Question: how often does each hospital hit the 15-hour reporting ceiling?
-- The streak uses gaps-and-islands: subtracting a per-status row number from an
-- all-readings row number gives each unbroken run of capped readings its own id.
CREATE OR REPLACE VIEW analysis_cap_rate WITH (security_invoker = true) AS
WITH ordered AS (
    SELECT
        hospital_id,
        short_name,
        type,
        local_date,
        scraped_at,
        wait_capped,
        ROW_NUMBER() OVER (PARTITION BY hospital_id ORDER BY scraped_at)
          - ROW_NUMBER() OVER (PARTITION BY hospital_id, wait_capped ORDER BY scraped_at) AS island
    FROM analysis_readings
),
capped_runs AS (
    SELECT hospital_id, COUNT(*) AS run_length
    FROM ordered
    WHERE wait_capped
    GROUP BY hospital_id, island
),
longest_runs AS (
    SELECT hospital_id, MAX(run_length) AS longest_capped_streak
    FROM capped_runs
    GROUP BY hospital_id
)
SELECT
    o.hospital_id,
    o.short_name,
    o.type,
    COUNT(*)                                                    AS readings,
    COUNT(*) FILTER (WHERE o.wait_capped)                       AS capped_readings,
    ROUND(100.0 * COUNT(*) FILTER (WHERE o.wait_capped) / COUNT(*), 1) AS cap_rate_pct,
    COUNT(DISTINCT o.local_date) FILTER (WHERE o.wait_capped)   AS days_with_cap,
    COALESCE(MAX(r.longest_capped_streak), 0)                   AS longest_capped_streak,
    MAX(o.scraped_at) FILTER (WHERE o.wait_capped)              AS last_capped_at
FROM ordered o
LEFT JOIN longest_runs r ON r.hospital_id = o.hospital_id
GROUP BY o.hospital_id, o.short_name, o.type;

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
