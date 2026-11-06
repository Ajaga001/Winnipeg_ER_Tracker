// findingsRoutes.js
// Serves the analysis_* views (see queries/) to the frontend's Findings page.

import { Router } from "express";

const SUMMARY_VIEWS = {
  ranking: "analysis_hospital_ranking",
  weekdayWeekend: "analysis_weekday_weekend",
  capRate: "analysis_cap_rate",
  heatmap: "analysis_hourly_heatmap",
};

// The trend view holds one row per site per day, so bound it to stay well under
// Supabase's 1000-row response limit as the history grows.
const TREND_DAYS = 120;

async function fetchView(supabase, view) {
  const { data, error } = await supabase.from(view).select("*");
  if (error) throw error;
  return data;
}

async function fetchTrend(supabase) {
  const since = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("analysis_rolling_trend")
    .select("short_name, local_date, rolling_7d_mean_minutes")
    .gte("local_date", since)
    .order("local_date", { ascending: true });

  if (error) throw error;
  return data;
}

export function createFindingsRouter(supabase, limiter) {
  const router = Router();

  // GET /api/findings
  // Returns every dataset the Findings page charts.
  router.get("/api/findings", limiter, async (_req, res) => {
    try {
      const entries = await Promise.all(
        Object.entries(SUMMARY_VIEWS).map(async ([key, view]) => [key, await fetchView(supabase, view)])
      );
      const trend = await fetchTrend(supabase);

      res.json({ ...Object.fromEntries(entries), trend, fetched_at: new Date().toISOString() });
    } catch (err) {
      console.error("[/api/findings]", err.message);
      res.status(500).json({ error: "Failed to fetch findings." });
    }
  });

  return router;
}
