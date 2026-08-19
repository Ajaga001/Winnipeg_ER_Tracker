// frontend/src/components/WaitTimeTrendChart.jsx
// Multi-line Recharts chart with per-hospital toggle controls.

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Distinct, accessible colours for up to 8 hospitals
const HOSPITAL_COLOURS = [
  "#38bdf8", // sky-400      HSC Adult
  "#fb923c", // orange-400   HSC Children's
  "#a78bfa", // violet-400   Grace
  "#34d399", // emerald-400  St. Boniface
  "#f472b6", // pink-400     Concordia
  "#facc15", // yellow-400   Seven Oaks
  "#60a5fa", // blue-400     Victoria
  "#f87171", // red-400      Pan Am
];

function formatMinutes(mins) {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + "m" : ""}`.trim() : `${m}m`;
}

function formatAxisTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Custom tooltip so we show formatted hours/minutes instead of raw numbers
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const time = new Date(label).toLocaleString("en-CA", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-xs min-w-[180px]">
      <p className="text-slate-400 mb-2 font-medium">{time}</p>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .sort((a, b) => a.value - b.value)
        .map((entry) => (
          <div key={entry.dataKey} className="flex justify-between gap-4 py-0.5">
            <span style={{ color: entry.color }}>{entry.dataKey}</span>
            <span className="text-white font-mono">{formatMinutes(entry.value)}</span>
          </div>
        ))}
    </div>
  );
}

export default function WaitTimeTrendChart({ data, loading, error, hours, onHoursChange }) {
  // Derive the list of hospital names from the data keys
  const hospitalNames = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]).filter((k) => k !== "time");
  }, [data]);

  // All hospitals visible by default
  const [hidden, setHidden] = useState(new Set());

  const toggle = (name) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const showAll = () => setHidden(new Set());
  const hideAll = () => setHidden(new Set(hospitalNames));

  if (error) {
    return (
      <Card className="border-slate-700/50 bg-slate-800/70 p-8 text-center">
        <p className="text-red-400 text-sm">Failed to load trend data: {error}</p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden border-slate-700/50 bg-slate-800/70 py-0">
      {/* Chart header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50">
        <div>
          <h2 className="text-slate-100 font-semibold text-base">Wait Time Trends</h2>
          <p className="text-slate-400 text-xs mt-0.5">Median wait to see a physician</p>
        </div>

        {/* Time range selector */}
        <Tabs value={String(hours)} onValueChange={(v) => onHoursChange(Number(v))}>
          <TabsList>
            {[6, 12, 24, 48].map((h) => (
              <TabsTrigger key={h} value={String(h)}>{h}h</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Hospital toggle buttons */}
      <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-slate-700/30">
        <span className="text-slate-500 text-xs mr-1">Hospitals:</span>
        {hospitalNames.map((name, i) => {
          const colour = HOSPITAL_COLOURS[i % HOSPITAL_COLOURS.length];
          const isHidden = hidden.has(name);
          return (
            <button
              key={name}
              onClick={() => toggle(name)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                         border transition-all duration-150 ${
                isHidden
                  ? "border-slate-600 text-slate-500 bg-transparent"
                  : "border-transparent text-slate-200"
              }`}
              style={!isHidden ? { backgroundColor: colour + "22", borderColor: colour + "66" } : {}}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: isHidden ? "#475569" : colour }}
              />
              {name}
            </button>
          );
        })}
        <div className="ml-auto flex gap-2">
          <button onClick={showAll} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
            All
          </button>
          <button onClick={hideAll} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
            None
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 pt-4 pb-2">
        {loading ? (
          <div className="h-72 flex items-center justify-center">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-sky-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-slate-500 text-sm">
            No data available for this time range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={formatAxisTime}
                tick={{ fill: "#64748b", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={formatMinutes}
                tick={{ fill: "#64748b", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={46}
              />
              <Tooltip content={<CustomTooltip />} />
              {hospitalNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={HOSPITAL_COLOURS[i % HOSPITAL_COLOURS.length]}
                  strokeWidth={hidden.has(name) ? 0 : 2}
                  dot={false}
                  activeDot={hidden.has(name) ? false : { r: 4, strokeWidth: 0 }}
                  connectNulls
                  hide={hidden.has(name)}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
