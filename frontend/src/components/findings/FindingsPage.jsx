// frontend/src/components/findings/FindingsPage.jsx
// Analysis of the collected history, one chart per question.

import CapRateChart from "./CapRateChart";
import RankingChart from "./RankingChart";
import RollingTrendChart from "./RollingTrendChart";
import WaitHeatmap from "./WaitHeatmap";
import WeekdayWeekendChart from "./WeekdayWeekendChart";
import { Skeleton } from "@/components/ui/skeleton";
import { useFindings } from "@/hooks/useFindings";
import { buildHeatmapRows, buildTrendRows, sitesWithEnoughData, trendSites } from "@/lib/findings";

function DataNotes() {
  return (
    <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5 text-xs text-slate-400 space-y-2">
      <h3 className="text-slate-200 font-semibold text-sm">Reading these charts</h3>
      <p>These are waits published by WRHA, sampled when the scraper ran. They describe the system, not what any one patient will wait.</p>
      <p>Sampling is uneven, about 8 snapshots a day rather than 48, and scraping stopped from Oct 26 to Nov 6, 2026.</p>
      <p>Urgent care sites only started being collected on Nov 6, 2026. They join these charts once they have 30 readings.</p>
    </section>
  );
}

export default function FindingsPage() {
  const { data, loading, error } = useFindings();

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl border border-slate-700/30 bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-4 text-red-400 text-sm">
        Could not load findings: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WaitHeatmap rows={buildHeatmapRows(data.heatmap)} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingChart ranking={data.ranking} />
        <CapRateChart sites={sitesWithEnoughData(data.capRate)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WeekdayWeekendChart sites={data.weekdayWeekend} />
        <RollingTrendChart rows={buildTrendRows(data.trend)} sites={trendSites(data.ranking)} />
      </div>
      <DataNotes />
    </div>
  );
}
