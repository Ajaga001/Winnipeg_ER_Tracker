// frontend/src/components/LastUpdatedBadge.jsx
// Shows when the data was last scraped, not when the browser last polled, so a
// stopped scraper can't look live.

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { STALE_THRESHOLD_MINUTES, formatAge, newestScrape } from "@/lib/freshness";

function formatScrapeTime(date) {
  return date.toLocaleString("en-CA", {
    timeZone: "America/Winnipeg",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function LastUpdatedBadge({ hospitals, onRefresh }) {
  const now = useNow();
  const scrapedAt = newestScrape(hospitals);
  if (!scrapedAt) return null;

  const ageMinutes = now === null ? null : Math.round((now - scrapedAt.getTime()) / 60000);
  const isStale = ageMinutes !== null && ageMinutes > STALE_THRESHOLD_MINUTES;

  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs flex items-center gap-1 ${isStale ? "text-amber-400" : "text-slate-400"}`}>
        {isStale && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
        <span className="hidden sm:inline">Last updated {formatScrapeTime(scrapedAt)} ·</span>
        <span>{ageMinutes === null ? "" : formatAge(ageMinutes)}</span>
        {isStale && <span className="hidden md:inline">· may be out of date</span>}
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
