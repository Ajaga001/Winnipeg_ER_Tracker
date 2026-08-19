-- db/functions.sql
-- Run this in the Supabase SQL editor AFTER schema.sql.
-- Exposes a Postgres function the Python scheduler can call via supabase.rpc().

CREATE OR REPLACE FUNCTION refresh_daily_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the function owner (postgres), not the caller
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_wait_time_stats;
END;
$$;

-- Only the service role may call this
REVOKE ALL ON FUNCTION refresh_daily_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_daily_stats() TO service_role;
