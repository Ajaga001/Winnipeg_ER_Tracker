-- 004_lock_inserts_and_add_refresh.sql
-- Two gaps between the live database and schema.sql / functions.sql:
--   1. "Allow scraper insert" let anyone holding the public key write to
--      wait_times_log. The scraper uses the service role, which bypasses RLS.
--   2. refresh_daily_stats() was never created, so daily_wait_time_stats
--      could not be refreshed after each scrape.
--
-- Safe to run more than once.

DROP POLICY IF EXISTS "Allow scraper insert" ON wait_times_log;

CREATE OR REPLACE FUNCTION refresh_daily_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the function owner (postgres), not the caller
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_wait_time_stats;
END;
$$;

-- Supabase grants EXECUTE to anon and authenticated by default, so revoking
-- from PUBLIC alone isn't enough.
REVOKE ALL ON FUNCTION refresh_daily_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_daily_stats() TO service_role;
