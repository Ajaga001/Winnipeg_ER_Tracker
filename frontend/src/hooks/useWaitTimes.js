// frontend/src/hooks/useWaitTimes.js
import { useState, useEffect, useCallback } from "react";
import { fetchLatest, fetchTrends } from "../lib/api";

// Polls latest wait times every 2 minutes (Shared Health updates ~15 min)
export function useLatestWaitTimes(pollMs = 2 * 60 * 1000) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const json = await fetchLatest();
      setData(json.wait_times ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, pollMs);
    return () => clearInterval(interval);
  }, [load, pollMs]);

  return { data, loading, error, lastUpdated, refresh: load };
}

// Fetches trend data for the chart; re-fetches when `hours` changes
export function useTrends(hours = 24) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetchTrends(hours)
      .then((json) => {
        // Pivot: [{scraped_at, wait_time_minutes, hospitals:{short_name}}]
        // → [{time, HSC Adult: 120, Grace: 90, ...}]
        const byTime = {};
        for (const row of json.readings ?? []) {
          const t = new Date(row.scraped_at).toISOString();
          if (!byTime[t]) byTime[t] = { time: t };
          const name = row.hospitals?.short_name ?? `Hospital ${row.hospital_id}`;
          byTime[t][name] = row.wait_time_minutes;
        }
        setData(Object.values(byTime).sort((a, b) => a.time.localeCompare(b.time)));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hours]);

  return { data, loading, error };
}
