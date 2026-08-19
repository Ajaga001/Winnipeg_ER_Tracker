// frontend/src/components/HospitalCard.jsx
// Status card for a single hospital. Color-codes urgency by wait time.

import { Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const URGENCY = (mins) => {
  if (mins === null || mins === undefined) return "unknown";
  if (mins <= 60)   return "low";
  if (mins <= 180)  return "medium";
  if (mins <= 300)  return "high";
  return "critical";
};

const URGENCY_STYLES = {
  low:      { bar: "bg-emerald-400", badge: "bg-emerald-900/60 text-emerald-300", label: "Short wait" },
  medium:   { bar: "bg-amber-400",   badge: "bg-amber-900/60 text-amber-300",     label: "Moderate" },
  high:     { bar: "bg-orange-400",  badge: "bg-orange-900/60 text-orange-300",   label: "Long wait" },
  critical: { bar: "bg-red-400",     badge: "bg-red-900/60 text-red-300",         label: "Critical" },
  unknown:  { bar: "bg-slate-600",   badge: "bg-slate-700 text-slate-400",        label: "No data" },
};

function formatWait(mins) {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function HospitalCard({ hospital }) {
  const { hospital_name, short_name, type, wait_time_minutes, patients_waiting, scraped_at } = hospital;
  const urgency = URGENCY(wait_time_minutes);
  const styles = URGENCY_STYLES[urgency];

  const updatedAgo = scraped_at
    ? Math.round((Date.now() - new Date(scraped_at)) / 60000)
    : null;

  return (
    <Card className="relative gap-0 overflow-hidden border border-slate-700/50 bg-slate-800/70 py-0
                    hover:border-slate-500/70 transition-all duration-300 hover:-translate-y-0.5
                    hover:shadow-lg hover:shadow-black/30">
      {/* Urgency colour bar along top */}
      <div className={`h-1 w-full ${styles.bar} transition-colors duration-500`} />

      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h3 className="font-semibold text-slate-100 text-sm leading-tight">
              {short_name ?? hospital_name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">
              {type === "urgent_care" ? "Urgent Care" : "Emergency"}
            </p>
          </div>
          <Badge className={`shrink-0 ${styles.badge}`}>{styles.label}</Badge>
        </div>

        {/* Wait time – large display */}
        <div className="mb-4">
          <span className="text-3xl font-bold tracking-tight text-white font-mono">
            {formatWait(wait_time_minutes)}
          </span>
          <span className="text-slate-400 text-sm ml-2">wait</span>
        </div>

        {/* Secondary stats */}
        <div className="flex items-center gap-4 text-xs text-slate-400">
          {patients_waiting !== null && patients_waiting !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {patients_waiting} waiting
            </span>
          )}
          {updatedAgo !== null && (
            <span className="flex items-center gap-1 ml-auto">
              <Clock className="w-3 h-3" />
              {updatedAgo < 1 ? "just now" : `${updatedAgo}m ago`}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
