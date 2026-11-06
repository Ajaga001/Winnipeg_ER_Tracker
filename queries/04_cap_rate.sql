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
