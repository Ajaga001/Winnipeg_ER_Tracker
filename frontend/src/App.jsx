// frontend/src/App.jsx
// Root dashboard layout — status cards grid + trend chart.

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import HospitalCard from "./components/HospitalCard";
import WaitTimeTrendChart from "./components/WaitTimeTrendChart";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLatestWaitTimes, useTrends } from "./hooks/useWaitTimes";

function LastUpdatedBadge({ date, onRefresh }) {
  if (!date) return null;
  const formatted = date.toLocaleTimeString("en-CA", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500">
        Updated {formatted}
      </span>
      <button
        onClick={onRefresh}
        className="text-xs text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
      >
        <RefreshCw className="w-3 h-3" />
        Refresh
      </button>
    </div>
  );
}

function StatSummary({ hospitals }) {
  if (!hospitals.length) return null;
  const withData = hospitals.filter((h) => h.wait_time_minutes != null);
  const avg = withData.length
    ? Math.round(withData.reduce((s, h) => s + h.wait_time_minutes, 0) / withData.length)
    : null;
  const shortest = withData.reduce((a, b) => a.wait_time_minutes < b.wait_time_minutes ? a : b, withData[0]);
  const longest  = withData.reduce((a, b) => a.wait_time_minutes > b.wait_time_minutes ? a : b, withData[0]);

  const fmt = (m) => {
    if (m == null) return "—";
    const h = Math.floor(m / 60), min = m % 60;
    return h > 0 ? `${h}h ${min > 0 ? min + "m" : ""}`.trim() : `${min}m`;
  };

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {[
        { label: "System Average", value: fmt(avg), sub: "across all sites" },
        { label: "Shortest Wait", value: fmt(shortest?.wait_time_minutes), sub: shortest?.short_name },
        { label: "Longest Wait",  value: fmt(longest?.wait_time_minutes),  sub: longest?.short_name  },
      ].map(({ label, value, sub }) => (
        <Card key={label} className="gap-0 border-slate-700/40 bg-slate-800/40 py-4">
          <CardContent className="px-4">
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className="text-white text-2xl font-bold font-mono">{value}</p>
            <p className="text-slate-500 text-xs mt-1 truncate">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function App() {
  const [trendHours, setTrendHours] = useState(24);
  const { data: latest, loading: latestLoading, error: latestError, lastUpdated, refresh } = useLatestWaitTimes();
  const { data: trends, loading: trendsLoading, error: trendsError } = useTrends(trendHours);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top nav bar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Pulse dot */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
            </span>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-tight">
                Manitoba ER Wait Times
              </h1>
              <p className="text-slate-500 text-xs hidden sm:block">
                Winnipeg Regional Health Authority — Live Dashboard
              </p>
            </div>
          </div>
          <LastUpdatedBadge date={lastUpdated} onRefresh={refresh} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Summary bar */}
        {!latestLoading && !latestError && <StatSummary hospitals={latest} />}

        {/* Status Cards */}
        <section>
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">
            Current Status — All Sites
          </h2>

          {latestLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl border border-slate-700/30 bg-slate-800/40" />
              ))}
            </div>
          )}

          {latestError && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-4 text-red-400 text-sm">
              Could not load hospital data: {latestError}
            </div>
          )}

          {!latestLoading && !latestError && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {latest.map((hospital) => (
                <HospitalCard key={hospital.hospital_id} hospital={hospital} />
              ))}
            </div>
          )}
        </section>

        {/* Trend Chart */}
        <section>
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">
            Historical Trends
          </h2>
          <WaitTimeTrendChart
            data={trends}
            loading={trendsLoading}
            error={trendsError}
            hours={trendHours}
            onHoursChange={setTrendHours}
          />
        </section>

        {/* Footer */}
        <footer className="pt-4 pb-8 border-t border-slate-800 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
          <span>Data source: Shared Health Manitoba / WRHA</span>
          <span>Auto-refreshes every 2 minutes</span>
        </footer>
      </main>
    </div>
  );
}
